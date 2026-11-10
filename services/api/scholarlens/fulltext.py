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

from .config import get_settings
from .db import pool
from .embeddings import embed_documents, embed_query, to_pgvector
from .openalex import OpenAlexError, _cached_get

log = logging.getLogger("scholarlens.fulltext")

MAX_PDF_BYTES = 25 * 1024 * 1024
MAX_PAGES = 60
SOURCES_VERSION = "v2"  # bump when PDF sources change, so papers marked "no PDF" are retried
PASSAGE_CHARS = 900
_CACHE_BYTES = 96 * 1024 * 1024
_UA = "ScholarLens/0.2 (research reader; +https://rstackhub.in)"

_pdf_cache: OrderedDict[str, bytes] = OrderedDict()
_locks: dict[str, asyncio.Lock] = {}
# One indexing job at a time per server: each briefly needs ~100 MB on top of the model.
_index_slot = asyncio.Semaphore(1)


class NoPdf(Exception):
    """No open-access PDF could be found or fetched for this paper."""


# ---------------------------------------------------------------- locating and fetching


async def _work(paper_id: str) -> dict:
    try:
        return await _cached_get(f"/works/{paper_id}", {"select": "id,doi,title,best_oa_location,locations"})
    except OpenAlexError:
        return {}


async def pdf_candidates(paper_id: str) -> list[tuple[str, str | None]]:
    """Open-access PDF URLs that OpenAlex lists for a work, best first, as (url, license)."""
    w = await _work(paper_id)
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


# ---- extra free sources, asked only when OpenAlex's own links fail


async def _json(url: str, params: dict | None = None) -> dict | None:
    try:
        async with httpx.AsyncClient(timeout=12, follow_redirects=True, headers={"User-Agent": _UA}) as c:
            r = await c.get(url, params=params)
        return r.json() if r.status_code == 200 else None
    except (httpx.HTTPError, ValueError):
        return None


async def _unpaywall(doi: str) -> list[tuple[str, str | None]]:
    email = get_settings().openalex_email
    if not email:
        return []
    d = await _json(f"https://api.unpaywall.org/v2/{doi}", {"email": email}) or {}
    return [(loc["url_for_pdf"], loc.get("license")) for loc in d.get("oa_locations") or [] if loc.get("url_for_pdf")]


async def _semantic_scholar(doi: str) -> list[tuple[str, str | None]]:
    d = (
        await _json(
            f"https://api.semanticscholar.org/graph/v1/paper/DOI:{doi}", {"fields": "openAccessPdf,externalIds"}
        )
        or {}
    )
    out: list[tuple[str, str | None]] = []
    ext = d.get("externalIds") or {}
    if ext.get("ArXiv"):
        out.append((f"https://arxiv.org/pdf/{ext['ArXiv']}", None))
    if ext.get("PubMedCentral"):
        pmc = str(ext["PubMedCentral"]).removeprefix("PMC")
        out.append((f"https://europepmc.org/backend/ptpmcrender.fcgi?accid=PMC{pmc}&blobtype=pdf", None))
    pdf = d.get("openAccessPdf") or {}
    if pdf.get("url"):
        out.append((pdf["url"], pdf.get("license")))
    return out


def _norm_title(t: str) -> str:
    return re.sub(r"[^a-z0-9]+", " ", (t or "").lower()).strip()


async def _arxiv_by_title(title: str) -> list[tuple[str, str | None]]:
    """arXiv preprint with exactly the same title (many published papers have one)."""
    if len(title) < 15:
        return []
    q = re.sub(r"[^\w\s-]", " ", title)[:200]
    try:
        async with httpx.AsyncClient(timeout=12, headers={"User-Agent": _UA}) as c:
            r = await c.get(
                "https://export.arxiv.org/api/query", params={"search_query": f'ti:"{q}"', "max_results": 3}
            )
    except httpx.HTTPError:
        return []
    if r.status_code != 200:
        return []
    out: list[tuple[str, str | None]] = []
    for entry in re.findall(r"<entry>(.*?)</entry>", r.text, re.S):
        t = re.search(r"<title>(.*?)</title>", entry, re.S)
        i = re.search(r"<id>https?://arxiv.org/abs/(.*?)</id>", entry)
        if t and i and _norm_title(t.group(1)) == _norm_title(title):
            out.append((f"https://arxiv.org/pdf/{i.group(1)}", None))
    return out


