"use client";

import { Bot, BookmarkPlus, Copy, MessageSquare, Pencil, Plus, Sparkles, Trash2, TriangleAlert, UserPlus, Wand2, Wrench } from "lucide-react";
import { recommendedTools } from "@/lib/profiles";
import { normalizeAgentRag, type AgentRag } from "@/lib/resources";
import { useState } from "react";
import { useT } from "@/i18n";
import { api, crud, useData, type Agent, type Kb, type Meta, type Profile, type Skill } from "../api";
import { ProfileGrid, ProfilePicker, type ProfilesData } from "../ProfilePicker";
import { Avatar, Badge, Button, Card, cx, Drawer, Empty, ErrorNote, Field, Input, PageHeader, Pick, Select, Textarea } from "../ui";

const COLORS = ["#6366f1", "#10b981", "#f59e0b", "#ec4899", "#06b6d4", "#8b5cf6", "#ef4444", "#84cc16", "#f97316", "#14b8a6"];

const blank = (): Partial<Agent> => ({
  name: "",
  role: "",
  emoji: "🤖",
  color: COLORS[Math.floor(Math.random() * COLORS.length)],
  system_prompt: "",
  model: "",
  temperature: 0.4,
  think: "",
  tools: [],
  skill_ids: [],
  kb_ids: [],
  mcp_ids: [],
});

/** Fields shared by agents and profiles. */
export const fromProfile = (p: Pick<Profile, "name" | "role" | "emoji" | "color" | "system_prompt" | "tools" | "think">): Partial<Agent> => ({
  ...blank(),
  name: p.name,
  role: p.role,
  emoji: p.emoji,
  color: p.color,
  system_prompt: p.system_prompt,
  tools: [...p.tools],
  think: p.think,
});

