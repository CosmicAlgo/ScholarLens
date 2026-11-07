"""Hybrid paper search: vector similarity + full-text, fused with Reciprocal Rank Fusion."""

import asyncio
import re
from dataclasses import dataclass, field

import numpy as np

from .db import pool
from .embeddings import embed_query, to_pgvector

RRF_K = 60
CANDIDATES = 100
# Relevance gate. bge-small cosine similarity is compressed: unrelated papers still score 0.50-0.65
# and on-topic ones 0.80+. A paper qualifies by matching the query's words OR being clearly close in
# meaning, so a thin database returns few results instead of its nearest unrelated papers.
MIN_SIMILARITY = 0.75
# Below this many local hits, fetch the topic's most relevant works from OpenAlex first.
MIN_LOCAL_HITS = 20


@dataclass
class PaperHit:
    id: str
    title: str
    year: int | None
    venue: str | None
    doi: str | None
    abstract: str | None
    cited_by_count: int
    is_retracted: bool
    is_preprint: bool
    is_oa: bool
    oa_url: str | None
    score: float
    authors: list[str] = field(default_factory=list)
    embedding: np.ndarray | None = field(default=None, repr=False)

    def public(self) -> dict:
        d = {k: v for k, v in self.__dict__.items() if k != "embedding"}
        d["abstract"] = (self.abstract or "")[:600]
        return d


_SQL = """
WITH vec AS (
    SELECT id, row_number() OVER (ORDER BY embedding <=> %(qv)s::vector) AS r
    FROM papers
    WHERE embedding IS NOT NULL AND (%(y0)s::int IS NULL OR year >= %(y0)s) AND (%(y1)s::int IS NULL OR year <= %(y1)s)
      AND embedding <=> %(qv)s::vector <= %(maxdist)s
    ORDER BY embedding <=> %(qv)s::vector
    LIMIT %(cand)s
),
txt AS (
    SELECT id, row_number() OVER (ORDER BY ts_rank_cd(search_tsv, q) DESC) AS r
    FROM papers, websearch_to_tsquery('english', %(qt)s) AS q
    WHERE search_tsv @@ q AND (%(y0)s::int IS NULL OR year >= %(y0)s) AND (%(y1)s::int IS NULL OR year <= %(y1)s)
    ORDER BY ts_rank_cd(search_tsv, q) DESC
    LIMIT %(cand)s
),
fused AS (
    SELECT id, sum(1.0 / (%(k)s + r)) AS score
    FROM (SELECT * FROM vec UNION ALL SELECT * FROM txt) u
    GROUP BY id
)
SELECT p.id, p.title, p.year, p.venue, p.doi, p.abstract, p.cited_by_count, p.is_retracted,
       p.is_preprint, p.is_oa, p.oa_url, f.score, p.embedding::text AS embedding,
       ARRAY(SELECT a.name FROM paper_authors pa JOIN authors a ON a.id = pa.author_id
             WHERE pa.paper_id = p.id ORDER BY pa.position LIMIT 4) AS authors
FROM fused f JOIN papers p ON p.id = f.id
ORDER BY f.score DESC
LIMIT %(lim)s
"""


def _norm_title(t: str) -> str:
    return re.sub(r"[^a-z0-9]+", " ", t.lower()).strip()


def dedupe(hits: list[PaperHit]) -> list[PaperHit]:
    """OpenAlex often holds a preprint and the published version as separate works.
    Keep one per title, preferring the peer-reviewed, more-cited record."""
    best: dict[str, PaperHit] = {}
    order: list[str] = []
    for h in hits:
        key = _norm_title(h.title)
        cur = best.get(key)
        if cur is None:
            best[key] = h
            order.append(key)
        elif (not h.is_preprint, h.cited_by_count) > (not cur.is_preprint, cur.cited_by_count):
            h.score = max(h.score, cur.score)
            best[key] = h
    return [best[k] for k in order]


def _parse_vec(text: str | None) -> np.ndarray | None:
    if not text:
        return None
    return np.array([float(x) for x in text.strip("[]").split(",")], dtype=np.float32)


async def search_papers(
    query: str, limit: int = 20, year_from: int | None = None, year_to: int | None = None
) -> list[PaperHit]:
    qv = await asyncio.to_thread(embed_query, query)
    params = {
        "qv": to_pgvector(qv),
        "qt": query,
        "y0": year_from,
        "y1": year_to,
        "cand": CANDIDATES,
        "k": RRF_K,
        "lim": limit * 2,
        "maxdist": 1 - MIN_SIMILARITY,
    }
    async with pool().connection() as conn:
        rows = await (await conn.execute(_SQL, params)).fetchall()
    hits = [PaperHit(**{**r, "embedding": _parse_vec(r["embedding"]), "score": float(r["score"])}) for r in rows]
    return dedupe(hits)[:limit]


async def get_paper(paper_id: str) -> dict | None:
    async with pool().connection() as conn:
        row = await (
            await conn.execute(
                """SELECT p.id, p.title, p.year, p.venue, p.doi, p.abstract, p.cited_by_count, p.is_retracted,
                      p.is_preprint, p.is_oa, p.oa_url, t.name AS topic,
                      ARRAY(SELECT a.name FROM paper_authors pa JOIN authors a ON a.id = pa.author_id
                            WHERE pa.paper_id = p.id ORDER BY pa.position) AS authors
               FROM papers p LEFT JOIN topics t ON t.id = p.primary_topic_id WHERE p.id = %s""",
                (paper_id,),
            )
        ).fetchone()
    return row


async def search_with_coverage(
    query: str, limit: int = 20, year_from: int | None = None, year_to: int | None = None
) -> list[PaperHit]:
    """search_papers, but first pull the topic from OpenAlex if we hold too few relevant papers."""
    from .ingest import ensure_coverage  # local import: ingest depends on this module's siblings

    hits = await search_papers(query, limit, year_from, year_to)
    if len(hits) < min(limit, MIN_LOCAL_HITS) and await ensure_coverage(query, year_from):
        hits = await search_papers(query, limit, year_from, year_to)
    return hits
