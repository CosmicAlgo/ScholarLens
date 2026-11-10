"use client";

import dynamic from "next/dynamic";
import { useEffect, useMemo, useRef, useState } from "react";
import { getDoc } from "@/lib/docstore";
import type { Highlight, OpenPaper } from "@/lib/workspace";
import { pdfUrl } from "@/lib/workspace";
import type { Jump, PdfSelection, SelAction } from "./pdf-view";

const PdfView = dynamic(() => import("./pdf-view"), {
  ssr: false,
  loading: () => <p className="p-6 text-sm text-ink-3 animate-pulse">Loading viewer…</p>,
});

export function Reader({
  papers,
  activeId,
  highlights,
  jump,
  view,
  setView,
  matrix,
  onActivate,
  onClose,
  onAction,
  onAttach,
}: {
  papers: OpenPaper[];
  activeId: string | null;
  highlights: Highlight[];
  jump: (NonNullable<Jump> & { id: string }) | null;
  view: "paper" | "matrix";
  setView: (v: "paper" | "matrix") => void;
  matrix: React.ReactNode;
  onActivate: (id: string) => void;
  onClose: (id: string) => void;
  onAction: (p: OpenPaper, a: SelAction, s: PdfSelection, color?: Highlight["color"]) => void;
  onAttach: (file: File, attachTo?: OpenPaper) => void;
}) {
  const p = papers.find((x) => x.id === activeId) || papers[0];

  return (
    <div className="h-full flex flex-col min-h-0">
      <div className="flex items-end gap-1 px-2 pt-2 border-b border-line overflow-x-auto shrink-0" role="tablist">
        {papers.length > 0 && (
          <button
            role="tab"
            aria-selected={view === "matrix"}
            onClick={() => setView("matrix")}
            className={`shrink-0 rounded-t-lg border border-b-0 px-3 py-1.5 text-xs font-medium ${
              view === "matrix" ? "bg-surface border-line text-accent-ink" : "border-transparent text-ink-3 hover:text-ink"
            }`}
            title="Evidence matrix: compare the open papers in one table"
          >
            ▦ Matrix
          </button>
        )}
        {papers.map((x) => (
          <div
            key={x.id}
            role="tab"
            aria-selected={view === "paper" && x.id === p?.id}
            className={`group flex items-center gap-1 max-w-56 shrink-0 rounded-t-lg border border-b-0 px-3 py-1.5 text-xs cursor-pointer ${
              view === "paper" && x.id === p?.id ? "bg-surface border-line text-ink" : "border-transparent text-ink-3 hover:text-ink"
            }`}
            onClick={() => {
              onActivate(x.id);
              setView("paper");
            }}
          >
            {x.local && (
              <span className="text-accent-ink" title="Your PDF">
                ●
              </span>
            )}
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

      {view === "matrix" && papers.length > 0 ? (
        <div className="flex-1 min-h-0">{matrix}</div>
      ) : !p ? (
        <Empty onAttach={onAttach} />
      ) : (
        <PaperView
          key={p.id}
          p={p}
          highlights={highlights.filter((h) => h.paper_id === p.id)}
          jump={jump && jump.id === p.id ? jump : null}
          onAction={(a, s, c) => onAction(p, a, s, c)}
          onAttach={onAttach}
        />
      )}
    </div>
  );
}

function PaperView({
  p,
  highlights,
  jump,
  onAction,
  onAttach,
}: {
  p: OpenPaper;
  highlights: Highlight[];
  jump: Jump;
  onAction: (a: SelAction, s: PdfSelection, color?: Highlight["color"]) => void;
  onAttach: (file: File, attachTo?: OpenPaper) => void;
}) {
  const [local, setLocal] = useState<ArrayBuffer | null>(null);
  const [view, setView] = useState<"pdf" | "abstract">("pdf");

  useEffect(() => {
    let live = true;
    if (p.local) getDoc(p.id).then((d) => live && setLocal(d?.data ?? null));
    return () => {
      live = false;
    };
  }, [p.id, p.local]);

  // A stable source object: pdf.js takes ownership of the bytes, so it gets its own copy.
  const localSource = useMemo(() => (local ? { data: new Uint8Array(local.slice(0)) } : null), [local]);
  const file = p.local ? localSource : p.fulltext === "ready" ? pdfUrl(p.id) : null;
  const showPdf = view === "pdf" && file !== null;
  const doi = p.doi ? (p.doi.startsWith("http") ? p.doi : `https://doi.org/${p.doi}`) : null;

  return (
    <>
      <header className="px-4 sm:px-5 py-3 border-b border-line bg-surface shrink-0">
        {p.is_retracted && (
          <div className="mb-2 rounded-lg bg-bad-soft text-bad text-xs px-3 py-1.5 font-medium">
            ⚠ This paper has been retracted. Do not rely on its findings.
          </div>
        )}
        <h1 className="font-semibold leading-snug line-clamp-2">{p.title}</h1>
        {p.authors.length > 0 && (
          <p className="mt-1 text-xs text-ink-3 line-clamp-1">
            {[p.authors.slice(0, 4).join(", ") + (p.authors.length > 4 ? " et al." : ""), p.venue, p.year].filter(Boolean).join(" · ")}
          </p>
        )}
        <div className="mt-2 flex flex-wrap items-center gap-2 text-[0.7rem]">
          {p.is_preprint && <span className="rounded px-1.5 py-0.5 bg-warn-soft text-warn">Preprint · not peer reviewed</span>}
          {!p.id.startsWith("U") && <span className="text-ink-3">{p.cited_by_count.toLocaleString("en-GB")} citations</span>}
          <SourceBadge p={p} />
          <span className="flex-1" />
          {file !== null && !p.id.startsWith("U") && (
            <div className="inline-flex rounded-lg border border-line p-0.5" role="group" aria-label="View">
              {(["pdf", "abstract"] as const).map((v) => (
                <button
                  key={v}
                  onClick={() => setView(v)}
                  className={`px-2.5 py-0.5 rounded-md ${(v === "pdf") === showPdf ? "bg-surface-2 text-ink" : "text-ink-3"}`}
                >
                  {v === "pdf" ? "PDF" : "Abstract"}
                </button>
              ))}
            </div>
          )}
          {doi && (
            <a href={doi} target="_blank" rel="noreferrer" className="text-ink-3 hover:text-ink underline">
              DOI
            </a>
          )}
        </div>
      </header>

      <div className="flex-1 min-h-0 bg-surface-2">
        {showPdf ? (
          <PdfView file={file} highlights={highlights} jump={jump} onAction={onAction} sourceUrl={p.local ? null : p.oa_url || doi} />
        ) : p.local && !local ? (
          <p className="p-6 text-sm text-ink-3 animate-pulse">Opening your PDF…</p>
        ) : (
          <div className="h-full overflow-y-auto">
            <article className="max-w-2xl mx-auto px-5 sm:px-6 py-8">
              {p.fulltext === "loading" && (
                <p className="text-sm text-ink-3 animate-pulse mb-4">
                  Looking for a free full-text PDF (OpenAlex, Unpaywall, arXiv, PubMed Central)…
                </p>
              )}
              {(p.fulltext === "no_pdf" || p.fulltext === "failed") && !p.local && <AttachBox p={p} onAttach={onAttach} />}
              <h2 className="text-xs font-semibold uppercase tracking-wider text-ink-3">Abstract</h2>
              <p className="mt-2 leading-relaxed">{p.abstract || "No abstract available."}</p>
            </article>
          </div>
        )}
      </div>
    </>
  );
}

function useDrop(onFile: (f: File) => void) {
  const [over, setOver] = useState(false);
  return {
    over,
    props: {
      onDragOver: (e: React.DragEvent) => {
        e.preventDefault();
        setOver(true);
      },
      onDragLeave: () => setOver(false),
      onDrop: (e: React.DragEvent) => {
        e.preventDefault();
        setOver(false);
        const f = e.dataTransfer.files[0];
        if (f) onFile(f);
      },
    },
  };
}

function FilePick({ onFile, children, className }: { onFile: (f: File) => void; children: React.ReactNode; className: string }) {
  const input = useRef<HTMLInputElement>(null);
  return (
    <>
      <button onClick={() => input.current?.click()} className={className}>
        {children}
      </button>
      <input
        ref={input}
        type="file"
        accept="application/pdf"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) onFile(f);
          e.target.value = "";
        }}
      />
    </>
  );
}

