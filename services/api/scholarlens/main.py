"""ScholarLens HTTP API.

Free, deterministic endpoints (no LLM cost): /api/trend, /api/compare, /api/search, /api/papers.
Agent endpoint (LLM cost, rate-limited): POST /api/runs, streamed as Server-Sent Events.
"""

import base64
import binascii
import json
import logging
import uuid
from contextlib import asynccontextmanager
from datetime import date
from typing import Literal

from fastapi import FastAPI, Header, HTTPException, Query, Response
from fastapi.middleware.cors import CORSMiddleware
from psycopg.types.json import Jsonb
from pydantic import BaseModel, Field
from sse_starlette.sse import EventSourceResponse

from . import citegraph, fulltext, lineage, openalex, smart_search
from .agents import copilot, figures, matrix, novelty
from .agents.deps import Deps, LiveTools
from .agents.graph import build_graph
from .agents.llm import AgentError, make_llm
from .config import get_settings
from .db import close_pool, open_pool, pool
from .search import get_paper, search_with_coverage

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
    smart: bool = False,
):
    """`smart=true`: tolerate typos and vague wording (an LLM may rewrite the query; results are
    always real catalogue papers, and the rewrite is returned so the UI can show it)."""
    if smart:
        out = await smart_search.smart_search(make_llm(get_settings()), q, limit, year_from, year_to)
        return {"query": q, "interpreted": out["interpreted"], "results": [h.public() for h in out["results"]]}
    hits = await search_with_coverage(q, limit=limit, year_from=year_from, year_to=year_to)
    return {"query": q, "interpreted": None, "results": [h.public() for h in hits]}


@app.get("/api/papers/{paper_id}")
async def paper(paper_id: str):
    if not paper_id.startswith("W") or not paper_id[1:].isdigit():
        raise HTTPException(404)
    row = await get_paper(paper_id)
    if not row:
        raise HTTPException(404)
    return row


# ---------- Full text (open-access PDFs) ----------


def _valid_id(paper_id: str) -> str:
    if not paper_id.startswith("W") or not paper_id[1:].isdigit() or len(paper_id) > 16:
        raise HTTPException(404)
    return paper_id


@app.get("/api/papers/{paper_id}/pdf")
async def paper_pdf(paper_id: str):
    """Streams the open-access PDF for the in-app reader (never stored on our side)."""
    try:
        data, _, _ = await fulltext.get_pdf(_valid_id(paper_id))
    except fulltext.NoPdf:
        raise HTTPException(404, "No open-access PDF is available for this paper.") from None
    return Response(
        data,
        media_type="application/pdf",
        headers={
            "Content-Disposition": f'inline; filename="{paper_id}.pdf"',
            "Cache-Control": "public, max-age=86400",
        },
    )


@app.post("/api/papers/{paper_id}/fulltext")
async def paper_fulltext(paper_id: str):
    """Index the paper's passages for grounded Q&A. Idempotent; returns status, pages and passage count."""
    return await fulltext.ensure_fulltext(_valid_id(paper_id))


# ---------- Copilot (master + parallel workers + streamed, cited answer) ----------


class ChatTurn(BaseModel):
    role: Literal["user", "assistant"]
    text: str = Field(max_length=6000)


class Passage(BaseModel):
    page: int = Field(ge=1, le=2000)
    text: str = Field(max_length=4000)


class Document(BaseModel):
    """Passages of a PDF the user brought. Extracted in their browser; used for this request only."""

    id: str
    title: str = Field(default="", max_length=500)
    passages: list[Passage] = Field(max_length=600)


MAX_IMAGE_B64 = 2_000_000  # ~1.5 MB JPEG


def _jpeg(b64: str) -> str:
    """Accept only a real base64 JPEG (the browser crops figures to JPEG)."""
    try:
        head = base64.b64decode(b64[:64], validate=True)
    except (binascii.Error, ValueError) as e:
        raise HTTPException(422, "Image is not valid base64.") from e
    if not head.startswith(b"\xff\xd8\xff"):
        raise HTTPException(422, "Image must be a JPEG.")
    return b64


