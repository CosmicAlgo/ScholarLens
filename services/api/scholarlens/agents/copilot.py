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

Mode = Literal["ask", "explain", "critique", "brainstorm", "related", "compare"]
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
- 1 to 5 jobs. Queries name the subject only, no words like "research" or "trends"."""

MODE_RULES = {
    "ask": "Answer the question directly and concisely.",
    "explain": "Explain the paper or concept clearly for a smart non-specialist: the problem, the idea, "
    "how it works, and the results. Define jargon briefly.",
    "critique": "Act as a careful peer reviewer: strengths, weaknesses, assumptions, threats to validity, "
    "and what evidence would change your mind. Be specific and fair.",
    "brainstorm": "Propose concrete research or build ideas. For each idea give: the idea, why it is "
    "promising (cite the gap or finding it builds on), and a first experiment. Mark ideas as ideas, "
    "not facts.",
    "related": "Map the related work: group the papers into themes, say how each relates to the open "
    "paper or question, and point out what is missing.",
    "compare": "Compare the papers or approaches side by side: goals, methods, data, results, limits. "
    "A compact markdown table is welcome.",
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
    jobs: list[dict]
    job: dict
    evidence: Annotated[list[dict], operator.add]
    events: Annotated[list[dict], operator.add]


def _open_list(state: CopilotState) -> str:
    papers = state.get("open_papers") or []
    return "\n".join(f"- {p['id']}: {p['title']}" for p in papers) or "(none)"


def build_dispatcher(deps: Deps, fulltext=None):
    """Graph: master → parallel workers (LangGraph Send) → END. `fulltext` is injectable for tests."""
    from .. import fulltext as live_fulltext

    ft = fulltext or live_fulltext
    sem = asyncio.Semaphore(MAX_PARALLEL)

    async def master(state: CopilotState):
        prompt = (
            f"Mode: {state.get('mode', 'ask')}\nOpen papers:\n{_open_list(state)}\n\n"
            f"Recent conversation:\n{state.get('history') or '(none)'}\n\nUser: {state['message']}"
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
                ev = await _run_job(job, deps, ft)
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


async def _run_job(job: dict, deps: Deps, ft) -> list[dict]:
    kind, q = job["kind"], job["query"]
    if kind == "read_paper":
        pid = job["target"]
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
        # No open-access full text: fall back to the abstract.
        hits = [h for h in await deps.tools.search(q, 30, None) if h.id == pid]
        return [{**paper_evidence(h), "abstract": (h.abstract or "")[:1200]} for h in hits[:1]]
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


def ledger_text(evidence: list[dict]) -> str:
    lines = []
    for e in evidence:
        if e["kind"] == "passage":
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


_CITE = re.compile(r"\[((?:[SPMC]):[^\]\s]+)\]")


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
    prompt = (
        f"Evidence ledger:\n{ledger_text(evidence) or '(empty: say that no evidence was found)'}\n\n"
        f"Recent conversation:\n{history or '(none)'}\n\nUser: {message}"
    )
    async for chunk in llm.stream_text(tier="strong", system=system, prompt=prompt):
        yield chunk
