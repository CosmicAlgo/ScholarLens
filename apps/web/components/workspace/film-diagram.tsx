"use client";

// An animated diagram of the mechanism a paper describes. The parts and arrow labels are the paper's own
// terms (checked on the server); beats play one per narration line: parts appear, arrows draw in,
// something flows along an arrow, a part goes wrong, keeps growing, gets fixed or is removed.

import { useMemo } from "react";
import type { DiagramBeat, DiagramNode, DiagramState, DiagramVisual } from "@/lib/film";

const W = 1000;
const H = 520;
type Box = { x: number; y: number; w: number; h: number };

function wrap(label: string): string[] {
  if (label.length <= 16) return [label];
  const words = label.split(" ");
  let a = "";
  for (const w of words) {
    if ((a + " " + w).trim().length > Math.max(14, Math.ceil(label.length / 2))) break;
    a = (a + " " + w).trim();
  }
  const b = label.slice(a.length).trim();
  return a && b ? [a, b] : [label];
}

function size(n: DiagramNode) {
  const lines = wrap(n.label);
  const longest = Math.max(...lines.map((l) => l.length));
  return { w: Math.max(120, Math.min(230, longest * 12 + 44)), h: lines.length > 1 ? 74 : 58 };
}

/** Longest-path ranks from the sources (cycles are broken by visiting each node once). */
function ranks(ids: string[], edges: { src: string; dst: string }[]) {
  const out = new Map<string, string[]>();
  ids.forEach((i) => out.set(i, []));
  edges.forEach((e) => out.get(e.src)?.push(e.dst));
  const indeg = new Map(ids.map((i) => [i, 0]));
  edges.forEach((e) => indeg.set(e.dst, (indeg.get(e.dst) ?? 0) + 1));
  const rank = new Map<string, number>();
  const visit = (id: string, r: number, path: Set<string>) => {
    if (path.has(id) || (rank.get(id) ?? -1) >= r) return;
    rank.set(id, r);
    path.add(id);
    out.get(id)?.forEach((d) => visit(d, r + 1, path));
    path.delete(id);
  };
  const roots = ids.filter((i) => !indeg.get(i));
  (roots.length ? roots : ids.slice(0, 1)).forEach((r) => visit(r, 0, new Set()));
  ids.forEach((i) => rank.has(i) || visit(i, 0, new Set()));
  return rank;
}

function layered(nodes: DiagramNode[], edges: { src: string; dst: string }[], area: Box, vertical: boolean) {
  const ids = nodes.map((n) => n.id);
  const rank = ranks(ids, edges);
  const cols: string[][] = [];
  ids.forEach((id) => (cols[rank.get(id) ?? 0] ??= []).push(id));
  const layers = cols.filter(Boolean);
  const pos = new Map<string, Box>();
  layers.forEach((layer, li) => {
    layer.forEach((id, k) => {
      const s = size(nodes.find((n) => n.id === id)!);
      const along = (li + 0.5) / layers.length;
      const across = (k + 0.5) / layer.length;
      const cx = area.x + (vertical ? across : along) * area.w;
      const cy = area.y + (vertical ? along : across) * area.h;
      pos.set(id, { x: cx - s.w / 2, y: cy - s.h / 2, ...s });
    });
  });
  return pos;
}

function layout(v: DiagramVisual) {
  const area: Box = { x: 30, y: 30, w: W - 60, h: H - 60 };
  if (v.layout === "cycle") {
    const pos = new Map<string, Box>();
    v.nodes.forEach((n, i) => {
      const a = -Math.PI / 2 + (i / v.nodes.length) * Math.PI * 2;
      const s = size(n);
      const cx = W / 2 + Math.cos(a) * (W * 0.33);
      const cy = H / 2 + Math.sin(a) * (H * 0.36);
      pos.set(n.id, { x: cx - s.w / 2, y: cy - s.h / 2, ...s });
    });
    return pos;
  }
  if (v.layout === "split") {
    const left = v.nodes.filter((n) => n.side !== "right");
    const right = v.nodes.filter((n) => n.side === "right");
    const inSide = (ns: DiagramNode[]) => v.edges.filter((e) => ns.some((n) => n.id === e.src) && ns.some((n) => n.id === e.dst));
    const pad = { y: 80, h: H - 110 };
    return new Map([
      ...layered(left, inSide(left), { x: 20, w: W / 2 - 40, ...pad }, true),
      ...layered(right, inSide(right), { x: W / 2 + 20, w: W / 2 - 40, ...pad }, true),
    ]);
  }
  return layered(v.nodes, v.edges, area, v.layout === "stack");
}

