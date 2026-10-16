import { getSettings, logUsage, newId } from "./db";
import { chatStream, ollamaBase, ollamaHeaders, resolveModel, type ChatMessage, type ToolDef } from "./gateway";

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

  const type = res.provider.type;
  if (type !== "ollama" && type !== "openai") {
    if (endpoint === "embeddings") return Response.json({ error: { message: `${res.provider.name} ne fournit pas d'embeddings` } }, { status: 400 });
    return viaGateway(body, res.ref, !!payload.stream, req.signal);
  }
  // Ollama exposes /v1; an OpenAI-compatible provider's base URL already ends with /v1.
  const url = type === "openai" ? `${res.provider.base_url.replace(/\/+$/, "")}/${endpoint}` : `${ollamaBase(res.provider)}/v1/${endpoint}`;
  const headers = type === "openai" ? { "content-type": "application/json", ...(res.provider.api_key ? { authorization: `Bearer ${res.provider.api_key}` } : {}) } : ollamaHeaders(res.provider);
  const upstream = await fetch(url, {
    method: "POST",
    headers,
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

/** Providers without an OpenAI endpoint (Anthropic, Claude Code, Codex): run through the gateway and answer in OpenAI format. */
async function viaGateway(body: Record<string, unknown>, ref: string, stream: boolean, signal: AbortSignal) {
  const id = `chatcmpl-${newId()}`;
  const created = Math.floor(Date.now() / 1000);
  try {
    const r = await chatStream({
      ref,
      messages: (body.messages ?? []) as ChatMessage[],
      tools: body.tools as ToolDef[] | undefined,
      temperature: typeof body.temperature === "number" ? body.temperature : undefined,
      signal,
      source: "proxy",
    });
    const message = { role: "assistant", content: r.content || null, ...(r.toolCalls.length ? { tool_calls: r.toolCalls } : {}) };
    const finish = r.toolCalls.length ? "tool_calls" : "stop";
    const usage = { ...r.usage, total_tokens: r.usage.prompt_tokens + r.usage.completion_tokens };
    if (!stream) return Response.json({ id, object: "chat.completion", created, model: ref, choices: [{ index: 0, message, finish_reason: finish }], usage });
    const chunk = (delta: object, finish_reason: string | null, extra = {}) => `data: ${JSON.stringify({ id, object: "chat.completion.chunk", created, model: ref, choices: [{ index: 0, delta, finish_reason }], ...extra })}\n\n`;
    const tools = r.toolCalls.map((tc, index) => ({ index, ...tc }));
    const sse = chunk({ role: "assistant", content: r.content, ...(tools.length ? { tool_calls: tools } : {}) }, null) + chunk({}, finish, { usage }) + "data: [DONE]\n\n";
    return new Response(sse, { headers: { "content-type": "text/event-stream; charset=utf-8", "cache-control": "no-cache" } });
  } catch (e) {
    return Response.json({ error: { message: e instanceof Error ? e.message : String(e) } }, { status: 502 });
  }
}
