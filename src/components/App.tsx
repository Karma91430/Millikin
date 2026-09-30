"use client";

import { Blocks, Bot, CheckCircle2, Cpu, FolderKanban, Library, Loader2, MessagesSquare, Plug, Settings, Users, X, XCircle } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { api, useData, type Agent, type Meta, type Project, type RunInfo, type Team } from "./api";
import { ChatView, type Target } from "./chat/ChatView";
import { cx } from "./ui";
import { AgentsView } from "./views/AgentsView";
import { KnowledgeView } from "./views/KnowledgeView";
import { McpView } from "./views/McpView";
import { ModelsView } from "./views/ModelsView";
import { ProjectsView } from "./views/ProjectsView";
import { SettingsView } from "./views/SettingsView";
import { SkillsView } from "./views/SkillsView";
import { TeamsView } from "./views/TeamsView";

const NAV = [
  { id: "chat", label: "Espace de travail", icon: MessagesSquare },
  { id: "projects", label: "Projets", icon: FolderKanban },
  { id: "agents", label: "Agents", icon: Bot },
  { id: "teams", label: "Équipes", icon: Users },
  { id: "skills", label: "Skills", icon: Blocks },
  { id: "knowledge", label: "Connaissances", icon: Library },
  { id: "mcp", label: "MCP", icon: Plug },
  { id: "models", label: "Modèles", icon: Cpu },
  { id: "settings", label: "Réglages", icon: Settings },
] as const;
type View = (typeof NAV)[number]["id"];

