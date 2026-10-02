"use client";

import { ArrowDown, CheckCircle2, MessageSquarePlus, PanelLeftClose, PanelLeftOpen, Send, Square, Trash2 } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from "react";
import { specFromTeam } from "@/lib/team";
import { applyEvent, emptyTrace, type Trace, type TraceEvent } from "@/lib/trace";
import { api, useData, type Agent, type Conversation, type Message, type Project, type RunInfo } from "../api";
import { useT } from "@/i18n";
import { Button, cx, Empty, Select } from "../ui";
import { AgentGraph } from "./AgentGraph";
import { CallFocus } from "./CallFocus";
import { AssistantTurn } from "./Thread";

/** planning: start a scoping discussion that ends with the project breakdown into tasks. */
export type Target = { type: "project" | "agent"; id: string; conversationId?: string; planning?: boolean };

type Props = {
  agents: Agent[];
  projects: Project[];
  onNewProject: () => void;
  target: Target | null;
  onTarget: (t: Target) => void;
  /** Conversation currently on screen (lets the app skip "answer ready" toasts for it). */
  viewingRef?: RefObject<string | null>;
  onRunsChanged?: () => void;
};

export function ChatView(props: Props) {
  const { agents, projects, target } = props;
  const { t } = useT();
  const effective = target ?? (projects[0] ? { type: "project" as const, id: projects[0].id } : agents[0] ? { type: "agent" as const, id: agents[0].id } : null);
  if (!effective)
    return (
      <Empty title={t("Aucun agent pour l'instant")} icon={<MessageSquarePlus size={28} />}>
        {t("Crée un projet (à partir d'un modèle d'équipe) ou un agent pour commencer à discuter.")}
      </Empty>
    );
  // One session per target (and per explicitly requested conversation).
  return <ChatSession key={`${effective.type}:${effective.id}:${effective.conversationId ?? ""}:${effective.planning ? "plan" : ""}`} {...props} effective={effective} />;
}

