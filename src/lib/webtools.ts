// Network tools for agents: web search (SearXNG, DuckDuckGo fallback), URL reading, HTTP/API calls.
import { getSettings } from "./db";

const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_4) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36 Millikin";
const MAX_BYTES = 3 * 1024 * 1024;
const PAGE_CHARS = 12000;

export type SearchResult = { title: string; url: string; snippet: string };

// Short-lived cache: agents of a team often repeat the same searches and page reads within a run.
const TTL = 10 * 60_000;
const gc = globalThis as unknown as { __millikinWebCache?: Map<string, { at: number; value: string }> };
const cache = (gc.__millikinWebCache ??= new Map());
async function cached(key: string, fn: () => Promise<string>): Promise<string> {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL) return hit.value;
  const value = await fn();
  cache.set(key, { at: Date.now(), value });
  if (cache.size > 200) cache.delete(cache.keys().next().value!);
  return value;
}

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", eacute: "é", egrave: "è", agrave: "à", ccedil: "ç", rsquo: "’", lsquo: "‘", ldquo: "“", rdquo: "”", hellip: "…", mdash: "—", ndash: "–" };
export function decodeEntities(s: string) {
  return s
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&([a-z]+);/gi, (m, n) => ENTITIES[n.toLowerCase()] ?? m);
}
const stripTags = (s: string) => decodeEntities(s.replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();

function assertHttp(url: string) {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    throw new Error(`URL invalide : ${url}`);
  }
  if (!/^https?:$/.test(u.protocol)) throw new Error("Seules les URL http(s) sont acceptées");
  return u;
}

/** Read a response body with a size cap. */
async function readCapped(r: Response): Promise<{ bytes: Uint8Array; truncated: boolean }> {
  if (!r.body) return { bytes: new Uint8Array(), truncated: false };
  const reader = r.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  let truncated = false;
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > MAX_BYTES) {
      truncated = true;
      await reader.cancel().catch(() => {});
      break;
    }
    chunks.push(value);
  }
  const out = new Uint8Array(chunks.reduce((n, c) => n + c.length, 0));
  let off = 0;
  for (const c of chunks) {
    out.set(c, off);
    off += c.length;
  }
  return { bytes: out, truncated };
}

// ---------------------------------------------------------------- search

async function searxng(query: string, n: number): Promise<SearchResult[]> {
  const base = getSettings().searxng_url.replace(/\/+$/, "");
  const r = await fetch(`${base}/search?q=${encodeURIComponent(query)}&format=json`, { signal: AbortSignal.timeout(15000) });
  if (!r.ok) throw new Error(`SearXNG ${r.status}${r.status === 403 ? " (active le format json dans settings.yml)" : ""}`);
  const j = (await r.json()) as { results?: { title: string; url: string; content?: string }[] };
  return (j.results ?? []).slice(0, n).map((x) => ({ title: x.title, url: x.url, snippet: (x.content ?? "").slice(0, 300) }));
}

/** DuckDuckGo's HTML endpoint, used only when SearXNG is unavailable (can be turned off in settings). */
async function duckduckgo(query: string, n: number): Promise<SearchResult[]> {
  const r = await fetch(`https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`, {
    headers: { "user-agent": UA, "accept-language": "fr-FR,fr;q=0.9,en;q=0.8" },
    signal: AbortSignal.timeout(15000),
  });
  if (!r.ok) throw new Error(`DuckDuckGo ${r.status}`);
  const html = await r.text();
  const links = [...html.matchAll(/<a[^>]*class="result__a"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/g)];
  const snippets = [...html.matchAll(/class="result__snippet"[^>]*>([\s\S]*?)<\/(?:a|td|div)>/g)].map((m) => stripTags(m[1]));
  return links.slice(0, n).map((m, i) => {
    let url = decodeEntities(m[1]);
    const uddg = url.match(/[?&]uddg=([^&]+)/);
    if (uddg) url = decodeURIComponent(uddg[1]);
    if (url.startsWith("//")) url = "https:" + url;
    return { title: stripTags(m[2]), url, snippet: (snippets[i] ?? "").slice(0, 300) };
  });
}

export async function webSearch(query: string, n = 6): Promise<string> {
  if (!query.trim()) throw new Error("Requête vide");
  return cached(`search:${n}:${query.trim().toLowerCase()}`, () => searchUncached(query, n));
}

async function searchUncached(query: string, n: number): Promise<string> {
  const s = getSettings();
  let results: SearchResult[] = [];
  let source = "SearXNG";
  let note = "";
  try {
    results = await searxng(query, n);
  } catch (e) {
    note = e instanceof Error ? e.message : String(e);
    if (s.web_fallback === "off") throw new Error(`Recherche indisponible : ${note} (secours désactivé dans Réglages)`);
    results = await duckduckgo(query, n).catch((e2) => {
      throw new Error(`Recherche indisponible : SearXNG (${note}) puis DuckDuckGo (${e2 instanceof Error ? e2.message : e2})`);
    });
    source = "DuckDuckGo (secours)";
  }
  if (!results.length) return `Aucun résultat pour « ${query} » (${source}).`;
  return `Résultats (${source}) pour « ${query} » :\n` + results.map((x, i) => `${i + 1}. ${x.title}\n   ${x.url}\n   ${x.snippet}`).join("\n");
}

// ---------------------------------------------------------------- read a page

