"""Search that copes with typos and vague queries.

1. Search the raw query. If the results are plentiful and close in meaning, stop there (no LLM).
2. Otherwise a fast LLM interprets the query: fixes spelling, names the field's own terms, and
   proposes up to three precise search phrases. Interpretations are cached for a month.
3. Each phrase is searched (hybrid search, pulling from OpenAlex when we hold too few papers), and
   the lists are merged and re-ranked by how many of the query's terms each title and abstract
   contain, agreement between the lists, and a small citation prior.

The LLM only rewrites the query. Every result is a real paper from the catalogue, so nothing shown
can be invented; the UI shows what was searched so the user can see and undo the interpretation.
"""

import asyncio
import hashlib
import logging
import math
import re
from datetime import date

import numpy as np
from pydantic import BaseModel, Field

from .embeddings import embed_query
from .search import PaperHit, dedupe, search_papers

log = logging.getLogger("scholarlens")

GOOD_SIMILARITY = 0.84
MAX_INTERPRETATIONS_PER_DAY = 3000
_day = {"date": None, "n": 0}


class Interpretation(BaseModel):
    corrected: str = Field(description="the query with spelling fixed, in the user's own words otherwise")
    searches: list[str] = Field(description="1-3 precise academic search phrases (2-6 words each) for this need")
    note: str = Field(
        default="",
        description='note for the user, e.g. "Spelling: tranformer → transformer"; empty if already clear',
    )


SYSTEM = """You turn what a researcher typed into good literature searches.
- Fix typos and misspellings of technical terms ("difusion modle" → "diffusion model").
- Expand abbreviations when ambiguous only in context ("RAG" → "retrieval augmented generation").
- For vague queries ("ai for cancer", "how do llms lie"), give 2-3 specific phrases using the terms
  papers in that field actually use (e.g. "deep learning cancer detection", "LLM hallucination").
- Keep the user's meaning. Never add a topic they did not ask about. No years or author names unless typed.
- If the query is already precise and correctly spelt, return it unchanged as the only search and an empty note."""


def _norm(q: str) -> str:
    return re.sub(r"\s+", " ", q.lower()).strip()


def _budget_left() -> bool:
    today = date.today()
    if _day["date"] != today:
        _day["date"], _day["n"] = today, 0
    if _day["n"] >= MAX_INTERPRETATIONS_PER_DAY:
        return False
    _day["n"] += 1
    return True


def _cos(a: np.ndarray | None, b: np.ndarray) -> float:
    if a is None:
        return 0.0
    return float(np.dot(a, b) / ((np.linalg.norm(a) * np.linalg.norm(b)) or 1.0))


async def interpret(llm, query: str) -> Interpretation | None:
    from .openalex import cache_get, cache_put

    key = "qi:" + hashlib.sha256(_norm(query).encode()).hexdigest()[:32]
    cached = await cache_get(key, ttl_hours=24 * 30)
    if cached:
        return Interpretation.model_validate(cached)
    if llm is None or not _budget_left():
        return None
    try:
        out = await asyncio.wait_for(
            llm.structured(
                tier="fast", system=SYSTEM, prompt=f"Typed: {query}", schema=Interpretation, effort="minimal"
            ),
            15,
        )
    except Exception as e:  # search must work without the LLM
        log.info("query interpretation failed: %r", e)
        return None
    out.searches = [s.strip() for s in out.searches if 2 <= len(s.strip()) <= 120][:3] or [out.corrected]
    await cache_put(key, out.model_dump())
    return out


def _lexical(h: PaperHit, terms: set[str]) -> float:
    from .fulltext import _terms

    if not terms:
        return 0.0
    title = set(_terms(h.title or ""))
    body = set(_terms((h.abstract or "")[:1500]))
    return (2 * len(terms & title) + len(terms & body)) / (3 * len(terms))