function ChatSession({ agents, projects, onTarget, onNewProject, effective, viewingRef, onRunsChanged }: Props & { effective: Target }) {
  const { t } = useT();
  const agentMap = useMemo(() => new Map(agents.map((a) => [a.id, a])), [agents]);
  const project = effective.type === "project" ? projects.find((p) => p.id === effective.id) : undefined;
  const spec = useMemo(() => (project ? specFromTeam(project.team) : null), [project]);
  const teamAgents = useMemo(
    () => (spec ? spec.agent_ids.map((id) => agentMap.get(id)).filter((a): a is Agent => !!a) : [agentMap.get(effective.id)].filter((a): a is Agent => !!a)),
    [spec, agentMap, effective.id],
  );
  const entries = spec ? spec.entry_ids.filter((id) => agentMap.has(id)) : teamAgents.map((a) => a.id);
  const lead = agentMap.get(entries[0] ?? "");
  const coLeads = entries.slice(1).map((id) => agentMap.get(id)!).filter(Boolean);

  const convs = useData<Conversation[]>(`/api/conversations?targetId=${effective.id}`);
  const [conversationId, setConversationId] = useState<string | null>(effective.conversationId ?? null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [live, setLive] = useState<Trace | null>(null);
  const [pendingUser, setPendingUser] = useState<string | null>(null);
  const [runId, setRunId] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [input, setInput] = useState("");
  const [showList, setShowList] = useState(false);
  const [focus, setFocus] = useState<string | null>(null);
  const streamRef = useRef<AbortController | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  // Auto-scroll only while the reader sits at the bottom; scrolling up pauses it.
  const followRef = useRef(true);
  const [atBottom, setAtBottom] = useState(true);
  const running = sending || !!runId;

  const loadMessages = useCallback(async (id: string) => setMessages(await api<Message[]>(`/api/conversations?id=${id}`)), []);

  useEffect(() => {
    if (viewingRef) viewingRef.current = conversationId;
  }, [conversationId, viewingRef]);

  useEffect(() => {
    if (followRef.current) scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [messages, live, pendingUser]);

  const toBottom = () => {
    followRef.current = true;
    setAtBottom(true);
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  };

  // Grow the composer with its content, up to 40% of the viewport.
  useEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    const max = window.innerHeight * 0.4;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, max)}px`;
    el.style.overflowY = el.scrollHeight > max ? "auto" : "hidden";
  }, [input]);

  /** Read a run's SSE stream into the live trace. Aborting only detaches this view. */
  const consume = useCallback(
    async (res: Response, ctrl: AbortController) => {
      let queue: TraceEvent[] = [];
      let frame = 0;
      let convId: string | null = null;
      const flush = () => {
        frame = 0;
        const batch = queue;
        queue = [];
        if (batch.length) setLive((t) => batch.reduce(applyEvent, t ?? emptyTrace()));
      };
      try {
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
            if (!chunk.startsWith("data:")) continue;
            const ev = JSON.parse(chunk.slice(5)) as TraceEvent;
            if (ev.type === "conversation") {
              convId = ev.conversationId;
              setConversationId(ev.conversationId);
              if (ev.runId) setRunId(ev.runId);
              continue;
            }
            if (ev.type === "done") continue;
            queue.push(ev);
            if (!frame) frame = requestAnimationFrame(flush);
          }
        }
      } catch (e) {
        if (ctrl.signal.aborted) return; // view left or switched conversation: the run keeps going server-side
        setLive((t) => applyEvent(t ?? emptyTrace(), { type: "error", message: e instanceof Error ? e.message : String(e) }));
      } finally {
        if (frame) cancelAnimationFrame(frame);
      }
      if (ctrl.signal.aborted) return;
      flush();
      setRunId(null);
      setSending(false);
      if (convId) {
        await loadMessages(convId);
        setLive(null);
        setPendingUser(null);
      }
      convs.reload();
      onRunsChanged?.();
    },
    [loadMessages, convs, onRunsChanged],
  );

  /** Re-attach to the conversation's active run, if any. */
  const attach = useCallback(
    async (id: string) => {
      const ctrl = new AbortController();
      streamRef.current = ctrl;
      const res = await fetch(`/api/runs/stream?conversationId=${id}`, { signal: ctrl.signal }).catch(() => null);
      if (!res?.ok || !res.body || ctrl.signal.aborted) return;
      setLive(emptyTrace());
      await consume(res, ctrl);
    },
    [consume],
  );

  const openConversation = useCallback(
    async (id: string | null) => {
      streamRef.current?.abort();
      setConversationId(id);
      setLive(null);
      setRunId(null);
      setPendingUser(null);
      setFocus(null);
      if (!id) return setMessages([]);
      await loadMessages(id);
      await attach(id);
    },
    [loadMessages, attach],
  );

  // On mount: open the requested conversation, or the one where this target is still working.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const runs = await api<RunInfo[]>("/api/runs").catch(() => [] as RunInfo[]);
      if (cancelled) return;
      const conv = effective.conversationId ?? runs.find((r) => r.status === "running" && r.targetId === effective.id)?.conversationId;
      if (conv) await openConversation(conv);
    })();
    return () => {
      cancelled = true;
      streamRef.current?.abort();
      if (viewingRef) viewingRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function send(override?: string, approve = false) {
    const text = (override ?? input).trim();
    if (!text || running) return;
    if (!override) setInput("");
    setPendingUser(text);
    toBottom();
    setSending(true);
    setLive(emptyTrace());
    const ctrl = new AbortController();
    streamRef.current = ctrl;
    try {
      const r = await fetch("/api/chat", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          conversationId,
          targetType: effective.type,
          targetId: effective.id,
          message: text,
          approve,
          kind: !conversationId && effective.planning ? "planning" : undefined,
        }),
        signal: ctrl.signal,
      });
      if (!r.ok || !r.body) throw new Error((await r.json().catch(() => ({}))).error ?? `HTTP ${r.status}`);
      onRunsChanged?.();
      await consume(r, ctrl);
    } catch (e) {
      if (ctrl.signal.aborted) return;
      setSending(false);
      setLive((t) => applyEvent(t ?? emptyTrace(), { type: "error", message: e instanceof Error ? e.message : String(e) }));
    }
  }

  const stop = async () => {
    if (runId) await api("/api/runs/stop", { method: "POST", json: { id: runId } });
  };

  const lastAssistant = [...messages].reverse().find((m) => m.role === "assistant");
  const lastUser = [...messages].reverse().find((m) => m.role === "user");
  const graphTrace = live ?? lastAssistant?.trace ?? null;
  const focusTrace = focus ? (live?.calls[focus] ? live : messages.find((m) => m.trace?.calls[focus])?.trace) : undefined;

  const expandAgent = (agentId: string) => {
    const tr = graphTrace;
    const call = tr?.order
      .map((id) => tr.calls[id])
      .filter((c) => c?.agentId === agentId)
      .at(-1);
    if (call) setFocus(call.callId);
  };

  const conv = convs.data?.find((c) => c.id === conversationId);
  const planning = conv ? conv.kind === "planning" : !!effective.planning && !conversationId;
  const phase = conv?.phase || ((spec?.clarify || planning) && !conversationId ? "cadrage" : "");
  const awaitingApproval = phase === "cadrage" && !running && messages.at(-1)?.role === "assistant";

  if (!lead)
    return (
      <Empty title={t("Aucun premier contact")}>
        {project ? t("Définis au moins un premier contact (★) dans l'onglet Équipe du projet.") : t("Agent introuvable.")}
      </Empty>
    );

  return (
    <div className="flex h-full min-h-0">
      {/* conversations */}
      {showList && (
        <aside className="hidden w-60 shrink-0 flex-col border-r border-line lg:flex">
          <div className="flex items-center justify-between px-3 py-3">
            <span className="text-xs font-semibold uppercase tracking-wide text-fg-subtle">{t("Conversations")}</span>
            <Button size="sm" variant="ghost" title={t("Nouvelle conversation")} onClick={() => openConversation(null)}>
              <MessageSquarePlus size={15} />
            </Button>
          </div>
          <div className="flex-1 overflow-y-auto px-2 pb-3">
            {(convs.data ?? []).map((c) => (
              <div
                key={c.id}
                onClick={() => c.id !== conversationId && openConversation(c.id)}
                className={cx(
                  "group mb-0.5 flex cursor-pointer items-center gap-2 rounded-lg px-2.5 py-2 text-sm",
                  c.id === conversationId ? "bg-surface-3 text-fg" : "text-fg-muted hover:bg-surface-2",
                )}
              >
                <span className="flex-1 truncate">{c.title || t("Sans titre")}</span>
                <button
                  className="hidden text-fg-subtle hover:text-red-400 group-hover:block"
                  title={t("Supprimer")}
                  onClick={async (e) => {
                    e.stopPropagation();
                    if (!confirm(t("Supprimer cette conversation ?"))) return;
                    await api(`/api/conversations?id=${c.id}`, { method: "DELETE" });
                    if (c.id === conversationId) openConversation(null);
                    convs.reload();
                  }}
                >
                  <Trash2 size={13} />
                </button>
              </div>
            ))}
            {!convs.data?.length && <div className="px-2.5 py-2 text-xs text-fg-subtle">{t("Aucune conversation")}</div>}
          </div>
        </aside>
      )}

      {/* graph */}
      <section className="relative hidden min-w-0 flex-1 md:block">
        <div className="absolute left-3 top-3 z-10 flex items-center gap-2">
          <Button size="sm" variant="soft" onClick={() => setShowList(!showList)} className="hidden lg:inline-flex" title={t("Conversations")}>
            {showList ? <PanelLeftClose size={14} /> : <PanelLeftOpen size={14} />}
          </Button>
          <Select
            className="h-8 w-64 text-xs"
            value={`${effective.type}:${effective.id}`}
            onChange={(e) => {
              const [type, id] = e.target.value.split(":");
              if (type === "new") return onNewProject();
              onTarget({ type: type as Target["type"], id });
            }}
          >
            <optgroup label={t("Projets")}>
              {projects.map((p) => (
                <option key={p.id} value={`project:${p.id}`}>
                  📁 {p.name}
                </option>
              ))}
              <option value="new:">➕ {t("Nouveau projet…")}</option>
            </optgroup>
            <optgroup label={t("Agents seuls")}>
              {agents.map((a) => (
                <option key={a.id} value={`agent:${a.id}`}>
                  {a.emoji} {a.name}
                </option>
              ))}
            </optgroup>
          </Select>
        </div>
        <div className="absolute bottom-3 right-3 z-10 text-[11px] text-fg-subtle">{t("Clique sur un agent pour agrandir sa réponse")}</div>
        <AgentGraph
          agents={teamAgents}
          entries={entries}
          links={spec?.links ?? []}
          layout={spec?.layout}
          trace={graphTrace}
          userText={pendingUser ?? lastUser?.content}
          running={running}
          onAgentClick={expandAgent}
        />
      </section>

      {/* chat */}
      <section className="flex w-full min-w-0 flex-col border-l border-line bg-surface-0 md:w-[400px] xl:w-[440px]">
        <div className="flex items-center gap-2 border-b border-line px-4 py-3">
          <span className="text-lg">{project ? "📁" : lead.emoji}</span>
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm font-semibold">{project?.name ?? lead.name}</div>
            <div className="truncate text-xs text-fg-muted">
              {project ? t("Premiers contacts : {names} · {n} agents", { names: [lead, ...coLeads].map((a) => a.name).join(" + "), n: teamAgents.length }) : lead.role}
            </div>
          </div>
          {planning && <span className="rounded-full bg-accent/15 px-2 py-0.5 text-[11px] text-accent">{t("planification")}</span>}
          {phase === "cadrage" && <span className="rounded-full bg-amber-500/15 px-2 py-0.5 text-[11px] text-amber-400">{t("cadrage")}</span>}
          {phase === "execution" && <span className="rounded-full bg-emerald-500/15 px-2 py-0.5 text-[11px] text-emerald-400">{t("réalisation")}</span>}
          {running && (
            <span className="flex items-center gap-1.5 rounded-full bg-accent/15 px-2 py-0.5 text-[11px] text-accent">
              <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-accent" /> {t("en cours")}
            </span>
          )}
        </div>
        <div className="relative flex min-h-0 flex-1 flex-col">
          <div
            ref={scrollRef}
            onScroll={(e) => {
              const el = e.currentTarget;
              const bottom = el.scrollHeight - el.scrollTop - el.clientHeight < 60;
              followRef.current = bottom;
              if (bottom !== atBottom) setAtBottom(bottom);
            }}
            className="flex-1 space-y-5 overflow-y-auto px-4 py-4"
          >
            {!messages.length && !pendingUser && (
              <div className="rounded-xl border border-dashed border-line p-4 text-sm text-fg-muted">
                {project && planning ? (
                  <>
                    <b className="text-fg">{t("Cadrage avant planification.")}</b> {t("Présente ton projet en quelques phrases, sans tout détailler :")}{" "}
                    <b className="text-fg">{[lead, ...coLeads].map((a) => a.name).join(t(" et "))}</b>{" "}
                    {t(
                      "vont te poser leurs questions (objectif, périmètre, priorités, contraintes). Quand tout est clair, clique sur « Valider et créer les tâches » : ils découperont le projet en tâches et en sprints à partir de votre échange.",
                    )}
                  </>
                ) : project ? (
                  <>
                    {t("Présente ton idée ou ta demande à")} <b className="text-fg">{[lead, ...coLeads].map((a) => a.name).join(t(" et "))}</b>.{" "}
                    {spec?.clarify
                      ? t("Ils commencent par cadrer : analyse, approche et questions. Quand tout est clair, valide pour qu'ils répartissent le travail et contrôlent les résultats.")
                      : t("Ils délèguent aux spécialistes selon les liens de l'équipe.")}
                  </>
                ) : (
                  <>
                    {t("Pose ta question à")} <b className="text-fg">{lead.name}</b>.
                  </>
                )}{" "}
                {t("Tu peux changer d'écran pendant qu'ils travaillent : la réponse continue en arrière-plan.")}
              </div>
            )}
            {messages.map((m) =>
              m.role === "user" ? (
                <UserBubble key={m.id} text={m.content} />
              ) : (
                <AssistantTurn key={m.id} trace={m.trace} agents={agentMap} fallback={m.content} onExpand={setFocus} />
              ),
            )}
            {pendingUser && <UserBubble text={pendingUser} />}
            {live && <AssistantTurn trace={live} agents={agentMap} onExpand={setFocus} />}
          </div>
          {!atBottom && (
            <button
              onClick={toBottom}
              className="absolute bottom-3 left-1/2 flex -translate-x-1/2 items-center gap-1 rounded-full bg-accent px-3 py-1.5 text-xs font-medium text-white shadow-lg shadow-black/40 hover:brightness-110"
            >
              <ArrowDown size={12} /> {running ? t("Suivre la réponse") : t("Aller en bas")}
            </button>
          )}
        </div>
        <div className="border-t border-line p-3">
          {awaitingApproval && (
            <div className="mb-2 flex items-center gap-2 rounded-xl border border-amber-500/30 bg-amber-500/10 px-3 py-2">
              <span className="flex-1 text-xs text-amber-200">
                {planning
                  ? t("Réponds aux questions, ou valide quand le cadrage te convient : l'équipe créera les tâches.")
                  : t("Phase de cadrage : réponds aux questions ci-dessus, ou valide pour lancer la réalisation.")}
              </span>
              <Button
                size="sm"
                variant="primary"
                onClick={() =>
                  send(planning ? "✅ Validé : crée les tâches à partir de notre échange." : "✅ Validé : lance la réalisation en tenant compte de nos échanges.", true)
                }
              >
                <CheckCircle2 size={13} /> {planning ? t("Valider et créer les tâches") : t("Valider et lancer")}
              </Button>
            </div>
          )}
          <div className="flex items-end gap-2 rounded-xl border border-line bg-surface-1 p-2 focus-within:border-accent">
            <textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  send();
                }
              }}
              ref={inputRef}
              rows={1}
              placeholder={running ? t("Réponse en cours…") : t("Message à {name}…", { name: lead.name })}
              className="flex-1 resize-none bg-transparent px-1.5 py-1 text-sm leading-relaxed outline-none placeholder:text-fg-subtle"
            />
            {running ? (
              <Button variant="danger" size="sm" onClick={stop} disabled={!runId} title={t("Arrêter la réponse")}>
                <Square size={13} />
              </Button>
            ) : (
              <Button variant="primary" size="sm" onClick={() => send()} disabled={!input.trim()} title={t("Envoyer")}>
                <Send size={13} />
              </Button>
            )}
          </div>
        </div>
      </section>

      {focus && focusTrace && <CallFocus trace={focusTrace} callId={focus} agents={agentMap} onClose={() => setFocus(null)} onFocus={setFocus} />}
    </div>
  );
}

function UserBubble({ text }: { text: string }) {
  return (
    <div className="flex justify-end">
      <div className="max-w-[85%] whitespace-pre-wrap rounded-2xl rounded-br-sm bg-accent/20 px-3.5 py-2 text-sm">{text}</div>
    </div>
  );
}
