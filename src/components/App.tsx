"use client";

import { Blocks, Bot, CheckCircle2, FolderKanban, Library, Loader2, LogOut, MessagesSquare, PanelLeftClose, PanelLeftOpen, Plug, Settings, ShieldCheck, Users, X, XCircle } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { I18nProvider, useT, type Lang } from "@/i18n";
import { api, useData, type Agent, type Meta, type Project, type RunInfo, type Team } from "./api";
import { ChatView, type Target } from "./chat/ChatView";
import { cx, usePersistentFlag } from "./ui";
import { AdminView, CreditBar, LoginScreen, type AppUser } from "./views/AdminView";
import { AgentsView } from "./views/AgentsView";
import { KnowledgeView } from "./views/KnowledgeView";
import { McpView } from "./views/McpView";
import { ProjectsView } from "./views/ProjectsView";
import { SettingsHub } from "./views/SettingsHub";
import { SkillsView } from "./views/SkillsView";
import { TeamsView } from "./views/TeamsView";

const NAV = [
  { id: "chat", label: "Espace de travail", icon: MessagesSquare },
  { id: "projects", label: "Projets", icon: FolderKanban },
  { id: "team", label: "Agents et équipes", icon: Users },
  { id: "skills", label: "Skills", icon: Blocks },
  { id: "knowledge", label: "Connaissances", icon: Library },
  { id: "mcp", label: "MCP", icon: Plug },
  { id: "settings", label: "Réglages", icon: Settings },
  { id: "admin", label: "Administration", icon: ShieldCheck },
] as const;
type View = (typeof NAV)[number]["id"];

export function App() {
  // Language: localStorage for an instant first paint, the server setting (agents' answers) as the source of truth.
  const [lang, setLangState] = useState<Lang>(() => {
    try {
      return localStorage.getItem("millikin:lang") === "en" ? "en" : "fr";
    } catch {
      return "fr";
    }
  });
  const settings = useData<Record<string, string>>("/api/settings");
  const serverLang = settings.data?.language === "en" ? "en" : settings.data ? "fr" : null;
  // Adopt the server's language once it is known (render-time sync, no effect needed).
  const [seenServer, setSeenServer] = useState<Lang | null>(null);
  if (serverLang && serverLang !== seenServer) {
    setSeenServer(serverLang);
    if (serverLang !== lang) setLangState(serverLang);
  }
  const setLang = useCallback((l: Lang) => {
    setLangState(l);
    try {
      localStorage.setItem("millikin:lang", l);
    } catch {}
    api("/api/settings", { method: "POST", json: { language: l } }).catch(() => {});
  }, []);
  // Accounts: setup mode (no account yet, single user), a session, or the login screen.
  const me = useData<Me>("/api/auth/me");
  return (
    <I18nProvider lang={lang} setLang={setLang}>
      {!me.data && !me.error ? null : me.error || (!me.data?.setup && !me.data?.user) ? <LoginScreen onLogged={me.reload} /> : <Workspace me={me.data!} onAuthChange={me.reload} />}
    </I18nProvider>
  );
}

type Me = { setup: boolean; user: AppUser | null; credits?: { used: number; quota: number; remaining: number | null } };

