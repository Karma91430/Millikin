// Built-in agent tools. Each id in agent.tools enables one group; file and command tools are
// confined to the team's workspace directory.
import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { getSettings, list, newId, now, upsert, type Agent, type Task } from "./db";
import type { ToolDef } from "./gateway";
import { fetchUrl, httpRequest, webSearch } from "./webtools";

export type ToolContext = { agent: Agent; workspace: string; projectId: string; team: Agent[] };
export type ToolImpl = (args: Record<string, unknown>) => Promise<string>;
type Group = { id: string; label: string; description: string; danger?: boolean; defs: (ctx: ToolContext) => [ToolDef, ToolImpl][] };

const fn = (name: string, description: string, properties: Record<string, unknown>, required: string[] = []): ToolDef => ({
  type: "function",
  function: { name, description, parameters: { type: "object", properties, required } },
});
const str = (description: string) => ({ type: "string", description });

// ---------- workspace ----------
const IGNORED = new Set(["node_modules", ".git", ".next", "dist", "build", ".venv", "venv", "__pycache__", ".DS_Store"]);

/** Resolve a path inside the workspace; rejects anything (including symlinks) that escapes it. */
async function inside(root: string, rel: string): Promise<string> {
  const abs = path.resolve(root, rel || ".");
  const ok = (p: string) => p === root || p.startsWith(root + path.sep);
  if (!ok(abs)) throw new Error(`Chemin hors du dossier de travail : ${rel}`);
  // Walk up to the nearest existing ancestor and check its real path.
  let probe = abs;
  for (;;) {
    try {
      const real = await fs.realpath(probe);
      if (!ok(real)) throw new Error(`Chemin hors du dossier de travail : ${rel}`);
      return abs;
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
      probe = path.dirname(probe);
    }
  }
}

async function tree(root: string, dir: string, depth: number, out: string[], limit = 300) {
  if (out.length >= limit) return;
  const entries = await fs.readdir(dir, { withFileTypes: true }).catch(() => []);
  entries.sort((a, b) => Number(b.isDirectory()) - Number(a.isDirectory()) || a.name.localeCompare(b.name));
  for (const e of entries) {
    if (IGNORED.has(e.name) || out.length >= limit) continue;
    const rel = path.relative(root, path.join(dir, e.name));
    out.push(e.isDirectory() ? `${rel}/` : rel);
    if (e.isDirectory() && depth > 1) await tree(root, path.join(dir, e.name), depth - 1, out, limit);
  }
}

function runCommand(cmd: string, cwd: string): Promise<string> {
  const timeout = (Number(getSettings().command_timeout) || 60) * 1000;
  return new Promise((resolve) => {
    execFile("/bin/zsh", ["-lc", cmd], { cwd, timeout, maxBuffer: 4 * 1024 * 1024, env: { ...process.env, CI: "1" } }, (err, stdout, stderr) => {
      const code = err ? ((err as NodeJS.ErrnoException & { code?: number }).code ?? 1) : 0;
      const killed = err && (err as { killed?: boolean }).killed ? " (délai dépassé, processus arrêté)" : "";
      const tail = (s: string) => (s.length > 5000 ? "…\n" + s.slice(-5000) : s);
      resolve(`$ ${cmd}\ncode de sortie : ${code}${killed}\n${stdout ? `--- stdout ---\n${tail(stdout)}\n` : ""}${stderr ? `--- stderr ---\n${tail(stderr)}` : ""}`.trim());
    });
  });
}

// ---------- tasks ----------
const byName = (team: Agent[], name: unknown) => {
  const n = String(name ?? "").toLowerCase().trim();
  if (!n) return undefined;
  const norm = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
  return team.find((a) => norm(a.name) === norm(n) || a.id === n) ?? team.find((a) => norm(a.name).includes(norm(n)));
};
const fmtTask = (t: Task, team: Agent[]) => {
  const who = team.find((a) => a.id === t.assignee_id);
  const deps = t.depends_on?.length ? ` (dépend de ${t.depends_on.map((d) => `#${d}`).join(", ")})` : "";
  return `#${t.id} [${t.status}] ${t.title}${who ? ` → ${who.name}` : ""}${t.priority !== "normal" ? ` (priorité ${t.priority})` : ""}${deps}`;
};

const POINTS = [1, 2, 3, 5, 8, 13];
/** Snap an estimate to the nearest story-point value (0 = not estimated). */
export const toPoints = (v: unknown) => {
  const n = Number(v);
  return n > 0 ? POINTS.reduce((best, p) => (Math.abs(p - n) < Math.abs(best - n) ? p : best), 1) : 0;
};

