"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { Paper } from "@/lib/api";

/** The sentence of an abstract that carries its main claim, chosen by cue words. Verbatim, never rewritten. */
export function keySentence(abstract: string | null): { before: string; key: string; after: string } | null {
  if (!abstract) return null;
  const sents = abstract.replace(/\s+/g, " ").trim().match(/[^.!?]+[.!?]+(\s|$)/g) || [abstract];
  const cue = /\b(we (propose|present|introduce|show|find|demonstrate|develop)|results? (show|indicate|suggest)|outperform|achiev|improv|reveal|found that|significant)/i;
  let best = 0;
  let bestScore = -1;
  sents.forEach((s, i) => {
    const score = (cue.test(s) ? 3 : 0) + (/\d/.test(s) ? 1 : 0) + (i === 0 ? 0.5 : 0) - (s.length > 400 ? 2 : 0);
    if (score > bestScore) {
      bestScore = score;
      best = i;
    }
  });
  return { before: sents.slice(0, best).join(""), key: sents[best], after: sents.slice(best + 1).join("") };
}

export type ScreenResult = { kept: Paper[]; skipped: number; seconds: number };

/** Screening deck: go through search results one card at a time. Keep (→), skip (←), open (↵). */
export function ScreenDeck({
  papers,
  query,
  onKeep,
  onOpen,
  onDone,
}: {
  papers: Paper[];
  query: string;
  onKeep: (p: Paper) => void;
  onOpen: (p: Paper) => void;
  onDone: (r: ScreenResult) => void;
}) {
  const [i, setI] = useState(0);
  const [kept, setKept] = useState<Paper[]>([]);
  const [skipped, setSkipped] = useState(0);
  const [started] = useState(() => Date.now());
  const [anim, setAnim] = useState<"keep" | "skip" | null>(null);
  const [showAll, setShowAll] = useState(false);
  const [secs, setSecs] = useState(0);
  const p = papers[i];
  const finished = i >= papers.length;
  const ks = useMemo(() => keySentence(p?.abstract ?? null), [p]);

  const next = useCallback(
    (action: "keep" | "skip") => {
      if (!p || anim) return;
      setAnim(action);
      if (action === "keep") {
        setKept((k) => [...k, p]);
        onKeep(p);
      } else setSkipped((n) => n + 1);
      if (i + 1 >= papers.length) setSecs(Math.round((Date.now() - started) / 1000));
      setTimeout(() => {
        setAnim(null);
        setShowAll(false);
        setI((n) => n + 1);
      }, 180);
    },
    [p, anim, onKeep, i, papers.length, started],
  );

  const close = useCallback(
    () => onDone({ kept, skipped, seconds: Math.round((Date.now() - started) / 1000) }),
    [kept, skipped, started, onDone],
  );

  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
      else if (finished) return;
      else if (e.key === "ArrowRight" || e.key.toLowerCase() === "k") next("keep");
      else if (e.key === "ArrowLeft" || e.key.toLowerCase() === "j") next("skip");
      else if (e.key === "Enter" && p) onOpen(p);
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [next, close, finished, p, onOpen]);

  return (
    <div className="fixed inset-0 z-40 bg-black/40 backdrop-blur-sm grid place-items-center p-3" role="dialog" aria-modal="true" aria-label="Screen papers">
      <div className="w-full max-w-xl rounded-3xl border border-line bg-surface shadow-2xl overflow-hidden flex flex-col max-h-[92dvh]">
        <div className="px-5 pt-4 pb-3 border-b border-line">
          <div className="flex items-center gap-2 text-xs text-ink-3">
            <span className="font-semibold uppercase tracking-wider text-accent-ink">Screening</span>
            <span className="truncate">“{query}”</span>
            <span className="flex-1" />
            <span className="font-mono tabular-nums">
              {Math.min(i + 1, papers.length)} / {papers.length}
            </span>
            <button onClick={close} aria-label="Close screening" className="tool-btn">
              ×
            </button>
          </div>
          <div className="mt-2 h-1.5 rounded-full bg-surface-2 overflow-hidden flex">
            <div className="h-full bg-good transition-all" style={{ width: `${(kept.length / papers.length) * 100}%` }} />
            <div className="h-full bg-line transition-all" style={{ width: `${(skipped / papers.length) * 100}%` }} />
          </div>
        </div>

        {finished ? (
          <div className="p-8 text-center">
            <div className="text-4xl" aria-hidden="true">
              ✓
            </div>
            <h2 className="mt-2 text-xl font-semibold">Screened {papers.length} papers</h2>
            <p className="mt-1 text-sm text-ink-2">
              {kept.length} kept for reading, {skipped} skipped, in {secs < 90 ? `${secs} s` : `${Math.round(secs / 60)} min`}.
            </p>
            {kept.length > 0 && (
              <ul className="mt-4 text-left space-y-1.5 max-h-56 overflow-y-auto">
                {kept.map((k) => (
                  <li key={k.id}>
                    <button onClick={() => onOpen(k)} className="w-full text-left rounded-lg px-3 py-2 text-sm hover:bg-surface-2">
                      <span className="line-clamp-1">{k.title}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
            <button onClick={close} className="mt-5 rounded-xl bg-accent text-white px-5 h-10 text-sm font-medium">
              Done
            </button>
          </div>
        ) : (
          <>
            <article
              className={`flex-1 overflow-y-auto px-5 py-4 transition-all duration-200 ${
                anim === "keep" ? "translate-x-16 opacity-0" : anim === "skip" ? "-translate-x-16 opacity-0" : ""
              }`}
            >
              <div className="flex flex-wrap gap-1.5 text-[0.7rem]">
                {p.is_retracted && <span className="rounded px-1.5 py-0.5 bg-bad-soft text-bad font-medium">Retracted</span>}
                {p.is_preprint && <span className="rounded px-1.5 py-0.5 bg-warn-soft text-warn">Preprint · not peer reviewed</span>}
                {p.is_oa && <span className="rounded px-1.5 py-0.5 bg-good-soft text-good">Open access · readable here</span>}
                <span className="rounded px-1.5 py-0.5 bg-surface-2 text-ink-2">{p.cited_by_count.toLocaleString("en-GB")} citations</span>
                {p.year && <span className="rounded px-1.5 py-0.5 bg-surface-2 text-ink-2 font-mono">{p.year}</span>}
              </div>
              <h2 className="mt-3 text-lg font-semibold leading-snug">{p.title}</h2>
              {p.authors?.length > 0 && (
                <p className="mt-1 text-xs text-ink-3">
                  {p.authors.slice(0, 4).join(", ")}
                  {p.authors.length > 4 ? " et al." : ""}
                  {p.venue ? ` · ${p.venue}` : ""}
                </p>
              )}
              {ks ? (
                <div className="mt-4">
                  <div className="text-[0.65rem] font-semibold uppercase tracking-wider text-ink-3">Key sentence from the abstract</div>
                  <p className="mt-1.5 text-[0.95rem] leading-relaxed">
                    {showAll && <span className="text-ink-3">{ks.before}</span>}
                    <mark className="bg-accent-soft text-ink rounded px-0.5">{ks.key}</mark>
                    {showAll && <span className="text-ink-3">{ks.after}</span>}
                  </p>
                  {(ks.before || ks.after) && (
                    <button onClick={() => setShowAll((v) => !v)} className="mt-1 text-xs text-accent-ink hover:underline">
                      {showAll ? "Show key sentence only" : "Show full abstract"}
                    </button>
                  )}
                </div>
              ) : (
                <p className="mt-4 text-sm text-ink-3">No abstract available.</p>
              )}
            </article>
            <div className="grid grid-cols-3 gap-2 p-3 border-t border-line">
              <button onClick={() => next("skip")} className="rounded-xl border border-line h-12 text-sm font-medium hover:border-ink-3">
                ← Skip
              </button>
              <button onClick={() => onOpen(p)} className="rounded-xl border border-line h-12 text-sm font-medium hover:border-accent hover:text-accent-ink">
                Open ↵
              </button>
              <button onClick={() => next("keep")} className="rounded-xl bg-good text-bg h-12 text-sm font-semibold hover:opacity-90">
                Keep →
              </button>
            </div>
            <p className="pb-3 text-center text-[0.68rem] text-ink-3 hidden sm:block">
              Keys: ← skip · → keep · Enter open · Esc stop. Kept papers go to your reading list.
            </p>
          </>
        )}
      </div>
    </div>
  );
}
