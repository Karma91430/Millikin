// Launch board tasks: the assignee does the work, then a first contact reviews it and sets the status.
// Tasks can depend on others: dependencies' results and the project's decision log are passed along,
// and a chain run executes a whole set of tasks in dependency order.
import fs from "node:fs/promises";
import path from "node:path";
import { appendDecision } from "./decisions";
import { get, getSettings, list, newId, now, upsert, type Agent, type Evaluation, type Project, type Task } from "./db";
import { runAgent, teamRuntime } from "./orchestrator";
import { activeRunFor, getRun, startRun, stopRun, type Run } from "./runs";
import type { TraceEvent } from "./trace";
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
  // No JSON verdict: only an explicit "valide" without reservation counts; an empty or unclear review never validates.
  const clean = text.replace(/\(pas de réponse[^)]*\)/g, "").trim();
  const valid = clean.length > 40 && /\bvalid[ée]e?\b/i.test(clean) && !/à corriger|a_corriger|a corriger|non valid|incomplet|manquant/i.test(clean);
  return {
    verdict: valid ? "valide" : "a_corriger",
    score: valid ? 3 : 2,
    comment: clean ? clean.replace(/\s+/g, " ").slice(-600) : "Le contrôle n'a rendu aucun verdict exploitable : la tâche est relancée.",
    by,
    at: now(),
  };
}

const projectTasks = (projectId: string) => list<Task>("tasks").filter((t) => t.project_id === projectId);

/** What an attempt really did, recorded from its tool events (the report is the agent's claim, this is the fact). */
type Actions = { written: Set<string>; failedEdits: number; commands: { command: string; result: string }[] };
function recorder(emit: (ev: TraceEvent) => void) {
  const actions: Actions = { written: new Set(), failedEdits: 0, commands: [] };
  const pending = new Map<string, { name: string; args: Record<string, unknown> }>();
  const tap = (ev: TraceEvent) => {
    if (ev.type === "tool_call") pending.set(ev.toolCallId, { name: ev.name, args: (typeof ev.args === "string" ? safeJson(ev.args) : ev.args) as Record<string, unknown> });
    if (ev.type === "tool_result") {
      const call = pending.get(ev.toolCallId);
      const m = ev.result.match(/^Fichier (?:écrit|modifié) : (\S+)/);
      if (m) actions.written.add(m[1]);
      else if (call?.name === "edit_file" && ev.result.startsWith("Échec")) actions.failedEdits++;
      if (call?.name === "run_command") actions.commands.push({ command: String(call.args?.command ?? ""), result: ev.result.slice(-1500) });
    }
    emit(ev);
  };
  return { actions, tap };
}
const safeJson = (s: string) => {
  try {
    return JSON.parse(s);
  } catch {
    return {};
  }
};

const FILE_RE = /(?<![\w/.-])((?:[\w.-]+\/)*[\w-]+\.(?:py|ts|tsx|js|jsx|json|md|csv|txt|toml|ya?ml|html|css|sql|sh|ipynb))(?![\w/])/g;

const LIBRARY_NAMES = /^(node|next|vue|nuxt|chart|d3|three|express|react|deno|bun|socket\.io)\.js$/i;

async function projectFiles(dir: string, base = dir, out = new Set<string>()) {
  for (const e of await fs.readdir(dir, { withFileTypes: true }).catch(() => [])) {
    if (["node_modules", ".git", ".venv", "venv", "__pycache__", ".next", "dist"].includes(e.name)) continue;
    const full = path.join(dir, e.name);
    if (e.isDirectory()) await projectFiles(full, base, out);
    else out.add(path.relative(base, full));
  }
  return out;
}

