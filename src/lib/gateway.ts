// Local-only gateway: every model runs on an Ollama host, reached through Ollama's native API
// (native /api/chat lets us set num_ctx and toggle thinking, which the OpenAI-compatible endpoint does not).
import { db, getSettings, list, logUsage, newId, type ModelRow, type Provider } from "./db";

export type ToolCall = { id: string; type: "function"; function: { name: string; arguments: string } };
export type ChatMessage =
  | { role: "system" | "user"; content: string }
  | { role: "assistant"; content: string | null; tool_calls?: ToolCall[] }
  | { role: "tool"; content: string; tool_call_id: string };
export type ToolDef = { type: "function"; function: { name: string; description: string; parameters: Record<string, unknown> } };
export type Usage = { prompt_tokens: number; completion_tokens: number };

export const PROVIDER_PRESETS: Record<string, { name: string; base_url: string; needsKey: boolean }> = {
  ollama: { name: "Ollama local", base_url: "http://127.0.0.1:11434", needsKey: false },
  "ollama-remote": { name: "Ollama distant (machine GPU du réseau)", base_url: "http://192.168.1.10:11434", needsKey: false },
};

export type Resolved = { provider: Provider; model: string; row?: ModelRow; ref: string };

/** Resolve "host-slug/model-name" (model names may themselves contain "/", e.g. hf.co/...). */
export function resolveModel(ref?: string | null, kind: "chat" | "embedding" = "chat"): Resolved {
  const s = getSettings();
  const r = (ref && ref.trim()) || (kind === "chat" ? s.default_model : s.embedding_model);
  const providers = list<Provider>("providers");
  const slash = r.indexOf("/");
  let provider = slash > 0 ? providers.find((p) => p.slug === r.slice(0, slash)) : undefined;
  let model = provider ? r.slice(slash + 1) : r;
  if (!provider) {
    const row = db().prepare("SELECT * FROM models WHERE model = ? OR label = ? LIMIT 1").get(r, r) as ModelRow | undefined;
    provider = row ? providers.find((p) => p.id === row.provider_id) : providers.find((p) => p.enabled);
    model = row ? row.model : r;
  }
  if (!provider) throw new Error(`Aucun hôte Ollama configuré pour le modèle « ${r} »`);
  if (!provider.enabled) throw new Error(`L'hôte « ${provider.name} » est désactivé`);
  const row = db().prepare("SELECT * FROM models WHERE provider_id = ? AND model = ?").get(provider.id, model) as ModelRow | undefined;
  return {
    provider,
    model,
    row: row ? { ...row, supports_tools: !!row.supports_tools, enabled: !!row.enabled } : undefined,
    ref: `${provider.slug}/${model}`,
  };
}

/** Native Ollama root (tolerates a pasted ".../v1"). */
export const ollamaBase = (p: Provider) => p.base_url.replace(/\/+$/, "").replace(/\/v1$/, "");
export function ollamaHeaders(p: Provider): Record<string, string> {
  const h: Record<string, string> = { "content-type": "application/json" };
  if (p.api_key) h.authorization = `Bearer ${p.api_key}`;
  return h;
}

// ---------- capabilities (cached per host+model) ----------
const g = globalThis as unknown as { __millikinCaps?: Map<string, string[]> };
const capsCache = (g.__millikinCaps ??= new Map());

export async function capabilities(p: Provider, model: string): Promise<string[]> {
  const key = `${p.id}:${model}`;
  const hit = capsCache.get(key);
  if (hit) return hit;
  try {
    const r = await fetch(`${ollamaBase(p)}/api/show`, { method: "POST", headers: ollamaHeaders(p), body: JSON.stringify({ model }) });
    const caps = r.ok ? (((await r.json()) as { capabilities?: string[] }).capabilities ?? []) : [];
    capsCache.set(key, caps);
    return caps;
  } catch {
    return [];
  }
}

