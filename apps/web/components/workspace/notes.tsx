"use client";

import { useState } from "react";
import type { Highlight, OpenPaper } from "@/lib/workspace";
import { download, notesMarkdown, toBibtex } from "@/lib/workspace";

const DOT: Record<Highlight["color"], string> = {
  yellow: "bg-yellow-400",
  blue: "bg-blue-500",
  green: "bg-green-500",
  pink: "bg-pink-500",
};

export function Notes({
  highlights,
  papers,
  onOpen,
  onAsk,
  onDelete,
  onNote,
}: {
  highlights: Highlight[];
  papers: OpenPaper[];
  onOpen: (h: Highlight) => void;
  onAsk: (h: Highlight) => void;
  onDelete: (id: string) => void;
  onNote: (id: string, note: string) => void;
}) {
  const [editing, setEditing] = useState<string | null>(null);
  const sorted = [...highlights].sort((a, b) => b.at - a.at);
  const catalog = papers.filter((p) => !p.id.startsWith("U"));

  return (
    <div className="h-full flex flex-col min-h-0">
      <div className="flex flex-wrap gap-2 p-3 border-b border-line">
        <button
          disabled={!highlights.length}
          onClick={() => download("scholarlens-notes.md", notesMarkdown(highlights), "text/markdown")}
          className="rounded-lg border border-line px-2.5 h-8 text-xs hover:border-ink-3 disabled:opacity-40"
        >
          Export notes (.md)
        </button>
        <button
          disabled={!catalog.length}
          onClick={() => download("scholarlens.bib", toBibtex(catalog), "application/x-bibtex")}
          className="rounded-lg border border-line px-2.5 h-8 text-xs hover:border-ink-3 disabled:opacity-40"
          title="BibTeX for the open papers"
        >
          BibTeX ({catalog.length})
        </button>
      </div>
      <div className="flex-1 overflow-y-auto min-h-0">
        {!sorted.length && (
          <p className="p-4 text-sm text-ink-3">
            Select text in a PDF and pick a colour to highlight it. Highlights and your notes collect here, and Copilot can
            answer questions about any of them.
          </p>
        )}
        <ul className="divide-y divide-line">
          {sorted.map((h) => (
            <li key={h.id} className="px-4 py-3 group">
              <button onClick={() => onOpen(h)} className="w-full text-left">
                <div className="flex items-center gap-2 text-[0.68rem] text-ink-3">
                  <span className={`w-2 h-2 rounded-full ${DOT[h.color]}`} />
                  <span className="truncate">{h.title}</span>
                  <span className="ml-auto font-mono shrink-0">p.{h.page}</span>
                </div>
                <p className="mt-1 text-sm text-ink-2 line-clamp-4 border-l-2 border-line pl-2">{h.text}</p>
              </button>
              {editing === h.id ? (
                <textarea
                  autoFocus
                  defaultValue={h.note}
                  onBlur={(e) => {
                    onNote(h.id, e.target.value.trim());
                    setEditing(null);
                  }}
                  rows={3}
                  placeholder="Your note…"
                  className="mt-2 w-full rounded-lg border border-line bg-bg px-2 py-1.5 text-sm outline-none focus:border-accent"
                />
              ) : (
                h.note && <p className="mt-2 text-sm text-ink whitespace-pre-wrap">{h.note}</p>
              )}
              <div className="mt-2 flex gap-3 text-[0.7rem] text-ink-3">
                <button onClick={() => onAsk(h)} className="hover:text-accent-ink">
                  Ask Copilot
                </button>
                <button onClick={() => setEditing(h.id)} className="hover:text-ink">
                  {h.note ? "Edit note" : "Add note"}
                </button>
                <button onClick={() => onDelete(h.id)} className="hover:text-bad ml-auto">
                  Delete
                </button>
              </div>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
