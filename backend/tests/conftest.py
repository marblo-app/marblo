"""Shared fixtures for the backend test suite.

Run from ``backend/``::

    pip install -r requirements.txt -r requirements-dev.txt
    pytest
"""

from __future__ import annotations

import sys
from pathlib import Path

import pytest

# Tests run against the source tree, not an installed package.
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app import auth, plan_source  # noqa: E402


class FakeRedis:
    """In-memory stand-in covering only the commands plan_limits issues."""

    def __init__(self) -> None:
        self.values: dict[str, int] = {}
        self.sets: dict[str, set[str]] = {}
        self.expires: dict[str, int] = {}

    async def get(self, key: str):
        value = self.values.get(key)
        return None if value is None else str(value)

    async def incr(self, key: str) -> int:
        return await self.incrby(key, 1)

    async def incrby(self, key: str, amount: int) -> int:
        self.values[key] = self.values.get(key, 0) + amount
        return self.values[key]

    async def expire(self, key: str, seconds: int) -> bool:
        self.expires[key] = seconds
        return True

    async def scard(self, key: str) -> int:
        return len(self.sets.get(key, set()))

    async def sismember(self, key: str, member: str) -> bool:
        return member in self.sets.get(key, set())

    async def sadd(self, key: str, member: str) -> int:
        self.sets.setdefault(key, set()).add(member)
        return 1

    async def srem(self, key: str, member: str) -> int:
        self.sets.get(key, set()).discard(member)
        return 1


@pytest.fixture
def fake_redis(monkeypatch) -> FakeRedis:
    """Point plan_limits at an in-memory Redis."""

    from app import plan_limits

    client = FakeRedis()

    async def _get_redis():
        return client

    monkeypatch.setattr(plan_limits, "get_redis", _get_redis)
    return client


@pytest.fixture(autouse=True)
def reset_token_verifier():
    """Keep the process-wide verifier from leaking between tests."""

    auth.set_token_verifier(None)
    yield
    auth.set_token_verifier(None)


class FakeSubscriptions:
    """In-memory stand-in for the ``subscriptions`` collection.

    Records every uid looked up so tests can assert *which* document was read --
    the security property is that the server reads the verified caller's own
    record and nothing else.
    """

    def __init__(self) -> None:
        self.docs: dict[str, dict] = {}
        self.reads: list[str] = []
        self.error: Exception | None = None

    def grant(self, uid: str, **fields) -> None:
        """Write a subscription document for ``uid`` (defaults to active)."""

        doc = {"status": "active", **fields}
        self.docs[uid] = doc

    def __call__(self, uid: str):
        self.reads.append(uid)
        if self.error is not None:
            raise self.error
        return self.docs.get(uid)


@pytest.fixture
def subscriptions() -> FakeSubscriptions:
    """Install an in-memory subscription store as the server-side plan source."""

    store = FakeSubscriptions()
    plan_source.set_subscription_lookup(store)
    return store


@pytest.fixture(autouse=True)
def reset_plan_source():
    """Keep the process-wide lookup and its cache from leaking between tests.

    The default for a test that installs nothing is "this user has no
    subscription" -- i.e. free -- so no test accidentally reaches a real
    Firestore.
    """

    plan_source.set_subscription_lookup(lambda uid: None)
    yield
    plan_source.set_subscription_lookup(None)
