"use client";

import { Brain, CheckCircle2, Code2, Cpu, Database, Eye, Feather, Gauge, HardDrive, Loader2, MemoryStick, MessageSquare, Play, RefreshCw, TriangleAlert, XCircle, Zap } from "lucide-react";
import { useState } from "react";
import { useT } from "@/i18n";
import type { Assessment, Hardware, Use } from "@/lib/machine";
import { api, useData } from "../api";
import { Badge, Button, cx, ErrorNote, PageHeader } from "../ui";

type MachineInfo = {
  hardware: Hardware;
  numCtx: number;
  defaults: { chat: string; embedding: string };
  ollama: { version?: string; installed: { name: string; size: number; parameter_size?: string }[]; loaded: { name: string; size: number; size_vram: number }[]; error?: string };
  models: Assessment[];
  recommendations: { use: Use; best?: string; lighter?: string; ambitious?: string }[];
};
type Bench = { tokensPerSec?: number; promptTokensPerSec?: number; loadSec?: number; error?: string };

const USES: Record<Use, { label: string; hint: string; icon: typeof Brain }> = {
  general: { label: "Agents et chat", hint: "Modèle par défaut des agents : outils et bon français", icon: MessageSquare },
  code: { label: "Code", hint: "Développeurs, revue de code, scripts", icon: Code2 },
  reasoning: { label: "Raisonnement", hint: "Chefs d'équipe, planification, décisions", icon: Brain },
  vision: { label: "Vision", hint: "Lire des images, captures et documents scannés", icon: Eye },
  light: { label: "Rapide et léger", hint: "Tâches simples, tri, résumés courts", icon: Feather },
  embedding: { label: "Embeddings (RAG)", hint: "Indexation et recherche dans les connaissances", icon: Database },
};
// Status colours carry an icon and a label too, never colour alone.
const FIT = {
  smooth: { label: "Fluide", color: "#10b981", icon: CheckCircle2 },
  tight: { label: "Possible, serré", color: "#f59e0b", icon: TriangleAlert },
  too_big: { label: "Trop lourd", color: "#ef4444", icon: XCircle },
} as const;

function FitBadge({ fit }: { fit: Assessment["fit"] }) {
  const { t } = useT();
  const f = FIT[fit];
  return (
    <span className="inline-flex items-center gap-1 text-[11px] font-medium" style={{ color: f.color }}>
      <f.icon size={12} /> {t(f.label)}
    </span>
  );
}

function Stat({ icon: Icon, label, value, sub }: { icon: typeof Cpu; label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-xl border border-line bg-surface-1 p-4">
      <div className="flex items-center gap-2 text-xs text-fg-muted">
        <Icon size={14} /> {label}
      </div>
      <div className="mt-1 text-lg font-semibold">{value}</div>
      {sub && <div className="text-xs text-fg-subtle">{sub}</div>}
    </div>
  );
}

