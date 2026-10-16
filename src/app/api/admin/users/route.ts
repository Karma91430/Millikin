import { creditStatus, deleteUser, listUsers, saveUser, type UserInput } from "@/lib/access";

/** Admin only (enforced by the proxy): users with their credit status. */
export async function GET() {
  return Response.json(listUsers().map((u) => ({ ...u, credits: creditStatus(u) })));
}

/** Create (no id) or update a user; `password` sets a new password and closes their sessions. */
export async function POST(req: Request) {
  const { id, ...input } = (await req.json()) as UserInput & { id?: string };
  try {
    return Response.json(saveUser(id ?? null, input));
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : String(e) }, { status: 400 });
  }
}

export async function DELETE(req: Request) {
  const id = new URL(req.url).searchParams.get("id");
  try {
    if (!id) throw new Error("id manquant");
    deleteUser(id);
    return Response.json({ ok: true });
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : String(e) }, { status: 400 });
  }
}
