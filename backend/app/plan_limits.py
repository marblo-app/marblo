"""Plan-based feature limit enforcement.

Provides Redis-backed usage tracking and FastAPI dependencies for:

1. Channel connection limits   -> :func:`acquire_channel_slot` / :func:`release_channel_slot`
2. DP (design pack) usage       -> :func:`consume_dp` / :func:`get_dp_usage`
3. API rate limiting per plan   -> :func:`check_rate_limit`
4. Feature gating middleware     -> :func:`require_feature`
5. Usage dashboard for users     -> :func:`get_usage_summary`

The caller's identity and plan come from :mod:`app.auth` (a verified Firebase
ID token) -- never from request headers, which a client controls.

The Redis client is injected so the pure logic stays testable without a live
server (see ``app.plan_limits`` verification script / fakeredis). All counters
are namespaced under ``plan:`` and self-expire, so this module owns no schema
migrations.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timezone

import redis.asyncio as redis
from fastapi import Depends, HTTPException

from app.auth import Claims, extract_uid, get_verified_claims
from app.events import get_redis
from app.plan_config import (
    UNLIMITED,
    Feature,
    Plan,
    PlanLimits,
    get_plan_limits,
    parse_plan,
)

# Key namespaces -------------------------------------------------------------

_RATE_PREFIX = "plan:rate"
_DP_PREFIX = "plan:dp"
_CHANNEL_PREFIX = "plan:channels"

# DP counters are monthly; keep them ~2 months so the prior month stays
# inspectable but storage is bounded.
_DP_TTL_SECONDS = 60 * 60 * 24 * 62
# Channel sets have no natural expiry (they mirror live connections) but we set
# a long guard TTL so abandoned users eventually drop out of Redis.
_CHANNEL_TTL_SECONDS = 60 * 60 * 24 * 90


# Request context ------------------------------------------------------------


@dataclass(frozen=True)
class UserContext:
    """Identity + plan resolved for an incoming request.

    Both fields come from a verified Firebase ID token (see :mod:`app.auth`).
    Request headers are never consulted: ``X-User-Id`` / ``X-Plan`` used to be
    the source here, which let any caller impersonate a user or claim a paid
    tier. ``parse_plan`` still guarantees an unrecognised plan value can never
    escalate above the free tier.
    """

    user_id: str
    plan: Plan

    @property
    def limits(self) -> PlanLimits:
        return get_plan_limits(self.plan)


# Claim names carrying the subscription tier. These are Firebase *custom
# claims*: only a privileged server (Admin SDK ``setCustomUserClaims``) can
# write them, so a client cannot mint or edit its own plan. A user with no
# plan claim resolves to free -- gating fails closed, never open.
PLAN_CLAIM_KEYS = ("plan", "planType")


def resolve_plan_from_claims(claims: Claims) -> Plan:
    """Read the caller's plan out of their verified token claims."""

    for key in PLAN_CLAIM_KEYS:
        value = claims.get(key)
        if isinstance(value, str) and value.strip():
            return parse_plan(value)
    return parse_plan(None)


async def get_user_context(
    claims: Claims = Depends(get_verified_claims),
) -> UserContext:
    """FastAPI dependency resolving the caller's identity and plan.

    Rejects the request (401) unless it carries a valid Firebase ID token.
    """

    return UserContext(
        user_id=extract_uid(claims), plan=resolve_plan_from_claims(claims)
    )


# Errors ---------------------------------------------------------------------


class PlanLimitExceeded(HTTPException):
    """402-style error raised when a plan ceiling is hit (rate limit uses 429)."""

    def __init__(self, detail: str, status_code: int = 402) -> None:
        super().__init__(status_code=status_code, detail=detail)


# Helpers --------------------------------------------------------------------


def _current_month(now: datetime | None = None) -> str:
    now = now or datetime.now(timezone.utc)
    return now.strftime("%Y%m")


def _current_minute(now: datetime | None = None) -> int:
    now = now or datetime.now(timezone.utc)
    return int(now.timestamp()) // 60


async def _client(r: redis.Redis | None) -> redis.Redis:
    return r if r is not None else await get_redis()


# 3. Rate limiting -----------------------------------------------------------


async def check_rate_limit(
    ctx: UserContext,
    *,
    r: redis.Redis | None = None,
    now: datetime | None = None,
) -> int:
    """Fixed-window per-minute rate limit. Returns the post-increment count.

    Raises :class:`PlanLimitExceeded` (429) when the plan's per-minute budget is
    exhausted. ``UNLIMITED`` plans skip the check entirely.
    """

    limit = ctx.limits.rate_limit_per_minute
    if limit == UNLIMITED:
        return 0

    client = await _client(r)
    key = f"{_RATE_PREFIX}:{ctx.user_id}:{_current_minute(now)}"
    count = await client.incr(key)
    if count == 1:
        # First hit in this window: arm a 60s expiry so the window self-clears.
        await client.expire(key, 60)
    if count > limit:
        raise PlanLimitExceeded(
            f"Rate limit exceeded: {limit} requests/min for plan '{ctx.plan.value}'",
            status_code=429,
        )
    return count


# 2. DP usage tracking -------------------------------------------------------