export function AgentsView({ agents, meta, onChange, onChat }: { agents: Agent[]; meta: Meta; onChange: () => void; onChat: (id: string) => void }) {
  const [tab, setTab] = useState<"agents" | "profiles">("agents");
  const [edit, setEdit] = useState<Partial<Agent> | null>(null);
  const [picker, setPicker] = useState(false);
  const [bulk, setBulk] = useState(false);
  const { t } = useT();
  return (
    <div>
      <PageHeader
        title={t("Agents")}
        subtitle={t("Des profils spécialisés : prompt, modèle local, outils, skills et connaissances. Les serveurs MCP se donnent par projet.")}
        actions={
          <>
            <div className="flex rounded-lg border border-line p-0.5">
              {(
                [
                  ["agents", "Mes agents"],
                  ["profiles", "Profils"],
                ] as const
              ).map(([id, label]) => (
                <button key={id} onClick={() => setTab(id)} className={cx("rounded-md px-3 py-1 text-sm", tab === id ? "bg-surface-3 text-fg" : "text-fg-muted")}>
                  {t(label)}
                </button>
              ))}
            </div>
            {tab === "agents" && (
              <>
                <Button onClick={() => setBulk(true)} title={t("Aligner les outils de tes agents sur les profils recommandés")}>
                  <Wrench size={15} /> {t("Outils recommandés")}
                </Button>
                <Button variant="primary" onClick={() => setPicker(true)}>
                  <Plus size={15} /> {t("Nouvel agent")}
                </Button>
              </>
            )}
          </>
        }
      />
      {tab === "agents" ? (
        <>
          <div className="grid gap-3 p-6 sm:grid-cols-2 xl:grid-cols-3">
            {agents.map((a) => (
              <Card key={a.id} onClick={() => setEdit(a)} className="flex flex-col gap-3 p-4">
                <div className="flex items-start gap-3">
                  <Avatar emoji={a.emoji} color={a.color} size={42} />
                  <div className="min-w-0 flex-1">
                    <div className="truncate font-semibold">{a.name}</div>
                    <div className="line-clamp-2 text-sm text-fg-muted">{a.role}</div>
                  </div>
                  <Button
                    size="sm"
                    variant="ghost"
                    title={t("Discuter")}
                    onClick={(e) => {
                      e.stopPropagation();
                      onChat(a.id);
                    }}
                  >
                    <MessageSquare size={15} />
                  </Button>
                </div>
                <div className="flex flex-wrap gap-1">
                  <Badge>{a.model ? a.model.replace(/^ollama\//, "") : t("modèle par défaut")}</Badge>
                  {a.think === "on" && <Badge color="#8b5cf6">{t("réflexion")}</Badge>}
                  {a.tools.map((tool) => (
                    <Badge key={tool} color={meta.tools.find((x) => x.id === tool)?.danger ? "#f59e0b" : undefined}>
                      {meta.tools.find((x) => x.id === tool)?.label ?? tool}
                    </Badge>
                  ))}
                  {a.skill_ids.length > 0 && <Badge color="#8b5cf6">{t("{n} skill(s)", { n: a.skill_ids.length })}</Badge>}
                  {a.kb_ids?.length > 0 && <Badge color="#06b6d4">📚 {t("{n} base(s)", { n: a.kb_ids.length })}</Badge>}
                </div>
              </Card>
            ))}
          </div>
          {!agents.length && (
            <Empty icon={<Bot size={28} />} title={t("Aucun agent")}>
              {t("Pars d'un des profils prédéfinis, ou décris l'agent et laisse le modèle générer son profil.")}
            </Empty>
          )}
        </>
      ) : (
        <ProfilesTab meta={meta} onCreateAgent={(p) => setEdit(fromProfile(p))} />
      )}
      <ProfilePicker
        open={picker}
        onClose={() => setPicker(false)}
        onPick={(p) => (setPicker(false), setEdit(fromProfile(p)))}
        onBlank={() => (setPicker(false), setEdit(blank()))}
        onGenerate={() => (setPicker(false), setEdit(blank()))}
      />
      {edit && <AgentEditor initial={edit} meta={meta} onClose={() => setEdit(null)} onSaved={onChange} />}
      {bulk && <BulkTools agents={agents} meta={meta} onClose={() => setBulk(false)} onSaved={onChange} />}
    </div>
  );
}

/** Preview and apply recommended tools to existing agents (adds missing tools, never removes). */
function BulkTools({ agents, meta, onClose, onSaved }: { agents: Agent[]; meta: Meta; onClose: () => void; onSaved: () => void }) {
  const label = (id: string) => meta.tools.find((t) => t.id === id)?.label ?? id;
  const changes = agents
    .map((a) => {
      const rec = recommendedTools(a.name, a.role);
      const add = rec ? rec.filter((t) => !a.tools.includes(t)) : [];
      return { agent: a, add };
    })
    .filter((c) => c.add.length);
  const [selected, setSelected] = useState<Set<string>>(() => new Set(changes.map((c) => c.agent.id)));
  const [busy, setBusy] = useState(false);
  const { t } = useT();
  return (
    <Drawer
      open
      onClose={onClose}
      title={t("Outils recommandés")}
      footer={
        <>
          <div className="flex-1 text-xs text-fg-muted">{t("{n} agent(s) sélectionné(s)", { n: selected.size })}</div>
          <Button variant="ghost" onClick={onClose}>
            {t("Annuler")}
          </Button>
          <Button
            variant="primary"
            disabled={!selected.size || busy}
            onClick={async () => {
              setBusy(true);
              for (const c of changes.filter((x) => selected.has(x.agent.id))) await crud.save("agents", { id: c.agent.id, tools: [...c.agent.tools, ...c.add] });
              onSaved();
              onClose();
            }}
          >
            {t("Appliquer")}
          </Button>
        </>
      }
    >
      <p className="mb-4 text-sm text-fg-muted">
        {t("Ajoute les outils dont chaque rôle a besoin pour agir (web, fichiers, commandes, API), d'après les profils prédéfinis. Rien n'est retiré.")}
      </p>
      {!changes.length && <div className="text-sm text-fg-subtle">{t("Tes agents ont déjà les outils recommandés pour leur rôle.")}</div>}
      <div className="flex flex-col gap-2">
        {changes.map(({ agent, add }) => (
          <label key={agent.id} className="flex cursor-pointer items-start gap-3 rounded-lg border border-line bg-surface-1 p-3">
            <input
              type="checkbox"
              className="mt-1 accent-[var(--accent)]"
              checked={selected.has(agent.id)}
              onChange={() =>
                setSelected((s) => {
                  const n = new Set(s);
                  if (n.has(agent.id)) n.delete(agent.id);
                  else n.add(agent.id);
                  return n;
                })
              }
            />
            <Avatar emoji={agent.emoji} color={agent.color} size={30} />
            <span className="min-w-0 flex-1">
              <span className="block text-sm font-medium">{agent.name}</span>
              <span className="mt-1 flex flex-wrap gap-1">
                {add.map((tool) => (
                  <Badge key={tool} color={meta.tools.find((x) => x.id === tool)?.danger ? "#f59e0b" : "#10b981"}>
                    + {label(tool)}
                  </Badge>
                ))}
              </span>
            </span>
          </label>
        ))}
      </div>
    </Drawer>
  );
}

/** The agent's own knowledge: bases, tag filter and how it uses them (applies in direct chats and in projects). */
function AgentKnowledge({ value, onChange }: { value: Partial<Agent>; onChange: (patch: Partial<Agent>) => void }) {
  const kbs = useData<Kb[]>("/api/crud/kbs");
  const ids = value.kb_ids ?? [];
  const rag = normalizeAgentRag(value.rag);
  const tags = useData<{ tag: string; count: number }[]>(ids.length ? `/api/kb/tags?kbIds=${ids.join(",")}` : null);
  const setRag = (patch: Partial<AgentRag>) => onChange({ rag: { ...rag, ...patch } });
  const { t } = useT();
  return (
    <Field label={t("Connaissances (RAG)")} hint={t("Bases que l'agent peut interroger partout, y compris quand tu lui parles hors projet.")}>
      <Pick items={kbs.data ?? []} value={ids} onChange={(v) => onChange({ kb_ids: v })} render={(k) => `📚 ${k.name}`} empty={t("Aucune base : crée-en dans l'onglet Connaissances.")} />
      {ids.length > 0 && (
        <div className="mt-2 flex flex-col gap-2 rounded-lg border border-line bg-surface-1 p-3">
          <div className="text-[11px] text-fg-muted">{t("Filtrer par tags (aucun = tous les documents)")}</div>
          <Pick
            items={(tags.data ?? []).map((x) => ({ id: x.tag, ...x }))}
            value={rag.tags}
            onChange={(v) => setRag({ tags: v })}
            render={(x) => `#${x.tag} (${x.count})`}
            empty={t("Aucun tag dans ces bases.")}
          />
          <div className="grid gap-2 sm:grid-cols-3">
            <Select value={rag.mode} onChange={(e) => setRag({ mode: e.target.value as AgentRag["mode"] })}>
              <option value="tool">{t("À la demande (rapide)")}</option>
              <option value="auto">{t("Extraits injectés à chaque réponse")}</option>
            </Select>
            <Select value={rag.hybrid ? "on" : "off"} onChange={(e) => setRag({ hybrid: e.target.value === "on" })}>
              <option value="on">{t("Sens + mots-clés")}</option>
              <option value="off">{t("Sens uniquement")}</option>
            </Select>
            <Select value={rag.rerank} onChange={(e) => setRag({ rerank: e.target.value as AgentRag["rerank"] })}>
              <option value="none">{t("Sans reranking")}</option>
              <option value="mmr">{t("Reranking MMR")}</option>
              <option value="llm">{t("Reranking LLM (lent)")}</option>
            </Select>
          </div>
        </div>
      )}
    </Field>
  );
}

type Health = { checks: Record<string, { ok: boolean; detail: string }>; tools: Record<string, boolean> };

// ---------------------------------------------------------------- profiles

function ProfilesTab({ meta, onCreateAgent }: { meta: Meta; onCreateAgent: (p: Profile) => void }) {
  const data = useData<ProfilesData>("/api/profiles");
  const [edit, setEdit] = useState<Partial<Profile> | null>(null);
  const duplicate = (p: Profile) => setEdit({ ...p, id: undefined, builtin: false, name: `${p.name} (copie)`, category: "Mes profils" });
  const { t } = useT();
  return (
    <div className="p-6">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-fg-muted">
          {t("Les profils sont des modèles d'agents réutilisables. Les profils prédéfinis se dupliquent ; les tiens se modifient librement.")}
        </p>
        <Button variant="primary" onClick={() => setEdit({ name: "", role: "", emoji: "🤖", color: COLORS[0], category: "Mes profils", system_prompt: "", tools: [], think: "" })}>
          <Plus size={15} /> {t("Nouveau profil")}
        </Button>
      </div>
      <ProfileGrid
        data={data.data}
        onPick={(p) => (p.builtin ? onCreateAgent(p) : setEdit(p))}
        actions={(p) => (
          <div className="flex gap-0.5 opacity-60 transition group-hover:opacity-100">
            <Button size="sm" variant="ghost" title={t("Créer un agent à partir de ce profil")} onClick={() => onCreateAgent(p)}>
              <UserPlus size={13} />
            </Button>
            {p.builtin ? (
              <Button size="sm" variant="ghost" title={t("Dupliquer en profil personnel")} onClick={() => duplicate(p)}>
                <Copy size={13} />
              </Button>
            ) : (
              <Button size="sm" variant="ghost" title={t("Modifier")} onClick={() => setEdit(p)}>
                <Pencil size={13} />
              </Button>
            )}
          </div>
        )}
      />
      {edit && <ProfileEditor initial={edit} meta={meta} categories={data.data?.categories ?? []} onClose={() => setEdit(null)} onSaved={data.reload} />}
    </div>
  );
}

function ProfileEditor({
  initial,
  meta,
  categories,
  onClose,
  onSaved,
}: {
  initial: Partial<Profile>;
  meta: Meta;
  categories: string[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const [p, setP] = useState(initial);
  const [brief, setBrief] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const set = <K extends keyof Profile>(k: K, v: Profile[K]) => setP((x) => ({ ...x, [k]: v }));
  const { t } = useT();

  return (
    <Drawer
      open
      wide
      onClose={onClose}
      title={p.id ? t("Profil : {name}", { name: p.name ?? "" }) : t("Nouveau profil")}
      footer={
        <>
          {p.id && (
            <Button
              variant="danger"
              onClick={async () => {
                if (!confirm(t("Supprimer le profil « {name} » ? Les agents déjà créés ne sont pas touchés.", { name: p.name ?? "" }))) return;
                await crud.remove("profiles", p.id!);
                onSaved();
                onClose();
              }}
            >
              <Trash2 size={14} /> {t("Supprimer")}
            </Button>
          )}
          <div className="flex-1" />
          <Button variant="ghost" onClick={onClose}>
            {t("Annuler")}
          </Button>
          <Button
            variant="primary"
            onClick={async () => {
              if (!p.name?.trim()) return setError(t("Le nom est obligatoire"));
              const { builtin: _b, ...data } = p;
              void _b;
              await crud.save("profiles", data);
              onSaved();
              onClose();
            }}
          >
            {t("Enregistrer le profil")}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <div className="rounded-xl border border-accent/30 bg-accent/5 p-3">
          <div className="mb-2 flex items-center gap-1.5 text-sm font-medium">
            <Sparkles size={14} className="text-accent" /> {t("Générer avec l'IA")}
          </div>
          <div className="flex gap-2">
            <Input value={brief} onChange={(e) => setBrief(e.target.value)} placeholder={t("ex : expert Kubernetes qui diagnostique les incidents de production")} />
            <Button
              variant="primary"
              disabled={!brief.trim() || busy}
              onClick={async () => {
                setBusy(true);
                setError(undefined);
                try {
                  const d = await api<Partial<Profile>>("/api/generate", { method: "POST", json: { kind: "agent", description: brief } });
                  setP((x) => ({ ...x, ...d }));
                } catch (e) {
                  setError(e instanceof Error ? e.message : String(e));
                } finally {
                  setBusy(false);
                }
              }}
            >
              {busy ? t("Génération…") : t("Générer")}
            </Button>
          </div>
        </div>
        <ErrorNote>{error}</ErrorNote>
        <div className="grid grid-cols-[auto_1fr_1fr] items-end gap-3">
          <Field label={t("Emoji")}>
            <Input className="w-16 text-center text-lg" value={p.emoji} onChange={(e) => set("emoji", e.target.value)} />
          </Field>
          <Field label={t("Nom")}>
            <Input value={p.name} onChange={(e) => set("name", e.target.value)} />
          </Field>
          <Field label={t("Catégorie")}>
            <Input list="profile-categories" value={p.category} onChange={(e) => set("category", e.target.value)} />
            <datalist id="profile-categories">
              {categories.map((c) => (
                <option key={c} value={c} />
              ))}
            </datalist>
          </Field>
        </div>
        <Field label={t("Rôle")}>
          <Input value={p.role} onChange={(e) => set("role", e.target.value)} />
        </Field>
        <ColorField value={p.color ?? COLORS[0]} onChange={(c) => set("color", c)} />
        <Field label={t("Prompt système")}>
          <Textarea rows={10} value={p.system_prompt} onChange={(e) => set("system_prompt", e.target.value)} />
        </Field>
        <Field label={t("Réflexion (think)")}>
          <ThinkSelect value={p.think ?? ""} onChange={(v) => set("think", v)} />
        </Field>
        <Field label={t("Outils intégrés")}>
          <ToolChecks meta={meta} value={p.tools ?? []} onChange={(v) => set("tools", v)} />
        </Field>
      </div>
    </Drawer>
  );
}

// ---------------------------------------------------------------- shared form bits

function ColorField({ value, onChange }: { value: string; onChange: (c: string) => void }) {
  const { t } = useT();
  return (
    <Field label={t("Couleur")}>
      <div className="flex flex-wrap gap-1.5">
        {COLORS.map((c) => (
          <button
            key={c}
            type="button"
            onClick={() => onChange(c)}
            className="h-7 w-7 rounded-full transition"
            style={{ background: c, boxShadow: value === c ? `0 0 0 2px var(--surface-0), 0 0 0 4px ${c}` : undefined }}
            aria-label={c}
          />
        ))}
      </div>
    </Field>
  );
}

function ThinkSelect({ value, onChange }: { value: Agent["think"]; onChange: (v: Agent["think"]) => void }) {
  const { t } = useT();
  return (
    <Select value={value} onChange={(e) => onChange(e.target.value as Agent["think"])}>
      <option value="">{t("Par défaut")}</option>
      <option value="on">{t("Activée (plus lent, plus fiable)")}</option>
      <option value="off">{t("Désactivée (rapide)")}</option>
    </Select>
  );
}

function ToolChecks({ meta, value, onChange }: { meta: Meta; value: string[]; onChange: (v: string[]) => void }) {
  return (
    <div className="grid gap-2 sm:grid-cols-2">
      {meta.tools.map((t) => {
        const on = value.includes(t.id);
        return (
          <label key={t.id} className="flex cursor-pointer items-start gap-2.5 rounded-lg border border-line bg-surface-1 p-2.5 hover:border-line-strong">
            <input type="checkbox" checked={on} onChange={() => onChange(on ? value.filter((x) => x !== t.id) : [...value, t.id])} className="mt-0.5 accent-[var(--accent)]" />
            <span className="min-w-0">
              <span className="flex items-center gap-1.5 text-sm font-medium">
                {t.label} {t.danger && <TriangleAlert size={13} className="text-amber-400" />}
              </span>
              <span className="block text-xs text-fg-muted">{t.description}</span>
            </span>
          </label>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------- agent editor

function AgentEditor({ initial, meta, onClose, onSaved }: { initial: Partial<Agent>; meta: Meta; onClose: () => void; onSaved: () => void }) {
  const [a, setA] = useState<Partial<Agent>>(initial);
  const [brief, setBrief] = useState("");
  const [busy, setBusy] = useState<"gen" | "save" | null>(null);
  const [error, setError] = useState<string>();
  const [profileSaved, setProfileSaved] = useState(false);
  const skills = useData<Skill[]>("/api/crud/skills");
  const set = <K extends keyof Agent>(k: K, v: Agent[K]) => setA((x) => ({ ...x, [k]: v }));
  const health = useData<Health>("/api/tools/health");
  const recommended = recommendedTools(a.name ?? "", a.role ?? "");
  const chatModels = meta.models.filter((m) => m.kind === "chat");
  const selectedModel = chatModels.find((m) => m.ref === a.model);
  const { t } = useT();

  async function generate() {
    setBusy("gen");
    setError(undefined);
    try {
      const d = await api<Partial<Agent>>("/api/generate", { method: "POST", json: { kind: "agent", description: brief } });
      setA((x) => ({ ...x, ...d }));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }

  async function save() {
    if (!a.name?.trim()) return setError(t("Le nom est obligatoire"));
    setBusy("save");
    try {
      await crud.save("agents", a);
      onSaved();
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setBusy(null);
    }
  }

  async function saveAsProfile() {
    if (!a.name?.trim()) return setError(t("Le nom est obligatoire"));
    await crud.save("profiles", {
      category: "Mes profils",
      name: a.name,
      role: a.role,
      emoji: a.emoji,
      color: a.color,
      system_prompt: a.system_prompt,
      tools: a.tools,
      think: a.think,
    });
    setProfileSaved(true);
  }

  return (
    <Drawer
      open
      wide
      onClose={onClose}
      title={a.id ? t("Modifier {name}", { name: a.name ?? "" }) : t("Nouvel agent")}
      footer={
        <>
          {a.id && (
            <Button
              variant="danger"
              onClick={async () => {
                if (!confirm(t("Supprimer l'agent « {name} » ?", { name: a.name ?? "" }))) return;
                await crud.remove("agents", a.id!);
                onSaved();
                onClose();
              }}
            >
              <Trash2 size={14} /> {t("Supprimer")}
            </Button>
          )}
          <Button variant="ghost" onClick={saveAsProfile} title={t("Réutiliser ce paramétrage pour créer d'autres agents")}>
            <BookmarkPlus size={14} /> {profileSaved ? t("Profil enregistré ✓") : t("Enregistrer comme profil")}
          </Button>
          <div className="flex-1" />
          <Button variant="ghost" onClick={onClose}>
            {t("Annuler")}
          </Button>
          <Button variant="primary" onClick={save} disabled={busy !== null}>
            {busy === "save" ? t("Enregistrement…") : t("Enregistrer")}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-5">
        <div className="rounded-xl border border-accent/30 bg-accent/5 p-3">
          <div className="mb-2 flex items-center gap-1.5 text-sm font-medium">
            <Sparkles size={14} className="text-accent" /> {t("Générer le profil avec l'IA")}
          </div>
          <div className="flex gap-2">
            <Input value={brief} onChange={(e) => setBrief(e.target.value)} placeholder={t("ex : expert sécurité applicative qui revoit les API et propose des correctifs")} />
            <Button variant="primary" onClick={generate} disabled={!brief.trim() || busy !== null}>
              {busy === "gen" ? t("Génération…") : t("Générer")}
            </Button>
          </div>
          <p className="mt-1.5 text-[11px] text-fg-subtle">{t("Le modèle par défaut rédige nom, rôle, emoji et prompt. Tu peux tout retoucher avant d'enregistrer.")}</p>
        </div>

        <ErrorNote>{error}</ErrorNote>

        <div className="grid grid-cols-[auto_1fr] items-end gap-3">
          <Field label={t("Emoji")}>
            <Input className="w-16 text-center text-lg" value={a.emoji} onChange={(e) => set("emoji", e.target.value)} />
          </Field>
          <Field label={t("Nom")}>
            <Input value={a.name} onChange={(e) => set("name", e.target.value)} placeholder={t("Architecte")} />
          </Field>
        </div>
        <Field label={t("Rôle")}>
          <Input value={a.role} onChange={(e) => set("role", e.target.value)} placeholder={t("Architecture système et choix techniques")} />
        </Field>
        <ColorField value={a.color ?? COLORS[0]} onChange={(c) => set("color", c)} />
        <Field label={t("Prompt système")}>
          <Textarea rows={9} value={a.system_prompt} onChange={(e) => set("system_prompt", e.target.value)} placeholder={t("Tu es… Ta mission… Ta méthode… Format de réponse…")} />
        </Field>

        <div className="grid gap-3 sm:grid-cols-3">
          <Field
            label={t("Modèle")}
            className="sm:col-span-2"
            hint={selectedModel && !selectedModel.supports_tools ? <span className="text-amber-400">{t("Ce modèle ne gère pas les outils : ils seront ignorés.")}</span> : undefined}
          >
            <Select value={a.model} onChange={(e) => set("model", e.target.value)}>
              <option value="">{t("Modèle par défaut (Réglages)")}</option>
              {chatModels.map((m) => (
                <option key={m.ref} value={m.ref}>
                  {m.label}
                  {m.supports_tools ? "" : ` · ${t("sans outils")}`}
                </option>
              ))}
            </Select>
          </Field>
          <Field label={t("Réflexion (think)")}>
            <ThinkSelect value={a.think ?? ""} onChange={(v) => set("think", v)} />
          </Field>
        </div>
        <Field label={t("Température : {v}", { v: a.temperature?.toFixed(1) ?? "" })}>
          <input type="range" min={0} max={1.2} step={0.1} value={a.temperature} onChange={(e) => set("temperature", Number(e.target.value))} className="accent-[var(--accent)]" />
        </Field>

        <Field label={t("Outils intégrés")} hint={t("Coche ce dont le rôle a besoin pour agir ; évite les outils inutiles, les petits modèles choisissent mieux parmi peu d'outils.")}>
          {recommended && recommended.some((x) => !a.tools?.includes(x)) && (
            <Button size="sm" variant="soft" className="mb-1 self-start" onClick={() => set("tools", [...new Set([...(a.tools ?? []), ...recommended])])}>
              <Wand2 size={13} /> {t("Ajouter les outils recommandés pour ce rôle")}
            </Button>
          )}
          <ToolChecks meta={meta} value={a.tools ?? []} onChange={(v) => set("tools", v)} />
        </Field>
        {health.data &&
          (a.tools ?? [])
            .filter((tool) => health.data!.tools[tool] === false)
            .map((tool) => (
              <div key={tool} className="flex gap-2 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-300">
                <TriangleAlert size={14} className="shrink-0" />
                {tool === "web_search"
                  ? t("La recherche web ne fonctionnera pas : SearXNG ({searxng}) et le secours ({fallback}) sont indisponibles. Voir Réglages.", {
                      searxng: health.data!.checks.searxng.detail,
                      fallback: health.data!.checks.fallback.detail,
                    })
                  : t("« {tool} » ne pourra pas fonctionner sur cette machine (voir Réglages → Diagnostic).", { tool: meta.tools.find((x) => x.id === tool)?.label ?? tool })}
              </div>
            ))}
        {a.tools?.includes("run_command") && (
          <div className="flex gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-200">
            <TriangleAlert size={14} className="shrink-0" />
            {t("Cet agent pourra lancer des commandes shell sur ta machine, dans le dossier du projet, avec ton utilisateur. Réserve-le aux agents qui construisent ou testent.")}
          </div>
        )}
        {a.tools?.includes("http_request") && (
          <div className="flex gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-200">
            <TriangleAlert size={14} className="shrink-0" />
            {t("Cet agent pourra appeler des API (y compris POST, PUT, DELETE), sur ta machine ou sur internet. Pendant la revue des tâches, cet outil est désactivé.")}
          </div>
        )}

        <Field label={t("Skills")}>
          <Pick items={skills.data ?? []} value={a.skill_ids ?? []} onChange={(v) => set("skill_ids", v)} render={(s) => s.name} empty={t("Aucun skill : crée-en dans l'onglet Skills.")} />
        </Field>
        <AgentKnowledge value={a} onChange={(patch) => setA((x) => ({ ...x, ...patch }))} />
        <p className="rounded-lg border border-line bg-surface-1 px-3 py-2 text-xs text-fg-muted">
          🔌 {t("Les serveurs MCP se donnent par projet (onglet")} <b>{t("Équipe")}</b> {t("du projet → Ressources). Un projet peut aussi ajouter ses propres bases de connaissances à cet agent.")}
        </p>
      </div>
    </Drawer>
  );
}