def rerank(lists: list[list[PaperHit]], phrases: list[str], limit: int) -> list[PaperHit]:
    """Merge result lists: agreement between lists (reciprocal rank), how many of the query's terms the
    title and abstract contain, and a small citation prior. No embeddings, so it is instant."""
    from .fulltext import _terms

    terms = {t for ph in phrases for t in _terms(ph)}
    rrf: dict[str, float] = {}
    best: dict[str, PaperHit] = {}
    for hits in lists:
        for r, h in enumerate(hits):
            rrf[h.id] = rrf.get(h.id, 0.0) + 1.0 / (20 + r)
            best.setdefault(h.id, h)
    if not best:
        return []
    top_rrf = max(rrf.values())
    max_cites = max(math.log10(1 + h.cited_by_count) for h in best.values()) or 1.0
    for h in best.values():
        h.score = (
            0.5 * _lexical(h, terms)
            + 0.35 * (rrf[h.id] / top_rrf)
            + 0.15 * math.log10(1 + h.cited_by_count) / max_cites
        )
        if h.is_retracted:
            h.score -= 0.2
    return dedupe(sorted(best.values(), key=lambda h: -h.score))[:limit]


def _hit(p: dict, vec: np.ndarray | None) -> PaperHit:
    return PaperHit(
        id=p["id"],
        title=p["title"],
        year=p["year"],
        venue=p["venue"],
        doi=p["doi"],
        abstract=p["abstract"],
        cited_by_count=p["cited_by_count"],
        is_retracted=p["is_retracted"],
        is_preprint=p["is_preprint"],
        is_oa=p["is_oa"],
        oa_url=p["oa_url"],
        score=0.0,
        authors=[a["name"] for a in p.get("authors") or []][:4],
        embedding=vec,
    )


async def _openalex(phrases: list[str], year_from) -> tuple[list[list[PaperHit]], list[dict]]:
    """Most relevant works across all of OpenAlex for each phrase (cached a week), embedded by title."""
    from .ingest import fetch_relevant
    from .openalex import OpenAlexError

    async def one(ph: str) -> list[dict]:
        try:
            return await fetch_relevant(ph, year_from, n=20)
        except (OpenAlexError, Exception) as e:  # a failed phrase must not sink the search
            log.info("openalex search failed for %r: %r", ph, e)
            return []

    rows = await asyncio.gather(*(one(ph) for ph in phrases))
    flat = {p["id"]: p for r in rows for p in r}
    if not flat:
        return [[] for _ in phrases], []
    hit = {i: _hit(p, None) for i, p in flat.items()}
    return [[hit[p["id"]] for p in r] for r in rows], list(flat.values())


_keep_tasks: set[asyncio.Task] = set()


def _store_later(papers: list[dict]) -> None:
    """Save what we showed, so opening a result, the matrix and Copilot can use its record."""
    from .ingest import store

    async def run():
        try:
            await store(papers)
        except Exception as e:
            log.warning("storing search results failed: %r", e)

    t = asyncio.create_task(run())
    _keep_tasks.add(t)
    t.add_done_callback(_keep_tasks.discard)


async def smart_search(llm, query: str, limit: int = 20, year_from=None, year_to=None) -> dict:
    qv = await asyncio.to_thread(embed_query, query)
    first = await search_papers(query, limit, year_from, year_to)
    sims = sorted((_cos(h.embedding, qv) for h in first), reverse=True)
    clear = len(first) >= min(limit, 10) and sims and sims[min(4, len(sims) - 1)] >= GOOD_SIMILARITY
    if clear:
        return {"interpreted": None, "results": first}

    interp = await interpret(llm, query)
    unchanged = interp is None or (interp.searches == [query] and _norm(interp.corrected) == _norm(query))
    phrases = [query] if unchanged else list(dict.fromkeys([interp.corrected, *interp.searches]))[:3]
    local = await asyncio.gather(*(search_papers(ph, 30, year_from, year_to) for ph in phrases))
    remote, raw = await _openalex(phrases, year_from)
    if year_to:
        remote = [[h for h in r if not h.year or h.year <= year_to] for r in remote]
    results = rerank([first, *local, *remote], phrases, limit)
    shown = {h.id for h in results}
    _store_later([p for p in raw if p["id"] in shown])
    interpreted = None if unchanged else {"corrected": interp.corrected, "searches": phrases, "note": interp.note}
    return {"interpreted": interpreted, "results": results}
