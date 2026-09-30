// Launch board tasks: the assignee does the work, then a first contact reviews it and sets the status.
// Tasks can depend on others: dependencies' results and the project's decision log are passed along,
// and a chain run executes a whole set of tasks in dependency order.
import { appendDecision } from "./decisions";
import { get, list, newId, now, upsert, type Agent, type Evaluation, type Project, type Task } from "./db";
import { runAgent, teamRuntime } from "./orchestrator";
import { activeRunFor, getRun, startRun, stopRun, type Run } from "./runs";
import { workspaceFor } from "./tools";

const BOARD_WRITE = ["board_add_card", "board_update_card"];
const DEP_RESULT_CHARS = 2500;

const note = (t: Task, by: string, text: string) => [...(t.notes ?? []), { at: now(), by, text }];

/** Pull the reviewer's verdict from its answer (a trailing JSON object), with a keyword fallback. */
function parseEvaluation(text: string, by: string): Evaluation {
  const blocks = text.match(/\{[^{}]*"verdict"[^{}]*\}/g);
  if (blocks) {
    try {
      const j = JSON.parse(blocks[blocks.length - 1]) as { verdict?: string; score?: number; commentaire?: string; comment?: string };
      const verdict = /corrig/i.test(String(j.verdict)) ? "a_corriger" : "valide";
      return { verdict, score: Math.min(5, Math.max(1, Math.round(Number(j.score) || 3))), comment: String(j.commentaire ?? j.comment ?? "").slice(0, 1500), by, at: now() };
    } catch {}
  }
  const verdict = /à corriger|a_corriger|a corriger|non valid/i.test(text) ? "a_corriger" : "valide";
  return { verdict, score: verdict === "valide" ? 4 : 2, comment: text.replace(/\s+/g, " ").slice(-600), by, at: now() };
}

const projectTasks = (projectId: string) => list<Task>("tasks").filter((t) => t.project_id === projectId);

/** Dependencies that are not done yet. */
export function blockersOf(task: Task, all: Task[]): Task[] {
  return (task.depends_on ?? []).map((id) => all.find((t) => t.id === id)).filter((t): t is Task => !!t && t.status !== "done");
}

/** What the assignee needs to know from the tasks it depends on. */
function dependencyContext(task: Task, all: Task[]): string {
  const deps = (task.depends_on ?? []).map((id) => all.find((t) => t.id === id)).filter((t): t is Task => !!t);
  if (!deps.length) return "";
  return (
    "\n\n## Tâches dont celle-ci dépend (déjà réalisées : appuie-toi dessus, ne refais pas leur travail)\n" +
    deps
      .map((d) => {
        const result = d.result ? (d.result.length > DEP_RESULT_CHARS ? d.result.slice(0, DEP_RESULT_CHARS) + "…" : d.result) : "(pas de compte rendu)";
        const review = d.evaluation ? `\nContrôle (${d.evaluation.verdict}, ${d.evaluation.score}/5) : ${d.evaluation.comment}` : "";
        return `### #${d.id} — ${d.title}\nConsigne : ${d.description || d.title}\nCompte rendu :\n${result}${review}`;
      })
      .join("\n\n") +
    "\nRelis les fichiers qu'elles ont produits (list_files / read_file) avant de commencer."
  );
}

function prepare(taskId: string, opts: { ignoreBlockers?: boolean } = {}) {
  const task = get<Task>("tasks", taskId);
  if (!task) throw new Error("Tâche introuvable");
  const project = get<Project>("projects", task.project_id);
  if (!project) throw new Error("Cette tâche n'est rattachée à aucun projet");
  if (activeRunFor(`task:${task.id}`)) throw new Error("Cette tâche est déjà en cours");
  const team = teamRuntime(project.team);
  const assignee = team.agents.get(task.assignee_id);
  if (!assignee) throw new Error(`Assigne d'abord « ${task.title} » à un agent`);
  if (!opts.ignoreBlockers) {
    const blockers = blockersOf(task, projectTasks(project.id));
    if (blockers.length) throw new Error(`Tâche bloquée : termine d'abord ${blockers.map((b) => `« ${b.title} »`).join(", ")}`);
  }
  return { task, project, team, assignee };
}

