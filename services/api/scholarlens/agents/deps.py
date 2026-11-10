"""What agents are allowed to touch. Injected, so tests swap in fakes and agents stay narrow."""

from dataclasses import dataclass, field
from datetime import date
from typing import Protocol

from .. import ingest, openalex
from ..search import PaperHit, get_paper, search_papers
from ..trends import TrendResult, compute_trend
from .llm import LLM


class Tools(Protocol):
    async def trend(self, query: str, year_from: int, year_to: int) -> TrendResult: ...
    async def search(self, query: str, limit: int, year_from: int | None) -> list[PaperHit]: ...
    async def ensure_coverage(self, query: str, year_from: int | None) -> int: ...
    async def paper(self, paper_id: str) -> dict | None: ...
    async def prior_work(self, query: str, limit: int) -> list[PaperHit]: ...
    async def keep(self, papers: list[PaperHit]) -> None: ...


class LiveTools:
    async def trend(self, query: str, year_from: int, year_to: int) -> TrendResult:
        baseline = await openalex.counts_by_year(None, year_from, year_to)
        counts = await openalex.counts_by_year(query, year_from, year_to)
        return compute_trend(counts, baseline, current_year=date.today().year)

    async def search(self, query: str, limit: int, year_from: int | None) -> list[PaperHit]:
        return await search_papers(query, limit=limit, year_from=year_from)

    async def ensure_coverage(self, query: str, year_from: int | None) -> int:
        return await ingest.ensure_coverage(query, year_from)

    async def paper(self, paper_id: str) -> dict | None:
        return await get_paper(paper_id)

    async def prior_work(self, query: str, limit: int) -> list[PaperHit]:
        """Most relevant works across all of OpenAlex (not just our index), straight from its search."""
        self._found = getattr(self, "_found", {})
        out = []
        for p in (await ingest.fetch_relevant(query, n=max(limit, 10)))[:limit]:
            self._found[p["id"]] = p
            out.append(
                PaperHit(
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
                    authors=[a["name"] if isinstance(a, dict) else a for a in p.get("authors") or []],
                )
            )
        return out

    async def keep(self, papers: list[PaperHit]) -> None:
        """Add works found by prior_work to our index, so the reader can open them."""
        found = getattr(self, "_found", {})
        await ingest.store([found[p.id] for p in papers if p.id in found])


@dataclass
class Deps:
    llm: LLM
    tools: Tools
    current_year: int = field(default_factory=lambda: date.today().year)
