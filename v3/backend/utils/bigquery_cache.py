"""
BigQuery Cache Utility

This module provides caching functionality for BigQuery query results to improve
API response times and reduce BigQuery costs.
"""

import hashlib
import json
import logging
from datetime import datetime, timedelta
from typing import Any, Dict, List, Optional, Union

import redis
from google.cloud import bigquery
from google.cloud.exceptions import NotFound
from pydantic import BaseModel

from backend.core.config import settings

logger = logging.getLogger(__name__)


class CacheMetrics(BaseModel):
    """Cache metrics for monitoring"""
    hits: int = 0
    misses: int = 0
    total_queries: int = 0
    cache_size: int = 0

    @property
    def hit_rate(self) -> float:
        """Calculate cache hit rate"""
        if self.total_queries == 0:
            return 0.0
        return (self.hits / self.total_queries) * 100


class QueryCacheKey(BaseModel):
    """Cache key structure for BigQuery queries"""
    query_hash: str
    dataset_id: str
    query_type: str
    parameters: Optional[Dict[str, Any]] = None

    def to_redis_key(self) -> str:
        """Convert to Redis key format"""
        key_parts = [
            "bigquery_cache",
            self.dataset_id,
            self.query_type,
            self.query_hash
        ]
        if self.parameters:
            param_hash = hashlib.md5(json.dumps(self.parameters, sort_keys=True).encode()).hexdigest()
            key_parts.append(param_hash)

        return ":".join(key_parts)


