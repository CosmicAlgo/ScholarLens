"use client";

import type { MatrixRow, OpenPaper } from "@/lib/workspace";
import { download, MATRIX_COLUMNS } from "@/lib/workspace";

export function Matrix({
  papers,
  rows,
  status,
  onFill,
  openPage,
}: {
  papers: OpenPaper[];
  rows: Record<string, MatrixRow>;
  status: Record<string, "loading" | string>;
  onFill: (ids: string[]) => void;
  openPage: (id: string, page: number, text?: string) => void;
}) {
  const missing = papers.filter((p) => !rows[p.id] && status[p.id] !== "loading").map((p) => p.id);
  const filled = papers.filter((p) => rows[p.id]?.row);

  function csv() {
    const q = (s: string) => `"${s.replace(/"/g, '""')}"`;
    const head = ["Paper", "Year", "Source", ...MATRIX_COLUMNS.map((c) => c.label)].map(q).join(",");
    const body = filled.map((p) => {
      const r = rows[p.id];
      return [p.title, String(p.year ?? ""), r.source, ...MATRIX_COLUMNS.map((c) => r.row![c.key].text)].map(q).join(",");
    });
    download("evidence-matrix.csv", [head, ...body].join("\n"), "text/csv");
  }

  return (
    <div className="h-full flex flex-col min-h-0">
      <div className="flex flex-wrap items-center gap-2 px-4 py-3 border-b border-line bg-surface">
        <div className="min-w-0">
          <h2 className="font-semibold">Evidence matrix</h2>
          <p className="text-xs text-ink-3">One row per open paper. Every cell links to the page it came from.</p>
        </div>
        <span className="flex-1" />
        {missing.length > 0 && (
          <button onClick={() => onFill(missing)} className="rounded-lg bg-accent text-white px-3 h-8 text-xs font-medium">
            Fill {missing.length} row{missing.length > 1 ? "s" : ""}
          </button>
        )}
        {filled.length > 0 && (
          <button onClick={csv} className="rounded-lg border border-line px-3 h-8 text-xs hover:border-ink-3">
            Export CSV
          </button>
        )}
      </div>
      <div className="flex-1 min-h-0 overflow-auto">
        <table className="text-xs border-collapse min-w-[56rem] w-full">
          <thead className="sticky top-0 bg-surface z-10">
            <tr>
              <th className="text-left font-semibold text-ink-2 border-b border-line px-3 py-2 w-48">Paper</th>
              {MATRIX_COLUMNS.map((c) => (
                <th key={c.key} className="text-left font-semibold text-ink-2 border-b border-line px-3 py-2">
                  {c.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {papers.map((p) => {
              const r = rows[p.id];
              const st = status[p.id];
              return (
                <tr key={p.id} className="align-top">
                  <td className="border-b border-line px-3 py-2.5">
                    <div className="font-medium text-ink line-clamp-3">{p.title}</div>
                    <div className="mt-1 text-ink-3">
                      {p.year ?? ""}
                      {r && <span className="ml-1">· {r.source === "abstract" ? "abstract only" : r.source === "uploaded" ? "your PDF" : "full text"}</span>}
                    </div>
                  </td>
                  {MATRIX_COLUMNS.map((c) => (
                    <td key={c.key} className="border-b border-line px-3 py-2.5 text-ink-2 leading-relaxed">
                      {r?.row ? (
                        <>
                          {r.row[c.key].text}{" "}
                          {r.row[c.key].uncited && (
                            <span
                              className="inline-flex mx-0.5 rounded px-1 text-[0.65rem] font-medium bg-warn-soft text-warn"
                              title="The model gave no valid source for this cell. Treat it as unverified, or refill the row."
                            >
                              ⚠ no source
                            </span>
                          )}
                          {(r.row[c.key].unsupported_numbers || []).length > 0 && (
                            <span
                              className="inline-flex mx-0.5 rounded px-1 text-[0.65rem] font-medium bg-warn-soft text-warn"
                              title={`Not found in the cited passages: ${r.row[c.key].unsupported_numbers!.join(", ")}. Check the page.`}
                            >
                              ⚠ {r.row[c.key].unsupported_numbers!.join(", ")}
                            </span>
                          )}
                          {r.row[c.key].cites.map((id) => {
                            const ev = r.evidence.find((e) => e.id === id);
                            if (!ev) return null;
                            return (
                              <button
                                key={id}
                                onClick={() => ev.page && openPage(p.id, ev.page, ev.text)}
                                title={ev.text.slice(0, 280)}
                                className="inline-flex mx-0.5 rounded px-1 text-[0.65rem] font-medium bg-accent-soft text-accent-ink hover:bg-accent hover:text-white"
                              >
                                {ev.page ? `p.${ev.page}` : "abs"}
                              </button>
                            );
                          })}
                        </>
                      ) : st === "loading" ? (
                        <span className="block h-3 rounded bg-surface-2 animate-pulse" />
                      ) : st ? (
                        c.key === "problem" && <span className="text-bad">{st}</span>
                      ) : r && !r.row ? (
                        c.key === "problem" && <span className="text-ink-3">Nothing to extract.</span>
                      ) : (
                        <span className="text-ink-3">·</span>
                      )}
                    </td>
                  ))}
                </tr>
              );
            })}
          </tbody>
        </table>
        <p className="px-4 py-3 text-[0.68rem] text-ink-3">
          Cells are AI-extracted from the retrieved passages; click a page chip to check the source. Each row uses one Copilot
          message from your daily allowance.
        </p>
      </div>
    </div>
  );
}
