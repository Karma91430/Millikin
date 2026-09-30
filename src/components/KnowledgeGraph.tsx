"use client";

import { forceCollide, forceLink, forceManyBody, forceRadial, forceSimulation, forceX, forceY, type SimulationLinkDatum, type SimulationNodeDatum } from "d3-force";
import { ArrowDown, ArrowUp, Pause, Play, RotateCcw, Search, SkipBack, SkipForward, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { api, useData, type Kb } from "./api";
import { Badge, Button, cx, Input, Select } from "./ui";

type GDoc = { id: string; name: string; kb_id: string; kb: string; tags: string[]; chunks: number; chars: number };
type Graph = { docs: GDoc[]; tags: { tag: string; count: number }[]; links: { source: string; target: string; score: number }[] };
type Candidate = { id: string; docId: string; doc: string; tags: string[]; text: string; vector: number; lexical?: number; hybrid?: number; mmr?: number; llm?: number };
type Stage = { id: "vector" | "hybrid" | "mmr" | "llm" | "final"; label: string; detail: string; order: string[]; scores: Record<string, number>; ms: number };
type Pipeline = { query: string; candidates: Candidate[]; stages: Stage[]; final: string[]; total: number };

// Validated categorical palette (dark steps). A tag always gets the same slot (hash of its name),
// so filtering never repaints the remaining constellations; nebulae carry the tag name as a direct label.
const PALETTE = ["#3987e5", "#d95926", "#199e70", "#c98500", "#d55181", "#008300", "#9085e9", "#e66767"];
const UNTAGGED = "#6b7280";
const GOLD = "#f5c451";
export const tagColor = (tag: string) => {
  if (!tag) return UNTAGGED;
  let h = 0;
  for (const c of tag) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return PALETTE[h % PALETTE.length];
};

type SimNode = SimulationNodeDatum & { id: string; kind: "brain" | "hub" | "doc"; tag: string; r: number; doc?: GDoc; count?: number };
type SimLink = SimulationLinkDatum<SimNode> & { kind: "hub" | "doc" | "sim" };

const reduceMotion = () => typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/** Deterministic star field so the background doesn't reshuffle on every render. */
const STARS = Array.from({ length: 140 }, (_, i) => {
  const x = Math.sin(i * 12.9898) * 43758.5453;
  const y = Math.sin(i * 78.233) * 12345.6789;
  return { x: (x - Math.floor(x)) * 2400 - 1200, y: (y - Math.floor(y)) * 1800 - 900, r: ((i * 7) % 10) / 10 + 0.3, o: ((i * 13) % 10) / 20 + 0.15 };
});

/** Physics layout: hubs on a ring around the brain, documents pulled to their hub, similar documents attracted. */
function useLayout(g?: Graph) {
  const [nodes, setNodes] = useState<SimNode[]>([]);
  const [links, setLinks] = useState<SimLink[]>([]);
  useEffect(() => {
    if (!g) return;
    const groups = new Map<string, GDoc[]>();
    for (const d of g.docs) groups.set(d.tags[0] ?? "", [...(groups.get(d.tags[0] ?? "") ?? []), d]);
    const ns: SimNode[] = [{ id: "brain", kind: "brain", tag: "", r: 46, fx: 0, fy: 0 }];
    const ls: SimLink[] = [];
    const keys = [...groups.keys()];
    keys.forEach((key, i) => {
      const a = (i / Math.max(1, keys.length)) * Math.PI * 2 - Math.PI / 2;
      const hub: SimNode = { id: `hub:${key || "_"}`, kind: "hub", tag: key, r: 18, count: groups.get(key)!.length, x: Math.cos(a) * 280, y: Math.sin(a) * 280 };
      ns.push(hub);
      ls.push({ source: "brain", target: hub.id, kind: "hub" });
      for (const d of groups.get(key)!) {
        ns.push({ id: d.id, kind: "doc", tag: key, r: Math.min(26, 11 + Math.sqrt(d.chunks) * 3.2), doc: d, x: hub.x! + (Math.random() - 0.5) * 80, y: hub.y! + (Math.random() - 0.5) * 80 });
        ls.push({ source: hub.id, target: d.id, kind: "doc" });
      }
    });
    for (const l of g.links) ls.push({ source: l.source, target: l.target, kind: "sim" });
    const sim = forceSimulation<SimNode>(ns)
      .force(
        "link",
        forceLink<SimNode, SimLink>(ls)
          .id((d) => d.id)
          .distance((l) => (l.kind === "hub" ? 280 : l.kind === "doc" ? 70 : 110))
          .strength((l) => (l.kind === "hub" ? 0.9 : l.kind === "doc" ? 0.6 : 0.08)),
      )
      .force("charge", forceManyBody<SimNode>().strength((d) => (d.kind === "doc" ? -90 : d.kind === "hub" ? -260 : -600)))
      .force("collide", forceCollide<SimNode>().radius((d) => d.r + 10))
      .force("ring", forceRadial<SimNode>((d) => (d.kind === "hub" ? 280 : d.kind === "doc" ? 360 : 0), 0, 0).strength((d) => (d.kind === "hub" ? 0.5 : 0.04)))
      .force("x", forceX(0).strength(0.01))
      .force("y", forceY(0).strength(0.01))
      .alphaDecay(0.035);
    let frame = 0;
    sim.on("tick", () => {
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        setNodes([...ns]);
        setLinks([...ls]);
      });
    });
    if (reduceMotion()) sim.tick(300);
    return () => {
      sim.stop();
      cancelAnimationFrame(frame);
    };
  }, [g]);
  return { nodes, links };
}

