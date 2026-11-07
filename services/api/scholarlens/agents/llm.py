"""The only place that talks to an LLM provider.

Every agent asks for a typed (Pydantic) answer, so agents never parse free text.
Usage is accumulated per run for cost tracking.

Providers:
- Gemini (default when GEMINI_API_KEY is set). On a billed key, prompts are not used to improve
  Google's products; on the free tier they may be, so the privacy page must match the key in use.
- Anthropic (when ANTHROPIC_API_KEY is set and LLM_PROVIDER=anthropic, or no Gemini key).
"""

import asyncio
import os
from dataclasses import dataclass
from typing import Literal, Protocol, TypeVar

from pydantic import BaseModel, ValidationError

from ..config import Settings

T = TypeVar("T", bound=BaseModel)
Tier = Literal["fast", "strong"]

# Anthropic models that support the server-side refusal fallback ("default" form).
_FALLBACK_MODELS = {"claude-opus-5-5", "claude-opus-5", "claude-fable-5-1", "claude-sonnet-5-5"}
_MAX_OUTPUT_TOKENS = 16000


class AgentError(RuntimeError):
    """The model could not produce a usable answer (refusal, truncation, invalid output, quota)."""


@dataclass
class Usage:
    input_tokens: int = 0
    output_tokens: int = 0
    calls: int = 0


class LLM(Protocol):
    usage: Usage
    provider: str

    async def structured(self, *, tier: Tier, system: str, prompt: str, schema: type[T]) -> T: ...


def _status_error(status: int | None) -> AgentError:
    if status == 429:
        return AgentError("The AI provider's free quota is used up for now; try again later.")
    return AgentError(f"AI provider error ({status or 'unknown'}).")


# --------------------------------------------------------------------------- Gemini


class GeminiLLM:
    provider = "gemini"

    def __init__(self, settings: Settings, client=None):
        if client is None:
            from google import genai

            key = settings.gemini_api_key or os.environ.get("GEMINI_API_KEY") or os.environ.get("GOOGLE_API_KEY")
            client = genai.Client(api_key=key)
        self.settings = settings
        self.client = client
        self.usage = Usage()

    def _model(self, tier: Tier) -> tuple[str, str]:
        s = self.settings
        if tier == "fast":
            return s.gemini_fast_model, s.llm_fast_effort
        return s.gemini_strong_model, s.llm_strong_effort

    async def structured(self, *, tier: Tier, system: str, prompt: str, schema: type[T]) -> T:
        last: AgentError | None = None
        for attempt in range(_GEMINI_ATTEMPTS):
            try:
                return await self._once(tier, system, prompt, schema)
            except _Transient as e:
                last = e
                await asyncio.sleep(1.5 * (attempt + 1))
        assert last is not None
        raise AgentError(str(last)) from last.__cause__

    async def _once(self, tier: Tier, system: str, prompt: str, schema: type[T]) -> T:
        model, effort = self._model(tier)
        # Streamed: long generations (the writer) exceed the ~60 s idle limit of a plain request.
        parts: list[str] = []
        final = None
        try:
            stream = await self.client.aio.interactions.create(
                model=model,
                input=prompt,
                system_instruction=system,
                store=False,
                stream=True,
                generation_config={"max_output_tokens": _MAX_OUTPUT_TOKENS, "thinking_level": effort},
                response_format={"type": "text", "mime_type": "application/json", "schema": schema.model_json_schema()},
            )
            async for ev in stream:
                kind = getattr(ev, "event_type", None)
                if kind == "step.delta" and type(ev.delta).__name__ == "TextDelta":
                    parts.append(ev.delta.text or "")
                elif kind == "interaction.completed":
                    final = ev.interaction
                elif kind == "error":
                    code = getattr(getattr(ev, "error", None), "code", None)
                    raise _classify(code if isinstance(code, int) else None)
        except AgentError:
            raise
        except Exception as e:  # the SDK raises several error families; map all to a safe message
            status = getattr(e, "status_code", None) or getattr(e, "code", None)
            if not isinstance(status, int):
                if "connect" in type(e).__name__.lower() or "timeout" in type(e).__name__.lower():
                    raise _Transient("Could not reach the AI provider.") from e
                status = None
            raise _classify(status) from e

        self.usage.calls += 1
        u = getattr(final, "usage", None)
        if u is not None:
            self.usage.input_tokens += u.total_input_tokens or 0
            self.usage.output_tokens += (u.total_output_tokens or 0) + (u.total_thought_tokens or 0)

        if final is None:
            raise _Transient("The AI provider's response was cut off.")
        status = getattr(final, "status", None)
        if status == "incomplete":
            raise AgentError("The model ran out of output space.")
        if status != "completed":
            raise AgentError(f"The model did not finish ({status}).")
        text = "".join(parts)
        if not text:
            raise _Transient("The model returned an empty answer.")
        try:
            return schema.model_validate_json(_strip_fences(text))
        except ValidationError as e:
            raise _Transient("The model returned an invalid answer.") from e


