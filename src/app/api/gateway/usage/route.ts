import { db } from "@/lib/db";

export async function GET(req: Request) {
  const days = Number(new URL(req.url).searchParams.get("days") ?? 7);
  const since = Date.now() - days * 86400_000;
  const d = db();
  const totals = d
    .prepare(
      `SELECT COUNT(*) AS calls, COALESCE(SUM(prompt_tokens),0) AS prompt_tokens, COALESCE(SUM(completion_tokens),0) AS completion_tokens,
       COALESCE(AVG(latency_ms),0) AS avg_latency, SUM(status = 'error') AS errors FROM usage_logs WHERE ts >= ?`,
    )
    .get(since);
  const byModel = d
    .prepare(
      `SELECT provider, model, COUNT(*) AS calls, SUM(prompt_tokens) AS prompt_tokens, SUM(completion_tokens) AS completion_tokens,
       AVG(latency_ms) AS avg_latency, SUM(status = 'error') AS errors FROM usage_logs WHERE ts >= ? GROUP BY provider, model ORDER BY calls DESC`,
    )
    .all(since);
  const byAgent = d
    .prepare(
      `SELECT u.agent_id, a.name, a.emoji, COUNT(*) AS calls, SUM(u.prompt_tokens + u.completion_tokens) AS tokens, AVG(u.latency_ms) AS avg_latency
       FROM usage_logs u LEFT JOIN agents a ON a.id = u.agent_id WHERE u.ts >= ? AND u.agent_id IS NOT NULL GROUP BY u.agent_id ORDER BY calls DESC`,
    )
    .all(since);
  const bySource = d.prepare("SELECT source, COUNT(*) AS calls FROM usage_logs WHERE ts >= ? GROUP BY source").all(since);
  const perDay = d
    .prepare(
      `SELECT strftime('%Y-%m-%d', ts / 1000, 'unixepoch', 'localtime') AS day, COUNT(*) AS calls, SUM(prompt_tokens + completion_tokens) AS tokens
       FROM usage_logs WHERE ts >= ? GROUP BY day ORDER BY day`,
    )
    .all(since);
  const recent = d
    .prepare(
      `SELECT u.*, a.name AS agent_name FROM usage_logs u LEFT JOIN agents a ON a.id = u.agent_id ORDER BY u.id DESC LIMIT 40`,
    )
    .all();
  return Response.json({ totals, byModel, byAgent, bySource, perDay, recent });
}
