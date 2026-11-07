"""Copilot dispatcher: master plans jobs, workers run in parallel, verifier checks citations."""

from types import SimpleNamespace

from test_agents import FakeTools

from scholarlens.agents.copilot import Dispatch, Job, build_dispatcher, dedupe_evidence, verify_answer
from scholarlens.agents.deps import Deps
from scholarlens.fulltext import split_passages


class PlannerLLM:
    usage = SimpleNamespace(input_tokens=0, output_tokens=0, calls=0)
    provider = "fake"

    def __init__(self, jobs):
        self.jobs = jobs

    async def structured(self, *, tier, system, prompt, schema):
        assert schema is Dispatch
        return Dispatch(jobs=self.jobs)


class FakeFulltext:
    def __init__(self):
        self.indexed = []

    async def ensure_fulltext(self, pid):
        self.indexed.append(pid)
        return {"status": "ready", "pages": 9, "passages": 20}

    async def search_passages(self, ids, query, k=6):
        row = {"paper_id": ids[0], "title": "Open paper"}
        return [{**row, "idx": i, "page": i + 1, "text": f"passage {i}"} for i in range(2)]


async def run(jobs, open_papers):
    ft = FakeFulltext()
    graph = build_dispatcher(Deps(llm=PlannerLLM(jobs), tools=FakeTools(), current_year=2026), fulltext=ft)
    final = await graph.ainvoke({"message": "q", "mode": "explain", "open_papers": open_papers})
    return final, ft


async def test_master_dispatches_parallel_workers_and_collects_evidence():
    jobs = [
        Job(kind="read_paper", target="W1", query="method"),
        Job(kind="search_literature", query="graph rag"),
        Job(kind="topic_trend", query="graph rag"),
    ]
    final, ft = await run(jobs, [{"id": "W1", "title": "Open paper"}])
    ids = {e["id"] for e in final["evidence"]}
    assert {"S:W1:0", "S:W1:1"} <= ids  # passages with pages
    assert any(i.startswith("P:") for i in ids) and any(i.startswith("M:") for i in ids)
    statuses = [e for e in final["events"] if e["type"] == "job"]
    assert len(statuses) == 3 and all(e["status"] == "done" for e in statuses)
    assert ft.indexed == ["W1"]


async def test_master_cannot_read_papers_the_user_has_not_opened():
    final, ft = await run([Job(kind="read_paper", target="W999", query="x")], [{"id": "W1", "title": "Open"}])
    assert ft.indexed == []  # dropped, replaced by a literature search
    assert final["jobs"][0]["kind"] == "search_literature"


def test_verifier_flags_unknown_and_retracted_citations():
    ev = [
        {"id": "S:W1:0", "kind": "passage"},
        {"id": "P:W2", "kind": "paper", "flags": ["retracted"]},
    ]
    answer = (
        "The method uses graphs to retrieve context for long questions and is evaluated on four datasets [S:W1:0].\n\n"
        "An earlier study claimed large gains on the same benchmark using a different approach [P:W2][P:W404].\n\n"
        "This paragraph has no citation at all but is long enough to count as a substantive claim here."
    )
    v = verify_answer(answer, ev)
    assert v["invalid"] == ["P:W404"] and v["retracted"] == ["P:W2"]
    assert v["valid"] == 2 and v["uncited_paragraphs"] == 1


def test_dedupe_keeps_first():
    assert [e["id"] for e in dedupe_evidence([{"id": "a"}, {"id": "b"}, {"id": "a"}])] == ["a", "b"]


def test_passages_keep_page_numbers_and_sentence_boundaries():
    pages = ["Short.", "First sentence here. " * 60, "Another page with enough text to keep as a passage."]
    out = split_passages(pages, size=300)
    assert all(p in (2, 3) for p, _ in out) and out[0][0] == 2 and out[-1][0] == 3
    assert all(t.endswith(".") for _, t in out)
