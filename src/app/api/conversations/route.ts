import { canSeeProject, denied, guard, type User } from "@/lib/access";
import { db } from "@/lib/db";

type Conv = { id: string; target_type: string; target_id: string; user_id?: string };

/** Project conversations follow project access; direct chats with an agent belong to their author (admins see all). */
function canSee(u: User | null, c: Conv | undefined) {
  if (!c) return false;
  if (!u || u.role === "admin") return true;
  if (c.target_type === "project") {
    const p = db().prepare("SELECT id, owner_id FROM projects WHERE id = ?").get(c.target_id) as { id: string; owner_id: string } | undefined;
    return !p || canSeeProject(u, p);
  }
  return !c.user_id || c.user_id === u.id;
}
const conv = (id: string) => db().prepare("SELECT * FROM conversations WHERE id = ?").get(id) as Conv | undefined;

export async function GET(req: Request) {
  try {
    const u = guard(req, "read");
    const sp = new URL(req.url).searchParams;
    const id = sp.get("id");
    if (id) {
      if (!canSee(u, conv(id))) return Response.json([]);
      const rows = db().prepare("SELECT * FROM messages WHERE conversation_id = ? ORDER BY created_at").all(id) as Record<string, unknown>[];
      return Response.json(rows.map((r) => ({ ...r, trace: r.trace ? JSON.parse(String(r.trace)) : null })));
    }
    const targetId = sp.get("targetId");
    const rows = (
      targetId
        ? db().prepare("SELECT * FROM conversations WHERE target_id = ? ORDER BY updated_at DESC").all(targetId)
        : db().prepare("SELECT * FROM conversations ORDER BY updated_at DESC LIMIT 100").all()
    ) as Conv[];
    return Response.json(rows.filter((c) => canSee(u, c)));
  } catch (e) {
    return denied(e);
  }
}

export async function DELETE(req: Request) {
  try {
    const u = guard(req, "edit");
    const id = new URL(req.url).searchParams.get("id");
    if (!id) return Response.json({ error: "id manquant" }, { status: 400 });
    if (!canSee(u, conv(id))) return Response.json({ error: "Conversation introuvable" }, { status: 404 });
    db().prepare("DELETE FROM messages WHERE conversation_id = ?").run(id);
    db().prepare("DELETE FROM conversations WHERE id = ?").run(id);
    return Response.json({ ok: true });
  } catch (e) {
    return denied(e);
  }
}
