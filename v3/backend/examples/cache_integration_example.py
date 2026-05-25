"""
Cache Integration Example

This example demonstrates how to integrate the caching system with existing
BigQuery operations and API endpoints for improved performance.
"""

import asyncio
from datetime import datetime, timedelta
from typing import Dict, List, Any

from backend.services.cache_service import (
    get_cache_service,
    cache_api_response,
    cache_bigquery_result,
    invalidate_related_cache
)
from backend.utils.bigquery_cache import cache_product_query, cache_order_query, cache_analytics_query


# Example 1: Caching BigQuery Results
def get_product_performance_data(vendor_id: str, days: int = 30) -> List[Dict[str, Any]]:
    """
    Get product performance data with BigQuery caching
    """
    cache_service = get_cache_service()

    # Define the query
    query = """
    SELECT
        p.product_id,
        p.display_product_name,
        COUNT(o.order_id) as order_count,
        SUM(o.total_price) as total_revenue,
        AVG(o.unit_price) as avg_price,
        MAX(o.ordered_at) as last_order_date
    FROM `{project}.{dataset}.coupang_products` p
    LEFT JOIN `{project}.{dataset}.coupang_orders` o
        ON p.product_id = o.product_id
    WHERE p.vendor_id = @vendor_id
        AND o.ordered_at >= @start_date
    GROUP BY p.product_id, p.display_product_name
    ORDER BY total_revenue DESC
    """.format(
        project=cache_service.bq_client.project,
        dataset="marblo_data"
    )

    # Parameters for the query
    parameters = {
        "vendor_id": vendor_id,
        "start_date": (datetime.now() - timedelta(days=days)).isoformat()
    }

    # Execute with caching (automatically cached for 30 minutes for analytics queries)
    return cache_service.execute_bigquery(
        query=query,
        query_type="analytics",
        parameters=parameters
    )


# Example 2: Using Decorator for API Response Caching
@cache_api_response(endpoint="dashboard/summary", ttl=300)  # Cache for 5 minutes
def get_dashboard_summary(vendor_id: str) -> Dict[str, Any]:
    """
    Get dashboard summary with API response caching
    """
    cache_service = get_cache_service()

    # Get various metrics using cached BigQuery queries
    # These will be cached individually based on their query types

    # Product count (cached for 30 minutes)
    product_count_query = """
    SELECT COUNT(*) as count
    FROM `{project}.{dataset}.coupang_products`
    WHERE vendor_id = @vendor_id AND status = 'APPROVED'
    """.format(
        project=cache_service.bq_client.project,
        dataset="marblo_data"
    )

    product_count = cache_service.execute_bigquery(
        query=product_count_query,
        query_type="products",
        parameters={"vendor_id": vendor_id}
    )

    # Recent orders (cached for 5 minutes)
    recent_orders_query = """
    SELECT COUNT(*) as count, SUM(total_price) as revenue
    FROM `{project}.{dataset}.coupang_orders`
    WHERE vendor_id = @vendor_id AND ordered_at >= @start_date
    """.format(
        project=cache_service.bq_client.project,
        dataset="marblo_data"
    )

    recent_orders = cache_service.execute_bigquery(
        query=recent_orders_query,
        query_type="orders",
        parameters={
            "vendor_id": vendor_id,
            "start_date": (datetime.now() - timedelta(days=7)).isoformat()
        }
    )

    # Low inventory alerts (cached for 3 minutes)
    low_inventory_query = """
    SELECT COUNT(*) as count
    FROM `{project}.{dataset}.coupang_inventory`
    WHERE vendor_id = @vendor_id AND available_quantity < 10
    """.format(
        project=cache_service.bq_client.project,
        dataset="marblo_data"
    )

    low_inventory = cache_service.execute_bigquery(
        query=low_inventory_query,
        query_type="inventory",
        parameters={"vendor_id": vendor_id}
    )

    return {
        "vendor_id": vendor_id,
        "total_products": product_count[0]["count"] if product_count else 0,
        "recent_orders": recent_orders[0]["count"] if recent_orders else 0,
        "recent_revenue": recent_orders[0]["revenue"] if recent_orders else 0,
        "low_inventory_alerts": low_inventory[0]["count"] if low_inventory else 0,
        "generated_at": datetime.now().isoformat()
    }


