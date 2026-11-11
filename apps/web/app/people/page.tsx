import type { Metadata } from "next";
import { Suspense } from "react";
import { PeopleClient } from "./people-client";

export const metadata: Metadata = {
  title: "Researchers: what a professor works on now",
  description:
    "Find a researcher, see their recent papers, how their focus is shifting and what they say is still open, and get a cited brief on where your research idea fits.",
};

type Props = { searchParams: Promise<{ id?: string; q?: string }> };

export default function PeoplePage({ searchParams }: Props) {
  return (
    <div className="mx-auto max-w-5xl px-4">
      <section className="pt-12 pb-6 md:pt-16 max-w-3xl">
        <p className="text-sm font-medium text-accent-ink">Researchers</p>
        <h1 className="mt-2 text-3xl md:text-5xl font-semibold tracking-tight leading-[1.08]">Know their work before you write</h1>
        <p className="mt-4 text-ink-2 text-lg">
          Find a professor and see what they publish now, where their focus is moving, who they work with and what they say
          is still unsolved. Describe your idea and get a cited brief on where it fits.
        </p>
      </section>
      <Suspense fallback={null}>
        <WithParams searchParams={searchParams} />
      </Suspense>
    </div>
  );
}

async function WithParams({ searchParams }: Props) {
  const sp = await searchParams;
  const id = typeof sp.id === "string" && /^A\d{4,12}$/.test(sp.id) ? sp.id : null;
  return <PeopleClient initialId={id} initialQuery={typeof sp.q === "string" ? sp.q.slice(0, 120) : ""} />;
}