export function startTaskRun(taskId: string, opts: { ignoreBlockers?: boolean } = {}): Run {
  const { task, project, team, assignee } = prepare(taskId, opts);
  const reviewer = team.spec.entry_ids.map((id) => team.agents.get(id)).find((a): a is Agent => !!a && a.id !== assignee.id);

  return startRun(
    { id: newId(), conversationId: `task:${task.id}`, targetType: "task", targetId: project.id, title: task.title, userMessage: task.title },
    async (emit, signal, run) => {
      const ctx = {
        workspace: await workspaceFor(project.name, project.path),
        projectId: project.id,
        team: team.spec.agent_ids.map((id) => team.agents.get(id)!).filter(Boolean),
      };
      let t = upsert<Task>("tasks", { id: task.id, status: "doing", notes: note(task, "Millikin", `▶ Lancée : ${assignee.name} s'en occupe.`) });

      const previous = t.evaluation?.verdict === "a_corriger" ? `\n\n## Retour du dernier contrôle à prendre en compte\n${t.evaluation.comment}` : "";
      const input = `Tâche du projet « ${project.name} » (#${t.id}) : ${t.title}\n\n${t.description || "(pas de description)"}${dependencyContext(t, projectTasks(project.id))}${previous}

Réalise cette tâche maintenant. Si elle implique du code ou des documents, écris réellement les fichiers dans le dossier du projet.
Termine par un compte rendu : ce que tu as fait, les fichiers créés ou modifiés (chemins), et les points d'attention.`;

      try {
        // The board is driven by the task run itself: the assignee must not add or move cards.
        const result = await runAgent({ agent: assignee, input, team, phase: "execution", depth: 1, emit, signal, ctx, excludeTools: BOARD_WRITE });
        t = upsert<Task>("tasks", { id: t.id, result, status: "review", notes: note(t, assignee.name, `Résultat : ${result.slice(0, 700)}`) });

        if (reviewer) {
          const review = await runAgent({
            agent: reviewer,
            depth: 1,
            consultOnly: true,
            // Review is read-only: no card creation, no file edits, no commands, no decision log edits.
            excludeTools: [...BOARD_WRITE, "write_file", "edit_file", "run_command", "record_decision"],
            phase: "execution",
            team,
            emit,
            signal,
            ctx,
            input: `Tu contrôles la tâche « ${t.title} » réalisée par ${assignee.name} sur le projet « ${project.name} ».

Consigne de la tâche :
${t.description || t.title}

Compte rendu de ${assignee.name} :
${result}

Vérifie le travail (lis les fichiers du projet si tu en as l'outil) : conformité à la consigne, cohérence avec les tâches dont elle dépend et avec les décisions du projet, qualité, oublis.
Donne un avis court et argumenté, puis termine OBLIGATOIREMENT par une ligne JSON :
{"verdict": "valide" ou "a_corriger", "score": 1 à 5, "commentaire": "ce qui va / ce qu'il faut corriger"}`,
          });
          const evaluation = parseEvaluation(review, reviewer.name);
          t = upsert<Task>("tasks", {
            id: t.id,
            evaluation,
            status: evaluation.verdict === "valide" ? "done" : "todo",
            notes: note(t, reviewer.name, `${evaluation.verdict === "valide" ? "✅ Validé" : "↩️ À corriger"} (${evaluation.score}/5) : ${evaluation.comment}`),
          });
          await appendDecision(
            ctx.workspace,
            `Tâche #${t.id} « ${t.title} » : ${evaluation.verdict === "valide" ? "validée" : "à corriger"} (${evaluation.score}/5)`,
            `Réalisée par ${assignee.name}. ${evaluation.comment}`,
            reviewer.name,
          ).catch(() => {});
        }
      } catch (e) {
        const message = signal.aborted ? "Arrêtée" : e instanceof Error ? e.message : String(e);
        t = upsert<Task>("tasks", { id: t.id, status: "todo", notes: note(t, "Millikin", `⚠️ ${message}`) });
        emit({ type: "error", message });
      }
      upsert("tasks", { id: t.id, trace: run.trace });
      emit({ type: "done", messageId: "" });
    },
  );
}

