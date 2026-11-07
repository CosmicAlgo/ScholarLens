"""ScholarLens HTTP API.

Free, deterministic endpoints (no LLM cost): /api/trend, /api/compare, /api/search, /api/papers.
Agent endpoint (LLM cost, rate-limited): POST /api/runs, streamed as Server-Sent Events.
"""

import json
import logging
import uuid
from contextlib import asynccontextmanager
from datetime import date

from fastapi import FastAPI, Header, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from psycopg.types.json import Jsonb
from pydantic import BaseModel, Field
from sse_starlette.sse import EventSourceResponse

from . import openalex
from .agents.deps import Deps, LiveTools
from .agents.graph import build_graph
from .agents.llm import AgentError, make_llm
from .config import get_settings
from .db import close_pool, open_pool, pool
from .search import get_paper, search_papers

log = logging.getLogger("scholarlens")


@asynccontextmanager
async def lifespan(app: FastAPI):
    await open_pool()
    yield
    await close_pool()


app = FastAPI(title="ScholarLens API", version="0.2.0", lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=get_settings().cors_origins,
    allow_methods=["GET", "POST"],
    allow_headers=["Content-Type", "X-Client-Id"],
)


@app.get("/health")
async def health():
    async with pool().connection() as conn:
        n = (await (await conn.execute("SELECT count(*) AS n FROM papers")).fetchone())["n"]
    return {"ok": True, "papers": n}


# ---------- Free, deterministic endpoints ----------


def _year_range(year_from: int | None) -> tuple[int, int]:
    now = date.today().year
    return max(1990, year_from or now - 12), now


@app.get("/api/trend")
async def trend(q: str = Query(..., min_length=2, max_length=200), year_from: int | None = None):
    y0, y1 = _year_range(year_from)
    try:
        result = await LiveTools().trend(q, y0, y1)
    except openalex.OpenAlexError as e:
        raise HTTPException(502, "Upstream data source is unavailable; try again shortly.") from e
    return {"query": q, **result.to_dict()}


@app.get("/api/compare")
async def compare(q: list[str] = Query(..., max_length=4), year_from: int | None = None):
    out = []
    for topic in q[:4]:
        if not 2 <= len(topic) <= 200:
            raise HTTPException(422, "each topic must be 2-200 characters")
        out.append(await trend(topic, year_from))
    return {"topics": out}


@app.get("/api/search")
async def search(
    q: str = Query(..., min_length=2, max_length=200),
    year_from: int | None = None,
    year_to: int | None = None,
    limit: int = Query(20, ge=1, le=50),
):
    hits = await search_papers(q, limit=limit, year_from=year_from, year_to=year_to)
    return {"query": q, "results": [h.public() for h in hits]}


@app.get("/api/papers/{paper_id}")
async def paper(paper_id: str):
    if not paper_id.startswith("W") or not paper_id[1:].isdigit():
        raise HTTPException(404)
    row = await get_paper(paper_id)
    if not row:
        raise HTTPException(404)
    return row


# ---------- Agent runs (LLM cost, rate-limited) ----------


class RunRequest(BaseModel):
    question: str = Field(min_length=5, max_length=500)


async def _check_quota(client_id: str) -> None:
    s = get_settings()
    async with pool().connection() as conn:
        row = await (
            await conn.execute(
                """SELECT count(*) FILTER (WHERE client_id = %s) AS mine, count(*) AS total
               FROM agent_runs WHERE created_at > now() - interval '1 day' AND status <> 'failed'""",
                (client_id,),
            )
        ).fetchone()
    if row["total"] >= s.agent_runs_global_per_day:
        raise HTTPException(429, "ScholarLens has hit today's AI budget. Trend and search still work.")
    if row["mine"] >= s.agent_runs_per_client_per_day:
        raise HTTPException(429, f"You've used today's {s.agent_runs_per_client_per_day} AI reports. Back tomorrow!")


def _public_result(state: dict) -> dict:
    landscapes = {
        k: [{kk: vv for kk, vv in c.items() if kk != "paper_ids"} for c in v]
        for k, v in (state.get("landscapes") or {}).items()
    }
    return {
        "plan": state.get("plan"),
        "report": state.get("report"),
        "verification": state.get("verification"),
        "trends": {
            k: {**v, "result": v["result"].to_dict() if hasattr(v.get("result"), "to_dict") else v.get("result")}
            for k, v in (state.get("trends") or {}).items()
        },
        "landscapes": landscapes,
        "trust": state.get("trust"),
        "evidence": state.get("evidence"),
        "stopped": state.get("stopped"),
    }


@app.post("/api/runs")
async def create_run(body: RunRequest, x_client_id: str = Header(default="anonymous", max_length=64)):
    llm = make_llm(get_settings())
    if llm is None:
        raise HTTPException(503, "AI reports are not enabled on this server yet. Trend and search still work.")
    await _check_quota(x_client_id)
    run_id = uuid.uuid4()
    async with pool().connection() as conn:
        await conn.execute(
            "INSERT INTO agent_runs (id, question, client_id) VALUES (%s, %s, %s)",
            (run_id, body.question, x_client_id),
        )

    graph = build_graph(Deps(llm=llm, tools=LiveTools()))

    async def stream():
        state: dict = {"question": body.question}
        status, error = "done", None
        yield {"event": "run", "data": json.dumps({"id": str(run_id)})}
        try:
            async for update in graph.astream({"question": body.question}, stream_mode="updates"):
                for node, delta in update.items():
                    delta = delta or {}
                    for key, value in delta.items():
                        if key in ("evidence", "trends", "hits", "landscapes") and isinstance(value, dict):
                            state[key] = {**state.get(key, {}), **value}
                        elif key == "events":
                            state.setdefault("events", []).extend(value)
                        else:
                            state[key] = value
                    for msg in delta.get("events", []):
                        yield {"event": "progress", "data": json.dumps({"node": node, "message": msg})}
            yield {"event": "result", "data": json.dumps(_public_result(state), default=str)}
        except AgentError as e:
            status, error = "failed", str(e)
            yield {"event": "error", "data": json.dumps({"message": str(e)})}
        except Exception as e:  # never leak internals to the client
            log.exception("agent run %s failed", run_id)
            status, error = "failed", repr(e)
            yield {"event": "error", "data": json.dumps({"message": "Something went wrong running this analysis."})}
        finally:
            async with pool().connection() as conn:
                await conn.execute(
                    """UPDATE agent_runs SET status=%s, error=%s, plan=%s, report=%s, input_tokens=%s,
                       output_tokens=%s, finished_at=now() WHERE id=%s""",
                    (
                        status,
                        error,
                        Jsonb(state.get("plan")),
                        Jsonb(state.get("report")),
                        llm.usage.input_tokens,
                        llm.usage.output_tokens,
                        run_id,
                    ),
                )

    return EventSourceResponse(stream())
