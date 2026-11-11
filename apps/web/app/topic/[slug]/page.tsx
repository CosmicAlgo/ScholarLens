import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { TopicSearch } from "@/components/topic-search";
import { TrendChart } from "@/components/trend-chart";
import { Notice, PaperCard, Skeleton, TrendBadge, TrendStats } from "@/components/ui";
import { topicFromSlug } from "@/lib/api";
import { LABELS } from "@/lib/format";
import { errorMessage, getSearch, getTrend } from "@/lib/server-data";

type Props = { params: Promise<{ slug: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const topic = topicFromSlug((await params).slug);
  return {
    title: `Is ${topic} still growing?`,
    description: `How research on ${topic} has risen or fallen as a share of all published papers, with key papers and trust flags.`,
  };
}

export default function TopicPage({ params }: Props) {
  return (
    <div className="mx-auto max-w-5xl px-4 py-8">
      <div className="max-w-xl mb-8">
        <TopicSearch size="md" />
      </div>
      <Suspense fallback={<TrendSkeleton />}>
        <TrendSection params={params} />
      </Suspense>
      <Suspense fallback={<Skeleton className="h-64 mt-10" />}>
        <PapersSection params={params} />
      </Suspense>
    </div>
  );
}

async function TrendSection({ params }: Props) {
  const topic = topicFromSlug((await params).slug);
  let trend;
  try {
    trend = await getTrend(topic);
  } catch (e) {
    return (
      <>
        <h1 className="text-3xl font-semibold tracking-tight capitalize">{topic}</h1>
        <div className="mt-4">
          <Notice tone="bad">{errorMessage(e, "Could not load trend data.")}</Notice>
        </div>
      </>
    );
  }
  const info = LABELS[trend.label];
  return (
    <section>
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-3xl font-semibold tracking-tight capitalize">{topic}</h1>
        <TrendBadge label={trend.label} />
      </div>
      <p className="mt-2 text-ink-2">{info.blurb}</p>
      {trend.sense?.note && (
        <p className="mt-3 max-w-3xl rounded-xl border border-line bg-surface-2 px-3 py-2 text-sm text-ink-2">
          {trend.sense.note}{" "}
          <Link href={`/compare?q=${encodeURIComponent(topic)}&s=all`} className="text-accent-ink underline underline-offset-2">
            Count all fields instead
          </Link>
        </p>
      )}
      <div className="mt-6">
        <TrendStats t={trend} />
      </div>
      <div className="mt-6 rounded-2xl border border-line bg-surface p-4 md:p-6">
        <h2 className="text-sm font-medium text-ink-2 mb-3">Share of all published papers</h2>
        <TrendChart series={[{ name: topic, points: trend.points }]} />
      </div>
      <div className="mt-4 flex flex-wrap gap-3 text-sm">
        <Link
          href={`/compare?q=${encodeURIComponent(topic)}`}
          className="rounded-lg border border-line bg-surface px-3 py-2 hover:border-ink-3"
        >
          Compare with another topic
        </Link>
        <Link
          href={`/ask?q=${encodeURIComponent(`Is ${topic} still growing, and what is emerging inside it?`)}`}
          className="rounded-lg bg-accent text-white px-3 py-2 hover:opacity-90"
        >
          Get an AI briefing on {topic}
        </Link>
      </div>
    </section>
  );
}

async function PapersSection({ params }: Props) {
  const topic = topicFromSlug((await params).slug);
  let results;
  try {
    results = (await getSearch(topic)).results;
  } catch {
    return null;
  }
  return (
    <section className="mt-12">
      <h2 className="text-xl font-semibold tracking-tight">Relevant papers</h2>
      <p className="mt-1 text-sm text-ink-3">
        From the papers ScholarLens has indexed so far. Coverage is growing; trend numbers above use the full OpenAlex
        catalogue.
      </p>
      {results.length === 0 ? (
        <div className="mt-4">
          <Notice>No indexed papers match this topic yet.</Notice>
        </div>
      ) : (
        <div className="mt-4 grid md:grid-cols-2 gap-3">
          {results.map((p) => (
            <PaperCard key={p.id} p={p} />
          ))}
        </div>
      )}
    </section>
  );
}

function TrendSkeleton() {
  return (
    <div>
      <Skeleton className="h-9 w-72" />
      <div className="mt-6 grid grid-cols-2 md:grid-cols-4 gap-3">
        {[0, 1, 2, 3].map((i) => (
          <Skeleton key={i} className="h-24" />
        ))}
      </div>
      <Skeleton className="h-80 mt-6" />
    </div>
  );
}
