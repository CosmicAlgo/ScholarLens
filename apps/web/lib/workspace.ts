// Workspace state, persistence (per browser) and the streaming Copilot client.

import { API_URL, type Paper } from "./api";
import { clientId } from "./client-id";
import type { DocPassage } from "./docstore";

export type Mode = "ask" | "explain" | "critique" | "brainstorm" | "related" | "compare" | "verify";

export type OpenPaper = Pick<
  Paper,
  "id" | "title" | "year" | "venue" | "authors" | "doi" | "abstract" | "cited_by_count" | "is_retracted" | "is_preprint" | "is_oa" | "oa_url"
> & {
  fulltext?: "loading" | "ready" | "no_pdf" | "failed";
  pages?: number | null;
  /** The user supplied the PDF (an upload, or attached to a paywalled paper). Lives in IndexedDB. */
  local?: boolean;
  /** When the local PDF was last (re)attached, so open views reload it. */
  localAt?: number;
};

export type Job = { kind: "read_paper" | "read_figures" | "search_literature" | "topic_trend"; target: string; query: string };
export type JobStatus = Job & { status: "running" | "done" | "failed"; note?: string };

export type EvidenceItem =
  | { id: string; kind: "passage" | "highlight"; paper_id: string; title: string; page: number; text: string; figure?: boolean }
  | { id: string; kind: "figure"; paper_id: string; title: string; page: number; label: string; figure_kind: string; text: string; caption?: string | null }
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
  /** Numbers in cited sentences that none of the cited sources contain. */
  unsupported_numbers?: { number: string; sentence: string; cites: string[] }[];
};

export type NoveltyItem = {
  title: string;
  verdict: "open" | "partly_explored" | "already_done";
  reason: string;
  query: string;
  closest: { id: string; title: string; year: number | null; cited_by: number }[];
};

/** `image` is a base64 JPEG of a figure the user cut out. It is sent once and never stored. */
export type Selection = { paper_id: string; page: number; text: string; image?: string; figure?: boolean };

export type FigureItem = Extract<EvidenceItem, { kind: "figure" }>;

export type GraphNode = {
  id: string;
  title: string;
  year: number | null;
  cited_by: number;
  retracted?: boolean;
  kind: "open" | "shared" | "reference" | "citing" | "idea" | "prior";
  verdict?: NoveltyItem["verdict"];
};
export type Graph = { nodes: GraphNode[]; edges: { source: string; target: string }[] };

export type Message =
  | { role: "user"; text: string; mode: Mode; at: number; selection?: Selection }
  | {
      role: "assistant";
      text: string;
      mode?: Mode;
      jobs: JobStatus[];
      evidence: EvidenceItem[];
      verification?: Verification;
      novelty?: NoveltyItem[] | "pending";
      /** Server run id, so the answer can resume after a reload or a dropped connection. */
      runId?: string;
      error?: string;
      done: boolean;
      at: number;
    };

/** Rects are fractions of the page box, so highlights survive zooming. */
export type Rect = { x: number; y: number; w: number; h: number };
export type Highlight = {
  id: string;
  paper_id: string;
  title: string;
  page: number;
  text: string;
  rects: Rect[];
  color: "yellow" | "blue" | "green" | "pink";
  note?: string;
  at: number;
};

export const MATRIX_COLUMNS = [
  { key: "problem", label: "Problem" },
  { key: "method", label: "Method" },
  { key: "data", label: "Data" },
  { key: "findings", label: "Findings" },
  { key: "limitations", label: "Limitations" },
] as const;

export type MatrixCell = { text: string; cites: string[]; unsupported_numbers?: string[]; uncited?: boolean };
export type MatrixRow = {
  paper_id: string;
  source: "full_text" | "uploaded" | "abstract";
  row: Record<(typeof MATRIX_COLUMNS)[number]["key"], MatrixCell> | null;
  evidence: { id: string; page: number; text: string }[];
};

export type WorkspaceState = {
  papers: OpenPaper[];
  activeId: string | null;
  page: Record<string, number>;
  messages: Message[];
  recent: { id: string; title: string; at: number }[];
  highlights: Highlight[];
  matrix: Record<string, MatrixRow>;
  figures: Record<string, FigureItem[]>;
  /** Reading list: papers kept while screening. */
  queue: OpenPaper[];
};

export const EMPTY: WorkspaceState = { papers: [], activeId: null, page: {}, messages: [], recent: [], highlights: [], matrix: {}, figures: {}, queue: [] };
const KEY = "sl_workspace_v1";