/** Files named in the report that are not in the project folder (a bare name matches any file with that name). */
async function missingFiles(report: string, workspace: string) {
  const named = [...new Set([...report.matchAll(FILE_RE)].map((m) => m[1].replace(/^\.\//, "")))].filter((f) => !LIBRARY_NAMES.test(f));
  if (!named.length) return [];
  const files = await projectFiles(workspace);
  const names = new Set([...files].map((f) => path.basename(f)));
  return named.filter((f) => !files.has(f) && !(f.includes("/") ? false : names.has(f)));
}

/**
 * Facts for the reviewer, gathered by Millikin: files written or modified in this attempt, failed edits,
 * commands with the end of their output, the current content of the deliverables named in the task
 * (even if written in an earlier attempt) and the files the report names that are not in the folder.
 */
async function factsFor(actions: Actions, workspace: string, task: Task, report: string) {
  const lines: string[] = [];
  lines.push(actions.written.size ? `Fichiers écrits ou modifiés pendant cette tentative : ${[...actions.written].join(", ")}` : "Aucun fichier écrit ni modifié pendant cette tentative (le travail a pu être fait lors d'une tentative précédente : juge l'état actuel des fichiers ci-dessous).");
  if (actions.failedEdits) lines.push(`${actions.failedEdits} modification(s) de fichier ont échoué (edit_file).`);
  let budget = 14000;
  const take = (text: string, max: number) => {
    const part = text.length > Math.min(max, budget) ? text.slice(0, Math.min(max, budget)) + "\n… (tronqué)" : text;
    budget -= part.length;
    return part;
  };
  for (const c of actions.commands.slice(-4)) {
    if (budget <= 0) break;
    lines.push(`\n### Commande exécutée : ${c.command.slice(0, 200)}\n\`\`\`\n${take(c.result, 1500)}\n\`\`\``);
  }
  // Deliverables: files named in the task that exist now, plus those written in this attempt.
  const named = [...new Set([...`${task.title}\n${task.description}`.matchAll(FILE_RE)].map((m) => m[1].replace(/^\.\//, "")))];
  const files = [...new Set([...actions.written, ...named])];
  for (const f of files.slice(0, 8)) {
    if (budget <= 0) break;
    const content = await fs.readFile(path.join(workspace, f), "utf8").catch(() => null);
    if (content === null) continue;
    lines.push(`\n### Contenu actuel de ${f}\n\`\`\`\n${take(content, 2500)}\n\`\`\``);
  }
  const missing = await missingFiles(report, workspace);
  if (missing.length)
    lines.push(
      `\nFichiers nommés dans le compte rendu mais absents du dossier : ${missing.slice(0, 10).join(", ")}. C'est normal s'ils ont été supprimés à dessein ou ne sont que des exemples ; c'est une faute seulement s'ils devaient être livrés.`,
    );
  return lines.join("\n");
}

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
  // Reviewer: a first contact other than the assignee, preferably one who can check (run commands, read files).
  const entries = team.spec.entry_ids.map((id) => team.agents.get(id)).filter((a): a is Agent => !!a && a.id !== assignee.id);
  const reviewer = entries.find((a) => a.tools?.includes("run_command")) ?? entries.find((a) => a.tools?.includes("files_read")) ?? entries[0];

  return startRun(
    { id: newId(), conversationId: `task:${task.id}`, targetType: "task", targetId: project.id, title: task.title, userMessage: task.title },
    async (emit, signal, run) => {
      const ctx = {
        workspace: await workspaceFor(project.name, project.path),
        projectId: project.id,
        team: team.spec.agent_ids.map((id) => team.agents.get(id)!).filter(Boolean),
      };
      // A launch by a person resets the automatic relaunch counter.
      let t = upsert<Task>("tasks", { id: task.id, status: "doing", attempts: 0, needs_human: false, notes: note(task, "Millikin", `▶ Lancée : ${assignee.name} s'en occupe.`) });
      const maxRetries = Math.max(0, Math.min(10, Number(getSettings().task_auto_retries) || 0));
      let lastError = "";

      // Loop: work → review; a rejected or failed attempt is relaunched with the feedback, up to maxRetries times.
      for (let attempt = 0; ; attempt++) {
        if (attempt > 0) {
          t = upsert<Task>("tasks", { id: t.id, status: "doing", attempts: attempt, notes: note(t, "Millikin", `↻ Relance automatique ${attempt}/${maxRetries}`) });
        }
        const previous =
          t.evaluation?.verdict === "a_corriger"
            ? `\n\n## Retour du dernier contrôle à prendre en compte\n${t.evaluation.comment}`
            : lastError
              ? `\n\n## La tentative précédente a échoué\n${lastError}\nCorrige la cause avant de recommencer.`
              : "";
        const input = `Tâche du projet « ${project.name} » (#${t.id}) : ${t.title}\n\n${t.description || "(pas de description)"}${dependencyContext(t, projectTasks(project.id))}${previous}

Réalise cette tâche maintenant. Si elle implique du code ou des documents, écris réellement les fichiers dans le dossier du projet.
Termine par un compte rendu : ce que tu as fait, les fichiers créés ou modifiés (chemins), et les points d'attention.`;

        try {
          lastError = "";
          // The board is driven by the task run itself: the assignee must not add or move cards.
          const { actions, tap } = recorder(emit);
          const result = await runAgent({ agent: assignee, input, team, phase: "execution", depth: 1, throwErrors: true, emit: tap, signal, ctx, excludeTools: BOARD_WRITE });
          t = upsert<Task>("tasks", { id: t.id, result, status: "review", notes: note(t, assignee.name, `Résultat : ${result.slice(0, 700)}`) });

          const facts = await factsFor(actions, ctx.workspace, t, result);

          // Without a reviewer the task stays "En revue" for a person to check.
          if (reviewer) {
            const review = await runAgent({
              agent: reviewer,
              depth: 1,
              throwErrors: true,
              consultOnly: true,
              // Review is read-only: no card creation, no file edits, no commands, no decision log edits.
              excludeTools: [...BOARD_WRITE, "write_file", "edit_file", "run_command", "http_request", "record_decision"],
              phase: "execution",
              team,
              emit,
              signal,
              ctx,
              input: `Tu contrôles la tâche « ${t.title} » réalisée par ${assignee.name} sur le projet « ${project.name} ».

Consigne de la tâche :
${t.description || t.title}

Compte rendu de ${assignee.name} (ce qu'il affirme) :
${result}

## Ce que Millikin a constaté (fait foi, relevé automatiquement)
${facts}

Vérifie le TRAVAIL RÉEL, pas les intentions : juge d'après les fichiers et leur contenu ci-dessus (et lis-en d'autres si besoin), pas d'après le compte rendu.
- Juge l'ÉTAT ACTUEL des livrables : s'ils existent et respectent la consigne, la tâche est faite, même si cette tentative n'a rien eu à réécrire.
- Si un livrable demandé manque ou ne respecte pas la consigne, le verdict est « a_corriger » (dis précisément lequel et pourquoi).
- Un compte rendu qui décrit ce qui « serait fait » sans que les fichiers le montrent est « a_corriger ».
- Ne demande pas de recopier des sorties dans le compte rendu : les commandes exécutées et le contenu des fichiers sont dans les faits ci-dessus.
- Vérifie aussi la conformité à la consigne, la cohérence avec les tâches dont elle dépend et les décisions du projet, la qualité, les oublis.
Donne un avis court et argumenté, puis termine OBLIGATOIREMENT par une ligne JSON :
{"verdict": "valide" ou "a_corriger", "score": 1 à 5, "commentaire": "ce qui va / ce qu'il faut corriger"}`,
            });
            const evaluation = parseEvaluation(review, reviewer.name);
            t = upsert<Task>("tasks", {
              id: t.id,
              evaluation,
              status: evaluation.verdict === "valide" ? "done" : "retry",
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
          // A failure goes to "À relancer"; a manual stop simply returns to the backlog.
          t = upsert<Task>("tasks", { id: t.id, status: signal.aborted ? "todo" : "retry", notes: note(t, "Millikin", `⚠️ ${message}`) });
          emit({ type: "error", message });
          lastError = message;
        }

        if (t.status !== "retry" || signal.aborted) break;
        if (attempt >= maxRetries) {
          if (maxRetries > 0)
            t = upsert<Task>("tasks", {
              id: t.id,
              needs_human: true,
              notes: note(t, "Millikin", `🧑 ${maxRetries} relances automatiques sans validation : une vérification humaine est nécessaire.`),
            });
          break;
        }
        // Give a failing service (model unloaded, network) a moment before the next attempt.
        if (lastError) await new Promise((r) => setTimeout(r, 5000));
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
export function startChainRun(projectId: string, opts: { parallel?: number; sprintId?: string } = {}): Run {
  const project = get<Project>("projects", projectId);
  if (!project) throw new Error("Projet introuvable");
  if (activeRunFor(chainKey(projectId))) throw new Error("Une chaîne est déjà en cours sur ce projet");
  const scope = projectTasks(projectId).filter((t) => !opts.sprintId || t.sprint_id === opts.sprintId);
  const order = chainOrder(scope);
  if (!order.length) throw new Error("Aucune tâche à lancer : tout est terminé");
  const missing = order.filter((t) => !t.assignee_id);
  if (missing.length) throw new Error(`Assigne d'abord : ${missing.map((t) => `« ${t.title} »`).join(", ")}`);
  const parallel = Math.max(1, opts.parallel ?? 2);

  return startRun(
    { id: newId(), conversationId: chainKey(projectId), targetType: "task", targetId: projectId, title: `Chaîne : ${order.length} tâche(s)`, userMessage: "" },
    async (emit, signal) => {
      const pending = new Set(order.map((t) => t.id));
      const running = new Map<string, Promise<void>>();
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
          // The task run already relaunched it automatically; past that, a person has to look.
          failed ??= `« ${t.title} » n'a pas été validée${t.needs_human ? " après les relances automatiques" : ""}${t.evaluation ? ` : ${t.evaluation.comment.slice(0, 200)}` : ""}`;
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
