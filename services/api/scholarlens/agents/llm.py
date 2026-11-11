"""The only place that talks to an LLM provider.

Every agent asks for a typed (Pydantic) answer, so agents never parse free text.
Usage is accumulated per run for cost tracking.

Providers:
- Gemini (default when GEMINI_API_KEY is set). On a billed key, prompts are not used to improve
  Google's products; on the free tier they may be, so the privacy page must match the key in use.
- Anthropic (when ANTHROPIC_API_KEY is set and LLM_PROVIDER=anthropic, or no Gemini key).
"""

import asyncio
import logging
import os
from collections.abc import AsyncIterator
from dataclasses import dataclass
from typing import Literal, Protocol, TypeVar

from pydantic import BaseModel, ValidationError

from ..config import Settings

T = TypeVar("T", bound=BaseModel)
log = logging.getLogger("scholarlens")
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


@dataclass
class Media:
    """An image or PDF the model should look at (vision). `data` is base64."""

    mime_type: str
    data: str
    label: str | None = None  # sent as text just before the media, e.g. "Page 4 of the paper:"

    @property
    def is_image(self) -> bool:
        return self.mime_type.startswith("image/")


def _gemini_input(prompt: str, media: list[Media] | None):
    if not media:
        return prompt
    blocks: list[dict] = []
    for m in media:
        if m.label:
            blocks.append({"type": "text", "text": m.label})
        blocks.append({"type": "image" if m.is_image else "document", "mime_type": m.mime_type, "data": m.data})
    return [*blocks, {"type": "text", "text": prompt}]


def _anthropic_content(prompt: str, media: list[Media] | None):
    if not media:
        return prompt
    blocks: list[dict] = []
    for m in media:
        if m.label:
            blocks.append({"type": "text", "text": m.label})
        blocks.append(
            {
                "type": "image" if m.is_image else "document",
                "source": {"type": "base64", "media_type": m.mime_type, "data": m.data},
            }
        )
    return [*blocks, {"type": "text", "text": prompt}]


class LLM(Protocol):
    usage: Usage
    provider: str

    async def structured(
        self,
        *,
        tier: Tier,
        system: str,
        prompt: str,
        schema: type[T],
        media: list[Media] | None = None,
        effort: str | None = None,
    ) -> T: ...

    def stream_text(
        self, *, tier: Tier, system: str, prompt: str, media: list[Media] | None = None
    ) -> AsyncIterator[str]: ...


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

    async def structured(
        self,
        *,
        tier: Tier,
        system: str,
        prompt: str,
        schema: type[T],
        media: list[Media] | None = None,
        effort: str | None = None,
    ) -> T:
        if tier == "strong":
            # The free-tier strong model can queue for minutes. Give it one bounded try, then let the
            # fast model do the job rather than leave the user waiting.
            try:
                return await self._once("strong", system, prompt, schema, media, effort, first=STRONG_FIRST_TIMEOUT)
            except _Transient as e:
                log.warning("strong model unavailable (%s); using the fast model", e)
                tier = "fast"
        last: AgentError | None = None
        for attempt in range(_GEMINI_ATTEMPTS):
            try:
                return await self._once(tier, system, prompt, schema, media, effort)
            except _Transient as e:
                last = e
                await asyncio.sleep(1.5 * (attempt + 1))
        assert last is not None
        raise AgentError(str(last)) from last.__cause__

    async def _once(
        self,
        tier: Tier,
        system: str,
        prompt: str,
        schema: type[T],
        media: list[Media] | None,
        effort_override=None,
        first: float = 0.0,
    ) -> T:
        first = first or FIRST_EVENT_TIMEOUT
        model, effort = self._model(tier)
        effort = effort_override or effort
        # Streamed: long generations (the writer) exceed the ~60 s idle limit of a plain request.
        parts: list[str] = []
        final = None
        try:
            stream = await _opened(
                self.client.aio.interactions.create(
                    model=model,
                    input=_gemini_input(prompt, media),
                    system_instruction=system,
                    store=False,
                    stream=True,
                    generation_config={"max_output_tokens": _MAX_OUTPUT_TOKENS, "thinking_level": effort},
                    response_format={
                        "type": "text",
                        "mime_type": "application/json",
                        "schema": schema.model_json_schema(),
                    },
                ),
                first,
            )
            async for ev in _paced(stream, first, IDLE_TIMEOUT):
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

    async def stream_text(
        self,
        *,
        tier: Tier,
        system: str,
        prompt: str,
        media: list[Media] | None = None,
        first_timeout: float | None = None,
        attempts: int | None = None,
    ) -> AsyncIterator[str]:
        """Plain-text streaming (Copilot answers). Retries only if nothing was produced yet.
        `first_timeout` bounds the wait for the first event (the caller may fall back to another model)."""
        model, effort = self._model(tier)
        tries = attempts or _GEMINI_ATTEMPTS
        for attempt in range(tries):
            produced = False
            final = None
            try:
                stream = await _opened(
                    self.client.aio.interactions.create(
                        model=model,
                        input=_gemini_input(prompt, media),
                        system_instruction=system,
                        store=False,
                        stream=True,
                        generation_config={"max_output_tokens": _MAX_OUTPUT_TOKENS, "thinking_level": effort},
                    ),
                    first_timeout or FIRST_EVENT_TIMEOUT,
                )
                async for ev in _paced(stream, first_timeout or FIRST_EVENT_TIMEOUT, IDLE_TIMEOUT):
                    kind = getattr(ev, "event_type", None)
                    if kind == "step.delta" and type(ev.delta).__name__ == "TextDelta" and ev.delta.text:
                        produced = True
                        yield ev.delta.text
                    elif kind == "interaction.completed":
                        final = ev.interaction
                    elif kind == "error":
                        code = getattr(getattr(ev, "error", None), "code", None)
                        raise _classify(code if isinstance(code, int) else None)
            except AgentError as e:
                if produced or not isinstance(e, _Transient) or attempt == tries - 1:
                    raise
                await asyncio.sleep(1.5 * (attempt + 1))
                continue
            except Exception as e:
                status = getattr(e, "status_code", None) or getattr(e, "code", None)
                err = _classify(status if isinstance(status, int) else None)
                if produced or not isinstance(err, _Transient) or attempt == tries - 1:
                    raise err from e
                await asyncio.sleep(1.5 * (attempt + 1))
                continue
            self.usage.calls += 1
            u = getattr(final, "usage", None)
            if u is not None:
                self.usage.input_tokens += u.total_input_tokens or 0
                self.usage.output_tokens += (u.total_output_tokens or 0) + (u.total_thought_tokens or 0)
            if final is None and not produced:
                raise AgentError("The AI provider's response was cut off.")
            return