class Selection(BaseModel):
    paper_id: str
    page: int = Field(ge=1, le=2000)
    text: str = Field(default="", max_length=4000)
    image: str | None = Field(default=None, max_length=MAX_IMAGE_B64, description="base64 JPEG of a figure region")


class CopilotRequest(BaseModel):
    message: str = Field(min_length=2, max_length=2000)
    mode: Literal["ask", "explain", "critique", "brainstorm", "related", "compare", "verify"] = "ask"
    open_papers: list[copilot.OpenPaper] = Field(default_factory=list, max_length=5)
    history: list[ChatTurn] = Field(default_factory=list, max_length=12)
    documents: list[Document] = Field(default_factory=list, max_length=5)
    selection: Selection | None = None


def _valid_doc_id(doc_id: str) -> str:
    """Catalogue papers (W123) or uploaded documents (U + 12 hex)."""
    if doc_id.startswith("U") and len(doc_id) == 13 and all(c in "0123456789abcdef" for c in doc_id[1:]):
        return doc_id
    return _valid_id(doc_id)


def _docs(documents: list[Document]) -> dict[str, list[dict]]:
    return {
        _valid_doc_id(d.id): [{"page": x.page, "text": x.text, "title": d.title} for x in d.passages]
        for d in documents
        if d.passages
    }


@app.post("/api/copilot")
async def copilot_chat(body: CopilotRequest, x_client_id: str = Header(default="anonymous", max_length=64)):
    llm = make_llm(get_settings())
    if llm is None:
        raise HTTPException(503, "AI is not enabled on this server yet. Reading, trends and search still work.")
    for p in body.open_papers:
        _valid_doc_id(p.id)
    if body.selection:
        _valid_doc_id(body.selection.paper_id)
        if body.selection.image:
            _jpeg(body.selection.image)
        elif len(body.selection.text.strip()) < 1:
            raise HTTPException(422, "Selection needs text or an image.")
    docs = _docs(body.documents)
    await _check_quota(x_client_id, "copilot")
    run_id = uuid.uuid4()
    async with pool().connection() as conn:
        await conn.execute(
            "INSERT INTO agent_runs (id, question, client_id, kind) VALUES (%s, %s, %s, 'copilot')",
            (run_id, body.message, x_client_id),
        )
    history = "\n".join(f"{t.role}: {t.text[:1500]}" for t in body.history[-6:])
    deps = Deps(llm=llm, tools=LiveTools())
    graph = copilot.build_dispatcher(deps, documents=docs)

    async def stream():
        status, error, answer, evidence = "done", None, "", []
        try:
            state = {
                "message": body.message,
                "mode": body.mode,
                "history": history,
                "open_papers": [p.model_dump() for p in body.open_papers],
                "selection": body.selection.model_dump(exclude={"image"}) | {"image": bool(body.selection.image)}
                if body.selection
                else None,
            }
            titles = {p.id: p.title for p in body.open_papers}
            evidence.extend(copilot.selection_evidence(state["selection"], titles))
            async for update in graph.astream(state, stream_mode="updates"):
                for delta in update.values():
                    for ev in (delta or {}).get("events", []):
                        yield {"event": ev["type"], "data": json.dumps(ev)}
                    evidence.extend((delta or {}).get("evidence", []))
            evidence = copilot.dedupe_evidence(evidence)
            yield {"event": "evidence", "data": json.dumps(evidence, default=str)}
            image = body.selection.image if body.selection else None
            async for chunk in copilot.write_answer(
                llm, message=body.message, mode=body.mode, history=history, evidence=evidence, image=image
            ):
                answer += chunk
                yield {"event": "token", "data": json.dumps({"text": chunk})}
            yield {"event": "verified", "data": json.dumps(copilot.verify_answer(answer, evidence))}
            if body.mode == "brainstorm" and answer:
                try:
                    checked = await novelty.check_ideas(deps, answer)
                    yield {"event": "novelty", "data": json.dumps(checked)}
                except Exception as e:  # the answer is already delivered; the check is a bonus
                    log.warning("novelty check failed for %s: %r", run_id, e)
                    yield {"event": "novelty", "data": json.dumps([])}
        except AgentError as e:
            log.warning("copilot %s failed: %s (cause: %r)", run_id, e, e.__cause__)
            status, error = "failed", f"{e} ({e.__cause__!r})"[:500]
            yield {"event": "error", "data": json.dumps({"message": str(e)})}
        except Exception as e:  # never leak internals to the client
            log.exception("copilot %s failed", run_id)
            status, error = "failed", repr(e)[:500]
            yield {"event": "error", "data": json.dumps({"message": "Something went wrong answering this."})}
        finally:
            async with pool().connection() as conn:
                await conn.execute(
                    """UPDATE agent_runs SET status=%s, error=%s, report=%s, input_tokens=%s, output_tokens=%s,
                       finished_at=now() WHERE id=%s""",
                    (
                        status,
                        error,
                        Jsonb({"answer": answer, "evidence_ids": [e["id"] for e in evidence]}),
                        llm.usage.input_tokens,
                        llm.usage.output_tokens,
                        run_id,
                    ),
                )

    return EventSourceResponse(stream())


