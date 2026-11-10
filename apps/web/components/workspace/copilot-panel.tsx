"use client";

import { useEffect, useRef, useState } from "react";
import type { JobStatus, Message, Mode, NoveltyItem, OpenPaper, Selection } from "@/lib/workspace";
import { JOB_LABEL } from "@/lib/workspace";
import { Answer, type CiteHandlers } from "./answer";

const MODES: { id: Mode; label: string; hint: string }[] = [
  { id: "ask", label: "Ask", hint: "Direct answer" },
  { id: "explain", label: "Explain", hint: "Plain-language walkthrough" },
  { id: "critique", label: "Critique", hint: "Peer-review style" },
  { id: "verify", label: "Verify", hint: "Check a claim against the literature" },
  { id: "brainstorm", label: "Ideas", hint: "Research ideas, each checked for prior work" },
  { id: "related", label: "Related", hint: "Map related work" },
  { id: "compare", label: "Compare", hint: "Side by side" },
];

function starters(papers: OpenPaper[]): { mode: Mode; text: string }[] {
  if (!papers.length)
    return [
      { mode: "related", text: "What are the main research directions in retrieval augmented generation?" },
      { mode: "brainstorm", text: "Suggest open problems in microplastics research I could build a project on" },
      { mode: "verify", text: "Large language models can reliably grade student essays" },
    ];
  const t = papers[0].title;
  return [
    { mode: "explain", text: `Explain "${t}" in plain language` },
    { mode: "critique", text: "What are the weaknesses and hidden assumptions of this paper?" },
    { mode: "brainstorm", text: "Brainstorm follow-up research built on this paper's limitations" },
    ...(papers.length > 1 ? [{ mode: "compare" as Mode, text: "Compare the open papers: methods, data and results" }] : []),
  ];
}

export type PendingSelection = Selection & { title: string };

