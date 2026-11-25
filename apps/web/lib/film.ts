// Paper Film: a narrated scene-by-scene explainer of one paper, built from its own text.

import { API_URL } from "./api";
import { authHeaders } from "./account";
import type { DocPassage } from "./docstore";
import { changed } from "./sync-events";

export type FilmLine = { text: string; cites: string[]; page: number };
export type FilmVisual =
  | { type: "title" }
  | { type: "figure"; label: string; caption: string; page: number; cite: string }
  | { type: "stat"; value: string; label: string; cite: string; page: number }
  | { type: "quote"; quote: string; cite: string; page: number }
  | { type: "compare"; bars: { label: string; value: string; number: number; cite: string }[]; label: string; cite: string; page: number }
  | { type: "flow" | "points"; items: string[]; sketch: boolean };
export type FilmScene = {
  kind: "intro" | "problem" | "idea" | "method" | "result" | "limits" | "takeaway";
  heading: string;
  lines: FilmLine[];
  visual: FilmVisual;
};
export type Film = {
  title: string;
  logline: string;
  scenes: FilmScene[];
  figures: { label: string; caption: string; page: number; cite: string }[];
  verification: { lines_kept: number; removed: { scene: string; text: string; reason: string }[] };
  read: { passages: number; parts: number; notes: number };
  cached?: boolean;
};

export async function makeFilm(paper_id: string, title: string, passages?: DocPassage[], signal?: AbortSignal): Promise<Film> {
  const res = await fetch(`${API_URL}/api/film`, {
    method: "POST",
    headers: await authHeaders(),
    body: JSON.stringify({ paper_id, title, passages: (passages || []).slice(0, 600).map((p) => ({ page: p.page, text: p.text.slice(0, 3900) })) }),
    signal,
  });
  if (!res.ok) {
    let detail = `Could not make the film (${res.status}).`;
    try {
      const j = await res.json();
      if (typeof j?.detail === "string") detail = j.detail;
    } catch {}
    throw new Error(detail);
  }
  return res.json();
}

// Films are small; keep the last few on this device so reopening a paper replays instantly
// (and in the account, when signed in).
const KEY = "sl_films_v1";
export type SavedFilms = Record<string, { at: number; film: Film }>;

export function readFilms(): SavedFilms {
  try {
    return JSON.parse(localStorage.getItem(KEY) || "{}") as SavedFilms;
  } catch {
    return {};
  }
}

/** Keeps the 12 most recent. */
export function writeFilms(all: SavedFilms) {
  try {
    const keep = Object.entries(all)
      .sort((a, b) => b[1].at - a[1].at)
      .slice(0, 12);
    localStorage.setItem(KEY, JSON.stringify(Object.fromEntries(keep)));
  } catch {}
}

export function mergeFilms(a: SavedFilms, b: SavedFilms): SavedFilms {
  const out: SavedFilms = { ...b };
  for (const [id, v] of Object.entries(a)) if (!out[id] || out[id].at < v.at) out[id] = v;
  return out;
}

export function savedFilm(id: string): Film | null {
  return readFilms()[id]?.film ?? null;
}

export function saveFilm(id: string, film: Film) {
  writeFilms({ ...readFilms(), [id]: { at: Date.now(), film } });
  changed("films");
}

export function filmScript(film: Film, paperTitle: string): string {
  const out = [`# ${film.title}`, "", `_${film.logline}_`, "", `A Paper Film of “${paperTitle}”. Every line cites the page it comes from.`, ""];
  film.scenes.forEach((s, i) => {
    out.push(`## ${i + 1}. ${s.heading}`, "");
    s.lines.forEach((l) => out.push(`${l.text} (p. ${l.page})`));
    out.push("");
  });
  return out.join("\n");
}