class ExtractRequest(BaseModel):
    paper_id: str
    title: str = Field(default="", max_length=500)
    passages: list[Passage] = Field(default_factory=list, max_length=600)


@app.post("/api/extract")
async def extract(body: ExtractRequest, x_client_id: str = Header(default="anonymous", max_length=64)):
    """One evidence-matrix row (problem, method, data, findings, limitations) with cited passages."""
    llm = make_llm(get_settings())
    if llm is None:
        raise HTTPException(503, "AI is not enabled on this server yet.")
    pid = _valid_doc_id(body.paper_id)
    if pid.startswith("U") and not body.passages:
        raise HTTPException(422, "Uploaded documents need their passages.")
    await _check_quota(x_client_id, "copilot")
    run_id = uuid.uuid4()
    async with pool().connection() as conn:
        await conn.execute(
            "INSERT INTO agent_runs (id, question, client_id, kind) VALUES (%s, %s, %s, 'copilot')",
            (run_id, f"[matrix] {body.title or pid}"[:500], x_client_id),
        )
    status, error = "done", None
    try:
        passages = [{"page": x.page, "text": x.text, "title": body.title} for x in body.passages] or None
        return await matrix.extract_row(Deps(llm=llm, tools=LiveTools()), fulltext, pid, body.title, passages)
    except AgentError as e:
        status, error = "failed", str(e)[:500]
        raise HTTPException(502, str(e)) from None
    finally:
        async with pool().connection() as conn:
            await conn.execute(
                """UPDATE agent_runs SET status=%s, error=%s, input_tokens=%s, output_tokens=%s, finished_at=now()
                   WHERE id=%s""",
                (status, error, llm.usage.input_tokens, llm.usage.output_tokens, run_id),
            )


# ---------- Agent runs (LLM cost, rate-limited) ----------


class RunRequest(BaseModel):
    question: str = Field(min_length=5, max_length=500)


async def _check_quota(client_id: str, kind: str = "report") -> None:
    s = get_settings()
    mine_cap, global_cap, noun = (
        (s.agent_runs_per_client_per_day, s.agent_runs_global_per_day, "AI reports")
        if kind == "report"
        else (s.copilot_per_client_per_day, s.copilot_global_per_day, "Copilot messages")
    )
    async with pool().connection() as conn:
        row = await (
            await conn.execute(
                """SELECT count(*) FILTER (WHERE client_id = %s) AS mine, count(*) AS total
               FROM agent_runs
               WHERE created_at > now() - interval '1 day' AND status <> 'failed' AND kind = %s""",
                (client_id, kind),
            )
        ).fetchone()
    if row["total"] >= global_cap:
        raise HTTPException(429, "ScholarLens has hit today's AI budget. Reading, trends and search still work.")
    if row["mine"] >= mine_cap:
        raise HTTPException(429, f"You've used today's {mine_cap} {noun}. Back tomorrow!")


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
            log.warning("agent run %s failed: %s (cause: %r)", run_id, e, e.__cause__)
            status, error = "failed", f"{e} ({e.__cause__!r})"[:500]
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


