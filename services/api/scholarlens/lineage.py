"""Topic context for the open papers: where they sit, where their key terms came from, how those terms
are trending, related topics, and which topics later work carried the papers into. OpenAlex only, no LLM.

"First usage" is the first year a term appears in a sustained way (at least 3 papers in two
consecutive years). The very earliest records are often misdated or mislabelled, so
a single early mention is not trusted.
"""

import asyncio
from datetime import date

from .openalex import PAPER_FILTER, _cached_get, _sanitise, counts_by_year

MAX_TERMS = 4
MAX_TOPICS = 3
YEARS = 16


def _wid(url: str) -> str:
    return url.rsplit("/", 1)[-1]


def first_sustained_year(counts: dict[int, int]) -> int | None:
    if not counts:
        return None
    floor = 3
    years = sorted(counts)
    for y in years:
        if counts.get(y, 0) >= floor and counts.get(y + 1, 0) >= floor:
            return y
    return None


async def _year_counts(filter_: str) -> dict[int, int]:
    payload = await _cached_get("/works", {"filter": f"{filter_},{PAPER_FILTER}", "group_by": "publication_year"})
    out = {}
    for g in payload.get("group_by", []):
        try:
            out[int(g["key"])] = int(g["count"])
        except (KeyError, ValueError):
            continue
    return out


def _series(counts: dict[int, int], base: dict[int, int], y0: int, y1: int) -> list[dict]:
    return [
        {
            "year": y,
            "count": counts.get(y, 0),
            "per_million": round(counts.get(y, 0) / base[y] * 1e6, 1) if base.get(y) else None,
        }
        for y in range(y0, y1 + 1)
    ]


async def _term(term: str, base: dict[int, int], y0: int, y1: int) -> dict:
    phrase = '"' + _sanitise(term).replace('"', "") + '"'
    counts = await _year_counts(f"title_and_abstract.search:{phrase}")
    first = first_sustained_year({y: c for y, c in counts.items() if 1900 <= y <= y1})
    early = []
    if first:
        payload = await _cached_get(
            "/works",
            {
                "filter": f"title_and_abstract.search:{phrase},publication_year:{first}-{first + 2},{PAPER_FILTER}",
                "sort": "cited_by_count:desc",
                "per-page": 3,
                "select": "id,display_name,publication_year,cited_by_count",
            },
        )
        early = [
            {
                "id": _wid(w["id"]),
                "title": w.get("display_name") or "Untitled",
                "year": w.get("publication_year"),
                "cited_by": w.get("cited_by_count") or 0,
            }
            for w in payload.get("results", [])
        ]
    total = sum(counts.values())
    return {
        "term": term,
        "first_year": first,
        "early_papers": early,
        "total": total,
        "trend": _series(counts, base, y0, y1),
    }


async def _topic(tid: str, base: dict[int, int], y0: int, y1: int) -> dict:
    meta, counts = await asyncio.gather(
        _cached_get(f"/topics/{tid}", {"select": "id,display_name,siblings,subfield,field,domain,works_count"}),
        _year_counts(f"primary_topic.id:{tid}"),
    )
    return {
        "id": tid,
        "name": meta.get("display_name"),
        "path": [x.get("display_name") for x in (meta.get("domain"), meta.get("field"), meta.get("subfield")) if x],
        "works_count": meta.get("works_count"),
        "related": [s.get("display_name") for s in (meta.get("siblings") or [])[:10] if s.get("display_name")],
        "trend": _series(counts, base, y0, y1),
    }


async def build(paper_ids: list[str]) -> dict:
    y1 = date.today().year - 1  # the current year is incomplete
    y0 = y1 - YEARS + 1
    works, base = await asyncio.gather(
        asyncio.gather(
            *(
                _cached_get(f"/works/{pid}", {"select": "id,display_name,publication_year,primary_topic,keywords"})
                for pid in paper_ids
            )
        ),
        counts_by_year(None, y0, y1),
    )
    topics: dict[str, list[str]] = {}
    terms: dict[str, list[str]] = {}
    for w in works:
        pid = _wid(w["id"])
        t = w.get("primary_topic")
        if t:
            topics.setdefault(_wid(t["id"]), []).append(pid)
        kws = sorted(w.get("keywords") or [], key=lambda k: -(k.get("score") or 0))
        for k in kws[:2]:
            name = (k.get("display_name") or "").strip()
            if len(name) >= 3:
                terms.setdefault(name.lower(), []).append(pid)

    top_topics = sorted(topics, key=lambda t: -len(topics[t]))[:MAX_TOPICS]
    top_terms = sorted(terms, key=lambda t: -len(terms[t]))[:MAX_TERMS]
    spread_payloads = await asyncio.gather(
        *(_cached_get("/works", {"filter": f"cites:{pid}", "group_by": "primary_topic.id"}) for pid in paper_ids)
    )
    topic_rows, term_rows = await asyncio.gather(
        asyncio.gather(*(_topic(t, base, y0, y1) for t in top_topics)),
        asyncio.gather(*(_term(t, base, y0, y1) for t in top_terms)),
    )
    for row in topic_rows:
        row["papers"] = topics[row["id"]]
    for row in term_rows:
        row["papers"] = terms[row["term"]]
    spread: dict[str, dict] = {}
    for pid, payload in zip(paper_ids, spread_payloads, strict=True):
        for g in payload.get("group_by", [])[:8]:
            name = g.get("key_display_name")
            if not name:
                continue
            cur = spread.setdefault(name, {"topic": name, "count": 0, "papers": []})
            cur["count"] += int(g.get("count") or 0)
            cur["papers"].append(pid)
    return {
        "years": [y0, y1],
        "topics": topic_rows,
        "terms": term_rows,
        "spread": sorted(spread.values(), key=lambda x: -x["count"])[:10],
        "source": "OpenAlex",
    }
