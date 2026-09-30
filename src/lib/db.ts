import { DatabaseSync } from "node:sqlite";
import fs from "node:fs";
import path from "node:path";
import { nanoid } from "nanoid";
import { seed } from "./seed";
import { specFromTeam, type TeamSpec } from "./team";

const DATA_DIR = process.env.MILLIKIN_DATA_DIR || path.join(process.cwd(), "data");

const SCHEMA = `
CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT);
CREATE TABLE IF NOT EXISTS providers (
  id TEXT PRIMARY KEY, slug TEXT UNIQUE NOT NULL, name TEXT NOT NULL, type TEXT NOT NULL,
  base_url TEXT NOT NULL, api_key TEXT DEFAULT '', enabled INTEGER DEFAULT 1, created_at INTEGER);
CREATE TABLE IF NOT EXISTS models (
  id TEXT PRIMARY KEY, provider_id TEXT NOT NULL, model TEXT NOT NULL, label TEXT DEFAULT '',
  kind TEXT DEFAULT 'chat', supports_tools INTEGER DEFAULT 1, enabled INTEGER DEFAULT 1,
  UNIQUE(provider_id, model));
CREATE TABLE IF NOT EXISTS agents (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, role TEXT DEFAULT '', emoji TEXT DEFAULT '🤖',
  color TEXT DEFAULT '#6366f1', system_prompt TEXT DEFAULT '', model TEXT DEFAULT '',
  temperature REAL DEFAULT 0.4, think TEXT DEFAULT '', tools TEXT DEFAULT '[]', skill_ids TEXT DEFAULT '[]',
  kb_ids TEXT DEFAULT '[]', mcp_ids TEXT DEFAULT '[]', created_at INTEGER, updated_at INTEGER);
CREATE TABLE IF NOT EXISTS teams (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, description TEXT DEFAULT '', lead_id TEXT,
  member_ids TEXT DEFAULT '[]', workspace TEXT DEFAULT '', created_at INTEGER, updated_at INTEGER);
CREATE TABLE IF NOT EXISTS tasks (
  id TEXT PRIMARY KEY, team_id TEXT DEFAULT '', title TEXT NOT NULL, description TEXT DEFAULT '',
  status TEXT DEFAULT 'todo', priority TEXT DEFAULT 'normal', assignee_id TEXT DEFAULT '',
  created_by TEXT DEFAULT '', notes TEXT DEFAULT '[]', created_at INTEGER, updated_at INTEGER);
CREATE TABLE IF NOT EXISTS projects (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, description TEXT DEFAULT '', path TEXT DEFAULT '',
  template_id TEXT DEFAULT '', team TEXT DEFAULT '{}', created_at INTEGER, updated_at INTEGER);
CREATE TABLE IF NOT EXISTS sprints (
  id TEXT PRIMARY KEY, project_id TEXT NOT NULL, name TEXT NOT NULL, goal TEXT DEFAULT '',
  start_date TEXT DEFAULT '', end_date TEXT DEFAULT '', status TEXT DEFAULT 'planned',
  created_at INTEGER, updated_at INTEGER);
CREATE TABLE IF NOT EXISTS profiles (
  id TEXT PRIMARY KEY, category TEXT DEFAULT 'Mes profils', name TEXT NOT NULL, role TEXT DEFAULT '', emoji TEXT DEFAULT '🤖',
  color TEXT DEFAULT '#6366f1', system_prompt TEXT DEFAULT '', tools TEXT DEFAULT '[]', think TEXT DEFAULT '',
  created_at INTEGER, updated_at INTEGER);
CREATE TABLE IF NOT EXISTS skills (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, description TEXT DEFAULT '', content TEXT DEFAULT '',
  created_at INTEGER, updated_at INTEGER);
CREATE TABLE IF NOT EXISTS mcp_servers (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, transport TEXT DEFAULT 'stdio', command TEXT DEFAULT '',
  args TEXT DEFAULT '[]', env TEXT DEFAULT '{}', url TEXT DEFAULT '', headers TEXT DEFAULT '{}',
  enabled INTEGER DEFAULT 1, created_at INTEGER, updated_at INTEGER);
CREATE TABLE IF NOT EXISTS kbs (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, description TEXT DEFAULT '', created_at INTEGER, updated_at INTEGER);
CREATE TABLE IF NOT EXISTS kb_docs (
  id TEXT PRIMARY KEY, kb_id TEXT NOT NULL, name TEXT NOT NULL, chars INTEGER, chunks INTEGER, created_at INTEGER);
CREATE TABLE IF NOT EXISTS kb_chunks (
  id TEXT PRIMARY KEY, kb_id TEXT NOT NULL, doc_id TEXT NOT NULL, idx INTEGER, text TEXT, embedding BLOB);
CREATE INDEX IF NOT EXISTS kb_chunks_kb ON kb_chunks(kb_id);
CREATE TABLE IF NOT EXISTS conversations (
  id TEXT PRIMARY KEY, target_type TEXT NOT NULL, target_id TEXT NOT NULL, title TEXT DEFAULT '',
  created_at INTEGER, updated_at INTEGER);
CREATE TABLE IF NOT EXISTS messages (
  id TEXT PRIMARY KEY, conversation_id TEXT NOT NULL, role TEXT NOT NULL, agent_id TEXT,
  content TEXT DEFAULT '', trace TEXT, created_at INTEGER);
CREATE INDEX IF NOT EXISTS messages_conv ON messages(conversation_id, created_at);
CREATE TABLE IF NOT EXISTS usage_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT, ts INTEGER, provider TEXT, model TEXT, agent_id TEXT,
  source TEXT, prompt_tokens INTEGER DEFAULT 0, completion_tokens INTEGER DEFAULT 0,
  latency_ms INTEGER, status TEXT, error TEXT);
`;

