"use client";

import { useEffect, useRef, useState } from "react";
import { fetchPaper, fetchSearch, type Paper } from "@/lib/api";
import { paperIdFrom } from "@/lib/verify";

export type Picked = { id: string; title: string; year: number | null; abstract: string; cited_by?: number };

/** Find the source paper by searching, or by pasting a DOI / OpenAlex link. */
export function PaperPicker({ value, onPick }: { value: Picked | null; onPick: (p: Picked | null) => void }) {
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<Paper[]>([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const run = useRef(0);

  // Arrived from a link with only an id: fill in the title and abstract (claim suggestions need it).
  const bareId = value && value.title === value.id && /^W\d+$/.test(value.id) ? value.id : null;
  useEffect(() => {
    if (!bareId) return;
    let live = true;
    fetchPaper(bareId)
      .then((p) => live && onPick({ id: p.id, title: p.title, year: p.year, abstract: p.abstract || "", cited_by: p.cited_by_count }))
      .catch(() => {});
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bareId]);

  const search = async (e?: React.FormEvent) => {
    e?.preventDefault();
    const text = q.trim();
    if (text.length < 2) return;
    const direct = paperIdFrom(text);
    if (direct) {
      onPick({ id: direct, title: direct.startsWith("W") ? `OpenAlex ${direct}` : `DOI ${direct}`, year: null, abstract: "" });
      return;
    }
    const n = ++run.current;
    setBusy(true);
    setErr("");
    try {
      const r = await fetchSearch(text, 8, true);
      if (n === run.current) setHits(r.results);
      if (n === run.current && !r.results.length) setErr("No papers found. Try the exact title, or paste its DOI.");
    } catch (e) {
      if (n === run.current) setErr(e instanceof Error ? e.message : "Search failed.");
    } finally {
      if (n === run.current) setBusy(false);
    }
  };

  if (value)
    return (
      <div className="rounded-2xl border border-line bg-surface p-4 flex items-start gap-3">
        <span className="w-9 h-9 shrink-0 rounded-lg bg-accent-soft text-accent-ink grid place-items-center" aria-hidden="true">
          ¶
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-[0.65rem] uppercase tracking-wider text-ink-3">Source paper</p>
          <p className="font-semibold leading-snug">{value.title}</p>
          <p className="text-xs text-ink-3 mt-0.5">
            {[value.year, value.cited_by != null ? `${value.cited_by.toLocaleString("en-GB")} citations` : null].filter(Boolean).join(" · ")}
          </p>
        </div>
        <button onClick={() => onPick(null)} className="text-xs rounded-lg border border-line px-2.5 h-8 hover:border-ink-3">
          Change
        </button>
      </div>
    );

  return (
    <div className="rounded-2xl border border-line bg-surface p-4">
      <form onSubmit={search} className="flex gap-2">
        <label className="sr-only" htmlFor="pp-q">
          Paper title, DOI or OpenAlex link
        </label>
        <input
          id="pp-q"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          maxLength={300}
          placeholder="Paper title, or paste a DOI / OpenAlex link"
          className="flex-1 min-w-0 h-11 rounded-xl border border-line bg-bg px-3 text-sm outline-none focus:border-accent"
        />
        <button className="h-11 rounded-xl bg-accent text-white font-medium px-4 hover:opacity-90 disabled:opacity-50" disabled={busy}>
          {busy ? "Searching…" : "Find"}
        </button>
      </form>
      {err && <p className="mt-2 text-sm text-bad">{err}</p>}
      {hits.length > 0 && (
        <ul className="mt-3 divide-y divide-line border border-line rounded-xl overflow-hidden">
          {hits.map((h) => (
            <li key={h.id}>
              <button
                onClick={() => onPick({ id: h.id, title: h.title, year: h.year, abstract: h.abstract || "", cited_by: h.cited_by_count })}
                className="w-full text-left px-3 py-2.5 hover:bg-surface-2"
              >
                <span className="block text-sm font-medium leading-snug">{h.title}</span>
                <span className="block text-xs text-ink-3 mt-0.5">
                  {[h.year, h.venue, `${h.cited_by_count.toLocaleString("en-GB")} citations`].filter(Boolean).join(" · ")}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** Honest progress: what is happening and how long it has taken, no fake percentages. */
export function Working({ steps, typical }: { steps: string[]; typical: string }) {
  const [t, setT] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setT((x) => x + 1), 1000);
    return () => clearInterval(id);
  }, []);
  return (
    <div className="rounded-2xl border border-line bg-surface p-5" aria-live="polite">
      <div className="flex items-center gap-3">
        <span className="w-4 h-4 rounded-full border-2 border-accent border-t-transparent animate-spin" aria-hidden="true" />
        <span className="font-medium">Working</span>
        <span className="ml-auto font-mono text-xs text-ink-3">{t}s</span>
      </div>
      <ol className="mt-3 space-y-1.5 text-sm text-ink-2">
        {steps.map((s, i) => (
          <li key={s} className="flex gap-2">
            <span className="font-mono text-xs text-ink-3 w-4 pt-0.5">{i + 1}</span>
            {s}
          </li>
        ))}
      </ol>
      <p className="mt-3 text-xs text-ink-3">{typical} Results are cached for a day, so repeats are instant.</p>
    </div>
  );
}

/** Text with one quoted span marked. The quote was checked to be in the text by the server. */
export function Marked({ text, quote, tone = "accent" }: { text: string; quote: string; tone?: "good" | "bad" | "accent" | "warn" }) {
  const cls = { good: "bg-good-soft text-good", bad: "bg-bad-soft text-bad", accent: "bg-accent-soft text-accent-ink", warn: "bg-warn-soft text-warn" }[tone];
  if (!quote) return <>{text}</>;
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  const idx = text.toLowerCase().indexOf(quote.toLowerCase());
  if (idx >= 0)
    return (
      <>
        {text.slice(0, idx)}
        <mark className={`rounded px-0.5 ${cls}`}>{text.slice(idx, idx + quote.length)}</mark>
        {text.slice(idx + quote.length)}
      </>
    );
  // Punctuation differs: mark the words of the quote instead.
  const words = new Set(norm(quote).split(" ").filter((w) => w.length > 2));
  return (
    <>
      {text.split(/(\s+)/).map((w, i) =>
        words.has(norm(w)) ? (
          <mark key={i} className={`rounded px-0.5 ${cls}`}>
            {w}
          </mark>
        ) : (
          <span key={i}>{w}</span>
        ),
      )}
    </>
  );
}

export function ErrorBox({ text }: { text: string }) {
  return <div className="rounded-xl border border-bad/30 bg-bad-soft px-4 py-3 text-sm text-bad">{text}</div>;
}

export function Bar({ parts }: { parts: { n: number; color: string; label: string }[] }) {
  const total = parts.reduce((a, p) => a + p.n, 0) || 1;
  return (
    <div className="flex h-3 w-full overflow-hidden rounded-full bg-surface-2" role="img" aria-label={parts.map((p) => `${p.n} ${p.label}`).join(", ")}>
      {parts.map((p) => (p.n ? <span key={p.label} style={{ width: `${(p.n / total) * 100}%`, background: p.color }} title={`${p.n} ${p.label}`} /> : null))}
    </div>
  );
}
