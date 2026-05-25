"""
Test cases for cache service functionality
"""

import json
import pytest
from unittest.mock import Mock, patch, MagicMock
from datetime import datetime, timedelta

import redis
from google.cloud import bigquery

from backend.services.cache_service import CacheService, get_cache_service, APICache
from backend.utils.bigquery_cache import BigQueryCache, QueryCacheKey, get_query_ttl_by_type


class TestAPICache:
    """Test cases for API cache functionality"""

    def setup_method(self):
        """Setup test fixtures"""
        self.redis_mock = Mock(spec=redis.Redis)
        self.api_cache = APICache(self.redis_mock)

    def test_make_cache_key_basic(self):
        """Test basic cache key generation"""
        key = self.api_cache._make_cache_key("products/list")
        assert key == "marblo_api_cache:products/list"

    def test_make_cache_key_with_params(self):
        """Test cache key generation with parameters"""
        params = {"page": 1, "limit": 10, "sort": "name"}
        key = self.api_cache._make_cache_key("products/list", params)

        # Should include sorted parameters
        assert key.startswith("marblo_api_cache:products/list:")
        assert "limit=10" in key
        assert "page=1" in key
        assert "sort=name" in key

    def test_get_cache_hit(self):
        """Test cache hit scenario"""
        test_data = {"data": [{"id": 1, "name": "test"}], "cached_at": "2024-01-01T00:00:00"}
        self.redis_mock.get.return_value = json.dumps(test_data)

        result = self.api_cache.get("products/list")

        assert result == test_data
        self.redis_mock.get.assert_called_once()

    def test_get_cache_miss(self):
        """Test cache miss scenario"""
        self.redis_mock.get.return_value = None

        result = self.api_cache.get("products/list")

        assert result is None
        self.redis_mock.get.assert_called_once()

    def test_set_cache(self):
        """Test setting cache data"""
        test_data = {"products": [{"id": 1, "name": "test"}]}

        self.api_cache.set("products/list", test_data, ttl=300)

        self.redis_mock.setex.assert_called_once()
        args = self.redis_mock.setex.call_args
        assert args[0][0] == "marblo_api_cache:products/list"
        assert args[0][1] == 300  # TTL

        # Check cached data structure
        cached_data = json.loads(args[0][2])
        assert cached_data["data"] == test_data
        assert cached_data["endpoint"] == "products/list"

    def test_delete_cache(self):
        """Test deleting cached data"""
        self.api_cache.delete("products/list")

        self.redis_mock.delete.assert_called_once_with("marblo_api_cache:products/list")

    def test_clear_pattern(self):
        """Test clearing cache by pattern"""
        self.redis_mock.keys.return_value = [
            "marblo_api_cache:products/list",
            "marblo_api_cache:products/detail"
        ]

        self.api_cache.clear_pattern("products/*")

        self.redis_mock.keys.assert_called_once_with("marblo_api_cache:products/*")
        self.redis_mock.delete.assert_called_once()


