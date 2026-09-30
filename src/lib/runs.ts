// Server-side run registry: a chat turn keeps running when the browser leaves the page.
// Clients (re)attach with a snapshot of the trace, then receive live events.
import { applyEvent, emptyTrace, type Trace, type TraceEvent } from "./trace";

export type RunStatus = "running" | "done" | "error" | "stopped";

export type Run = {
  id: string;
  conversationId: string;
  targetType: "project" | "agent" | "task";
  targetId: string;
  title: string;
  userMessage: string;
  startedAt: number;
  endedAt?: number;
  status: RunStatus;
  trace: Trace;
  controller: AbortController;
  listeners: Set<(ev: TraceEvent) => void>;
};

export type RunInfo = Omit<Run, "trace" | "controller" | "listeners">;

const KEEP_FINISHED_MS = 10 * 60_000;
const g = globalThis as unknown as { __millikinRuns?: Map<string, Run> };
const runs = (g.__millikinRuns ??= new Map());

export const info = ({ trace: _t, controller: _c, listeners: _l, ...rest }: Run): RunInfo => (void _t, void _c, void _l, rest);

export function listRuns(): RunInfo[] {
  const now = Date.now();
  for (const [id, r] of runs) if (r.endedAt && now - r.endedAt > KEEP_FINISHED_MS) runs.delete(id);
  return [...runs.values()].map(info).sort((a, b) => b.startedAt - a.startedAt);
}

export const getRun = (id: string) => runs.get(id);
export const activeRunFor = (conversationId: string) => [...runs.values()].find((r) => r.conversationId === conversationId && r.status === "running");

/** Register a run and execute it in the background. `exec` must emit its events through `emit`. */
export function startRun(
  meta: Pick<Run, "id" | "conversationId" | "targetType" | "targetId" | "title" | "userMessage">,
  exec: (emit: (ev: TraceEvent) => void, signal: AbortSignal, run: Run) => Promise<void>,
): Run {
  const run: Run = { ...meta, startedAt: Date.now(), status: "running", trace: emptyTrace(), controller: new AbortController(), listeners: new Set() };
  runs.set(run.id, run);
  const emit = (ev: TraceEvent) => {
    if (ev.type !== "conversation" && ev.type !== "done" && ev.type !== "snapshot") run.trace = applyEvent(run.trace, ev);
    if (ev.type === "done") {
      run.endedAt = Date.now();
      if (run.status === "running") run.status = run.trace.error ? "error" : "done";
    }
    for (const l of run.listeners) l(ev);
  };
  exec(emit, run.controller.signal, run).catch((e) => {
    run.status = "error";
    emit({ type: "error", message: e instanceof Error ? e.message : String(e) });
    emit({ type: "done", messageId: "" });
  });
  return run;
}

export function stopRun(id: string) {
  const r = runs.get(id);
  if (r?.status === "running") {
    r.status = "stopped";
    r.controller.abort();
  }
  return !!r;
}

/** SSE stream for a run: conversation info + snapshot first, then live events until the run ends. */
export function streamRun(run: Run): Response {
  const enc = new TextEncoder();
  let listener: ((ev: TraceEvent) => void) | undefined;
  const stream = new ReadableStream({
    start(controller) {
      const send = (ev: TraceEvent) => {
        try {
          controller.enqueue(enc.encode(`data: ${JSON.stringify(ev)}\n\n`));
        } catch {
          if (listener) run.listeners.delete(listener);
        }
      };
      send({ type: "conversation", conversationId: run.conversationId, userMessageId: "", runId: run.id });
      send({ type: "snapshot", trace: run.trace });
      if (run.status !== "running") {
        send({ type: "done", messageId: "" });
        controller.close();
        return;
      }
      listener = (ev) => {
        send(ev);
        if (ev.type === "done") {
          run.listeners.delete(listener!);
          try {
            controller.close();
          } catch {}
        }
      };
      run.listeners.add(listener);
    },
    // Browser left: stop streaming to it, but let the run continue.
    cancel() {
      if (listener) run.listeners.delete(listener);
    },
  });
  return new Response(stream, {
    headers: { "content-type": "text/event-stream; charset=utf-8", "cache-control": "no-cache, no-transform", connection: "keep-alive" },
  });
}
