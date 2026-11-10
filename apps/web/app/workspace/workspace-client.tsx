"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Group, Panel, Separator } from "react-resizable-panels";
import { track } from "@/components/analytics";
import { CopilotPanel, type PendingSelection } from "@/components/workspace/copilot-panel";
import { Library } from "@/components/workspace/library";
import { ConnectionMap } from "@/components/workspace/map";
import { Matrix } from "@/components/workspace/matrix";
import { Notes } from "@/components/workspace/notes";
import type { PdfSelection, SelAction } from "@/components/workspace/pdf-view";
import { Reader, type ReaderView } from "@/components/workspace/reader";
import { fetchPaper, type Paper } from "@/lib/api";
import { deleteDoc, docId, figurePages, getDoc, putDoc, readPdf, renderPages } from "@/lib/docstore";
import {
  askCopilot,
  EMPTY,
  extractRow,
  loadState,
  prepareFulltext,
  readFigures,
  saveState,
  type FigureItem,
  type Highlight,
  type Message,
  type Mode,
  type OpenPaper,
  type Selection,
  type WorkspaceState,
} from "@/lib/workspace";

const MAX_OPEN = 5;
const MAX_UPLOAD = 40 * 1024 * 1024;
type Pane = "library" | "paper" | "copilot";
type Assistant = Extract<Message, { role: "assistant" }>;

