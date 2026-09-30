"use client";

import { Background, Controls, Handle, Position, ReactFlow, ReactFlowProvider, type Edge, type Node, type NodeProps } from "@xyflow/react";
import { Search, X } from "lucide-react";
import { useMemo, useState } from "react";
import { api, useData, type Kb } from "./api";
import { Badge, Button, cx, Input, Select } from "./ui";

type GDoc = { id: string; name: string; kb_id: string; kb: string; tags: string[]; chunks: number; chars: number };
type Graph = { docs: GDoc[]; tags: { tag: string; count: number }[]; links: { source: string; target: string; score: number }[] };
type Hit = { docId: string; doc: string; text: string; score: number; tags: string[] };

// Validated categorical palette (dark steps). A tag always gets the same slot (hash of its name),
// so filtering never repaints the remaining constellations; hubs carry the tag name as a direct label.
const PALETTE = ["#3987e5", "#d95926", "#199e70", "#c98500", "#d55181", "#008300", "#9085e9", "#e66767"];
const UNTAGGED = "#6b7280";
export const tagColor = (tag: string) => {
  if (!tag) return UNTAGGED;
  let h = 0;
  for (const c of tag) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return PALETTE[h % PALETTE.length];
};

type BrainData = { docs: number; tags: number };
type HubData = { tag: string; count: number; color: string; dim: boolean };
type DocData = { doc: GDoc; color: string; size: number; hit: boolean; dim: boolean };

function BrainNode({ data }: NodeProps<Node<BrainData>>) {
  return (
    <div className="relative flex h-28 w-28 flex-col items-center justify-center rounded-full border-2 border-accent bg-surface-1 text-center shadow-[0_0_40px_-6px_var(--accent)]">
      <Handle type="source" position={Position.Top} className="!opacity-0" style={{ top: "50%" }} />
      <span className="text-3xl">🧠</span>
      <span className="text-[11px] text-fg-muted">
        {data.docs} doc · {data.tags} tags
      </span>
    </div>
  );
}

function HubNode({ data }: NodeProps<Node<HubData>>) {
  return (
    <div className={cx("relative rounded-full px-3 py-1.5 text-xs font-semibold text-white shadow-lg transition", data.dim && "opacity-25")} style={{ background: data.color }}>
      <Handle type="target" position={Position.Top} className="!opacity-0" style={{ top: "50%" }} />
      <Handle type="source" position={Position.Top} className="!opacity-0" style={{ top: "50%" }} />#{data.tag}
      <span className="ml-1 font-normal opacity-80">{data.count}</span>
    </div>
  );
}

