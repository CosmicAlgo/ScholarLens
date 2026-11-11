"use client";

import { useEffect, useRef, useState } from "react";
import { citationTelephone, citingLink, claimSuggestions, type Fate, type PhoneResult, type Retelling } from "@/lib/verify";
import { Bar, ErrorBox, PaperPicker, type Picked, Working } from "./shared";

const FATE: Record<Fate, { label: string; blurb: string; color: string; chip: string }> = {
  faithful: { label: "Kept", blurb: "the number survived", color: "var(--good)", chip: "bg-good-soft text-good border-good/30" },
  rounded: { label: "Rounded", blurb: "within 3%", color: "var(--accent)", chip: "bg-accent-soft text-accent-ink border-accent/30" },
  changed: { label: "Changed", blurb: "a different number", color: "var(--bad)", chip: "bg-bad-soft text-bad border-bad/30" },
  vaguer: { label: "Vaguer", blurb: "the number was dropped", color: "var(--warn)", chip: "bg-warn-soft text-warn border-warn/30" },
  overstated: { label: "Overstated", blurb: "stated more strongly", color: "var(--vision)", chip: "bg-vision-soft text-vision border-vision/30" },
};
const ORDER: Fate[] = ["faithful", "rounded", "changed", "vaguer", "overstated"];

export function Telephone({ initialPaper, initialClaim }: { initialPaper: string; initialClaim: string }) {
  const [paper, setPaper] = useState<Picked | null>(initialPaper ? { id: initialPaper, title: initialPaper, year: null, abstract: "" } : null);
  const [claim, setClaim] = useState(initialClaim);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [res, setRes] = useState<PhoneResult | null>(null);
  const [filter, setFilter] = useState<Fate | "all">("all");
  const abort = useRef<AbortController | null>(null);
  useEffect(() => () => abort.current?.abort(), []);

  const run = async () => {
    if (!paper || claim.trim().length < 8) return;
    abort.current?.abort();
    const ctl = (abort.current = new AbortController());
    setBusy(true);
    setErr("");
    setRes(null);
    try {
      const r = await citationTelephone(paper.id, claim, ctl.signal);
      setRes(r);
      setFilter("all");
      setPaper((p) => (p ? { ...p, title: r.paper.title, year: r.paper.year, abstract: r.paper.abstract || p.abstract, cited_by: r.paper.cited_by } : p));
    } catch (e) {
      if (!ctl.signal.aborted) setErr(e instanceof Error ? e.message : "Something went wrong.");
    } finally {
      if (!ctl.signal.aborted) setBusy(false);
    }
  };

  const suggestions = paper?.abstract ? claimSuggestions(paper.abstract, true, paper.title) : [];

  return (
    <div className="space-y-4">
      <PaperPicker
        value={paper}
        onPick={(p) => {
          setPaper(p);
          setRes(null);
        }}
      />
      {!paper && (
        <button
          onClick={() => {
            setPaper({ id: "W2346834216", title: "Medical error—the third leading cause of death in the US", year: 2016, abstract: "" });
            setClaim("medical error is the third leading cause of death in the US, with an estimated 251,454 deaths a year");
          }}
          className="text-sm text-accent-ink underline underline-offset-2"
        >
          Try a famous one: the “251,454 deaths from medical error” estimate
        </button>
      )}
      {paper && (
        <div className="rounded-2xl border border-line bg-surface p-4">
          <label htmlFor="ct-claim" className="text-sm font-medium">
            The finding to follow <span className="text-ink-3 font-normal">(works best with a number)</span>
          </label>
          <textarea
            id="ct-claim"
            value={claim}
            onChange={(e) => setClaim(e.target.value)}
            maxLength={500}
            rows={2}
            placeholder="e.g. we estimate 251,454 deaths a year from medical error"
            className="mt-2 w-full rounded-xl border border-line bg-bg px-3 py-2 text-sm outline-none focus:border-accent resize-y"
          />
          {suggestions.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-1.5">
              <span className="text-xs text-ink-3 py-1">Numbers in the abstract:</span>
              {suggestions.map((s) => (
                <button
                  key={s}
                  onClick={() => setClaim(s)}
                  title={s}
                  className="text-left text-xs rounded-lg border border-line bg-surface-2 px-2 py-1 text-ink-2 hover:border-ink-3 max-w-full line-clamp-2"
                >
                  {s}
                </button>
              ))}
            </div>
          )}
          <button
            onClick={run}
            disabled={busy || claim.trim().length < 8}
            className="mt-3 h-10 rounded-xl bg-accent text-white font-medium px-5 hover:opacity-90 disabled:opacity-50"
          >
            {busy ? "Listening down the line…" : "Follow the number"}
          </button>
        </div>
      )}

      {busy && (
        <Working
          typical="Usually 20 to 90 seconds."
          steps={[
            "Collecting every sentence that cites the source paper",
            "An AI agent finds the ones that retell this finding and copies their exact words",
            "Following the retellings one generation further: who cited the citers?",
            "Comparing the numbers in code: kept, rounded, changed or dropped",
          ]}
        />
      )}
      {err && <ErrorBox text={err} />}
      {res && <PhoneView res={res} filter={filter} setFilter={setFilter} />}
    </div>
  );
}