function Workspace({ me, onAuthChange }: { me: Me; onAuthChange: () => void }) {
  const isAdmin = me.setup || me.user?.role === "admin";
  const [teamTab, setTeamTab] = useState<"agents" | "teams">("agents");
  const { t: tr } = useT();
  // Wide (icons + labels) on large screens unless the user collapsed it; always icons-only on small screens.
  const [navWide, toggleNav] = usePersistentFlag("millikin:nav-wide", true);
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
  // Notifications fade out on their own after a few seconds.
  useEffect(() => {
    if (!toasts.length) return;
    const timer = setTimeout(() => setToasts((x) => x.slice(0, -1)), 6000);
    return () => clearTimeout(timer);
  }, [toasts]);
  const openRun = (r: RunInfo) => {
    setToasts((t) => t.filter((x) => x.id !== r.id));
    if (r.targetType === "task") {
      setSelectedProject(r.targetId);
      go("projects");
    } else chatWith({ type: r.targetType, id: r.targetId, conversationId: r.conversationId });
  };
  const targetName = (r: RunInfo) =>
    r.targetType === "agent"
      ? (agents.data?.find((x) => x.id === r.targetId)?.name ?? tr("Agent"))
      : `${r.targetType === "task" ? `${tr("Tâche")} · ` : ""}${projects.data?.find((x) => x.id === r.targetId)?.name ?? tr("Projet")}`;

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
      <nav className={cx("flex w-14 shrink-0 flex-col items-center gap-1 border-r border-line bg-surface-1 py-3 transition-[width]", navWide && "xl:w-52 xl:items-stretch xl:px-2")}>
        <div className={cx("mb-3 flex items-center gap-2 px-1", navWide && "xl:px-2")}>
          <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-accent text-sm font-bold text-white">M</span>
          <span className={cx("hidden text-sm font-semibold", navWide && "xl:block")}>Millikin</span>
        </div>
        {NAV.filter((n) => n.id !== "admin" || isAdmin).map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            onClick={() => go(id)}
            title={tr(label)}
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
            <span className={cx("hidden", navWide && "xl:block")}>{tr(label)}</span>
          </button>
        ))}
        {running.length > 0 && (
          <div className={cx("mt-4 hidden flex-col gap-1", navWide && "xl:flex")}>
            <div className="px-2.5 text-[10px] font-semibold uppercase tracking-wide text-fg-subtle">{tr("En cours")}</div>
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
        <div className={cx("mt-auto flex flex-col gap-2 px-1", navWide && "xl:px-2.5")}>
          <button
            onClick={toggleNav}
            title={navWide ? tr("Réduire le menu") : tr("Agrandir le menu")}
            aria-label={navWide ? tr("Réduire le menu") : tr("Agrandir le menu")}
            className="hidden h-8 items-center gap-2.5 rounded-lg px-2.5 text-xs text-fg-subtle hover:bg-surface-2 hover:text-fg xl:flex"
          >
            {navWide ? <PanelLeftClose size={16} /> : <PanelLeftOpen size={16} />}
            {navWide && <span>{tr("Réduire le menu")}</span>}
          </button>
          {me.user && (
            <div className={cx("flex items-center gap-2 rounded-lg border border-line p-1.5", !navWide && "justify-center")} title={`${me.user.name || me.user.email} · ${me.user.role}`}>
              <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-accent/20 text-xs font-semibold">{(me.user.name || me.user.email).charAt(0).toUpperCase()}</span>
              {navWide && (
                <span className="hidden min-w-0 flex-1 xl:block">
                  <span className="block truncate text-xs text-fg">{me.user.name || me.user.email}</span>
                  {me.credits && me.credits.quota > 0 ? <CreditBar used={me.credits.used} quota={me.credits.quota} /> : <span className="block text-[10px] text-fg-subtle">{tr(me.user.role === "admin" ? "Administrateur" : me.user.role === "viewer" ? "Lecteur" : "Membre")}</span>}
                </span>
              )}
              <button
                onClick={async () => {
                  await api("/api/auth/logout", { method: "POST" });
                  onAuthChange();
                }}
                title={tr("Se déconnecter")}
                aria-label={tr("Se déconnecter")}
                className={cx("text-fg-subtle hover:text-fg", !navWide && "hidden")}
              >
                <LogOut size={14} />
              </button>
            </div>
          )}
        </div>
      </nav>

      <main className="min-w-0 flex-1 overflow-hidden">
        {!agents.data || !teams.data ? (
          <div className="flex h-full items-center justify-center text-sm text-fg-muted">{agents.error || teams.error || tr("Chargement…")}</div>
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
                projects={projects.data}
                reloadProjects={projects.reload}
                runs={runs}
                onChat={(id) => chatWith({ type: "project", id })}
                onAgentsChange={refreshAll}
                selected={selectedProject}
                onSelect={(id) => (setSelectedProject(id), projects.reload())}
                createFrom={createFrom}
                onCreateHandled={() => setCreateFrom(null)}
                onRunsChanged={pollRuns}
                onPlanChat={(id) => chatWith({ type: "project", id, planning: true })}
              />
            )}
            {view === "team" && m && (
              <div className="flex h-full flex-col">
                <div className="flex gap-1 border-b border-line px-6 pt-3">
                  {(
                    [
                      ["agents", "Agents", Bot],
                      ["teams", "Modèles d'équipe", Users],
                    ] as const
                  ).map(([id, label, Icon]) => (
                    <button
                      key={id}
                      onClick={() => setTeamTab(id)}
                      className={cx("-mb-px flex items-center gap-1.5 border-b-2 px-3 py-2 text-sm", teamTab === id ? "border-accent text-fg" : "border-transparent text-fg-muted hover:text-fg")}
                    >
                      <Icon size={14} /> {tr(label)}
                    </button>
                  ))}
                </div>
                <div className="min-h-0 flex-1 overflow-y-auto">
                  {teamTab === "agents" ? (
                    <AgentsView agents={a} meta={m} onChange={refreshAll} onChat={(id) => chatWith({ type: "agent", id })} />
                  ) : (
                    <TeamsView agents={a} teams={t} onChange={refreshAll} onCreateProject={(id) => (setCreateFrom(id), go("projects"))} />
                  )}
                </div>
              </div>
            )}
            {view === "skills" && <SkillsView />}
            {view === "knowledge" && <KnowledgeView />}
            {view === "mcp" && <McpView />}
            {view === "settings" && m && <SettingsHub meta={m} onMetaChange={meta.reload} />}
            {view === "admin" && isAdmin && m && <AdminView meta={m} projects={projects.data ?? []} setupMode={me.setup} onAccountsEnabled={onAuthChange} />}
          </div>
        )}
      </main>

      {/* "answer ready" notifications for runs that finished while you were elsewhere */}
      <div className="pointer-events-none fixed bottom-4 right-4 z-[60] flex w-80 flex-col gap-2">
        {toasts.map((r) => (
          <div key={r.id} className="pop pointer-events-auto flex items-start gap-2.5 rounded-xl border border-line bg-surface-1 p-3 shadow-2xl">
            {r.status === "done" ? <CheckCircle2 size={17} className="mt-0.5 shrink-0 text-emerald-400" /> : <XCircle size={17} className="mt-0.5 shrink-0 text-red-400" />}
            <div className="min-w-0 flex-1">
              <div className="text-sm font-medium">{r.status === "done" ? tr("Réponse prête") : r.status === "stopped" ? tr("Réponse arrêtée") : tr("Échec de la réponse")}</div>
              <div className="truncate text-xs text-fg-muted">
                {targetName(r)} · {r.title}
              </div>
              <button onClick={() => openRun(r)} className="mt-1.5 text-xs font-medium text-accent hover:underline">
                {tr("Ouvrir la conversation")}
              </button>
            </div>
            <button onClick={() => setToasts((t) => t.filter((x) => x.id !== r.id))} className="text-fg-subtle hover:text-fg" aria-label={tr("Fermer")}>
              <X size={14} />
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