/** Where the line from a's centre to b's centre leaves box a. */
function exitPoint(a: Box, b: Box) {
  const ax = a.x + a.w / 2;
  const ay = a.y + a.h / 2;
  const dx = b.x + b.w / 2 - ax;
  const dy = b.y + b.h / 2 - ay;
  const t = Math.min(Math.abs(a.w / 2 / (dx || 1e-9)), Math.abs(a.h / 2 / (dy || 1e-9)));
  return { x: ax + dx * t, y: ay + dy * t };
}

/** Everything up to (and including) the current narration line. */
function stateAt(v: DiagramVisual, line: number) {
  const shownSomewhere = new Set(v.beats.flatMap((b) => b.show));
  const visible = new Set(v.nodes.filter((n) => !shownSomewhere.has(n.id)).map((n) => n.id));
  const states = new Map<string, DiagramState>();
  let now: DiagramBeat | undefined;
  for (const b of [...v.beats].sort((x, y) => x.line - y.line)) {
    if (b.line > line) break;
    b.show.forEach((id) => visible.add(id));
    b.states.forEach((s) => states.set(s.id, s.state));
    if (b.line === line) now = b;
  }
  return { visible, states, focus: new Set(now?.focus ?? []), flows: new Set(now?.flows ?? []) };
}

const TONE: Record<DiagramState, { stroke: string; fill: string; text: string }> = {
  normal: { stroke: "#5b8fd8", fill: "rgba(57,135,229,0.14)", text: "#e8f0fc" },
  problem: { stroke: "#f07a7a", fill: "rgba(240,122,122,0.22)", text: "#ffe3e3" },
  growing: { stroke: "#f0b75c", fill: "rgba(240,183,92,0.22)", text: "#fff1d9" },
  fixed: { stroke: "#7fd49a", fill: "rgba(127,212,154,0.2)", text: "#e2f8e9" },
  gone: { stroke: "#6b7280", fill: "rgba(107,114,128,0.08)", text: "#9ca3af" },
};

function Shape({ n, b, tone }: { n: DiagramNode; b: Box; tone: (typeof TONE)[DiagramState] }) {
  const common = { stroke: tone.stroke, fill: tone.fill, strokeWidth: 2.5 };
  switch (n.shape) {
    case "actor":
      return <rect x={b.x} y={b.y} width={b.w} height={b.h} rx={b.h / 2} {...common} />;
    case "store": {
      const e = 9;
      return (
        <g>
          <path d={`M${b.x},${b.y + e} v${b.h - 2 * e} a${b.w / 2},${e} 0 0 0 ${b.w},0 v${-(b.h - 2 * e)}`} {...common} />
          <ellipse cx={b.x + b.w / 2} cy={b.y + e} rx={b.w / 2} ry={e} {...common} />
        </g>
      );
    }
    case "data": {
      const k = 12;
      return <path d={`M${b.x + k},${b.y} h${b.w} l${-k},${b.h} h${-b.w} z`} {...common} />;
    }
    case "process":
      return (
        <g>
          <rect x={b.x} y={b.y} width={b.w} height={b.h} rx={8} {...common} />
          <rect x={b.x + 5} y={b.y + 5} width={b.w - 10} height={b.h - 10} rx={5} fill="none" stroke={tone.stroke} strokeOpacity={0.5} strokeWidth={1.2} />
        </g>
      );
    default:
      return <rect x={b.x} y={b.y} width={b.w} height={b.h} rx={12} {...common} />;
  }
}

