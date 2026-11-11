"""On-demand ingestion: fetch the most relevant OpenAlex works for a topic and store them.

The Go harvester does bulk ingestion. This module covers topics nobody has harvested yet, so
search and the Scout work for any topic instead of only pre-loaded ones. It mirrors the
harvester's normalisation (services/harvester/openalex.go) so both write identical rows.
"""

import asyncio
import logging
from datetime import date

import httpx

from .db import pool
from .embeddings import embed_documents, paper_text, to_pgvector
from .openalex import PAPER_FILTER, OpenAlexError, _cached_get, _sanitise

log = logging.getLogger("scholarlens.ingest")

FETCH_SIZE = 50
MAX_AUTHORS = 25
_SELECT = ",".join(
    [
        "id", "doi", "title", "publication_year", "publication_date", "type", "primary_location",
        "cited_by_count", "open_access", "is_retracted", "primary_topic", "authorships", "abstract_inverted_index",
    ]
)  # fmt: skip

# Only one fetch per query at a time, so concurrent visitors to a new topic don't duplicate work.
_locks: dict[str, asyncio.Lock] = {}


def _short(oa_id: str | None) -> str:
    return (oa_id or "").rsplit("/", 1)[-1]


def reconstruct_abstract(inv: dict[str, list[int]] | None) -> str:
    if not inv:
        return ""
    words = sorted((p, w) for w, positions in inv.items() for p in positions)
    return " ".join(w for _, w in words)


def _abstract_for(w: dict, title: str) -> str | None:
    """OpenAlex occasionally attaches another paper's abstract to a record. Better none than wrong."""
    from .textmatch import plausible_abstract

    text = reconstruct_abstract(w.get("abstract_inverted_index"))
    return text if text and plausible_abstract(text, title) else None


def normalise(w: dict) -> dict | None:
    title = (w.get("title") or "").strip()
    if not title or not w.get("id"):
        return None
    loc = w.get("primary_location") or {}
    src = loc.get("source") or {}
    oa = w.get("open_access") or {}
    is_preprint = (
        src.get("type") == "repository" or loc.get("version") == "submittedVersion" or w.get("type") == "preprint"
    )
    topic = None
    if (t := w.get("primary_topic")) and t.get("id"):
        topic = {
            "id": _short(t["id"]),
            "name": t.get("display_name") or "",
            "subfield": (t.get("subfield") or {}).get("display_name"),
            "field": (t.get("field") or {}).get("display_name"),
            "domain": (t.get("domain") or {}).get("display_name"),
        }
    authors, seen = [], set()
    for i, a in enumerate((w.get("authorships") or [])[:MAX_AUTHORS]):
        au = a.get("author") or {}
        aid = _short(au.get("id"))
        if not aid or aid in seen:
            continue
        seen.add(aid)
        insts = a.get("institutions") or []
        authors.append(
            {
                "id": aid,
                "name": au.get("display_name") or "",
                "orcid": (au.get("orcid") or "").removeprefix("https://orcid.org/") or None,
                "institution": (insts[0].get("display_name") if insts else None) or None,
                "position": i,
            }
        )
    pub_date = w.get("publication_date")
    try:
        pub_date = date.fromisoformat(pub_date) if pub_date else None
    except ValueError:
        pub_date = None
    return {
        "id": _short(w["id"]),
        "doi": (w.get("doi") or "").removeprefix("https://doi.org/") or None,
        "title": title,
        "abstract": _abstract_for(w, title),
        "year": w.get("publication_year"),
        "publication_date": pub_date,
        "work_type": w.get("type"),
        "venue": src.get("display_name"),
        "cited_by_count": w.get("cited_by_count") or 0,
        "is_oa": bool(oa.get("is_oa")),
        "oa_url": oa.get("oa_url"),
        "is_retracted": bool(w.get("is_retracted")),
        "is_preprint": is_preprint,
        "topic": topic,
        "authors": authors,
    }


async def fetch_relevant(query: str, year_from: int | None = None, n: int = FETCH_SIZE) -> list[dict]:
    """The n most relevant research works for `query` (single page, no cursor; cached a week)."""
    filters = [PAPER_FILTER]
    if year_from:
        filters.append(f"from_publication_date:{year_from}-01-01")
    payload = await _cached_get(
        "/works",
        {"search": _sanitise(query), "filter": ",".join(filters), "per-page": n, "select": _SELECT},
    )
    return [p for p in (normalise(w) for w in payload.get("results", [])) if p]


