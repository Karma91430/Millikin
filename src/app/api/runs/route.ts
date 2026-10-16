import { canSeeProject, denied, guard } from "@/lib/access";
import { db } from "@/lib/db";
import { listRuns } from "@/lib/runs";

/** Running runs and those finished in the last few minutes (a member sees their own runs and those of their projects). */
export async function GET(req: Request) {
  try {
    const u = guard(req, "read");
    const runs = listRuns();
    if (!u || u.role === "admin") return Response.json(runs);
    return Response.json(
      runs.filter((r) => {
        if (r.userId === u.id) return true;
        if (r.targetType === "agent") return false;
        const p = db().prepare("SELECT id, owner_id FROM projects WHERE id = ?").get(r.targetId) as { id: string; owner_id: string } | undefined;
        return !!p && canSeeProject(u, p);
      }),
    );
  } catch (e) {
    return denied(e);
  }
}
