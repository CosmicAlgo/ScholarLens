"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { fetchGraph, type Graph, type GraphNode, type Message, type NoveltyItem, type OpenPaper } from "@/lib/workspace";

const STYLE: Record<GraphNode["kind"], { fill: string; label: string; hint: string }> = {
  open: { fill: "var(--accent)", label: "Open paper", hint: "A paper you have open" },
  shared: { fill: "var(--vision)", label: "Shared foundation", hint: "Cited by two or more of your papers" },
  reference: { fill: "var(--text-3)", label: "Key reference", hint: "A most-cited work one of your papers builds on" },
  citing: { fill: "var(--good)", label: "Built on it", hint: "A most-cited later work that cites your paper" },
  idea: { fill: "var(--warn)", label: "Your idea", hint: "An idea from Copilot's Ideas mode" },
  prior: { fill: "var(--series-2)", label: "Prior work for an idea", hint: "The closest existing work the novelty check found" },
};

const VERDICT: Record<NoveltyItem["verdict"], string> = {
  open: "No close match found",
  partly_explored: "Partly explored",
  already_done: "Already done",
};

type P = GraphNode & { x: number; y: number; r: number };
type E = { source: string; target: string; dashed?: boolean };

/** Merge the citation graph with ideas from the conversation's novelty checks. */
function withIdeas(g: Graph | null, messages: Message[]): { nodes: GraphNode[]; edges: E[] } {
  const nodes = new Map((g?.nodes || []).map((n) => [n.id, n]));
  const edges: E[] = [...(g?.edges || [])];
  let i = 0;
  for (const m of messages) {
    if (m.role !== "assistant" || !Array.isArray(m.novelty)) continue;
    for (const idea of m.novelty) {
      const id = `idea:${i++}`;
      nodes.set(id, { id, title: idea.title, year: null, cited_by: 0, kind: "idea", verdict: idea.verdict });
      for (const c of idea.closest.slice(0, 3)) {
        if (!nodes.has(c.id)) nodes.set(c.id, { id: c.id, title: c.title, year: c.year, cited_by: c.cited_by, kind: "prior" });
        edges.push({ source: id, target: c.id, dashed: true });
      }
    }
  }
  return { nodes: [...nodes.values()], edges };
}

function radius(n: GraphNode) {
  if (n.kind === "open") return 15;
  if (n.kind === "idea") return 11;
  return 5 + Math.min(7, Math.log10(1 + n.cited_by) * 1.8);
}

/** A small deterministic force layout (repulsion, springs, gravity). Fine for <150 nodes. */
function layout(nodes: GraphNode[], edges: E[]): P[] {
  const pts: P[] = nodes.map((n, i) => {
    const a = (i / Math.max(1, nodes.length)) * Math.PI * 2;
    const ring = n.kind === "open" ? 60 : n.kind === "idea" ? 260 : 180;
    return { ...n, x: Math.cos(a * 3.7) * ring, y: Math.sin(a * 3.7) * ring, r: radius(n) };
  });
  const idx = new Map(pts.map((p, i) => [p.id, i]));
  const links = edges.map((e) => [idx.get(e.source), idx.get(e.target)]).filter((l): l is [number, number] => l[0] !== undefined && l[1] !== undefined);
  for (let it = 0; it < 320; it++) {
    const cool = 1 - it / 320;
    const fx = new Float64Array(pts.length), fy = new Float64Array(pts.length);
    for (let i = 0; i < pts.length; i++)
      for (let j = i + 1; j < pts.length; j++) {
        const dx = pts[i].x - pts[j].x, dy = pts[i].y - pts[j].y;
        const d2 = Math.max(dx * dx + dy * dy, 25);
        const f = 2600 / d2;
        const d = Math.sqrt(d2);
        fx[i] += (dx / d) * f; fy[i] += (dy / d) * f;
        fx[j] -= (dx / d) * f; fy[j] -= (dy / d) * f;
      }
    for (const [a, b] of links) {
      const dx = pts[b].x - pts[a].x, dy = pts[b].y - pts[a].y;
      const d = Math.sqrt(dx * dx + dy * dy) || 1;
      const want = pts[a].kind === "open" && pts[b].kind === "open" ? 140 : 85;
      const f = (d - want) * 0.04;
      fx[a] += (dx / d) * f; fy[a] += (dy / d) * f;
      fx[b] -= (dx / d) * f; fy[b] -= (dy / d) * f;
    }
    for (let i = 0; i < pts.length; i++) {
      const g = pts[i].kind === "open" ? 0.03 : 0.012;
      fx[i] -= pts[i].x * g; fy[i] -= pts[i].y * g;
      const step = Math.min(18, Math.hypot(fx[i], fy[i])) * cool;
      const m = Math.hypot(fx[i], fy[i]) || 1;
      pts[i].x += (fx[i] / m) * step;
      pts[i].y += (fy[i] / m) * step;
    }
  }
  return pts;
}

