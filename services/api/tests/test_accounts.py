"""Optional accounts: token verification, per-account AI quotas, and that signed-out use is unchanged."""

import time

import jwt
import pytest
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey
from fastapi import FastAPI, Header
from fastapi.testclient import TestClient

from scholarlens import accounts, guard
from scholarlens.config import get_settings

BASE = "https://ep-test.neonauth.example.aws.neon.tech/neondb/auth"
ORIGIN = "https://ep-test.neonauth.example.aws.neon.tech"
KEY = Ed25519PrivateKey.generate()
OTHER_KEY = Ed25519PrivateKey.generate()


class _FakeJWKS:
    def get_signing_key_from_jwt(self, token):
        return type("K", (), {"key": KEY.public_key()})()


@pytest.fixture(autouse=True)
def auth_on(monkeypatch):
    monkeypatch.setattr(get_settings(), "neon_auth_url", BASE)
    monkeypatch.setattr(accounts, "_client", lambda base: _FakeJWKS())
    guard._minute.clear()
    guard._daily.clear()


def token(key=KEY, **over):
    claims = {"sub": "user-1", "email": "a@uni.ac.uk", "name": "A", "iss": ORIGIN, "aud": ORIGIN}
    claims["exp"] = int(time.time()) + 900
    claims.update(over)
    return jwt.encode(claims, key, algorithm="EdDSA")


def test_valid_token_gives_the_user():
    u = accounts._verify(token())
    assert (u.id, u.email, u.quota_id) == ("user-1", "a@uni.ac.uk", "u:user-1")


@pytest.mark.parametrize(
    "bad",
    [
        {"exp": int(time.time()) - 3600},  # expired
        {"aud": "https://evil.example"},  # minted for someone else
        {"iss": "https://evil.example"},
        {"banned": True},
    ],
)
def test_bad_tokens_are_rejected(bad):
    with pytest.raises(accounts.InvalidToken):
        accounts._verify(token(**bad))


def test_token_signed_with_another_key_is_rejected():
    with pytest.raises(accounts.InvalidToken):
        accounts._verify(token(key=OTHER_KEY))


def test_accounts_off_rejects_tokens(monkeypatch):
    monkeypatch.setattr(get_settings(), "neon_auth_url", "")
    with pytest.raises(accounts.InvalidToken):
        accounts._verify(token())


def make_app():
    app = FastAPI()
    app.add_middleware(guard.GuardMiddleware)

    @app.post("/api/copilot")
    async def copilot(x_client_id: str = Header(default="anonymous")):
        return {"client": x_client_id}

    return app


def test_signed_in_users_get_their_own_cap_and_quota_id(monkeypatch):
    s = get_settings()
    monkeypatch.setattr(s, "ai_calls_per_ip_per_day", 1)
    monkeypatch.setattr(s, "ai_calls_per_user_per_day", 2)
    c = TestClient(make_app())
    # The network's cap is used up by someone signed out...
    assert c.post("/api/copilot", json={}, headers={"X-Client-Id": "x"}).status_code == 200
    assert c.post("/api/copilot", json={}, headers={"X-Client-Id": "x"}).status_code == 429
    # ...but a signed-in user on the same network still has their own allowance, counted by account,
    # and cannot pick their quota id by sending a different X-Client-Id.
    auth = {"Authorization": f"Bearer {token()}", "X-Client-Id": "spoofed"}
    r = c.post("/api/copilot", json={}, headers=auth)
    assert r.status_code == 200 and r.json()["client"] == "u:user-1"
    assert c.post("/api/copilot", json={}, headers=auth).status_code == 200
    assert c.post("/api/copilot", json={}, headers=auth).status_code == 429


def test_expired_token_gets_401_not_a_silent_downgrade():
    c = TestClient(make_app())
    r = c.post("/api/copilot", json={}, headers={"Authorization": f"Bearer {token(exp=1)}"})
    assert r.status_code == 401
