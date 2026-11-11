"use client";

import { useEffect, useRef, useState } from "react";
import { checkReferences, pdfText, type ClaimCheck, type RefCheckResult, type RefResult, type RefStatus } from "@/lib/verify";
import { ErrorBox, Marked, Working } from "./shared";

const STATUS: Record<RefStatus, { label: string; icon: string; chip: string; rank: number }> = {
  not_found: { label: "Not found", icon: "✕", chip: "bg-bad-soft text-bad border-bad/30", rank: 0 },
  retracted: { label: "Retracted", icon: "⚠", chip: "bg-bad-soft text-bad border-bad/30", rank: 1 },
  doi_mismatch: { label: "Wrong DOI", icon: "≠", chip: "bg-warn-soft text-warn border-warn/30", rank: 2 },
  check_details: { label: "Check details", icon: "!", chip: "bg-warn-soft text-warn border-warn/30", rank: 3 },
  unreadable: { label: "Unreadable", icon: "?", chip: "bg-surface-2 text-ink-2 border-line", rank: 4 },
  verified: { label: "Verified", icon: "✓", chip: "bg-good-soft text-good border-good/30", rank: 5 },
};
const ORDER: RefStatus[] = ["not_found", "retracted", "doi_mismatch", "check_details", "unreadable", "verified"];

const VERDICT = {
  supported: { label: "Abstract backs it", chip: "bg-good-soft text-good border-good/30", tone: "good" as const },
  contradicted: { label: "Abstract contradicts it", chip: "bg-bad-soft text-bad border-bad/30", tone: "bad" as const },
  not_in_abstract: { label: "Not in the abstract", chip: "bg-surface-2 text-ink-2 border-line", tone: "accent" as const },
};

const EXAMPLE = `1. Introduction
Transformers replaced recurrence entirely with attention and reached 28.4 BLEU on WMT 2014 English-to-German [1]. Residual networks won ILSVRC 2015 with a 3.57% top-5 error [2]. A link between the MMR vaccine and autism has been reported [4]. Protein language models can fold any protein in under one millisecond [3].

References
[1] Vaswani, A., Shazeer, N., Parmar, N., et al. Attention is all you need. Advances in Neural Information Processing Systems, 2015.
[2] He, K., Zhang, X., Ren, S., Sun, J. Deep residual learning for image recognition. CVPR 2016. https://doi.org/10.1109/CVPR.2016.90
[3] Lindqvist, M., Okafor, T. Quantum gradient folding for self-supervised protein linguistics. Nature Machine Intelligence, 2021.
[4] Wakefield, A. J., et al. Ileal-lymphoid-nodular hyperplasia, non-specific colitis, and pervasive developmental disorder in children. The Lancet, 1998.`;

