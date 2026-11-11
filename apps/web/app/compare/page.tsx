import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { TrendChart } from "@/components/trend-chart";
import { Notice, Skeleton, TrendBadge } from "@/components/ui";
import { topicSlug, type Trend } from "@/lib/api";
import { LABELS, pct } from "@/lib/format";
import { compareInsights } from "@/lib/insights";
import { errorMessage, getCompare } from "@/lib/server-data";

export const metadata: Metadata = {
  title: "Compare research topics",
  description:
    "Put up to four research topics on one scale: share of all papers over time, momentum, crossovers and peaks, computed from OpenAlex.",
};

type Props = { searchParams: Promise<{ q?: string | string[] }> };

const COLORS = ["var(--series-1)", "var(--series-2)", "var(--series-3)", "var(--series-4)"];
const PRESETS: [string, string[]][] = [
  ["Architectures", ["transformers", "recurrent neural networks", "convolutional neural networks"]],
  ["Gene editing", ["CRISPR", "TALEN", "zinc finger nuclease"]],
  ["Energy", ["perovskite solar cells", "silicon solar cells", "organic solar cells"]],
  ["Generative AI", ["diffusion models", "generative adversarial networks", "variational autoencoders"]],
  ["Hype cycles", ["blockchain", "metaverse", "large language models"]],
];

const parse = (q: string | string[] | undefined) =>
  (Array.isArray(q) ? q : q ? [q] : [])
    .map((t) => t.trim())
    .filter((t) => t.length >= 2 && t.length <= 200)
    .slice(0, 4);

const href = (topics: string[]) => `/compare?${topics.map((t) => `q=${encodeURIComponent(t)}`).join("&")}`;

export default function ComparePage({ searchParams }: Props) {
  return (
    <div className="mx-auto max-w-5xl px-4">
      <section className="pt-12 pb-6 md:pt-16 max-w-3xl">
        <p className="text-sm font-medium text-accent-ink">Compare</p>
        <h1 className="mt-2 text-3xl md:text-5xl font-semibold tracking-tight leading-[1.08]">Which field is winning?</h1>
        <p className="mt-4 text-ink-2 text-lg">
          Up to four topics on one scale: papers per million published each year. We work out who is growing, who is
          biggest, where one overtook another, and who has peaked.
        </p>
      </section>
      <Suspense fallback={<Skeleton className="h-96" />}>
        <CompareBody searchParams={searchParams} />
      </Suspense>
    </div>
  );
}

async function CompareBody({ searchParams }: Props) {
  const topics = parse((await searchParams).q);
  const slots = [...topics, "", "", "", ""].slice(0, 4);
  return (
    <>
      <form action="/compare" className="rounded-2xl border border-line bg-surface p-4 md:p-5">
        <div className="grid sm:grid-cols-2 md:grid-cols-4 gap-2">
          {slots.map((t, i) => (
            <label key={i} className="relative block">
              <span className="sr-only">Topic {i + 1}</span>
              <span className="absolute left-3 top-1/2 -translate-y-1/2 w-2.5 h-2.5 rounded-full" style={{ background: COLORS[i] }} aria-hidden="true" />
              <input
                name="q"
                defaultValue={t}
                maxLength={200}
                placeholder={["e.g. transformers", "e.g. LSTM", "Topic 3 (optional)", "Topic 4 (optional)"][i]}
                className="w-full h-11 rounded-xl border border-line bg-bg pl-8 pr-3 text-sm outline-none focus:border-accent"
              />
            </label>
          ))}
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <button className="h-10 rounded-xl bg-accent text-white font-medium px-5 hover:opacity-90">Compare</button>
          <span className="text-xs text-ink-3 ml-1">Try:</span>
          {PRESETS.map(([name, ts]) => (
            <Link
              key={name}
              href={href(ts)}
              className="text-xs rounded-full border border-line bg-surface-2 px-3 py-1 text-ink-2 hover:border-ink-3 hover:text-ink"
              title={ts.join(" vs ")}
            >
              {name}
            </Link>
          ))}
        </div>
      </form>
      {topics.length > 0 ? (
        <Results topics={topics} />
      ) : (
        <p className="mt-6 pb-20 text-sm text-ink-3">Pick a preset above, or type two to four topics.</p>
      )}
    </>
  );
}

