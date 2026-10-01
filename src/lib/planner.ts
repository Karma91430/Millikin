// Project planning: the lead first contact (with the other first contacts) breaks the project into
// sprints and tasks with assignee, complexity, priority and dependencies; Millikin creates them.
import fs from "node:fs/promises";
import path from "node:path";
import { appendDecision } from "./decisions";
import { get, list, newId, now, upsert, type Agent, type Project, type Sprint, type Task } from "./db";
import { complete } from "./gateway";
import { runAgent, slugify, teamRuntime } from "./orchestrator";
import { activeRunFor, startRun, type Run } from "./runs";
import type { TraceEvent } from "./trace";
import { toPoints, workspaceFor } from "./tools";

type PlanTask = { ref?: string; title?: string; description?: string; assignee?: string; priority?: string; complexity?: number; depends_on?: string[]; sprint?: string };
type PlanSprint = { ref?: string; name?: string; goal?: string };
type Plan = { sprints?: PlanSprint[]; tasks?: PlanTask[] };

const IGNORED = new Set(["node_modules", ".git", ".next", "dist", "build", ".venv", "venv", "__pycache__", ".DS_Store"]);

async function fileTree(root: string, max = 80): Promise<string[]> {
  const out: string[] = [];
  const walk = async (dir: string) => {
    for (const e of await fs.readdir(dir, { withFileTypes: true }).catch(() => [])) {
      if (IGNORED.has(e.name) || out.length >= max) continue;
      const rel = path.relative(root, path.join(dir, e.name));
      out.push(e.isDirectory() ? `${rel}/` : rel);
      if (e.isDirectory()) await walk(path.join(dir, e.name));
    }
  };
  await walk(root);
  return out;
}

/** Small models add comments, "…" placeholders or trailing commas to JSON: clean them up. */
const lenient = (c: string) =>
  c
    .trim()
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "")
    .replace(/,\s*(?:…|\.\.\.)\s*(?=[\]}])/g, "")
    .replace(/,\s*([\]}])/g, "$1");

/** Take the last JSON object of the answer (models sometimes wrap it in prose or code fences). */
export function parsePlan(text: string): Plan {
  const fenced = [...text.matchAll(/```(?:json)?\s*([\s\S]*?)```/g)].map((m) => m[1]).filter((b) => b.includes("{"));
  const candidates = [...fenced.reverse(), text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1)];
  for (const c of candidates) {
    try {
      const j = JSON.parse(lenient(c)) as Plan;
      if (Array.isArray(j.tasks)) return j;
    } catch {}
  }
  throw new Error("Le plan n'a pas pu être lu (JSON attendu). Relance la planification.");
}
const tryParsePlan = (text: string) => {
  try {
    return parsePlan(text);
  } catch {
    return null;
  }
};

const planKey = (projectId: string) => `plan:${projectId}`;

type Emit = (ev: TraceEvent) => void;

/**
 * Break a project into sprints and tasks. The lead first contact plans (co-leads are consulted
 * automatically), the answer's JSON is turned into sprints and tasks. `brief` can be a whole
 * scoping conversation. Returns what was created.
 */
export type Granularity = "macro" | "standard" | "fine";
const LOTS = "Des lots fonctionnels de 1 à 3 jours chacun (complexité 5 à 13), une fonctionnalité ou un livrable complet par lot.";
/** Size of the tasks each lot is split into (small models keep one task per feature otherwise). */
const SPLIT: Record<Exclude<Granularity, "macro">, { size: string; points: string; count: string }> = {
  standard: { size: "une demi-journée à une journée de travail", points: "2, 3 ou 5", count: "2 à 4" },
  fine: { size: "1 à 3 heures de travail, une seule action ou un seul fichier principal", points: "1, 2 ou 3", count: "3 à 8" },
};
type SubTask = { title?: string; description?: string; assignee?: string; complexity?: number; after?: number[] };

/**
 * Second pass: split each lot into sub-tasks with a short JSON call per lot. Sub-tasks keep the
 * lot's sprint and priority; inside a lot they chain through `after`, and the lot's dependencies
 * are carried by its first sub-tasks (pointing at the last sub-tasks of the lots it depends on).
 */
