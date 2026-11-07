"""Postgres connection pool (psycopg 3, async)."""

import asyncio
import sys

from psycopg.rows import dict_row
from psycopg_pool import AsyncConnectionPool

from .config import get_settings

if sys.platform == "win32":  # local dev only; psycopg async can't use Windows' default Proactor loop
    asyncio.set_event_loop_policy(asyncio.WindowsSelectorEventLoopPolicy())

_pool: AsyncConnectionPool | None = None


def _normalise_dsn(url: str) -> str:
    # Heroku hands out postgres://; psycopg accepts both, but keep one canonical form.
    return url.replace("postgres://", "postgresql://", 1)


async def open_pool() -> AsyncConnectionPool:
    global _pool
    if _pool is None:
        _pool = AsyncConnectionPool(
            _normalise_dsn(get_settings().database_url),
            min_size=1,
            max_size=5,  # Heroku Essential-0 allows 20 connections in total
            kwargs={"row_factory": dict_row},
            open=False,
        )
        await _pool.open()
    return _pool


async def close_pool() -> None:
    global _pool
    if _pool is not None:
        await _pool.close()
        _pool = None


def pool() -> AsyncConnectionPool:
    if _pool is None:
        raise RuntimeError("database pool is not open")
    return _pool