/** Wheel zoom around the cursor and drag-to-pan on the background. */
function usePanZoom() {
  const [view, setView] = useState({ x: 0, y: 0, k: 0.75 });
  const drag = useRef<{ x: number; y: number; vx: number; vy: number } | null>(null);
  const handlers = {
    onWheel: (e: React.WheelEvent<SVGSVGElement>) => {
      const rect = e.currentTarget.getBoundingClientRect();
      const mx = e.clientX - rect.left - rect.width / 2;
      const my = e.clientY - rect.top - rect.height / 2;
      setView((v) => {
        const k = Math.min(2.5, Math.max(0.25, v.k * (e.deltaY < 0 ? 1.12 : 0.89)));
        return { k, x: mx - ((mx - v.x) * k) / v.k, y: my - ((my - v.y) * k) / v.k };
      });
    },
    onPointerDown: (e: React.PointerEvent<SVGSVGElement>) => {
      if ((e.target as Element).closest("[data-node]")) return;
      drag.current = { x: e.clientX, y: e.clientY, vx: view.x, vy: view.y };
      e.currentTarget.setPointerCapture(e.pointerId);
    },
    onPointerMove: (e: React.PointerEvent<SVGSVGElement>) => {
      const d = drag.current;
      if (d) setView((v) => ({ ...v, x: d.vx + e.clientX - d.x, y: d.vy + e.clientY - d.y }));
    },
    onPointerUp: () => (drag.current = null),
  };
  return { view, setView, handlers };
}

const STAGE_MS = 1700;

