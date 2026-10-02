"use client";

import { Brain, ChevronDown, ChevronRight, Maximize2 } from "lucide-react";
import { useState } from "react";
import { useT } from "@/i18n";
import { childrenOf, type CallNode, type ToolUse, type Trace } from "@/lib/trace";
import type { Agent } from "../api";
import { Avatar, cx, Markdown } from "../ui";

const TOOL_ICON: Record<string, string> = {
  web_search: "🔎",
  fetch_url: "🌐",
  list_files: "📁",
  read_file: "📄",
  write_file: "✍️",
  edit_file: "✏️",
  run_command: "⌨️",
  board_list: "📋",
  board_add_card: "📋",
  board_update_card: "📋",
  search_knowledge: "📚",
};

function argSummary(t: ToolUse) {
  const a = (t.args ?? {}) as Record<string, unknown>;
  const v = a.query ?? a.url ?? a.path ?? a.command ?? a.title ?? a.id ?? Object.values(a)[0];
  return typeof v === "string" ? v : v ? JSON.stringify(v) : "";
}

export function ToolChip({ t }: { t: ToolUse }) {
  const [open, setOpen] = useState(false);
  const pending = t.result === undefined;
  return (
    <div className="text-xs">
      <button
        onClick={() => setOpen(!open)}
        className={cx(
          "inline-flex max-w-full items-center gap-1.5 rounded-lg border px-2 py-1 text-left transition hover:bg-surface-3",
          t.error ? "border-red-500/30 bg-red-500/5" : "border-line bg-surface-2",
        )}
      >
        {open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
        <span>{TOOL_ICON[t.name] ?? "🔧"}</span>
        <span className="font-mono text-[11px] text-fg-muted">{t.name}</span>
        <span className="truncate text-fg">{argSummary(t)}</span>
        {pending && <span className="ml-1 h-1.5 w-1.5 animate-pulse rounded-full bg-accent" />}
      </button>
      {open && (
        <pre className="mt-1 max-h-64 overflow-auto whitespace-pre-wrap rounded-lg border border-line bg-surface-0 p-2 font-mono text-[11px] text-fg-muted">
          {JSON.stringify(t.args, null, 2)}
          {"\n\n"}
          {t.result ?? "…"}
        </pre>
      )}
    </div>
  );
}

export function Reasoning({ text, live }: { text: string; live: boolean }) {
  const { t } = useT();
  const [open, setOpen] = useState(false);
  if (!text.trim()) return null;
  return (
    <div className="text-xs">
      <button onClick={() => setOpen(!open)} className="inline-flex items-center gap-1 text-fg-subtle hover:text-fg-muted">
        <Brain size={12} /> {live ? t("réfléchit…") : t("réflexion")} {open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
      </button>
      {open && <div className="mt-1 max-h-48 overflow-auto whitespace-pre-wrap rounded-lg bg-surface-2 p-2 text-[11px] text-fg-muted">{text}</div>}
    </div>
  );
}

/** Two-party exchange: the caller's question (left) and the callee's answer (right). */
type Expand = (callId: string) => void;

export function ExpandButton({ onClick, title }: { onClick: () => void; title?: string }) {
  const { t } = useT();
  return (
    <span
      role="button"
      tabIndex={0}
      title={title ?? t("Agrandir (suivi en direct)")}
      onClick={(e) => (e.stopPropagation(), onClick())}
      onKeyDown={(e) => e.key === "Enter" && (e.stopPropagation(), onClick())}
      className="inline-flex h-6 w-6 items-center justify-center rounded-md text-fg-subtle hover:bg-surface-3 hover:text-fg"
    >
      <Maximize2 size={12} />
    </span>
  );
}

function Delegation({
  trace,
  call,
  caller,
  agents,
  depth,
  onExpand,
}: {
  trace: Trace;
  call: CallNode;
  caller: Agent;
  agents: Map<string, Agent>;
  depth: number;
  onExpand?: Expand;
}) {
  const { t } = useT();
  const callee = agents.get(call.agentId);
  const [open, setOpen] = useState(true);
  if (!callee) return null;
  const live = !["done", "error"].includes(call.status);
  const secs = call.endedAt ? Math.round((call.endedAt - call.startedAt) / 1000) : null;
  return (
    <div className="pop rounded-xl border bg-surface-1/60" style={{ borderColor: `${callee.color}44` }}>
      <button onClick={() => setOpen(!open)} className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs">
        {open ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
        <span>{caller.emoji}</span>
        <span className="font-medium">{caller.name}</span>
        <span className="text-fg-subtle">→</span>
        <span>{callee.emoji}</span>
        <span className="font-medium" style={{ color: callee.color }}>
          {callee.name}
        </span>
        <span className="ml-auto text-fg-subtle">{live ? t("en cours…") : call.status === "error" ? t("erreur") : secs !== null ? `${secs}s` : ""}</span>
        {onExpand && <ExpandButton onClick={() => onExpand(call.callId)} />}
      </button>
      {open && (
        <div className="flex flex-col gap-2.5 px-3 pb-3">
          <div className="flex items-start gap-2">
            <Avatar emoji={caller.emoji} color={caller.color} size={26} />
            <div className="max-w-[85%] rounded-2xl rounded-tl-sm px-3 py-2 text-[13px]" style={{ background: `${caller.color}1f` }}>
              <div className="whitespace-pre-wrap">{call.input}</div>
            </div>
          </div>
          <div className="flex flex-row-reverse items-start gap-2">
            <Avatar emoji={callee.emoji} color={callee.color} size={26} />
            <div className="flex max-w-[85%] flex-col gap-1.5 rounded-2xl rounded-tr-sm border bg-surface-2 px-3 py-2" style={{ borderColor: `${callee.color}44` }}>
              <Reasoning text={call.reasoning} live={live && !call.text} />
              {call.tools.filter((t) => t.name !== "ask_agent").map((t) => (
                <ToolChip key={t.id} t={t} />
              ))}
              {depth < 3 &&
                childrenOf(trace, call.callId).map((c) => (
                  <Delegation key={c.callId} trace={trace} call={c} caller={callee} agents={agents} depth={depth + 1} onExpand={onExpand} />
                ))}
              {call.status === "error" ? (
                <div className="text-sm text-red-400">⚠️ {call.error}</div>
              ) : call.text ? (
                <Markdown className={cx(live && "caret")}>{call.text}</Markdown>
              ) : live ? (
                <span className="dots text-fg-muted">
                  <span>●</span>
                  <span>●</span>
                  <span>●</span>
                </span>
              ) : null}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/** Assistant turn: delegations and tools first, then the lead's final answer. */
export function AssistantTurn({ trace, agents, fallback, onExpand }: { trace: Trace | null; agents: Map<string, Agent>; fallback?: string; onExpand?: Expand }) {
  const root = trace?.order.map((id) => trace.calls[id]).find((c) => c && !c.parentCallId);
  const lead = root ? agents.get(root.agentId) : undefined;
  if (!trace || !root || !lead) return fallback ? <Markdown>{fallback}</Markdown> : null;
  const live = !["done", "error"].includes(root.status);
  return (
    <div className="flex items-start gap-2.5">
      <Avatar emoji={lead.emoji} color={lead.color} size={30} />
      <div className="flex min-w-0 flex-1 flex-col gap-2">
        <div className="flex items-center gap-1 text-xs font-semibold" style={{ color: lead.color }}>
          {lead.name}
          {onExpand && <ExpandButton onClick={() => onExpand(root.callId)} />}
        </div>
        <Reasoning text={root.reasoning} live={live && !root.text} />
        {root.tools.filter((t) => t.name !== "ask_agent").map((t) => (
          <ToolChip key={t.id} t={t} />
        ))}
        {childrenOf(trace, root.callId).map((c) => (
          <Delegation key={c.callId} trace={trace} call={c} caller={lead} agents={agents} depth={1} onExpand={onExpand} />
        ))}
        {root.status === "error" || trace.error ? (
          <div className="text-sm text-red-400">⚠️ {root.error ?? trace.error}</div>
        ) : root.text ? (
          <div className="rounded-2xl rounded-tl-sm bg-surface-2 px-3.5 py-2.5">
            <Markdown className={cx(live && "caret")}>{root.text}</Markdown>
          </div>
        ) : live ? (
          <span className="dots text-fg-muted">
            <span>●</span>
            <span>●</span>
            <span>●</span>
          </span>
        ) : null}
      </div>
    </div>
  );
}
