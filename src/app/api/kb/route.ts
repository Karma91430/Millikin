import { db } from "@/lib/db";
import { addDocument, extractText, removeDocument } from "@/lib/rag";

export async function GET(req: Request) {
  const kbId = new URL(req.url).searchParams.get("kbId");
  const rows = kbId
    ? db().prepare("SELECT * FROM kb_docs WHERE kb_id = ? ORDER BY created_at DESC").all(kbId)
    : db().prepare("SELECT kb_id, COUNT(*) AS docs, SUM(chunks) AS chunks FROM kb_docs GROUP BY kb_id").all();
  return Response.json(rows);
}

/** multipart (kbId + files) or JSON { kbId, name, text }. */
export async function POST(req: Request) {
  try {
    if ((req.headers.get("content-type") ?? "").includes("multipart/form-data")) {
      const form = await req.formData();
      const kbId = String(form.get("kbId") ?? "");
      const results = [];
      for (const f of form.getAll("files")) {
        if (!(f instanceof File)) continue;
        try {
          const text = await extractText(f.name, new Uint8Array(await f.arrayBuffer()));
          results.push(await addDocument(kbId, f.name, text));
        } catch (e) {
          results.push({ name: f.name, error: e instanceof Error ? e.message : String(e) });
        }
      }
      return Response.json(results);
    }
    const { kbId, name, text } = (await req.json()) as { kbId: string; name: string; text: string };
    return Response.json([await addDocument(kbId, name || "Texte collé", text)]);
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}

export async function DELETE(req: Request) {
  const docId = new URL(req.url).searchParams.get("docId");
  if (!docId) return Response.json({ error: "docId manquant" }, { status: 400 });
  removeDocument(docId);
  return Response.json({ ok: true });
}