const short = (t: string, n = 34) => (t.length > n ? t.slice(0, n - 1) + "…" : t);

export function ConnectionMap({ papers, messages, onOpen }: { papers: OpenPaper[]; messages: Message[]; onOpen: (id: string) => void }) {
  const ids = papers.filter((p) => !p.id.startsWith("U")).map((p) => p.id);
  const key = ids.join(",");
  const [graph, setGraph] = useState<{ key: string; g: Graph | null; error?: string } | null>(null);
  const [sel, setSel] = useState<string | null>(null);
  const [view, setView] = useState({ k: 1, x: 0, y: 0 });
  const drag = useRef<{ x: number; y: number; vx: number; vy: number } | null>(null);
  const svg = useRef<SVGSVGElement>(null);

  useEffect(() => {
    if (!key) return;
    let live = true;
    fetchGraph(key.split(","))
      .then((g) => live && setGraph({ key, g }))
      .catch((e) => live && setGraph({ key, g: null, error: e instanceof Error ? e.message : "Could not build the map." }));
    return () => {
      live = false;
    };
  }, [key]);

  const loading = !!key && graph?.key !== key;
  const merged = useMemo(() => withIdeas(graph?.key === key ? graph.g : null, messages), [graph, key, messages]);
  const pts = useMemo(() => layout(merged.nodes, merged.edges), [merged]);
  const byId = useMemo(() => new Map(pts.map((p) => [p.id, p])), [pts]);

  const box = useMemo(() => {
    if (!pts.length) return { x: -200, y: -150, w: 400, h: 300 };
    const xs = pts.map((p) => p.x), ys = pts.map((p) => p.y);
    const pad = 60;
    const x0 = Math.min(...xs) - pad, y0 = Math.min(...ys) - pad;
    return { x: x0, y: y0, w: Math.max(...xs) + pad - x0, h: Math.max(...ys) + pad - y0 };
  }, [pts]);
  const vb = { w: box.w / view.k, h: box.h / view.k };
  const vx = box.x + (box.w - vb.w) / 2 + view.x, vy = box.y + (box.h - vb.h) / 2 + view.y;

  const neighbours = useMemo(() => {
    const m = new Map<string, Set<string>>();
    for (const e of merged.edges) {
      if (!m.has(e.source)) m.set(e.source, new Set());
      if (!m.has(e.target)) m.set(e.target, new Set());
      m.get(e.source)!.add(e.target);
      m.get(e.target)!.add(e.source);
    }
    return m;
  }, [merged]);

  const shared = useMemo(
    () =>
      pts
        .filter((p) => p.kind === "shared")
        .map((p) => ({ p, n: [...(neighbours.get(p.id) || [])].filter((x) => byId.get(x)?.kind === "open").length }))
        .sort((a, b) => b.n - a.n || b.p.cited_by - a.p.cited_by),
    [pts, neighbours, byId],
  );

  const focus = sel ? byId.get(sel) : null;
  const near = sel ? neighbours.get(sel) : null;
  const uploadsOnly = papers.length > 0 && !ids.length;

  return (
    <div className="h-full flex flex-col min-h-0 @container">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2 border-b border-line bg-surface text-[0.7rem] text-ink-2 shrink-0">
        {(Object.keys(STYLE) as GraphNode["kind"][]).map((k) => (
          <span key={k} className="inline-flex items-center gap-1" title={STYLE[k].hint}>
            <svg width="10" height="10" aria-hidden="true">
              {k === "idea" ? <rect x="1" y="1" width="8" height="8" transform="rotate(45 5 5)" fill={STYLE[k].fill} /> : <circle cx="5" cy="5" r="4.5" fill={STYLE[k].fill} />}
            </svg>
            {STYLE[k].label}
          </span>
        ))}
        <span className="flex-1" />
        <button className="tool-btn" aria-label="Zoom out" onClick={() => setView((v) => ({ ...v, k: Math.max(0.5, v.k / 1.3) }))}>
          −
        </button>
        <button className="tool-btn" aria-label="Reset view" onClick={() => setView({ k: 1, x: 0, y: 0 })}>
          ⟲
        </button>
        <button className="tool-btn" aria-label="Zoom in" onClick={() => setView((v) => ({ ...v, k: Math.min(5, v.k * 1.3) }))}>
          +
        </button>
      </div>

      <div className="flex-1 min-h-0 flex flex-col @3xl:flex-row">
        <div className="relative flex-1 min-h-[260px] bg-surface-2">
          {loading && <p className="absolute inset-x-0 top-4 text-center text-sm text-ink-3 animate-pulse">Tracing references and citations in OpenAlex…</p>}
          {graph?.error && graph.key === key && <p className="absolute inset-x-0 top-4 text-center text-sm text-bad">{graph.error}</p>}
          {uploadsOnly && !merged.nodes.length && (
            <p className="absolute inset-x-6 top-6 text-center text-sm text-ink-3">
              The map traces citations through OpenAlex, so it needs at least one catalogue paper open. Your ideas from the
              Ideas mode also appear here.
            </p>
          )}
          <svg
            ref={svg}
            role="img"
            aria-label="Connection map of the open papers"
            className="w-full h-full touch-none select-none cursor-grab active:cursor-grabbing"
            viewBox={`${vx} ${vy} ${vb.w} ${vb.h}`}
            preserveAspectRatio="xMidYMid meet"
            onWheel={(e) => setView((v) => ({ ...v, k: Math.min(5, Math.max(0.5, v.k * (e.deltaY < 0 ? 1.12 : 1 / 1.12))) }))}
            onPointerDown={(e) => {
              if ((e.target as Element).closest("[data-node]")) return;
              (e.currentTarget as Element).setPointerCapture(e.pointerId);
              drag.current = { x: e.clientX, y: e.clientY, vx: view.x, vy: view.y };
            }}
            onPointerMove={(e) => {
              const d = drag.current;
              const el = svg.current;
              if (!d || !el) return;
              const scale = vb.w / el.clientWidth;
              setView((v) => ({ ...v, x: d.vx - (e.clientX - d.x) * scale, y: d.vy - (e.clientY - d.y) * scale }));
            }}
            onPointerUp={() => (drag.current = null)}
            onClick={(e) => !(e.target as Element).closest("[data-node]") && setSel(null)}
          >
            {merged.edges.map((e, i) => {
              const a = byId.get(e.source), b = byId.get(e.target);
              if (!a || !b) return null;
              const lit = sel && (e.source === sel || e.target === sel);
              return (
                <line
                  key={i}
                  x1={a.x}
                  y1={a.y}
                  x2={b.x}
                  y2={b.y}
                  stroke={lit ? "var(--accent)" : "var(--text-3)"}
                  strokeOpacity={sel ? (lit ? 0.9 : 0.12) : 0.35}
                  strokeWidth={lit ? 1.6 : 1}
                  strokeDasharray={e.dashed ? "4 3" : undefined}
                />
              );
            })}
            {pts.map((p) => {
              const dim = sel && p.id !== sel && !near?.has(p.id);
              const showLabel = p.kind === "open" || p.kind === "idea" || p.kind === "shared" || p.id === sel || near?.has(p.id);
              return (
                <g
                  key={p.id}
                  data-node
                  transform={`translate(${p.x} ${p.y})`}
                  opacity={dim ? 0.25 : 1}
                  className="cursor-pointer"
                  onClick={() => setSel(p.id === sel ? null : p.id)}
                  tabIndex={0}
                  role="button"
                  aria-label={`${STYLE[p.kind].label}: ${p.title}`}
                  onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && setSel(p.id)}
                >
                  <title>{`${p.title}${p.year ? ` (${p.year})` : ""}${p.kind !== "idea" ? ` · ${p.cited_by.toLocaleString("en-GB")} citations` : ""}`}</title>
                  {p.kind === "idea" ? (
                    <rect x={-p.r} y={-p.r} width={p.r * 2} height={p.r * 2} transform="rotate(45)" fill={STYLE.idea.fill} stroke="var(--surface)" strokeWidth={2} />
                  ) : (
                    <circle r={p.r} fill={STYLE[p.kind].fill} stroke={p.retracted ? "var(--bad)" : "var(--surface)"} strokeWidth={p.retracted ? 3 : 2} />
                  )}
                  {showLabel && (
                    <text
                      y={p.r + 12}
                      textAnchor="middle"
                      fontSize={p.kind === "open" ? 11 : 9.5}
                      fontWeight={p.kind === "open" ? 600 : 400}
                      fill="var(--text)"
                      stroke="var(--surface-2)"
                      strokeWidth={3}
                      paintOrder="stroke"
                    >
                      {short(p.title, p.kind === "open" ? 38 : 30)}
                    </text>
                  )}
                </g>
              );
            })}
          </svg>
        </div>

        <aside className="@3xl:w-72 shrink-0 border-t @3xl:border-t-0 @3xl:border-l border-line bg-surface overflow-y-auto max-h-[38%] @3xl:max-h-none p-3 text-sm">
          {focus ? (
            <div>
              <div className="text-[0.65rem] font-semibold uppercase tracking-wider" style={{ color: STYLE[focus.kind].fill }}>
                {STYLE[focus.kind].label}
              </div>
              <h3 className="mt-1 font-semibold leading-snug">{focus.title}</h3>
              {focus.kind === "idea" ? (
                <p className="mt-1 text-xs text-ink-2">{focus.verdict ? VERDICT[focus.verdict] : ""}. Dashed lines lead to the closest existing work.</p>
              ) : (
                <p className="mt-1 text-xs text-ink-3">
                  {[focus.year, `${focus.cited_by.toLocaleString("en-GB")} citations`, focus.retracted ? "retracted" : null].filter(Boolean).join(" · ")}
                </p>
              )}
              <p className="mt-2 text-xs text-ink-2">{STYLE[focus.kind].hint}. Linked to {near?.size || 0} other nodes.</p>
              {focus.kind !== "idea" && (
                <button onClick={() => onOpen(focus.id)} className="mt-3 rounded-lg bg-accent text-white px-3 h-8 text-xs font-medium">
                  {focus.kind === "open" ? "Show in reader" : "Open in workspace"}
                </button>
              )}
            </div>
          ) : (
            <div>
              <h3 className="font-semibold">Shared foundations</h3>
              <p className="mt-1 text-xs text-ink-3">Works that several of your open papers cite. Often the place to start reading.</p>
              {shared.length === 0 && (
                <p className="mt-2 text-xs text-ink-3">
                  {ids.length < 2 ? "Open two or more papers to find what they share." : "These papers don't cite a common work."}
                </p>
              )}
              <ul className="mt-2 space-y-1.5">
                {shared.slice(0, 12).map(({ p, n }) => (
                  <li key={p.id}>
                    <button onClick={() => setSel(p.id)} className="text-left w-full rounded-lg px-2 py-1.5 hover:bg-surface-2">
                      <div className="text-xs font-medium leading-snug line-clamp-2">{p.title}</div>
                      <div className="text-[0.68rem] text-ink-3">
                        cited by {n} of your papers · {p.year ?? "n.d."} · {p.cited_by.toLocaleString("en-GB")} citations
                      </div>
                    </button>
                  </li>
                ))}
              </ul>
              <p className="mt-3 text-[0.7rem] text-ink-3">Click a node for details. Drag to pan, scroll to zoom. Ideas from the Ideas mode join the map with their closest prior work.</p>
            </div>
          )}
        </aside>
      </div>
    </div>
  );
}
