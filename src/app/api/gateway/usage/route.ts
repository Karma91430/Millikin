import { denied, guard } from "@/lib/access";
import { db } from "@/lib/db";

/** Usage of the models (admins see everyone's, other users their own). */
export async function GET(req: Request) {
  let who = "%";
  try {
    const u = guard(req, "read");
    if (u && u.role !== "admin") who = u.id;
  } catch (e) {
    return denied(e);
  }
  const days = Number(new URL(req.url).searchParams.get("days") ?? 7);
  const since = Date.now() - days * 86400_000;
  const d = db();
  const totals = d
    .prepare(
      `SELECT COUNT(*) AS calls, COALESCE(SUM(prompt_tokens),0) AS prompt_tokens, COALESCE(SUM(completion_tokens),0) AS completion_tokens,
       COALESCE(AVG(latency_ms),0) AS avg_latency, SUM(status = 'error') AS errors FROM usage_logs WHERE ts >= ? AND user_id LIKE ?`,
    )
    .get(since, who);
  const byModel = d
    .prepare(
      `SELECT provider, model, COUNT(*) AS calls, SUM(prompt_tokens) AS prompt_tokens, SUM(completion_tokens) AS completion_tokens,
       AVG(latency_ms) AS avg_latency, SUM(status = 'error') AS errors FROM usage_logs WHERE ts >= ? AND user_id LIKE ? GROUP BY provider, model ORDER BY calls DESC`,
    )
    .all(since, who);
  const byAgent = d
    .prepare(
      `SELECT u.agent_id, a.name, a.emoji, COUNT(*) AS calls, SUM(u.prompt_tokens + u.completion_tokens) AS tokens, AVG(u.latency_ms) AS avg_latency
       FROM usage_logs u LEFT JOIN agents a ON a.id = u.agent_id WHERE u.ts >= ? AND u.user_id LIKE ? AND u.agent_id IS NOT NULL GROUP BY u.agent_id ORDER BY calls DESC`,
    )
    .all(since, who);
  const bySource = d.prepare("SELECT source, COUNT(*) AS calls FROM usage_logs WHERE ts >= ? AND user_id LIKE ? GROUP BY source").all(since, who);
  const perDay = d
    .prepare(
      `SELECT strftime('%Y-%m-%d', ts / 1000, 'unixepoch', 'localtime') AS day, COUNT(*) AS calls, SUM(prompt_tokens + completion_tokens) AS tokens
       FROM usage_logs WHERE ts >= ? AND user_id LIKE ? GROUP BY day ORDER BY day`,
    )
    .all(since, who);
  const recent = d
    .prepare(
      `SELECT u.*, a.name AS agent_name FROM usage_logs u LEFT JOIN agents a ON a.id = u.agent_id WHERE u.user_id LIKE ? ORDER BY u.id DESC LIMIT 40`,
    )
    .all(who);
  return Response.json({ totals, byModel, byAgent, bySource, perDay, recent });
}
