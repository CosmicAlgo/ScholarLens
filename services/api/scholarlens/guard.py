"""Abuse guardrails for a public beta.

- Per-IP request rate (sliding minute) for every endpoint.
- Per-IP daily cap on AI calls. The client id header is chosen by the browser and can be changed at
  will, so the per-client quota alone cannot stop a script; the IP cap can. (Caddy overwrites
  X-Forwarded-For, and the API is reachable only through Caddy, so the IP cannot be spoofed.)
- A request body limit, so nobody can post huge payloads.
- AI_PAUSED=true turns every AI endpoint off at once (a kill switch) without touching anything else.

Counters live in memory: the API is one process, and a restart resetting them is acceptable.
"""

import time
from collections import defaultdict, deque
from datetime import date

from fastapi import HTTPException, Request
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.responses import JSONResponse

from .config import get_settings

MAX_BODY_BYTES = 8 * 1024 * 1024
# Endpoints that call the LLM (smart search counts too; it may call it once per new query).
AI_PATHS = (
    "/api/copilot",
    "/api/extract",
    "/api/figures",
    "/api/runs",
    "/api/refcheck",
    "/api/court",
    "/api/telephone",
)

_minute: dict[str, deque] = defaultdict(deque)
_daily: dict[str, int] = defaultdict(int)
_day = {"d": date.today()}


def client_ip(request: Request) -> str:
    return request.client.host if request.client else "unknown"


def is_ai_call(request: Request) -> bool:
    if request.method != "POST":
        return False
    p = request.url.path
    return p.startswith(AI_PATHS) and not p.endswith("/cancel")


def _count_ai(ip: str) -> bool:
    today = date.today()
    if _day["d"] != today:
        _day["d"] = today
        _daily.clear()
    if _daily[ip] >= get_settings().ai_calls_per_ip_per_day:
        return False
    _daily[ip] += 1
    return True


def _rate_ok(ip: str) -> bool:
    now = time.monotonic()
    q = _minute[ip]
    while q and now - q[0] > 60:
        q.popleft()
    if len(q) >= get_settings().requests_per_ip_per_minute:
        return False
    q.append(now)
    return True


class GuardMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next):
        if request.method == "OPTIONS" or request.url.path == "/health":
            return await call_next(request)
        ip = client_ip(request)
        if not _rate_ok(ip):
            return JSONResponse({"detail": "Too many requests. Please slow down for a minute."}, status_code=429)
        if request.method == "POST":
            length = request.headers.get("content-length")
            if length is None and "chunked" in request.headers.get("transfer-encoding", "").lower():
                return JSONResponse({"detail": "Content-Length required."}, status_code=411)
            if length is not None and (not length.isdigit() or int(length) > MAX_BODY_BYTES):
                return JSONResponse({"detail": "Request too large."}, status_code=413)
        if is_ai_call(request):
            if get_settings().ai_paused:
                return JSONResponse(
                    {"detail": "AI features are paused for maintenance. Reading and search still work."},
                    status_code=503,
                )
            if not _count_ai(ip):
                return JSONResponse(
                    {"detail": "Daily AI limit reached for your network. It resets at midnight UTC."}, status_code=429
                )
        return await call_next(request)


_smart: dict[str, int] = defaultdict(int)


def allow_smart_search(request: Request) -> bool:
    """Smart search may call the LLM once per new query. It has its own per-IP allowance and
    quietly falls back to plain search when AI is paused or the allowance is used up."""
    if get_settings().ai_paused:
        return False
    ip = client_ip(request)
    today = date.today()
    if _day["d"] != today:
        _day["d"] = today
        _daily.clear()
        _smart.clear()
    if _smart[ip] >= get_settings().smart_searches_per_ip_per_day:
        return False
    _smart[ip] += 1
    return True


def reject_if_paused() -> None:
    if get_settings().ai_paused:
        raise HTTPException(503, "AI features are paused for maintenance.")
