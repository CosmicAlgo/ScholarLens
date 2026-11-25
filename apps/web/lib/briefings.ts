"use client";

// Saved Briefings: the last few cited reports, kept in this browser (and synced when signed in).

import type { RunResult } from "./api";
import { changed } from "./sync-events";

export const SAVED_KEY = "sl_briefings_v1";
export type SavedBriefing = { q: string; at: number; result: RunResult };

export function loadSaved(): SavedBriefing[] {
  try {
    return JSON.parse(localStorage.getItem(SAVED_KEY) || "[]");
  } catch {
    return [];
  }
}

export function writeSaved(list: SavedBriefing[]) {
  try {
    localStorage.setItem(SAVED_KEY, JSON.stringify(list));
  } catch {}
}

export function saveBriefing(q: string, result: RunResult) {
  writeSaved([{ q, at: Date.now(), result }, ...loadSaved().filter((s) => s.q !== q)].slice(0, 8));
  changed("briefings");
}

/** Newest copy of each question wins; the eight most recent are kept. */
export function mergeBriefings(a: SavedBriefing[], b: SavedBriefing[]): SavedBriefing[] {
  const best = new Map<string, SavedBriefing>();
  for (const s of [...a, ...b]) if (!best.has(s.q) || best.get(s.q)!.at < s.at) best.set(s.q, s);
  return [...best.values()].sort((x, y) => y.at - x.at).slice(0, 8);
}