async def extra_candidates(paper_id: str) -> list[tuple[str, str | None]]:
    """Unpaywall, Semantic Scholar (arXiv / PubMed Central / OA PDF) and an arXiv title match."""
    w = await _work(paper_id)
    doi = (w.get("doi") or "").removeprefix("https://doi.org/")
    tasks = [_arxiv_by_title(w.get("title") or "")]
    if doi:
        tasks += [_unpaywall(doi), _semantic_scholar(doi)]
    found = await asyncio.gather(*tasks, return_exceptions=True)
    out: list[tuple[str, str | None]] = []
    for group in found:
        if isinstance(group, list):
            out += [c for c in group if c[0] not in {u for u, _ in out}]
    out.sort(key=lambda c: 0 if "arxiv.org" in c[0] else 1 if "europepmc" in c[0] else 2)
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
    """(pdf bytes, source url, license). Tries OpenAlex's links, then the extra sources. Raises NoPdf."""
    if paper_id in _pdf_cache:
        _pdf_cache.move_to_end(paper_id)
        return _pdf_cache[paper_id], "", None
    errors, tried = [], set()
    for finder in (pdf_candidates, extra_candidates):
        for url, lic in (await finder(paper_id))[:5]:
            if url in tried:
                continue
            tried.add(url)
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
    """Make the paper's passages searchable. Returns {status, pages, passages}.

    Passages are stored immediately and are keyword-searchable at once; their embeddings are
    computed afterwards in the background (minutes on a 0.1-CPU server), and retrieval blends
    keyword and semantic matches as the embeddings arrive.
    """
    async with pool().connection() as conn:
        row = await (
            await conn.execute("SELECT status, pages, error FROM paper_files WHERE paper_id = %s", (paper_id,))
        ).fetchone()
        if row and row["status"] == "ready":
            counts = await (
                await conn.execute(
                    "SELECT count(*) AS n, count(*) FILTER (WHERE embedding IS NULL) AS pending"
                    " FROM paper_chunks WHERE paper_id = %s",
                    (paper_id,),
                )
            ).fetchone()
            if counts["pending"]:
                _schedule_embedding(paper_id)  # resume after a restart
            return {"status": "ready", "pages": row["pages"], "passages": counts["n"]}
        if row and row["status"] == "no_pdf" and (row["error"] or "").startswith(SOURCES_VERSION):
            return {"status": "no_pdf", "pages": None, "passages": 0}

    lock = _locks.setdefault(paper_id, asyncio.Lock())
    async with lock:
        try:
            data, url, lic = await get_pdf(paper_id)
            pages = await asyncio.to_thread(extract_pages, data)
            passages = split_passages(pages)
            if not passages:
                raise NoPdf("no extractable text (scanned PDF?)")
        except NoPdf as e:
            await _record(paper_id, "no_pdf", None, None, None, f"{SOURCES_VERSION} {e}"[:300])
            return {"status": "no_pdf", "pages": None, "passages": 0}
        except Exception as e:  # malformed PDFs etc.: record and move on
            log.warning("fulltext failed for %s: %r", paper_id, e)
            await _record(paper_id, "failed", None, None, None, repr(e)[:300])
            return {"status": "failed", "pages": None, "passages": 0}

        async with pool().connection() as conn, conn.transaction():
            await conn.execute("DELETE FROM paper_chunks WHERE paper_id = %s", (paper_id,))
            async with conn.cursor() as cur:
                await cur.executemany(
                    "INSERT INTO paper_chunks (paper_id, idx, page, text) VALUES (%s,%s,%s,%s)",
                    [(paper_id, i, p, t) for i, (p, t) in enumerate(passages)],
                )
        await _record(paper_id, "ready", url or None, lic, len(pages), None)
    _locks.pop(paper_id, None)
    _schedule_embedding(paper_id)
    return {"status": "ready", "pages": len(pages), "passages": len(passages)}


# Background embedding: one paper at a time, small batches, so the server stays responsive.
_embedding_tasks: dict[str, asyncio.Task] = {}
EMBED_BATCH = 8


def _schedule_embedding(paper_id: str) -> None:
    task = _embedding_tasks.get(paper_id)
    if task is None or task.done():
        _embedding_tasks[paper_id] = asyncio.create_task(_embed_pending(paper_id))


async def _embed_pending(paper_id: str) -> None:
    try:
        async with _index_slot:
            while True:
                async with pool().connection() as conn:
                    rows = await (
                        await conn.execute(
                            "SELECT idx, text FROM paper_chunks WHERE paper_id = %s AND embedding IS NULL"
                            " ORDER BY idx LIMIT %s",
                            (paper_id, EMBED_BATCH),
                        )
                    ).fetchall()
                if not rows:
                    return
                vectors = await asyncio.to_thread(embed_documents, [r["text"] for r in rows])
                async with pool().connection() as conn:
                    async with conn.cursor() as cur:
                        await cur.executemany(
                            "UPDATE paper_chunks SET embedding = %s::vector WHERE paper_id = %s AND idx = %s",
                            [(to_pgvector(v), paper_id, r["idx"]) for r, v in zip(rows, vectors, strict=True)],
                        )
    except Exception as e:  # retried the next time the paper is opened
        log.warning("background embedding failed for %s: %r", paper_id, e)
    finally:
        _embedding_tasks.pop(paper_id, None)


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


