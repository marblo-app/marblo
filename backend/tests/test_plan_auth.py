"""Plan gating must derive identity and plan on the server only.

Two properties, and both matter:

* **Nothing the caller says buys anything.** ``X-User-Id`` / ``X-Plan`` cannot
  buy access, cannot rename the caller, and cannot spend someone else's quota --
  and neither can a token claim.
* **A legitimate paying customer still gets through.** Locking out people who
  paid is the larger incident, so the paid paths are pinned here too: an active
  subscription, a team grant, and a cancelled-but-paid-through period all keep
  working, and an infrastructure failure returns 503 rather than silently
  demoting a payer to free.
"""

from __future__ import annotations

import pytest
from fastapi import Depends, FastAPI, HTTPException
from fastapi.testclient import TestClient

from app import auth, plan_source
from app.entitlement import RENEWAL_GRACE_MS
from app.plan_config import Feature, Plan
from app.plan_limits import UserContext, get_user_context, require_feature
from app.routers import plan as plan_router

DAY_MS = 24 * 60 * 60 * 1000

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


def _fixed_now() -> int:
    """Epoch ms 'now' as the server will compute it inside the request."""

    from app.entitlement import now_millis

    return now_millis()


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


def test_active_paid_subscription_passes_through(fake_redis, subscriptions):
    """★A legitimate paying customer keeps their plan and their paid feature."""

    subscriptions.grant("u-pro", planType="pro")
    subscriptions.grant("u-ent", planType="enterprise")
    use_tokens({"pro": {"uid": "u-pro"}, "ent": {"uid": "u-ent"}})
    client = make_client()

    assert client.get("/probe/whoami", headers=bearer("pro")).json()["plan"] == "pro"
    assert client.get("/probe/whoami", headers=bearer("ent")).json()["plan"] == "enterprise"

    # ...and the gated feature actually opens for them.
    assert client.get("/probe/analytics", headers=bearer("pro")).status_code == 200
    assert client.get("/probe/analytics", headers=bearer("ent")).status_code == 200

    # ...and the dashboard reports the paid tier, not free.
    assert client.get("/api/usage", headers=bearer("pro")).json()["plan"] == "pro"


def test_existing_team_grants_are_not_downgraded(fake_redis, subscriptions):
    """★Team grants are already issued; they must not land on free.

    ``team`` / ``team_plus`` are real SKUs. Before they existed in ``Plan`` they
    fell through ``parse_plan`` to free, which locked out customers who paid.
    """

    subscriptions.grant("u-team", planType="team")
    subscriptions.grant("u-teamplus", planType="team_plus")
    use_tokens({"team": {"uid": "u-team"}, "teamplus": {"uid": "u-teamplus"}})
    client = make_client()

    assert client.get("/probe/whoami", headers=bearer("team")).json()["plan"] == "team"
    assert (
        client.get("/probe/whoami", headers=bearer("teamplus")).json()["plan"]
        == "team_plus"
    )
    assert client.get("/probe/analytics", headers=bearer("team")).status_code == 200
    assert client.get("/probe/analytics", headers=bearer("teamplus")).status_code == 200


def test_legacy_active_doc_without_a_period_stays_paid(fake_redis, subscriptions):
    """Legacy documents have no ``currentPeriodEnd``; they must not be demoted."""

    subscriptions.grant("u-legacy", planType="pro")  # no period recorded
    use_tokens({"tok": {"uid": "u-legacy"}})
    client = make_client()

    assert client.get("/probe/whoami", headers=bearer("tok")).json()["plan"] == "pro"


def test_cancelled_but_paid_through_keeps_access(fake_redis, subscriptions):
    """Cancelling stops the next charge; it does not confiscate paid days."""

    now_ms = _fixed_now()
    subscriptions.docs["u-cancel"] = {
        "status": "canceled",
        "planType": "pro",
        "currentPeriodEndMs": now_ms + 29 * DAY_MS,
    }
    use_tokens({"tok": {"uid": "u-cancel"}})
    client = make_client()

    assert client.get("/probe/whoami", headers=bearer("tok")).json()["plan"] == "pro"


def test_refunded_and_expired_subscriptions_do_not_grant(fake_redis, subscriptions):
    """The kill-switch and expiry paths still land on free."""

    now_ms = _fixed_now()
    cases = {
        # Refund / 3-strike / Paddle cancel all write planType="free".
        "refunded": {
            "status": "canceled",
            "planType": "free",
            "currentPeriodEndMs": now_ms + 29 * DAY_MS,
        },
        # Expired well past the renewal grace.
        "expired": {
            "status": "active",
            "planType": "pro",
            "currentPeriodEndMs": now_ms - RENEWAL_GRACE_MS - DAY_MS,
        },
        # Delinquent.
        "past_due": {"status": "past_due", "planType": "pro"},
    }
    for uid, doc in cases.items():
        subscriptions.docs[uid] = doc
    use_tokens({uid: {"uid": uid} for uid in cases})
    client = make_client()

    for uid in cases:
        resp = client.get("/probe/whoami", headers=bearer(uid))
        assert resp.json()["plan"] == Plan.FREE.value, uid
        assert client.get("/probe/analytics", headers=bearer(uid)).status_code == 403, uid


