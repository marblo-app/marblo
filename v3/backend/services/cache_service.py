"""
Cache Service

Central caching service that provides unified caching across the application
including BigQuery results, API responses, and general data caching.
"""

import json
import logging
from datetime import datetime, timedelta
from typing import Any, Dict, List, Optional, Union, Callable
from functools import wraps
from urllib.parse import urlencode

import redis
from google.cloud import bigquery
from pydantic import BaseModel

from backend.core.config import settings
from backend.utils.bigquery_cache import BigQueryCache, get_query_ttl_by_type

logger = logging.getLogger(__name__)


class CacheStats(BaseModel):
    """Overall cache statistics"""
    bigquery_metrics: Dict[str, Any]
    api_cache_size: int
    total_cache_entries: int
    redis_memory_usage: str
    uptime: str


class APICache:
    """API response caching manager"""

    def __init__(self, redis_client: redis.Redis, cache_prefix: str = "marblo_api_cache"):
        self.redis = redis_client
        self.cache_prefix = cache_prefix
        self.default_ttl = settings.CACHE_API_TTL

    def _make_cache_key(self, endpoint: str, params: Dict[str, Any] = None) -> str:
        """Generate cache key for API endpoint"""
        key_parts = [self.cache_prefix, endpoint]

        if params:
            # Sort parameters for consistent key generation
            sorted_params = sorted(params.items())
            param_string = urlencode(sorted_params)
            key_parts.append(param_string)

        return ":".join(key_parts)

    def get(self, endpoint: str, params: Dict[str, Any] = None) -> Optional[Dict[str, Any]]:
        """Get cached API response"""
        try:
            cache_key = self._make_cache_key(endpoint, params)
            cached_data = self.redis.get(cache_key)

            if cached_data:
                logger.debug(f"API cache HIT for {endpoint}")
                return json.loads(cached_data)

            logger.debug(f"API cache MISS for {endpoint}")
            return None

        except Exception as e:
            logger.error(f"Error getting API cache for {endpoint}: {e}")
            return None

    def set(
        self,
        endpoint: str,
        data: Dict[str, Any],
        params: Dict[str, Any] = None,
        ttl: int = None
    ):
        """Set API response in cache"""
        try:
            cache_key = self._make_cache_key(endpoint, params)
            cache_ttl = ttl or self.default_ttl

            cache_data = {
                "data": data,
                "cached_at": datetime.utcnow().isoformat(),
                "endpoint": endpoint,
                "params": params
            }

            self.redis.setex(
                cache_key,
                cache_ttl,
                json.dumps(cache_data, default=str)
            )

            logger.debug(f"Cached API response for {endpoint} (TTL: {cache_ttl}s)")

        except Exception as e:
            logger.error(f"Error caching API response for {endpoint}: {e}")

    def delete(self, endpoint: str, params: Dict[str, Any] = None):
        """Delete cached API response"""
        try:
            cache_key = self._make_cache_key(endpoint, params)
            deleted = self.redis.delete(cache_key)
            if deleted:
                logger.debug(f"Deleted API cache for {endpoint}")

        except Exception as e:
            logger.error(f"Error deleting API cache for {endpoint}: {e}")

    def clear_pattern(self, pattern: str):
        """Clear cached responses matching pattern"""
        try:
            full_pattern = f"{self.cache_prefix}:{pattern}"
            keys = self.redis.keys(full_pattern)
            if keys:
                deleted = self.redis.delete(*keys)
                logger.info(f"Cleared {deleted} API cache entries matching {pattern}")

        except Exception as e:
            logger.error(f"Error clearing API cache pattern {pattern}: {e}")