# Example 3: Cache Invalidation After Data Updates
@invalidate_related_cache(["products:*", "inventory:*"])
def update_product_inventory(vendor_item_id: str, quantity: int) -> Dict[str, Any]:
    """
    Update product inventory and invalidate related caches
    """
    # This would normally update the database/external API
    # The decorator will automatically invalidate related cache entries

    # Simulate inventory update
    updated_data = {
        "vendor_item_id": vendor_item_id,
        "new_quantity": quantity,
        "updated_at": datetime.now().isoformat()
    }

    return updated_data


# Example 4: Manual Cache Management
def manage_cache_manually():
    """
    Example of manual cache management operations
    """
    cache_service = get_cache_service()

    # Get cache statistics
    stats = cache_service.get_cache_stats()
    print(f"Cache hit rate: {stats.bigquery_metrics.get('metrics', {}).get('hit_rate', 0)}%")
    print(f"Total cache entries: {stats.total_cache_entries}")

    # Invalidate specific cache types
    cache_service.invalidate_bigquery_cache(query_type="products")
    cache_service.invalidate_api_cache(pattern="dashboard/*")

    # Clear all cache entries
    # cache_service.clear_all()  # Uncomment to clear everything


# Example 5: Using Convenience Functions
def get_cached_product_data(vendor_id: str) -> List[Dict[str, Any]]:
    """
    Example using convenience functions for common query types
    """
    cache_service = get_cache_service()

    # Product query with automatic product-specific caching
    product_query = """
    SELECT * FROM `{project}.{dataset}.coupang_products`
    WHERE vendor_id = @vendor_id AND status = 'APPROVED'
    ORDER BY created_at DESC
    LIMIT 100
    """.format(
        project=cache_service.bq_client.project,
        dataset="marblo_data"
    )

    # This will automatically use the "products" query type with appropriate TTL
    return cache_product_query(
        cache=cache_service.bigquery_cache,
        query=product_query,
        parameters={"vendor_id": vendor_id}
    )


def get_cached_order_analytics(vendor_id: str, start_date: str, end_date: str) -> List[Dict[str, Any]]:
    """
    Example of cached order analytics
    """
    cache_service = get_cache_service()

    analytics_query = """
    SELECT
        DATE(ordered_at) as order_date,
        COUNT(*) as order_count,
        SUM(total_price) as daily_revenue,
        COUNT(DISTINCT buyer_name) as unique_customers
    FROM `{project}.{dataset}.coupang_orders`
    WHERE vendor_id = @vendor_id
        AND ordered_at BETWEEN @start_date AND @end_date
    GROUP BY DATE(ordered_at)
    ORDER BY order_date DESC
    """.format(
        project=cache_service.bq_client.project,
        dataset="marblo_data"
    )

    # This will use analytics TTL (30 minutes)
    return cache_analytics_query(
        cache=cache_service.bigquery_cache,
        query=analytics_query,
        parameters={
            "vendor_id": vendor_id,
            "start_date": start_date,
            "end_date": end_date
        }
    )


# Example 6: FastAPI Integration
from fastapi import APIRouter, HTTPException, Depends

# This would be in your actual API module
cache_example_router = APIRouter(prefix="/api/v1/cached", tags=["Cached Endpoints"])


@cache_example_router.get("/dashboard/{vendor_id}")
async def get_cached_dashboard(vendor_id: str):
    """
    FastAPI endpoint using cached dashboard data
    """
    try:
        # This will automatically use caching due to the decorator
        dashboard_data = get_dashboard_summary(vendor_id)
        return dashboard_data

    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to get dashboard data: {str(e)}")


