"use client";

// The paper's own figure: pdf.js renders the page, finds where the caption is printed, and the film
// shows the region the caption belongs to (above it for figures, below it for tables). If the caption
// cannot be located, the whole page is shown. Loaded only in the browser.
import { useEffect, useState } from "react";
import { pdfjs } from "@/lib/pdfjs";

type Item = { str: string; transform: number[]; width: number; height: number };

function findCaption(items: Item[], label: string) {
  const [kind, num] = label.split(" ");
  const head = kind === "Table" ? /^table$|^table\s*\d/i : /^fig(ure)?\.?$|^fig(ure)?\.?\s*\d/i;
  for (let i = 0; i < items.length; i++) {
    const s = items[i].str.trim();
    if (!head.test(s)) continue;
    const joined = (s + " " + (items[i + 1]?.str ?? "") + (items[i + 2]?.str ?? "")).replace(/\s+/g, " ");
    if (new RegExp(`^(fig(ure)?\\.?|table)\\s*${num}\\s*[:.|]`, "i").test(joined)) return items[i];
  }
  return null;
}

export default function FilmFigure({ file, page, label }: { file: string | { data: Uint8Array }; page: number; label: string }) {
  const [src, setSrc] = useState<string | null>(null);
  const [state, setState] = useState<"loading" | "ok" | "error">("loading");

  useEffect(() => {
    let live = true;
    const source = typeof file === "string" ? { url: file } : { data: new Uint8Array(file.data.slice(0)) };
    const task = pdfjs.getDocument({ ...source, disableRange: true, disableStream: true });
    (async () => {
      try {
        const doc = await task.promise;
        const pg = await doc.getPage(page);
        const vp = pg.getViewport({ scale: 2 });
        const full = document.createElement("canvas");
        full.width = vp.width;
        full.height = vp.height;
        await pg.render({ canvasContext: full.getContext("2d")!, viewport: vp, canvas: full }).promise;
        const items: Item[] = (await pg.getTextContent()).items.flatMap((x) =>
          "str" in x ? [{ str: x.str, transform: x.transform as number[], width: x.width, height: x.height }] : [],
        );
        const cap = findCaption(items, label);
        const W = vp.width;
        const H = vp.height;
        let crop = { x: 0, y: 0, w: W, h: H };
        if (cap) {
          const [cx, cy] = vp.convertToViewportPoint(cap.transform[4], cap.transform[5]);
          // Which column: captions starting right of the middle belong to the right column; a caption line
          // that stays left of the middle belongs to the left column; otherwise the figure spans the page.
          const sameLine = items.filter((x) => Math.abs(x.transform[5] - cap.transform[5]) < 2);
          const lineEnd = Math.max(...sameLine.map((x) => vp.convertToViewportPoint(x.transform[4] + x.width, x.transform[5])[0]));
          const [x0, x1] = cx > W * 0.48 ? [W * 0.48, W] : lineEnd < W * 0.55 ? [0, W * 0.53] : [0, W];
          const [y0, y1] = label.startsWith("Table") ? [cy - H * 0.03, cy + H * 0.45] : [cy - H * 0.5, cy + H * 0.07];
          crop = { x: x0, y: Math.max(0, y0), w: x1 - x0, h: Math.min(H, y1) - Math.max(0, y0) };
        }
        if (!live) return;
        const out = document.createElement("canvas");
        out.width = crop.w;
        out.height = crop.h;
        out.getContext("2d")!.drawImage(full, crop.x, crop.y, crop.w, crop.h, 0, 0, crop.w, crop.h);
        setSrc(out.toDataURL("image/jpeg", 0.9));
        setState("ok");
      } catch {
        if (live) setState("error");
      }
    })();
    return () => {
      live = false;
      task.destroy();
    };
  }, [file, page, label]);

  return (
    <div className="relative w-full h-full overflow-hidden">
      {state === "loading" && <p className="p-4 text-sm text-white/60">Opening the figure…</p>}
      {state === "error" && <p className="p-4 text-sm text-white/60">Could not open this page.</p>}
      {src && (
        <div className="film-drift absolute inset-0">
          {/* eslint-disable-next-line @next/next/no-img-element -- a locally rendered page region, not a remote image */}
          <img src={src} alt={`${label} from page ${page} of the paper`} className="absolute inset-0 w-full h-full object-contain drop-shadow-2xl" />
        </div>
      )}
    </div>
  );
}
