// Server-side cached reads. Trend counts come from OpenAlex aggregations that move slowly,
// so pages can be cached for hours; the API itself caches OpenAlex for a week.

import { cacheLife } from "next/cache";
import { ApiError, fetchCompare, fetchPaper, fetchSearch, fetchTrend } from "./api";

export async function getTrend(q: string) {
  "use cache";
  cacheLife("hours");
  return fetchTrend(q);
}

export async function getSearch(q: string, limit = 12) {
  "use cache";
  cacheLife("hours");
  return fetchSearch(q, limit);
}

export async function getCompare(topics: string[]) {
  "use cache";
  cacheLife("hours");
  return fetchCompare(topics);
}

export async function getPaper(id: string) {
  "use cache";
  cacheLife("days");
  try {
    return await fetchPaper(id);
  } catch (e) {
    if (e instanceof ApiError && e.status === 404) return null; // cacheable "not found"
    throw e;
  }
}

// Errors thrown out of a cached function lose their class, so read the message structurally.
export const errorMessage = (e: unknown, fallback: string) =>
  e && typeof e === "object" && "message" in e && typeof e.message === "string" && e.message ? e.message : fallback;