@cache_example_router.get("/products/{vendor_id}/performance")
async def get_cached_product_performance(vendor_id: str, days: int = 30):
    """
    FastAPI endpoint for cached product performance data
    """
    try:
        performance_data = get_product_performance_data(vendor_id, days)
        return {
            "vendor_id": vendor_id,
            "period_days": days,
            "products": performance_data,
            "cache_info": "Data may be cached up to 30 minutes"
        }

    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to get performance data: {str(e)}")


@cache_example_router.post("/inventory/{vendor_item_id}")
async def update_cached_inventory(vendor_item_id: str, quantity: int):
    """
    FastAPI endpoint that updates inventory and invalidates cache
    """
    try:
        # This will invalidate related cache entries
        result = update_product_inventory(vendor_item_id, quantity)
        return result

    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to update inventory: {str(e)}")


# Example 7: Batch Operations with Cache Warming
async def warm_cache_for_vendor(vendor_id: str):
    """
    Warm up cache with commonly accessed data for a vendor
    """
    cache_service = get_cache_service()

    # Warm up dashboard data
    dashboard_task = asyncio.create_task(
        asyncio.to_thread(get_dashboard_summary, vendor_id)
    )

    # Warm up product performance data
    performance_task = asyncio.create_task(
        asyncio.to_thread(get_product_performance_data, vendor_id)
    )

    # Warm up product data
    products_task = asyncio.create_task(
        asyncio.to_thread(get_cached_product_data, vendor_id)
    )

    # Wait for all tasks to complete
    await asyncio.gather(dashboard_task, performance_task, products_task)

    print(f"Cache warmed for vendor {vendor_id}")


# Example 8: Cache Health Monitoring
def monitor_cache_health():
    """
    Monitor cache health and performance
    """
    cache_service = get_cache_service()

    # Get health check
    health = cache_service.health_check()
    print(f"Cache Status: {health['status']}")
    print(f"Redis Connected: {health['redis_connected']}")
    print(f"BigQuery Status: {health['bigquery_status']}")

    # Get detailed metrics
    if health['status'] == 'healthy':
        stats = health['cache_stats']
        bq_metrics = stats.get('bigquery_metrics', {}).get('metrics', {})

        print(f"\nBigQuery Cache Metrics:")
        print(f"  Hit Rate: {bq_metrics.get('hit_rate', 0):.2f}%")
        print(f"  Total Queries: {bq_metrics.get('total_queries', 0)}")
        print(f"  Cache Hits: {bq_metrics.get('hits', 0)}")
        print(f"  Cache Misses: {bq_metrics.get('misses', 0)}")

        print(f"\nGeneral Cache Info:")
        print(f"  API Cache Size: {stats.get('api_cache_size', 0)}")
        print(f"  Total Cache Entries: {stats.get('total_cache_entries', 0)}")
        print(f"  Redis Memory Usage: {stats.get('redis_memory_usage', 'unknown')}")


if __name__ == "__main__":
    # Example usage
    print("Cache Integration Examples")
    print("=========================")

    # Example vendor ID
    example_vendor_id = "V123456789"

    try:
        # Monitor cache health
        print("\n1. Cache Health Check:")
        monitor_cache_health()

        # Get dashboard data (will be cached)
        print("\n2. Getting Dashboard Data:")
        dashboard = get_dashboard_summary(example_vendor_id)
        print(f"Dashboard generated at: {dashboard['generated_at']}")

        # Get product performance (will be cached)
        print("\n3. Getting Product Performance:")
        performance = get_product_performance_data(example_vendor_id, 30)
        print(f"Found {len(performance)} products with performance data")

        # Demonstrate cache invalidation
        print("\n4. Updating Inventory (will invalidate cache):")
        update_result = update_product_inventory("ITEM123", 50)
        print(f"Updated inventory: {update_result}")

        # Warm cache
        print("\n5. Warming Cache:")
        asyncio.run(warm_cache_for_vendor(example_vendor_id))

    except Exception as e:
        print(f"Error running examples: {e}")
        print("Make sure Redis and BigQuery are properly configured")