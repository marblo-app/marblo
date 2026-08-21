"""Entitlement rule -- the same case table as the TypeScript mirrors.

``app/entitlement.py`` is a third copy of a rule that also lives in
``v3/src/lib/entitlement.ts`` and ``v3/functions/src/entitlement.ts``. Those two
are kept in step by ``v3/tests/unit/subscription-entitlement.test.ts``, which
runs both through one case table. This file runs the Python copy through *that
same table*, so a change made on one side only goes red here.

The rule exists because of a P0 billing bug (ticket HUETzRj97oSJOGNULro8): a Toss
subscriber who cancelled on day 2 was demoted to free immediately, losing the 29
days they had already paid for, with no refund -- while the UI showed
``currentPeriodEnd`` as their end-of-access date.
"""

from __future__ import annotations

from datetime import datetime, timezone

import pytest

from app.entitlement import (
    RENEWAL_GRACE_MS,
    resolve_entitled_plan,
    to_millis,
)

# Fixed reference clock, mirroring NOW in the TypeScript table.
NOW = int(datetime(2026, 7, 20, 12, 0, 0, tzinfo=timezone.utc).timestamp() * 1000)
DAY = 24 * 60 * 60 * 1000


def resolve(sub, now_ms: int = NOW) -> str:
    return resolve_entitled_plan(sub, now_ms)


# --- Voluntary cancellation ends at period end (P0 regression) -------------


def test_cancelled_with_time_remaining_stays_paid():
    """★The bug this rule exists for: 29 days left must not become free."""

    assert (
        resolve(
            {"status": "canceled", "planType": "pro", "currentPeriodEndMs": NOW + 29 * DAY}
        )
        == "pro"
    )


def test_paid_until_the_last_minute_of_the_period():
    assert (
        resolve(
            {"status": "canceled", "planType": "pro", "currentPeriodEndMs": NOW + 60_000}
        )
        == "pro"
    )


def test_cancelled_past_the_period_is_free_with_no_grace():
    """No renewal grace for someone who left -- they never bought those days."""

    assert (
        resolve(
            {"status": "canceled", "planType": "pro", "currentPeriodEndMs": NOW - 1}
        )
        == "free"
    )
    assert (
        resolve(
            {
                "status": "canceled",
                "planType": "pro",
                "currentPeriodEndMs": NOW - RENEWAL_GRACE_MS + DAY,
            }
        )
        == "free"
    )


def test_cancelled_without_a_period_is_free():
    """Unknown period -> free. We do not invent a period that was never bought."""

    assert resolve({"status": "canceled", "planType": "pro"}) == "free"
    assert (
        resolve({"status": "canceled", "planType": "pro", "currentPeriodEndMs": None})
        == "free"
    )


# --- planType:"free" is a hard kill switch --------------------------------


@pytest.mark.parametrize("days_left", [29, 1, 10])
def test_refund_shaped_documents_are_free_even_with_time_left(days_left: int):
    """Refund webhook / 3-strike failure / Paddle cancel all write planType=free."""

    assert (
        resolve(
            {
                "status": "canceled",
                "planType": "free",
                "currentPeriodEndMs": NOW + days_left * DAY,
            }
        )
        == "free"
    )


def test_missing_plan_type_is_free():
    assert resolve({"status": "active", "currentPeriodEndMs": NOW + DAY}) == "free"
    assert resolve({"status": "active", "planType": None}) == "free"
    assert resolve(None) == "free"
    assert resolve({}) == "free"


# --- active + renewal grace -----------------------------------------------


def test_active_within_the_period_is_paid():
    assert (
        resolve(
            {"status": "active", "planType": "pro", "currentPeriodEndMs": NOW + DAY}
        )
        == "pro"
    )


def test_active_inside_the_renewal_grace_is_paid():
    """The renewal cron runs daily; the lag is a waiting payer, not a churner."""

    assert (
        resolve(
            {
                "status": "active",
                "planType": "pro",
                "currentPeriodEndMs": NOW - RENEWAL_GRACE_MS + DAY,
            }
        )
        == "pro"
    )


def test_active_past_the_renewal_grace_is_free():
    assert (
        resolve(
            {
                "status": "active",
                "planType": "pro",
                "currentPeriodEndMs": NOW - RENEWAL_GRACE_MS - 1,
            }
        )
        == "free"
    )


def test_legacy_active_document_without_a_period_stays_paid():
    """No existing payer may be downgraded by this rule."""

    assert resolve({"status": "active", "planType": "pro"}) == "pro"
    assert resolve({"status": "active", "planType": "team"}) == "team"


# --- Everything else is free ----------------------------------------------


@pytest.mark.parametrize("status", ["past_due", "trialing", "paused", "", None, 42])
def test_other_statuses_are_free(status):
    assert (
        resolve(
            {"status": status, "planType": "pro", "currentPeriodEndMs": NOW + DAY}
        )
        == "free"
    )


# --- Period parsing --------------------------------------------------------


def test_broken_period_values_are_treated_as_unknown():
    assert (
        resolve(
            {"status": "canceled", "planType": "pro", "currentPeriodEndMs": float("nan")}
        )
        == "free"
    )
    assert (
        resolve(
            {"status": "active", "planType": "pro", "currentPeriodEndMs": float("inf")}
        )
        == "pro"
    )


def test_firestore_timestamp_shapes_are_accepted():
    """Documents come back with datetimes, not pre-normalised milliseconds."""

    ends_at = datetime.fromtimestamp((NOW + 5 * DAY) / 1000, tz=timezone.utc)
    assert (
        resolve({"status": "canceled", "planType": "pro", "currentPeriodEnd": ends_at})
        == "pro"
    )

    class Timestamp:
        def __init__(self, seconds: int) -> None:
            self.seconds = seconds

    assert (
        resolve(
            {
                "status": "canceled",
                "planType": "pro",
                "currentPeriodEnd": Timestamp((NOW + 5 * DAY) // 1000),
            }
        )
        == "pro"
    )


def test_to_millis_rejects_what_it_cannot_read():
    assert to_millis(None) is None
    assert to_millis("2026-07-20") is None
    assert to_millis(True) is None
    assert to_millis(float("nan")) is None
    assert to_millis(object()) is None


def test_naive_datetimes_are_read_as_utc():
    """Firestore returns tz-aware values; a naive one must not shift by locale."""

    naive = datetime(2026, 7, 25, 12, 0, 0)
    aware = datetime(2026, 7, 25, 12, 0, 0, tzinfo=timezone.utc)
    assert to_millis(naive) == to_millis(aware)
