import { retagAll, suggestTags, tagCounts } from "@/lib/rag";

/** Tags in use (?kbIds=a,b to restrict). */
export async function GET(req: Request) {
  const ids = new URL(req.url).searchParams.get("kbIds");
  return Response.json(tagCounts(ids ? ids.split(",").filter(Boolean) : undefined));
}

/**
 * { docId }: suggest tags for a document with the local default model.
 * { retag: true, kbIds }: retag every document of these bases; streams one JSON line per step.
 */
export async function POST(req: Request) {
  const body = (await req.json()) as { docId?: string; retag?: boolean; kbIds?: string[] };
  if (body.retag) {
    const enc = new TextEncoder();
    const stream = new ReadableStream({
      async start(ctrl) {
        const send = (o: object) => ctrl.enqueue(enc.encode(JSON.stringify(o) + "\n"));
        try {
          await retagAll(body.kbIds?.length ? body.kbIds : undefined, send, req.signal);
        } catch (e) {
          send({ error: e instanceof Error ? e.message : String(e) });
        }
        ctrl.close();
      },
    });
    return new Response(stream, { headers: { "content-type": "application/x-ndjson", "cache-control": "no-cache" } });
  }
  try {
    return Response.json({ tags: await suggestTags(String(body.docId ?? "")) });
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
