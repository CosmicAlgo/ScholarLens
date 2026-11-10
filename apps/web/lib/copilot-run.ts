"use client";

// Copilot answers run here, not inside a page, so they survive navigation. Each answer has a
// server run id: a dropped connection reconnects, and a reload resumes the answer from the start
// of its event log.

import { track } from "@/components/analytics";
import { getDoc } from "./docstore";
import { getWS, setWS, whenRestored } from "./store";
import {
  askCopilot,
  cancelRun,
  type Job,
  type Message,
  type Mode,
  type OpenPaper,
  type RunCursor,
  type Selection,
  type WorkspaceState,
} from "./workspace";

type Assistant = Extract<Message, { role: "assistant" }>;
let ctrl: AbortController | null = null;

async function documents(papers: OpenPaper[]) {
  const out = [];
  for (const p of papers.filter((x) => x.local)) {
    const d = await getDoc(p.id);
    if (d) out.push({ id: p.id, title: d.title, passages: d.passages.slice(0, 600) });
  }
  return out;
}

function updater(at: number) {
  return (fn: (m: Assistant) => Assistant) =>
    setWS((c) => ({
      ...c,
      messages: c.messages.map((m) => (m.role === "assistant" && m.at === at ? fn(m) : m)),
    }));
}

function handlers(update: (fn: (m: Assistant) => Assistant) => void, mode: Mode | undefined) {
  return {
    onDispatch: (jobs: Job[]) => update((m) => ({ ...m, jobs: jobs.map((j) => ({ ...j, status: "running" as const })) })),
    onJob: (job: Job, status: "done" | "failed", note: string) =>
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
    onEvidence: (evidence: Assistant["evidence"]) => update((m) => ({ ...m, evidence })),
    onToken: (t: string) => update((m) => ({ ...m, text: m.text + t })),
    onVerified: (v: NonNullable<Assistant["verification"]>) =>
      update((m) => ({ ...m, verification: v, done: mode !== "brainstorm", ...(mode === "brainstorm" ? { novelty: "pending" as const } : {}) })),
    onNovelty: (n: NonNullable<Exclude<Assistant["novelty"], "pending">>) => update((m) => ({ ...m, novelty: n, done: true })),
  };
}

async function drive(body: Parameters<typeof askCopilot>[0], at: number, mode: Mode | undefined, cur: RunCursor) {
  const update = updater(at);
  ctrl = new AbortController();
  const mine = ctrl;
  try {
    await askCopilot(body, handlers(update, mode), mine.signal, cur, (runId) => update((m) => ({ ...m, runId })));
    update((m) => ({ ...m, done: true, novelty: m.novelty === "pending" ? [] : m.novelty }));
  } catch (e) {
    const msg = mine.signal.aborted ? "Stopped." : e instanceof Error ? e.message : "Copilot failed.";
    update((m) => ({ ...m, done: true, error: m.verification ? undefined : msg, novelty: m.novelty === "pending" ? [] : m.novelty }));
  } finally {
    if (ctrl === mine) ctrl = null;
  }
}

export function sendCopilot(text: string, mode: Mode, selection: Selection | null) {
  const cur = getWS();
  track("copilot_sent", { mode, open: cur.papers.length, selection: !!selection, figure: !!selection?.image });
  const history = cur.messages.slice(-6).map((m) => ({ role: m.role, text: m.text.slice(0, 1500) }));
  const open = cur.papers.map((p) => ({ id: p.id, title: p.title }));
  const at = Date.now();
  const assistant: Assistant = { role: "assistant", text: "", mode, jobs: [], evidence: [], done: false, at };
  setWS((c) => ({
    ...c,
    messages: [...c.messages, { role: "user", text, mode, at: at - 1, ...(selection ? { selection } : {}) }, assistant],
  }));
  void (async () => {
    const body = { message: text, mode, open_papers: open, history, documents: await documents(cur.papers), selection };
    await drive(body, at, mode, { last: -1 });
  })();
}

export function stopCopilot() {
  const m = getWS().messages.at(-1);
  ctrl?.abort();
  if (m?.role === "assistant" && m.runId) cancelRun(m.runId);
  if (m?.role === "assistant" && !m.done) updater(m.at)((x) => ({ ...x, done: true, error: x.verification ? undefined : "Stopped." }));
}

/** After a reload: replay the unfinished answer's event log from the start. */
function resume(s: WorkspaceState) {
  const m = s.messages.at(-1);
  if (m?.role !== "assistant" || m.done || !m.runId) return;
  updater(m.at)((x) => ({ ...x, text: "", jobs: [], evidence: [], verification: undefined, novelty: undefined }));
  void drive(null, m.at, m.mode, { runId: m.runId, last: -1 });
}

whenRestored(resume);
