"""
Cache Management API Endpoints

Provides endpoints for managing and monitoring the caching system.
"""

import logging
from typing import Dict, List, Optional

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel

from backend.services.cache_service import get_cache_service, CacheStats

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/cache", tags=["Cache Management"])


class CacheStatusResponse(BaseModel):
    """Cache status response model"""
    status: str
    redis_connected: bool
    bigquery_status: str
    cache_stats: Dict


class CacheStatsResponse(BaseModel):
    """Cache statistics response model"""
    bigquery_metrics: Dict
    api_cache_size: int
    total_cache_entries: int
    redis_memory_usage: str
    uptime: str


class InvalidateCacheRequest(BaseModel):
    """Request model for cache invalidation"""
    cache_type: str  # "bigquery", "api", "all"
    pattern: Optional[str] = None
    query_type: Optional[str] = None
    endpoint: Optional[str] = None


class CacheOperationResponse(BaseModel):
    """Response model for cache operations"""
    success: bool
    message: str
    details: Optional[Dict] = None


@router.get("/status", response_model=CacheStatusResponse)
async def get_cache_status():
    """
    Get cache service status and health information
    """
    try:
        cache_service = get_cache_service()
        health_check = cache_service.health_check()

        return CacheStatusResponse(
            status=health_check["status"],
            redis_connected=health_check["redis_connected"],
            bigquery_status=health_check["bigquery_status"],
            cache_stats=health_check["cache_stats"]
        )

    except Exception as e:
        logger.error(f"Error getting cache status: {e}")
        raise HTTPException(status_code=500, detail=f"Failed to get cache status: {str(e)}")


@router.get("/stats", response_model=CacheStatsResponse)
async def get_cache_stats():
    """
    Get detailed cache statistics and metrics
    """
    try:
        cache_service = get_cache_service()
        stats = cache_service.get_cache_stats()

        return CacheStatsResponse(**stats.dict())

    except Exception as e:
        logger.error(f"Error getting cache stats: {e}")
        raise HTTPException(status_code=500, detail=f"Failed to get cache stats: {str(e)}")


@router.get("/bigquery/metrics")
async def get_bigquery_cache_metrics():
    """
    Get BigQuery cache metrics including hit rate and performance data
    """
    try:
        cache_service = get_cache_service()

        if not cache_service.bigquery_cache:
            raise HTTPException(status_code=503, detail="BigQuery cache is not available")

        metrics = cache_service.bigquery_cache.get_metrics()
        cache_info = cache_service.bigquery_cache.get_cache_info()

        return {
            "metrics": metrics.dict(),
            "cache_info": cache_info
        }

    except Exception as e:
        logger.error(f"Error getting BigQuery cache metrics: {e}")
        raise HTTPException(status_code=500, detail=f"Failed to get BigQuery metrics: {str(e)}")


@router.post("/invalidate", response_model=CacheOperationResponse)
async def invalidate_cache(request: InvalidateCacheRequest):
    """
    Invalidate cache entries based on specified criteria
    """
    try:
        cache_service = get_cache_service()

        if request.cache_type == "bigquery":
            if not cache_service.bigquery_cache:
                raise HTTPException(status_code=503, detail="BigQuery cache is not available")

            cache_service.invalidate_bigquery_cache(
                query_type=request.query_type
            )
            message = f"Invalidated BigQuery cache"
            if request.query_type:
                message += f" for query type: {request.query_type}"

        elif request.cache_type == "api":
            if request.pattern:
                cache_service.invalidate_api_cache(pattern=request.pattern)
                message = f"Invalidated API cache matching pattern: {request.pattern}"
            elif request.endpoint:
                cache_service.invalidate_api_cache(endpoint=request.endpoint)
                message = f"Invalidated API cache for endpoint: {request.endpoint}"
            else:
                cache_service.invalidate_api_cache(pattern="*")
                message = "Invalidated all API cache entries"

        elif request.cache_type == "all":
            # Clear all cache entries
            pattern = request.pattern or "marblo_*"
            cache_service.clear_all(pattern)
            message = f"Cleared all cache entries matching pattern: {pattern}"

        else:
            raise HTTPException(
                status_code=400,
                detail=f"Invalid cache_type: {request.cache_type}. Must be 'bigquery', 'api', or 'all'"
            )

        return CacheOperationResponse(
            success=True,
            message=message
        )

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error invalidating cache: {e}")
        raise HTTPException(status_code=500, detail=f"Failed to invalidate cache: {str(e)}")


