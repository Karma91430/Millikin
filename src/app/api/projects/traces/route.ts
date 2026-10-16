import { denied, guard, guardProject } from "@/lib/access";
import { db, list, type Sprint, type Task } from "@/lib/db";
import { getRun, listRuns } from "@/lib/runs";
import type { Trace } from "@/lib/trace";

export type TraceSummary = {
  id: string;
  kind: "chat" | "task" | "review" | "live";
  title: string;
  status: "running" | "done" | "error";
  startedAt: number;
  endedAt: number;
  calls: number;
  tools: number;
  errors: number;
  tokens: number;
  agents: string[];
};

/** Figures of one saved trace, for the list. */
function summarize(id: string, kind: TraceSummary["kind"], title: string, trace: Trace, fallbackAt: number, running = false): TraceSummary | null {
  const calls = Object.values(trace.calls ?? {});
  if (!calls.length) return null;
  const startedAt = Math.min(...calls.map((c) => c.startedAt));
  const endedAt = Math.max(...calls.map((c) => c.endedAt ?? c.startedAt), ...calls.flatMap((c) => c.tools.map((t) => t.endedAt ?? 0)));
  const errors = calls.filter((c) => c.status === "error").length + calls.reduce((n, c) => n + c.tools.filter((t) => t.error).length, 0) + (trace.error ? 1 : 0);
  return {
    id,
    kind,
    title: title.split("\n")[0].slice(0, 140),
    status: running ? "running" : errors && calls.some((c) => c.status === "error") ? "error" : "done",
    startedAt: startedAt || fallbackAt,
    endedAt: endedAt || fallbackAt,
    calls: calls.length,
    tools: calls.reduce((n, c) => n + c.tools.filter((t) => t.name !== "ask_agent").length, 0),
    errors,
    tokens: calls.reduce((n, c) => n + (c.llm ?? []).reduce((m, s) => m + s.promptTokens + s.completionTokens, 0), 0),
    agents: [...new Set(calls.map((c) => c.agentId))],
  };
}

const parse = (raw: unknown): Trace | null => {
  if (!raw) return null;
  try {
    const t = (typeof raw === "string" ? JSON.parse(raw) : raw) as Trace | null;
    return t?.calls ? t : null;
  } catch {
    return null;
  }
};

/** Saved runs of a project: chat turns and ticket runs, plus the runs in progress. ?run=<id> returns one full trace. */
async function handleGET(req: Request) {
  const sp = new URL(req.url).searchParams;
  const projectId = sp.get("id");
  if (!projectId) return Response.json({ error: "id manquant" }, { status: 400 });
  const run = sp.get("run");
  const d = db();

  if (run) {
    const [kind, id] = run.split(":");
    let trace: Trace | null = null;
    if (kind === "chat") {
      const row = d
        .prepare("SELECT m.trace FROM messages m JOIN conversations c ON c.id = m.conversation_id WHERE m.id = ? AND c.target_type = 'project' AND c.target_id = ?")
        .get(id, projectId) as { trace: string } | undefined;
      trace = parse(row?.trace);
    } else if (kind === "task") {
      const task = list<Task>("tasks").find((t) => t.id === id && t.project_id === projectId);
      trace = parse(task?.trace);
    } else if (kind === "review") {
      const row = d.prepare("SELECT review_trace FROM sprints WHERE id = ? AND project_id = ?").get(id, projectId) as { review_trace: string } | undefined;
      trace = parse(row?.review_trace);
    } else if (kind === "live") {
      const r = getRun(id);
      if (r && r.targetId === projectId) trace = r.trace;
    }
    return trace ? Response.json(trace) : Response.json({ error: "Trace introuvable" }, { status: 404 });
  }

  const out: TraceSummary[] = [];
  const live = listRuns().filter((r) => r.targetId === projectId && r.status === "running");
  for (const r of live) {
    const t = getRun(r.id)?.trace;
    const s = t && summarize(`live:${r.id}`, "live", r.title, t, r.startedAt, true);
    if (s) out.push(s);
  }
  const rows = d
    .prepare(
      `SELECT m.id, m.trace, m.created_at, c.title FROM messages m JOIN conversations c ON c.id = m.conversation_id
       WHERE c.target_type = 'project' AND c.target_id = ? AND m.role = 'assistant' AND m.trace IS NOT NULL ORDER BY m.created_at DESC LIMIT 200`,
    )
    .all(projectId) as { id: string; trace: string; created_at: number; title: string }[];
  for (const r of rows) {
    const t = parse(r.trace);
    const first = t && t.order.map((id) => t.calls[id]).find((c) => c && !c.parentCallId);
    const s = t && summarize(`chat:${r.id}`, "chat", first?.input || r.title || "Conversation", t, r.created_at);
    if (s) out.push(s);
  }
  for (const task of list<Task>("tasks").filter((t) => t.project_id === projectId)) {
    const t = parse(task.trace);
    const s = t && summarize(`task:${task.id}`, "task", task.title, t, (task as Task & { updated_at?: number }).updated_at ?? 0);
    if (s) out.push(s);
  }
  const reviews = d.prepare("SELECT id, name, review_trace, updated_at FROM sprints WHERE project_id = ? AND review_trace IS NOT NULL AND review_trace != 'null'").all(projectId) as (Pick<Sprint, "id" | "name"> & { review_trace: string; updated_at: number })[];
  for (const r of reviews) {
    const t = parse(r.review_trace);
    const s = t && summarize(`review:${r.id}`, "review", `Revue du sprint « ${r.name} »`, t, r.updated_at);
    if (s) out.push(s);
  }
  out.sort((a, b) => (a.status === "running" ? -1 : 0) - (b.status === "running" ? -1 : 0) || b.startedAt - a.startedAt);
  return Response.json(out);
}

/** Read access to the project given in ?id=. */
export async function GET(req: Request) {
  try {
    guardProject(guard(req, "read"), new URL(req.url).searchParams.get("id"));
    return await handleGET(req);
  } catch (e) {
    return denied(e);
  }
}
