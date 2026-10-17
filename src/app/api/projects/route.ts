import fs from "node:fs";
import path from "node:path";
import { assertCanCreateProject, assertTeamSize, denied, guard, guardProject } from "@/lib/access";
import { db, get, getSettings, list, upsert, type Agent, type Project, type Team } from "@/lib/db";
import { ALL_MODULES } from "@/lib/modules";
import { BUILTIN_PROFILES } from "@/lib/profiles";
import { rigorOf } from "@/lib/rigor";
import { specFromTeam } from "@/lib/team";
import { slug } from "@/lib/tools";

/** Agent for a member pick: an existing agent id, or a built-in profile id (an agent of that name is reused, else created). */
function memberAgent(id: string): string | null {
  if (!id.startsWith("builtin:")) return get<Agent>("agents", id) ? id : null;
  const profile = BUILTIN_PROFILES.find((p) => p.id === id);
  if (!profile) return null;
  const existing = list<Agent>("agents").find((a) => a.name === profile.name);
  if (existing) return existing.id;
  const { name, role, emoji, color, system_prompt, tools, think } = profile;
  return upsert<Agent>("agents", { name, role, emoji, color, system_prompt, tools, think, model: "", temperature: 0.4, skill_ids: [], kb_ids: [], mcp_ids: [] }).id;
}

/**
 * Create a project. The team comes from a template (copied), or from picked members (agents or
 * built-in profiles) with their first contacts; `modules` lists the optional sections to show.
 */
export async function POST(req: Request) {
  const b = (await req.json()) as { name: string; description?: string; template_id?: string; path?: string; members?: string[]; entries?: string[]; modules?: string[]; rigor?: string };
  if (!b.name?.trim()) return Response.json({ error: "Le nom du projet est obligatoire" }, { status: 400 });
  let user;
  try {
    user = guard(req, "edit");
    assertCanCreateProject(user);
    // Picking built-in profiles creates agents: that is agent management.
    if (b.members?.some((m) => m.startsWith("builtin:")) && b.members.some((m) => !list<Agent>("agents").some((a) => a.id === m))) guard(req, "agents");
    const template = b.template_id ? get<Team>("teams", b.template_id) : undefined;
    assertTeamSize(user, template ? specFromTeam(template).agent_ids.length : (b.members ?? []).length);
  } catch (e) {
    return denied(e);
  }
  const template = b.template_id ? get<Team>("teams", b.template_id) : undefined;
  let spec = template ? specFromTeam(template) : specFromTeam({});
  if (!template && b.members?.length) {
    const ids = new Map(b.members.map((m) => [m, memberAgent(m)]));
    const agent_ids = [...new Set([...ids.values()].filter((x): x is string => !!x))];
    const entry_ids = (b.entries ?? []).map((e) => ids.get(e) ?? memberAgent(e)).filter((x): x is string => !!x && agent_ids.includes(x));
    // First contacts delegate to everyone else.
    spec = specFromTeam({ entry_ids: entry_ids.length ? entry_ids : agent_ids.slice(0, 1), member_ids: agent_ids });
  }
  const modules = (b.modules ?? []).filter((m) => (ALL_MODULES as string[]).includes(m));
  let dir = b.path?.trim();
  if (!dir) {
    // A dedicated, well-named folder per project (suffixed if the name is already taken).
    const base = path.join(getSettings().workspace_dir, slug(b.name));
    dir = base;
    for (let i = 2; fs.existsSync(dir) && fs.readdirSync(dir).length; i++) dir = `${base}-${i}`;
  }
  fs.mkdirSync(dir, { recursive: true });
  const project = upsert<Project>("projects", { name: b.name.trim(), description: b.description ?? "", path: dir, template_id: template?.id ?? "", team: spec, modules: modules.length ? modules : ALL_MODULES, owner_id: user?.id ?? "", rigor: rigorOf(b) });
  return Response.json(project);
}

/** Delete a project with its conversations, tasks and sprints. Files on disk are kept. */
export async function DELETE(req: Request) {
  const id = new URL(req.url).searchParams.get("id");
  if (!id) return Response.json({ error: "id manquant" }, { status: 400 });
  try {
    const user = guard(req, "edit");
    guardProject(user, id);
    // Members delete only the projects they created.
    const owner = (db().prepare("SELECT owner_id FROM projects WHERE id = ?").get(id) as { owner_id?: string } | undefined)?.owner_id;
    if (user && user.role !== "admin" && owner !== user.id) throw Response.json({ error: "Seul le créateur du projet ou un administrateur peut le supprimer" }, { status: 403 });
  } catch (e) {
    return denied(e);
  }
  const d = db();
  const convs = d.prepare("SELECT id FROM conversations WHERE target_type = 'project' AND target_id = ?").all(id) as { id: string }[];
  for (const c of convs) d.prepare("DELETE FROM messages WHERE conversation_id = ?").run(c.id);
  d.prepare("DELETE FROM conversations WHERE target_type = 'project' AND target_id = ?").run(id);
  d.prepare("DELETE FROM tasks WHERE project_id = ?").run(id);
  d.prepare("DELETE FROM sprints WHERE project_id = ?").run(id);
  d.prepare("DELETE FROM projects WHERE id = ?").run(id);
  return Response.json({ ok: true });
}
