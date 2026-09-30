import { db, newId, now } from "./db";
import { embed } from "./gateway";

const CHUNK = 900;
const OVERLAP = 150;

/** Split on paragraph boundaries, packing paragraphs into ~CHUNK-char windows with overlap. */
export function chunkText(text: string): string[] {
  const clean = text.replace(/\r\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
  if (!clean) return [];
  const paras = clean.split(/\n\n+/);
  const chunks: string[] = [];
  let cur = "";
  for (const p of paras) {
    if (p.length > CHUNK) {
      if (cur) chunks.push(cur);
      cur = "";
      for (let i = 0; i < p.length; i += CHUNK - OVERLAP) chunks.push(p.slice(i, i + CHUNK));
      continue;
    }
    if ((cur + "\n\n" + p).length > CHUNK && cur) {
      chunks.push(cur);
      cur = cur.slice(-OVERLAP) + "\n\n" + p;
    } else cur = cur ? cur + "\n\n" + p : p;
  }
  if (cur) chunks.push(cur);
  return chunks;
}

export async function extractText(name: string, bytes: Uint8Array): Promise<string> {
  if (/\.pdf$/i.test(name)) {
    const { extractText: pdfText, getDocumentProxy } = await import("unpdf");
    const pdf = await getDocumentProxy(bytes);
    const { text } = await pdfText(pdf, { mergePages: true });
    return Array.isArray(text) ? text.join("\n\n") : text;
  }
  return new TextDecoder().decode(bytes);
}

export async function addDocument(kbId: string, name: string, text: string) {
  const chunks = chunkText(text);
  if (!chunks.length) throw new Error(`« ${name} » ne contient pas de texte exploitable`);
  const vectors = await embed(chunks.map((c) => `${name}\n${c}`));
  const docId = newId();
  const d = db();
  d.exec("BEGIN");
  try {
    d.prepare("INSERT INTO kb_docs (id, kb_id, name, chars, chunks, created_at) VALUES (?,?,?,?,?,?)").run(docId, kbId, name, text.length, chunks.length, now());
    const ins = d.prepare("INSERT INTO kb_chunks (id, kb_id, doc_id, idx, text, embedding) VALUES (?,?,?,?,?,?)");
    chunks.forEach((c, i) => ins.run(newId(), kbId, docId, i, c, new Uint8Array(new Float32Array(vectors[i]).buffer)));
    d.exec("COMMIT");
  } catch (e) {
    d.exec("ROLLBACK");
    throw e;
  }
  return { id: docId, name, chunks: chunks.length, chars: text.length };
}

export function removeDocument(docId: string) {
  db().prepare("DELETE FROM kb_chunks WHERE doc_id = ?").run(docId);
  db().prepare("DELETE FROM kb_docs WHERE id = ?").run(docId);
}

export type Hit = { text: string; doc: string; kb: string; score: number };

export async function search(kbIds: string[], query: string, k = 4): Promise<Hit[]> {
  if (!kbIds.length || !query.trim()) return [];
  const [q] = await embed([query]);
  const qn = Math.hypot(...q);
  const rows = db()
    .prepare(
      `SELECT c.text, c.embedding, d.name AS doc, k.name AS kb FROM kb_chunks c
       JOIN kb_docs d ON d.id = c.doc_id JOIN kbs k ON k.id = c.kb_id
       WHERE c.kb_id IN (${kbIds.map(() => "?").join(",")})`,
    )
    .all(...kbIds) as { text: string; embedding: Uint8Array; doc: string; kb: string }[];
  const hits = rows.map((r) => {
    const v = new Float32Array(r.embedding.slice().buffer);
    let dot = 0;
    let n = 0;
    for (let i = 0; i < v.length; i++) {
      dot += v[i] * q[i];
      n += v[i] * v[i];
    }
    return { text: r.text, doc: r.doc, kb: r.kb, score: dot / (Math.sqrt(n) * qn || 1) };
  });
  return hits.sort((a, b) => b.score - a.score).slice(0, k);
}
