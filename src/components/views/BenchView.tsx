"use client";

import { CheckCircle2, FlaskConical, Loader2, Play, Square, Trash2, XCircle } from "lucide-react";
import { Fragment, useEffect, useMemo, useState } from "react";
import { useT } from "@/i18n";
import { RIGORS, type Rigor } from "@/lib/rigor";
import { api, useData, type Meta } from "../api";
import { Badge, Button, Card, cx, ErrorNote, Field, Input, Select } from "../ui";

type Scenario = { id: string; name: string; summary: string; brief: string; leads: string[]; builders: string[]; checks: string[] };
type Result = {
  checks: { name: string; ok: boolean; detail: string }[];
  passed: number;
  total: number;
  tasks: number;
  done: number;
  firstTry: number;
  attempts: number;
  needsHuman: number;
  planMs: number;
  buildMs: number;
  modelCalls: number;
  promptTokens: number;
  completionTokens: number;
  modelErrors: number;
};
type Run = {
  id: string;
  batch: string;
  scenario: string;
  config: { label: string; leadModel: string; builderModel: string; rigor: Rigor };
  status: "queued" | "running" | "done" | "error" | "stopped";
  phase: string;
  started_at: number | null;
  ended_at: number | null;
  result: Result | null;
  error: string;
};
type Data = { scenarios: Scenario[]; runs: Run[]; busy: boolean };

const fmtMs = (ms: number) => (ms >= 60000 ? `${Math.round(ms / 60000)} min` : `${Math.round(ms / 1000)} s`);
const fmtTok = (n: number) => (n >= 1e6 ? `${(n / 1e6).toFixed(1)} M` : n >= 1000 ? `${Math.round(n / 1000)} k` : String(n));
const PHASE: Record<string, string> = { planning: "planification", build: "réalisation des tickets", checks: "vérifications" };