# ---------- Figures (vision) and the connection map ----------


class PageImage(BaseModel):
    page: int = Field(ge=1, le=2000)
    data: str = Field(max_length=MAX_IMAGE_B64)
    text: str = Field(default="", max_length=20000, description="the page's text, for caption checks")


class FiguresRequest(BaseModel):
    paper_id: str
    title: str = Field(default="", max_length=500)
    query: str | None = Field(default=None, max_length=500)
    images: list[PageImage] = Field(default_factory=list, max_length=6)


@app.post("/api/figures")
async def paper_figures(body: FiguresRequest, x_client_id: str = Header(default="anonymous", max_length=64)):
    """A vision model reads the paper's figures, tables and diagrams. Uploaded PDFs send page images
    rendered in the browser; catalogue papers are read from the server's copy of the PDF."""
    llm = make_llm(get_settings())
    if llm is None:
        raise HTTPException(503, "AI is not enabled on this server yet.")
    pid = _valid_doc_id(body.paper_id)
    if pid.startswith("U") and not body.images:
        raise HTTPException(422, "Uploaded documents need page images.")
    for im in body.images:
        _jpeg(im.data)
    await _check_quota(x_client_id, "copilot")
    deps = Deps(llm=llm, tools=LiveTools())
    run_id = uuid.uuid4()
    async with pool().connection() as conn:
        await conn.execute(
            "INSERT INTO agent_runs (id, question, client_id, kind) VALUES (%s, %s, %s, 'copilot')",
            (run_id, f"figures {pid}", x_client_id),
        )
    status, error, items = "done", None, []
    try:
        if body.images:
            imgs = [(im.page, im.data) for im in body.images]
            texts = {im.page: im.text for im in body.images if im.text}
            items = await figures.read_image_figures(deps, pid, body.title, imgs, body.query, texts)
        else:
            items = await figures.read_pdf_figures(deps, fulltext, pid, body.title, body.query, limit=8)
    except AgentError as e:
        status, error = "failed", str(e)[:500]
        raise HTTPException(502, str(e)) from e
    except fulltext.NoPdf as e:
        status, error = "failed", "no pdf"
        raise HTTPException(404, "No PDF is available for this paper.") from e
    finally:
        async with pool().connection() as conn:
            await conn.execute(
                """UPDATE agent_runs SET status=%s, error=%s, report=%s, input_tokens=%s, output_tokens=%s,
                   finished_at=now() WHERE id=%s""",
                (
                    status,
                    error,
                    Jsonb({"figures": len(items)}),
                    llm.usage.input_tokens,
                    llm.usage.output_tokens,
                    run_id,
                ),
            )
    return {"paper_id": pid, "figures": items}


class GraphRequest(BaseModel):
    ids: list[str] = Field(min_length=1, max_length=8)


@app.post("/api/graph")
async def connection_graph(body: GraphRequest):
    """How the open papers connect: shared references, top references and top citing works (no LLM)."""
    ids = list(dict.fromkeys(_valid_id(i) for i in body.ids))
    try:
        return await citegraph.build(ids)
    except openalex.OpenAlexError as e:
        raise HTTPException(502, "OpenAlex is unavailable right now.") from e


@app.post("/api/lineage")
async def topic_lineage(body: GraphRequest):
    """Where the open papers sit: topics, key terms (first sustained year, early influential papers,
    trend), related topics and the topics later work carried them into. OpenAlex only, no LLM."""
    ids = list(dict.fromkeys(_valid_id(i) for i in body.ids))[:5]
    try:
        return await lineage.build(ids)
    except openalex.OpenAlexError as e:
        raise HTTPException(502, "OpenAlex is unavailable right now.") from e