@router.post("/clear/bigquery/metrics", response_model=CacheOperationResponse)
async def clear_bigquery_metrics():
    """
    Clear BigQuery cache metrics (reset hit/miss counters)
    """
    try:
        cache_service = get_cache_service()

        if not cache_service.bigquery_cache:
            raise HTTPException(status_code=503, detail="BigQuery cache is not available")

        cache_service.bigquery_cache.clear_metrics()

        return CacheOperationResponse(
            success=True,
            message="BigQuery cache metrics cleared successfully"
        )

    except Exception as e:
        logger.error(f"Error clearing BigQuery metrics: {e}")
        raise HTTPException(status_code=500, detail=f"Failed to clear BigQuery metrics: {str(e)}")


@router.get("/bigquery/query-types")
async def get_query_types():
    """
    Get available query types and their TTL configurations
    """
    try:
        from backend.utils.bigquery_cache import get_query_ttl_by_type

        query_types = [
            "products", "orders", "inventory", "settlements",
            "returns", "analytics", "reports", "reference", "default"
        ]

        ttl_config = {}
        for query_type in query_types:
            ttl_config[query_type] = get_query_ttl_by_type(query_type)

        return {
            "query_types": query_types,
            "ttl_configuration": ttl_config
        }

    except Exception as e:
        logger.error(f"Error getting query types: {e}")
        raise HTTPException(status_code=500, detail=f"Failed to get query types: {str(e)}")


@router.get("/keys")
async def list_cache_keys(
    pattern: str = Query(default="marblo_*", description="Redis key pattern to match"),
    limit: int = Query(default=100, ge=1, le=1000, description="Maximum number of keys to return")
):
    """
    List cache keys matching a pattern (for debugging)
    """
    try:
        cache_service = get_cache_service()
        keys = cache_service.redis.keys(pattern)

        # Limit results and decode keys
        limited_keys = keys[:limit]
        decoded_keys = []
        for key in limited_keys:
            if isinstance(key, bytes):
                decoded_keys.append(key.decode('utf-8'))
            else:
                decoded_keys.append(str(key))

        return {
            "pattern": pattern,
            "total_matches": len(keys),
            "returned_count": len(decoded_keys),
            "keys": decoded_keys
        }

    except Exception as e:
        logger.error(f"Error listing cache keys: {e}")
        raise HTTPException(status_code=500, detail=f"Failed to list cache keys: {str(e)}")


@router.delete("/keys/{key}")
async def delete_cache_key(key: str):
    """
    Delete a specific cache key
    """
    try:
        cache_service = get_cache_service()
        deleted = cache_service.redis.delete(key)

        return CacheOperationResponse(
            success=deleted > 0,
            message=f"{'Deleted' if deleted > 0 else 'Key not found'}: {key}",
            details={"deleted_count": deleted}
        )

    except Exception as e:
        logger.error(f"Error deleting cache key {key}: {e}")
        raise HTTPException(status_code=500, detail=f"Failed to delete cache key: {str(e)}")


@router.get("/performance/report")
async def get_performance_report():
    """
    Get comprehensive cache performance report
    """
    try:
        cache_service = get_cache_service()

        # Get overall stats
        stats = cache_service.get_cache_stats()

        # Get BigQuery specific metrics
        bq_metrics = None
        if cache_service.bigquery_cache:
            bq_metrics = cache_service.bigquery_cache.get_metrics()

        # Calculate performance indicators
        performance_indicators = {
            "cache_efficiency": "N/A",
            "memory_efficiency": "N/A",
            "recommendations": []
        }

        if bq_metrics and bq_metrics.total_queries > 0:
            hit_rate = bq_metrics.hit_rate
            performance_indicators["cache_efficiency"] = f"{hit_rate:.2f}%"

            # Add recommendations based on performance
            if hit_rate < 50:
                performance_indicators["recommendations"].append(
                    "Low cache hit rate. Consider increasing TTL values or reviewing query patterns."
                )
            elif hit_rate > 90:
                performance_indicators["recommendations"].append(
                    "Excellent cache hit rate. Current configuration is working well."
                )

        # Check memory usage
        if stats.total_cache_entries > 10000:
            performance_indicators["recommendations"].append(
                "High number of cache entries. Consider implementing cache cleanup policies."
            )

        return {
            "summary": stats.dict(),
            "bigquery_metrics": bq_metrics.dict() if bq_metrics else None,
            "performance_indicators": performance_indicators,
            "generated_at": cache_service.redis.time()[0]  # Redis server timestamp
        }

    except Exception as e:
        logger.error(f"Error generating performance report: {e}")
        raise HTTPException(status_code=500, detail=f"Failed to generate performance report: {str(e)}")