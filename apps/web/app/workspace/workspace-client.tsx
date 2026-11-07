"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Group, Panel, Separator } from "react-resizable-panels";
import { track } from "@/components/analytics";
import { CopilotPanel } from "@/components/workspace/copilot-panel";
import { Library } from "@/components/workspace/library";
import { Reader } from "@/components/workspace/reader";
import { fetchPaper, type Paper } from "@/lib/api";
import {
  askCopilot,
  EMPTY,
  loadState,
  prepareFulltext,
  saveState,
  type Message,
  type Mode,
  type OpenPaper,
  type WorkspaceState,
} from "@/lib/workspace";

const MAX_OPEN = 5;
type Pane = "library" | "paper" | "copilot";

export function WorkspaceClient() {
  const [s, setS] = useState<WorkspaceState>(EMPTY);
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [pane, setPane] = useState<Pane>("library");
  const abort = useRef<AbortController | null>(null);
  const sRef = useRef(s);
  sRef.current = s;

  // Restore the session after mount (localStorage is browser-only).
  useEffect(() => {
    const restored = loadState();
    setS(restored);
    setReady(true);
    restored.papers.filter((p) => p.fulltext === "loading" || !p.fulltext).forEach((p) => indexPaper(p.id));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    if (ready) saveState(s);
  }, [s, ready]);

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
      const papers = exists
        ? cur.papers
        : [...cur.papers, { ...pick(p), fulltext: "loading" as const }].slice(-MAX_OPEN);
      const recent = [{ id: p.id, title: p.title, at: Date.now() }, ...cur.recent.filter((r) => r.id !== p.id)].slice(0, 30);
      return { ...cur, papers, activeId: p.id, recent };
    });
    setPane("paper");
    if (isNew) {
      track("paper_opened", { id: p.id });
      indexPaper(p.id);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const openById = useCallback(
    async (id: string) => {
      const open = s.papers.find((p) => p.id === id);
      if (open) return setS((cur) => ({ ...cur, activeId: id }));
      try {
        const p = await fetchPaper(id);
        openPaper(p);
      } catch {}
    },
    [s.papers, openPaper],
  );

  const openPage = useCallback(
    (id: string, page: number) => {
      setS((cur) => ({ ...cur, activeId: id, page: { ...cur.page, [id]: page } }));
      setPane("paper");
      if (!s.papers.some((p) => p.id === id)) openById(id);
    },
    [s.papers, openById],
  );

  const closePaper = (id: string) =>
    setS((cur) => {
      const papers = cur.papers.filter((p) => p.id !== id);
      return { ...cur, papers, activeId: cur.activeId === id ? (papers.at(-1)?.id ?? null) : cur.activeId };
    });

  async function send(text: string, mode: Mode) {
    const ctrl = new AbortController();
    abort.current = ctrl;
    setBusy(true);
    setPane("copilot");
    track("copilot_sent", { mode, open: s.papers.length });
    const history = s.messages.slice(-6).map((m) => ({ role: m.role, text: m.text.slice(0, 1500) }));
    const open = s.papers.map((p) => ({ id: p.id, title: p.title }));
    const assistant: Message = { role: "assistant", text: "", jobs: [], evidence: [], done: false, at: Date.now() };
    setS((cur) => ({ ...cur, messages: [...cur.messages, { role: "user", text, mode, at: Date.now() }, assistant] }));

    const update = (fn: (m: Extract<Message, { role: "assistant" }>) => Extract<Message, { role: "assistant" }>) =>
      setS((cur) => {
        const msgs = [...cur.messages];
        const last = msgs[msgs.length - 1];
        if (last?.role === "assistant") msgs[msgs.length - 1] = fn(last);
        return { ...cur, messages: msgs };
      });

    try {
      await askCopilot(
        { message: text, mode, open_papers: open, history },
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
          onVerified: (v) => update((m) => ({ ...m, verification: v, done: true })),
        },
        ctrl.signal,
      );
    } catch (e) {
      if (!ctrl.signal.aborted) update((m) => ({ ...m, done: true, error: e instanceof Error ? e.message : "Copilot failed." }));
      else update((m) => ({ ...m, done: true, error: "Stopped." }));
    } finally {
      setBusy(false);
    }
  }

  const h = { openPage, openPaper: openById };
  const library = <Library state={s} onOpen={openPaper} onActivate={openById} />;
  const reader = (
    <Reader papers={s.papers} activeId={s.activeId} page={s.page} onActivate={(id) => setS((c) => ({ ...c, activeId: id }))} onClose={closePaper} />
  );
  const copilot = (
    <CopilotPanel
      messages={s.messages}
      papers={s.papers}
      busy={busy}
      onSend={send}
      onStop={() => abort.current?.abort()}
      onClear={() => setS((c) => ({ ...c, messages: [] }))}
      h={h}
    />
  );

  return (
    <div className="h-[calc(100dvh-3.5rem)] flex flex-col workspace-bg">
      {/* Phones: one pane at a time */}
      <div className="md:hidden flex border-b border-line bg-surface" role="tablist">
        {(["library", "paper", "copilot"] as Pane[]).map((p) => (
          <button
            key={p}
            role="tab"
            aria-selected={pane === p}
            onClick={() => setPane(p)}
            className={`flex-1 py-2.5 text-sm capitalize ${pane === p ? "text-ink border-b-2 border-accent font-medium" : "text-ink-3"}`}
          >
            {p}
          </button>
        ))}
      </div>
      <div className="md:hidden flex-1 min-h-0 bg-surface">{pane === "library" ? library : pane === "paper" ? reader : copilot}</div>

      {/* Desktop: three resizable panels */}
      <div className="hidden md:block flex-1 min-h-0 p-2">
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
    </div>
  );
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
  };
}
