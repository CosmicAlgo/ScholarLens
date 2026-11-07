"""LangGraph orchestration.

            ┌─> trends (Trend Analyst) ─────────────────────────────┐
  planner ──┤                                                        ├─> writer ─> verifier
            └─> scout (Scout) ─> landscape (Cartographer) ─> trust ──┘
                                                         (Trust Auditor)

Each node does one job and returns a partial state update. Trends and scouting run in
parallel; the writer waits for both branches. Out-of-scope questions stop after planning.
"""

import asyncio
import operator
from typing import Annotated, Any, TypedDict

from langgraph.graph import END, START, StateGraph

from . import cartographer, planner, scout, trend_analyst, trust_auditor, verifier, writer
from .deps import Deps
from .evidence import paper_evidence
from .schemas import Report


def merge(a: dict, b: dict) -> dict:
    return {**(a or {}), **(b or {})}


class RunState(TypedDict, total=False):
    question: str
    plan: dict
    evidence: Annotated[dict[str, dict], merge]
    trends: Annotated[dict[str, dict], merge]
    hits: Annotated[dict[str, list], merge]  # in-memory only (holds embeddings)
    landscapes: Annotated[dict[str, list], merge]
    trust: dict
    draft: Report
    report: dict
    verification: dict
    stopped: str
    events: Annotated[list[str], operator.add]


PAPERS_FOR_WRITER = 10


def build_graph(deps: Deps):
    def topics(state: RunState):
        from .schemas import TopicQuery

        return [TopicQuery(**t) for t in state["plan"]["topics"]]

    def year_from(state: RunState) -> int:
        return state["plan"].get("year_from") or deps.current_year - 12

    async def plan_node(state: RunState):
        p = await planner.plan(state["question"], deps)
        labels = ", ".join(t.label for t in p.topics)
        return {"plan": p.model_dump(), "events": [f"Planned analysis of: {labels}" if p.in_scope else "Out of scope"]}

    def after_plan(state: RunState):
        return ["trends", "scout"] if state["plan"]["in_scope"] else "out_of_scope"

    async def out_of_scope_node(state: RunState):
        return {
            "stopped": state["plan"].get("out_of_scope_reason") or "This question is outside what ScholarLens covers."
        }

    async def trends_node(state: RunState):
        y0 = year_from(state)
        results = await asyncio.gather(*(trend_analyst.analyse(t, y0, deps) for t in topics(state)))
        trends, evidence = {}, {}
        for t, (result, ev, insight) in zip(topics(state), results, strict=True):
            trends[t.key] = {"label": t.label, "result": result, "insight": insight.model_dump()}
            evidence.update({e["id"]: e for e in ev})
        return {"trends": trends, "evidence": evidence, "events": ["Computed publication trends"]}

    async def scout_node(state: RunState):
        y0 = state["plan"].get("year_from")
        results = await asyncio.gather(*(scout.scout(t, y0, deps) for t in topics(state)))
        hits = {t.key: r for t, r in zip(topics(state), results, strict=True)}
        evidence = {f"P:{h.id}": paper_evidence(h) for r in results for h in r}
        n = sum(len(r) for r in results)
        return {"hits": hits, "evidence": evidence, "events": [f"Found {n} relevant papers"]}

    async def landscape_node(state: RunState):
        ts = topics(state)
        results = await asyncio.gather(*(cartographer.map_landscape(t, state["hits"].get(t.key, []), deps) for t in ts))
        landscapes, evidence = {}, {}
        for t, (clusters, ev) in zip(ts, results, strict=True):
            landscapes[t.key] = clusters
            evidence.update({e["id"]: e for e in ev})
        n = sum(len(c) for c in landscapes.values())
        return {"landscapes": landscapes, "evidence": evidence, "events": [f"Mapped {n} sub-areas"]}

    async def trust_node(state: RunState):
        report = trust_auditor.audit(state["evidence"])
        return {"trust": report, "events": [f"Checked {report['papers_checked']} papers for retractions"]}

    async def writer_node(state: RunState):
        ev = state["evidence"]
        material: dict[str, Any] = {"topics": {}, "trust_audit": state["trust"]}
        for t in topics(state):
            tr = state["trends"][t.key]
            clusters = state["landscapes"].get(t.key, [])
            reps = {r for c in clusters for r in c["representative"]}
            top = [f"P:{h.id}" for h in state["hits"].get(t.key, [])[:PAPERS_FOR_WRITER]]
            material["topics"][t.key] = {
                "label": t.label,
                "metrics": [e for e in ev.values() if e["id"].startswith(f"M:{t.key}:")],
                "trend_statements": tr["insight"]["statements"],
                "clusters": [{k: v for k, v in c.items() if k != "paper_ids"} for c in clusters],
                "papers": [ev[i] for i in dict.fromkeys(top + sorted(reps)) if i in ev],
            }
        draft = await writer.write(state["question"], material, deps)
        return {"draft": draft, "events": ["Drafted report"]}

    async def verify_node(state: RunState):
        clean, v = verifier.verify(state["draft"], state["evidence"])
        return {
            "report": clean.model_dump(),
            "verification": v.model_dump(),
            "events": [f"Verified: kept {v.claims_kept}/{v.claims_total} claims"],
        }

    g = StateGraph(RunState)
    g.add_node("planner", plan_node)
    g.add_node("out_of_scope", out_of_scope_node)
    g.add_node("trends", trends_node)
    g.add_node("scout", scout_node)
    g.add_node("landscape", landscape_node)
    g.add_node("trust", trust_node)
    g.add_node("writer", writer_node)
    g.add_node("verifier", verify_node)

    g.add_edge(START, "planner")
    g.add_conditional_edges("planner", after_plan, ["trends", "scout", "out_of_scope"])
    g.add_edge("out_of_scope", END)
    g.add_edge("scout", "landscape")
    g.add_edge("landscape", "trust")
    g.add_edge(["trends", "trust"], "writer")
    g.add_edge("writer", "verifier")
    g.add_edge("verifier", END)
    return g.compile()
