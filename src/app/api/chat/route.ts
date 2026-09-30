import { db, get, newId, now, type Agent, type Project } from "@/lib/db";
import type { ChatMessage } from "@/lib/gateway";
import { runAgent, teamRuntime, type Phase, type TeamRuntime } from "@/lib/orchestrator";
import { activeRunFor, startRun, streamRun } from "@/lib/runs";
import { workspaceFor } from "@/lib/tools";

type Body = {
  conversationId?: string;
  targetType: "project" | "agent";
  targetId: string;
  message: string;
  /** User validated the scoping: switch the conversation to execution. */
  approve?: boolean;
};

/** Start a chat turn as a background run and stream it. Closing the stream does not stop the run. */
export async function POST(req: Request) {
  const body = (await req.json()) as Body;
  const d = db();
  if (!body.message?.trim()) return Response.json({ error: "Message vide" }, { status: 400 });

  let speaker: Agent | undefined;
  let team: TeamRuntime | undefined;
  let project: Project | undefined;
  if (body.targetType === "project") {
    project = get<Project>("projects", body.targetId);
    if (!project) return Response.json({ error: "Projet introuvable" }, { status: 404 });
    team = teamRuntime(project.team);
    speaker = team.agents.get(team.spec.entry_ids[0] ?? team.spec.agent_ids[0]);
    if (!speaker) return Response.json({ error: "Ce projet n'a pas de premier contact : définis-le dans l'onglet Équipe du projet." }, { status: 400 });
  } else speaker = get<Agent>("agents", body.targetId);
  if (!speaker) return Response.json({ error: "Agent introuvable" }, { status: 404 });
  if (body.conversationId && activeRunFor(body.conversationId))
    return Response.json({ error: "Une réponse est déjà en cours dans cette conversation" }, { status: 409 });

  // ---- conversation + phase
  let conversationId: string = body.conversationId ?? "";
  let phase: Phase = "free";
  const title = body.message.trim().slice(0, 70);
  const existing = conversationId ? (d.prepare("SELECT phase FROM conversations WHERE id = ?").get(conversationId) as { phase: string } | undefined) : undefined;
  if (!existing) {
    conversationId = newId();
    phase = team?.spec.clarify ? "cadrage" : "free";
    d.prepare("INSERT INTO conversations (id, target_type, target_id, title, phase, created_at, updated_at) VALUES (?,?,?,?,?,?,?)").run(
      conversationId,
      body.targetType,
      body.targetId,
      title,
      phase,
      now(),
      now(),
    );
  } else phase = (existing.phase as Phase) || "free";
  if (body.approve && phase === "cadrage") {
    phase = "execution";
    d.prepare("UPDATE conversations SET phase = ? WHERE id = ?").run(phase, conversationId);
  }

  const ctx = project
    ? { workspace: await workspaceFor(project.name, project.path), projectId: project.id, team: team!.spec.agent_ids.map((id) => team!.agents.get(id)!).filter(Boolean) }
    : { workspace: await workspaceFor(null), projectId: "", team: [speaker] };
  if (project) d.prepare("UPDATE projects SET updated_at = ? WHERE id = ?").run(now(), project.id);

  // Only the user ↔ speaker exchange is replayed as history; delegations stay in the trace.
  const history = (
    d.prepare("SELECT role, content FROM messages WHERE conversation_id = ? ORDER BY created_at DESC LIMIT 20").all(conversationId) as {
      role: "user" | "assistant";
      content: string;
    }[]
  )
    .reverse()
    .map((m) => ({ role: m.role, content: m.content }) as ChatMessage);

  d.prepare("INSERT INTO messages (id, conversation_id, role, agent_id, content, created_at) VALUES (?,?,?,?,?,?)").run(
    newId(),
    conversationId,
    "user",
    null,
    body.message,
    now(),
  );

  const convId = conversationId;
  const lead = speaker;
  const run = startRun(
    { id: newId(), conversationId: convId, targetType: body.targetType, targetId: body.targetId, title, userMessage: body.message },
    async (emit, signal) => {
      let content = "";
      try {
        content = await runAgent({ agent: lead, input: body.message, history, team, phase, emit, signal, ctx });
      } catch (e) {
        const message = signal.aborted ? "Arrêté" : e instanceof Error ? e.message : String(e);
        content = `⚠️ ${message}`;
        emit({ type: "error", message });
      }
      const trace = run.trace;
      for (const c of Object.values(trace.calls)) c.reasoning = c.reasoning.slice(0, 4000);
      const messageId = newId();
      d.prepare("INSERT INTO messages (id, conversation_id, role, agent_id, content, trace, created_at) VALUES (?,?,?,?,?,?,?)").run(
        messageId,
        convId,
        "assistant",
        lead.id,
        content,
        JSON.stringify(trace),
        now(),
      );
      d.prepare("UPDATE conversations SET updated_at = ? WHERE id = ?").run(now(), convId);
      emit({ type: "done", messageId });
    },
  );
  return streamRun(run);
}
