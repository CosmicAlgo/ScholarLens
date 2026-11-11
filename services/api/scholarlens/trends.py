"""Trend maths. Pure functions, no I/O, fully unit-tested.

The old prototype labelled a topic "SATURATED" when a search returned more than
100 papers, and called raw count increases "growth". Both mostly measured how
much science is published overall. Here growth is measured on the topic's
*share* of all publications, so a field only "grows" if it outpaces science.
"""

import math
from dataclasses import asdict, dataclass, field
from typing import Literal

Label = Literal["surging", "growing", "stable", "cooling", "declining", "peaked", "insufficient_data"]

MIN_TOTAL_PAPERS = 30
RECENT_YEARS = 3


@dataclass
class YearPoint:
    year: int
    count: int
    baseline: int
    share_per_million: float  # papers on this topic per 1M papers published that year
    partial: bool = False  # current year: still being indexed, excluded from fitting


@dataclass
class TrendResult:
    label: Label
    annual_growth: float | None  # fitted growth of share per year, e.g. 0.18 = +18%/yr
    recent_growth: float | None  # growth of share over the last RECENT_YEARS complete years
    fit_r2: float | None  # how well a steady exponential trend explains the data (0-1)
    baseline_growth: float | None  # growth of all science over the same window, for context
    total_papers: int
    peak_year: int | None
    points: list[YearPoint] = field(default_factory=list)
    sense: dict | None = None  # which meaning of the name was counted (see senses.py)

    def to_dict(self) -> dict:
        return asdict(self)


def _log_linear_fit(xs: list[float], ys: list[float]) -> tuple[float, float]:
    """Least squares fit of ln(y) = a + b*x. Returns (b, r2). Requires y > 0."""
    ly = [math.log(y) for y in ys]
    n = len(xs)
    mx, my = sum(xs) / n, sum(ly) / n
    sxx = sum((x - mx) ** 2 for x in xs)
    if sxx == 0:
        return 0.0, 0.0
    sxy = sum((x - mx) * (y - my) for x, y in zip(xs, ly, strict=True))
    b = sxy / sxx
    ss_tot = sum((y - my) ** 2 for y in ly)
    ss_res = sum((y - (my + b * (x - mx))) ** 2 for x, y in zip(xs, ly, strict=True))
    r2 = 1 - ss_res / ss_tot if ss_tot > 0 else 1.0
    return b, max(0.0, min(1.0, r2))


def _cagr(start: float, end: float, years: int) -> float | None:
    if start <= 0 or end <= 0 or years <= 0:
        return None
    return (end / start) ** (1 / years) - 1


def _label(growth: float, recent: float | None, shares: list[float], years: list[int]) -> Label:
    # "Peaked" = rose substantially, then fell back. A topic declining from day one is just declining.
    peak_idx = max(range(len(shares)), key=lambda i: shares[i])
    peak = shares[peak_idx]
    rose_first = peak_idx >= 2 and shares[0] < 0.7 * peak
    fell_after = peak_idx < len(shares) - 2 and shares[-1] < 0.8 * peak
    if rose_first and fell_after and (recent is None or recent < 0):
        return "peaked"
    g = recent if recent is not None else growth
    if g > 0.25:
        return "surging"
    if g > 0.07:
        return "growing"
    if g >= -0.07:
        return "stable"
    if g >= -0.20:
        return "cooling"
    return "declining"


def compute_trend(counts: dict[int, int], baseline: dict[int, int], current_year: int) -> TrendResult:
    years = sorted(y for y in baseline if baseline[y] > 0)
    points = [
        YearPoint(
            year=y,
            count=counts.get(y, 0),
            baseline=baseline[y],
            share_per_million=round(counts.get(y, 0) / baseline[y] * 1e6, 3),
            partial=y >= current_year,
        )
        for y in years
    ]
    complete = [p for p in points if not p.partial]
    total = sum(p.count for p in complete)
    peak = max(complete, key=lambda p: p.share_per_million).year if complete and total else None

    nonzero = [p for p in complete if p.count > 0]
    if total < MIN_TOTAL_PAPERS or len(nonzero) < 4:
        return TrendResult("insufficient_data", None, None, None, None, total, peak, points)

    xs = [float(p.year) for p in nonzero]
    slope, r2 = _log_linear_fit(xs, [p.share_per_million for p in nonzero])
    growth = math.exp(slope) - 1

    recent_growth = None
    if len(complete) > RECENT_YEARS:
        start, end = complete[-1 - RECENT_YEARS], complete[-1]
        recent_growth = _cagr(start.share_per_million, end.share_per_million, RECENT_YEARS)

    first, last = complete[0], complete[-1]
    baseline_growth = _cagr(first.baseline, last.baseline, last.year - first.year)

    label = _label(growth, recent_growth, [p.share_per_million for p in complete], [p.year for p in complete])
    return TrendResult(
        label=label,
        annual_growth=round(growth, 4),
        recent_growth=round(recent_growth, 4) if recent_growth is not None else None,
        fit_r2=round(r2, 3),
        baseline_growth=round(baseline_growth, 4) if baseline_growth is not None else None,
        total_papers=total,
        peak_year=peak,
        points=points,
    )
