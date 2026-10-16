// Users, sessions, permissions and credits. Until the first account exists Millikin runs as before
// (single user, this machine only); afterwards every request carries a verified user (see src/proxy.ts).
import crypto from "node:crypto";
import { db, getSettings, list, newId, now, userContext, type Project } from "./db";

export type Role = "admin" | "member" | "viewer";
export type User = {
  id: string;
  email: string;
  name: string;
  role: Role;
  active: boolean;
  /** Tool groups the user's agents may use; empty = all. */
  tools: string[];
  project_access: "all" | "selected";
  project_ids: string[];
  can_create_projects: boolean;
  can_manage_agents: boolean;
  /** 0 = unlimited. */
  max_team_size: number;
  max_projects: number;
  credits_monthly: number;
  credits_bonus: number;
  created_at: number;
  last_login: number | null;
};
type Row = Omit<User, "active" | "tools" | "project_ids" | "can_create_projects" | "can_manage_agents"> & {
  active: number;
  tools: string;
  project_ids: string;
  can_create_projects: number;
  can_manage_agents: number;
  password_hash: string;
};

export const SESSION_COOKIE = "millikin_session";
const SESSION_DAYS = 30;
export const USER_HEADER = "x-millikin-user";

const parse = (r: Row): User => ({
  id: r.id,
  email: r.email,
  name: r.name,
  role: r.role,
  active: !!r.active,
  tools: JSON.parse(r.tools || "[]"),
  project_access: r.project_access === "selected" ? "selected" : "all",
  project_ids: JSON.parse(r.project_ids || "[]"),
  can_create_projects: !!r.can_create_projects,
  can_manage_agents: !!r.can_manage_agents,
  max_team_size: r.max_team_size,
  max_projects: r.max_projects,
  credits_monthly: r.credits_monthly,
  credits_bonus: r.credits_bonus,
  created_at: r.created_at,
  last_login: r.last_login,
});

// ---------------------------------------------------------------- passwords & sessions

export function hashPassword(password: string) {
  const salt = crypto.randomBytes(16).toString("hex");
  return `scrypt:${salt}:${crypto.scryptSync(password, salt, 64).toString("hex")}`;
}
function checkPassword(password: string, stored: string) {
  const [, salt, hash] = stored.split(":");
  if (!salt || !hash) return false;
  const got = crypto.scryptSync(password, salt, 64);
  const want = Buffer.from(hash, "hex");
  return got.length === want.length && crypto.timingSafeEqual(got, want);
}

export const hasUsers = () => !!db().prepare("SELECT 1 FROM users LIMIT 1").get();
export const listUsers = () => (db().prepare("SELECT * FROM users ORDER BY created_at").all() as Row[]).map(parse);
export function getUser(id: string) {
  const r = db().prepare("SELECT * FROM users WHERE id = ?").get(id) as Row | undefined;
  return r ? parse(r) : null;
}

export function login(email: string, password: string) {
  const r = db().prepare("SELECT * FROM users WHERE email = ?").get(email.trim().toLowerCase()) as Row | undefined;
  if (!r || !checkPassword(password, r.password_hash)) throw new Error("E-mail ou mot de passe incorrect");
  if (!r.active) throw new Error("Ce compte est désactivé : contacte un administrateur");
  const id = crypto.randomBytes(32).toString("hex");
  db().prepare("INSERT INTO sessions (id, user_id, created_at, expires_at) VALUES (?,?,?,?)").run(id, r.id, now(), now() + SESSION_DAYS * 86400_000);
  db().prepare("UPDATE users SET last_login = ? WHERE id = ?").run(now(), r.id);
  return { token: id, user: parse(r), maxAge: SESSION_DAYS * 86400 };
}
export const logout = (token: string) => db().prepare("DELETE FROM sessions WHERE id = ?").run(token);

/** User behind a session token (active accounts and unexpired sessions only). */
export function userFromSession(token: string | undefined | null): User | null {
  if (!token) return null;
  const s = db().prepare("SELECT user_id, expires_at FROM sessions WHERE id = ?").get(token) as { user_id: string; expires_at: number } | undefined;
  if (!s || s.expires_at < now()) return null;
  const u = getUser(s.user_id);
  return u?.active ? u : null;
}

// ---------------------------------------------------------------- users (admin)

export type UserInput = Partial<Omit<User, "id" | "created_at" | "last_login">> & { password?: string };

