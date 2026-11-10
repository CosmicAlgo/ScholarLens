"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { API_URL, topicSlug } from "@/lib/api";

export type Trending = {
  updated: string;
  refresh_hours: number;
  window: { recent: [string, string]; previous: [string, string] };
  rising: { id: string; name: string; recent: number; previous: number; growth: number }[];
  busiest: { id: string; name: string; recent: number; previous: number; growth: number }[];
  source: string;
};

let cache: Promise<Trending> | null = null;
export function fetchTrending(): Promise<Trending> {
  cache ??= fetch(`${API_URL}/api/trending`).then((r) => {
    if (!r.ok) throw new Error("trending unavailable");
    return r.json();
  });
  cache.catch(() => (cache = null));
  return cache;
}

const fmtPct = (g: number) => `+${Math.round(g * 100)}%`;
const fmtMonth = (d: string) => new Date(d).toLocaleDateString("en-GB", { month: "short", year: "numeric" });

/** Fastest-growing topics, refreshed by the API every few hours (computed from OpenAlex, no AI). */
export function TrendingNow() {
  const [t, setT] = useState<Trending | null>(null);
  const [err, setErr] = useState(false);
  useEffect(() => {
    fetchTrending().then(setT, () => setErr(true));
  }, []);
  if (err) return null;
  const max = t ? Math.max(...t.rising.map((r) => r.growth), 0.01) : 1;
  return (
    <section className="rounded-2xl border border-line bg-surface p-5 md:p-6">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-lg font-semibold tracking-tight">Trending now</h2>
        {t && (
          <span className="text-xs text-ink-3">
            Updated {new Date(t.updated).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })} ·
            refreshes every {t.refresh_hours} h
          </span>
        )}
      </div>
      <p className="mt-1 text-sm text-ink-2">
        Topics whose paper output grew fastest
        {t ? ` from ${fmtMonth(t.window.recent[0])} to ${fmtMonth(t.window.recent[1])}` : " in the last 12 months"}, compared with the
        year before and with the growth of science overall.
      </p>
      {!t ? (
        <div className="mt-4 grid sm:grid-cols-2 gap-2">
          {Array.from({ length: 8 }, (_, i) => (
            <div key={i} className="h-11 rounded-xl bg-surface-2 animate-pulse" />
          ))}
        </div>
      ) : (
        <ol className="mt-4 grid sm:grid-cols-2 gap-x-4 gap-y-1.5">
          {t.rising.map((r, i) => (
            <li key={r.id}>
              <Link
                href={`/topic/${topicSlug(r.name)}`}
                className="group grid grid-cols-[1.25rem_1fr_auto] items-center gap-2 rounded-xl px-2 py-2 hover:bg-surface-2"
                title={`${r.previous.toLocaleString("en-GB")} → ${r.recent.toLocaleString("en-GB")} papers`}
              >
                <span className="text-xs font-mono text-ink-3">{i + 1}</span>
                <span className="min-w-0">
                  <span className="block text-sm font-medium leading-snug group-hover:text-accent-ink">{r.name}</span>
                  <span className="mt-1 block h-1 rounded-full bg-surface-2 overflow-hidden">
                    <span className="block h-full rounded-full bg-good" style={{ width: `${Math.max(6, (r.growth / max) * 100)}%` }} />
                  </span>
                </span>
                <span className="text-xs font-mono font-semibold text-good tabular-nums">{fmtPct(r.growth)}</span>
              </Link>
            </li>
          ))}
        </ol>
      )}
      <p className="mt-4 text-[0.7rem] text-ink-3 leading-relaxed">
        Topic labels and counts come from {t?.source || "OpenAlex"}. A very large jump can mean OpenAlex re-labelled many papers,
        not only that the field grew, so open a topic to see its long-run trend before drawing conclusions.
      </p>
    </section>
  );
}
