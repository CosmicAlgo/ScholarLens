"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { track } from "@/components/analytics";
import { TrendChart } from "@/components/trend-chart";
import { Notice, TrendBadge } from "@/components/ui";
import { API_URL, type Claim, type Cluster, type Evidence, type RunResult } from "@/lib/api";
import { clientId } from "@/lib/client-id";
import { pct } from "@/lib/format";

const STEPS = [
  { node: "planner", name: "Planner", job: "Turns the question into searchable topics", icon: "◎" },
  { node: "trends", name: "Trend Analyst", job: "Computes share-of-research trends", icon: "↗" },
  { node: "scout", name: "Scout", job: "Finds the papers that matter", icon: "⌕" },
  { node: "landscape", name: "Cartographer", job: "Maps sub-areas, spots emerging ones", icon: "◫" },
  { node: "trust", name: "Trust Auditor", job: "Flags retractions and preprints", icon: "✓" },
  { node: "writer", name: "Writer", job: "Drafts from evidence only", icon: "✎" },
  { node: "verifier", name: "Verifier", job: "Deletes claims without a source", icon: "⌫" },
];

const TEMPLATES = [
  ["Is it still growing?", "Is ___ still growing, or has it peaked?"],
  ["What is emerging?", "What sub-areas are emerging inside ___?"],
  ["Compare two fields", "Compare ___ and ___: which is gaining ground?"],
  ["Where to start reading", "What are the key papers to read first on ___?"],
] as const;

const EXAMPLES = [
  "Is retrieval augmented generation still growing, and what is emerging inside it?",
  "Has research on COVID-19 peaked?",
  "Compare graph neural networks and transformers for molecules",
];

const SAVED_KEY = "sl_briefings_v1";
type Saved = { q: string; at: number; result: RunResult };

function loadSaved(): Saved[] {
  try {
    return JSON.parse(localStorage.getItem(SAVED_KEY) || "[]");
  } catch {
    return [];
  }
}
function saveBriefing(q: string, result: RunResult) {
  try {
    const list = [{ q, at: Date.now(), result }, ...loadSaved().filter((s) => s.q !== q)].slice(0, 8);
    localStorage.setItem(SAVED_KEY, JSON.stringify(list));
  } catch {}
}

type Phase = "idle" | "running" | "done" | "error";

