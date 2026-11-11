"""Semantic Scholar client: the sentences in which other papers cite a paper, and title matching.

OpenAlex tells us *that* a paper cites another; Semantic Scholar also has the sentence it cites it in
(for roughly two thirds of citations, mostly open-access ones). Those sentences are the raw material
for Claim Court and Citation Telephone. Responses are cached for a week.
"""

import asyncio
import hashlib
import logging

import httpx

from .openalex import cache_get, cache_put

BASE = "https://api.semanticscholar.org/graph/v1"
CITE_FIELDS = "contexts,isInfluential,title,year,externalIds,citationCount,venue"
log = logging.getLogger("scholarlens")
_gate = asyncio.Semaphore(2)  # the unauthenticated pool is shared; stay polite


class S2Error(RuntimeError):
    pass


async def _get(path: str, params: dict, ttl_hours: float = 24 * 7) -> dict | None:
    key = "s2:" + hashlib.sha256((path + repr(sorted(params.items()))).encode()).hexdigest()[:32]
    if (hit := await cache_get(key, ttl_hours)) is not None:
        return hit.get("v")
    async with _gate:
        for attempt in range(4):
            async with httpx.AsyncClient(timeout=30, headers={"User-Agent": "ScholarLens/0.2"}) as client:
                try:
                    resp = await client.get(BASE + path, params=params)
                except httpx.HTTPError as e:
                    log.warning("semantic scholar %s: %s", path, e)
                    await asyncio.sleep(1 + attempt * 2)
                    continue
            if resp.status_code == 404:
                await cache_put(key, {"v": None})
                return None
            if resp.status_code == 429 or resp.status_code >= 500:
                await asyncio.sleep(1.5 + attempt * 2.5)
                continue
            if resp.status_code != 200:
                raise S2Error(f"Semantic Scholar HTTP {resp.status_code}")
            data = resp.json()
            await cache_put(key, {"v": data})
            return data
    raise S2Error("Semantic Scholar is busy right now. Try again in a minute.")


def paper_ref(doi: str | None = None, arxiv: str | None = None, s2_id: str | None = None) -> str | None:
    if s2_id:
        return s2_id
    if doi:
        return "DOI:" + doi.removeprefix("https://doi.org/")
    if arxiv:
        return "ARXIV:" + arxiv
    return None


async def match_title(title: str) -> dict | None:
    """Best Semantic Scholar match for a title, or None."""
    data = await _get(
        "/paper/search/match",
        {"query": title[:300], "fields": "title,year,authors,externalIds,venue,citationCount"},
    )
    if not data or not data.get("data"):
        return None
    return data["data"][0]


async def citation_contexts(ref: str, max_items: int = 2000) -> list[dict]:
    """Every citing sentence we can get, one item per sentence, newest citing papers first."""
    out: list[dict] = []
    seen: set[str] = set()
    offset = 0
    while offset < max_items:
        data = await _get(f"/paper/{ref}/citations", {"fields": CITE_FIELDS, "limit": 1000, "offset": offset})
        if not data:
            break
        for row in data.get("data", []):
            p = row.get("citingPaper") or {}
            for ctx in row.get("contexts") or []:
                text = " ".join((ctx or "").split())
                if len(text) < 30 or text.lower() in seen:
                    continue
                seen.add(text.lower())
                ids = p.get("externalIds") or {}
                out.append(
                    {
                        "text": text[:900],
                        "influential": bool(row.get("isInfluential")),
                        "paper": {
                            "s2": p.get("paperId"),
                            "title": p.get("title") or "Untitled",
                            "year": p.get("year"),
                            "venue": p.get("venue") or "",
                            "doi": ids.get("DOI"),
                            "arxiv": ids.get("ArXiv"),
                            "cited_by": p.get("citationCount") or 0,
                        },
                    }
                )
        nxt = data.get("next")
        if not nxt:
            break
        offset = nxt
    return out


async def paper(ref: str, fields: str) -> dict | None:
    return await _get(f"/paper/{ref}", {"fields": fields})


async def citation_count(ref: str) -> int | None:
    return ((await paper(ref, "citationCount")) or {}).get("citationCount")