class TestBigQueryCache:
    """Test cases for BigQuery cache functionality"""

    def setup_method(self):
        """Setup test fixtures"""
        self.redis_mock = Mock(spec=redis.Redis)
        self.bq_mock = Mock(spec=bigquery.Client)
        self.bq_cache = BigQueryCache(self.redis_mock, self.bq_mock)

    def test_generate_query_hash(self):
        """Test query hash generation"""
        query1 = "SELECT * FROM products WHERE status = 'active'"
        query2 = "SELECT   *   FROM   products   WHERE   status = 'active'"  # Different whitespace

        hash1 = self.bq_cache._generate_query_hash(query1)
        hash2 = self.bq_cache._generate_query_hash(query2)

        # Hashes should be identical despite whitespace differences
        assert hash1 == hash2
        assert len(hash1) == 16  # Truncated hash length

    def test_cache_key_generation(self):
        """Test cache key generation for queries"""
        query = "SELECT * FROM products"
        cache_key = self.bq_cache._get_cache_key(query, "products", "test_dataset")

        assert isinstance(cache_key, QueryCacheKey)
        assert cache_key.dataset_id == "test_dataset"
        assert cache_key.query_type == "products"
        assert cache_key.query_hash is not None

    def test_cache_key_to_redis_key(self):
        """Test Redis key generation from cache key"""
        cache_key = QueryCacheKey(
            query_hash="abc123",
            dataset_id="test_dataset",
            query_type="products"
        )

        redis_key = cache_key.to_redis_key()
        expected = "bigquery_cache:test_dataset:products:abc123"

        assert redis_key == expected

    def test_cache_key_with_parameters(self):
        """Test cache key generation with parameters"""
        params = {"vendor_id": "123", "status": "active"}
        cache_key = QueryCacheKey(
            query_hash="abc123",
            dataset_id="test_dataset",
            query_type="products",
            parameters=params
        )

        redis_key = cache_key.to_redis_key()

        # Should include parameter hash
        assert redis_key.startswith("bigquery_cache:test_dataset:products:abc123:")
        assert len(redis_key.split(":")) == 5  # Additional parameter hash part

    def test_get_cached_result_hit(self):
        """Test getting cached query result - cache hit"""
        cached_data = {
            "result": [{"id": 1, "name": "test"}],
            "cached_at": "2024-01-01T00:00:00"
        }
        self.redis_mock.get.return_value = json.dumps(cached_data)

        result = self.bq_cache.get_cached_result("SELECT * FROM products", "products")

        assert result == cached_data["result"]

    def test_get_cached_result_miss(self):
        """Test getting cached query result - cache miss"""
        self.redis_mock.get.return_value = None

        result = self.bq_cache.get_cached_result("SELECT * FROM products", "products")

        assert result is None

    def test_cache_result(self):
        """Test caching query result"""
        query = "SELECT * FROM products"
        result = [{"id": 1, "name": "test"}]

        self.bq_cache.cache_result(query, result, "products", ttl=300)

        self.redis_mock.setex.assert_called_once()
        args = self.redis_mock.setex.call_args

        # Check cached data structure
        cached_data = json.loads(args[0][2])
        assert cached_data["result"] == result
        assert cached_data["query_type"] == "products"
        assert cached_data["ttl"] == 300

    @patch('backend.utils.bigquery_cache.logger')
    def test_execute_cached_query_cache_hit(self, mock_logger):
        """Test executing query with cache hit"""
        cached_data = {
            "result": [{"id": 1, "name": "test"}],
            "cached_at": "2024-01-01T00:00:00"
        }
        self.redis_mock.get.return_value = json.dumps(cached_data)

        result = self.bq_cache.execute_cached_query("SELECT * FROM products", "products")

        assert result == cached_data["result"]
        # Should not execute BigQuery
        assert not self.bq_mock.query.called

    @patch('backend.utils.bigquery_cache.logger')
    def test_execute_cached_query_cache_miss(self, mock_logger):
        """Test executing query with cache miss"""
        # Setup cache miss
        self.redis_mock.get.return_value = None

        # Setup BigQuery response
        mock_job = Mock()
        mock_results = Mock()
        mock_results.__iter__ = Mock(return_value=iter([{"id": 1, "name": "test"}]))
        mock_job.result.return_value = mock_results
        self.bq_mock.query.return_value = mock_job

        result = self.bq_cache.execute_cached_query("SELECT * FROM products", "products")

        assert result == [{"id": 1, "name": "test"}]
        # Should execute BigQuery
        self.bq_mock.query.assert_called_once()
        # Should cache the result
        self.redis_mock.setex.assert_called_once()

    def test_invalidate_cache_by_pattern(self):
        """Test cache invalidation by pattern"""
        self.redis_mock.keys.return_value = [
            "bigquery_cache:dataset:products:hash1",
            "bigquery_cache:dataset:products:hash2"
        ]

        self.bq_cache.invalidate_cache(query_type="products")

        self.redis_mock.keys.assert_called_once()
        self.redis_mock.delete.assert_called_once()

    def test_get_metrics(self):
        """Test getting cache metrics"""
        metrics_data = {
            b"hits": b"50",
            b"misses": b"25",
            b"total_queries": b"75"
        }
        self.redis_mock.hgetall.return_value = metrics_data

        metrics = self.bq_cache.get_metrics()

        assert metrics.hits == 50
        assert metrics.misses == 25
        assert metrics.total_queries == 75
        assert metrics.hit_rate == 66.67  # 50/75 * 100

    def test_update_metrics_hit(self):
        """Test updating metrics on cache hit"""
        pipe_mock = Mock()
        self.redis_mock.pipeline.return_value = pipe_mock

        self.bq_cache._update_metrics(hit=True)

        pipe_mock.hincrby.assert_any_call(self.bq_cache.metrics_key, "hits", 1)
        pipe_mock.hincrby.assert_any_call(self.bq_cache.metrics_key, "total_queries", 1)
        pipe_mock.execute.assert_called_once()

    def test_update_metrics_miss(self):
        """Test updating metrics on cache miss"""
        pipe_mock = Mock()
        self.redis_mock.pipeline.return_value = pipe_mock

        self.bq_cache._update_metrics(hit=False)

        pipe_mock.hincrby.assert_any_call(self.bq_cache.metrics_key, "misses", 1)
        pipe_mock.hincrby.assert_any_call(self.bq_cache.metrics_key, "total_queries", 1)
        pipe_mock.execute.assert_called_once()


