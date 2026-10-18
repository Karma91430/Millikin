// Sprint review: figures computed when a sprint is closed, then feedback from each first contact and a
// synthesis by the main one. Runs in the background like a ticket, so it shows up live and in the traces.
import { db, get, list, newId, now, upsert, type Agent, type Project, type Sprint, type SprintAnalytics, type SprintReview, type Task } from "./db";
import { runAgent, teamRuntime } from "./orchestrator";
import { activeRunFor, startRun, type Run } from "./runs";
import { workspaceFor } from "./tools";

const DAY = 86_400_000;
export const reviewKey = (sprintId: string) => `review:${sprintId}`;
const retriesOf = (t: Task) => (t.notes ?? []).filter((n) => n.text.startsWith("↩️")).length;

/** Figures of a sprint, from its tasks and the model usage between its start and now. Call before unfinished tasks are moved. */
export function sprintAnalytics(sprint: Sprint & { created_at?: number }): SprintAnalytics {
  const tasks = list<Task>("tasks").filter((t) => t.sprint_id === sprint.id);
  const done = tasks.filter((t) => t.status === "done");
  const scored = done.filter((t) => t.evaluation?.score != null);
  const points = (ts: Task[]) => ts.reduce((n, t) => n + (t.complexity || 0), 0);
  const avg = (ts: Task[]) => (ts.length ? ts.reduce((n, t) => n + (t.evaluation?.score ?? 0), 0) / ts.length : null);
  const from = (sprint.start_date ? Date.parse(sprint.start_date) : NaN) || sprint.created_at || now() - 14 * DAY;
  const usage = db()
    .prepare(
      `SELECT agent_id, COUNT(*) AS calls, SUM(status = 'error') AS errors, COALESCE(SUM(prompt_tokens + completion_tokens), 0) AS tokens, COALESCE(SUM(latency_ms), 0) AS ms
       FROM usage_logs WHERE project_id = ? AND ts >= ? GROUP BY agent_id`,
    )
    .all(sprint.project_id, from) as { agent_id: string | null; calls: number; errors: number; tokens: number; ms: number }[];
  const use = (id: string) => usage.find((u) => u.agent_id === id);
  const memberIds = [...new Set([...tasks.map((t) => t.assignee_id).filter(Boolean), ...usage.map((u) => u.agent_id).filter((x): x is string => !!x)])];
  return {
    tasks: tasks.length,
    done: done.length,
    points: points(tasks),
    pointsDone: points(done),
    firstTry: done.filter((t) => !retriesOf(t)).length,
    avgScore: avg(scored),
    retries: tasks.reduce((n, t) => n + retriesOf(t), 0),
    needsHuman: tasks.filter((t) => t.needs_human).length,
    tokens: usage.reduce((n, u) => n + u.tokens, 0),
    computeMs: usage.reduce((n, u) => n + u.ms, 0),
    modelCalls: usage.reduce((n, u) => n + u.calls, 0),
    modelErrors: usage.reduce((n, u) => n + (u.errors || 0), 0),
    days: Math.max(1, Math.round((now() - from) / DAY)),
    members: memberIds.map((id) => {
      const mine = tasks.filter((t) => t.assignee_id === id);
      const mineDone = mine.filter((t) => t.status === "done");
      return {
        agentId: id,
        tasks: mine.length,
        done: mineDone.length,
        points: points(mine),
        pointsDone: points(mineDone),
        avgScore: avg(mineDone.filter((t) => t.evaluation?.score != null)),
        retries: mine.reduce((n, t) => n + retriesOf(t), 0),
        tokens: use(id)?.tokens ?? 0,
        computeMs: use(id)?.ms ?? 0,
      };
    }),
    carried: tasks.filter((t) => t.status !== "done").map((t) => ({ id: t.id, title: t.title, status: t.status, assignee_id: t.assignee_id })),
    delivered: done.map((t) => ({ id: t.id, title: t.title, assignee_id: t.assignee_id, score: t.evaluation?.score ?? null, points: t.complexity || 0 })),
  };
}

