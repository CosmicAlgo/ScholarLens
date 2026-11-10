"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { topicSlug } from "@/lib/api";
import {
  fetchGraph,
  fetchLineage,
  type Graph,
  type GraphNode,
  type Lineage,
  type Message,
  type NoveltyItem,
  type OpenPaper,
  type SeriesPoint,
} from "@/lib/workspace";

type Kind = GraphNode["kind"];

/** Lanes, top to bottom: what came before, the user's papers, what came after, the user's ideas. */
const LANES: { kind: Kind; label: string; hint: string; color: string }[] = [
  { kind: "shared", label: "Shared foundations", hint: "Cited by two or more of your papers", color: "var(--vision)" },
  { kind: "reference", label: "Key references", hint: "The most-cited works your papers build on", color: "var(--text-3)" },
  { kind: "open", label: "Your papers", hint: "Papers you have open", color: "var(--accent)" },
  { kind: "citing", label: "Built on it", hint: "The most-cited later work citing your papers", color: "var(--good)" },
  { kind: "idea", label: "Your ideas", hint: "Ideas from Copilot's Ideas mode", color: "var(--warn)" },
  { kind: "prior", label: "Closest prior work", hint: "What the novelty check found for each idea", color: "var(--series-2)" },
];
const LANE = Object.fromEntries(LANES.map((l) => [l.kind, l])) as Record<Kind, (typeof LANES)[number]>;

const VERDICT: Record<NoveltyItem["verdict"], string> = {
  open: "No close match found",
  partly_explored: "Partly explored",
  already_done: "Already done",
};

const COL = 184; // px per year column
const CARD_W = 168;
const CARD_H = 64;
const GAP = 8;
const HEAD = 34;

type E = { source: string; target: string; dashed?: boolean };
type Placed = GraphNode & { x: number; y: number };

function withIdeas(g: Graph | null, messages: Message[]): { nodes: GraphNode[]; edges: E[] } {
  const nodes = new Map((g?.nodes || []).map((n) => [n.id, n]));
  const edges: E[] = [...(g?.edges || [])];
  let i = 0;
  for (const m of messages) {
    if (m.role !== "assistant" || !Array.isArray(m.novelty)) continue;
    for (const idea of m.novelty) {
      const id = `idea:${i++}`;
      nodes.set(id, { id, title: idea.title, year: null, cited_by: 0, kind: "idea", verdict: idea.verdict });
      for (const c of idea.closest.slice(0, 2)) {
        if (!nodes.has(c.id)) nodes.set(c.id, { id: c.id, title: c.title, year: c.year, cited_by: c.cited_by, kind: "prior" });
        edges.push({ source: id, target: c.id, dashed: true });
      }
    }
  }
  return { nodes: [...nodes.values()], edges };
}

/** Ordinal year columns (only years that have papers), lanes as rows, cards stacked in each cell. */
function layout(nodes: GraphNode[], LABEL_W: number) {
  const years = [...new Set(nodes.filter((n) => n.kind !== "idea" && n.year).map((n) => n.year!))].sort((a, b) => a - b);
  const hasIdeas = nodes.some((n) => n.kind === "idea");
  const colOf = (n: GraphNode) => (n.kind === "idea" ? years.length : n.year ? years.indexOf(n.year) : 0);
  const lanes = LANES.filter((l) => nodes.some((n) => n.kind === l.kind));
  const placed: Placed[] = [];
  const laneTop: { kind: Kind; top: number; height: number }[] = [];
  let top = HEAD;
  for (const l of lanes) {
    const cells = new Map<number, GraphNode[]>();
    for (const n of nodes.filter((x) => x.kind === l.kind)) {
      const c = colOf(n);
      cells.set(c, [...(cells.get(c) || []), n]);
    }
    let rows = 1;
    for (const [c, list] of cells) {
      list.sort((a, b) => b.cited_by - a.cited_by);
      rows = Math.max(rows, list.length);
      list.forEach((n, r) => placed.push({ ...n, x: LABEL_W + c * COL + (COL - CARD_W) / 2, y: top + GAP + r * (CARD_H + GAP) }));
    }
    const height = rows * (CARD_H + GAP) + GAP * 2;
    laneTop.push({ kind: l.kind, top, height });
    top += height;
  }
  const width = LABEL_W + (years.length + (hasIdeas ? 1 : 0)) * COL + 16;
  return { placed, laneTop, years, hasIdeas, width, height: top + 8, LABEL_W };
}