/** Read an NDJSON stream line by line. */
async function readNDJSON(body: ReadableStream<Uint8Array>, onLine: (j: Record<string, unknown>) => void) {
  const reader = body.getReader();
  const dec = new TextDecoder();
  let buf = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let nl: number;
    while ((nl = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, nl).trim();
      buf = buf.slice(nl + 1);
      if (line) onLine(JSON.parse(line));
    }
  }
  if (buf.trim()) onLine(JSON.parse(buf));
}

/** OpenAI-shaped history → Ollama native messages (object arguments, tool_name on tool results). */
function toNative(messages: ChatMessage[]) {
  const names = new Map<string, string>();
  return messages.map((m) => {
    if (m.role === "assistant") {
      for (const tc of m.tool_calls ?? []) names.set(tc.id, tc.function.name);
      return {
        role: "assistant",
        content: m.content ?? "",
        ...(m.tool_calls?.length
          ? {
              tool_calls: m.tool_calls.map((tc) => {
                let args: unknown = {};
                try {
                  args = JSON.parse(tc.function.arguments || "{}");
                } catch {}
                return { function: { name: tc.function.name, arguments: args } };
              }),
            }
          : {}),
      };
    }
    if (m.role === "tool") return { role: "tool", content: m.content, tool_name: names.get(m.tool_call_id) ?? "" };
    return m;
  });
}

export type StreamResult = { content: string; reasoning: string; toolCalls: ToolCall[]; usage: Usage };

/**
 * Small local models sometimes write a tool call as text (`<tool_call>{"name": …, "arguments": …}</tool_call>`)
 * instead of using the structured channel. Turn those blocks into real calls (known tools only) and drop them from the text.
 */
export function extractTextToolCalls(content: string, toolNames: string[]): { calls: ToolCall[]; rest: string } {
  const calls: ToolCall[] = [];
  const rest = content.replace(/<tool_call>\s*(\{[\s\S]*?\})\s*(?:<\/tool_call>|$)/g, (block, json: string) => {
    try {
      const j = JSON.parse(json) as { name?: string; arguments?: unknown };
      if (!j.name || !toolNames.includes(j.name)) return block;
      calls.push({ id: `call_${newId()}`, type: "function", function: { name: j.name, arguments: typeof j.arguments === "string" ? j.arguments : JSON.stringify(j.arguments ?? {}) } });
      return "";
    } catch {
      return block;
    }
  });
  return { calls, rest: rest.trim() };
}
export type Think = "" | "on" | "off";

