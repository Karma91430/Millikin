import { activeRunFor, getRun, streamRun } from "@/lib/runs";

/** Re-attach to a run: ?id=<runId> or ?conversationId=<id> (active run only). */
export async function GET(req: Request) {
  const sp = new URL(req.url).searchParams;
  const run = sp.get("id") ? getRun(sp.get("id")!) : sp.get("conversationId") ? activeRunFor(sp.get("conversationId")!) : undefined;
  if (!run) return Response.json({ error: "Aucune exécution en cours" }, { status: 404 });
  return streamRun(run);
}
