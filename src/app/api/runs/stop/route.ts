import { stopRun } from "@/lib/runs";

export async function POST(req: Request) {
  const { id } = (await req.json()) as { id: string };
  return Response.json({ ok: stopRun(id) });
}