export function loadState(): WorkspaceState {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return EMPTY;
    const s = JSON.parse(raw) as WorkspaceState;
    // Never restore a half-streamed answer.
    s.messages = (s.messages || []).map((m) =>
      m.role === "assistant" && !m.done && !m.runId
        ? { ...m, done: true, error: m.error || "Interrupted." }
        : m.role === "assistant" && m.novelty === "pending"
          ? { ...m, novelty: [] }
          : m,
    );
    return { ...EMPTY, ...s };
  } catch {
    return EMPTY;
  }
}

export function saveState(s: WorkspaceState) {
  try {
    // Figure images are large: keep only the fact that one was sent.
    const messages = s.messages.slice(-40).map((m) =>
      m.role === "user" && m.selection?.image ? { ...m, selection: { ...m.selection, image: undefined, figure: true } } : m,
    );
    localStorage.setItem(KEY, JSON.stringify({ ...s, messages }));
  } catch {}
}

export const pdfUrl = (id: string) => `${API_URL}/api/papers/${id}/pdf`;

export async function prepareFulltext(id: string): Promise<{ status: OpenPaper["fulltext"]; pages: number | null }> {
  const res = await fetch(`${API_URL}/api/papers/${id}/fulltext`, { method: "POST" });
  if (!res.ok) return { status: "failed", pages: null };
  const d = await res.json();
  return { status: d.status, pages: d.pages };
}

async function errorText(res: Response, fallback: string) {
  try {
    const b = await res.json();
    if (typeof b?.detail === "string") return b.detail;
  } catch {}
  return fallback;
}

export async function extractRow(paper_id: string, title: string, passages?: DocPassage[]): Promise<MatrixRow> {
  const res = await fetch(`${API_URL}/api/extract`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Client-Id": clientId() },
    body: JSON.stringify({ paper_id, title, passages: passages || [] }),
  });
  if (!res.ok) throw new Error(await errorText(res, "Could not extract this paper."));
  return res.json();
}

export async function readFigures(
  paper_id: string,
  title: string,
  images?: { page: number; data: string; text?: string }[],
): Promise<FigureItem[]> {
  const res = await fetch(`${API_URL}/api/figures`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Client-Id": clientId() },
    body: JSON.stringify({ paper_id, title, images: images || [] }),
  });
  if (!res.ok) throw new Error(await errorText(res, "Could not read the figures."));
  return (await res.json()).figures;
}

export async function fetchGraph(ids: string[]): Promise<Graph> {
  const res = await fetch(`${API_URL}/api/graph`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ids }),
  });
  if (!res.ok) throw new Error(await errorText(res, "Could not build the map."));
  return res.json();
}

type Handlers = {
  onDispatch: (jobs: Job[]) => void;
  onJob: (job: Job, status: "done" | "failed", note: string) => void;
  onEvidence: (ev: EvidenceItem[]) => void;
  onToken: (text: string) => void;
  onVerified: (v: Verification) => void;
  onNovelty: (n: NoveltyItem[]) => void;
};

export type CopilotBody = {
  message: string;
  mode: Mode;
  open_papers: { id: string; title: string }[];
  history: { role: string; text: string }[];
  documents: { id: string; title: string; passages: DocPassage[] }[];
  selection: Selection | null;
};

/** Where a Copilot stream got to: the server's run id and the last event index received. */
export type RunCursor = { runId?: string; last: number };

class AnswerError extends Error {}

async function consume(res: Response, h: Handlers, cur: RunCursor, onRun: (id: string) => void) {
  if (!res.ok || !res.body) throw new AnswerError(await errorText(res, "Copilot is unavailable right now."));
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) return;
    buf += dec.decode(value, { stream: true }).replace(/\r\n?/g, "\n");
    let i;
    while ((i = buf.indexOf("\n\n")) >= 0) {
      const chunk = buf.slice(0, i);
      buf = buf.slice(i + 2);
      let event = "message";
      let id: number | null = null;
      const lines: string[] = [];
      for (const line of chunk.split("\n")) {
        if (line.startsWith("event:")) event = line.slice(6).trim();
        else if (line.startsWith("id:")) id = Number(line.slice(3).trim());
        else if (line.startsWith("data:")) lines.push(line.slice(5).replace(/^ /, ""));
      }
      if (!lines.length) continue;
      const d = JSON.parse(lines.join("\n"));
      if (event === "run") {
        cur.runId = d.id;
        onRun(d.id);
        continue;
      }
      if (id !== null) {
        if (id <= cur.last) continue; // already applied before a reconnect
        cur.last = id;
      }
      if (event === "dispatch") h.onDispatch(d.jobs);
      else if (event === "job") h.onJob(d.job, d.status, d.note);
      else if (event === "evidence") h.onEvidence(d);
      else if (event === "token") h.onToken(d.text);
      else if (event === "verified") h.onVerified(d);
      else if (event === "novelty") h.onNovelty(d);
      else if (event === "error") throw new AnswerError(d.message || "Copilot failed.");
    }
  }
}

