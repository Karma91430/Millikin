import { getSettings, logUsage } from "./db";
import { ollamaBase, ollamaHeaders, resolveModel } from "./gateway";

export function checkProxyAuth(req: Request): Response | null {
  const key = getSettings().proxy_key;
  if (!key) return null;
  const got = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
  return got === key ? null : Response.json({ error: { message: "Clé proxy invalide", type: "auth_error" } }, { status: 401 });
}

/** Forward an OpenAI-format request to Ollama's OpenAI-compatible endpoint, logging usage (streaming or not). */
export async function forward(req: Request, endpoint: "chat/completions" | "embeddings") {
  const denied = checkProxyAuth(req);
  if (denied) return denied;
  const body = (await req.json()) as Record<string, unknown>;
  let res;
  try {
    res = resolveModel(String(body.model ?? ""), endpoint === "embeddings" ? "embedding" : "chat");
  } catch (e) {
    return Response.json({ error: { message: String(e instanceof Error ? e.message : e) } }, { status: 400 });
  }
  const started = Date.now();
  const payload: Record<string, unknown> = { ...body, model: res.model };
  if (payload.stream) payload.stream_options = { include_usage: true, ...(payload.stream_options as object) };
  const log = (status: "ok" | "error", u?: { prompt_tokens?: number; completion_tokens?: number }, error?: string) =>
    logUsage({ provider: res.provider.slug, model: res.model, source: "proxy", ...u, latency_ms: Date.now() - started, status, error });

  const upstream = await fetch(`${ollamaBase(res.provider)}/v1/${endpoint}`, {
    method: "POST",
    headers: ollamaHeaders(res.provider),
    body: JSON.stringify(payload),
    signal: req.signal,
  }).catch((e) => e as Error);
  if (upstream instanceof Error) {
    log("error", undefined, upstream.message);
    return Response.json({ error: { message: upstream.message } }, { status: 502 });
  }
  if (!upstream.ok || !payload.stream || !upstream.body) {
    const text = await upstream.text();
    let usage;
    try {
      usage = JSON.parse(text).usage;
    } catch {}
    log(upstream.ok ? "ok" : "error", usage, upstream.ok ? undefined : text.slice(0, 300));
    return new Response(text, { status: upstream.status, headers: { "content-type": upstream.headers.get("content-type") ?? "application/json" } });
  }

  // Pass the stream through untouched while sniffing the final usage chunk.
  let usage: { prompt_tokens?: number; completion_tokens?: number } | undefined;
  let tail = "";
  const dec = new TextDecoder();
  const sniff = new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, ctrl) {
      tail = (tail + dec.decode(chunk, { stream: true })).slice(-4000);
      const m = tail.match(/"usage"\s*:\s*(\{[^}]*\})/g);
      if (m) {
        try {
          usage = JSON.parse(m[m.length - 1].replace(/^"usage"\s*:\s*/, ""));
        } catch {}
      }
      ctrl.enqueue(chunk);
    },
    flush() {
      log("ok", usage);
    },
  });
  return new Response(upstream.body.pipeThrough(sniff), {
    headers: { "content-type": "text/event-stream; charset=utf-8", "cache-control": "no-cache" },
  });
}
