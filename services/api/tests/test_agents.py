"""End-to-end agent graph tests with a scripted LLM and fake tools (no network, no cost)."""

import numpy as np
import pytest

from scholarlens.agents.deps import Deps
from scholarlens.agents.graph import build_graph
from scholarlens.agents.llm import Usage
from scholarlens.agents.schemas import (
    Claim,
    ClusterLabel,
    ClusterLabels,
    Plan,
    Report,
    SearchQueries,
    Section,
    TopicQuery,
    TrendInsight,
)
from scholarlens.agents.verifier import verify
from scholarlens.search import PaperHit
from scholarlens.trends import compute_trend

BASELINE = {y: 1_000_000 for y in range(2014, 2027)}


class FakeLLM:
    def __init__(self):
        self.usage = Usage()
        self.calls: list[str] = []

    async def structured(self, *, tier, system, prompt, schema):
        self.calls.append(schema.__name__)
        if schema is Plan:
            if "recipe" in prompt:
                return Plan(in_scope=False, out_of_scope_reason="Not a research question.", topics=[])
            return Plan(
                in_scope=True, topics=[TopicQuery(key="RAG!", label="RAG", query="retrieval augmented generation")]
            )
        if schema is SearchQueries:
            return SearchQueries(queries=["retrieval augmentation", "RAG"])
        if schema is TrendInsight:
            return TrendInsight(statements=[Claim(text="Share is surging.", evidence=["M:rag:recent_growth"])])
        if schema is ClusterLabels:
            return ClusterLabels(clusters=[ClusterLabel(index=i, name=f"Area {i}", summary="s") for i in range(6)])
        if schema is Report:
            return Report(
                title="RAG",
                tldr=[
                    Claim(text="RAG share is surging.", evidence=["M:rag:recent_growth", "M:rag:label"]),
                    Claim(text="Made-up claim.", evidence=[]),
                ],
                sections=[
                    Section(
                        heading="Papers",
                        claims=[
                            Claim(text="Key paper.", evidence=["P:W0", "P:WBAD"]),
                            Claim(text="Hallucinated source.", evidence=["P:W_DOES_NOT_EXIST"]),
                        ],
                    ),
                    Section(heading="Empty", claims=[Claim(text="x", evidence=[])]),
                ],
            )
        raise AssertionError(f"unexpected schema {schema}")


class FakeTools:
    async def trend(self, query, year_from, year_to):
        counts = {y: int(50 * 1.4 ** (y - 2014)) for y in BASELINE}
        return compute_trend(counts, BASELINE, current_year=2026)

    async def search(self, query, limit, year_from):
        rng = np.random.default_rng(len(query))
        hits = []
        for i in range(30):
            v = rng.normal(0, 0.05, 8) + np.eye(8)[i % 3]
            hits.append(
                PaperHit(
                    id=f"W{i}" if i else "W0",
                    title=f"Paper {i}",
                    year=2015 + i % 11,
                    venue=None,
                    doi=None,
                    abstract=None,
                    cited_by_count=100 - i,
                    is_retracted=(i == 1),
                    is_preprint=(i % 2 == 0),
                    is_oa=True,
                    oa_url=None,
                    score=1.0,
                    embedding=v,
                )
            )
        hits.append(
            PaperHit(
                id="WBAD",
                title="Retracted study",
                year=2020,
                venue=None,
                doi=None,
                abstract=None,
                cited_by_count=5,
                is_retracted=True,
                is_preprint=False,
                is_oa=False,
                oa_url=None,
                score=0.5,
                embedding=np.eye(8)[0],
            )
        )
        return hits


@pytest.fixture
def deps():
    return Deps(llm=FakeLLM(), tools=FakeTools(), current_year=2026)


async def test_full_run_produces_verified_report(deps):
    final = await build_graph(deps).ainvoke({"question": "Is RAG still growing?"})

    assert final["plan"]["topics"][0]["key"] == "rag"  # slug sanitised by the planner
    assert final["trends"]["rag"]["result"]["label"] == "surging"
    assert final["landscapes"]["rag"], "cartographer should produce clusters"
    assert "P:WBAD" in final["trust"]["retracted"]

    report, v = final["report"], final["verification"]
    all_claims = report["tldr"] + [c for s in report["sections"] for c in s["claims"]]
    assert {c["text"] for c in all_claims} == {"RAG share is surging.", "Key paper."}
    assert v["claims_total"] == 5 and v["claims_kept"] == 2
    assert v["retracted_citations_removed"] == ["P:WBAD"]
    assert [s["heading"] for s in report["sections"]] == ["Papers"]  # empty sections dropped
    assert "Verified: kept 2/5 claims" in final["events"]


async def test_out_of_scope_stops_after_planning(deps):
    final = await build_graph(deps).ainvoke({"question": "Give me a pasta recipe"})
    assert final["stopped"] == "Not a research question."
    assert deps.llm.calls == ["Plan"]  # no further (paid) calls


def test_verifier_keeps_supported_claims_only():
    evidence = {"M:x:a": {"id": "M:x:a", "kind": "metric"}}
    report = Report(title="t", tldr=[Claim(text="ok", evidence=["M:x:a", "M:x:a"])], sections=[])
    clean, v = verify(report, evidence)
    assert clean.tldr[0].evidence == ["M:x:a"]  # duplicates collapsed
    assert v.claims_kept == 1 and not v.removed
