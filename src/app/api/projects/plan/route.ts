import { withAccess } from "@/lib/access";
import { startPlanRun, type Granularity } from "@/lib/planner";
import { info } from "@/lib/runs";

/** Break the project into tasks (and sprints) in the background. */
async function handlePOST(req: Request) {
  const { projectId, brief, sprints, granularity } = (await req.json()) as { projectId: string; brief?: string; sprints?: boolean; granularity?: Granularity };
  try {
    return Response.json(info(startPlanRun(projectId, { brief, sprints: sprints !== false, granularity })));
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : String(e) }, { status: 400 });
  }
}

export const POST = withAccess("edit", handlePOST, { credits: true, project: (b) => String(b.projectId ?? "") });
