"""Signed-in user's synced documents. The guard middleware has already verified the token."""

import json
from typing import Any

from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import JSONResponse
from psycopg.types.json import Jsonb
from pydantic import BaseModel

from . import accounts
from .db import pool

router = APIRouter(prefix="/api/me")


def _user(request: Request) -> accounts.User:
    user = getattr(request.state, "user", None)
    if user is None:
        raise HTTPException(401, "Sign in to sync your work.")
    return user


def _kind(kind: str) -> str:
    if kind not in accounts.DOC_KINDS:
        raise HTTPException(404, "Unknown document.")
    return kind


@router.get("")
async def me(request: Request):
    user = _user(request)
    return {"id": user.id, "email": user.email, "name": user.name}


@router.get("/docs")
async def get_docs(request: Request):
    """Every synced document with its version, so a new device can start from them."""
    user = _user(request)
    async with pool().connection() as conn:
        rows = await (
            await conn.execute("SELECT kind, data, version FROM user_docs WHERE user_id = %s", (user.id,))
        ).fetchall()
    return {r["kind"]: {"data": r["data"], "version": r["version"]} for r in rows}


class DocWrite(BaseModel):
    data: Any
    # The version this write started from (0 = the device has never seen a server copy).
    base_version: int = 0


@router.post("/docs/{kind}")
async def put_doc(kind: str, body: DocWrite, request: Request):
    """Save one document if nobody else wrote since `base_version`; otherwise 409 with the newer copy,
    which the browser merges and sends again."""
    user = _user(request)
    _kind(kind)
    size = len(json.dumps(body.data, separators=(",", ":")))
    if size > accounts.DOC_KINDS[kind]:
        raise HTTPException(413, "This is too large to sync. Close a few papers or clear old chat, then try again.")
    async with pool().connection() as conn:
        if body.base_version == 0:
            row = await (
                await conn.execute(
                    """INSERT INTO user_docs (user_id, kind, data) VALUES (%s, %s, %s)
                       ON CONFLICT (user_id, kind) DO NOTHING RETURNING version""",
                    (user.id, kind, Jsonb(body.data)),
                )
            ).fetchone()
        else:
            row = await (
                await conn.execute(
                    """UPDATE user_docs SET data = %s, version = version + 1, updated_at = now()
                       WHERE user_id = %s AND kind = %s AND version = %s RETURNING version""",
                    (Jsonb(body.data), user.id, kind, body.base_version),
                )
            ).fetchone()
        if row:
            return {"version": row["version"]}
        current = await (
            await conn.execute("SELECT data, version FROM user_docs WHERE user_id = %s AND kind = %s", (user.id, kind))
        ).fetchone()
    if current is None:
        # The copy this device knew about was deleted elsewhere; start again from zero.
        return JSONResponse({"detail": "conflict", "current": None}, status_code=409)
    return JSONResponse(
        {"detail": "conflict", "current": {"data": current["data"], "version": current["version"]}}, status_code=409
    )


@router.post("/erase")
async def delete_docs(request: Request):
    """Erase everything this account has synced. Work on this device is kept."""
    user = _user(request)
    async with pool().connection() as conn:
        await conn.execute("DELETE FROM user_docs WHERE user_id = %s", (user.id,))
    return {"ok": True}
