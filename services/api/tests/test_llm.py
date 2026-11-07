"""Provider adapters, exercised with fake SDK clients (no network, no keys)."""

from types import SimpleNamespace

import pytest

from scholarlens.agents.llm import AgentError, GeminiLLM, resolve_provider
from scholarlens.agents.schemas import SearchQueries
from scholarlens.config import Settings


class TextDelta:  # the adapter matches the SDK's delta class by name
    def __init__(self, text):
        self.text = text


class FakeInteractions:
    """Mimics the SDK's streamed interaction: text deltas, then a completed event."""

    def __init__(self, result=None, exc=None):
        self.result, self.exc, self.calls = result, exc, []

    async def create(self, **kwargs):
        self.calls.append(kwargs)
        if self.exc:
            raise self.exc
        text, final = self.result
        half = len(text) // 2

        async def events():
            for chunk in (text[:half], text[half:]):
                yield SimpleNamespace(event_type="step.delta", delta=TextDelta(chunk))
            yield SimpleNamespace(event_type="interaction.completed", interaction=final)

        return events()


def fake_client(**kw):
    inter = FakeInteractions(**kw)
    return SimpleNamespace(aio=SimpleNamespace(interactions=inter)), inter


def interaction(text, status="completed"):
    usage = SimpleNamespace(total_input_tokens=100, total_output_tokens=20, total_thought_tokens=5)
    return text, SimpleNamespace(status=status, usage=usage)


def settings(**kw):
    return Settings(_env_file=None, **kw)


async def test_gemini_parses_typed_answer_and_tracks_usage():
    client, inter = fake_client(result=interaction('```json\n{"queries": ["a", "b"]}\n```'))
    llm = GeminiLLM(settings(), client=client)
    out = await llm.structured(tier="fast", system="sys", prompt="p", schema=SearchQueries)
    assert out.queries == ["a", "b"]
    assert llm.usage.calls == 1 and llm.usage.input_tokens == 100 and llm.usage.output_tokens == 25
    call = inter.calls[0]
    assert call["model"] == "gemini-3.5-flash-lite" and call["store"] is False and call["stream"] is True
    assert call["response_format"]["schema"]["title"] == "SearchQueries"


async def test_gemini_strong_tier_uses_strong_model():
    client, inter = fake_client(result=interaction('{"queries": []}'))
    await GeminiLLM(settings(), client=client).structured(tier="strong", system="s", prompt="p", schema=SearchQueries)
    assert inter.calls[0]["model"] == "gemini-3.6-flash"
    assert inter.calls[0]["generation_config"]["thinking_level"] == "medium"


@pytest.mark.parametrize(
    "result,exc,msg",
    [
        (interaction("not json"), None, "invalid"),
        (interaction('{"queries": []}', status="incomplete"), None, "output space"),
        (None, type("E", (Exception,), {"status_code": 429})(), "quota"),
    ],
)
async def test_gemini_failures_become_agent_errors(result, exc, msg, monkeypatch):
    monkeypatch.setattr("scholarlens.agents.llm.asyncio.sleep", _no_sleep)
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


async def _no_sleep(_):
    return None


class FlakyInteractions(FakeInteractions):
    """First call streams truncated JSON with no completion event; second call succeeds."""

    async def create(self, **kwargs):
        if not self.calls:
            self.calls.append(kwargs)

            async def cut():
                yield SimpleNamespace(event_type="step.delta", delta=TextDelta('{"queries": ["a'))

            return cut()
        return await super().create(**kwargs)


async def test_gemini_retries_truncated_stream(monkeypatch):
    monkeypatch.setattr("scholarlens.agents.llm.asyncio.sleep", _no_sleep)
    inter = FlakyInteractions(result=interaction('{"queries": ["a"]}'))
    client = SimpleNamespace(aio=SimpleNamespace(interactions=inter))
    llm = GeminiLLM(settings(), client=client)
    out = await llm.structured(tier="fast", system="s", prompt="p", schema=SearchQueries)
    assert out.queries == ["a"] and len(inter.calls) == 2


async def test_gemini_does_not_retry_quota_errors(monkeypatch):
    monkeypatch.setattr("scholarlens.agents.llm.asyncio.sleep", _no_sleep)
    client, inter = fake_client(exc=type("E", (Exception,), {"status_code": 429})())
    with pytest.raises(AgentError, match="quota"):
        await GeminiLLM(settings(), client=client).structured(tier="fast", system="s", prompt="p", schema=SearchQueries)
    assert len(inter.calls) == 1
