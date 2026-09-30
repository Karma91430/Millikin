import { searchPipeline, type SearchOptions } from "@/lib/rag";

/** Full retrieval pipeline (every stage's ordering and scores), for the animated search view. */
export async function POST(req: Request) {
  const { kbIds, query, k, ...opts } = (await req.json()) as { kbIds: string[]; query: string; k?: number } & SearchOptions;
  try {
    return Response.json(await searchPipeline(kbIds, query, k ?? 4, opts));
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
