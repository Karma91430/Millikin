import { denied, guard, guardProject } from "@/lib/access";
import { getRun, stopRun } from "@/lib/runs";

export async function POST(req: Request) {
  try {
    const u = guard(req, "edit");
    const { id } = (await req.json()) as { id: string };
    const run = getRun(id);
    // Stop your own runs, or the runs of a project you can see.
    if (u && run && u.role !== "admin" && run.userId !== u.id) {
      if (run.targetType === "agent") throw Response.json({ error: "Exécution d'un autre utilisateur" }, { status: 403 });
      guardProject(u, run.targetId);
    }
    return Response.json({ ok: stopRun(id) });
  } catch (e) {
    return denied(e);
  }
}