export function ConnectionMap({ papers, messages, onOpen }: { papers: OpenPaper[]; messages: Message[]; onOpen: (id: string) => void }) {
  const ids = papers.filter((p) => !p.id.startsWith("U")).map((p) => p.id);
  const key = ids.join(",");
  const [tab, setTab] = useState<"lineage" | "topic">("lineage");
  const [graph, setGraph] = useState<{ key: string; g: Graph | null; error?: string } | null>(null);
  const [sel, setSel] = useState<string | null>(null);
  const [hover, setHover] = useState<string | null>(null);

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
  const narrow = useNarrow();
  const L = useMemo(() => layout(merged.nodes, narrow ? 72 : 132), [merged, narrow]);
  const LABEL_W = L.LABEL_W;
  const byId = useMemo(() => new Map(L.placed.map((p) => [p.id, p])), [L]);
  const focusId = hover || sel;
  const near = useMemo(() => {
    if (!focusId) return null;
    const s = new Set<string>([focusId]);
    for (const e of merged.edges) {
      if (e.source === focusId) s.add(e.target);
      if (e.target === focusId) s.add(e.source);
    }
    return s;
  }, [focusId, merged]);
  const focus = sel ? byId.get(sel) : null;

  return (
    <div className="h-full flex flex-col min-h-0">
      <div className="flex items-center gap-2 px-3 h-10 border-b border-line bg-surface shrink-0">
        <div className="inline-flex rounded-lg border border-line p-0.5 text-xs" role="tablist" aria-label="Map view">
          {(
            [
              ["lineage", "Lineage"],
              ["topic", "Topic context"],
            ] as const
          ).map(([v, label]) => (
            <button
              key={v}
              role="tab"
              aria-selected={tab === v}
              onClick={() => setTab(v)}
              className={`px-2.5 py-0.5 rounded-md whitespace-nowrap ${tab === v ? "bg-surface-2 text-ink font-medium" : "text-ink-3 hover:text-ink"}`}
            >
              {label}
            </button>
          ))}
        </div>
        <span className="text-[0.7rem] text-ink-3 truncate hidden sm:inline">
          {tab === "lineage" ? "Older work on the left, newer on the right. Click a card for details." : "Where these papers sit, where their ideas came from, and where they went."}
        </span>
      </div>

      {tab === "topic" ? (
        <TopicContext ids={ids} papers={papers} onOpen={onOpen} />
      ) : (
        <div className="flex-1 min-h-0 flex flex-col">
          <div className="relative flex-1 min-h-0 overflow-auto bg-surface-2" onClick={() => setSel(null)}>
            {loading && <p className="p-6 text-sm text-ink-3 animate-pulse">Tracing references and citations in OpenAlex…</p>}
            {graph?.error && graph.key === key && <p className="p-6 text-sm text-bad">{graph.error}</p>}
            {!ids.length && !merged.nodes.length && (
              <p className="p-6 text-sm text-ink-3">
                The lineage traces citations through OpenAlex, so it needs at least one catalogue paper open. Ideas from Ideas
                mode also appear here.
              </p>
            )}
            {L.placed.length > 0 && (
              <div className="relative" style={{ width: L.width, height: L.height }}>
                {/* year header */}
                <div className="sticky top-0 z-20 h-[34px] bg-surface-2/95 backdrop-blur border-b border-line" style={{ width: L.width }}>
                  {L.years.map((y, i) => (
                    <div
                      key={y}
                      className="absolute top-0 h-full flex items-center justify-center text-[0.7rem] font-mono text-ink-3"
                      style={{ left: LABEL_W + i * COL, width: COL }}
                    >
                      {y}
                      {i > 0 && y - L.years[i - 1] > 1 && (
                        <span className="absolute left-0 text-ink-3/60" title={`${y - L.years[i - 1] - 1} years without linked papers`}>
                          ⋯
                        </span>
                      )}
                    </div>
                  ))}
                  {L.hasIdeas && (
                    <div
                      className="absolute top-0 h-full flex items-center justify-center text-[0.7rem] font-semibold text-warn"
                      style={{ left: LABEL_W + L.years.length * COL, width: COL }}
                    >
                      Ideas
                    </div>
                  )}
                </div>
                {/* lanes */}
                {L.laneTop.map((l, i) => (
                  <div
                    key={l.kind}
                    className={`absolute left-0 ${i % 2 ? "bg-surface/40" : ""} border-b border-line/60`}
                    style={{ top: l.top, height: l.height, width: L.width }}
                  >
                    <div
                      className={`sticky left-0 z-10 h-full flex flex-col justify-center gap-0.5 ${narrow ? "px-1.5" : "px-3"} bg-surface-2/95 border-r border-line`}
                      style={{ width: LABEL_W }}
                      title={LANE[l.kind].hint}
                    >
                      <span className="flex items-center gap-1.5 text-[0.72rem] font-semibold text-ink leading-tight">
                        <span className="w-2 h-2 rounded-full shrink-0" style={{ background: LANE[l.kind].color }} />
                        {LANE[l.kind].label}
                      </span>
                      {!narrow && <span className="text-[0.62rem] leading-tight text-ink-3">{LANE[l.kind].hint}</span>}
                    </div>
                  </div>
                ))}
                {/* edges */}
                <svg className="absolute inset-0 pointer-events-none" width={L.width} height={L.height} aria-hidden="true">
                  {merged.edges.map((e, i) => {
                    const a = byId.get(e.source),
                      b = byId.get(e.target);
                    if (!a || !b) return null;
                    const lit = near && near.has(e.source) && near.has(e.target) && (e.source === focusId || e.target === focusId);
                    const [l, r] = a.x <= b.x ? [a, b] : [b, a];
                    const sameCol = Math.abs(a.x - b.x) < 2;
                    const x1 = sameCol ? l.x + CARD_W : l.x + CARD_W,
                      y1 = l.y + CARD_H / 2;
                    const x2 = sameCol ? r.x + CARD_W : r.x,
                      y2 = r.y + CARD_H / 2;
                    const dx = sameCol ? 40 : Math.max(30, (x2 - x1) / 2);
                    const d = sameCol
                      ? `M${x1},${y1} C${x1 + dx},${y1} ${x2 + dx},${y2} ${x2},${y2}`
                      : `M${x1},${y1} C${x1 + dx},${y1} ${x2 - dx},${y2} ${x2},${y2}`;
                    return (
                      <path
                        key={i}
                        d={d}
                        fill="none"
                        stroke={lit ? "var(--accent)" : "var(--text-3)"}
                        strokeOpacity={focusId ? (lit ? 0.9 : 0.06) : 0.22}
                        strokeWidth={lit ? 1.8 : 1}
                        strokeDasharray={e.dashed ? "4 4" : undefined}
                      />
                    );
                  })}
                </svg>
                {/* cards */}
                {L.placed.map((n) => {
                  const dim = near && !near.has(n.id);
                  return (
                    <button
                      key={n.id}
                      onClick={(e) => {
                        e.stopPropagation();
                        setSel(n.id === sel ? null : n.id);
                      }}
                      onMouseEnter={() => setHover(n.id)}
                      onMouseLeave={() => setHover(null)}
                      onFocus={() => setHover(n.id)}
                      onBlur={() => setHover(null)}
                      className={`absolute z-[5] text-left rounded-xl border bg-surface shadow-sm px-2.5 py-1.5 transition-[opacity,box-shadow,border-color] duration-150 hover:shadow-md ${
                        sel === n.id ? "border-accent ring-2 ring-accent/30" : "border-line"
                      } ${dim ? "opacity-35" : "opacity-100"}`}
                      style={{ left: n.x, top: n.y, width: CARD_W, height: CARD_H, borderLeft: `3px solid ${LANE[n.kind].color}` }}
                      title={n.title}
                    >
                      <span className="text-[0.72rem] leading-snug font-medium text-ink line-clamp-2">{n.title}</span>
                      <span className="block mt-0.5 text-[0.62rem] text-ink-3 truncate">
                        {n.kind === "idea"
                          ? n.verdict
                            ? VERDICT[n.verdict]
                            : "idea"
                          : `${n.year ?? "n.d."} · ${n.cited_by.toLocaleString("en-GB")} cites${n.retracted ? " · retracted" : ""}`}
                      </span>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
          {focus && (
            <div className="border-t border-line bg-surface px-4 py-3 text-sm flex flex-wrap items-start gap-3 shrink-0">
              <div className="min-w-0 flex-1">
                <div className="text-[0.65rem] font-semibold uppercase tracking-wider" style={{ color: LANE[focus.kind].color }}>
                  {LANE[focus.kind].label}
                </div>
                <div className="font-semibold leading-snug">{focus.title}</div>
                <div className="text-xs text-ink-3 mt-0.5">
                  {focus.kind === "idea"
                    ? `${focus.verdict ? VERDICT[focus.verdict] : ""}. Dashed lines lead to the closest existing work.`
                    : `${focus.year ?? "n.d."} · ${focus.cited_by.toLocaleString("en-GB")} citations · linked to ${(near?.size || 1) - 1} others on this map`}
                </div>
              </div>
              {focus.kind !== "idea" && (
                <button onClick={() => onOpen(focus.id)} className="rounded-lg bg-accent text-white px-3 h-8 text-xs font-medium shrink-0">
                  {focus.kind === "open" ? "Show in reader" : "Open in workspace"}
                </button>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function Spark({ pts, field = "per_million", label }: { pts: SeriesPoint[]; field?: "per_million" | "count"; label: string }) {
  const vals = pts.map((p) => (field === "count" ? p.count : (p.per_million ?? 0)));
  const max = Math.max(...vals, 1);
  const w = 240,
    h = 48;
  const x = (i: number) => (i / Math.max(1, pts.length - 1)) * w;
  const y = (v: number) => h - 3 - (v / max) * (h - 8);
  const line = vals.map((v, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join("");
  const peak = vals.indexOf(max);
  return (
    <figure>
      <svg viewBox={`0 0 ${w} ${h}`} className="w-full" role="img" aria-label={label}>
        <path d={`${line}L${w},${h}L0,${h}Z`} fill="var(--accent)" fillOpacity="0.1" />
        <path d={line} fill="none" stroke="var(--accent)" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
        <circle cx={x(peak)} cy={y(max)} r="3" fill="var(--accent)" />
      </svg>
      <figcaption className="flex justify-between text-[0.62rem] font-mono text-ink-3">
        <span>{pts[0]?.year}</span>
        <span>peak {pts[peak]?.year}</span>
        <span>{pts.at(-1)?.year}</span>
      </figcaption>
    </figure>
  );
}

function TopicContext({ ids, papers, onOpen }: { ids: string[]; papers: OpenPaper[]; onOpen: (id: string) => void }) {
  const key = ids.slice(0, 5).join(",");
  const [data, setData] = useState<{ key: string; d: Lineage | null; error?: string } | null>(null);
  useEffect(() => {
    if (!key) return;
    let live = true;
    fetchLineage(key.split(","))
      .then((d) => live && setData({ key, d }))
      .catch((e) => live && setData({ key, d: null, error: e instanceof Error ? e.message : "Could not load the topic context." }));
    return () => {
      live = false;
    };
  }, [key]);
  const title = (id: string) => papers.find((p) => p.id === id)?.title || id;
  if (!key) return <p className="p-6 text-sm text-ink-3">Open a catalogue paper to see its topic context.</p>;
  if (!data || data.key !== key) return <p className="p-6 text-sm text-ink-3 animate-pulse">Reading the field from OpenAlex…</p>;
  if (!data.d) return <p className="p-6 text-sm text-bad">{data.error}</p>;
  const d = data.d;
  const maxSpread = Math.max(...d.spread.map((s) => s.count), 1);

  return (
    <div className="flex-1 min-h-0 overflow-y-auto bg-surface-2 p-3 @container">
      <div className="grid gap-3 @2xl:grid-cols-2">
        {d.terms.map((t) => (
          <section key={t.term} className="rounded-2xl border border-line bg-surface p-4">
            <div className="text-[0.65rem] font-semibold uppercase tracking-wider text-ink-3">Key term</div>
            <h3 className="mt-0.5 font-semibold text-lg leading-tight">{t.term}</h3>
            <p className="mt-1 text-xs text-ink-2">
              {t.first_year ? (
                <>
                  In steady use since <strong className="text-ink">{t.first_year}</strong> ·{" "}
                </>
              ) : null}
              {t.total.toLocaleString("en-GB")} papers use it
            </p>
            <div className="mt-2">
              <Spark pts={t.trend} field="count" label={`Papers per year using “${t.term}”`} />
            </div>
            {t.early_papers.length > 0 && (
              <div className="mt-3">
                <div className="text-[0.65rem] font-semibold uppercase tracking-wider text-ink-3">Early influential papers</div>
                <ul className="mt-1 space-y-1">
                  {t.early_papers.map((p) => (
                    <li key={p.id}>
                      <button onClick={() => onOpen(p.id)} className="w-full text-left rounded-lg px-2 py-1 -mx-2 hover:bg-surface-2">
                        <span className="block text-xs font-medium leading-snug line-clamp-2">{p.title}</span>
                        <span className="block text-[0.65rem] text-ink-3">
                          {p.year} · {p.cited_by.toLocaleString("en-GB")} citations
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            <p className="mt-2 text-[0.62rem] text-ink-3">From: {t.papers.map(title).join("; ")}</p>
          </section>
        ))}

        {d.topics.map((t) => (
          <section key={t.id} className="rounded-2xl border border-line bg-surface p-4">
            <div className="text-[0.65rem] text-ink-3">{t.path.join(" › ")}</div>
            <h3 className="mt-0.5 font-semibold text-lg leading-tight">{t.name}</h3>
            <p className="mt-1 text-xs text-ink-2">
              {t.works_count?.toLocaleString("en-GB")} works · share of all papers per year
            </p>
            <div className="mt-2">
              <Spark pts={t.trend} label={`${t.name}: papers per million published`} />
            </div>
            {t.related.length > 0 && (
              <div className="mt-3">
                <div className="text-[0.65rem] font-semibold uppercase tracking-wider text-ink-3">Neighbouring topics</div>
                <div className="mt-1.5 flex flex-wrap gap-1.5">
                  {t.related.slice(0, 8).map((r) => (
                    <Link
                      key={r}
                      href={`/topic/${topicSlug(r)}`}
                      target="_blank"
                      className="rounded-full border border-line bg-surface-2 px-2.5 py-0.5 text-[0.7rem] text-ink-2 hover:border-ink-3 hover:text-ink"
                    >
                      {r}
                    </Link>
                  ))}
                </div>
              </div>
            )}
          </section>
        ))}

        {d.spread.length > 0 && (
          <section className="rounded-2xl border border-line bg-surface p-4 @2xl:col-span-2">
            <div className="text-[0.65rem] font-semibold uppercase tracking-wider text-ink-3">Where later work took these papers</div>
            <p className="mt-0.5 text-xs text-ink-3">Topics of the papers that cite them</p>
            <ul className="mt-3 space-y-1.5">
              {d.spread.map((s) => (
                <li key={s.topic} className="grid grid-cols-[minmax(0,12rem)_1fr_auto] items-center gap-2 text-xs">
                  <span className="truncate text-ink-2" title={s.topic}>
                    {s.topic}
                  </span>
                  <span className="h-2 rounded-full bg-surface-2 overflow-hidden">
                    <span className="block h-full rounded-full bg-good" style={{ width: `${(s.count / maxSpread) * 100}%` }} />
                  </span>
                  <span className="font-mono text-ink-3 tabular-nums">{s.count}</span>
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>
      <p className="mt-3 text-center text-[0.65rem] text-ink-3">
        All data from {d.source}; nothing on this page is written by AI. “Steady use” is the first year with 3+ papers two years
        running, because the earliest records are often misdated.
      </p>
    </div>
  );
}

function useNarrow() {
  const [narrow, setNarrow] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(max-width: 640px)");
    const on = () => setNarrow(mq.matches);
    on();
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);
  return narrow;
}
