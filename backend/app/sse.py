import asyncio
import json
import logging

import redis.asyncio as redis
from sse_starlette.sse import EventSourceResponse
from starlette.requests import Request

from app.config import settings
from app.events import CHANNEL

logger = logging.getLogger(__name__)


async def _event_generator(request: Request):
    """Subscribe to Redis pub/sub and yield SSE events."""
    r = redis.from_url(settings.redis_url, decode_responses=True)
    pubsub = r.pubsub()
    await pubsub.subscribe(CHANNEL)

    try:
        while True:
            if await request.is_disconnected():
                break

            message = await pubsub.get_message(
                ignore_subscribe_messages=True, timeout=1.0
            )
            if message is not None and message["type"] == "message":
                data = message["data"]
                try:
                    parsed = json.loads(data)
                    event_type = parsed.get("type", "task_updated")
                    yield {
                        "event": event_type,
                        "data": data,
                    }
                except json.JSONDecodeError:
                    logger.warning("Invalid JSON in Redis message: %s", data)
            else:
                # Send keepalive comment every second when no messages
                yield {"comment": "keepalive"}
                await asyncio.sleep(1)
    finally:
        await pubsub.unsubscribe(CHANNEL)
        await pubsub.close()
        await r.close()


async def sse_endpoint(request: Request):
    """SSE endpoint for real-time task updates."""
    return EventSourceResponse(
        _event_generator(request),
        media_type="text/event-stream",
    )
