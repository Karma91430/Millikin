// Optional project modules (client + server safe). Overview and team are always there; a project
// with no module list (created before modules existed) shows everything.

export const PROJECT_MODULES = [
  { id: "board", label: "Tableau des tâches", description: "Kanban, lancement des tâches par les agents, contrôle et relances" },
  { id: "sprints", label: "Sprints et planification", description: "Découpage en sprints, points de complexité, planification par l'équipe" },
  { id: "files", label: "Fichiers", description: "Explorateur du dossier du projet et des livrables" },
  { id: "knowledge", label: "Connaissances et MCP", description: "Bases RAG et serveurs MCP connectés au projet, accès par agent" },
  { id: "decisions", label: "Journal des décisions", description: "Décisions techniques et validations consignées dans docs/DECISIONS.md" },
  { id: "stats", label: "Statistiques", description: "Usage des modèles, vélocité, qualité des livraisons" },
] as const;

export type ModuleId = (typeof PROJECT_MODULES)[number]["id"];
export const ALL_MODULES = PROJECT_MODULES.map((m) => m.id) as ModuleId[];

export const hasModule = (p: { modules?: string[] }, id: ModuleId) => !p.modules?.length || p.modules.includes(id);