// Columns added after the first release: [table, column, definition].
const COLUMNS: [string, string, string][] = [
  ["agents", "think", "TEXT DEFAULT ''"],
  ["teams", "workspace", "TEXT DEFAULT ''"],
  ["teams", "links", "TEXT DEFAULT '[]'"],
  ["teams", "entry_ids", "TEXT DEFAULT '[]'"],
  ["teams", "layout", "TEXT DEFAULT '{}'"],
  ["teams", "clarify", "INTEGER DEFAULT 1"],
  ["teams", "concert", "INTEGER DEFAULT 1"],
  ["conversations", "phase", "TEXT DEFAULT ''"],
  ["tasks", "project_id", "TEXT DEFAULT ''"],
  ["tasks", "result", "TEXT DEFAULT ''"],
  ["tasks", "evaluation", "TEXT DEFAULT 'null'"],
  ["tasks", "trace", "TEXT DEFAULT 'null'"],
  ["tasks", "depends_on", "TEXT DEFAULT '[]'"],
  ["tasks", "complexity", "INTEGER DEFAULT 0"],
  ["tasks", "sprint_id", "TEXT DEFAULT ''"],
  ["usage_logs", "project_id", "TEXT DEFAULT ''"],
];

const slugify = (s: string) =>
  s
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || "projet";

