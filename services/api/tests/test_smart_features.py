"""Uploaded documents, highlights, idea novelty checks and the evidence matrix."""

from types import SimpleNamespace

from test_agents import FakeTools
from test_copilot import FakeFulltext, PlannerLLM

from scholarlens.agents.copilot import Job, build_dispatcher, ledger_text, selection_evidence, verify_answer
from scholarlens.agents.deps import Deps
from scholarlens.agents.matrix import Row, extract_row
from scholarlens.agents.novelty import Ideas, Verdicts, check_ideas
from scholarlens.fulltext import rank_passages

DOC = [
    {"page": 1, "text": "We introduce a new benchmark for protein folding.", "title": "My draft"},
    {"page": 2, "text": "Our transformer model uses sparse attention over residues.", "title": "My draft"},
    {
        "page": 7,
        "text": "A limitation is the small dataset; future work should add membrane proteins.",
        "title": "My draft",
    },
]


def test_bm25_finds_the_relevant_passage_and_falls_back_to_the_opening():
    assert rank_passages(DOC, "what are the limitations and future work?", k=1) == [2]
    assert rank_passages(DOC, "zzz qqq", k=2) == [0, 1]


async def test_uploaded_documents_are_read_from_the_request_not_the_server():
    ft = FakeFulltext()
    deps = Deps(
        llm=PlannerLLM([Job(kind="read_paper", target="U0123456789ab", query="limitations")]), tools=FakeTools()
    )
    graph = build_dispatcher(deps, fulltext=ft, documents={"U0123456789ab": DOC})
    final = await graph.ainvoke(
        {"message": "q", "mode": "critique", "open_papers": [{"id": "U0123456789ab", "title": "My draft"}]}
    )
    assert ft.indexed == []  # never fetched or indexed server-side
    first = final["evidence"][0]
    assert first["id"] == "S:U0123456789ab:2" and first["page"] == 7


def test_highlight_becomes_citable_evidence():
    ev = selection_evidence({"paper_id": "W1", "page": 4, "text": "Accuracy rose by 12%."}, {"W1": "Paper one"})
    assert ev[0]["id"] == "H:W1:4" and "USER HIGHLIGHTED" in ledger_text(ev)
    v = verify_answer("The highlighted result is a 12% gain in accuracy on the main benchmark [H:W1:4].", ev)
    assert v["valid"] == 1 and not v["invalid"]


class ScriptedLLM:
    usage = SimpleNamespace(input_tokens=0, output_tokens=0, calls=0)
    provider = "fake"

    def __init__(self, answers):
        self.answers = answers
        self.prompts = []

    async def structured(self, *, tier, system, prompt, schema):
        self.prompts.append(prompt)
        return schema.model_validate(self.answers[schema])


class CoverageTools(FakeTools):
    covered: list[str] = []

    async def ensure_coverage(self, query, year_from):
        self.covered.append(query)
        return 0


async def test_novelty_check_judges_ideas_against_papers_it_actually_found():
    llm = ScriptedLLM(
        {
            Ideas: {
                "ideas": [
                    {"title": "Graph RAG for law", "summary": "s", "search_query": "graph retrieval legal documents"},
                    {"title": "Tiny RAG", "summary": "s", "search_query": "small language model retrieval"},
                ]
            },
            Verdicts: {
                "verdicts": [
                    {"idea": 0, "verdict": "already_done", "reason": "Paper 2 does it.", "closest": ["W2", "W_FAKE"]},
                    {"idea": 1, "verdict": "open", "reason": "No close match found."},
                ]
            },
        }
    )
    tools = CoverageTools()
    out = await check_ideas(Deps(llm=llm, tools=tools), "### Graph RAG for law\n...\n### Tiny RAG\n...")
    assert [o["verdict"] for o in out] == ["already_done", "open"]
    assert [c["id"] for c in out[0]["closest"]] == ["W2"]  # invented id dropped
    assert len(out[1]["closest"]) == 2  # nearest papers shown even when the idea looks open
    assert len(tools.covered) == 2  # index topped up for each idea
    assert "Candidates:" in llm.prompts[1]


async def test_matrix_row_cells_only_cite_retrieved_passages():
    cell = {"text": "x", "cites": ["S:W1:0", "S:W1:99"]}
    llm = ScriptedLLM({Row: {k: cell for k in ("problem", "method", "data", "findings", "limitations")}})
    out = await extract_row(Deps(llm=llm, tools=FakeTools()), FakeFulltext(), "W1", "Open paper")
    assert out["source"] == "full_text"
    assert out["row"]["method"]["cites"] == ["S:W1:0"]
    assert [e["id"] for e in out["evidence"]] == ["S:W1:0"]
