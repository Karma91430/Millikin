import { db, list, newId, now } from "./db";
import { complete, embed } from "./gateway";

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

/** Tags are stored lower-case and trimmed, so filters match regardless of how they were typed. */
export const normTags = (tags: unknown): string[] =>
  [...new Set((Array.isArray(tags) ? tags : typeof tags === "string" ? tags.split(",") : []).map((t) => String(t).trim().toLowerCase().replace(/^#+/, "").replace(/\s+/g, "-")).filter(Boolean))].slice(0, 12);

export async function addDocument(kbId: string, name: string, text: string, tags: string[] = []) {
  const chunks = chunkText(text);
  if (!chunks.length) throw new Error(`« ${name} » ne contient pas de texte exploitable`);
  const vectors = await embed(chunks.map((c) => `${name}\n${c}`));
  const docId = newId();
  const d = db();
  d.exec("BEGIN");
  try {
    d.prepare("INSERT INTO kb_docs (id, kb_id, name, chars, chunks, tags, created_at) VALUES (?,?,?,?,?,?,?)").run(
      docId,
      kbId,
      name,
      text.length,
      chunks.length,
      JSON.stringify(normTags(tags)),
      now(),
    );
    const ins = d.prepare("INSERT INTO kb_chunks (id, kb_id, doc_id, idx, text, embedding) VALUES (?,?,?,?,?,?)");
    chunks.forEach((c, i) => ins.run(newId(), kbId, docId, i, c, new Uint8Array(new Float32Array(vectors[i]).buffer)));
    d.exec("COMMIT");
  } catch (e) {
    d.exec("ROLLBACK");
    throw e;
  }
  // No tags given: the local model tags the document, reusing the base's themes and vocabulary.
  if (!normTags(tags).length) await autoTag(docId).catch(() => {});
  return { id: docId, name, chunks: chunks.length, chars: text.length };
}

export function removeDocument(docId: string) {
  db().prepare("DELETE FROM kb_chunks WHERE doc_id = ?").run(docId);
  db().prepare("DELETE FROM kb_docs WHERE id = ?").run(docId);
}

export function setDocumentTags(docId: string, tags: unknown) {
  const clean = normTags(tags);
  db().prepare("UPDATE kb_docs SET tags = ? WHERE id = ?").run(JSON.stringify(clean), docId);
  return clean;
}

type DocRow = { id: string; kb_id: string; name: string; chars: number; chunks: number; tags: string; created_at: number };
const parseTags = (s: string) => {
  try {
    return normTags(JSON.parse(s || "[]"));
  } catch {
    return [];
  }
};

export function listDocuments(kbIds?: string[]) {
  const rows = (
    kbIds?.length
      ? db().prepare(`SELECT * FROM kb_docs WHERE kb_id IN (${kbIds.map(() => "?").join(",")}) ORDER BY created_at DESC`).all(...kbIds)
      : db().prepare("SELECT * FROM kb_docs ORDER BY created_at DESC").all()
  ) as DocRow[];
  return rows.map((r) => ({ ...r, tags: parseTags(r.tags) }));
}

/** Tags in use, with how many documents carry each. */
export function tagCounts(kbIds?: string[]): { tag: string; count: number }[] {
  const counts = new Map<string, number>();
  for (const d of listDocuments(kbIds)) for (const t of d.tags) counts.set(t, (counts.get(t) ?? 0) + 1);
  return [...counts].map(([tag, count]) => ({ tag, count })).sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag));
}

// Repeated questions (retries, co-leads, several agents) reuse the query embedding.
const g = globalThis as unknown as { __millikinQueryEmb?: Map<string, number[]> };
const queryCache = (g.__millikinQueryEmb ??= new Map());
async function embedQuery(query: string): Promise<number[]> {
  const key = query.trim().toLowerCase();
  const hit = queryCache.get(key);
  if (hit) return hit;
  const [q] = await embed([query]);
  queryCache.set(key, q);
  if (queryCache.size > 300) queryCache.delete(queryCache.keys().next().value!);
  return q;
}

const vec = (u8: Uint8Array) => new Float32Array(u8.slice().buffer);
function cosine(a: ArrayLike<number>, b: ArrayLike<number>) {
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  return dot / (Math.sqrt(na) * Math.sqrt(nb) || 1);
}

export type Hit = { text: string; doc: string; docId: string; kb: string; tags: string[]; score: number };

// ---------------------------------------------------------------- search pipeline

export type Rerank = "none" | "mmr" | "llm";
export type SearchOptions = {
  tags?: string[];
  /** Blend a keyword (BM25) score with the vector score, for exact terms. */
  hybrid?: boolean;
  /** Weight of the vector score in hybrid mode (0–1). */
  alpha?: number;
  /** Re-order the best candidates: MMR (diversity) or the local LLM (relevance). */
  rerank?: Rerank;
  /** MMR trade-off between relevance (1) and diversity (0). */
  lambda?: number;
  /** How many candidates enter the pipeline before the final top-k. */
  candidates?: number;
};
export type Candidate = { id: string; docId: string; doc: string; kb: string; tags: string[]; text: string; vector: number; lexical?: number; hybrid?: number; mmr?: number; llm?: number };
export type Stage = { id: "vector" | "hybrid" | "mmr" | "llm" | "final"; label: string; detail: string; order: string[]; scores: Record<string, number>; ms: number };
export type Pipeline = { query: string; candidates: Candidate[]; stages: Stage[]; final: string[]; total: number };

const STOP = new Set(
  "les des une un le la de du et en est pour que qui dans par sur au aux avec son ses sa ce cette ces pas plus ne se il elle ils on nous vous leur leurs mais ou donc car comme tout tous toute être avoir fait faire the and for with that this from are was were you your have has not but can will its into".split(" "),
);
const tokens = (s: string) =>
  s
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length > 2 && !STOP.has(t));

/** BM25 over the given corpus, returning a scorer for its documents. */
function bm25(corpus: string[], query: string, k1 = 1.4, b = 0.75) {
  const docs = corpus.map(tokens);
  const avgdl = docs.reduce((n, d) => n + d.length, 0) / (docs.length || 1);
  const q = [...new Set(tokens(query))];
  const df = new Map(q.map((t) => [t, docs.filter((d) => d.includes(t)).length]));
  return (i: number) => {
    const d = docs[i];
    let score = 0;
    for (const t of q) {
      const tf = d.filter((x) => x === t).length;
      if (!tf) continue;
      const idf = Math.log(1 + (docs.length - df.get(t)! + 0.5) / (df.get(t)! + 0.5));
      score += (idf * tf * (k1 + 1)) / (tf + k1 * (1 - b + (b * d.length) / avgdl));
    }
    return score;
  };
}

const normalize = (xs: number[]) => {
  const min = Math.min(...xs);
  const max = Math.max(...xs);
  return xs.map((x) => (max > min ? (x - min) / (max - min) : max > 0 ? 1 : 0));
};

/** Ask the local model to grade each candidate's relevance (0–10) in one call. */
async function llmScores(query: string, cands: { id: string; text: string }[]): Promise<Record<string, number>> {
  const list = cands.map((c, i) => `[P${i + 1}] ${c.text.replace(/\s+/g, " ").slice(0, 500)}`).join("\n\n");
  const raw = await complete({
    json: true,
    temperature: 0,
    source: "rerank",
    messages: [
      {
        role: "system",
        content: 'Tu évalues la pertinence de passages pour répondre à une question. Réponds UNIQUEMENT en JSON : {"scores": {"P1": note, "P2": note, …}} avec une note de 0 (hors sujet) à 10 (répond directement à la question).',
      },
      { role: "user", content: `Question : ${query}\n\nPassages :\n${list}` },
    ],
  });
  const m = raw.match(/\{[\s\S]*\}/);
  const parsed = m ? ((JSON.parse(m[0]) as { scores?: Record<string, unknown> }).scores ?? {}) : {};
  return Object.fromEntries(cands.map((c, i) => [c.id, Math.max(0, Math.min(10, Number(parsed[`P${i + 1}`]) || 0))]));
}

/**
 * Instrumented retrieval: vector similarity, optional hybrid keyword blend, optional reranking,
 * then top-k. Every stage reports its ordering and scores so the UI can replay it.
 */
export async function searchPipeline(kbIds: string[], query: string, k = 4, opts: SearchOptions = {}): Promise<Pipeline> {
  const empty: Pipeline = { query, candidates: [], stages: [], final: [], total: 0 };
  if (!kbIds.length || !query.trim()) return empty;
  const stages: Stage[] = [];
  let t = Date.now();
  const q = await embedQuery(query);
  const want = normTags(opts.tags ?? []);
  const rows = (
    db()
      .prepare(
        `SELECT c.id, c.text, c.embedding, d.id AS doc_id, d.name AS doc, d.tags AS tags, k.name AS kb FROM kb_chunks c
         JOIN kb_docs d ON d.id = c.doc_id JOIN kbs k ON k.id = c.kb_id
         WHERE c.kb_id IN (${kbIds.map(() => "?").join(",")})`,
      )
      .all(...kbIds) as { id: string; text: string; embedding: Uint8Array; doc_id: string; doc: string; tags: string; kb: string }[]
  )
    .map((r) => ({ ...r, tagList: parseTags(r.tags) }))
    .filter((r) => !want.length || r.tagList.some((x) => want.includes(x)));
  if (!rows.length) return empty;

  // 1. Vector similarity over the whole (filtered) corpus, keep the best candidates.
  const n = Math.max(k, Math.min(40, opts.candidates ?? 16));
  const embs = new Map(rows.map((r) => [r.id, vec(r.embedding)]));
  const scored = rows.map((r) => ({ r, vector: cosine(embs.get(r.id)!, q) })).sort((a, b) => b.vector - a.vector);
  const pool = scored.slice(0, n);
  const cands: Candidate[] = pool.map(({ r, vector }) => ({ id: r.id, docId: r.doc_id, doc: r.doc, kb: r.kb, tags: r.tagList, text: r.text, vector }));
  const byId = new Map(cands.map((c) => [c.id, c]));
  const score = (key: "vector" | "hybrid" | "mmr" | "llm") => Object.fromEntries(cands.map((c) => [c.id, (c[key] as number | undefined) ?? 0]));
  stages.push({ id: "vector", label: "Recherche vectorielle", detail: `${rows.length} passages comparés, ${cands.length} candidats retenus`, order: cands.map((c) => c.id), scores: score("vector"), ms: Date.now() - t });
  let order = cands.map((c) => c.id);
  let current: "vector" | "hybrid" | "mmr" | "llm" = "vector";

  // 2. Hybrid: BM25 over the corpus, blended with the vector score.
  if (opts.hybrid) {
    t = Date.now();
    const index = new Map(rows.map((r, i) => [r.id, i]));
    const scorer = bm25(rows.map((r) => `${r.doc} ${r.text}`), query);
    const lex = cands.map((c) => scorer(index.get(c.id)!));
    const nl = normalize(lex);
    const nv = normalize(cands.map((c) => c.vector));
    const alpha = Math.min(1, Math.max(0, opts.alpha ?? 0.6));
    cands.forEach((c, i) => {
      c.lexical = lex[i];
      c.hybrid = alpha * nv[i] + (1 - alpha) * nl[i];
    });
    order = [...cands].sort((a, b) => b.hybrid! - a.hybrid!).map((c) => c.id);
    current = "hybrid";
    stages.push({ id: "hybrid", label: "Hybride (mots-clés)", detail: `score = ${alpha.toFixed(2)} × vecteur + ${(1 - alpha).toFixed(2)} × BM25`, order, scores: score("hybrid"), ms: Date.now() - t });
  }

  // 3. Reranking.
  if (opts.rerank === "mmr") {
    t = Date.now();
    const lambda = Math.min(1, Math.max(0, opts.lambda ?? 0.7));
    const rels = normalize(order.map((id) => (byId.get(id)![current] as number) ?? 0));
    const relN = new Map(order.map((id, i) => [id, rels[i]]));
    const left = [...order];
    const picked: string[] = [];
    while (left.length) {
      let best = left[0];
      let bestScore = -Infinity;
      for (const id of left) {
        const div = picked.length ? Math.max(...picked.map((p) => cosine(embs.get(id)!, embs.get(p)!))) : 0;
        const s = lambda * relN.get(id)! - (1 - lambda) * div;
        if (s > bestScore) {
          bestScore = s;
          best = id;
        }
      }
      byId.get(best)!.mmr = bestScore;
      picked.push(best);
      left.splice(left.indexOf(best), 1);
    }
    order = picked;
    current = "mmr";
    stages.push({ id: "mmr", label: "Reranking MMR", detail: `diversité : λ = ${lambda.toFixed(2)} (1 = pertinence seule)`, order, scores: score("mmr"), ms: Date.now() - t });
  } else if (opts.rerank === "llm") {
    t = Date.now();
    const top = order.slice(0, Math.min(8, order.length));
    const grades = await llmScores(query, top.map((id) => ({ id, text: byId.get(id)!.text })));
    for (const id of top) byId.get(id)!.llm = grades[id];
    order = [...top].sort((a, b) => (grades[b] ?? 0) - (grades[a] ?? 0) || order.indexOf(a) - order.indexOf(b)).concat(order.slice(top.length));
    current = "llm";
    stages.push({ id: "llm", label: "Reranking LLM", detail: `le modèle note les ${top.length} meilleurs candidats de 0 à 10`, order, scores: score("llm"), ms: Date.now() - t });
  }

  const final = order.slice(0, k);
  stages.push({ id: "final", label: `Top ${k}`, detail: "passages transmis à l'agent", order: final, scores: score(current), ms: 0 });
  return { query, candidates: cands, stages, final, total: rows.length };
}

/** Search used by agents: the pipeline's final passages. */
export async function search(kbIds: string[], query: string, k = 4, opts: SearchOptions = {}): Promise<Hit[]> {
  const p = await searchPipeline(kbIds, query, k, opts);
  const byId = new Map(p.candidates.map((c) => [c.id, c]));
  return p.final.map((id) => {
    const c = byId.get(id)!;
    return { text: c.text, doc: c.doc, docId: c.docId, kb: c.kb, tags: c.tags, score: c.vector };
  });
}

/** Documents as graph nodes plus similarity links (mean chunk embeddings, top 2 neighbours above a threshold). */
/** Sum of each document's passage embeddings (cosine ignores the scale). */
function docCentroids(docs: { id: string }[]) {
  const centroids = new Map<string, Float32Array>();
  const stmt = db().prepare("SELECT embedding FROM kb_chunks WHERE doc_id = ?");
  for (const d of docs) {
    const rows = stmt.all(d.id) as { embedding: Uint8Array }[];
    if (!rows.length) continue;
    const sum = new Float32Array(vec(rows[0].embedding).length);
    for (const r of rows) {
      const v = vec(r.embedding);
      for (let i = 0; i < sum.length; i++) sum[i] += v[i];
    }
    centroids.set(d.id, sum);
  }
  return centroids;
}

export function knowledgeGraph(kbIds?: string[]) {
  const docs = listDocuments(kbIds).slice(0, 400);
  const kbs = new Map(list<{ id: string; name: string }>("kbs").map((k) => [k.id, k.name]));
  const centroids = docCentroids(docs);
  const links: { source: string; target: string; score: number }[] = [];
  const seen = new Set<string>();
  for (const a of docs) {
    const ca = centroids.get(a.id);
    if (!ca) continue;
    const near = docs
      .filter((b) => b.id !== a.id && centroids.has(b.id))
      .map((b) => ({ id: b.id, score: cosine(ca, centroids.get(b.id)!) }))
      .filter((x) => x.score > 0.72)
      .sort((x, y) => y.score - x.score)
      .slice(0, 2);
    for (const n of near) {
      const key = [a.id, n.id].sort().join("|");
      if (seen.has(key)) continue;
      seen.add(key);
      links.push({ source: a.id, target: n.id, score: Math.round(n.score * 100) / 100 });
    }
  }
  return {
    docs: docs.map((d) => ({ id: d.id, name: d.name, kb_id: d.kb_id, kb: kbs.get(d.kb_id) ?? "", tags: d.tags, chunks: d.chunks, chars: d.chars })),
    tags: tagCounts(kbIds),
    links,
  };
}

const docSample = (docId: string, max: number) =>
  (db().prepare("SELECT text FROM kb_chunks WHERE doc_id = ? ORDER BY idx LIMIT 3").all(docId) as { text: string }[])
    .map((r) => r.text)
    .join("\n\n")
    .slice(0, max);
const parseJson = <T>(raw: string): T | null => {
  try {
    return JSON.parse(raw.slice(raw.indexOf("{"), raw.lastIndexOf("}") + 1)) as T;
  } catch {
    return null;
  }
};
/** Main themes in use: the first tag of each document (it defines the graph constellation). */
const themesInUse = (kbIds?: string[]) => [...new Set(listDocuments(kbIds).map((d) => d.tags[0]).filter(Boolean))];

/**
 * Tag a document with the local default model: one main theme (picked from `themes` when given,
 * else from the themes in use) followed by 1–3 specific tags (technologies, notions), reusing the
 * existing vocabulary. Returns the tags without saving them.
 */
export async function suggestTags(docId: string, opts: { themes?: string[]; theme?: string } = {}): Promise<string[]> {
  const doc = db().prepare("SELECT name, kb_id FROM kb_docs WHERE id = ?").get(docId) as { name: string; kb_id: string } | undefined;
  if (!doc) throw new Error("Document introuvable");
  if (opts.theme) return [opts.theme, ...(await specificTags(doc.name, docId, [opts.theme]))].slice(0, 4);
  // Given themes are a closed list; otherwise the themes in use, plus "autre" for a new one.
  const strict = !!opts.themes?.length;
  const known = strict ? opts.themes! : themesInUse([doc.kb_id]);
  const vocabulary = tagCounts()
    .map((t) => t.tag)
    .filter((t) => !known.includes(t))
    .slice(0, 60);
  const raw = await complete({
    temperature: 0.1,
    source: "tags",
    schema: {
      type: "object",
      properties: {
        theme: known.length ? { type: "string", enum: strict ? known : [...known, "autre"] } : { type: "string" },
        ...(strict || !known.length ? {} : { nouveau_theme: { type: "string" } }),
        tags: { type: "array", items: { type: "string" }, minItems: 1, maxItems: 3 },
      },
      required: ["theme", "tags"],
    },
    messages: [
      {
        role: "system",
        content: `Tu classes des documents dans une base de connaissances. Réponds UNIQUEMENT en JSON : {"theme": "…", "tags": ["…"]}.
- "theme" : LE thème principal du document.${known.length ? ` Choisis-le parmi : ${known.join(", ")}.${strict ? "" : ` Réponds "autre" seulement si aucun ne convient, et propose alors "nouveau_theme" (un domaine en français, un ou deux mots en minuscules reliés par un tiret).`}` : " Un domaine général en français (pas une technologie), un ou deux mots en minuscules reliés par un tiret."}
- "tags" : 1 à 3 tags plus précis (technologies, notions clés), en minuscules, différents du thème.${vocabulary.length ? ` Réutilise ces tags existants quand ils conviennent : ${vocabulary.join(", ")}.` : ""}
Pas de synonymes ni de variantes d'un tag existant (pas de pluriel, pas de traduction).`,
      },
      { role: "user", content: `Document « ${doc.name} » :\n${docSample(docId, 2500)}` },
    ],
  });
  const j = parseJson<{ theme?: unknown; nouveau_theme?: unknown; tags?: unknown }>(raw);
  const theme = j?.theme === "autre" ? j.nouveau_theme : j?.theme;
  const tags = normTags([theme, ...(Array.isArray(j?.tags) ? j.tags : [])].filter((t) => typeof t === "string" && t !== "autre")).slice(0, 4);
  if (!tags.length) throw new Error("Aucun tag proposé, réessaie");
  return tags;
}

/** 1–3 specific tags (technologies, notions) for a document whose theme is already known. */
async function specificTags(name: string, docId: string, exclude: string[]) {
  const vocabulary = tagCounts()
    .map((t) => t.tag)
    .filter((t) => !exclude.includes(t))
    .slice(0, 60);
  const raw = await complete({
    temperature: 0.1,
    source: "tags",
    schema: { type: "object", properties: { tags: { type: "array", items: { type: "string" }, minItems: 1, maxItems: 3 } }, required: ["tags"] },
    messages: [
      {
        role: "system",
        content: `Tu tagues des documents. Réponds UNIQUEMENT en JSON : {"tags": ["…"]}. 1 à 3 tags précis (technologies, notions clés), en minuscules, un ou deux mots reliés par un tiret, différents de : ${exclude.join(", ")}.${
          vocabulary.length ? ` Réutilise ces tags existants quand ils conviennent : ${vocabulary.join(", ")}.` : ""
        } Pas de synonymes ni de variantes d'un tag existant.`,
      },
      { role: "user", content: `Document « ${name} » :\n${docSample(docId, 2500)}` },
    ],
  });
  return normTags(parseJson<{ tags?: unknown }>(raw)?.tags).filter((t) => !exclude.includes(t));
}

export async function autoTag(docId: string, opts?: { themes?: string[]; theme?: string }) {
  return setDocumentTags(docId, await suggestTags(docId, opts));
}

/** Short description of a document for the model: its title and first lines (headings stripped). */
const docBrief = (d: { id: string; name: string }, max = 200) => `${d.name} : ${docSample(d.id, 600).replace(/^#+.*$/gm, "").replace(/\s+/g, " ").trim().slice(0, max)}`;

/**
 * Main themes of these bases with the local model, in two short steps that small models handle
 * well: propose themes from the documents' briefs, then merge the ones that overlap.
 */
export async function proposeThemes(kbIds?: string[]): Promise<string[]> {
  const docs = listDocuments(kbIds);
  if (!docs.length) return [];
  const max = Math.max(3, Math.min(10, Math.round(Math.sqrt(docs.length) * 1.3)));
  const listSchema = (n: number) => ({ type: "object", properties: { themes: { type: "array", items: { type: "string" }, minItems: Math.min(2, n), maxItems: n } }, required: ["themes"] });
  const raw = await complete({
    temperature: 0.1,
    source: "tags",
    schema: listSchema(max),
    messages: [
      {
        role: "system",
        content: `Tu organises une base de connaissances. Réponds UNIQUEMENT en JSON : {"themes": ["…"]}.
Propose au plus ${max} thèmes principaux couvrant tous les documents : des domaines en français (un ou deux mots en minuscules reliés par un tiret, ex : data-science, jeux-video), pas des technologies. Chaque document doit entrer dans exactement un thème, et chaque thème regrouper si possible plusieurs documents.`,
      },
      { role: "user", content: docs.map((d) => `- ${docBrief(d)}`).join("\n") },
    ],
  });
  const proposed = normTags(parseJson<{ themes?: unknown }>(raw)?.themes);
  if (proposed.length < 3) return proposed;
  // Merge pass: map each theme to the one it should be merged into (itself if it stays).
  const merged = await complete({
    temperature: 0,
    source: "tags",
    schema: {
      type: "object",
      properties: { fusion: { type: "array", items: { type: "object", properties: { theme: { type: "string", enum: proposed }, garder: { type: "string", enum: proposed } }, required: ["theme", "garder"] } } },
      required: ["fusion"],
    },
    messages: [
      {
        role: "system",
        content: `Tu nettoies une liste de thèmes. Réponds UNIQUEMENT en JSON : {"fusion": [{"theme": "…", "garder": "…"}]}, une entrée par thème de la liste.
"garder" = le thème à conserver : le thème lui-même s'il est distinct des autres, ou un autre thème de la liste s'ils se recoupent (synonymes, l'un inclus dans l'autre, même domaine). Exemples de recoupements : data-science, analyse-de-donnees et apprentissage-machine ; jeux-video et simulation-et-jeux.`,
      },
      { role: "user", content: proposed.join(", ") },
    ],
  });
  const map = new Map<string, string>();
  for (const f of parseJson<{ fusion?: { theme?: string; garder?: string }[] }>(merged)?.fusion ?? []) if (f.theme && f.garder) map.set(f.theme, f.garder);
  // Follow chains (a → b → c) and keep only themes that map to themselves.
  const final = (t: string, seen = new Set<string>()): string => {
    const n = map.get(t) ?? t;
    return n === t || seen.has(n) ? t : (seen.add(t), final(n, seen));
  };
  return [...new Set(proposed.map((t) => final(t)))];
}

/** Retag every document of these bases: themes first, then each document within them (empty themes are dropped). */
export async function retagAll(kbIds: string[] | undefined, onProgress: (ev: { themes?: string[]; doc?: string; tags?: string[]; error?: string; done?: number; total?: number }) => void, signal?: AbortSignal) {
  const docs = listDocuments(kbIds);
  const themes = await proposeThemes(kbIds);
  onProgress({ themes, total: docs.length });
  for (const [i, d] of docs.entries()) {
    if (signal?.aborted) break;
    try {
      onProgress({ doc: d.name, tags: await autoTag(d.id, themes.length ? { themes } : {}), done: i + 1, total: docs.length });
    } catch (e) {
      onProgress({ doc: d.name, error: e instanceof Error ? e.message : String(e), done: i + 1, total: docs.length });
    }
  }
  // Themes holding a single document (on a base of some size) are folded into the others.
  const count = new Map<string, number>();
  for (const d of listDocuments(kbIds)) count.set(d.tags[0], (count.get(d.tags[0]) ?? 0) + 1);
  const kept = themes.filter((t) => (count.get(t) ?? 0) >= (docs.length >= 10 ? 2 : 1));
  if (kept.length >= 2 && kept.length < themes.length)
    for (const d of listDocuments(kbIds).filter((x) => !kept.includes(x.tags[0]))) {
      if (signal?.aborted) break;
      try {
        onProgress({ doc: d.name, tags: await autoTag(d.id, { themes: kept }) });
      } catch {}
    }
  onProgress({ themes: kept.length >= 2 ? kept : themes, done: docs.length, total: docs.length });
}
