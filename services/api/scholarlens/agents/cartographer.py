"""Cartographer. One job: name the sub-areas inside a topic.

Grouping and "is it emerging" scoring are deterministic (clustering.py); the LLM only
reads representative titles and gives each group a name and one-line summary.
"""

import json

from ..clustering import cluster_papers
from ..search import PaperHit
from .deps import Deps
from .schemas import ClusterLabels, TopicQuery

SYSTEM = """You name clusters of research papers. For each cluster you get its index and the
titles of its most representative papers. Return a 3-6 word name and a one-sentence summary
of what those papers study. Describe only what the titles show; do not judge importance."""


async def map_landscape(topic: TopicQuery, papers: list[PaperHit], deps: Deps) -> tuple[list[dict], list[dict]]:
    with_vec = [p for p in papers if p.embedding is not None]
    clusters = cluster_papers(
        [p.id for p in with_vec], [p.embedding for p in with_vec], [p.year for p in with_vec], deps.current_year
    )
    if not clusters:
        return [], []

    titles = {p.id: p.title for p in with_vec}
    prompt = json.dumps(
        [{"index": c.index, "titles": [titles[i] for i in c.representative_ids]} for c in clusters], indent=1
    )
    labels = await deps.llm.structured(tier="fast", system=SYSTEM, prompt=prompt, schema=ClusterLabels)
    names = {c.index: c for c in labels.clusters}

    out, evidence = [], []
    for c in clusters:
        label = names.get(c.index)
        item = {
            "id": f"C:{topic.key}:{c.index}",
            "kind": "cluster",
            "topic": topic.label,
            "name": label.name if label else f"Group {c.index + 1}",
            "summary": label.summary if label else "",
            "size": len(c.paper_ids),
            "median_year": c.median_year,
            "emergence": c.emergence,
            "emerging": c.emergence >= 1.5 and len(c.paper_ids) >= 4,
            "paper_ids": c.paper_ids,
            "representative": [f"P:{i}" for i in c.representative_ids[:3]],
        }
        out.append(item)
        evidence.append({k: v for k, v in item.items() if k != "paper_ids"})
    return out, evidence