export function KnowledgeGraph({ onOpenDoc }: { onOpenDoc: (doc: GDoc) => void }) {
  const kbs = useData<Kb[]>("/api/crud/kbs");
  const [kbFilter, setKbFilter] = useState("");
  const [tagFilter, setTagFilter] = useState<string | null>(null);
  const graph = useData<Graph>(`/api/kb/graph${kbFilter ? `?kbIds=${kbFilter}` : ""}`);
  const { nodes, links } = useLayout(graph.data);
  const { view, setView, handlers } = usePanZoom();
  const [hover, setHover] = useState<string | null>(null);
  // Scene origin (the brain) sits at the centre of the panel.
  const boxRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 800, h: 600 });
  useEffect(() => {
    const el = boxRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setSize({ w: el.clientWidth, h: el.clientHeight }));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // ---- search lab state
  const [q, setQ] = useState("");
  const [hybrid, setHybrid] = useState(true);
  const [alpha, setAlpha] = useState(0.6);
  const [rerank, setRerank] = useState<"none" | "mmr" | "llm">("mmr");
  const [lambda, setLambda] = useState(0.7);
  const [k, setK] = useState(4);
  const [pipeline, setPipeline] = useState<Pipeline | null>(null);
  const [stageIdx, setStageIdx] = useState(-1);
  const [playing, setPlaying] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  // Auto-advance through the stages while playing.
  useEffect(() => {
    if (!playing || !pipeline) return;
    if (stageIdx >= pipeline.stages.length - 1) {
      const t = setTimeout(() => setPlaying(false), 0);
      return () => clearTimeout(t);
    }
    const t = setTimeout(() => setStageIdx((i) => i + 1), stageIdx < 0 ? 900 : STAGE_MS);
    return () => clearTimeout(t);
  }, [playing, stageIdx, pipeline]);

  async function run() {
    if (!q.trim()) return;
    setBusy(true);
    setError(undefined);
    setPipeline(null);
    setStageIdx(-1);
    try {
      const ids = kbFilter ? [kbFilter] : (kbs.data ?? []).map((x) => x.id);
      const p = await api<Pipeline>("/api/kb/search/trace", {
        method: "POST",
        json: { kbIds: ids, query: q, k, hybrid, alpha, rerank, lambda, candidates: 16, tags: tagFilter ? [tagFilter] : [] },
      });
      setPipeline(p);
      setStageIdx(-1);
      setPlaying(true);
      setView((v) => ({ ...v, x: 0, y: 0 }));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  const stage = pipeline && stageIdx >= 0 ? pipeline.stages[stageIdx] : null;
  const prevStage = pipeline && stageIdx > 0 ? pipeline.stages[stageIdx - 1] : null;
  const cands = useMemo(() => new Map((pipeline?.candidates ?? []).map((c) => [c.id, c])), [pipeline]);
  const isFinal = stage?.id === "final";
  // Best rank per document at the current stage (a document can hold several candidate passages).
  const docRank = useMemo(() => {
    const m = new Map<string, number>();
    const order = stage ? (isFinal ? stage.order : stage.order.slice(0, 10)) : [];
    order.forEach((id, i) => {
      const d = cands.get(id)?.docId;
      if (d && !m.has(d)) m.set(d, i);
    });
    return m;
  }, [stage, cands, isFinal]);

  const pos = useMemo(() => new Map(nodes.map((n) => [n.id, n])), [nodes]);
  const clusters = useMemo(() => {
    const m = new Map<string, { x: number; y: number; r: number; count: number }>();
    for (const n of nodes.filter((x) => x.kind === "doc")) {
      const c = m.get(n.tag) ?? { x: 0, y: 0, r: 0, count: 0 };
      c.x += n.x ?? 0;
      c.y += n.y ?? 0;
      c.count++;
      m.set(n.tag, c);
    }
    for (const [tag, c] of m) {
      c.x /= c.count;
      c.y /= c.count;
      c.r = Math.max(90, ...nodes.filter((n) => n.kind === "doc" && n.tag === tag).map((n) => Math.hypot((n.x ?? 0) - c.x, (n.y ?? 0) - c.y) + n.r + 40));
    }
    return m;
  }, [nodes]);

  const dimDoc = (n: SimNode) => (!!tagFilter && !n.doc?.tags.includes(tagFilter)) || (!!stage && !docRank.has(n.id));
  const g = graph.data;
  const queryPos = { x: 0, y: -80 };

  return (
    <div className="flex h-full min-h-0">
      <div ref={boxRef} className="relative min-w-0 flex-1 overflow-hidden bg-[#07080c]">
        {/* filters */}
        <div className="absolute left-3 right-3 top-3 z-10 flex flex-wrap items-center gap-2">
          <Select className="h-8 w-52 text-xs" value={kbFilter} onChange={(e) => (setKbFilter(e.target.value), setPipeline(null))}>
            <option value="">Toutes les bases</option>
            {(kbs.data ?? []).map((x) => (
              <option key={x.id} value={x.id}>
                📚 {x.name}
              </option>
            ))}
          </Select>
          <div className="flex flex-wrap gap-1">
            {(g?.tags ?? []).map((t) => (
              <button
                key={t.tag}
                onClick={() => setTagFilter(tagFilter === t.tag ? null : t.tag)}
                className={cx("rounded-full border px-2 py-0.5 text-[11px] backdrop-blur", tagFilter === t.tag ? "text-white" : "bg-black/40 text-fg-muted")}
                style={{ borderColor: tagColor(t.tag), background: tagFilter === t.tag ? tagColor(t.tag) : undefined }}
              >
                #{t.tag} <span className="opacity-70">{t.count}</span>
              </button>
            ))}
          </div>
        </div>
        <div className="absolute bottom-3 left-3 z-10 flex gap-1">
          <Button size="sm" variant="soft" onClick={() => setView({ x: 0, y: 0, k: 0.75 })} title="Recentrer">
            <RotateCcw size={13} />
          </Button>
        </div>
        {g && !g.docs.length ? (
          <div className="flex h-full items-center justify-center text-sm text-fg-subtle">Aucun document indexé pour l&apos;instant.</div>
        ) : (
          <svg className="h-full w-full cursor-grab touch-none select-none active:cursor-grabbing" {...handlers}>
            <defs>
              <radialGradient id="kg-brain" cx="50%" cy="45%" r="60%">
                <stop offset="0%" stopColor="#b9adff" />
                <stop offset="55%" stopColor="#7c6cf6" />
                <stop offset="100%" stopColor="#3b2f9e" />
              </radialGradient>
              {[...new Set(nodes.map((n) => n.tag))].map((t) => (
                <radialGradient key={t || "_"} id={`kg-neb-${(t || "_").replace(/[^a-z0-9]/gi, "_")}`}>
                  <stop offset="0%" stopColor={tagColor(t)} stopOpacity="0.28" />
                  <stop offset="60%" stopColor={tagColor(t)} stopOpacity="0.1" />
                  <stop offset="100%" stopColor={tagColor(t)} stopOpacity="0" />
                </radialGradient>
              ))}
              <filter id="kg-glow" x="-100%" y="-100%" width="300%" height="300%">
                <feGaussianBlur stdDeviation="6" result="b" />
                <feMerge>
                  <feMergeNode in="b" />
                  <feMergeNode in="SourceGraphic" />
                </feMerge>
              </filter>
            </defs>
            <style>{`
              @keyframes kg-float { 0%,100% { transform: translate(0,0) } 50% { transform: translate(0,-5px) } }
              @keyframes kg-pulse { 0%,100% { opacity:.55; transform: scale(1) } 50% { opacity:.15; transform: scale(1.18) } }
              @keyframes kg-flow { to { stroke-dashoffset: -28 } }
              @keyframes kg-ripple { from { r: 40; opacity: .6 } to { r: 900; opacity: 0 } }
              @keyframes kg-twinkle { 0%,100% { opacity: var(--o) } 50% { opacity: calc(var(--o) * .3) } }
              .kg-float { animation: kg-float 6s ease-in-out infinite; transform-box: fill-box; }
              .kg-pulse { animation: kg-pulse 3.2s ease-in-out infinite; transform-box: fill-box; transform-origin: center; }
              .kg-flow { animation: kg-flow 1.6s linear infinite; }
              .kg-beam { transition: stroke-width .6s, opacity .6s, stroke .6s; }
              .kg-doc circle { transition: r .4s, opacity .4s, stroke .4s; }
              @media (prefers-reduced-motion: reduce) { .kg-float, .kg-pulse, .kg-flow { animation: none } }
            `}</style>
            <g transform={`translate(${size.w / 2 + view.x} ${size.h / 2 + view.y}) scale(${view.k})`}>
              <g transform="translate(0 0)">
                {/* stars */}
                {STARS.map((s, i) => (
                  <circle key={i} cx={s.x} cy={s.y} r={s.r} fill="#fff" style={{ ["--o" as string]: s.o, opacity: s.o, animation: `kg-twinkle ${4 + (i % 5)}s ease-in-out ${i % 7}s infinite` }} />
                ))}
                {/* nebulae */}
                {[...clusters].map(([tag, c]) => (
                  <g key={tag || "_"} opacity={tagFilter && tagFilter !== tag ? 0.25 : 1}>
                    <circle cx={c.x} cy={c.y} r={c.r} fill={`url(#kg-neb-${(tag || "_").replace(/[^a-z0-9]/gi, "_")})`} />
                  </g>
                ))}
                {/* search ripple */}
                {stage?.id === "vector" && <circle key={`ripple-${pipeline?.query}`} cx={0} cy={0} fill="none" stroke="#b9adff" strokeWidth={2} style={{ animation: "kg-ripple 1.6s ease-out" }} />}
                {/* links */}
                {links.map((l, i) => {
                  const s = l.source as SimNode;
                  const t = l.target as SimNode;
                  if (!s.x || !t.x) return null;
                  if (l.kind === "sim")
                    return <line key={i} x1={s.x} y1={s.y} x2={t.x} y2={t.y} stroke="#8b93a7" strokeOpacity={stage ? 0.08 : 0.3} strokeWidth={1} strokeDasharray="3 6" className="kg-flow" />;
                  const color = tagColor(t.tag);
                  return <line key={i} x1={s.x} y1={s.y} x2={t.x} y2={t.y} stroke={l.kind === "hub" ? color : color} strokeOpacity={stage ? 0.06 : l.kind === "hub" ? 0.35 : 0.22} strokeWidth={l.kind === "hub" ? 2 : 1} />;
                })}
                {/* search beams: query → documents holding candidate passages */}
                {stage &&
                  [...docRank].map(([docId, rank]) => {
                    const n = pos.get(docId);
                    if (!n?.x) return null;
                    const color = isFinal ? GOLD : "#b9adff";
                    const w = isFinal ? 3 : Math.max(0.8, 4 - rank * 0.35);
                    return (
                      <line
                        key={docId}
                        className="kg-beam kg-flow"
                        x1={queryPos.x}
                        y1={queryPos.y}
                        x2={n.x}
                        y2={n.y}
                        stroke={color}
                        strokeWidth={w}
                        strokeOpacity={isFinal ? 0.9 : Math.max(0.15, 0.85 - rank * 0.07)}
                        strokeDasharray="8 6"
                        filter="url(#kg-glow)"
                      />
                    );
                  })}
                {/* constellation labels, on the top edge of each nebula (hubs themselves stay invisible anchors) */}
                {[...clusters].map(([tag, c]) => {
                  const color = tagColor(tag);
                  const count = nodes.filter((n) => n.kind === "doc" && n.tag === tag).length;
                  const label = `#${tag || "sans tag"} · ${count}`;
                  const w = label.length * 7 + 24;
                  return (
                    <g
                      key={`lbl-${tag || "_"}`}
                      data-node
                      transform={`translate(${c.x} ${c.y - c.r + 18})`}
                      opacity={tagFilter && tagFilter !== tag ? 0.3 : 1}
                      className="cursor-pointer"
                      onClick={() => setTagFilter(tagFilter === tag ? null : tag)}
                    >
                      <rect x={-w / 2} y={-12} width={w} height={24} rx={12} fill={color} opacity={0.92} filter="url(#kg-glow)" />
                      <text textAnchor="middle" y={4.5} fontSize={12} fontWeight={600} fill="#fff">
                        {label}
                      </text>
                    </g>
                  );
                })}
                {/* documents */}
                {nodes
                  .filter((n) => n.kind === "doc")
                  .map((n, i) => {
                    const color = tagColor(n.tag);
                    const rank = docRank.get(n.id);
                    const lit = rank !== undefined;
                    const dim = dimDoc(n);
                    const r = n.r * (lit ? 1.25 : hover === n.id ? 1.15 : 1);
                    return (
                      <g
                        key={n.id}
                        data-node
                        className="kg-doc cursor-pointer"
                        transform={`translate(${n.x} ${n.y})`}
                        opacity={dim ? 0.18 : 1}
                        onMouseEnter={() => setHover(n.id)}
                        onMouseLeave={() => setHover(null)}
                        onClick={() => n.doc && onOpenDoc(n.doc)}
                      >
                        <g className="kg-float" style={{ animationDelay: `${(i % 9) * 0.6}s` }}>
                          {lit && <circle r={r + 10} fill="none" stroke={isFinal ? GOLD : "#b9adff"} strokeWidth={2} className="kg-pulse" />}
                          <circle r={r} fill="#0b0d12" stroke={lit && isFinal ? GOLD : color} strokeWidth={lit ? 3 : 2} filter={lit || hover === n.id ? "url(#kg-glow)" : undefined} />
                          <circle r={r * 0.45} fill={lit && isFinal ? GOLD : color} opacity={0.85} />
                          {lit && (
                            <g transform={`translate(${r * 0.75} ${-r * 0.75})`}>
                              <circle r={9} fill={isFinal ? GOLD : "#7c6cf6"} />
                              <text textAnchor="middle" y={3.5} fontSize={10} fontWeight={700} fill={isFinal ? "#1a1400" : "#fff"}>
                                {rank! + 1}
                              </text>
                            </g>
                          )}
                          <text textAnchor="middle" y={r + 14} fontSize={11} fill={hover === n.id || lit ? "#e6e8ee" : "#9aa3b5"}>
                            {n.doc!.name.length > 30 ? n.doc!.name.slice(0, 30) + "…" : n.doc!.name}
                          </text>
                          {hover === n.id && (
                            <text textAnchor="middle" y={r + 28} fontSize={10} fill="#697287">
                              {n.doc!.tags.map((t) => `#${t}`).join(" ")} · {n.doc!.chunks} passages
                            </text>
                          )}
                        </g>
                      </g>
                    );
                  })}
                {/* brain */}
                <g data-node>
                  <circle r={64} fill="#7c6cf6" opacity={0.35} className="kg-pulse" />
                  <circle r={46} fill="url(#kg-brain)" filter="url(#kg-glow)" />
                  <text textAnchor="middle" y={9} fontSize={30}>
                    🧠
                  </text>
                  <text textAnchor="middle" y={66} fontSize={11} fill="#9aa3b5">
                    {g?.docs.length ?? 0} documents · {g?.tags.length ?? 0} tags
                  </text>
                </g>
                {/* query orb */}
                {pipeline && (
                  <g transform={`translate(${queryPos.x} ${queryPos.y})`} style={{ transition: "opacity .5s" }}>
                    <circle r={16} fill={isFinal ? GOLD : "#b9adff"} filter="url(#kg-glow)" className="kg-pulse" />
                    <circle r={10} fill={isFinal ? GOLD : "#e5e0ff"} />
                  </g>
                )}
              </g>
            </g>
          </svg>
        )}
        {stage && (
          <div className="pointer-events-none absolute bottom-3 left-1/2 z-10 -translate-x-1/2 rounded-full border border-white/10 bg-black/60 px-4 py-1.5 text-xs text-fg backdrop-blur">
            <b style={{ color: isFinal ? GOLD : "#b9adff" }}>{stage.label}</b> · {stage.detail}
          </div>
        )}
      </div>

      <SearchLab
        q={q}
        setQ={setQ}
        hybrid={hybrid}
        setHybrid={setHybrid}
        alpha={alpha}
        setAlpha={setAlpha}
        rerank={rerank}
        setRerank={setRerank}
        lambda={lambda}
        setLambda={setLambda}
        k={k}
        setK={setK}
        tagFilter={tagFilter}
        busy={busy}
        error={error}
        onRun={run}
        pipeline={pipeline}
        stageIdx={stageIdx}
        setStageIdx={(i) => (setPlaying(false), setStageIdx(i))}
        playing={playing}
        onPlay={() => (stageIdx >= (pipeline?.stages.length ?? 0) - 1 ? (setStageIdx(-1), setPlaying(true)) : setPlaying(!playing))}
        onClear={() => (setPipeline(null), setStageIdx(-1), setPlaying(false))}
        stage={stage}
        prevStage={prevStage}
        cands={cands}
      />
    </div>
  );
}

// ---------------------------------------------------------------- search lab

const ROW = 46;

function SearchLab(p: {
  q: string;
  setQ: (v: string) => void;
  hybrid: boolean;
  setHybrid: (v: boolean) => void;
  alpha: number;
  setAlpha: (v: number) => void;
  rerank: "none" | "mmr" | "llm";
  setRerank: (v: "none" | "mmr" | "llm") => void;
  lambda: number;
  setLambda: (v: number) => void;
  k: number;
  setK: (v: number) => void;
  tagFilter: string | null;
  busy: boolean;
  error?: string;
  onRun: () => void;
  pipeline: Pipeline | null;
  stageIdx: number;
  setStageIdx: (i: number) => void;
  playing: boolean;
  onPlay: () => void;
  onClear: () => void;
  stage: Stage | null;
  prevStage: Stage | null;
  cands: Map<string, Candidate>;
}) {
  const { pipeline, stage, prevStage, cands } = p;
  const shown = pipeline ? pipeline.stages[0].order.slice(0, 10) : [];
  // Rows keep their identity; only their vertical position follows the current stage's ranking.
  const rankOf = (id: string, s: Stage | null) => (s ? s.order.indexOf(id) : -1);
  const scores = stage ? Object.values(stage.scores) : [];
  const maxScore = Math.max(0.0001, ...scores);
  const minScore = Math.min(...(scores.length ? scores : [0]));
  return (
    <aside className="flex w-[380px] shrink-0 flex-col border-l border-line bg-surface-0">
      <div className="flex flex-col gap-2.5 border-b border-line p-3">
        <div className="text-sm font-semibold">Laboratoire de recherche</div>
        <form
          className="flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            p.onRun();
          }}
        >
          <Input value={p.q} onChange={(e) => p.setQ(e.target.value)} placeholder="Pose une question…" className="h-8 text-xs" />
          <Button size="sm" variant="primary" type="submit" disabled={p.busy || !p.q.trim()}>
            <Search size={13} /> {p.busy ? "…" : "Chercher"}
          </Button>
        </form>
        <div className="grid grid-cols-2 gap-2 text-[11px]">
          <label className="flex flex-col gap-1">
            <span className="text-fg-muted">Recherche</span>
            <Select className="h-7 text-[11px]" value={p.hybrid ? "on" : "off"} onChange={(e) => p.setHybrid(e.target.value === "on")}>
              <option value="on">Hybride (sens + mots-clés)</option>
              <option value="off">Vectorielle seule</option>
            </Select>
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-fg-muted">Reranking</span>
            <Select className="h-7 text-[11px]" value={p.rerank} onChange={(e) => p.setRerank(e.target.value as "none" | "mmr" | "llm")}>
              <option value="none">Aucun</option>
              <option value="mmr">MMR (diversité)</option>
              <option value="llm">LLM (pertinence)</option>
            </Select>
          </label>
          {p.hybrid && (
            <label className="col-span-2 flex items-center gap-2">
              <span className="w-24 text-fg-muted">Poids du sens {p.alpha.toFixed(2)}</span>
              <input type="range" min={0} max={1} step={0.05} value={p.alpha} onChange={(e) => p.setAlpha(Number(e.target.value))} className="flex-1 accent-[var(--accent)]" />
            </label>
          )}
          {p.rerank === "mmr" && (
            <label className="col-span-2 flex items-center gap-2">
              <span className="w-24 text-fg-muted">Pertinence λ {p.lambda.toFixed(2)}</span>
              <input type="range" min={0} max={1} step={0.05} value={p.lambda} onChange={(e) => p.setLambda(Number(e.target.value))} className="flex-1 accent-[var(--accent)]" />
            </label>
          )}
          <label className="col-span-2 flex items-center gap-2">
            <span className="w-24 text-fg-muted">Passages retenus</span>
            <Select className="h-7 w-20 text-[11px]" value={p.k} onChange={(e) => p.setK(Number(e.target.value))}>
              {[2, 3, 4, 5, 6, 8].map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </Select>
            {p.tagFilter && <Badge color={tagColor(p.tagFilter)}>#{p.tagFilter}</Badge>}
          </label>
        </div>
        {p.error && <div className="text-xs text-red-400">{p.error}</div>}
      </div>

      {pipeline && (
        <div className="border-b border-line p-3">
          {/* stepper */}
          <div className="mb-2 flex items-center gap-1">
            <Button size="sm" variant="ghost" onClick={() => p.setStageIdx(Math.max(0, p.stageIdx - 1))} aria-label="Étape précédente">
              <SkipBack size={13} />
            </Button>
            <Button size="sm" variant="soft" onClick={p.onPlay} aria-label={p.playing ? "Pause" : "Lecture"}>
              {p.playing ? <Pause size={13} /> : <Play size={13} />}
            </Button>
            <Button size="sm" variant="ghost" onClick={() => p.setStageIdx(Math.min(pipeline.stages.length - 1, p.stageIdx + 1))} aria-label="Étape suivante">
              <SkipForward size={13} />
            </Button>
            <div className="flex-1" />
            <Button size="sm" variant="ghost" onClick={p.onClear} aria-label="Effacer">
              <X size={13} />
            </Button>
          </div>
          <ol className="flex flex-col gap-1">
            {pipeline.stages.map((s, i) => (
              <li key={s.id}>
                <button
                  onClick={() => p.setStageIdx(i)}
                  className={cx(
                    "flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-xs transition",
                    i === p.stageIdx ? "bg-accent/20 text-fg" : i < p.stageIdx ? "text-fg-muted" : "text-fg-subtle",
                  )}
                >
                  <span
                    className={cx("flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[10px] font-bold", i <= p.stageIdx ? "text-white" : "bg-surface-3")}
                    style={{ background: i <= p.stageIdx ? (s.id === "final" ? GOLD : "#7c6cf6") : undefined, color: i <= p.stageIdx && s.id === "final" ? "#1a1400" : undefined }}
                  >
                    {i + 1}
                  </span>
                  <span className="flex-1">
                    <span className="block font-medium">{s.label}</span>
                    {i === p.stageIdx && <span className="block text-[10px] text-fg-muted">{s.detail}</span>}
                  </span>
                  {s.ms > 0 && <span className="tabular-nums text-[10px] text-fg-subtle">{s.ms} ms</span>}
                </button>
              </li>
            ))}
          </ol>
        </div>
      )}

      {/* animated ranking */}
      <div className="relative flex-1 overflow-y-auto p-3">
        {!pipeline && (
          <p className="text-xs leading-relaxed text-fg-subtle">
            Lance une recherche pour voir son déroulé : les passages candidats s&apos;allument dans le graphe, puis leur classement évolue à chaque étape (hybride, reranking) jusqu&apos;aux passages
            finalement transmis à l&apos;agent, en doré.
          </p>
        )}
        {pipeline && (
          <div className="relative" style={{ height: shown.length * ROW }}>
            {(() => {
              // Eliminated rows keep their previous order, stacked below the kept ones.
              const kept = stage ? stage.order.filter((id) => shown.includes(id)).length : shown.length;
              const dropped = stage ? shown.filter((id) => rankOf(id, stage) < 0).sort((a, b) => (prevStage ? rankOf(a, prevStage) - rankOf(b, prevStage) : 0)) : [];
              return shown.map((id) => {
              const c = cands.get(id)!;
              const rank = stage ? rankOf(id, stage) : shown.indexOf(id);
              const prev = prevStage ? rankOf(id, prevStage) : rank;
              const inFinal = stage?.id === "final" && rank >= 0;
              const out = stage?.id === "final" && rank < 0;
              const score = stage?.scores[id] ?? c.vector;
              const pct = Math.max(4, ((score - minScore) / (maxScore - minScore || 1)) * 100);
              const delta = prev >= 0 && rank >= 0 ? prev - rank : 0;
              const top = (rank >= 0 ? rank : kept + dropped.indexOf(id)) * ROW;
              return (
                <div
                  key={id}
                  className={cx("absolute left-0 right-0 flex items-center gap-2 rounded-lg border px-2 py-1.5 text-xs", inFinal ? "bg-[#f5c45114]" : "bg-surface-1")}
                  style={{ top, height: ROW - 6, transition: "top .7s cubic-bezier(.2,.8,.2,1), opacity .5s, border-color .5s", opacity: out ? 0.25 : 1, borderColor: inFinal ? GOLD : "var(--line)" }}
                  title={c.text}
                >
                  <span className="w-5 text-center font-bold tabular-nums" style={{ color: inFinal ? GOLD : "var(--fg-muted)" }}>
                    {rank >= 0 ? rank + 1 : "–"}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-1">
                      <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: tagColor(c.tags[0] ?? "") }} />
                      <span className="truncate">{c.doc}</span>
                    </span>
                    <span className="mt-1 block h-1 overflow-hidden rounded-full bg-surface-3">
                      <span className="block h-full rounded-full" style={{ width: `${pct}%`, background: inFinal ? GOLD : "#7c6cf6", transition: "width .7s" }} />
                    </span>
                  </span>
                  <span className="w-12 text-right tabular-nums text-[10px] text-fg-muted">
                    {stage?.id === "llm" ? `${score.toFixed(0)}/10` : score.toFixed(2)}
                  </span>
                  <span className="w-7 text-right text-[10px]">
                    {delta > 0 && (
                      <span className="inline-flex items-center text-emerald-400">
                        <ArrowUp size={10} />
                        {delta}
                      </span>
                    )}
                    {delta < 0 && (
                      <span className="inline-flex items-center text-red-400">
                        <ArrowDown size={10} />
                        {-delta}
                      </span>
                    )}
                  </span>
                </div>
              );
              });
            })()}
          </div>
        )}
      </div>
    </aside>
  );
}

export type { GDoc };