export function AskClient({ initial }: { initial: string }) {
  const [q, setQ] = useState(initial);
  const [asked, setAsked] = useState("");
  const [phase, setPhase] = useState<Phase>("idle");
  const [done, setDone] = useState<Record<string, string>>({});
  const [result, setResult] = useState<RunResult | null>(null);
  const [error, setError] = useState("");
  const [started, setStarted] = useState(0);
  const [now, setNow] = useState(0);
  const [saved, setSaved] = useState<Saved[]>([]);
  const abort = useRef<AbortController | null>(null);
  const box = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    const t = setTimeout(() => setSaved(loadSaved()), 0);
    return () => clearTimeout(t);
  }, []);
  useEffect(() => {
    if (phase !== "running") return;
    const t = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(t);
  }, [phase]);

  async function run(question: string) {
    abort.current?.abort();
    const ctrl = new AbortController();
    abort.current = ctrl;
    setAsked(question);
    setPhase("running");
    setDone({});
    setResult(null);
    setError("");
    setStarted(Date.now());
    setNow(Date.now());
    track("ask_submitted", { length: question.length });
    try {
      const res = await fetch(`${API_URL}/api/runs`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Client-Id": clientId() },
        body: JSON.stringify({ question }),
        signal: ctrl.signal,
      });
      if (!res.ok || !res.body) {
        let msg = "Could not start the analysis.";
        try {
          const b = await res.json();
          if (typeof b?.detail === "string") msg = b.detail;
        } catch {}
        throw new Error(msg);
      }
      await readSSE(res.body, (event, data) => {
        if (event === "progress") setDone((d) => ({ ...d, [data.node]: data.message }));
        else if (event === "result") {
          setResult(data as RunResult);
          setPhase("done");
          if ((data as RunResult).report) {
            saveBriefing(question, data as RunResult);
            setSaved(loadSaved());
          }
          track("ask_completed", { stopped: Boolean(data.stopped) });
        } else if (event === "error") throw new Error(data.message || "The analysis failed.");
      });
      setPhase((p) => (p === "running" ? "error" : p));
      setError((e) => e || "The connection closed before the analysis finished.");
    } catch (e) {
      if (ctrl.signal.aborted) return;
      setPhase("error");
      setError(e instanceof Error ? e.message : "Something went wrong.");
      track("ask_failed");
    }
  }

  const doneCount = STEPS.filter((s) => done[s.node]).length;
  const elapsed = started ? Math.max(0, Math.round((now - started) / 1000)) : 0;

  return (
    <div className="pb-20">
      <form
        className="rounded-2xl border border-line bg-surface p-4 md:p-5"
        onSubmit={(e) => {
          e.preventDefault();
          if (q.trim().length >= 5 && phase !== "running") run(q.trim());
        }}
      >
        <label htmlFor="ask-q" className="sr-only">
          Your question
        </label>
        <textarea
          ref={box}
          id="ask-q"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          maxLength={500}
          rows={3}
          placeholder="e.g. Is federated learning still growing, and which sub-areas are emerging?"
          className="w-full rounded-xl border border-line bg-bg p-4 outline-none focus:border-accent resize-y"
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) e.currentTarget.form?.requestSubmit();
          }}
        />
        <div className="mt-3 flex flex-wrap items-center gap-2">
          {TEMPLATES.map(([label, text]) => (
            <button
              type="button"
              key={label}
              onClick={() => {
                setQ(text);
                requestAnimationFrame(() => {
                  const el = box.current;
                  if (!el) return;
                  el.focus();
                  const i = text.indexOf("___");
                  el.setSelectionRange(i, i + 3);
                });
              }}
              className="text-xs rounded-full border border-line bg-surface-2 px-3 py-1 text-ink-2 hover:border-ink-3 hover:text-ink"
            >
              {label}
            </button>
          ))}
          <span className="flex-1" />
          <button
            disabled={phase === "running" || q.trim().length < 5 || q.includes("___")}
            className="h-10 rounded-xl bg-accent text-white font-medium px-5 hover:opacity-90 disabled:opacity-50"
          >
            {phase === "running" ? "Researching…" : "Get briefing"}
          </button>
        </div>
        <p className="mt-2 text-xs text-ink-3">Free: 5 briefings a day. Takes about a minute. Don&rsquo;t include personal information.</p>
      </form>

      {phase === "idle" && (
        <div className="mt-6 grid md:grid-cols-2 gap-4">
          <section className="rounded-2xl border border-line bg-surface p-5">
            <h2 className="text-xs font-semibold uppercase tracking-wider text-ink-3">Try a question</h2>
            <ul className="mt-2 space-y-1">
              {EXAMPLES.map((ex) => (
                <li key={ex}>
                  <button type="button" onClick={() => setQ(ex)} className="w-full text-left rounded-lg px-2 py-1.5 -mx-2 text-sm text-ink-2 hover:bg-surface-2 hover:text-ink">
                    {ex}
                  </button>
                </li>
              ))}
            </ul>
          </section>
          <section className="rounded-2xl border border-line bg-surface p-5">
            <h2 className="text-xs font-semibold uppercase tracking-wider text-ink-3">Your recent briefings</h2>
            {saved.length === 0 ? (
              <p className="mt-2 text-sm text-ink-3">Briefings you run are kept here, in this browser, so you can reopen them instantly.</p>
            ) : (
              <ul className="mt-2 space-y-1">
                {saved.map((s) => (
                  <li key={s.at}>
                    <button
                      type="button"
                      onClick={() => {
                        setQ(s.q);
                        setAsked(s.q);
                        setResult(s.result);
                        setPhase("done");
                      }}
                      className="w-full text-left rounded-lg px-2 py-1.5 -mx-2 hover:bg-surface-2"
                    >
                      <span className="block text-sm font-medium leading-snug line-clamp-2">{s.result.report?.title || s.q}</span>
                      <span className="block text-[0.7rem] text-ink-3">
                        {new Date(s.at).toLocaleDateString("en-GB", { day: "numeric", month: "short" })} · {s.q.slice(0, 70)}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      )}

      {(phase === "running" || (phase === "error" && doneCount > 0)) && !result?.report && (
        <section className="mt-6 rounded-2xl border border-line bg-surface p-5" aria-live="polite">
          <div className="flex flex-wrap items-center gap-3">
            <h2 className="font-semibold">The agents are working</h2>
            <span className="text-xs font-mono text-ink-3">
              {doneCount}/{STEPS.length} · {elapsed}s
            </span>
          </div>
          <div className="mt-3 h-1.5 rounded-full bg-surface-2 overflow-hidden">
            <div className="h-full bg-accent transition-all duration-500" style={{ width: `${(doneCount / STEPS.length) * 100}%` }} />
          </div>
          <ol className="mt-4 grid sm:grid-cols-2 lg:grid-cols-4 gap-2">
            {STEPS.map((s, i) => {
              const msg = done[s.node];
              const active = !msg && phase === "running" && STEPS.slice(0, i).every((x) => done[x.node] || x.node === "trends" || x.node === "scout");
              return (
                <li
                  key={s.node}
                  className={`rounded-xl border p-3 transition-colors ${
                    msg ? "border-good/30 bg-good-soft" : active ? "border-accent/40 bg-accent-soft" : "border-line bg-surface-2"
                  }`}
                >
                  <div className="flex items-center gap-2">
                    <span className={`w-6 h-6 grid place-items-center rounded-lg text-sm ${msg ? "bg-good text-bg" : active ? "bg-accent text-white animate-pulse" : "bg-surface text-ink-3"}`} aria-hidden="true">
                      {msg ? "✓" : s.icon}
                    </span>
                    <span className="font-medium text-sm">{s.name}</span>
                  </div>
                  <p className="mt-1.5 text-xs text-ink-2 leading-snug">{msg || s.job}</p>
                </li>
              );
            })}
          </ol>
        </section>
      )}

      {phase === "error" && (
        <div className="mt-6">
          <Notice tone="bad">{error}</Notice>
        </div>
      )}

      {result?.stopped && (
        <div className="mt-6">
          <Notice tone="warn">{result.stopped} ScholarLens answers questions about research literature and trends.</Notice>
        </div>
      )}

      {result?.report && (
        <ReportView
          r={result}
          question={asked}
          onNew={() => {
            setPhase("idle");
            setResult(null);
            setQ("");
            window.scrollTo({ top: 0, behavior: "smooth" });
          }}
        />
      )}
    </div>
  );
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function readSSE(body: ReadableStream<Uint8Array>, on: (event: string, data: any) => void) {
  const reader = body.getReader();
  const dec = new TextDecoder();
  let buf = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true }).replace(/\r\n?/g, "\n");
    let i;
    while ((i = buf.indexOf("\n\n")) >= 0) {
      const chunk = buf.slice(0, i);
      buf = buf.slice(i + 2);
      let event = "message";
      const data: string[] = [];
      for (const line of chunk.split("\n")) {
        if (line.startsWith("event:")) event = line.slice(6).trim();
        else if (line.startsWith("data:")) data.push(line.slice(5).replace(/^ /, ""));
      }
      if (data.length) on(event, JSON.parse(data.join("\n")));
    }
  }
}

// ------------------------------------------------------------------ report

type PaperEv = Extract<Evidence, { kind: "paper" }>;

function toMarkdown(r: RunResult, order: string[], question: string) {
  const report = r.report!;
  const ev = r.evidence || {};
  const cite = (ids: string[]) =>
    ids
      .filter((id) => ev[id])
      .map((id) => `[${order.indexOf(id) + 1}]`)
      .join("");
  const lines = [`# ${report.title}`, "", `_Question: ${question}_`, "", "## Key findings", ""];
  for (const c of report.tldr) lines.push(`- ${c.text} ${cite(c.evidence)}`);
  for (const s of report.sections) {
    lines.push("", `## ${s.heading}`, "");
    for (const c of s.claims) lines.push(`${c.text} ${cite(c.evidence)}`, "");
  }
  if (report.caveats.length) lines.push("## Caveats", "", ...report.caveats.map((c) => `- ${c}`), "");
  lines.push("## Sources", "");
  order.forEach((id, i) => {
    const e = ev[id];
    if (e.kind === "paper")
      lines.push(`${i + 1}. ${e.title} (${[e.authors[0], e.year, e.venue].filter(Boolean).join(", ")})${e.doi ? ` https://doi.org/${e.doi.replace(/^https?:\/\/doi\.org\//, "")}` : ""}`);
    else if (e.kind === "metric") lines.push(`${i + 1}. ${e.label} (${e.topic}): ${e.value} (computed from OpenAlex)`);
    else lines.push(`${i + 1}. Sub-area "${e.name}" (${e.topic}, ${e.size} papers)`);
  });
  lines.push("", "_Generated by ScholarLens (rstackhub.in). Every claim cites a source; check them before relying on it._");
  return lines.join("\n");
}

function ReportView({ r, question, onNew }: { r: RunResult; question: string; onNew: () => void }) {
  const report = r.report!;
  const evidence = useMemo(() => r.evidence || {}, [r]);
  const [active, setActive] = useState<number | null>(null);
  const [copied, setCopied] = useState(false);

  // Number sources in reading order (findings first, then sections).
  const order = useMemo(() => {
    const o: string[] = [];
    for (const c of [...report.tldr, ...report.sections.flatMap((s) => s.claims)])
      for (const id of c.evidence) if (evidence[id] && !o.includes(id)) o.push(id);
    return o;
  }, [report, evidence]);
  const cite = (ids: string[]) => ids.filter((id) => evidence[id]).map((id) => order.indexOf(id) + 1);

  const papers = useMemo(
    () =>
      Object.values(evidence)
        .filter((e): e is PaperEv => e.kind === "paper" && !e.flags.includes("retracted"))
        .sort((a, b) => b.cited_by - a.cited_by)
        .slice(0, 6),
    [evidence],
  );
  const clusters = Object.values(r.landscapes || {}).flat();
  const emerging = clusters.filter((c) => c.emerging).length;
  const v = r.verification;
  const trends = Object.entries(r.trends || {});
  const md = () => toMarkdown(r, order, question);
  const openIds = papers.slice(0, 5).map((p) => p.id.slice(2)).join(",");

  const ClaimText = ({ c }: { c: Claim }) => (
    <>
      {c.text}{" "}
      {cite(c.evidence).map((n) => (
        <a
          key={n}
          href={`#src-${n}`}
          onMouseEnter={() => setActive(n)}
          onMouseLeave={() => setActive(null)}
          className="inline-flex align-baseline mx-0.5 rounded px-1 text-[0.68rem] font-mono font-medium bg-accent-soft text-accent-ink hover:bg-accent hover:text-white no-underline"
        >
          {n}
        </a>
      ))}
    </>
  );

  return (
    <article className="mt-8">
      <header className="rounded-2xl border border-line bg-surface p-5 md:p-6">
        <p className="text-xs text-ink-3">“{question}”</p>
        <h2 className="mt-1 text-2xl md:text-3xl font-semibold tracking-tight leading-tight">{report.title}</h2>
        <dl className="mt-4 grid grid-cols-2 sm:grid-cols-4 gap-2">
          {[
            ["Claims kept", v ? `${v.claims_kept}/${v.claims_total}` : "n/a", "Claims without a real source were deleted"],
            ["Sources", String(order.length), "Papers, computed numbers and sub-areas cited"],
            ["Papers checked", String(r.trust?.papers_checked ?? papers.length), "Checked for retractions and preprints"],
            ["Sub-areas", clusters.length ? `${clusters.length}${emerging ? ` · ${emerging} emerging` : ""}` : "n/a", "Clusters of related papers"],
          ].map(([k, val, hint]) => (
            <div key={k} className="rounded-xl bg-surface-2 px-3 py-2" title={hint}>
              <dt className="text-[0.62rem] uppercase tracking-wider text-ink-3">{k}</dt>
              <dd className="mt-0.5 font-mono font-semibold">{val}</dd>
            </div>
          ))}
        </dl>
        <div className="mt-4 flex flex-wrap gap-2 text-xs">
          {openIds && (
            <Link href={`/workspace?open=${openIds}`} className="rounded-lg bg-accent text-white px-3 h-8 inline-flex items-center font-medium hover:opacity-90">
              Open key papers in the workspace →
            </Link>
          )}
          <button
            onClick={async () => {
              await navigator.clipboard.writeText(md());
              setCopied(true);
              setTimeout(() => setCopied(false), 1500);
            }}
            className="rounded-lg border border-line px-3 h-8 hover:border-ink-3"
          >
            {copied ? "Copied" : "Copy as Markdown"}
          </button>
          <button
            onClick={() => {
              const url = URL.createObjectURL(new Blob([md()], { type: "text/markdown" }));
              Object.assign(document.createElement("a"), { href: url, download: "scholarlens-briefing.md" }).click();
              setTimeout(() => URL.revokeObjectURL(url), 1000);
            }}
            className="rounded-lg border border-line px-3 h-8 hover:border-ink-3"
          >
            Download .md
          </button>
          <button onClick={onNew} className="rounded-lg border border-line px-3 h-8 hover:border-ink-3">
            New briefing
          </button>
        </div>
      </header>

      <div className="mt-6 grid lg:grid-cols-[minmax(0,1fr)_300px] gap-6 items-start">
        <div className="min-w-0">
          <section className="rounded-2xl bg-accent-soft p-5">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-accent-ink">Key findings</h3>
            <ul className="mt-2 space-y-2">
              {report.tldr.map((c, i) => (
                <li key={i} className="flex gap-2 leading-relaxed">
                  <span className="text-accent-ink font-semibold" aria-hidden="true">
                    {i + 1}.
                  </span>
                  <span>
                    <ClaimText c={c} />
                  </span>
                </li>
              ))}
            </ul>
          </section>

          {trends.map(([key, t]) => (
            <section key={key} className="mt-5 rounded-2xl border border-line bg-surface p-4 md:p-5">
              <div className="flex flex-wrap items-center gap-2 mb-3">
                <h3 className="font-semibold capitalize">{t.label}</h3>
                <TrendBadge label={t.result.label} size="sm" />
                <span className="flex-1" />
                <span className="text-xs text-ink-3 font-mono">
                  {pct(t.result.recent_growth)}/yr recently · peak {t.result.peak_year ?? "n/a"} · {t.result.total_papers.toLocaleString("en-GB")} papers
                </span>
              </div>
              <TrendChart series={[{ name: t.label, points: t.result.points }]} />
            </section>
          ))}

          {report.sections.map((s, i) => (
            <section key={i} className="mt-7">
              <h3 className="text-lg font-semibold">{s.heading}</h3>
              <div className="mt-2 space-y-3 text-ink-2 leading-relaxed">
                {s.claims.map((c, j) => (
                  <p key={j}>
                    <ClaimText c={c} />
                  </p>
                ))}
              </div>
            </section>
          ))}

          {papers.length > 0 && (
            <section className="mt-8">
              <h3 className="text-lg font-semibold">Key papers</h3>
              <p className="mt-1 text-sm text-ink-3">The most-cited papers among this briefing&rsquo;s sources.</p>
              <div className="mt-3 grid sm:grid-cols-2 gap-3">
                {papers.map((p) => (
                  <div key={p.id} className="rounded-xl border border-line bg-surface p-4 flex flex-col">
                    <Link href={`/paper/${p.id.slice(2)}`} className="font-medium leading-snug hover:text-accent-ink line-clamp-3" title={p.title}>
                      {p.title}
                    </Link>
                    <p className="mt-1 text-xs text-ink-3">
                      {[p.authors[0] && `${p.authors[0]}${p.authors.length > 1 ? " et al." : ""}`, p.year, p.venue].filter(Boolean).join(" · ")}
                    </p>
                    <div className="mt-2 flex flex-wrap items-center gap-1.5 text-[0.68rem]">
                      <span className="rounded px-1.5 py-0.5 bg-surface-2 text-ink-2">{p.cited_by.toLocaleString("en-GB")} citations</span>
                      {p.flags.includes("preprint") && <span className="rounded px-1.5 py-0.5 bg-warn-soft text-warn">Preprint</span>}
                    </div>
                    <span className="flex-1" />
                    <Link href={`/workspace?open=${p.id.slice(2)}`} className="mt-3 text-xs font-medium text-accent-ink hover:underline">
                      Read it in the workspace →
                    </Link>
                  </div>
                ))}
              </div>
            </section>
          )}

          {clusters.length > 0 && <SubAreas clusters={clusters} />}

          {report.caveats.length > 0 && (
            <section className="mt-8 rounded-2xl border border-line bg-surface p-5">
              <h3 className="text-xs font-semibold uppercase tracking-wider text-ink-3">Limits of this briefing</h3>
              <ul className="mt-2 list-disc pl-5 text-sm text-ink-2 space-y-1">
                {report.caveats.map((c, i) => (
                  <li key={i}>{c}</li>
                ))}
              </ul>
            </section>
          )}

          {v && v.removed.length > 0 && (
            <details className="mt-6 rounded-2xl border border-line bg-surface p-5">
              <summary className="cursor-pointer text-sm font-medium">
                {v.removed.length} claim{v.removed.length > 1 ? "s" : ""} deleted by the verifier
              </summary>
              <ul className="mt-3 space-y-2 text-sm text-ink-3">
                {v.removed.map((c, i) => (
                  <li key={i}>
                    <span className="line-through">{c.text}</span>{" "}
                    <span className="text-xs">({c.reason === "no_evidence" ? "no source given" : "cited a source that doesn't exist"})</span>
                  </li>
                ))}
              </ul>
            </details>
          )}
        </div>

        <aside className="lg:sticky lg:top-20 space-y-4">
          {r.trust && (
            <section className="rounded-2xl border border-line bg-surface p-4">
              <h3 className="text-xs font-semibold uppercase tracking-wider text-ink-3">Trust check</h3>
              <p className="mt-2 text-sm">
                {r.trust.papers_checked} papers checked · {r.trust.retracted.length} retracted
              </p>
              <div className="mt-2 text-xs text-ink-3">Preprints (not peer reviewed): {Math.round(r.trust.preprint_share * 100)}%</div>
              <div className="mt-1 h-1.5 rounded-full bg-surface-2 overflow-hidden">
                <div className="h-full bg-warn" style={{ width: `${Math.round(r.trust.preprint_share * 100)}%` }} />
              </div>
              {r.trust.note && <p className="mt-2 text-xs text-ink-2">{r.trust.note}</p>}
            </section>
          )}
          <section className="rounded-2xl border border-line bg-surface p-4">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-ink-3">Sources</h3>
            <ol className="mt-2 space-y-2 text-xs max-h-[60vh] overflow-y-auto overflow-x-hidden pr-1 break-words">
              {order.map((id, i) => (
                <li
                  key={id}
                  id={`src-${i + 1}`}
                  className={`flex gap-2 scroll-mt-24 rounded-lg p-1.5 -mx-1.5 transition-colors ${active === i + 1 ? "bg-accent-soft" : ""}`}
                >
                  <span className="font-mono text-ink-3 w-5 shrink-0 text-right">{i + 1}</span>
                  <Source e={evidence[id]} />
                </li>
              ))}
            </ol>
          </section>
        </aside>
      </div>
    </article>
  );
}

function SubAreas({ clusters }: { clusters: Cluster[] }) {
  const sorted = [...clusters].sort((a, b) => b.emergence - a.emergence);
  const maxSize = Math.max(...sorted.map((c) => c.size), 1);
  return (
    <section className="mt-8">
      <h3 className="text-lg font-semibold">Sub-areas, by momentum</h3>
      <p className="mt-1 text-sm text-ink-3">Bar length is the number of papers; the multiplier is how much of the cluster is recent work.</p>
      <ul className="mt-3 space-y-2">
        {sorted.map((c) => (
          <li key={c.id} className="rounded-xl border border-line bg-surface p-3">
            <div className="flex items-center gap-2">
              <span className="font-medium text-sm">{c.name}</span>
              {c.emerging && <span className="text-[0.65rem] rounded-full px-2 py-0.5 bg-good-soft text-good font-medium">Emerging</span>}
              <span className="flex-1" />
              <span className={`text-xs font-mono ${c.emergence >= 1.2 ? "text-good" : "text-ink-3"}`}>{c.emergence.toFixed(1)}×</span>
            </div>
            <div className="mt-2 h-1.5 rounded-full bg-surface-2 overflow-hidden">
              <div className={`h-full rounded-full ${c.emerging ? "bg-good" : "bg-ink-3/50"}`} style={{ width: `${(c.size / maxSize) * 100}%` }} />
            </div>
            <p className="mt-2 text-xs text-ink-2">{c.summary}</p>
            <p className="mt-1 text-[0.68rem] text-ink-3">
              {c.size} papers · median year {c.median_year ?? "n/a"}
            </p>
          </li>
        ))}
      </ul>
    </section>
  );
}

function Source({ e }: { e: Evidence }) {
  if (e.kind === "paper") {
    const pid = e.id.slice(2);
    return (
      <span className="min-w-0">
        <Link href={`/paper/${pid}`} className="text-ink hover:text-accent-ink leading-snug">
          {e.title}
        </Link>
        <span className="block text-ink-3">
          {[e.authors[0] && `${e.authors[0]}${e.authors.length > 1 ? " et al." : ""}`, e.year].filter(Boolean).join(", ")}
          {e.flags.includes("preprint") && " · preprint"}
        </span>
      </span>
    );
  }
  if (e.kind === "metric") {
    return (
      <span>
        <span className="text-ink-2">{e.label}</span> ({e.topic}): <span className="font-mono">{String(e.value ?? "n/a")}</span>
        <span className="block text-ink-3">computed from OpenAlex counts</span>
      </span>
    );
  }
  return (
    <span>
      Sub-area <span className="font-medium">{e.name}</span>
      <span className="block text-ink-3">
        {e.topic}, {e.size} papers
      </span>
    </span>
  );
}