export function App() {
  // Rendered client-only (see ClientApp), so localStorage is safe in the initializer.
  const [view, setView] = useState<View>(() => {
    try {
      const v = localStorage.getItem("millikin:view") as View | null;
      if (v && NAV.some((n) => n.id === v)) return v;
    } catch {}
    return "chat";
  });
  const viewRef = useRef(view);
  const [target, setTarget] = useState<Target | null>(null);
  const agents = useData<Agent[]>("/api/crud/agents");
  const teams = useData<Team[]>("/api/crud/teams");
  const projects = useData<Project[]>("/api/crud/projects");
  const [selectedProject, setSelectedProject] = useState<string | null>(null);
  const [createFrom, setCreateFrom] = useState<string | null>(null);
  const meta = useData<Meta>("/api/meta");

  const go = (v: View) => {
    setView(v);
    viewRef.current = v;
    try {
      localStorage.setItem("millikin:view", v);
    } catch {}
  };

  // ---- background runs: poll, show "in progress", toast when an answer is ready off-screen
  const [runs, setRuns] = useState<RunInfo[]>([]);
  const [toasts, setToasts] = useState<RunInfo[]>([]);
  const viewingRef = useRef<string | null>(null);
  const known = useRef(new Map<string, RunInfo["status"]>());
  const pollRuns = useCallback(async () => {
    const list = await api<RunInfo[]>("/api/runs").catch(() => null);
    if (!list) return;
    const finished = list.filter((r) => known.current.get(r.id) === "running" && r.status !== "running");
    known.current = new Map(list.map((r) => [r.id, r.status]));
    setRuns(list);
    const unseen = finished.filter((r) => !(viewRef.current === "chat" && viewingRef.current === r.conversationId));
    if (unseen.length) setToasts((t) => [...unseen, ...t].slice(0, 4));
  }, []);
  useEffect(() => {
    const first = setTimeout(pollRuns, 0);
    const t = setInterval(pollRuns, 2500);
    return () => (clearTimeout(first), clearInterval(t));
  }, [pollRuns]);
  const running = runs.filter((r) => r.status === "running");
  const openRun = (r: RunInfo) => {
    setToasts((t) => t.filter((x) => x.id !== r.id));
    if (r.targetType === "task") {
      setSelectedProject(r.targetId);
      go("projects");
    } else chatWith({ type: r.targetType, id: r.targetId, conversationId: r.conversationId });
  };
  const targetName = (r: RunInfo) =>
    r.targetType === "agent"
      ? (agents.data?.find((x) => x.id === r.targetId)?.name ?? "Agent")
      : `${r.targetType === "task" ? "Tâche · " : ""}${projects.data?.find((x) => x.id === r.targetId)?.name ?? "Projet"}`;

  const refreshAll = () => {
    agents.reload();
    teams.reload();
    projects.reload();
  };
  const chatWith = (t: Target) => {
    setTarget(t);
    go("chat");
  };

  const a = agents.data ?? [];
  const t = teams.data ?? [];
  const m = meta.data;

  return (
    <div className="flex h-screen min-h-0">
      <nav className="flex w-14 shrink-0 flex-col items-center gap-1 border-r border-line bg-surface-1 py-3 xl:w-52 xl:items-stretch xl:px-2">
        <div className="mb-3 flex items-center gap-2 px-1 xl:px-2">
          <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-accent text-sm font-bold text-white">M</span>
          <span className="hidden text-sm font-semibold xl:block">Millikin</span>
        </div>
        {NAV.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            onClick={() => go(id)}
            title={label}
            className={cx(
              "flex h-9 items-center gap-2.5 rounded-lg px-2.5 text-sm transition",
              view === id ? "bg-accent/15 text-fg" : "text-fg-muted hover:bg-surface-2 hover:text-fg",
            )}
          >
            <span className="relative">
              <Icon size={17} className={view === id ? "text-accent" : undefined} />
              {id === "chat" && running.length > 0 && (
                <span className="absolute -right-1.5 -top-1.5 flex h-3.5 min-w-3.5 items-center justify-center rounded-full bg-accent px-0.5 text-[9px] font-bold text-white">
                  {running.length}
                </span>
              )}
            </span>
            <span className="hidden xl:block">{label}</span>
          </button>
        ))}
        {running.length > 0 && (
          <div className="mt-4 hidden flex-col gap-1 xl:flex">
            <div className="px-2.5 text-[10px] font-semibold uppercase tracking-wide text-fg-subtle">En cours</div>
            {running.map((r) => (
              <button key={r.id} onClick={() => openRun(r)} className="flex items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-xs text-fg-muted hover:bg-surface-2" title={r.title}>
                <Loader2 size={13} className="shrink-0 animate-spin text-accent" />
                <span className="min-w-0">
                  <span className="block truncate text-fg">{targetName(r)}</span>
                  <span className="block truncate">{r.title}</span>
                </span>
              </button>
            ))}
          </div>
        )}
        <div className="mt-auto hidden px-2.5 text-[11px] text-fg-subtle xl:block">100 % local · Ollama</div>
      </nav>

      <main className="min-w-0 flex-1 overflow-hidden">
        {!agents.data || !teams.data ? (
          <div className="flex h-full items-center justify-center text-sm text-fg-muted">{agents.error || teams.error || "Chargement…"}</div>
        ) : view === "chat" ? (
          <ChatView
            agents={a}
            projects={projects.data ?? []}
            target={target}
            onTarget={setTarget}
            onNewProject={() => (setCreateFrom("__new"), go("projects"))}
            viewingRef={viewingRef}
            onRunsChanged={pollRuns}
          />
        ) : (
          <div className={cx("h-full", view === "projects" ? "overflow-hidden" : "overflow-y-auto")}>
            {view === "projects" && (
              <ProjectsView
                agents={a}
                teams={t}
                runs={runs}
                onChat={(id) => chatWith({ type: "project", id })}
                onAgentsChange={refreshAll}
                selected={selectedProject}
                onSelect={(id) => (setSelectedProject(id), projects.reload())}
                createFrom={createFrom}
                onCreateHandled={() => setCreateFrom(null)}
                onRunsChanged={pollRuns}
              />
            )}
            {view === "agents" && m && <AgentsView agents={a} meta={m} onChange={refreshAll} onChat={(id) => chatWith({ type: "agent", id })} />}
            {view === "teams" && <TeamsView agents={a} teams={t} onChange={refreshAll} onCreateProject={(id) => (setCreateFrom(id), go("projects"))} />}
            {view === "skills" && <SkillsView />}
            {view === "knowledge" && <KnowledgeView />}
            {view === "mcp" && <McpView />}
            {view === "models" && <ModelsView onChange={meta.reload} />}
            {view === "settings" && m && <SettingsView meta={m} />}
          </div>
        )}
      </main>

      {/* "answer ready" notifications for runs that finished while you were elsewhere */}
      <div className="pointer-events-none fixed bottom-4 right-4 z-[60] flex w-80 flex-col gap-2">
        {toasts.map((r) => (
          <div key={r.id} className="pop pointer-events-auto flex items-start gap-2.5 rounded-xl border border-line bg-surface-1 p-3 shadow-2xl">
            {r.status === "done" ? <CheckCircle2 size={17} className="mt-0.5 shrink-0 text-emerald-400" /> : <XCircle size={17} className="mt-0.5 shrink-0 text-red-400" />}
            <div className="min-w-0 flex-1">
              <div className="text-sm font-medium">{r.status === "done" ? "Réponse prête" : r.status === "stopped" ? "Réponse arrêtée" : "Échec de la réponse"}</div>
              <div className="truncate text-xs text-fg-muted">
                {targetName(r)} · {r.title}
              </div>
              <button onClick={() => openRun(r)} className="mt-1.5 text-xs font-medium text-accent hover:underline">
                Ouvrir la conversation
              </button>
            </div>
            <button onClick={() => setToasts((t) => t.filter((x) => x.id !== r.id))} className="text-fg-subtle hover:text-fg" aria-label="Fermer">
              <X size={14} />
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
