import { withAccess } from "@/lib/access";
import { get, type Sprint } from "@/lib/db";
import { info } from "@/lib/runs";
import { startSprintReview } from "@/lib/sprintreview";

/** (Re)generate the review of a sprint; the figures taken at closing time are kept. */
async function handlePOST(req: Request) {
  const { id } = (await req.json()) as { id: string };
  try {
    return Response.json(info(startSprintReview(id)));
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : String(e) }, { status: 400 });
  }
}

export const POST = withAccess("edit", handlePOST, { credits: true, project: (b) => get<Sprint>("sprints", String(b.id ?? ""))?.project_id });
