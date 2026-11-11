// Typed client for the ScholarLens API (services/api).

export const API_URL = (process.env.NEXT_PUBLIC_API_URL || "http://127.0.0.1:8000").replace(/\/$/, "");

export type TrendLabel = "surging" | "growing" | "stable" | "cooling" | "declining" | "peaked" | "insufficient_data";

export type YearPoint = {
  year: number;
  count: number;
  baseline: number;
  share_per_million: number;
  partial: boolean;
};

export type Trend = {
  query: string;
  label: TrendLabel;
  annual_growth: number | null;
  recent_growth: number | null;
  fit_r2: number | null;
  baseline_growth: number | null;
  total_papers: number;
  peak_year: number | null;
  points: YearPoint[];
  sense?: Sense | null;
};

/** Which meaning of a topic name was counted: OpenAlex field of each paper's primary topic. */
export type Sense = {
  field: string | null;
  name: string;
  auto: boolean;
  note: string;
  options: { id: string; name: string; share: number }[];
};

export type Paper = {
  id: string;
  title: string;
  year: number | null;
  venue: string | null;
  doi: string | null;
  abstract: string | null;
  cited_by_count: number;
  is_retracted: boolean;
  is_preprint: boolean;
  is_oa: boolean;
  oa_url: string | null;
  authors: string[];
  score?: number;
  topic?: string | null;
};

export type Claim = { text: string; evidence: string[] };
export type Report = {
  title: string;
  tldr: Claim[];
  sections: { heading: string; claims: Claim[] }[];
  caveats: string[];
};
export type Verification = {
  claims_total: number;
  claims_kept: number;
  removed: { text: string; reason: "no_evidence" | "unknown_evidence" }[];
  retracted_citations_removed: string[];
};
export type Evidence =
  | {
      id: string;
      kind: "paper";
      title: string;
      year: number | null;
      venue: string | null;
      authors: string[];
      cited_by: number;
      flags: string[];
      doi: string | null;
    }
  | { id: string; kind: "metric"; topic: string; label: string; value: string | number | null }
  | {
      id: string;
      kind: "cluster";
      topic: string;
      name: string;
      summary: string;
      size: number;
      median_year: number | null;
      emergence: number;
      emerging: boolean;
      representative: string[];
    };

export type Cluster = Extract<Evidence, { kind: "cluster" }>;

export type RunResult = {
  plan: { in_scope: boolean; topics: { key: string; label: string; query: string }[] } | null;
  report: Report | null;
  verification: Verification | null;
  trends: Record<string, { label: string; result: Trend; insight: { statements: Claim[] } }> | null;
  landscapes: Record<string, Cluster[]>;
  trust: { papers_checked: number; retracted: string[]; preprints: string[]; preprint_share: number; note: string } | null;
  evidence: Record<string, Evidence> | null;
  stopped: string | null;
};

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

async function get<T>(path: string): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, { headers: { Accept: "application/json" } });
  if (!res.ok) {
    let detail = `Request failed (${res.status})`;
    try {
      const body = await res.json();
      if (typeof body?.detail === "string") detail = body.detail;
    } catch {}
    throw new ApiError(res.status, detail);
  }
  return res.json() as Promise<T>;
}

export const fetchTrend = (q: string) => get<Trend>(`/api/trend?q=${encodeURIComponent(q)}`);

export const fetchCompare = (topics: string[], senses: string[] = []) =>
  get<{ topics: Trend[] }>(
    `/api/compare?${topics.map((t, i) => `q=${encodeURIComponent(t)}&sense=${encodeURIComponent(senses[i] || "auto")}`).join("&")}`,
  );

export type Interpretation = { corrected: string; searches: string[]; note: string };
export const fetchSearch = (q: string, limit = 20, smart = false) =>
  get<{ query: string; interpreted?: Interpretation | null; results: Paper[] }>(
    `/api/search?q=${encodeURIComponent(q)}&limit=${limit}${smart ? "&smart=true" : ""}`,
  );

export const fetchPaper = (id: string) => get<Paper>(`/api/papers/${encodeURIComponent(id)}`);

// Topic URLs: "retrieval augmented generation" <-> /topic/retrieval-augmented-generation.
// OpenAlex full-text search splits on hyphens, so "k-means" and "k means" match the same works.
export const topicSlug = (q: string) =>
  encodeURIComponent(q.trim().toLowerCase().replace(/\s+/g, "-"));
export const topicFromSlug = (slug: string) => decodeURIComponent(slug).replace(/-/g, " ").trim();