export function CopilotPanel({
  messages,
  papers,
  busy,
  pending,
  focusNonce,
  onClearPending,
  onSend,
  onStop,
  onClear,
  h,
}: {
  messages: Message[];
  papers: OpenPaper[];
  busy: boolean;
  pending: PendingSelection | null;
  focusNonce: number;
  onClearPending: () => void;
  onSend: (text: string, mode: Mode) => void;
  onStop: () => void;
  onClear: () => void;
  h: CiteHandlers;
}) {
  const [mode, setMode] = useState<Mode>("ask");
  const [text, setText] = useState("");
  const end = useRef<HTMLDivElement>(null);
  const box = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    end.current?.scrollIntoView({ block: "end" });
  }, [messages]);
  useEffect(() => {
    if (focusNonce) box.current?.focus();
  }, [focusNonce]);

  const send = (t: string, m: Mode) => {
    if (t.trim().length < 2 || busy) return;
    onSend(t.trim(), m);
    setText("");
  };

  return (
    <div className="h-full flex flex-col min-h-0">
      <div className="px-3 py-2.5 border-b border-line flex items-center gap-2 shrink-0">
        <span className="relative flex w-2 h-2">
          <span className={`absolute inline-flex h-full w-full rounded-full bg-accent opacity-60 ${busy ? "animate-ping" : ""}`} />
          <span className="relative inline-flex rounded-full w-2 h-2 bg-accent" />
        </span>
        <h2 className="text-sm font-semibold">Copilot</h2>
        <span className="text-[0.7rem] text-ink-3 truncate">
          {papers.length ? `reading ${papers.length} paper${papers.length > 1 ? "s" : ""}` : "no paper open"}
        </span>
        <span className="flex-1" />
        {messages.length > 0 && (
          <button onClick={onClear} className="text-[0.7rem] text-ink-3 hover:text-ink">
            Clear
          </button>
        )}
      </div>

      <div className="flex-1 overflow-y-auto min-h-0 px-3 py-3 space-y-4">
        {messages.length === 0 && (
          <div className="space-y-2">
            <p className="text-sm text-ink-3">
              A master agent plans the work and dispatches workers in parallel: one reads your open papers, one searches the
              literature, one checks topic trends. Every claim cites a page or a paper, and a checker verifies the citations.
              Select text in a PDF to ask about it.
            </p>
            {starters(papers).map((s) => (
              <button
                key={s.text}
                onClick={() => {
                  setMode(s.mode);
                  send(s.text, s.mode);
                }}
                className="w-full text-left rounded-xl border border-line bg-bg px-3 py-2 text-sm hover:border-accent"
              >
                <span className="text-[0.68rem] uppercase tracking-wider text-accent-ink font-semibold">
                  {MODES.find((m) => m.id === s.mode)?.label}
                </span>
                <div className="text-ink-2 line-clamp-2">{s.text}</div>
              </button>
            ))}
          </div>
        )}

        {messages.map((m, i) =>
          m.role === "user" ? (
            <div key={i} className="flex justify-end">
              <div className="max-w-[90%] rounded-2xl rounded-br-md bg-accent text-white px-3.5 py-2 text-sm">
                {m.mode !== "ask" && (
                  <span className="block text-[0.65rem] uppercase tracking-wider opacity-80">{MODES.find((x) => x.id === m.mode)?.label}</span>
                )}
                {m.selection && (
                  <span className="block mb-1 border-l-2 border-white/60 pl-2 text-xs opacity-90 line-clamp-3">
                    “{m.selection.text}” <span className="opacity-80">p.{m.selection.page}</span>
                  </span>
                )}
                {m.text}
              </div>
            </div>
          ) : (
            <div key={i} className="space-y-2">
              {m.jobs.length > 0 && <Dispatch jobs={m.jobs} done={m.done || !!m.text} />}
              {m.text ? (
                <Answer text={m.text} evidence={m.evidence} invalid={m.verification?.invalid || []} h={h} />
              ) : (
                !m.error && <p className="text-sm text-ink-3 animate-pulse">{m.jobs.length ? "Workers gathering evidence…" : "Planning…"}</p>
              )}
              {m.error && <p className="text-sm rounded-lg bg-bad-soft text-bad px-3 py-2">{m.error}</p>}
              {m.verification && <Verified v={m.verification} sources={m.evidence.length} />}
              {m.novelty && <Novelty items={m.novelty} openPaper={h.openPaper} />}
            </div>
          ),
        )}
        <div ref={end} />
      </div>

      <form
        className="border-t border-line p-2.5 space-y-2 shrink-0"
        onSubmit={(e) => {
          e.preventDefault();
          send(text, mode);
        }}
      >
        <div className="flex gap-1 overflow-x-auto no-scrollbar" role="radiogroup" aria-label="Copilot mode">
          {MODES.map((m) => (
            <button
              type="button"
              key={m.id}
              role="radio"
              aria-checked={mode === m.id}
              title={m.hint}
              onClick={() => setMode(m.id)}
              className={`shrink-0 rounded-full px-2.5 py-1 text-xs border ${
                mode === m.id ? "bg-ink text-bg border-ink" : "border-line text-ink-2 hover:border-ink-3"
              }`}
            >
              {m.label}
            </button>
          ))}
        </div>
        {pending && (
          <div className="flex items-start gap-2 rounded-xl border border-accent/40 bg-accent-soft px-3 py-2 text-xs">
            <div className="min-w-0 flex-1">
              <div className="text-[0.65rem] font-semibold uppercase tracking-wider text-accent-ink">
                Selected · p.{pending.page} · {pending.title}
              </div>
              <p className="text-ink-2 line-clamp-2">“{pending.text}”</p>
            </div>
            <button type="button" aria-label="Remove selection" onClick={onClearPending} className="text-ink-3 hover:text-ink">
              ×
            </button>
          </div>
        )}
        <div className="flex gap-2 items-end">
          <label htmlFor="copilot-q" className="sr-only">
            Message Copilot
          </label>
          <textarea
            id="copilot-q"
            ref={box}
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                send(text, mode);
              }
            }}
            rows={2}
            maxLength={2000}
            placeholder={
              pending ? "Ask about the selected text…" : mode === "verify" ? "Paste a claim to check…" : papers.length ? "Ask about the open papers…" : "Ask about a research topic…"
            }
            className="flex-1 resize-none rounded-xl border border-line bg-bg px-3 py-2 text-base sm:text-sm outline-none focus:border-accent"
          />
          {busy ? (
            <button type="button" onClick={onStop} className="h-10 rounded-xl border border-line px-3 text-sm hover:border-ink-3">
              Stop
            </button>
          ) : (
            <button disabled={text.trim().length < 2} className="h-10 rounded-xl bg-accent text-white px-4 text-sm font-medium disabled:opacity-40">
              Send
            </button>
          )}
        </div>
        <p className="text-[0.65rem] text-ink-3 px-1">Answers are AI-generated from cited sources. Check the citations before relying on them.</p>
      </form>
    </div>
  );
}

