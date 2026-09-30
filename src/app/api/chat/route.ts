import { db, get, newId, now, type Agent, type Project } from "@/lib/db";
import type { ChatMessage } from "@/lib/gateway";
import { PLANNING_SCOPING, runAgent, teamRuntime, type Phase, type TeamRuntime } from "@/lib/orchestrator";
import { planProject } from "@/lib/planner";
import { appendDecision } from "@/lib/decisions";
import { activeRunFor, startRun, streamRun } from "@/lib/runs";
import { workspaceFor } from "@/lib/tools";

type Body = {
  conversationId?: string;
  targetType: "project" | "agent";
  targetId: string;
  message: string;
  /** User validated the scoping: switch the conversation to execution (or create the tasks, for planning). */
  approve?: boolean;
  /** Only for a new conversation: "planning" = scoping discussion that ends with the project breakdown. */
  kind?: "planning";
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
  let kind = "";
  const title = body.message.trim().slice(0, 70);
  const existing = conversationId ? (d.prepare("SELECT phase, kind FROM conversations WHERE id = ?").get(conversationId) as { phase: string; kind: string } | undefined) : undefined;
  if (!existing) {
    conversationId = newId();
    kind = body.kind === "planning" && project ? "planning" : "";
    // Planning conversations always start with a scoping discussion.
    phase = kind === "planning" || team?.spec.clarify ? "cadrage" : "free";
    d.prepare("INSERT INTO conversations (id, target_type, target_id, title, phase, kind, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?)").run(
      conversationId,
      body.targetType,
      body.targetId,
      kind === "planning" ? `🗂️ Cadrage : ${title}` : title,
      phase,
      kind,
      now(),
      now(),
    );
  } else {
    phase = (existing.phase as Phase) || "free";
    kind = existing.kind || "";
  }
  const planningNow = kind === "planning" && !!body.approve && phase === "cadrage";
  if (body.approve && phase === "cadrage") {
    phase = "execution";
    d.prepare("UPDATE conversations SET phase = ? WHERE id = ?").run(phase, conversationId);
  }

  const ctx = project
    ? { workspace: await workspaceFor(project.name, project.path), projectId: project.id, team: team!.spec.agent_ids.map((id) => team!.agents.get(id)!).filter(Boolean) }
    : { workspace: await workspaceFor(null), projectId: "", team: [speaker] };
  if (project) d.prepare("UPDATE projects SET updated_at = ? WHERE id = ?").run(now(), project.id);
  // Validated scoping becomes the first entry of the project's decision log.
  if (project && body.approve) {
    const scoping = d.prepare("SELECT content FROM messages WHERE conversation_id = ? AND role = 'assistant' ORDER BY created_at DESC LIMIT 1").get(conversationId) as
      | { content: string }
      | undefined;
    await appendDecision(
      ctx.workspace,
      "Cadrage validé",
      `**Validation de l'utilisateur :** ${body.message}\n\n**Cadrage retenu :**\n${(scoping?.content ?? "").slice(0, 3000)}`,
      "Utilisateur",
    ).catch(() => {});
  }

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
        if (planningNow && project) {
          // Validated scoping: the whole discussion becomes the brief for the breakdown.
          const transcript = [...history, { role: "user", content: body.message }]
            .map((m) => `${m.role === "user" ? "Utilisateur" : lead.name} : ${m.content}`)
            .join("\n\n")
            .slice(-8000);
          const r = await planProject({ project: get<Project>("projects", project.id) ?? project, brief: transcript, sprints: true, emit, signal });
          content =
            `✅ Planification créée par ${r.credit} : **${r.tasks.length} tâche(s)**${r.sprints ? ` réparties en **${r.sprints} sprint(s)**` : ""}.\n\n` +
            r.tasks.map((t) => `- ${t.title}${t.complexity ? ` (${t.complexity} pts)` : ""}`).join("\n") +
            `\n\nRetrouve-les dans **Projets → Tâches** : tu peux les ajuster, puis lancer la chaîne ou un sprint.`;
        } else
          content = await runAgent({
            agent: lead,
            input: body.message,
            history,
            team,
            phase,
            emit,
            signal,
            ctx,
            scopingNote: kind === "planning" ? PLANNING_SCOPING : undefined,
          });
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
