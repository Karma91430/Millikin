// Tool calls written as text, for engines without a structured tool channel (Claude Code / Codex
// CLIs) and small local models that slip. Accepted forms:
//   <tool_call>{"name": "x", "arguments": {...}}</tool_call>   (and <get_tool_call>, <tool_use>)
//   <invoke name="x"><parameter name="k">v</parameter></invoke>  (Claude's native format, optionally in <function_calls>)
import { newId } from "./db";

export type TextToolCall = { id: string; type: "function"; function: { name: string; arguments: string } };

/** Where a call starts (to hide raw calls from the screen) and how one ends (to stop runaway generations). */
export const CALL_OPEN = /<(?:tool_call|get_tool_call|tool_use|function_calls|invoke\s)/;
const CALL_CLOSE = /<\/(?:tool_call|get_tool_call|tool_use|invoke|function_calls)>/g;
const JSON_BLOCK = /<(tool_call|get_tool_call|tool_use)>\s*(\{[\s\S]*?\})\s*(?:<\/\1>|$)/g;
const INVOKE_BLOCK = /<invoke\s+name="([^"]+)"\s*>([\s\S]*?)(?:<\/invoke>|$)/g;
const PARAM = /<parameter\s+name="([^"]+)"\s*>([\s\S]*?)<\/parameter>/g;

/** At most this many calls are taken from one answer (models sometimes repeat a call dozens of times). */
export const MAX_CALLS_PER_ANSWER = 12;

/** Number of complete calls in `text`. */
export const countCalls = (text: string) => [...text.matchAll(CALL_CLOSE)].length;

/** End of the last complete call in `text` (-1 if none). */
export function lastCallEnd(text: string) {
  let end = -1;
  for (const m of text.matchAll(CALL_CLOSE)) end = m.index + m[0].length;
  return end;
}

/** Does `rest` (what follows a complete call) only continue with more calls? */
export const onlyMoreCalls = (rest: string) => {
  const r = rest.trimStart();
  return !r || CALL_OPEN.test(r.slice(0, 20)) || /^<\/function_calls>/.test(r) || "<tool_call>".startsWith(r.slice(0, 11)) || "<invoke ".startsWith(r.slice(0, 8)) || "<function_calls>".startsWith(r.slice(0, 16));
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
  let rest = content.replace(JSON_BLOCK, (block, _tag: string, json: string) => {
    try {
      const j = JSON.parse(json) as { name?: string; arguments?: unknown; input?: unknown };
      if (!j.name || !toolNames.includes(j.name)) return block;
      push(j.name, j.arguments ?? j.input ?? {});
      return "";
    } catch {
      return block;
    }
  });
  rest = rest.replace(INVOKE_BLOCK, (block, name: string, body: string) => {
    if (!toolNames.includes(name)) return block;
    const args: Record<string, unknown> = {};
    for (const p of body.matchAll(PARAM)) args[p[1]] = paramValue(p[2]);
    push(name, args);
    return "";
  });
  if (calls.length) rest = rest.replace(/<\/?function_calls>/g, "");
  return { calls, rest: rest.trim() };
}

/** Text without any raw call blocks (a final answer must not be a call). */
export const stripTextToolCalls = (text: string) =>
  text
    .replace(JSON_BLOCK, "")
    .replace(INVOKE_BLOCK, "")
    .replace(/<\/?function_calls>/g, "")
    .trim();
