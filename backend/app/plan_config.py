"""Subscription plan tiers and their feature limits.

Single source of truth for plan-based gating. Consumed by `app.plan_limits`
(enforcement) and the `/api/usage` dashboard. Keep this module dependency-free
so it can be imported anywhere without side effects.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from enum import Enum


class Plan(str, Enum):
    """Subscription tiers, ordered free -> paid -> top."""

    FREE = "free"
    PRO = "pro"
    ENTERPRISE = "enterprise"


class Feature(str, Enum):
    """Gateable product features. Presence in a plan's feature set grants access."""

    CHANNEL_CONNECT = "channel_connect"
    DP_GENERATION = "dp_generation"
    ANALYTICS = "analytics"
    TEAM_COLLAB = "team_collab"
    PRIORITY_SUPPORT = "priority_support"
    API_ACCESS = "api_access"


# Sentinel for "no ceiling". Using a real int (not math.inf) keeps every limit
# comparison integer-typed and JSON-serializable for the dashboard.
UNLIMITED = -1


@dataclass(frozen=True)
class PlanLimits:
    """Hard limits and feature grants for a single plan.

    A limit of ``UNLIMITED`` (-1) disables the ceiling for that dimension.
    """

    plan: Plan
    channel_limit: int
    dp_monthly_quota: int
    rate_limit_per_minute: int
    features: frozenset[Feature] = field(default_factory=frozenset)

    def has_feature(self, feature: Feature) -> bool:
        return feature in self.features

    def is_unlimited(self, dimension_value: int) -> bool:
        return dimension_value == UNLIMITED


PLAN_LIMITS: dict[Plan, PlanLimits] = {
    Plan.FREE: PlanLimits(
        plan=Plan.FREE,
        channel_limit=2,
        dp_monthly_quota=50,
        rate_limit_per_minute=30,
        features=frozenset({Feature.CHANNEL_CONNECT, Feature.DP_GENERATION}),
    ),
    Plan.PRO: PlanLimits(
        plan=Plan.PRO,
        channel_limit=10,
        dp_monthly_quota=2000,
        rate_limit_per_minute=120,
        features=frozenset(
            {
                Feature.CHANNEL_CONNECT,
                Feature.DP_GENERATION,
                Feature.ANALYTICS,
                Feature.TEAM_COLLAB,
                Feature.API_ACCESS,
            }
        ),
    ),
    Plan.ENTERPRISE: PlanLimits(
        plan=Plan.ENTERPRISE,
        channel_limit=UNLIMITED,
        dp_monthly_quota=UNLIMITED,
        rate_limit_per_minute=600,
        features=frozenset(Feature),  # every feature
    ),
}


DEFAULT_PLAN = Plan.FREE


def parse_plan(value: str | Plan | None) -> Plan:
    """Coerce an arbitrary plan identifier into a :class:`Plan`.

    Unknown / missing values fall back to :data:`DEFAULT_PLAN` rather than
    raising, so a malformed header can never escalate a user above free tier.
    """

    if isinstance(value, Plan):
        return value
    if not value:
        return DEFAULT_PLAN
    try:
        return Plan(value.strip().lower())
    except ValueError:
        return DEFAULT_PLAN


def get_plan_limits(plan: str | Plan | None) -> PlanLimits:
    """Return the :class:`PlanLimits` for a plan, defaulting to free tier."""

    return PLAN_LIMITS[parse_plan(plan)]
