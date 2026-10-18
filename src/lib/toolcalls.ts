// Tool calls written as text, for engines without a structured tool channel (Claude Code / Codex
// CLIs) and small local models that slip. Accepted forms:
//   <tool_call>{"name": "x", "arguments": {...}}</tool_call>   (any tag name: <get_tool_call>, <get_file>, <call>…)
//   <invoke name="x"><parameter name="k">v</parameter></invoke>  (Claude's native format, optionally in <function_calls>)
// A JSON call ends where its JSON object ends (braces counted outside strings), never at the first "}</…>":
// file contents often hold HTML or templates such as "%{x}</b>".
import { newId } from "./db";

export type TextToolCall = { id: string; type: "function"; function: { name: string; arguments: string } };

/** Where a call starts (to hide raw calls from the screen). */
export const CALL_OPEN = /<(?:tool_call|get_tool_call|tool_use|function_calls|invoke\s)|<[a-z_][\w-]*>\s*\{\s*"name"\s*:/;
const JSON_OPEN = /<([a-z_][\w-]*)>\s*(?=\{\s*"name"\s*:)/g;
const INVOKE_BLOCK = /<invoke\s+name="([^"]+)"\s*>([\s\S]*?)<\/invoke>/g;
const INVOKE_OPEN = /<invoke\s+name="/g;
const PARAM = /<parameter\s+name="([^"]+)"\s*>([\s\S]*?)<\/parameter>/g;

/** At most this many calls are taken from one answer (models sometimes repeat a call dozens of times). */
export const MAX_CALLS_PER_ANSWER = 12;

/** Index just after the JSON object starting at `from` ("{"), or -1 if the text ends first. */
function jsonEnd(text: string, from: number): number {
  let depth = 0;
  let inString = false;
  for (let i = from; i < text.length; i++) {
    const c = text[i];
    if (inString) {
      if (c === "\\") i++;
      else if (c === '"') inString = false;
    } else if (c === '"') inString = true;
    else if (c === "{") depth++;
    else if (c === "}" && --depth === 0) return i + 1;
  }
  return -1;
}

type Block = { start: number; end: number; json?: string; name?: string; body?: string; complete: boolean };

/** Every call block in `text`, in order: JSON calls (any tag) and <invoke> calls. Incomplete = cut before its end. */
function blocks(text: string): Block[] {
  const out: Block[] = [];
  for (const m of text.matchAll(JSON_OPEN)) {
    const brace = m.index + m[0].length;
    if (out.some((b) => brace >= b.start && brace < b.end)) continue;
    const e = jsonEnd(text, brace);
    if (e < 0) {
      out.push({ start: m.index, end: text.length, complete: false });
      break;
    }
    // The closing tag may differ from the opening one (<get_tool_call>…</tool_call>) or be missing.
    const close = text.slice(e).match(/^\s*(?:<\/[a-z_][\w-]*>)?/);
    out.push({ start: m.index, end: e + (close?.[0].length ?? 0), json: text.slice(brace, e), complete: true });
  }
  for (const m of text.matchAll(INVOKE_BLOCK)) out.push({ start: m.index, end: m.index + m[0].length, name: m[1], body: m[2], complete: true });
  // An <invoke> still being written (no closing tag yet).
  for (const m of text.matchAll(INVOKE_OPEN)) if (!out.some((b) => m.index >= b.start && m.index < b.end)) out.push({ start: m.index, end: text.length, complete: false });
  return out.sort((a, b) => a.start - b.start);
}

/** Number of complete calls in `text`. */
export const countCalls = (text: string) => blocks(text).filter((b) => b.complete).length;

/** End of the last complete call in `text` (-1 if none). */
export function lastCallEnd(text: string) {
  const done = blocks(text).filter((b) => b.complete);
  if (!done.length) return -1;
  let end = done[done.length - 1].end;
  const close = text.slice(end).match(/^\s*<\/function_calls>/);
  if (close) end += close[0].length;
  return end;
}

/** Does the text end with a call that was cut off (its JSON or <invoke> never closed)? */
export const hasIncompleteCall = (text: string) => blocks(text).some((b) => !b.complete);

/** Does `rest` (what follows a complete call) only continue with more calls? */
export const onlyMoreCalls = (rest: string) => {
  const r = rest.trimStart();
  return !r || CALL_OPEN.test(r.slice(0, 40)) || /^<\/function_calls>/.test(r) || /^<[a-z_][\w-]*>?\s*\{?\s*"?n?a?m?e?"?$/.test(r) || "<invoke ".startsWith(r.slice(0, 8)) || "<function_calls>".startsWith(r.slice(0, 16));
};

const paramValue = (raw: string): unknown => {
  const v = raw.trim();
  if (/^(?:-?\d+(?:\.\d+)?|true|false|null)$/.test(v) || /^[[{]/.test(v)) {
    try {
      return JSON.parse(v);
    } catch {}
  }
  return raw.replace(/^\n/, "").replace(/\n$/, "");
};

/** Turn text tool calls into real calls (known tools only) and return the remaining text. */
export function extractTextToolCalls(content: string, toolNames: string[]): { calls: TextToolCall[]; rest: string } {
  const calls: TextToolCall[] = [];
  const seen = new Set<string>();
  // Identical calls are run once, and only the first MAX_CALLS_PER_ANSWER are kept.
  const push = (name: string, args: unknown) => {
    const a = typeof args === "string" ? args : JSON.stringify(args ?? {});
    if (seen.has(name + a) || calls.length >= MAX_CALLS_PER_ANSWER) return;
    seen.add(name + a);
    calls.push({ id: `call_${newId()}`, type: "function", function: { name, arguments: a } });
  };
  let rest = "";
  let at = 0;
  for (const b of blocks(content)) {
    if (!b.complete) continue;
    let used = false;
    if (b.json) {
      try {
        const j = JSON.parse(b.json) as { name?: string; arguments?: unknown; input?: unknown };
        if (j.name && toolNames.includes(j.name)) {
          push(j.name, j.arguments ?? j.input ?? {});
          used = true;
        }
      } catch {}
    } else if (b.name && toolNames.includes(b.name)) {
      const args: Record<string, unknown> = {};
      for (const p of (b.body ?? "").matchAll(PARAM)) args[p[1]] = paramValue(p[2]);
      push(b.name, args);
      used = true;
    }
    if (used) {
      rest += content.slice(at, b.start);
      at = b.end;
    }
  }
  rest += content.slice(at);
  if (calls.length) rest = rest.replace(/<\/?function_calls>/g, "");
  return { calls, rest: rest.trim() };
}

/** Text without any raw call blocks, complete or cut off (a final answer must not be a call). */
export function stripTextToolCalls(text: string) {
  let out = "";
  let at = 0;
  for (const b of blocks(text)) {
    out += text.slice(at, b.start);
    at = b.end;
  }
  return (out + text.slice(at)).replace(/<\/?function_calls>/g, "").trim();
}
