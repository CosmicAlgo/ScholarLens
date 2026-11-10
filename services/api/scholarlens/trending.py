"""What is trending now: the research topics whose output grew fastest in the last 12 months.

Two OpenAlex aggregations (papers per topic in the last 12 months, and in the 12 months before),
both ending a month ago because the newest weeks are still being indexed. Growth is relative to
the growth of the same topic set overall, so a topic only "rises" if it outpaces science as a
whole. Computed in code (no LLM), cached for six hours.
"""

from datetime import UTC, date, datetime, timedelta

from .openalex import PAPER_FILTER, _cached_get, cache_get, cache_put

REFRESH_HOURS = 6
MIN_PREVIOUS = 400  # ignore small topics, whose growth is mostly noise


def _wid(url: str) -> str:
    return url.rsplit("/", 1)[-1]


async def _by_topic(start: date, end: date) -> dict[str, tuple[str, int]]:
    payload = await _cached_get(
        "/works",
        {
            "filter": f"from_publication_date:{start},to_publication_date:{end},{PAPER_FILTER}",
            "group_by": "primary_topic.id",
            "per-page": 200,
        },
    )
    out = {}
    for g in payload.get("group_by", []):
        if g.get("key") and g.get("key_display_name") and g["key"] != "unknown":
            out[_wid(g["key"])] = (g["key_display_name"], int(g.get("count") or 0))
    return out


def rank(recent: dict[str, tuple[str, int]], previous: dict[str, tuple[str, int]], k: int = 12) -> dict:
    both = [t for t in recent if t in previous and previous[t][1] >= MIN_PREVIOUS]
    if not both:
        return {"rising": [], "busiest": []}
    base = sum(recent[t][1] for t in both) / max(1, sum(previous[t][1] for t in both))
    rows = [
        {
            "id": t,
            "name": recent[t][0],
            "recent": recent[t][1],
            "previous": previous[t][1],
            "growth": round((recent[t][1] / previous[t][1]) / base - 1, 3),
        }
        for t in both
    ]
    rising = sorted((r for r in rows if r["growth"] > 0), key=lambda r: -r["growth"])[:k]
    busiest = sorted(rows, key=lambda r: -r["recent"])[:8]
    return {"rising": rising, "busiest": busiest}


async def trending() -> dict:
    today = date.today()
    key = f"trending:v1:{today}:{datetime.now(UTC).hour // REFRESH_HOURS}"
    cached = await cache_get(key, ttl_hours=REFRESH_HOURS)
    if cached:
        return cached
    end = today - timedelta(days=30)
    mid = end - timedelta(days=365)
    start = mid - timedelta(days=365)
    recent = await _by_topic(mid + timedelta(days=1), end)
    previous = await _by_topic(start, mid)
    out = {
        "updated": datetime.now(UTC).isoformat(timespec="minutes"),
        "refresh_hours": REFRESH_HOURS,
        "window": {"recent": [str(mid + timedelta(days=1)), str(end)], "previous": [str(start), str(mid)]},
        **rank(recent, previous),
        "source": "OpenAlex",
    }
    await cache_put(key, out)
    return out
