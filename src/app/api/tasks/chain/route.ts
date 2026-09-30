import { info } from "@/lib/runs";
import { startChainRun } from "@/lib/taskrun";

/** Run a project's open tasks in dependency order (stop it with /api/runs/stop). */
export async function POST(req: Request) {
  const { projectId, retry, sprintId } = (await req.json()) as { projectId: string; retry?: boolean; sprintId?: string };
  try {
    return Response.json(info(startChainRun(projectId, { retry: !!retry, sprintId })));
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : String(e) }, { status: 400 });
  }
}
