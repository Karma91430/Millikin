"use client";

import { useState } from "react";
import { useT } from "@/i18n";
import { api, useData, type Meta } from "../api";
import { Button, Card, Field, Input, PageHeader, Select } from "../ui";

export function SettingsView({ meta }: { meta: Meta }) {
  const s = useData<Record<string, string>>("/api/settings");
  return s.data ? <SettingsForm meta={meta} initial={s.data} /> : null;
}

function SettingsForm({ meta, initial }: { meta: Meta; initial: Record<string, string> }) {
  const { t } = useT();
  const [v, setV] = useState<Record<string, string>>(initial);
  const [saved, setSaved] = useState(false);
  const set = (k: string, val: string) => (setV((x) => ({ ...x, [k]: val })), setSaved(false));
  const chat = meta.models.filter((m) => m.kind === "chat");
  const emb = meta.models.filter((m) => m.kind === "embedding");

  return (
    <div>
      <PageHeader
        title={t("Réglages")}
        actions={
          <Button
            variant="primary"
            onClick={async () => {
              setV(await api("/api/settings", { method: "POST", json: v }));
              setSaved(true);
            }}
          >
            {saved ? t("Enregistré ✓") : t("Enregistrer")}
          </Button>
        }
      />
      <div className="grid max-w-4xl gap-4 p-6 md:grid-cols-2">
        <Diagnostic />
        <Card className="flex flex-col gap-3 p-4">
          <div className="text-sm font-semibold">{t("Modèles")}</div>
          <Field label={t("Modèle par défaut")} hint={t("Utilisé par les agents sans modèle défini, et pour générer agents, équipes et skills.")}>
            <Select value={v.default_model} onChange={(e) => set("default_model", e.target.value)}>
              {chat.map((m) => (
                <option key={m.ref} value={m.ref}>
                  {m.label}
                  {m.supports_tools ? "" : t(" · sans outils")}
                </option>
              ))}
            </Select>
          </Field>
          <Field label={t("Modèle d'embedding (RAG)")} hint={t("Changer de modèle impose de réindexer les documents.")}>
            <Select value={v.embedding_model} onChange={(e) => set("embedding_model", e.target.value)}>
              {emb.map((m) => (
                <option key={m.ref} value={m.ref}>
                  {m.label}
                </option>
              ))}
            </Select>
          </Field>
          <Field label={t("Réflexion par défaut (think)")} hint={t("Pour les modèles qui la gèrent (qwen3…). Désactivée = bien plus rapide.")}>
            <Select value={v.think} onChange={(e) => set("think", e.target.value)}>
              <option value="off">{t("Désactivée")}</option>
              <option value="on">{t("Activée")}</option>
            </Select>
          </Field>
        </Card>

        <Card className="flex flex-col gap-3 p-4">
          <div className="text-sm font-semibold">Ollama</div>
          <Field label={t("Taille du contexte (num_ctx)")} hint={t("16 384 convient à 18 Go de RAM avec un modèle 8B. Plus grand = plus de mémoire.")}>
            <Select value={v.num_ctx} onChange={(e) => set("num_ctx", e.target.value)}>
              {["4096", "8192", "16384", "32768", "65536"].map((n) => (
                <option key={n} value={n}>
                  {t("{n} tokens", { n: Number(n).toLocaleString("fr-FR") })}
                </option>
              ))}
            </Select>
          </Field>
          <Field label={t("Maintien en mémoire (keep_alive)")} hint={t("Durée pendant laquelle un modèle reste chargé après usage : 5m, 30m, 1h, -1 = toujours.")}>
            <Input value={v.keep_alive} onChange={(e) => set("keep_alive", e.target.value)} />
          </Field>
          <Field label={t("Réflexion max (caractères)")} hint={t("Au-delà, la réflexion est interrompue et l'agent répond directement (évite les boucles de réflexion des petits modèles).")}>
            <Input type="number" min={2000} max={100000} step={1000} value={v.max_reasoning} onChange={(e) => set("max_reasoning", e.target.value)} />
          </Field>
          <Field label={t("Étapes max par agent")} hint={t("Nombre maximal d'allers-retours outil → modèle par tour.")}>
            <Input type="number" min={1} max={30} value={v.max_steps} onChange={(e) => set("max_steps", e.target.value)} />
          </Field>
          <Field label={t("Relances automatiques d'une tâche")} hint={t("Une tâche rejetée par le contrôle ou en échec est relancée avec le retour, jusqu'à ce nombre de fois, avant de demander une vérification humaine. 0 = désactivé.")}>
            <Input type="number" min={0} max={10} value={v.task_auto_retries} onChange={(e) => set("task_auto_retries", e.target.value)} />
          </Field>
        </Card>

        <Card className="flex flex-col gap-3 p-4">
          <div className="text-sm font-semibold">{t("Outils")}</div>
          <Field label={t("URL SearXNG")} hint={t("Moteur de recherche local utilisé par l'outil web_search.")}>
            <Input value={v.searxng_url} onChange={(e) => set("searxng_url", e.target.value)} />
          </Field>
          <Field label={t("Recherche de secours")} hint={t("Si SearXNG ne répond pas, la requête est envoyée à DuckDuckGo (seule la requête sort de ta machine).")}>
            <Select value={v.web_fallback} onChange={(e) => set("web_fallback", e.target.value)}>
              <option value="on">{t("Activée (DuckDuckGo)")}</option>
              <option value="off">{t("Désactivée")}</option>
            </Select>
          </Field>
          <Field label={t("Dossier des espaces de travail")} hint={t("Chaque équipe y a son sous-dossier, sauf si un dossier précis est défini sur l'équipe.")}>
            <Input className="font-mono text-xs" value={v.workspace_dir} onChange={(e) => set("workspace_dir", e.target.value)} />
          </Field>
          <Field label={t("Délai max d'une commande (secondes)")}>
            <Input type="number" min={5} max={900} value={v.command_timeout} onChange={(e) => set("command_timeout", e.target.value)} />
          </Field>
        </Card>

        <Card className="flex flex-col gap-3 p-4">
          <div className="text-sm font-semibold">{t("Proxy API")}</div>
          <Field label={t("Clé du proxy")} hint={t("Si définie, les appels à /api/v1 doivent envoyer « Authorization: Bearer <clé> ». Vide = pas de clé (Millikin n'écoute que sur 127.0.0.1).")}>
            <Input type="password" value={v.proxy_key} onChange={(e) => set("proxy_key", e.target.value)} autoComplete="off" />
          </Field>
        </Card>
      </div>
    </div>
  );
}