export function RefCheck() {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [reading, setReading] = useState(false);
  const [err, setErr] = useState("");
  const [res, setRes] = useState<RefCheckResult | null>(null);
  const [filter, setFilter] = useState<RefStatus | "problems" | "all">("all");
  const abort = useRef<AbortController | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  useEffect(() => () => abort.current?.abort(), []);

  const run = async () => {
    if (text.trim().length < 20) return;
    abort.current?.abort();
    const ctl = (abort.current = new AbortController());
    setBusy(true);
    setErr("");
    setRes(null);
    try {
      const r = await checkReferences(text, ctl.signal);
      setRes(r);
      const problems = r.references.some((x) => x.status !== "verified");
      setFilter(problems ? "problems" : "all");
    } catch (e) {
      if (!ctl.signal.aborted) setErr(e instanceof Error ? e.message : "Something went wrong.");
    } finally {
      if (!ctl.signal.aborted) setBusy(false);
    }
  };

  const onFile = async (f: File | undefined) => {
    if (!f) return;
    setErr("");
    setReading(true);
    try {
      if (f.type === "application/pdf" || f.name.toLowerCase().endsWith(".pdf")) setText(await pdfText(f));
      else setText((await f.text()).slice(0, 200_000));
    } catch {
      setErr("Could not read that file. Paste the text instead.");
    } finally {
      setReading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  const refs = res ? [...res.references].sort((a, b) => STATUS[a.status].rank - STATUS[b.status].rank || a.n - b.n) : [];
  const shown = refs.filter((r) => filter === "all" || (filter === "problems" ? r.status !== "verified" : r.status === filter));
  const claimsFor = (n: number) => (res?.claims || []).filter((c) => c.ref === n);

  return (
    <div className="space-y-4">
      <div className="rounded-2xl border border-line bg-surface p-4">
        <div className="flex flex-wrap items-center gap-2">
          <label htmlFor="rc-text" className="text-sm font-medium">
            Paste a reference list, or a whole draft with one
          </label>
          <span className="flex-1" />
          <button onClick={() => setText(EXAMPLE)} className="text-xs rounded-lg border border-line px-2.5 h-8 hover:border-ink-3">
            Try an example
          </button>
          <button
            onClick={() => fileRef.current?.click()}
            className="text-xs rounded-lg border border-line px-2.5 h-8 hover:border-ink-3 disabled:opacity-50"
            disabled={reading}
          >
            {reading ? "Reading…" : "Upload PDF or .txt"}
          </button>
          <input ref={fileRef} type="file" accept=".pdf,.txt,.md,.bib,application/pdf,text/plain" className="hidden" onChange={(e) => onFile(e.target.files?.[0])} />
        </div>
        <textarea
          id="rc-text"
          value={text}
          onChange={(e) => setText(e.target.value.slice(0, 200_000))}
          rows={9}
          placeholder={"References\n[1] Vaswani, A. et al. Attention is all you need. NeurIPS, 2017.\n[2] …"}
          className="mt-2 w-full rounded-xl border border-line bg-bg px-3 py-2 text-sm font-mono outline-none focus:border-accent resize-y"
        />
        <div className="mt-2 flex flex-wrap items-center gap-3">
          <button
            onClick={run}
            disabled={busy || text.trim().length < 20}
            className="h-10 rounded-xl bg-accent text-white font-medium px-5 hover:opacity-90 disabled:opacity-50"
          >
            {busy ? "Checking…" : "Check citations"}
          </button>
          <span className="text-xs text-ink-3">
            Up to 120 references. With a draft, we also check up to 30 citing sentences against the cited abstracts. PDFs are read in your
            browser; only the text is sent.
          </span>
        </div>
      </div>

      {busy && (
        <Working
          typical="Usually 15 to 60 seconds."
          steps={[
            "Splitting the list into references (every title must really be in your text)",
            "Looking each one up by DOI and title in OpenAlex, then Semantic Scholar",
            "Comparing title, year and first author in code, and checking for retractions",
            "If there is a draft: checking the sentences that cite each paper against its abstract",
          ]}
        />
      )}
      {err && <ErrorBox text={err} />}

      {res && (
        <section className="space-y-4">
          <Summary res={res} filter={filter} setFilter={setFilter} />
          {res.references.length === 0 && <p className="text-sm text-ink-2">We could not find any references in that text.</p>}
          <ul className="space-y-2">
            {shown.map((r) => (
              <RefCard key={r.n} r={r} claims={claimsFor(r.n)} />
            ))}
          </ul>
          {res.had_draft && res.claims.length === 0 && (
            <p className="text-sm text-ink-3">No citing sentences could be checked (the cited papers have no abstracts on record, or none were found).</p>
          )}
          <div className="flex flex-wrap items-center gap-3">
            <button onClick={() => download(res)} className="text-xs rounded-lg border border-line px-3 h-8 hover:border-ink-3">
              Download report (.md)
            </button>
            <p className="text-xs text-ink-3">
              Lookups and comparisons are done in code against OpenAlex and Semantic Scholar. “Not found” means neither has it; check the
              source before calling it fabricated (very new, non-English or grey literature can be missing).{res.cached ? " (Cached result.)" : ""}
            </p>
          </div>
        </section>
      )}
    </div>
  );
}

function Summary({
  res,
  filter,
  setFilter,
}: {
  res: RefCheckResult;
  filter: string;
  setFilter: (f: RefStatus | "problems" | "all") => void;
}) {
  const total = res.references.length;
  const bad = total - res.counts.verified;
  return (
    <div className={`rounded-2xl border p-5 ${bad === 0 ? "border-good/30 bg-good-soft" : "border-warn/30 bg-warn-soft"}`}>
      <p className="text-xl font-semibold leading-snug">
        {total === 0
          ? "No references found"
          : bad === 0
            ? `All ${total} references check out`
            : `${bad} of ${total} references need a look`}
      </p>
      {res.claims.length > 0 && (
        <p className="mt-1 text-sm text-ink-2">
          {res.claims.filter((c) => c.verdict === "supported").length} of {res.claims.length} citing sentences are backed by the cited abstract
          {res.claims.some((c) => c.verdict === "contradicted") && `; ${res.claims.filter((c) => c.verdict === "contradicted").length} contradicted`}.
        </p>
      )}
      <div className="mt-3 flex flex-wrap gap-1.5">
        <Pill on={filter === "all"} onClick={() => setFilter("all")}>
          All {total}
        </Pill>
        {bad > 0 && (
          <Pill on={filter === "problems"} onClick={() => setFilter("problems")}>
            Problems {bad}
          </Pill>
        )}
        {ORDER.filter((s) => res.counts[s]).map((s) => (
          <Pill key={s} on={filter === s} onClick={() => setFilter(s)} cls={STATUS[s].chip}>
            {STATUS[s].icon} {STATUS[s].label} {res.counts[s]}
          </Pill>
        ))}
      </div>
    </div>
  );
}

function Pill({ on, onClick, children, cls = "" }: { on: boolean; onClick: () => void; children: React.ReactNode; cls?: string }) {
  return (
    <button
      onClick={onClick}
      aria-pressed={on}
      className={`rounded-full border px-2.5 py-1 text-xs ${on ? "ring-2 ring-accent/50" : ""} ${cls || "border-line bg-surface text-ink-2"}`}
    >
      {children}
    </button>
  );
}

function RefCard({ r, claims }: { r: RefResult; claims: ClaimCheck[] }) {
  const s = STATUS[r.status];
  const m = r.match;
  const link = m?.doi ? `https://doi.org/${m.doi}` : m?.id ? `https://openalex.org/${m.id}` : null;
  return (
    <li className="rounded-2xl border border-line bg-surface p-4">
      <div className="flex flex-wrap items-start gap-2">
        <span className="font-mono text-xs text-ink-3 pt-0.5 w-8">[{r.label || r.n}]</span>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium leading-snug">{r.title}</p>
          <p className="text-xs text-ink-3 mt-0.5">{[r.first_author, r.year, r.doi && `doi:${r.doi}`].filter(Boolean).join(" · ")}</p>
        </div>
        <span className={`rounded-full border px-2 py-0.5 text-[0.7rem] font-medium whitespace-nowrap ${s.chip}`}>
          {s.icon} {s.label}
        </span>
      </div>
      {r.issues.length > 0 && (
        <ul className="mt-2 ml-10 space-y-0.5 text-sm text-ink-2 list-disc pl-4">
          {r.issues.map((i) => (
            <li key={i}>{i}</li>
          ))}
        </ul>
      )}
      {m && (
        <p className="mt-2 ml-10 text-xs text-ink-3">
          On record ({m.source}):{" "}
          {link ? (
            <a href={link} target="_blank" rel="noreferrer" className="text-ink-2 hover:text-accent-ink hover:underline underline-offset-2">
              {m.title}
            </a>
          ) : (
            <span className="text-ink-2">{m.title}</span>
          )}
          {" · "}
          {[m.authors[0] && `${m.authors[0]}${m.authors.length > 1 ? " et al." : ""}`, m.year, m.venue, `${m.cited_by.toLocaleString("en-GB")} citations`]
            .filter(Boolean)
            .join(" · ")}
        </p>
      )}
      {claims.length > 0 && (
        <div className="mt-3 ml-10 space-y-2">
          {claims.map((c, i) => {
            const v = VERDICT[c.verdict];
            return (
              <div key={i} className="rounded-xl bg-surface-2 p-3">
                <span className={`rounded-full border px-2 py-0.5 text-[0.68rem] font-medium ${v.chip}`}>{v.label}</span>
                <p className="mt-1.5 text-sm">“{c.sentence}”</p>
                {c.quote && (
                  <p className="mt-1.5 text-xs text-ink-2">
                    Abstract: “<Marked text={c.quote} quote={c.quote} tone={v.tone} />”
                  </p>
                )}
              </div>
            );
          })}
        </div>
      )}
    </li>
  );
}

function download(res: RefCheckResult) {
  const lines = ["# Citation Check report", "", `${res.references.length} references checked.`, ""];
  for (const r of res.references) {
    lines.push(`- [${r.label || r.n}] **${STATUS[r.status].label}**: ${r.title}`);
    r.issues.forEach((i) => lines.push(`  - ${i}`));
    if (r.match) lines.push(`  - On record: ${r.match.title} (${r.match.year ?? "n.d."})${r.match.doi ? ` https://doi.org/${r.match.doi}` : ""}`);
  }
  if (res.claims.length) {
    lines.push("", "## Citing sentences", "");
    for (const c of res.claims) lines.push(`- [${c.label}] ${VERDICT[c.verdict].label}: "${c.sentence}"${c.quote ? `\n  - Abstract: "${c.quote}"` : ""}`);
  }
  lines.push("", "Checked with ScholarLens Citation Check against OpenAlex and Semantic Scholar.");
  const blob = new Blob([lines.join("\n")], { type: "text/markdown" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = "citation-check.md";
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