class CacheService:
    """
    Central cache service providing unified caching functionality

    Features:
    - BigQuery result caching
    - API response caching
    - General purpose caching
    - Cache invalidation strategies
    - Performance monitoring
    """

    def __init__(self):
        # Initialize Redis connection
        self.redis = self._create_redis_client()

        # Initialize BigQuery client if credentials available
        try:
            self.bq_client = bigquery.Client(project=settings.GOOGLE_CLOUD_PROJECT)
            self.bigquery_cache = BigQueryCache(self.redis, self.bq_client)
        except Exception as e:
            logger.warning(f"BigQuery client initialization failed: {e}")
            self.bq_client = None
            self.bigquery_cache = None

        # Initialize API cache
        self.api_cache = APICache(self.redis)

        logger.info("Cache service initialized successfully")

    def _create_redis_client(self) -> redis.Redis:
        """Create Redis client with proper configuration"""
        try:
            redis_client = redis.from_url(
                settings.REDIS_URL,
                decode_responses=False,  # Keep as bytes for JSON handling
                socket_connect_timeout=5,
                socket_timeout=5,
                retry_on_timeout=True,
                health_check_interval=30
            )

            # Test connection
            redis_client.ping()
            logger.info(f"Connected to Redis at {settings.REDIS_URL}")

            return redis_client

        except Exception as e:
            logger.error(f"Failed to connect to Redis: {e}")
            raise

    def get_cache_stats(self) -> CacheStats:
        """Get comprehensive cache statistics"""
        try:
            # BigQuery metrics
            bq_metrics = {}
            if self.bigquery_cache:
                bq_metrics = self.bigquery_cache.get_cache_info()

            # API cache size
            api_keys = self.redis.keys("marblo_api_cache:*")
            api_cache_size = len(api_keys)

            # Total cache entries
            all_cache_keys = self.redis.keys("marblo_*")
            total_entries = len(all_cache_keys)

            # Redis memory usage
            redis_info = self.redis.info("memory")
            memory_usage = redis_info.get("used_memory_human", "unknown")

            # Uptime
            server_info = self.redis.info("server")
            uptime_seconds = server_info.get("uptime_in_seconds", 0)
            uptime = str(timedelta(seconds=uptime_seconds))

            return CacheStats(
                bigquery_metrics=bq_metrics,
                api_cache_size=api_cache_size,
                total_cache_entries=total_entries,
                redis_memory_usage=memory_usage,
                uptime=uptime
            )

        except Exception as e:
            logger.error(f"Error getting cache stats: {e}")
            return CacheStats(
                bigquery_metrics={"error": str(e)},
                api_cache_size=0,
                total_cache_entries=0,
                redis_memory_usage="unknown",
                uptime="unknown"
            )

    # BigQuery cache methods
    def execute_bigquery(
        self,
        query: str,
        query_type: str = "generic",
        parameters: Dict[str, Any] = None,
        ttl: int = None
    ) -> List[Dict[str, Any]]:
        """Execute BigQuery query with caching"""
        if not self.bigquery_cache:
            raise RuntimeError("BigQuery caching is not available")

        return self.bigquery_cache.execute_cached_query(
            query=query,
            query_type=query_type,
            parameters=parameters,
            ttl=ttl
        )

    def invalidate_bigquery_cache(
        self,
        query_type: str = None,
        dataset_id: str = None
    ):
        """Invalidate BigQuery cache entries"""
        if self.bigquery_cache:
            self.bigquery_cache.invalidate_cache(
                query_type=query_type,
                dataset_id=dataset_id
            )

    # API cache methods
    def get_api_response(self, endpoint: str, params: Dict[str, Any] = None) -> Optional[Dict[str, Any]]:
        """Get cached API response"""
        return self.api_cache.get(endpoint, params)

    def cache_api_response(
        self,
        endpoint: str,
        data: Dict[str, Any],
        params: Dict[str, Any] = None,
        ttl: int = None
    ):
        """Cache API response"""
        self.api_cache.set(endpoint, data, params, ttl)

    def invalidate_api_cache(self, endpoint: str = None, pattern: str = None):
        """Invalidate API cache"""
        if pattern:
            self.api_cache.clear_pattern(pattern)
        elif endpoint:
            self.api_cache.delete(endpoint)

    # General cache methods
    def get(self, key: str) -> Optional[Any]:
        """Get value from cache"""
        try:
            cached_data = self.redis.get(f"marblo_general:{key}")
            if cached_data:
                return json.loads(cached_data)
            return None

        except Exception as e:
            logger.error(f"Error getting cache key {key}: {e}")
            return None

    def set(self, key: str, value: Any, ttl: int = None):
        """Set value in cache"""
        try:
            cache_ttl = ttl or settings.CACHE_DEFAULT_TTL
            self.redis.setex(
                f"marblo_general:{key}",
                cache_ttl,
                json.dumps(value, default=str)
            )

        except Exception as e:
            logger.error(f"Error setting cache key {key}: {e}")

    def delete(self, key: str):
        """Delete value from cache"""
        try:
            self.redis.delete(f"marblo_general:{key}")

        except Exception as e:
            logger.error(f"Error deleting cache key {key}: {e}")

    def clear_all(self, pattern: str = "marblo_*"):
        """Clear all cache entries matching pattern"""
        try:
            keys = self.redis.keys(pattern)
            if keys:
                deleted = self.redis.delete(*keys)
                logger.info(f"Cleared {deleted} cache entries")
            else:
                logger.info("No cache entries to clear")

        except Exception as e:
            logger.error(f"Error clearing cache: {e}")

    def health_check(self) -> Dict[str, Any]:
        """Perform cache service health check"""
        try:
            # Test Redis connection
            ping_result = self.redis.ping()

            # Test BigQuery connection if available
            bq_status = "not_configured"
            if self.bq_client:
                try:
                    # Simple query to test BigQuery connectivity
                    query = "SELECT 1 as test_value"
                    job = self.bq_client.query(query)
                    job.result()  # Wait for completion
                    bq_status = "healthy"
                except Exception as e:
                    bq_status = f"error: {str(e)}"

            return {
                "status": "healthy",
                "redis_connected": ping_result,
                "bigquery_status": bq_status,
                "cache_stats": self.get_cache_stats().dict()
            }

        except Exception as e:
            return {
                "status": "unhealthy",
                "error": str(e)
            }