async function Results({ topics }: { topics: string[] }) {
  let data;
  try {
    data = await getCompare(topics);
  } catch (e) {
    return (
      <div className="mt-6">
        <Notice tone="bad">{errorMessage(e, "Could not load comparison.")}</Notice>
      </div>
    );
  }
  const insights = compareInsights(data.topics);
  const color = (q: string) => COLORS[Math.max(0, data.topics.findIndex((t) => t.query === q))];
  return (
    <div className="pb-20">
      <div className="mt-6 rounded-2xl border border-line bg-surface p-4 md:p-6">
        <TrendChart series={data.topics.map((t) => ({ name: t.query, points: t.points }))} caption="Papers per million published that year." />
      </div>

      {insights.length > 0 && (
        <section className="mt-6">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-ink-3">What the numbers say</h2>
          <div className="mt-3 grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {insights.map((x) => (
              <div
                key={x.title}
                className={`rounded-2xl border p-4 ${
                  x.tone === "good" ? "border-good/30 bg-good-soft" : x.tone === "warn" ? "border-warn/30 bg-warn-soft" : "border-line bg-surface"
                }`}
              >
                <div className="flex gap-1 mb-2">
                  {x.topics.map((q) => (
                    <span key={q} className="w-2.5 h-2.5 rounded-full" style={{ background: color(q) }} aria-hidden="true" />
                  ))}
                </div>
                <h3 className="font-semibold leading-snug">{x.title}</h3>
                <p className="mt-1 text-sm text-ink-2 leading-relaxed">{x.body}</p>
              </div>
            ))}
          </div>
          <p className="mt-2 text-[0.7rem] text-ink-3">Computed from OpenAlex counts in code; no AI is involved.</p>
        </section>
      )}

      <section className="mt-8">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-ink-3">Topic by topic</h2>
        <div className="mt-3 grid sm:grid-cols-2 gap-3">
          {data.topics.map((t, i) => (
            <TopicCard key={t.query} t={t} color={COLORS[i]} />
          ))}
        </div>
      </section>
    </div>
  );
}

function TopicCard({ t, color }: { t: Trend; color: string }) {
  const pts = t.points.filter((p) => !p.partial);
  const last = pts.at(-1);
  return (
    <div className="rounded-2xl border border-line bg-surface p-4" style={{ borderTop: `3px solid ${color}` }}>
      <div className="flex items-start justify-between gap-2">
        <h3 className="font-semibold capitalize leading-snug">{t.query}</h3>
        <TrendBadge label={t.label} size="sm" />
      </div>
      <p className="mt-1 text-xs text-ink-3">{LABELS[t.label].blurb}</p>
      <dl className="mt-3 grid grid-cols-3 gap-2 text-center">
        {[
          ["Last 3 years", pct(t.recent_growth), "share change per year"],
          ["Long run", pct(t.annual_growth), "share change per year"],
          ["Peak", t.peak_year ?? "n/a", last ? `${last.share_per_million.toFixed(0)} per million in ${last.year}` : ""],
        ].map(([k, v, hint]) => (
          <div key={k as string} className="rounded-xl bg-surface-2 px-2 py-2" title={hint as string}>
            <dt className="text-[0.62rem] uppercase tracking-wider text-ink-3">{k}</dt>
            <dd className="mt-0.5 font-mono font-semibold text-sm">{v}</dd>
          </div>
        ))}
      </dl>
      <p className="mt-2 text-xs text-ink-3">{t.total_papers.toLocaleString("en-GB")} papers in the window</p>
      <div className="mt-3 flex flex-wrap gap-2 text-xs">
        <Link href={`/topic/${topicSlug(t.query)}`} className="rounded-lg border border-line px-2.5 h-7 inline-flex items-center hover:border-ink-3">
          Full trend and key papers
        </Link>
        <Link
          href={`/workspace?q=${encodeURIComponent(t.query)}`}
          className="rounded-lg bg-accent-soft text-accent-ink px-2.5 h-7 inline-flex items-center hover:bg-accent hover:text-white"
        >
          Read papers in the workspace →
        </Link>
      </div>
    </div>
  );
}
