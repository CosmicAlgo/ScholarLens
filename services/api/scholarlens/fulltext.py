"""Full text of open-access papers: find the PDF, stream it to the reader, and index its passages.

- The PDF is only ever streamed from the open-access host (arXiv, publisher OA copies). We keep a
  small in-memory cache so a reader opening the same paper twice doesn't refetch it, but never
  persist PDFs.
- For grounded Q&A we extract text per page, split it into passages, embed them and store the
  passages with their page numbers (paper_chunks). Answers cite "page N of paper X".
"""

import asyncio
import io
import logging
import re
from collections import OrderedDict

import httpx

from .db import pool
from .embeddings import embed_documents, embed_query, to_pgvector
from .openalex import OpenAlexError, _cached_get

log = logging.getLogger("scholarlens.fulltext")

MAX_PDF_BYTES = 25 * 1024 * 1024
MAX_PAGES = 60
PASSAGE_CHARS = 900
_CACHE_BYTES = 40 * 1024 * 1024
_UA = "ScholarLens/0.2 (research reader; +https://rstackhub.in)"

_pdf_cache: OrderedDict[str, bytes] = OrderedDict()
_locks: dict[str, asyncio.Lock] = {}


class NoPdf(Exception):
    """No open-access PDF could be found or fetched for this paper."""


# ---------------------------------------------------------------- locating and fetching


async def pdf_candidates(paper_id: str) -> list[tuple[str, str | None]]:
    """Open-access PDF URLs for a work, best first, as (url, license)."""
    try:
        w = await _cached_get(f"/works/{paper_id}", {"select": "id,best_oa_location,locations"})
    except OpenAlexError:
        return []
    out: list[tuple[str, str | None]] = []
    best = w.get("best_oa_location") or {}
    if best.get("pdf_url"):
        out.append((best["pdf_url"], best.get("license")))
    for loc in w.get("locations") or []:
        if loc.get("is_oa") and loc.get("pdf_url") and loc["pdf_url"] not in {u for u, _ in out}:
            out.append((loc["pdf_url"], loc.get("license")))
    # arXiv copies are the most reliably fetchable; try them first.
    out.sort(key=lambda c: 0 if "arxiv.org" in c[0] else 1)
    return out


async def _download(url: str) -> bytes:
    async with httpx.AsyncClient(timeout=30, follow_redirects=True, headers={"User-Agent": _UA}) as client:
        async with client.stream("GET", url) as resp:
            if resp.status_code != 200:
                raise NoPdf(f"HTTP {resp.status_code}")
            buf = bytearray()
            async for chunk in resp.aiter_bytes():
                buf.extend(chunk)
                if len(buf) > MAX_PDF_BYTES:
                    raise NoPdf("PDF too large")
    if not bytes(buf[:1024]).lstrip().startswith(b"%PDF"):
        raise NoPdf("not a PDF (probably a landing page)")
    return bytes(buf)


def _remember(paper_id: str, data: bytes) -> None:
    _pdf_cache[paper_id] = data
    _pdf_cache.move_to_end(paper_id)
    while sum(len(v) for v in _pdf_cache.values()) > _CACHE_BYTES and len(_pdf_cache) > 1:
        _pdf_cache.popitem(last=False)


async def get_pdf(paper_id: str) -> tuple[bytes, str, str | None]:
    """(pdf bytes, source url, license). Raises NoPdf."""
    if paper_id in _pdf_cache:
        _pdf_cache.move_to_end(paper_id)
        return _pdf_cache[paper_id], "", None
    errors = []
    for url, lic in (await pdf_candidates(paper_id))[:4]:
        try:
            data = await _download(url)
            _remember(paper_id, data)
            return data, url, lic
        except (NoPdf, httpx.HTTPError) as e:
            errors.append(f"{url.split('/')[2]}: {e}")
    raise NoPdf("; ".join(errors) or "no open-access PDF listed")


# ---------------------------------------------------------------- text and passages


def _clean(text: str) -> str:
    text = re.sub(r"-\n(?=[a-z])", "", text)  # re-join hyphenated line breaks
    return re.sub(r"\s+", " ", text).strip()


def extract_pages(data: bytes) -> list[str]:
    from pypdf import PdfReader

    reader = PdfReader(io.BytesIO(data))
    return [_clean(p.extract_text() or "") for p in reader.pages[:MAX_PAGES]]


