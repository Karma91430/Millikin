// Project resources: which knowledge bases and MCP servers a project connects, with filters,
// and which agents of the team may use them (client + server safe).

export type RagMode = "auto" | "tool";

export type ProjectResources = {
  rag: {
    kb_ids: string[];
    /** Only documents carrying one of these tags (empty = all documents). */
    tags: string[];
    /** auto: best passages injected before the agent thinks · tool: the agent searches only when needed (faster). */
    mode: RagMode;
    top_k: number;
    /** Blend keyword (BM25) scores with vector similarity. */
    hybrid: boolean;
    /** Re-order candidates: none, MMR (diversity) or the local LLM (relevance, slower). */
    rerank: "none" | "mmr" | "llm";
    /** Agents allowed to use the knowledge; the others are not slowed down by it. */
    agent_ids: string[];
  };
  mcp: { server_id: string; agent_ids: string[] }[];
};

export const defaultResources = (): ProjectResources => ({ rag: { kb_ids: [], tags: [], mode: "auto", top_k: 4, hybrid: true, rerank: "none", agent_ids: [] }, mcp: [] });

export function normalizeResources(r: unknown): ProjectResources {
  const d = defaultResources();
  const x = (r && typeof r === "object" ? r : {}) as Partial<ProjectResources>;
  const rag = { ...d.rag, ...(x.rag ?? {}) };
  return {
    rag: {
      kb_ids: Array.isArray(rag.kb_ids) ? rag.kb_ids : [],
      tags: Array.isArray(rag.tags) ? rag.tags : [],
      mode: rag.mode === "tool" ? "tool" : "auto",
      top_k: Math.min(10, Math.max(1, Number(rag.top_k) || 4)),
      hybrid: rag.hybrid !== false,
      rerank: rag.rerank === "mmr" || rag.rerank === "llm" ? rag.rerank : "none",
      agent_ids: Array.isArray(rag.agent_ids) ? rag.agent_ids : [],
    },
    mcp: Array.isArray(x.mcp) ? x.mcp.filter((m) => m && typeof m.server_id === "string").map((m) => ({ server_id: m.server_id, agent_ids: Array.isArray(m.agent_ids) ? m.agent_ids : [] })) : [],
  };
}

/** An agent's own knowledge settings (used everywhere, including direct chats outside projects). */
export type AgentRag = { tags: string[]; mode: RagMode; top_k: number; hybrid: boolean; rerank: "none" | "mmr" | "llm" };

export const defaultAgentRag = (): AgentRag => ({ tags: [], mode: "tool", top_k: 4, hybrid: true, rerank: "none" });

export function normalizeAgentRag(r: unknown): AgentRag {
  const d = defaultAgentRag();
  const x = { ...d, ...((r && typeof r === "object" ? r : {}) as Partial<AgentRag>) };
  return {
    tags: Array.isArray(x.tags) ? x.tags : [],
    mode: x.mode === "auto" ? "auto" : "tool",
    top_k: Math.min(10, Math.max(1, Number(x.top_k) || 4)),
    hybrid: x.hybrid !== false,
    rerank: x.rerank === "mmr" || x.rerank === "llm" ? x.rerank : "none",
  };
}