class BigQueryCache:
    """
    BigQuery query result caching manager

    Provides intelligent caching for BigQuery queries with:
    - Query result caching with configurable TTL
    - Cache key generation based on query content and parameters
    - Cache invalidation strategies
    - Performance monitoring and metrics
    """

    def __init__(
        self,
        redis_client: redis.Redis,
        bigquery_client: bigquery.Client,
        default_ttl: int = None,
        cache_prefix: str = "marblo_bq_cache"
    ):
        self.redis = redis_client
        self.bq_client = bigquery_client
        self.default_ttl = default_ttl or settings.CACHE_BIGQUERY_TTL
        self.cache_prefix = cache_prefix
        self.metrics_key = f"{cache_prefix}:metrics"

    def _generate_query_hash(self, query: str) -> str:
        """Generate hash for query string"""
        normalized_query = " ".join(query.strip().split())
        return hashlib.sha256(normalized_query.encode()).hexdigest()[:16]

    def _get_cache_key(
        self,
        query: str,
        query_type: str = "generic",
        dataset_id: str = None,
        parameters: Dict[str, Any] = None
    ) -> QueryCacheKey:
        """Generate cache key for query"""
        query_hash = self._generate_query_hash(query)
        dataset = dataset_id or settings.BIGQUERY_DATASET_ID

        return QueryCacheKey(
            query_hash=query_hash,
            dataset_id=dataset,
            query_type=query_type,
            parameters=parameters
        )

    def _update_metrics(self, hit: bool):
        """Update cache metrics"""
        try:
            pipe = self.redis.pipeline()
            metrics_key = self.metrics_key

            if hit:
                pipe.hincrby(metrics_key, "hits", 1)
            else:
                pipe.hincrby(metrics_key, "misses", 1)

            pipe.hincrby(metrics_key, "total_queries", 1)
            pipe.expire(metrics_key, 86400)  # Expire metrics after 24 hours
            pipe.execute()

        except Exception as e:
            logger.warning(f"Failed to update cache metrics: {e}")

    def get_metrics(self) -> CacheMetrics:
        """Get current cache metrics"""
        try:
            metrics_data = self.redis.hgetall(self.metrics_key)

            if not metrics_data:
                return CacheMetrics()

            # Convert byte strings to integers
            metrics = {}
            for key, value in metrics_data.items():
                if isinstance(key, bytes):
                    key = key.decode('utf-8')
                if isinstance(value, bytes):
                    value = int(value.decode('utf-8'))
                metrics[key] = value

            return CacheMetrics(**metrics)

        except Exception as e:
            logger.warning(f"Failed to get cache metrics: {e}")
            return CacheMetrics()

    def clear_metrics(self):
        """Clear cache metrics"""
        try:
            self.redis.delete(self.metrics_key)
            logger.info("Cache metrics cleared")
        except Exception as e:
            logger.error(f"Failed to clear cache metrics: {e}")

    def get_cached_result(
        self,
        query: str,
        query_type: str = "generic",
        dataset_id: str = None,
        parameters: Dict[str, Any] = None
    ) -> Optional[List[Dict[str, Any]]]:
        """
        Get cached query result

        Args:
            query: SQL query string
            query_type: Type of query (for categorization)
            dataset_id: BigQuery dataset ID
            parameters: Query parameters for parameterized queries

        Returns:
            Cached query result or None if not found
        """
        try:
            cache_key = self._get_cache_key(query, query_type, dataset_id, parameters)
            redis_key = cache_key.to_redis_key()

            cached_data = self.redis.get(redis_key)
            if cached_data:
                self._update_metrics(hit=True)
                result = json.loads(cached_data)

                logger.info(f"Cache HIT for query type '{query_type}' (key: {cache_key.query_hash})")
                return result

            self._update_metrics(hit=False)
            logger.info(f"Cache MISS for query type '{query_type}' (key: {cache_key.query_hash})")
            return None

        except Exception as e:
            logger.error(f"Error getting cached result: {e}")
            self._update_metrics(hit=False)
            return None

    def cache_result(
        self,
        query: str,
        result: List[Dict[str, Any]],
        query_type: str = "generic",
        dataset_id: str = None,
        parameters: Dict[str, Any] = None,
        ttl: int = None
    ):
        """
        Cache query result

        Args:
            query: SQL query string
            result: Query result to cache
            query_type: Type of query (for categorization)
            dataset_id: BigQuery dataset ID
            parameters: Query parameters for parameterized queries
            ttl: Time to live in seconds (uses default if not provided)
        """
        try:
            cache_key = self._get_cache_key(query, query_type, dataset_id, parameters)
            redis_key = cache_key.to_redis_key()
            cache_ttl = ttl or self.default_ttl

            # Prepare result for caching
            cache_data = {
                "result": result,
                "cached_at": datetime.utcnow().isoformat(),
                "query_type": query_type,
                "ttl": cache_ttl
            }

            # Store in Redis
            self.redis.setex(
                redis_key,
                cache_ttl,
                json.dumps(cache_data, default=str)
            )

            logger.info(
                f"Cached result for query type '{query_type}' "
                f"(key: {cache_key.query_hash}, TTL: {cache_ttl}s, size: {len(result)} rows)"
            )

        except Exception as e:
            logger.error(f"Error caching result: {e}")

    def execute_cached_query(
        self,
        query: str,
        query_type: str = "generic",
        dataset_id: str = None,
        parameters: Dict[str, Any] = None,
        ttl: int = None
    ) -> List[Dict[str, Any]]:
        """
        Execute BigQuery query with caching

        First checks cache, executes query if not cached, then stores result

        Args:
            query: SQL query string
            query_type: Type of query (for categorization and TTL selection)
            dataset_id: BigQuery dataset ID
            parameters: Query parameters for parameterized queries
            ttl: Cache TTL in seconds

        Returns:
            Query result as list of dictionaries
        """
        # Try to get from cache first
        cached_result = self.get_cached_result(query, query_type, dataset_id, parameters)
        if cached_result is not None:
            return cached_result["result"]

        # Execute query
        try:
            logger.info(f"Executing BigQuery query (type: {query_type})")

            # Configure query job
            job_config = bigquery.QueryJobConfig()
            if parameters:
                # Convert parameters to BigQuery parameter format
                query_parameters = []
                for key, value in parameters.items():
                    if isinstance(value, str):
                        query_parameters.append(
                            bigquery.ScalarQueryParameter(key, "STRING", value)
                        )
                    elif isinstance(value, int):
                        query_parameters.append(
                            bigquery.ScalarQueryParameter(key, "INTEGER", value)
                        )
                    elif isinstance(value, float):
                        query_parameters.append(
                            bigquery.ScalarQueryParameter(key, "FLOAT", value)
                        )
                    elif isinstance(value, bool):
                        query_parameters.append(
                            bigquery.ScalarQueryParameter(key, "BOOLEAN", value)
                        )
                    elif isinstance(value, datetime):
                        query_parameters.append(
                            bigquery.ScalarQueryParameter(key, "TIMESTAMP", value)
                        )

                job_config.query_parameters = query_parameters

            # Execute query
            query_job = self.bq_client.query(query, job_config=job_config)
            results = query_job.result()

            # Convert to list of dictionaries
            result_list = []
            for row in results:
                result_list.append(dict(row))

            logger.info(f"BigQuery query executed successfully ({len(result_list)} rows)")

            # Cache the result
            self.cache_result(
                query=query,
                result=result_list,
                query_type=query_type,
                dataset_id=dataset_id,
                parameters=parameters,
                ttl=ttl
            )

            return result_list

        except Exception as e:
            logger.error(f"BigQuery query execution failed: {e}")
            raise

    def invalidate_cache(
        self,
        pattern: str = None,
        query_type: str = None,
        dataset_id: str = None
    ):
        """
        Invalidate cache entries

        Args:
            pattern: Redis key pattern to match
            query_type: Invalidate all entries of specific query type
            dataset_id: Invalidate all entries for specific dataset
        """
        try:
            if pattern:
                # Use provided pattern
                search_pattern = pattern
            else:
                # Build pattern from parameters
                pattern_parts = ["bigquery_cache"]

                if dataset_id:
                    pattern_parts.append(dataset_id)
                else:
                    pattern_parts.append("*")

                if query_type:
                    pattern_parts.append(query_type)
                else:
                    pattern_parts.append("*")

                pattern_parts.append("*")
                search_pattern = ":".join(pattern_parts)

            # Find and delete matching keys
            keys = self.redis.keys(search_pattern)
            if keys:
                deleted_count = self.redis.delete(*keys)
                logger.info(f"Invalidated {deleted_count} cache entries (pattern: {search_pattern})")
            else:
                logger.info(f"No cache entries found to invalidate (pattern: {search_pattern})")

        except Exception as e:
            logger.error(f"Error invalidating cache: {e}")

    def get_cache_info(self) -> Dict[str, Any]:
        """
        Get comprehensive cache information

        Returns:
            Dictionary with cache statistics and configuration
        """
        try:
            metrics = self.get_metrics()

            # Get cache size (approximate)
            cache_keys = self.redis.keys("bigquery_cache:*")
            cache_size = len(cache_keys)

            # Get Redis memory info
            redis_info = self.redis.info("memory")

            return {
                "metrics": metrics.dict(),
                "cache_size": cache_size,
                "redis_memory_used": redis_info.get("used_memory_human", "unknown"),
                "default_ttl": self.default_ttl,
                "cache_prefix": self.cache_prefix,
                "bigquery_project": self.bq_client.project,
                "dataset_id": settings.BIGQUERY_DATASET_ID
            }

        except Exception as e:
            logger.error(f"Error getting cache info: {e}")
            return {"error": str(e)}


