import { db, get, list, now, upsert, type Sprint, type Task } from "@/lib/db";

/** start: one active sprint per project · close: unfinished tasks move to the next planned sprint (or the backlog). */
export async function POST(req: Request) {
  const { id, action } = (await req.json()) as { id: string; action: "start" | "close" };
  const sprint = get<Sprint>("sprints", id);
  if (!sprint) return Response.json({ error: "Sprint introuvable" }, { status: 404 });
  const siblings = list<Sprint>("sprints").filter((s) => s.project_id === sprint.project_id);
  if (action === "start") {
    const active = siblings.find((s) => s.status === "active" && s.id !== id);
    if (active) return Response.json({ error: `Clôture d'abord « ${active.name} »` }, { status: 400 });
    const today = new Date().toISOString().slice(0, 10);
    return Response.json(upsert("sprints", { id, status: "active", start_date: sprint.start_date || today }));
  }
  const next = siblings.find((s) => s.status === "planned" && s.id !== id);
  const open = list<Task>("tasks").filter((t) => t.sprint_id === id && t.status !== "done");
  const move = db().prepare("UPDATE tasks SET sprint_id = ?, updated_at = ? WHERE id = ?");
  for (const t of open) move.run(next?.id ?? "", now(), t.id);
  const closed = upsert("sprints", { id, status: "done", end_date: sprint.end_date || new Date().toISOString().slice(0, 10) });
  return Response.json({ sprint: closed, moved: open.length, to: next?.name ?? "Backlog" });
}
