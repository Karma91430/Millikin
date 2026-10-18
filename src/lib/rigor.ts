// How much process a project gets (client + server safe). It drives the planning (number and kind of
// tasks) and the control of each task, so a small project does not pay for an enterprise method.

export const RIGORS = [
  {
    id: "prototype",
    label: "Prototype",
    description: "Le minimum qui marche : peu de tâches, orientées livrables, contrôle automatique sur les faits.",
  },
  {
    id: "standard",
    label: "Standard",
    description: "Un vrai projet sans cérémonie : des lots fonctionnels, relecture par un agent sur les grosses tâches (5 points et plus).",
  },
  {
    id: "entreprise",
    label: "Entreprise",
    description: "Méthode complète : décisions d'architecture, user stories, recette, relecture de chaque tâche par un agent.",
  },
] as const;

export type Rigor = (typeof RIGORS)[number]["id"];
export const rigorOf = (p: { rigor?: string }): Rigor => (RIGORS.some((r) => r.id === p.rigor) ? (p.rigor as Rigor) : "standard");

/** Planning instructions for each level. */
export const PLANNING_RIGOR: Record<Rigor, string> = {
  prototype: `Niveau de rigueur : PROTOTYPE. Vise le plus petit ensemble de lots qui donne un résultat qui fonctionne.
- Chaque lot produit un livrable utilisable (du code qui tourne, avec ses tests essentiels), jamais un document de process.
- Pas de lot dédié à une décision d'architecture, à des user stories, à une maquette, à un cahier de recette, à une relecture ou à une validation : chaque tâche est déjà contrôlée automatiquement.
- La documentation se limite au README, écrit dans le lot qui livre l'application.
- En général 3 à 8 lots suffisent.`,
  standard: `Niveau de rigueur : STANDARD.
- Pas de lot dont le seul objet est de relire ou de valider le travail d'un autre membre : chaque tâche est déjà contrôlée.
- Documentation utile seulement : README, et une décision d'architecture uniquement pour un choix structurant.
- Pas de cahier de recette ni de user stories séparés, sauf si le cadrage les demande.`,
  entreprise: `Niveau de rigueur : ENTREPRISE. Méthode complète : décisions d'architecture (ADR), user stories, maquette, recette et relectures croisées quand elles sont utiles.`,
};

/**
 * Who controls a finished task: "auto" = Millikin checks the facts (files written, syntax, commands and
 * tests), "agent" = a first contact reviews it. Standard keeps agent reviews for the big tasks (5 points and
 * more, or not estimated); Entreprise reviews every task.
 */
export const reviewMode = (rigor: Rigor, complexity: number): "auto" | "agent" =>
  rigor === "entreprise" ? "agent" : rigor === "standard" && (complexity >= 5 || complexity <= 0) ? "agent" : "auto";

/** Default task size when planning: lots kept whole, except with the full method. */
export const defaultGranularity = (rigor: Rigor): "macro" | "standard" => (rigor === "entreprise" ? "standard" : "macro");
