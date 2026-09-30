// Project planning: the lead first contact (with the other first contacts) breaks the project into
// sprints and tasks with assignee, complexity, priority and dependencies; Millikin creates them.
import fs from "node:fs/promises";
import path from "node:path";
import { appendDecision } from "./decisions";
import { get, list, newId, now, upsert, type Agent, type Project, type Sprint, type Task } from "./db";
import { runAgent, slugify, teamRuntime } from "./orchestrator";
import { activeRunFor, startRun, type Run } from "./runs";
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

/** Take the last JSON object of the answer (models sometimes wrap it in prose or code fences). */
export function parsePlan(text: string): Plan {
  const fenced = [...text.matchAll(/```(?:json)?\s*([\s\S]*?)```/g)].map((m) => m[1]).filter((b) => b.includes("{"));
  const candidates = [...fenced.reverse(), text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1)];
  for (const c of candidates) {
    try {
      const j = JSON.parse(c.trim()) as Plan;
      if (Array.isArray(j.tasks)) return j;
    } catch {}
  }
  throw new Error("Le plan n'a pas pu être lu (JSON attendu). Relance la planification.");
}

const planKey = (projectId: string) => `plan:${projectId}`;

export function startPlanRun(projectId: string, opts: { brief?: string; sprints: boolean }): Run {
  const project = get<Project>("projects", projectId);
  if (!project) throw new Error("Projet introuvable");
  if (activeRunFor(planKey(projectId))) throw new Error("Une planification est déjà en cours");
  const team = teamRuntime(project.team);
  const planner = team.agents.get(team.spec.entry_ids[0] ?? "");
  if (!planner) throw new Error("Définis au moins un premier contact (★) dans l'équipe du projet");
  const coLeads = team.spec.entry_ids.slice(1).map((id) => team.agents.get(id)).filter((a): a is Agent => !!a);
  const members = team.spec.agent_ids.map((id) => team.agents.get(id)).filter((a): a is Agent => !!a);

  return startRun(
    { id: newId(), conversationId: planKey(projectId), targetType: "task", targetId: projectId, title: "Planification du projet", userMessage: opts.brief ?? "" },
    async (emit, signal) => {
      const workspace = await workspaceFor(project.name, project.path);
      const ctx = { workspace, projectId, team: members };
      const existing = list<Task>("tasks").filter((t) => t.project_id === projectId);
      const sprints = list<Sprint>("sprints").filter((s) => s.project_id === projectId);
      const tree = await fileTree(workspace);

      const input = `Planifie le projet « ${project.name} ».
${project.description ? `\nDescription : ${project.description}\n` : ""}${opts.brief ? `\nConsigne de l'utilisateur : ${opts.brief}\n` : ""}
Membres disponibles (utilise exactement ces noms pour "assignee") :
${members.map((m) => `- ${m.name} : ${m.role}`).join("\n")}

Tâches déjà présentes (ne les recrée pas) :
${existing.length ? existing.map((t) => `- [${t.status}] ${t.title}`).join("\n") : "(aucune)"}

Fichiers du projet :
${tree.length ? tree.join("\n") : "(dossier vide)"}

Découpe le travail restant en tâches distinctes, concrètes et réalisables par un seul membre (une demi-journée de travail au plus chacune).
Pour chaque tâche : une consigne autonome (objectif, livrables, fichiers attendus), le membre le plus adapté, une priorité, une complexité en points (1, 2, 3, 5, 8 ou 13) et ses dépendances.
${opts.sprints ? "Regroupe les tâches en sprints cohérents (2 à 4 sprints, chacun avec un objectif), en respectant les dépendances." : "Ne crée pas de sprint."}

Réponds par une courte explication de ton découpage, puis termine OBLIGATOIREMENT par un bloc JSON de cette forme :
\`\`\`json
{"sprints": [{"ref": "S1", "name": "Sprint 1", "goal": "…"}],
 "tasks": [{"ref": "T1", "title": "…", "description": "…", "assignee": "Nom du membre", "priority": "high|normal|low", "complexity": 3, "depends_on": ["T0"], "sprint": "S1"}]}
\`\`\``;

      try {
        const answer = await runAgent({
          agent: planner,
          input,
          team,
          phase: "free",
          consultOnly: true, // plans only: no delegation, the co-leads are consulted automatically
          excludeTools: ["board_add_card", "board_update_card", "write_file", "edit_file", "run_command", "record_decision"],
          emit,
          signal,
          ctx,
        });
        const plan = parsePlan(answer);

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

        await appendDecision(
          workspace,
          `Planification : ${created.length} tâche(s)${sprintIds.size ? `, ${new Set(sprintIds.values()).size} sprint(s)` : ""}`,
          created.map((t) => `- ${t.title}`).join("\n"),
          credit,
        ).catch(() => {});
      } catch (e) {
        emit({ type: "error", message: signal.aborted ? "Planification arrêtée" : e instanceof Error ? e.message : String(e) });
      }
      emit({ type: "done", messageId: "" });
    },
  );
}
