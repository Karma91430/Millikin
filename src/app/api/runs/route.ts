import { listRuns } from "@/lib/runs";

/** Running runs and those finished in the last few minutes. */
export async function GET() {
  return Response.json(listRuns());
}
