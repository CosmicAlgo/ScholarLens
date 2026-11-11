// Plain-language findings from trend data, computed in code (no AI), so every sentence is exact.

import type { Trend, YearPoint } from "./api";
import { pct } from "./format";

export type Insight = { title: string; body: string; tone: "good" | "warn" | "info"; topics: string[] };

const full = (pts: YearPoint[]) => pts.filter((p) => !p.partial);
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** Last year in which the order of two topics flipped (a overtook b, or b overtook a). */
export function crossover(a: Trend, b: Trend): { year: number; leader: string; trailer: string } | null {
  const pa = new Map(full(a.points).map((p) => [p.year, p.share_per_million]));
  const years = full(b.points)
    .map((p) => p.year)
    .filter((y) => pa.has(y))
    .sort((x, y) => x - y);
  let last: { year: number; leader: string; trailer: string } | null = null;
  let prev: number | null = null;
  for (const y of years) {
    const diff = pa.get(y)! - full(b.points).find((p) => p.year === y)!.share_per_million;
    const sign = Math.sign(diff);
    if (sign && prev && sign !== prev) last = sign > 0 ? { year: y, leader: a.query, trailer: b.query } : { year: y, leader: b.query, trailer: a.query };
    if (sign) prev = sign;
  }
  return last;
}

export function compareInsights(ts: Trend[]): Insight[] {
  const ok = ts.filter((t) => full(t.points).length >= 3);
  if (!ok.length) return [];
  const out: Insight[] = [];
  const latest = (t: Trend) => full(t.points).at(-1)!;

  const growing = ok.filter((t) => t.recent_growth != null).sort((a, b) => b.recent_growth! - a.recent_growth!);
  if (growing.length) {
    const g = growing[0];
    out.push({
      title: `${cap(g.query)} has the most momentum`,
      body: `Its share of all papers changed ${pct(g.recent_growth)} a year over the last three years${
        growing.length > 1 ? `, against ${pct(growing.at(-1)!.recent_growth)} for ${growing.at(-1)!.query}` : ""
      }.`,
      tone: (g.recent_growth ?? 0) > 0 ? "good" : "warn",
      topics: [g.query],
    });
  }

  if (ok.length > 1) {
    const big = [...ok].sort((a, b) => latest(b).share_per_million - latest(a).share_per_million);
    const [x, y] = big;
    const ratio = latest(y).share_per_million ? latest(x).share_per_million / latest(y).share_per_million : null;
    out.push({
      title: `${cap(x.query)} is the biggest field`,
      body: `In ${latest(x).year} it made up ${latest(x).share_per_million.toFixed(0)} of every million papers published${
        ratio && ratio > 1.05 ? `, ${ratio.toFixed(1)}× ${y.query}` : `, about level with ${y.query}`
      }.`,
      tone: "info",
      topics: [x.query, y.query],
    });
    for (let i = 0; i < ok.length; i++)
      for (let j = i + 1; j < ok.length; j++) {
        const c = crossover(ok[i], ok[j]);
        if (c)
          out.push({
            title: `${cap(c.leader)} overtook ${c.trailer} in ${c.year}`,
            body: `Before ${c.year}, ${c.trailer} had the larger share of published papers.`,
            tone: "info",
            topics: [c.leader, c.trailer],
          });
      }
  }

  for (const t of ok) {
    const end = latest(t).year;
    if (t.peak_year && t.peak_year <= end - 2 && (t.label === "peaked" || t.label === "declining" || t.label === "cooling")) {
      const peak = full(t.points).find((p) => p.year === t.peak_year)!;
      const drop = peak.share_per_million ? 1 - latest(t).share_per_million / peak.share_per_million : 0;
      out.push({
        title: `${cap(t.query)} peaked in ${t.peak_year}`,
        body: `Its share has fallen ${Math.round(drop * 100)}% since then.`,
        tone: "warn",
        topics: [t.query],
      });
    }
  }
  return out.slice(0, 6);
}