function AttachBox({ p, onAttach }: { p: OpenPaper; onAttach: (file: File, attachTo?: OpenPaper) => void }) {
  const drop = useDrop((f) => onAttach(f, p));
  const link = p.oa_url || (p.doi ? (p.doi.startsWith("http") ? p.doi : `https://doi.org/${p.doi}`) : null);
  return (
    <div
      {...drop.props}
      className={`mb-6 rounded-2xl border-2 border-dashed p-5 text-sm transition-colors ${drop.over ? "border-accent bg-accent-soft" : "border-line bg-surface"}`}
    >
      <p className="font-medium">No free PDF found for this paper.</p>
      <p className="mt-1 text-ink-3">
        If you have access through your library, drop the PDF here. It stays in this browser, and Copilot then reads and cites
        its pages.
      </p>
      <div className="mt-3 flex flex-wrap gap-2">
        <FilePick onFile={(f) => onAttach(f, p)} className="rounded-lg bg-accent text-white px-3 h-8 text-xs font-medium">
          Attach PDF
        </FilePick>
        {link && (
          <a href={link} target="_blank" rel="noreferrer" className="rounded-lg border border-line px-3 h-8 text-xs inline-flex items-center hover:border-ink-3">
            Get it from the publisher ↗
          </a>
        )}
      </div>
    </div>
  );
}