function DocNode({ data }: NodeProps<Node<DocData>>) {
  return (
    <div
      className={cx("relative flex items-center justify-center rounded-full border-2 bg-surface-1 transition", data.dim && "opacity-20", data.hit && "scale-110")}
      style={{ width: data.size, height: data.size, borderColor: data.color, boxShadow: data.hit ? `0 0 0 6px ${data.color}55, 0 0 24px ${data.color}` : undefined }}
      title={`${data.doc.name}\n${data.doc.tags.map((t) => `#${t}`).join(" ") || "sans tag"} · ${data.doc.chunks} passages · ${data.doc.kb}`}
    >
      <Handle type="target" position={Position.Top} className="!opacity-0" style={{ top: "50%" }} />
      <Handle type="source" position={Position.Top} className="!opacity-0" style={{ top: "50%" }} />
      <span className="text-sm">📄</span>
      <span className="pointer-events-none absolute top-full mt-1 w-32 truncate text-center text-[10px] text-fg-muted">{data.doc.name}</span>
    </div>
  );
}

const nodeTypes = { brain: BrainNode, hub: HubNode, doc: DocNode };

/** "Brain" view of the knowledge: tags as constellations around the centre, documents as bubbles, similar documents linked. */
export function KnowledgeGraph({ onOpenDoc }: { onOpenDoc: (doc: GDoc) => void }) {
  const kbs = useData<Kb[]>("/api/crud/kbs");
  const [kbFilter, setKbFilter] = useState("");
  const [tagFilter, setTagFilter] = useState<string | null>(null);
  const graph = useData<Graph>(`/api/kb/graph${kbFilter ? `?kbIds=${kbFilter}` : ""}`);
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<Hit[] | null>(null);
  const [searching, setSearching] = useState(false);

  const g = graph.data;
  const hitIds = useMemo(() => new Set((hits ?? []).map((h) => h.docId)), [hits]);

  const { nodes, edges } = useMemo(() => {
    const nodes: Node[] = [];
    const edges: Edge[] = [];
    if (!g) return { nodes, edges };
    // One constellation per primary tag (a document's first tag), untagged documents in their own group.
    const groups = new Map<string, GDoc[]>();
    for (const d of g.docs) {
      const key = d.tags[0] ?? "";
      groups.set(key, [...(groups.get(key) ?? []), d]);
    }
    const keys = [...groups.keys()].sort((a, b) => (a ? 0 : 1) - (b ? 0 : 1) || (groups.get(b)!.length - groups.get(a)!.length));
    nodes.push({ id: "brain", type: "brain", position: { x: -56, y: -56 }, data: { docs: g.docs.length, tags: g.tags.length } satisfies BrainData, draggable: false });
    const R = Math.max(300, 90 * keys.length);
    keys.forEach((key, i) => {
      const angle = (i / keys.length) * Math.PI * 2 - Math.PI / 2;
      const cx0 = Math.cos(angle) * R;
      const cy0 = Math.sin(angle) * R;
      const color = tagColor(key);
      const hubId = `hub:${key || "_"}`;
      const dimHub = !!tagFilter && tagFilter !== key;
      nodes.push({ id: hubId, type: "hub", position: { x: cx0 - 40, y: cy0 - 14 }, data: { tag: key || "sans tag", count: groups.get(key)!.length, color, dim: dimHub } satisfies HubData });
      edges.push({ id: `e-brain-${hubId}`, source: "brain", target: hubId, style: { stroke: color, strokeWidth: 2, opacity: dimHub ? 0.15 : 0.6 } });
      // Documents on a small spiral around their hub, pushed outwards from the centre.
      groups.get(key)!.forEach((d, j) => {
        const a = angle + (j - (groups.get(key)!.length - 1) / 2) * 0.55;
        const r = 120 + 34 * Math.floor(j / 6);
        const size = Math.min(58, 30 + Math.sqrt(d.chunks) * 5);
        const dim = (!!tagFilter && !d.tags.includes(tagFilter)) || (!!hits && !hitIds.has(d.id));
        nodes.push({
          id: d.id,
          type: "doc",
          position: { x: cx0 + Math.cos(a) * r - size / 2, y: cy0 + Math.sin(a) * r - size / 2 },
          data: { doc: d, color, size, hit: hitIds.has(d.id), dim } satisfies DocData,
        });
        edges.push({ id: `e-${hubId}-${d.id}`, source: hubId, target: d.id, style: { stroke: color, strokeWidth: 1.2, opacity: dim ? 0.1 : 0.45 } });
      });
    });
    for (const l of g.links)
      edges.push({ id: `sim-${l.source}-${l.target}`, source: l.source, target: l.target, style: { stroke: "var(--fg-subtle)", strokeWidth: 1, strokeDasharray: "3 5", opacity: 0.5 } });
    return { nodes, edges };
  }, [g, tagFilter, hits, hitIds]);

  async function runSearch() {
    if (!q.trim()) return setHits(null);
    setSearching(true);
    try {
      const ids = kbFilter ? [kbFilter] : (kbs.data ?? []).map((k) => k.id);
      setHits(await api<Hit[]>("/api/kb/search", { method: "POST", json: { kbIds: ids, query: q, k: 6, tags: tagFilter ? [tagFilter] : [] } }));
    } finally {
      setSearching(false);
    }
  }

  return (
    <div className="flex h-full min-h-0">
      <div className="relative min-w-0 flex-1">
        <div className="absolute left-3 right-3 top-3 z-10 flex flex-wrap items-center gap-2">
          <Select className="h-8 w-52 text-xs" value={kbFilter} onChange={(e) => (setKbFilter(e.target.value), setHits(null))}>
            <option value="">Toutes les bases</option>
            {(kbs.data ?? []).map((k) => (
              <option key={k.id} value={k.id}>
                📚 {k.name}
              </option>
            ))}
          </Select>
          <div className="flex flex-wrap gap-1">
            {(g?.tags ?? []).map((t) => (
              <button
                key={t.tag}
                onClick={() => setTagFilter(tagFilter === t.tag ? null : t.tag)}
                className={cx("rounded-full border px-2 py-0.5 text-[11px]", tagFilter === t.tag ? "text-white" : "bg-surface-1/90 text-fg-muted")}
                style={{ borderColor: tagColor(t.tag), background: tagFilter === t.tag ? tagColor(t.tag) : undefined }}
              >
                #{t.tag} <span className="opacity-70">{t.count}</span>
              </button>
            ))}
          </div>
        </div>
        {g && !g.docs.length ? (
          <div className="flex h-full items-center justify-center text-sm text-fg-subtle">Aucun document indexé pour l&apos;instant.</div>
        ) : (
          <ReactFlowProvider>
            <ReactFlow
              key={`${kbFilter}-${g?.docs.length ?? 0}`}
              nodes={nodes}
              edges={edges}
              nodeTypes={nodeTypes}
              onNodeClick={(_, n) => n.type === "doc" && onOpenDoc((n.data as DocData).doc)}
              fitView
              fitViewOptions={{ padding: 0.15 }}
              minZoom={0.2}
              maxZoom={1.8}
              proOptions={{ hideAttribution: true }}
              nodesConnectable={false}
              colorMode="dark"
            >
              <Background gap={22} size={1.2} color="var(--line)" />
              <Controls showInteractive={false} position="bottom-left" />
            </ReactFlow>
          </ReactFlowProvider>
        )}
      </div>

      {/* guided search */}
      <aside className="flex w-80 shrink-0 flex-col border-l border-line bg-surface-0">
        <div className="border-b border-line p-3">
          <div className="mb-2 text-sm font-semibold">Recherche guidée</div>
          <form
            className="flex gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              runSearch();
            }}
          >
            <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Pose une question…" className="h-8 text-xs" />
            <Button size="sm" type="submit" disabled={searching}>
              <Search size={13} />
            </Button>
          </form>
          <p className="mt-2 text-[11px] text-fg-subtle">
            {tagFilter ? (
              <>
                Limitée à <b style={{ color: tagColor(tagFilter) }}>#{tagFilter}</b>.{" "}
              </>
            ) : (
              "Clique un tag pour cibler une thématique. "
            )}
            Les documents trouvés s&apos;allument dans le graphe.
          </p>
        </div>
        <div className="flex-1 overflow-y-auto p-3">
          {hits && (
            <div className="mb-2 flex items-center justify-between text-xs text-fg-muted">
              <span>{hits.length} passage(s)</span>
              <button onClick={() => setHits(null)} className="flex items-center gap-1 hover:text-fg">
                <X size={12} /> effacer
              </button>
            </div>
          )}
          <div className="flex flex-col gap-2">
            {hits?.map((h, i) => (
              <div key={i} className="rounded-lg border border-line bg-surface-1 p-2.5 text-xs">
                <div className="mb-1 flex items-center justify-between gap-2">
                  <span className="truncate font-medium">{h.doc}</span>
                  <span className="shrink-0 tabular-nums text-fg-subtle">{h.score.toFixed(2)}</span>
                </div>
                <div className="mb-1.5 flex flex-wrap gap-1">
                  {h.tags.map((t) => (
                    <Badge key={t} color={tagColor(t)}>
                      #{t}
                    </Badge>
                  ))}
                </div>
                <div className="line-clamp-5 whitespace-pre-wrap text-fg-muted">{h.text}</div>
              </div>
            ))}
            {hits && !hits.length && <div className="text-xs text-fg-subtle">Aucun passage pertinent.</div>}
          </div>
        </div>
      </aside>
    </div>
  );
}

export type { GDoc };
