"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Group, Panel, Separator, usePanelRef } from "react-resizable-panels";
import { track } from "@/components/analytics";
import { CopilotPanel, type PendingSelection } from "@/components/workspace/copilot-panel";
import { Library } from "@/components/workspace/library";
import { ConnectionMap } from "@/components/workspace/map";
import { Matrix } from "@/components/workspace/matrix";
import { Notes } from "@/components/workspace/notes";
import type { PdfSelection, SelAction } from "@/components/workspace/pdf-view";
import { Reader, type ReaderView } from "@/components/workspace/reader";
import { fetchPaper, type Paper } from "@/lib/api";
import { deleteDoc, docId, figurePages, getDoc, keepStorage, putDoc, readPdf, renderPages } from "@/lib/docstore";
import { sendCopilot, stopCopilot } from "@/lib/copilot-run";
import { isAnswering, setLive, setWS, useLive, useWorkspace, whenRestored } from "@/lib/store";
import {
  extractRow,
  prepareFulltext,
  readFigures,
  type FigureItem,
  type Highlight,
  type Mode,
  type OpenPaper,
  type Selection,
} from "@/lib/workspace";

const MAX_OPEN = 5;
const MAX_UPLOAD = 40 * 1024 * 1024;
type Pane = "library" | "paper" | "copilot";

const patchPaper = (id: string, patch: Partial<OpenPaper>) =>
  setWS((cur) => ({ ...cur, papers: cur.papers.map((p) => (p.id === id ? { ...p, ...patch } : p)) }));

async function indexPaper(id: string) {
  patchPaper(id, { fulltext: "loading" });
  try {
    const r = await prepareFulltext(id);
    patchPaper(id, { fulltext: r.status, pages: r.pages });
  } catch {
    patchPaper(id, { fulltext: "failed" });
  }
}

const setS = setWS;
type StatusMap = Record<string, string>;
const setMatrixStatus = (fn: (m: StatusMap) => StatusMap) => setLive((l) => ({ ...l, matrixStatus: fn(l.matrixStatus) }));
const setFigStatus = (fn: (m: StatusMap) => StatusMap) => setLive((l) => ({ ...l, figStatus: fn(l.figStatus) }));

// Papers still being prepared when the tab was closed: pick them up again.
whenRestored((s) =>
  s.papers.filter((p) => !p.local && !p.id.startsWith("U") && (p.fulltext === "loading" || !p.fulltext)).forEach((p) => indexPaper(p.id)),
);