/** Resolve card references given by a model: ids (with or without #) or titles. */
function resolveCards(refs: unknown, projectId: string): string[] {
  const list0 = Array.isArray(refs) ? refs : typeof refs === "string" ? refs.split(",") : [];
  const mine = list<Task>("tasks").filter((x) => x.project_id === projectId);
  const norm = (x: string) => x.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();
  return [
    ...new Set(
      list0
        .map((r) => String(r).replace(/^#/, "").trim())
        .map((r) => mine.find((x) => x.id === r)?.id ?? mine.find((x) => norm(x.title) === norm(r))?.id ?? mine.find((x) => norm(x.title).includes(norm(r)) && r.length > 3)?.id)
        .filter((x): x is string => !!x),
    ),
  ];
}
const STATUSES = ["todo", "doing", "review", "done"];

export const TOOL_GROUPS: Group[] = [
  {
    id: "web_search",
    label: "Recherche web",
    description: "SearXNG local, avec secours DuckDuckGo",
    defs: () => [
      [
        fn("web_search", "Rechercher sur le web (documentation, actualité, solutions). Renvoie titres, URL et extraits ; lis ensuite les pages utiles avec fetch_url.", { query: str("requête précise, mots-clés") }, ["query"]),
        (a) => webSearch(String(a.query ?? "")),
      ],
    ],
  },
  {
    id: "fetch_url",
    label: "Lecture d'URL",
    description: "Texte d'une page web, JSON, texte brut ou PDF",
    defs: () => [[fn("fetch_url", "Lire le contenu d'une URL : page web (texte extrait), JSON, texte brut ou PDF.", { url: str("URL http(s)") }, ["url"]), (a) => fetchUrl(String(a.url ?? ""))]],
  },
  {
    id: "http_request",
    label: "Appels d'API (HTTP)",
    description: "GET/POST/PUT/PATCH/DELETE vers une API, y compris locale",
    danger: true,
    defs: () => [
      [
        fn(
          "http_request",
          "Appeler une API HTTP (tester un endpoint, récupérer des données). Renvoie le statut, les en-têtes utiles et le corps.",
          {
            method: { type: "string", enum: ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD"], description: "GET par défaut" },
            url: str("URL complète, ex : http://127.0.0.1:8000/todos"),
            headers: { type: "object", description: "en-têtes HTTP (optionnel)" },
            body: { description: "corps de la requête : objet JSON ou texte (optionnel)" },
          },
          ["url"],
        ),
        (a) => httpRequest(a),
      ],
    ],
  },
  {
    id: "files_read",
    label: "Lire les fichiers",
    description: "Lister et lire les fichiers du dossier de travail",
    defs: (ctx) => [
      [
        fn("list_files", "Lister les fichiers du dossier de travail (arborescence).", { path: str("sous-dossier, '.' par défaut"), depth: { type: "number", description: "profondeur, 3 par défaut" } }),
        async (a) => {
          const dir = await inside(ctx.workspace, String(a.path ?? "."));
          const out: string[] = [];
          await tree(ctx.workspace, dir, Math.min(6, Number(a.depth) || 3), out);
          return out.length ? out.join("\n") : "(dossier vide)";
        },
      ],
      [
        fn("read_file", "Lire un fichier texte du dossier de travail.", { path: str("chemin relatif") }, ["path"]),
        async (a) => {
          const p = await inside(ctx.workspace, String(a.path ?? ""));
          const text = await fs.readFile(p, "utf8");
          return text.length > 20000 ? text.slice(0, 20000) + `\n… (tronqué, ${text.length} caractères)` : text;
        },
      ],
    ],
  },
  {
    id: "files_write",
    label: "Écrire des fichiers",
    description: "Créer et modifier des fichiers dans le dossier de travail",
    defs: (ctx) => [
      [
        fn("write_file", "Créer ou remplacer entièrement un fichier (dossiers créés au besoin).", { path: str("chemin relatif"), content: str("contenu complet") }, ["path", "content"]),
        async (a) => {
          const p = await inside(ctx.workspace, String(a.path ?? ""));
          await fs.mkdir(path.dirname(p), { recursive: true });
          const content = String(a.content ?? "");
          await fs.writeFile(p, content, "utf8");
          return `Fichier écrit : ${path.relative(ctx.workspace, p)} (${content.split("\n").length} lignes)`;
        },
      ],
      [
        fn(
          "edit_file",
          "Remplacer un passage exact dans un fichier existant.",
          { path: str("chemin relatif"), old_text: str("texte exact à remplacer (unique dans le fichier)"), new_text: str("nouveau texte") },
          ["path", "old_text", "new_text"],
        ),
        async (a) => {
          const p = await inside(ctx.workspace, String(a.path ?? ""));
          const text = await fs.readFile(p, "utf8");
          const oldText = String(a.old_text ?? "");
          const n = oldText ? text.split(oldText).length - 1 : 0;
          if (n !== 1) return `Échec : le passage apparaît ${n} fois (il doit être unique). Relis le fichier avec read_file.`;
          await fs.writeFile(p, text.replace(oldText, String(a.new_text ?? "")), "utf8");
          return `Fichier modifié : ${path.relative(ctx.workspace, p)}`;
        },
      ],
    ],
  },
  {
    id: "run_command",
    label: "Exécuter des commandes",
    description: "Shell dans le dossier de travail (tests, build, git…)",
    danger: true,
    defs: (ctx) => [
      [
        fn(
          "run_command",
          "Exécuter une commande shell dans le dossier du projet (tests, build, git, scripts…). Pas de commande interactive ni de serveur qui tourne sans fin.",
          { command: str("commande shell"), cwd: str("sous-dossier du projet où l'exécuter (optionnel)") },
          ["command"],
        ),
        async (a) => runCommand(String(a.command ?? ""), a.cwd ? await inside(ctx.workspace, String(a.cwd)) : ctx.workspace),
      ],
    ],
  },
  {
    id: "tasks",
    label: "Gestion de tâches",
    description: "Tableau Kanban partagé par l'équipe",
    defs: (ctx) => [
      [
        fn("board_list", "Lire les cartes du tableau Kanban de suivi du projet.", { status: { type: "string", enum: STATUSES, description: "filtre optionnel" } }),
        async (a) => {
          const rows = list<Task>("tasks").filter((t) => t.project_id === ctx.projectId && (!a.status || t.status === a.status));
          return rows.length ? rows.map((t) => fmtTask(t, ctx.team)).join("\n") : "Aucune tâche.";
        },
      ],
      [
        fn(
          "board_add_card",
          "Ajouter une carte de SUIVI au tableau Kanban. Ne déclenche aucun travail : pour faire travailler un membre, utilise ask_agent.",
          {
            title: str("titre court"),
            description: str("détails, critères d'acceptation"),
            owner: str(`responsable affiché sur la carte (${ctx.team.map((m) => m.name).join(", ")})`),
            priority: { type: "string", enum: ["low", "normal", "high"] },
            depends_on: { type: "array", items: { type: "string" }, description: "cartes à terminer avant celle-ci (identifiants ou titres)" },
            complexity: { type: "number", description: "complexité en points : 1, 2, 3, 5, 8 ou 13" },
          },
          ["title"],
        ),
        async (a) => {
          const t = upsert<Task>("tasks", {
            project_id: ctx.projectId,
            title: String(a.title ?? "").slice(0, 200),
            description: String(a.description ?? ""),
            status: "todo",
            priority: ["low", "normal", "high"].includes(String(a.priority)) ? a.priority : "normal",
            assignee_id: byName(ctx.team, a.owner ?? a.assignee)?.id ?? "",
            created_by: ctx.agent.id,
            notes: [],
            depends_on: resolveCards(a.depends_on, ctx.projectId),
            complexity: toPoints(a.complexity),
          });
          return `Tâche créée : ${fmtTask(t, ctx.team)}`;
        },
      ],
      [
        fn(
          "board_update_card",
          "Mettre à jour une carte du tableau Kanban : statut, responsable ou note de suivi.",
          { id: str("identifiant de la carte (sans #) ou son titre"), status: { type: "string", enum: STATUSES }, owner: str("responsable"), note: str("note de suivi") },
          ["id"],
        ),
        async (a) => {
          // Accept an id, or fall back to a unique title match (models often pass a name instead).
          const key = String(a.id ?? "").replace(/^#/, "").trim();
          const norm = (x: string) => x.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
          const mine = list<Task>("tasks").filter((x) => x.project_id === ctx.projectId);
          const byTitle = mine.filter((x) => key && norm(x.title).includes(norm(key)));
          const t = mine.find((x) => x.id === key) ?? (byTitle.length === 1 ? byTitle[0] : undefined);
          if (!t)
            return `Tâche introuvable : « ${a.id} ». ${byTitle.length > 1 ? "Plusieurs cartes correspondent, précise l'identifiant." : "Utilise board_list pour voir les identifiants."}`;
          const patch: Record<string, unknown> = { id: t.id };
          if (a.status && STATUSES.includes(String(a.status))) patch.status = a.status;
          const owner = a.owner ?? a.assignee;
          if (owner) patch.assignee_id = byName(ctx.team, owner)?.id ?? t.assignee_id;
          if (a.note) patch.notes = [...(t.notes ?? []), { at: now(), by: ctx.agent.name, text: String(a.note) }];
          return `Tâche mise à jour : ${fmtTask(upsert<Task>("tasks", patch), ctx.team)}`;
        },
      ],
    ],
  },
];

export const BUILTIN_TOOLS = TOOL_GROUPS.map(({ id, label, description, danger }) => ({ id, label, description, danger: !!danger }));

export function buildTools(ctx: ToolContext): [ToolDef, ToolImpl][] {
  return TOOL_GROUPS.filter((g) => ctx.agent.tools?.includes(g.id)).flatMap((g) => g.defs(ctx));
}

/** Workspace folder (a project's path, or a default one by name), created on first use. */
export async function workspaceFor(name: string | null, override?: string): Promise<string> {
  const root = override?.trim() || path.join(getSettings().workspace_dir, name ? slug(name) : "solo");
  await fs.mkdir(root, { recursive: true });
  return fs.realpath(root);
}
export const slug = (s: string) =>
  s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || newId();

