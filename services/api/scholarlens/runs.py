"""Copilot runs that outlive the HTTP connection.

The answer is produced by a background task that appends events to an in-memory log. The SSE
response only replays that log, so a dropped connection, a page change or a reload does not lose
the answer: the browser reconnects with the run id and the index of the last event it saw.

The API runs as a single process, so an in-memory registry is enough. Finished runs are kept for
RETAIN_SECONDS so late reconnects can still read them.
"""

import asyncio
import time
import uuid
from collections.abc import AsyncIterator, Awaitable, Callable

RETAIN_SECONDS = 15 * 60
MAX_RUNS = 500


class Run:
    def __init__(self, client_id: str):
        self.id = str(uuid.uuid4())
        self.client_id = client_id
        self.events: list[dict] = []
        self.done = False
        self.created = time.monotonic()
        self.finished: float | None = None
        self._changed = asyncio.Event()
        self.task: asyncio.Task | None = None

    def push(self, event: str, data: str) -> None:
        self.events.append({"event": event, "data": data, "id": str(len(self.events))})
        self._changed.set()

    def finish(self) -> None:
        self.done = True
        self.finished = time.monotonic()
        self._changed.set()

    async def follow(self, start: int = 0) -> AsyncIterator[dict]:
        """Replay events from `start`, then wait for new ones until the run finishes."""
        i = max(0, start)
        while True:
            while i < len(self.events):
                yield self.events[i]
                i += 1
            if self.done:
                return
            self._changed.clear()
            if i < len(self.events) or self.done:
                continue
            await self._changed.wait()


_runs: dict[str, Run] = {}


def _prune() -> None:
    now = time.monotonic()
    for rid, r in list(_runs.items()):
        if r.finished and now - r.finished > RETAIN_SECONDS:
            _runs.pop(rid, None)
    while len(_runs) > MAX_RUNS:  # oldest first
        oldest = min(_runs.values(), key=lambda r: r.created)
        if oldest.task and not oldest.task.done():
            oldest.task.cancel()
        _runs.pop(oldest.id, None)


def start(client_id: str, produce: Callable[[Run], Awaitable[None]]) -> Run:
    _prune()
    run = Run(client_id)
    _runs[run.id] = run

    async def wrapper():
        try:
            await produce(run)
        finally:
            run.finish()

    run.task = asyncio.create_task(wrapper())
    # A task cancelled before it starts never runs `finally`; mark it finished anyway.
    run.task.add_done_callback(lambda _t: None if run.done else run.finish())
    return run


def get(run_id: str, client_id: str) -> Run | None:
    r = _runs.get(run_id)
    return r if r and r.client_id == client_id else None


def cancel(run_id: str, client_id: str) -> bool:
    r = get(run_id, client_id)
    if not r or r.done or not r.task:
        return False
    r.task.cancel()
    return True
