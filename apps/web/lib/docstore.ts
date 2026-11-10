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
