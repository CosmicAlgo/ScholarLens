"""Research Copilot: a master that dispatches single-purpose workers, then writes a cited answer.

Shaped like a cluster scheduler:

    master (LLM, fast)  ──plans jobs──►  Send(worker, job) × N   (run in parallel, no LLM)
                                              │ read_paper        → passages from the open paper, with pages
                                              │ search_literature → relevant papers (hybrid search, trust flags)
                                              │ topic_trend       → computed trend metrics
                                              ▼
                                       evidence ledger (ids: S:, P:, M:)
                                              ▼
    writer (LLM, strong, streamed)  ──►  answer citing ledger ids  ──►  verifier (code)

Workers are deterministic tools, so every fact in the ledger is real and traceable. The writer can
only cite ledger ids; the verifier flags any citation that isn't in the ledger.
"""

import asyncio
import operator
import re
from typing import Annotated, Literal, TypedDict

from langgraph.graph import END, START, StateGraph
from langgraph.types import Send
from pydantic import BaseModel, Field

from .deps import Deps
from .evidence import paper_evidence, trend_evidence
from .llm import LLM

Mode = Literal["ask", "explain", "critique", "brainstorm", "related", "compare", "verify"]
MAX_JOBS = 5
MAX_PARALLEL = 4


class Job(BaseModel):
    kind: Literal["read_paper", "search_literature", "topic_trend"]
    target: str = Field(
        default="",
        description="read_paper: the paper id (e.g. W2741809807) from the open papers list; otherwise empty",
    )
    query: str = Field(description="what to look for: a question for read_paper, a search phrase, or a topic name")


class Dispatch(BaseModel):
    jobs: list[Job] = Field(description="1-5 jobs that together gather the evidence needed")


class OpenPaper(BaseModel):
    id: str
    title: str


MASTER = """You are the scheduler of a research assistant. You never answer the user yourself.
Plan the jobs that gather evidence for the answer. Available workers:
- read_paper(target=<open paper id>, query=<what to find in it>): finds passages in the full text.
- search_literature(query=<2-6 word search phrase>): finds other relevant papers.
- topic_trend(query=<research topic>): publication trend of a topic (growing, peaked, ...).

Rules:
- If papers are open and the question is about them, read them (one job per paper, max 3).
- Use search_literature for related work, comparisons, gaps, or when no paper is open.
- Use topic_trend only when momentum or popularity of a field matters.
- If the user highlighted a passage, the question is about it: read that paper with a query built from
  the highlighted text, and search the literature for it when the user wants related, supporting or
  contradicting work.
- brainstorm: read the open papers for limitations and future work, and search the literature for what
  has already been done, so ideas are new.
- verify: search the literature for the claim (2 different phrasings) and read open papers for it.
- 1 to 5 jobs. Queries name the subject only, no words like "research" or "trends"."""

MODE_RULES = {
    "ask": "Answer the question directly and concisely.",
    "explain": "Explain the paper or concept clearly for a smart non-specialist: the problem, the idea, "
    "how it works, and the results. Define jargon briefly.",
    "critique": "Act as a careful peer reviewer: strengths, weaknesses, assumptions, threats to validity, "
    "and what evidence would change your mind. Be specific and fair.",
    "brainstorm": "Propose 3-5 concrete, non-obvious research or build ideas. Each must start from a specific "
    "limitation, gap or surprising result in the evidence (cite it). For each give a '### ' heading with the "
    "idea's name, then: **Builds on** (the cited gap), **Why it is new** (how it differs from the closest "
    "cited work; avoid ideas the evidence shows are already done), **First experiment** (data, baseline, "
    "metric, roughly a week of work) and **Risk** (the likeliest reason it fails). Prefer specific, testable "
    "ideas over broad themes. Mark ideas as ideas, not facts.",
    "related": "Map the related work: group the papers into themes, say how each relates to the open "
    "paper or question, and point out what is missing.",
    "compare": "Compare the papers or approaches side by side: goals, methods, data, results, limits. "
    "A compact markdown table is welcome.",
    "verify": "Check the user's claim against the evidence. Start with a one-line verdict in bold: "
    "**Supported**, **Contradicted**, **Mixed** or **Not enough evidence**. Then list the evidence for and "
    "against, each with its citation, and note the strength of each source (preprint, retracted, citations, "
    "how directly it tests the claim). Do not guess beyond the evidence.",
}

