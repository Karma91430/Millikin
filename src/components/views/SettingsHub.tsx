"use client";

import { Check, Cloud, Cpu, Gauge, Languages, Laptop, Settings, TerminalSquare } from "lucide-react";
import { useState } from "react";
import { LANGS, useT } from "@/i18n";
import { api, useData, type Meta, type Provider } from "../api";
import { Badge, Button, Card, cx, Select } from "../ui";
import { MachineView } from "./MachineView";
import { ModelsView } from "./ModelsView";
import { SettingsView } from "./SettingsView";

type Tab = "engine" | "general" | "models" | "machine";

// How each kind of provider is presented to the user.
const KIND: Record<string, { label: string; hint: string; icon: typeof Cpu }> = {
  ollama: { label: "Ollama (local)", hint: "Modèles sur cette machine : gratuits, privés, plus lents sur les gros travaux.", icon: Laptop },
  "claude-code": { label: "Claude Code", hint: "Ton abonnement Claude via la CLI installée : rapide et très capable.", icon: TerminalSquare },
  codex: { label: "Codex", hint: "Ton compte OpenAI via la CLI Codex.", icon: TerminalSquare },
  openai: { label: "API compatible OpenAI", hint: "OpenAI, Mistral, Groq, OpenRouter, LM Studio… avec une clé ou en local.", icon: Cloud },
  anthropic: { label: "API Anthropic", hint: "Claude via une clé API, facturé à l'usage.", icon: Cloud },
};

/** The engine every agent uses unless it has its own model: pick a provider, then one of its models. */
function EngineSettings({ meta, onChange, onManage }: { meta: Meta; onChange: () => void; onManage: () => void }) {
  const { t } = useT();
  const settings = useData<Record<string, string>>("/api/settings");
  const providers = useData<Provider[]>("/api/crud/providers");
  const [pick, setPick] = useState<Record<string, string>>({});
  const current = settings.data?.default_model ?? "";
  const currentSlug = current.split("/")[0];
  const list = (providers.data ?? []).filter((p) => p.enabled);
  const modelsOf = (slug: string) => meta.models.filter((m) => m.kind !== "embedding" && m.ref.startsWith(`${slug}/`));
  const use = async (ref: string) => {
    await api("/api/settings", { method: "POST", json: { default_model: ref } });
    settings.reload();
    onChange();
  };
  const currentProvider = list.find((p) => p.slug === currentSlug);
  const currentModel = meta.models.find((m) => m.ref === current);
  return (
    <div className="flex max-w-5xl flex-col gap-5">
      <Card className="flex flex-wrap items-center gap-4 border-accent/40 bg-accent/5 p-4">
        <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-accent/20 text-accent">
          {(() => {
            const Icon = KIND[currentProvider?.type ?? "ollama"]?.icon ?? Cpu;
            return <Icon size={20} />;
          })()}
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-xs text-fg-muted">{t("Moteur actuel des agents")}</div>
          <div className="text-lg font-semibold">
            {currentProvider ? t(KIND[currentProvider.type]?.label ?? currentProvider.name) : "—"} · <span className="font-mono">{currentModel?.label ?? current.split("/").slice(1).join("/")}</span>
          </div>
          <div className="text-xs text-fg-subtle">{t("Utilisé par tous les agents qui n'ont pas de modèle propre (fiche de l'agent), et pour la planification et les suggestions.")}</div>
        </div>
      </Card>

      <div>
        <div className="mb-2 text-sm font-semibold">{t("Changer de moteur")}</div>
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {list.map((p) => {
            const k = KIND[p.type] ?? { label: p.name, hint: "", icon: Cpu };
            const models = modelsOf(p.slug);
            const active = p.slug === currentSlug;
            const chosen = pick[p.slug] ?? (active ? current : (models[0]?.ref ?? ""));
            return (
              <Card key={p.id} className={cx("flex flex-col gap-3 p-4", active && "border-accent")}>
                <div className="flex items-start gap-2">
                  <k.icon size={18} className={active ? "text-accent" : "text-fg-muted"} />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 text-sm font-semibold">
                      {t(k.label)}
                      {active && (
                        <Badge color="#7c6cf6">
                          <Check size={10} /> {t("actif")}
                        </Badge>
                      )}
                    </div>
                    <div className="text-xs text-fg-muted">{p.name !== k.label ? `${p.name} · ` : ""}{t(k.hint)}</div>
                  </div>
                </div>
                {models.length ? (
                  <div className="flex gap-2">
                    <Select className="flex-1" value={chosen} onChange={(e) => setPick({ ...pick, [p.slug]: e.target.value })}>
                      {models.map((m) => (
                        <option key={m.ref} value={m.ref}>
                          {m.label}
                        </option>
                      ))}
                    </Select>
                    <Button variant={active && chosen === current ? "soft" : "primary"} disabled={!chosen || chosen === current} onClick={() => use(chosen)}>
                      {chosen === current ? t("Utilisé") : t("Utiliser")}
                    </Button>
                  </div>
                ) : (
                  <div className="text-xs text-fg-subtle">{t("Aucun modèle synchronisé : teste et synchronise ce fournisseur.")}</div>
                )}
              </Card>
            );
          })}
        </div>
        <div className="mt-3 flex items-center gap-2 text-xs text-fg-muted">
          {t("Un moteur manque (Claude Code, Codex, une API) ?")}
          <Button size="sm" variant="ghost" onClick={onManage}>
            {t("Ajouter ou gérer les fournisseurs")}
          </Button>
        </div>
      </div>
      <p className="text-xs text-fg-subtle">
        {t("Astuce : garde un modèle puissant pour les premiers contacts (cadrage, contrôle) et un modèle rapide pour les exécutants, en réglant le modèle dans la fiche de chaque agent.")}
      </p>
    </div>
  );
}

