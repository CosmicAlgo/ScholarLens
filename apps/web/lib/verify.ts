// Client for the verification tools: Citation Check, Claim Court, Citation Telephone.

import { API_URL } from "./api";
import { clientId } from "./client-id";

export type CitingPaper = {
  s2: string | null;
  title: string;
  year: number | null;
  venue: string;
  doi: string | null;
  arxiv: string | null;
  cited_by: number;
};

export type SourcePaper = {
  id: string;
  title: string;
  year: number | null;
  doi: string | null;
  authors: string[];
  cited_by: number;
  retracted: boolean;
  abstract: string;
};

export type Stance = "supports" | "disputes" | "mentions";
export type CourtItem = { text: string; influential: boolean; paper: CitingPaper; stance: Stance; quote: string };
export type CourtResult = {
  paper: SourcePaper;
  claim: string;
  verdict: { label: "supported" | "mostly_supported" | "contested" | "not_enough"; text: string };
  tally: Record<Stance, number>;
  items: CourtItem[];
  coverage: { sentences_available: number; sentences_judged: number; cited_by: number; labels_without_proof: number };
  note: string;
  cached?: boolean;
};

export type Fate = "faithful" | "rounded" | "changed" | "vaguer" | "overstated";
export type Retelling = {
  text: string;
  influential: boolean;
  paper: CitingPaper;
  stated: string;
  fate: Fate;
  decided_by: "numbers" | "ai";
  numbers: number[];
  parent?: string | null;
};
export type PhoneResult = {
  paper: SourcePaper;
  claim: string;
  claim_numbers: number[];
  claim_in_source: boolean;
  hop1: Retelling[];
  hop2: Retelling[];
  counts: Record<Fate, number>;
  coverage: { sentences_available: number; parents_followed: number; second_generation_sentences?: number };
  note: string;
  cached?: boolean;
};

export type RefStatus = "verified" | "check_details" | "doi_mismatch" | "retracted" | "not_found" | "unreadable";
export type RefResult = {
  n: number;
  label: string;
  title: string;
  first_author: string;
  year: number | null;
  doi: string;
  readable: boolean;
  status: RefStatus;
  issues: string[];
  match: {
    id: string | null;
    title: string;
    year: number | null;
    doi: string | null;
    authors: string[];
    venue: string;
    retracted: boolean;
    cited_by: number;
    source: string;
  } | null;
};
export type ClaimCheck = {
  sentence: string;
  ref: number;
  label: string;
  verdict: "supported" | "not_in_abstract" | "contradicted";
  quote: string;
};
export type RefCheckResult = {
  references: RefResult[];
  counts: Record<RefStatus, number>;
  claims: ClaimCheck[];
  had_draft: boolean;
  cached?: boolean;
};

async function post<T>(path: string, body: unknown, signal?: AbortSignal): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Client-Id": clientId() },
    body: JSON.stringify(body),
    signal,
  });
  if (!res.ok) {
    let detail = `Request failed (${res.status})`;
    try {
      const j = await res.json();
      if (typeof j?.detail === "string") detail = j.detail;
      else if (Array.isArray(j?.detail)) detail = "Check what you entered and try again.";
    } catch {}
    throw new Error(detail);
  }
  return res.json();
}

export const checkReferences = (text: string, signal?: AbortSignal) => post<RefCheckResult>("/api/refcheck", { text }, signal);
export const claimCourt = (paper_id: string, claim: string, signal?: AbortSignal) =>
  post<CourtResult>("/api/court", { paper_id, claim }, signal);
export const citationTelephone = (paper_id: string, claim: string, signal?: AbortSignal) =>
  post<PhoneResult>("/api/telephone", { paper_id, claim }, signal);

/** OpenAlex id or DOI from whatever the user pasted (URL, doi:, plain id). */
export function paperIdFrom(input: string): string | null {
  const s = input.trim();
  const w = s.match(/\b(W\d{3,12})\b/);
  if (w) return w[1];
  const d = s.match(/\b(10\.\d{4,9}\/[^\s"<>]+)/);
  return d ? d[1].replace(/[.,;)]+$/, "") : null;
}

export const citingLink = (p: CitingPaper) =>
  p.doi ? `https://doi.org/${p.doi}` : p.arxiv ? `https://arxiv.org/abs/${p.arxiv}` : p.s2 ? `https://www.semanticscholar.org/paper/${p.s2}` : null;

const STOP = new Set("a an the of in on for to and or with by from at as is are was were be been this that we our its it via into".split(" "));
const words = (t: string) => new Set(t.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length > 2 && !STOP.has(w)));

/** Catalogue records occasionally carry another paper's abstract: a real one shares the title's words. */
export function plausibleAbstract(abstract: string, title: string): boolean {
  if (!abstract) return false;
  const t = words(title);
  if (!t.size) return true;
  const a = words(abstract);
  let hit = 0;
  t.forEach((w) => a.has(w) && hit++);
  return hit >= Math.max(1, Math.round(t.size / 3));
}

/** Sentences of an abstract, numbers first: good starting claims to put on trial or trace. */
export function claimSuggestions(abstract: string, withNumbers = false, title = ""): string[] {
  if (title && !plausibleAbstract(abstract, title)) return [];
  const sents = abstract
    .replace(/\s+/g, " ")
    .split(/(?<=[.!?])\s+(?=[A-Z])/)
    .map((s) => s.trim())
    .filter((s) => s.length >= 40 && s.length <= 400);
  const hasNum = (s: string) => /\d[\d,.]*\s?%|\d{2,}/.test(s);
  const picked = withNumbers ? sents.filter(hasNum) : [...sents.filter(hasNum), ...sents.filter((s) => !hasNum(s))];
  return picked.slice(0, 4);
}

export async function pdfText(file: File): Promise<string> {
  const { pdfjs } = await import("./pdfjs");
  const task = pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) });
  const pdf = await task.promise;
  const pages: string[] = [];
  for (let n = 1; n <= Math.min(pdf.numPages, 80); n++) {
    const content = await (await pdf.getPage(n)).getTextContent();
    pages.push(content.items.map((it) => ("str" in it ? it.str + (it.hasEOL ? "\n" : "") : "")).join(""));
  }
  await task.destroy();
  return pages.join("\n").slice(0, 200_000);
}
