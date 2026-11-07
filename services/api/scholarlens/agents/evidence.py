"""Evidence ids give every number and paper a citable handle.

    P:<openalex id>        a paper              e.g. P:W2741809807
    M:<topic>:<metric>     a computed number    e.g. M:rag:recent_growth
    C:<topic>:<index>      a sub-topic cluster  e.g. C:rag:2

Agents may only cite ids that exist here; the verifier enforces it.
"""

from ..search import PaperHit
from ..trends import TrendResult


def pct(x: float | None) -> str:
    return "n/a" if x is None else f"{x * 100:+.0f}%/yr"


def paper_evidence(h: PaperHit) -> dict:
    flags = [f for f, on in (("retracted", h.is_retracted), ("preprint", h.is_preprint)) if on]
    return {
        "id": f"P:{h.id}",
        "kind": "paper",
        "title": h.title,
        "year": h.year,
        "venue": h.venue,
        "authors": h.authors[:3],
        "cited_by": h.cited_by_count,
        "flags": flags,
        "doi": h.doi,
    }


def trend_evidence(key: str, label: str, t: TrendResult) -> list[dict]:
    complete = [p for p in t.points if not p.partial]
    span = f"{complete[0].year}-{complete[-1].year}" if complete else ""
    items = [
        ("label", "Trend label", t.label),
        ("total", f"Papers {span}", f"{t.total_papers:,}"),
        ("annual_growth", f"Fitted growth of share of all papers, {span}", pct(t.annual_growth)),
        ("recent_growth", "Growth of share, last 3 complete years", pct(t.recent_growth)),
        ("baseline_growth", f"Growth of all published papers, {span}", pct(t.baseline_growth)),
        ("fit_r2", "How steady the trend is (R², 0-1)", t.fit_r2),
        ("peak_year", "Year with the highest share", t.peak_year),
    ]
    out = [
        {"id": f"M:{key}:{m}", "kind": "metric", "topic": label, "label": name, "value": value}
        for m, name, value in items
    ]
    if complete:
        last = complete[-1]
        out.append(
            {
                "id": f"M:{key}:latest_count",
                "kind": "metric",
                "topic": label,
                "label": f"Papers in {last.year}",
                "value": f"{last.count:,}",
            }
        )
    return out