async function refineLots(opts: { lots: PlanTask[]; granularity: Exclude<Granularity, "macro">; project: Project; members: Agent[]; model?: string; emit: Emit; signal: AbortSignal }) {
  const { lots, granularity, project, members, emit, signal } = opts;
  const g = SPLIT[granularity];
  const callId = newId();
  emit({ type: "agent_start", callId, agentId: members[0]?.id ?? "", parentCallId: null, input: `Découpage des ${lots.length} lots en tâches (${g.size})` });
  const firsts = new Map<string, string[]>();
  const lasts = new Map<string, string[]>();
  const subs: PlanTask[][] = [];
  let log = "";
  for (const [i, lot] of lots.entries()) {
    if (signal.aborted) throw new Error("Planification arrêtée");
    const ref = String(lot.ref ?? `T${i + 1}`);
    let parsed: SubTask[] = [];
    try {
      const raw = await complete({
        ref: opts.model,
        json: true,
        source: "planner",
        messages: [
          { role: "system", content: "Tu découpes un lot de travail en tâches concrètes. Réponds uniquement en JSON." },
          {
            role: "user",
            content: `Projet « ${project.name} »${project.description ? ` : ${project.description}` : ""}
Lot à découper : « ${lot.title} »
${lot.description ?? ""}
Responsable proposé : ${lot.assignee ?? "non défini"}
Membres disponibles : ${members.map((m) => `${m.name} (${m.role})`).join(", ")}

Découpe ce lot en ${g.count} tâches de ${g.size} chacune, dans l'ordre de réalisation. Chaque tâche a une consigne autonome (objectif, livrable, fichiers), le membre le plus adapté (souvent le responsable du lot, mais les tests, la relecture ou la documentation peuvent revenir à un autre membre), une complexité (${g.points}) et "after" : les numéros (à partir de 1) des tâches de ce lot qui doivent être terminées avant.
Format : {"tasks": [{"title": "…", "description": "…", "assignee": "Nom", "complexity": 2, "after": []}, {"title": "…", "description": "…", "assignee": "Nom", "complexity": 2, "after": [1]}]}`,
          },
        ],
      });
      const j = JSON.parse(lenient(raw.slice(raw.indexOf("{"), raw.lastIndexOf("}") + 1))) as { tasks?: SubTask[] };
      parsed = (j.tasks ?? []).filter((t) => t.title).slice(0, 10);
    } catch {}
    // A lot that could not be split stays as a single task.
    const pieces: PlanTask[] = parsed.length
      ? parsed.map((t, k) => ({
          ref: `${ref}.${k + 1}`,
          title: t.title,
          description: t.description ? `${t.description}\n\n(Lot : ${lot.title})` : `Lot : ${lot.title}`,
          assignee: t.assignee || lot.assignee,
          priority: lot.priority,
          complexity: t.complexity,
          sprint: lot.sprint,
          depends_on: (t.after ?? []).filter((n) => Number.isInteger(n) && n >= 1 && n <= k).map((n) => `${ref}.${n}`),
        }))
      : [{ ...lot, ref, depends_on: [] }];
    const needed = new Set(pieces.flatMap((p) => p.depends_on ?? []));
    firsts.set(ref, pieces.filter((p) => !p.depends_on?.length).map((p) => p.ref!));
    lasts.set(ref, pieces.filter((p) => !needed.has(p.ref!)).map((p) => p.ref!));
    subs.push(pieces);
    log += `**${lot.title}** → ${pieces.length} tâche(s)\n${pieces.map((p) => `- ${p.title}`).join("\n")}\n\n`;
    emit({ type: "text", callId, text: log });
  }
  // Carry each lot's dependencies onto its first sub-tasks.
  lots.forEach((lot, i) => {
    const deps = (lot.depends_on ?? []).flatMap((r) => lasts.get(String(r)) ?? []);
    for (const p of subs[i]) if (firsts.get(String(lot.ref ?? `T${i + 1}`))?.includes(p.ref!)) p.depends_on = [...(p.depends_on ?? []), ...deps];
  });
  emit({ type: "agent_end", callId, content: log });
  return subs.flat();
}

