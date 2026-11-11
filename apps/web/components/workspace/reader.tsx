"use client";

import dynamic from "next/dynamic";
import { useEffect, useMemo, useRef, useState } from "react";
import { getDoc } from "@/lib/docstore";
import type { FigureItem, Highlight, OpenPaper } from "@/lib/workspace";
import { pdfUrl } from "@/lib/workspace";
import { FilmView } from "./film";
import type { Jump, PdfSelection, SelAction } from "./pdf-view";

const PdfView = dynamic(() => import("./pdf-view"), {
  ssr: false,
  loading: () => <p className="p-6 text-sm text-ink-3 animate-pulse">Loading viewer…</p>,
});

export type ReaderView = "paper" | "matrix" | "map";

export type FigureGuideProps = {
  items: Record<string, FigureItem[]>;
  status: Record<string, string>;
  onRead: (p: OpenPaper) => void;
  onAsk: (p: OpenPaper, f: FigureItem) => void;
  onOpenPage: (id: string, page: number, text?: string) => void;
};

export function Reader({
  papers,
  activeId,
  highlights,
  jump,
  view,
  setView,
  matrix,
  map,
  figures,
  onActivate,
  onClose,
  onAction,
  onAttach,
}: {
  papers: OpenPaper[];
  activeId: string | null;
  highlights: Highlight[];
  jump: (NonNullable<Jump> & { id: string }) | null;
  view: ReaderView;
  setView: (v: ReaderView) => void;
  matrix: React.ReactNode;
  map: React.ReactNode;
  figures: FigureGuideProps;
  onActivate: (id: string) => void;
  onClose: (id: string) => void;
  onAction: (p: OpenPaper, a: SelAction, s: PdfSelection, color?: Highlight["color"]) => void;
  onAttach: (file: File, attachTo?: OpenPaper) => void;
}) {
  const p = papers.find((x) => x.id === activeId) || papers[0];

  return (
    <div className="h-full flex flex-col min-h-0">
      <div className="flex items-end gap-1 px-2 pt-2 border-b border-line overflow-x-auto shrink-0" role="tablist">
        {papers.length > 0 &&
          (
            [
              ["matrix", "▦ Matrix", "Evidence matrix: compare the open papers in one table"],
              ["map", "⌘ Map", "Connection map: how the open papers, their sources and your ideas link up"],
            ] as const
          ).map(([v, label, hint]) => (
            <button
              key={v}
              role="tab"
              aria-selected={view === v}
              onClick={() => setView(v)}
              className={`shrink-0 rounded-t-lg border border-b-0 px-3 py-1.5 text-xs font-medium ${
                view === v ? "bg-surface border-line text-accent-ink" : "border-transparent text-ink-3 hover:text-ink"
              }`}
              title={hint}
            >
              {label}
            </button>
          ))}
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
      ) : view === "map" && papers.length > 0 ? (
        <div className="flex-1 min-h-0">{map}</div>
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
          figures={figures}
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
  figures,
}: {
  p: OpenPaper;
  highlights: Highlight[];
  jump: Jump;
  onAction: (a: SelAction, s: PdfSelection, color?: Highlight["color"]) => void;
  onAttach: (file: File, attachTo?: OpenPaper) => void;
  figures: FigureGuideProps;
}) {
  const [local, setLocal] = useState<ArrayBuffer | null>(null);
  const [missing, setMissing] = useState(false);
  const [view, setView] = useState<"pdf" | "abstract" | "film">("pdf");
  const [filmJump, setFilmJump] = useState<Jump>(null);
  const [guide, setGuide] = useState(false);
  const figs = figures.items[p.id];
  const figStatus = figures.status[p.id];

  useEffect(() => {
    let live = true;
    if (p.local)
      getDoc(p.id).then((d) => {
        if (!live) return;
        setLocal(d?.data ?? null);
        setMissing(!d);
      });
    return () => {
      live = false;
    };
  }, [p.id, p.local, p.localAt]);

  // A stable source object: pdf.js takes ownership of the bytes, so it gets its own copy.
  const localSource = useMemo(() => (local ? { data: new Uint8Array(local.slice(0)) } : null), [local]);
  const file = p.local ? localSource : p.fulltext === "ready" ? pdfUrl(p.id) : null;
  const showPdf = view === "pdf" && file !== null;
  const showFilm = view === "film";
  // Whichever jump is newer wins: a citation from Copilot or a page link from the film.
  const pdfJump = filmJump && (!jump || filmJump.nonce > jump.nonce) ? filmJump : jump;
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
          <button
            onClick={() => setView(showFilm ? "pdf" : "film")}
            aria-pressed={showFilm}
            className={`inline-flex items-center gap-1 rounded-lg border px-2.5 py-0.5 ${
              showFilm ? "border-accent bg-accent text-white" : "border-accent/40 text-accent-ink hover:bg-accent-soft"
            }`}
            title="Paper Film: a narrated explainer made from this paper's own text"
          >
            ▶ Film
          </button>
          {doi && (
            <a href={doi} target="_blank" rel="noreferrer" className="text-ink-3 hover:text-ink underline">
              DOI
            </a>
          )}
        </div>
      </header>

      <div className="flex-1 min-h-0 bg-surface-2 relative">
        {showFilm ? (
          <FilmView
            p={p}
            file={file}
            onCite={(page, text) => {
              setFilmJump({ page, text, nonce: Date.now() });
              setView("pdf");
            }}
          />
        ) : showPdf ? (
          <PdfView
            file={file}
            highlights={highlights}
            jump={pdfJump}
            onAction={onAction}
            sourceUrl={p.local ? null : p.oa_url || doi}
            extra={
              <button
                onClick={() => {
                  setGuide((g) => !g);
                  if (!figs && figStatus !== "loading") figures.onRead(p);
                }}
                aria-pressed={guide}
                className={`tool-btn gap-1 px-2 ${guide ? "!bg-vision !text-white" : "text-vision"}`}
                title="Figure guide: a vision model reads every figure, table and diagram"
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
                  <rect x="3" y="4" width="18" height="16" rx="2" />
                  <path d="m3 16 5-5 4 4 3-3 6 6M15.5 9.5h.01" />
                </svg>
                <span className="hidden sm:inline">Figures{figs ? ` · ${figs.length}` : ""}</span>
              </button>
            }
          />
        ) : p.local && missing ? (
          <div className="h-full overflow-y-auto">
            <div className="max-w-2xl mx-auto px-5 py-8">
              <MissingBox p={p} onAttach={onAttach} />
            </div>
          </div>
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
        {guide && showPdf && (
          <FigureGuide
            items={figs}
            status={figStatus}
            onClose={() => setGuide(false)}
            onRetry={() => figures.onRead(p)}
            onOpen={(f) => figures.onOpenPage(p.id, f.page, f.caption ?? undefined)}
            onAsk={(f) => figures.onAsk(p, f)}
          />
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

function MissingBox({ p, onAttach }: { p: OpenPaper; onAttach: (file: File, attachTo?: OpenPaper) => void }) {
  const drop = useDrop((f) => onAttach(f, p));
  return (
    <div
      {...drop.props}
      className={`rounded-2xl border-2 border-dashed p-5 text-sm transition-colors ${drop.over ? "border-accent bg-accent-soft" : "border-warn/50 bg-warn-soft"}`}
    >
      <p className="font-medium text-ink">This PDF is no longer stored in this browser.</p>
      <p className="mt-1 text-ink-2">
        Browsers sometimes clear stored files (for example after a long time away, or when the disk is nearly full). Your highlights,
        notes and matrix rows for it are still here. Drop the same PDF here, or restore a backup from the Library, to keep reading.
      </p>
      <FilePick onFile={(f) => onAttach(f, p)} className="mt-3 rounded-lg bg-accent text-white px-3 h-8 text-xs font-medium">
        Re-attach PDF
      </FilePick>
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

const FIG_ICON: Record<string, string> = { chart: "▥", diagram: "◇", flowchart: "⇢", table: "▦", image: "▣", equation: "∑", other: "▢" };

function FigureGuide({
  items,
  status,
  onClose,
  onRetry,
  onOpen,
  onAsk,
}: {
  items?: FigureItem[];
  status?: string;
  onClose: () => void;
  onRetry: () => void;
  onOpen: (f: FigureItem) => void;
  onAsk: (f: FigureItem) => void;
}) {
  return (
    <aside
      aria-label="Figure guide"
      className="absolute z-20 top-10 bottom-0 right-0 w-full sm:w-80 border-l border-line bg-surface shadow-xl flex flex-col"
    >
      <div className="flex items-center gap-2 px-3 h-10 border-b border-line shrink-0">
        <span className="text-sm font-semibold">Figure guide</span>
        <span className="rounded px-1.5 py-0.5 text-[0.6rem] font-medium uppercase tracking-wider bg-vision-soft text-vision">vision</span>
        <span className="flex-1" />
        <button onClick={onClose} aria-label="Close figure guide" className="tool-btn">
          ×
        </button>
      </div>
      <div className="flex-1 overflow-y-auto p-3 space-y-2.5">
        {status === "loading" && (
          <p className="text-sm text-ink-3 animate-pulse">Looking at the figures, tables and diagrams… (10–20 s)</p>
        )}
        {status && status !== "loading" && (
          <div className="rounded-lg bg-bad-soft text-bad text-xs px-3 py-2">
            {status}{" "}
            <button onClick={onRetry} className="underline">
              Try again
            </button>
          </div>
        )}
        {items && items.length === 0 && <p className="text-sm text-ink-3">No figures or tables were found on the pages checked.</p>}
        {items?.map((f) => (
          <div key={f.id} className="rounded-xl border border-line p-3 text-sm hover:border-vision/50">
            <button onClick={() => onOpen(f)} className="w-full text-left">
              <div className="flex items-center gap-1.5 text-xs">
                <span className="text-vision" aria-hidden="true">
                  {FIG_ICON[f.figure_kind] || FIG_ICON.other}
                </span>
                <span className="font-semibold text-ink">{f.label}</span>
                <span className="text-ink-3">· {f.figure_kind} · p.{f.page}</span>
                {f.caption ? (
                  <span className="ml-auto text-good" title={`Label and page checked against the printed caption: “${f.caption}”`}>
                    ✓ caption
                  </span>
                ) : (
                  <span className="ml-auto text-ink-3" title="No printed caption was found for this label; the page and label are the vision model's reading">
                    unchecked
                  </span>
                )}
              </div>
              <p className="mt-1 text-ink-2 leading-snug">{f.text.replace(/^.*?Shows:\s*/, "").replace(/\s*Takeaway:.*$/, "")}</p>
              {/Takeaway:/.test(f.text) && (
                <p className="mt-1 text-ink leading-snug">
                  <span className="text-[0.65rem] font-semibold uppercase tracking-wider text-ink-3">Takeaway </span>
                  {f.text.replace(/^.*Takeaway:\s*/, "")}
                </p>
              )}
            </button>
            <button onClick={() => onAsk(f)} className="mt-2 text-xs font-medium text-accent-ink hover:underline">
              Ask Copilot about this →
            </button>
          </div>
        ))}
        {items && items.length > 0 && (
          <p className="text-[0.7rem] text-ink-3 leading-snug">
            Descriptions are read by a vision model, so check numbers against the page. “✓ caption” means the label and
            page were confirmed against the caption printed in the PDF. Tap a card to jump to it.
          </p>
        )}
      </div>
    </aside>
  );
}
