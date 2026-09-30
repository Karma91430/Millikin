import fs from "node:fs";
import path from "node:path";
import { db, get, getSettings, upsert, type Project, type Team } from "@/lib/db";
import { specFromTeam } from "@/lib/team";
import { slug } from "@/lib/tools";

/** Create a project from a team template: the team composition is copied into the project. */
export async function POST(req: Request) {
  const b = (await req.json()) as { name: string; description?: string; template_id?: string; path?: string };
  if (!b.name?.trim()) return Response.json({ error: "Le nom du projet est obligatoire" }, { status: 400 });
  const template = b.template_id ? get<Team>("teams", b.template_id) : undefined;
  const spec = template ? specFromTeam(template) : specFromTeam({});
  let dir = b.path?.trim();
  if (!dir) {
    // A dedicated, well-named folder per project (suffixed if the name is already taken).
    const base = path.join(getSettings().workspace_dir, slug(b.name));
    dir = base;
    for (let i = 2; fs.existsSync(dir) && fs.readdirSync(dir).length; i++) dir = `${base}-${i}`;
  }
  fs.mkdirSync(dir, { recursive: true });
  const project = upsert<Project>("projects", { name: b.name.trim(), description: b.description ?? "", path: dir, template_id: template?.id ?? "", team: spec });
  return Response.json(project);
}

/** Delete a project with its conversations, tasks and sprints. Files on disk are kept. */
export async function DELETE(req: Request) {
  const id = new URL(req.url).searchParams.get("id");
  if (!id) return Response.json({ error: "id manquant" }, { status: 400 });
  const d = db();
  const convs = d.prepare("SELECT id FROM conversations WHERE target_type = 'project' AND target_id = ?").all(id) as { id: string }[];
  for (const c of convs) d.prepare("DELETE FROM messages WHERE conversation_id = ?").run(c.id);
  d.prepare("DELETE FROM conversations WHERE target_type = 'project' AND target_id = ?").run(id);
  d.prepare("DELETE FROM tasks WHERE project_id = ?").run(id);
  d.prepare("DELETE FROM sprints WHERE project_id = ?").run(id);
  d.prepare("DELETE FROM projects WHERE id = ?").run(id);
  return Response.json({ ok: true });
}