/** Teams became templates: move team conversations and tasks into one project per team (keeps its folder). */
function migrateTeamsToProjects(d: DatabaseSync) {
  type T = { id: string; name: string; description: string; lead_id: string; member_ids: string; workspace: string; links: string; entry_ids: string; layout: string; clarify: number; concert: number };
  const teams = d.prepare("SELECT * FROM teams").all() as T[];
  const wsDir = (d.prepare("SELECT value FROM settings WHERE key = 'workspace_dir'").get() as { value: string } | undefined)?.value || path.join(process.cwd(), "workspace");
  for (const t of teams) {
    const used =
      d.prepare("SELECT 1 FROM conversations WHERE target_type = 'team' AND target_id = ? LIMIT 1").get(t.id) ||
      d.prepare("SELECT 1 FROM tasks WHERE team_id = ? AND (project_id = '' OR project_id IS NULL) LIMIT 1").get(t.id);
    if (!used) continue;
    let project = d.prepare("SELECT id FROM projects WHERE template_id = ? AND name = ?").get(t.id, t.name) as { id: string } | undefined;
    if (!project) {
      const spec = specFromTeam({
        lead_id: t.lead_id,
        member_ids: JSON.parse(t.member_ids || "[]"),
        links: JSON.parse(t.links || "[]"),
        entry_ids: JSON.parse(t.entry_ids || "[]"),
        layout: JSON.parse(t.layout || "{}"),
        clarify: !!t.clarify,
        concert: !!t.concert,
      });
      project = { id: nanoid(12) };
      d.prepare("INSERT INTO projects (id, name, description, path, template_id, team, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?)").run(
        project.id,
        t.name,
        t.description,
        t.workspace || path.join(wsDir, slugify(t.name)),
        t.id,
        JSON.stringify(spec),
        Date.now(),
        Date.now(),
      );
    }
    d.prepare("UPDATE conversations SET target_type = 'project', target_id = ? WHERE target_type = 'team' AND target_id = ?").run(project.id, t.id);
    d.prepare("UPDATE tasks SET project_id = ? WHERE team_id = ? AND (project_id = '' OR project_id IS NULL)").run(project.id, t.id);
  }
}

function migrate(d: DatabaseSync) {
  d.exec(SCHEMA);
  for (const [table, col, def] of COLUMNS) {
    const cols = d.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[];
    if (!cols.some((c) => c.name === col)) d.exec(`ALTER TABLE ${table} ADD COLUMN ${col} ${def}`);
  }
  migrateTeamsToProjects(d);
}

const g = globalThis as unknown as { __millikinDb?: DatabaseSync; __millikinSchema?: string };

export function db(): DatabaseSync {
  if (!g.__millikinDb) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    const d = new DatabaseSync(path.join(DATA_DIR, "millikin.db"));
    d.exec("PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000;");
    g.__millikinDb = d;
  }
  // Re-run idempotent migrations whenever the schema changes (also after hot reloads).
  const version = SCHEMA + JSON.stringify(COLUMNS);
  if (g.__millikinSchema !== version) {
    migrate(g.__millikinDb);
    seed(g.__millikinDb);
    g.__millikinSchema = version;
  }
  return g.__millikinDb;
}

export const newId = () => nanoid(12);
export const now = () => Date.now();

// ---------- settings ----------
export const DEFAULT_SETTINGS: Record<string, string> = {
  default_model: "ollama/qwen3:8b",
  embedding_model: "ollama/nomic-embed-text:latest",
  searxng_url: "http://127.0.0.1:8888",
  proxy_key: "",
  max_steps: "8",
  num_ctx: "16384",
  think: "off",
  keep_alive: "10m",
  workspace_dir: path.join(process.cwd(), "workspace"),
  command_timeout: "60",
  max_reasoning: "12000",
  web_fallback: "on",
};

export function getSettings(): Record<string, string> {
  const rows = db().prepare("SELECT key, value FROM settings").all() as { key: string; value: string }[];
  const out = { ...DEFAULT_SETTINGS };
  for (const r of rows) out[r.key] = r.value;
  return out;
}

export function setSettings(values: Record<string, string>) {
  const st = db().prepare("INSERT INTO settings(key, value) VALUES(?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value");
  for (const [k, v] of Object.entries(values)) if (k in DEFAULT_SETTINGS) st.run(k, String(v ?? ""));
}

// ---------- generic entity CRUD ----------
type EntityDef = { table: string; json: string[]; bool: string[]; cols: string[]; order: string };

