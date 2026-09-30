// Shared (client + server) shape of a run: one node per agent invocation.

export type TraceEvent =
  | { type: "conversation"; conversationId: string; userMessageId: string; runId?: string }
  | { type: "snapshot"; trace: Trace }
  | { type: "agent_start"; callId: string; agentId: string; parentCallId: string | null; viaToolCallId?: string; input: string }
  | { type: "text"; callId: string; text: string }
  | { type: "reasoning"; callId: string; text: string }
  | { type: "tool_call"; callId: string; toolCallId: string; name: string; args: unknown }
  | { type: "tool_result"; callId: string; toolCallId: string; result: string; error?: boolean }
  | { type: "agent_end"; callId: string; content: string }
  | { type: "error"; callId?: string; message: string }
  | { type: "done"; messageId: string };

export type ToolUse = { id: string; name: string; args: unknown; result?: string; error?: boolean; childCallId?: string };

export type CallNode = {
  callId: string;
  agentId: string;
  parentCallId: string | null;
  input: string;
  text: string;
  reasoning: string;
  status: "thinking" | "streaming" | "tool" | "waiting" | "done" | "error";
  tools: ToolUse[];
  startedAt: number;
  endedAt?: number;
  error?: string;
};

export type Trace = { calls: Record<string, CallNode>; order: string[]; error?: string };

export const emptyTrace = (): Trace => ({ calls: {}, order: [] });

export function applyEvent(t: Trace, ev: TraceEvent): Trace {
  const calls = { ...t.calls };
  const patch = (id: string, f: (c: CallNode) => CallNode) => {
    if (calls[id]) calls[id] = f(calls[id]);
  };
  switch (ev.type) {
    case "snapshot":
      return ev.trace;
    case "agent_start": {
      calls[ev.callId] = {
        callId: ev.callId,
        agentId: ev.agentId,
        parentCallId: ev.parentCallId,
        input: ev.input,
        text: "",
        reasoning: "",
        status: "thinking",
        tools: [],
        startedAt: Date.now(),
      };
      if (ev.parentCallId && ev.viaToolCallId)
        patch(ev.parentCallId, (c) => ({
          ...c,
          status: "waiting",
          tools: c.tools.map((x) => (x.id === ev.viaToolCallId ? { ...x, childCallId: ev.callId } : x)),
        }));
      return { ...t, calls, order: [...t.order, ev.callId] };
    }
    case "text":
      patch(ev.callId, (c) => ({ ...c, text: c.text + ev.text, status: "streaming" }));
      break;
    case "reasoning":
      patch(ev.callId, (c) => ({ ...c, reasoning: c.reasoning + ev.text }));
      break;
    case "tool_call":
      patch(ev.callId, (c) => ({
        ...c,
        status: ev.name === "ask_agent" ? "waiting" : "tool",
        tools: [...c.tools, { id: ev.toolCallId, name: ev.name, args: ev.args }],
      }));
      break;
    case "tool_result":
      patch(ev.callId, (c) => {
        const tools = c.tools.map((x) => (x.id === ev.toolCallId ? { ...x, result: ev.result, error: ev.error } : x));
        return { ...c, tools, status: tools.some((x) => x.result === undefined) ? c.status : "thinking" };
      });
      break;
    case "agent_end":
      patch(ev.callId, (c) => ({ ...c, text: ev.content, status: "done", endedAt: Date.now() }));
      break;
    case "error":
      if (ev.callId) patch(ev.callId, (c) => ({ ...c, status: "error", error: ev.message, endedAt: Date.now() }));
      else return { ...t, calls, error: ev.message };
      break;
    default:
      return t;
  }
  return { ...t, calls };
}

export const rootCall = (t: Trace) => t.order.map((id) => t.calls[id]).find((c) => c && !c.parentCallId);
export const childrenOf = (t: Trace, callId: string) => t.order.map((id) => t.calls[id]).filter((c) => c?.parentCallId === callId);
