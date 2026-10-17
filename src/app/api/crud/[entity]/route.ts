import { assertCanCreateProject, assertTeamSize, canSeeProject, denied, guard, guardProject, type Need, type User } from "@/lib/access";
import { ENTITIES, get, list, remove, upsert, type Project } from "@/lib/db";
import { disconnectMcp } from "@/lib/mcp";

type Ctx = { params: Promise<{ entity: string }> };

async function entityOf(ctx: Ctx) {
  const { entity } = await ctx.params;
  if (!ENTITIES[entity]) throw new Response(JSON.stringify({ error: `Entité inconnue : ${entity}` }), { status: 404 });
  return entity;
}

const fail = denied;

// Who may change what: global configuration is for admins, agents and resources for agent managers, project data for editors.
const WRITE: Record<string, Need> = { providers: "admin", models: "admin", agents: "agents", teams: "agents", skills: "agents", mcp: "agents", kbs: "agents", profiles: "agents" };
const needToWrite = (entity: string): Need => WRITE[entity] ?? "edit";

/** Project of a row of a project-scoped entity (to check access). */
function projectOf(entity: string, row: Record<string, unknown> | undefined): string | undefined {
  if (!row) return undefined;
  if (entity === "projects") return String(row.id ?? "");
  if (entity === "tasks" || entity === "sprints") return String(row.project_id ?? "");
  return undefined;
}

/** Test bench projects (and their tasks and sprints) never show up in the lists. */
function withoutBench(entity: string, rows: Record<string, unknown>[]) {
  if (entity === "projects") return rows.filter((p) => !p.bench);
  if (entity === "tasks" || entity === "sprints") {
    const bench = new Set(list<Project & { bench?: string }>("projects").filter((p) => p.bench).map((p) => p.id));
    return bench.size ? rows.filter((r) => !bench.has(String(r.project_id ?? ""))) : rows;
  }
  return rows;
}

function visibleRows(u: User | null, entity: string, all: Record<string, unknown>[]) {
  const rows = withoutBench(entity, all);
  if (!u || u.role === "admin") return rows;
  if (entity === "projects") return rows.filter((p) => canSeeProject(u, p as { id: string; owner_id?: string }));
  if (entity === "tasks" || entity === "sprints") {
    const ok = new Set(list<Project & { owner_id?: string }>("projects").filter((p) => canSeeProject(u, p)).map((p) => p.id));
    return rows.filter((r) => ok.has(String(r.project_id ?? "")));
  }
  return rows;
}

export async function GET(req: Request, ctx: Ctx) {
  try {
    const entity = await entityOf(ctx);
    const rows = visibleRows(guard(req, "read"), entity, list(entity));
    // Never send provider keys back to the browser in clear.
    if (entity === "providers") return Response.json(rows.map((r) => ({ ...r, api_key: r.api_key ? "••••••••" : "" })));
    return Response.json(rows);
  } catch (e) {
    return fail(e);
  }
}

export async function POST(req: Request, ctx: Ctx) {
  try {
    const entity = await entityOf(ctx);
    const data = (await req.json()) as Record<string, unknown>;
    const u = guard(req, needToWrite(entity));
    // Project data: the target project must be visible (for an update, the row's current project too).
    const before = data.id ? (get(entity, String(data.id)) as Record<string, unknown> | undefined) : undefined;
    guardProject(u, projectOf(entity, before));
    guardProject(u, projectOf(entity, data));
    if (entity === "projects" && data.team) assertTeamSize(u, ((data.team as { agent_ids?: string[] }).agent_ids ?? []).length);
    if (entity === "projects" && !before) {
      assertCanCreateProject(u);
      if (u) data.owner_id = u.id;
    }
    if (entity === "providers" && data.api_key === "••••••••") delete data.api_key;
    if (entity === "mcp" && data.id) await disconnectMcp(String(data.id));
    return Response.json(upsert(entity, data));
  } catch (e) {
    return fail(e);
  }
}

export async function DELETE(req: Request, ctx: Ctx) {
  try {
    const entity = await entityOf(ctx);
    const id = new URL(req.url).searchParams.get("id");
    if (!id) return Response.json({ error: "id manquant" }, { status: 400 });
    const u = guard(req, needToWrite(entity));
    guardProject(u, projectOf(entity, get(entity, id) as Record<string, unknown> | undefined));
    if (entity === "mcp") await disconnectMcp(id);
    remove(entity, id);
    return Response.json({ ok: true });
  } catch (e) {
    return fail(e);
  }
}
