"""Subscription entitlement rule -- what plan does this subscription grant *now*.

★MIRROR -- this file implements the **same rule** as
``v3/src/lib/entitlement.ts`` and ``v3/functions/src/entitlement.ts``. Those two
are a byte-identical pair (a renderer copy and a Cloud Functions copy); this is
a third copy in Python because the FastAPI backend cannot import TypeScript.

Drift is guarded by tests, not by comments: ``tests/test_entitlement.py`` runs
the *same case table* as ``v3/tests/unit/subscription-entitlement.test.ts``. If
someone changes the rule on one side only, that table goes red here.

Why the rule is not just ``status == "active"``:

* Toss voluntary cancellation (``cancelTossSubscription``) writes
  ``status="canceled"`` and leaves ``planType`` alone. Judging on status alone
  would drop a user who cancelled on day 2 straight to free and burn the 29 days
  they already paid for -- with no refund. Cancelling stops the *next* charge; it
  does not confiscate the period already bought.
* The status cannot simply stay ``active`` either: Toss recurring billing is a
  pull model (``scheduledChargeSubscriptions`` selects on
  ``status in {active, past_due}``), so leaving it active would re-charge a user
  who cancelled. Status stays ``canceled``; only the *judgement* looks at the
  period.
* ``planType == "free"`` is a hard kill switch. Every path that must cut access
  immediately -- Toss refund webhook, 3-strike billing failure, Paddle
  ``subscription.canceled`` -- writes ``status=canceled`` together with
  ``planType="free"``. The rule below drops those to free unconditionally.
"""

from __future__ import annotations

from collections.abc import Mapping
from datetime import datetime, timezone
from math import isfinite
from typing import Any

# The renewal cron (scheduledChargeSubscriptions) runs once a day (04:30 KST).
# Between the period boundary and that run there is a normal lag of up to ~24h,
# and users in that window are waiting for renewal, not churned. The grace only
# applies while status is still ``active`` -- a failed charge flips status to
# past_due/canceled, so this never keeps a delinquent account paid forever.
RENEWAL_GRACE_DAYS = 3
_DAY_MS = 24 * 60 * 60 * 1000
RENEWAL_GRACE_MS = RENEWAL_GRACE_DAYS * _DAY_MS

FREE = "free"


def to_millis(value: Any) -> int | None:
    """Normalise a Firestore period end into epoch milliseconds.

    Accepts what the ``subscriptions`` collection actually holds across its
    history: a Firestore ``Timestamp`` (``DatetimeWithNanoseconds``), a plain
    ``datetime``, or a raw epoch number. Anything unparseable -- including NaN
    and infinity -- becomes ``None`` ("period unknown") rather than a guess.
    """

    if value is None or value is True or value is False:
        return None
    if isinstance(value, datetime):
        moment = value if value.tzinfo else value.replace(tzinfo=timezone.utc)
        return int(moment.timestamp() * 1000)
    if isinstance(value, (int, float)):
        return int(value) if isfinite(float(value)) else None
    # Firestore Timestamp objects from other client shapes.
    to_ms = getattr(value, "to_millis", None) or getattr(value, "toMillis", None)
    if callable(to_ms):
        try:
            millis = to_ms()
        except Exception:  # pragma: no cover - defensive
            return None
        if not isinstance(millis, (int, float)) or not isfinite(float(millis)):
            return None
        return int(millis)
    seconds = getattr(value, "seconds", None)
    if isinstance(seconds, (int, float)) and isfinite(float(seconds)):
        return int(seconds * 1000)
    return None


def resolve_entitled_plan(
    sub: Mapping[str, Any] | None, now_ms: int
) -> str:
    """Return the plan this subscription grants right now, or ``"free"``.

    Rules (identical to the TypeScript mirrors):

    * no ``planType``, or ``planType == "free"``  -> free (hard kill switch)
    * ``active``   -> unknown period (legacy doc) stays paid -- this rule must
      never be what downgrades an existing payer. A known period stays paid
      until it expires plus the renewal grace.
    * ``canceled`` -> paid only while an **explicitly recorded** period has not
      yet passed. No grace: there is no reason to hand someone who left a period
      they never bought. Unknown period -> free; we do not invent one.
    * anything else (``past_due`` / ``trialing`` / unknown) -> free.
    """

    if not sub:
        return FREE

    raw_plan = sub.get("planType")
    plan_type = raw_plan if isinstance(raw_plan, str) else ""
    if not plan_type or plan_type == FREE:
        return FREE

    # The TS mirrors take a pre-normalised ``currentPeriodEndMs`` because their
    # callers convert first. Here the raw Firestore field is accepted too, so a
    # document can be passed straight through without a conversion step that a
    # future caller could forget.
    raw_end = sub.get("currentPeriodEndMs")
    if raw_end is None:
        raw_end = sub.get("currentPeriodEnd")
    end_ms = to_millis(raw_end)
    status = sub.get("status")

    if status == "active":
        # A legacy doc with no recorded period stays paid -- no existing payer
        # gets downgraded by this rule.
        if end_ms is None:
            return plan_type
        return plan_type if end_ms + RENEWAL_GRACE_MS > now_ms else FREE
    if status == "canceled":
        return plan_type if end_ms is not None and end_ms > now_ms else FREE
    return FREE


def now_millis() -> int:
    """Current time in epoch milliseconds (injectable seam for tests)."""

    return int(datetime.now(timezone.utc).timestamp() * 1000)
