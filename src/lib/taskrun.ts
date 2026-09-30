// Launch a board task: the assignee does the work, then a first contact reviews it and sets the status.
import { get, newId, now, upsert, type Agent, type Evaluation, type Project, type Task } from "./db";
import { runAgent, teamRuntime } from "./orchestrator";
import { activeRunFor, startRun, type Run } from "./runs";
import { workspaceFor } from "./tools";

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

export function startTaskRun(taskId: string): Run {
  const task = get<Task>("tasks", taskId);
  if (!task) throw new Error("Tâche introuvable");
  const project = get<Project>("projects", task.project_id);
  if (!project) throw new Error("Cette tâche n'est rattachée à aucun projet");
  const convKey = `task:${task.id}`;
  if (activeRunFor(convKey)) throw new Error("Cette tâche est déjà en cours");
  const team = teamRuntime(project.team);
  const assignee = team.agents.get(task.assignee_id);
  if (!assignee) throw new Error("Assigne d'abord la tâche à un agent");
  const reviewer = team.spec.entry_ids.map((id) => team.agents.get(id)).find((a): a is Agent => !!a && a.id !== assignee.id);

  return startRun(
    { id: newId(), conversationId: convKey, targetType: "task", targetId: project.id, title: task.title, userMessage: task.title },
    async (emit, signal, run) => {
      const ctx = {
        workspace: await workspaceFor(project.name, project.path),
        projectId: project.id,
        team: team.spec.agent_ids.map((id) => team.agents.get(id)!).filter(Boolean),
      };
      let t = upsert<Task>("tasks", { id: task.id, status: "doing", notes: note(task, "Millikin", `▶ Lancée : ${assignee.name} s'en occupe.`) });

      const previous = t.evaluation?.verdict === "a_corriger" ? `\n\nRetour du dernier contrôle à prendre en compte :\n${t.evaluation.comment}` : "";
      const input = `Tâche du projet « ${project.name} » (#${t.id}) : ${t.title}\n\n${t.description || "(pas de description)"}${previous}

Réalise cette tâche maintenant. Si elle implique du code ou des documents, écris réellement les fichiers dans le dossier du projet.
Termine par un compte rendu : ce que tu as fait, les fichiers créés ou modifiés (chemins), et les points d'attention.`;

      try {
        const result = await runAgent({ agent: assignee, input, team, phase: "execution", depth: 1, emit, signal, ctx });
        t = upsert<Task>("tasks", { id: t.id, result, status: "review", notes: note(t, assignee.name, `Résultat : ${result.slice(0, 700)}`) });

        if (reviewer) {
          const review = await runAgent({
            agent: reviewer,
            depth: 1,
            consultOnly: true,
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

Vérifie le travail (lis les fichiers du projet si tu en as l'outil) : conformité à la consigne, qualité, oublis.
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
