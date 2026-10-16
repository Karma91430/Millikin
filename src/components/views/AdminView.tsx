"use client";

import { KeyRound, ShieldCheck, Trash2, UserPlus, Users } from "lucide-react";
import { useState } from "react";
import { useT } from "@/i18n";
import { api, useData, type Meta, type Project } from "../api";
import { Badge, Button, Card, cx, Drawer, Empty, ErrorNote, Field, Input, PageHeader, Select } from "../ui";

export type AppUser = {
  id: string;
  email: string;
  name: string;
  role: "admin" | "member" | "viewer";
  active: boolean;
  tools: string[];
  project_access: "all" | "selected";
  project_ids: string[];
  can_create_projects: boolean;
  can_manage_agents: boolean;
  max_team_size: number;
  max_projects: number;
  credits_monthly: number;
  credits_bonus: number;
  last_login: number | null;
  credits?: { used: number; quota: number; remaining: number | null };
};

const ROLES: Record<AppUser["role"], { label: string; hint: string; color: string }> = {
  admin: { label: "Administrateur", hint: "Tout, y compris cet espace, les fournisseurs et les réglages", color: "#d95926" },
  member: { label: "Membre", hint: "Utilise les projets autorisés, selon ses droits", color: "#3987e5" },
  viewer: { label: "Lecteur", hint: "Consulte les projets autorisés, sans rien lancer ni modifier", color: "#9085e9" },
};
const PROVIDER_TYPES: [string, string][] = [
  ["ollama", "Ollama (local)"],
  ["openai", "Compatible OpenAI"],
  ["anthropic", "Anthropic"],
  ["claude-code", "Claude Code"],
  ["codex", "Codex"],
];

/** First account: turns accounts on (single-user mode until then). */
function CreateAdmin({ onDone }: { onDone: () => void }) {
  const { t } = useT();
  const [f, setF] = useState({ name: "", email: "", password: "" });
  const [error, setError] = useState<string>();
  return (
    <Card className="flex max-w-lg flex-col gap-3 p-5">
      <div className="flex items-center gap-2 text-sm font-semibold">
        <ShieldCheck size={16} className="text-accent" /> {t("Activer les comptes utilisateurs")}
      </div>
      <p className="text-sm text-fg-muted">
        {t("Millikin fonctionne pour l'instant en mode mono-utilisateur sur cette machine. Crée le compte administrateur : chacun devra ensuite se connecter, et tu pourras inviter d'autres personnes avec leurs droits.")}
      </p>
      <ErrorNote>{error}</ErrorNote>
      <Field label={t("Nom")}>
        <Input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />
      </Field>
      <Field label={t("E-mail")}>
        <Input type="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} />
      </Field>
      <Field label={t("Mot de passe")} hint={t("8 caractères minimum.")}>
        <Input type="password" value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} />
      </Field>
      <Button
        variant="primary"
        disabled={!f.email || f.password.length < 8}
        onClick={async () => {
          try {
            await api("/api/auth/setup", { method: "POST", json: f });
            onDone();
          } catch (e) {
            setError(e instanceof Error ? e.message : String(e));
          }
        }}
      >
        <ShieldCheck size={14} /> {t("Créer le compte administrateur")}
      </Button>
    </Card>
  );
}

