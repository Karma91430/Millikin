"use client";

import { useEffect, useState } from "react";
import { applyEvent, emptyTrace, type Trace, type TraceEvent } from "@/lib/trace";

/** Call onEvent for each SSE event of a run stream. */
export async function readRunStream(res: Response, onEvent: (ev: TraceEvent) => void) {
  const reader = res.body!.getReader();
  const dec = new TextDecoder();
  let buf = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let i: number;
    while ((i = buf.indexOf("\n\n")) >= 0) {
      const chunk = buf.slice(0, i).trim();
      buf = buf.slice(i + 2);
      if (chunk.startsWith("data:")) onEvent(JSON.parse(chunk.slice(5)) as TraceEvent);
    }
  }
}

/** Live trace of the active run attached to `key` (a conversation id, or `task:<id>`), while `active`. */
export function useRunTrace(key: string | null, active: boolean): Trace | null {
  const [trace, setTrace] = useState<{ key: string; trace: Trace } | null>(null);
  useEffect(() => {
    if (!key || !active) return;
    const ctrl = new AbortController();
    (async () => {
      const res = await fetch(`/api/runs/stream?conversationId=${encodeURIComponent(key)}`, { signal: ctrl.signal }).catch(() => null);
      if (!res?.ok || !res.body) return;
      let t = emptyTrace();
      let frame = 0;
      await readRunStream(res, (ev) => {
        if (ev.type === "conversation" || ev.type === "done") return;
        t = applyEvent(t, ev);
        if (!frame)
          frame = requestAnimationFrame(() => {
            frame = 0;
            setTrace({ key, trace: t });
          });
      }).catch(() => {});
    })();
    return () => ctrl.abort();
  }, [key, active]);
  return active && trace?.key === key ? trace.trace : null;
}
