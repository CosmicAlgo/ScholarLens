"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { YearPoint } from "@/lib/api";
import { num } from "@/lib/format";

export type Series = { name: string; points: YearPoint[] };

// Fixed categorical order (validated palette); colour follows the series' position in the input, never its rank.
const COLORS = ["var(--series-1)", "var(--series-2)", "var(--series-3)", "var(--series-4)"];
const H = 280;
const M = { top: 16, right: 16, bottom: 28, left: 52 };

function niceMax(v: number) {
  if (v <= 0) return 1;
  const p = 10 ** Math.floor(Math.log10(v));
  return [1, 2, 2.5, 5, 10].map((m) => m * p).find((m) => m >= v) ?? 10 * p;
}

const fmtShare = (v: number) => (v === 0 ? "0" : v >= 100 ? Math.round(v).toLocaleString("en-GB") : v >= 10 ? v.toFixed(0) : v.toFixed(1));

export function TrendChart({ series, caption }: { series: Series[]; caption?: string }) {
  const wrap = useRef<HTMLDivElement>(null);
  const [w, setW] = useState(640);
  const [hover, setHover] = useState<number | null>(null);

  useEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setW(Math.max(280, Math.round(e.contentRect.width))));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const years = useMemo(() => {
    const s = new Set<number>();
    series.forEach((x) => x.points.forEach((p) => s.add(p.year)));
    return [...s].sort((a, b) => a - b);
  }, [series]);

  if (!years.length) return <p className="text-ink-3 text-sm">No data to chart.</p>;

  const maxV = niceMax(Math.max(...series.flatMap((s) => s.points.map((p) => p.share_per_million))));
  const iw = w - M.left - M.right;
  const ih = H - M.top - M.bottom;
  const x = (yr: number) => M.left + (years.length === 1 ? iw / 2 : ((yr - years[0]) / (years.at(-1)! - years[0])) * iw);
  const y = (v: number) => M.top + ih - (v / maxV) * ih;
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((t) => t * maxV);
  const step = Math.ceil(years.length / Math.max(2, Math.floor(iw / 56)));
  const multi = series.length > 1;

  // Direct labels at each line's last complete point, nudged apart vertically so they never overlap.
  const labelY: number[] = [];
  if (multi && series.length <= 4) {
    const ends = series
      .map((s, i) => ({ i, y: (() => { const l = s.points.filter((p) => !p.partial).at(-1); return l ? y(l.share_per_million) - 9 : -1; })() }))
      .filter((e) => e.y >= 0)
      .sort((a, b) => a.y - b.y);
    for (let k = 1; k < ends.length; k++) ends[k].y = Math.max(ends[k].y, ends[k - 1].y + 13);
    const overflow = ends.length ? ends.at(-1)!.y - (M.top + ih - 4) : 0;
    if (overflow > 0) ends.forEach((e) => (e.y -= overflow));
    ends.forEach((e) => (labelY[e.i] = e.y));
  }

  const onMove = (e: React.PointerEvent<SVGRectElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    const px = e.clientX - r.left;
    let best = years[0];
    for (const yr of years) if (Math.abs(x(yr) - M.left - px) < Math.abs(x(best) - M.left - px)) best = yr;
    setHover(best);
  };

  const tip = hover == null ? null : { yr: hover, rows: series.map((s, i) => ({ s, i, p: s.points.find((p) => p.year === hover) })) };
  const tipLeft = hover == null ? 0 : x(hover) > w * 0.6 ? x(hover) - 12 : x(hover) + 12;

  return (
    <figure className="m-0">
      {multi && (
        <div className="flex flex-wrap gap-x-4 gap-y-1 mb-2 text-sm text-ink-2" aria-label="Legend">
          {series.map((s, i) => (
            <span key={s.name} className="inline-flex items-center gap-1.5">
              <span className="inline-block w-3 h-[3px] rounded" style={{ background: COLORS[i] }} />
              {s.name}
            </span>
          ))}
        </div>
      )}
      <div ref={wrap} className="relative w-full select-none">
        <svg width={w} height={H} role="img" aria-label={caption || "Trend chart"} className="block overflow-visible">
          {ticks.map((t) => (
            <g key={t}>
              <line x1={M.left} x2={w - M.right} y1={y(t)} y2={y(t)} stroke="var(--grid)" strokeWidth={1} />
              <text x={M.left - 8} y={y(t)} dy="0.32em" textAnchor="end" fontSize={11} fill="var(--text-3)">
                {fmtShare(t)}
              </text>
            </g>
          ))}
          {years.map((yr, i) =>
            i % step === 0 || i === years.length - 1 ? (
              <text key={yr} x={x(yr)} y={H - 8} textAnchor="middle" fontSize={11} fill="var(--text-3)">
                {yr}
              </text>
            ) : null,
          )}
          {series.map((s, i) => {
            const solid = s.points.filter((p) => !p.partial);
            const partial = s.points.find((p) => p.partial);
            const d = solid.map((p, j) => `${j ? "L" : "M"}${x(p.year)},${y(p.share_per_million)}`).join("");
            const last = solid.at(-1);
            return (
              <g key={s.name}>
                <path d={d} fill="none" stroke={COLORS[i]} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
                {partial && last && (
                  <>
                    <path
                      d={`M${x(last.year)},${y(last.share_per_million)}L${x(partial.year)},${y(partial.share_per_million)}`}
                      stroke={COLORS[i]}
                      strokeWidth={2}
                      strokeDasharray="3 4"
                      fill="none"
                    />
                    <circle cx={x(partial.year)} cy={y(partial.share_per_million)} r={4} fill="var(--surface)" stroke={COLORS[i]} strokeWidth={2} />
                  </>
                )}
                {multi && last && series.length <= 4 && (
                  <text x={x(last.year) - 6} y={labelY[i]} textAnchor="end" fontSize={11} fill="var(--text-2)">
                    {s.name.length > 22 ? s.name.slice(0, 21) + "…" : s.name}
                  </text>
                )}
              </g>
            );
          })}
          {tip && (
            <g pointerEvents="none">
              <line x1={x(tip.yr)} x2={x(tip.yr)} y1={M.top} y2={M.top + ih} stroke="var(--text-3)" strokeWidth={1} />
              {tip.rows.map(({ p, i }) =>
                p ? (
                  <circle key={i} cx={x(p.year)} cy={y(p.share_per_million)} r={4.5} fill={COLORS[i]} stroke="var(--surface)" strokeWidth={2} />
                ) : null,
              )}
            </g>
          )}
          <rect
            x={M.left}
            y={M.top}
            width={iw}
            height={ih}
            fill="transparent"
            onPointerMove={onMove}
            onPointerDown={onMove}
            onPointerLeave={() => setHover(null)}
          />
        </svg>
        {tip && (
          <div
            className="absolute top-2 z-10 pointer-events-none rounded-lg border border-line bg-surface shadow-lg px-3 py-2 text-xs min-w-40"
            style={{ left: tipLeft, transform: x(tip.yr) > w * 0.6 ? "translateX(-100%)" : undefined }}
          >
            <div className="font-medium text-ink mb-1">
              {tip.yr}
              {tip.rows.some((r) => r.p?.partial) && <span className="text-ink-3 font-normal"> · still being indexed</span>}
            </div>
            {tip.rows.map(({ s, i, p }) => (
              <div key={s.name} className="flex items-center gap-2 text-ink-2">
                {multi && <span className="inline-block w-2 h-2 rounded-full" style={{ background: COLORS[i] }} />}
                <span className="flex-1">{multi ? s.name : "Per million papers"}</span>
                <span className="font-mono text-ink">{p ? fmtShare(p.share_per_million) : "–"}</span>
              </div>
            ))}
            {!multi && tip.rows[0].p && (
              <div className="text-ink-3 mt-1">{num(tip.rows[0].p.count)} papers that year</div>
            )}
          </div>
        )}
      </div>
      <figcaption className="mt-2 text-xs text-ink-3">
        {caption || "Papers on this topic per million papers published that year."} Dashed: current year, still being indexed.
      </figcaption>
      <details className="mt-2 text-sm">
        <summary className="cursor-pointer text-ink-3 hover:text-ink-2">Show data table</summary>
        <div className="overflow-x-auto mt-2">
          <table className="text-xs w-full border-collapse">
            <thead>
              <tr className="text-ink-3 text-left">
                <th className="py-1 pr-3 font-medium">Year</th>
                {series.map((s) => (
                  <th key={s.name} className="py-1 pr-3 font-medium" colSpan={2}>
                    {s.name}: papers / per million
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {years.map((yr) => (
                <tr key={yr} className="border-t border-line">
                  <td className="py-1 pr-3">{yr}</td>
                  {series.map((s) => {
                    const p = s.points.find((q) => q.year === yr);
                    return [
                      <td key="c" className="py-1 pr-2 font-mono">{p ? num(p.count) : "–"}</td>,
                      <td key="s" className="py-1 pr-3 font-mono text-ink-2">{p ? fmtShare(p.share_per_million) : "–"}</td>,
                    ];
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </figure>
  );
}
