"""Novelty check for brainstormed ideas: is each idea actually new, or has someone already done it?

LLMs happily propose ideas that already exist. After a brainstorm answer we:
  1. pull the ideas out of the answer (fast LLM, structured),
  2. search all of OpenAlex (250M+ works) for each idea, in parallel,
  3. ask a reviewer (fast LLM) to compare each idea with the closest papers we actually found.

The verdict always comes with the papers it is based on, so the user can check it.
"""

import asyncio
from typing import Literal

from pydantic import BaseModel, Field

from .deps import Deps

MAX_IDEAS = 5
CANDIDATES = 5


class Idea(BaseModel):
    title: str = Field(description="the idea's name, as written in the answer")
    summary: str = Field(description="one sentence: what would be built or tested")
    search_query: str = Field(description="4-8 word phrase that would find prior work doing exactly this")


class Ideas(BaseModel):
    ideas: list[Idea] = Field(description="the distinct ideas proposed in the answer, at most 5")


class Verdict(BaseModel):
    idea: int = Field(description="index of the idea, from 0")
    verdict: Literal["open", "partly_explored", "already_done"]
    reason: str = Field(description="one sentence; name the closest paper if it matters")
    closest: list[str] = Field(default_factory=list, description="ids of candidate papers that already do (part of) it")


class Verdicts(BaseModel):
    verdicts: list[Verdict]


EXTRACT = "List the distinct ideas proposed in this answer. Use the answer's own idea names."

REVIEW = """You are a strict reviewer checking whether research ideas are new.
For each idea you get the closest papers a literature search found (title, year, abstract).
- already_done: a candidate paper does essentially this idea.
- partly_explored: candidates cover a core part, but the idea adds something real (new data, setting, method).
- open: no candidate does it. Absence of evidence from 5 search hits is weak, so say "no close match found",
  not "nobody has done this".
Only use candidate ids that were given for that idea."""


async def check_ideas(deps: Deps, answer: str) -> list[dict]:
    ideas = (await deps.llm.structured(tier="fast", system=EXTRACT, prompt=answer[:12000], schema=Ideas)).ideas
    ideas = ideas[:MAX_IDEAS]
    if not ideas:
        return []

    async def prior_work(idea: Idea):
        return await deps.tools.prior_work(idea.search_query, CANDIDATES)

    found = await asyncio.gather(*(prior_work(i) for i in ideas), return_exceptions=True)
    hits = [f if isinstance(f, list) else [] for f in found]

    blocks = []
    for n, (idea, hs) in enumerate(zip(ideas, hits, strict=True)):
        cands = (
            "\n".join(f"  - {h.id} ({h.year}) {h.title}: {(h.abstract or '')[:400]}" for h in hs) or "  (none found)"
        )
        blocks.append(f"Idea {n}: {idea.title}. {idea.summary}\nCandidates:\n{cands}")
    verdicts = await deps.llm.structured(tier="fast", system=REVIEW, prompt="\n\n".join(blocks), schema=Verdicts)

    by_idea = {v.idea: v for v in verdicts.verdicts}
    out = []
    for n, (idea, hs) in enumerate(zip(ideas, hits, strict=True)):
        v = by_idea.get(n)
        known = {h.id: h for h in hs}
        closest_ids = [c for c in (v.closest if v else []) if c in known] or [h.id for h in hs[:2]]
        out.append(
            {
                "title": idea.title,
                "verdict": v.verdict if v else "open",
                "reason": v.reason if v else "No close match found in the papers searched.",
                "query": idea.search_query,
                "closest": [
                    {"id": c, "title": known[c].title, "year": known[c].year, "cited_by": known[c].cited_by_count}
                    for c in closest_ids[:3]
                ],
            }
        )
    try:  # make the closest papers openable in the reader
        shown = {c["id"] for o in out for c in o["closest"]}
        await deps.tools.keep([h for hs in hits for h in hs if h.id in shown])
    except Exception:
        pass
    return out
