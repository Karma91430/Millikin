import { db } from "@/lib/db";

export async function GET(req: Request) {
  const sp = new URL(req.url).searchParams;
  const id = sp.get("id");
  if (id) {
    const rows = db().prepare("SELECT * FROM messages WHERE conversation_id = ? ORDER BY created_at").all(id) as Record<string, unknown>[];
    return Response.json(rows.map((r) => ({ ...r, trace: r.trace ? JSON.parse(String(r.trace)) : null })));
  }
  const targetId = sp.get("targetId");
  const rows = targetId
    ? db().prepare("SELECT * FROM conversations WHERE target_id = ? ORDER BY updated_at DESC").all(targetId)
    : db().prepare("SELECT * FROM conversations ORDER BY updated_at DESC LIMIT 100").all();
  return Response.json(rows);
}

export async function DELETE(req: Request) {
  const id = new URL(req.url).searchParams.get("id");
  if (!id) return Response.json({ error: "id manquant" }, { status: 400 });
  db().prepare("DELETE FROM messages WHERE conversation_id = ?").run(id);
  db().prepare("DELETE FROM conversations WHERE id = ?").run(id);
  return Response.json({ ok: true });
}
