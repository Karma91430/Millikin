// Model providers other than Ollama: OpenAI-compatible APIs, Anthropic, and agentic CLIs (Claude Code,
// Codex) driven as plain text engines. Every adapter honours the same contract as the Ollama path:
// stream text, return tool calls and usage, so agents work the same whatever the engine.
import { spawn } from "node:child_process";
import { newId, type Provider } from "./db";
import { CALL_OPEN, countCalls, lastCallEnd, MAX_CALLS_PER_ANSWER, onlyMoreCalls } from "./toolcalls";
import type { ChatMessage, StreamResult, ToolCall, ToolDef, Usage } from "./gateway";

export type ProviderType = "ollama" | "openai" | "anthropic" | "claude-code" | "codex";
export type Preset = { type: ProviderType; name: string; base_url: string; needsKey: boolean; group: "local" | "cloud" | "cli"; hint: string; models?: string[] };

/** One click to add a provider: type, endpoint and the models to offer when it cannot list them. */
export const PROVIDER_PRESETS: Record<string, Preset> = {
  ollama: { type: "ollama", name: "Ollama local", base_url: "http://127.0.0.1:11434", needsKey: false, group: "local", hint: "Modèles locaux, gratuits et privés" },
  "ollama-remote": { type: "ollama", name: "Ollama distant", base_url: "http://192.168.1.10:11434", needsKey: false, group: "local", hint: "Une machine GPU de ton réseau" },
  lmstudio: { type: "openai", name: "LM Studio", base_url: "http://127.0.0.1:1234/v1", needsKey: false, group: "local", hint: "Serveur local compatible OpenAI" },
  "claude-code": { type: "claude-code", name: "Claude Code", base_url: "claude", needsKey: false, group: "cli", hint: "Utilise ton abonnement Claude via la CLI installée", models: ["sonnet", "opus", "haiku"] },
  codex: { type: "codex", name: "Codex", base_url: "codex", needsKey: false, group: "cli", hint: "Utilise ton compte OpenAI via la CLI Codex", models: ["gpt-5-codex", "gpt-5"] },
  anthropic: { type: "anthropic", name: "Anthropic (Claude API)", base_url: "https://api.anthropic.com", needsKey: true, group: "cloud", hint: "Clé API Anthropic" },
  openai: { type: "openai", name: "OpenAI", base_url: "https://api.openai.com/v1", needsKey: true, group: "cloud", hint: "Clé API OpenAI" },
  mistral: { type: "openai", name: "Mistral AI", base_url: "https://api.mistral.ai/v1", needsKey: true, group: "cloud", hint: "Clé API Mistral (hébergé en Europe)" },
  openrouter: { type: "openai", name: "OpenRouter", base_url: "https://openrouter.ai/api/v1", needsKey: true, group: "cloud", hint: "Des centaines de modèles avec une seule clé" },
  groq: { type: "openai", name: "Groq", base_url: "https://api.groq.com/openai/v1", needsKey: true, group: "cloud", hint: "Inférence très rapide" },
};

export type ChatOpts = {
  model: string;
  messages: ChatMessage[];
  tools?: ToolDef[];
  temperature?: number;
  schema?: Record<string, unknown>;
  json?: boolean;
  signal?: AbortSignal;
  onText?: (t: string) => void;
};

const trimSlash = (u: string) => u.replace(/\/+$/, "");
const parseArgs = (s: string) => {
  try {
    return JSON.parse(s || "{}");
  } catch {
    return {};
  }
};

/** Read a Server-Sent Events body: one callback per `data:` payload (JSON-decoded). */
async function readSSE(body: ReadableStream<Uint8Array>, onData: (j: Record<string, unknown>, event?: string) => void) {
  const reader = body.getReader();
  const dec = new TextDecoder();
  let buf = "";
  let event: string | undefined;
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let nl: number;
    while ((nl = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, nl).replace(/\r$/, "");
      buf = buf.slice(nl + 1);
      if (line.startsWith("event:")) event = line.slice(6).trim();
      else if (line.startsWith("data:")) {
        const data = line.slice(5).trim();
        if (data && data !== "[DONE]") onData(JSON.parse(data), event);
      } else if (!line) event = undefined;
    }
  }
}

