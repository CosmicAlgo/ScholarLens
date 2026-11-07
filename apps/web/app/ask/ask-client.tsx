"use client";

import Link from "next/link";
import { useRef, useState } from "react";
import { track } from "@/components/analytics";
import { TrendChart } from "@/components/trend-chart";
import { Notice, TrendBadge } from "@/components/ui";
import { API_URL, type Claim, type Evidence, type RunResult } from "@/lib/api";
import { clientId } from "@/lib/client-id";

const STEPS = [
  { node: "planner", name: "Planner", job: "Understanding the question" },
  { node: "trends", name: "Trend Analyst", job: "Computing publication trends" },
  { node: "scout", name: "Scout", job: "Finding relevant papers" },
  { node: "landscape", name: "Cartographer", job: "Mapping sub-areas" },
  { node: "trust", name: "Trust Auditor", job: "Checking for retractions" },
  { node: "writer", name: "Writer", job: "Drafting the briefing" },
  { node: "verifier", name: "Verifier", job: "Removing unsupported claims" },
];

const EXAMPLES = [
  "Is retrieval augmented generation still growing, and what is emerging inside it?",
  "Has research on COVID-19 peaked?",
  "Compare graph neural networks and transformers for molecules",
];

type Phase = "idle" | "running" | "done" | "error";