/** Readable text from HTML: title, description, headings, paragraphs and lists, without chrome. */
export function htmlToText(html: string): { title: string; text: string } {
  const title = stripTags(html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? "");
  const desc = html.match(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']*)["']/i)?.[1];
  const main = html.match(/<(main|article)[\s\S]*?<\/\1>/i)?.[0] ?? html.match(/<body[\s\S]*<\/body>/i)?.[0] ?? html;
  const text = main
    .replace(/<(script|style|noscript|svg|nav|footer|header|aside|form|iframe|template)[\s\S]*?<\/\1>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<h([1-6])[^>]*>/gi, (_, l) => `\n\n${"#".repeat(Number(l))} `)
    .replace(/<li[^>]*>/gi, "\n- ")
    .replace(/<(br|\/p|\/div|\/tr|\/h[1-6]|\/li|\/pre|\/blockquote)[^>]*>/gi, "\n")
    .replace(/<td[^>]*>/gi, " | ")
    .replace(/<[^>]+>/g, " ");
  const clean = decodeEntities(text)
    .split("\n")
    .map((l) => l.replace(/[ \t ]+/g, " ").trim())
    .filter(Boolean)
    .join("\n")
    .replace(/\n{3,}/g, "\n\n");
  return { title, text: (desc ? `${decodeEntities(desc)}\n\n` : "") + clean };
}

export async function fetchUrl(url: string): Promise<string> {
  assertHttp(url);
  return cached(`url:${url}`, () => fetchUncached(url));
}

async function fetchUncached(url: string): Promise<string> {
  let r: Response;
  try {
    r = await fetch(url, { redirect: "follow", signal: AbortSignal.timeout(20000), headers: { "user-agent": UA, accept: "text/html,application/json,text/plain,*/*;q=0.8" } });
  } catch (e) {
    throw new Error(`Impossible de joindre ${url} : ${e instanceof Error ? e.message : e}`);
  }
  const type = (r.headers.get("content-type") ?? "").toLowerCase();
  const { bytes, truncated } = await readCapped(r);
  const head = `HTTP ${r.status} — ${r.url}${r.url !== url ? ` (redirigé depuis ${url})` : ""}`;
  const cut = (s: string) => (s.length > PAGE_CHARS ? s.slice(0, PAGE_CHARS) + `\n… (tronqué, ${s.length} caractères)` : s);
  if (type.includes("pdf") || /\.pdf($|\?)/i.test(r.url)) {
    const { extractText } = await import("./rag");
    return `${head}\n\n${cut(await extractText("document.pdf", bytes))}`;
  }
  const text = new TextDecoder().decode(bytes) + (truncated ? "\n… (contenu tronqué à 3 Mo)" : "");
  if (type.includes("json")) {
    try {
      return `${head}\n\n${cut(JSON.stringify(JSON.parse(text), null, 2))}`;
    } catch {
      return `${head}\n\n${cut(text)}`;
    }
  }
  if (type.includes("html") || /^\s*<(!doctype|html)/i.test(text)) {
    const { title, text: body } = htmlToText(text);
    return `${head}${title ? `\nTitre : ${title}` : ""}\n\n${cut(body)}`;
  }
  if (type.startsWith("text/") || type.includes("xml") || type.includes("javascript") || !type) return `${head}\n\n${cut(text)}`;
  return `${head}\nContenu binaire (${type}) non lisible en texte.`;
}

// ---------------------------------------------------------------- HTTP / API

const METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"];

export async function httpRequest(a: { method?: unknown; url?: unknown; headers?: unknown; body?: unknown; timeout?: unknown }): Promise<string> {
  const url = String(a.url ?? "");
  assertHttp(url);
  const method = String(a.method ?? "GET").toUpperCase();
  if (!METHODS.includes(method)) throw new Error(`Méthode non gérée : ${method}`);
  const headers: Record<string, string> = { "user-agent": "Millikin-agent" };
  if (a.headers && typeof a.headers === "object") for (const [k, v] of Object.entries(a.headers as Record<string, unknown>)) headers[k.toLowerCase()] = String(v);
  let body: string | undefined;
  if (a.body !== undefined && a.body !== null && a.body !== "" && !["GET", "HEAD"].includes(method)) {
    if (typeof a.body === "string") body = a.body;
    else {
      body = JSON.stringify(a.body);
      headers["content-type"] ??= "application/json";
    }
  }
  const timeout = Math.min(120, Math.max(1, Number(a.timeout) || 30)) * 1000;
  const started = Date.now();
  let r: Response;
  try {
    r = await fetch(url, { method, headers, body, redirect: "follow", signal: AbortSignal.timeout(timeout) });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    throw new Error(`${method} ${url} a échoué : ${/timeout|abort/i.test(msg) ? `délai de ${timeout / 1000} s dépassé` : msg}`);
  }
  const ms = Date.now() - started;
  const type = r.headers.get("content-type") ?? "";
  const keep = ["content-type", "location", "content-length", "retry-after", "www-authenticate"].map((h) => (r.headers.get(h) ? `${h}: ${r.headers.get(h)}` : "")).filter(Boolean);
  let text = method === "HEAD" ? "" : new TextDecoder().decode((await readCapped(r)).bytes);
  if (type.includes("json")) {
    try {
      text = JSON.stringify(JSON.parse(text), null, 2);
    } catch {}
  }
  if (text.length > 8000) text = text.slice(0, 8000) + `\n… (tronqué, ${text.length} caractères)`;
  return `${method} ${url} → HTTP ${r.status} ${r.statusText} (${ms} ms)\n${keep.join("\n")}${text ? `\n\n${text}` : ""}`;
}
