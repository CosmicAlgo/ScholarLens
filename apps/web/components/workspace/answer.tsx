"use client";

import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { EvidenceItem } from "@/lib/workspace";

const CITE = /\[((?:[SPMCHF]):[^\]\s]+)\]/g;

export type CiteHandlers = {
  openPage: (paperId: string, page: number, text?: string) => void;
  openPaper: (paperId: string) => void;
};

/** Markdown answer where every [S:…]/[P:…]/[M:…] citation becomes a clickable chip. */
export function Answer({ text, evidence, invalid, h }: { text: string; evidence: EvidenceItem[]; invalid: string[]; h: CiteHandlers }) {
  const byId = new Map(evidence.map((e) => [e.id, e]));
  // Rewrite citations as in-page links that the custom <a> renderer turns into chips.
  const md = text.replace(CITE, (_, id: string) => ` [${id}](#cite-${encodeURIComponent(id)})`);

  return (
    <div className="answer text-[0.92rem] leading-relaxed text-ink">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          a: ({ href, children }) => {
            if (href?.startsWith("#cite-")) {
              const id = decodeURIComponent(href.slice(6));
              return <Chip id={id} e={byId.get(id)} bad={invalid.includes(id) || !byId.has(id)} h={h} />;
            }
            return (
              <a href={href} target="_blank" rel="noreferrer" className="text-accent-ink underline">
                {children}
              </a>
            );
          },
          table: ({ children }) => (
            <div className="overflow-x-auto my-3">
              <table className="w-full text-xs border-collapse">{children}</table>
            </div>
          ),
          th: ({ children }) => <th className="text-left font-medium text-ink-2 border-b border-line py-1.5 pr-3">{children}</th>,
          td: ({ children }) => <td className="border-b border-line py-1.5 pr-3 align-top">{children}</td>,
          h1: ({ children }) => <h3 className="font-semibold text-base mt-4 mb-1.5">{children}</h3>,
          h2: ({ children }) => <h3 className="font-semibold text-base mt-4 mb-1.5">{children}</h3>,
          h3: ({ children }) => <h4 className="font-semibold mt-3 mb-1">{children}</h4>,
          ul: ({ children }) => <ul className="list-disc pl-5 space-y-1 my-2">{children}</ul>,
          ol: ({ children }) => <ol className="list-decimal pl-5 space-y-1 my-2">{children}</ol>,
          p: ({ children }) => <p className="my-2">{children}</p>,
          hr: () => <hr className="my-3 border-line" />,
          code: ({ children }) => <code className="font-mono text-[0.85em] bg-surface-2 rounded px-1">{children}</code>,
        }}
      >
        {md}
      </ReactMarkdown>
    </div>
  );
}

function Chip({ id, e, bad, h }: { id: string; e?: EvidenceItem; bad: boolean; h: CiteHandlers }) {
  if (bad || !e) {
    return (
      <span
        className="inline-flex align-baseline mx-0.5 rounded px-1 text-[0.7rem] font-mono bg-bad-soft text-bad line-through"
        title="The verifier could not find this source in the evidence; treat the sentence with caution."
      >
        unverified
      </span>
    );
  }
  let label = "source";
  let title = "";
  let onClick = () => {};
  if (e.kind === "passage" || e.kind === "highlight") {
    label = e.kind === "highlight" ? (e.figure ? `your figure, p.${e.page}` : `your highlight, p.${e.page}`) : `p.${e.page}`;
    title = `${e.title}, page ${e.page}:\n“${e.text.slice(0, 280)}…”`;
    onClick = () => h.openPage(e.paper_id, e.page, e.figure ? undefined : e.text);
  } else if (e.kind === "figure") {
    label = `${e.label === "unlabelled" ? "figure" : e.label.replace(/^figure/i, "Fig.")}, p.${e.page}`;
    title = `AI reading of ${e.label} (page ${e.page} of ${e.title}):\n${e.text.slice(0, 400)}`;
    onClick = () => h.openPage(e.paper_id, e.page, e.caption ?? undefined);
  } else if (e.kind === "paper") {
    const who = e.authors[0]?.split(" ").at(-1) || "paper";
    label = `${who}${e.year ? ` ’${String(e.year).slice(2)}` : ""}`;
    title = `${e.title}${e.flags.length ? ` [${e.flags.join(", ")}]` : ""}`;
    onClick = () => h.openPaper(id.slice(2));
  } else if (e.kind === "metric") {
    label = "data";
    title = `${e.label} (${e.topic}): ${e.value}`;
  }
  const flagged = e.kind === "paper" && e.flags.includes("preprint");
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      className={`inline-flex align-baseline mx-0.5 rounded px-1.5 text-[0.7rem] font-medium leading-5 transition-colors ${
        e.kind === "passage" || e.kind === "highlight"
          ? "bg-accent-soft text-accent-ink hover:bg-accent hover:text-white"
          : e.kind === "figure"
            ? "bg-vision-soft text-vision hover:bg-vision hover:text-white"
          : e.kind === "paper"
            ? `${flagged ? "bg-warn-soft text-warn" : "bg-surface-2 text-ink-2"} hover:bg-ink hover:text-bg`
            : "bg-good-soft text-good"
      }`}
    >
      {label}
    </button>
  );
}
