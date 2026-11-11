import type { Metadata } from "next";
import { Suspense } from "react";
import { AskClient } from "./ask-client";

export const metadata: Metadata = {
  title: "Briefings: cited research reports",
  description:
    "Ask about a research field and get a briefing from seven agents: computed trends, key papers, emerging sub-areas and trust checks. Every claim cites a source.",
};

type Props = { searchParams: Promise<{ q?: string }> };

export default function AskPage({ searchParams }: Props) {
  return (
    <div className="mx-auto max-w-5xl px-4">
      <section className="pt-12 pb-6 md:pt-16 max-w-3xl">
        <p className="text-sm font-medium text-accent-ink">Briefings</p>
        <h1 className="mt-2 text-3xl md:text-5xl font-semibold tracking-tight leading-[1.08]">A cited briefing on any research field</h1>
        <p className="mt-4 text-ink-2 text-lg">
          Seven agents work through your question: they compute the trend, find the papers that matter, map the sub-areas,
          check for retractions, write, and then delete every claim that lacks a source.
        </p>
      </section>
      <Suspense fallback={null}>
        <WithQuery searchParams={searchParams} />
      </Suspense>
    </div>
  );
}

async function WithQuery({ searchParams }: Props) {
  const q = (await searchParams).q;
  return <AskClient initial={typeof q === "string" ? q.slice(0, 500) : ""} />;
}
