"""Planner. One job: turn the user's question into 1-3 searchable topics. No research, no prose."""

import re

from .deps import Deps
from .schemas import Plan

SYSTEM = """You plan research-trend analyses. Read the user's question and output a plan.

- topics: the research topics the question is about. Use one topic unless the user is
  explicitly comparing (then up to 3). `query` must be the phrase researchers actually
  write in titles and abstracts (e.g. "retrieval augmented generation", not "RAG stuff").
  The query names the SUBJECT only. Never add words about the analysis itself such as
  "research", "trends", "growth", "papers", "literature", "studies" or "field": the query
  "COVID-19 research trends" would only count papers that literally mention research trends.
  Right: "COVID-19". Wrong: "COVID-19 research trends".
- year_from: only if the user names a start year or period.
- in_scope=false for anything that is not about research literature or scientific fields
  (e.g. coding help, personal advice, current news), with a one-line reason."""

MAX_TOPICS = 3

# Safety net for the rule above: trailing words that describe the analysis, not the subject.
_META = re.compile(
    r"(\s+(research|trends?|growth|papers?|literature|studies|study|field|publications?|landscape|"
    r"developments?|progress|advances?|overview|state of the art|recent))+$",
    re.IGNORECASE,
)


def clean_query(q: str) -> str:
    cleaned = _META.sub("", q.strip()).strip()
    return cleaned if len(cleaned) >= 2 else q.strip()


async def plan(question: str, deps: Deps) -> Plan:
    result = await deps.llm.structured(tier="fast", system=SYSTEM, prompt=question, schema=Plan)
    seen: set[str] = set()
    topics = []
    for t in result.topics:
        key = "".join(c for c in t.key.lower() if c.isalnum() or c == "_")[:24] or f"t{len(topics)}"
        if key in seen:
            key = f"{key}{len(topics)}"
        seen.add(key)
        topics.append(t.model_copy(update={"key": key, "query": clean_query(t.query)}))
    result.topics = topics[:MAX_TOPICS]
    if result.in_scope and not result.topics:
        result.in_scope, result.out_of_scope_reason = False, "Could not identify a research topic in the question."
    return result