/** The figures as text for the reviewers. */
function brief(project: Project, sprint: Sprint, a: SprintAnalytics, names: Map<string, string>) {
  const who = (id: string) => names.get(id) ?? "non assignée";
  const pct = (x: number, of: number) => (of ? `${Math.round((x / of) * 100)} %` : "—");
  return `# Sprint « ${sprint.name} » du projet « ${project.name} »
${sprint.goal ? `Objectif du sprint : ${sprint.goal}\n` : ""}Durée : ${a.days} jour(s).

## Chiffres
- Tâches terminées : ${a.done}/${a.tasks} (${pct(a.done, a.tasks)}) · points : ${a.pointsDone}/${a.points}
- Validées du premier coup : ${a.firstTry}/${a.done} · relances après contrôle : ${a.retries} · en attente d'un humain : ${a.needsHuman}
- Note moyenne du contrôle : ${a.avgScore == null ? "—" : `${a.avgScore.toFixed(1)}/5`}
- Appels au modèle : ${a.modelCalls} (${a.modelErrors} en erreur) · ${Math.round(a.tokens / 1000)}k tokens · ${Math.round(a.computeMs / 60000)} min de calcul

## Par membre
${a.members.map((m) => `- ${who(m.agentId)} : ${m.done}/${m.tasks} tâche(s), ${m.pointsDone}/${m.points} pts, note ${m.avgScore == null ? "—" : m.avgScore.toFixed(1)}, ${m.retries} relance(s), ${Math.round(m.tokens / 1000)}k tokens`).join("\n") || "- (aucune activité)"}

## Livré
${a.delivered.map((t) => `- « ${t.title} » par ${who(t.assignee_id)}${t.score != null ? ` (note ${t.score}/5)` : ""}`).join("\n") || "- rien"}

## Non terminé (reporté)
${a.carried.map((t) => `- « ${t.title} » (${t.status}, ${who(t.assignee_id)})`).join("\n") || "- rien"}`;
}

const REVIEW_NOTE = `Tu fais la revue de fin de sprint de ton équipe, selon ton rôle. Tu peux lire les fichiers du projet pour vérifier un livrable, mais tu ne modifies rien.
Réponds en Markdown, avec ces parties :
### Ce qui a bien marché
### Ce qui a coincé
### Commentaires par membre (une ligne par personne : ce qu'elle a apporté, ce qu'elle peut améliorer)
### Recommandations pour le prochain sprint (3 à 5 actions concrètes)
Appuie-toi sur les chiffres ; sois factuel, bref et constructif.`;

const READ_ONLY = ["board_add_card", "board_update_card", "write_file", "edit_file", "run_command", "http_request", "record_decision"];

const today = () => new Date().toISOString().slice(0, 10);

/** A ticket of a planned sprint starts: the sprint becomes the active one (unless another is still running). */
export function activateSprintFor(task: Task) {
  const sprint = task.sprint_id ? get<Sprint>("sprints", task.sprint_id) : undefined;
  if (!sprint || sprint.status !== "planned") return;
  const busy = list<Sprint>("sprints").some((s) => s.project_id === sprint.project_id && s.status === "active" && s.id !== sprint.id);
  if (!busy) upsert("sprints", { id: sprint.id, status: "active", start_date: sprint.start_date || today() });
}

/**
 * A ticket was validated: when it was the last open ticket of its sprint, the sprint is closed and its review
 * starts (the agents run the work, nobody has to close the sprint by hand). Returns true when it closed it.
 */
