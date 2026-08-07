"""Plan gating must derive identity and plan from a verified token only.

Every test here is an attack or a fail-closed check: the property under test is
that ``X-User-Id`` / ``X-Plan`` cannot buy access, cannot rename the caller, and
cannot spend someone else's quota.
"""

from __future__ import annotations

import pytest
from fastapi import Depends, FastAPI, HTTPException
from fastapi.testclient import TestClient

from app import auth
from app.plan_config import Feature, Plan
from app.plan_limits import UserContext, get_user_context, require_feature
from app.routers import plan as plan_router

# Forged headers replayed by the attack tests below.
FORGED = {"X-User-Id": "victim-uid", "X-Plan": "enterprise"}


def make_client() -> TestClient:
    """App exposing the real plan router plus two identity-echoing probes."""

    app = FastAPI()
    app.include_router(plan_router.router)

    @app.get("/probe/whoami")
    async def whoami(ctx: UserContext = Depends(get_user_context)) -> dict:
        return {"user_id": ctx.user_id, "plan": ctx.plan.value}

    @app.get("/probe/analytics")
    async def analytics(
        ctx: UserContext = Depends(require_feature(Feature.ANALYTICS)),
    ) -> dict:
        return {"ok": True, "plan": ctx.plan.value}

    return TestClient(app, raise_server_exceptions=False)


def use_tokens(tokens: dict[str, dict]) -> None:
    """Install a verifier that accepts only ``tokens`` keys."""

    def _verify(token: str) -> dict:
        if token not in tokens:
            raise ValueError("invalid token")
        return tokens[token]

    auth.set_token_verifier(_verify)


def bearer(token: str, *, forged: bool = False) -> dict[str, str]:
    headers = {"Authorization": f"Bearer {token}"}
    if forged:
        headers.update(FORGED)
    return headers


# --- Header forgery -------------------------------------------------------


def test_forged_plan_headers_alone_are_rejected(fake_redis):
    """The old contract (headers only, no token) must now 401."""

    use_tokens({})
    client = make_client()

    for path in ("/api/usage", "/probe/whoami", "/probe/analytics"):
        resp = client.get(path, headers=FORGED)
        assert resp.status_code == 401, path

    resp = client.post("/api/usage/channels/c1/connect", headers=FORGED)
    assert resp.status_code == 401
    resp = client.post("/api/usage/dp/consume", headers=FORGED)
    assert resp.status_code == 401


def test_forged_plan_header_cannot_unlock_a_paid_feature(fake_redis):
    """A free user shouting 'X-Plan: enterprise' stays free."""

    use_tokens({"free-token": {"uid": "user-1"}})
    client = make_client()

    resp = client.get("/probe/analytics", headers=bearer("free-token", forged=True))
    assert resp.status_code == 403

    resp = client.get("/api/usage", headers=bearer("free-token", forged=True))
    assert resp.status_code == 200
    assert resp.json()["plan"] == Plan.FREE.value


def test_forged_user_header_cannot_rename_the_caller(fake_redis):
    """Identity comes from the token subject, not X-User-Id."""

    use_tokens({"tok": {"uid": "real-uid"}})
    client = make_client()

    resp = client.get("/probe/whoami", headers=bearer("tok", forged=True))
    assert resp.status_code == 200
    assert resp.json()["user_id"] == "real-uid"


def test_forged_user_header_cannot_spend_another_users_quota(fake_redis):
    """Usage counters are keyed by the verified uid."""

    use_tokens({"tok": {"uid": "real-uid"}})
    client = make_client()

    resp = client.post("/api/usage/dp/consume?amount=3", headers=bearer("tok", forged=True))
    assert resp.status_code == 200

    keys = list(fake_redis.values)
    assert any("real-uid" in key for key in keys)
    assert not any("victim-uid" in key for key in keys)