export function saveUser(id: string | null, input: UserInput): User {
  const email = input.email?.trim().toLowerCase();
  if (!id) {
    if (!email || !input.password) throw new Error("E-mail et mot de passe obligatoires");
    if (input.password.length < 8) throw new Error("Le mot de passe doit faire au moins 8 caractères");
    id = newId();
    db().prepare("INSERT INTO users (id, email, password_hash, created_at, updated_at) VALUES (?,?,?,?,?)").run(id, email, hashPassword(input.password), now(), now());
  } else if (input.password) {
    if (input.password.length < 8) throw new Error("Le mot de passe doit faire au moins 8 caractères");
    db().prepare("UPDATE users SET password_hash = ? WHERE id = ?").run(hashPassword(input.password), id);
    db().prepare("DELETE FROM sessions WHERE user_id = ?").run(id);
  }
  const cols: Record<string, unknown> = {
    email,
    name: input.name,
    role: input.role,
    active: input.active === undefined ? undefined : input.active ? 1 : 0,
    tools: input.tools && JSON.stringify(input.tools),
    project_access: input.project_access,
    project_ids: input.project_ids && JSON.stringify(input.project_ids),
    can_create_projects: input.can_create_projects === undefined ? undefined : input.can_create_projects ? 1 : 0,
    can_manage_agents: input.can_manage_agents === undefined ? undefined : input.can_manage_agents ? 1 : 0,
    max_team_size: input.max_team_size,
    max_projects: input.max_projects,
    credits_monthly: input.credits_monthly,
    credits_bonus: input.credits_bonus,
  };
  const keys = Object.keys(cols).filter((k) => cols[k] !== undefined);
  if (keys.length) db().prepare(`UPDATE users SET ${keys.map((k) => `${k} = ?`).join(", ")}, updated_at = ? WHERE id = ?`).run(...keys.map((k) => cols[k] as string | number), now(), id);
  // Never lock everybody out: there must always be an active admin.
  if (!listUsers().some((u) => u.role === "admin" && u.active)) {
    db().prepare("UPDATE users SET role = 'admin', active = 1 WHERE id = ?").run(id);
  }
  if (input.active === false) db().prepare("DELETE FROM sessions WHERE user_id = ?").run(id);
  return getUser(id)!;
}

export function deleteUser(id: string) {
  const admins = listUsers().filter((u) => u.role === "admin" && u.active);
  if (admins.length === 1 && admins[0].id === id) throw new Error("Impossible de supprimer le dernier administrateur");
  db().prepare("DELETE FROM sessions WHERE user_id = ?").run(id);
  db().prepare("DELETE FROM users WHERE id = ?").run(id);
}

// ---------------------------------------------------------------- permissions

/** Request user, as set by the proxy (null while no account exists: single-user mode, full access). */
export function requestUser(req: Request): User | null {
  const id = req.headers.get(USER_HEADER);
  return id ? getUser(id) : null;
}
export const isAdmin = (u: User | null) => !u || u.role === "admin";
export const canEdit = (u: User | null) => !u || u.role !== "viewer";
export const canManageAgents = (u: User | null) => !u || u.role === "admin" || (u.role === "member" && u.can_manage_agents);

export function canSeeProject(u: User | null, p: Pick<Project, "id"> & { owner_id?: string }) {
  if (!u || u.role === "admin" || u.project_access === "all") return true;
  return u.project_ids.includes(p.id) || p.owner_id === u.id;
}
export const visibleProjects = <T extends Pick<Project, "id"> & { owner_id?: string }>(u: User | null, rows: T[]) => rows.filter((p) => canSeeProject(u, p));

export function assertCanCreateProject(u: User | null) {
  if (!u) return;
  if (u.role === "viewer" || (u.role === "member" && !u.can_create_projects)) throw new Error("Ton compte ne permet pas de créer des projets");
  if (u.max_projects > 0) {
    const mine = list<Project & { owner_id?: string }>("projects").filter((p) => p.owner_id === u.id).length;
    if (mine >= u.max_projects) throw new Error(`Limite atteinte : ${u.max_projects} projet(s) maximum pour ton compte`);
  }
}
export function assertTeamSize(u: User | null, size: number) {
  if (u && u.role !== "admin" && u.max_team_size > 0 && size > u.max_team_size) throw new Error(`Équipe trop grande : ${u.max_team_size} agent(s) maximum pour ton compte`);
}

