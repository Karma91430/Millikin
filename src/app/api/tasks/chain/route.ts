import { info } from "@/lib/runs";
import { startChainRun } from "@/lib/taskrun";

/** Run a project's open tasks in dependency order (stop it with /api/runs/stop). */
export async function POST(req: Request) {
  const { projectId, sprintId } = (await req.json()) as { projectId: string; sprintId?: string };
  try {
    return Response.json(info(startChainRun(projectId, { sprintId })));
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : String(e) }, { status: 400 });
  }
}
