"""Request authentication for plan gating.

Identity (and therefore entitlement) is derived from a **verified Firebase ID
token** carried in the ``Authorization: Bearer <token>`` header. Nothing here
reads client-supplied identity headers: a caller cannot name themselves, and a
caller cannot name their plan.

Why this module exists: plan gating previously trusted ``X-User-Id`` /
``X-Plan``, so ``curl -H 'X-Plan: enterprise'`` was enough to unlock every paid
feature and to spend another user's quota. Those headers are now ignored
outright (see :func:`app.plan_limits.get_user_context`).

Verification only needs the Firebase project id -- ID tokens are RS256-signed
by Google and validated against Google's public certs, so no service-account
credential is required. Set ``MARBLO_FIREBASE_PROJECT_ID``; when it is missing
every gated request fails closed with 503 rather than silently degrading to an
unauthenticated (or worse, header-trusting) mode.
"""

from __future__ import annotations

from typing import Any, Callable

from fastapi import Header, HTTPException
from starlette.concurrency import run_in_threadpool

from app.config import settings

# A verifier takes a raw ID token and returns its decoded claims, raising on
# any invalid/expired/forged token. Injectable so tests can exercise the full
# dependency without minting real Google-signed tokens.
Claims = dict[str, Any]
TokenVerifier = Callable[[str], Claims]

_BEARER_PREFIX = "bearer"

_verifier: TokenVerifier | None = None


class AuthError(HTTPException):
    """401 for a missing, malformed, expired, or otherwise invalid credential."""

    def __init__(self, detail: str = "Invalid or missing credentials") -> None:
        super().__init__(
            status_code=401,
            detail=detail,
            headers={"WWW-Authenticate": "Bearer"},
        )


class AuthNotConfigured(HTTPException):
    """503 raised when the server cannot verify tokens at all.

    Fail closed: an unconfigured server must reject gated traffic, never admit
    it unauthenticated.
    """

    def __init__(self) -> None:
        super().__init__(
            status_code=503,
            detail="Authentication is not configured on this server",
        )


# Token verification ---------------------------------------------------------


def _build_firebase_verifier() -> TokenVerifier:
    """Create the production verifier backed by the Firebase Admin SDK.

    Imported lazily so the module (and its tests) stay importable without the
    SDK installed, and so process start does not depend on Firebase.
    """

    project_id = settings.firebase_project_id.strip()
    if not project_id:
        raise AuthNotConfigured()

    try:
        import firebase_admin
        from firebase_admin import auth as firebase_auth
    except ImportError as exc:  # pragma: no cover - depends on install env
        raise AuthNotConfigured() from exc

    try:
        app = firebase_admin.get_app()
    except ValueError:
        # No credential is passed: ID token verification only needs the project
        # id plus Google's public certs. firebase-admin resolves credentials
        # lazily, so this stays credential-free.
        app = firebase_admin.initialize_app(options={"projectId": project_id})

    def _verify(token: str) -> Claims:
        return firebase_auth.verify_id_token(token, app=app)

    return _verify


def get_token_verifier() -> TokenVerifier:
    """Return the process-wide verifier, building it on first use."""

    global _verifier
    if _verifier is None:
        _verifier = _build_firebase_verifier()
    return _verifier


def set_token_verifier(verifier: TokenVerifier | None) -> None:
    """Override (or with ``None``, reset) the verifier. Tests only."""

    global _verifier
    _verifier = verifier


# Header parsing -------------------------------------------------------------


def parse_bearer_token(authorization: str | None) -> str:
    """Extract the token from an ``Authorization`` header value.

    Raises :class:`AuthError` unless the header is exactly one ``Bearer
    <token>`` pair with a non-empty token.
    """

    if not authorization:
        raise AuthError("Missing Authorization header")

    parts = authorization.split()
    if len(parts) != 2 or parts[0].lower() != _BEARER_PREFIX or not parts[1]:
        raise AuthError("Authorization header must be 'Bearer <token>'")
    return parts[1]


# FastAPI dependency ---------------------------------------------------------


async def get_verified_claims(
    authorization: str | None = Header(default=None, alias="Authorization"),
) -> Claims:
    """Resolve the verified claims of the calling user, or reject the request."""

    token = parse_bearer_token(authorization)
    verifier = get_token_verifier()

    try:
        claims = await run_in_threadpool(verifier, token)
    except HTTPException:
        raise
    except Exception as exc:
        # Deliberately opaque: verification failures must not describe why a
        # token was rejected (expiry vs. signature vs. audience).
        raise AuthError("Invalid or expired credentials") from exc

    if not isinstance(claims, dict):
        raise AuthError()
    return claims


def extract_uid(claims: Claims) -> str:
    """Pull the authenticated user id out of verified claims.

    firebase-admin surfaces the subject as both ``uid`` and ``sub``; either is
    server-issued and unforgeable once the signature has been checked.
    """

    for key in ("uid", "sub"):
        value = claims.get(key)
        if isinstance(value, str) and value.strip():
            return value.strip()
    raise AuthError("Token carries no user id")
