"""Copilot runs keep going when the browser disconnects, and can be replayed from any event."""

import asyncio

from scholarlens import runs


async def test_run_survives_disconnect_and_replays_from_an_index():
    gate = asyncio.Event()

    async def produce(run):
        run.push("token", "a")
        await gate.wait()
        run.push("token", "b")
        run.push("verified", "{}")

    run = runs.start("me", produce)
    seen = []

    async def first_listener():
        async for ev in run.follow(0):
            seen.append(ev["data"])

    t = asyncio.create_task(first_listener())
    await asyncio.sleep(0.01)
    t.cancel()  # the browser went away mid-answer
    gate.set()
    await run.task
    assert seen == ["a"] and run.done
    again = [ev["data"] async for ev in run.follow(1)]  # reconnect after the first event
    assert again == ["b", "{}"]


async def test_runs_are_private_to_their_client_and_cancellable():
    async def produce(run):
        await asyncio.sleep(10)

    run = runs.start("alice", produce)
    assert runs.get(run.id, "mallory") is None
    assert runs.cancel(run.id, "mallory") is False
    assert runs.cancel(run.id, "alice") is True
    await asyncio.sleep(0.01)
    assert run.done


def test_matrix_citations_are_normalised_or_dropped():
    from scholarlens.agents.matrix import normalise_cites

    seen = {"S:Uab12:3", "S:Uab12:14", "S:Uab12:4"}
    assert normalise_cites(["[S:Uab12:3]", " S:Uab12:14 ", "4", "S:Uzz:99", "passage 3"], seen) == [
        "S:Uab12:3",
        "S:Uab12:14",
        "S:Uab12:4",
    ]


async def test_writer_falls_back_to_the_fast_model_when_the_strong_one_stalls():
    from types import SimpleNamespace

    from scholarlens.agents import copilot
    from scholarlens.agents.llm import AgentError

    class StallingLLM:
        usage = SimpleNamespace(input_tokens=0, output_tokens=0, calls=0)
        tiers = []

        async def stream_text(self, *, tier, system, prompt, media=None, first_timeout=None, attempts=None):
            self.tiers.append(tier)
            if tier == "strong":
                raise AgentError("The AI model took too long to respond.")
            yield "answer [S:W1:1]"

    llm = StallingLLM()
    out = "".join([c async for c in copilot.write_answer(llm, message="m", mode="ask", history="", evidence=[])])
    assert llm.tiers == ["strong", "fast"] and out.startswith("answer") and "faster model" in out


async def test_a_silent_stream_times_out_instead_of_hanging():
    import asyncio

    import pytest

    from scholarlens.agents.llm import AgentError, _paced

    async def silent():
        await asyncio.sleep(10)
        yield "never"

    with pytest.raises(AgentError):
        async for _ in _paced(silent(), 0.05, 0.05):
            pass


async def test_structured_strong_calls_fall_back_to_the_fast_model():
    from pydantic import BaseModel

    from scholarlens.agents.llm import GeminiLLM, _Transient
    from scholarlens.config import Settings

    class Out(BaseModel):
        ok: bool

    llm = GeminiLLM(Settings(), client=object())
    calls = []

    async def fake_once(tier, system, prompt, schema, media, effort=None, first=0.0):
        calls.append(tier)
        if tier == "strong":
            raise _Transient("The AI model took too long to respond.")
        return Out(ok=True)

    llm._once = fake_once
    out = await llm.structured(tier="strong", system="s", prompt="p", schema=Out)
    assert out.ok and calls == ["strong", "fast"]
