import logging
import os
from datetime import datetime, timedelta
from typing import Any, Dict, List, Optional

from google.cloud import bigquery
from google.cloud.exceptions import NotFound

from backend.bigquery_schemas.smartstore_tables import (
    create_smartstore_tables,
    SMARTSTORE_INQUIRIES_SCHEMA,
    SMARTSTORE_INVENTORY_SCHEMA,
    SMARTSTORE_ORDERS_SCHEMA,
    SMARTSTORE_PRODUCTS_SCHEMA,
    SMARTSTORE_RETURNS_SCHEMA,
    SMARTSTORE_REVIEWS_SCHEMA,
    SMARTSTORE_SALES_STATS_SCHEMA,
    SMARTSTORE_SETTLEMENTS_SCHEMA,
)
from backend.naver_smartstore import NaverCommerceAPI, NaverCommerceConfig

logger = logging.getLogger(__name__)


class SmartStoreDataSync:
    """네이버 스마트스토어 데이터 동기화 파이프라인"""

    def __init__(
        self,
        commerce_config: NaverCommerceConfig,
        bigquery_client: bigquery.Client,
        dataset_id: str = "smartstore_data"
    ):
        self.api = NaverCommerceAPI(commerce_config)
        self.bq_client = bigquery_client
        self.dataset_id = dataset_id
        self.channel_id = commerce_config.channel_id

        # 데이터셋 및 테이블 초기화
        self._initialize_bigquery()

    def _initialize_bigquery(self):
        """BigQuery 데이터셋 및 테이블 초기화"""
        try:
            dataset = self.bq_client.get_dataset(self.dataset_id)
            logger.info(f"Using existing dataset: {self.dataset_id}")
        except NotFound:
            dataset = bigquery.Dataset(f"{self.bq_client.project}.{self.dataset_id}")
            dataset.location = "asia-northeast3"  # Seoul region
            dataset = self.bq_client.create_dataset(dataset)
            logger.info(f"Created dataset: {self.dataset_id}")

        # 테이블 생성 (존재하지 않는 경우)
        create_smartstore_tables(self.bq_client, self.dataset_id)

    def _insert_to_bigquery(self, table_name: str, rows: List[Dict[str, Any]]):
        """BigQuery에 데이터 삽입"""
        if not rows:
            logger.info(f"No data to insert into {table_name}")
            return

        table_id = f"{self.bq_client.project}.{self.dataset_id}.{table_name}"
        table = self.bq_client.get_table(table_id)

        errors = self.bq_client.insert_rows_json(table, rows)
        if errors:
            logger.error(f"Failed to insert rows into {table_name}: {errors}")
            raise Exception(f"BigQuery insert failed: {errors}")
        else:
            logger.info(f"Inserted {len(rows)} rows into {table_name}")

    def sync_products(self, full_sync: bool = False) -> Dict[str, Any]:
        """상품 데이터 동기화"""
        logger.info("Starting product sync...")
        synced_at = datetime.utcnow()
        products_synced = 0
        page = 1
        page_size = 100

        try:
            while True:
                # 상품 목록 조회
                response = self.api.get_products(
                    page=page,
                    size=page_size,
                    status="SALE" if not full_sync else None
                )

                products = response.get("contents", [])
                if not products:
                    break

                product_rows = []
                for product in products:
                    # 상품 상세 정보 조회
                    try:
                        detail = self.api.get_product(product["originProductNo"])
                    except Exception as e:
                        logger.warning(f"Failed to get product detail: {e}")
                        detail = product

                    product_row = {
                        "product_id": product.get("originProductNo"),
                        "channel_product_id": product.get("channelProductNo"),
                        "channel_id": self.channel_id,
                        "name": product.get("name"),
                        "sale_price": product.get("salePrice", 0),
                        "discount_price": product.get("discountedPrice"),
                        "mobile_discount_price": product.get("mobileDiscountedPrice"),
                        "cost_price": product.get("costPrice"),
                        "stock_quantity": product.get("stockQuantity", 0),
                        "status": product.get("statusType", ""),
                        "status_type": product.get("statusType"),
                        "category_id": product.get("categoryId", ""),
                        "category_name": product.get("categoryName"),
                        "brand": product.get("brand"),
                        "manufacturer": product.get("manufacturer"),
                        "origin": product.get("origin"),
                        "images": product.get("images", []),
                        "detail_content": detail.get("detailContent"),
                        "delivery_fee_type": product.get("deliveryFeeType", ""),
                        "delivery_fee": product.get("baseFee"),
                        "delivery_method": product.get("deliveryMethodType", "DELIVERY"),
                        "sale_start_date": product.get("saleStartDate"),
                        "sale_end_date": product.get("saleEndDate"),
                        "attributes": detail.get("detailAttribute"),
                        "created_at": product.get("createdAt", synced_at.isoformat()),
                        "updated_at": product.get("modifiedAt", synced_at.isoformat()),
                        "synced_at": synced_at.isoformat(),
                    }
                    product_rows.append(product_row)

                # BigQuery에 삽입
                self._insert_to_bigquery("smartstore_products", product_rows)
                products_synced += len(product_rows)

                # 다음 페이지 확인
                total_pages = response.get("totalPages", 1)
                if page >= total_pages:
                    break
                page += 1

            logger.info(f"Product sync completed: {products_synced} products")
            return {
                "products_synced": products_synced,
                "synced_at": synced_at.isoformat()
            }

        except Exception as e:
            logger.error(f"Product sync failed: {str(e)}")
            raise

    def sync_orders(
        self,
        start_date: Optional[datetime] = None,
        end_date: Optional[datetime] = None
    ) -> Dict[str, Any]:
        """주문 데이터 동기화"""
        logger.info("Starting order sync...")
        synced_at = datetime.utcnow()

        if not start_date:
            start_date = datetime.utcnow() - timedelta(days=7)
        if not end_date:
            end_date = datetime.utcnow()

        orders_synced = 0
        page = 1
        page_size = 100

        try:
            while True:
                # 주문 목록 조회
                response = self.api.get_orders(
                    start_date=start_date,
                    end_date=end_date,
                    page=page,
                    size=page_size
                )

                orders = response.get("contents", [])
                if not orders:
                    break

                order_rows = []
                for order in orders:
                    # 주문 상세 조회
                    try:
                        detail = self.api.get_order_detail(order["productOrderId"])
                    except Exception as e:
                        logger.warning(f"Failed to get order detail: {e}")
                        detail = order

                    shipping = detail.get("shippingAddress", {})

                    order_row = {
                        "order_id": order.get("productOrderId"),
                        "channel_id": self.channel_id,
                        "order_date": order.get("orderDate"),
                        "product_id": order.get("productId", ""),
                        "product_name": order.get("productName", ""),
                        "option_code": order.get("productOptionCode"),
                        "option_name": order.get("productOption"),
                        "quantity": order.get("quantity", 0),
                        "unit_price": order.get("unitPrice", 0),
                        "option_price": order.get("optionPrice", 0),
                        "discount_amount": order.get("productDiscountAmount", 0),
                        "total_payment_amount": order.get("totalPaymentAmount", 0),
                        "delivery_fee": order.get("deliveryFeeAmount", 0),
                        "order_status": order.get("productOrderStatus", ""),
                        "claim_status": order.get("claimStatus"),
                        "claim_type": order.get("claimType"),
                        "orderer_name": order.get("ordererName", ""),
                        "orderer_tel": order.get("ordererTel"),
                        "orderer_mobile": order.get("ordererTel1", ""),
                        "orderer_email": order.get("ordererEmail"),
                        "receiver_name": shipping.get("name", ""),
                        "receiver_tel": shipping.get("tel"),
                        "receiver_mobile": shipping.get("tel1", ""),
                        "receiver_zipcode": shipping.get("zipCode", ""),
                        "receiver_address": shipping.get("baseAddress", ""),
                        "receiver_detail_address": shipping.get("detailAddress"),
                        "delivery_message": order.get("shippingMemo"),
                        "delivery_company": order.get("deliveryCompany"),
                        "invoice_number": order.get("trackingNumber"),
                        "dispatched_date": order.get("dispatchDate"),
                        "delivered_date": order.get("deliveredDate"),
                        "purchase_confirmed_date": order.get("purchaseConfirmDate"),
                        "payment_method": order.get("paymentMethod"),
                        "payment_date": order.get("paymentDate"),
                        "created_at": synced_at.isoformat(),
                        "updated_at": synced_at.isoformat(),
                        "synced_at": synced_at.isoformat(),
                    }
                    order_rows.append(order_row)

                # BigQuery에 삽입
                self._insert_to_bigquery("smartstore_orders", order_rows)
                orders_synced += len(order_rows)

                # 다음 페이지 확인
                total_pages = response.get("totalPages", 1)
                if page >= total_pages:
                    break
                page += 1

            logger.info(f"Order sync completed: {orders_synced} orders")
            return {
                "orders_synced": orders_synced,
                "synced_at": synced_at.isoformat()
            }

        except Exception as e:
            logger.error(f"Order sync failed: {str(e)}")
            raise

    def sync_settlements(
        self,
        start_date: Optional[datetime] = None,
        end_date: Optional[datetime] = None
    ) -> Dict[str, Any]:
        """정산 데이터 동기화"""
        logger.info("Starting settlement sync...")
        synced_at = datetime.utcnow()

        if not start_date:
            start_date = datetime.utcnow() - timedelta(days=30)
        if not end_date:
            end_date = datetime.utcnow()

        settlements_synced = 0
        page = 1
        page_size = 100

        try:
            while True:
                # 정산 내역 조회
                response = self.api.get_settlements(
                    start_date=start_date,
                    end_date=end_date,
                    page=page,
                    size=page_size
                )

                settlements = response.get("contents", [])
                if not settlements:
                    break

                settlement_rows = []
                for settlement in settlements:
                    settlement_row = {
                        "settlement_id": f"{settlement.get('settleDate')}_{settlement.get('productOrderId')}",
                        "channel_id": self.channel_id,
                        "settlement_date": settlement.get("settleDate"),
                        "order_id": settlement.get("productOrderId"),
                        "product_id": settlement.get("productId", ""),
                        "product_name": settlement.get("productName", ""),
                        "option_name": settlement.get("productOption"),
                        "quantity": settlement.get("quantity", 0),
                        "order_amount": settlement.get("orderAmount", 0),
                        "discount_amount": settlement.get("productDiscountAmount", 0),
                        "naver_discount_amount": settlement.get("naverDiscountAmount", 0),
                        "seller_discount_amount": settlement.get("sellerDiscountAmount", 0),
                        "delivery_fee": settlement.get("deliveryFeeAmount", 0),
                        "commission_rate": settlement.get("commissionRate", 0),
                        "commission_amount": settlement.get("commissionAmount", 0),
                        "service_fee_amount": settlement.get("serviceFeeAmount", 0),
                        "billing_amount": settlement.get("billingAmount", 0),
                        "settlement_amount": settlement.get("settleAmount", 0),
                        "vat_amount": settlement.get("vatAmount", 0),
                        "settlement_status": settlement.get("settleStatus", ""),
                        "purchase_confirm_date": settlement.get("purchaseConfirmDate"),
                        "settlement_start_date": settlement.get("settleStartDate"),
                        "settlement_end_date": settlement.get("settleEndDate"),
                        "payment_date": settlement.get("paymentDueDate"),
                        "created_at": synced_at.isoformat(),
                        "updated_at": synced_at.isoformat(),
                        "synced_at": synced_at.isoformat(),
                    }
                    settlement_rows.append(settlement_row)

                # BigQuery에 삽입
                self._insert_to_bigquery("smartstore_settlements", settlement_rows)
                settlements_synced += len(settlement_rows)

                # 다음 페이지 확인
                total_pages = response.get("totalPages", 1)
                if page >= total_pages:
                    break
                page += 1

            logger.info(f"Settlement sync completed: {settlements_synced} settlements")
            return {
                "settlements_synced": settlements_synced,
                "synced_at": synced_at.isoformat()
            }

        except Exception as e:
            logger.error(f"Settlement sync failed: {str(e)}")
            raise

    def sync_sales_statistics(
        self,
        start_date: Optional[datetime] = None,
        end_date: Optional[datetime] = None,
        interval: str = "DAILY"
    ) -> Dict[str, Any]:
        """매출 통계 동기화"""
        logger.info("Starting sales statistics sync...")
        synced_at = datetime.utcnow()

        if not start_date:
            start_date = datetime.utcnow() - timedelta(days=30)
        if not end_date:
            end_date = datetime.utcnow()

        try:
            # 매출 통계 조회
            response = self.api.get_sales_statistics(
                start_date=start_date,
                end_date=end_date,
                interval=interval
            )

            stats = response.get("statistics", [])
            stat_rows = []

            for stat in stats:
                stat_row = {
                    "stat_date": stat.get("date"),
                    "channel_id": self.channel_id,
                    "interval_type": interval,
                    "order_count": stat.get("orderCount", 0),
                    "order_amount": stat.get("orderAmount", 0),
                    "payment_count": stat.get("paymentCount", 0),
                    "payment_amount": stat.get("paymentAmount", 0),
                    "refund_count": stat.get("refundCount", 0),
                    "refund_amount": stat.get("refundAmount", 0),
                    "net_sales_amount": stat.get("netSalesAmount", 0),
                    "visitor_count": stat.get("visitorCount"),
                    "page_view_count": stat.get("pageViewCount"),
                    "conversion_rate": stat.get("conversionRate"),
                    "average_order_value": stat.get("averageOrderValue"),
                    "created_at": synced_at.isoformat(),
                    "synced_at": synced_at.isoformat(),
                }
                stat_rows.append(stat_row)

            # BigQuery에 삽입
            self._insert_to_bigquery("smartstore_sales_stats", stat_rows)

            logger.info(f"Sales statistics sync completed: {len(stat_rows)} records")
            return {
                "stats_synced": len(stat_rows),
                "synced_at": synced_at.isoformat()
            }

        except Exception as e:
            logger.error(f"Sales statistics sync failed: {str(e)}")
            raise

    def sync_inventory(self, product_ids: Optional[List[str]] = None) -> Dict[str, Any]:
        """재고 데이터 동기화"""
        logger.info("Starting inventory sync...")
        synced_at = datetime.utcnow()
        inventory_synced = 0

        try:
            # product_ids가 없으면 모든 활성 상품 조회
            if not product_ids:
                product_ids = []
                page = 1

                while True:
                    response = self.api.get_products(
                        page=page,
                        size=100,
                        status="SALE"
                    )

                    products = response.get("contents", [])
                    if not products:
                        break

                    for product in products:
                        product_ids.append(product["originProductNo"])

                    total_pages = response.get("totalPages", 1)
                    if page >= total_pages:
                        break
                    page += 1

            # 각 상품의 재고 조회
            inventory_rows = []
            for product_id in product_ids:
                try:
                    inventory = self.api.get_inventory(product_id)

                    # 옵션별 재고 처리
                    options = inventory.get("options", [])
                    if options:
                        for option in options:
                            inventory_row = {
                                "product_id": product_id,
                                "channel_id": self.channel_id,
                                "option_id": option.get("optionId"),
                                "option_name": option.get("optionName"),
                                "available_quantity": option.get("availableQuantity", 0),
                                "onhand_quantity": option.get("onhandQuantity", 0),
                                "reserved_quantity": option.get("reservedQuantity", 0),
                                "safety_stock_quantity": option.get("safetyStockQuantity", 0),
                                "incoming_quantity": option.get("incomingQuantity", 0),
                                "last_updated_at": inventory.get("lastUpdatedAt", synced_at.isoformat()),
                                "created_at": synced_at.isoformat(),
                                "synced_at": synced_at.isoformat(),
                            }
                            inventory_rows.append(inventory_row)
                    else:
                        # 옵션이 없는 상품
                        inventory_row = {
                            "product_id": product_id,
                            "channel_id": self.channel_id,
                            "option_id": None,
                            "option_name": None,
                            "available_quantity": inventory.get("availableQuantity", 0),
                            "onhand_quantity": inventory.get("onhandQuantity", 0),
                            "reserved_quantity": inventory.get("reservedQuantity", 0),
                            "safety_stock_quantity": inventory.get("safetyStockQuantity", 0),
                            "incoming_quantity": inventory.get("incomingQuantity", 0),
                            "last_updated_at": inventory.get("lastUpdatedAt", synced_at.isoformat()),
                            "created_at": synced_at.isoformat(),
                            "synced_at": synced_at.isoformat(),
                        }
                        inventory_rows.append(inventory_row)

                except Exception as e:
                    logger.warning(f"Failed to get inventory for {product_id}: {str(e)}")
                    continue

            # BigQuery에 삽입
            if inventory_rows:
                self._insert_to_bigquery("smartstore_inventory", inventory_rows)
                inventory_synced = len(inventory_rows)

            logger.info(f"Inventory sync completed: {inventory_synced} records")
            return {
                "inventory_synced": inventory_synced,
                "synced_at": synced_at.isoformat()
            }

        except Exception as e:
            logger.error(f"Inventory sync failed: {str(e)}")
            raise

    def sync_reviews(
        self,
        start_date: Optional[datetime] = None,
        end_date: Optional[datetime] = None
    ) -> Dict[str, Any]:
        """리뷰 데이터 동기화"""
        logger.info("Starting review sync...")
        synced_at = datetime.utcnow()

        if not start_date:
            start_date = datetime.utcnow() - timedelta(days=30)
        if not end_date:
            end_date = datetime.utcnow()

        reviews_synced = 0
        page = 1
        page_size = 100

        try:
            while True:
                # 리뷰 목록 조회
                response = self.api.get_reviews(
                    start_date=start_date,
                    end_date=end_date,
                    page=page,
                    size=page_size
                )

                reviews = response.get("contents", [])
                if not reviews:
                    break

                review_rows = []
                for review in reviews:
                    review_row = {
                        "review_id": review.get("reviewId"),
                        "order_id": review.get("productOrderId"),
                        "channel_id": self.channel_id,
                        "product_id": review.get("productId", ""),
                        "product_name": review.get("productName", ""),
                        "option_name": review.get("productOption"),
                        "reviewer_id": review.get("reviewerId"),
                        "reviewer_name": review.get("reviewerName", ""),
                        "rating": review.get("rating", 0),
                        "title": review.get("title"),
                        "content": review.get("content", ""),
                        "images": review.get("images", []),
                        "is_best_review": review.get("isBestReview", False),
                        "reply_content": review.get("replyContent"),
                        "reply_date": review.get("replyDate"),
                        "helpful_count": review.get("helpfulCount", 0),
                        "review_date": review.get("reviewDate"),
                        "created_at": synced_at.isoformat(),
                        "updated_at": synced_at.isoformat(),
                        "synced_at": synced_at.isoformat(),
                    }
                    review_rows.append(review_row)

                # BigQuery에 삽입
                self._insert_to_bigquery("smartstore_reviews", review_rows)
                reviews_synced += len(review_rows)

                # 다음 페이지 확인
                total_pages = response.get("totalPages", 1)
                if page >= total_pages:
                    break
                page += 1

            logger.info(f"Review sync completed: {reviews_synced} reviews")
            return {
                "reviews_synced": reviews_synced,
                "synced_at": synced_at.isoformat()
            }

        except Exception as e:
            logger.error(f"Review sync failed: {str(e)}")
            raise

    def run_full_sync(self) -> Dict[str, Any]:
        """전체 데이터 동기화 실행"""
        logger.info("Starting full SmartStore data sync...")
        results = {}

        try:
            # 1. 상품 동기화
            results["products"] = self.sync_products(full_sync=True)

            # 2. 주문 동기화 (최근 30일)
            results["orders"] = self.sync_orders(
                start_date=datetime.utcnow() - timedelta(days=30)
            )

            # 3. 정산 동기화 (최근 30일)
            results["settlements"] = self.sync_settlements(
                start_date=datetime.utcnow() - timedelta(days=30)
            )

            # 4. 매출 통계 동기화 (최근 30일)
            results["sales_stats"] = self.sync_sales_statistics(
                start_date=datetime.utcnow() - timedelta(days=30)
            )

            # 5. 재고 동기화
            results["inventory"] = self.sync_inventory()

            # 6. 리뷰 동기화 (최근 30일)
            results["reviews"] = self.sync_reviews(
                start_date=datetime.utcnow() - timedelta(days=30)
            )

            logger.info(f"Full sync completed successfully: {results}")
            return results

        except Exception as e:
            logger.error(f"Full sync failed: {str(e)}")
            raise

        finally:
            self.api.close()