function Empty({ onAttach }: { onAttach: (file: File) => void }) {
  const drop = useDrop(onAttach);
  return (
    <div {...drop.props} className={`flex-1 grid place-items-center p-8 text-center transition-colors ${drop.over ? "bg-accent-soft" : ""}`}>
      <div className="max-w-sm">
        <div className="mx-auto w-14 h-14 rounded-2xl bg-accent-soft grid place-items-center text-accent-ink">
          <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
            <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" />
            <path d="M14 3v5h5M9 13h6M9 17h4" strokeLinecap="round" />
          </svg>
        </div>
        <h2 className="mt-4 font-semibold text-lg">Open a paper, or drop in your own PDF</h2>
        <p className="mt-2 text-sm text-ink-3">
          Search the library for open-access papers, or bring a PDF: a draft, or a paywalled paper you have access to. Select
          any text to ask, explain, verify or highlight it.
        </p>
        <FilePick onFile={onAttach} className="mt-4 rounded-xl bg-accent text-white px-4 h-10 text-sm font-medium">
          Upload a PDF
        </FilePick>
      </div>
    </div>
  );
}

function SourceBadge({ p }: { p: OpenPaper }) {
  if (p.local)
    return <span className="rounded px-1.5 py-0.5 bg-accent-soft text-accent-ink">Your PDF · {p.pages} pages · stays in this browser</span>;
  if (p.fulltext === "loading") return <span className="text-ink-3 animate-pulse">finding full text…</span>;
  if (p.fulltext === "ready")
    return <span className="rounded px-1.5 py-0.5 bg-good-soft text-good">Full text · {p.pages} pages · Copilot cites pages</span>;
  if (p.fulltext === "no_pdf" || p.fulltext === "failed")
    return <span className="rounded px-1.5 py-0.5 bg-surface-2 text-ink-3">Abstract only</span>;
  return null;
}