async def get_dp_usage(
    ctx: UserContext,
    *,
    r: redis.Redis | None = None,
    now: datetime | None = None,
) -> int:
    client = await _client(r)
    key = f"{_DP_PREFIX}:{ctx.user_id}:{_current_month(now)}"
    raw = await client.get(key)
    return int(raw) if raw is not None else 0


async def consume_dp(
    ctx: UserContext,
    amount: int = 1,
    *,
    r: redis.Redis | None = None,
    now: datetime | None = None,
) -> int:
    """Atomically consume ``amount`` DP units for the current month.

    Returns the new monthly total. Raises :class:`PlanLimitExceeded` (402) if the
    consumption would exceed the plan's monthly quota; the increment is rolled
    back so the counter never reports more usage than was actually granted.
    """

    if amount <= 0:
        raise ValueError("amount must be positive")

    quota = ctx.limits.dp_monthly_quota
    client = await _client(r)
    key = f"{_DP_PREFIX}:{ctx.user_id}:{_current_month(now)}"
    new_total = await client.incrby(key, amount)
    if new_total == amount:
        await client.expire(key, _DP_TTL_SECONDS)

    if quota != UNLIMITED and new_total > quota:
        # Roll back the over-consumption so usage stays truthful.
        await client.incrby(key, -amount)
        raise PlanLimitExceeded(
            f"Monthly DP quota exceeded: {quota} for plan '{ctx.plan.value}'"
        )
    return new_total


# 1. Channel connection limits ----------------------------------------------


async def get_channel_count(
    ctx: UserContext, *, r: redis.Redis | None = None
) -> int:
    client = await _client(r)
    return await client.scard(f"{_CHANNEL_PREFIX}:{ctx.user_id}")


async def acquire_channel_slot(
    ctx: UserContext, channel_id: str, *, r: redis.Redis | None = None
) -> int:
    """Reserve a connection slot for ``channel_id``.

    Idempotent: re-connecting an already-tracked channel does not consume a new
    slot. Returns the channel count after the operation. Raises
    :class:`PlanLimitExceeded` (402) when the plan's channel limit is reached.
    """

    limit = ctx.limits.channel_limit
    client = await _client(r)
    key = f"{_CHANNEL_PREFIX}:{ctx.user_id}"

    is_member = await client.sismember(key, channel_id)
    if is_member:
        return await client.scard(key)

    if limit != UNLIMITED and await client.scard(key) >= limit:
        raise PlanLimitExceeded(
            f"Channel limit reached: {limit} for plan '{ctx.plan.value}'"
        )

    await client.sadd(key, channel_id)
    await client.expire(key, _CHANNEL_TTL_SECONDS)
    return await client.scard(key)


async def release_channel_slot(
    ctx: UserContext, channel_id: str, *, r: redis.Redis | None = None
) -> int:
    """Free a connection slot. Idempotent. Returns the remaining channel count."""

    client = await _client(r)
    key = f"{_CHANNEL_PREFIX}:{ctx.user_id}"
    await client.srem(key, channel_id)
    return await client.scard(key)


# 4. Feature gating middleware ----------------------------------------------


def require_feature(feature: Feature):
    """Build a FastAPI dependency that 403s unless the caller's plan has ``feature``.

    Usage::

        @app.post("/api/analytics", dependencies=[Depends(require_feature(Feature.ANALYTICS))])
        async def analytics(): ...
    """

    async def _dependency(
        ctx: UserContext = Depends(get_user_context),
    ) -> UserContext:
        if not ctx.limits.has_feature(feature):
            raise HTTPException(
                status_code=403,
                detail=(
                    f"Feature '{feature.value}' is not available on plan "
                    f"'{ctx.plan.value}'. Upgrade required."
                ),
            )
        return ctx

    return _dependency


# 5. Usage dashboard ---------------------------------------------------------


def _remaining(used: int, limit: int) -> int | None:
    """Remaining allowance, or ``None`` for unlimited dimensions."""

    if limit == UNLIMITED:
        return None
    return max(limit - used, 0)


async def get_usage_summary(
    ctx: UserContext,
    *,
    r: redis.Redis | None = None,
    now: datetime | None = None,
) -> dict:
    """Aggregate the caller's current usage against their plan limits.

    Shape is JSON-ready for the user-facing dashboard. ``None`` limit/remaining
    means unlimited; rate limit reports the configured budget, not live usage
    (live per-minute counts are ephemeral and not meaningful in a dashboard).
    """

    limits = ctx.limits
    channels_used = await get_channel_count(ctx, r=r)
    dp_used = await get_dp_usage(ctx, r=r, now=now)

    def dim(used: int, limit: int) -> dict:
        return {
            "used": used,
            "limit": None if limit == UNLIMITED else limit,
            "remaining": _remaining(used, limit),
            "unlimited": limit == UNLIMITED,
        }

    return {
        "plan": ctx.plan.value,
        "channels": dim(channels_used, limits.channel_limit),
        "dp_monthly": dim(dp_used, limits.dp_monthly_quota),
        "rate_limit_per_minute": (
            None
            if limits.rate_limit_per_minute == UNLIMITED
            else limits.rate_limit_per_minute
        ),
        "features": sorted(f.value for f in limits.features),
    }
