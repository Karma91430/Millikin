"use client";

import {
  applyNodeChanges,
  Background,
  BaseEdge,
  Controls,
  EdgeLabelRenderer,
  getBezierPath,
  Handle,
  MarkerType,
  Position,
  ReactFlow,
  ReactFlowProvider,
  type Connection,
  type Edge,
  type EdgeProps,
  type Node,
  type NodeChange,
  type NodeProps,
} from "@xyflow/react";
import { LayoutGrid, Search, Star, UserPlus, X } from "lucide-react";
import { useMemo, useState } from "react";
import { layoutOf, type TeamSpec } from "@/lib/team";
import { crud, type Agent } from "./api";
import { ProfilePicker } from "./ProfilePicker";
import { Avatar, Button, cx, Input } from "./ui";
import { fromProfile } from "./views/AgentsView";

type AgentNodeData = { agent: Agent; entry: boolean; toggleEntry: () => void; remove: () => void };
type LinkData = { remove: () => void };

function BuilderNode({ data, selected }: NodeProps<Node<AgentNodeData>>) {
  const { agent, entry } = data;
  return (
    <div
      className={cx("group relative flex w-[220px] items-center gap-2.5 rounded-2xl border bg-surface-1 px-3 py-2.5 shadow-lg", selected && "ring-2 ring-accent/60")}
      style={{ borderColor: entry ? agent.color : "var(--line-strong)" }}
    >
      <Handle type="target" position={Position.Left} className="!h-3 !w-3 !border-2 !border-surface-0 !bg-fg-subtle !opacity-100" />
      <Handle type="source" position={Position.Right} className="!h-3 !w-3 !border-2 !border-surface-0 !opacity-100" style={{ background: agent.color }} />
      <Avatar emoji={agent.emoji} color={agent.color} size={38} />
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-semibold">{agent.name}</div>
        <div className="truncate text-[11px] text-fg-muted">{agent.role}</div>
        {entry && (
          <div className="mt-0.5 text-[10px] font-semibold" style={{ color: agent.color }}>
            ★ premier contact
          </div>
        )}
      </div>
      <div className="nodrag absolute -top-3 right-2 flex gap-1 opacity-0 transition group-hover:opacity-100">
        <button
          onClick={data.toggleEntry}
          title={entry ? "Retirer des premiers contacts" : "Définir comme premier contact"}
          className={cx("flex h-6 w-6 items-center justify-center rounded-full border border-line bg-surface-2", entry ? "text-amber-400" : "text-fg-subtle hover:text-amber-400")}
        >
          <Star size={12} fill={entry ? "currentColor" : "none"} />
        </button>
        <button onClick={data.remove} title="Retirer de l'équipe" className="flex h-6 w-6 items-center justify-center rounded-full border border-line bg-surface-2 text-fg-subtle hover:text-red-400">
          <X size={12} />
        </button>
      </div>
    </div>
  );
}

function UserNode() {
  return (
    <div className="flex items-center gap-2 rounded-2xl border border-dashed border-line-strong bg-surface-1 px-3 py-2.5">
      <Handle type="source" position={Position.Right} className="!opacity-0" isConnectable={false} />
      <span className="flex h-9 w-9 items-center justify-center rounded-full bg-surface-3 text-lg">🙂</span>
      <div>
        <div className="text-sm font-semibold">Vous</div>
        <div className="text-[11px] text-fg-muted">parlez aux ★</div>
      </div>
    </div>
  );
}

function LinkEdge({ id, sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, data, markerEnd, selected, style }: EdgeProps<Edge<LinkData>>) {
  const [path, lx, ly] = getBezierPath({ sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition });
  return (
    <>
      <BaseEdge id={id} path={path} markerEnd={markerEnd} style={{ ...style, strokeWidth: selected ? 2.5 : 1.8 }} />
      {data && (
        <EdgeLabelRenderer>
          <button
            onClick={data.remove}
            title="Supprimer ce lien"
            className={cx(
              "nodrag nopan absolute flex h-5 w-5 items-center justify-center rounded-full border border-line bg-surface-2 text-fg-subtle transition hover:text-red-400",
              selected ? "opacity-100" : "opacity-40 hover:opacity-100",
            )}
            style={{ transform: `translate(-50%, -50%) translate(${lx}px, ${ly}px)`, pointerEvents: "all" }}
          >
            <X size={11} />
          </button>
        </EdgeLabelRenderer>
      )}
    </>
  );
}

