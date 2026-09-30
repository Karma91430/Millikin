import { startPlanRun } from "@/lib/planner";
import { info } from "@/lib/runs";

/** Break the project into tasks (and sprints) in the background. */
export async function POST(req: Request) {
  const { projectId, brief, sprints } = (await req.json()) as { projectId: string; brief?: string; sprints?: boolean };
  try {
    return Response.json(info(startPlanRun(projectId, { brief, sprints: sprints !== false })));
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : String(e) }, { status: 400 });
  }
}
