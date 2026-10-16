import { withAccess } from "@/lib/access";
import { get, type Task } from "@/lib/db";
import { startTaskRun } from "@/lib/taskrun";
import { info } from "@/lib/runs";

/** Launch a board task in the background (assignee works, then a first contact reviews). */
async function handlePOST(req: Request) {
  const { taskId } = (await req.json()) as { taskId: string };
  try {
    return Response.json(info(startTaskRun(taskId)));
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : String(e) }, { status: 400 });
  }
}

const taskProject = (id: string) => get<Task>("tasks", id)?.project_id;

export const POST = withAccess("edit", handlePOST, { credits: true, project: (b) => taskProject(String(b.taskId ?? "")) });
