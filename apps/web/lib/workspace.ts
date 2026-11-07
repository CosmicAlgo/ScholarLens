// Workspace state, persistence (per browser) and the streaming Copilot client.

import { API_URL, type Paper } from "./api";
import { clientId } from "./client-id";

export type Mode = "ask" | "explain" | "critique" | "brainstorm" | "related" | "compare";

export type OpenPaper = Pick<
  Paper,
  "id" | "title" | "year" | "venue" | "authors" | "doi" | "abstract" | "cited_by_count" | "is_retracted" | "is_preprint" | "is_oa" | "oa_url"
> & { fulltext?: "loading" | "ready" | "no_pdf" | "failed"; pages?: number | null };

export type Job = { kind: "read_paper" | "search_literature" | "topic_trend"; target: string; query: string };
export type JobStatus = Job & { status: "running" | "done" | "failed"; note?: string };

export type EvidenceItem =
  | { id: string; kind: "passage"; paper_id: string; title: string; page: number; text: string }
  | {
      id: string;
      kind: "paper";
      title: string;
      year: number | null;
      venue: string | null;
      authors: string[];
      cited_by: number;
      flags: string[];
      abstract?: string;
    }
  | { id: string; kind: "metric"; topic: string; label: string; value: string | number | null };

export type Verification = {
  citations: number;
  valid: number;
  invalid: string[];
  retracted: string[];
  paragraphs: number;
  uncited_paragraphs: number;
};

export type Message =
  | { role: "user"; text: string; mode: Mode; at: number }
  | {
      role: "assistant";
      text: string;
      jobs: JobStatus[];
      evidence: EvidenceItem[];
      verification?: Verification;
      error?: string;
      done: boolean;
      at: number;
    };

export type WorkspaceState = {
  papers: OpenPaper[];
  activeId: string | null;
  page: Record<string, number>;
  messages: Message[];
  recent: { id: string; title: string; at: number }[];
};

export const EMPTY: WorkspaceState = { papers: [], activeId: null, page: {}, messages: [], recent: [] };
const KEY = "sl_workspace_v1";

export function loadState(): WorkspaceState {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return EMPTY;
    const s = JSON.parse(raw) as WorkspaceState;
    // Never restore a half-streamed answer.
    s.messages = (s.messages || []).map((m) => (m.role === "assistant" && !m.done ? { ...m, done: true, error: m.error || "Interrupted." } : m));
    return { ...EMPTY, ...s };
  } catch {
    return EMPTY;
  }
}

export function saveState(s: WorkspaceState) {
  try {
    localStorage.setItem(KEY, JSON.stringify({ ...s, messages: s.messages.slice(-40) }));
  } catch {}
}

export const pdfUrl = (id: string, page?: number) => `${API_URL}/api/papers/${id}/pdf${page ? `#page=${page}` : ""}`;

export async function prepareFulltext(id: string): Promise<{ status: OpenPaper["fulltext"]; pages: number | null }> {
  const res = await fetch(`${API_URL}/api/papers/${id}/fulltext`, { method: "POST" });
  if (!res.ok) return { status: "failed", pages: null };
  const d = await res.json();
  return { status: d.status, pages: d.pages };
}

type Handlers = {
  onDispatch: (jobs: Job[]) => void;
  onJob: (job: Job, status: "done" | "failed", note: string) => void;
  onEvidence: (ev: EvidenceItem[]) => void;
  onToken: (text: string) => void;
  onVerified: (v: Verification) => void;
};

export async function askCopilot(
  body: { message: string; mode: Mode; open_papers: { id: string; title: string }[]; history: { role: string; text: string }[] },
  h: Handlers,
  signal: AbortSignal,
) {
  const res = await fetch(`${API_URL}/api/copilot`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Client-Id": clientId() },
    body: JSON.stringify(body),
    signal,
  });
  if (!res.ok || !res.body) {
    let msg = "Copilot is unavailable right now.";
    try {
      const b = await res.json();
      if (typeof b?.detail === "string") msg = b.detail;
    } catch {}
    throw new Error(msg);
  }
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = "";
  let finished = false;
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true }).replace(/\r\n?/g, "\n");
    let i;
    while ((i = buf.indexOf("\n\n")) >= 0) {
      const chunk = buf.slice(0, i);
      buf = buf.slice(i + 2);
      let event = "message";
      const lines: string[] = [];
      for (const line of chunk.split("\n")) {
        if (line.startsWith("event:")) event = line.slice(6).trim();
        else if (line.startsWith("data:")) lines.push(line.slice(5).replace(/^ /, ""));
      }
      if (!lines.length) continue;
      const d = JSON.parse(lines.join("\n"));
      if (event === "dispatch") h.onDispatch(d.jobs);
      else if (event === "job") h.onJob(d.job, d.status, d.note);
      else if (event === "evidence") h.onEvidence(d);
      else if (event === "token") h.onToken(d.text);
      else if (event === "verified") {
        h.onVerified(d);
        finished = true;
      } else if (event === "error") throw new Error(d.message || "Copilot failed.");
    }
  }
  if (!finished) throw new Error("The connection closed before the answer finished.");
}

export const JOB_LABEL: Record<Job["kind"], string> = {
  read_paper: "Read paper",
  search_literature: "Search literature",
  topic_trend: "Check trend",
};
