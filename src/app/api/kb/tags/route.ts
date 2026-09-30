import { suggestTags, tagCounts } from "@/lib/rag";

/** Tags in use (?kbIds=a,b to restrict). */
export async function GET(req: Request) {
  const ids = new URL(req.url).searchParams.get("kbIds");
  return Response.json(tagCounts(ids ? ids.split(",").filter(Boolean) : undefined));
}

/** Suggest tags for a document with the default model. */
export async function POST(req: Request) {
  const { docId } = (await req.json()) as { docId: string };
  try {
    return Response.json({ tags: await suggestTags(docId) });
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
