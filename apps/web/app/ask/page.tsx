import type { Metadata } from "next";
import { Suspense } from "react";
import { AskClient } from "./ask-client";

export const metadata: Metadata = {
  title: "Ask: AI research briefings with citations",
  description: "Ask about a research field and get a briefing where every claim cites a paper or a computed number.",
};

type Props = { searchParams: Promise<{ q?: string }> };

export default function AskPage({ searchParams }: Props) {
  return (
    <div className="mx-auto max-w-4xl px-4 py-8">
      <h1 className="text-3xl font-semibold tracking-tight">Ask about a research field</h1>
      <p className="mt-2 text-ink-2">
        Seven single-purpose agents research your question. Every claim in the briefing cites a source, or it is removed.
      </p>
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
