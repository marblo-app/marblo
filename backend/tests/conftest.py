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

from app import auth  # noqa: E402


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
