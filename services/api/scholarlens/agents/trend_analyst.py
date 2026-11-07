"""Trend Analyst. One job: interpret numbers that were computed deterministically.

It never sees papers and never computes anything; it can only explain the metrics it is given.
"""

import json

from .deps import Deps
from .evidence import trend_evidence
from .schemas import TopicQuery, TrendInsight

SYSTEM = """You interpret publication-trend metrics for a research topic.

You get a list of metrics, each with an id. Write 2-4 short factual statements about the
topic's trajectory. Rules:
- Every statement cites the metric ids it relies on in `evidence`.
- Use only the numbers given. Do not round differently, extrapolate, or speculate about causes.
- Growth figures are for the topic's SHARE of all published papers, i.e. relative to how
  fast science grows overall. Say so when it matters.
- If the label is insufficient_data, say only that there is too little data."""


async def analyse(topic: TopicQuery, year_from: int, deps: Deps) -> tuple[dict, list[dict], TrendInsight]:
    result = await deps.tools.trend(topic.query, year_from, deps.current_year)
    evidence = trend_evidence(topic.key, topic.label, result)
    prompt = f"Topic: {topic.label}\nMetrics:\n" + json.dumps(evidence, indent=1)
    insight = await deps.llm.structured(tier="fast", system=SYSTEM, prompt=prompt, schema=TrendInsight)
    insight.statements = insight.statements[:4]
    return result.to_dict(), evidence, insight
