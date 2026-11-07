"""The only place that talks to the LLM provider.

Every agent asks for a typed (Pydantic) answer, so agents never parse free text.
Usage is accumulated per run for cost tracking.
"""

from dataclasses import dataclass
from typing import Literal, Protocol, TypeVar

import anthropic
from pydantic import BaseModel

from ..config import Settings

T = TypeVar("T", bound=BaseModel)
Tier = Literal["fast", "strong"]

# Models that support the server-side refusal fallback ("default" form).
_FALLBACK_MODELS = {"claude-opus-5-5", "claude-opus-5", "claude-fable-5-1", "claude-sonnet-5-5"}


class AgentError(RuntimeError):
    """The model could not produce a usable answer (refusal, truncation, invalid output)."""


@dataclass
class Usage:
    input_tokens: int = 0
    output_tokens: int = 0
    calls: int = 0


class LLM(Protocol):
    usage: Usage

    async def structured(self, *, tier: Tier, system: str, prompt: str, schema: type[T]) -> T: ...


class AnthropicLLM:
    def __init__(self, settings: Settings, client: anthropic.AsyncAnthropic | None = None):
        self.settings = settings
        self.client = client or anthropic.AsyncAnthropic(api_key=settings.anthropic_api_key or None, max_retries=3)
        self.usage = Usage()

    def _model(self, tier: Tier) -> tuple[str, str]:
        s = self.settings
        return (s.llm_fast_model, s.llm_fast_effort) if tier == "fast" else (s.llm_strong_model, s.llm_strong_effort)

    async def structured(self, *, tier: Tier, system: str, prompt: str, schema: type[T]) -> T:
        model, effort = self._model(tier)
        extra = {}
        if model in _FALLBACK_MODELS:
            extra = {"betas": ["server-side-fallback-2026-07-01"], "fallbacks": "default"}
        try:
            resp = await self.client.beta.messages.parse(
                model=model,
                max_tokens=16000,
                system=system,
                messages=[{"role": "user", "content": prompt}],
                output_format=schema,
                output_config={"effort": effort},
                **extra,
            )
        except anthropic.RateLimitError as e:
            raise AgentError("The AI provider is rate-limiting us; try again in a minute.") from e
        except anthropic.APIStatusError as e:
            raise AgentError(f"AI provider error ({e.status_code}).") from e
        except anthropic.APIConnectionError as e:
            raise AgentError("Could not reach the AI provider.") from e

        self.usage.calls += 1
        self.usage.input_tokens += resp.usage.input_tokens
        self.usage.output_tokens += resp.usage.output_tokens
        if resp.stop_reason == "refusal":
            raise AgentError("The model declined this request.")
        if resp.stop_reason == "max_tokens":
            raise AgentError("The model ran out of output space.")
        if resp.parsed_output is None:
            raise AgentError("The model returned an invalid answer.")
        return resp.parsed_output
