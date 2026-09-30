"use client";

import { Download, Play, Plus, Power, RefreshCw, Trash2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { api, crud, formatBytes, useData, type Provider } from "../api";
import { Badge, Button, Card, cx, ErrorNote, Field, Input, PageHeader } from "../ui";

type Installed = { name: string; size: number; family?: string; parameter_size?: string; quantization?: string; capabilities: string[] };
type Loaded = { name: string; size: number; size_vram: number; expires_at: string; context_length?: number };
type OllamaState = { provider: { id: string; name: string; base_url: string }; version?: string; installed: Installed[]; loaded: Loaded[] };

/** Popular local models (tool-capable chat models first, then embeddings). */
const SUGGESTED: [string, string][] = [
  ["qwen3:4b", "léger, outils + réflexion"],
  ["qwen3:8b", "bon équilibre, outils + réflexion"],
  ["qwen3:14b", "plus fiable pour les chefs d'équipe (≈ 10 Go de RAM)"],
  ["llama3.1:8b", "généraliste, outils"],
  ["qwen2.5-coder:7b", "code, outils"],
  ["nomic-embed-text", "embedding pour le RAG"],
  ["bge-m3", "embedding multilingue pour le RAG"],
];

const CAP_COLOR: Record<string, string> = { tools: "#10b981", thinking: "#8b5cf6", vision: "#06b6d4", embedding: "#f59e0b", completion: "#64748b" };

export function ModelsView({ onChange }: { onChange: () => void }) {
  const [tab, setTab] = useState<"models" | "usage" | "hosts" | "proxy">("models");
  const providers = useData<Provider[]>("/api/crud/providers");
  const [host, setHost] = useState<string>("");
  const hostId = host || providers.data?.find((p) => p.enabled)?.id || "";
  return (
    <div>
      <PageHeader
        title="Modèles"
        subtitle="Tout tourne en local sur Ollama. Millikin suit chaque appel et expose un proxy compatible OpenAI."
        actions={
          <div className="flex rounded-lg border border-line p-0.5">
            {(
              [
                ["models", "Modèles"],
                ["usage", "Utilisation"],
                ["hosts", "Hôtes Ollama"],
                ["proxy", "Proxy API"],
              ] as const
            ).map(([id, label]) => (
              <button key={id} onClick={() => setTab(id)} className={cx("rounded-md px-3 py-1 text-sm", tab === id ? "bg-surface-3 text-fg" : "text-fg-muted")}>
                {label}
              </button>
            ))}
          </div>
        }
      />
      <div className="p-6">
        {tab === "models" && hostId && <Models hostId={hostId} providers={providers.data ?? []} onHost={setHost} onChange={onChange} />}
        {tab === "usage" && <Usage />}
        {tab === "hosts" && <Hosts providers={providers.data ?? []} reload={() => (providers.reload(), onChange())} />}
        {tab === "proxy" && <Proxy />}
      </div>
    </div>
  );
}

function Models({ hostId, providers, onHost, onChange }: { hostId: string; providers: Provider[]; onHost: (id: string) => void; onChange: () => void }) {
  const st = useData<OllamaState>(`/api/ollama?providerId=${hostId}`);
  const [pull, setPull] = useState("");
  const [progress, setProgress] = useState<{ model: string; status: string; pct?: number } | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [syncMsg, setSyncMsg] = useState<string | null>(null);
  const [tests, setTests] = useState<Record<string, string>>({});
  const [error, setError] = useState<string>();
  const pullCtrl = useRef<AbortController | null>(null);
  const loaded = new Map((st.data?.loaded ?? []).map((l) => [l.name, l]));
  const installed = new Set((st.data?.installed ?? []).map((m) => m.name));
  const act = (action: string, model: string) => api("/api/ollama", { method: "POST", json: { action, model, providerId: hostId } });

  // Loaded models and CLI-side changes show up without a manual refresh.
  useEffect(() => {
    const t = setInterval(st.reload, 10000);
    return () => clearInterval(t);
  }, [st.reload]);

  /** Re-read the installed models from Ollama and sync the catalog used by agent/model pickers. */
  async function refresh() {
    setSyncMsg("synchronisation…");
    try {
      const r = await api<{ added: number; total: number }>("/api/ollama", { method: "POST", json: { action: "sync", providerId: hostId } });
      setSyncMsg(`✓ ${r.total} modèle(s) sur Ollama${r.added ? `, ${r.added} nouveau(x)` : ""}`);
      st.reload();
      onChange();
    } catch (e) {
      setSyncMsg(null);
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  /** Equivalent of `ollama pull <model>`, with live progress; Annuler stops the download. */
  async function doPull(name = pull.trim()) {
    if (!name || progress) return;
    setError(undefined);
    setDone(null);
    setProgress({ model: name, status: "démarrage…" });
    const ctrl = new AbortController();
    pullCtrl.current = ctrl;
    try {
      const r = await fetch("/api/ollama", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "pull", model: name, providerId: hostId }),
        signal: ctrl.signal,
      });
      if (!r.ok || !r.body) throw new Error((await r.json().catch(() => ({}))).error ?? `HTTP ${r.status}`);
      const reader = r.body.getReader();
      const dec = new TextDecoder();
      let buf = "";
      let ok = false;
      for (;;) {
        const { value, done: end } = await reader.read();
        if (end) break;
        buf += dec.decode(value, { stream: true });
        const lines = buf.split("\n");
        buf = lines.pop() ?? "";
        for (const l of lines) {
          if (!l.trim()) continue;
          const j = JSON.parse(l) as { status?: string; total?: number; completed?: number; error?: string };
          if (j.error) throw new Error(j.error.includes("file does not exist") ? `« ${name} » n'existe pas dans la bibliothèque Ollama (vérifie le nom et le tag).` : j.error);
          if (j.status === "success") ok = true;
          setProgress({ model: name, status: j.status ?? "", pct: j.total ? Math.round(((j.completed ?? 0) / j.total) * 100) : undefined });
        }
      }
      if (!ok) throw new Error("Téléchargement interrompu avant la fin");
      setPull("");
      setDone(name);
      await refresh();
    } catch (e) {
      setError(ctrl.signal.aborted ? `Téléchargement de ${name} annulé.` : e instanceof Error ? e.message : String(e));
    } finally {
      setProgress(null);
      pullCtrl.current = null;
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-3">
        {providers.length > 1 && (
          <select className="h-9 rounded-lg border border-line bg-surface-1 px-2 text-sm" value={hostId} onChange={(e) => onHost(e.target.value)}>
            {providers.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        )}
        <span className="text-sm text-fg-muted">
          {st.data ? `${st.data.provider.name} · Ollama ${st.data.version ?? "?"} · ${st.data.installed.length} modèles` : st.error ? "" : "Connexion…"}
        </span>
        <Button size="sm" variant="soft" onClick={refresh} title="Relire les modèles installés sur Ollama et mettre à jour les listes de modèles de l'appli">
          <RefreshCw size={13} /> Rafraîchir depuis Ollama
        </Button>
        {syncMsg && <span className="text-xs text-fg-muted">{syncMsg}</span>}
      </div>
      <ErrorNote>{st.error && `Ollama injoignable : ${st.error}. Lance « ollama serve » ou vérifie l'hôte.`}</ErrorNote>
      <ErrorNote>{error}</ErrorNote>

      <Card className="flex flex-col gap-3 p-3">
        <div className="flex flex-wrap items-end gap-2">
          <Field
            label="Télécharger un modèle (ollama pull)"
            className="min-w-64 flex-1"
            hint={
              <>
                Nom et tag de la{" "}
                <a href="https://ollama.com/library" target="_blank" rel="noreferrer" className="text-accent hover:underline">
                  bibliothèque Ollama
                </a>
                , ex : qwen3:14b, llama3.1:8b, bge-m3. Attention à la place disque et à la mémoire.
              </>
            }
          >
            <Input value={pull} onChange={(e) => setPull(e.target.value)} placeholder="qwen3:14b" onKeyDown={(e) => e.key === "Enter" && doPull()} disabled={!!progress} />
          </Field>
          {progress ? (
            <Button variant="danger" onClick={() => pullCtrl.current?.abort()}>
              Annuler
            </Button>
          ) : (
            <Button variant="primary" onClick={() => doPull()} disabled={!pull.trim()}>
              <Download size={14} /> Télécharger
            </Button>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-[11px] text-fg-subtle">Suggestions :</span>
          {SUGGESTED.map(([name, why]) => (
            <button
              key={name}
              disabled={!!progress || installed.has(name)}
              onClick={() => (setPull(name), doPull(name))}
              title={installed.has(name) ? "déjà installé" : why}
              className={cx(
                "rounded-md border px-2 py-0.5 font-mono text-[11px]",
                installed.has(name) ? "border-emerald-500/30 text-emerald-400" : "border-line text-fg-muted hover:border-line-strong hover:text-fg",
              )}
            >
              {installed.has(name) ? "✓ " : ""}
              {name}
            </button>
          ))}
        </div>
        {progress && (
          <div>
            <div className="mb-1 flex justify-between text-xs text-fg-muted">
              <span>
                <span className="font-mono">{progress.model}</span> · {progress.status}
              </span>
              {progress.pct !== undefined && <span className="tabular-nums">{progress.pct}%</span>}
            </div>
            <div className="h-1.5 overflow-hidden rounded-full bg-surface-3">
              <div className="h-full bg-accent transition-all" style={{ width: `${progress.pct ?? 3}%` }} />
            </div>
          </div>
        )}
        {done && <div className="text-xs text-emerald-400">✓ {done} est installé et disponible dans les listes de modèles.</div>}
      </Card>

      <Card className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="text-left text-xs text-fg-subtle">
            <tr className="border-b border-line">
              <th className="px-3 py-2 font-medium">Modèle</th>
              <th className="px-3 py-2 font-medium">Taille</th>
              <th className="px-3 py-2 font-medium">Capacités</th>
              <th className="px-3 py-2 font-medium">Mémoire</th>
              <th className="px-3 py-2" />
            </tr>
          </thead>
          <tbody>
            {(st.data?.installed ?? []).map((m) => {
              const l = loaded.get(m.name);
              return (
                <tr key={m.name} className="border-b border-line last:border-0">
                  <td className="px-3 py-2.5">
                    <div className="font-mono text-[13px]">{m.name}</div>
                    <div className="text-xs text-fg-subtle">{[m.family, m.parameter_size, m.quantization].filter(Boolean).join(" · ")}</div>
                    {tests[m.name] && <div className="mt-1 text-xs text-fg-muted">{tests[m.name]}</div>}
                  </td>
                  <td className="px-3 py-2.5 text-fg-muted">{formatBytes(m.size)}</td>
                  <td className="px-3 py-2.5">
                    <div className="flex flex-wrap gap-1">
                      {m.capabilities
                        .filter((c) => c !== "completion")
                        .map((c) => (
                          <Badge key={c} color={CAP_COLOR[c]}>
                            {c}
                          </Badge>
                        ))}
                    </div>
                  </td>
                  <td className="px-3 py-2.5 text-xs">
                    {l ? (
                      <span className="text-emerald-400">
                        ● chargé · {formatBytes(l.size_vram || l.size)}
                        {l.context_length ? ` · ctx ${l.context_length}` : ""}
                      </span>
                    ) : (
                      <span className="text-fg-subtle">—</span>
                    )}
                  </td>
                  <td className="px-3 py-2.5">
                    <div className="flex justify-end gap-1">
                      {!m.capabilities.includes("embedding") && (
                        <Button
                          size="sm"
                          variant="ghost"
                          title="Tester"
                          onClick={async () => {
                            setTests((t) => ({ ...t, [m.name]: "test en cours…" }));
                            const r = await api<{ ok: boolean; reply?: string; error?: string; latency_ms: number }>("/api/gateway/test", {
                              method: "POST",
                              json: { model: `${providers.find((p) => p.id === hostId)?.slug}/${m.name}` },
                            }).catch((e) => ({ ok: false, error: String(e.message), latency_ms: 0, reply: undefined }));
                            setTests((t) => ({ ...t, [m.name]: r.ok ? `✓ « ${r.reply} » en ${(r.latency_ms / 1000).toFixed(1)} s` : `✗ ${r.error}` }));
                            st.reload();
                          }}
                        >
                          <Play size={13} />
                        </Button>
                      )}
                      {l && (
                        <Button size="sm" variant="ghost" title="Décharger de la mémoire" onClick={async () => (await act("unload", m.name), st.reload())}>
                          <Power size={13} />
                        </Button>
                      )}
                      <Button
                        size="sm"
                        variant="ghost"
                        title="Supprimer du disque"
                        onClick={async () => {
                          if (!confirm(`Supprimer ${m.name} du disque (${formatBytes(m.size)}) ?`)) return;
                          await act("delete", m.name);
                          st.reload();
                          onChange();
                        }}
                      >
                        <Trash2 size={13} />
                      </Button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </Card>
      <p className="text-xs text-fg-subtle">
        Pour les agents, privilégie les modèles avec le badge <b>tools</b>. Les modèles <b>embedding</b> servent au RAG (réglable dans Réglages).
      </p>
    </div>
  );
}

type UsageData = {
  totals: { calls: number; prompt_tokens: number; completion_tokens: number; avg_latency: number; errors: number };
  byModel: { provider: string; model: string; calls: number; prompt_tokens: number; completion_tokens: number; avg_latency: number; errors: number }[];
  byAgent: { agent_id: string; name: string; emoji: string; calls: number; tokens: number; avg_latency: number }[];
  recent: { id: number; ts: number; model: string; source: string; agent_name?: string; prompt_tokens: number; completion_tokens: number; latency_ms: number; status: string; error?: string }[];
};

function Usage() {
  const [days, setDays] = useState(7);
  const u = useData<UsageData>(`/api/gateway/usage?days=${days}`);
  const t = u.data?.totals;
  const n = (x: number) => Math.round(x || 0).toLocaleString("fr-FR");
  return (
    <div className="flex flex-col gap-4">
      <div className="flex gap-1">
        {[1, 7, 30].map((d) => (
          <Button key={d} size="sm" variant={days === d ? "soft" : "ghost"} onClick={() => setDays(d)}>
            {d === 1 ? "24 h" : `${d} jours`}
          </Button>
        ))}
        <Button size="sm" variant="ghost" onClick={u.reload}>
          <RefreshCw size={13} />
        </Button>
      </div>
      {t && (
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          {[
            ["Appels", n(t.calls)],
            ["Tokens entrée / sortie", `${n(t.prompt_tokens)} / ${n(t.completion_tokens)}`],
            ["Latence moyenne", `${(t.avg_latency / 1000).toFixed(1)} s`],
            ["Erreurs", n(t.errors)],
          ].map(([label, value]) => (
            <Card key={label} className="p-3">
              <div className="text-xs text-fg-muted">{label}</div>
              <div className="mt-1 text-lg font-semibold tabular-nums">{value}</div>
            </Card>
          ))}
        </div>
      )}
      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="overflow-x-auto">
          <div className="border-b border-line px-3 py-2 text-sm font-medium">Par modèle</div>
          <table className="w-full text-xs">
            <tbody>
              {u.data?.byModel.map((m) => (
                <tr key={m.model} className="border-b border-line last:border-0">
                  <td className="px-3 py-2 font-mono">{m.model}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{n(m.calls)} appels</td>
                  <td className="px-3 py-2 text-right tabular-nums text-fg-muted">{n(m.prompt_tokens + m.completion_tokens)} tok</td>
                  <td className="px-3 py-2 text-right tabular-nums text-fg-muted">{(m.avg_latency / 1000).toFixed(1)} s</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
        <Card className="overflow-x-auto">
          <div className="border-b border-line px-3 py-2 text-sm font-medium">Par agent</div>
          <table className="w-full text-xs">
            <tbody>
              {u.data?.byAgent.map((a) => (
                <tr key={a.agent_id} className="border-b border-line last:border-0">
                  <td className="px-3 py-2">
                    {a.emoji ?? "🤖"} {a.name ?? "agent supprimé"}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">{n(a.calls)} appels</td>
                  <td className="px-3 py-2 text-right tabular-nums text-fg-muted">{n(a.tokens)} tok</td>
                  <td className="px-3 py-2 text-right tabular-nums text-fg-muted">{(a.avg_latency / 1000).toFixed(1)} s</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      </div>
      <Card className="overflow-x-auto">
        <div className="border-b border-line px-3 py-2 text-sm font-medium">Derniers appels</div>
        <table className="w-full text-xs">
          <tbody>
            {u.data?.recent.map((r) => (
              <tr key={r.id} className="border-b border-line last:border-0">
                <td className="whitespace-nowrap px-3 py-1.5 text-fg-subtle">{new Date(r.ts).toLocaleTimeString("fr-FR")}</td>
                <td className="px-3 py-1.5 font-mono">{r.model}</td>
                <td className="px-3 py-1.5 text-fg-muted">{r.agent_name ?? r.source}</td>
                <td className="px-3 py-1.5 text-right tabular-nums text-fg-muted">
                  {r.prompt_tokens}→{r.completion_tokens}
                </td>
                <td className="px-3 py-1.5 text-right tabular-nums text-fg-muted">{(r.latency_ms / 1000).toFixed(1)} s</td>
                <td className="px-3 py-1.5" title={r.error}>
                  {r.status === "ok" ? <span className="text-emerald-400">ok</span> : <span className="text-red-400">erreur</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </div>
  );
}

function Hosts({ providers, reload }: { providers: Provider[]; reload: () => void }) {
  const [draft, setDraft] = useState({ slug: "", name: "", base_url: "http://192.168.1.10:11434" });
  const [msg, setMsg] = useState<string>();
  return (
    <div className="flex max-w-3xl flex-col gap-3">
      <p className="text-sm text-fg-muted">Un hôte = une instance Ollama. Ajoute une autre machine du réseau (ex : un PC avec GPU) pour y faire tourner de plus gros modèles.</p>
      {providers.map((p) => (
        <Card key={p.id} className="flex flex-wrap items-center gap-3 p-3">
          <span className={cx("h-2 w-2 rounded-full", p.enabled ? "bg-emerald-400" : "bg-fg-subtle")} />
          <div className="min-w-0 flex-1">
            <div className="text-sm font-medium">
              {p.name} <span className="font-mono text-xs text-fg-subtle">({p.slug})</span>
            </div>
            <div className="font-mono text-xs text-fg-muted">{p.base_url}</div>
          </div>
          <Button
            size="sm"
            onClick={async () => {
              const r = await api<{ total?: number }>("/api/ollama", { method: "POST", json: { action: "sync", providerId: p.id } }).catch((e) => ({ error: String(e.message) }));
              setMsg("error" in r ? `${p.name} : ${r.error}` : `${p.name} : ${r.total} modèles synchronisés`);
              reload();
            }}
          >
            <RefreshCw size={13} /> Synchroniser
          </Button>
          <Button size="sm" variant="ghost" onClick={async () => (await crud.save("providers", { id: p.id, enabled: !p.enabled }), reload())}>
            {p.enabled ? "Désactiver" : "Activer"}
          </Button>
          {providers.length > 1 && (
            <Button
              size="sm"
              variant="ghost"
              onClick={async () => {
                if (!confirm(`Retirer l'hôte ${p.name} ?`)) return;
                await crud.remove("providers", p.id);
                reload();
              }}
            >
              <Trash2 size={13} />
            </Button>
          )}
        </Card>
      ))}
      {msg && <div className="text-sm text-fg-muted">{msg}</div>}
      <Card className="grid gap-2 p-3 sm:grid-cols-[120px_1fr_1.4fr_auto] sm:items-end">
        <Field label="Identifiant">
          <Input value={draft.slug} onChange={(e) => setDraft({ ...draft, slug: e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, "") })} placeholder="gpu" />
        </Field>
        <Field label="Nom">
          <Input value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} placeholder="PC GPU" />
        </Field>
        <Field label="URL">
          <Input value={draft.base_url} onChange={(e) => setDraft({ ...draft, base_url: e.target.value })} />
        </Field>
        <Button
          variant="primary"
          disabled={!draft.slug || !draft.name}
          onClick={async () => {
            await crud.save("providers", { ...draft, type: "ollama", enabled: true, api_key: "" });
            setDraft({ slug: "", name: "", base_url: "http://192.168.1.10:11434" });
            reload();
          }}
        >
          <Plus size={14} /> Ajouter
        </Button>
      </Card>
    </div>
  );
}

function Proxy() {
  const origin = typeof window !== "undefined" ? window.location.origin : "http://127.0.0.1:3210";
  const curl = `curl ${origin}/api/v1/chat/completions \\
  -H "Content-Type: application/json" \\
  -H "Authorization: Bearer <clé-proxy-si-définie>" \\
  -d '{"model": "ollama/qwen3:8b", "messages": [{"role": "user", "content": "Bonjour"}]}'`;
  return (
    <div className="flex max-w-3xl flex-col gap-4">
      <p className="text-sm text-fg-muted">
        Comme LiteLLM : tes autres outils (IDE, scripts, n8n, Open WebUI…) peuvent appeler tes modèles locaux via une API compatible OpenAI. Chaque appel apparaît dans
        l&apos;onglet Utilisation.
      </p>
      <Card className="flex flex-col gap-2 p-4 text-sm">
        <div>
          <span className="text-fg-muted">Base URL :</span> <code className="font-mono">{origin}/api/v1</code>
        </div>
        <div>
          <span className="text-fg-muted">Routes :</span> <code className="font-mono">/chat/completions</code>, <code className="font-mono">/embeddings</code>,{" "}
          <code className="font-mono">/models</code>
        </div>
        <div>
          <span className="text-fg-muted">Nom de modèle :</span> <code className="font-mono">hôte/modèle</code> (ex : <code className="font-mono">ollama/qwen3:8b</code>) ou nom seul
        </div>
        <div className="text-fg-muted">Clé : optionnelle, à définir dans Réglages → Clé du proxy.</div>
      </Card>
      <pre className="overflow-x-auto rounded-xl border border-line bg-surface-1 p-4 font-mono text-xs">{curl}</pre>
    </div>
  );
}
