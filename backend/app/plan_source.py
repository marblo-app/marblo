"""Server-side lookup of a caller's subscription -- the only source of plan.

The caller's uid comes from a verified Firebase ID token (:mod:`app.auth`); the
caller's *plan* comes from here, and here reads Firestore. Nothing a client sends
-- header, body, or token claim -- selects a tier.

Why not custom claims: they would be server-issued and therefore safe to trust,
but nothing in this product ever writes them (``setCustomUserClaims`` appears
nowhere), so a claim-based lookup resolves every paying customer to free. The
real record of who paid is ``subscriptions/{uid}``, written exclusively by Cloud
Functions -- ``firestore.rules`` pins that collection to ``allow write: if
false``, so clients cannot touch the tier even with a direct SDK write.

★The Admin SDK bypasses security rules. This module therefore never relies on
rules for authorisation: it reads exactly one document, the one whose id equals
the *verified* uid of the caller. There is no query, no uid parameter from the
request, and no path a caller can steer.

Failure policy -- fail closed, but *loudly*:

* document missing        -> free. A user with no subscription is a free user.
* Firestore unreachable   -> 503. Never a silent downgrade: an outage that
  quietly turned every paying customer into a free one would be indistinguishable
  from working software, and the paid features would just start 403-ing.
"""

from __future__ import annotations

import time
from collections.abc import Mapping
from typing import Any, Callable

from fastapi import HTTPException
from starlette.concurrency import run_in_threadpool

from app.config import settings

# Firestore paths live in constants, never inline at the call site.
SUBSCRIPTIONS_COLLECTION = "subscriptions"

# A lookup takes a uid and returns that user's subscription document (or None
# when they have none). Injectable so tests exercise the real dependency chain
# without a live Firestore.
SubscriptionDoc = Mapping[str, Any]
SubscriptionLookup = Callable[[str], SubscriptionDoc | None]

_lookup: SubscriptionLookup | None = None

# Successful lookups are cached briefly. Every plan-gated request would otherwise
# cost a Firestore read, and an enterprise caller is allowed 600 requests/min.
# The cached value is the *document*, not the resolved plan, so period expiry is
# still evaluated against the current clock on every request -- only a change to
# the document itself (upgrade, refund, cancellation) lags, by at most the TTL.
# Errors are never cached.
_CACHE_TTL_SECONDS = 60.0
_cache: dict[str, tuple[float, SubscriptionDoc | None]] = {}


class PlanLookupUnavailable(HTTPException):
    """503 -- the subscription record could not be read.

    Deliberately not "assume free": a plan lookup that fails must stop the
    request, not silently strip a paying customer of what they bought.
    """

    def __init__(self) -> None:
        super().__init__(
            status_code=503,
            detail="Subscription lookup is unavailable; please retry",
        )


def _build_firestore_lookup() -> SubscriptionLookup:
    """Create the production lookup backed by the Firebase Admin SDK.

    Imported lazily so this module stays importable (and testable) without the
    SDK present, and so process start does not depend on Firebase.
    """

    project_id = settings.firebase_project_id.strip()
    if not project_id:
        raise PlanLookupUnavailable()

    try:
        import firebase_admin
        from firebase_admin import firestore as firebase_firestore
    except ImportError as exc:  # pragma: no cover - depends on install env
        raise PlanLookupUnavailable() from exc

    try:
        app = firebase_admin.get_app()
    except ValueError:
        app = firebase_admin.initialize_app(options={"projectId": project_id})

    client = firebase_firestore.client(app)

    def _fetch(uid: str) -> SubscriptionDoc | None:
        snapshot = client.collection(SUBSCRIPTIONS_COLLECTION).document(uid).get()
        if not snapshot.exists:
            return None
        data = snapshot.to_dict()
        return data if isinstance(data, dict) else None

    return _fetch


def get_subscription_lookup() -> SubscriptionLookup:
    """Return the process-wide lookup, building it on first use."""

    global _lookup
    if _lookup is None:
        _lookup = _build_firestore_lookup()
    return _lookup


def set_subscription_lookup(lookup: SubscriptionLookup | None) -> None:
    """Override (or with ``None``, reset) the lookup. Tests only."""

    global _lookup
    _lookup = lookup
    _cache.clear()


def clear_subscription_cache() -> None:
    """Drop every cached subscription document."""

    _cache.clear()


async def fetch_subscription(
    uid: str, *, now: float | None = None
) -> SubscriptionDoc | None:
    """Read ``subscriptions/{uid}``, or ``None`` when the user has no record.

    Raises :class:`PlanLookupUnavailable` if the record cannot be read at all.
    """

    if not uid:
        raise PlanLookupUnavailable()

    clock = time.monotonic() if now is None else now
    cached = _cache.get(uid)
    if cached is not None and cached[0] > clock:
        return cached[1]

    lookup = get_subscription_lookup()
    try:
        document = await run_in_threadpool(lookup, uid)
    except HTTPException:
        raise
    except Exception as exc:
        raise PlanLookupUnavailable() from exc

    if document is not None and not isinstance(document, Mapping):
        # A malformed record is an infrastructure problem, not a free user.
        raise PlanLookupUnavailable()

    _cache[uid] = (clock + _CACHE_TTL_SECONDS, document)
    return document