function UserEditor({ initial, meta, projects, onClose, onSaved }: { initial: Partial<AppUser>; meta: Meta; projects: Project[]; onClose: () => void; onSaved: () => void }) {
  const { t } = useT();
  const [u, setU] = useState<Partial<AppUser> & { password?: string }>(initial);
  const [error, setError] = useState<string>();
  const isNew = !initial.id;
  const set = (patch: Partial<AppUser> & { password?: string }) => setU((x) => ({ ...x, ...patch }));
  const allTools = !u.tools?.length;
  return (
    <Drawer
      open
      wide
      onClose={onClose}
      title={isNew ? t("Nouvel utilisateur") : u.name || u.email || ""}
      footer={
        <>
          {!isNew && (
            <Button
              variant="danger"
              onClick={async () => {
                if (!confirm(t("Supprimer le compte {email} ?", { email: u.email ?? "" }))) return;
                try {
                  await api(`/api/admin/users?id=${u.id}`, { method: "DELETE" });
                  onSaved();
                } catch (e) {
                  setError(e instanceof Error ? e.message : String(e));
                }
              }}
            >
              <Trash2 size={14} />
            </Button>
          )}
          <div className="flex-1" />
          <Button variant="ghost" onClick={onClose}>
            {t("Annuler")}
          </Button>
          <Button
            variant="primary"
            onClick={async () => {
              try {
                const { credits: _c, last_login: _l, ...body } = u;
                void _c;
                void _l;
                await api("/api/admin/users", { method: "POST", json: body });
                onSaved();
              } catch (e) {
                setError(e instanceof Error ? e.message : String(e));
              }
            }}
          >
            {isNew ? t("Créer le compte") : t("Enregistrer")}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-5 text-sm">
        <ErrorNote>{error}</ErrorNote>
        <section className="grid gap-3 sm:grid-cols-2">
          <Field label={t("Nom")}>
            <Input value={u.name ?? ""} onChange={(e) => set({ name: e.target.value })} />
          </Field>
          <Field label={t("E-mail")}>
            <Input type="email" value={u.email ?? ""} onChange={(e) => set({ email: e.target.value })} />
          </Field>
          <Field label={isNew ? t("Mot de passe") : t("Nouveau mot de passe")} hint={isNew ? t("8 caractères minimum.") : t("Laisse vide pour le conserver ; un changement déconnecte l'utilisateur.")}>
            <Input type="password" value={u.password ?? ""} onChange={(e) => set({ password: e.target.value })} />
          </Field>
          <Field label={t("Rôle")} hint={t(ROLES[u.role ?? "member"].hint)}>
            <Select value={u.role ?? "member"} onChange={(e) => set({ role: e.target.value as AppUser["role"] })}>
              {(Object.keys(ROLES) as AppUser["role"][]).map((r) => (
                <option key={r} value={r}>
                  {t(ROLES[r].label)}
                </option>
              ))}
            </Select>
          </Field>
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={u.active ?? true} onChange={(e) => set({ active: e.target.checked })} className="accent-[var(--accent)]" />
            {t("Compte actif")}
          </label>
        </section>

        {u.role !== "admin" && (
          <>
            <section className="flex flex-col gap-2">
              <div className="font-semibold">{t("Droits")}</div>
              <label className="flex items-center gap-2">
                <input type="checkbox" checked={u.can_create_projects ?? true} disabled={u.role === "viewer"} onChange={(e) => set({ can_create_projects: e.target.checked })} className="accent-[var(--accent)]" />
                {t("Créer des projets")}
              </label>
              <label className="flex items-center gap-2">
                <input type="checkbox" checked={u.can_manage_agents ?? false} disabled={u.role === "viewer"} onChange={(e) => set({ can_manage_agents: e.target.checked })} className="accent-[var(--accent)]" />
                {t("Gérer les agents, équipes, skills, connaissances et MCP")}
              </label>
            </section>

            <section className="flex flex-col gap-2">
              <div className="font-semibold">{t("Projets visibles")}</div>
              <Select value={u.project_access ?? "all"} onChange={(e) => set({ project_access: e.target.value as AppUser["project_access"] })}>
                <option value="all">{t("Tous les projets")}</option>
                <option value="selected">{t("Seulement les projets choisis (et ceux qu'il crée)")}</option>
              </Select>
              {u.project_access === "selected" && (
                <div className="grid max-h-44 grid-cols-1 gap-1 overflow-y-auto rounded-lg border border-line p-2 sm:grid-cols-2">
                  {projects.map((p) => (
                    <label key={p.id} className="flex items-center gap-2 truncate">
                      <input
                        type="checkbox"
                        checked={u.project_ids?.includes(p.id) ?? false}
                        onChange={() => set({ project_ids: u.project_ids?.includes(p.id) ? u.project_ids.filter((x) => x !== p.id) : [...(u.project_ids ?? []), p.id] })}
                        className="accent-[var(--accent)]"
                      />
                      <span className="truncate">{p.name}</span>
                    </label>
                  ))}
                  {!projects.length && <span className="text-xs text-fg-subtle">{t("Aucun projet pour l'instant.")}</span>}
                </div>
              )}
            </section>

            <section className="flex flex-col gap-2">
              <div className="font-semibold">{t("Outils autorisés pour ses agents")}</div>
              <label className="flex items-center gap-2">
                <input type="checkbox" checked={allTools} onChange={(e) => set({ tools: e.target.checked ? [] : meta.tools.filter((x) => !x.danger).map((x) => x.id) })} className="accent-[var(--accent)]" />
                {t("Tous les outils")}
              </label>
              {!allTools && (
                <div className="grid gap-1 sm:grid-cols-2">
                  {meta.tools.map((tool) => (
                    <label key={tool.id} className="flex items-start gap-2 rounded-md border border-line p-2">
                      <input
                        type="checkbox"
                        checked={u.tools?.includes(tool.id) ?? false}
                        onChange={() => set({ tools: u.tools?.includes(tool.id) ? u.tools.filter((x) => x !== tool.id) : [...(u.tools ?? []), tool.id] })}
                        className="mt-0.5 accent-[var(--accent)]"
                      />
                      <span>
                        <span className="block">
                          {tool.label} {tool.danger && <Badge color="#ef4444">{t("sensible")}</Badge>}
                        </span>
                        <span className="block text-[11px] text-fg-subtle">{tool.description}</span>
                      </span>
                    </label>
                  ))}
                </div>
              )}
              <p className="text-[11px] text-fg-subtle">{t("Quand cet utilisateur lance un agent, seuls ces outils restent actifs, quels que soient les outils de l'agent.")}</p>
            </section>

            <section className="grid gap-3 sm:grid-cols-2">
              <Field label={t("Taille d'équipe max")} hint={t("0 = illimitée")}>
                <Input type="number" min={0} value={u.max_team_size ?? 0} onChange={(e) => set({ max_team_size: Number(e.target.value) })} />
              </Field>
              <Field label={t("Projets max (créés)")} hint={t("0 = illimité")}>
                <Input type="number" min={0} value={u.max_projects ?? 0} onChange={(e) => set({ max_projects: Number(e.target.value) })} />
              </Field>
              <Field label={t("Crédits par mois")} hint={t("1 crédit = 1 000 tokens × coefficient du fournisseur. 0 = illimité.")}>
                <Input type="number" min={0} value={u.credits_monthly ?? 0} onChange={(e) => set({ credits_monthly: Number(e.target.value) })} />
              </Field>
              <Field label={t("Crédits bonus (ce mois)")} hint={t("Recharge ponctuelle ajoutée au quota mensuel.")}>
                <div className="flex gap-1">
                  <Input type="number" min={0} value={u.credits_bonus ?? 0} onChange={(e) => set({ credits_bonus: Number(e.target.value) })} />
                  <Button size="sm" onClick={() => set({ credits_bonus: (u.credits_bonus ?? 0) + 100 })}>
                    +100
                  </Button>
                </div>
              </Field>
            </section>
            {u.credits && u.credits.quota > 0 && <CreditBar used={u.credits.used} quota={u.credits.quota} />}
          </>
        )}
      </div>
    </Drawer>
  );
}

export function CreditBar({ used, quota }: { used: number; quota: number }) {
  const { t } = useT();
  const pct = Math.min(100, (used / quota) * 100);
  return (
    <div>
      <div className="mb-1 flex justify-between text-[11px] text-fg-muted">
        <span>{t("Crédits ce mois")}</span>
        <span className="tabular-nums">
          {used} / {quota}
        </span>
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-surface-3">
        <div className="h-full rounded-full" style={{ width: `${pct}%`, background: pct >= 100 ? "#ef4444" : pct >= 80 ? "#f59e0b" : "#10b981" }} />
      </div>
    </div>
  );
}

function AccessSettings() {
  const { t } = useT();
  const s = useData<Record<string, string>>("/api/settings");
  const [weights, setWeights] = useState<Record<string, number> | null>(null);
  const [saved, setSaved] = useState(false);
  const current: Record<string, number> = weights ?? (() => {
    try {
      return JSON.parse(s.data?.credit_weights || "{}");
    } catch {
      return {};
    }
  })();
  const save = async (values: Record<string, string>) => {
    await api("/api/settings", { method: "POST", json: values });
    s.reload();
    setSaved(true);
    setTimeout(() => setSaved(false), 1500);
  };
  return (
    <div className="grid max-w-4xl gap-4 lg:grid-cols-2">
      <Card className="flex flex-col gap-3 p-4">
        <div className="text-sm font-semibold">{t("Accès réseau")}</div>
        <label className="flex items-start gap-2 text-sm">
          <input type="checkbox" checked={s.data?.network_access === "on"} onChange={(e) => save({ network_access: e.target.checked ? "on" : "off" })} className="mt-0.5 accent-[var(--accent)]" />
          <span>
            <span className="block font-medium">{t("Autoriser les autres machines du réseau")}</span>
            <span className="block text-xs text-fg-muted">
              {t("Puis relance Millikin avec « npm run dev:lan » (ou « start:lan ») : le serveur écoute alors sur le réseau local et chacun se connecte avec son compte. Le lancement normal reste limité à cette machine.")}
            </span>
          </span>
        </label>
        <p className="text-[11px] text-fg-subtle">{t("Les clés de fournisseurs, les commandes et les serveurs MCP s'exécutent sur cette machine : donne les droits « outils sensibles » et « gérer les agents » avec prudence.")}</p>
      </Card>
      <Card className="flex flex-col gap-3 p-4">
        <div className="flex items-center gap-2 text-sm font-semibold">
          {t("Coefficients de crédits")} {saved && <span className="text-xs font-normal text-emerald-400">✓</span>}
        </div>
        <p className="text-xs text-fg-muted">{t("Crédits consommés = tokens / 1 000 × coefficient du fournisseur qui a répondu. Un modèle local peut coûter moins qu'une API payante.")}</p>
        {PROVIDER_TYPES.map(([type, label]) => (
          <label key={type} className="flex items-center gap-3 text-sm">
            <span className="flex-1">{t(label)}</span>
            <Input type="number" min={0} step={0.1} className="w-24" value={current[type] ?? 1} onChange={(e) => setWeights({ ...current, [type]: Number(e.target.value) })} />
          </label>
        ))}
        <Button size="sm" variant="primary" disabled={!weights} onClick={() => (save({ credit_weights: JSON.stringify(current) }), setWeights(null))}>
          {t("Enregistrer les coefficients")}
        </Button>
      </Card>
    </div>
  );
}

export function AdminView({ meta, projects, setupMode, onAccountsEnabled }: { meta: Meta; projects: Project[]; setupMode: boolean; onAccountsEnabled: () => void }) {
  const { t } = useT();
  const users = useData<AppUser[]>(setupMode ? null : "/api/admin/users");
  const [tab, setTab] = useState<"users" | "access">("users");
  const [edit, setEdit] = useState<Partial<AppUser> | null>(null);
  const blank: Partial<AppUser> = { role: "member", active: true, tools: [], project_access: "all", project_ids: [], can_create_projects: true, can_manage_agents: false, max_team_size: 0, max_projects: 0, credits_monthly: 0, credits_bonus: 0 };
  return (
    <div className="flex h-full flex-col">
      <PageHeader
        title={t("Administration")}
        subtitle={t("Comptes, droits, projets visibles, outils autorisés, limites et crédits.")}
        actions={
          !setupMode && (
            <div className="flex items-center gap-2">
              <div className="flex rounded-lg border border-line p-0.5">
                {(
                  [
                    ["users", "Utilisateurs"],
                    ["access", "Accès et crédits"],
                  ] as const
                ).map(([id, label]) => (
                  <button key={id} onClick={() => setTab(id)} className={cx("rounded-md px-3 py-1 text-sm", tab === id ? "bg-surface-3 text-fg" : "text-fg-muted")}>
                    {t(label)}
                  </button>
                ))}
              </div>
              {tab === "users" && (
                <Button variant="primary" onClick={() => setEdit(blank)}>
                  <UserPlus size={15} /> {t("Nouvel utilisateur")}
                </Button>
              )}
            </div>
          )
        }
      />
      <div className="min-h-0 flex-1 overflow-y-auto p-6">
        {setupMode ? (
          <CreateAdmin onDone={onAccountsEnabled} />
        ) : tab === "access" ? (
          <AccessSettings />
        ) : !users.data?.length ? (
          <Empty icon={<Users size={28} />} title={t("Aucun utilisateur")}>
            {t("Crée les comptes des personnes qui utiliseront Millikin.")}
          </Empty>
        ) : (
          <div className="overflow-x-auto rounded-xl border border-line">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-line bg-surface-1 text-left text-xs text-fg-muted">
                  <th className="px-4 py-2 font-medium">{t("Utilisateur")}</th>
                  <th className="px-4 py-2 font-medium">{t("Rôle")}</th>
                  <th className="px-4 py-2 font-medium">{t("Projets")}</th>
                  <th className="px-4 py-2 font-medium">{t("Outils")}</th>
                  <th className="px-4 py-2 font-medium">{t("Limites")}</th>
                  <th className="w-48 px-4 py-2 font-medium">{t("Crédits ce mois")}</th>
                  <th className="px-4 py-2 font-medium">{t("Dernière connexion")}</th>
                </tr>
              </thead>
              <tbody>
                {users.data.map((u) => (
                  <tr key={u.id} onClick={() => setEdit(u)} className={cx("cursor-pointer border-b border-line last:border-0 hover:bg-surface-2", !u.active && "opacity-50")}>
                    <td className="px-4 py-2">
                      <div className="font-medium">{u.name || u.email}</div>
                      <div className="text-[11px] text-fg-subtle">{u.email}</div>
                    </td>
                    <td className="px-4 py-2">
                      <Badge color={ROLES[u.role].color}>{t(ROLES[u.role].label)}</Badge>
                      {!u.active && <span className="ml-1 text-[11px] text-fg-subtle">{t("désactivé")}</span>}
                    </td>
                    <td className="px-4 py-2 text-xs text-fg-muted">{u.role === "admin" || u.project_access === "all" ? t("Tous") : t("{n} choisi(s)", { n: u.project_ids.length })}</td>
                    <td className="px-4 py-2 text-xs text-fg-muted">{u.role === "admin" || !u.tools.length ? t("Tous") : t("{n} groupe(s)", { n: u.tools.length })}</td>
                    <td className="px-4 py-2 text-xs text-fg-muted">
                      {u.role === "admin"
                        ? "—"
                        : [u.max_team_size ? t("équipe ≤ {n}", { n: u.max_team_size }) : "", u.max_projects ? t("projets ≤ {n}", { n: u.max_projects }) : ""].filter(Boolean).join(" · ") || t("aucune")}
                    </td>
                    <td className="px-4 py-2">
                      {u.role === "admin" || !u.credits?.quota ? <span className="text-xs text-fg-muted">{t("illimités · {n} utilisés", { n: u.credits?.used ?? 0 })}</span> : <CreditBar used={u.credits.used} quota={u.credits.quota} />}
                    </td>
                    <td className="px-4 py-2 text-xs text-fg-subtle">{u.last_login ? new Date(u.last_login).toLocaleString() : t("jamais")}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
      {edit && (
        <UserEditor
          key={edit.id ?? "new"}
          initial={edit}
          meta={meta}
          projects={projects}
          onClose={() => setEdit(null)}
          onSaved={() => {
            setEdit(null);
            users.reload();
          }}
        />
      )}
    </div>
  );
}

/** Login screen (accounts enabled, no session). */
export function LoginScreen({ onLogged }: { onLogged: () => void }) {
  const { t } = useT();
  const [f, setF] = useState({ email: "", password: "" });
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  return (
    <div className="flex h-screen items-center justify-center bg-surface-0 p-4">
      <form
        className="flex w-full max-w-sm flex-col gap-3 rounded-2xl border border-line bg-surface-1 p-6"
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          setError(undefined);
          try {
            await api("/api/auth/login", { method: "POST", json: f });
            onLogged();
          } catch (err) {
            setError(err instanceof Error ? err.message : String(err));
          } finally {
            setBusy(false);
          }
        }}
      >
        <div className="mb-2 flex items-center gap-2">
          <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-accent text-base font-bold text-white">M</span>
          <span className="text-lg font-semibold">Millikin</span>
        </div>
        <ErrorNote>{error}</ErrorNote>
        <Field label={t("E-mail")}>
          <Input type="email" autoFocus autoComplete="username" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} />
        </Field>
        <Field label={t("Mot de passe")}>
          <Input type="password" autoComplete="current-password" value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} />
        </Field>
        <Button variant="primary" type="submit" disabled={busy || !f.email || !f.password}>
          <KeyRound size={14} /> {busy ? t("Connexion en cours…") : t("Se connecter")}
        </Button>
        <p className="text-center text-[11px] text-fg-subtle">{t("Pas de compte ? Demande-le à un administrateur.")}</p>
      </form>
    </div>
  );
}