def test_plan_claims_in_a_verified_token_grant_nothing(fake_redis, subscriptions):
    """★Single source: the plan comes from the record, not from the token.

    The token here is genuinely valid and genuinely says ``enterprise``. It still
    buys nothing, because the server looks the plan up itself.
    """

    subscriptions.grant("u1", planType="free")
    use_tokens(
        {
            "claim-ent": {"uid": "u1", "plan": "enterprise"},
            "claim-legacy": {"uid": "u1", "planType": "enterprise"},
        }
    )
    client = make_client()

    for token in ("claim-ent", "claim-legacy"):
        resp = client.get("/probe/whoami", headers=bearer(token))
        assert resp.json()["plan"] == Plan.FREE.value, token
        assert client.get("/probe/analytics", headers=bearer(token)).status_code == 403


def test_no_subscription_record_is_a_free_user(fake_redis, subscriptions):
    use_tokens({"tok": {"uid": "nobody"}})
    client = make_client()

    resp = client.get("/probe/whoami", headers=bearer("tok"))
    assert resp.status_code == 200
    assert resp.json()["plan"] == Plan.FREE.value


def test_unknown_plan_values_fall_back_to_free(fake_redis, subscriptions):
    """A corrupt or future ``planType`` cannot escalate above free."""

    subscriptions.grant("u1", planType="platinum")
    subscriptions.grant("u2", planType="   ")
    subscriptions.grant("u3", planType={"tier": "enterprise"})
    subscriptions.grant("u4")  # planType missing entirely
    use_tokens({uid: {"uid": uid} for uid in ("u1", "u2", "u3", "u4")})
    client = make_client()

    for uid in ("u1", "u2", "u3", "u4"):
        resp = client.get("/probe/whoami", headers=bearer(uid))
        assert resp.status_code == 200, uid
        assert resp.json()["plan"] == Plan.FREE.value, uid
        assert client.get("/probe/analytics", headers=bearer(uid)).status_code == 403, uid


def test_the_server_reads_only_the_verified_callers_record(fake_redis, subscriptions):
    """The looked-up uid is the token subject -- forged headers steer nothing."""

    subscriptions.grant("victim-uid", planType="enterprise")
    use_tokens({"tok": {"uid": "real-uid"}})
    client = make_client()

    resp = client.get("/probe/whoami", headers=bearer("tok", forged=True))
    assert resp.json()["plan"] == Plan.FREE.value
    assert subscriptions.reads == ["real-uid"]


# --- Lookup failures ------------------------------------------------------


def test_lookup_failure_is_503_not_a_silent_downgrade(fake_redis, subscriptions):
    """★An outage must not quietly turn a paying customer into a free one."""

    subscriptions.grant("u-pro", planType="pro")
    subscriptions.error = RuntimeError("firestore unavailable")
    use_tokens({"tok": {"uid": "u-pro"}})
    client = make_client()

    for path in ("/probe/whoami", "/api/usage", "/probe/analytics"):
        resp = client.get(path, headers=bearer("tok"))
        assert resp.status_code == 503, path


def test_unconfigured_plan_source_fails_closed(monkeypatch, fake_redis):
    """No Firebase project id -> 503, never an unauthenticated or free pass."""

    from app.config import settings

    monkeypatch.setattr(settings, "firebase_project_id", "")
    plan_source.set_subscription_lookup(None)
    use_tokens({"tok": {"uid": "u-pro"}})
    client = make_client()

    resp = client.get("/probe/whoami", headers=bearer("tok"))
    assert resp.status_code == 503


def test_lookups_are_cached_per_user(fake_redis, subscriptions):
    """Repeat requests reuse the record instead of re-reading it every time."""

    subscriptions.grant("u-pro", planType="pro")
    use_tokens({"tok": {"uid": "u-pro"}})
    client = make_client()

    for _ in range(3):
        assert client.get("/probe/whoami", headers=bearer("tok")).json()["plan"] == "pro"
    assert subscriptions.reads == ["u-pro"]

    # The cache holds a document, not a verdict, so clearing it re-reads.
    plan_source.clear_subscription_cache()
    client.get("/probe/whoami", headers=bearer("tok"))
    assert subscriptions.reads == ["u-pro", "u-pro"]