function PhoneView({ res, filter, setFilter }: { res: PhoneResult; filter: Fate | "all"; setFilter: (f: Fate | "all") => void }) {
  const total = res.hop1.length + res.hop2.length;
  const mutations = [...res.hop1, ...res.hop2]
    .filter((x) => x.fate === "changed" || x.fate === "overstated")
    .sort((a, b) => (a.paper.year ?? 9999) - (b.paper.year ?? 9999));
  const first = mutations[0];
  const kids = (sid: string | null) => res.hop2.filter((h) => h.parent && h.parent === sid);
  const visible = (x: Retelling) => filter === "all" || x.fate === filter;
  const roots = [...res.hop1].sort((a, b) => (a.paper.year ?? 9999) - (b.paper.year ?? 9999));
  const orphans = res.hop2.filter((h) => !res.hop1.some((p) => p.paper.s2 && p.paper.s2 === h.parent));

  return (
    <section className="space-y-4">
      <div className="rounded-2xl border border-line bg-surface p-5">
        <p className="text-[0.65rem] uppercase tracking-wider text-ink-3">The original</p>
        <p className="mt-1 text-lg font-semibold leading-snug">
          “<Numbers text={res.claim} claim={res.claim_numbers} />”
        </p>
        <p className="mt-1 text-sm text-ink-2">
          {res.paper.title}
          {res.paper.year ? ` (${res.paper.year})` : ""}
        </p>
        <p className={`mt-2 text-xs ${res.claim_in_source ? "text-good" : "text-warn"}`}>
          {res.claim_in_source
            ? "✓ Found in the source's abstract."
            : "We could not find this in the source's abstract. It may be in the full text, so check the original before relying on it."}
        </p>
        {total > 0 && (
          <div className="mt-4">
            <Bar parts={ORDER.map((f) => ({ n: res.counts[f], color: FATE[f].color, label: FATE[f].label }))} />
            <div className="mt-3 grid grid-cols-2 sm:grid-cols-5 gap-2">
              {ORDER.map((f) => (
                <button
                  key={f}
                  onClick={() => setFilter(filter === f ? "all" : f)}
                  aria-pressed={filter === f}
                  className={`rounded-xl border px-3 py-2 text-left ${filter === f ? FATE[f].chip : "border-line bg-surface hover:border-ink-3"}`}
                >
                  <span className="block font-mono text-2xl font-semibold" style={{ color: FATE[f].color }}>
                    {res.counts[f]}
                  </span>
                  <span className="text-xs text-ink-2">{FATE[f].label}</span>
                  <span className="block text-[0.65rem] text-ink-3">{FATE[f].blurb}</span>
                </button>
              ))}
            </div>
          </div>
        )}
      </div>

      {first && (
        <div className="rounded-2xl border border-bad/30 bg-bad-soft p-4">
          <p className="text-[0.65rem] uppercase tracking-wider text-bad">Earliest change we found</p>
          <p className="mt-1 text-sm leading-relaxed">
            “<Numbers text={first.stated} claim={res.claim_numbers} />”
          </p>
          <p className="mt-1 text-xs text-ink-2">
            {first.paper.title}
            {first.paper.year ? ` (${first.paper.year})` : ""}. {mutations.length > 1 ? `${mutations.length - 1} more retelling(s) changed it too.` : ""}
          </p>
        </div>
      )}

      {res.note && <p className="text-sm text-ink-2">{res.note}</p>}

      {total > 0 && (
        <div>
          <h3 className="text-xs font-semibold uppercase tracking-wider text-ink-3">Down the line, oldest first</h3>
          <ol className="mt-3 relative border-l-2 border-line ml-2 space-y-3">
            {roots.map((x, i) => {
              const children = kids(x.paper.s2).filter(visible);
              if (!visible(x) && !children.length) return null;
              return (
                <li key={i} className="pl-4 relative">
                  <span className="absolute -left-[7px] top-4 w-3 h-3 rounded-full border-2 border-surface" style={{ background: FATE[x.fate].color }} aria-hidden="true" />
                  <RetellingCard x={x} claim={res.claim_numbers} dim={!visible(x)} />
                  {children.length > 0 && (
                    <ol className="mt-2 ml-4 border-l-2 border-dashed border-line space-y-2">
                      {children.map((c, j) => (
                        <li key={j} className="pl-4">
                          <RetellingCard x={c} claim={res.claim_numbers} second />
                        </li>
                      ))}
                    </ol>
                  )}
                </li>
              );
            })}
            {orphans.filter(visible).map((c, j) => (
              <li key={`o${j}`} className="pl-4">
                <RetellingCard x={c} claim={res.claim_numbers} second />
              </li>
            ))}
          </ol>
        </div>
      )}

      <p className="text-xs text-ink-3 leading-relaxed">
        Searched {res.coverage.sentences_available.toLocaleString("en-GB")} citing sentences, then followed {res.coverage.parents_followed}{" "}
        retellings one generation further. An AI agent picks the sentences that retell the finding and must copy their exact words (checked in
        code); the numbers are compared in code. When the finding has no number, the AI compares the wording and the card says so. Citation
        sentences exist mostly for open-access papers, so this is a sample, not a census.{res.cached ? " (Cached result.)" : ""}
      </p>
    </section>
  );
}

