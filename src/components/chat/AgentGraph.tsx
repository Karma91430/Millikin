"use client";

import {
  applyNodeChanges,
  BaseEdge,
  Background,
  Controls,
  EdgeLabelRenderer,
  getBezierPath,
  Handle,
  Position,
  ReactFlow,
  ReactFlowProvider,
  useReactFlow,
  type Edge,
  type EdgeProps,
  type Node,
  type NodeChange,
  type NodeProps,
} from "@xyflow/react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useT } from "@/i18n";
import { layoutOf, type Link } from "@/lib/team";
import type { CallNode, Trace } from "@/lib/trace";
import type { Agent } from "../api";
import { cx } from "../ui";

type Status = CallNode["status"] | "idle";
type AgentData = { kind: "agent"; agent: Agent; lead: boolean; call?: CallNode; waitingOn?: string; bubbleSide: "top" | "bottom" };
type UserData = { kind: "user"; text?: string; active: boolean };
type TalkData = { color: string; label?: string; active: boolean; back: boolean; seen: boolean };

const STATUS_LABEL: Record<Status, string> = {
  idle: "disponible",
  thinking: "réfléchit",
  streaming: "répond",
  tool: "utilise un outil",
  waiting: "attend une réponse",
  done: "a terminé",
  error: "erreur",
};

const TOOL_LABEL: Record<string, string> = {
  web_search: "🔎 recherche sur le web",
  fetch_url: "🌐 lit une page",
  list_files: "📁 parcourt les fichiers",
  read_file: "📄 lit un fichier",
  write_file: "✍️ écrit un fichier",
  edit_file: "✏️ modifie un fichier",
  run_command: "⌨️ exécute une commande",
  board_list: "📋 consulte le tableau",
  board_add_card: "📋 ajoute une carte",
  board_update_card: "📋 met à jour une carte",
  search_knowledge: "📚 cherche dans la base",
};

function Bubble({ text, color, live, side, children }: { text?: string; color: string; live: boolean; side: "top" | "bottom"; children?: React.ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (ref.current) ref.current.scrollTop = ref.current.scrollHeight;
  }, [text]);
  if (!text && !children) return null;
  return (
    <div
      className={cx(
        "pop pointer-events-none absolute z-10 w-[270px] rounded-2xl border bg-surface-1/95 px-3 py-2 text-[12px] leading-relaxed text-fg shadow-xl backdrop-blur",
        side === "top" ? "bottom-[calc(100%+14px)] left-1/2 -translate-x-1/2" : "top-[calc(100%+14px)] left-1/2 -translate-x-1/2",
        !live && "opacity-70",
      )}
      style={{ borderColor: `${color}66` }}
    >
      <div ref={ref} className="max-h-[110px] overflow-hidden whitespace-pre-wrap break-words">
        {children ?? <span className={cx(live && "caret")}>{text}</span>}
      </div>
      <span
        className={cx("absolute h-3 w-3 rotate-45 border bg-surface-1", side === "top" ? "-bottom-1.5 left-1/2 -ml-1.5 border-l-0 border-t-0" : "-top-1.5 left-1/2 -ml-1.5 border-b-0 border-r-0")}
        style={{ borderColor: `${color}66` }}
      />
    </div>
  );
}

function Dots() {
  return (
    <span className="dots text-fg-muted">
      <span>●</span>
      <span>●</span>
      <span>●</span>
    </span>
  );
}

function AgentNode({ data }: NodeProps<Node<AgentData>>) {
  const { agent, call, lead, waitingOn, bubbleSide } = data;
  const { t } = useT();
  const status: Status = call?.status ?? "idle";
  const live = !!call && !["done", "error"].includes(status);
  const lastTool = call?.tools.at(-1);
  let bubble: React.ReactNode = null;
  let text: string | undefined;
  if (call) {
    if (status === "error") text = `⚠️ ${call.error}`;
    else if (call.text) text = call.text.length > 700 ? "…" + call.text.slice(-700) : call.text;
    else if (status === "waiting") bubble = <span className="text-fg-muted">⏳ {t("attend {name}…", { name: waitingOn ?? t("un coéquipier") })}</span>;
    else if (status === "tool" && lastTool) bubble = <span className="text-fg-muted">{TOOL_LABEL[lastTool.name] ? t(TOOL_LABEL[lastTool.name]) : `🔧 ${lastTool.name}`}…</span>;
    else if (live) bubble = <Dots />;
  }
  return (
    <div className="relative">
      <Handle type="target" position={Position.Left} />
      <Handle type="source" position={Position.Right} />
      <Bubble text={text} color={agent.color} live={live} side={bubbleSide}>
        {!text ? bubble : undefined}
      </Bubble>
      <div
        className={cx("flex w-[230px] cursor-pointer items-center gap-3 rounded-2xl border bg-surface-1 px-3 py-2.5 shadow-lg transition hover:bg-surface-2", live && "pulse")}
        style={{ borderColor: live ? agent.color : "var(--line)", ["--ring" as string]: `${agent.color}66` }}
      >
        <span
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-xl"
          style={{ background: `${agent.color}26`, boxShadow: `inset 0 0 0 2px ${agent.color}` }}
        >
          {agent.emoji}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <span className="truncate text-sm font-semibold">{agent.name}</span>
            {lead && (
              <span className="rounded px-1 text-[9px] font-bold uppercase tracking-wide" style={{ background: `${agent.color}33`, color: agent.color }}>
                lead
              </span>
            )}
          </div>
          <div className="truncate text-[11px] text-fg-muted">{agent.role}</div>
          <div className="mt-0.5 flex items-center gap-1 text-[10px]" style={{ color: live ? agent.color : "var(--fg-subtle)" }}>
            <span className="h-1.5 w-1.5 rounded-full" style={{ background: live ? agent.color : status === "error" ? "#ef4444" : "var(--line-strong)" }} />
            {t(STATUS_LABEL[status])}
          </div>
        </div>
      </div>
    </div>
  );
}