def split_passages(pages: list[str], size: int = PASSAGE_CHARS) -> list[tuple[int, str]]:
    """(page, passage) pairs. Splits on sentence ends so passages read as whole thoughts."""
    out: list[tuple[int, str]] = []
    for pno, text in enumerate(pages, start=1):
        if len(text) < 40:
            continue
        cur = ""
        for sent in re.split(r"(?<=[.!?])\s+", text):
            if cur and len(cur) + len(sent) > size:
                out.append((pno, cur.strip()))
                cur = ""
            cur += sent + " "
        if len(cur.strip()) >= 40:
            out.append((pno, cur.strip()))
    return out


async def ensure_fulltext(paper_id: str) -> dict:
    """Index the paper's passages if we haven't yet. Returns {status, pages, passages}."""
    async with pool().connection() as conn:
        row = await (
            await conn.execute("SELECT status, pages FROM paper_files WHERE paper_id = %s", (paper_id,))
        ).fetchone()
        if row and row["status"] == "ready":
            n = (
                await (
                    await conn.execute("SELECT count(*) AS n FROM paper_chunks WHERE paper_id = %s", (paper_id,))
                ).fetchone()
            )["n"]
            return {"status": "ready", "pages": row["pages"], "passages": n}
        if row and row["status"] == "no_pdf":
            return {"status": "no_pdf", "pages": None, "passages": 0}

    lock = _locks.setdefault(paper_id, asyncio.Lock())
    async with lock:
        try:
            data, url, lic = await get_pdf(paper_id)
            pages = await asyncio.to_thread(extract_pages, data)
            passages = split_passages(pages)
            if not passages:
                raise NoPdf("no extractable text (scanned PDF?)")
            vectors = await asyncio.to_thread(embed_documents, [t for _, t in passages])
        except NoPdf as e:
            await _record(paper_id, "no_pdf", None, None, None, str(e)[:300])
            return {"status": "no_pdf", "pages": None, "passages": 0}
        except Exception as e:  # malformed PDFs etc.: record and move on
            log.warning("fulltext failed for %s: %r", paper_id, e)
            await _record(paper_id, "failed", None, None, None, repr(e)[:300])
            return {"status": "failed", "pages": None, "passages": 0}

        async with pool().connection() as conn, conn.transaction():
            await conn.execute("DELETE FROM paper_chunks WHERE paper_id = %s", (paper_id,))
            async with conn.cursor() as cur:
                await cur.executemany(
                    "INSERT INTO paper_chunks (paper_id, idx, page, text, embedding) VALUES (%s,%s,%s,%s,%s::vector)",
                    [
                        (paper_id, i, p, t, to_pgvector(v))
                        for i, ((p, t), v) in enumerate(zip(passages, vectors, strict=True))
                    ],
                )
        await _record(paper_id, "ready", url or None, lic, len(pages), None)
    _locks.pop(paper_id, None)
    return {"status": "ready", "pages": len(pages), "passages": len(passages)}


async def _record(paper_id, status, url, lic, pages, error) -> None:
    async with pool().connection() as conn:
        await conn.execute(
            """INSERT INTO paper_files (paper_id, pdf_url, license, status, pages, error, fetched_at)
               VALUES (%s,%s,%s,%s,%s,%s, now())
               ON CONFLICT (paper_id) DO UPDATE SET pdf_url=COALESCE(EXCLUDED.pdf_url, paper_files.pdf_url),
                 license=EXCLUDED.license, status=EXCLUDED.status, pages=EXCLUDED.pages,
                 error=EXCLUDED.error, fetched_at=now()""",
            (paper_id, url, lic, status, pages, error),
        )


async def search_passages(paper_ids: list[str], query: str, k: int = 6) -> list[dict]:
    """Most relevant passages for `query` within the given papers."""
    if not paper_ids:
        return []
    qv = to_pgvector(await asyncio.to_thread(embed_query, query))
    async with pool().connection() as conn:
        rows = await (
            await conn.execute(
                """SELECT c.paper_id, c.idx, c.page, c.text, p.title, 1 - (c.embedding <=> %s::vector) AS sim
                   FROM paper_chunks c JOIN papers p ON p.id = c.paper_id
                   WHERE c.paper_id = ANY(%s)
                   ORDER BY c.embedding <=> %s::vector LIMIT %s""",
                (qv, paper_ids, qv, k),
            )
        ).fetchall()
    return [dict(r) for r in rows]
