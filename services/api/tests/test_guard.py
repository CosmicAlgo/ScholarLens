"""Abuse guardrails: per-IP rate and AI caps, body size, the AI kill switch."""

from fastapi import FastAPI
from fastapi.testclient import TestClient

from scholarlens import guard
from scholarlens.config import get_settings


def make_app():
    app = FastAPI()
    app.add_middleware(guard.GuardMiddleware)

    @app.post("/api/copilot")
    async def copilot():
        return {"ok": True}

    @app.get("/api/search")
    async def search():
        return {"ok": True}

    return app


def reset():
    guard._minute.clear()
    guard._daily.clear()
    guard._smart.clear()


def test_ai_calls_are_capped_per_ip_whatever_the_client_id(monkeypatch):
    reset()
    s = get_settings()
    monkeypatch.setattr(s, "ai_calls_per_ip_per_day", 2)
    c = TestClient(make_app())
    codes = [c.post("/api/copilot", json={}, headers={"X-Client-Id": f"id{i}"}).status_code for i in range(3)]
    assert codes == [200, 200, 429]
    assert c.get("/api/search").status_code == 200  # reading and search keep working


def test_rate_limit_and_body_size(monkeypatch):
    reset()
    s = get_settings()
    monkeypatch.setattr(s, "requests_per_ip_per_minute", 3)
    c = TestClient(make_app())
    assert [c.get("/api/search").status_code for _ in range(4)] == [200, 200, 200, 429]
    reset()
    big = c.post(
        "/api/copilot", content=b"x" * (guard.MAX_BODY_BYTES + 1), headers={"Content-Type": "application/json"}
    )
    assert big.status_code == 413


def test_kill_switch_turns_ai_off(monkeypatch):
    reset()
    monkeypatch.setattr(get_settings(), "ai_paused", True)
    c = TestClient(make_app())
    assert c.post("/api/copilot", json={}).status_code == 503
    assert c.get("/api/search").status_code == 200


def test_trending_ranks_growth_against_the_whole_field():
    from scholarlens.trending import rank

    prev = {"T1": ("Steady", 1000), "T2": ("Rising", 1000), "T3": ("Tiny", 10), "T4": ("Falling", 1000)}
    recent = {"T1": ("Steady", 1100), "T2": ("Rising", 2200), "T3": ("Tiny", 500), "T4": ("Falling", 700)}
    out = rank(recent, prev)
    assert [r["name"] for r in out["rising"]] == ["Rising"]  # Steady only kept pace; Tiny is too small
    assert out["busiest"][0]["name"] == "Rising"
