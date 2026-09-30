import { ENTITIES, list, remove, upsert } from "@/lib/db";
import { disconnectMcp } from "@/lib/mcp";

type Ctx = { params: Promise<{ entity: string }> };

async function entityOf(ctx: Ctx) {
  const { entity } = await ctx.params;
  if (!ENTITIES[entity]) throw new Response(JSON.stringify({ error: `Entité inconnue : ${entity}` }), { status: 404 });
  return entity;
}

const fail = (e: unknown) => (e instanceof Response ? e : Response.json({ error: e instanceof Error ? e.message : String(e) }, { status: 400 }));

export async function GET(_req: Request, ctx: Ctx) {
  try {
    const entity = await entityOf(ctx);
    const rows = list(entity);
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
    if (entity === "mcp") await disconnectMcp(id);
    remove(entity, id);
    return Response.json({ ok: true });
  } catch (e) {
    return fail(e);
  }
}
