"use client";

import { useState } from "react";
import { ClaimCourt } from "@/components/verify/claim-court";
import { RefCheck } from "@/components/verify/ref-check";
import { Telephone } from "@/components/verify/telephone";

type Tool = "check" | "court" | "telephone";

const TOOLS: { id: Tool; name: string; icon: string; pitch: string }[] = [
  { id: "check", name: "Citation Check", icon: "✓", pitch: "Are these references real, right and not retracted?" },
  { id: "court", name: "Claim Court", icon: "⚖", pitch: "Who supports a claim, and who disputes it?" },
  { id: "telephone", name: "Citation Telephone", icon: "☎", pitch: "Did a number change as papers repeated it?" },
];

export function VerifyClient({
  initialTool,
  initialPaper,
  initialClaim,
}: {
  initialTool: Tool;
  initialPaper: string;
  initialClaim: string;
}) {
  const [tool, setTool] = useState<Tool>(initialTool);
  const choose = (t: Tool) => {
    setTool(t);
    const url = new URL(window.location.href);
    url.search = t === "check" ? "" : `?tool=${t}`;
    window.history.replaceState(null, "", url);
  };
  return (
    <div className="pb-20">
      <div role="tablist" aria-label="Verification tools" className="grid sm:grid-cols-3 gap-2">
        {TOOLS.map((t) => {
          const on = t.id === tool;
          return (
            <button
              key={t.id}
              role="tab"
              aria-selected={on}
              onClick={() => choose(t.id)}
              className={`text-left rounded-2xl border p-4 transition-colors ${
                on ? "border-accent bg-accent-soft" : "border-line bg-surface hover:border-ink-3"
              }`}
            >
              <span className="flex items-center gap-2">
                <span
                  className={`w-8 h-8 rounded-lg grid place-items-center text-base ${on ? "bg-accent text-white" : "bg-surface-2 text-ink-2"}`}
                  aria-hidden="true"
                >
                  {t.icon}
                </span>
                <span className={`font-semibold ${on ? "text-accent-ink" : ""}`}>{t.name}</span>
              </span>
              <span className="mt-2 block text-sm text-ink-2 leading-snug">{t.pitch}</span>
            </button>
          );
        })}
      </div>
      <div className="mt-6">
        {tool === "check" && <RefCheck />}
        {tool === "court" && <ClaimCourt initialPaper={initialTool === "court" ? initialPaper : ""} initialClaim={initialTool === "court" ? initialClaim : ""} />}
        {tool === "telephone" && (
          <Telephone initialPaper={initialTool === "telephone" ? initialPaper : ""} initialClaim={initialTool === "telephone" ? initialClaim : ""} />
        )}
      </div>
    </div>
  );
}
