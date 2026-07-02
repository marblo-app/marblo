"""Plan limit & usage endpoints.

Exposes the user-facing usage dashboard plus thin enforcement endpoints for
channel connect/disconnect and DP consumption. These wrap `app.plan_limits` so
the frontend has a single REST surface for plan gating.
"""

from __future__ import annotations

from fastapi import APIRouter, Depends

from app.plan_config import Feature
from app.plan_limits import (
    UserContext,
    acquire_channel_slot,
    consume_dp,
    get_usage_summary,
    get_user_context,
    release_channel_slot,
    require_feature,
)

router = APIRouter(prefix="/api/usage", tags=["plan"])


@router.get("")
async def usage_dashboard(ctx: UserContext = Depends(get_user_context)) -> dict:
    """Return the caller's current usage against their plan limits."""

    return await get_usage_summary(ctx)


@router.post("/channels/{channel_id}/connect")
async def connect_channel(
    channel_id: str,
    ctx: UserContext = Depends(require_feature(Feature.CHANNEL_CONNECT)),
) -> dict:
    """Reserve a channel connection slot (402 if the plan limit is reached)."""

    count = await acquire_channel_slot(ctx, channel_id)
    return {"connected": channel_id, "channels_used": count}


@router.post("/channels/{channel_id}/disconnect")
async def disconnect_channel(
    channel_id: str, ctx: UserContext = Depends(get_user_context)
) -> dict:
    """Free a channel connection slot (idempotent)."""

    count = await release_channel_slot(ctx, channel_id)
    return {"disconnected": channel_id, "channels_used": count}


@router.post("/dp/consume")
async def consume_dp_units(
    amount: int = 1,
    ctx: UserContext = Depends(require_feature(Feature.DP_GENERATION)),
) -> dict:
    """Consume DP units for the current month (402 if the quota is exceeded)."""

    total = await consume_dp(ctx, amount)
    return {"consumed": amount, "dp_used_this_month": total}
