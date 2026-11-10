"use client";

// Workspace backup: one file with the open papers, notes, highlights, reading list, matrix and the
// user's own PDFs. Nothing leaves the device unless the user moves the file. Restoring merges into
// the current workspace, so it never wipes work.

import { allDocs, putDoc, type StoredDoc } from "./docstore";
import { getWS, setWS } from "./store";
import { download, type WorkspaceState } from "./workspace";

const toB64 = (buf: ArrayBuffer) => {
  let s = "";
  const bytes = new Uint8Array(buf);
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
};
const fromB64 = (b64: string) => Uint8Array.from(atob(b64), (c) => c.charCodeAt(0)).buffer;

export async function exportWorkspace() {
  const docs = await allDocs();
  const state = getWS();
  const file = {
    app: "scholarlens",
    version: 1,
    exported_at: new Date().toISOString(),
    state: { ...state, messages: state.messages.slice(-40) },
    docs: docs.map((d) => ({ ...d, data: toB64(d.data) })),
  };
  const name = `scholarlens-backup-${new Date().toISOString().slice(0, 10)}.json`;
  download(name, JSON.stringify(file), "application/json");
  return { papers: state.papers.length, pdfs: docs.length };
}

const byId = <T extends { id: string }>(a: T[], b: T[]) => [...a, ...b.filter((x) => !a.some((y) => y.id === x.id))];

export async function importWorkspace(f: File): Promise<{ papers: number; pdfs: number }> {
  const raw = JSON.parse(await f.text());
  if (raw?.app !== "scholarlens" || !raw.state) throw new Error("That file is not a ScholarLens backup.");
  const docs = (raw.docs || []) as (Omit<StoredDoc, "data"> & { data: string })[];
  for (const d of docs) await putDoc({ ...d, data: fromB64(d.data) });
  const inc = raw.state as WorkspaceState;
  setWS((c) => ({
    ...c,
    papers: byId(c.papers, inc.papers || []).slice(-5),
    highlights: byId(c.highlights, inc.highlights || []),
    queue: byId(c.queue, inc.queue || []),
    recent: byId(c.recent, inc.recent || []).slice(0, 30),
    matrix: { ...(inc.matrix || {}), ...c.matrix },
    figures: { ...(inc.figures || {}), ...c.figures },
    messages: c.messages.length ? c.messages : (inc.messages || []).map((m) => (m.role === "assistant" ? { ...m, done: true } : m)),
  }));
  return { papers: (inc.papers || []).length, pdfs: docs.length };
}