export function WorkspaceClient() {
  const s = useWorkspace();
  const { matrixStatus, figStatus } = useLive();
  const busy = isAnswering(s);
  const [pane, setPane] = useState<Pane>("library");
  const [readerView, setReaderView] = useState<ReaderView>("paper");
  const [jump, setJump] = useState<{ id: string; page: number; text?: string; nonce: number } | null>(null);
  const [pending, setPending] = useState<PendingSelection | null>(null);
  const [focusNonce, setFocusNonce] = useState(0);
  const [notice, setNotice] = useState<{ text: string; tone: "info" | "bad" } | null>(null);
  const wide = useWide();
  const libPanel = usePanelRef();
  const copPanel = usePanelRef();
  const [libClosed, setLibClosed] = useState(false);
  const [copClosed, setCopClosed] = useState(false);
  const sRef = useRef(s);
  sRef.current = s;

  // Links from other pages: /workspace?q=topic searches the library, ?open=W1,W2 opens papers.
  const [initialQuery, setInitialQuery] = useState<string | null>(null);
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const q = params.get("q");
    const open = (params.get("open") || "").split(",").filter((x) => /^W\d+$/.test(x)).slice(0, 5);
    if (!q && !open.length) return;
    window.history.replaceState(null, "", "/workspace");
    if (q) {
      setPane("library");
      setInitialQuery(q.slice(0, 200));
    }
    open.forEach((id) => openById(id));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!notice) return;
    const t = setTimeout(() => setNotice(null), notice.tone === "bad" ? 7000 : 5000);
    return () => clearTimeout(t);
  }, [notice]);

  const openPaper = useCallback((p: Paper | OpenPaper) => {
    const isNew = !sRef.current.papers.some((x) => x.id === p.id);
    setS((cur) => {
      const exists = cur.papers.some((x) => x.id === p.id);
      const fresh: OpenPaper = { ...pick(p), fulltext: "local" in p && p.local ? undefined : "loading" };
      const papers = exists ? cur.papers : [...cur.papers, fresh].slice(-MAX_OPEN);
      const recent = [{ id: p.id, title: p.title, at: Date.now() }, ...cur.recent.filter((r) => r.id !== p.id)].slice(0, 30);
      return { ...cur, papers, activeId: p.id, recent };
    });
    setReaderView("paper");
    setPane("paper");
    if (isNew && !p.id.startsWith("U") && !("local" in p && p.local)) {
      track("paper_opened", { id: p.id });
      indexPaper(p.id);
    }
     
  }, []);

  const openById = useCallback(
    async (id: string) => {
      setReaderView("paper");
      setPane("paper");
      if (sRef.current.papers.some((p) => p.id === id)) return setS((cur) => ({ ...cur, activeId: id }));
      if (id.startsWith("U")) {
        const d = await getDoc(id);
        if (d) openPaper(uploadPaper(id, d.title, d.pages));
        return;
      }
      try {
        openPaper(await fetchPaper(id));
      } catch {}
    },
    [openPaper],
  );

  const openPage = useCallback(
    (id: string, page: number, text?: string) => {
      setJump({ id, page, text, nonce: Date.now() });
      if (sRef.current.papers.some((p) => p.id === id)) {
        setS((cur) => ({ ...cur, activeId: id }));
        setReaderView("paper");
        setPane("paper");
      } else openById(id);
    },
    [openById],
  );

  const closePaper = (id: string) =>
    setS((cur) => {
      const papers = cur.papers.filter((p) => p.id !== id);
      if (id.startsWith("U") && !cur.highlights.some((h) => h.paper_id === id)) deleteDoc(id);
      return { ...cur, papers, activeId: cur.activeId === id ? (papers.at(-1)?.id ?? null) : cur.activeId };
    });

  async function upload(file: File, attachTo?: OpenPaper) {
    if (file.type && file.type !== "application/pdf") return setNotice({ text: "That isn't a PDF.", tone: "bad" });
    if (file.size > MAX_UPLOAD) return setNotice({ text: "PDFs up to 40 MB, please.", tone: "bad" });
    setNotice({ text: `Reading ${file.name}…`, tone: "info" });
    try {
      const data = await file.arrayBuffer();
      const id = attachTo?.id ?? (await docId(data));
      const parsed = await readPdf(data, file.name);
      if (!parsed.passages.length) throw new Error("No selectable text in this PDF (is it a scan?).");
      const title = attachTo?.title ?? parsed.title;
      await putDoc({ id, title, data, passages: parsed.passages, pages: parsed.pages, at: Date.now() });
      const kept = await keepStorage();
      if (attachTo) {
        patchPaper(id, { local: true, pages: parsed.pages, localAt: Date.now() });
        setS((cur) => ({ ...cur, activeId: id }));
      } else openPaper(uploadPaper(id, title, parsed.pages));
      track("pdf_uploaded", { pages: parsed.pages, attached: !!attachTo });
      setNotice({
        text: `Your PDF stays in this browser${kept ? " (protected from automatic clean-up)" : ""}. Copilot only sends the passages it needs to Google Gemini. Use “Back up” in the Library to keep a copy.`,
        tone: "info",
      });
    } catch (e) {
      setNotice({ text: e instanceof Error ? e.message : "Could not read that PDF.", tone: "bad" });
    }
  }

  function send(text: string, mode: Mode, selection?: Selection | null) {
    const sel =
      selection ??
      (pending ? { paper_id: pending.paper_id, page: pending.page, text: pending.text, ...(pending.image ? { image: pending.image } : {}) } : null);
    setPending(null);
    setPane("copilot");
    sendCopilot(text, mode, sel);
  }

  function onAction(p: OpenPaper, a: SelAction, sel: PdfSelection, color?: Highlight["color"]) {
    const selection = { paper_id: p.id, page: sel.page, text: sel.text, ...(sel.image ? { image: sel.image } : {}) };
    track("selection_action", { action: a, figure: !!sel.image });
    if (a === "highlight") {
      const text = sel.image ? `[Figure] ${sel.text}`.trim() : sel.text;
      const h: Highlight = { id: crypto.randomUUID(), paper_id: p.id, title: p.title, page: sel.page, text, rects: sel.rects, color: color || "yellow", at: Date.now() };
      return setS((c) => ({ ...c, highlights: [...c.highlights, h] }));
    }
    if (a === "court" || a === "telephone") {
      if (!/^W\d+$/.test(p.id))
        return setNotice({ text: "Claim Court and Citation Telephone work on catalogue papers, not uploaded PDFs.", tone: "info" });
      const url = `/verify?tool=${a}&paper=${p.id}&claim=${encodeURIComponent(sel.text.replace(/\s+/g, " ").trim().slice(0, 500))}`;
      window.open(url, "_blank", "noopener");
      return;
    }
    if (a === "ask") {
      setPending({ ...selection, title: p.title });
      setPane("copilot");
      return setFocusNonce((n) => n + 1);
    }
    if (busy) return setNotice({ text: "Copilot is still answering. Try again in a moment.", tone: "info" });
    const what = sel.image ? "figure" : "passage";
    if (a === "explain")
      send(
        sel.image
          ? "Explain this figure: what it shows, how to read it, and what it means for the paper's argument."
          : "Explain this passage in plain language, with the context from the paper.",
        "explain",
        selection,
      );
    if (a === "verify") send("Is this claim supported or contradicted by other work?", "verify", selection);
    if (a === "related") send(`Find related work on what this ${what} describes.`, "related", selection);
  }

  async function fillMatrix(ids: string[]) {
    track("matrix_filled", { rows: ids.length });
    const queue = [...ids];
    const work = async () => {
      for (let id = queue.shift(); id; id = queue.shift()) {
        const p = sRef.current.papers.find((x) => x.id === id);
        if (!p) continue;
        setMatrixStatus((m) => ({ ...m, [id!]: "loading" }));
        try {
          const passages = p.local ? (await getDoc(p.id))?.passages.slice(0, 600) : undefined;
          const row = await extractRow(p.id, p.title, passages);
          setS((c) => ({ ...c, matrix: { ...c.matrix, [row.paper_id]: row } }));
          setMatrixStatus((m) => Object.fromEntries(Object.entries(m).filter(([k]) => k !== id)));
        } catch (e) {
          setMatrixStatus((m) => ({ ...m, [id!]: e instanceof Error ? e.message : "Failed." }));
        }
      }
    };
    await Promise.all([work(), work()]); // two rows at a time
  }

  async function readFiguresOf(p: OpenPaper) {
    setFigStatus((m) => ({ ...m, [p.id]: "loading" }));
    track("figures_read", { local: !!p.local });
    try {
      let images: { page: number; data: string }[] | undefined;
      if (p.local) {
        const d = await getDoc(p.id);
        if (!d) throw new Error("This PDF is no longer stored in this browser.");
        const pages = figurePages(d.passages, 6);
        images = await renderPages(d.data, pages.length ? pages : [1, 2, 3].filter((n) => n <= d.pages));
      }
      const items = await readFigures(p.id, p.title, images);
      setS((c) => ({ ...c, figures: { ...c.figures, [p.id]: items } }));
      setFigStatus((m) => Object.fromEntries(Object.entries(m).filter(([k]) => k !== p.id)));
    } catch (e) {
      setFigStatus((m) => ({ ...m, [p.id]: e instanceof Error ? e.message : "Could not read the figures." }));
    }
  }

  function askFigure(p: OpenPaper, f: FigureItem) {
    setPending({ paper_id: p.id, page: f.page, text: `${f.label} (${f.figure_kind}, read by a vision model): ${f.text}`, title: p.title });
    setPane("copilot");
    setFocusNonce((n) => n + 1);
  }

  const h = { openPage, openPaper: openById };
  const notes = (
    <Notes
      highlights={s.highlights}
      papers={s.papers}
      onOpen={(x) => openPage(x.paper_id, x.page)}
      onAsk={(x) => {
        setPending({ paper_id: x.paper_id, page: x.page, text: x.text, title: x.title });
        setPane("copilot");
        setFocusNonce((n) => n + 1);
      }}
      onDelete={(id) => setS((c) => ({ ...c, highlights: c.highlights.filter((x) => x.id !== id) }))}
      onNote={(id, note) => setS((c) => ({ ...c, highlights: c.highlights.map((x) => (x.id === id ? { ...x, note } : x)) }))}
    />
  );
  const library = (
    <Library
      state={s}
      onOpen={openPaper}
      onActivate={openById}
      onUpload={(f) => upload(f)}
      notes={notes}
      onKeep={(p) => setS((c) => (c.queue.some((x) => x.id === p.id) ? c : { ...c, queue: [pick(p), ...c.queue].slice(0, 100) }))}
      onUnqueue={(id) => setS((c) => ({ ...c, queue: c.queue.filter((x) => x.id !== id) }))}
      notify={(text, tone) => setNotice({ text, tone })}
      initialQuery={initialQuery}
      onScreened={(kept, total, seconds) => {
        track("screened", { kept, total, seconds });
        if (kept) setNotice({ text: `${kept} of ${total} papers added to your reading list.`, tone: "info" });
      }}
    />
  );
  const reader = (
    <Reader
      papers={s.papers}
      activeId={s.activeId}
      highlights={s.highlights}
      jump={jump}
      view={readerView}
      setView={setReaderView}
      matrix={<Matrix papers={s.papers} rows={s.matrix} status={matrixStatus} onFill={fillMatrix} openPage={openPage} />}
      map={<ConnectionMap papers={s.papers} messages={s.messages} onOpen={openById} />}
      figures={{ items: s.figures, status: figStatus, onRead: readFiguresOf, onAsk: askFigure, onOpenPage: openPage }}
      onActivate={(id) => setS((c) => ({ ...c, activeId: id }))}
      onClose={closePaper}
      onAction={onAction}
      onAttach={upload}
    />
  );
  const copilot = (
    <CopilotPanel
      messages={s.messages}
      papers={s.papers}
      busy={busy}
      pending={pending}
      focusNonce={focusNonce}
      onClearPending={() => setPending(null)}
      onSend={(t, m) => send(t, m)}
      onStop={stopCopilot}
      onClear={() => setS((c) => ({ ...c, messages: [] }))}
      h={h}
    />
  );

  return (
    <div className="h-[calc(100dvh-3.5rem)] flex flex-col workspace-bg">
      {notice && (
        <div
          role="status"
          className={`fixed z-50 left-1/2 -translate-x-1/2 bottom-20 md:bottom-6 max-w-md w-[calc(100%-2rem)] rounded-xl border px-4 py-2.5 text-sm shadow-lg ${
            notice.tone === "bad" ? "bg-bad-soft text-bad border-bad/30" : "bg-surface text-ink-2 border-line"
          }`}
        >
          {notice.text}
        </div>
      )}

      {wide === false && (
        <>
      {/* Phones: one pane at a time, switched from a bottom bar within thumb reach */}
      <div className="flex-1 min-h-0 bg-surface">{pane === "library" ? library : pane === "paper" ? reader : copilot}</div>
      <nav className="grid grid-cols-3 border-t border-line bg-surface pb-[env(safe-area-inset-bottom)]" aria-label="Workspace panes">
        {(
          [
            ["library", "Library", "M4 5h4v14H4zM10 5h4v14h-4zM16 6l3.5 1-3 12-3.5-1z"],
            ["paper", "Reader", "M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8zM14 3v5h5M9 13h6M9 17h4"],
            ["copilot", "Copilot", "M12 3l1.9 4.6L18.5 9l-4.6 1.9L12 15.5l-1.9-4.6L5.5 9l4.6-1.4zM18 15l.9 2.1L21 18l-2.1.9L18 21l-.9-2.1L15 18l2.1-.9z"],
          ] as const
        ).map(([id, label, d]) => (
          <button
            key={id}
            onClick={() => setPane(id)}
            aria-current={pane === id ? "page" : undefined}
            className={`relative flex flex-col items-center gap-0.5 py-2 text-[0.68rem] ${pane === id ? "text-accent-ink font-medium" : "text-ink-3"}`}
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" strokeLinecap="round" aria-hidden="true">
              <path d={d} />
            </svg>
            {label}
            {id === "copilot" && busy && <span className="absolute top-1.5 right-[30%] w-2 h-2 rounded-full bg-accent animate-pulse" />}
            {id === "paper" && s.papers.length > 0 && (
              <span className="absolute top-1 right-[28%] min-w-4 h-4 px-1 rounded-full bg-accent text-white text-[0.6rem] leading-4">{s.papers.length}</span>
            )}
          </button>
        ))}
      </nav>
        </>
      )}

      {/* Desktop: three resizable panels. Only one layout is mounted, so each PDF loads once. */}
      {wide && (
      <div className="flex-1 min-h-0 p-2">
        <Group orientation="horizontal" className="h-full">
          <Panel
            panelRef={libPanel}
            defaultSize="22"
            minSize="15"
            collapsible
            collapsedSize="44px"
            onResize={(size) => setLibClosed(size.inPixels < 80)}
            className="rounded-2xl border border-line bg-surface overflow-hidden shadow-sm"
          >
            {libClosed ? (
              <Rail label="Library" side="left" onOpen={() => libPanel.current?.expand()} badge={s.queue.length || undefined} />
            ) : (
              <div className="h-full relative">
                {library}
                <CollapseBtn side="left" onClick={() => libPanel.current?.collapse()} />
              </div>
            )}
          </Panel>
          <Separator className="w-2 group flex items-center justify-center">
            <span className="h-10 w-1 rounded-full bg-line group-hover:bg-accent transition-colors" />
          </Separator>
          <Panel defaultSize="48" minSize="28" className="rounded-2xl border border-line bg-surface overflow-hidden shadow-sm">
            {reader}
          </Panel>
          <Separator className="w-2 group flex items-center justify-center">
            <span className="h-10 w-1 rounded-full bg-line group-hover:bg-accent transition-colors" />
          </Separator>
          <Panel
            panelRef={copPanel}
            defaultSize="30"
            minSize="22"
            collapsible
            collapsedSize="44px"
            onResize={(size) => setCopClosed(size.inPixels < 80)}
            className="rounded-2xl border border-line bg-surface overflow-hidden shadow-sm"
          >
            {copClosed ? (
              <Rail label="Copilot" side="right" onOpen={() => copPanel.current?.expand()} busy={busy} />
            ) : (
              <div className="h-full relative">
                {copilot}
                <CollapseBtn side="right" onClick={() => copPanel.current?.collapse()} />
              </div>
            )}
          </Panel>
        </Group>
      </div>
      )}
    </div>
  );
}