class TestCacheService:
    """Test cases for main cache service"""

    @patch('backend.services.cache_service.redis.from_url')
    @patch('backend.services.cache_service.bigquery.Client')
    def test_cache_service_initialization(self, mock_bq_client, mock_redis):
        """Test cache service initialization"""
        mock_redis_instance = Mock()
        mock_redis.return_value = mock_redis_instance
        mock_redis_instance.ping.return_value = True

        mock_bq_instance = Mock()
        mock_bq_client.return_value = mock_bq_instance

        cache_service = CacheService()

        assert cache_service.redis == mock_redis_instance
        assert cache_service.bq_client == mock_bq_instance
        assert cache_service.bigquery_cache is not None
        assert cache_service.api_cache is not None

    @patch('backend.services.cache_service.redis.from_url')
    def test_cache_service_without_bigquery(self, mock_redis):
        """Test cache service initialization without BigQuery"""
        mock_redis_instance = Mock()
        mock_redis.return_value = mock_redis_instance
        mock_redis_instance.ping.return_value = True

        with patch('backend.services.cache_service.bigquery.Client', side_effect=Exception("No credentials")):
            cache_service = CacheService()

            assert cache_service.redis == mock_redis_instance
            assert cache_service.bq_client is None
            assert cache_service.bigquery_cache is None

    def test_get_cache_service_singleton(self):
        """Test that get_cache_service returns singleton instance"""
        # Clear any existing instance
        import backend.services.cache_service
        backend.services.cache_service._cache_service_instance = None

        with patch.object(CacheService, '__init__', return_value=None) as mock_init:
            service1 = get_cache_service()
            service2 = get_cache_service()

            assert service1 is service2
            mock_init.assert_called_once()


class TestQueryTTLConfiguration:
    """Test cases for query TTL configuration"""

    def test_query_ttl_mapping(self):
        """Test TTL mapping for different query types"""
        # Test known query types
        assert get_query_ttl_by_type("products") == 1800
        assert get_query_ttl_by_type("orders") == 300
        assert get_query_ttl_by_type("inventory") == 180
        assert get_query_ttl_by_type("settlements") == 3600
        assert get_query_ttl_by_type("returns") == 600
        assert get_query_ttl_by_type("analytics") == 1800
        assert get_query_ttl_by_type("reports") == 3600
        assert get_query_ttl_by_type("reference") == 7200

    def test_unknown_query_type_returns_default(self):
        """Test that unknown query types return default TTL"""
        from backend.core.config import settings

        unknown_ttl = get_query_ttl_by_type("unknown_type")
        assert unknown_ttl == settings.CACHE_BIGQUERY_TTL


class TestCacheDecorators:
    """Test cases for caching decorators"""

    @patch('backend.services.cache_service.get_cache_service')
    def test_cache_api_response_decorator_hit(self, mock_get_service):
        """Test API response caching decorator - cache hit"""
        mock_service = Mock()
        mock_get_service.return_value = mock_service
        mock_service.get_api_response.return_value = {"data": {"cached": True}}

        from backend.services.cache_service import cache_api_response

        @cache_api_response("test_endpoint")
        def test_function(param1, param2):
            return {"computed": True}

        result = test_function("value1", param2="value2")

        assert result == {"cached": True}
        mock_service.get_api_response.assert_called_once_with("test_endpoint", {"param2": "value2"})

    @patch('backend.services.cache_service.get_cache_service')
    def test_cache_api_response_decorator_miss(self, mock_get_service):
        """Test API response caching decorator - cache miss"""
        mock_service = Mock()
        mock_get_service.return_value = mock_service
        mock_service.get_api_response.return_value = None

        from backend.services.cache_service import cache_api_response

        @cache_api_response("test_endpoint")
        def test_function(param1, param2):
            return {"computed": True}

        result = test_function("value1", param2="value2")

        assert result == {"computed": True}
        mock_service.cache_api_response.assert_called_once_with(
            "test_endpoint", {"computed": True}, {"param2": "value2"}, None
        )


# Integration test fixtures
@pytest.fixture
def redis_client():
    """Redis client fixture for integration tests"""
    try:
        client = redis.Redis(host='localhost', port=6379, db=15)  # Use test DB
        client.ping()
        yield client
        client.flushdb()  # Clean up after test
    except redis.ConnectionError:
        pytest.skip("Redis not available for integration tests")


@pytest.fixture
def bigquery_client():
    """BigQuery client fixture for integration tests"""
    try:
        client = bigquery.Client()
        yield client
    except Exception:
        pytest.skip("BigQuery not available for integration tests")


class TestCacheIntegration:
    """Integration tests with real Redis and BigQuery"""

    def test_api_cache_integration(self, redis_client):
        """Test API cache with real Redis"""
        api_cache = APICache(redis_client)

        # Test set and get
        test_data = {"products": [{"id": 1, "name": "test"}]}
        api_cache.set("products/list", test_data, ttl=60)

        result = api_cache.get("products/list")
        assert result["data"] == test_data

        # Test expiration (would need to wait or mock time)
        # For now, just test that the key exists
        assert redis_client.exists("marblo_api_cache:products/list")

    def test_cache_service_health_check(self, redis_client):
        """Test cache service health check with real Redis"""
        with patch('backend.services.cache_service.redis.from_url', return_value=redis_client):
            cache_service = CacheService()
            health = cache_service.health_check()

            assert health["status"] == "healthy"
            assert health["redis_connected"] is True