import Link from "next/link";
import type { Paper, Trend, TrendLabel } from "@/lib/api";
import { LABELS, compact, num, pct } from "@/lib/format";

const TONE = {
  good: "bg-good-soft text-good",
  warn: "bg-warn-soft text-warn",
  bad: "bg-bad-soft text-bad",
  neutral: "bg-surface-2 text-ink-2",
} as const;

export function TrendBadge({ label, size = "md" }: { label: TrendLabel; size?: "sm" | "md" }) {
  const info = LABELS[label];
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full font-medium ${TONE[info.tone]} ${
        size === "sm" ? "text-xs px-2 py-0.5" : "text-sm px-2.5 py-1"
      }`}
    >
      <span aria-hidden="true">{info.arrow}</span>
      {info.text}
    </span>
  );
}

export function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-xl border border-line bg-surface p-4">
      <div className="text-xs text-ink-3">{label}</div>
      <div className="mt-1 text-2xl font-semibold tracking-tight font-mono">{value}</div>
      {hint && <div className="mt-1 text-xs text-ink-3">{hint}</div>}
    </div>
  );
}

export function TrendStats({ t }: { t: Trend }) {
  const complete = t.points.filter((p) => !p.partial);
  const span = complete.length ? `${complete[0].year}–${complete.at(-1)!.year}` : "";
  const relative =
    t.annual_growth != null && t.baseline_growth != null
      ? `All of science grew ${pct(t.baseline_growth)}/yr`
      : undefined;
  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
      <Stat label="Growth in share, per year" value={pct(t.annual_growth)} hint={relative} />
      <Stat label="Last 3 complete years" value={pct(t.recent_growth)} hint="Recent momentum" />
      <Stat label={`Papers ${span}`} value={compact(t.total_papers)} hint={`${num(t.total_papers)} total`} />
      <Stat
        label="Peak year (share)"
        value={t.peak_year ? String(t.peak_year) : "n/a"}
        hint={t.fit_r2 != null ? `Trend steadiness ${t.fit_r2.toFixed(2)} (0–1)` : undefined}
      />
    </div>
  );
}

export function TrustFlags({ p }: { p: Pick<Paper, "is_retracted" | "is_preprint" | "is_oa"> }) {
  return (
    <span className="inline-flex flex-wrap gap-1.5">
      {p.is_retracted && (
        <span className="text-xs rounded px-1.5 py-0.5 bg-bad-soft text-bad font-medium" title="This paper has been retracted">
          ⚠ Retracted
        </span>
      )}
      {p.is_preprint && (
        <span className="text-xs rounded px-1.5 py-0.5 bg-warn-soft text-warn" title="Not yet peer reviewed">
          Preprint
        </span>
      )}
      {p.is_oa && (
        <span className="text-xs rounded px-1.5 py-0.5 bg-surface-2 text-ink-2" title="Free to read">
          Open access
        </span>
      )}
    </span>
  );
}

export function PaperCard({ p }: { p: Paper }) {
  const authors = p.authors.slice(0, 3).join(", ") + (p.authors.length > 3 ? " et al." : "");
  return (
    <article className="rounded-xl border border-line bg-surface p-4 hover:border-ink-3 transition-colors">
      <div className="flex items-start justify-between gap-3">
        <h3 className="font-medium leading-snug">
          <Link href={`/paper/${p.id}`} className="hover:text-accent-ink">
            {p.title}
          </Link>
        </h3>
        <span className="text-xs text-ink-3 whitespace-nowrap font-mono">{p.year ?? ""}</span>
      </div>
      <p className="mt-1 text-sm text-ink-3">
        {[authors, p.venue].filter(Boolean).join(" · ")}
      </p>
      {p.abstract && <p className="mt-2 text-sm text-ink-2 line-clamp-3">{p.abstract}</p>}
      <div className="mt-3 flex flex-wrap items-center gap-3 text-xs text-ink-3">
        <TrustFlags p={p} />
        <span>{num(p.cited_by_count)} citations</span>
      </div>
    </article>
  );
}

export function Notice({ tone = "neutral", children }: { tone?: keyof typeof TONE; children: React.ReactNode }) {
  return <div className={`rounded-xl px-4 py-3 text-sm ${TONE[tone]}`}>{children}</div>;
}

export function Skeleton({ className = "" }: { className?: string }) {
  return <div className={`animate-pulse rounded-xl bg-surface-2 ${className}`} />;
}