function Dispatch({ jobs, done }: { jobs: JobStatus[]; done: boolean }) {
  return (
    <div className="rounded-xl border border-line bg-bg p-2.5">
      <div className="text-[0.65rem] font-semibold uppercase tracking-wider text-ink-3 mb-1.5">
        Dispatched {jobs.length} worker{jobs.length > 1 ? "s" : ""}
      </div>
      <ul className="space-y-1">
        {jobs.map((j, i) => (
          <li key={i} className="flex items-center gap-2 text-xs min-w-0">
            <span
              className={`w-4 h-4 shrink-0 grid place-items-center rounded-full text-[0.6rem] ${
                j.status === "done" ? "bg-good-soft text-good" : j.status === "failed" ? "bg-bad-soft text-bad" : "bg-surface-2 text-ink-3"
              }`}
              aria-label={j.status}
            >
              {j.status === "done" ? "✓" : j.status === "failed" ? "!" : <span className="w-1.5 h-1.5 rounded-full bg-ink-3 animate-pulse" />}
            </span>
            <span className="font-medium text-ink-2 shrink-0">{JOB_LABEL[j.kind]}</span>
            <span className="text-ink-3 truncate">{j.query}</span>
            {j.note && j.status !== "running" && <span className="ml-auto text-ink-3 font-mono shrink-0">{j.note}</span>}
          </li>
        ))}
      </ul>
      {!done && <div className="mt-2 h-0.5 rounded bg-accent/60 animate-pulse" />}
    </div>
  );
}

function Verified({ v, sources }: { v: { citations: number; valid: number; invalid: string[]; retracted: string[] }; sources: number }) {
  const ok = v.invalid.length === 0 && v.retracted.length === 0;
  return (
    <div className={`flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg px-3 py-1.5 text-[0.7rem] ${ok ? "bg-good-soft text-good" : "bg-warn-soft text-warn"}`}>
      <span className="font-semibold">{ok ? "✓ Verified" : "⚠ Check citations"}</span>
      <span>
        {v.valid}/{v.citations} citations match the evidence
      </span>
      <span>{sources} sources gathered</span>
      {v.invalid.length > 0 && <span>{v.invalid.length} unverified</span>}
      {v.retracted.length > 0 && <span>{v.retracted.length} retracted cited</span>}
    </div>
  );
}

const VERDICT: Record<NoveltyItem["verdict"], { label: string; cls: string }> = {
  open: { label: "No close match", cls: "bg-good-soft text-good" },
  partly_explored: { label: "Partly explored", cls: "bg-warn-soft text-warn" },
  already_done: { label: "Already done", cls: "bg-bad-soft text-bad" },
};

function Novelty({ items, openPaper }: { items: NoveltyItem[] | "pending"; openPaper: (id: string) => void }) {
  return (
    <div className="rounded-xl border border-line bg-bg p-3">
      <div className="flex items-center gap-2 text-[0.65rem] font-semibold uppercase tracking-wider text-ink-3">
        Novelty check
        {items === "pending" && <span className="normal-case tracking-normal font-normal animate-pulse">searching prior work for each idea…</span>}
      </div>
      {items !== "pending" && items.length === 0 && <p className="mt-1 text-xs text-ink-3">Could not check these ideas this time.</p>}
      {items !== "pending" && items.length > 0 && (
        <>
          <ul className="mt-2 space-y-2.5">
            {items.map((it, i) => (
              <li key={i} className="text-xs">
                <div className="flex items-start gap-2">
                  <span className={`shrink-0 rounded px-1.5 py-0.5 text-[0.65rem] font-semibold ${VERDICT[it.verdict].cls}`}>{VERDICT[it.verdict].label}</span>
                  <span className="font-medium text-ink">{it.title}</span>
                </div>
                <p className="mt-1 text-ink-3">{it.reason}</p>
                {it.closest.length > 0 && (
                  <div className="mt-1 flex flex-wrap gap-1">
                    <span className="text-ink-3">Closest:</span>
                    {it.closest.map((c) => (
                      <button
                        key={c.id}
                        onClick={() => openPaper(c.id)}
                        className="rounded bg-surface-2 px-1.5 text-ink-2 hover:bg-ink hover:text-bg max-w-full truncate"
                        title={c.title}
                      >
                        {c.title.length > 48 ? c.title.slice(0, 46) + "…" : c.title} {c.year ? `(${c.year})` : ""}
                      </button>
                    ))}
                  </div>
                )}
              </li>
            ))}
          </ul>
          <p className="mt-2 text-[0.65rem] text-ink-3">
            Based on a literature search for each idea. &ldquo;No close match&rdquo; means none of the papers found does it, not that
            nobody has.
          </p>
        </>
      )}
    </div>
  );
}