function LanguageCard() {
  const { t, lang, setLang } = useT();
  return (
    <Card className="flex max-w-4xl flex-wrap items-center gap-4 p-4">
      <Languages size={18} className="text-fg-muted" />
      <div className="min-w-0 flex-1">
        <div className="text-sm font-semibold">{t("Langue")}</div>
        <div className="text-xs text-fg-muted">{t("Langue de l'interface et des réponses des agents")}</div>
      </div>
      <div className="flex rounded-lg border border-line p-0.5">
        {LANGS.map((l) => (
          <button key={l.id} onClick={() => setLang(l.id)} className={cx("rounded-md px-3 py-1 text-sm", lang === l.id ? "bg-accent/20 text-fg" : "text-fg-muted hover:text-fg")}>
            {l.flag} {l.label}
          </button>
        ))}
      </div>
    </Card>
  );
}

/** Settings hub: engine, general settings (language included), models and machine. */
export function SettingsHub({ meta, onMetaChange }: { meta: Meta; onMetaChange: () => void }) {
  const { t } = useT();
  const [tab, setTab] = useState<Tab>("engine");
  const [modelsTab, setModelsTab] = useState<"models" | "hosts">("models");
  const tabs: [Tab, string, typeof Cpu][] = [
    ["engine", "Moteur IA", Cpu],
    ["general", "Général", Settings],
    ["models", "Modèles et fournisseurs", Cloud],
    ["machine", "Machine", Gauge],
  ];
  return (
    <div className="flex h-full flex-col">
      <div className="flex gap-1 border-b border-line px-6 pt-3">
        {tabs.map(([id, label, Icon]) => (
          <button
            key={id}
            onClick={() => (setTab(id), setModelsTab("models"))}
            className={cx("-mb-px flex items-center gap-1.5 border-b-2 px-3 py-2 text-sm", tab === id ? "border-accent text-fg" : "border-transparent text-fg-muted hover:text-fg")}
          >
            <Icon size={14} /> {t(label)}
          </button>
        ))}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        {tab === "engine" && (
          <div className="p-6">
            <EngineSettings meta={meta} onChange={onMetaChange} onManage={() => (setModelsTab("hosts"), setTab("models"))} />
          </div>
        )}
        {tab === "general" && (
          <>
            <div className="px-6 pt-6">
              <LanguageCard />
            </div>
            <SettingsView meta={meta} />
          </>
        )}
        {tab === "models" && <ModelsView key={modelsTab} onChange={onMetaChange} initialTab={modelsTab} />}
        {tab === "machine" && <MachineView onChange={onMetaChange} />}
      </div>
    </div>
  );
}