/** Streaming chat with tool calls, thinking split and usage logging. */
export async function chatStream(opts: {
  ref?: string | null;
  messages: ChatMessage[];
  tools?: ToolDef[];
  temperature?: number;
  think?: Think;
  signal?: AbortSignal;
  agentId?: string | null;
  /** Attributes usage to a project (per-project stats). */
  projectId?: string | null;
  source?: string;
  json?: boolean;
  /** JSON schema the answer must follow (Ollama structured outputs); implies JSON. */
  schema?: Record<string, unknown>;
  onText?: (t: string) => void;
  onReasoning?: (t: string) => void;
}): Promise<StreamResult> {
  const res = resolveModel(opts.ref);
  const s = getSettings();
  const caps = await capabilities(res.provider, res.model);
  const started = Date.now();

  const options: Record<string, unknown> = { num_ctx: Number(s.num_ctx) || 16384 };
  if (opts.temperature !== undefined) options.temperature = opts.temperature;
  const body: Record<string, unknown> = {
    model: res.model,
    messages: toNative(opts.messages),
    stream: true,
    options,
    keep_alive: s.keep_alive || "10m",
  };
  if (opts.tools?.length && (caps.length ? caps.includes("tools") : res.row?.supports_tools !== false)) body.tools = opts.tools;
  if (opts.schema) body.format = opts.schema;
  else if (opts.json) body.format = "json";
  // Only send `think` to models that support it; Ollama rejects it otherwise.
  if (caps.includes("thinking")) {
    const mode = opts.think || (s.think === "on" ? "on" : "off");
    body.think = mode === "on";
  }

  let content = "";
  let reasoning = "";
  const usage: Usage = { prompt_tokens: 0, completion_tokens: 0 };
  const toolCalls: ToolCall[] = [];

  // Some models still inline <think>…</think>; split it out, holding back partial tags.
  let inThink = false;
  let pending = "";
  const emit = (t: string) => {
    if (!t) return;
    if (inThink) {
      reasoning += t;
      opts.onReasoning?.(t);
    } else {
      content += t;
      opts.onText?.(t);
    }
  };
  const partialTail = (str: string, tag: string) => {
    for (let k = Math.min(tag.length - 1, str.length); k > 0; k--) if (str.endsWith(tag.slice(0, k))) return k;
    return 0;
  };
  const pushText = (t: string) => {
    pending += t;
    for (;;) {
      const tag = inThink ? "</think>" : "<think>";
      const at = pending.indexOf(tag);
      if (at < 0) {
        const hold = partialTail(pending, tag);
        emit(pending.slice(0, pending.length - hold));
        pending = pending.slice(pending.length - hold);
        return;
      }
      emit(pending.slice(0, at));
      pending = pending.slice(at + tag.length);
      inThink = !inThink;
    }
  };

  // Runaway thinking guard: past the cap, abort and answer directly without thinking.
  const maxReasoning = Number(s.max_reasoning) || 12000;
  const local = new AbortController();
  const onOuterAbort = () => local.abort();
  opts.signal?.addEventListener("abort", onOuterAbort);
  let overthinking = false;

  try {
    const r = await fetch(`${ollamaBase(res.provider)}/api/chat`, {
      method: "POST",
      headers: ollamaHeaders(res.provider),
      body: JSON.stringify(body),
      signal: local.signal,
    });
    if (!r.ok || !r.body) throw new Error(`Ollama ${r.status} (${res.model}) : ${(await r.text()).slice(0, 400)}`);
    await readNDJSON(r.body, (ev) => {
      if (ev.error) throw new Error(`Ollama : ${ev.error}`);
      const msg = ev.message as { content?: string; thinking?: string; tool_calls?: { function: { name: string; arguments: unknown } }[] } | undefined;
      if (msg?.thinking) {
        reasoning += msg.thinking;
        opts.onReasoning?.(msg.thinking);
        if (body.think && reasoning.length > maxReasoning && !content) {
          overthinking = true;
          local.abort();
        }
      }
      if (msg?.content) pushText(msg.content);
      for (const tc of msg?.tool_calls ?? []) {
        const args = tc.function.arguments;
        toolCalls.push({
          id: `call_${newId()}`,
          type: "function",
          function: { name: tc.function.name, arguments: typeof args === "string" ? args : JSON.stringify(args ?? {}) },
        });
      }
      if (ev.done) {
        usage.prompt_tokens = Number(ev.prompt_eval_count ?? 0);
        usage.completion_tokens = Number(ev.eval_count ?? 0);
      }
    });
    emit(pending);
    logUsage({ provider: res.provider.slug, model: res.model, agent_id: opts.agentId, project_id: opts.projectId, source: opts.source ?? "agent", ...usage, latency_ms: Date.now() - started, status: "ok" });
    opts.signal?.removeEventListener("abort", onOuterAbort);
    if (!toolCalls.length && opts.tools?.length && content.includes("<tool_call>")) {
      const { calls, rest } = extractTextToolCalls(content, opts.tools.map((t) => t.function.name));
      if (calls.length) return { content: rest, reasoning, toolCalls: calls, usage };
    }
    return { content, reasoning, toolCalls, usage };
  } catch (e) {
    if (overthinking && !opts.signal?.aborted) {
      logUsage({ provider: res.provider.slug, model: res.model, agent_id: opts.agentId, project_id: opts.projectId, source: opts.source ?? "agent", latency_ms: Date.now() - started, status: "error", error: "réflexion trop longue, relance sans réflexion" });
      opts.onReasoning?.("\n\n[Réflexion trop longue : réponse directe sans réflexion]\n");
      return chatStream({ ...opts, think: "off" });
    }
    const msg = e instanceof Error ? e.message : String(e);
    if (!opts.signal?.aborted)
      logUsage({ provider: res.provider.slug, model: res.model, agent_id: opts.agentId, project_id: opts.projectId, source: opts.source ?? "agent", latency_ms: Date.now() - started, status: "error", error: msg });
    throw e;
  }
}

