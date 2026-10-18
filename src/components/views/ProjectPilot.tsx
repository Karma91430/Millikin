"use client";

import { Activity, AlertTriangle, ClipboardCheck, Loader2, MessageSquare, RefreshCw, Sparkles, SquareKanban } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useT } from "@/i18n";
import type { CallNode, Trace } from "@/lib/trace";
import { api, useData, type Agent, type Project, type Sprint, type SprintAnalytics, type TraceSummary } from "../api";
import { CallFocus } from "../chat/CallFocus";
import { Avatar, Badge, Button, Card, cx, Empty, ErrorNote, Markdown } from "../ui";

const fmtMs = (ms: number) => (ms >= 3600000 ? `${(ms / 3600000).toFixed(1)} h` : ms >= 60000 ? `${Math.round(ms / 60000)} min` : ms >= 1000 ? `${Math.round(ms / 1000)} s` : `${Math.max(0, Math.round(ms))} ms`);
const fmtN = (n: number) => Math.round(n || 0).toLocaleString("fr-FR");
const fmtTok = (n: number) => (n >= 1000 ? `${(n / 1000).toFixed(n >= 10000 ? 0 : 1)}k` : String(n));
const pct = (x: number, of: number) => (of ? Math.round((x / of) * 100) : 0);

/** Project management: sprint reviews by the first contacts, and the traces of every run. */
export function ProjectPilot({ project, agents, sprintsOn }: { project: Project; agents: Agent[]; sprintsOn: boolean }) {
  const { t } = useT();
  const [subState, setSub] = useState<"reviews" | "traces">("reviews");
  const sub = sprintsOn ? subState : "traces";
  const byId = useMemo(() => new Map(agents.map((a) => [a.id, a])), [agents]);
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex gap-1 px-6 pt-4">
        {(
          [
            ["reviews", t("Revues de sprint"), ClipboardCheck, sprintsOn],
            ["traces", t("Traces des agents"), Activity, true],
          ] as const
        )
          .filter(([, , , on]) => on)
          .map(([id, label, Icon]) => (
            <button key={id} onClick={() => setSub(id)} className={cx("flex items-center gap-1.5 rounded-lg px-3 py-1 text-sm", sub === id ? "bg-accent/20 text-fg" : "text-fg-muted hover:bg-surface-2")}>
              <Icon size={14} /> {label}
            </button>
          ))}
      </div>
      <div className="min-h-0 flex-1">{sub === "reviews" ? <SprintReviews project={project} agents={byId} /> : <Traces project={project} agents={byId} />}</div>
    </div>
  );
}

/* ------------------------------------------------------------------ sprint reviews */

