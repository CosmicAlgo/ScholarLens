"use client";

import { useState } from "react";
import type { OpenPaper } from "@/lib/workspace";
import { pdfUrl } from "@/lib/workspace";

export function Reader({
  papers,
  activeId,
  page,
  onActivate,
  onClose,
}: {
  papers: OpenPaper[];
  activeId: string | null;
  page: Record<string, number>;
  onActivate: (id: string) => void;
  onClose: (id: string) => void;
}) {
  const p = papers.find((x) => x.id === activeId) || papers[0];
  const [view, setView] = useState<"pdf" | "abstract">("pdf");

  if (!p) {
    return (
      <div className="h-full grid place-items-center p-8 text-center">
        <div className="max-w-sm">
          <div className="mx-auto w-14 h-14 rounded-2xl bg-accent-soft grid place-items-center text-accent-ink text-2xl">⌕</div>
          <h2 className="mt-4 font-semibold text-lg">Open a paper to start reading</h2>
          <p className="mt-2 text-sm text-ink-3">
            Search in the library on the left. Open-access papers load as the full PDF; Copilot reads them with you and cites
            the exact page.
          </p>
        </div>
      </div>
    );
  }

  const showPdf = view === "pdf" && p.fulltext === "ready";
  const doi = p.doi ? (p.doi.startsWith("http") ? p.doi : `https://doi.org/${p.doi}`) : null;

  return (
    <div className="h-full flex flex-col min-h-0">
      <div className="flex items-end gap-1 px-2 pt-2 border-b border-line overflow-x-auto" role="tablist">
        {papers.map((x) => (
          <div
            key={x.id}
            role="tab"
            aria-selected={x.id === p.id}
            className={`group flex items-center gap-1 max-w-56 rounded-t-lg border border-b-0 px-3 py-1.5 text-xs cursor-pointer ${
              x.id === p.id ? "bg-surface border-line text-ink" : "border-transparent text-ink-3 hover:text-ink"
            }`}
            onClick={() => onActivate(x.id)}
          >
            <span className="truncate">{x.title}</span>
            <button
              aria-label={`Close ${x.title}`}
              onClick={(e) => {
                e.stopPropagation();
                onClose(x.id);
              }}
              className="ml-1 rounded px-1 text-ink-3 hover:bg-surface-2 hover:text-ink"
            >
              ×
            </button>
          </div>
        ))}
      </div>

      <header className="px-5 py-3 border-b border-line bg-surface">
        {p.is_retracted && (
          <div className="mb-2 rounded-lg bg-bad-soft text-bad text-xs px-3 py-1.5 font-medium">
            ⚠ This paper has been retracted. Do not rely on its findings.
          </div>
        )}
        <h1 className="font-semibold leading-snug">{p.title}</h1>
        <p className="mt-1 text-xs text-ink-3 line-clamp-1">
          {[p.authors.slice(0, 4).join(", ") + (p.authors.length > 4 ? " et al." : ""), p.venue, p.year].filter(Boolean).join(" · ")}
        </p>
        <div className="mt-2 flex flex-wrap items-center gap-2 text-[0.7rem]">
          {p.is_preprint && <span className="rounded px-1.5 py-0.5 bg-warn-soft text-warn">Preprint · not peer reviewed</span>}
          <span className="text-ink-3">{p.cited_by_count.toLocaleString("en-GB")} citations</span>
          <FulltextBadge p={p} />
          <span className="flex-1" />
          <div className="inline-flex rounded-lg border border-line p-0.5" role="group" aria-label="View">
            {(["pdf", "abstract"] as const).map((v) => (
              <button
                key={v}
                onClick={() => setView(v)}
                disabled={v === "pdf" && p.fulltext !== "ready"}
                className={`px-2.5 py-0.5 rounded-md capitalize disabled:opacity-40 ${
                  (v === "pdf" ? showPdf : !showPdf) ? "bg-surface-2 text-ink" : "text-ink-3"
                }`}
              >
                {v === "pdf" ? "PDF" : "Abstract"}
              </button>
            ))}
          </div>
          {doi && (
            <a href={doi} target="_blank" rel="noreferrer" className="text-ink-3 hover:text-ink underline">
              DOI
            </a>
          )}
        </div>
      </header>

      <div className="flex-1 min-h-0 bg-surface-2">
        {showPdf ? (
          <iframe
            key={`${p.id}-${page[p.id] || 1}`}
            src={pdfUrl(p.id, page[p.id] || 1)}
            title={`PDF: ${p.title}`}
            className="w-full h-full border-0 bg-white"
          />
        ) : (
          <div className="h-full overflow-y-auto">
            <article className="max-w-2xl mx-auto px-6 py-8">
              {p.fulltext === "loading" && <p className="text-sm text-ink-3 animate-pulse mb-4">Fetching the open-access full text…</p>}
              {(p.fulltext === "no_pdf" || p.fulltext === "failed") && (
                <p className="text-sm text-ink-3 mb-4 rounded-lg border border-line bg-surface px-3 py-2">
                  No open-access PDF could be loaded for this paper, so Copilot works from the abstract.
                  {p.oa_url && (
                    <>
                      {" "}
                      <a href={p.oa_url} target="_blank" rel="noreferrer" className="underline">
                        Try the publisher&rsquo;s free version
                      </a>
                      .
                    </>
                  )}
                </p>
              )}
              <h2 className="text-xs font-semibold uppercase tracking-wider text-ink-3">Abstract</h2>
              <p className="mt-2 leading-relaxed">{p.abstract || "No abstract available."}</p>
            </article>
          </div>
        )}
      </div>
    </div>
  );
}

function FulltextBadge({ p }: { p: OpenPaper }) {
  if (p.fulltext === "loading") return <span className="text-ink-3 animate-pulse">indexing full text…</span>;
  if (p.fulltext === "ready")
    return <span className="rounded px-1.5 py-0.5 bg-good-soft text-good">Full text · {p.pages} pages · Copilot can cite pages</span>;
  if (p.fulltext === "no_pdf" || p.fulltext === "failed")
    return <span className="rounded px-1.5 py-0.5 bg-surface-2 text-ink-3">Abstract only</span>;
  return null;
}
