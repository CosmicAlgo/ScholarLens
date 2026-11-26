"""Optional accounts: Neon Auth (managed Better Auth) signs people in; this API only verifies the token.

The browser sends `Authorization: Bearer <JWT>`. The token is EdDSA-signed by Neon Auth, lives 15 minutes,
and is checked against the published JWKS with the issuer and audience pinned to the Auth origin.
Nobody has to sign in: without a token every endpoint behaves exactly as before.

Signed-in users get two things: their workspace, Briefings and Films synced across devices
(`user_docs`, one JSON document per kind, versioned so two devices cannot silently overwrite each
other), and an AI quota of their own instead of sharing their network's per-IP cap.
"""

import asyncio
from dataclasses import dataclass
from urllib.parse import urlsplit

import jwt
from jwt import PyJWKClient

from .config import get_settings

# What may be synced, and the most each document may hold. Uploaded PDFs are never synced.
DOC_KINDS = {"workspace": 3_000_000, "briefings": 2_000_000, "films": 1_500_000}


@dataclass(frozen=True)
class User:
    id: str
    email: str
    name: str

    @property
    def quota_id(self) -> str:
        """Stands in for the browser's random client id in quota counting."""
        return f"u:{self.id}"[:64]


class InvalidToken(Exception):
    pass


_jwks: dict[str, PyJWKClient] = {}


def enabled() -> bool:
    return bool(get_settings().neon_auth_url)


def _origin(url: str) -> str:
    p = urlsplit(url)
    return f"{p.scheme}://{p.netloc}"


def _client(base: str) -> PyJWKClient:
    if base not in _jwks:
        _jwks[base] = PyJWKClient(f"{base.rstrip('/')}/.well-known/jwks.json", cache_keys=True, lifespan=3600)
    return _jwks[base]


def _verify(token: str) -> User:
    base = get_settings().neon_auth_url
    if not base:
        raise InvalidToken("Accounts are not enabled on this server.")
    try:
        key = _client(base).get_signing_key_from_jwt(token)
        origin = _origin(base)
        claims = jwt.decode(
            token,
            key.key,
            algorithms=["EdDSA"],
            issuer=origin,
            audience=origin,
            options={"require": ["exp", "sub", "iss", "aud"]},
            leeway=30,
        )
    except (jwt.PyJWTError, jwt.PyJWKClientError) as e:
        raise InvalidToken(str(e)) from e
    if claims.get("banned"):
        raise InvalidToken("This account is suspended.")
    return User(id=str(claims["sub"]), email=str(claims.get("email") or ""), name=str(claims.get("name") or ""))


async def verify(token: str) -> User:
    # Fetching the JWKS is blocking I/O (only on a cache miss); keep it off the event loop.
    return await asyncio.to_thread(_verify, token)


def bearer(header: str | None) -> str | None:
    if not header:
        return None
    scheme, _, token = header.partition(" ")
    return token.strip() if scheme.lower() == "bearer" and token.strip() else None