FIRST_EVENT_TIMEOUT = 75.0  # seconds before the provider must send anything at all
STRONG_FIRST_TIMEOUT = 45.0  # the strong model gets this long to start before the fast model takes over
IDLE_TIMEOUT = 60.0  # seconds allowed between two streamed events


async def _opened(call, timeout: float):
    """Await the request that opens a stream; on the free tier it can queue for minutes."""
    try:
        return await asyncio.wait_for(call, timeout)
    except TimeoutError as e:
        raise _Transient("The AI model took too long to respond.") from e


async def _paced(stream, first: float, idle: float):
    """Iterate a provider stream, failing instead of hanging when it goes quiet."""
    it = stream.__aiter__()
    wait = first
    while True:
        try:
            ev = await asyncio.wait_for(it.__anext__(), wait)
        except StopAsyncIteration:
            return
        except TimeoutError as e:
            raise _Transient("The AI model took too long to respond.") from e
        wait = idle
        yield ev


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

    async def structured(
        self,
        *,
        tier: Tier,
        system: str,
        prompt: str,
        schema: type[T],
        media: list[Media] | None = None,
        effort: str | None = None,
    ) -> T:
        anthropic = self._anthropic
        model, default_effort = self._model(tier)
        effort = {"minimal": "low"}.get(effort or "", effort) or default_effort
        extra = {}
        if model in _FALLBACK_MODELS:
            extra = {"betas": ["server-side-fallback-2026-07-01"], "fallbacks": "default"}
        try:
            resp = await self.client.beta.messages.parse(
                model=model,
                max_tokens=_MAX_OUTPUT_TOKENS,
                system=system,
                messages=[{"role": "user", "content": _anthropic_content(prompt, media)}],
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

    async def stream_text(
        self,
        *,
        tier: Tier,
        system: str,
        prompt: str,
        media: list[Media] | None = None,
        first_timeout: float | None = None,
        attempts: int | None = None,
    ) -> AsyncIterator[str]:
        anthropic = self._anthropic
        model, effort = self._model(tier)
        try:
            async with self.client.beta.messages.stream(
                model=model,
                max_tokens=_MAX_OUTPUT_TOKENS,
                system=system,
                messages=[{"role": "user", "content": _anthropic_content(prompt, media)}],
                output_config={"effort": effort},
            ) as stream:
                async for text in stream.text_stream:
                    yield text
                msg = await stream.get_final_message()
        except anthropic.APIStatusError as e:
            raise _status_error(e.status_code) from e
        except anthropic.APIConnectionError as e:
            raise AgentError("Could not reach the AI provider.") from e
        self.usage.calls += 1
        self.usage.input_tokens += msg.usage.input_tokens
        self.usage.output_tokens += msg.usage.output_tokens


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
