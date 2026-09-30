import { get, newId, type McpServer } from "@/lib/db";
import { disconnectMcp, listMcpTools } from "@/lib/mcp";

/** Connect to a saved server (by id) or an unsaved draft, and list its tools. */
export async function POST(req: Request) {
  const body = (await req.json()) as Partial<McpServer> & { id?: string };
  const saved = body.id ? get<McpServer>("mcp", body.id) : undefined;
  const server = { ...(saved ?? {}), ...body, id: body.id || `draft-${newId()}` } as McpServer;
  try {
    const tools = await listMcpTools(server);
    if (!saved) await disconnectMcp(server.id);
    return Response.json({ ok: true, tools: tools.map((t) => ({ name: t.name, description: t.description ?? "" })) });
  } catch (e) {
    await disconnectMcp(server.id);
    return Response.json({ ok: false, error: e instanceof Error ? e.message : String(e) });
  }
}
