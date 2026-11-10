"use client";

import "react-pdf/dist/Page/TextLayer.css";
import "react-pdf/dist/Page/AnnotationLayer.css";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Document, Page } from "react-pdf";
import "@/lib/pdfjs";
import type { Highlight, Rect } from "@/lib/workspace";

export type SelAction = "ask" | "explain" | "verify" | "related" | "highlight";
export type PdfSelection = { page: number; text: string; rects: Rect[] };
export type Jump = { page: number; text?: string; nonce: number } | null;

const COLORS: Record<Highlight["color"], string> = {
  yellow: "rgba(250, 204, 21, 0.38)",
  blue: "rgba(56, 132, 255, 0.28)",
  green: "rgba(34, 197, 94, 0.30)",
  pink: "rgba(236, 72, 153, 0.28)",
};

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

export default function PdfView({
  file,
  highlights,
  jump,
  onAction,
  onPages,
  sourceUrl,
}: {
  file: string | ArrayBuffer;
  highlights: Highlight[];
  jump: Jump;
  onAction: (a: SelAction, s: PdfSelection, color?: Highlight["color"]) => void;
  onPages?: (n: number) => void;
  sourceUrl?: string | null;
}) {
  const scroller = useRef<HTMLDivElement>(null);
  const slots = useRef<(HTMLDivElement | null)[]>([]);
  const [numPages, setNumPages] = useState(0);
  const [ratio, setRatio] = useState(1.294); // A4 until the first page tells us
  const [width, setWidth] = useState(600);
  const [zoom, setZoom] = useState(1);
  const [visible, setVisible] = useState<Set<number>>(new Set([1, 2]));
  const [current, setCurrent] = useState(1);
  const [error, setError] = useState(false);
  const [sel, setSel] = useState<(PdfSelection & { x: number; y: number }) | null>(null);

  // pdf.js detaches ArrayBuffers it is given, so hand it a copy; keep the object stable per file.
  const source = useMemo(() => (typeof file === "string" ? file : { data: new Uint8Array(file.slice(0)) }), [file]);
  // Plain GETs only: range requests would need extra CORS headers on the API.
  const options = useMemo(() => ({ disableRange: true, disableStream: true }), []);

  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setWidth(Math.max(240, e.contentRect.width - 32)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const pageW = Math.round(Math.min(width, 1100) * zoom);
  const pageH = Math.round(pageW * ratio);

  // Render only pages near the viewport.
  useEffect(() => {
    if (!numPages || !scroller.current) return;
    const io = new IntersectionObserver(
      (entries) =>
        setVisible((cur) => {
          const next = new Set(cur);
          for (const e of entries) {
            const n = Number((e.target as HTMLElement).dataset.page);
            if (e.isIntersecting) next.add(n);
            else next.delete(n);
          }
          return next;
        }),
      { root: scroller.current, rootMargin: "1200px 0px" },
    );
    slots.current.slice(0, numPages).forEach((el) => el && io.observe(el));
    return () => io.disconnect();
  }, [numPages, pageH]);

  const onScroll = useCallback(() => {
    const el = scroller.current;
    if (!el) return;
    setSel(null);
    const mark = el.scrollTop + el.clientHeight / 3;
    let n = 1;
    for (let i = 0; i < numPages; i++) {
      const s = slots.current[i];
      if (s && s.offsetTop <= mark) n = i + 1;
    }
    setCurrent(n);
  }, [numPages]);

  const goTo = useCallback((n: number) => {
    const s = slots.current[n - 1];
    if (s && scroller.current) scroller.current.scrollTo({ top: s.offsetTop - 8, behavior: "smooth" });
  }, []);

  // Citation clicked elsewhere: scroll to the page, then to the highlighted passage once its text renders.
  const pendingFlash = useRef<number | null>(null);
  useEffect(() => {
    if (!jump || !numPages) return;
    pendingFlash.current = jump.text ? jump.page : null;
    const t = setTimeout(() => goTo(Math.min(jump.page, numPages)), 50);
    return () => clearTimeout(t);
  }, [jump, numPages, goTo]);

  const flashText = jump?.text ? norm(jump.text) : "";
  const renderText = useCallback(
    ({ str, pageNumber }: { str: string; pageNumber: number }) => {
      if (flashText && jump && pageNumber === jump.page) {
        const n = norm(str);
        if (n.length >= 8 && flashText.includes(n)) return `<mark class="sl-flash">${esc(str)}</mark>`;
      }
      return esc(str);
    },
    [flashText, jump],
  );

  // Text selection → floating action bar.
  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    let t: ReturnType<typeof setTimeout>;
    const check = () => {
      clearTimeout(t);
      t = setTimeout(() => {
        const s = window.getSelection();
        const text = s?.toString().replace(/\s+/g, " ").trim() || "";
        if (!s || s.isCollapsed || text.length < 3 || !s.rangeCount) return setSel(null);
        const range = s.getRangeAt(0);
        const node = range.startContainer instanceof Element ? range.startContainer : range.startContainer.parentElement;
        const slot = node?.closest<HTMLElement>("[data-page]");
        if (!slot || !el.contains(slot)) return setSel(null);
        const box = slot.getBoundingClientRect();
        const rects = [...range.getClientRects()]
          .filter((r) => r.width > 1 && r.height > 1 && r.top >= box.top - 2 && r.bottom <= box.bottom + 2)
          .map((r) => ({ x: (r.left - box.left) / box.width, y: (r.top - box.top) / box.height, w: r.width / box.width, h: r.height / box.height }));
        const last = range.getBoundingClientRect();
        setSel({
          page: Number(slot.dataset.page),
          text: text.slice(0, 3500),
          rects,
          x: Math.min(Math.max(last.left + last.width / 2, 150), window.innerWidth - 150),
          y: Math.min(last.bottom + 10, window.innerHeight - 60),
        });
      }, 120);
    };
    document.addEventListener("selectionchange", check);
    return () => {
      document.removeEventListener("selectionchange", check);
      clearTimeout(t);
    };
  }, []);

  const act = (a: SelAction, color?: Highlight["color"]) => {
    if (!sel) return;
    onAction(a, { page: sel.page, text: sel.text, rects: sel.rects }, color);
    window.getSelection()?.removeAllRanges();
    setSel(null);
  };

  const byPage = useMemo(() => {
    const m = new Map<number, Highlight[]>();
    for (const h of highlights) m.set(h.page, [...(m.get(h.page) || []), h]);
    return m;
  }, [highlights]);

  if (error) {
    return (
      <div className="h-full grid place-items-center p-8 text-center text-sm text-ink-3">
        <div>
          <p>This PDF could not be displayed here.</p>
          {sourceUrl && (
            <a className="underline text-accent-ink" href={sourceUrl} target="_blank" rel="noreferrer">
              Open it in a new tab
            </a>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col min-h-0 relative">
      <div className="flex items-center gap-2 px-3 h-10 border-b border-line bg-surface text-xs text-ink-2 shrink-0">
        <span className="font-mono tabular-nums">
          {numPages ? `${current} / ${numPages}` : "…"}
        </span>
        <span className="flex-1" />
        <button aria-label="Zoom out" onClick={() => setZoom((z) => Math.max(0.5, +(z - 0.15).toFixed(2)))} className="tool-btn">
          −
        </button>
        <button onClick={() => setZoom(1)} className="tool-btn font-mono w-12" title="Fit width">
          {Math.round(zoom * 100)}%
        </button>
        <button aria-label="Zoom in" onClick={() => setZoom((z) => Math.min(2.5, +(z + 0.15).toFixed(2)))} className="tool-btn">
          +
        </button>
        {sourceUrl && (
          <a href={sourceUrl} target="_blank" rel="noreferrer" className="tool-btn hidden sm:inline-flex" title="Open the original">
            ↗
          </a>
        )}
      </div>

      <div ref={scroller} onScroll={onScroll} className="flex-1 min-h-0 overflow-auto bg-surface-2 pdf-scroller">
        <Document
          file={source}
          options={options}
          onLoadSuccess={async (pdf) => {
            setNumPages(pdf.numPages);
            onPages?.(pdf.numPages);
            try {
              const vp = (await pdf.getPage(1)).getViewport({ scale: 1 });
              setRatio(vp.height / vp.width);
            } catch {}
          }}
          onLoadError={() => setError(true)}
          loading={<p className="p-6 text-sm text-ink-3 animate-pulse">Loading PDF…</p>}
          className="py-4 flex flex-col items-center gap-4"
        >
          {Array.from({ length: numPages }, (_, i) => i + 1).map((n) => (
            <div
              key={n}
              ref={(el) => {
                slots.current[n - 1] = el;
              }}
              data-page={n}
              className="relative bg-white shadow-sm rounded-sm"
              style={{ width: pageW, height: pageH }}
            >
              {visible.has(n) && (
                <Page
                  pageNumber={n}
                  width={pageW}
                  renderAnnotationLayer
                  renderTextLayer
                  customTextRenderer={renderText}
                  onRenderTextLayerSuccess={() => {
                    if (pendingFlash.current !== n) return;
                    pendingFlash.current = null;
                    slots.current[n - 1]?.querySelector(".sl-flash")?.scrollIntoView({ block: "center", behavior: "smooth" });
                  }}
                  loading={<div style={{ width: pageW, height: pageH }} />}
                />
              )}
              {(byPage.get(n) || []).map((h) =>
                h.rects.map((r, i) => (
                  <div
                    key={`${h.id}-${i}`}
                    className="absolute pointer-events-none mix-blend-multiply rounded-[2px]"
                    style={{
                      left: `${r.x * 100}%`,
                      top: `${r.y * 100}%`,
                      width: `${r.w * 100}%`,
                      height: `${r.h * 100}%`,
                      background: COLORS[h.color],
                    }}
                  />
                )),
              )}
              <span className="absolute -left-0 -bottom-5 text-[0.65rem] text-ink-3 font-mono">{n}</span>
            </div>
          ))}
        </Document>
      </div>

      {sel && (
        <div
          role="toolbar"
          aria-label="Selection actions"
          className="fixed z-50 -translate-x-1/2 flex items-center gap-0.5 rounded-xl border border-line bg-surface p-1 shadow-lg text-xs"
          style={{ left: sel.x, top: sel.y }}
          onMouseDown={(e) => e.preventDefault()}
        >
          <SelBtn onClick={() => act("ask")} label="Ask" hint="Ask Copilot about this" />
          <SelBtn onClick={() => act("explain")} label="Explain" hint="Explain in plain language" />
          <SelBtn onClick={() => act("verify")} label="Verify" hint="Check this claim against the literature" />
          <SelBtn onClick={() => act("related")} label="Related" hint="Find related work" />
          <span className="w-px h-5 bg-line mx-0.5" />
          {(Object.keys(COLORS) as Highlight["color"][]).map((c) => (
            <button
              key={c}
              aria-label={`Highlight ${c}`}
              title={`Highlight (${c})`}
              onClick={() => act("highlight", c)}
              className="w-5 h-5 rounded-full border border-line mx-0.5 hover:scale-110 transition-transform"
              style={{ background: COLORS[c].replace(/0\.\d+\)$/, "0.9)") }}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function SelBtn({ onClick, label, hint }: { onClick: () => void; label: string; hint: string }) {
  return (
    <button onClick={onClick} title={hint} className="rounded-lg px-2 py-1 font-medium text-ink-2 hover:bg-accent hover:text-white">
      {label}
    </button>
  );
}
