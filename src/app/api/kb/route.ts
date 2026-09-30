import { db } from "@/lib/db";
import { addDocument, extractText, listDocuments, normTags, removeDocument, setDocumentTags } from "@/lib/rag";

export async function GET(req: Request) {
  const kbId = new URL(req.url).searchParams.get("kbId");
  if (kbId) return Response.json(listDocuments([kbId]));
  return Response.json(db().prepare("SELECT kb_id, COUNT(*) AS docs, SUM(chunks) AS chunks FROM kb_docs GROUP BY kb_id").all());
}

/** multipart (kbId + files + optional tags) or JSON { kbId, name, text, tags }. */
export async function POST(req: Request) {
  try {
    if ((req.headers.get("content-type") ?? "").includes("multipart/form-data")) {
      const form = await req.formData();
      const kbId = String(form.get("kbId") ?? "");
      const tags = normTags(String(form.get("tags") ?? ""));
      const results = [];
      for (const f of form.getAll("files")) {
        if (!(f instanceof File)) continue;
        try {
          const text = await extractText(f.name, new Uint8Array(await f.arrayBuffer()));
          results.push(await addDocument(kbId, f.name, text, tags));
        } catch (e) {
          results.push({ name: f.name, error: e instanceof Error ? e.message : String(e) });
        }
      }
      return Response.json(results);
    }
    const { kbId, name, text, tags } = (await req.json()) as { kbId: string; name: string; text: string; tags?: string[] };
    return Response.json([await addDocument(kbId, name || "Texte collé", text, normTags(tags))]);
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}

/** Update a document's tags. */
export async function PATCH(req: Request) {
  const { docId, tags } = (await req.json()) as { docId: string; tags: string[] };
  if (!docId) return Response.json({ error: "docId manquant" }, { status: 400 });
  return Response.json({ tags: setDocumentTags(docId, tags) });
}

export async function DELETE(req: Request) {
  const docId = new URL(req.url).searchParams.get("docId");
  if (!docId) return Response.json({ error: "docId manquant" }, { status: 400 });
  removeDocument(docId);
  return Response.json({ ok: true });
}
