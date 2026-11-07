"use client";

import { useState } from "react";
import type { Paper, Trend } from "@/lib/api";
import { fetchSearch, fetchTrend } from "@/lib/api";
import { LABELS, pct } from "@/lib/format";
import type { OpenPaper, WorkspaceState } from "@/lib/workspace";
import { TrendBadge } from "../ui";

export function Library({
  state,
  onOpen,
  onActivate,
}: {
  state: WorkspaceState;
  onOpen: (p: Paper) => void;
  onActivate: (id: string) => void;
}) {
  const [q, setQ] = useState("");
  const [results, setResults] = useState<Paper[] | null>(null);
  const [trend, setTrend] = useState<Trend | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  async function search(e?: React.FormEvent, override?: string) {
    e?.preventDefault();
    const topic = (override ?? q).trim();
    if (topic.length < 2) return;
    setBusy(true);
    setErr("");
    setTrend(null);
    try {
      const [s, t] = await Promise.allSettled([fetchSearch(topic, 20), fetchTrend(topic)]);
      if (s.status === "fulfilled") setResults(s.value.results);
      else throw s.reason;
      if (t.status === "fulfilled") setTrend(t.value);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Search failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="h-full flex flex-col min-h-0">
      <form onSubmit={search} className="p-3 border-b border-line">
        <label htmlFor="lib-q" className="sr-only">
          Search papers
        </label>
        <div className="relative">
          <input
            id="lib-q"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search papers or a topic…"
            className="w-full h-10 rounded-xl border border-line bg-bg pl-9 pr-3 text-sm outline-none focus:border-accent"
          />
          <svg className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-3" width="15" height="15" viewBox="0 0 24 24" aria-hidden="true">
            <circle cx="11" cy="11" r="7" fill="none" stroke="currentColor" strokeWidth="2" />
            <path d="M16.5 16.5 21 21" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
          </svg>
        </div>
      </form>

      <div className="flex-1 overflow-y-auto min-h-0">
        {trend && <Pulse t={trend} />}
        {busy && <p className="px-4 py-3 text-sm text-ink-3 animate-pulse">Searching…</p>}
        {err && <p className="px-4 py-3 text-sm text-bad">{err}</p>}
        {results && !busy && (
          <Section title={`Results (${results.length})`}>
            {results.length === 0 && <p className="px-4 pb-3 text-sm text-ink-3">No papers found.</p>}
            {results.map((p) => (
              <ResultRow key={p.id} p={p} open={state.papers.some((o) => o.id === p.id)} onClick={() => onOpen(p)} />
            ))}
          </Section>
        )}

        {state.papers.length > 0 && (
          <Section title="Open">
            {state.papers.map((p) => (
              <button
                key={p.id}
                onClick={() => onActivate(p.id)}
                className={`w-full text-left px-4 py-2 text-sm hover:bg-surface-2 flex gap-2 items-start ${
                  p.id === state.activeId ? "text-ink" : "text-ink-2"
                }`}
              >
                <span className={`mt-1.5 w-1.5 h-1.5 rounded-full shrink-0 ${p.id === state.activeId ? "bg-accent" : "bg-line"}`} />
                <span className="line-clamp-2">{p.title}</span>
              </button>
            ))}
          </Section>
        )}

        {state.recent.length > 0 && (
          <Section title="Recently read">
            {state.recent.slice(0, 12).map((r) => (
              <button
                key={r.id}
                onClick={() => onActivate(r.id)}
                className="w-full text-left px-4 py-1.5 text-xs text-ink-3 hover:text-ink hover:bg-surface-2 line-clamp-1"
              >
                {r.title}
              </button>
            ))}
          </Section>
        )}

        {!results && state.papers.length === 0 && (
          <div className="p-4 text-sm text-ink-3 space-y-3">
            <p>Search for a topic or paper. Open papers to read them side by side and ask Copilot about them.</p>
            <div className="flex flex-wrap gap-1.5">
              {["retrieval augmented generation", "CRISPR base editing", "microplastics", "perovskite stability"].map((t) => (
                <button
                  key={t}
                  type="button"
                  onClick={() => {
                    setQ(t);
                    search(undefined, t);
                  }}
                  className="rounded-full border border-line px-2.5 py-1 text-xs hover:border-ink-3 hover:text-ink"
                >
                  {t}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="py-2">
      <h3 className="px-4 pt-1 pb-1.5 text-[0.68rem] font-semibold uppercase tracking-wider text-ink-3">{title}</h3>
      {children}
    </section>
  );
}

function ResultRow({ p, open, onClick }: { p: Paper; open: boolean; onClick: () => void }) {
  return (
    <button onClick={onClick} className="group w-full text-left px-4 py-2.5 hover:bg-surface-2 border-l-2 border-transparent hover:border-accent">
      <div className="text-sm leading-snug text-ink line-clamp-2 group-hover:text-accent-ink">{p.title}</div>
      <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[0.7rem] text-ink-3">
        <span className="font-mono">{p.year ?? ""}</span>
        <span>{p.cited_by_count.toLocaleString("en-GB")} cites</span>
        {p.is_retracted && <span className="rounded px-1 bg-bad-soft text-bad font-medium">Retracted</span>}
        {p.is_preprint && <span className="rounded px-1 bg-warn-soft text-warn">Preprint</span>}
        {p.is_oa && <span className="rounded px-1 bg-good-soft text-good">Full text</span>}
        {open && <span className="text-accent-ink">open</span>}
      </div>
    </button>
  );
}

function Pulse({ t }: { t: Trend }) {
  const pts = t.points.filter((p) => !p.partial);
  if (pts.length < 2) return null;
  const w = 220,
    h = 44;
  const max = Math.max(...pts.map((p) => p.share_per_million)) || 1;
  const x = (i: number) => (i / (pts.length - 1)) * w;
  const y = (v: number) => h - 4 - (v / max) * (h - 8);
  const d = pts.map((p, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(p.share_per_million).toFixed(1)}`).join("");
  return (
    <div className="m-3 rounded-xl border border-line bg-bg p-3">
      <div className="flex items-center justify-between gap-2">
        <span className="text-[0.68rem] font-semibold uppercase tracking-wider text-ink-3">Topic pulse</span>
        <TrendBadge label={t.label} size="sm" />
      </div>
      <svg
        viewBox={`0 0 ${w} ${h}`}
        className="w-full mt-2"
        role="img"
        aria-label={`Share of papers ${pts[0].year}–${pts.at(-1)!.year}: ${LABELS[t.label].text}`}
      >
        <path d={d} fill="none" stroke="var(--accent)" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
      </svg>
      <div className="flex justify-between text-[0.68rem] text-ink-3 font-mono">
        <span>{pts[0].year}</span>
        <span>
          share {pct(t.recent_growth)}/yr recently · {t.total_papers.toLocaleString("en-GB")} papers
        </span>
        <span>{pts.at(-1)!.year}</span>
      </div>
    </div>
  );
}

export type { OpenPaper };
