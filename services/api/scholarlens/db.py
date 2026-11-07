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


def connect_kwargs(url: str) -> dict:
    """Behind a transaction-mode pooler (Neon's "-pooler" hosts, PgBouncer) a backend can change
    between statements, so psycopg's automatic server-side prepared statements must be off."""
    kw: dict = {"row_factory": dict_row}
    if "-pooler" in url or "pgbouncer" in url.lower():
        kw["prepare_threshold"] = None
    return kw


async def open_pool() -> AsyncConnectionPool:
    global _pool
    if _pool is None:
        url = _normalise_dsn(get_settings().database_url)
        _pool = AsyncConnectionPool(
            url,
            min_size=0,  # serverless Postgres scales to zero; don't pin a connection open
            max_size=5,
            kwargs=connect_kwargs(url),
            open=False,
            check=AsyncConnectionPool.check_connection,  # computes suspend when idle; drop dead conns
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
