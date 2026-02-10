import json
import logging

import redis.asyncio as redis

from app.config import settings
from app.schemas import ActivityLogResponse, TaskResponse

logger = logging.getLogger(__name__)

CHANNEL = "taskforce:events"

_redis: redis.Redis | None = None


async def get_redis() -> redis.Redis:
    global _redis
    if _redis is None:
        _redis = redis.from_url(settings.redis_url, decode_responses=True)
    return _redis


async def close_redis() -> None:
    global _redis
    if _redis is not None:
        await _redis.close()
        _redis = None


async def publish_event(event_type: str, task: TaskResponse) -> None:
    """Publish a task event to Redis pub/sub."""
    try:
        r = await get_redis()
        payload = json.dumps({
            "type": event_type,
            "task": task.model_dump(mode="json"),
        })
        await r.publish(CHANNEL, payload)
    except Exception:
        logger.warning("Failed to publish event %s", event_type, exc_info=True)


async def publish_activity_event(
    task_id: str, activity: ActivityLogResponse
) -> None:
    """Publish an activity log event to Redis pub/sub."""
    try:
        r = await get_redis()
        payload = json.dumps({
            "type": "task_activity",
            "task_id": task_id,
            "activity": activity.model_dump(mode="json"),
        })
        await r.publish(CHANNEL, payload)
    except Exception:
        logger.warning("Failed to publish activity event", exc_info=True)
