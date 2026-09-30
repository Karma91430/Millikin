import { search } from "@/lib/rag";

export async function POST(req: Request) {
  const { kbIds, query, k, tags } = (await req.json()) as { kbIds: string[]; query: string; k?: number; tags?: string[] };
  try {
    return Response.json(await search(kbIds, query, k ?? 5, { tags }));
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
