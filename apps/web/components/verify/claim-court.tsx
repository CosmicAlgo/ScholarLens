"use client";

import { useEffect, useRef, useState } from "react";
import { claimCourt, claimSuggestions, citingLink, type CourtItem, type CourtResult, type Stance } from "@/lib/verify";
import { Bar, ErrorBox, Marked, PaperPicker, type Picked, Working } from "./shared";

const STANCE: Record<Stance, { label: string; color: string; tone: "good" | "bad" | "accent"; chip: string }> = {
  supports: { label: "Supports", color: "var(--good)", tone: "good", chip: "bg-good-soft text-good border-good/30" },
  disputes: { label: "Disputes", color: "var(--bad)", tone: "bad", chip: "bg-bad-soft text-bad border-bad/30" },
  mentions: { label: "Mentions", color: "var(--ink-3)", tone: "accent", chip: "bg-surface-2 text-ink-2 border-line" },
};

const VERDICT_STYLE = {
  supported: "border-good/30 bg-good-soft",
  mostly_supported: "border-good/30 bg-good-soft",
  contested: "border-bad/30 bg-bad-soft",
  not_enough: "border-line bg-surface",
} as const;

export function ClaimCourt({ initialPaper, initialClaim }: { initialPaper: string; initialClaim: string }) {
  const [paper, setPaper] = useState<Picked | null>(
    initialPaper ? { id: initialPaper, title: initialPaper, year: null, abstract: "" } : null,
  );
  const [claim, setClaim] = useState(initialClaim);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [res, setRes] = useState<CourtResult | null>(null);
  const [filter, setFilter] = useState<Stance | "all">("all");
  const abort = useRef<AbortController | null>(null);
  useEffect(() => () => abort.current?.abort(), []);

  const run = async () => {
    if (!paper) return;
    abort.current?.abort();
    const ctl = (abort.current = new AbortController());
    setBusy(true);
    setErr("");
    setRes(null);
    try {
      const r = await claimCourt(paper.id, claim, ctl.signal);
      setRes(r);
      setFilter("all");
      setPaper((p) => (p ? { ...p, title: r.paper.title, year: r.paper.year, abstract: r.paper.abstract || p.abstract, cited_by: r.paper.cited_by } : p));
    } catch (e) {
      if (!ctl.signal.aborted) setErr(e instanceof Error ? e.message : "Something went wrong.");
    } finally {
      if (!ctl.signal.aborted) setBusy(false);
    }
  };

  const suggestions = paper?.abstract ? claimSuggestions(paper.abstract, false, paper.title) : [];
  const shown = res ? res.items.filter((x) => filter === "all" || x.stance === filter) : [];

  return (
    <div className="space-y-4">
      <PaperPicker
        value={paper}
        onPick={(p) => {
          setPaper(p);
          setRes(null);
        }}
      />
      {paper && (
        <div className="rounded-2xl border border-line bg-surface p-4">
          <label htmlFor="cc-claim" className="text-sm font-medium">
            The claim on trial <span className="text-ink-3 font-normal">(optional: leave empty to judge the paper&rsquo;s main findings)</span>
          </label>
          <textarea
            id="cc-claim"
            value={claim}
            onChange={(e) => setClaim(e.target.value)}
            maxLength={600}
            rows={2}
            placeholder="e.g. Diffusion models produce higher quality images than GANs"
            className="mt-2 w-full rounded-xl border border-line bg-bg px-3 py-2 text-sm outline-none focus:border-accent resize-y"
          />
          {suggestions.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-1.5">
              <span className="text-xs text-ink-3 py-1">From the abstract:</span>
              {suggestions.map((s) => (
                <button
                  key={s}
                  onClick={() => setClaim(s)}
                  className="text-left text-xs rounded-lg border border-line bg-surface-2 px-2 py-1 text-ink-2 hover:border-ink-3 max-w-full line-clamp-2"
                  title={s}
                >
                  {s}
                </button>
              ))}
            </div>
          )}
          <button
            onClick={run}
            disabled={busy}
            className="mt-3 h-10 rounded-xl bg-accent text-white font-medium px-5 hover:opacity-90 disabled:opacity-50"
          >
            {busy ? "In session…" : "Call the court"}
          </button>
        </div>
      )}

      {busy && (
        <Working
          typical="Usually 20 to 90 seconds."
          steps={[
            "Collecting the sentences in which other papers cite this one (Semantic Scholar)",
            "Picking the 40 most relevant to the claim",
            "An AI clerk labels each one and must quote the words that justify its label",
            "Labels whose quote is not really in the sentence are thrown out; the verdict is counted in code",
          ]}
        />
      )}
      {err && <ErrorBox text={err} />}

      {res && (
        <section className="space-y-4">
          <div className={`rounded-2xl border p-5 ${VERDICT_STYLE[res.verdict.label]}`}>
            <p className="text-[0.65rem] uppercase tracking-wider text-ink-3">Verdict</p>
            <p className="mt-1 text-xl font-semibold leading-snug">{res.verdict.text}</p>
            <p className="mt-1 text-sm text-ink-2">
              On {res.claim ? <>“{res.claim}”</> : <>the main findings of “{res.paper.title}”</>}
            </p>
            {res.paper.retracted && <p className="mt-2 text-sm font-medium text-bad">The source paper itself has been retracted.</p>}
            {res.items.length > 0 && (
              <div className="mt-4">
                <Bar
                  parts={(["supports", "disputes", "mentions"] as Stance[]).map((s) => ({ n: res.tally[s], color: STANCE[s].color, label: STANCE[s].label }))}
                />
                <div className="mt-3 grid grid-cols-3 gap-2">
                  {(["supports", "disputes", "mentions"] as Stance[]).map((s) => (
                    <button
                      key={s}
                      onClick={() => setFilter(filter === s ? "all" : s)}
                      aria-pressed={filter === s}
                      className={`rounded-xl border px-3 py-2 text-left ${filter === s ? STANCE[s].chip : "border-line bg-surface hover:border-ink-3"}`}
                    >
                      <span className="block font-mono text-2xl font-semibold" style={{ color: STANCE[s].color }}>
                        {res.tally[s]}
                      </span>
                      <span className="text-xs text-ink-2">{STANCE[s].label}</span>
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>

          {res.note && <p className="text-sm text-ink-2">{res.note}</p>}

          <ul className="space-y-2">
            {shown.map((x, i) => (
              <Witness key={i} x={x} />
            ))}
          </ul>

          <p className="text-xs text-ink-3 leading-relaxed">
            Judged the {res.coverage.sentences_judged} most relevant of {res.coverage.sentences_available.toLocaleString("en-GB")} citing
            sentences available ({res.coverage.cited_by.toLocaleString("en-GB")} papers cite it; sentences exist mostly for open-access
            ones). Stance labels are AI judgements. Each “supports” or “disputes” label is backed by a quote that was checked, in code,
            to be in that sentence
            {res.coverage.labels_without_proof > 0 && <>; {res.coverage.labels_without_proof} label(s) without proof were downgraded to mentions</>}
            . The verdict is computed from the counts.{res.cached ? " (Cached result.)" : ""}
          </p>
        </section>
      )}
    </div>
  );
}

function Witness({ x }: { x: CourtItem }) {
  const s = STANCE[x.stance];
  const link = citingLink(x.paper);
  return (
    <li className="rounded-2xl border border-line bg-surface p-4" style={{ borderLeft: `3px solid ${s.color}` }}>
      <div className="flex flex-wrap items-center gap-2">
        <span className={`rounded-full border px-2 py-0.5 text-[0.68rem] font-medium ${s.chip}`}>{s.label}</span>
        {x.influential && (
          <span className="rounded-full border border-line px-2 py-0.5 text-[0.68rem] text-ink-3" title="Semantic Scholar marks this citation as influential">
            Influential
          </span>
        )}
      </div>
      <blockquote className="mt-2 text-sm leading-relaxed text-ink">
        “<Marked text={x.text} quote={x.quote} tone={s.tone} />”
      </blockquote>
      <p className="mt-2 text-xs text-ink-3">
        {link ? (
          <a href={link} target="_blank" rel="noreferrer" className="hover:text-accent-ink underline-offset-2 hover:underline">
            {x.paper.title}
          </a>
        ) : (
          x.paper.title
        )}
        {[x.paper.year, x.paper.venue].filter(Boolean).length > 0 && <> · {[x.paper.year, x.paper.venue].filter(Boolean).join(" · ")}</>}
      </p>
    </li>
  );
}
