"use client";

import "react-pdf/dist/Page/TextLayer.css";
import "react-pdf/dist/Page/AnnotationLayer.css";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Document, Page } from "react-pdf";
import { cropCanvas } from "@/lib/docstore";
import "@/lib/pdfjs";
import type { Highlight, Rect } from "@/lib/workspace";

export type SelAction = "ask" | "explain" | "verify" | "related" | "highlight" | "court" | "telephone";
/** `image` (base64 JPEG) is set when the user cut out a figure instead of selecting text. */
export type PdfSelection = { page: number; text: string; rects: Rect[]; image?: string };
export type Jump = { page: number; text?: string; nonce: number } | null;

const COLORS: Record<Highlight["color"], string> = {
  yellow: "rgba(250, 204, 21, 0.38)",
  blue: "rgba(56, 132, 255, 0.28)",
  green: "rgba(34, 197, 94, 0.30)",
  pink: "rgba(236, 72, 153, 0.28)",
};

// Plain GETs only: range requests would need extra CORS headers on the API.
const OPTIONS = { disableRange: true, disableStream: true };

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

export default function PdfView({
  file,
  highlights,
  jump,
  onAction,
  onPages,
  sourceUrl,
  extra,
}: {
  file: string | { data: Uint8Array };
  highlights: Highlight[];
  jump: Jump;
  onAction: (a: SelAction, s: PdfSelection, color?: Highlight["color"]) => void;
  onPages?: (n: number) => void;
  sourceUrl?: string | null;
  /** Extra toolbar buttons (e.g. the figure guide). */
  extra?: React.ReactNode;
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
  const [snip, setSnip] = useState(false);
  const [drag, setDrag] = useState<{ page: number; x0: number; y0: number; x1: number; y1: number } | null>(null);
  const figureSel = useRef(false);
  useEffect(() => {
    figureSel.current = !!sel?.image;
  }, [sel]);

  useEffect(() => {
    if (!snip) return;
    const esc = (e: KeyboardEvent) => e.key === "Escape" && (setSnip(false), setDrag(null));
    window.addEventListener("keydown", esc);
    return () => window.removeEventListener("keydown", esc);
  }, [snip]);

  const frac = (e: React.PointerEvent, el: HTMLElement) => {
    const b = el.getBoundingClientRect();
    return { x: Math.min(1, Math.max(0, (e.clientX - b.left) / b.width)), y: Math.min(1, Math.max(0, (e.clientY - b.top) / b.height)) };
  };

  // Cut out a figure: crop the rendered page canvas, and collect the text that sits inside the box.
  const finishSnip = (n: number, el: HTMLElement) => {
    const d = drag;
    setDrag(null);
    if (!d) return;
    const r = { x: Math.min(d.x0, d.x1), y: Math.min(d.y0, d.y1), w: Math.abs(d.x1 - d.x0), h: Math.abs(d.y1 - d.y0) };
    if (r.w < 0.03 || r.h < 0.03) return;
    const canvas = el.querySelector<HTMLCanvasElement>("canvas.react-pdf__Page__canvas");
    if (!canvas) return;
    const box = el.getBoundingClientRect();
    const inside = [...el.querySelectorAll<HTMLElement>(".textLayer span")].filter((sp) => {
      const b = sp.getBoundingClientRect();
      const cx = (b.left + b.width / 2 - box.left) / box.width, cy = (b.top + b.height / 2 - box.top) / box.height;
      return cx >= r.x && cx <= r.x + r.w && cy >= r.y - 0.04 && cy <= r.y + r.h + 0.06; // captions sit just below
    });
    const text = inside.map((sp) => sp.textContent).join(" ").replace(/\s+/g, " ").trim().slice(0, 1500);
    let image: string;
    try {
      image = cropCanvas(canvas, r);
    } catch {
      return; // a tainted canvas cannot be read; nothing sensible to send
    }
    setSnip(false);
    setSel({
      page: n,
      text,
      rects: [r],
      image,
      x: Math.min(Math.max(box.left + (r.x + r.w / 2) * box.width, 150), window.innerWidth - 150),
      y: Math.min(box.top + (r.y + r.h) * box.height + 10, window.innerHeight - 60),
    });
  };


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

  // Position of a page inside the scroller, independent of which ancestor is the offsetParent.
  const topOf = (el: HTMLElement) => {
    const sc = scroller.current!;
    return el.getBoundingClientRect().top - sc.getBoundingClientRect().top + sc.scrollTop;
  };

  const onScroll = useCallback(() => {
    const el = scroller.current;
    if (!el) return;
    setSel(null);
    const mark = el.scrollTop + el.clientHeight / 3;
    let n = 1;
    for (let i = 0; i < numPages; i++) {
      const s = slots.current[i];
      if (s && topOf(s) <= mark) n = i + 1;
    }
    setCurrent(n);
  }, [numPages]);

  // Citation clicked elsewhere: scroll to the page, then to the highlighted passage once its text renders.
  const pendingFlash = useRef<number | null>(null);
  useEffect(() => {
    if (!jump || !numPages) return;
    pendingFlash.current = jump.text ? jump.page : null;
    const n = Math.min(jump.page, numPages);
    // Jump instantly, then re-check: a long smooth scroll can be cut short while pages render.
    const land = () => {
      const s = slots.current[n - 1];
      const sc = scroller.current;
      if (s && sc && Math.abs(sc.scrollTop - (topOf(s) - 8)) > 4) sc.scrollTo({ top: topOf(s) - 8 });
    };
    const timers = [50, 350, 900].map((ms) => setTimeout(land, ms));
    return () => timers.forEach(clearTimeout);
  }, [jump, numPages]);

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
        if (figureSel.current && (!s || s.isCollapsed)) return; // a cut-out figure is not a text selection
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
    onAction(a, { page: sel.page, text: sel.text, rects: sel.rects, ...(sel.image ? { image: sel.image } : {}) }, color);
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
        <button
          onClick={() => {
            setSnip((v) => !v);
            setSel(null);
          }}
          aria-pressed={snip}
          className={`tool-btn gap-1 px-2 ${snip ? "!bg-accent !text-white" : ""}`}
          title="Cut out a figure, table or diagram and ask about it"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
            <path d="M4 8V4h4M16 4h4v4M20 16v4h-4M8 20H4v-4" />
          </svg>
          <span className="hidden sm:inline">{snip ? "Drag over a figure" : "Figure"}</span>
        </button>
        {extra}
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
          file={file}
          options={OPTIONS}
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
              {snip && (
                <div
                  className="absolute inset-0 z-10 cursor-crosshair bg-accent/5 touch-none"
                  onPointerDown={(e) => {
                    const el = slots.current[n - 1]!;
                    (e.target as HTMLElement).setPointerCapture(e.pointerId);
                    const f = frac(e, el);
                    setDrag({ page: n, x0: f.x, y0: f.y, x1: f.x, y1: f.y });
                  }}
                  onPointerMove={(e) => {
                    if (!drag || drag.page !== n) return;
                    const f = frac(e, slots.current[n - 1]!);
                    setDrag({ ...drag, x1: f.x, y1: f.y });
                  }}
                  onPointerUp={() => finishSnip(n, slots.current[n - 1]!)}
                >
                  {drag?.page === n && (
                    <div
                      className="absolute border-2 border-accent bg-accent/10 rounded-sm"
                      style={{
                        left: `${Math.min(drag.x0, drag.x1) * 100}%`,
                        top: `${Math.min(drag.y0, drag.y1) * 100}%`,
                        width: `${Math.abs(drag.x1 - drag.x0) * 100}%`,
                        height: `${Math.abs(drag.y1 - drag.y0) * 100}%`,
                      }}
                    />
                  )}
                </div>
              )}
              {sel?.image && sel.page === n && (
                <div
                  className="absolute border-2 border-accent rounded-sm pointer-events-none"
                  style={{ left: `${sel.rects[0].x * 100}%`, top: `${sel.rects[0].y * 100}%`, width: `${sel.rects[0].w * 100}%`, height: `${sel.rects[0].h * 100}%` }}
                />
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
          <SelBtn onClick={() => act("explain")} label="Explain" hint={sel.image ? "Explain this figure" : "Explain in plain language"} />
          {!sel.image && <SelBtn onClick={() => act("verify")} label="Verify" hint="Check this claim against the literature" />}
          <SelBtn onClick={() => act("related")} label="Related" hint="Find related work" />
          {!sel.image && <SelBtn onClick={() => act("court")} label="⚖ Court" hint="Claim Court: which papers support or dispute this?" />}
          {!sel.image && /\d/.test(sel.text) && (
            <SelBtn onClick={() => act("telephone")} label="☎ Trace" hint="Citation Telephone: did this number change as others repeated it?" />
          )}
          {sel.image && <SelBtn onClick={() => setSel(null)} label="✕" hint="Cancel" />}
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