function UserNode({ data }: NodeProps<Node<UserData>>) {
  const { t } = useT();
  return (
    <div className="relative">
      <Handle type="source" position={Position.Right} />
      {data.text && <Bubble text={data.text.length > 400 ? data.text.slice(0, 400) + "…" : data.text} color="#94a3b8" live={data.active} side="top" />}
      <div className="flex items-center gap-2.5 rounded-2xl border border-line bg-surface-1 px-3 py-2.5 shadow-lg">
        <span className="flex h-10 w-10 items-center justify-center rounded-full bg-surface-3 text-lg">🙂</span>
        <div>
          <div className="text-sm font-semibold">{t("Vous")}</div>
          <div className="text-[11px] text-fg-muted">{data.active ? t("en attente de la réponse") : t("prêt")}</div>
        </div>
      </div>
    </div>
  );
}

function TalkEdge({ id, sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, data }: EdgeProps<Edge<TalkData>>) {
  const [path, lx, ly] = getBezierPath({ sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition });
  const d = data!;
  return (
    <>
      <BaseEdge
        id={id}
        path={path}
        className={d.active ? "edge-active" : undefined}
        style={{ stroke: d.active || d.seen ? d.color : "var(--line-strong)", strokeWidth: d.active ? 2.5 : 1.5, opacity: d.active ? 1 : d.seen ? 0.55 : 0.6 }}
      />
      {d.active && (
        <circle r={5} fill={d.color} style={{ filter: `drop-shadow(0 0 6px ${d.color})` }}>
          <animateMotion dur="1.4s" repeatCount="indefinite" path={path} keyPoints={d.back ? "1;0" : "0;1"} keyTimes="0;1" calcMode="linear" />
        </circle>
      )}
      {d.label && (
        <EdgeLabelRenderer>
          <div
            className={cx("nodrag nopan pop absolute max-w-[170px] rounded-xl border bg-surface-2 px-2.5 py-1.5 text-[11px] leading-snug shadow-lg", !d.active && "opacity-60")}
            style={{ transform: `translate(-50%, -50%) translate(${lx}px, ${ly}px)`, borderColor: `${d.color}66`, pointerEvents: "all" }}
            title={d.label}
          >
            <span className="line-clamp-3">💬 {d.label}</span>
          </div>
        </EdgeLabelRenderer>
      )}
    </>
  );
}

const nodeTypes = { agent: AgentNode, user: UserNode };
const edgeTypes = { talk: TalkEdge };

type GraphProps = {
  /** Agents shown as nodes (a project's team, or a single agent). */
  agents: Agent[];
  entries: string[];
  links: Link[];
  /** Positions from the team builder; missing ones are laid out automatically. */
  layout?: Record<string, { x: number; y: number }>;
  trace: Trace | null;
  userText?: string;
  running: boolean;
  onAgentClick?: (agentId: string) => void;
};

export function AgentGraph(props: GraphProps) {
  return (
    <ReactFlowProvider>
      <Graph {...props} />
    </ReactFlowProvider>
  );
}

/** Re-fit the view whenever the graph panel is resized (side panels opening, window resize). */
function useFitOnResize() {
  const { fitView } = useReactFlow();
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!ref.current) return;
    let t: ReturnType<typeof setTimeout>;
    const ro = new ResizeObserver(() => {
      clearTimeout(t);
      t = setTimeout(() => fitView({ padding: 0.3, duration: 250 }), 80);
    });
    ro.observe(ref.current);
    return () => (clearTimeout(t), ro.disconnect());
  }, [fitView]);
  return ref;
}

