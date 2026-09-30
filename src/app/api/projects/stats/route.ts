import { db, list, type Sprint, type Task } from "@/lib/db";

/** Usage and delivery statistics for one project. */
export async function GET(req: Request) {
  const id = new URL(req.url).searchParams.get("id");
  if (!id) return Response.json({ error: "id manquant" }, { status: 400 });
  const d = db();
  const usage = d
    .prepare(
      `SELECT COUNT(*) AS calls, COALESCE(SUM(prompt_tokens),0) AS prompt_tokens, COALESCE(SUM(completion_tokens),0) AS completion_tokens,
       COALESCE(SUM(latency_ms),0) AS compute_ms, SUM(status = 'error') AS errors FROM usage_logs WHERE project_id = ?`,
    )
    .get(id);
  const byAgent = d
    .prepare(
      `SELECT u.agent_id, a.name, a.emoji, a.color, COUNT(*) AS calls, SUM(u.prompt_tokens + u.completion_tokens) AS tokens, SUM(u.latency_ms) AS compute_ms
       FROM usage_logs u LEFT JOIN agents a ON a.id = u.agent_id WHERE u.project_id = ? AND u.agent_id IS NOT NULL GROUP BY u.agent_id ORDER BY compute_ms DESC`,
    )
    .all(id);
  const tasks = list<Task>("tasks").filter((t) => t.project_id === id);
  const evaluated = tasks.filter((t) => t.evaluation);
  const corrections = tasks.reduce((n, t) => n + (t.notes ?? []).filter((x) => x.text.startsWith("↩️")).length, 0);
  const firstTry = tasks.filter((t) => t.status === "done" && !(t.notes ?? []).some((x) => x.text.startsWith("↩️"))).length;
  const points = (ts: Task[]) => ts.reduce((n, t) => n + (t.complexity || 0), 0);
  const sprints = list<Sprint>("sprints")
    .filter((s) => s.project_id === id)
    .map((s) => {
      const mine = tasks.filter((t) => t.sprint_id === s.id);
      return { id: s.id, name: s.name, status: s.status, planned: points(mine), done: points(mine.filter((t) => t.status === "done")), tasks: mine.length };
    });
  const conversations = d.prepare("SELECT COUNT(*) AS n FROM conversations WHERE target_type = 'project' AND target_id = ?").get(id) as { n: number };
  return Response.json({
    usage,
    byAgent,
    tasks: {
      total: tasks.length,
      byStatus: Object.fromEntries(["todo", "doing", "review", "done"].map((s) => [s, tasks.filter((t) => t.status === s).length])),
      points: points(tasks),
      pointsDone: points(tasks.filter((t) => t.status === "done")),
      avgScore: evaluated.length ? evaluated.reduce((n, t) => n + (t.evaluation?.score ?? 0), 0) / evaluated.length : null,
      corrections,
      firstTry,
      estimated: tasks.filter((t) => t.complexity > 0).length,
    },
    sprints,
    conversations: conversations.n,
  });
}
