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


@dataclass
class Deps:
    llm: LLM
    tools: Tools
    current_year: int = field(default_factory=lambda: date.today().year)