const nodeTypes = { agent: BuilderNode, user: UserNode };
const edgeTypes = { link: LinkEdge };

type NodeUi = Pick<Node, "measured" | "selected" | "dragging" | "position">;

function Canvas({ agents, value, onChange }: { agents: Agent[]; value: TeamSpec; onChange: (s: TeamSpec) => void }) {
  const byId = useMemo(() => new Map(agents.map((a) => [a.id, a])), [agents]);
  const [ui, setUi] = useState<Record<string, NodeUi>>({});
  const layout = layoutOf(value);
  const entries = new Set(value.entry_ids);
  const minX = Math.min(...Object.values(layout).map((p) => p.x), 300);
  const entryYs = value.entry_ids.map((id) => layout[id]?.y ?? 0);
  const userPos = { x: minX - 330, y: entryYs.length ? entryYs.reduce((a, b) => a + b, 0) / entryYs.length : 0 };

  const set = (patch: Partial<TeamSpec>) => onChange({ ...value, ...patch });
  const toggleEntry = (id: string) => set({ entry_ids: entries.has(id) ? value.entry_ids.filter((x) => x !== id) : [...value.entry_ids, id] });
  const remove = (id: string) =>
    set({
      agent_ids: value.agent_ids.filter((x) => x !== id),
      entry_ids: value.entry_ids.filter((x) => x !== id),
      links: value.links.filter((l) => l.from !== id && l.to !== id),
    });

  const nodes: Node[] = [
    { id: "__user", type: "user", position: userPos, draggable: false, selectable: false, data: {} },
    ...value.agent_ids
      .filter((id) => byId.has(id))
      .map((id) => ({
        id,
        type: "agent",
        ...ui[id],
        position: ui[id]?.dragging && ui[id]?.position ? ui[id].position! : layout[id],
        data: { agent: byId.get(id)!, entry: entries.has(id), toggleEntry: () => toggleEntry(id), remove: () => remove(id) } satisfies AgentNodeData,
      })),
  ];
  const edges: Edge[] = [
    ...value.entry_ids.map((id) => ({
      id: `__user-${id}`,
      source: "__user",
      target: id,
      selectable: false,
      style: { stroke: "var(--line-strong)", strokeDasharray: "5 5" },
      markerEnd: { type: MarkerType.ArrowClosed, color: "var(--line-strong)" },
    })),
    ...value.links
      .filter((l) => byId.has(l.from) && byId.has(l.to))
      .map((l) => ({
        id: `${l.from}->${l.to}`,
        source: l.from,
        target: l.to,
        type: "link",
        style: { stroke: byId.get(l.to)!.color },
        markerEnd: { type: MarkerType.ArrowClosed, color: byId.get(l.to)!.color },
        data: { remove: () => set({ links: value.links.filter((x) => !(x.from === l.from && x.to === l.to)) }) } satisfies LinkData,
      })),
  ];

  const onNodesChange = (changes: NodeChange[]) => {
    const next = applyNodeChanges(changes, nodes);
    setUi(Object.fromEntries(next.map((n) => [n.id, { measured: n.measured, selected: n.selected, dragging: n.dragging, position: n.position }])));
  };

  return (
    <ReactFlow
      nodes={nodes}
      edges={edges}
      nodeTypes={nodeTypes}
      edgeTypes={edgeTypes}
      onNodesChange={onNodesChange}
      onNodeDragStop={(_, n) => set({ layout: { ...layoutOf(value), [n.id]: n.position } })}
      onConnect={(c: Connection) => {
        if (!c.source || !c.target || c.source === c.target || c.source === "__user") return;
        if (value.links.some((l) => l.from === c.source && l.to === c.target)) return;
        set({ links: [...value.links, { from: c.source, to: c.target }] });
      }}
      onEdgesDelete={(es) => set({ links: value.links.filter((l) => !es.some((e) => e.id === `${l.from}->${l.to}`)) })}
      fitView
      fitViewOptions={{ padding: 0.25 }}
      minZoom={0.3}
      maxZoom={1.5}
      proOptions={{ hideAttribution: true }}
      colorMode="dark"
      deleteKeyCode={["Backspace", "Delete"]}
    >
      <Background gap={22} size={1.2} color="var(--line)" />
      <Controls showInteractive={false} position="bottom-left" />
    </ReactFlow>
  );
}

