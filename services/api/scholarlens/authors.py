"""Researcher profiles: who someone is, what they work on now, and what they say is still open.

Everything here is OpenAlex data, computed in code. The only AI step (the brief, in agents/scout_brief)
reads the abstracts collected here, and every statement it makes must cite one of these papers.
"""

import asyncio
import re
from datetime import date

from .ingest import reconstruct_abstract
from .openalex import OpenAlexError, _cached_get, _sanitise
from .textmatch import plausible_abstract

_AID = re.compile(r"^A\d{4,12}$")
_WORK_SELECT = (
    "id,display_name,publication_year,publication_date,doi,cited_by_count,is_retracted,type,"
    "primary_location,open_access,authorships,abstract_inverted_index,primary_topic"
)
RECENT_YEARS = 3
# Sentences in which authors say what is unsolved or what they will do next.
_OPEN = re.compile(
    r"\b(future (work|research|directions?)|remains? (an? )?(open|unclear|unknown|challenging|to be)|"
    r"open (question|problem|challenge)s?|"
    r"we plan|further (work|research|investigation|studies) (is|are) (needed|required)|limitation|has not been|"
    r"little is known|not yet (been )?(understood|explored|addressed)|gaps? (remains?|in (our|the) understanding))\b",
    re.I,
)


def _wid(url: str | None) -> str:
    return (url or "").rsplit("/", 1)[-1]


def _institutions(a: dict) -> list[dict]:
    return [
        {"name": i.get("display_name") or "", "country": i.get("country_code"), "id": _wid(i.get("id"))}
        for i in (a.get("last_known_institutions") or [])
    ]


def _summary(a: dict) -> dict:
    stats = a.get("summary_stats") or {}
    years = [c["year"] for c in (a.get("counts_by_year") or []) if c.get("works_count")]
    return {
        "id": _wid(a.get("id")),
        "name": a.get("display_name") or "",
        "orcid": a.get("orcid"),
        "works": a.get("works_count") or 0,
        "cited_by": a.get("cited_by_count") or 0,
        "h_index": stats.get("h_index"),
        "institutions": _institutions(a),
        "topics": [t.get("display_name") for t in (a.get("topics") or [])[:3]],
        "last_active": max(years) if years else None,
    }


async def search(q: str) -> list[dict]:
    """Candidates for a name. The same person is sometimes split across several OpenAlex records, so we
    return enough (institution, topics, output, last active year) for the user to tell them apart."""
    payload = await _cached_get(
        "/authors",
        {
            "search": _sanitise(q)[:120],
            "per-page": 10,
            "select": "id,display_name,orcid,works_count,cited_by_count,summary_stats,last_known_institutions,"
            "topics,counts_by_year",
        },
    )
    out = [_summary(a) for a in payload.get("results", [])]
    return sorted(out, key=lambda x: -x["works"])


def _work(w: dict, author_id: str) -> dict:
    loc = w.get("primary_location") or {}
    oa = w.get("open_access") or {}
    authors, position = [], None
    for i, au in enumerate(w.get("authorships") or []):
        a = au.get("author") or {}
        if _wid(a.get("id")) == author_id:
            position = "first" if i == 0 else ("last" if i == len(w["authorships"]) - 1 else "middle")
        authors.append({"id": _wid(a.get("id")), "name": a.get("display_name") or ""})
    title = w.get("display_name") or "Untitled"
    abstract = reconstruct_abstract(w.get("abstract_inverted_index"))
    topic = w.get("primary_topic") or {}
    return {
        "id": _wid(w.get("id")),
        "title": title,
        "year": w.get("publication_year"),
        "date": w.get("publication_date"),
        "doi": (w.get("doi") or "").removeprefix("https://doi.org/") or None,
        "venue": (loc.get("source") or {}).get("display_name") or "",
        "cited_by": w.get("cited_by_count") or 0,
        "retracted": bool(w.get("is_retracted")),
        "preprint": w.get("type") == "preprint" or (loc.get("source") or {}).get("type") == "repository",
        "oa_url": oa.get("oa_url"),
        "authors": authors[:12],
        "n_authors": len(w.get("authorships") or []),
        "position": position,
        "abstract": abstract if plausible_abstract(abstract, title) else "",
        "topic": topic.get("display_name"),
    }