def _or_query(query: str) -> str:
    """Words of a natural-language question as an OR tsquery, so any matching term counts."""
    words = {w.lower() for w in re.findall(r"[A-Za-z][A-Za-z0-9-]{2,}", query)}
    return " | ".join(sorted(words))[:1000]


async def search_passages(paper_ids: list[str], query: str, k: int = 6) -> list[dict]:
    """Most relevant passages within the given papers: keyword (BM25-like ts_rank_cd) and semantic
    (pgvector) rankings fused with reciprocal rank fusion. Works before embeddings exist."""
    if not paper_ids:
        return []
    qv = to_pgvector(await asyncio.to_thread(embed_query, query))
    sql = """
    WITH c AS (
        SELECT paper_id, idx, page, text, embedding FROM paper_chunks WHERE paper_id = ANY(%(ids)s)
    ),
    txt AS (
        SELECT paper_id, idx, row_number() OVER (ORDER BY ts_rank_cd(to_tsvector('english', text), q) DESC) AS r
        FROM c, to_tsquery('english', %(tq)s) AS q
        WHERE %(tq)s <> '' AND to_tsvector('english', text) @@ q
        ORDER BY ts_rank_cd(to_tsvector('english', text), q) DESC
        LIMIT 30
    ),
    vec AS (
        SELECT paper_id, idx, row_number() OVER (ORDER BY embedding <=> %(qv)s::vector) AS r
        FROM c WHERE embedding IS NOT NULL
        ORDER BY embedding <=> %(qv)s::vector
        LIMIT 30
    ),
    fused AS (
        SELECT paper_id, idx, sum(1.0 / (60 + r)) AS score
        FROM (SELECT * FROM txt UNION ALL SELECT * FROM vec) u GROUP BY paper_id, idx
    )
    SELECT c.paper_id, c.idx, c.page, c.text, p.title, f.score
    FROM fused f JOIN c USING (paper_id, idx) JOIN papers p ON p.id = c.paper_id
    ORDER BY f.score DESC LIMIT %(k)s
    """
    async with pool().connection() as conn:
        rows = await (await conn.execute(sql, {"ids": paper_ids, "tq": _or_query(query), "qv": qv, "k": k})).fetchall()
        if not rows:  # nothing matched by keyword and no embeddings yet: return the paper's opening passages
            rows = await (
                await conn.execute(
                    """SELECT c.paper_id, c.idx, c.page, c.text, p.title, 0.0 AS score
                       FROM paper_chunks c JOIN papers p ON p.id = c.paper_id
                       WHERE c.paper_id = ANY(%s) ORDER BY c.idx LIMIT %s""",
                    (paper_ids, k),
                )
            ).fetchall()
    return [dict(r) for r in rows]


# ---------------------------------------------------------------- user-supplied documents

_WORD = re.compile(r"[a-z][a-z0-9-]{2,}")
_STOP = set(
    "the and for with that this from are was were has have had not but its their which into than then also can "
    "our".split()
)


def _stem(w: str) -> str:
    for suf in ("ing", "ed", "es", "s"):
        if len(w) > len(suf) + 3 and w.endswith(suf):
            return w[: -len(suf)]
    return w


def _terms(text: str) -> list[str]:
    return [_stem(w) for w in _WORD.findall(text.lower()) if w not in _STOP]


def rank_passages(passages: list[dict], query: str, k: int = 6) -> list[int]:
    """BM25 over passages the browser sent (uploaded PDFs are never stored on the server).
    Returns indexes into `passages`, best first; the opening passages if nothing matches."""
    import math

    q = set(_terms(query))
    docs = [_terms(p["text"]) for p in passages]
    if not docs:
        return []
    n = len(docs)
    avg = (sum(map(len, docs)) / n) or 1
    df = {t: sum(1 for d in docs if t in d) for t in q}
    scored = []
    for i, d in enumerate(docs):
        score = 0.0
        for t in q:
            tf = d.count(t)
            if tf:
                idf = math.log(1 + (n - df[t] + 0.5) / (df[t] + 0.5))
                score += idf * tf * 2.2 / (tf + 1.2 * (0.25 + 0.75 * len(d) / avg))
        scored.append((score, i))
    best = [i for score, i in sorted(scored, key=lambda x: -x[0]) if score > 0][:k]
    return best or list(range(min(k, n)))