/** Test bench: run reference scenarios with a configuration and compare the results. */
export function BenchView({ meta }: { meta: Meta }) {
  const { t } = useT();
  const data = useData<Data>("/api/bench");
  const [picked, setPicked] = useState<string[]>([]);
  const [config, setConfig] = useState({ label: "", leadModel: "", builderModel: "", rigor: "standard" as Rigor });
  const [error, setError] = useState<string>();
  const [open, setOpen] = useState<string | null>(null);
  const models = meta.models.filter((m) => m.kind !== "embedding");
  const busy = data.data?.busy;
  const reload = data.reload;
  useEffect(() => {
    if (!busy) return;
    const timer = setInterval(reload, 5000);
    return () => clearInterval(timer);
  }, [busy, reload]);

  // Batches, newest first, with their runs in scenario order.
  const batches = useMemo(() => {
    const m = new Map<string, Run[]>();
    for (const r of data.data?.runs ?? []) m.set(r.batch, [...(m.get(r.batch) ?? []), r]);
    return [...m.values()];
  }, [data.data]);
  const scenarioName = (id: string) => data.data?.scenarios.find((s) => s.id === id)?.name ?? id;
  const modelLabel = (ref: string) => (ref ? (models.find((m) => m.ref === ref)?.label ?? ref) : t("modèle de chaque agent"));

  if (!data.data) return <div className="p-6 text-sm text-fg-muted">{data.error ?? t("Chargement…")}</div>;

  const start = async () => {
    setError(undefined);
    try {
      await api("/api/bench", { method: "POST", json: { action: "start", scenarios: picked, config } });
      reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <div className="flex max-w-6xl flex-col gap-5 p-6">
      <div className="flex items-start gap-3">
        <FlaskConical size={20} className="mt-0.5 text-accent" />
        <div>
          <h2 className="text-lg font-semibold">{t("Banc d'essai")}</h2>
          <p className="text-sm text-fg-muted">
            {t("Des projets de référence réalisés de bout en bout par l'équipe (planification, tickets, contrôles), puis vérifiés par des tests cachés que les agents ne voient pas. Compare des moteurs, des modèles ou des réglages sur les mêmes scénarios.")}
          </p>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-5">
        <Card className="flex flex-col gap-2 p-4 lg:col-span-3">
          <div className="text-sm font-semibold">{t("Scénarios")}</div>
          {data.data.scenarios.map((s) => (
            <label key={s.id} className={cx("flex cursor-pointer items-start gap-2 rounded-lg border p-2.5 text-sm", picked.includes(s.id) ? "border-accent/50 bg-accent/5" : "border-line")}>
              <input
                type="checkbox"
                checked={picked.includes(s.id)}
                onChange={() => setPicked((x) => (x.includes(s.id) ? x.filter((y) => y !== s.id) : [...x, s.id]))}
                className="mt-0.5 accent-[var(--accent)]"
              />
              <span className="min-w-0">
                <span className="block font-medium">{t(s.name)}</span>
                <span className="block text-xs text-fg-muted">{t(s.summary)}</span>
                <span className="block text-[11px] text-fg-subtle">
                  {t("Équipe : {team} · {n} vérifications cachées", { team: [...s.leads, ...s.builders].join(", "), n: s.checks.length })}
                </span>
              </span>
            </label>
          ))}
        </Card>
        <Card className="flex flex-col gap-3 p-4 lg:col-span-2">
          <div className="text-sm font-semibold">{t("Configuration à tester")}</div>
          <Field label={t("Nom de la configuration")}>
            <Input value={config.label} placeholder={t("ex. Sonnet exécutants, Opus contrôle")} onChange={(e) => setConfig({ ...config, label: e.target.value })} />
          </Field>
          <Field label={t("Modèle des premiers contacts (planification, contrôle)")}>
            <Select value={config.leadModel} onChange={(e) => setConfig({ ...config, leadModel: e.target.value })}>
              <option value="">{t("modèle de chaque agent")}</option>
              {models.map((m) => (
                <option key={m.ref} value={m.ref}>
                  {m.label}
                </option>
              ))}
            </Select>
          </Field>
          <Field label={t("Modèle des exécutants")}>
            <Select value={config.builderModel} onChange={(e) => setConfig({ ...config, builderModel: e.target.value })}>
              <option value="">{t("modèle de chaque agent")}</option>
              {models.map((m) => (
                <option key={m.ref} value={m.ref}>
                  {m.label}
                </option>
              ))}
            </Select>
          </Field>
          <Field label={t("Niveau de rigueur")}>
            <Select value={config.rigor} onChange={(e) => setConfig({ ...config, rigor: e.target.value as Rigor })}>
              {RIGORS.map((r) => (
                <option key={r.id} value={r.id}>
                  {t(r.label)}
                </option>
              ))}
            </Select>
          </Field>
          <ErrorNote>{error}</ErrorNote>
          {busy ? (
            <Button variant="soft" onClick={async () => (await api("/api/bench", { method: "POST", json: { action: "stop" } }), reload())}>
              <Square size={14} /> {t("Arrêter le banc d'essai")}
            </Button>
          ) : (
            <Button variant="primary" disabled={!picked.length} onClick={start}>
              <Play size={14} /> {t("Lancer {n} scénario(s)", { n: picked.length })}
            </Button>
          )}
          <p className="text-[11px] text-fg-subtle">{t("Les agents ne sont pas modifiés : les modèles choisis ne valent que pour ce banc d'essai. Compte quelques minutes et quelques centaines de milliers de tokens par scénario.")}</p>
        </Card>
      </div>

      <Card className="overflow-x-auto p-4">
        <div className="mb-3 text-sm font-semibold">{t("Résultats")}</div>
        {batches.length ? (
          <table className="w-full min-w-[900px] text-xs">
            <thead className="text-left text-fg-subtle">
              <tr>
                <th className="pb-2 font-medium">{t("Configuration")}</th>
                <th className="pb-2 font-medium">{t("Scénario")}</th>
                <th className="pb-2 text-right font-medium">{t("Vérifications")}</th>
                <th className="pb-2 text-right font-medium">{t("Tickets")}</th>
                <th className="pb-2 text-right font-medium">{t("1er coup")}</th>
                <th className="pb-2 text-right font-medium">{t("Passages")}</th>
                <th className="pb-2 text-right font-medium">{t("Durée")}</th>
                <th className="pb-2 text-right font-medium">{t("Appels")}</th>
                <th className="pb-2 text-right font-medium">{t("Tokens (entrée / sortie)")}</th>
                <th className="pb-2 text-right font-medium">{t("Erreurs")}</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {batches.map((runs) => {
                const c = runs[0].config;
                return runs.map((r, i) => {
                  const res = r.result;
                  const ok = res && res.passed === res.total;
                  return (
                    <Fragment key={r.id}>
                      <tr className={cx("border-t border-line align-top", i === 0 && "border-line-strong")}>
                        <td className="py-2 pr-3">
                          {i === 0 && (
                            <div>
                              <div className="font-medium text-fg">{c.label}</div>
                              <div className="text-[11px] text-fg-subtle">
                                {modelLabel(c.leadModel)} / {modelLabel(c.builderModel)} · {t(RIGORS.find((x) => x.id === c.rigor)?.label ?? c.rigor)}
                              </div>
                              <div className="text-[11px] text-fg-subtle">{r.started_at ? new Date(r.started_at).toLocaleString(undefined, { dateStyle: "short", timeStyle: "short" }) : ""}</div>
                            </div>
                          )}
                        </td>
                        <td className="py-2 pr-3">
                          <button className="text-left hover:underline" onClick={() => setOpen(open === r.id ? null : r.id)}>
                            {t(scenarioName(r.scenario))}
                          </button>
                          {r.status === "running" && (
                            <div className="flex items-center gap-1 text-[11px] text-accent">
                              <Loader2 size={11} className="animate-spin" /> {t(PHASE[r.phase] ?? r.phase)}
                            </div>
                          )}
                          {r.status === "queued" && <div className="text-[11px] text-fg-subtle">{t("en attente")}</div>}
                          {r.status === "stopped" && <div className="text-[11px] text-fg-subtle">{t("arrêté")}</div>}
                          {r.status === "error" && <div className="text-[11px] text-red-400">{r.error}</div>}
                        </td>
                        <td className="py-2 text-right">
                          {res ? (
                            <Badge color={ok ? "#10b981" : res.passed ? "#f59e0b" : "#ef4444"}>
                              {res.passed}/{res.total}
                            </Badge>
                          ) : (
                            "—"
                          )}
                        </td>
                        <td className="py-2 text-right tabular-nums">{res ? `${res.done}/${res.tasks}` : "—"}</td>
                        <td className="py-2 text-right tabular-nums">{res ? `${res.firstTry}/${res.tasks}` : "—"}</td>
                        <td className="py-2 text-right tabular-nums">{res ? res.attempts : "—"}</td>
                        <td className="py-2 text-right tabular-nums">{res ? fmtMs(res.planMs + res.buildMs) : "—"}</td>
                        <td className="py-2 text-right tabular-nums">{res ? res.modelCalls : "—"}</td>
                        <td className="py-2 text-right tabular-nums">{res ? `${fmtTok(res.promptTokens)} / ${fmtTok(res.completionTokens)}` : "—"}</td>
                        <td className={cx("py-2 text-right tabular-nums", res?.modelErrors ? "text-red-400" : "")}>{res ? res.modelErrors : "—"}</td>
                        <td className="py-2 pl-2 text-right">
                          {i === 0 && !runs.some((x) => x.status === "running" || x.status === "queued") && (
                            <button
                              title={t("Supprimer ces résultats")}
                              aria-label={t("Supprimer ces résultats")}
                              className="text-fg-subtle hover:text-red-400"
                              onClick={async () => (await api(`/api/bench?batch=${r.batch}`, { method: "DELETE" }), reload())}
                            >
                              <Trash2 size={13} />
                            </button>
                          )}
                        </td>
                      </tr>
                      {open === r.id && res && (
                        <tr>
                          <td />
                          <td colSpan={10} className="pb-3">
                            <ul className="space-y-1">
                              {res.checks.map((ch) => (
                                <li key={ch.name} className="flex items-start gap-2">
                                  {ch.ok ? <CheckCircle2 size={13} className="mt-0.5 shrink-0 text-emerald-400" /> : <XCircle size={13} className="mt-0.5 shrink-0 text-red-400" />}
                                  <span>
                                    {ch.name}
                                    {ch.detail && <pre className="mt-1 max-h-40 overflow-auto whitespace-pre-wrap rounded bg-surface-0 p-2 font-mono text-[10px] text-fg-muted">{ch.detail}</pre>}
                                  </span>
                                </li>
                              ))}
                            </ul>
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                });
              })}
            </tbody>
          </table>
        ) : (
          <p className="text-sm text-fg-muted">{t("Aucun résultat pour l'instant : choisis des scénarios et lance un premier banc d'essai.")}</p>
        )}
      </Card>
    </div>
  );
}
