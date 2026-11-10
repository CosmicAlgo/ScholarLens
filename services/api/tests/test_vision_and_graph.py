"""Figure reader (vision), figure snips in Copilot, and the connection map."""

import base64
import io
from types import SimpleNamespace

import pytest
from fastapi import HTTPException
from pypdf import PdfReader, PdfWriter
from test_agents import FakeTools
from test_copilot import FakeFulltext

from scholarlens import citegraph
from scholarlens.agents import copilot
from scholarlens.agents.copilot import Dispatch, Job, build_dispatcher, ledger_text, selection_evidence, verify_answer
from scholarlens.agents.deps import Deps
from scholarlens.agents.figures import Figures, choose_pages, read_pdf_figures, subset_pdf
from scholarlens.main import _jpeg

PAGES = [
    "Introduction. Large language models hallucinate.",
    "Figure 1: Overview of the proposed framework. The retriever feeds the reader.",
    "Method details. As shown in Figure 1, the pipeline has two stages.",
    "Results. Table 1: Accuracy on four benchmarks against baselines.",
    "Figure 2: Ablation of the reranker. Conclusion.",
]


def test_page_choice_follows_the_question():
    assert choose_pages(PAGES, "table 1", 1) == [4]
    assert choose_pages(PAGES, "explain the architecture", 1) == [2]
    assert 4 in choose_pages(PAGES, "main results compared with baselines", 2)
    assert choose_pages(PAGES, None, 2) == [2, 3]  # no question: the caption pages in order


def _pdf(n: int) -> bytes:
    w = PdfWriter()
    for _ in range(n):
        w.add_blank_page(width=200, height=200)
    out = io.BytesIO()
    w.write(out)
    return out.getvalue()


def test_subset_pdf_keeps_only_the_chosen_pages():
    assert len(PdfReader(io.BytesIO(subset_pdf(_pdf(5), [2, 4]))).pages) == 2


class VisionLLM:
    usage = SimpleNamespace(input_tokens=0, output_tokens=0, calls=0)
    provider = "fake"

    def __init__(self, jobs=None):
        self.jobs = jobs or []
        self.media = []

    async def structured(self, *, tier, system, prompt, schema, media=None):
        if schema is Dispatch:
            return Dispatch(jobs=self.jobs)
        assert schema is Figures
        self.media.append(media)
        return Figures(
            figures=[
                {"page": 4, "label": "Table 1", "kind": "table", "shows": "accuracy per benchmark", "takeaway": "+3"},
                {"page": 99, "label": "Figure 9", "kind": "chart", "shows": "invented", "takeaway": "invented"},
            ]
        )


class PdfFulltext(FakeFulltext):
    async def get_pdf(self, pid):
        return _pdf(5), "", None

    def extract_pages(self, data):
        return PAGES


async def test_figure_reader_sends_the_pdf_pages_and_drops_invented_pages():
    llm = VisionLLM()
    ev = await read_pdf_figures(Deps(llm=llm, tools=FakeTools()), PdfFulltext(), "W1", "Paper", "table 1", 2)
    (media,) = llm.media
    assert media[0].mime_type == "application/pdf"
    assert len(PdfReader(io.BytesIO(base64.b64decode(media[0].data))).pages) == 2
    assert [e["id"] for e in ev] == ["F:W1:4:1"]  # page 99 was not among the pages shown
    assert "AI reading of a figure" in ledger_text(ev)
    assert verify_answer("Table 1 shows a three point gain over the strongest baseline [F:W1:4:1].", ev)["valid"] == 1


async def test_master_can_dispatch_the_figure_reader_but_not_on_uploads():
    llm = VisionLLM(
        [
            Job(kind="read_figures", target="W1", query="table 1"),
            Job(kind="read_figures", target="U0123456789ab", query="figure 1"),
        ]
    )
    graph = build_dispatcher(
        Deps(llm=llm, tools=FakeTools()),
        fulltext=PdfFulltext(),
        documents={"U0123456789ab": [{"page": 1, "text": "x" * 50, "title": "Mine"}]},
    )
    final = await graph.ainvoke(
        {
            "message": "q",
            "mode": "explain",
            "open_papers": [{"id": "W1", "title": "Paper"}, {"id": "U0123456789ab", "title": "Mine"}],
        }
    )
    assert [j["target"] for j in final["jobs"]] == ["W1"]  # uploaded PDFs never leave the browser
    assert any(e["id"].startswith("F:W1:") for e in final["evidence"])


class EchoLLM:
    usage = SimpleNamespace(input_tokens=0, output_tokens=0, calls=0)

    def __init__(self):
        self.media, self.system = None, ""

    async def stream_text(self, *, tier, system, prompt, media=None):
        self.media, self.system = media, system
        yield "ok"


async def test_figure_snip_reaches_the_writer_as_an_image():
    ev = selection_evidence({"paper_id": "W1", "page": 3, "text": "", "image": True}, {"W1": "Paper"})
    assert ev[0]["id"] == "H:W1:3" and ev[0]["figure"]
    llm = EchoLLM()
    out = [c async for c in copilot.write_answer(llm, message="m", mode="ask", history="", evidence=ev, image="/9j/")]
    assert out == ["ok"] and llm.media[0].mime_type == "image/jpeg" and "cut out a figure" in llm.system


def test_only_real_jpegs_are_accepted():
    good = base64.b64encode(b"\xff\xd8\xff\xe0" + b"0" * 60).decode()
    assert _jpeg(good) == good
    for bad in (base64.b64encode(b"\x89PNG" + b"0" * 60).decode(), "not base64!!"):
        with pytest.raises(HTTPException):
            _jpeg(bad)


async def test_connection_map_keeps_shared_foundations(monkeypatch):
    works = {
        "W1": {"id": "https://openalex.org/W1", "display_name": "A", "referenced_works": ["W10", "W11", "W2"]},
        "W2": {"id": "https://openalex.org/W2", "display_name": "B", "referenced_works": ["W10", "W12"]},
    }

    async def fake_get(path, params):
        if path.startswith("/works/"):
            return works[path.rsplit("/", 1)[1]]
        f = params["filter"]
        if f.startswith("cites:"):
            return {"results": [{"id": "https://openalex.org/W50", "display_name": "Citer", "cited_by_count": 9}]}
        ids = f.split(":", 1)[1].split("|")
        return {"results": [{"id": f"https://openalex.org/{i}", "display_name": i, "cited_by_count": 1} for i in ids]}

    monkeypatch.setattr(citegraph, "_cached_get", fake_get)
    g = await citegraph.build(["W1", "W2"])
    kinds = {n["id"]: n["kind"] for n in g["nodes"]}
    assert kinds["W10"] == "shared" and kinds["W1"] == "open" and kinds["W50"] == "citing"
    edges = {(e["source"], e["target"]) for e in g["edges"]}
    assert ("W1", "W2") in edges and ("W1", "W10") in edges and ("W2", "W10") in edges and ("W50", "W1") in edges


class PositionalLLM(VisionLLM):
    async def structured(self, *, tier, system, prompt, schema, media=None):
        return Figures(figures=[{"page": 1, "label": "Table 1", "kind": "table", "shows": "s", "takeaway": "t"}])


async def test_positional_page_numbers_are_mapped_back_to_real_pages():
    ev = await read_pdf_figures(Deps(llm=PositionalLLM(), tools=FakeTools()), PdfFulltext(), "W1", "P", "table 1", 2)
    assert [e["page"] for e in ev] == [choose_pages(PAGES, "table 1", 2)[0]]  # position 1, not page 1
