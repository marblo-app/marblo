"""Subscription plan tiers and their feature limits.

Single source of truth for plan-based gating. Consumed by `app.plan_limits`
(enforcement) and the `/api/usage` dashboard. Keep this module dependency-free
so it can be imported anywhere without side effects.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from enum import Enum


class Plan(str, Enum):
    """Subscription tiers, ordered free -> paid -> top.

    These are the five SKUs the product actually sells and the five values
    ``subscriptions/{uid}.planType`` can hold (mirrors ``PlanType`` in
    ``v3/src/types/subscription.ts``). Every tier that exists on the billing side
    must exist here: a paid tier missing from this enum falls through
    :func:`parse_plan` to free, which silently locks out customers who paid --
    exactly what happened to the ``team`` grants before this enum was completed.
    """

    FREE = "free"
    PRO = "pro"
    TEAM = "team"
    TEAM_PLUS = "team_plus"
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
    # Team sits above Pro on every dimension and adds priority support, matching
    # the feature matrix the desktop app gates on (``PLAN_FEATURES.team`` in
    # ``v3/src/lib/planLimits.ts``). The *numbers* below are this backend's own
    # dimensions (channels / DP / rate), which the SKU sheet does not specify;
    # they are set so no tier ever grants less than the tier beneath it.
    Plan.TEAM: PlanLimits(
        plan=Plan.TEAM,
        channel_limit=25,
        dp_monthly_quota=5000,
        rate_limit_per_minute=240,
        features=frozenset(
            {
                Feature.CHANNEL_CONNECT,
                Feature.DP_GENERATION,
                Feature.ANALYTICS,
                Feature.TEAM_COLLAB,
                Feature.API_ACCESS,
                Feature.PRIORITY_SUPPORT,
            }
        ),
    ),
    # Team Plus and Enterprise differ only in features this backend does not
    # gate yet (SSO, audit log export, SAML, on-prem), so on these dimensions
    # they are identical. Kept as separate entries so adding such a feature is a
    # one-line change instead of a tier split.
    Plan.TEAM_PLUS: PlanLimits(
        plan=Plan.TEAM_PLUS,
        channel_limit=UNLIMITED,
        dp_monthly_quota=UNLIMITED,
        rate_limit_per_minute=600,
        features=frozenset(Feature),  # every feature
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
    raising, so a corrupt or future ``planType`` can never escalate a user above
    the free tier. Note the flip side: a *legitimate* new SKU that is missing
    from :class:`Plan` also lands on free, which locks paying customers out --
    adding a tier to billing means adding it here in the same change.
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
