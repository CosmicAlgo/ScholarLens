import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { Notice, Skeleton, TrustFlags } from "@/components/ui";
import { num } from "@/lib/format";
import { getPaper } from "@/lib/server-data";

type Props = { params: Promise<{ id: string }> };

const valid = (id: string) => /^W\d+$/.test(id);

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { id } = await params;
  if (!valid(id)) return {};
  try {
    const p = await getPaper(id);
    if (!p) return {};
    return { title: p.title, description: (p.abstract || "").slice(0, 160) };
  } catch {
    return {};
  }
}

export default function PaperPage({ params }: Props) {
  return (
    <div className="mx-auto max-w-3xl px-4 py-10">
      <Suspense fallback={<Skeleton className="h-96" />}>
        <PaperBody params={params} />
      </Suspense>
    </div>
  );
}

async function PaperBody({ params }: Props) {
  const { id } = await params;
  if (!valid(id)) notFound();
  let p;
  try {
    p = await getPaper(id);
  } catch {
    return <Notice tone="bad">Could not load this paper.</Notice>;
  }
  if (!p) notFound();
  const doiUrl = p.doi ? (p.doi.startsWith("http") ? p.doi : `https://doi.org/${p.doi}`) : null;
  return (
    <article>
      {p.is_retracted && (
        <div className="mb-4">
          <Notice tone="bad">
            <strong>This paper has been retracted.</strong> Its findings should not be relied on.
          </Notice>
        </div>
      )}
      <div className="text-sm text-ink-3">
        {[p.year, p.venue, p.topic].filter(Boolean).join(" · ")}
      </div>
      <h1 className="mt-2 text-2xl md:text-3xl font-semibold tracking-tight leading-tight">{p.title}</h1>
      <p className="mt-3 text-ink-2">{p.authors.join(", ")}</p>
      <div className="mt-4 flex flex-wrap items-center gap-3 text-sm text-ink-3">
        <TrustFlags p={p} />
        <span>{num(p.cited_by_count)} citations</span>
      </div>
      {p.abstract && (
        <section className="mt-8">
          <h2 className="text-sm font-medium text-ink-3 uppercase tracking-wide">Abstract</h2>
          <p className="mt-2 leading-relaxed whitespace-pre-line">{p.abstract}</p>
        </section>
      )}
      <div className="mt-8 flex flex-wrap gap-3 text-sm">
        {p.oa_url && (
          <a href={p.oa_url} target="_blank" rel="noreferrer" className="rounded-lg bg-accent text-white px-3 py-2 hover:opacity-90">
            Read free version
          </a>
        )}
        {doiUrl && (
          <a href={doiUrl} target="_blank" rel="noreferrer" className="rounded-lg border border-line bg-surface px-3 py-2 hover:border-ink-3">
            Publisher page (DOI)
          </a>
        )}
        <a
          href={`https://openalex.org/works/${p.id}`}
          target="_blank"
          rel="noreferrer"
          className="rounded-lg border border-line bg-surface px-3 py-2 hover:border-ink-3"
        >
          OpenAlex record
        </a>
        <a href={`/verify?tool=court&paper=${p.id}`} className="rounded-lg border border-line bg-surface px-3 py-2 hover:border-ink-3">
          ⚖ Claim Court: who agrees?
        </a>
        <a href={`/verify?tool=telephone&paper=${p.id}`} className="rounded-lg border border-line bg-surface px-3 py-2 hover:border-ink-3">
          ☎ Trace a number
        </a>
      </div>
    </article>
  );
}
