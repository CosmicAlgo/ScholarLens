"""Scout. One job: find the relevant papers for a topic.

The LLM only proposes alternative phrasings; retrieval itself is the hybrid search tool.
"""

import asyncio

from ..search import PaperHit, dedupe
from .deps import Deps
from .schemas import SearchQueries, TopicQuery

SYSTEM = """You write search queries for an academic paper search engine.
Given a research topic, return 2-3 alternative phrasings researchers use for it
(synonyms, the expanded form of acronyms, closely related method names).
Keep each under 8 words. Do not broaden the topic."""

PER_QUERY = 40
MAX_PAPERS = 60


async def scout(topic: TopicQuery, year_from: int | None, deps: Deps) -> list[PaperHit]:
    alt = await deps.llm.structured(tier="fast", system=SYSTEM, prompt=topic.label, schema=SearchQueries)
    queries = [topic.query] + [q for q in alt.queries[:3] if q.strip()]
    results = await asyncio.gather(*(deps.tools.search(q, PER_QUERY, year_from) for q in queries))

    # Reciprocal-rank merge across phrasings, then drop duplicate records of the same paper.
    scores: dict[str, float] = {}
    by_id: dict[str, PaperHit] = {}
    for hits in results:
        for rank, h in enumerate(hits):
            scores[h.id] = scores.get(h.id, 0.0) + 1.0 / (60 + rank)
            by_id[h.id] = h
    merged = sorted(by_id.values(), key=lambda h: -scores[h.id])
    for h in merged:
        h.score = scores[h.id]
    return dedupe(merged)[:MAX_PAPERS]
