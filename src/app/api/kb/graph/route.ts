import { knowledgeGraph } from "@/lib/rag";

/** Documents, tags and similarity links for the knowledge graph (?kbIds=a,b to restrict). */
export async function GET(req: Request) {
  const ids = new URL(req.url).searchParams.get("kbIds");
  return Response.json(knowledgeGraph(ids ? ids.split(",").filter(Boolean) : undefined));
}