/**
 * Ask Copilot, or resume a run (`cur.runId` set). The server keeps producing the answer even if this
 * connection drops, so network errors reconnect and continue from the last event received.
 */
export async function askCopilot(
  body: CopilotBody | null,
  h: Handlers,
  signal: AbortSignal,
  cur: RunCursor,
  onRun: (id: string) => void,
) {
  const headers = { "Content-Type": "application/json", "X-Client-Id": clientId() };
  for (let attempt = 0; ; attempt++) {
    try {
      const res =
        cur.runId || !body
          ? await fetch(`${API_URL}/api/copilot/${cur.runId}/stream?after=${cur.last + 1}`, { headers, signal })
          : await fetch(`${API_URL}/api/copilot`, { method: "POST", headers, body: JSON.stringify(body), signal });
      if (res.status === 404 && cur.runId) throw new AnswerError("This answer is no longer available on the server.");
      await consume(res, h, cur, onRun);
      return;
    } catch (e) {
      if (signal.aborted || e instanceof AnswerError) throw e;
      // A dropped connection: reconnect if the server had already started this run.
      if (!cur.runId || attempt >= 6) throw new Error("The connection dropped. Check your network and ask again.");
      await new Promise((r) => setTimeout(r, Math.min(8000, 800 * 2 ** attempt)));
    }
  }
}

export async function cancelRun(runId: string) {
  try {
    await fetch(`${API_URL}/api/copilot/${runId}/cancel`, { method: "POST", headers: { "X-Client-Id": clientId() } });
  } catch {}
}

export const JOB_LABEL: Record<Job["kind"], string> = {
  read_paper: "Read paper",
  read_figures: "Read figures (vision)",
  search_literature: "Search literature",
  topic_trend: "Check trend",
};

// ---------- exports

function bibKey(p: OpenPaper) {
  const last = (p.authors[0] || "anon").split(" ").at(-1)!.toLowerCase().replace(/[^a-z]/g, "");
  const word = (p.title.toLowerCase().match(/[a-z]{4,}/) || ["paper"])[0];
  return `${last}${p.year ?? ""}${word}`;
}

export function toBibtex(papers: OpenPaper[]): string {
  return papers
    .map((p) => {
      const f: [string, string | number | null | undefined][] = [
        ["title", p.title],
        ["author", p.authors.join(" and ")],
        ["year", p.year],
        ["journal", p.venue],
        ["doi", p.doi?.replace(/^https?:\/\/doi\.org\//, "")],
        ["url", p.oa_url],
      ];
      const body = f
        .filter(([, v]) => v !== null && v !== undefined && v !== "")
        .map(([k, v]) => `  ${k} = {${k === "title" ? `{${v}}` : v}}`)
        .join(",\n");
      return `@article{${bibKey(p)},\n${body}\n}`;
    })
    .join("\n\n");
}

export function notesMarkdown(highlights: Highlight[]): string {
  const byPaper = new Map<string, Highlight[]>();
  for (const h of highlights) byPaper.set(h.title, [...(byPaper.get(h.title) || []), h]);
  return [...byPaper.entries()]
    .map(
      ([title, hs]) =>
        `## ${title}\n\n` +
        [...hs]
          .sort((a, b) => a.page - b.page)
          .map((h) => `> ${h.text.replace(/\n/g, " ")}\n>\n> (p. ${h.page})${h.note ? `\n\n${h.note}` : ""}`)
          .join("\n\n"),
    )
    .join("\n\n");
}

export function download(name: string, text: string, type = "text/plain") {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = Object.assign(document.createElement("a"), { href: url, download: name });
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export type SeriesPoint = { year: number; count: number; per_million: number | null };
export type Lineage = {
  years: [number, number];
  topics: { id: string; name: string; path: string[]; works_count: number; related: string[]; trend: SeriesPoint[]; papers: string[] }[];
  terms: {
    term: string;
    first_year: number | null;
    early_papers: { id: string; title: string; year: number | null; cited_by: number }[];
    total: number;
    trend: SeriesPoint[];
    papers: string[];
  }[];
  spread: { topic: string; count: number; papers: string[] }[];
  source: string;
};

export async function fetchLineage(ids: string[]): Promise<Lineage> {
  const res = await fetch(`${API_URL}/api/lineage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ids }),
  });
  if (!res.ok) throw new Error(await errorText(res, "Could not load the topic context."));
  return res.json();
}
