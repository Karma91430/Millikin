import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";
import type { McpServer } from "./db";

export type McpTool = { name: string; description?: string; inputSchema: Record<string, unknown> };
type Conn = { key: string; client: Client; tools: McpTool[] };

// Connections survive hot reloads and are reused across requests.
const g = globalThis as unknown as { __millikinMcp?: Map<string, Conn> };
const conns = (g.__millikinMcp ??= new Map());

const configKey = (s: McpServer) => JSON.stringify([s.transport, s.command, s.args, s.env, s.url, s.headers]);

async function connect(s: McpServer): Promise<Conn> {
  const key = configKey(s);
  const existing = conns.get(s.id);
  if (existing?.key === key) return existing;
  if (existing) await existing.client.close().catch(() => {});

  const client = new Client({ name: "millikin", version: "0.1.0" });
  if (s.transport === "stdio") {
    if (!s.command) throw new Error("Commande manquante");
    await client.connect(
      new StdioClientTransport({
        command: s.command,
        args: s.args ?? [],
        env: { ...(process.env as Record<string, string>), ...(s.env ?? {}) },
        stderr: "ignore",
      }),
    );
  } else {
    const url = new URL(s.url);
    const requestInit = { headers: s.headers ?? {} };
    await client.connect(s.transport === "sse" ? new SSEClientTransport(url, { requestInit }) : new StreamableHTTPClientTransport(url, { requestInit }));
  }
  const { tools } = await client.listTools();
  const conn = { key, client, tools: tools as McpTool[] };
  conns.set(s.id, conn);
  return conn;
}

export async function listMcpTools(s: McpServer): Promise<McpTool[]> {
  return (await connect(s)).tools;
}

export async function callMcpTool(s: McpServer, name: string, args: Record<string, unknown>): Promise<string> {
  const conn = await connect(s);
  const res = (await conn.client.callTool({ name, arguments: args })) as {
    content?: { type: string; text?: string; resource?: { text?: string } }[];
    isError?: boolean;
    structuredContent?: unknown;
  };
  const text = (res.content ?? [])
    .map((c) => (c.type === "text" ? c.text : c.resource?.text ?? `[${c.type}]`))
    .filter(Boolean)
    .join("\n");
  const out = text || (res.structuredContent ? JSON.stringify(res.structuredContent) : "(résultat vide)");
  return res.isError ? `Erreur de l'outil : ${out}` : out;
}

export async function disconnectMcp(id: string) {
  const c = conns.get(id);
  if (c) await c.client.close().catch(() => {});
  conns.delete(id);
}