// ---------------------------------------------------------------- OpenAI-compatible

export async function openaiChat(p: Provider, o: ChatOpts): Promise<StreamResult> {
  const body: Record<string, unknown> = { model: o.model, messages: o.messages, stream: true, stream_options: { include_usage: true } };
  if (o.temperature !== undefined) body.temperature = o.temperature;
  if (o.tools?.length) body.tools = o.tools;
  if (o.schema) body.response_format = { type: "json_schema", json_schema: { name: "answer", schema: o.schema } };
  else if (o.json) body.response_format = { type: "json_object" };
  const r = await fetch(`${trimSlash(p.base_url)}/chat/completions`, {
    method: "POST",
    headers: { "content-type": "application/json", ...(p.api_key ? { authorization: `Bearer ${p.api_key}` } : {}) },
    body: JSON.stringify(body),
    signal: o.signal,
  });
  if (!r.ok || !r.body) throw new Error(`${p.name} ${r.status} (${o.model}) : ${(await r.text()).slice(0, 400)}`);
  let content = "";
  const usage: Usage = { prompt_tokens: 0, completion_tokens: 0 };
  const calls = new Map<number, { id: string; name: string; args: string }>();
  await readSSE(r.body, (j) => {
    if (j.error) throw new Error(`${p.name} : ${JSON.stringify(j.error).slice(0, 300)}`);
    const u = j.usage as { prompt_tokens?: number; completion_tokens?: number } | undefined;
    if (u) Object.assign(usage, { prompt_tokens: u.prompt_tokens ?? 0, completion_tokens: u.completion_tokens ?? 0 });
    const delta = ((j.choices as { delta?: Record<string, unknown> }[] | undefined)?.[0]?.delta ?? {}) as {
      content?: string;
      tool_calls?: { index: number; id?: string; function?: { name?: string; arguments?: string } }[];
    };
    if (delta.content) {
      content += delta.content;
      o.onText?.(delta.content);
    }
    for (const tc of delta.tool_calls ?? []) {
      const cur = calls.get(tc.index) ?? { id: tc.id || `call_${newId()}`, name: "", args: "" };
      if (tc.function?.name) cur.name += tc.function.name;
      if (tc.function?.arguments) cur.args += tc.function.arguments;
      calls.set(tc.index, cur);
    }
  });
  const toolCalls: ToolCall[] = [...calls.values()].filter((c) => c.name).map((c) => ({ id: c.id, type: "function", function: { name: c.name, arguments: c.args || "{}" } }));
  return { content, reasoning: "", toolCalls, usage };
}

export async function openaiEmbed(p: Provider, model: string, texts: string[]) {
  const r = await fetch(`${trimSlash(p.base_url)}/embeddings`, {
    method: "POST",
    headers: { "content-type": "application/json", ...(p.api_key ? { authorization: `Bearer ${p.api_key}` } : {}) },
    body: JSON.stringify({ model, input: texts }),
  });
  if (!r.ok) throw new Error(`Embeddings ${p.name} ${r.status} (${model}) : ${(await r.text()).slice(0, 300)}`);
  const j = (await r.json()) as { data: { embedding: number[] }[]; usage?: { prompt_tokens?: number } };
  return { vectors: j.data.map((d) => d.embedding), tokens: j.usage?.prompt_tokens ?? 0 };
}

// ---------------------------------------------------------------- Anthropic