export function WorkspaceClient() {
  const [s, setS] = useState<WorkspaceState>(EMPTY);
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [pane, setPane] = useState<Pane>("library");
  const [readerView, setReaderView] = useState<ReaderView>("paper");
  const [figStatus, setFigStatus] = useState<Record<string, string>>({});
  const [jump, setJump] = useState<{ id: string; page: number; text?: string; nonce: number } | null>(null);
  const [pending, setPending] = useState<PendingSelection | null>(null);
  const [focusNonce, setFocusNonce] = useState(0);
  const [matrixStatus, setMatrixStatus] = useState<Record<string, string>>({});
  const [notice, setNotice] = useState<{ text: string; tone: "info" | "bad" } | null>(null);
  const wide = useWide();
  const abort = useRef<AbortController | null>(null);
  const sRef = useRef(s);
  sRef.current = s;

  // Restore the session after mount (localStorage is browser-only).
  useEffect(() => {
    const restored = loadState();
    setS(restored);
    setReady(true);
    restored.papers.filter((p) => !p.local && !p.id.startsWith("U") && (p.fulltext === "loading" || !p.fulltext)).forEach((p) => indexPaper(p.id));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    if (ready) saveState(s);
  }, [s, ready]);
  useEffect(() => {
    if (!notice) return;
    const t = setTimeout(() => setNotice(null), notice.tone === "bad" ? 7000 : 5000);
    return () => clearTimeout(t);
  }, [notice]);

  const patchPaper = (id: string, patch: Partial<OpenPaper>) =>
    setS((cur) => ({ ...cur, papers: cur.papers.map((p) => (p.id === id ? { ...p, ...patch } : p)) }));

  async function indexPaper(id: string) {
    patchPaper(id, { fulltext: "loading" });
    try {
      const r = await prepareFulltext(id);
      patchPaper(id, { fulltext: r.status, pages: r.pages });
    } catch {
      patchPaper(id, { fulltext: "failed" });
    }
  }

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
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
      if (attachTo) {
        patchPaper(id, { local: true, pages: parsed.pages });
        setS((cur) => ({ ...cur, activeId: id }));
      } else openPaper(uploadPaper(id, title, parsed.pages));
      track("pdf_uploaded", { pages: parsed.pages, attached: !!attachTo });
      setNotice({
        text: "Your PDF stays in this browser. When you ask Copilot, only the passages it needs are sent (to Google Gemini) to answer.",
        tone: "info",
      });
    } catch (e) {
      setNotice({ text: e instanceof Error ? e.message : "Could not read that PDF.", tone: "bad" });
    }
  }

  async function documents(papers: OpenPaper[]) {
    const out = [];
    for (const p of papers.filter((x) => x.local)) {
      const d = await getDoc(p.id);
      if (d) out.push({ id: p.id, title: d.title, passages: d.passages.slice(0, 600) });
    }
    return out;
  }

  async function send(text: string, mode: Mode, selection?: Selection | null) {
    const sel =
      selection ??
      (pending ? { paper_id: pending.paper_id, page: pending.page, text: pending.text, ...(pending.image ? { image: pending.image } : {}) } : null);
    setPending(null);
    const ctrl = new AbortController();
    abort.current = ctrl;
    setBusy(true);
    setPane("copilot");
    track("copilot_sent", { mode, open: s.papers.length, selection: !!sel });
    const cur = sRef.current;
    const history = cur.messages.slice(-6).map((m) => ({ role: m.role, text: m.text.slice(0, 1500) }));
    const open = cur.papers.map((p) => ({ id: p.id, title: p.title }));
    const assistant: Assistant = { role: "assistant", text: "", mode, jobs: [], evidence: [], done: false, at: Date.now() };
    setS((c) => ({
      ...c,
      messages: [...c.messages, { role: "user", text, mode, at: Date.now(), ...(sel ? { selection: sel } : {}) }, assistant],
    }));

    const update = (fn: (m: Assistant) => Assistant) =>
      setS((c) => {
        const msgs = [...c.messages];
        const last = msgs[msgs.length - 1];
        if (last?.role === "assistant") msgs[msgs.length - 1] = fn(last);
        return { ...c, messages: msgs };
      });

    try {
      await askCopilot(
        { message: text, mode, open_papers: open, history, documents: await documents(cur.papers), selection: sel },
        {
          onDispatch: (jobs) => update((m) => ({ ...m, jobs: jobs.map((j) => ({ ...j, status: "running" as const })) })),
          onJob: (job, status, note) =>
            update((m) => {
              let marked = false;
              const jobs = m.jobs.map((j) => {
                if (!marked && j.status === "running" && j.kind === job.kind && j.query === job.query && j.target === job.target) {
                  marked = true;
                  return { ...j, status, note };
                }
                return j;
              });
              return { ...m, jobs };
            }),
          onEvidence: (evidence) => update((m) => ({ ...m, evidence })),
          onToken: (t) => update((m) => ({ ...m, text: m.text + t })),
          onVerified: (v) => update((m) => ({ ...m, verification: v, done: true, ...(mode === "brainstorm" ? { novelty: "pending" as const } : {}) })),
          onNovelty: (n) => update((m) => ({ ...m, novelty: n })),
        },
        ctrl.signal,
      );
    } catch (e) {
      const msg = ctrl.signal.aborted ? "Stopped." : e instanceof Error ? e.message : "Copilot failed.";
      update((m) => ({ ...m, done: true, error: m.verification ? undefined : msg, novelty: m.novelty === "pending" ? [] : m.novelty }));
    } finally {
      setBusy(false);
    }
  }

  function onAction(p: OpenPaper, a: SelAction, sel: PdfSelection, color?: Highlight["color"]) {
    const selection = { paper_id: p.id, page: sel.page, text: sel.text, ...(sel.image ? { image: sel.image } : {}) };
    track("selection_action", { action: a, figure: !!sel.image });
    if (a === "highlight") {
      const text = sel.image ? `[Figure] ${sel.text}`.trim() : sel.text;
      const h: Highlight = { id: crypto.randomUUID(), paper_id: p.id, title: p.title, page: sel.page, text, rects: sel.rects, color: color || "yellow", at: Date.now() };
      return setS((c) => ({ ...c, highlights: [...c.highlights, h] }));
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
  const library = <Library state={s} onOpen={openPaper} onActivate={openById} onUpload={(f) => upload(f)} notes={notes} />;
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
      onStop={() => abort.current?.abort()}
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
          <Panel defaultSize="22" minSize="15" className="rounded-2xl border border-line bg-surface overflow-hidden shadow-sm">
            {library}
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
          <Panel defaultSize="30" minSize="22" className="rounded-2xl border border-line bg-surface overflow-hidden shadow-sm">
            {copilot}
          </Panel>
        </Group>
      </div>
      )}
    </div>
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
