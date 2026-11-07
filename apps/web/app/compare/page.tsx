import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { TrendChart } from "@/components/trend-chart";
import { Notice, Skeleton, TrendBadge } from "@/components/ui";
import { topicSlug } from "@/lib/api";
import { pct } from "@/lib/format";
import { errorMessage, getCompare } from "@/lib/server-data";

export const metadata: Metadata = {
  title: "Compare research topics",
  description: "Compare up to four research topics by their share of all published papers over time.",
};

type Props = { searchParams: Promise<{ q?: string | string[] }> };

const parse = (q: string | string[] | undefined) =>
  (Array.isArray(q) ? q : q ? [q] : [])
    .map((t) => t.trim())
    .filter((t) => t.length >= 2 && t.length <= 200)
    .slice(0, 4);

export default function ComparePage({ searchParams }: Props) {
  return (
    <div className="mx-auto max-w-5xl px-4 py-8">
      <h1 className="text-3xl font-semibold tracking-tight">Compare topics</h1>
      <p className="mt-2 text-ink-2">Same scale for every topic: papers per million published that year.</p>
      <Suspense fallback={<Skeleton className="h-96 mt-6" />}>
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
      <form action="/compare" className="mt-6 grid sm:grid-cols-2 md:grid-cols-4 gap-2">
        {slots.map((t, i) => (
          <label key={i} className="block">
            <span className="sr-only">Topic {i + 1}</span>
            <input
              name="q"
              defaultValue={t}
              maxLength={200}
              placeholder={["e.g. transformers", "e.g. LSTM", "Topic 3 (optional)", "Topic 4 (optional)"][i]}
              className="w-full h-10 rounded-xl border border-line bg-surface px-3 text-sm outline-none focus:border-accent"
            />
          </label>
        ))}
        <button className="sm:col-span-2 md:col-span-4 h-10 rounded-xl bg-accent text-white font-medium hover:opacity-90">
          Compare
        </button>
      </form>
      {topics.length > 0 && <Results topics={topics} />}
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
  return (
    <>
      <div className="mt-6 rounded-2xl border border-line bg-surface p-4 md:p-6">
        <TrendChart series={data.topics.map((t) => ({ name: t.query, points: t.points }))} caption="Papers per million published that year." />
      </div>
      <div className="mt-4 overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-ink-3">
              <th className="py-2 pr-4 font-medium">Topic</th>
              <th className="py-2 pr-4 font-medium">Trend</th>
              <th className="py-2 pr-4 font-medium">Share growth / yr</th>
              <th className="py-2 pr-4 font-medium">Last 3 years</th>
              <th className="py-2 pr-4 font-medium">Peak</th>
            </tr>
          </thead>
          <tbody>
            {data.topics.map((t) => (
              <tr key={t.query} className="border-t border-line">
                <td className="py-2 pr-4">
                  <Link href={`/topic/${topicSlug(t.query)}`} className="hover:text-accent-ink capitalize">
                    {t.query}
                  </Link>
                </td>
                <td className="py-2 pr-4">
                  <TrendBadge label={t.label} size="sm" />
                </td>
                <td className="py-2 pr-4 font-mono">{pct(t.annual_growth)}</td>
                <td className="py-2 pr-4 font-mono">{pct(t.recent_growth)}</td>
                <td className="py-2 pr-4 font-mono">{t.peak_year ?? "n/a"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
