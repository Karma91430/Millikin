"use client";

import {
  Check,
  ChevronRight,
  Code2,
  Copy,
  Eye,
  File,
  Folder,
  FolderOpen,
  FolderPlus,
  CalendarRange,
  Link2,
  ListTree,
  Loader2,
  Lock,
  MessageSquare,
  Pencil,
  Play,
  Plus,
  RefreshCw,
  RotateCcw,
  Square,
  Trash2,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { layoutOf, specFromTeam, type TeamSpec } from "@/lib/team";
import type { Trace } from "@/lib/trace";
import { api, crud, formatBytes, useData, type Agent, type Project, type RunInfo, type Sprint, type Task, type Team } from "../api";
import { CallFocus } from "../chat/CallFocus";
import { ProjectResourcesPanel } from "../ProjectResources";
import { TeamBuilder } from "../TeamBuilder";
import { Avatar, Badge, Button, Card, cx, Empty, ErrorNote, Field, Input, Markdown, Modal, Select, Textarea } from "../ui";
import { useRunTrace } from "../useRunTrace";

const COLUMNS: { id: Task["status"]; label: string; color: string }[] = [
  { id: "todo", label: "À faire", color: "#94a3b8" },
  { id: "doing", label: "En cours", color: "#f59e0b" },
  { id: "review", label: "En revue", color: "#8b5cf6" },
  { id: "done", label: "Terminé", color: "#10b981" },
];
const PRIORITY: Record<Task["priority"], { label: string; color?: string }> = {
  high: { label: "haute", color: "#ef4444" },
  normal: { label: "normale" },
  low: { label: "basse", color: "#64748b" },
};
type Entry = { path: string; dir: boolean; size: number; mtime: number };
type Workspace = { root: string; entries: Entry[] };
type Tab = "overview" | "tasks" | "files" | "team" | "stats";
const POINTS = [0, 1, 2, 3, 5, 8, 13];

const ago = (ms: number) => {
  const s = Math.round((Date.now() - ms) / 1000);
  if (s < 60) return "à l'instant";
  if (s < 3600) return `il y a ${Math.round(s / 60)} min`;
  if (s < 86400) return `il y a ${Math.round(s / 3600)} h`;
  return new Date(ms).toLocaleDateString("fr-FR");
};

function useCopy() {
  const [copied, setCopied] = useState<string | null>(null);
  const copy = async (text: string) => {
    await navigator.clipboard.writeText(text).catch(() => {});
    setCopied(text);
    setTimeout(() => setCopied((c) => (c === text ? null : c)), 1500);
  };
  return { copied, copy };
}

const openIn = (projectId: string, app: "finder" | "vscode", file?: string) => api("/api/workspace", { method: "POST", json: { projectId, app, file } });

export function ProjectsView({
  agents,
  teams,
  projects,
  reloadProjects,
  runs,
  onChat,
  onAgentsChange,
  selected,
  onSelect,
  createFrom,
  onCreateHandled,
  onRunsChanged,
  onPlanChat,
}: {
  agents: Agent[];
  teams: Team[];
  /** Owned by the app so the workspace sees team edits immediately. */
  projects?: Project[];
  reloadProjects: () => void;
  runs: RunInfo[];
  onChat: (projectId: string) => void;
  onAgentsChange: () => void;
  selected: string | null;
  onSelect: (id: string | null) => void;
  /** Open the "new project" dialog preset with this team template. */
  createFrom: string | null;
  onCreateHandled: () => void;
  onRunsChanged: () => void;
  /** Open a scoping-then-planning discussion with the project's first contacts. */
  onPlanChat: (projectId: string) => void;
}) {
  const tasks = useData<Task[]>("/api/crud/tasks");
  const [creating, setCreating] = useState(false);
  const list = projects ?? [];
  const project = list.find((p) => p.id === selected) ?? list[0];

  // Agents update the board during runs: keep it fresh.
  useEffect(() => {
    const t = setInterval(tasks.reload, 3000);
    return () => clearInterval(t);
  }, [tasks.reload]);

  const showCreate = creating || !!createFrom;

  return (
    <div className="flex h-full min-h-0">
      {/* project sub-menu */}
      <aside className="flex w-64 shrink-0 flex-col border-r border-line">
        <div className="flex items-center justify-between px-4 pb-2 pt-4">
          <span className="text-xs font-semibold uppercase tracking-wide text-fg-subtle">Projets</span>
          <Button size="sm" variant="ghost" onClick={() => setCreating(true)} title="Nouveau projet">
            <FolderPlus size={15} />
          </Button>
        </div>
        <div className="flex-1 overflow-y-auto px-2 pb-3">
          {list.map((p) => {
            const mine = (tasks.data ?? []).filter((x) => x.project_id === p.id);
            const done = mine.filter((x) => x.status === "done").length;
            const busy = runs.some((r) => r.status === "running" && r.targetId === p.id);
            return (
              <button key={p.id} onClick={() => onSelect(p.id)} className={cx("mb-1 w-full rounded-lg px-3 py-2.5 text-left", p.id === project?.id ? "bg-surface-3" : "hover:bg-surface-2")}>
                <div className="flex items-center gap-2">
                  <span className="flex-1 truncate text-sm font-medium">{p.name}</span>
                  {busy && <Loader2 size={13} className="animate-spin text-accent" />}
                </div>
                <div className="mt-1 flex items-center gap-2 text-[11px] text-fg-subtle">
                  <span>
                    {mine.length} tâche{mine.length > 1 ? "s" : ""}
                  </span>
                  {mine.length > 0 && (
                    <span className="h-1 flex-1 overflow-hidden rounded-full bg-surface-3">
                      <span className="block h-full bg-emerald-500" style={{ width: `${(done / mine.length) * 100}%` }} />
                    </span>
                  )}
                </div>
              </button>
            );
          })}
          {!list.length && projects && (
            <button onClick={() => setCreating(true)} className="w-full rounded-lg border border-dashed border-line p-3 text-left text-xs text-fg-muted hover:border-line-strong">
              Aucun projet. Crée le premier à partir d&apos;un modèle d&apos;équipe.
            </button>
          )}
        </div>
      </aside>

      {project ? (
        <ProjectDetail
          key={project.id}
          project={project}
          agents={agents}
          tasks={(tasks.data ?? []).filter((t) => t.project_id === project.id)}
          reloadTasks={tasks.reload}
          runs={runs}
          onChat={() => onChat(project.id)}
          reloadProjects={reloadProjects}
          onAgentsChange={onAgentsChange}
          onRunsChanged={onRunsChanged}
          onPlanChat={() => onPlanChat(project.id)}
          onDeleted={() => (onSelect(null), reloadProjects())}
        />
      ) : (
        <Empty title="Aucun projet">Un projet a son propre dossier, son tableau de tâches et une équipe copiée depuis un modèle.</Empty>
      )}

      {showCreate && (
        <NewProject
          teams={teams}
          templateId={createFrom}
          onClose={() => (setCreating(false), onCreateHandled())}
          onCreated={(p, scoping) => {
            setCreating(false);
            onCreateHandled();
            reloadProjects();
            onSelect(p.id);
            if (scoping) onPlanChat(p.id);
          }}
        />
      )}
    </div>
  );
}

function NewProject({ teams, templateId, onClose, onCreated }: { teams: Team[]; templateId: string | null; onClose: () => void; onCreated: (p: Project, scoping: boolean) => void }) {
  const [scoping, setScoping] = useState(true);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [template, setTemplate] = useState(templateId && templateId !== "__new" ? templateId : (teams[0]?.id ?? ""));
  const [dir, setDir] = useState("");
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  return (
    <Modal
      open
      onClose={onClose}
      title="Nouveau projet"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Annuler
          </Button>
          <Button
            variant="primary"
            disabled={!name.trim() || busy}
            onClick={async () => {
              setBusy(true);
              try {
                onCreated(await api<Project>("/api/projects", { method: "POST", json: { name, description, template_id: template, path: dir } }), scoping);
              } catch (e) {
                setError(e instanceof Error ? e.message : String(e));
                setBusy(false);
              }
            }}
          >
            Créer le projet
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        <ErrorNote>{error}</ErrorNote>
        <Field label="Nom du projet">
          <Input autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="Appli de réservation de salles" />
        </Field>
        <Field label="Description">
          <Textarea rows={2} value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Objectif, contexte, contraintes…" />
        </Field>
        <Field label="Équipe (modèle)" hint="La composition est copiée dans le projet : tu pourras l'ajuster sans modifier le modèle.">
          <Select value={template} onChange={(e) => setTemplate(e.target.value)}>
            {teams.map((t) => (
              <option key={t.id} value={t.id}>
                👥 {t.name}
              </option>
            ))}
            <option value="">Équipe vide (à construire)</option>
          </Select>
        </Field>
        <Field label="Dossier du projet (optionnel)" hint="Vide : un dossier dédié est créé dans workspace/ avec le nom du projet.">
          <Input className="font-mono text-xs" value={dir} onChange={(e) => setDir(e.target.value)} placeholder="/Users/moi/Projets/reservation-salles" />
        </Field>
        <label className="flex items-start gap-2 rounded-lg border border-line bg-surface-1 p-3 text-sm">
          <input type="checkbox" checked={scoping} onChange={(e) => setScoping(e.target.checked)} className="mt-0.5 accent-[var(--accent)]" />
          <span>
            <span className="block font-medium">Démarrer par un échange de cadrage avec l&apos;équipe</span>
            <span className="block text-xs text-fg-muted">Les premiers contacts te posent leurs questions, puis découpent le projet en tâches quand tu valides.</span>
          </span>
        </label>
      </div>
    </Modal>
  );
}

function ProjectDetail({
  project,
  agents,
  tasks,
  reloadTasks,
  runs,
  onChat,
  reloadProjects,
  onAgentsChange,
  onRunsChanged,
  onPlanChat,
  onDeleted,
}: {
  project: Project;
  agents: Agent[];
  tasks: Task[];
  reloadTasks: () => void;
  runs: RunInfo[];
  onChat: () => void;
  reloadProjects: () => void;
  onAgentsChange: () => void;
  onRunsChanged: () => void;
  onPlanChat: () => void;
  onDeleted: () => void;
}) {
  const [tab, setTab] = useState<Tab>("overview");
  const [openFile, setOpenFile] = useState<string | null>(null);
  const ws = useData<Workspace>(`/api/workspace?projectId=${project.id}`);
  const { copied, copy } = useCopy();
  const [editPath, setEditPath] = useState<string | null>(null);
  const byId = useMemo(() => new Map(agents.map((a) => [a.id, a])), [agents]);
  const spec = specFromTeam(project.team);
  const people = spec.agent_ids.map((id) => byId.get(id)).filter((a): a is Agent => !!a);
  const busy = runs.some((r) => r.status === "running" && r.targetId === project.id);

  // Files change while agents work: refresh the listing during runs.
  useEffect(() => {
    if (!busy) return;
    const t = setInterval(ws.reload, 3000);
    return () => clearInterval(t);
  }, [busy, ws.reload]);

  const root = ws.data?.root ?? project.path;
  const showFile = (p: string) => (setOpenFile(p), setTab("files"));

  return (
    <div className="flex min-w-0 flex-1 flex-col">
      <div className="border-b border-line px-6 pb-0 pt-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <h1 className="text-lg font-semibold">{project.name}</h1>
              {busy && (
                <span className="flex items-center gap-1 rounded-full bg-accent/15 px-2 py-0.5 text-[11px] text-accent">
                  <Loader2 size={11} className="animate-spin" /> l&apos;équipe travaille
                </span>
              )}
            </div>
            {project.description && <div className="mt-0.5 max-w-2xl text-sm text-fg-muted">{project.description}</div>}
            <div className="mt-1.5 flex items-center -space-x-1.5">
              {people.map((a) => (
                <span key={a.id} title={`${a.name} — ${a.role}${spec.entry_ids.includes(a.id) ? " (premier contact)" : ""}`}>
                  <Avatar emoji={a.emoji} color={a.color} size={24} />
                </span>
              ))}
            </div>
          </div>
          <div className="flex gap-2">
            <Button variant="primary" onClick={onChat}>
              <MessageSquare size={14} /> Discuter avec l&apos;équipe
            </Button>
            <Button
              variant="ghost"
              title="Supprimer le projet (les fichiers sur le disque sont conservés)"
              onClick={async () => {
                if (!confirm(`Supprimer le projet « ${project.name} », ses conversations et ses tâches ?\nLes fichiers du dossier sont conservés.`)) return;
                await api(`/api/projects?id=${project.id}`, { method: "DELETE" });
                onDeleted();
              }}
            >
              <Trash2 size={14} />
            </Button>
          </div>
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-2 rounded-xl border border-line bg-surface-1 px-3 py-2">
          <FolderOpen size={15} className="shrink-0 text-fg-muted" />
          {editPath === null ? (
            <>
              <code className="min-w-0 flex-1 truncate font-mono text-xs" title={root}>
                {root}
              </code>
              <Button size="sm" variant="ghost" onClick={() => copy(root)} title="Copier le chemin">
                {copied === root ? <Check size={13} className="text-emerald-400" /> : <Copy size={13} />}
              </Button>
              <Button size="sm" variant="ghost" onClick={() => openIn(project.id, "finder")} title="Ouvrir dans le Finder">
                <Folder size={13} /> Finder
              </Button>
              <Button size="sm" variant="ghost" onClick={() => openIn(project.id, "vscode")} title="Ouvrir dans VS Code">
                <Code2 size={13} /> VS Code
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setEditPath(project.path)} title="Changer le dossier du projet">
                <Pencil size={13} />
              </Button>
            </>
          ) : (
            <form
              className="flex flex-1 items-center gap-2"
              onSubmit={async (e) => {
                e.preventDefault();
                await crud.save("projects", { id: project.id, path: editPath.trim() });
                setEditPath(null);
                reloadProjects();
                ws.reload();
              }}
            >
              <Input autoFocus className="h-8 font-mono text-xs" value={editPath} onChange={(e) => setEditPath(e.target.value)} />
              <Button size="sm" variant="primary" type="submit">
                Enregistrer
              </Button>
              <Button size="sm" variant="ghost" type="button" onClick={() => setEditPath(null)}>
                Annuler
              </Button>
            </form>
          )}
        </div>

        <div className="mt-3 flex gap-1">
          {(
            [
              ["overview", "Vue d'ensemble"],
              ["tasks", `Tâches (${tasks.length})`],
              ["files", `Fichiers (${ws.data?.entries.filter((e) => !e.dir).length ?? 0})`],
              ["team", `Équipe (${people.length})`],
              ["stats", "Stats"],
            ] as const
          ).map(([id, label]) => (
            <button
              key={id}
              onClick={() => setTab(id)}
              className={cx("-mb-px border-b-2 px-3 py-2 text-sm", tab === id ? "border-accent text-fg" : "border-transparent text-fg-muted hover:text-fg")}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {tab === "overview" && <Overview projectId={project.id} tasks={tasks} byId={byId} ws={ws.data} onTab={setTab} onFile={showFile} />}
        {tab === "tasks" && (
          <Board project={project} tasks={tasks} agents={people} allAgents={byId} reload={reloadTasks} runs={runs} onRunsChanged={onRunsChanged} onPlanChat={onPlanChat} />
        )}
        {tab === "stats" && <ProjectStats projectId={project.id} busy={busy} />}
        {tab === "files" && <Files projectId={project.id} ws={ws.data} reload={ws.reload} selected={openFile} onSelect={setOpenFile} />}
        {tab === "team" && <TeamTab project={project} agents={agents} onSaved={reloadProjects} onAgentsChange={onAgentsChange} />}
      </div>
    </div>
  );
}

/** Team tab: the project's own team composition, and the resources each member may use. */
function TeamTab(props: { project: Project; agents: Agent[]; onSaved: () => void; onAgentsChange: () => void }) {
  const [sub, setSub] = useState<"composition" | "resources">("composition");
  return (
    <div className="flex h-full flex-col">
      <div className="flex gap-1 px-6 pt-4">
        {(
          [
            ["composition", "Composition"],
            ["resources", "Ressources (connaissances & MCP)"],
          ] as const
        ).map(([id, label]) => (
          <button key={id} onClick={() => setSub(id)} className={cx("rounded-lg px-3 py-1 text-sm", sub === id ? "bg-accent/20 text-fg" : "text-fg-muted hover:bg-surface-2")}>
            {label}
          </button>
        ))}
      </div>
      {sub === "composition" ? <ProjectTeam {...props} /> : <ProjectResourcesPanel key={props.project.id} project={props.project} agents={props.agents} onSaved={props.onSaved} />}
    </div>
  );
}

function ProjectTeam({ project, agents, onSaved, onAgentsChange }: { project: Project; agents: Agent[]; onSaved: () => void; onAgentsChange: () => void }) {
  const [spec, setSpec] = useState<TeamSpec>(() => specFromTeam(project.team));
  const [dirty, setDirty] = useState(false);
  const [error, setError] = useState<string>();
  const update = (s: TeamSpec) => (setSpec(s), setDirty(true));
  return (
    <div className="flex h-full min-h-[520px] flex-col gap-3 p-6">
      <div className="flex flex-wrap items-center gap-4">
        <p className="flex-1 text-sm text-fg-muted">Composition propre à ce projet (copiée depuis le modèle à la création). Les changements ici ne modifient pas le modèle.</p>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={spec.clarify} onChange={(e) => update({ ...spec, clarify: e.target.checked })} className="accent-[var(--accent)]" />
          Cadrage avant délégation
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={spec.concert} onChange={(e) => update({ ...spec, concert: e.target.checked })} className="accent-[var(--accent)]" />
          Concertation des premiers contacts
        </label>
        <Button
          variant="primary"
          disabled={!dirty}
          onClick={async () => {
            if (!spec.entry_ids.length) return setError("Définis au moins un premier contact (★)");
            await crud.save("projects", { id: project.id, team: { ...spec, layout: layoutOf(spec) } });
            setDirty(false);
            setError(undefined);
            onSaved();
          }}
        >
          {dirty ? "Enregistrer l'équipe" : "Enregistré ✓"}
        </Button>
      </div>
      <ErrorNote>{error}</ErrorNote>
      <div className="min-h-0 flex-1">
        <TeamBuilder agents={agents} value={spec} onChange={update} onAgentCreated={onAgentsChange} />
      </div>
    </div>
  );
}

function Overview({
  projectId,
  tasks,
  byId,
  ws,
  onTab,
  onFile,
}: {
  projectId: string;
  tasks: Task[];
  byId: Map<string, Agent>;
  ws?: Workspace;
  onTab: (t: Tab) => void;
  onFile: (p: string) => void;
}) {
  const hasLog = ws?.entries.some((e) => e.path === "docs/DECISIONS.md");
  const log = useData<{ content: string }>(hasLog ? `/api/workspace?projectId=${projectId}&file=${encodeURIComponent("docs/DECISIONS.md")}` : null);
  const done = tasks.filter((t) => t.status === "done").length;
  const pct = tasks.length ? Math.round((done / tasks.length) * 100) : 0;
  const recentTasks = [...tasks].sort((a, b) => (b.updated_at ?? 0) - (a.updated_at ?? 0)).slice(0, 6);
  const recentFiles = (ws?.entries ?? [])
    .filter((e) => !e.dir)
    .sort((a, b) => b.mtime - a.mtime)
    .slice(0, 8);
  return (
    <div className="grid gap-4 p-6 lg:grid-cols-2">
      <Card className="p-4 lg:col-span-2">
        <div className="mb-3 flex items-center justify-between">
          <div className="text-sm font-semibold">Avancement</div>
          <div className="text-sm tabular-nums text-fg-muted">{pct} % terminé</div>
        </div>
        <div className="mb-4 flex h-2 overflow-hidden rounded-full bg-surface-3">
          {COLUMNS.map((c) => {
            const n = tasks.filter((t) => t.status === c.id).length;
            return n ? <div key={c.id} style={{ width: `${(n / tasks.length) * 100}%`, background: c.color }} title={`${c.label} : ${n}`} /> : null;
          })}
        </div>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {COLUMNS.map((c) => (
            <button key={c.id} onClick={() => onTab("tasks")} className="rounded-lg border border-line bg-surface-2 p-3 text-left hover:border-line-strong">
              <div className="flex items-center gap-1.5 text-xs text-fg-muted">
                <span className="h-2 w-2 rounded-full" style={{ background: c.color }} />
                {c.label}
              </div>
              <div className="mt-1 text-xl font-semibold tabular-nums">{tasks.filter((t) => t.status === c.id).length}</div>
            </button>
          ))}
        </div>
      </Card>
      <Card>
        <div className="flex items-center justify-between border-b border-line px-4 py-2.5">
          <span className="text-sm font-semibold">Tâches récentes</span>
          <button onClick={() => onTab("tasks")} className="text-xs text-accent hover:underline">
            Tableau
          </button>
        </div>
        {recentTasks.map((t) => {
          const col = COLUMNS.find((c) => c.id === t.status)!;
          const who = byId.get(t.assignee_id);
          return (
            <div key={t.id} className="flex items-center gap-2.5 border-b border-line px-4 py-2.5 last:border-0">
              <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: col.color }} title={col.label} />
              <span className="min-w-0 flex-1 truncate text-sm">{t.title}</span>
              {t.evaluation && <EvalBadge e={t.evaluation} />}
              <Badge color={col.color}>{col.label}</Badge>
              {who && <Avatar emoji={who.emoji} color={who.color} size={20} />}
            </div>
          );
        })}
        {!tasks.length && <div className="px-4 py-4 text-sm text-fg-subtle">Aucune tâche. Discute avec l&apos;équipe pour planifier le projet, ou crée-les dans le tableau.</div>}
      </Card>
      <Card>
        <div className="flex items-center justify-between border-b border-line px-4 py-2.5">
          <span className="text-sm font-semibold">Fichiers récents</span>
          <button onClick={() => onTab("files")} className="text-xs text-accent hover:underline">
            Tous les fichiers
          </button>
        </div>
        {recentFiles.map((f) => (
          <button key={f.path} onClick={() => onFile(f.path)} className="flex w-full items-center gap-2.5 border-b border-line px-4 py-2.5 text-left last:border-0 hover:bg-surface-2">
            <File size={13} className="shrink-0 text-fg-muted" />
            <span className="min-w-0 flex-1 truncate font-mono text-xs">{f.path}</span>
            <span className="shrink-0 text-[11px] text-fg-subtle">{ago(f.mtime)}</span>
          </button>
        ))}
        {!recentFiles.length && <div className="px-4 py-4 text-sm text-fg-subtle">Aucun fichier pour l&apos;instant.</div>}
      </Card>
      <Card className="lg:col-span-2">
        <div className="flex items-center justify-between border-b border-line px-4 py-2.5">
          <span className="text-sm font-semibold">Journal des décisions</span>
          {hasLog && (
            <button onClick={() => onFile("docs/DECISIONS.md")} className="font-mono text-xs text-accent hover:underline">
              docs/DECISIONS.md
            </button>
          )}
        </div>
        <div className="max-h-80 overflow-y-auto px-4 py-3">
          {log.data?.content ? (
            <Markdown>{log.data.content.replace(/^# Journal des décisions\n+/, "")}</Markdown>
          ) : (
            <div className="text-sm text-fg-subtle">
              Vide pour l&apos;instant. Il se remplit quand tu valides un cadrage, quand une tâche est contrôlée, et quand les premiers contacts consignent une décision. Chaque agent du projet le reçoit.
            </div>
          )}
        </div>
      </Card>
    </div>
  );
}

function EvalBadge({ e }: { e: NonNullable<Task["evaluation"]> }) {
  return (
    <Badge color={e.verdict === "valide" ? "#10b981" : "#f59e0b"}>
      {e.verdict === "valide" ? "✓" : "↩"} {e.score}/5
    </Badge>
  );
}

// ---------------------------------------------------------------- tasks board

function Board({
  project,
  tasks,
  agents,
  allAgents,
  reload,
  runs,
  onRunsChanged,
  onPlanChat,
}: {
  project: Project;
  tasks: Task[];
  agents: Agent[];
  allAgents: Map<string, Agent>;
  reload: () => void;
  runs: RunInfo[];
  onRunsChanged: () => void;
  onPlanChat: () => void;
}) {
  const [edit, setEdit] = useState<Partial<Task> | null>(null);
  const [drag, setDrag] = useState<string | null>(null);
  const [local, setLocal] = useState<Record<string, Task["status"]>>({});
  const [error, setError] = useState<string>();
  const [retry, setRetry] = useState(true);
  const [planOpen, setPlanOpen] = useState(false);
  const [sprintEdit, setSprintEdit] = useState<Partial<Sprint> | null>(null);
  const [focus, setFocus] = useState<string | null>(null);
  const sprintData = useData<Sprint[]>("/api/crud/sprints");
  const sprints = (sprintData.data ?? []).filter((x) => x.project_id === project.id);
  const planRun = runs.find((r) => r.status === "running" && r.conversationId === `plan:${project.id}`);
  const planTrace = useRunTrace(`plan:${project.id}`, !!planRun);
  // The planner creates sprints: refresh them while it runs and right after.
  useEffect(() => {
    sprintData.reload();
    if (!planRun) return;
    const t = setInterval(sprintData.reload, 3000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [planRun?.id]);
  const [filterChoice, setFilter] = useState<string | null>(null);
  const validChoice = filterChoice === "all" || filterChoice === "backlog" || sprints.some((x) => x.id === filterChoice) ? filterChoice : null;
  const filter = validChoice ?? sprints.find((x) => x.status === "active")?.id ?? "all";
  const inFilter = (t: Task) => filter === "all" || (filter === "backlog" ? !t.sprint_id || !sprints.some((x) => x.id === t.sprint_id) : t.sprint_id === filter);
  const currentSprint = sprints.find((x) => x.id === filter);
  const byId = allAgents;
  const running = new Set(runs.filter((r) => r.status === "running" && r.conversationId.startsWith("task:")).map((r) => r.conversationId.slice(5)));
  const chain = runs.find((r) => r.status === "running" && r.conversationId === `chain:${project.id}`);
  const statusOf = (t: Task) => local[t.id] ?? t.status;
  const taskById = new Map(tasks.map((t) => [t.id, t]));
  const blockers = (t: Task) => (t.depends_on ?? []).map((id) => taskById.get(id)).filter((d): d is Task => !!d && d.status !== "done");
  const launchChain = async () => {
    setError(undefined);
    try {
      await api("/api/tasks/chain", { method: "POST", json: { projectId: project.id, retry, sprintId: currentSprint?.id } });
      onRunsChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const move = async (id: string, status: Task["status"]) => {
    setLocal((l) => ({ ...l, [id]: status }));
    await crud.save("tasks", { id, status });
    reload();
    setLocal((l) => {
      const n = { ...l };
      delete n[id];
      return n;
    });
  };
  const launch = async (t: Task) => {
    setError(undefined);
    try {
      await api("/api/tasks/run", { method: "POST", json: { taskId: t.id } });
      onRunsChanged();
      reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex flex-wrap items-center gap-2 px-6 pt-4">
        <Button
          variant="primary"
          size="sm"
          onClick={() =>
            setEdit({ project_id: project.id, title: "", description: "", status: "todo", priority: "normal", assignee_id: "", notes: [], complexity: 0, sprint_id: currentSprint?.id ?? "", depends_on: [] })
          }
        >
          <Plus size={14} /> Tâche
        </Button>
        {planRun ? (
          <button onClick={() => planTrace && setFocus(planTrace.order.find((id) => !planTrace.calls[id].parentCallId) ?? null)} className="flex items-center gap-1.5 rounded-full bg-accent/15 px-2.5 py-1 text-xs text-accent">
            <Loader2 size={12} className="animate-spin" /> Planification en cours… suivre
          </button>
        ) : (
          <Button size="sm" variant="soft" onClick={() => setPlanOpen(true)} title="Le premier contact découpe le projet en tâches (avec les autres premiers contacts)">
            <ListTree size={13} /> Planifier
          </Button>
        )}
        {chain ? (
          <>
            <span className="flex items-center gap-1.5 rounded-full bg-accent/15 px-2.5 py-1 text-xs text-accent">
              <Loader2 size={12} className="animate-spin" /> Chaîne en cours
            </span>
            <Button size="sm" variant="danger" onClick={async () => (await api("/api/runs/stop", { method: "POST", json: { id: chain.id } }), onRunsChanged())}>
              <Square size={12} /> Arrêter
            </Button>
          </>
        ) : (
          <>
            <Button size="sm" variant="soft" onClick={launchChain} title="Exécute les tâches ouvertes (du sprint affiché) dans l'ordre des dépendances">
              <Link2 size={13} /> {currentSprint ? `Lancer le ${currentSprint.name}` : "Lancer la chaîne"}
            </Button>
            <label className="flex items-center gap-1.5 text-xs text-fg-muted" title="Si le contrôle renvoie « à corriger », la tâche est relancée une fois avec le retour avant d'arrêter la chaîne">
              <input type="checkbox" checked={retry} onChange={(e) => setRetry(e.target.checked)} className="accent-[var(--accent)]" />
              relancer une fois si « à corriger »
            </label>
          </>
        )}
        <span className="text-xs text-fg-subtle">▶ lance une tâche · 🔒 bloquée tant que ses dépendances ne sont pas terminées</span>
      </div>
      {error && (
        <div className="px-6 pt-2">
          <ErrorNote>{error}</ErrorNote>
        </div>
      )}
      <SprintBar
        sprints={sprints}
        tasks={tasks}
        filter={filter}
        onFilter={setFilter}
        onNew={() => setSprintEdit({ project_id: project.id, name: `Sprint ${sprints.length + 1}`, goal: "", start_date: "", end_date: "", status: "planned" })}
        onEdit={setSprintEdit}
        onAction={async (id, action) => {
          setError(undefined);
          try {
            await api("/api/sprints/action", { method: "POST", json: { id, action } });
            sprintData.reload();
            reload();
          } catch (e) {
            setError(e instanceof Error ? e.message : String(e));
          }
        }}
      />
      <div className="grid min-h-0 flex-1 grid-cols-1 gap-3 px-6 pb-6 pt-3 md:grid-cols-4">
        {COLUMNS.map((col) => {
          const items = tasks.filter((t) => inFilter(t) && statusOf(t) === col.id);
          return (
            <div key={col.id} onDragOver={(e) => e.preventDefault()} onDrop={() => drag && move(drag, col.id)} className="flex min-h-40 flex-col rounded-xl border border-line bg-surface-1/50">
              <div className="flex items-center gap-2 px-3 py-2.5 text-sm font-medium">
                <span className="h-2 w-2 rounded-full" style={{ background: col.color }} />
                {col.label}
                <span className="text-xs text-fg-subtle">{items.length}</span>
              </div>
              <div className="flex flex-1 flex-col gap-2 overflow-y-auto px-2 pb-2">
                {items.map((t) => {
                  const who = byId.get(t.assignee_id);
                  const isRunning = running.has(t.id);
                  const blockedBy = blockers(t);
                  const phaseLabel = isRunning ? (t.status === "review" ? "contrôle en cours…" : `${who?.name ?? "l'agent"} travaille…`) : null;
                  return (
                    <div
                      key={t.id}
                      draggable={!isRunning}
                      onDragStart={() => setDrag(t.id)}
                      onDragEnd={() => setDrag(null)}
                      onClick={() => setEdit(t)}
                      className={cx("pop group cursor-pointer rounded-lg border bg-surface-2 p-2.5 hover:border-line-strong", isRunning ? "border-accent/60" : "border-line")}
                    >
                      <div className="flex items-start gap-2">
                        <div className="min-w-0 flex-1 text-sm font-medium leading-snug">{t.title}</div>
                        {!isRunning && t.status !== "done" && blockedBy.length > 0 && (
                          <span title={`Bloquée par : ${blockedBy.map((b) => b.title).join(", ")}`} className="flex h-6 w-6 shrink-0 items-center justify-center text-fg-subtle">
                            <Lock size={12} />
                          </span>
                        )}
                        {!isRunning && t.status !== "done" && !blockedBy.length && (
                          <button
                            onClick={(e) => (e.stopPropagation(), launch(t))}
                            title={who ? `Lancer : ${who.name} réalise la tâche` : "Assigne d'abord la tâche à un agent"}
                            className={cx(
                              "flex h-6 w-6 shrink-0 items-center justify-center rounded-md",
                              who ? "bg-accent/15 text-accent hover:bg-accent/30" : "cursor-not-allowed text-fg-subtle",
                            )}
                          >
                            <Play size={12} fill="currentColor" />
                          </button>
                        )}
                        {isRunning && <Loader2 size={14} className="mt-0.5 shrink-0 animate-spin text-accent" />}
                      </div>
                      {phaseLabel && <div className="mt-1 text-[11px] text-accent">{phaseLabel}</div>}
                      {!phaseLabel && t.description && <div className="mt-1 line-clamp-2 text-xs text-fg-muted">{t.description}</div>}
                      {t.evaluation && !isRunning && <div className="mt-1.5 line-clamp-2 text-[11px] text-fg-muted">💬 {t.evaluation.comment}</div>}
                      {t.depends_on?.length > 0 && (
                        <div className="mt-1.5 flex flex-wrap gap-1">
                          {t.depends_on.map((id) => {
                            const d = taskById.get(id);
                            return d ? (
                              <span key={id} title={d.title} className={cx("rounded px-1 text-[10px]", d.status === "done" ? "bg-emerald-500/15 text-emerald-400" : "bg-surface-3 text-fg-muted")}>
                                ⛓ {d.title.length > 22 ? d.title.slice(0, 22) + "…" : d.title}
                              </span>
                            ) : null;
                          })}
                        </div>
                      )}
                      <div className="mt-2 flex items-center gap-1.5">
                        {who && <Avatar emoji={who.emoji} color={who.color} size={20} />}
                        {t.evaluation && <EvalBadge e={t.evaluation} />}
                        {t.complexity > 0 && <Badge>{t.complexity} pts</Badge>}
                        {t.priority !== "normal" && <Badge color={PRIORITY[t.priority].color}>{PRIORITY[t.priority].label}</Badge>}
                        {t.notes?.length > 0 && <Badge>{t.notes.length} 💬</Badge>}
                        <span className="ml-auto text-[10px] text-fg-subtle">#{t.id.slice(0, 5)}</span>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
      {edit && (
        <TaskEditor
          key={edit.id ?? "new"}
          initial={edit}
          live={tasks.find((t) => t.id === edit.id)}
          projectTasks={tasks}
          sprints={sprints}
          agents={agents}
          byId={byId}
          running={!!edit.id && running.has(edit.id)}
          onLaunch={(t) => launch(t)}
          onClose={() => setEdit(null)}
          onSaved={reload}
        />
      )}
      {planOpen && (
        <PlanModal
          project={project}
          onChat={() => (setPlanOpen(false), onPlanChat())}
          onClose={() => setPlanOpen(false)}
          onStarted={() => {
            setPlanOpen(false);
            onRunsChanged();
          }}
        />
      )}
      {sprintEdit && <SprintEditor initial={sprintEdit} onClose={() => setSprintEdit(null)} onSaved={() => (sprintData.reload(), reload())} />}
      {focus && planTrace && <CallFocus trace={planTrace} callId={focus} agents={byId} onClose={() => setFocus(null)} onFocus={setFocus} />}
    </div>
  );
}

function TaskEditor({
  initial,
  live,
  projectTasks,
  sprints,
  agents,
  byId,
  running,
  onLaunch,
  onClose,
  onSaved,
}: {
  initial: Partial<Task>;
  live?: Task;
  projectTasks: Task[];
  sprints: Sprint[];
  agents: Agent[];
  byId: Map<string, Agent>;
  running: boolean;
  onLaunch: (t: Task) => void;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [t, setT] = useState(initial);
  const [focus, setFocus] = useState<string | null>(null);
  const set = <K extends keyof Task>(k: K, v: Task[K]) => setT((x) => ({ ...x, [k]: v }));
  // Status, notes, result and evaluation are updated by the agents: always read them fresh.
  const cur = live ?? (t as Task);
  const liveTrace = useRunTrace(t.id ? `task:${t.id}` : null, running);
  const trace: Trace | null = liveTrace ?? (cur.trace as Trace | null) ?? null;
  const roots = trace ? trace.order.map((id) => trace.calls[id]).filter((c) => c && !c.parentCallId) : [];
  const save = async () => {
    // Agent-maintained fields are never overwritten from the dialog.
    const editable = {
      id: t.id,
      title: t.title,
      description: t.description,
      priority: t.priority,
      assignee_id: t.assignee_id,
      depends_on: t.depends_on ?? [],
      complexity: t.complexity ?? 0,
      sprint_id: t.sprint_id ?? "",
    };
    await crud.save("tasks", t.id ? editable : t);
    onSaved();
  };

  return (
    <>
      <Modal
        open
        onClose={onClose}
        title={t.id ? `Tâche #${t.id.slice(0, 5)}` : "Nouvelle tâche"}
        footer={
          <>
            {t.id && (
              <Button
                variant="danger"
                onClick={async () => {
                  await crud.remove("tasks", t.id!);
                  onSaved();
                  onClose();
                }}
              >
                <Trash2 size={14} />
              </Button>
            )}
            <div className="flex-1" />
            {t.id && !running && cur.status !== "done" && (
              <Button
                variant="soft"
                disabled={!t.assignee_id}
                onClick={async () => {
                  await save();
                  onLaunch(cur);
                }}
              >
                {cur.evaluation?.verdict === "a_corriger" ? <RotateCcw size={13} /> : <Play size={13} />} {cur.evaluation?.verdict === "a_corriger" ? "Relancer" : "Lancer"}
              </Button>
            )}
            <Button variant="ghost" onClick={onClose}>
              Fermer
            </Button>
            <Button
              variant="primary"
              disabled={!t.title?.trim()}
              onClick={async () => {
                await save();
                onClose();
              }}
            >
              Enregistrer
            </Button>
          </>
        }
      >
        <div className="flex max-h-[65vh] flex-col gap-3 overflow-y-auto pr-1">
          <Field label="Titre">
            <Input value={t.title} onChange={(e) => set("title", e.target.value)} />
          </Field>
          <Field label="Description / consigne">
            <Textarea rows={4} value={t.description} onChange={(e) => set("description", e.target.value)} />
          </Field>
          <div className="grid grid-cols-3 gap-2">
            <Field label="Statut">
              {t.id ? (
                <div className="flex h-9 items-center gap-1.5 text-sm">
                  <span className="h-2 w-2 rounded-full" style={{ background: COLUMNS.find((c) => c.id === cur.status)?.color }} />
                  {COLUMNS.find((c) => c.id === cur.status)?.label}
                  {running && <Loader2 size={12} className="animate-spin text-accent" />}
                </div>
              ) : (
                <Select value={t.status} onChange={(e) => set("status", e.target.value as Task["status"])}>
                  {COLUMNS.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.label}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
            <Field label="Priorité">
              <Select value={t.priority} onChange={(e) => set("priority", e.target.value as Task["priority"])}>
                <option value="high">Haute</option>
                <option value="normal">Normale</option>
                <option value="low">Basse</option>
              </Select>
            </Field>
            <Field label="Assignée à">
              <Select value={t.assignee_id} onChange={(e) => set("assignee_id", e.target.value)}>
                <option value="">—</option>
                {agents.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.emoji} {a.name}
                  </option>
                ))}
              </Select>
            </Field>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <Field label="Complexité (points)">
              <Select value={t.complexity ?? 0} onChange={(e) => set("complexity", Number(e.target.value))}>
                {POINTS.map((p) => (
                  <option key={p} value={p}>
                    {p ? `${p} pt${p > 1 ? "s" : ""}` : "Non estimée"}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Sprint">
              <Select value={t.sprint_id ?? ""} onChange={(e) => set("sprint_id", e.target.value)}>
                <option value="">Backlog</option>
                {sprints
                  .filter((sp) => sp.status !== "done" || sp.id === t.sprint_id)
                  .map((sp) => (
                    <option key={sp.id} value={sp.id}>
                      {sp.name}
                      {sp.status === "active" ? " (actif)" : sp.status === "done" ? " (clôturé)" : ""}
                    </option>
                  ))}
              </Select>
            </Field>
          </div>
          <Field label="Dépend de" hint="La tâche reste bloquée tant que celles-ci ne sont pas terminées ; leur compte rendu est transmis à l'agent au lancement.">
            <DependencyPick task={t} tasks={projectTasks} value={t.depends_on ?? []} onChange={(v) => set("depends_on", v)} />
          </Field>

          {cur.evaluation && (
            <div className={cx("rounded-lg border p-3", cur.evaluation.verdict === "valide" ? "border-emerald-500/30 bg-emerald-500/5" : "border-amber-500/30 bg-amber-500/5")}>
              <div className="mb-1 flex items-center gap-2 text-sm font-medium">
                {cur.evaluation.verdict === "valide" ? "✅ Validée" : "↩️ À corriger"}
                <span className="text-amber-400">{"★".repeat(cur.evaluation.score)}{"☆".repeat(5 - cur.evaluation.score)}</span>
                <span className="ml-auto text-xs font-normal text-fg-subtle">par {cur.evaluation.by}</span>
              </div>
              <div className="whitespace-pre-wrap text-xs text-fg-muted">{cur.evaluation.comment}</div>
            </div>
          )}

          {(roots.length > 0 || running) && (
            <Field label="Déroulé">
              <div className="flex flex-wrap gap-2">
                {roots.map((c) => {
                  const a = byId.get(c.agentId);
                  const cl = !["done", "error"].includes(c.status);
                  return (
                    <button key={c.callId} onClick={() => setFocus(c.callId)} className="flex items-center gap-2 rounded-lg border border-line bg-surface-1 px-2.5 py-1.5 text-xs hover:bg-surface-2">
                      <Eye size={12} />
                      {a?.emoji} {a?.name} · {c === roots[0] ? "réalisation" : "contrôle"}
                      {cl && <Loader2 size={11} className="animate-spin text-accent" />}
                    </button>
                  );
                })}
                {running && !roots.length && <span className="text-xs text-fg-subtle">démarrage…</span>}
              </div>
            </Field>
          )}

          {cur.result && (
            <details className="rounded-lg border border-line bg-surface-1 p-3">
              <summary className="cursor-pointer text-sm font-medium">Résultat de l&apos;agent</summary>
              <Markdown className="mt-2">{cur.result}</Markdown>
            </details>
          )}

          {!!cur.notes?.length && (
            <Field label="Suivi">
              <div className="flex flex-col gap-1.5">
                {[...cur.notes].reverse().map((n, i) => (
                  <div key={i} className="rounded-lg bg-surface-2 px-2.5 py-1.5 text-xs">
                    <span className="font-medium">{n.by}</span> <span className="text-fg-subtle">· {new Date(n.at).toLocaleString("fr-FR")}</span>
                    <div className="mt-0.5 line-clamp-6 whitespace-pre-wrap text-fg-muted">{n.text}</div>
                  </div>
                ))}
              </div>
            </Field>
          )}
        </div>
      </Modal>
      {focus && trace && <CallFocus trace={trace} callId={focus} agents={byId} onClose={() => setFocus(null)} onFocus={setFocus} />}
    </>
  );
}

/** Backlog / sprint selector with progress and sprint actions. */
function SprintBar({
  sprints,
  tasks,
  filter,
  onFilter,
  onNew,
  onEdit,
  onAction,
}: {
  sprints: Sprint[];
  tasks: Task[];
  filter: string;
  onFilter: (f: string) => void;
  onNew: () => void;
  onEdit: (s: Sprint) => void;
  onAction: (id: string, action: "start" | "close") => void;
}) {
  const pts = (ts: Task[]) => ts.reduce((n, t) => n + (t.complexity || 0), 0);
  const backlog = tasks.filter((t) => !t.sprint_id || !sprints.some((x) => x.id === t.sprint_id));
  const current = sprints.find((x) => x.id === filter);
  const mine = current ? tasks.filter((t) => t.sprint_id === current.id) : [];
  const done = pts(mine.filter((t) => t.status === "done"));
  const total = pts(mine);
  const chip = (id: string, label: React.ReactNode) => (
    <button key={id} onClick={() => onFilter(id)} className={cx("flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-xs", filter === id ? "bg-accent/20 text-fg" : "text-fg-muted hover:bg-surface-2")}>
      {label}
    </button>
  );
  return (
    <div className="px-6 pt-3">
      <div className="flex flex-wrap items-center gap-1">
        {chip("all", `Tout (${tasks.length})`)}
        {chip("backlog", `Backlog (${backlog.length})`)}
        {sprints.map((sp) =>
          chip(
            sp.id,
            <>
              {sp.status === "active" && <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />}
              <span className={cx(sp.status === "done" && "line-through opacity-60")}>{sp.name}</span>
              <span className="text-fg-subtle">({tasks.filter((t) => t.sprint_id === sp.id).length})</span>
            </>,
          ),
        )}
        <button onClick={onNew} className="flex items-center gap-1 rounded-lg px-2 py-1 text-xs text-fg-subtle hover:bg-surface-2 hover:text-fg">
          <Plus size={12} /> Sprint
        </button>
      </div>
      {current && (
        <div className="mt-2 flex flex-wrap items-center gap-3 rounded-xl border border-line bg-surface-1 px-3 py-2">
          <CalendarRange size={15} className="text-fg-muted" />
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 text-sm font-medium">
              {current.name}
              <Badge color={current.status === "active" ? "#10b981" : current.status === "done" ? "#64748b" : "#8b5cf6"}>
                {current.status === "active" ? "actif" : current.status === "done" ? "clôturé" : "planifié"}
              </Badge>
              {(current.start_date || current.end_date) && (
                <span className="text-xs font-normal text-fg-subtle">
                  {current.start_date || "?"} → {current.end_date || "?"}
                </span>
              )}
            </div>
            {current.goal && <div className="truncate text-xs text-fg-muted">🎯 {current.goal}</div>}
          </div>
          <div className="w-40">
            <div className="mb-1 flex justify-between text-[11px] text-fg-muted">
              <span>avancement</span>
              <span className="tabular-nums">
                {done}/{total} pts
              </span>
            </div>
            <div className="h-1.5 overflow-hidden rounded-full bg-surface-3">
              <div className="h-full bg-emerald-500" style={{ width: `${total ? (done / total) * 100 : 0}%` }} />
            </div>
          </div>
          {current.status === "planned" && (
            <Button size="sm" variant="primary" onClick={() => onAction(current.id, "start")}>
              Démarrer
            </Button>
          )}
          {current.status === "active" && (
            <Button
              size="sm"
              variant="soft"
              onClick={() => confirm("Clôturer le sprint ? Les tâches non terminées passent au sprint suivant (ou au backlog).") && onAction(current.id, "close")}
            >
              Clôturer
            </Button>
          )}
          <Button size="sm" variant="ghost" onClick={() => onEdit(current)} title="Modifier le sprint">
            <Pencil size={13} />
          </Button>
        </div>
      )}
    </div>
  );
}

function SprintEditor({ initial, onClose, onSaved }: { initial: Partial<Sprint>; onClose: () => void; onSaved: () => void }) {
  const [sp, setSp] = useState(initial);
  return (
    <Modal
      open
      onClose={onClose}
      title={sp.id ? `Sprint : ${sp.name}` : "Nouveau sprint"}
      footer={
        <>
          {sp.id && (
            <Button
              variant="danger"
              onClick={async () => {
                if (!confirm(`Supprimer « ${sp.name} » ? Ses tâches repassent au backlog.`)) return;
                await crud.remove("sprints", sp.id!);
                onSaved();
                onClose();
              }}
            >
              <Trash2 size={14} />
            </Button>
          )}
          <div className="flex-1" />
          <Button variant="ghost" onClick={onClose}>
            Annuler
          </Button>
          <Button
            variant="primary"
            disabled={!sp.name?.trim()}
            onClick={async () => {
              await crud.save("sprints", sp);
              onSaved();
              onClose();
            }}
          >
            Enregistrer
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        <Field label="Nom">
          <Input value={sp.name} onChange={(e) => setSp({ ...sp, name: e.target.value })} />
        </Field>
        <Field label="Objectif du sprint">
          <Textarea rows={2} value={sp.goal} onChange={(e) => setSp({ ...sp, goal: e.target.value })} />
        </Field>
        <div className="grid grid-cols-2 gap-2">
          <Field label="Début">
            <Input type="date" value={sp.start_date} onChange={(e) => setSp({ ...sp, start_date: e.target.value })} />
          </Field>
          <Field label="Fin">
            <Input type="date" value={sp.end_date} onChange={(e) => setSp({ ...sp, end_date: e.target.value })} />
          </Field>
        </div>
      </div>
    </Modal>
  );
}

function PlanModal({ project, onChat, onClose, onStarted }: { project: Project; onChat: () => void; onClose: () => void; onStarted: () => void }) {
  const [direct, setDirect] = useState(false);
  const [brief, setBrief] = useState("");
  const [sprints, setSprints] = useState(true);
  const [error, setError] = useState<string>();
  const entries = specFromTeam(project.team).entry_ids.length;
  return (
    <Modal
      open
      onClose={onClose}
      title="Planifier le projet"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Annuler
          </Button>
          {direct && (
            <Button
              variant="primary"
              onClick={async () => {
                try {
                  await api("/api/projects/plan", { method: "POST", json: { projectId: project.id, brief, sprints } });
                  onStarted();
                } catch (e) {
                  setError(e instanceof Error ? e.message : String(e));
                }
              }}
            >
              <ListTree size={14} /> Planifier directement
            </Button>
          )}
        </>
      }
    >
      <div className="flex flex-col gap-3">
        <ErrorNote>{error}</ErrorNote>
        <button onClick={onChat} className="flex items-start gap-3 rounded-xl border border-accent/40 bg-accent/5 p-3 text-left hover:border-accent">
          <span className="text-xl">💬</span>
          <span>
            <span className="block text-sm font-medium">Discuter d&apos;abord avec l&apos;équipe (recommandé)</span>
            <span className="block text-xs text-fg-muted">
              Présente le projet en quelques phrases : les premiers contacts te posent leurs questions, puis créent les tâches quand tu valides.
            </span>
          </span>
        </button>
        <button onClick={() => setDirect(!direct)} className="text-left text-xs text-fg-muted hover:text-fg">
          {direct ? "▾" : "▸"} Ou planifier directement à partir d&apos;une consigne
        </button>
        {direct && (
        <>
        <p className="text-sm text-fg-muted">
          Le premier contact reprend le contexte (description, journal des décisions, fichiers, tâches existantes)
          {entries > 1 ? ", se concerte avec les autres premiers contacts" : ""} puis découpe le travail en tâches avec responsable, complexité, priorité et dépendances.
        </p>
        <Field label="Consigne (optionnelle)">
          <Textarea rows={3} value={brief} onChange={(e) => setBrief(e.target.value)} placeholder="ex : priorité au MVP, pas d'interface graphique pour l'instant" />
        </Field>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={sprints} onChange={(e) => setSprints(e.target.checked)} className="accent-[var(--accent)]" />
          Organiser les tâches en sprints
        </label>
        <p className="text-xs text-fg-subtle">Compte quelques minutes en local. Les tâches apparaissent dans le tableau à la fin ; tu peux suivre la réflexion en direct.</p>
        </>
        )}
      </div>
    </Modal>
  );
}

// ---------------------------------------------------------------- stats

type Stats = {
  usage: { calls: number; prompt_tokens: number; completion_tokens: number; compute_ms: number; errors: number };
  byAgent: { agent_id: string; name: string; emoji: string; color: string; calls: number; tokens: number; compute_ms: number }[];
  tasks: {
    total: number;
    byStatus: Record<Task["status"], number>;
    points: number;
    pointsDone: number;
    avgScore: number | null;
    corrections: number;
    firstTry: number;
    estimated: number;
  };
  sprints: { id: string; name: string; status: Sprint["status"]; planned: number; done: number; tasks: number }[];
  conversations: number;
};

const fmtMs = (ms: number) => (ms >= 3600000 ? `${(ms / 3600000).toFixed(1)} h` : ms >= 60000 ? `${Math.round(ms / 60000)} min` : `${Math.round(ms / 1000)} s`);
const fmtN = (n: number) => Math.round(n || 0).toLocaleString("fr-FR");

function ProjectStats({ projectId, busy }: { projectId: string; busy: boolean }) {
  const st = useData<Stats>(`/api/projects/stats?id=${projectId}`);
  useEffect(() => {
    if (!busy) return;
    const t = setInterval(st.reload, 5000);
    return () => clearInterval(t);
  }, [busy, st.reload]);
  const s = st.data;
  if (!s) return <div className="p-6 text-sm text-fg-muted">{st.error ?? "Chargement…"}</div>;
  const maxAgent = Math.max(1, ...s.byAgent.map((a) => a.compute_ms));
  const maxSprint = Math.max(1, ...s.sprints.map((x) => x.planned));
  const tiles: [string, string, string?][] = [
    ["Temps de calcul", fmtMs(s.usage.compute_ms), `${fmtN(s.usage.calls)} appels au modèle`],
    ["Tokens", fmtN(s.usage.prompt_tokens + s.usage.completion_tokens), `${fmtN(s.usage.prompt_tokens)} en entrée · ${fmtN(s.usage.completion_tokens)} en sortie`],
    ["Avancement", `${s.tasks.byStatus.done}/${s.tasks.total} tâches`, s.tasks.points ? `${s.tasks.pointsDone}/${s.tasks.points} points` : "complexité non estimée"],
    ["Qualité", s.tasks.avgScore !== null ? `${s.tasks.avgScore.toFixed(1)}/5` : "—", `${s.tasks.firstTry} validée(s) du premier coup · ${s.tasks.corrections} correction(s)`],
  ];
  return (
    <div className="flex flex-col gap-4 p-6">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {tiles.map(([label, value, sub]) => (
          <Card key={label} className="p-4">
            <div className="text-xs text-fg-muted">{label}</div>
            <div className="mt-1 text-2xl font-semibold tabular-nums">{value}</div>
            {sub && <div className="mt-0.5 text-[11px] text-fg-subtle">{sub}</div>}
          </Card>
        ))}
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <div className="border-b border-line px-4 py-2.5 text-sm font-semibold">Temps de calcul par agent</div>
          <div className="flex flex-col gap-2.5 p-4">
            {s.byAgent.map((a) => (
              <div key={a.agent_id} className="text-xs" title={`${a.name} : ${fmtMs(a.compute_ms)} · ${fmtN(a.calls)} appels · ${fmtN(a.tokens)} tokens`}>
                <div className="mb-1 flex justify-between">
                  <span>
                    {a.emoji} {a.name ?? "agent supprimé"}
                  </span>
                  <span className="tabular-nums text-fg-muted">
                    {fmtMs(a.compute_ms)} · {fmtN(a.tokens)} tokens
                  </span>
                </div>
                <div className="h-2 overflow-hidden rounded-full bg-surface-3">
                  <div className="h-full rounded-full bg-accent" style={{ width: `${(a.compute_ms / maxAgent) * 100}%` }} />
                </div>
              </div>
            ))}
            {!s.byAgent.length && <div className="text-sm text-fg-subtle">Aucune activité enregistrée pour ce projet.</div>}
          </div>
        </Card>
        <Card>
          <div className="flex items-center justify-between border-b border-line px-4 py-2.5">
            <span className="text-sm font-semibold">Vélocité par sprint</span>
            <span className="flex items-center gap-3 text-[11px] text-fg-muted">
              <span className="flex items-center gap-1">
                <span className="h-2 w-2 rounded-sm bg-surface-3 ring-1 ring-line-strong" /> planifié
              </span>
              <span className="flex items-center gap-1">
                <span className="h-2 w-2 rounded-sm bg-accent" /> terminé
              </span>
            </span>
          </div>
          <div className="flex flex-col gap-2.5 p-4">
            {s.sprints.map((x) => (
              <div key={x.id} className="text-xs" title={`${x.name} : ${x.done}/${x.planned} points terminés (${x.tasks} tâches)`}>
                <div className="mb-1 flex justify-between">
                  <span>
                    {x.name} <span className="text-fg-subtle">· {x.status === "active" ? "actif" : x.status === "done" ? "clôturé" : "planifié"}</span>
                  </span>
                  <span className="tabular-nums text-fg-muted">
                    {x.done}/{x.planned} pts
                  </span>
                </div>
                <div className="relative h-2 overflow-hidden rounded-full bg-surface-3" style={{ width: `${Math.max(8, (x.planned / maxSprint) * 100)}%` }}>
                  <div className="h-full rounded-full bg-accent" style={{ width: `${x.planned ? (x.done / x.planned) * 100 : 0}%` }} />
                </div>
              </div>
            ))}
            {!s.sprints.length && <div className="text-sm text-fg-subtle">Aucun sprint. Crée-en depuis le tableau, ou laisse « Planifier » les proposer.</div>}
          </div>
        </Card>
      </div>
      <Card className="overflow-x-auto">
        <div className="border-b border-line px-4 py-2.5 text-sm font-semibold">Tâches</div>
        <table className="w-full text-xs">
          <tbody>
            {COLUMNS.map((c) => (
              <tr key={c.id} className="border-b border-line last:border-0">
                <td className="px-4 py-2">
                  <span className="mr-2 inline-block h-2 w-2 rounded-full" style={{ background: c.color }} />
                  {c.label}
                </td>
                <td className="px-4 py-2 text-right tabular-nums">{s.tasks.byStatus[c.id]}</td>
              </tr>
            ))}
            <tr>
              <td className="px-4 py-2 text-fg-muted">Estimées (complexité renseignée)</td>
              <td className="px-4 py-2 text-right tabular-nums text-fg-muted">
                {s.tasks.estimated}/{s.tasks.total}
              </td>
            </tr>
            <tr>
              <td className="px-4 py-2 text-fg-muted">Conversations du projet</td>
              <td className="px-4 py-2 text-right tabular-nums text-fg-muted">{s.conversations}</td>
            </tr>
          </tbody>
        </table>
      </Card>
    </div>
  );
}

/** Pick dependencies among the project's tasks, excluding the task itself and anything that depends on it. */
function DependencyPick({ task, tasks, value, onChange }: { task: Partial<Task>; tasks: Task[]; value: string[]; onChange: (v: string[]) => void }) {
  const dependents = new Set<string>();
  if (task.id) {
    const stack = [task.id];
    while (stack.length) {
      const id = stack.pop()!;
      for (const t of tasks)
        if (t.depends_on?.includes(id) && !dependents.has(t.id)) {
          dependents.add(t.id);
          stack.push(t.id);
        }
    }
  }
  const options = tasks.filter((t) => t.id !== task.id && !dependents.has(t.id));
  if (!options.length) return <div className="text-xs text-fg-subtle">Aucune autre tâche disponible.</div>;
  return (
    <div className="flex flex-wrap gap-1.5">
      {options.map((o) => {
        const on = value.includes(o.id);
        const col = COLUMNS.find((c) => c.id === o.status)!;
        return (
          <button
            type="button"
            key={o.id}
            onClick={() => onChange(on ? value.filter((v) => v !== o.id) : [...value, o.id])}
            className={cx("inline-flex items-center gap-1.5 rounded-lg border px-2 py-1 text-xs", on ? "border-accent bg-accent/15 text-fg" : "border-line bg-surface-1 text-fg-muted hover:border-line-strong")}
          >
            <span className="h-1.5 w-1.5 rounded-full" style={{ background: col.color }} />
            {o.title}
          </button>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------- files

function Files({ projectId, ws, reload, selected, onSelect }: { projectId: string; ws?: Workspace; reload: () => void; selected: string | null; onSelect: (p: string | null) => void }) {
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const content = useData<{ path: string; absolute: string; content: string }>(selected ? `/api/workspace?projectId=${projectId}&file=${encodeURIComponent(selected)}` : null);
  const { copied, copy } = useCopy();
  const rows = useMemo(() => (ws?.entries ?? []).filter((e) => ![...collapsed].some((c) => e.path.startsWith(c + "/"))), [ws, collapsed]);
  const file = content.data?.path === selected ? content.data : undefined;

  return (
    <div className="grid h-full min-h-0 grid-cols-1 gap-3 p-6 md:grid-cols-[320px_1fr]">
      <div className="flex min-h-0 flex-col rounded-xl border border-line bg-surface-1">
        <div className="flex items-center justify-between border-b border-line px-3 py-2">
          <span className="text-xs font-medium text-fg-muted">Arborescence</span>
          <Button size="sm" variant="ghost" onClick={reload} title="Rafraîchir">
            <RefreshCw size={13} />
          </Button>
        </div>
        <div className="flex-1 overflow-y-auto p-1.5">
          {rows.map((e) => {
            const depth = e.path.split("/").length - 1;
            const name = e.path.split("/").at(-1);
            const isCollapsed = collapsed.has(e.path);
            return (
              <button
                key={e.path}
                onClick={() =>
                  e.dir
                    ? setCollapsed((s) => {
                        const n = new Set(s);
                        if (n.has(e.path)) n.delete(e.path);
                        else n.add(e.path);
                        return n;
                      })
                    : onSelect(e.path)
                }
                style={{ paddingLeft: 8 + depth * 14 }}
                className={cx("flex w-full items-center gap-1.5 rounded-md py-1.5 pr-2 text-left font-mono text-xs", selected === e.path ? "bg-surface-3 text-fg" : "text-fg-muted hover:bg-surface-2")}
                title={e.path}
              >
                {e.dir ? (
                  <>
                    <ChevronRight size={12} className={cx("shrink-0 transition", !isCollapsed && "rotate-90")} />
                    <Folder size={12} className="shrink-0 text-amber-400/80" />
                  </>
                ) : (
                  <File size={12} className="ml-[18px] shrink-0" />
                )}
                <span className="truncate">{name}</span>
                {!e.dir && <span className="ml-auto shrink-0 text-[10px] text-fg-subtle">{formatBytes(e.size)}</span>}
              </button>
            );
          })}
          {!rows.length && <div className="p-3 text-xs text-fg-subtle">Dossier vide. Les agents avec l&apos;outil « Écrire des fichiers » écrivent ici.</div>}
        </div>
      </div>
      <div className="flex min-h-0 flex-col overflow-hidden rounded-xl border border-line bg-surface-1">
        {selected ? (
          <>
            <div className="flex flex-wrap items-center gap-2 border-b border-line px-3 py-2">
              <code className="min-w-0 flex-1 truncate font-mono text-xs" title={file?.absolute}>
                {file?.absolute ?? selected}
              </code>
              {file && (
                <>
                  <Button size="sm" variant="ghost" onClick={() => copy(file.absolute)} title="Copier le chemin complet">
                    {copied === file.absolute ? <Check size={13} className="text-emerald-400" /> : <Copy size={13} />}
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => openIn(projectId, "finder", selected)} title="Afficher dans le Finder">
                    <Folder size={13} />
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => openIn(projectId, "vscode", selected)} title="Ouvrir dans VS Code">
                    <Code2 size={13} />
                  </Button>
                </>
              )}
            </div>
            <pre className="flex-1 overflow-auto p-3 font-mono text-xs leading-relaxed">{file?.content ?? (content.error ? `Impossible de lire : ${content.error}` : "…")}</pre>
          </>
        ) : (
          <div className="p-6 text-sm text-fg-subtle">Sélectionne un fichier pour voir son contenu et son chemin complet.</div>
        )}
      </div>
    </div>
  );
}
