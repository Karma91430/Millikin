import { complete } from "./gateway";

const PALETTE = ["#6366f1", "#10b981", "#f59e0b", "#ec4899", "#06b6d4", "#8b5cf6", "#ef4444", "#84cc16", "#f97316", "#14b8a6"];

function parseJson<T>(raw: string): T {
  const cleaned = raw.replace(/```(?:json)?/g, "").trim();
  try {
    return JSON.parse(cleaned);
  } catch {
    const m = cleaned.match(/\{[\s\S]*\}/);
    if (!m) throw new Error("Le modèle n'a pas renvoyé de JSON exploitable");
    return JSON.parse(m[0]);
  }
}

export type AgentDraft = { name: string; role: string; emoji: string; color: string; system_prompt: string; tools: string[]; think?: "" | "on" | "off" };

const AGENT_SHAPE = `{
  "name": "nom court de l'agent (ex: Architecte)",
  "role": "rôle en une ligne",
  "emoji": "un seul emoji représentatif",
  "system_prompt": "prompt système détaillé à la 2e personne (Tu es…) : mission, méthode de travail, format de réponse attendu, limites. 6 à 12 lignes, en français.",
  "tools": ["web_search" et/ou "fetch_url" seulement si l'agent a vraiment besoin d'internet, sinon []]
}`;

/** A missing name is derived from the role ("Optimise le contenu SEO" → "Optimise le contenu"). */
function fallbackName(role: string | undefined, i: number) {
  const words = String(role ?? "")
    .replace(/[^\p{L}\p{N}' -]/gu, " ")
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 3);
  return words.length ? words.join(" ").replace(/^./, (c) => c.toUpperCase()) : `Spécialiste ${i + 1}`;
}

function normalizeAgent(a: Partial<AgentDraft>, i: number): AgentDraft {
  return {
    name: String(a.name || fallbackName(a.role, i)).slice(0, 60),
    role: String(a.role || "").slice(0, 200),
    emoji: String(a.emoji || "🤖").slice(0, 4),
    color: /^#[0-9a-f]{6}$/i.test(String(a.color)) ? String(a.color) : PALETTE[i % PALETTE.length],
    system_prompt: String(a.system_prompt || ""),
    tools: Array.isArray(a.tools) ? a.tools.filter((t) => t === "web_search" || t === "fetch_url") : [],
  };
}

export async function generateAgent(description: string, model?: string): Promise<AgentDraft> {
  const raw = await complete({
    ref: model,
    json: true,
    temperature: 0.6,
    messages: [
      { role: "system", content: `Tu conçois des profils d'agents IA. Réponds UNIQUEMENT avec un objet JSON de cette forme :\n${AGENT_SHAPE}` },
      { role: "user", content: `Crée le profil de cet agent : ${description}` },
    ],
  });
  return normalizeAgent(parseJson<Partial<AgentDraft>>(raw), Math.floor(Math.random() * PALETTE.length));
}

export type TeamDraft = { name: string; description: string; lead: AgentDraft; members: AgentDraft[] };

export async function generateTeam(description: string, size = 3, model?: string): Promise<TeamDraft> {
  const raw = await complete({
    ref: model,
    json: true,
    temperature: 0.6,
    messages: [
      {
        role: "system",
        content: `Tu conçois des équipes d'agents IA : un chef d'équipe qui orchestre et délègue, et des spécialistes complémentaires.
Réponds UNIQUEMENT avec un objet JSON :
{
  "name": "nom de l'équipe",
  "description": "une phrase",
  "lead": ${AGENT_SHAPE},
  "members": [ ${size} objets de la même forme, un par spécialiste ]
}
Le prompt du chef doit expliquer quand déléguer à quel spécialiste (en les nommant) et qu'il rédige la synthèse finale.`,
      },
      { role: "user", content: `Équipe à créer : ${description}` },
    ],
  });
  const j = parseJson<{ name?: string; description?: string; lead?: Partial<AgentDraft>; members?: Partial<AgentDraft>[] }>(raw);
  if (!j.lead || !Array.isArray(j.members) || !j.members.length) throw new Error("Équipe incomplète renvoyée par le modèle, réessaie");
  return {
    name: String(j.name || "Nouvelle équipe"),
    description: String(j.description || description),
    // Orchestration decisions are where small models slip: the lead thinks before acting.
    lead: { ...normalizeAgent(j.lead, 2), think: "on" },
    members: j.members.slice(0, 8).map((m, i) => normalizeAgent(m, i + 3)),
  };
}

export async function generateSkill(description: string, model?: string) {
  const raw = await complete({
    ref: model,
    json: true,
    temperature: 0.5,
    messages: [
      {
        role: "system",
        content: `Tu rédiges des "skills" pour agents IA : des instructions réutilisables qui décrivent une méthode ou un format.
Réponds UNIQUEMENT en JSON : {"name": "nom court", "description": "quand utiliser ce skill, une phrase", "content": "instructions détaillées en Markdown : étapes, règles, format de sortie, exemple"}`,
      },
      { role: "user", content: description },
    ],
  });
  const j = parseJson<{ name?: string; description?: string; content?: string }>(raw);
  return { name: String(j.name || "Nouveau skill"), description: String(j.description || ""), content: String(j.content || "") };
}