_PAPER_SQL = """
INSERT INTO papers (id, doi, title, abstract, year, publication_date, work_type, venue, cited_by_count,
                    is_oa, oa_url, is_retracted, is_preprint, primary_topic_id, embedding, updated_at)
VALUES (%(id)s, %(doi)s, %(title)s, %(abstract)s, %(year)s, %(publication_date)s, %(work_type)s, %(venue)s,
        %(cited_by_count)s, %(is_oa)s, %(oa_url)s, %(is_retracted)s, %(is_preprint)s, %(topic_id)s,
        %(embedding)s::vector, now())
ON CONFLICT (id) DO UPDATE SET
    doi=EXCLUDED.doi, title=EXCLUDED.title, abstract=EXCLUDED.abstract, year=EXCLUDED.year,
    publication_date=EXCLUDED.publication_date, work_type=EXCLUDED.work_type, venue=EXCLUDED.venue,
    cited_by_count=EXCLUDED.cited_by_count, is_oa=EXCLUDED.is_oa, oa_url=EXCLUDED.oa_url,
    is_retracted=EXCLUDED.is_retracted, is_preprint=EXCLUDED.is_preprint,
    primary_topic_id=EXCLUDED.primary_topic_id, updated_at=now(),
    embedding = CASE WHEN papers.embedding IS NULL
                       OR papers.title IS DISTINCT FROM EXCLUDED.title
                       OR papers.abstract IS DISTINCT FROM EXCLUDED.abstract
                     THEN EXCLUDED.embedding ELSE papers.embedding END
"""


async def store(papers: list[dict]) -> int:
    """Upsert papers with embeddings. Returns how many were new."""
    if not papers:
        return 0
    async with pool().connection() as conn:
        existing = await (
            await conn.execute(
                "SELECT id FROM papers WHERE id = ANY(%s) AND embedding IS NOT NULL", ([p["id"] for p in papers],)
            )
        ).fetchall()
    have = {r["id"] for r in existing}
    todo = [p for p in papers if p["id"] not in have]
    if not todo:
        return 0
    vectors = await asyncio.to_thread(embed_documents, [paper_text(p["title"], p["abstract"]) for p in todo])

    async with pool().connection() as conn, conn.transaction():
        for p, v in zip(todo, vectors, strict=True):
            t = p["topic"]
            if t:
                await conn.execute(
                    """INSERT INTO topics (id, name, subfield, field, domain) VALUES (%s,%s,%s,%s,%s)
                       ON CONFLICT (id) DO UPDATE SET name=EXCLUDED.name""",
                    (t["id"], t["name"], t["subfield"], t["field"], t["domain"]),
                )
            await conn.execute(_PAPER_SQL, {**p, "topic_id": t["id"] if t else None, "embedding": to_pgvector(v)})
            for a in p["authors"]:
                await conn.execute(
                    """INSERT INTO authors (id, name, orcid) VALUES (%s,%s,%s)
                       ON CONFLICT (id) DO UPDATE
                       SET name=EXCLUDED.name, orcid=COALESCE(EXCLUDED.orcid, authors.orcid)""",
                    (a["id"], a["name"], a["orcid"]),
                )
                await conn.execute(
                    """INSERT INTO paper_authors (paper_id, author_id, position, institution) VALUES (%s,%s,%s,%s)
                       ON CONFLICT (paper_id, author_id) DO UPDATE SET position=EXCLUDED.position""",
                    (p["id"], a["id"], a["position"], a["institution"]),
                )
    return len(todo)


async def ensure_coverage(query: str, year_from: int | None = None) -> int:
    """Fetch and store the top OpenAlex works for `query`. Returns new papers stored (0 on upstream failure)."""
    key = f"{query.lower().strip()}|{year_from}"
    lock = _locks.setdefault(key, asyncio.Lock())
    async with lock:
        try:
            papers = await fetch_relevant(query, year_from)
        except (OpenAlexError, httpx.HTTPError) as e:  # degrade to whatever we already hold
            log.warning("coverage fetch failed for %r: %s", query, e)
            return 0
        added = await store(papers)
    _locks.pop(key, None)
    if added:
        log.info("stored %d new papers for %r", added, query)
    return added