/** OpenAI-shaped history → Anthropic messages (system apart, tool calls and results as content blocks). */
function toAnthropic(messages: ChatMessage[]) {
  const system = messages.filter((m) => m.role === "system").map((m) => m.content).join("\n\n");
  const out: { role: "user" | "assistant"; content: unknown }[] = [];
  for (const m of messages) {
    if (m.role === "system") continue;
    if (m.role === "tool") {
      const block = { type: "tool_result", tool_use_id: m.tool_call_id, content: m.content };
      const last = out[out.length - 1];
      // Consecutive tool results go into one user turn.
      if (last?.role === "user" && Array.isArray(last.content) && (last.content as { type: string }[]).every((b) => b.type === "tool_result")) (last.content as unknown[]).push(block);
      else out.push({ role: "user", content: [block] });
    } else if (m.role === "assistant") {
      const blocks: unknown[] = [];
      if (m.content) blocks.push({ type: "text", text: m.content });
      for (const tc of m.tool_calls ?? []) blocks.push({ type: "tool_use", id: tc.id, name: tc.function.name, input: parseArgs(tc.function.arguments) });
      if (blocks.length) out.push({ role: "assistant", content: blocks });
    } else out.push({ role: "user", content: m.content });
  }
  return { system, messages: out };
}

export async function anthropicChat(p: Provider, o: ChatOpts): Promise<StreamResult> {
  const { system, messages } = toAnthropic(o.messages);
  const sys = o.schema || o.json ? `${system}\n\nRéponds uniquement avec un objet JSON valide${o.schema ? ` conforme à ce schéma : ${JSON.stringify(o.schema)}` : ""}, sans texte autour.` : system;
  const body: Record<string, unknown> = { model: o.model, max_tokens: 8192, messages, stream: true, ...(sys ? { system: sys } : {}) };
  if (o.temperature !== undefined) body.temperature = Math.min(1, o.temperature);
  if (o.tools?.length) body.tools = o.tools.map((t) => ({ name: t.function.name, description: t.function.description, input_schema: t.function.parameters }));
  const r = await fetch(`${trimSlash(p.base_url)}/v1/messages`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-api-key": p.api_key, "anthropic-version": "2023-06-01" },
    body: JSON.stringify(body),
    signal: o.signal,
  });
  if (!r.ok || !r.body) throw new Error(`${p.name} ${r.status} (${o.model}) : ${(await r.text()).slice(0, 400)}`);
  let content = "";
  const usage: Usage = { prompt_tokens: 0, completion_tokens: 0 };
  const blocks = new Map<number, { id: string; name: string; json: string }>();
  await readSSE(r.body, (j) => {
    if (j.type === "error") throw new Error(`${p.name} : ${JSON.stringify(j.error).slice(0, 300)}`);
    if (j.type === "message_start") usage.prompt_tokens = contextTokens((j.message as { usage?: ClaudeUsage })?.usage ?? {});
    if (j.type === "message_delta") usage.completion_tokens = Number((j.usage as { output_tokens?: number })?.output_tokens ?? 0);
    if (j.type === "content_block_start") {
      const b = j.content_block as { type: string; id?: string; name?: string };
      if (b.type === "tool_use") blocks.set(Number(j.index), { id: b.id || `call_${newId()}`, name: b.name ?? "", json: "" });
    }
    if (j.type === "content_block_delta") {
      const d = j.delta as { type: string; text?: string; partial_json?: string };
      if (d.type === "text_delta" && d.text) {
        content += d.text;
        o.onText?.(d.text);
      }
      if (d.type === "input_json_delta" && d.partial_json) {
        const b = blocks.get(Number(j.index));
        if (b) b.json += d.partial_json;
      }
    }
  });
  const toolCalls: ToolCall[] = [...blocks.values()].map((b) => ({ id: b.id, type: "function", function: { name: b.name, arguments: b.json || "{}" } }));
  return { content, reasoning: "", toolCalls, usage };
}

// ---------------------------------------------------------------- CLIs (Claude Code, Codex)

/** Tools described in the prompt for engines without a structured tool channel; answers come back as <tool_call> blocks. */
function toolProtocol(tools: ToolDef[]) {
  const list = tools
    .map((t) => {
      const props = (t.function.parameters as { properties?: Record<string, { description?: string; type?: string }> }).properties ?? {};
      const args = Object.entries(props)
        .map(([k, v]) => `${k}${v.description ? ` (${v.description})` : ""}`)
        .join(", ");
      return `- ${t.function.name} : ${t.function.description}${args ? ` — arguments : ${args}` : ""}`;
    })
    .join("\n");
  return `## Outils
Tu disposes de ces outils, exécutés par Millikin (tu n'as pas d'autre accès au système) :
${list}

Pour utiliser un ou plusieurs outils, réponds UNIQUEMENT avec des blocs de cette forme exacte (JSON valide), sans autre texte :
<tool_call>{"name": "nom_de_l_outil", "arguments": {"argument": "valeur"}}</tool_call>
Puis ARRÊTE-TOI : Millikin exécute les outils et te renvoie leurs résultats. N'écris jamais toi-même un résultat d'outil.
Quand tu n'as plus besoin d'outil, donne ta réponse finale (compte rendu) en texte normal, sans bloc d'appel.`;
}