/** Tasks to run in dependency order; throws on cycles. Done tasks are skipped. */
export function chainOrder(tasks: Task[]): Task[] {
  const byId = new Map(tasks.map((t) => [t.id, t]));
  const out: Task[] = [];
  const state = new Map<string, "visiting" | "done">();
  const visit = (t: Task) => {
    if (state.get(t.id) === "done") return;
    if (state.get(t.id) === "visiting") throw new Error(`Dépendance circulaire autour de « ${t.title} »`);
    state.set(t.id, "visiting");
    for (const d of t.depends_on ?? []) if (byId.has(d)) visit(byId.get(d)!);
    state.set(t.id, "done");
    if (t.status !== "done") out.push(t);
  };
  tasks.forEach(visit);
  return out;
}

export const chainKey = (projectId: string) => `chain:${projectId}`;

/**
 * Run every open task of a project in dependency order. Independent tasks run side by side
 * (up to `parallel`); each task is its own run, so the board and live views work as usual.
 */
export function startChainRun(projectId: string, opts: { retry: boolean; parallel?: number }): Run {
  const project = get<Project>("projects", projectId);
  if (!project) throw new Error("Projet introuvable");
  if (activeRunFor(chainKey(projectId))) throw new Error("Une chaîne est déjà en cours sur ce projet");
  const order = chainOrder(projectTasks(projectId));
  if (!order.length) throw new Error("Aucune tâche à lancer : tout est terminé");
  const missing = order.filter((t) => !t.assignee_id);
  if (missing.length) throw new Error(`Assigne d'abord : ${missing.map((t) => `« ${t.title} »`).join(", ")}`);
  const parallel = Math.max(1, opts.parallel ?? 2);

  return startRun(
    { id: newId(), conversationId: chainKey(projectId), targetType: "task", targetId: projectId, title: `Chaîne : ${order.length} tâche(s)`, userMessage: "" },
    async (emit, signal) => {
      const pending = new Set(order.map((t) => t.id));
      const running = new Map<string, Promise<void>>();
      const retried = new Set<string>();
      let failed: string | null = null;
      signal.addEventListener("abort", () => {
        for (const id of running.keys()) {
          const r = activeRunFor(`task:${id}`);
          if (r) stopRun(r.id);
        }
      });

      const launch = (id: string) => {
        const run = startTaskRun(id, { ignoreBlockers: true });
        const p = run.finished.then(() => {
          running.delete(id);
          const t = get<Task>("tasks", id)!;
          if (t.status === "done") return;
          if (opts.retry && !retried.has(id) && !signal.aborted && t.evaluation?.verdict === "a_corriger") {
            retried.add(id);
            pending.add(id); // one more attempt with the reviewer's feedback
            return;
          }
          failed ??= `« ${t.title} » n'a pas été validée${t.evaluation ? ` : ${t.evaluation.comment.slice(0, 200)}` : ""}`;
        });
        running.set(id, p);
      };

      while (!signal.aborted && !failed && (pending.size || running.size)) {
        const all = projectTasks(projectId);
        const ready = [...pending].filter((id) => {
          const t = all.find((x) => x.id === id);
          return t && !blockersOf(t, all).length;
        });
        for (const id of ready.slice(0, parallel - running.size)) {
          pending.delete(id);
          try {
            launch(id);
          } catch (e) {
            failed = e instanceof Error ? e.message : String(e);
          }
        }
        if (!running.size) {
          if (pending.size && !failed) failed = "Tâches restantes bloquées par des dépendances non terminées";
          break;
        }
        await Promise.race(running.values());
      }
      await Promise.all(running.values());
      if (failed && !signal.aborted) emit({ type: "error", message: `Chaîne arrêtée : ${failed}` });
      emit({ type: "done", messageId: "" });
    },
  );
}

export const chainRunFor = (projectId: string) => {
  const r = activeRunFor(chainKey(projectId));
  return r ? getRun(r.id) : undefined;
};