function RetellingCard({ x, claim, second, dim }: { x: Retelling; claim: number[]; second?: boolean; dim?: boolean }) {
  const f = FATE[x.fate];
  const link = citingLink(x.paper);
  return (
    <div className={`rounded-xl border border-line bg-surface p-3 ${dim ? "opacity-50" : ""}`}>
      <div className="flex flex-wrap items-center gap-2">
        <span className={`rounded-full border px-2 py-0.5 text-[0.68rem] font-medium ${f.chip}`}>{f.label}</span>
        {second && <span className="text-[0.68rem] text-ink-3">2nd generation: cites a paper that cites the original</span>}
        {x.decided_by === "ai" && <span className="text-[0.68rem] text-ink-3">wording compared by AI</span>}
        <span className="ml-auto font-mono text-xs text-ink-3">{x.paper.year ?? ""}</span>
      </div>
      <p className="mt-2 text-sm leading-relaxed">
        “<Numbers text={x.stated} claim={claim} />”
      </p>
      <p className="mt-1.5 text-xs text-ink-3">
        {link ? (
          <a href={link} target="_blank" rel="noreferrer" className="hover:text-accent-ink hover:underline underline-offset-2">
            {x.paper.title}
          </a>
        ) : (
          x.paper.title
        )}
      </p>
    </div>
  );
}

/** Numbers matching the original in green, others in red. */
function Numbers({ text, claim }: { text: string; claim: number[] }) {
  const re = /(\d{1,3}(?:[,   ]\d{3})+|\d+(?:\.\d+)?)(\s?%)?/g;
  const out: React.ReactNode[] = [];
  let last = 0;
  for (const m of text.matchAll(re)) {
    const v = parseFloat(m[1].replace(/[,   ]/g, ""));
    const salient = m[2] || m[1].includes(".") || (v > 10 && !(v >= 1900 && v <= 2100));
    if (!salient) continue;
    out.push(text.slice(last, m.index));
    const ok = claim.some((c) => Math.abs(c - v) <= 0.03 * Math.max(c, v));
    out.push(
      <mark key={m.index} className={`rounded px-0.5 font-semibold ${claim.length === 0 ? "bg-accent-soft text-accent-ink" : ok ? "bg-good-soft text-good" : "bg-bad-soft text-bad"}`}>
        {m[0]}
      </mark>,
    );
    last = (m.index ?? 0) + m[0].length;
  }
  out.push(text.slice(last));
  return <>{out}</>;
}