/** Flatten a chat history into one prompt (CLIs take a single input). */
function transcript(messages: ChatMessage[]) {
  const names = new Map<string, string>();
  const parts: string[] = [];
  for (const m of messages) {
    if (m.role === "system") continue;
    if (m.role === "user") parts.push(`### Utilisateur\n${m.content}`);
    if (m.role === "assistant") {
      for (const tc of m.tool_calls ?? []) names.set(tc.id, tc.function.name);
      const calls = (m.tool_calls ?? []).map((tc) => `<tool_call>{"name": ${JSON.stringify(tc.function.name)}, "arguments": ${tc.function.arguments || "{}"}}</tool_call>`).join("\n");
      parts.push(`### Toi (assistant)\n${[m.content, calls].filter(Boolean).join("\n")}`);
    }
    if (m.role === "tool") parts.push(`### Résultat de l'outil ${names.get(m.tool_call_id) ?? ""}\n${m.content}`);
  }
  return parts.join("\n\n") + "\n\n### Toi (assistant)\n";
}

/** Hard limits per CLI call: a stuck or runaway generation must not freeze a task. */
// A long answer (a whole file) can take several minutes: only silence or a very long run means it is stuck.
const CLI_IDLE_MS = 3 * 60_000;
const CLI_TIMEOUT_MS = 15 * 60_000;
const CLI_MAX_CHARS = 60_000;

/**
 * Run a CLI and stream its stdout lines. `control.stop()` ends it early on purpose (the answer is
 * complete): the call then resolves normally. A timeout (no output for CLI_IDLE_MS, or CLI_TIMEOUT_MS in all) rejects.
 * `describe` turns the last stdout lines into an error detail when the CLI exits with an error.
 */
function runCli(
  cmd: string,
  args: string[],
  input: string,
  signal: AbortSignal | undefined,
  onLine: (line: string) => void,
  control: { stop?: () => void } = {},
  describe?: (lastLines: string[]) => string,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { stdio: ["pipe", "pipe", "pipe"], env: process.env });
    let err = "";
    let buf = "";
    let stopped = false;
    let timedOut: "" | "idle" | "total" = "";
    const tail: string[] = [];
    const abort = () => child.kill("SIGTERM");
    signal?.addEventListener("abort", abort);
    control.stop = () => {
      stopped = true;
      child.kill("SIGTERM");
    };
    const timer = setTimeout(() => {
      timedOut = "total";
      child.kill("SIGTERM");
    }, CLI_TIMEOUT_MS);
    let idle = setTimeout(() => ((timedOut = "idle"), child.kill("SIGTERM")), CLI_IDLE_MS);
    child.stdout.on("data", (d: Buffer) => {
      clearTimeout(idle);
      idle = setTimeout(() => ((timedOut = "idle"), child.kill("SIGTERM")), CLI_IDLE_MS);
      buf += d.toString("utf8");
      let nl: number;
      while ((nl = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, nl);
        buf = buf.slice(nl + 1);
        if (!line.trim()) continue;
        tail.push(line);
        if (tail.length > 5) tail.shift();
        try {
          onLine(line);
        } catch {}
      }
    });
    child.stderr.on("data", (d: Buffer) => (err += d.toString("utf8")));
    child.on("error", (e) => reject(new Error(`${cmd} introuvable ou impossible à lancer : ${e.message}`)));
    child.on("close", (code) => {
      clearTimeout(timer);
      clearTimeout(idle);
      signal?.removeEventListener("abort", abort);
      if (buf.trim() && !stopped) onLine(buf);
      if (signal?.aborted) reject(new Error("Arrêté"));
      else if (stopped) resolve();
      else if (timedOut === "idle") reject(new Error(`${cmd} : aucune sortie depuis ${CLI_IDLE_MS / 60_000} min`));
      else if (timedOut) reject(new Error(`${cmd} : pas de réponse complète après ${CLI_TIMEOUT_MS / 60_000} min`));
      else if (code !== 0) reject(new Error(`${cmd} a échoué (code ${code}) : ${err.trim().slice(-400) || describe?.(tail) || tail.join(" ").slice(-400) || "aucun détail"}`));
      else resolve();
    });
    child.stdin.end(input);
  });
}