export async function planProject(opts: { project: Project; brief?: string; sprints: boolean; granularity?: Granularity; emit: Emit; signal: AbortSignal }) {
  const { project, emit, signal } = opts;
  const projectId = project.id;
  const team = teamRuntime(project.team);
  const planner = team.agents.get(team.spec.entry_ids[0] ?? "");
  if (!planner) throw new Error("Définis au moins un premier contact (★) dans l'équipe du projet");
  const coLeads = team.spec.entry_ids.slice(1).map((id) => team.agents.get(id)).filter((a): a is Agent => !!a);
  const members = team.spec.agent_ids.map((id) => team.agents.get(id)).filter((a): a is Agent => !!a);
  const workspace = await workspaceFor(project.name, project.path);
  const ctx = { workspace, projectId, team: members };
  const existing = list<Task>("tasks").filter((t) => t.project_id === projectId);
  const sprints = list<Sprint>("sprints").filter((s) => s.project_id === projectId);
  const tree = await fileTree(workspace);

  const input = `Planifie le projet « ${project.name} ».
${project.description ? `\nDescription : ${project.description}\n` : ""}${opts.brief ? `\nCadrage avec l'utilisateur (à respecter) :\n${opts.brief}\n` : ""}
Membres disponibles (utilise exactement ces noms pour "assignee") :
${members.map((m) => `- ${m.name} : ${m.role}`).join("\n")}

Tâches déjà présentes (ne les recrée pas) :
${existing.length ? existing.map((t) => `- [${t.status}] ${t.title}`).join("\n") : "(aucune)"}

Fichiers du projet :
${tree.length ? tree.join("\n") : "(dossier vide)"}

Découpe le travail restant en lots distincts et concrets, chacun confié à un seul membre${opts.granularity === "macro" ? "" : " (chaque lot sera ensuite découpé en tâches plus courtes)"}. Méthode :
1. Liste d'abord tous les livrables et fonctionnalités du périmètre, puis le travail de chaque membre concerné (conception, développement, données, tests, documentation…).
2. Crée un lot par unité de travail identifiée : ${LOTS}
3. Vérifie que chaque livrable du cadrage est couvert par au moins un lot.
Le nombre de lots découle uniquement du périmètre et de l'équipe : il n'y a pas de nombre attendu. Un petit script tient parfois en 2 lots, une application complète en demande souvent 8 à 15. Ne te limite pas à un nombre rond.
Dans le JSON ci-dessous, chaque lot est une entrée du tableau "tasks".
Pour chaque lot : une consigne autonome (objectif, livrables, fichiers attendus), le membre le plus adapté, une priorité, une complexité en points (1, 2, 3, 5, 8 ou 13) et ses dépendances.
${opts.sprints ? "Regroupe les lots en sprints cohérents (2 à 4 sprints, chacun avec un objectif), en respectant les dépendances." : "Ne crée pas de sprint."}

Réponds par une courte explication de ton découpage, puis termine OBLIGATOIREMENT par un bloc JSON de cette forme :
\`\`\`json
{"sprints": [{"ref": "S1", "name": "Sprint 1", "goal": "…"}],
 "tasks": [{"ref": "T1", "title": "…", "description": "…", "assignee": "Nom du membre", "priority": "high|normal|low", "complexity": 3, "depends_on": [], "sprint": "S1"},
           {"ref": "T2", "title": "…", "description": "…", "assignee": "…", "priority": "normal", "complexity": 2, "depends_on": ["T1"], "sprint": "S1"}
          ]}
\`\`\`
(Le tableau "tasks" contient autant d'objets que nécessaire : les deux ci-dessus ne sont qu'un exemple de format.)`;

  // Keep every agent's final answer: the lead sometimes only summarises the plan a co-lead wrote.
  const answers: string[] = [];
  const answer = await runAgent({
    agent: planner,
    input,
    team,
    phase: "free",
    consultOnly: true, // plans only: no delegation, the co-leads are consulted automatically
    excludeTools: ["board_add_card", "board_update_card", "write_file", "edit_file", "run_command", "http_request", "record_decision"],
    emit: (ev) => {
      if (ev.type === "agent_end") answers.push(ev.content);
      emit(ev);
    },
    signal,
    ctx,
  });
  const plan = [answer, ...answers.reverse()].map(tryParsePlan).find((p) => p?.tasks?.length);
  if (!plan) throw new Error("Le plan n'a pas pu être lu (JSON attendu). Relance la planification.");
  const granularity = opts.granularity ?? "standard";
  if (granularity !== "macro" && plan.tasks?.length)
    plan.tasks = await refineLots({ lots: plan.tasks.filter((t) => t.title), granularity, project, members, model: planner.model, emit, signal });

  // Sprints first, so tasks can reference them.
  const sprintIds = new Map<string, string>();
  if (opts.sprints)
    (plan.sprints ?? []).forEach((s, i) => {
      const created = upsert<Sprint>("sprints", {
        project_id: projectId,
        name: String(s.name || `Sprint ${sprints.length + i + 1}`).slice(0, 80),
        goal: String(s.goal ?? "").slice(0, 500),
        status: "planned",
      });
      sprintIds.set(String(s.ref ?? s.name ?? i), created.id);
      if (s.name) sprintIds.set(String(s.name), created.id);
    });

  const byName = new Map(members.map((m) => [slugify(m.name), m.id]));
  const refToId = new Map<string, string>();
  const created: Task[] = [];
  const credit = coLeads.length ? `${planner.name} (avec ${coLeads.map((c) => c.name).join(", ")})` : planner.name;
  for (const [i, t] of (plan.tasks ?? []).entries()) {
    if (!t.title) continue;
    const task = upsert<Task>("tasks", {
      project_id: projectId,
      title: String(t.title).slice(0, 200),
      description: String(t.description ?? ""),
      status: "todo",
      priority: ["low", "normal", "high"].includes(String(t.priority)) ? t.priority : "normal",
      complexity: toPoints(t.complexity),
      assignee_id: byName.get(slugify(String(t.assignee ?? ""))) ?? "",
      sprint_id: sprintIds.get(String(t.sprint ?? "")) ?? "",
      created_by: planner.id,
      notes: [{ at: now(), by: planner.name, text: `🗂️ Planifiée par ${credit}.` }],
      depends_on: [],
    });
    refToId.set(String(t.ref ?? `T${i + 1}`), task.id);
    created.push(task);
  }
  // Dependencies once every task has an id (references to unknown refs are dropped).
  for (const [i, t] of (plan.tasks ?? []).filter((x) => x.title).entries()) {
    const deps = (t.depends_on ?? []).map((r) => refToId.get(String(r))).filter((x): x is string => !!x && x !== created[i].id);
    if (deps.length) upsert("tasks", { id: created[i].id, depends_on: deps });
  }

  const sprintCount = new Set(sprintIds.values()).size;
  await appendDecision(
    workspace,
    `Planification : ${created.length} tâche(s)${sprintCount ? `, ${sprintCount} sprint(s)` : ""}`,
    created.map((t) => `- ${t.title}`).join("\n"),
    credit,
  ).catch(() => {});
  return { tasks: created, sprints: sprintCount, credit, planner };
}

export function startPlanRun(projectId: string, opts: { brief?: string; sprints: boolean; granularity?: Granularity }): Run {
  const project = get<Project>("projects", projectId);
  if (!project) throw new Error("Projet introuvable");
  if (activeRunFor(planKey(projectId))) throw new Error("Une planification est déjà en cours");
  if (!teamRuntime(project.team).spec.entry_ids.length) throw new Error("Définis au moins un premier contact (★) dans l'équipe du projet");
  return startRun(
    { id: newId(), conversationId: planKey(projectId), targetType: "task", targetId: projectId, title: "Planification du projet", userMessage: opts.brief ?? "" },
    async (emit, signal) => {
      try {
        await planProject({ project, brief: opts.brief, sprints: opts.sprints, granularity: opts.granularity, emit, signal });
      } catch (e) {
        emit({ type: "error", message: signal.aborted ? "Planification arrêtée" : e instanceof Error ? e.message : String(e) });
      }
      emit({ type: "done", messageId: "" });
    },
  );
}
