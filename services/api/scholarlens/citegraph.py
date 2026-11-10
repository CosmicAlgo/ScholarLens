"""Connection map: how the papers a user has open relate through the literature (no LLM).

For each open paper we take what it cites and the most-cited works that cite it, from OpenAlex.
Works cited by two or more open papers are the shared foundations; they are always kept. Edges
point from the citing work to the cited work.
"""

import asyncio

from .openalex import _cached_get

_SELECT = "id,display_name,publication_year,cited_by_count,referenced_works,is_retracted"
_META = "id,display_name,publication_year,cited_by_count,is_retracted"
PER_PAPER_REFS = 6
PER_PAPER_CITING = 4


def _wid(url: str) -> str:
    return url.rsplit("/", 1)[-1]


def _node(w: dict, kind: str) -> dict:
    return {
        "id": _wid(w["id"]),
        "title": w.get("display_name") or "Untitled",
        "year": w.get("publication_year"),
        "cited_by": w.get("cited_by_count") or 0,
        "retracted": bool(w.get("is_retracted")),
        "kind": kind,
    }


async def _works(ids: list[str]) -> list[dict]:
    out = []
    for i in range(0, len(ids), 50):
        chunk = ids[i : i + 50]
        payload = await _cached_get(
            "/works", {"filter": "ids.openalex:" + "|".join(chunk), "per-page": 50, "select": _META}
        )
        out += payload.get("results", [])
    return out


async def build(paper_ids: list[str]) -> dict:
    roots = await asyncio.gather(*(_cached_get(f"/works/{pid}", {"select": _SELECT}) for pid in paper_ids))
    citing = await asyncio.gather(
        *(
            _cached_get(
                "/works",
                {
                    "filter": f"cites:{pid}",
                    "sort": "cited_by_count:desc",
                    "per-page": PER_PAPER_CITING,
                    "select": _META,
                },
            )
            for pid in paper_ids
        )
    )
    open_ids = {_wid(r["id"]) for r in roots}
    refs_of = {_wid(r["id"]): [_wid(x) for x in (r.get("referenced_works") or [])[:120]] for r in roots}

    counts: dict[str, int] = {}
    for refs in refs_of.values():
        for x in set(refs):
            counts[x] = counts.get(x, 0) + 1
    shared = {x for x, n in counts.items() if n >= 2 and x not in open_ids}
    meta = {_wid(w["id"]): w for w in await _works(sorted({x for refs in refs_of.values() for x in refs} - open_ids))}

    nodes = {_wid(r["id"]): _node(r, "open") for r in roots}
    edges: set[tuple[str, str]] = set()
    for pid, refs in refs_of.items():
        known = [x for x in refs if x in meta]
        top = sorted(known, key=lambda x: -(meta[x].get("cited_by_count") or 0))[:PER_PAPER_REFS]
        for x in set(top) | (set(refs) & shared):
            if x in open_ids:
                edges.add((pid, x))
            elif x in meta:
                nodes.setdefault(x, _node(meta[x], "shared" if x in shared else "reference"))
                edges.add((pid, x))
        for x in set(refs) & open_ids:
            edges.add((pid, x))
    for pid, payload in zip(paper_ids, citing, strict=True):
        for w in payload.get("results", []):
            cid = _wid(w["id"])
            if cid in open_ids:
                edges.add((cid, pid))
                continue
            nodes.setdefault(cid, _node(w, "citing"))
            edges.add((cid, pid))
    # A shared foundation's other links (e.g. a citing work that also cites it) are already captured
    # through the open papers; we do not fetch second-hop references, to keep the map readable.
    return {
        "nodes": list(nodes.values()),
        "edges": [{"source": a, "target": b} for a, b in sorted(edges) if a in nodes and b in nodes],
    }