WRITER = """You are ScholarLens Copilot, a research assistant for scholars. Write in markdown.

Evidence rules (strict):
- Use ONLY the evidence ledger below for facts, numbers and claims about papers.
- Cite inline with the ledger id in square brackets right after the sentence it supports,
  e.g. "...improves recall by 12% [S:W123:4]." Use several ids if needed: [S:W1:2][P:W9].
- Never invent ids, numbers, authors or results. If the ledger lacks something, say so plainly.
- Papers flagged retracted must not be used as support. Point out when key evidence is a preprint.
- General background knowledge may be used only to explain concepts, never as a claim about a paper,
  and needs no citation.

Task: {mode_rule}
Keep it focused: short paragraphs or bullet points, no filler."""


class CopilotState(TypedDict, total=False):
    message: str
    mode: str
    history: str
    open_papers: list[dict]
    selection: dict | None
    jobs: list[dict]
    job: dict
    evidence: Annotated[list[dict], operator.add]
    events: Annotated[list[dict], operator.add]


def _open_list(state: CopilotState) -> str:
    papers = state.get("open_papers") or []
    return "\n".join(f"- {p['id']}: {p['title']}" for p in papers) or "(none)"


def _selection_text(state: CopilotState) -> str:
    sel = state.get("selection")
    if not sel:
        return ""
    return f'\nThe user highlighted this on page {sel["page"]} of {sel["paper_id"]}:\n"""{sel["text"][:1500]}"""\n'


def build_dispatcher(deps: Deps, fulltext=None, documents: dict[str, list[dict]] | None = None):
    """Graph: master → parallel workers (LangGraph Send) → END. `fulltext` is injectable for tests.

    `documents` holds passages of PDFs the user uploaded (kept in their browser, sent per request),
    keyed by the paper id they are shown under."""
    from .. import fulltext as live_fulltext

    ft = fulltext or live_fulltext
    docs = documents or {}
    sem = asyncio.Semaphore(MAX_PARALLEL)

    async def master(state: CopilotState):
        prompt = (
            f"Mode: {state.get('mode', 'ask')}\nOpen papers:\n{_open_list(state)}\n\n"
            f"Recent conversation:\n{state.get('history') or '(none)'}\n{_selection_text(state)}\n"
            f"User: {state['message']}"
        )
        plan = await deps.llm.structured(tier="fast", system=MASTER, prompt=prompt, schema=Dispatch)
        open_ids = {p["id"] for p in state.get("open_papers") or []}
        jobs = []
        for j in plan.jobs[:MAX_JOBS]:
            if j.kind == "read_paper" and j.target not in open_ids:
                continue  # the master may only read papers the user has open
            jobs.append(j.model_dump())
        if not jobs:  # always gather something
            jobs = [{"kind": "search_literature", "target": "", "query": state["message"][:120]}]
        return {"jobs": jobs, "events": [{"type": "dispatch", "jobs": jobs}]}

    def fan_out(state: CopilotState):
        return [Send("worker", {"job": j, "open_papers": state.get("open_papers") or []}) for j in state["jobs"]]

    async def worker(state: CopilotState):
        job = state["job"]
        async with sem:
            try:
                ev = await _run_job(job, deps, ft, docs)
                status, note = "done", f"{len(ev)} items"
            except Exception as e:  # one failed worker must not sink the answer
                ev, status, note = [], "failed", type(e).__name__
        return {"evidence": ev, "events": [{"type": "job", "job": job, "status": status, "note": note}]}

    g = StateGraph(CopilotState)
    g.add_node("master", master)
    g.add_node("worker", worker)
    g.add_edge(START, "master")
    g.add_conditional_edges("master", fan_out, ["worker"])
    g.add_edge("worker", END)
    return g.compile()


async def _run_job(job: dict, deps: Deps, ft, docs: dict[str, list[dict]] | None = None) -> list[dict]:
    kind, q = job["kind"], job["query"]
    if kind == "read_paper":
        pid = job["target"]
        if docs and pid in docs:  # a PDF the user brought: rank its passages here, nothing is stored
            return doc_passages(pid, docs[pid], q, 5)
        status = await ft.ensure_fulltext(pid)
        if status["status"] == "ready":
            rows = await ft.search_passages([pid], q, k=5)
            return [
                {
                    "id": f"S:{r['paper_id']}:{r['idx']}",
                    "kind": "passage",
                    "paper_id": r["paper_id"],
                    "title": r["title"],
                    "page": r["page"],
                    "text": r["text"],
                }
                for r in rows
            ]
        # No open-access full text: fall back to the paper's own record (abstract).
        row = await deps.tools.paper(pid)
        if not row:
            return []
        flags = [f for f, on in (("retracted", row["is_retracted"]), ("preprint", row["is_preprint"])) if on]
        return [
            {
                "id": f"P:{pid}",
                "kind": "paper",
                "title": row["title"],
                "year": row["year"],
                "venue": row["venue"],
                "authors": (row.get("authors") or [])[:3],
                "cited_by": row["cited_by_count"],
                "flags": flags,
                "doi": row["doi"],
                "abstract": (row["abstract"] or "")[:2000],
            }
        ]
    if kind == "search_literature":
        hits = await deps.tools.search(q, 8, None)
        return [{**paper_evidence(h), "abstract": (h.abstract or "")[:600]} for h in hits]
    if kind == "topic_trend":
        from datetime import date

        y1 = date.today().year
        t = await deps.tools.trend(q, y1 - 12, y1)
        key = re.sub(r"[^a-z0-9]+", "_", q.lower()).strip("_")[:24] or "topic"
        return trend_evidence(key, q, t)
    return []


