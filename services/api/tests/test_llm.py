"""Provider adapters, exercised with fake SDK clients (no network, no keys)."""

from types import SimpleNamespace

import pytest

from scholarlens.agents.llm import AgentError, GeminiLLM, resolve_provider
from scholarlens.agents.schemas import SearchQueries
from scholarlens.config import Settings


class FakeInteractions:
    def __init__(self, result=None, exc=None):
        self.result, self.exc, self.calls = result, exc, []

    async def create(self, **kwargs):
        self.calls.append(kwargs)
        if self.exc:
            raise self.exc
        return self.result


def fake_client(**kw):
    inter = FakeInteractions(**kw)
    return SimpleNamespace(aio=SimpleNamespace(interactions=inter)), inter


def interaction(text, status="completed"):
    usage = SimpleNamespace(total_input_tokens=100, total_output_tokens=20, total_thought_tokens=5)
    return SimpleNamespace(output_text=text, status=status, usage=usage)


def settings(**kw):
    return Settings(_env_file=None, **kw)


async def test_gemini_parses_typed_answer_and_tracks_usage():
    client, inter = fake_client(result=interaction('```json\n{"queries": ["a", "b"]}\n```'))
    llm = GeminiLLM(settings(), client=client)
    out = await llm.structured(tier="fast", system="sys", prompt="p", schema=SearchQueries)
    assert out.queries == ["a", "b"]
    assert llm.usage.calls == 1 and llm.usage.input_tokens == 100 and llm.usage.output_tokens == 25
    call = inter.calls[0]
    assert call["model"] == "gemini-3.5-flash-lite" and call["store"] is False
    assert call["response_format"]["schema"]["title"] == "SearchQueries"


async def test_gemini_strong_tier_uses_strong_model():
    client, inter = fake_client(result=interaction('{"queries": []}'))
    await GeminiLLM(settings(), client=client).structured(tier="strong", system="s", prompt="p", schema=SearchQueries)
    assert inter.calls[0]["model"] == "gemini-3.8-flash"
    assert inter.calls[0]["generation_config"]["thinking_level"] == "medium"


@pytest.mark.parametrize(
    "result,exc,msg",
    [
        (interaction("not json"), None, "invalid"),
        (interaction('{"queries": []}', status="incomplete"), None, "output space"),
        (None, type("E", (Exception,), {"status_code": 429})(), "quota"),
    ],
)
async def test_gemini_failures_become_agent_errors(result, exc, msg):
    client, _ = fake_client(result=result, exc=exc)
    with pytest.raises(AgentError, match=msg):
        await GeminiLLM(settings(), client=client).structured(tier="fast", system="s", prompt="p", schema=SearchQueries)


def test_provider_resolution(monkeypatch):
    for v in ("GEMINI_API_KEY", "GOOGLE_API_KEY", "ANTHROPIC_API_KEY"):
        monkeypatch.delenv(v, raising=False)
    assert resolve_provider(settings()) is None
    assert resolve_provider(settings(gemini_api_key="g")) == "gemini"
    assert resolve_provider(settings(anthropic_api_key="a")) == "anthropic"
    assert resolve_provider(settings(gemini_api_key="g", anthropic_api_key="a")) == "gemini"
    both = settings(gemini_api_key="g", anthropic_api_key="a", llm_provider="anthropic")
    assert resolve_provider(both) == "anthropic"
    assert resolve_provider(settings(anthropic_api_key="a", llm_provider="gemini")) is None
