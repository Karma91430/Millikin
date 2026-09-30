"use client";

import { useCallback, useEffect, useState } from "react";
import type { ProjectResources } from "@/lib/resources";
import type { TeamSpec } from "@/lib/team";
export type { ProjectResources } from "@/lib/resources";
import type { Trace } from "@/lib/trace";
export type { Link, TeamSpec } from "@/lib/team";

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
export type Profile = {
  id: string;
  builtin: boolean;
  category: string;
  name: string;
  role: string;
  emoji: string;
  color: string;
  system_prompt: string;
  tools: string[];
  think: "" | "on" | "off";
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
export type Project = { id: string; name: string; description: string; path: string; template_id: string; team: TeamSpec; resources: ProjectResources; updated_at: number };
export type Evaluation = { verdict: "valide" | "a_corriger"; score: number; comment: string; by: string; at: number };
export type Skill = { id: string; name: string; description: string; content: string };
export type Kb = { id: string; name: string; description: string };
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
export type Task = {
  id: string;
  team_id: string;
  project_id: string;
  result: string;
  evaluation: Evaluation | null;
  trace: Trace | null;
  depends_on: string[];
  complexity: number;
  sprint_id: string;
  title: string;
  description: string;
  status: "todo" | "doing" | "review" | "done";
  priority: "low" | "normal" | "high";
  assignee_id: string;
  created_by: string;
  notes: { at: number; by: string; text: string }[];
  created_at: number;
  updated_at: number;
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
export type RunInfo = {
  id: string;
  conversationId: string;
  targetType: "project" | "agent" | "task";
  targetId: string;
  title: string;
  userMessage: string;
  startedAt: number;
  endedAt?: number;
  status: "running" | "done" | "error" | "stopped";
};
export type Conversation = { id: string; target_type: "project" | "agent"; target_id: string; title: string; phase: "" | "free" | "cadrage" | "execution"; updated_at: number };
export type Message = { id: string; role: "user" | "assistant"; agent_id: string | null; content: string; trace: Trace | null; created_at: number };
export type Meta = {
  tools: { id: string; label: string; description: string; danger: boolean }[];
  models: { ref: string; label: string; provider: string; kind: string; supports_tools: boolean }[];
  presets: Record<string, { name: string; base_url: string }>;
};

export async function api<T = unknown>(url: string, init?: RequestInit & { json?: unknown }): Promise<T> {
  const { json, ...rest } = init ?? {};
  const r = await fetch(url, {
    ...rest,
    headers: json !== undefined ? { "content-type": "application/json", ...(rest.headers ?? {}) } : rest.headers,
    body: json !== undefined ? JSON.stringify(json) : rest.body,
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok || (data && typeof data === "object" && "error" in data && data.error)) throw new Error((data as { error?: string }).error || `HTTP ${r.status}`);
  return data as T;
}

export const crud = {
  list: <T>(entity: string) => api<T[]>(`/api/crud/${entity}`),
  save: <T>(entity: string, data: Partial<T> & Record<string, unknown>) => api<T>(`/api/crud/${entity}`, { method: "POST", json: data }),
  remove: (entity: string, id: string) => api(`/api/crud/${entity}?id=${encodeURIComponent(id)}`, { method: "DELETE" }),
};

/** Tiny fetch-and-refresh hook: state is only set once a response arrives. */
export function useData<T>(url: string | null) {
  const [state, setState] = useState<{ data?: T; error?: string }>({});
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (!url) return;
    let alive = true;
    api<T>(url).then(
      (data) => alive && setState({ data }),
      (e) => alive && setState((s) => ({ ...s, error: e instanceof Error ? e.message : String(e) })),
    );
    return () => {
      alive = false;
    };
  }, [url, tick]);
  const reload = useCallback(() => setTick((t) => t + 1), []);
  const setData = useCallback((f: T | ((prev: T | undefined) => T | undefined)) => {
    setState((s) => ({ ...s, data: typeof f === "function" ? (f as (p: T | undefined) => T | undefined)(s.data) : f }));
  }, []);
  return { data: state.data, error: state.error, reload, setData };
}

export const formatBytes = (n: number) =>
  n > 1e9 ? `${(n / 1e9).toFixed(1)} Go` : n > 1e6 ? `${(n / 1e6).toFixed(0)} Mo` : n >= 1000 ? `${Math.round(n / 1e3)} Ko` : `${n} o`;