export const ENTITIES: Record<string, EntityDef> = {
  agents: {
    table: "agents",
    json: ["tools", "skill_ids", "kb_ids", "mcp_ids"],
    bool: [],
    cols: ["name", "role", "emoji", "color", "system_prompt", "model", "temperature", "think", "tools", "skill_ids", "kb_ids", "mcp_ids"],
    order: "created_at",
  },
  teams: {
    table: "teams",
    json: ["member_ids", "links", "entry_ids", "layout"],
    bool: ["clarify", "concert"],
    cols: ["name", "description", "lead_id", "member_ids", "workspace", "links", "entry_ids", "layout", "clarify", "concert"],
    order: "created_at",
  },
  projects: { table: "projects", json: ["team"], bool: [], cols: ["name", "description", "path", "template_id", "team"], order: "updated_at DESC" },
  tasks: {
    table: "tasks",
    json: ["notes", "evaluation", "trace", "depends_on"],
    bool: [],
    cols: ["team_id", "project_id", "title", "description", "status", "priority", "assignee_id", "created_by", "notes", "result", "evaluation", "trace", "depends_on", "complexity", "sprint_id"],
    order: "created_at",
  },
  sprints: { table: "sprints", json: [], bool: [], cols: ["project_id", "name", "goal", "start_date", "end_date", "status"], order: "created_at" },
  profiles: {
    table: "profiles",
    json: ["tools"],
    bool: [],
    cols: ["category", "name", "role", "emoji", "color", "system_prompt", "tools", "think"],
    order: "name",
  },
  skills: { table: "skills", json: [], bool: [], cols: ["name", "description", "content"], order: "name" },
  mcp: {
    table: "mcp_servers",
    json: ["args", "env", "headers"],
    bool: ["enabled"],
    cols: ["name", "transport", "command", "args", "env", "url", "headers", "enabled"],
    order: "created_at",
  },
  kbs: { table: "kbs", json: [], bool: [], cols: ["name", "description"], order: "created_at" },
  providers: { table: "providers", json: [], bool: ["enabled"], cols: ["slug", "name", "type", "base_url", "api_key", "enabled"], order: "created_at" },
  models: { table: "models", json: [], bool: ["supports_tools", "enabled"], cols: ["provider_id", "model", "label", "kind", "supports_tools", "enabled"], order: "model" },
};

type Row = Record<string, unknown>;

function decode(def: EntityDef, row: Row): Row {
  const out: Row = { ...row };
  for (const k of def.json) {
    try {
      out[k] = JSON.parse(String(row[k] ?? "null"));
    } catch {
      out[k] = null;
    }
  }
  for (const k of def.bool) out[k] = !!row[k];
  return out;
}

function encode(def: EntityDef, k: string, v: unknown): string | number | null {
  if (def.json.includes(k)) return JSON.stringify(v ?? null);
  if (def.bool.includes(k)) return v ? 1 : 0;
  if (v === undefined || v === null) return null;
  return typeof v === "number" ? v : String(v);
}

export function list<T = Row>(entity: string): T[] {
  const def = ENTITIES[entity];
  return (db().prepare(`SELECT * FROM ${def.table} ORDER BY ${def.order}`).all() as Row[]).map((r) => decode(def, r) as T);
}

export function get<T = Row>(entity: string, id: string): T | undefined {
  const def = ENTITIES[entity];
  const r = db().prepare(`SELECT * FROM ${def.table} WHERE id = ?`).get(id) as Row | undefined;
  return r ? (decode(def, r) as T) : undefined;
}

export function upsert<T = Row>(entity: string, data: Row): T {
  const def = ENTITIES[entity];
  const hasTs = entity !== "models" && entity !== "providers";
  const keys = def.cols.filter((k) => k in data);
  const id = (data.id as string) || newId();
  const existing = data.id ? get(entity, id) : undefined;
  if (existing) {
    if (keys.length) {
      const sets = keys.map((k) => `${k} = ?`).join(", ") + (hasTs ? ", updated_at = ?" : "");
      const vals = keys.map((k) => encode(def, k, data[k]));
      if (hasTs) vals.push(now());
      db().prepare(`UPDATE ${def.table} SET ${sets} WHERE id = ?`).run(...vals, id);
    }
  } else {
    const cols = ["id", ...keys, ...(entity === "models" ? [] : ["created_at"]), ...(hasTs ? ["updated_at"] : [])];
    const vals: (string | number | null)[] = [id, ...keys.map((k) => encode(def, k, data[k]))];
    if (entity !== "models") vals.push(now());
    if (hasTs) vals.push(now());
    db().prepare(`INSERT INTO ${def.table} (${cols.join(", ")}) VALUES (${cols.map(() => "?").join(", ")})`).run(...vals);
  }
  return get<T>(entity, id)!;
}