function Graph({ agents, entries, links, layout: builderLayout, trace, userText, running, onAgentClick }: GraphProps) {
  const containerRef = useFitOnResize();
  const layoutKey = [...entries, "|", ...agents.map((a) => a.id)].join(",");
  const byId = useMemo(() => new Map(agents.map((a) => [a.id, a])), [agents]);

  const layoutSig = JSON.stringify(builderLayout ?? {}) + JSON.stringify(links);
  const defaults = useMemo(() => {
    const spec = { agent_ids: agents.map((a) => a.id), entry_ids: entries, links, layout: builderLayout ?? {}, clarify: false, concert: false };
    const p: Record<string, { x: number; y: number }> = layoutOf(spec);
    const minX = Math.min(...Object.values(p).map((v) => v.x), 300);
    const ys = entries.map((id) => p[id]?.y ?? 0);
    p.user = { x: minX - 360, y: ys.length ? ys.reduce((a, b) => a + b, 0) / ys.length : 0 };
    return p;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [layoutKey, layoutSig]);

  // React Flow keeps measured sizes and drag positions on the node objects; keep them per team layout.
  type Layout = Pick<Node, "position" | "measured" | "selected" | "dragging">;
  const [layout, setLayout] = useState<{ key: string; nodes: Record<string, Layout> }>({ key: "", nodes: {} });
  const saved = (id: string) => (layout.key === layoutKey ? layout.nodes[id] : undefined);
  const pos = (id: string) => saved(id)?.position ?? defaults[id] ?? { x: 0, y: 0 };

  // Latest call per agent, and latest call per caller→callee pair (drives edges).
  const { latest, pairs } = useMemo(() => {
    const latest = new Map<string, CallNode>();
    const pairs = new Map<string, CallNode>();
    for (const id of trace?.order ?? []) {
      const c = trace!.calls[id];
      if (!c) continue;
      latest.set(c.agentId, c);
      const parent = c.parentCallId ? trace!.calls[c.parentCallId] : undefined;
      if (parent) pairs.set(`${parent.agentId}->${c.agentId}`, c);
    }
    return { latest, pairs };
  }, [trace]);
  const live = (c?: CallNode) => !!c && !["done", "error"].includes(c.status);

  const waitingName = (c?: CallNode) => {
    const pending = c?.tools.filter((t) => t.name === "ask_agent" && t.result === undefined).map((t) => byId.get(trace?.calls[t.childCallId ?? ""]?.agentId ?? "")?.name);
    return pending?.filter(Boolean).join(", ") || undefined;
  };

  const nodes: Node[] = [{ id: "user", type: "user", position: pos("user"), data: { kind: "user", text: userText, active: running } satisfies UserData }];
  for (const a of agents) {
    const c = latest.get(a.id);
    nodes.push({
      id: a.id,
      type: "agent",
      position: pos(a.id),
      data: { kind: "agent", agent: a, lead: entries.includes(a.id), call: c, waitingOn: waitingName(c), bubbleSide: entries.includes(a.id) ? "top" : "bottom" } satisfies AgentData,
    });
  }

  const edges: Edge[] = [];
  for (const id of entries) {
    const a = byId.get(id);
    if (!a) continue;
    // The user talks to the speaker (first entry) directly.
    const c = !trace?.calls ? undefined : latest.get(id);
    const direct = c && !c.parentCallId;
    edges.push({ id: `user->${id}`, source: "user", target: id, type: "talk", data: { color: a.color, active: !!direct && live(c), back: c?.status === "streaming", seen: !!direct } satisfies TalkData });
  }
  const drawn = new Set<string>();
  const addEdge = (from: string, to: string, dynamic: boolean) => {
    const key = `${from}->${to}`;
    const target = byId.get(to);
    if (drawn.has(key) || !target || !byId.has(from)) return;
    drawn.add(key);
    const c = pairs.get(key);
    edges.push({
      id: key,
      source: from,
      target: to,
      type: "talk",
      data: { color: target.color, label: c?.input, active: live(c), back: c?.status === "streaming", seen: !!c } satisfies TalkData,
      ...(dynamic ? { style: { strokeDasharray: "3 5" } } : {}),
    });
  };
  for (const l of links) addEdge(l.from, l.to, false);
  // Exchanges outside the declared links (e.g. first contacts consulting each other).
  for (const key of pairs.keys()) {
    const [from, to] = key.split("->");
    addEdge(from, to, true);
  }

  for (const n of nodes) Object.assign(n, { ...saved(n.id), position: pos(n.id) });

  const onNodesChange = (changes: NodeChange[]) => {
    const next = applyNodeChanges(changes, nodes);
    setLayout({
      key: layoutKey,
      nodes: Object.fromEntries(next.map((n) => [n.id, { position: n.position, measured: n.measured, selected: n.selected, dragging: n.dragging }])),
    });
  };

  return (
    <div ref={containerRef} className="h-full w-full">
    <ReactFlow
      key={layoutKey}
      nodes={nodes}
      edges={edges}
      nodeTypes={nodeTypes}
      edgeTypes={edgeTypes}
      onNodesChange={onNodesChange}
      onNodeClick={(_, n) => n.type === "agent" && onAgentClick?.(n.id)}
      fitView
      fitViewOptions={{ padding: 0.3 }}
      minZoom={0.3}
      maxZoom={1.6}
      proOptions={{ hideAttribution: true }}
      nodesConnectable={false}
      colorMode="dark"
    >
      <Background gap={22} size={1.2} color="var(--line)" />
      <Controls showInteractive={false} position="bottom-left" />
    </ReactFlow>
    </div>
  );
}