/**
 * Stream text but hold it back once a <tool_call> starts, so raw calls never reach the screen. Text
 * engines tend to keep going after a tool call (inventing its result, the next turns…): as soon as
 * something other than another call follows a complete call, or the answer grows past the limit,
 * `onDone` fires so the caller can stop the generation; the text is cut at that point.
 */
function textGate(onText?: (t: string) => void, onDone?: () => void) {
  let shown = "";
  let all = "";
  let done = false;
  return {
    push(t: string) {
      if (done) return;
      all += t;
      const end = lastCallEnd(all);
      // Whitespace or the start of another call may follow a call; anything else is the model writing past it.
      // Past MAX_CALLS_PER_ANSWER calls the model is looping: stop there too.
      if (end >= 0 && (!onlyMoreCalls(all.slice(end)) || countCalls(all) >= MAX_CALLS_PER_ANSWER)) {
        all = all.slice(0, end);
        done = true;
        onDone?.();
      }
      if (!done && all.length > CLI_MAX_CHARS) {
        done = true;
        onDone?.();
      }
      const cut = all.search(CALL_OPEN);
      const visible = cut >= 0 ? all.slice(0, cut) : all.replace(/<[^>]{0,16}$/, "");
      if (visible.length > shown.length) {
        onText?.(visible.slice(shown.length));
        shown = visible;
      }
    },
    get text() {
      return all;
    },
  };
}

type ClaudeUsage = { input_tokens?: number; cache_creation_input_tokens?: number; cache_read_input_tokens?: number; output_tokens?: number };
/** Claude Code caches the conversation: the input is mostly in the cache fields, input_tokens alone is only the new part. */
const contextTokens = (u: ClaudeUsage) => (u.input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0);