class _Transient(AgentError):
    """Worth retrying: dropped streams, malformed output, connection errors, server errors."""


_GEMINI_ATTEMPTS = 3


def _classify(status: int | None) -> AgentError:
    err = _status_error(status)
    if status is None or status >= 500:
        return _Transient(str(err))
    return err


def _strip_fences(text: str) -> str:
    t = text.strip()
    if t.startswith("```"):
        t = t.split("\n", 1)[1] if "\n" in t else ""
        t = t.rsplit("```", 1)[0]
    return t.strip()


# --------------------------------------------------------------------------- Anthropic


class AnthropicLLM:
    provider = "anthropic"

    def __init__(self, settings: Settings, client=None):
        import anthropic

        self._anthropic = anthropic
        self.settings = settings
        self.client = client or anthropic.AsyncAnthropic(api_key=settings.anthropic_api_key or None, max_retries=3)
        self.usage = Usage()

    def _model(self, tier: Tier) -> tuple[str, str]:
        s = self.settings
        if tier == "fast":
            return s.anthropic_fast_model, s.llm_fast_effort
        return s.anthropic_strong_model, s.llm_strong_effort

    async def structured(self, *, tier: Tier, system: str, prompt: str, schema: type[T]) -> T:
        anthropic = self._anthropic
        model, effort = self._model(tier)
        extra = {}
        if model in _FALLBACK_MODELS:
            extra = {"betas": ["server-side-fallback-2026-07-01"], "fallbacks": "default"}
        try:
            resp = await self.client.beta.messages.parse(
                model=model,
                max_tokens=_MAX_OUTPUT_TOKENS,
                system=system,
                messages=[{"role": "user", "content": prompt}],
                output_format=schema,
                output_config={"effort": effort},
                **extra,
            )
        except anthropic.APIStatusError as e:
            raise _status_error(e.status_code) from e
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


# --------------------------------------------------------------------------- selection


def resolve_provider(settings: Settings) -> str | None:
    """Which provider to use, or None if no key is configured (AI reports disabled)."""
    gemini = settings.gemini_api_key or os.environ.get("GEMINI_API_KEY") or os.environ.get("GOOGLE_API_KEY")
    claude = settings.anthropic_api_key or os.environ.get("ANTHROPIC_API_KEY")
    choice = settings.llm_provider
    if choice == "gemini":
        return "gemini" if gemini else None
    if choice == "anthropic":
        return "anthropic" if claude else None
    return "gemini" if gemini else "anthropic" if claude else None


def make_llm(settings: Settings) -> LLM | None:
    provider = resolve_provider(settings)
    if provider == "gemini":
        return GeminiLLM(settings)
    if provider == "anthropic":
        return AnthropicLLM(settings)
    return None
