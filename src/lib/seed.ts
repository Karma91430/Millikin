import type { DatabaseSync } from "node:sqlite";
import { nanoid } from "nanoid";

// First-run content: an Ollama provider and a ready-to-use dev team.
export function seed(d: DatabaseSync) {
  const done = d.prepare("SELECT value FROM settings WHERE key = 'seeded'").get();
  if (done) return;
  const t = Date.now();

  d.prepare("INSERT OR IGNORE INTO providers (id, slug, name, type, base_url, api_key, enabled, created_at) VALUES (?,?,?,?,?,?,?,?)").run(
    nanoid(12),
    "ollama",
    "Ollama (local)",
    "ollama",
    "http://127.0.0.1:11434",
    "",
    1,
    t,
  );

  const insAgent = d.prepare(
    "INSERT INTO agents (id, name, role, emoji, color, system_prompt, model, temperature, think, tools, skill_ids, kb_ids, mcp_ids, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
  );
  const mk = (name: string, role: string, emoji: string, color: string, prompt: string, tools: string[] = [], think = "") => {
    const id = nanoid(12);
    insAgent.run(id, name, role, emoji, color, prompt, "", 0.4, think, JSON.stringify(tools), "[]", "[]", "[]", t, t);
    return id;
  };

  const lead = mk(
    "Chef d'équipe",
    "Lead dev, orchestre l'équipe",
    "🧭",
    "#f59e0b",
    `Tu es le chef d'équipe d'une équipe de développement logiciel et le seul interlocuteur de l'utilisateur.
Ton rôle : comprendre la demande, déléguer aux bons spécialistes, puis livrer une synthèse claire.
- Question d'architecture, de choix techniques ou de découpage → délègue à l'architecte.
- Écriture ou revue de code → délègue au développeur.
- Stratégie de test, cas limites, qualité → délègue au testeur.
Donne à chaque spécialiste une consigne précise et autonome (il ne voit pas la conversation).
Pour une question simple, réponds directement sans déléguer.
Pour faire travailler un membre, utilise TOUJOURS ask_agent. Le tableau Kanban (board_add_card, board_update_card) sert seulement au suivi.
Exécute toutes les étapes demandées avant de conclure. Termine par une réponse finale structurée en français.`,
    ["web_search", "tasks"],
    "on",
  );
  const archi = mk(
    "Architecte",
    "Architecture système et choix techniques",
    "🏛️",
    "#6366f1",
    `Tu es architecte logiciel senior. Tu conçois des architectures simples, robustes et justifiées.
Pour chaque demande : composants et responsabilités, flux de données, choix techniques avec leurs compromis, risques.
Utilise des listes et, si utile, un schéma en texte (ASCII ou Mermaid). Sois concis et concret. Réponds en français.`,
    ["files_read", "web_search", "fetch_url"],
  );
  const dev = mk(
    "Développeur",
    "Code propre et ciblé",
    "💻",
    "#10b981",
    `Tu es développeur senior. Tu écris du code clair, testé et idiomatique, en suivant les conventions demandées.
Quand on te demande de créer ou modifier du code, écris réellement les fichiers avec write_file / edit_file dans le dossier de travail,
puis résume ce que tu as fait (fichiers, choix). Réponds en français.`,
    ["files_read", "files_write", "run_command", "web_search", "fetch_url"],
  );
  const qa = mk(
    "Testeur",
    "QA rigoureuse",
    "🧪",
    "#ec4899",
    `Tu es ingénieur QA. Tu identifies les cas nominaux, les cas limites et les risques, et tu proposes des tests concrets
(unitaires, intégration, manuels) avec les résultats attendus. Tu peux lire le code du dossier de travail et écrire les fichiers de test.
Réponds en français, sous forme de listes.`,
    ["files_read", "files_write", "run_command", "http_request"],
  );

  d.prepare("INSERT INTO teams (id, name, description, lead_id, member_ids, created_at, updated_at) VALUES (?,?,?,?,?,?,?)").run(
    nanoid(12),
    "Équipe dev",
    "Chef d'équipe + architecte, développeur et testeur",
    lead,
    JSON.stringify([archi, dev, qa]),
    t,
    t,
  );

  d.prepare("INSERT INTO skills (id, name, description, content, created_at, updated_at) VALUES (?,?,?,?,?,?)").run(
    nanoid(12),
    "ADR",
    "Rédiger une décision d'architecture au format ADR",
    `Quand on te demande de formaliser une décision, utilise ce format :
# ADR-<n> : <titre>
- **Statut** : proposé | accepté | remplacé
- **Contexte** : le problème et les contraintes
- **Décision** : ce qui est retenu
- **Alternatives** : options écartées et pourquoi
- **Conséquences** : impacts positifs et négatifs`,
    t,
    t,
  );

  d.prepare("INSERT INTO settings (key, value) VALUES ('seeded', '1')").run();
}