export async function cliChat(p: Provider, o: ChatOpts): Promise<StreamResult> {
  const type = p.type as ProviderType;
  const system = o.messages.filter((m) => m.role === "system").map((m) => m.content).join("\n\n");
  const extra = [o.tools?.length ? toolProtocol(o.tools) : "", o.schema || o.json ? `Réponds uniquement avec un objet JSON valide${o.schema ? ` conforme à ce schéma : ${JSON.stringify(o.schema)}` : ""}, sans texte autour.` : ""]
    .filter(Boolean)
    .join("\n\n");
  const sys = [system, extra].filter(Boolean).join("\n\n");
  const control: { stop?: () => void } = {};
  const gate = textGate(o.onText, () => control.stop?.());
  const usage: Usage = { prompt_tokens: 0, completion_tokens: 0 };
  const cmd = p.base_url || (type === "codex" ? "codex" : "claude");

  if (type === "claude-code") {
    // Text engine only: no built-in tools, no MCP, no user settings, no saved session.
    const args = ["-p", "--output-format", "stream-json", "--verbose", "--include-partial-messages", "--model", o.model, "--tools", "", "--no-session-persistence", "--strict-mcp-config", "--setting-sources", ""];
    if (sys) args.push("--system-prompt", sys);
    let finalText = "";
    let failure = "";
    await runCli(cmd, args, transcript(o.messages), o.signal, (line) => {
      let e: Record<string, unknown>;
      try {
        e = JSON.parse(line);
      } catch {
        return;
      }
      const ev = e.event as { type?: string; delta?: { type?: string; text?: string }; message?: { usage?: ClaudeUsage } } | undefined;
      if (e.type === "stream_event" && ev?.type === "content_block_delta" && ev.delta?.type === "text_delta" && ev.delta.text) gate.push(ev.delta.text);
      // The context size is known from the start: kept even when the generation is stopped early.
      if (e.type === "stream_event" && ev?.type === "message_start" && ev.message?.usage) usage.prompt_tokens = contextTokens(ev.message.usage);
      if (e.type === "result") {
        if (e.is_error) failure = `Claude Code : ${String(e.result ?? e.subtype).slice(0, 300)}`;
        finalText = String(e.result ?? "");
        const u = e.usage as ClaudeUsage | undefined;
        if (u) usage.prompt_tokens = contextTokens(u);
        usage.completion_tokens = u?.output_tokens ?? 0;
      }
    }, control, () => failure);
    if (failure && !gate.text) throw new Error(failure);
    if (!gate.text && finalText) gate.push(finalText);
  } else {
    // Codex: non-interactive, read-only sandbox, JSON events; the final agent message is the answer.
    const args = ["exec", "--json", "--skip-git-repo-check", "--sandbox", "read-only", "--model", o.model, "-"];
    await runCli(cmd, args, `${sys ? `${sys}\n\n` : ""}${transcript(o.messages)}`, o.signal, (line) => {
      let e: Record<string, unknown>;
      try {
        e = JSON.parse(line);
      } catch {
        return;
      }
      const item = (e.item ?? (e.msg as Record<string, unknown> | undefined)) as { type?: string; text?: string; message?: string } | undefined;
      if ((e.type === "item.completed" && item?.type === "agent_message") || item?.type === "agent_message") gate.push((item.text ?? item.message ?? "") + "\n");
      const u = e.usage as { input_tokens?: number; output_tokens?: number } | undefined;
      if (u) Object.assign(usage, { prompt_tokens: u.input_tokens ?? 0, completion_tokens: u.output_tokens ?? 0 });
    }, control);
  }
  // A call stopped early has no final usage report: estimate the output from its length.
  if (!usage.completion_tokens && gate.text) usage.completion_tokens = Math.round(gate.text.length / 4);
  return { content: gate.text.trim(), reasoning: "", toolCalls: [], usage };
}

// ---------------------------------------------------------------- discovery

/** Models a non-Ollama provider offers: listed by the API when possible, else the preset's list. */
export async function listProviderModels(p: Provider): Promise<{ model: string; kind: "chat" | "embedding" }[]> {
  const type = p.type as ProviderType;
  if (type === "claude-code" || type === "codex") {
    const preset = Object.values(PROVIDER_PRESETS).find((x) => x.type === type);
    return (preset?.models ?? []).map((model) => ({ model, kind: "chat" }));
  }
  const url = type === "anthropic" ? `${trimSlash(p.base_url)}/v1/models` : `${trimSlash(p.base_url)}/models`;
  const headers: Record<string, string> = type === "anthropic" ? { "x-api-key": p.api_key, "anthropic-version": "2023-06-01" } : p.api_key ? { authorization: `Bearer ${p.api_key}` } : {};
  const r = await fetch(url, { headers, signal: AbortSignal.timeout(8000) });
  if (!r.ok) throw new Error(`${p.name} ${r.status} : ${(await r.text()).slice(0, 300)}`);
  const ids = ((await r.json()) as { data?: { id: string }[] }).data?.map((m) => m.id) ?? [];
  return ids.map((model) => ({ model, kind: /embed/i.test(model) ? "embedding" : "chat" }));
}

/** Is the CLI of a CLI provider installed? */
export async function cliAvailable(cmd: string): Promise<string | null> {
  return new Promise((resolve) => {
    const child = spawn(cmd, ["--version"], { stdio: ["ignore", "pipe", "ignore"] });
    let out = "";
    child.stdout.on("data", (d: Buffer) => (out += d.toString()));
    child.on("error", () => resolve(null));
    child.on("close", (code) => resolve(code === 0 ? out.trim().split("\n")[0] || "ok" : null));
  });
}