def test_channel_slots_are_keyed_by_verified_uid(fake_redis):
    use_tokens({"tok": {"uid": "real-uid"}})
    client = make_client()

    resp = client.post("/api/usage/channels/c1/connect", headers=bearer("tok", forged=True))
    assert resp.status_code == 200

    assert any("real-uid" in key for key in fake_redis.sets)
    assert not any("victim-uid" in key for key in fake_redis.sets)


# --- Token handling -------------------------------------------------------


def test_invalid_and_malformed_credentials_are_rejected(fake_redis):
    use_tokens({"good": {"uid": "user-1"}})
    client = make_client()

    cases = [
        {},  # no Authorization at all
        {"Authorization": "Bearer forged-token"},  # not a token we minted
        {"Authorization": "good"},  # missing scheme
        {"Authorization": "Basic good"},  # wrong scheme
        {"Authorization": "Bearer"},  # no token
        {"Authorization": "Bearer good extra"},  # malformed
    ]
    for headers in cases:
        resp = client.get("/probe/whoami", headers=headers)
        assert resp.status_code == 401, headers


def test_bearer_scheme_is_case_insensitive():
    assert auth.parse_bearer_token("bearer abc") == "abc"
    assert auth.parse_bearer_token("BEARER abc") == "abc"

    for bad in (None, "", "abc", "Bearer", "Bearer  ", "Token abc"):
        with pytest.raises(HTTPException) as excinfo:
            auth.parse_bearer_token(bad)
        assert excinfo.value.status_code == 401


def test_token_without_a_subject_is_rejected(fake_redis):
    use_tokens({"tok": {"email": "someone@example.com"}})
    client = make_client()

    resp = client.get("/probe/whoami", headers=bearer("tok"))
    assert resp.status_code == 401


def test_sub_claim_is_accepted_as_the_uid(fake_redis):
    use_tokens({"tok": {"sub": "sub-uid"}})
    client = make_client()

    resp = client.get("/probe/whoami", headers=bearer("tok"))
    assert resp.json()["user_id"] == "sub-uid"


def test_unconfigured_auth_fails_closed(monkeypatch, fake_redis):
    """No Firebase project id -> 503, never an unauthenticated pass."""

    from app.config import settings

    monkeypatch.setattr(settings, "firebase_project_id", "")
    auth.set_token_verifier(None)
    client = make_client()

    resp = client.get("/probe/whoami", headers={"Authorization": "Bearer anything"})
    assert resp.status_code == 503

    # Even the forged-header shape gets nothing.
    resp = client.get("/probe/whoami", headers=FORGED)
    assert resp.status_code == 401


# --- Plan resolution ------------------------------------------------------


def test_plan_comes_from_verified_custom_claims(fake_redis):
    use_tokens(
        {
            "pro": {"uid": "u-pro", "plan": "pro"},
            "legacy-pro": {"uid": "u-pro2", "planType": "pro"},
            "ent": {"uid": "u-ent", "plan": "enterprise"},
        }
    )
    client = make_client()

    assert client.get("/probe/whoami", headers=bearer("pro")).json()["plan"] == "pro"
    assert (
        client.get("/probe/whoami", headers=bearer("legacy-pro")).json()["plan"] == "pro"
    )
    assert (
        client.get("/probe/whoami", headers=bearer("ent")).json()["plan"] == "enterprise"
    )

    # ...and the paid feature actually opens for them.
    assert client.get("/probe/analytics", headers=bearer("pro")).status_code == 200


def test_unknown_or_missing_plan_claims_fall_back_to_free(fake_redis):
    use_tokens(
        {
            "none": {"uid": "u1"},
            "junk": {"uid": "u2", "plan": "platinum"},
            "empty": {"uid": "u3", "plan": "   "},
            "wrong-type": {"uid": "u4", "plan": {"tier": "enterprise"}},
        }
    )
    client = make_client()

    for token in ("none", "junk", "empty", "wrong-type"):
        resp = client.get("/probe/whoami", headers=bearer(token))
        assert resp.status_code == 200, token
        assert resp.json()["plan"] == Plan.FREE.value, token
        assert client.get("/probe/analytics", headers=bearer(token)).status_code == 403
