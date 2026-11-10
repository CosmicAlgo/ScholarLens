// PDFs the user brings (uploads, or a copy attached to a paywalled paper) stay in this browser.
// The file and its extracted passages live in IndexedDB; Copilot receives only the passages it
// needs, per request, and the server keeps nothing.

export type DocPassage = { page: number; text: string };
export type StoredDoc = { id: string; title: string; data: ArrayBuffer; passages: DocPassage[]; pages: number; at: number };

const DB = "scholarlens";
const STORE = "docs";

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE, { keyPath: "id" });
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function tx<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await open();
  return new Promise((resolve, reject) => {
    const req = fn(db.transaction(STORE, mode).objectStore(STORE));
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export const putDoc = (d: StoredDoc) => tx("readwrite", (s) => s.put(d));
export const getDoc = (id: string) => tx<StoredDoc | undefined>("readonly", (s) => s.get(id)).catch(() => undefined);
export const deleteDoc = (id: string) => tx("readwrite", (s) => s.delete(id)).catch(() => undefined);

/** Stable id for an uploaded file: "U" + 12 hex chars of its SHA-256. */
export async function docId(data: ArrayBuffer): Promise<string> {
  const hash = new Uint8Array(await crypto.subtle.digest("SHA-256", data));
  return "U" + [...hash.slice(0, 6)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** Split page texts into ~900-character passages on sentence ends (same rule as the server). */
export function splitPassages(pages: string[], size = 900): DocPassage[] {
  const out: DocPassage[] = [];
  pages.forEach((raw, i) => {
    const text = raw.replace(/-\n(?=[a-z])/g, "").replace(/\s+/g, " ").trim();
    if (text.length < 40) return;
    let cur = "";
    for (const sent of text.split(/(?<=[.!?])\s+/)) {
      if (cur && cur.length + sent.length > size) {
        out.push({ page: i + 1, text: cur.trim() });
        cur = "";
      }
      cur += sent + " ";
    }
    if (cur.trim().length >= 40) out.push({ page: i + 1, text: cur.trim().slice(0, 3900) });
  });
  return out.map((p) => ({ ...p, text: p.text.slice(0, 3900) }));
}

/** Read a PDF in the browser: title (from metadata or first line), page count and passages. */
export async function readPdf(data: ArrayBuffer, fallbackTitle: string) {
  const { pdfjs } = await import("./pdfjs");
  const task = pdfjs.getDocument({ data: new Uint8Array(data.slice(0)) });
  const pdf = await task.promise;
  const pages: string[] = [];
  for (let n = 1; n <= Math.min(pdf.numPages, 120); n++) {
    const page = await pdf.getPage(n);
    const content = await page.getTextContent();
    pages.push(
      content.items
        .map((it) => ("str" in it ? it.str + (it.hasEOL ? "\n" : "") : ""))
        .join("")
        .trim(),
    );
  }
  let title = fallbackTitle.replace(/\.pdf$/i, "");
  try {
    const meta = (await pdf.getMetadata()).info as { Title?: string };
    if (meta?.Title && meta.Title.trim().length > 8) title = meta.Title.trim();
  } catch {}
  const numPages = pdf.numPages;
  await task.destroy();
  return { title, pages: numPages, passages: splitPassages(pages) };
}

const CAPTION = /\b(fig\.?|figure|table)\s*\d+/i;

/** Pages of an uploaded PDF that mention a figure or table caption (first `limit`). */
export function figurePages(passages: DocPassage[], limit = 6): number[] {
  const pages: number[] = [];
  for (const p of passages) if (CAPTION.test(p.text) && !pages.includes(p.page)) pages.push(p.page);
  return pages.slice(0, limit);
}

/** Render pages to JPEG in the browser (for figure reading on PDFs that never leave this device). */
export async function renderPages(
  data: ArrayBuffer,
  pages: number[],
  width = 1240,
): Promise<{ page: number; data: string; text: string }[]> {
  const { pdfjs } = await import("./pdfjs");
  const task = pdfjs.getDocument({ data: new Uint8Array(data.slice(0)) });
  const pdf = await task.promise;
  const out: { page: number; data: string; text: string }[] = [];
  try {
    for (const n of pages) {
      if (n < 1 || n > pdf.numPages) continue;
      const page = await pdf.getPage(n);
      const vp1 = page.getViewport({ scale: 1 });
      const viewport = page.getViewport({ scale: width / vp1.width });
      const canvas = document.createElement("canvas");
      canvas.width = Math.round(viewport.width);
      canvas.height = Math.round(viewport.height);
      const ctx = canvas.getContext("2d")!;
      ctx.fillStyle = "#fff";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      await page.render({ canvas, canvasContext: ctx, viewport }).promise;
      // Page text with line breaks, so the server can check figure labels against printed captions.
      const content = await page.getTextContent();
      const text = content.items
        .map((it) => ("str" in it ? it.str + (it.hasEOL ? "\n" : "") : ""))
        .join("")
        .slice(0, 19000);
      out.push({ page: n, data: canvas.toDataURL("image/jpeg", 0.82).split(",")[1], text });
    }
  } finally {
    await task.destroy();
  }
  return out;
}

/** Crop a region (fractions of the page) out of a rendered page canvas, as base64 JPEG. */
export function cropCanvas(canvas: HTMLCanvasElement, r: { x: number; y: number; w: number; h: number }, max = 1600): string {
  const sx = r.x * canvas.width, sy = r.y * canvas.height, sw = r.w * canvas.width, sh = r.h * canvas.height;
  const scale = Math.min(1, max / Math.max(sw, sh));
  const out = document.createElement("canvas");
  out.width = Math.max(1, Math.round(sw * scale));
  out.height = Math.max(1, Math.round(sh * scale));
  const ctx = out.getContext("2d")!;
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, out.width, out.height);
  ctx.drawImage(canvas, sx, sy, sw, sh, 0, 0, out.width, out.height);
  return out.toDataURL("image/jpeg", 0.85).split(",")[1];
}

export const allDocs = () => tx<StoredDoc[]>("readonly", (s) => s.getAll()).catch(() => [] as StoredDoc[]);

/** Ask the browser not to evict our storage. Returns whether storage is now persistent. */
export async function keepStorage(): Promise<boolean> {
  try {
    if (await navigator.storage?.persisted?.()) return true;
    return (await navigator.storage?.persist?.()) ?? false;
  } catch {
    return false;
  }
}