export function remove(entity: string, id: string) {
  const def = ENTITIES[entity];
  const d = db();
  d.prepare(`DELETE FROM ${def.table} WHERE id = ?`).run(id);
  if (entity === "kbs") {
    d.prepare("DELETE FROM kb_docs WHERE kb_id = ?").run(id);
    d.prepare("DELETE FROM kb_chunks WHERE kb_id = ?").run(id);
  }
  if (entity === "providers") d.prepare("DELETE FROM models WHERE provider_id = ?").run(id);
}

// ---------- typed shapes ----------
export type Agent = {
  id: string;
  name: string;
  role: string;
  emoji: string;
  color: string;
  system_prompt: string;
  model: string;
  temperature: number;
  think: "" | "on" | "off";
  tools: string[];
  skill_ids: string[];
  kb_ids: string[];
  mcp_ids: string[];
};
export type Team = {
  id: string;
  name: string;
  description: string;
  lead_id: string;
  member_ids: string[];
  workspace: string;
  links: TeamSpec["links"];
  entry_ids: string[];
  layout: TeamSpec["layout"];
  clarify: boolean;
  concert: boolean;
};
export type Project = { id: string; name: string; description: string; path: string; template_id: string; team: TeamSpec };
export type Evaluation = { verdict: "valide" | "a_corriger"; score: number; comment: string; by: string; at: number };
export type Task = {
  id: string;
  team_id: string;
  project_id: string;
  result: string;
  evaluation: Evaluation | null;
  trace: unknown;
  /** Ids of tasks that must be done first. */
  depends_on: string[];
  /** Story points (1, 2, 3, 5, 8, 13); 0 = not estimated. */
  complexity: number;
  sprint_id: string;
  title: string;
  description: string;
  status: "todo" | "doing" | "review" | "done";
  priority: "low" | "normal" | "high";
  assignee_id: string;
  created_by: string;
  notes: { at: number; by: string; text: string }[];
};
export type Sprint = {
  id: string;
  project_id: string;
  name: string;
  goal: string;
  start_date: string;
  end_date: string;
  status: "planned" | "active" | "done";
};
export type Skill = { id: string; name: string; description: string; content: string };
export type McpServer = {
  id: string;
  name: string;
  transport: "stdio" | "http" | "sse";
  command: string;
  args: string[];
  env: Record<string, string>;
  url: string;
  headers: Record<string, string>;
  enabled: boolean;
};
export type Provider = { id: string; slug: string; name: string; type: string; base_url: string; api_key: string; enabled: boolean };
export type ModelRow = { id: string; provider_id: string; model: string; label: string; kind: string; supports_tools: boolean; enabled: boolean };

export function logUsage(u: {
  provider: string;
  model: string;
  agent_id?: string | null;
  project_id?: string | null;
  source: string;
  prompt_tokens?: number;
  completion_tokens?: number;
  latency_ms: number;
  status: "ok" | "error";
  error?: string;
}) {
  db()
    .prepare(
      "INSERT INTO usage_logs (ts, provider, model, agent_id, project_id, source, prompt_tokens, completion_tokens, latency_ms, status, error) VALUES (?,?,?,?,?,?,?,?,?,?,?)",
    )
    .run(now(), u.provider, u.model, u.agent_id ?? null, u.project_id ?? "", u.source, u.prompt_tokens ?? 0, u.completion_tokens ?? 0, u.latency_ms, u.status, u.error ?? null);
}