async def _works(author_id: str, filters: str, sort: str, n: int) -> list[dict]:
    payload = await _cached_get(
        "/works",
        {
            "filter": f"authorships.author.id:{author_id},{filters}".rstrip(","),
            "sort": sort,
            "per-page": n,
            "select": _WORK_SELECT,
        },
    )
    return [_work(w, author_id) for w in payload.get("results", [])]


async def _groups(author_id: str, by: str, filters: str = "") -> list[dict]:
    payload = await _cached_get("/works", {"filter": f"authorships.author.id:{author_id}{filters}", "group_by": by})
    return [
        {"id": _wid(str(g.get("key"))), "name": g.get("key_display_name") or "", "count": int(g.get("count") or 0)}
        for g in payload.get("group_by", [])
    ]


def topic_shift(recent: list[dict], before: list[dict], k: int = 8) -> list[dict]:
    """Topics of the last few years against the years before, as shares of each period's papers.
    Pure, so it is unit-tested."""
    rt, bt = sum(t["count"] for t in recent) or 1, sum(t["count"] for t in before) or 1
    old = {t["id"]: t["count"] / bt for t in before}
    out = []
    for t in recent[:k]:
        now = t["count"] / rt
        was = old.get(t["id"], 0.0)
        trend = "new" if was == 0 else ("rising" if now > was * 1.5 else ("fading" if now < was * 0.67 else "steady"))
        out.append(
            {
                "id": t["id"],
                "name": t["name"],
                "recent_share": round(now, 3),
                "earlier_share": round(was, 3),
                "trend": trend,
            }
        )
    recent_ids = {t["id"] for t in recent[:k]}
    for t in before[:k]:
        if t["id"] not in recent_ids and t["count"] / bt >= 0.08:
            out.append(
                {
                    "id": t["id"],
                    "name": t["name"],
                    "recent_share": 0.0,
                    "earlier_share": round(t["count"] / bt, 3),
                    "trend": "dropped",
                }
            )
    return out


def open_problems(works: list[dict], limit: int = 8) -> list[dict]:
    """Sentences from the abstracts where the authors say something is unsolved. Verbatim, no AI."""
    out = []
    for w in works:
        for sent in re.split(r"(?<=[.!?])\s+(?=[A-Z])", w["abstract"]):
            s = sent.strip()
            if 40 <= len(s) <= 400 and _OPEN.search(s):
                out.append({"text": s, "work": w["id"], "title": w["title"], "year": w["year"]})
                break
        if len(out) >= limit:
            break
    return out


async def profile(author_id: str) -> dict | None:
    if not _AID.match(author_id):
        return None
    try:
        a = await _cached_get(f"/authors/{author_id}", {})
    except OpenAlexError:
        return None
    if not a or not a.get("id"):
        return None
    this_year = date.today().year
    since = this_year - RECENT_YEARS
    recent, cited, topics_recent, topics_before, coauthors = await asyncio.gather(
        _works(author_id, f"from_publication_date:{since}-01-01", "publication_date:desc", 25),
        _works(author_id, "", "cited_by_count:desc", 8),
        _groups(author_id, "primary_topic.id", f",from_publication_date:{since}-01-01"),
        _groups(author_id, "primary_topic.id", f",to_publication_date:{since - 1}-12-31"),
        _groups(author_id, "authorships.author.id", f",from_publication_date:{this_year - 6}-01-01"),
    )
    yearly = sorted(
        (
            {"year": c["year"], "works": c.get("works_count", 0), "cited_by": c.get("cited_by_count", 0)}
            for c in a.get("counts_by_year") or []
        ),
        key=lambda x: x["year"],
    )
    affiliations = sorted(
        (
            {
                "name": (x.get("institution") or {}).get("display_name") or "",
                "from": min(x.get("years") or [0]),
                "to": max(x.get("years") or [0]),
            }
            for x in a.get("affiliations") or []
        ),
        key=lambda x: -x["to"],
    )[:6]
    collaborators = [c for c in coauthors if c["id"] != author_id][:12]
    roles = [w["position"] for w in recent if w["position"]]
    return {
        **_summary(a),
        "i10_index": (a.get("summary_stats") or {}).get("i10_index"),
        "affiliations": affiliations,
        "yearly": yearly,
        "topics": topic_shift(topics_recent, topics_before),
        "recent": recent,
        "most_cited": cited,
        "collaborators": collaborators,
        "open_problems": open_problems(recent),
        "roles": {r: roles.count(r) for r in ("first", "middle", "last")},
        "since": since,
    }