def get_query_ttl_by_type(query_type: str) -> int:
    """
    Get appropriate TTL based on query type

    Args:
        query_type: Type of query

    Returns:
        TTL in seconds
    """
    ttl_mapping = {
        "products": 1800,      # 30 minutes - products change frequently
        "orders": 300,         # 5 minutes - orders are time-sensitive
        "inventory": 180,      # 3 minutes - inventory changes rapidly
        "settlements": 3600,   # 1 hour - settlements are less frequent
        "returns": 600,        # 10 minutes - returns need moderate freshness
        "analytics": 1800,     # 30 minutes - analytics can be slightly stale
        "reports": 3600,       # 1 hour - reports can be cached longer
        "reference": 7200,     # 2 hours - reference data changes rarely
        "default": settings.CACHE_BIGQUERY_TTL
    }

    return ttl_mapping.get(query_type, ttl_mapping["default"])


# Convenience functions for common query types
def cache_product_query(
    cache: BigQueryCache,
    query: str,
    parameters: Dict[str, Any] = None
) -> List[Dict[str, Any]]:
    """Execute and cache product-related query"""
    return cache.execute_cached_query(
        query=query,
        query_type="products",
        parameters=parameters,
        ttl=get_query_ttl_by_type("products")
    )


def cache_order_query(
    cache: BigQueryCache,
    query: str,
    parameters: Dict[str, Any] = None
) -> List[Dict[str, Any]]:
    """Execute and cache order-related query"""
    return cache.execute_cached_query(
        query=query,
        query_type="orders",
        parameters=parameters,
        ttl=get_query_ttl_by_type("orders")
    )


def cache_analytics_query(
    cache: BigQueryCache,
    query: str,
    parameters: Dict[str, Any] = None
) -> List[Dict[str, Any]]:
    """Execute and cache analytics query"""
    return cache.execute_cached_query(
        query=query,
        query_type="analytics",
        parameters=parameters,
        ttl=get_query_ttl_by_type("analytics")
    )