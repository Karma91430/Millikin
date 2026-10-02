"use client";

import { ArrowDownToLine, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useT } from "@/i18n";
import { childrenOf, type Trace } from "@/lib/trace";
import type { Agent } from "../api";
import { Avatar, Button, cx, Markdown } from "../ui";
import { Reasoning, ToolChip } from "./Thread";

const STATUS: Record<string, string> = {
  thinking: "réfléchit…",
  streaming: "écrit…",
  tool: "utilise un outil…",
  waiting: "attend un coéquipier…",
  done: "terminé",
  error: "erreur",
};

/** Large live view of one agent call; keeps following the stream while the user reads. */
export function CallFocus({ trace, callId, agents, onClose, onFocus }: { trace: Trace; callId: string; agents: Map<string, Agent>; onClose: () => void; onFocus: (id: string) => void }) {
  const { t } = useT();
  const call = trace.calls[callId];
  const agent = call ? agents.get(call.agentId) : undefined;
  const parent = call?.parentCallId ? trace.calls[call.parentCallId] : undefined;
  const caller = parent ? agents.get(parent.agentId) : undefined;
  const scroller = useRef<HTMLDivElement>(null);
  const [follow, setFollow] = useState(true);
  const live = !!call && !["done", "error"].includes(call.status);
  // Elapsed-time clock, ticking only while the call runs.
  const [clock, setClock] = useState(() => Date.now());
  useEffect(() => {
    if (!live) return;
    const timer = setInterval(() => setClock(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [live]);

  // Stick to the bottom while text streams, unless the user scrolled up to re-read.
  useEffect(() => {
    if (follow && scroller.current) scroller.current.scrollTop = scroller.current.scrollHeight;
  }, [call?.text, call?.tools.length, follow]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  if (!call || !agent) return null;
  const secs = Math.max(0, Math.round(((call.endedAt ?? clock) - call.startedAt) / 1000));
  const children = childrenOf(trace, call.callId);

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/40 backdrop-blur-[1px]" onMouseDown={onClose}>
      <div className="flex h-full w-full max-w-4xl flex-col border-l border-line bg-surface-0 shadow-2xl" onMouseDown={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-3 border-b border-line px-5 py-3" style={{ boxShadow: `inset 0 -2px 0 ${agent.color}55` }}>
          <Avatar emoji={agent.emoji} color={agent.color} size={36} />
          <div className="min-w-0 flex-1">
            <div className="font-semibold">{agent.name}</div>
            <div className="flex items-center gap-1.5 text-xs" style={{ color: live ? agent.color : "var(--fg-muted)" }}>
              {live && <span className="h-1.5 w-1.5 animate-pulse rounded-full" style={{ background: agent.color }} />}
              {STATUS[call.status] ? t(STATUS[call.status]) : call.status} · {secs}s
            </div>
          </div>
          {!follow && (
            <Button size="sm" variant="soft" onClick={() => setFollow(true)}>
              <ArrowDownToLine size={13} /> {t("Suivre")}
            </Button>
          )}
          <Button variant="ghost" size="sm" onClick={onClose} aria-label={t("Fermer")}>
            <X size={16} />
          </Button>
        </div>

        <div
          ref={scroller}
          onScroll={(e) => {
            const el = e.currentTarget;
            setFollow(el.scrollHeight - el.scrollTop - el.clientHeight < 40);
          }}
          className="flex-1 space-y-5 overflow-y-auto px-6 py-5"
        >
          <section>
            <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-fg-subtle">
              {caller ? t("Demande de {name}", { name: caller.name }) : t("Demande de l'utilisateur")}
            </div>
            <div className="whitespace-pre-wrap rounded-xl px-4 py-3 text-sm" style={{ background: `${(caller ?? agent).color}1a` }}>
              {call.input}
            </div>
          </section>

          {call.reasoning && <Reasoning text={call.reasoning} live={live && !call.text} />}

          {call.tools.some((t) => t.name !== "ask_agent") && (
            <section>
              <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-fg-subtle">{t("Outils")}</div>
              <div className="flex flex-col gap-1.5">
                {call.tools
                  .filter((t) => t.name !== "ask_agent")
                  .map((t) => (
                    <ToolChip key={t.id} t={t} />
                  ))}
              </div>
            </section>
          )}

          {children.length > 0 && (
            <section>
              <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-fg-subtle">{t("Délégations")}</div>
              <div className="flex flex-wrap gap-2">
                {children.map((c) => {
                  const a = agents.get(c.agentId);
                  const cl = !["done", "error"].includes(c.status);
                  return (
                    <button
                      key={c.callId}
                      onClick={() => onFocus(c.callId)}
                      className="flex items-center gap-2 rounded-lg border bg-surface-1 px-2.5 py-1.5 text-xs hover:bg-surface-2"
                      style={{ borderColor: `${a?.color ?? "#888"}55` }}
                    >
                      <span>{a?.emoji}</span>
                      <span className="font-medium">{a?.name}</span>
                      <span className={cx("text-fg-subtle", cl && "animate-pulse")}>{cl ? t("en cours") : t("voir")}</span>
                    </button>
                  );
                })}
              </div>
            </section>
          )}

          <section>
            <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-fg-subtle">{t("Réponse")}</div>
            {call.status === "error" ? (
              <div className="text-sm text-red-400">⚠️ {call.error}</div>
            ) : call.text ? (
              <div className="rounded-xl border border-line bg-surface-1 px-5 py-4">
                <Markdown className={cx("text-[15px]", live && "caret")}>{call.text}</Markdown>
              </div>
            ) : (
              <div className="text-sm text-fg-subtle">{live ? t("La réponse s'affichera ici dès les premiers mots…") : t("(pas de texte)")}</div>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}