# Singleton instance
_cache_service_instance: Optional[CacheService] = None


def get_cache_service() -> CacheService:
    """Get singleton cache service instance"""
    global _cache_service_instance

    if _cache_service_instance is None:
        _cache_service_instance = CacheService()

    return _cache_service_instance


# Decorators for caching
def cache_api_response(endpoint: str = None, ttl: int = None):
    """
    Decorator to cache API responses

    Usage:
        @cache_api_response(endpoint="products/list", ttl=300)
        def get_products(params):
            return expensive_operation(params)
    """
    def decorator(func: Callable) -> Callable:
        @wraps(func)
        def wrapper(*args, **kwargs):
            cache_service = get_cache_service()

            # Use function name if endpoint not provided
            cache_endpoint = endpoint or func.__name__

            # Try to get from cache
            cached_result = cache_service.get_api_response(cache_endpoint, kwargs)
            if cached_result is not None:
                return cached_result["data"]

            # Execute function and cache result
            result = func(*args, **kwargs)
            cache_service.cache_api_response(cache_endpoint, result, kwargs, ttl)

            return result

        return wrapper
    return decorator


def cache_bigquery_result(query_type: str = "generic", ttl: int = None):
    """
    Decorator to cache BigQuery results

    Usage:
        @cache_bigquery_result(query_type="products", ttl=1800)
        def get_product_analytics(query, params):
            return cache_service.execute_bigquery(query, "products", params)
    """
    def decorator(func: Callable) -> Callable:
        @wraps(func)
        def wrapper(*args, **kwargs):
            cache_service = get_cache_service()

            # Extract query and parameters from function arguments
            query = args[0] if args else kwargs.get("query")
            parameters = args[1] if len(args) > 1 else kwargs.get("parameters")

            if not query:
                # If no query provided, just execute function normally
                return func(*args, **kwargs)

            # Use cache service to execute query
            return cache_service.execute_bigquery(
                query=query,
                query_type=query_type,
                parameters=parameters,
                ttl=ttl or get_query_ttl_by_type(query_type)
            )

        return wrapper
    return decorator


def invalidate_related_cache(cache_patterns: List[str]):
    """
    Decorator to invalidate related cache entries after function execution

    Usage:
        @invalidate_related_cache(["products:*", "inventory:*"])
        def update_product(product_id, data):
            return update_operation(product_id, data)
    """
    def decorator(func: Callable) -> Callable:
        @wraps(func)
        def wrapper(*args, **kwargs):
            result = func(*args, **kwargs)

            # Invalidate specified cache patterns
            cache_service = get_cache_service()
            for pattern in cache_patterns:
                cache_service.clear_all(f"marblo_*:{pattern}")

            return result

        return wrapper
    return decorator