export function FilmDiagram({ v, line, uid }: { v: DiagramVisual; line: number; uid: string }) {
  const pos = useMemo(() => layout(v), [v]);
  const { visible, states, focus, flows } = stateAt(v, line);
  const reduced = typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  return (
    <div className="h-full flex flex-col">
      <svg viewBox={`0 0 ${W} ${H}`} className="flex-1 min-h-0 w-full" role="img" aria-label={`Diagram: ${v.nodes.map((n) => n.label).join(", ")}`}>
        <defs>
          <marker id={`${uid}-arrow`} viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
            <path d="M0,0 L10,5 L0,10 z" fill="#8fb3e6" />
          </marker>
          <filter id={`${uid}-glow`} x="-30%" y="-30%" width="160%" height="160%">
            <feGaussianBlur stdDeviation="7" result="b" />
            <feMerge>
              <feMergeNode in="b" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>

        {v.layout === "split" && (
          <g className="dg-fade">
            <line x1={W / 2} y1={20} x2={W / 2} y2={H - 20} stroke="rgba(255,255,255,0.15)" strokeDasharray="6 6" />
            <text x={W / 4} y={46} textAnchor="middle" fill="rgba(255,255,255,0.7)" fontSize={22} fontWeight={600}>
              {v.left_title}
            </text>
            <text x={(3 * W) / 4} y={46} textAnchor="middle" fill="rgba(255,255,255,0.7)" fontSize={22} fontWeight={600}>
              {v.right_title}
            </text>
          </g>
        )}

        {v.edges.map((e, i) => {
          const a = pos.get(e.src);
          const b = pos.get(e.dst);
          if (!a || !b || !visible.has(e.src) || !visible.has(e.dst)) return null;
          const p = exitPoint(a, b);
          const q = exitPoint(b, a);
          const d = `M${p.x},${p.y} L${q.x},${q.y}`;
          const id = `${uid}-e${i}`;
          const carrying = flows.has(`${e.src}>${e.dst}`);
          const gone = states.get(e.src) === "gone" || states.get(e.dst) === "gone";
          return (
            <g key={id} opacity={gone ? 0.3 : 1}>
              <path id={id} d={d} className="dg-draw" stroke={carrying ? "#cfe0fb" : "#8fb3e6"} strokeWidth={carrying ? 3.5 : 2.5} fill="none" markerEnd={`url(#${uid}-arrow)`} strokeDasharray={gone ? "6 6" : undefined} />
              {e.label && (
                <g className="dg-fade">
                  <rect x={(p.x + q.x) / 2 - e.label.length * 5.2 - 8} y={(p.y + q.y) / 2 - 15} width={e.label.length * 10.4 + 16} height={26} rx={7} fill="#0b0f1a" stroke="rgba(255,255,255,0.15)" />
                  <text x={(p.x + q.x) / 2} y={(p.y + q.y) / 2 + 5} textAnchor="middle" fill="rgba(255,255,255,0.8)" fontSize={16}>
                    {e.label}
                  </text>
                </g>
              )}
              {carrying &&
                (reduced ? (
                  <circle cx={(p.x + q.x) / 2} cy={(p.y + q.y) / 2} r={7} fill="#ffffff" />
                ) : (
                  [0, 0.6, 1.2].map((delay) => (
                    <circle key={delay} r={6} fill="#ffffff" opacity={0.9}>
                      <animateMotion dur="1.8s" begin={`${delay}s`} repeatCount="indefinite">
                        <mpath href={`#${id}`} />
                      </animateMotion>
                    </circle>
                  ))
                ))}
            </g>
          );
        })}

        {v.nodes.map((n) => {
          const b = pos.get(n.id);
          if (!b) return null;
          const shown = visible.has(n.id);
          const st = states.get(n.id) ?? "normal";
          const tone = TONE[st];
          const lines = wrap(n.label);
          const cx = b.x + b.w / 2;
          const cy = b.y + b.h / 2;
          return (
            <g
              key={n.id}
              className={`dg-node dg-${st}${shown ? " dg-on" : ""}`}
              style={{ transformOrigin: `${cx}px ${cy}px` }}
              filter={focus.has(n.id) ? `url(#${uid}-glow)` : undefined}
              aria-hidden={!shown}
            >
              <Shape n={n} b={b} tone={tone} />
              {lines.map((l, i) => (
                <text
                  key={i}
                  x={cx}
                  y={cy + (i - (lines.length - 1) / 2) * 22 + 7}
                  textAnchor="middle"
                  fill={tone.text}
                  fontSize={19}
                  fontWeight={600}
                  textDecoration={st === "gone" ? "line-through" : undefined}
                >
                  {l}
                </text>
              ))}
              {st === "fixed" && (
                <g transform={`translate(${b.x + b.w - 4},${b.y + 4})`}>
                  <circle r={13} fill="#7fd49a" />
                  <path d="M-6,0 l4,4 l8,-8" stroke="#0b0f1a" strokeWidth={3} fill="none" />
                </g>
              )}
              {st === "problem" && (
                <g transform={`translate(${b.x + b.w - 4},${b.y + 4})`}>
                  <circle r={13} fill="#f07a7a" />
                  <text y={6} textAnchor="middle" fontSize={18} fontWeight={800} fill="#0b0f1a">
                    !
                  </text>
                </g>
              )}
            </g>
          );
        })}
      </svg>
      <p className="mt-1 text-[0.68rem] text-white/45">Labels are the paper&rsquo;s own terms · p. {v.page}</p>
    </div>
  );
}