export function AskClient({ initial }: { initial: string }) {
  const [q, setQ] = useState(initial);
  const [phase, setPhase] = useState<Phase>("idle");
  const [done, setDone] = useState<Record<string, string>>({});
  const [result, setResult] = useState<RunResult | null>(null);
  const [error, setError] = useState("");
  const abort = useRef<AbortController | null>(null);

  async function run(question: string) {
    abort.current?.abort();
    const ctrl = new AbortController();
    abort.current = ctrl;
    setPhase("running");
    setDone({});
    setResult(null);
    setError("");
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

  return (
    <div className="mt-6">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (q.trim().length >= 5 && phase !== "running") run(q.trim());
        }}
      >
        <label htmlFor="ask-q" className="sr-only">
          Your question
        </label>
        <textarea
          id="ask-q"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          maxLength={500}
          rows={3}
          placeholder="e.g. Is federated learning still growing, and which sub-areas are emerging?"
          className="w-full rounded-xl border border-line bg-surface p-4 outline-none focus:border-accent resize-y"
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) e.currentTarget.form?.requestSubmit();
          }}
        />
        <div className="mt-2 flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap gap-2">
            {phase === "idle" &&
              EXAMPLES.map((ex) => (
                <button
                  type="button"
                  key={ex}
                  onClick={() => setQ(ex)}
                  className="text-xs rounded-full border border-line bg-surface px-3 py-1 text-ink-2 hover:border-ink-3 text-left"
                >
                  {ex}
                </button>
              ))}
          </div>
          <button
            disabled={phase === "running" || q.trim().length < 5}
            className="h-10 rounded-xl bg-accent text-white font-medium px-5 hover:opacity-90 disabled:opacity-50"
          >
            {phase === "running" ? "Researching…" : "Get briefing"}
          </button>
        </div>
        <p className="mt-2 text-xs text-ink-3">Free: 5 briefings a day. Don&rsquo;t include personal information.</p>
      </form>

      {(phase === "running" || (phase === "error" && Object.keys(done).length > 0)) && !result?.report && (
        <ol className="mt-8 space-y-2" aria-live="polite">
          {STEPS.map((s) => {
            const msg = done[s.node];
            const status = msg ? "done" : phase === "running" ? "pending" : "idle";
            return (
              <li key={s.node} className="flex items-start gap-3">
                <span
                  className={`mt-1 inline-block w-2.5 h-2.5 rounded-full ${
                    status === "done" ? "bg-good" : status === "pending" ? "bg-ink-3 animate-pulse" : "bg-line"
                  }`}
                  aria-hidden="true"
                />
                <div>
                  <span className="font-medium">{s.name}</span>{" "}
                  <span className="text-ink-3 text-sm">{msg || s.job}</span>
                </div>
              </li>
            );
          })}
        </ol>
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

      {result?.report && <ReportView r={result} />}
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

function ReportView({ r }: { r: RunResult }) {
  const report = r.report!;
  const evidence = r.evidence || {};
  // Number sources in reading order (findings first, then sections) before rendering anything.
  const order: string[] = [];
  for (const c of [...report.tldr, ...report.sections.flatMap((s) => s.claims)])
    for (const id of c.evidence) if (evidence[id] && !order.includes(id)) order.push(id);
  const cite = (ids: string[]) => ids.filter((id) => evidence[id]).map((id) => order.indexOf(id) + 1);

  const ClaimText = ({ c }: { c: Claim }) => (
    <>
      {c.text}{" "}
      {cite(c.evidence).map((n) => (
        <a key={n} href={`#src-${n}`} className="text-xs align-super text-accent-ink hover:underline font-mono">
          [{n}]
        </a>
      ))}
    </>
  );

  const v = r.verification;
  const trends = Object.entries(r.trends || {});

  return (
    <article className="mt-10">
      <h2 className="text-2xl font-semibold tracking-tight">{report.title}</h2>
      {v && (
        <p className="mt-1 text-sm text-ink-3">
          Verifier kept {v.claims_kept} of {v.claims_total} claims
          {v.retracted_citations_removed.length > 0 && `, removed ${v.retracted_citations_removed.length} retracted citation(s)`}.
        </p>
      )}

      <div className="mt-5 rounded-2xl bg-accent-soft p-5">
        <h3 className="text-sm font-medium text-accent-ink">Key findings</h3>
        <ul className="mt-2 space-y-2 list-disc pl-5">
          {report.tldr.map((c, i) => (
            <li key={i}>
              <ClaimText c={c} />
            </li>
          ))}
        </ul>
      </div>

      {trends.map(([key, t]) => (
        <div key={key} className="mt-6 rounded-2xl border border-line bg-surface p-4 md:p-6">
          <div className="flex flex-wrap items-center gap-2 mb-3">
            <h3 className="font-medium capitalize">{t.label}</h3>
            <TrendBadge label={t.result.label} size="sm" />
          </div>
          <TrendChart series={[{ name: t.label, points: t.result.points }]} />
        </div>
      ))}

      {report.sections.map((s, i) => (
        <section key={i} className="mt-8">
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

      {Object.entries(r.landscapes || {}).map(([key, clusters]) =>
        clusters.length ? (
          <section key={key} className="mt-8">
            <h3 className="text-lg font-semibold">Sub-areas found</h3>
            <div className="mt-3 grid sm:grid-cols-2 gap-3">
              {[...clusters]
                .sort((a, b) => b.emergence - a.emergence)
                .map((c) => (
                  <div key={c.id} className="rounded-xl border border-line bg-surface p-4">
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-medium">{c.name}</span>
                      {c.emerging && (
                        <span className="text-xs rounded-full px-2 py-0.5 bg-good-soft text-good font-medium">Emerging</span>
                      )}
                    </div>
                    <p className="mt-1 text-sm text-ink-2">{c.summary}</p>
                    <p className="mt-2 text-xs text-ink-3">
                      {c.size} papers · median year {c.median_year ?? "n/a"} · {c.emergence.toFixed(1)}× recent share
                    </p>
                  </div>
                ))}
            </div>
          </section>
        ) : null,
      )}

      {r.trust?.note && (
        <div className="mt-6">
          <Notice tone="warn">{r.trust.note}</Notice>
        </div>
      )}

      {report.caveats.length > 0 && (
        <section className="mt-8">
          <h3 className="text-sm font-medium text-ink-3 uppercase tracking-wide">Caveats</h3>
          <ul className="mt-2 list-disc pl-5 text-sm text-ink-2 space-y-1">
            {report.caveats.map((c, i) => (
              <li key={i}>{c}</li>
            ))}
          </ul>
        </section>
      )}

      <section className="mt-8">
        <h3 className="text-sm font-medium text-ink-3 uppercase tracking-wide">Sources</h3>
        <ol className="mt-2 space-y-2 text-sm">
          {order.map((id, i) => (
            <li key={id} id={`src-${i + 1}`} className="flex gap-2 scroll-mt-20">
              <span className="font-mono text-ink-3 w-8 shrink-0">[{i + 1}]</span>
              <Source e={evidence[id]} />
            </li>
          ))}
        </ol>
      </section>

      {v && v.removed.length > 0 && (
        <details className="mt-8 rounded-xl border border-line p-4">
          <summary className="cursor-pointer text-sm font-medium">
            {v.removed.length} claim{v.removed.length > 1 ? "s" : ""} removed by the verifier
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
    </article>
  );
}

function Source({ e }: { e: Evidence }) {
  if (e.kind === "paper") {
    const pid = e.id.slice(2);
    return (
      <span>
        <Link href={`/paper/${pid}`} className="hover:text-accent-ink">
          {e.title}
        </Link>
        <span className="text-ink-3">
          {" "}
          · {[e.authors[0] && `${e.authors[0]}${e.authors.length > 1 ? " et al." : ""}`, e.year, e.venue].filter(Boolean).join(", ")}
        </span>
        {e.flags.includes("preprint") && <span className="ml-2 text-xs rounded px-1.5 py-0.5 bg-warn-soft text-warn">Preprint</span>}
      </span>
    );
  }
  if (e.kind === "metric") {
    return (
      <span>
        <span className="text-ink-2">{e.label}</span> ({e.topic}): <span className="font-mono">{String(e.value ?? "n/a")}</span>
        <span className="text-ink-3 text-xs"> · computed by ScholarLens from OpenAlex counts</span>
      </span>
    );
  }
  return (
    <span>
      Sub-area <span className="font-medium">{e.name}</span> ({e.topic}, {e.size} papers)
    </span>
  );
}
