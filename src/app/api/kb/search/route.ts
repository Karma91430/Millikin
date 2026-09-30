import { search } from "@/lib/rag";

export async function POST(req: Request) {
  const { kbIds, query, k } = (await req.json()) as { kbIds: string[]; query: string; k?: number };
  try {
    return Response.json(await search(kbIds, query, k ?? 5));
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