def doc_passages(pid: str, passages: list[dict], query: str, k: int) -> list[dict]:
    from ..fulltext import rank_passages

    title = passages[0].get("title") or "Uploaded document" if passages else ""
    return [
        {
            "id": f"S:{pid}:{i}",
            "kind": "passage",
            "paper_id": pid,
            "title": title,
            "page": passages[i]["page"],
            "text": passages[i]["text"],
        }
        for i in rank_passages(passages, query, k)
    ]


def selection_evidence(sel: dict | None, titles: dict[str, str]) -> list[dict]:
    if not sel:
        return []
    pid = sel["paper_id"]
    return [
        {
            "id": f"H:{pid}:{sel['page']}",
            "kind": "highlight",
            "paper_id": pid,
            "title": titles.get(pid, pid),
            "page": sel["page"],
            "text": sel["text"][:3000],
        }
    ]


def ledger_text(evidence: list[dict]) -> str:
    lines = []
    for e in evidence:
        if e["kind"] == "highlight":
            lines.append(f'[{e["id"]}] passage the USER HIGHLIGHTED, page {e["page"]} of "{e["title"]}": {e["text"]}')
        elif e["kind"] == "passage":
            lines.append(f'[{e["id"]}] passage, page {e["page"]} of "{e["title"]}": {e["text"]}')
        elif e["kind"] == "paper":
            flags = f" FLAGS: {', '.join(e['flags'])}." if e.get("flags") else ""
            who = ", ".join(e.get("authors") or [])
            lines.append(
                f'[{e["id"]}] paper "{e["title"]}" ({who}, {e.get("year")}, {e.get("venue") or "n/a"}, '
                f"{e.get('cited_by', 0)} citations).{flags} Abstract: {e.get('abstract', '')}"
            )
        elif e["kind"] == "metric":
            lines.append(f"[{e['id']}] metric for {e['topic']}: {e['label']} = {e['value']}")
    return "\n".join(lines)


def dedupe_evidence(evidence: list[dict]) -> list[dict]:
    seen, out = set(), []
    for e in evidence:
        if e["id"] not in seen:
            seen.add(e["id"])
            out.append(e)
    return out


_CITE = re.compile(r"\[((?:[SPMCH]):[^\]\s]+)\]")


def verify_answer(answer: str, evidence: list[dict]) -> dict:
    """Deterministic check: every cited id must exist; report uncited paragraphs and retracted citations."""
    known = {e["id"]: e for e in evidence}
    cited = _CITE.findall(answer)
    invalid = sorted({c for c in cited if c not in known})
    retracted = sorted({c for c in cited if c in known and "retracted" in (known[c].get("flags") or [])})
    paragraphs = [p for p in re.split(r"\n\s*\n", answer) if len(p.strip()) > 80 and not p.lstrip().startswith("#")]
    uncited = sum(1 for p in paragraphs if not _CITE.search(p))
    return {
        "citations": len(cited),
        "valid": len([c for c in cited if c in known]),
        "invalid": invalid,
        "retracted": retracted,
        "paragraphs": len(paragraphs),
        "uncited_paragraphs": uncited,
    }


async def write_answer(llm: LLM, *, message: str, mode: str, history: str, evidence: list[dict]):
    system = WRITER.format(mode_rule=MODE_RULES.get(mode, MODE_RULES["ask"]))
    if any(e["kind"] == "highlight" for e in evidence):
        system += (
            "\nThe user highlighted a passage (its id starts with H:). Focus on it and cite it when you discuss it."
        )
    prompt = (
        f"Evidence ledger:\n{ledger_text(evidence) or '(empty: say that no evidence was found)'}\n\n"
        f"Recent conversation:\n{history or '(none)'}\n\nUser: {message}"
    )
    async for chunk in llm.stream_text(tier="strong", system=system, prompt=prompt):
        yield chunk
