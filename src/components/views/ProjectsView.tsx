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
  Loader2,
  MessageSquare,
  Pencil,
  Play,
  Plus,
  RefreshCw,
  RotateCcw,
  Trash2,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { layoutOf, specFromTeam, type TeamSpec } from "@/lib/team";
import type { Trace } from "@/lib/trace";
import { api, crud, formatBytes, useData, type Agent, type Project, type RunInfo, type Task, type Team } from "../api";
import { CallFocus } from "../chat/CallFocus";
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
type Tab = "overview" | "tasks" | "files" | "team";

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
          onCreated={(p) => {
            setCreating(false);
            onCreateHandled();
            reloadProjects();
            onSelect(p.id);
          }}
        />
      )}
    </div>
  );
}

function NewProject({ teams, templateId, onClose, onCreated }: { teams: Team[]; templateId: string | null; onClose: () => void; onCreated: (p: Project) => void }) {
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
                onCreated(await api<Project>("/api/projects", { method: "POST", json: { name, description, template_id: template, path: dir } }));
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
        {tab === "overview" && <Overview tasks={tasks} byId={byId} ws={ws.data} onTab={setTab} onFile={showFile} />}
        {tab === "tasks" && <Board project={project} tasks={tasks} agents={people} allAgents={byId} reload={reloadTasks} runs={runs} onRunsChanged={onRunsChanged} />}
        {tab === "files" && <Files projectId={project.id} ws={ws.data} reload={ws.reload} selected={openFile} onSelect={setOpenFile} />}
        {tab === "team" && <ProjectTeam project={project} agents={agents} onSaved={reloadProjects} onAgentsChange={onAgentsChange} />}
      </div>
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

function Overview({ tasks, byId, ws, onTab, onFile }: { tasks: Task[]; byId: Map<string, Agent>; ws?: Workspace; onTab: (t: Tab) => void; onFile: (p: string) => void }) {
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
}: {
  project: Project;
  tasks: Task[];
  agents: Agent[];
  allAgents: Map<string, Agent>;
  reload: () => void;
  runs: RunInfo[];
  onRunsChanged: () => void;
}) {
  const [edit, setEdit] = useState<Partial<Task> | null>(null);
  const [drag, setDrag] = useState<string | null>(null);
  const [local, setLocal] = useState<Record<string, Task["status"]>>({});
  const [error, setError] = useState<string>();
  const byId = allAgents;
  const running = new Set(runs.filter((r) => r.status === "running" && r.conversationId.startsWith("task:")).map((r) => r.conversationId.slice(5)));
  const statusOf = (t: Task) => local[t.id] ?? t.status;

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
        <Button variant="primary" size="sm" onClick={() => setEdit({ project_id: project.id, title: "", description: "", status: "todo", priority: "normal", assignee_id: "", notes: [] })}>
          <Plus size={14} /> Tâche
        </Button>
        <span className="text-xs text-fg-subtle">▶ lance la tâche : l&apos;agent assigné la réalise, puis un premier contact la contrôle et met à jour le statut.</span>
      </div>
      {error && (
        <div className="px-6 pt-2">
          <ErrorNote>{error}</ErrorNote>
        </div>
      )}
      <div className="grid min-h-0 flex-1 grid-cols-1 gap-3 p-6 md:grid-cols-4">
        {COLUMNS.map((col) => {
          const items = tasks.filter((t) => statusOf(t) === col.id);
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
                        {!isRunning && t.status !== "done" && (
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
                      <div className="mt-2 flex items-center gap-1.5">
                        {who && <Avatar emoji={who.emoji} color={who.color} size={20} />}
                        {t.evaluation && <EvalBadge e={t.evaluation} />}
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
          agents={agents}
          byId={byId}
          running={!!edit.id && running.has(edit.id)}
          onLaunch={(t) => launch(t)}
          onClose={() => setEdit(null)}
          onSaved={reload}
        />
      )}
    </div>
  );
}

function TaskEditor({
  initial,
  live,
  agents,
  byId,
  running,
  onLaunch,
  onClose,
  onSaved,
}: {
  initial: Partial<Task>;
  live?: Task;
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
    const editable = { id: t.id, title: t.title, description: t.description, priority: t.priority, assignee_id: t.assignee_id };
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