export function closeSprintIfDone(task: Task): boolean {
  const sprint = task.sprint_id ? get<Sprint>("sprints", task.sprint_id) : undefined;
  if (!sprint || sprint.status === "done") return false;
  const tasks = list<Task>("tasks").filter((t) => t.sprint_id === sprint.id);
  if (!tasks.length || tasks.some((t) => t.status !== "done")) return false;
  const analytics = sprintAnalytics(sprint);
  upsert("sprints", { id: sprint.id, status: "done", start_date: sprint.start_date || today(), end_date: sprint.end_date || today() });
  try {
    startSprintReview(sprint.id, analytics);
  } catch {
    // No first contact or a review already running: the sprint stays closed, the review can be run from Pilotage.
  }
  return true;
}

/** Start (or restart) the review of a sprint in the background. */
export function startSprintReview(sprintId: string, analytics?: SprintAnalytics): Run {
  const sprint = get<Sprint>("sprints", sprintId);
  if (!sprint) throw new Error("Sprint introuvable");
  const project = get<Project>("projects", sprint.project_id);
  if (!project) throw new Error("Projet introuvable");
  if (activeRunFor(reviewKey(sprintId))) throw new Error("La revue de ce sprint est déjà en cours");
  const team = teamRuntime(project.team);
  const reviewers = (team.spec.entry_ids.length ? team.spec.entry_ids : team.spec.agent_ids.slice(0, 1)).map((id) => team.agents.get(id)).filter((a): a is Agent => !!a);
  if (!reviewers.length) throw new Error("Définis au moins un premier contact (★) dans l'équipe du projet");

  // Once closed, unfinished tasks have left the sprint: keep the figures taken at closing time.
  const figures = analytics ?? sprint.review?.analytics ?? sprintAnalytics(sprint);
  const save = (r: Partial<SprintReview>) => {
    const current = get<Sprint>("sprints", sprintId)?.review;
    return upsert<Sprint>("sprints", { id: sprintId, review: { status: "running", created_at: now(), analytics: figures, feedback: [], summary: "", ...current, ...r } });
  };
  save({ status: "running", created_at: now(), analytics: figures, feedback: [], summary: "", error: undefined });

  const names = new Map([...team.agents.values()].map((a) => [a.id, a.name]));
  const facts = brief(project, sprint, figures, names);

  return startRun(
    { id: newId(), conversationId: reviewKey(sprintId), targetType: "task", targetId: project.id, title: `Revue du sprint « ${sprint.name} »`, userMessage: "" },
    async (emit, signal, run) => {
      try {
        const ctx = { workspace: await workspaceFor(project.name, project.path), projectId: project.id, team: team.spec.agent_ids.map((id) => team.agents.get(id)!).filter(Boolean) };
        const common = { depth: 1, consultOnly: true, excludeTools: READ_ONLY, emit, signal, ctx, throwErrors: true } as const;
        const feedback = await Promise.all(
          reviewers.map(async (agent) => ({ agentId: agent.id, text: await runAgent({ ...common, agent, input: `${facts}\n\n${REVIEW_NOTE}` }) })),
        );
        save({ feedback });
        const lead = reviewers[0];
        const summary =
          reviewers.length === 1
            ? feedback[0].text
            : await runAgent({
                ...common,
                agent: lead,
                input: `${facts}\n\n## Avis des premiers contacts\n${feedback.map((f) => `### ${names.get(f.agentId)}\n${f.text}`).join("\n\n")}\n\nRédige la revue de sprint commune : commence par un résumé de 3 phrases, puis les mêmes parties (bien marché, coincé, commentaires par membre, recommandations), en fusionnant les avis sans doublon et en citant qui a soulevé quel point quand c'est utile.`,
              });
        save({ status: "done", summary });
      } catch (e) {
        save({ status: "error", error: signal.aborted ? "Revue arrêtée" : e instanceof Error ? e.message : String(e) });
        emit({ type: "error", message: e instanceof Error ? e.message : String(e) });
      }
      for (const c of Object.values(run.trace.calls)) c.reasoning = c.reasoning.slice(0, 4000);
      db().prepare("UPDATE sprints SET review_trace = ? WHERE id = ?").run(JSON.stringify(run.trace), sprintId);
      emit({ type: "done", messageId: "" });
    },
  );
}