export function MachineView({ onChange }: { onChange: () => void }) {
  const { t, lang } = useT();
  const info = useData<MachineInfo>("/api/machine");
  const [useFilter, setUseFilter] = useState<Use | null>(null);
  const [hideTooBig, setHideTooBig] = useState(false);
  const [pulling, setPulling] = useState<{ model: string; pct?: number; status: string } | null>(null);
  const [bench, setBench] = useState<Record<string, Bench | "running">>({});
  const [error, setError] = useState<string>();
  const [notice, setNotice] = useState<string>();
  const d = info.data;
  const hw = d?.hardware;
  const byName = new Map((d?.models ?? []).map((m) => [m.name, m]));
  const gb = (n: number) => `${n < 10 ? n.toFixed(1) : Math.round(n)} ${lang === "en" ? "GB" : "Go"}`;

  async function install(model: string) {
    if (pulling) return;
    setError(undefined);
    setNotice(undefined);
    setPulling({ model, status: "" });
    try {
      const r = await fetch("/api/ollama", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "pull", model }) });
      if (!r.ok || !r.body) throw new Error((await r.json().catch(() => ({}))).error ?? `HTTP ${r.status}`);
      const reader = r.body.getReader();
      const dec = new TextDecoder();
      let buf = "";
      let ok = false;
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        const lines = buf.split("\n");
        buf = lines.pop() ?? "";
        for (const l of lines.filter((x) => x.trim())) {
          const j = JSON.parse(l) as { status?: string; total?: number; completed?: number; error?: string };
          if (j.error) throw new Error(j.error);
          if (j.status === "success") ok = true;
          setPulling({ model, status: j.status ?? "", pct: j.total ? Math.round(((j.completed ?? 0) / j.total) * 100) : undefined });
        }
      }
      if (!ok) throw new Error(t("Téléchargement interrompu avant la fin"));
      setNotice(t("{model} est installé.", { model }));
      info.reload();
      onChange();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setPulling(null);
    }
  }

  async function makeDefault(model: string, kind: "chat" | "embedding") {
    await api("/api/settings", { method: "POST", json: kind === "chat" ? { default_model: `ollama/${model}` } : { embedding_model: `ollama/${model}` } });
    setNotice(
      kind === "chat"
        ? t("{model} est maintenant le modèle par défaut des agents.", { model })
        : t("{model} est maintenant le modèle d'embedding. Réindexe les bases de connaissances pour en profiter.", { model }),
    );
    info.reload();
    onChange();
  }

  async function runBench(model: string) {
    setBench((b) => ({ ...b, [model]: "running" }));
    try {
      const r = await api<Bench>("/api/machine/bench", { method: "POST", json: { model } });
      setBench((b) => ({ ...b, [model]: r }));
    } catch (e) {
      setBench((b) => ({ ...b, [model]: { error: e instanceof Error ? e.message : String(e) } }));
    }
  }

  function actions(m: Assessment, kind: "chat" | "embedding") {
    const isDefault = kind === "chat" ? d?.defaults.chat === m.name : d?.defaults.embedding === m.name;
    if (!m.installed)
      return (
        <Button size="sm" onClick={() => install(m.name)} disabled={!!pulling || m.fit === "too_big"} title={m.fit === "too_big" ? t("Trop lourd pour cette machine") : undefined}>
          {pulling?.model === m.name ? (
            <>
              <Loader2 size={12} className="animate-spin" /> {pulling.pct !== undefined ? `${pulling.pct} %` : "…"}
            </>
          ) : (
            t("Installer ({size})", { size: gb(m.sizeGB) })
          )}
        </Button>
      );
    return isDefault ? (
      <Badge color="#7c6cf6">{t("par défaut")}</Badge>
    ) : (
      <Button size="sm" variant="soft" onClick={() => makeDefault(m.name, kind)}>
        {t("Utiliser par défaut")}
      </Button>
    );
  }

  const catalog = (d?.models ?? []).filter((m) => (!useFilter || m.uses.includes(useFilter)) && (!hideTooBig || m.fit !== "too_big"));
  const maxNeed = Math.max(hw?.modelMemoryGB ?? 1, ...(d?.models ?? []).map((m) => m.needGB));
  const caps = (m: Assessment) => [m.tools && t("outils"), m.thinking && t("réflexion"), m.vision && t("images"), m.uses.includes("embedding") && "embeddings"].filter(Boolean).join(" · ");

  return (
    <div className="flex h-full flex-col">
      <PageHeader
        title={t("Machine")}
        subtitle={t("Performances de cet ordinateur et modèles Ollama les plus adaptés.")}
        actions={
          <Button onClick={info.reload}>
            <RefreshCw size={15} /> {t("Actualiser")}
          </Button>
        }
      />
      <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">
        {!d || !hw ? (
          <div className="flex items-center gap-2 text-sm text-fg-muted">
            <Loader2 size={15} className="animate-spin" /> {t("Analyse de la machine…")}
          </div>
        ) : (
          <div className="flex flex-col gap-6">
            <ErrorNote>{error}</ErrorNote>
            {notice && (
              <div className="flex items-center gap-2 rounded-lg bg-emerald-500/10 px-3 py-2 text-sm text-emerald-400">
                <CheckCircle2 size={15} /> {notice}
              </div>
            )}

            {/* hardware */}
            <section className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-5">
              <Stat
                icon={Cpu}
                label={t("Processeur")}
                value={hw.cpu}
                sub={`${t("{n} cœurs", { n: hw.cores })}${hw.perfCores ? ` (${t("{p} performance", { p: hw.perfCores })})` : ""} · ${hw.os}`}
              />
              <Stat icon={MemoryStick} label={hw.unified ? t("Mémoire unifiée") : t("Mémoire vive")} value={gb(hw.ramGB)} sub={t("{free} libres en ce moment", { free: gb(hw.freeRamGB) })} />
              <Stat
                icon={Gauge}
                label={t("Accélération")}
                value={hw.acceleration === "metal" ? t("GPU Apple (Metal)") : hw.acceleration === "cuda" ? t("GPU NVIDIA (CUDA)") : t("Processeur seul")}
                sub={hw.gpus.map((g) => [g.name, g.cores && t("{n} cœurs GPU", { n: g.cores }), g.vramGB && gb(g.vramGB)].filter(Boolean).join(" · ")).join(", ") || t("Aucun GPU détecté")}
              />
              <Stat icon={HardDrive} label={t("Disque disponible")} value={hw.diskFreeGB !== undefined ? gb(hw.diskFreeGB) : "—"} sub={t("Les modèles sont stockés dans ~/.ollama")} />
              <Stat
                icon={Zap}
                label="Ollama"
                value={d.ollama.version ? `v${d.ollama.version}` : t("injoignable")}
                sub={d.ollama.error || t("{n} modèle(s) installé(s), {l} chargé(s)", { n: d.ollama.installed.length, l: d.ollama.loaded.length })}
              />
            </section>

            {/* memory budget */}
            <section className="rounded-xl border border-line bg-surface-1 p-4">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <div className="text-sm font-semibold">{t("Mémoire disponible pour les modèles : ≈ {n}", { n: gb(hw.modelMemoryGB) })}</div>
                <div className="text-xs text-fg-subtle">{t("Contexte réglé à {n} tokens · bande passante ≈ {bw} Go/s", { n: d.numCtx, bw: hw.bandwidthGBs })}</div>
              </div>
              <p className="mt-1 text-xs text-fg-muted">
                {hw.unified
                  ? t("Sur Mac, le GPU partage la mémoire avec le système : environ deux tiers sont utilisables par un modèle. Un modèle doit tenir entièrement dans cette enveloppe, avec son contexte, pour rester rapide.")
                  : hw.acceleration === "cuda"
                    ? t("Un modèle qui dépasse la mémoire du GPU déborde sur la mémoire vive et devient beaucoup plus lent.")
                    : t("Sans GPU, les modèles tournent sur le processeur : privilégie les petits modèles (4B et moins).")}
              </p>
              {d.ollama.loaded.length > 0 && (
                <div className="mt-3 flex flex-wrap items-center gap-2 text-xs">
                  <span className="text-fg-subtle">{t("Chargés maintenant :")}</span>
                  {d.ollama.loaded.map((m) => (
                    <Badge key={m.name}>
                      {m.name} · {gb(m.size / 1024 ** 3)}
                      {m.size_vram < m.size ? ` · ${t("{p} % sur GPU", { p: Math.round((m.size_vram / m.size) * 100) })}` : ""}
                    </Badge>
                  ))}
                </div>
              )}
            </section>

            {/* recommendations */}
            <section>
              <h2 className="mb-3 text-sm font-semibold">{t("Recommandations pour cette machine")}</h2>
              <div className="grid grid-cols-1 gap-3 md:grid-cols-2 2xl:grid-cols-3">
                {d.recommendations.map((r) => {
                  const u = USES[r.use];
                  const best = r.best ? byName.get(r.best) : undefined;
                  return (
                    <div key={r.use} className="flex flex-col gap-3 rounded-xl border border-line bg-surface-1 p-4">
                      <div className="flex items-start gap-2">
                        <u.icon size={16} className="mt-0.5 text-accent" />
                        <div>
                          <div className="text-sm font-semibold">{t(u.label)}</div>
                          <div className="text-xs text-fg-muted">{t(u.hint)}</div>
                        </div>
                      </div>
                      {best ? (
                        <div className="rounded-lg border border-line bg-surface-2 p-3">
                          <div className="flex items-center gap-2">
                            <span className="font-mono text-sm font-semibold">{best.name}</span>
                            {best.installed && <Badge>{t("installé")}</Badge>}
                            <span className="ml-auto">
                              <FitBadge fit={best.fit} />
                            </span>
                          </div>
                          <div className="mt-1 text-xs text-fg-muted">{t(best.note)}</div>
                          <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-fg-subtle">
                            <span>{t("≈ {n} en mémoire", { n: gb(best.needGB) })}</span>
                            {best.tokensPerSec && <span>{t("≈ {n} tokens/s estimés", { n: best.tokensPerSec })}</span>}
                            {caps(best) && <span>{caps(best)}</span>}
                            <span className="ml-auto">{actions(best, r.use === "embedding" ? "embedding" : "chat")}</span>
                          </div>
                        </div>
                      ) : (
                        <div className="text-xs text-fg-subtle">{t("Aucun modèle de cette catégorie ne tient confortablement dans la mémoire disponible.")}</div>
                      )}
                      {(r.lighter || r.ambitious) && (
                        <div className="flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-fg-muted">
                          {r.lighter && (
                            <span>
                              {t("Plus rapide :")} <span className="font-mono text-fg">{r.lighter}</span>
                            </span>
                          )}
                          {r.ambitious && (
                            <span>
                              {t("Plus ambitieux (serré) :")} <span className="font-mono text-fg">{r.ambitious}</span>
                            </span>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </section>

            {/* installed: real speed */}
            {d.ollama.installed.length > 0 && (
              <section>
                <h2 className="mb-1 text-sm font-semibold">{t("Vitesse réelle des modèles installés")}</h2>
                <p className="mb-3 text-xs text-fg-muted">{t("Un test court (environ 160 tokens) mesure la vitesse de génération sur cette machine. Le premier test charge le modèle en mémoire.")}</p>
                <div className="overflow-hidden rounded-xl border border-line">
                  {d.ollama.installed.map((m) => {
                    const b = bench[m.name];
                    const est = byName.get(m.name.replace(/:latest$/, ""))?.tokensPerSec;
                    const isEmbedding = /embed|bge|nomic/i.test(m.name);
                    return (
                      <div key={m.name} className="flex flex-wrap items-center gap-3 border-b border-line bg-surface-1 px-4 py-2.5 text-sm last:border-0">
                        <span className="min-w-48 font-mono">{m.name}</span>
                        <span className="text-xs text-fg-subtle">
                          {gb(m.size / 1024 ** 3)}
                          {m.parameter_size ? ` · ${m.parameter_size}` : ""}
                        </span>
                        {est && <span className="text-xs text-fg-subtle">{t("estimé ≈ {n} tok/s", { n: est })}</span>}
                        <span className="ml-auto flex items-center gap-3">
                          {b === "running" ? (
                            <span className="flex items-center gap-1.5 text-xs text-fg-muted">
                              <Loader2 size={13} className="animate-spin" /> {t("test en cours…")}
                            </span>
                          ) : b?.error ? (
                            <span className="text-xs text-red-400">{b.error}</span>
                          ) : b ? (
                            <span className="text-xs">
                              <b className="text-sm text-emerald-400">{b.tokensPerSec} tok/s</b>
                              <span className="text-fg-subtle">
                                {" · "}
                                {t("lecture {n} tok/s", { n: b.promptTokensPerSec ?? "—" })}
                                {b.loadSec ? ` · ${t("chargement {n} s", { n: b.loadSec })}` : ""}
                              </span>
                            </span>
                          ) : null}
                          {!isEmbedding && (
                            <Button size="sm" variant="soft" onClick={() => runBench(m.name)} disabled={b === "running"}>
                              <Play size={12} /> {t("Tester la vitesse")}
                            </Button>
                          )}
                        </span>
                      </div>
                    );
                  })}
                </div>
              </section>
            )}

            {/* full catalogue */}
            <section>
              <div className="mb-3 flex flex-wrap items-center gap-2">
                <h2 className="mr-2 text-sm font-semibold">{t("Catalogue")}</h2>
                <button onClick={() => setUseFilter(null)} className={cx("rounded-full border px-2.5 py-1 text-xs", !useFilter ? "border-accent bg-accent/15" : "border-line text-fg-muted hover:text-fg")}>
                  {t("Tous")}
                </button>
                {(Object.keys(USES) as Use[]).map((u) => (
                  <button
                    key={u}
                    onClick={() => setUseFilter(useFilter === u ? null : u)}
                    className={cx("rounded-full border px-2.5 py-1 text-xs", useFilter === u ? "border-accent bg-accent/15" : "border-line text-fg-muted hover:text-fg")}
                  >
                    {t(USES[u].label)}
                  </button>
                ))}
                <label className="ml-auto flex items-center gap-2 text-xs text-fg-muted">
                  <input type="checkbox" checked={hideTooBig} onChange={(e) => setHideTooBig(e.target.checked)} className="accent-[var(--accent)]" />
                  {t("Masquer les modèles trop lourds")}
                </label>
              </div>
              <div className="overflow-x-auto rounded-xl border border-line">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-line bg-surface-1 text-left text-xs text-fg-muted">
                      <th className="px-4 py-2 font-medium">{t("Modèle")}</th>
                      <th className="px-4 py-2 font-medium">{t("Mémoire nécessaire")}</th>
                      <th className="px-4 py-2 font-medium">{t("Verdict")}</th>
                      <th className="px-4 py-2 text-right font-medium">{t("Vitesse estimée")}</th>
                      <th className="px-4 py-2 font-medium">{t("Capacités")}</th>
                      <th className="px-4 py-2" />
                    </tr>
                  </thead>
                  <tbody>
                    {catalog.map((m) => (
                      <tr key={m.name} className="border-b border-line last:border-0">
                        <td className="px-4 py-2">
                          <div className="font-mono text-sm">{m.name}</div>
                          <div className="text-[11px] text-fg-subtle">{t(m.note)}</div>
                        </td>
                        <td className="w-56 px-4 py-2">
                          {/* need vs the memory available for models (dashed marker) */}
                          <div className="relative h-2 rounded-full bg-surface-3">
                            <div className="h-2 rounded-full" style={{ width: `${Math.min(100, (m.needGB / maxNeed) * 100)}%`, background: FIT[m.fit].color }} />
                            <div className="absolute -top-1 h-4 border-l-2 border-dashed border-fg-muted" style={{ left: `${(hw.modelMemoryGB / maxNeed) * 100}%` }} title={t("Mémoire disponible")} />
                          </div>
                          <div className="mt-1 text-[11px] text-fg-subtle">
                            {gb(m.needGB)} / {gb(hw.modelMemoryGB)}
                          </div>
                        </td>
                        <td className="px-4 py-2">
                          <FitBadge fit={m.fit} />
                        </td>
                        <td className="px-4 py-2 text-right text-xs tabular-nums">{m.tokensPerSec ? `≈ ${m.tokensPerSec} tok/s` : "—"}</td>
                        <td className="px-4 py-2 text-[11px] text-fg-muted">{caps(m) || "—"}</td>
                        <td className="px-4 py-2 text-right">{actions(m, m.uses.includes("embedding") ? "embedding" : "chat")}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="mt-2 text-[11px] text-fg-subtle">
                {t("Estimations : poids du modèle (quantification par défaut ≈ Q4) + cache de contexte. La vitesse dépend de la bande passante mémoire ; le test réel ci-dessus fait foi.")}
              </p>
            </section>
          </div>
        )}
      </div>
    </div>
  );
}