def run_smartstore_sync(
    client_id: str,
    client_secret: str,
    access_token: str,
    refresh_token: str,
    channel_id: str,
    bigquery_project_id: str,
    dataset_id: str = "smartstore_data"
):
    """스마트스토어 동기화 실행 함수"""
    # 설정 생성
    config = NaverCommerceConfig(
        client_id=client_id,
        client_secret=client_secret,
        redirect_uri="http://localhost:8001/callback/naver",
        access_token=access_token,
        refresh_token=refresh_token,
        channel_id=channel_id
    )

    # BigQuery 클라이언트 생성
    bq_client = bigquery.Client(project=bigquery_project_id)

    # 동기화 실행
    sync = SmartStoreDataSync(config, bq_client, dataset_id)
    return sync.run_full_sync()


if __name__ == "__main__":
    # 환경 변수에서 설정 읽기
    import sys

    if len(sys.argv) < 6:
        print("Usage: python sync_smartstore.py <client_id> <client_secret> <access_token> <refresh_token> <channel_id> <bigquery_project_id>")
        sys.exit(1)

    result = run_smartstore_sync(
        client_id=sys.argv[1],
        client_secret=sys.argv[2],
        access_token=sys.argv[3],
        refresh_token=sys.argv[4],
        channel_id=sys.argv[5],
        bigquery_project_id=sys.argv[6]
    )
    print(f"Sync result: {result}")