const CHECK_LABELS: Record<string, [string, string]> = {
  searxng: ["SearXNG", "Recherche web principale"],
  fallback: ["Secours DuckDuckGo", "Recherche si SearXNG est indisponible"],
  ollama: ["Ollama", "Modèles"],
  node: ["Node.js", "Scripts JS/TS via run_command"],
  python: ["Python", "Scripts Python via run_command"],
  git: ["Git", "Versionnage via run_command"],
};

/** Can the agent tools actually work on this machine? */
function Diagnostic() {
  const { t } = useT();
  const h = useData<{ checks: Record<string, { ok: boolean; detail: string }> }>("/api/tools/health");
  return (
    <Card className="flex flex-col gap-2 p-4 md:col-span-2">
      <div className="flex items-center justify-between">
        <div className="text-sm font-semibold">{t("Diagnostic des outils")}</div>
        <Button size="sm" variant="ghost" onClick={h.reload}>
          {t("Relancer")}
        </Button>
      </div>
      {!h.data ? (
        <div className="text-sm text-fg-muted">{h.error ?? t("Vérification…")}</div>
      ) : (
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {Object.entries(CHECK_LABELS).map(([key, [name, use]]) => {
            const c = h.data!.checks[key];
            return (
              <div key={key} className="flex items-start gap-2 rounded-lg border border-line bg-surface-2 px-3 py-2">
                <span className={c?.ok ? "text-emerald-400" : "text-red-400"}>{c?.ok ? "✓" : "✗"}</span>
                <span className="min-w-0">
                  <span className="block text-sm font-medium">{t(name)}</span>
                  <span className="block truncate text-[11px] text-fg-muted" title={c?.detail}>
                    {c?.detail ?? "—"}
                  </span>
                  <span className="block text-[11px] text-fg-subtle">{t(use)}</span>
                </span>
              </div>
            );
          })}
        </div>
      )}
    </Card>
  );
}