/** Non-streaming helper for JSON generation (thinking off: faster, and cleaner JSON). */
export async function complete(opts: { ref?: string | null; messages: ChatMessage[]; json?: boolean; schema?: Record<string, unknown>; source?: string; temperature?: number }) {
  const r = await chatStream({ ...opts, think: "off", source: opts.source ?? "generator" });
  return r.content;
}

export async function embed(texts: string[], ref?: string | null): Promise<number[][]> {
  const res = resolveModel(ref, "embedding");
  const out: number[][] = [];
  const started = Date.now();
  let tokens = 0;
  try {
    for (let i = 0; i < texts.length; i += 32) {
      const r = await fetch(`${ollamaBase(res.provider)}/api/embed`, {
        method: "POST",
        headers: ollamaHeaders(res.provider),
        body: JSON.stringify({ model: res.model, input: texts.slice(i, i + 32), keep_alive: "10m" }),
      });
      if (!r.ok) {
        const body = (await r.text()).slice(0, 300);
        if (r.status === 404 && /not found/i.test(body)) throw new Error(`Le modèle d'embedding « ${res.model} » n'est pas installé sur Ollama : installe-le (onglet Modèles) ou choisis-en un autre dans Réglages.`);
        throw new Error(`Embeddings ${r.status} (${res.model}) : ${body}`);
      }
      const j = (await r.json()) as { embeddings: number[][]; prompt_eval_count?: number };
      tokens += j.prompt_eval_count ?? 0;
      out.push(...j.embeddings);
    }
    logUsage({ provider: res.provider.slug, model: res.model, source: "embedding", prompt_tokens: tokens, latency_ms: Date.now() - started, status: "ok" });
    return out;
  } catch (e) {
    logUsage({ provider: res.provider.slug, model: res.model, source: "embedding", latency_ms: Date.now() - started, status: "error", error: String(e) });
    throw e;
  }
}

/** Sync the catalog with the models installed on an Ollama host. */
export async function discoverModels(p: Provider): Promise<{ added: number; total: number }> {
  const r = await fetch(`${ollamaBase(p)}/api/tags`, { headers: ollamaHeaders(p) });
  if (!r.ok) throw new Error(`${p.name} ${r.status}: ${(await r.text()).slice(0, 300)}`);
  const ids = (((await r.json()) as { models?: { name: string }[] }).models ?? []).map((m) => m.name);
  const ins = db().prepare(
    "INSERT INTO models (id, provider_id, model, label, kind, supports_tools, enabled) VALUES (?,?,?,?,?,?,1) ON CONFLICT(provider_id, model) DO UPDATE SET kind = excluded.kind, supports_tools = excluded.supports_tools",
  );
  let added = 0;
  for (const id of ids) {
    capsCache.delete(`${p.id}:${id}`);
    const caps = await capabilities(p, id);
    const kind = caps.includes("embedding") && !caps.includes("completion") ? "embedding" : /embed|bge/i.test(id) && !caps.length ? "embedding" : "chat";
    const before = db().prepare("SELECT 1 FROM models WHERE provider_id = ? AND model = ?").get(p.id, id);
    ins.run(newId(), p.id, id, "", kind, caps.includes("tools") ? 1 : 0);
    if (!before) added++;
  }
  // Drop catalog rows for models that were removed from the host.
  const rows = db().prepare("SELECT id, model FROM models WHERE provider_id = ?").all(p.id) as { id: string; model: string }[];
  for (const row of rows) if (!ids.includes(row.model)) db().prepare("DELETE FROM models WHERE id = ?").run(row.id);
  return { added, total: ids.length };
}