/** A collapsed side panel: a slim rail that reopens it. */
function Rail({ label, side, onOpen, badge, busy }: { label: string; side: "left" | "right"; onOpen: () => void; badge?: number; busy?: boolean }) {
  return (
    <button
      onClick={onOpen}
      aria-label={`Show ${label}`}
      title={`Show ${label}`}
      className="h-full w-full flex flex-col items-center gap-3 pt-3 text-ink-3 hover:text-ink hover:bg-surface-2 transition-colors"
    >
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
        <path d={side === "left" ? "m9 6 6 6-6 6" : "m15 6-6 6 6 6"} />
      </svg>
      <span className="text-xs font-medium tracking-wide [writing-mode:vertical-rl] rotate-180">{label}</span>
      {badge ? <span className="min-w-5 h-5 px-1 rounded-full bg-accent text-white text-[0.65rem] leading-5">{badge}</span> : null}
      {busy && <span className="w-2 h-2 rounded-full bg-accent animate-pulse" />}
    </button>
  );
}

function CollapseBtn({ side, onClick }: { side: "left" | "right"; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      aria-label={side === "left" ? "Collapse library" : "Collapse Copilot"}
      title={side === "left" ? "Collapse library" : "Collapse Copilot"}
      className={`absolute top-1/2 -translate-y-1/2 ${side === "left" ? "right-0 rounded-l-lg border-r-0" : "left-0 rounded-r-lg border-l-0"} z-10 w-4 h-12 grid place-items-center border border-line bg-surface text-ink-3 opacity-60 hover:opacity-100 hover:text-ink hover:w-5 transition-all`}
    >
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" aria-hidden="true">
        <path d={side === "left" ? "m15 6-6 6 6 6" : "m9 6 6 6-6 6"} />
      </svg>
    </button>
  );
}

/** true on tablets and desktops, false on phones, null before the first client render. */
function useWide() {
  const [wide, setWide] = useState<boolean | null>(null);
  useEffect(() => {
    const mq = window.matchMedia("(min-width: 768px)");
    const on = () => setWide(mq.matches);
    on();
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);
  return wide;
}

function uploadPaper(id: string, title: string, pages: number): OpenPaper {
  return {
    id,
    title,
    year: null,
    venue: null,
    authors: [],
    doi: null,
    abstract: null,
    cited_by_count: 0,
    is_retracted: false,
    is_preprint: false,
    is_oa: false,
    oa_url: null,
    local: true,
    pages,
  };
}

function pick(p: Paper | OpenPaper): OpenPaper {
  return {
    id: p.id,
    title: p.title,
    year: p.year,
    venue: p.venue,
    authors: p.authors || [],
    doi: p.doi,
    abstract: p.abstract,
    cited_by_count: p.cited_by_count,
    is_retracted: p.is_retracted,
    is_preprint: p.is_preprint,
    is_oa: p.is_oa,
    oa_url: p.oa_url,
    ...("local" in p && p.local ? { local: true, pages: p.pages } : {}),
  };
}