function SprintReviews({ project, agents }: { project: Project; agents: Map<string, Agent> }) {
  const { t } = useT();
  const data = useData<Sprint[]>("/api/crud/sprints");
  // Every sprint, newest first; a planned one can still get an interim review.
  const sprints = useMemo(() => (data.data ?? []).filter((s) => s.project_id === project.id).reverse(), [data.data, project.id]);
  const [pick, setPick] = useState<string>();
  const [error, setError] = useState<string>();
  const sprint = sprints.find((s) => s.id === pick) ?? sprints.find((s) => s.review) ?? sprints[0];
  const running = sprints.some((s) => s.review?.status === "running");
  useEffect(() => {
    if (!running) return;
    const timer = setInterval(data.reload, 4000);
    return () => clearInterval(timer);
  }, [running, data.reload]);

  if (!data.data) return <div className="p-6 text-sm text-fg-muted">{data.error ?? t("Chargement…")}</div>;
  if (!sprints.length)
    return (
      <Empty icon={<ClipboardCheck size={28} />} title={t("Aucun sprint")}>
        {t("Quand le dernier ticket d'un sprint est validé, le sprint se clôture et les premiers contacts rédigent sa revue.")}
      </Empty>
    );

  const generate = async (id: string) => {
    setError(undefined);
    try {
      await api("/api/sprints/review", { method: "POST", json: { id } });
      data.reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };
  const review = sprint?.review;

  return (
    <div className="flex h-full min-h-0">
      <aside className="w-56 shrink-0 overflow-y-auto border-r border-line p-3">
        {sprints.map((s) => (
          <button key={s.id} onClick={() => setPick(s.id)} className={cx("mb-1 w-full rounded-lg px-3 py-2 text-left text-sm", s.id === sprint?.id ? "bg-surface-3" : "hover:bg-surface-2")}>
            <div className="truncate font-medium">{s.name}</div>
            <div className="mt-0.5 flex items-center gap-1.5 text-[11px] text-fg-subtle">
              {s.status === "active" ? t("en cours") : s.status === "planned" ? t("pas commencé") : t("clôturé")}
              {s.review?.status === "running" && <Loader2 size={11} className="animate-spin text-accent" />}
              {s.review?.status === "done" && <span className="text-emerald-400">· {t("revue prête")}</span>}
              {s.review?.status === "error" && <span className="text-red-400">· {t("revue en erreur")}</span>}
            </div>
          </button>
        ))}
      </aside>
      {sprint && (
        <div className="min-w-0 flex-1 overflow-y-auto p-6">
          <div className="mb-4 flex flex-wrap items-center gap-3">
            <div className="min-w-0 flex-1">
              <h2 className="text-lg font-semibold">{t("Revue du sprint « {name} »", { name: sprint.name })}</h2>
              <div className="text-xs text-fg-muted">
                {[sprint.start_date, sprint.end_date].filter(Boolean).join(" → ")}
                {sprint.goal ? ` · ${sprint.goal}` : ""}
              </div>
            </div>
            <Button variant={review ? "soft" : "primary"} disabled={review?.status === "running"} onClick={() => generate(sprint.id)}>
              {review?.status === "running" ? <Loader2 size={14} className="animate-spin" /> : review ? <RefreshCw size={14} /> : <Sparkles size={14} />}
              {review?.status === "running" ? t("Revue en cours…") : review ? t("Relancer la revue") : sprint.status === "done" ? t("Lancer la revue") : t("Faire une revue intermédiaire")}
            </Button>
          </div>
          <ErrorNote>{error ?? (review?.status === "error" ? review.error : undefined)}</ErrorNote>
          {!review ? (
            <p className="text-sm text-fg-muted">{t("Pas encore de revue pour ce sprint. Elle démarre d'elle-même quand son dernier ticket est validé, ou avec le bouton ci-dessus.")}</p>
          ) : (
            <div className="flex flex-col gap-5">
              <SprintFigures a={review.analytics} agents={agents} />
              <Card className="p-5">
                <div className="mb-2 flex items-center gap-2 text-sm font-semibold">
                  <ClipboardCheck size={15} className="text-accent" /> {t("Synthèse de l'équipe")}
                </div>
                {review.summary ? (
                  <Markdown>{review.summary}</Markdown>
                ) : (
                  <p className="flex items-center gap-2 text-sm text-fg-muted">
                    {review.status === "running" && <Loader2 size={13} className="animate-spin" />}
                    {review.status === "running" ? t("Les premiers contacts rédigent la revue…") : "—"}
                  </p>
                )}
              </Card>
              {review.feedback.length > 1 && (
                <div>
                  <div className="mb-2 text-sm font-semibold">{t("Avis de chaque premier contact")}</div>
                  <div className="grid gap-3 xl:grid-cols-2">
                    {review.feedback.map((f) => {
                      const a = agents.get(f.agentId);
                      return (
                        <Card key={f.agentId} className="p-4">
                          <div className="mb-2 flex items-center gap-2">
                            {a && <Avatar emoji={a.emoji} color={a.color} size={26} />}
                            <div className="text-sm font-semibold">{a?.name ?? "?"}</div>
                            <span className="text-xs text-fg-subtle">{a?.role}</span>
                          </div>
                          <Markdown className="text-sm">{f.text}</Markdown>
                        </Card>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function SprintFigures({ a, agents }: { a: SprintAnalytics; agents: Map<string, Agent> }) {
  const { t } = useT();
  const tiles: [string, string, string][] = [
    [t("Terminées"), `${pct(a.done, a.tasks)} %`, t("{done}/{total} tâches", { done: a.done, total: a.tasks })],
    [t("Points livrés"), `${a.pointsDone}/${a.points}`, t("{n} jour(s) de sprint", { n: a.days })],
    [t("Premier coup"), `${pct(a.firstTry, a.done)} %`, t("{n} relance(s) après contrôle", { n: a.retries })],
    [t("Note du contrôle"), a.avgScore == null ? "—" : `${a.avgScore.toFixed(1)}/5`, t("{n} à vérifier par un humain", { n: a.needsHuman })],
    [t("Tokens"), fmtTok(a.tokens), t("{n} appels au modèle", { n: fmtN(a.modelCalls) })],
    [t("Temps de calcul"), fmtMs(a.computeMs), t("{n} erreur(s) du modèle", { n: a.modelErrors })],
  ];
  const maxPts = Math.max(1, ...a.members.map((m) => m.points || m.tasks));
  return (
    <>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        {tiles.map(([label, value, hint]) => (
          <Card key={label} className="p-3">
            <div className="text-[11px] text-fg-muted">{label}</div>
            <div className="text-xl font-semibold">{value}</div>
            <div className="text-[11px] text-fg-subtle">{hint}</div>
          </Card>
        ))}
      </div>
      <div className="grid gap-3 xl:grid-cols-5">
        <Card className="p-4 xl:col-span-3">
          <div className="mb-3 text-sm font-semibold">{t("Contribution par membre")}</div>
          {a.members.length ? (
            <table className="w-full text-xs">
              <thead className="text-left text-fg-subtle">
                <tr>
                  <th className="pb-2 font-medium">{t("Membre")}</th>
                  <th className="pb-2 font-medium">{t("Points livrés")}</th>
                  <th className="pb-2 text-right font-medium">{t("Tâches")}</th>
                  <th className="pb-2 text-right font-medium">{t("Note")}</th>
                  <th className="pb-2 text-right font-medium">{t("Relances")}</th>
                  <th className="pb-2 text-right font-medium">{t("Tokens")}</th>
                </tr>
              </thead>
              <tbody>
                {a.members.map((m) => {
                  const ag = agents.get(m.agentId);
                  const total = m.points || m.tasks;
                  const done = m.points ? m.pointsDone : m.done;
                  return (
                    <tr key={m.agentId} className="border-t border-line">
                      <td className="py-2 pr-2">
                        <span className="flex items-center gap-1.5">
                          <span>{ag?.emoji}</span>
                          <span className="truncate">{ag?.name ?? "?"}</span>
                        </span>
                      </td>
                      <td className="w-1/3 py-2 pr-3">
                        <div className="flex items-center gap-2">
                          <div className="relative h-2 flex-1 rounded-full bg-surface-3" style={{ maxWidth: `${(total / maxPts) * 100}%`, minWidth: 8 }}>
                            <div className="absolute inset-y-0 left-0 rounded-full" style={{ width: `${pct(done, total)}%`, background: ag?.color ?? "var(--accent)" }} />
                          </div>
                          <span className="tabular-nums text-fg-muted">{m.points ? `${m.pointsDone}/${m.points}` : `${m.done}/${m.tasks}`}</span>
                        </div>
                      </td>
                      <td className="py-2 text-right tabular-nums">
                        {m.done}/{m.tasks}
                      </td>
                      <td className="py-2 text-right tabular-nums">{m.avgScore == null ? "—" : m.avgScore.toFixed(1)}</td>
                      <td className={cx("py-2 text-right tabular-nums", m.retries > 2 && "text-amber-400")}>{m.retries}</td>
                      <td className="py-2 text-right tabular-nums text-fg-muted">{fmtTok(m.tokens)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          ) : (
            <p className="text-xs text-fg-muted">{t("Aucune activité sur ce sprint.")}</p>
          )}
        </Card>
        <Card className="flex flex-col gap-3 p-4 xl:col-span-2">
          <div>
            <div className="mb-1.5 text-sm font-semibold">{t("Livré ({n})", { n: a.delivered.length })}</div>
            <ul className="space-y-1 text-xs">
              {a.delivered.map((d) => (
                <li key={d.id} className="flex items-center gap-2">
                  <span className="text-emerald-400">✓</span>
                  <span className="min-w-0 flex-1 truncate">{d.title}</span>
                  {d.score != null && <span className="text-fg-subtle">{d.score}/5</span>}
                </li>
              ))}
              {!a.delivered.length && <li className="text-fg-subtle">—</li>}
            </ul>
          </div>
          <div>
            <div className="mb-1.5 text-sm font-semibold">{t("Reporté ({n})", { n: a.carried.length })}</div>
            <ul className="space-y-1 text-xs">
              {a.carried.map((d) => (
                <li key={d.id} className="flex items-center gap-2">
                  <span className="text-amber-400">↪</span>
                  <span className="min-w-0 flex-1 truncate">{d.title}</span>
                  <span className="text-fg-subtle">{agents.get(d.assignee_id)?.name ?? ""}</span>
                </li>
              ))}
              {!a.carried.length && <li className="text-fg-subtle">—</li>}
            </ul>
          </div>
        </Card>
      </div>
    </>
  );
}

/* ------------------------------------------------------------------ traces */

const KIND_ICON = { chat: MessageSquare, task: SquareKanban, review: ClipboardCheck, live: Loader2 } as const;

function Traces({ project, agents }: { project: Project; agents: Map<string, Agent> }) {
  const { t } = useT();
  const list = useData<TraceSummary[]>(`/api/projects/traces?id=${project.id}`);
  const [filter, setFilter] = useState<"all" | "chat" | "task" | "review" | "errors">("all");
  const [pick, setPick] = useState<string>();
  const live = list.data?.some((r) => r.status === "running");
  useEffect(() => {
    if (!live) return;
    const timer = setInterval(list.reload, 4000);
    return () => clearInterval(timer);
  }, [live, list.reload]);
  const rows = (list.data ?? []).filter((r) => (filter === "all" ? true : filter === "errors" ? r.errors > 0 : r.kind === filter || (r.kind === "live" && filter === "task")));
  const selected = (list.data ?? []).find((r) => r.id === pick) ?? rows[0];

  if (!list.data) return <div className="p-6 text-sm text-fg-muted">{list.error ?? t("Chargement…")}</div>;
  if (!list.data.length)
    return (
      <Empty icon={<Activity size={28} />} title={t("Pas encore de trace")}>
        {t("Chaque échange avec l'équipe, chaque ticket lancé et chaque revue de sprint laisse une trace consultable ici.")}
      </Empty>
    );

  return (
    <div className="flex h-full min-h-0">
      <aside className="flex w-80 shrink-0 flex-col border-r border-line">
        <div className="flex flex-wrap gap-1 p-3">
          {(
            [
              ["all", t("Tout")],
              ["chat", t("Échanges")],
              ["task", t("Tickets")],
              ["review", t("Revues")],
              ["errors", t("Erreurs")],
            ] as const
          ).map(([id, label]) => (
            <button key={id} onClick={() => setFilter(id)} className={cx("rounded-md px-2 py-0.5 text-xs", filter === id ? "bg-accent/20 text-fg" : "text-fg-muted hover:bg-surface-2")}>
              {label}
            </button>
          ))}
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-3">
          {rows.map((r) => {
            const Icon = KIND_ICON[r.kind];
            return (
              <button key={r.id} onClick={() => setPick(r.id)} className={cx("mb-1 w-full rounded-lg px-3 py-2 text-left", r.id === selected?.id ? "bg-surface-3" : "hover:bg-surface-2")}>
                <div className="flex items-center gap-2 text-sm">
                  <Icon size={13} className={cx("shrink-0", r.status === "running" ? "animate-spin text-accent" : "text-fg-subtle")} />
                  <span className="min-w-0 flex-1 truncate">{r.title}</span>
                  {r.errors > 0 && <AlertTriangle size={12} className="shrink-0 text-red-400" />}
                </div>
                <div className="mt-1 flex items-center gap-2 pl-5 text-[11px] text-fg-subtle">
                  <span>{new Date(r.startedAt).toLocaleString(undefined, { dateStyle: "short", timeStyle: "short" })}</span>
                  <span>· {fmtMs(r.endedAt - r.startedAt)}</span>
                  <span>· {t("{n} agent(s)", { n: r.agents.length })}</span>
                  {r.tokens > 0 && <span>· {fmtTok(r.tokens)} tok</span>}
                </div>
              </button>
            );
          })}
          {!rows.length && <p className="px-3 py-2 text-xs text-fg-subtle">{t("Rien pour ce filtre.")}</p>}
        </div>
      </aside>
      <div className="min-w-0 flex-1 overflow-y-auto">{selected && <TraceDetail key={selected.id} projectId={project.id} run={selected} agents={agents} />}</div>
    </div>
  );
}

type Row = { call: CallNode; depth: number; start: number; end: number };

/** Calls in tree order (parent then its delegations), with their time span. */
function rowsOf(trace: Trace, now: number): Row[] {
  const calls = trace.order.map((id) => trace.calls[id]).filter(Boolean);
  const endOf = (c: CallNode) => c.endedAt ?? (["done", "error"].includes(c.status) ? Math.max(c.startedAt, ...c.tools.map((x) => x.endedAt ?? 0)) : now);
  const out: Row[] = [];
  const walk = (c: CallNode, depth: number) => {
    out.push({ call: c, depth, start: c.startedAt, end: endOf(c) });
    for (const k of calls.filter((x) => x.parentCallId === c.callId)) walk(k, depth + 1);
  };
  for (const root of calls.filter((c) => !c.parentCallId || !trace.calls[c.parentCallId])) walk(root, 0);
  return out;
}

function TraceDetail({ projectId, run, agents }: { projectId: string; run: TraceSummary; agents: Map<string, Agent> }) {
  const { t } = useT();
  const data = useData<Trace>(`/api/projects/traces?id=${projectId}&run=${encodeURIComponent(run.id)}`);
  const [focus, setFocus] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const live = run.status === "running";
  const reload = data.reload;
  useEffect(() => {
    if (!live) return;
    const timer = setInterval(() => (reload(), setNow(Date.now())), 2000);
    return () => clearInterval(timer);
  }, [live, reload]);
  const trace = data.data;
  const rows = useMemo(() => (trace ? rowsOf(trace, now) : []), [trace, now]);
  if (!trace) return <div className="p-6 text-sm text-fg-muted">{data.error ?? t("Chargement…")}</div>;

  const t0 = Math.min(...rows.map((r) => r.start));
  const span = Math.max(1, Math.max(...rows.map((r) => r.end)) - t0);
  const x = (ts: number) => `${((ts - t0) / span) * 100}%`;

  // Aggregates: per tool and per agent.
  const tools = new Map<string, { n: number; errors: number; ms: number; timed: number }>();
  const byAgent = new Map<string, { calls: number; tokens: number; llmMs: number; steps: number }>();
  for (const { call } of rows) {
    for (const u of call.tools) {
      if (u.name === "ask_agent") continue;
      const s = tools.get(u.name) ?? { n: 0, errors: 0, ms: 0, timed: 0 };
      s.n++;
      if (u.error) s.errors++;
      if (u.startedAt && u.endedAt) {
        s.ms += u.endedAt - u.startedAt;
        s.timed++;
      }
      tools.set(u.name, s);
    }
    const a = byAgent.get(call.agentId) ?? { calls: 0, tokens: 0, llmMs: 0, steps: 0 };
    a.calls++;
    for (const l of call.llm ?? []) {
      a.tokens += l.promptTokens + l.completionTokens;
      a.llmMs += l.ms;
      a.steps++;
    }
    byAgent.set(call.agentId, a);
  }
  const hasLlm = rows.some((r) => r.call.llm?.length);
  const errors = rows.filter((r) => r.call.status === "error");

  return (
    <div className="flex flex-col gap-4 p-6">
      <div>
        <h2 className="text-base font-semibold">{run.title}</h2>
        <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-xs text-fg-muted">
          <span>{new Date(run.startedAt).toLocaleString()}</span>
          <span>
            {t("Durée")} : {fmtMs(span)}
          </span>
          <span>{t("{n} appel(s) d'agent", { n: rows.length })}</span>
          <span>{t("{n} outil(s)", { n: run.tools })}</span>
          {run.tokens > 0 && <span>{fmtN(run.tokens)} tokens</span>}
          {run.errors > 0 && <span className="text-red-400">{t("{n} erreur(s)", { n: run.errors })}</span>}
        </div>
      </div>

      {trace.error && <ErrorNote>{trace.error}</ErrorNote>}

      <Card className="p-4">
        <div className="mb-3 flex items-center justify-between text-sm font-semibold">
          {t("Chronologie")}
          <span className="text-[11px] font-normal text-fg-subtle">{t("Clique sur une ligne pour voir la demande, les outils et la réponse")}</span>
        </div>
        <div className="flex flex-col gap-1">
          {rows.map(({ call, depth, start, end }) => {
            const a = agents.get(call.agentId);
            const color = a?.color ?? "#888";
            const runningNow = !["done", "error"].includes(call.status);
            const tokens = (call.llm ?? []).reduce((n, l) => n + l.promptTokens + l.completionTokens, 0);
            return (
              <button key={call.callId} onClick={() => setFocus(call.callId)} className="group grid grid-cols-[minmax(160px,240px)_1fr_auto] items-center gap-3 rounded-md px-1 py-1 text-left hover:bg-surface-2">
                <span className="flex min-w-0 items-center gap-1.5 text-xs" style={{ paddingLeft: depth * 14 }}>
                  {depth > 0 && <span className="text-fg-subtle">└</span>}
                  <span>{a?.emoji ?? "🤖"}</span>
                  <span className="truncate">{a?.name ?? t("Agent supprimé")}</span>
                  {call.status === "error" && <AlertTriangle size={11} className="shrink-0 text-red-400" />}
                </span>
                <span className="relative h-5 rounded bg-surface-2/60">
                  <span
                    className={cx("absolute inset-y-0.5 rounded", runningNow && "animate-pulse")}
                    style={{ left: x(start), width: `max(3px, ${((end - start) / span) * 100}%)`, background: call.status === "error" ? "#ef4444aa" : `${color}99` }}
                  />
                  {call.tools
                    .filter((u) => u.name !== "ask_agent" && u.startedAt)
                    .map((u) => (
                      <span
                        key={u.id}
                        title={u.name}
                        className={cx("absolute top-0 h-5 w-[2px] rounded", u.error ? "bg-red-400" : "bg-fg/70")}
                        style={{ left: x(u.startedAt!) }}
                      />
                    ))}
                </span>
                <span className="w-28 text-right text-[11px] tabular-nums text-fg-muted">
                  {fmtMs(end - start)}
                  {tokens > 0 && <span className="text-fg-subtle"> · {fmtTok(tokens)}</span>}
                </span>
              </button>
            );
          })}
        </div>
        <div className="mt-2 flex items-center gap-3 pl-[calc(min(240px,30%)+12px)] text-[10px] text-fg-subtle">
          <span className="inline-block h-2 w-3 rounded bg-accent/60" /> {t("travail de l'agent (délégations comprises)")}
          <span className="inline-block h-3 w-[2px] bg-fg/70" /> {t("appel d'outil")}
        </div>
      </Card>

      <div className="grid gap-3 xl:grid-cols-2">
        <Card className="p-4">
          <div className="mb-2 text-sm font-semibold">{t("Par agent")}</div>
          <table className="w-full text-xs">
            <thead className="text-left text-fg-subtle">
              <tr>
                <th className="pb-1.5 font-medium">{t("Agent")}</th>
                <th className="pb-1.5 text-right font-medium">{t("Appels")}</th>
                {hasLlm && <th className="pb-1.5 text-right font-medium">{t("Étapes modèle")}</th>}
                {hasLlm && <th className="pb-1.5 text-right font-medium">{t("Temps modèle")}</th>}
                {hasLlm && <th className="pb-1.5 text-right font-medium">Tokens</th>}
              </tr>
            </thead>
            <tbody>
              {[...byAgent].map(([id, s]) => (
                <tr key={id} className="border-t border-line">
                  <td className="py-1.5">
                    {agents.get(id)?.emoji} {agents.get(id)?.name ?? "?"}
                  </td>
                  <td className="py-1.5 text-right tabular-nums">{s.calls}</td>
                  {hasLlm && <td className="py-1.5 text-right tabular-nums">{s.steps}</td>}
                  {hasLlm && <td className="py-1.5 text-right tabular-nums">{fmtMs(s.llmMs)}</td>}
                  {hasLlm && <td className="py-1.5 text-right tabular-nums">{fmtTok(s.tokens)}</td>}
                </tr>
              ))}
            </tbody>
          </table>
          {!hasLlm && <p className="mt-2 text-[11px] text-fg-subtle">{t("Tokens et temps par étape : disponibles pour les traces enregistrées à partir de maintenant.")}</p>}
        </Card>
        <Card className="p-4">
          <div className="mb-2 text-sm font-semibold">{t("Outils utilisés")}</div>
          {tools.size ? (
            <table className="w-full text-xs">
              <thead className="text-left text-fg-subtle">
                <tr>
                  <th className="pb-1.5 font-medium">{t("Outil")}</th>
                  <th className="pb-1.5 text-right font-medium">{t("Appels")}</th>
                  <th className="pb-1.5 text-right font-medium">{t("Erreurs")}</th>
                  <th className="pb-1.5 text-right font-medium">{t("Durée moyenne")}</th>
                </tr>
              </thead>
              <tbody>
                {[...tools]
                  .sort((a, b) => b[1].n - a[1].n)
                  .map(([name, s]) => (
                    <tr key={name} className="border-t border-line">
                      <td className="py-1.5 font-mono text-[11px]">{name}</td>
                      <td className="py-1.5 text-right tabular-nums">{s.n}</td>
                      <td className={cx("py-1.5 text-right tabular-nums", s.errors > 0 && "text-red-400")}>{s.errors}</td>
                      <td className="py-1.5 text-right tabular-nums text-fg-muted">{s.timed ? fmtMs(s.ms / s.timed) : "—"}</td>
                    </tr>
                  ))}
              </tbody>
            </table>
          ) : (
            <p className="text-xs text-fg-muted">{t("Aucun outil appelé.")}</p>
          )}
        </Card>
      </div>

      {errors.length > 0 && (
        <Card className="border-red-500/30 p-4">
          <div className="mb-2 text-sm font-semibold text-red-400">{t("Erreurs")}</div>
          <ul className="space-y-1 text-xs">
            {errors.map(({ call }) => (
              <li key={call.callId}>
                <button className="text-left hover:underline" onClick={() => setFocus(call.callId)}>
                  <Badge color={agents.get(call.agentId)?.color}>{agents.get(call.agentId)?.name ?? "?"}</Badge> {call.error}
                </button>
              </li>
            ))}
          </ul>
        </Card>
      )}

      {focus && <CallFocus trace={trace} callId={focus} agents={agents} onClose={() => setFocus(null)} onFocus={setFocus} />}
    </div>
  );
}
