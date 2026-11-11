"""OpenAlex aggregation client with a Postgres-backed cache.

We never page through OpenAlex at request time. Field-wide numbers come from
`group_by=publication_year`, a single cheap server-side aggregation over the
whole 250M-work catalogue, cached for a week so a popular topic costs us one call.
"""

import hashlib
import json
from datetime import UTC, datetime, timedelta

import httpx
from psycopg.types.json import Jsonb

from .config import get_settings
from .db import pool

BASE = "https://api.openalex.org"
PAPER_FILTER = "type:article|preprint|review,has_abstract:true"


class OpenAlexError(RuntimeError):
    pass


def _cache_key(path: str, params: dict) -> str:
    raw = path + "?" + json.dumps(params, sort_keys=True)
    return "oa:" + hashlib.sha256(raw.encode()).hexdigest()[:32]


async def _cached_get(path: str, params: dict) -> dict:
    settings = get_settings()
    key = _cache_key(path, params)
    async with pool().connection() as conn:
        row = await (await conn.execute("SELECT payload, fetched_at FROM api_cache WHERE key = %s", (key,))).fetchone()
        ttl = timedelta(hours=settings.openalex_cache_ttl_hours)
        if row and datetime.now(UTC) - row["fetched_at"] < ttl:
            return row["payload"]

    query = dict(params)
    if settings.openalex_api_key:
        query["api_key"] = settings.openalex_api_key
    if settings.openalex_email:
        query["mailto"] = settings.openalex_email
    async with httpx.AsyncClient(timeout=30, headers={"User-Agent": "ScholarLens/0.1"}) as client:
        resp = await client.get(BASE + path, params=query)
    if resp.status_code != 200:
        raise OpenAlexError(f"OpenAlex HTTP {resp.status_code}: {resp.text[:200]}")
    payload = resp.json()

    async with pool().connection() as conn:
        await conn.execute(
            """INSERT INTO api_cache (key, payload, fetched_at) VALUES (%s, %s, now())
               ON CONFLICT (key) DO UPDATE SET payload = EXCLUDED.payload, fetched_at = now()""",
            (key, Jsonb(payload)),
        )
    return payload


def _sanitise(query: str) -> str:
    # OpenAlex filter syntax uses , | : as operators; strip them from user text.
    return " ".join("".join(c if c not in ",|:" else " " for c in query).split())


def search_term(query: str) -> str:
    """Two- and three-word concept names are matched as a phrase ("diffusion models" must appear
    together); longer questions are matched on all their words."""
    clean = _sanitise(query).replace('"', "")
    return f'"{clean}"' if 2 <= len(clean.split()) <= 3 else clean


async def counts_by_year(query: str | None, year_from: int, year_to: int, field: str | None = None) -> dict[int, int]:
    """Research papers per publication year matching `query` in title/abstract (None = all papers).

    Both the topic and the baseline are restricted to articles/preprints/reviews with an abstract.
    The unfiltered catalogue contains bulk-ingested non-paper records (35M "works" dated 2026),
    which would make every topic's share look like it collapsed.
    """
    filters = [f"publication_year:{year_from}-{year_to}", PAPER_FILTER]
    if query:
        filters.append(f"title_and_abstract.search:{search_term(query)}")
    if field:
        filters.append(f"primary_topic.field.id:{field}")
    payload = await _cached_get("/works", {"filter": ",".join(filters), "group_by": "publication_year"})
    out: dict[int, int] = {}
    for group in payload.get("group_by", []):
        try:
            out[int(group["key"])] = int(group["count"])
        except (KeyError, ValueError):
            continue
    return out


async def cache_get(key: str, ttl_hours: float) -> dict | None:
    """Generic JSON cache in the api_cache table (shared with the OpenAlex cache)."""
    async with pool().connection() as conn:
        row = await (await conn.execute("SELECT payload, fetched_at FROM api_cache WHERE key = %s", (key,))).fetchone()
    if row and datetime.now(UTC) - row["fetched_at"] < timedelta(hours=ttl_hours):
        return row["payload"]
    return None


async def cache_put(key: str, payload: dict) -> None:
    async with pool().connection() as conn:
        await conn.execute(
            """INSERT INTO api_cache (key, payload, fetched_at) VALUES (%s, %s, now())
               ON CONFLICT (key) DO UPDATE SET payload = EXCLUDED.payload, fetched_at = now()""",
            (key, Jsonb(payload)),
        )
