import type { TrendLabel } from "./api";

export const pct = (x: number | null | undefined, digits = 0) =>
  x == null ? "n/a" : `${x >= 0 ? "+" : "−"}${Math.abs(x * 100).toFixed(digits)}%`;

export const num = (n: number | null | undefined) => (n == null ? "n/a" : n.toLocaleString("en-GB"));

export const compact = (n: number) =>
  new Intl.NumberFormat("en-GB", { notation: "compact", maximumFractionDigits: 1 }).format(n);

type LabelInfo = { text: string; arrow: string; tone: "good" | "warn" | "bad" | "neutral"; blurb: string };

export const LABELS: Record<TrendLabel, LabelInfo> = {
  surging: { text: "Surging", arrow: "↑↑", tone: "good", blurb: "Share of all research is rising fast." },
  growing: { text: "Growing", arrow: "↑", tone: "good", blurb: "Gaining share faster than science overall." },
  stable: { text: "Stable", arrow: "→", tone: "neutral", blurb: "Holding a steady share of research." },
  cooling: { text: "Cooling", arrow: "↘", tone: "warn", blurb: "Was growing; momentum has slowed recently." },
  declining: { text: "Declining", arrow: "↓", tone: "bad", blurb: "Losing share of all research." },
  peaked: { text: "Peaked", arrow: "⌒", tone: "warn", blurb: "Rose, hit a high, and is now falling back." },
  insufficient_data: { text: "Too few papers", arrow: "·", tone: "neutral", blurb: "Not enough papers to call a trend." },
};
