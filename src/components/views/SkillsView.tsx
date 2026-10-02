"use client";

import { Blocks, FileUp, Library, Plus, RefreshCw, Search, Sparkles, Trash2, Users, X } from "lucide-react";
import { useMemo, useRef, useState } from "react";
import { SKILL_CATEGORIES } from "@/lib/skillLibrary";
import { api, crud, useData, type Agent, type Skill } from "../api";
import { Avatar, Badge, Button, cx, Drawer, Empty, ErrorNote, Field, Input, Markdown, Modal, PageHeader, Select, Textarea } from "../ui";

const OTHER = "Autres";
// Fixed categorical order (validated dark palette); a category keeps its colour whatever the filter.
const CATEGORY_COLOR: Record<string, string> = {
  Développement: "#3987e5",
  "Produit & gestion": "#d95926",
  "Data & IA": "#199e70",
  Communication: "#c98500",
  [OTHER]: "#9085e9",
};
const categoryOf = (s: Pick<Skill, "category">) => (s.category && s.category in CATEGORY_COLOR ? s.category : OTHER);
/** Rough prompt cost: about 4 characters per token. */
const tokens = (s: Pick<Skill, "content" | "description">) => Math.round(((s.content?.length ?? 0) + (s.description?.length ?? 0)) / 4);

