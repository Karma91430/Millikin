import { startTaskRun } from "@/lib/taskrun";
import { info } from "@/lib/runs";

/** Launch a board task in the background (assignee works, then a first contact reviews). */
export async function POST(req: Request) {
  const { taskId } = (await req.json()) as { taskId: string };
  try {
    return Response.json(info(startTaskRun(taskId)));
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : String(e) }, { status: 400 });
  }
}