/** Visual team editor: add agents, draw "can delegate to" links, mark first contacts. */
export function TeamBuilder({ agents, value, onChange, onAgentCreated }: { agents: Agent[]; value: TeamSpec; onChange: (s: TeamSpec) => void; onAgentCreated?: () => void }) {
  const [q, setQ] = useState("");
  const [picker, setPicker] = useState(false);
  const [created, setCreated] = useState<Agent[]>([]);
  const all = useMemo(() => [...agents, ...created.filter((c) => !agents.some((a) => a.id === c.id))], [agents, created]);
  const available = all.filter((a) => !value.agent_ids.includes(a.id) && (!q || `${a.name} ${a.role}`.toLowerCase().includes(q.toLowerCase())));

  const add = (id: string) => {
    const layout = layoutOf(value);
    const maxX = Math.max(300, ...Object.values(layout).map((p) => p.x));
    const col = Object.values(layout).filter((p) => p.x === maxX).length;
    onChange({
      ...value,
      agent_ids: [...value.agent_ids, id],
      entry_ids: value.entry_ids.length ? value.entry_ids : [id],
      layout: { ...layout, [id]: { x: value.agent_ids.length ? maxX : 300, y: col * 200 } },
    });
  };

  return (
    <div className="flex h-full min-h-0 rounded-xl border border-line">
      <div className="flex w-60 shrink-0 flex-col border-r border-line">
        <div className="border-b border-line p-2.5">
          <Button size="sm" variant="soft" className="w-full" onClick={() => setPicker(true)}>
            <UserPlus size={13} /> Nouvel agent depuis un profil
          </Button>
          <div className="relative mt-2">
            <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-fg-subtle" />
            <Input className="h-8 pl-7 text-xs" placeholder="Agents existants…" value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
        </div>
        <div className="flex-1 overflow-y-auto p-1.5">
          {available.map((a) => (
            <button key={a.id} onClick={() => add(a.id)} className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left hover:bg-surface-2" title="Ajouter à l'équipe">
              <Avatar emoji={a.emoji} color={a.color} size={26} />
              <span className="min-w-0">
                <span className="block truncate text-xs font-medium">{a.name}</span>
                <span className="block truncate text-[10px] text-fg-subtle">{a.role}</span>
              </span>
            </button>
          ))}
          {!available.length && <div className="p-2 text-[11px] text-fg-subtle">Tous les agents sont déjà dans l&apos;équipe.</div>}
        </div>
      </div>
      <div className="relative min-w-0 flex-1">
        <div className="pointer-events-none absolute left-3 right-3 top-3 z-10 flex items-start justify-between gap-3">
          <div className="rounded-lg bg-surface-1/90 px-3 py-2 text-[11px] leading-relaxed text-fg-muted backdrop-blur">
            Tire un lien depuis le <b>point de droite</b> d&apos;un agent vers un autre : « peut lui déléguer du travail ».
            <br />
            Survole un agent : <Star size={10} className="inline" /> premier contact · <X size={10} className="inline" /> retirer. Clique un lien puis Suppr pour l&apos;effacer.
          </div>
          <Button size="sm" variant="soft" className="pointer-events-auto" onClick={() => onChange({ ...value, layout: {} })} title="Disposition automatique">
            <LayoutGrid size={13} /> Réorganiser
          </Button>
        </div>
        <ReactFlowProvider>
          <Canvas agents={all} value={value} onChange={onChange} />
        </ReactFlowProvider>
      </div>
      <ProfilePicker
        open={picker}
        title="Ajouter un membre"
        onClose={() => setPicker(false)}
        onPick={async (p) => {
          setPicker(false);
          const agent = await crud.save<Agent>("agents", fromProfile(p));
          setCreated((c) => [...c, agent]);
          add(agent.id);
          onAgentCreated?.();
        }}
      />
    </div>
  );
}