/** Tool groups allowed for the user running the current request/run (null = no restriction). */
export function allowedToolGroups(): string[] | null {
  const id = userContext().getStore()?.userId;
  const u = id ? getUser(id) : null;
  return u && u.role !== "admin" && u.tools.length ? u.tools : null;
}

/** Run `fn` on behalf of a user: usage is attributed to them, tools are filtered by their rights. */
export const runAs = <T>(userId: string | null | undefined, fn: () => T): T => (userId ? userContext().run({ userId }, fn) : fn());

// ---------------------------------------------------------------- credits

const monthStart = () => {
  const d = new Date();
  return new Date(d.getFullYear(), d.getMonth(), 1).getTime();
};

/** Credits used this month: tokens / 1000 × the weight of the provider type that served them. */
export function creditsUsed(userId: string) {
  let weights: Record<string, number> = {};
  try {
    weights = JSON.parse(getSettings().credit_weights || "{}");
  } catch {}
  const types = new Map(list<{ slug: string; type: string }>("providers").map((p) => [p.slug, p.type]));
  const rows = db()
    .prepare("SELECT provider, SUM(prompt_tokens + completion_tokens) AS tokens FROM usage_logs WHERE user_id = ? AND ts >= ? GROUP BY provider")
    .all(userId, monthStart()) as { provider: string; tokens: number }[];
  return Math.round(rows.reduce((s, r) => s + (r.tokens / 1000) * (weights[types.get(r.provider) ?? "ollama"] ?? 1), 0) * 10) / 10;
}

export function creditStatus(u: User) {
  const used = creditsUsed(u.id);
  const quota = u.credits_monthly > 0 ? u.credits_monthly + u.credits_bonus : 0;
  return { used, quota, remaining: quota ? Math.max(0, Math.round((quota - used) * 10) / 10) : null };
}

/** Block a new run when the user's monthly credits are spent (admins and unlimited accounts never are). */
export function assertCredits(u: User | null) {
  if (!u) return;
  if (u.role === "viewer") throw new Error("Ton compte est en lecture seule");
  if (u.role === "admin" || u.credits_monthly <= 0) return;
  const s = creditStatus(u);
  if ((s.remaining ?? 1) <= 0) throw new Error(`Crédits épuisés pour ce mois (${s.used} / ${s.quota}). Demande une recharge à un administrateur.`);
}

// ---------------------------------------------------------------- route guards

export type Need = "read" | "edit" | "agents" | "admin";

/** The request user if they have the required level; throws a 403 Response otherwise (catch it with `denied`). */
export function guard(req: Request, need: Need): User | null {
  const u = requestUser(req);
  if (!u) return null; // single-user mode, or the proxy already refused the request
  const ok = need === "read" || (need === "edit" && canEdit(u)) || (need === "agents" && canManageAgents(u)) || (need === "admin" && u.role === "admin");
  if (!ok)
    throw Response.json(
      { error: need === "admin" ? "Réservé aux administrateurs" : need === "agents" ? "Ton compte ne permet pas de modifier les agents et ressources" : "Ton compte est en lecture seule" },
      { status: 403 },
    );
  return u;
}

/** 403 unless the user may see this project. */
export function guardProject(u: User | null, projectId: string | null | undefined) {
  if (!u || !projectId) return;
  const p = db().prepare("SELECT id, owner_id FROM projects WHERE id = ?").get(projectId) as { id: string; owner_id: string } | undefined;
  if (p && !canSeeProject(u, p)) throw Response.json({ error: "Tu n'as pas accès à ce projet" }, { status: 403 });
}

/** Turn a thrown guard Response (or error) into a response. */
export const denied = (e: unknown) => (e instanceof Response ? e : Response.json({ error: e instanceof Error ? e.message : String(e) }, { status: 400 }));

/**
 * Wrap a route handler: required level, credits for model calls, project access, and the handler
 * runs on behalf of the user (usage attribution, tool rights).
 */
export function withAccess(
  need: Need,
  handler: (req: Request) => Promise<Response>,
  opts: { credits?: boolean; project?: (body: Record<string, unknown>) => string | null | undefined } = {},
) {
  return async (req: Request) => {
    try {
      const u = guard(req, need);
      if (opts.credits) assertCredits(u);
      if (opts.project && u) guardProject(u, opts.project((await req.clone().json().catch(() => ({}))) as Record<string, unknown>));
      return await runAs(u?.id, () => handler(req));
    } catch (e) {
      return denied(e);
    }
  };
}