/** Parse a SKILL.md (YAML-ish frontmatter with name/description, then the body). */
function parseSkillMd(text: string, fallbackName: string): Partial<Skill> {
  const m = text.match(/^---\s*\n([\s\S]*?)\n---\s*\n?([\s\S]*)$/);
  if (!m) return { name: fallbackName, description: "", content: text };
  const meta: Record<string, string> = {};
  for (const line of m[1].split("\n")) {
    const kv = line.match(/^(\w[\w-]*)\s*:\s*(.*)$/);
    if (kv) meta[kv[1]] = kv[2].replace(/^["']|["']$/g, "");
  }
  return { name: meta.name || fallbackName, description: meta.description || "", content: m[2].trim() };
}

type LibrarySkill = { name: string; category: string; description: string; content: string; profiles: string[]; installed: boolean; id?: string; outdated: boolean };

/** Built-in skills: pick the ones to install, optionally giving them to the matching agents. */
function SkillLibrary({ onClose, onInstalled }: { onClose: () => void; onInstalled: () => void }) {
  const lib = useData<LibrarySkill[]>("/api/skills/library");
  const [picked, setPicked] = useState<string[] | null>(null);
  const [assign, setAssign] = useState(true);
  const [result, setResult] = useState<string>();
  const available = (lib.data ?? []).filter((s) => !s.installed).map((s) => s.name);
  const sel = picked ?? available;
  const outdated = (lib.data ?? []).filter((s) => s.outdated).map((s) => s.name);
  const run = async (json: object) => {
    const r = await api<{ added: number; updated: number; assigned: number }>("/api/skills/library", { method: "POST", json });
    setResult([r.added && `${r.added} ajouté(s)`, r.updated && `${r.updated} mis à jour`, r.assigned && `${r.assigned} agent(s) équipé(s)`].filter(Boolean).join(", ") || "Rien à changer.");
    setPicked([]);
    lib.reload();
    onInstalled();
  };
  return (
    <Modal
      open
      onClose={onClose}
      title="Bibliothèque de skills"
      footer={
        <>
          <label className="mr-auto flex items-center gap-2 text-sm">
            <input type="checkbox" checked={assign} onChange={(e) => setAssign(e.target.checked)} className="accent-[var(--accent)]" />
            Attribuer aux agents des profils recommandés
          </label>
          <Button variant="ghost" onClick={onClose}>
            Fermer
          </Button>
          <Button
            variant="primary"
            disabled={!sel.length && !assign}
            // Nothing new to add: (re)assign the installed library skills to the matching agents.
            onClick={() => run({ names: sel.length ? sel : (lib.data ?? []).filter((s) => s.installed).map((s) => s.name), assign })}
          >
            {sel.length ? `Ajouter ${sel.length}` : "Attribuer aux agents"}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-2">
        {result && <div className="rounded-lg bg-emerald-500/10 px-3 py-2 text-sm text-emerald-400">{result}</div>}
        {outdated.length > 0 && (
          <div className="flex items-center gap-2 rounded-lg border border-accent/40 bg-accent/5 px-3 py-2 text-sm">
            <RefreshCw size={14} className="text-accent" />
            <span className="flex-1">
              {outdated.length} skill(s) installé(s) ont une version enrichie dans la bibliothèque. La mise à jour remplace leur texte (tes modifications éventuelles seraient perdues).
            </span>
            <Button size="sm" onClick={() => run({ update: outdated })}>
              Mettre à jour
            </Button>
          </div>
        )}
        <p className="text-xs text-fg-muted">Des méthodes courtes et des formats de sortie, pensés pour les modèles locaux. Chaque skill est ajouté au prompt des agents qui le possèdent.</p>
        <div className="max-h-[55vh] overflow-y-auto rounded-lg border border-line">
          {SKILL_CATEGORIES.map((cat) => {
            const items = (lib.data ?? []).filter((s) => s.category === cat);
            if (!items.length) return null;
            return (
              <div key={cat}>
                <div className="sticky top-0 z-10 flex items-center gap-2 border-b border-line bg-surface-1 px-3 py-1.5 text-xs font-semibold">
                  <span className="h-2 w-2 rounded-full" style={{ background: CATEGORY_COLOR[cat] }} />
                  {cat}
                </div>
                {items.map((s) => (
                  <label key={s.name} className={cx("flex items-start gap-3 border-b border-line px-3 py-2 last:border-0", s.installed ? "opacity-70" : "cursor-pointer hover:bg-surface-2")}>
                    <input
                      type="checkbox"
                      disabled={s.installed}
                      checked={s.installed || sel.includes(s.name)}
                      onChange={() => setPicked(sel.includes(s.name) ? sel.filter((n) => n !== s.name) : [...sel, s.name])}
                      className="mt-1 accent-[var(--accent)]"
                    />
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center gap-2 text-sm font-medium">
                        {s.name} {s.installed && <Badge>installé</Badge>} {s.outdated && <Badge color="#7c6cf6">mise à jour</Badge>}
                      </span>
                      <span className="block text-xs text-fg-muted">{s.description}</span>
                      <span className="block text-[11px] text-fg-subtle">Pour : {s.profiles.join(", ")}</span>
                    </span>
                  </label>
                ))}
              </div>
            );
          })}
        </div>
      </div>
    </Modal>
  );
}

/** Ask the default model for a skill draft from a short brief. */
function GenerateSkill({ onClose, onDraft }: { onClose: () => void; onDraft: (s: Partial<Skill>) => void }) {
  const [brief, setBrief] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  return (
    <Modal
      open
      onClose={onClose}
      title="Générer un skill avec l'IA"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Annuler
          </Button>
          <Button
            variant="primary"
            disabled={!brief.trim() || busy}
            onClick={async () => {
              setBusy(true);
              setError(undefined);
              try {
                onDraft(await api<Skill>("/api/generate", { method: "POST", json: { kind: "skill", description: brief } }));
              } catch (e) {
                setError(e instanceof Error ? e.message : String(e));
                setBusy(false);
              }
            }}
          >
            <Sparkles size={14} /> {busy ? "Génération…" : "Générer un brouillon"}
          </Button>
        </>
      }
    >
      <ErrorNote>{error}</ErrorNote>
      <Field label="Ce que le skill doit apprendre aux agents" hint="Le modèle local rédige un brouillon que tu pourras relire et modifier avant de l'enregistrer.">
        <Textarea rows={4} autoFocus value={brief} onChange={(e) => setBrief(e.target.value)} placeholder="ex : revue de code orientée sécurité, avec une grille de sévérité" />
      </Field>
    </Modal>
  );
}

/** One skill: preview first, edit on demand, and which agents have it. */
function SkillDrawer({
  initial,
  agents,
  outdated,
  onClose,
  onSaved,
  onAgentsChanged,
}: {
  initial: Partial<Skill>;
  agents: Agent[];
  outdated: boolean;
  onClose: () => void;
  onSaved: (s: Skill | null) => void;
  onAgentsChanged: () => void;
}) {
  const [cur, setCur] = useState<Partial<Skill>>(initial);
  const [editing, setEditing] = useState(!initial.id);
  const [error, setError] = useState<string>();
  const color = CATEGORY_COLOR[categoryOf({ category: cur.category ?? "" })];
  const users = agents.filter((a) => cur.id && a.skill_ids?.includes(cur.id));
  const save = async () => {
    if (!cur.name?.trim()) return setError("Le nom est obligatoire");
    const s = await crud.save<Skill>("skills", cur);
    setCur(s);
    setEditing(false);
    setError(undefined);
    onSaved(s);
  };
  const toggleAgent = async (a: Agent) => {
    if (!cur.id) return;
    const has = a.skill_ids?.includes(cur.id);
    await crud.save("agents", { id: a.id, skill_ids: has ? a.skill_ids.filter((x) => x !== cur.id) : [...(a.skill_ids ?? []), cur.id] });
    onAgentsChanged();
  };
  return (
    <Drawer
      open
      wide
      onClose={onClose}
      title={
        <span className="flex items-center gap-2">
          <span className="h-2.5 w-2.5 rounded-full" style={{ background: color }} />
          {cur.name || "Nouveau skill"}
        </span>
      }
      footer={
        <>
          {cur.id && (
            <Button
              variant="danger"
              onClick={async () => {
                if (!confirm(`Supprimer le skill « ${cur.name} » ?`)) return;
                await crud.remove("skills", cur.id!);
                onSaved(null);
              }}
            >
              <Trash2 size={14} />
            </Button>
          )}
          <div className="flex-1" />
          {editing ? (
            <>
              {cur.id && (
                <Button variant="ghost" onClick={() => (setCur(initial), setEditing(false))}>
                  Annuler
                </Button>
              )}
              <Button variant="primary" onClick={save}>
                Enregistrer
              </Button>
            </>
          ) : (
            <Button variant="primary" onClick={() => setEditing(true)}>
              Modifier
            </Button>
          )}
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <ErrorNote>{error}</ErrorNote>
        {outdated && !editing && (
          <div className="flex items-center gap-2 rounded-lg border border-accent/40 bg-accent/5 px-3 py-2 text-xs">
            <RefreshCw size={13} className="text-accent" />
            <span className="flex-1">La bibliothèque propose une version enrichie de ce skill.</span>
            <Button
              size="sm"
              onClick={async () => {
                await api("/api/skills/library", { method: "POST", json: { update: [cur.name] } });
                const fresh = (await api<Skill[]>("/api/crud/skills")).find((s) => s.id === cur.id);
                if (fresh) setCur(fresh);
                onSaved(fresh ?? null);
              }}
            >
              Mettre à jour
            </Button>
          </div>
        )}
        {editing ? (
          <>
            <div className="grid gap-3 sm:grid-cols-[1fr_200px]">
              <Field label="Nom">
                <Input value={cur.name ?? ""} onChange={(e) => setCur({ ...cur, name: e.target.value })} />
              </Field>
              <Field label="Catégorie">
                <Select value={cur.category ?? ""} onChange={(e) => setCur({ ...cur, category: e.target.value })}>
                  <option value="">{OTHER}</option>
                  {SKILL_CATEGORIES.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </Select>
              </Field>
            </div>
            <Field label="Quand l'utiliser">
              <Input value={cur.description ?? ""} onChange={(e) => setCur({ ...cur, description: e.target.value })} />
            </Field>
            <Field label="Instructions (Markdown)" hint={`≈ ${tokens(cur as Skill)} tokens ajoutés au prompt de chaque agent qui possède ce skill.`}>
              <Textarea rows={20} className="font-mono text-xs" value={cur.content ?? ""} onChange={(e) => setCur({ ...cur, content: e.target.value })} />
            </Field>
          </>
        ) : (
          <>
            <div className="flex flex-wrap items-center gap-2 text-xs text-fg-muted">
              <Badge color={color}>{categoryOf({ category: cur.category ?? "" })}</Badge>
              <span>≈ {tokens(cur as Skill)} tokens</span>
            </div>
            <p className="text-sm text-fg-muted">{cur.description}</p>
            <div className="rounded-lg border border-line bg-surface-0 p-4 text-sm">
              <Markdown>{cur.content || "_vide_"}</Markdown>
            </div>
          </>
        )}
        {cur.id && (
          <Field label={`Agents qui possèdent ce skill (${users.length})`} hint="Coche pour ajouter le skill au prompt de l'agent ; décoche pour le retirer.">
            <div className="grid max-h-56 grid-cols-1 gap-1 overflow-y-auto sm:grid-cols-2">
              {agents.map((a) => (
                <label key={a.id} className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1 text-sm hover:bg-surface-2">
                  <input type="checkbox" checked={users.includes(a)} onChange={() => toggleAgent(a)} className="accent-[var(--accent)]" />
                  <Avatar emoji={a.emoji} color={a.color} size={20} />
                  <span className="truncate">{a.name}</span>
                </label>
              ))}
            </div>
          </Field>
        )}
      </div>
    </Drawer>
  );
}

type Usage = "all" | "used" | "unused";

export function SkillsView() {
  const skills = useData<Skill[]>("/api/crud/skills");
  const agents = useData<Agent[]>("/api/crud/agents");
  const lib = useData<LibrarySkill[]>("/api/skills/library");
  const [open, setOpen] = useState<Partial<Skill> | null>(null);
  const [library, setLibrary] = useState(false);
  const [generate, setGenerate] = useState(false);
  const [q, setQ] = useState("");
  const [cat, setCat] = useState<string | null>(null);
  const [usage, setUsage] = useState<Usage>("all");
  const [onlyOutdated, setOnlyOutdated] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const all = useMemo(() => skills.data ?? [], [skills.data]);
  const agentList = agents.data ?? [];
  const usersOf = (s: Skill) => agentList.filter((a) => a.skill_ids?.includes(s.id));
  const outdated = new Set((lib.data ?? []).filter((s) => s.outdated && s.id).map((s) => s.id!));
  const norm = (t: string) => t.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
  const visible = all.filter(
    (s) =>
      (!q || norm(`${s.name} ${s.description} ${s.content}`).includes(norm(q))) &&
      (!cat || categoryOf(s) === cat) &&
      (usage === "all" || (usage === "used") === usersOf(s).length > 0) &&
      (!onlyOutdated || outdated.has(s.id)),
  );
  const categories = [...SKILL_CATEGORIES, OTHER].filter((c) => all.some((s) => categoryOf(s) === c));
  const reload = () => (skills.reload(), lib.reload());
  const filtered = q || cat || usage !== "all" || onlyOutdated;

  return (
    <div className="flex h-full flex-col">
      <PageHeader
        title="Skills"
        subtitle="Des méthodes et formats réutilisables, injectés dans le prompt des agents qui les possèdent."
        actions={
          <>
            <input
              ref={fileRef}
              type="file"
              accept=".md,.markdown,.txt"
              multiple
              hidden
              onChange={async (e) => {
                for (const f of Array.from(e.target.files ?? [])) await crud.save("skills", parseSkillMd(await f.text(), f.name.replace(/\.(md|markdown|txt)$/i, "")));
                e.target.value = "";
                reload();
              }}
            />
            <Button onClick={() => setGenerate(true)}>
              <Sparkles size={15} /> Générer avec l&apos;IA
            </Button>
            <Button onClick={() => setLibrary(true)}>
              <Library size={15} /> Bibliothèque
            </Button>
            <Button onClick={() => fileRef.current?.click()}>
              <FileUp size={15} /> Importer SKILL.md
            </Button>
            <Button variant="primary" onClick={() => setOpen({ name: "", description: "", content: "", category: cat && cat !== OTHER ? cat : "" })}>
              <Plus size={15} /> Nouveau skill
            </Button>
          </>
        }
      />

      {/* filters, in one row above the grid */}
      <div className="flex flex-wrap items-center gap-2 border-b border-line px-6 py-3">
        <div className="relative w-64">
          <Search size={14} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-fg-subtle" />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Rechercher un skill…" className="h-8 pl-8 text-sm" />
        </div>
        <div className="flex flex-wrap gap-1">
          <button onClick={() => setCat(null)} className={cx("rounded-full border px-2.5 py-1 text-xs", !cat ? "border-accent bg-accent/15 text-fg" : "border-line text-fg-muted hover:text-fg")}>
            Toutes <span className="opacity-60">{all.length}</span>
          </button>
          {categories.map((c) => (
            <button
              key={c}
              onClick={() => setCat(cat === c ? null : c)}
              className={cx("flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs", cat === c ? "text-fg" : "border-line text-fg-muted hover:text-fg")}
              style={cat === c ? { borderColor: CATEGORY_COLOR[c], background: `${CATEGORY_COLOR[c]}26` } : undefined}
            >
              <span className="h-2 w-2 rounded-full" style={{ background: CATEGORY_COLOR[c] }} />
              {c} <span className="opacity-60">{all.filter((s) => categoryOf(s) === c).length}</span>
            </button>
          ))}
        </div>
        <div className="ml-auto flex items-center gap-2">
          {outdated.size > 0 && (
            <button
              onClick={() => setOnlyOutdated(!onlyOutdated)}
              className={cx("flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs", onlyOutdated ? "border-accent bg-accent/15 text-fg" : "border-line text-fg-muted hover:text-fg")}
            >
              <RefreshCw size={11} /> Mises à jour {outdated.size}
            </button>
          )}
          <div className="flex rounded-lg border border-line p-0.5 text-xs">
            {(
              [
                ["all", "Tous"],
                ["used", "Attribués"],
                ["unused", "Non attribués"],
              ] as [Usage, string][]
            ).map(([v, label]) => (
              <button key={v} onClick={() => setUsage(v)} className={cx("rounded-md px-2.5 py-1", usage === v ? "bg-surface-3 text-fg" : "text-fg-muted hover:text-fg")}>
                {label}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-6 py-4">
        {!all.length ? (
          <Empty icon={<Blocks size={28} />} title="Aucun skill">
            Ajoute les skills de la bibliothèque, importe un SKILL.md ou génère un brouillon avec l&apos;IA, puis attache-les aux agents concernés.
          </Empty>
        ) : !visible.length ? (
          <div className="flex flex-col items-center gap-2 py-16 text-sm text-fg-muted">
            Aucun skill ne correspond aux filtres.
            <Button size="sm" variant="ghost" onClick={() => (setQ(""), setCat(null), setUsage("all"), setOnlyOutdated(false))}>
              <X size={13} /> Effacer les filtres
            </Button>
          </div>
        ) : (
          <div className="flex flex-col gap-6">
            {filtered && <div className="text-xs text-fg-subtle">{visible.length} skill(s) affiché(s) sur {all.length}</div>}
            {categories.map((c) => {
              const items = visible.filter((s) => categoryOf(s) === c);
              if (!items.length) return null;
              return (
                <section key={c}>
                  <h2 className="mb-2 flex items-center gap-2 text-sm font-semibold">
                    <span className="h-2.5 w-2.5 rounded-full" style={{ background: CATEGORY_COLOR[c] }} />
                    {c}
                    <span className="text-xs font-normal text-fg-subtle">{items.length}</span>
                  </h2>
                  <div className="grid grid-cols-1 gap-3 md:grid-cols-2 2xl:grid-cols-3">
                    {items.map((s) => {
                      const users = usersOf(s);
                      return (
                        <button
                          key={s.id}
                          onClick={() => setOpen(s)}
                          className="group relative flex flex-col gap-2 overflow-hidden rounded-xl border border-line bg-surface-1 p-4 pl-5 text-left transition hover:border-line-strong hover:bg-surface-2"
                        >
                          <span className="absolute inset-y-0 left-0 w-1" style={{ background: CATEGORY_COLOR[c] }} />
                          <div className="flex items-start gap-2">
                            <span className="flex-1 text-sm font-semibold leading-snug">{s.name}</span>
                            {outdated.has(s.id) && <Badge color="#7c6cf6">mise à jour</Badge>}
                          </div>
                          <p className="line-clamp-2 text-xs leading-relaxed text-fg-muted">{s.description || "Sans description"}</p>
                          <div className="mt-auto flex items-center gap-2 pt-1 text-[11px] text-fg-subtle">
                            <span>≈ {tokens(s)} tokens</span>
                            <span className="ml-auto flex items-center gap-1">
                              {users.length ? (
                                <>
                                  <span className="flex -space-x-1.5">
                                    {users.slice(0, 4).map((a) => (
                                      <span key={a.id} title={a.name} className="rounded-full ring-2 ring-[var(--surface-1)]">
                                        <Avatar emoji={a.emoji} color={a.color} size={20} />
                                      </span>
                                    ))}
                                  </span>
                                  {users.length > 4 && <span>+{users.length - 4}</span>}
                                </>
                              ) : (
                                <span className="flex items-center gap-1">
                                  <Users size={11} /> aucun agent
                                </span>
                              )}
                            </span>
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </section>
              );
            })}
          </div>
        )}
      </div>

      {open && (
        <SkillDrawer
          key={open.id ?? "new"}
          initial={open}
          agents={agentList}
          outdated={!!open.id && outdated.has(open.id)}
          onClose={() => setOpen(null)}
          onSaved={(s) => {
            reload();
            if (!s) setOpen(null);
          }}
          onAgentsChanged={agents.reload}
        />
      )}
      {library && <SkillLibrary onClose={() => setLibrary(false)} onInstalled={reload} />}
      {generate && (
        <GenerateSkill
          onClose={() => setGenerate(false)}
          onDraft={(d) => {
            setGenerate(false);
            setOpen({ ...d, id: undefined });
          }}
        />
      )}
    </div>
  );
}
