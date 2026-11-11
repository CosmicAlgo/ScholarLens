import type { Metadata } from "next";
import { Suspense } from "react";
import { VerifyClient } from "./verify-client";

export const metadata: Metadata = {
  title: "Verify: check citations, claims and numbers",
  description:
    "Citation Check finds fabricated, wrong and retracted references. Claim Court shows which papers support or dispute a claim. Citation Telephone follows a number through the papers that repeat it.",
};

type Props = { searchParams: Promise<{ tool?: string; paper?: string; claim?: string }> };

export default function VerifyPage({ searchParams }: Props) {
  return (
    <div className="mx-auto max-w-5xl px-4">
      <section className="pt-12 pb-6 md:pt-16 max-w-3xl">
        <p className="text-sm font-medium text-accent-ink">Verify</p>
        <h1 className="mt-2 text-3xl md:text-5xl font-semibold tracking-tight leading-[1.08]">Trust, but check</h1>
        <p className="mt-4 text-ink-2 text-lg">
          Three tools for the moment you are about to rely on something: a reference list, a claim, or a number everyone
          keeps quoting. Every verdict shows the real sentences behind it.
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
  const tool = sp.tool === "court" || sp.tool === "telephone" ? sp.tool : "check";
  return (
    <VerifyClient
      initialTool={tool}
      initialPaper={typeof sp.paper === "string" ? sp.paper.slice(0, 220) : ""}
      initialClaim={typeof sp.claim === "string" ? sp.claim.slice(0, 600) : ""}
    />
  );
}
