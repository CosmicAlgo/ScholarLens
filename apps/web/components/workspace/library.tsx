"use client";

import { useEffect, useRef, useState } from "react";
import { fetchTrending } from "../trending-now";
import { exportWorkspace, importWorkspace } from "@/lib/backup";
import { ScreenDeck } from "./screen";
import type { Interpretation, Paper, Trend } from "@/lib/api";
import { fetchSearch, fetchTrend } from "@/lib/api";
import { LABELS, pct } from "@/lib/format";
import type { OpenPaper, WorkspaceState } from "@/lib/workspace";
import { TrendBadge } from "../ui";

export function Library({
  state,
  onOpen,
  onActivate,
  onUpload,
  notes,
  onKeep,
  onUnqueue,
  onScreened,
  notify,
}: {
  state: WorkspaceState;
  onOpen: (p: Paper) => void;
  onActivate: (id: string) => void;
  onUpload: (f: File) => void;
  notes: React.ReactNode;
  onKeep: (p: Paper) => void;
  onUnqueue: (id: string) => void;
  onScreened: (kept: number, total: number, seconds: number) => void;
  notify: (text: string, tone: "info" | "bad") => void;
}) {
  const restoreInput = useRef<HTMLInputElement>(null);
  const [tab, setTab] = useState<"search" | "notes">("search");
  const file = useRef<HTMLInputElement>(null);
  const [q, setQ] = useState("");
  const [results, setResults] = useState<Paper[] | null>(null);
  const [trend, setTrend] = useState<Trend | null>(null);
  const [busy, setBusy] = useState(false);
  const [improving, setImproving] = useState(false);
  const [interp, setInterp] = useState<Interpretation | null>(null);
  const [asked, setAsked] = useState("");
  const [screening, setScreening] = useState(false);
  const [err, setErr] = useState("");
  const run = useRef(0);
  const [suggestions, setSuggestions] = useState(["retrieval augmented generation", "CRISPR base editing", "microplastics", "perovskite stability"]);
  useEffect(() => {
    fetchTrending()
      .then((t) => t.rising.length && setSuggestions(t.rising.slice(0, 6).map((r) => r.name)))
      .catch(() => {});
  }, []);

  /** Plain results show at once; the smart search (typos, vague wording) replaces them when ready. */
  async function search(e?: React.FormEvent, override?: string, exact = false) {
    e?.preventDefault();
    const topic = (override ?? q).trim();
    if (topic.length < 2) return;
    const me = ++run.current;
    setBusy(true);
    setImproving(!exact);
    setErr("");
    setTrend(null);
    setInterp(null);
    setAsked(topic);
    let shown = false;
    const plain = fetchSearch(topic, 20)
      .then((s) => {
        if (run.current === me && !shown) {
          shown = true;
          setResults(s.results);
          setBusy(false);
        }
      })
      .catch(() => {});
    const smart = exact
      ? Promise.resolve(null)
      : fetchSearch(topic, 20, true)
          .then((s) => {
            if (run.current !== me) return null;
            shown = true;
            setResults(s.results);
            setInterp(s.interpreted ?? null);
            setBusy(false);
            return s.interpreted?.corrected ?? null;
          })
          .catch(() => null);
    const corrected = await smart;
    await plain;
    if (run.current !== me) return;
    setImproving(false);
    setBusy(false);
    if (!shown) setErr("Search failed. Check your connection and try again.");
    fetchTrend(corrected || topic)
      .then((t) => run.current === me && setTrend(t))
      .catch(() => {});
  }

  return (
    <div className="h-full flex flex-col min-h-0">
      <div className="flex items-center gap-1 px-2 pt-2 border-b border-line" role="tablist">
        {(["search", "notes"] as const).map((t) => (
          <button
            key={t}
            role="tab"
            aria-selected={tab === t}
            onClick={() => setTab(t)}
            className={`px-3 py-1.5 text-xs font-medium border-b-2 -mb-px ${tab === t ? "border-accent text-ink" : "border-transparent text-ink-3 hover:text-ink"}`}
          >
            {t === "search" ? "Library" : `Notes${state.highlights.length ? ` (${state.highlights.length})` : ""}`}
          </button>
        ))}
        <span className="flex-1" />
        <button
          onClick={() => file.current?.click()}
          className="mb-1 rounded-lg border border-line px-2 h-7 text-[0.7rem] text-ink-2 hover:border-accent hover:text-accent-ink"
          title="Open your own PDF. It stays in this browser."
        >
          + Upload PDF
        </button>
        <input
          ref={file}
          type="file"
          accept="application/pdf"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) onUpload(f);
            e.target.value = "";
          }}
        />
      </div>
      {tab === "notes" ? (
        <div className="flex-1 min-h-0">{notes}</div>
      ) : (
      <>
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
        {interp && !busy && (
          <div className="mx-3 mt-3 rounded-xl bg-accent-soft px-3 py-2 text-xs text-ink-2">
            <div>
              Showing results for <strong className="text-ink">{interp.corrected}</strong>
            </div>
            {interp.searches.length > 1 && <div className="mt-0.5 text-ink-3">Also searched: {interp.searches.filter((s) => s !== interp.corrected).join(" · ")}</div>}
            <button onClick={() => search(undefined, asked, true)} className="mt-1 text-accent-ink hover:underline">
              Search exactly “{asked}” instead
            </button>
          </div>
        )}
        {improving && results && !busy && <p className="px-4 pt-2 text-[0.7rem] text-ink-3 animate-pulse">Checking spelling and related terms…</p>}
        {results && !busy && (
          <Section
            title={`Results (${results.length})`}
            action={
              results.length > 1 ? (
                <button
                  onClick={() => setScreening(true)}
                  className="rounded-full bg-accent text-white px-2.5 py-0.5 text-[0.68rem] font-medium normal-case tracking-normal hover:opacity-90"
                  title="Go through the results one card at a time: keep or skip"
                >
                  Screen {results.length} →
                </button>
              ) : null
            }
          >
            {results.length === 0 && <p className="px-4 pb-3 text-sm text-ink-3">No papers found.</p>}
            {results.map((p) => (
              <ResultRow key={p.id} p={p} open={state.papers.some((o) => o.id === p.id)} onClick={() => onOpen(p)} />
            ))}
          </Section>
        )}

        {state.queue.length > 0 && (
          <Section title={`Reading list (${state.queue.length})`}>
            {state.queue.map((p) => (
              <div key={p.id} className="group flex items-start gap-1 px-4 py-1.5 hover:bg-surface-2">
                <button onClick={() => onOpen(p as Paper)} title={p.title} className="flex-1 text-left text-sm text-ink-2 hover:text-ink line-clamp-2">
                  {p.title}
                </button>
                <button
                  onClick={() => onUnqueue(p.id)}
                  aria-label={`Remove ${p.title} from reading list`}
                  className="text-ink-3 hover:text-ink opacity-0 group-hover:opacity-100 focus:opacity-100"
                >
                  ×
                </button>
              </div>
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
                {p.local && <span className="text-[0.65rem] text-accent-ink shrink-0 mt-0.5">PDF</span>}
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
            <p>Search for a topic or paper, even with typos. Open papers to read them side by side and ask Copilot about them.</p>
            <p className="text-[0.68rem] font-semibold uppercase tracking-wider">Trending now</p>
            <div className="flex flex-wrap gap-1.5">
              {suggestions.map((t) => (
                <button
                  key={t}
                  type="button"
                  onClick={() => {
                    setQ(t);
                    search(undefined, t);
                  }}
                  title={t}
                  className="max-w-full rounded-full border border-line px-2.5 py-1 text-xs text-left leading-snug hover:border-ink-3 hover:text-ink"
                >
                  {t}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
      </>
      )}
      {tab === "search" && (
        <div className="shrink-0 border-t border-line px-3 py-2 flex items-center gap-2 text-[0.68rem] text-ink-3">
          <span className="flex-1 leading-snug">Your workspace and PDFs are saved in this browser only.</span>
          <button
            onClick={async () => {
              const r = await exportWorkspace();
              notify(`Backup saved: ${r.papers} open papers, ${r.pdfs} of your PDFs, notes and reading list.`, "info");
            }}
            className="rounded-md border border-line px-2 h-6 hover:border-accent hover:text-accent-ink"
            title="Download a backup file with your papers, notes, reading list and your own PDFs"
          >
            Back up
          </button>
          <button
            onClick={() => restoreInput.current?.click()}
            className="rounded-md border border-line px-2 h-6 hover:border-accent hover:text-accent-ink"
            title="Restore from a backup file. Merges into this workspace; nothing is deleted."
          >
            Restore
          </button>
          <input
            ref={restoreInput}
            type="file"
            accept="application/json,.json"
            className="hidden"
            onChange={async (e) => {
              const f = e.target.files?.[0];
              e.target.value = "";
              if (!f) return;
              try {
                const r = await importWorkspace(f);
                notify(`Restored ${r.papers} papers and ${r.pdfs} PDFs from the backup.`, "info");
              } catch (err) {
                notify(err instanceof Error ? err.message : "Could not read that backup.", "bad");
              }
            }}
          />
        </div>
      )}
      {screening && results && (
        <ScreenDeck
          papers={results}
          query={interp?.corrected || asked}
          onKeep={onKeep}
          onOpen={onOpen}
          onDone={(r) => {
            setScreening(false);
            onScreened(r.kept.length, results.length, r.seconds);
          }}
        />
      )}
    </div>
  );
}

function Section({ title, children, action }: { title: string; children: React.ReactNode; action?: React.ReactNode }) {
  return (
    <section className="py-2">
      <h3 className="px-4 pt-1 pb-1.5 text-[0.68rem] font-semibold uppercase tracking-wider text-ink-3 flex items-center justify-between gap-2">
        {title}
        {action}
      </h3>
      {children}
    </section>
  );
}

function ResultRow({ p, open, onClick }: { p: Paper; open: boolean; onClick: () => void }) {
  return (
    <button onClick={onClick} title={p.title} className="group w-full text-left px-4 py-2.5 hover:bg-surface-2 border-l-2 border-transparent hover:border-accent">
      <div className="text-sm leading-snug text-ink line-clamp-2 group-hover:text-accent-ink">{p.title}</div>
      <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[0.7rem] text-ink-3">
        <span className="font-mono">{p.year ?? ""}</span>
        <span>{p.cited_by_count.toLocaleString("en-GB")} cites</span>
        {p.is_retracted && <span className="rounded px-1 bg-bad-soft text-bad font-medium">Retracted</span>}
        {p.is_preprint && <span className="rounded px-1 bg-warn-soft text-warn">Preprint</span>}
        {p.is_oa && <span className="rounded px-1 bg-good-soft text-good">Open access</span>}
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
        <span>{pts.at(-1)!.year}</span>
      </div>
      <p className="mt-1.5 text-xs text-ink-2 leading-snug">
        Share of all papers: <strong className="text-ink">{pct(t.recent_growth)}</strong> a year recently ·{" "}
        {t.total_papers.toLocaleString("en-GB")} papers in total
      </p>
    </div>
  );
}

export type { OpenPaper };
