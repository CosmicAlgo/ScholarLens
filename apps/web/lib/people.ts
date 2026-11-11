// Researcher profiles: OpenAlex data plus an optional cited AI brief.

import { API_URL } from "./api";
import { clientId } from "./client-id";

export type Institution = { name: string; country: string | null; id: string };

export type AuthorSummary = {
  id: string;
  name: string;
  orcid: string | null;
  works: number;
  cited_by: number;
  h_index: number | null;
  institutions: Institution[];
  topics: string[];
  last_active: number | null;
};

export type Work = {
  id: string;
  title: string;
  year: number | null;
  date: string | null;
  doi: string | null;
  venue: string;
  cited_by: number;
  retracted: boolean;
  preprint: boolean;
  oa_url: string | null;
  authors: { id: string; name: string }[];
  n_authors: number;
  position: "first" | "middle" | "last" | null;
  abstract: string;
  topic: string | null;
};

export type TopicShift = {
  id: string;
  name: string;
  recent_share: number;
  earlier_share: number;
  trend: "new" | "rising" | "steady" | "fading" | "dropped";
};

export type Profile = Omit<AuthorSummary, "topics"> & {
  i10_index: number | null;
  affiliations: { name: string; from: number; to: number }[];
  yearly: { year: number; works: number; cited_by: number }[];
  topics: TopicShift[];
  recent: Work[];
  most_cited: Work[];
  collaborators: { id: string; name: string; count: number }[];
  open_problems: { text: string; work: string; title: string; year: number | null }[];
  roles: { first: number; middle: number; last: number };
  since: number;
};

export type BriefPoint = { text: string; works: string[] };
export type Brief = {
  agenda: { name: string; summary: string; works: string[] }[];
  direction: BriefPoint | null;
  overlap: BriefPoint[];
  gaps: BriefPoint[];
  read_first: { work: string; why: string }[];
  talking_points: BriefPoint[];
};
export type BriefResult = {
  brief: Brief | null;
  verification: { kept: number; removed: { text: string; where: string; reason: string }[] };
  papers_read: number;
  cached?: boolean;
};

async function req<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, init);
  if (!res.ok) {
    let detail = `Request failed (${res.status})`;
    try {
      const j = await res.json();
      if (typeof j?.detail === "string") detail = j.detail;
    } catch {}
    throw new Error(detail);
  }
  return res.json();
}

export const searchAuthors = (q: string) => req<{ results: AuthorSummary[] }>(`/api/authors?q=${encodeURIComponent(q)}`);
export const fetchProfile = (id: string) => req<Profile>(`/api/authors/${encodeURIComponent(id)}`);
export const fetchBrief = (id: string, idea: string, signal?: AbortSignal) =>
  req<BriefResult>(`/api/authors/${encodeURIComponent(id)}/brief`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Client-Id": clientId() },
    body: JSON.stringify({ idea }),
    signal,
  });
