import logging
import os
from datetime import datetime, timedelta
from typing import Any, Dict, List, Optional

from google.cloud import bigquery
from google.cloud.exceptions import NotFound

from backend.bigquery_schemas.coupang_tables import (
    create_coupang_tables,
    COUPANG_INVENTORY_SCHEMA,
    COUPANG_ORDERS_SCHEMA,
    COUPANG_PRICE_HISTORY_SCHEMA,
    COUPANG_PRODUCTS_SCHEMA,
    COUPANG_PRODUCT_ITEMS_SCHEMA,
    COUPANG_RETURNS_SCHEMA,
    COUPANG_SETTLEMENTS_SCHEMA,
)
from backend.coupang_client import CoupangAPIClient, CoupangConfig

logger = logging.getLogger(__name__)


class CoupangDataSync:
    """쿠팡 데이터 동기화 파이프라인"""

    def __init__(
        self,
        coupang_config: CoupangConfig,
        bigquery_client: bigquery.Client,
        dataset_id: str = "coupang_data"
    ):
        self.coupang = CoupangAPIClient(coupang_config)
        self.bq_client = bigquery_client
        self.dataset_id = dataset_id
        self.vendor_id = coupang_config.vendor_id

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
        create_coupang_tables(self.bq_client, self.dataset_id)

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
        items_synced = 0
        next_token = None

        try:
            while True:
                # 상품 목록 조회
                response = self.coupang.search_products(
                    status="APPROVED" if not full_sync else None,
                    limit=50,
                    next_token=next_token
                )

                products = response.get("data", [])
                if not products:
                    break

                product_rows = []
                item_rows = []

                for product in products:
                    # 상품 기본 정보
                    product_row = {
                        "product_id": product.get("sellerProductId"),
                        "seller_product_id": product.get("sellerProductId"),
                        "vendor_id": self.vendor_id,
                        "display_product_name": product.get("displayProductName"),
                        "brand": product.get("brand", ""),
                        "general_product_name": product.get("generalProductName", ""),
                        "product_group": product.get("productGroup", ""),
                        "category_code": product.get("displayCategoryCode"),
                        "category_name": product.get("displayCategoryName"),
                        "status": product.get("status"),
                        "status_name": product.get("statusName"),
                        "delivery_charge_type": product.get("deliveryChargeType", "FREE"),
                        "delivery_charge": product.get("deliveryCharge", 0),
                        "free_shipover_amount": product.get("freeShipOverAmount"),
                        "return_charge_vendor": product.get("returnChargeVendor", 0),
                        "return_charge_customer": product.get("returnChargeCustomer", 0),
                        "sale_start_date": product.get("saleStartedAt"),
                        "sale_end_date": product.get("saleEndedAt"),
                        "created_at": product.get("createdAt", synced_at.isoformat()),
                        "updated_at": product.get("modifiedAt", synced_at.isoformat()),
                        "synced_at": synced_at.isoformat(),
                    }
                    product_rows.append(product_row)

                    # 상품 아이템(옵션) 정보
                    items = product.get("items", [])
                    for item in items:
                        item_row = {
                            "vendor_item_id": item.get("vendorItemId"),
                            "product_id": product.get("sellerProductId"),
                            "seller_product_id": product.get("sellerProductId"),
                            "vendor_id": self.vendor_id,
                            "item_name": item.get("itemName", ""),
                            "original_price": item.get("originalPrice"),
                            "sale_price": item.get("salePrice"),
                            "maximum_buy_count": item.get("maximumBuyCount"),
                            "maximum_buy_for_person": item.get("maximumBuyForPerson"),
                            "outbound_shipping_place_code": item.get("outboundShippingPlaceCode"),
                            "contents": item.get("contents"),
                            "attributes": item.get("attributes"),
                            "notices": item.get("notices"),
                            "created_at": synced_at.isoformat(),
                            "updated_at": synced_at.isoformat(),
                            "synced_at": synced_at.isoformat(),
                        }
                        item_rows.append(item_row)

                # BigQuery에 삽입
                self._insert_to_bigquery("coupang_products", product_rows)
                self._insert_to_bigquery("coupang_product_items", item_rows)

                products_synced += len(product_rows)
                items_synced += len(item_rows)

                # 다음 페이지 확인
                next_token = response.get("nextToken")
                if not next_token:
                    break

            logger.info(f"Product sync completed: {products_synced} products, {items_synced} items")
            return {
                "products_synced": products_synced,
                "items_synced": items_synced,
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
        next_token = None

        try:
            while True:
                # 주문 목록 조회
                response = self.coupang.get_orders(
                    created_at_from=start_date,
                    created_at_to=end_date,
                    limit=50,
                    next_token=next_token
                )

                orders = response.get("data", [])
                if not orders:
                    break

                order_rows = []
                for order in orders:
                    # 주문 상세 조회
                    order_detail = self.coupang.get_order_detail(order["orderId"])
                    order_items = order_detail.get("orderItems", [])

                    for item in order_items:
                        order_row = {
                            "order_id": order["orderId"],
                            "vendor_id": self.vendor_id,
                            "vendor_item_id": item.get("vendorItemId"),
                            "product_id": item.get("sellerProductId", ""),
                            "seller_product_id": item.get("sellerProductId"),
                            "product_name": item.get("sellerProductName", ""),
                            "option_name": item.get("vendorItemName"),
                            "quantity": item.get("shippingCount", 0),
                            "unit_price": item.get("unitPrice", 0),
                            "total_price": item.get("totalPrice", 0),
                            "discount_price": item.get("discountPrice", 0),
                            "instant_discount_price": item.get("instantDiscountPrice", 0),
                            "shipping_fee": item.get("deliveryChargeAmount", 0),
                            "remote_fee": item.get("remoteAreaCostAmount", 0),
                            "buyer_name": order.get("ordererName", ""),
                            "buyer_phone": order.get("ordererPhoneNumber", ""),
                            "buyer_email": order.get("ordererEmail"),
                            "receiver_name": item.get("receiverName", ""),
                            "receiver_phone": item.get("receiverPhoneNumber", ""),
                            "postal_code": item.get("receiverZipCode", ""),
                            "address": item.get("receiverAddress1", ""),
                            "address_detail": item.get("receiverAddress2"),
                            "order_status": item.get("status", ""),
                            "shipping_status": item.get("shippingStatus"),
                            "delivery_company_code": item.get("deliveryCompanyCode"),
                            "delivery_company_name": item.get("deliveryCompanyName"),
                            "invoice_number": item.get("invoiceNumber"),
                            "shipped_at": item.get("shippedAt"),
                            "delivered_at": item.get("deliveredAt"),
                            "purchase_decided_at": item.get("purchaseDecidedAt"),
                            "payment_method": order.get("paymentMethod"),
                            "payment_at": order.get("paidAt"),
                            "ordered_at": order.get("orderedAt"),
                            "created_at": synced_at.isoformat(),
                            "updated_at": synced_at.isoformat(),
                            "synced_at": synced_at.isoformat(),
                        }
                        order_rows.append(order_row)

                # BigQuery에 삽입
                self._insert_to_bigquery("coupang_orders", order_rows)
                orders_synced += len(order_rows)

                # 다음 페이지 확인
                next_token = response.get("nextToken")
                if not next_token:
                    break

            logger.info(f"Order sync completed: {orders_synced} orders")
            return {
                "orders_synced": orders_synced,
                "synced_at": synced_at.isoformat()
            }

        except Exception as e:
            logger.error(f"Order sync failed: {str(e)}")
            raise

    def sync_returns(
        self,
        start_date: Optional[datetime] = None,
        end_date: Optional[datetime] = None
    ) -> Dict[str, Any]:
        """반품 데이터 동기화"""
        logger.info("Starting return sync...")
        synced_at = datetime.utcnow()

        if not start_date:
            start_date = datetime.utcnow() - timedelta(days=30)
        if not end_date:
            end_date = datetime.utcnow()

        returns_synced = 0

        try:
            # 반품 목록 조회
            response = self.coupang.get_returns(
                search_from=start_date,
                search_to=end_date,
                limit=50
            )

            returns = response.get("data", [])
            return_rows = []

            for return_item in returns:
                return_row = {
                    "return_id": return_item.get("returnId"),
                    "order_id": return_item.get("orderId"),
                    "vendor_id": self.vendor_id,
                    "vendor_item_id": return_item.get("vendorItemId"),
                    "product_id": return_item.get("sellerProductId", ""),
                    "product_name": return_item.get("sellerProductName", ""),
                    "option_name": return_item.get("vendorItemName"),
                    "quantity": return_item.get("returnQuantity", 0),
                    "return_reason": return_item.get("returnReason", ""),
                    "return_reason_detail": return_item.get("returnReasonDetail"),
                    "return_status": return_item.get("returnStatus", ""),
                    "return_shipping_charge": return_item.get("returnShippingCharge", 0),
                    "return_delivery_company": return_item.get("returnDeliveryCompanyName"),
                    "return_invoice_number": return_item.get("returnInvoiceNumber"),
                    "refund_amount": return_item.get("refundAmount", 0),
                    "requested_at": return_item.get("createdAt"),
                    "approved_at": return_item.get("approvedAt"),
                    "rejected_at": return_item.get("rejectedAt"),
                    "completed_at": return_item.get("completedAt"),
                    "created_at": synced_at.isoformat(),
                    "updated_at": synced_at.isoformat(),
                    "synced_at": synced_at.isoformat(),
                }
                return_rows.append(return_row)

            # BigQuery에 삽입
            self._insert_to_bigquery("coupang_returns", return_rows)
            returns_synced = len(return_rows)

            logger.info(f"Return sync completed: {returns_synced} returns")
            return {
                "returns_synced": returns_synced,
                "synced_at": synced_at.isoformat()
            }

        except Exception as e:
            logger.error(f"Return sync failed: {str(e)}")
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

        try:
            # 정산 내역 조회
            response = self.coupang.get_settlements(
                settlement_date_from=start_date,
                settlement_date_to=end_date
            )

            settlements = response.get("data", [])
            settlement_rows = []

            for settlement in settlements:
                # 정산 상세 조회
                detail = self.coupang.get_settlement_detail(settlement["settlementId"])
                items = detail.get("settlementItems", [])

                for item in items:
                    settlement_row = {
                        "settlement_id": settlement["settlementId"],
                        "vendor_id": self.vendor_id,
                        "settlement_date": settlement.get("settlementDate"),
                        "order_id": item.get("orderId"),
                        "vendor_item_id": item.get("vendorItemId"),
                        "product_id": item.get("sellerProductId", ""),
                        "product_name": item.get("sellerProductName", ""),
                        "option_name": item.get("vendorItemName"),
                        "quantity": item.get("quantity", 0),
                        "unit_price": item.get("unitPrice", 0),
                        "sales_amount": item.get("salesAmount", 0),
                        "order_amount": item.get("orderAmount", 0),
                        "discount_amount": item.get("discountAmount", 0),
                        "instant_discount_amount": item.get("instantDiscountAmount", 0),
                        "commission_rate": item.get("commissionRate", 0),
                        "commission_amount": item.get("commissionAmount", 0),
                        "partner_support_amount": item.get("partnerSupportAmount", 0),
                        "coupon_discount_amount": item.get("couponDiscountAmount", 0),
                        "shipping_fee": item.get("shippingFee", 0),
                        "shipping_fee_discount": item.get("shippingFeeDiscount", 0),
                        "remote_fee": item.get("remoteFee", 0),
                        "promotion_fee": item.get("promotionFee", 0),
                        "settlement_amount": item.get("settlementAmount", 0),
                        "payment_date": settlement.get("paymentDate"),
                        "payment_amount": settlement.get("paymentAmount"),
                        "payment_status": settlement.get("paymentStatus"),
                        "tax_type": item.get("taxType"),
                        "tax_amount": item.get("taxAmount", 0),
                        "ordered_at": item.get("orderedAt"),
                        "purchase_decided_at": item.get("purchaseDecidedAt"),
                        "created_at": synced_at.isoformat(),
                        "updated_at": synced_at.isoformat(),
                        "synced_at": synced_at.isoformat(),
                    }
                    settlement_rows.append(settlement_row)

            # BigQuery에 삽입
            self._insert_to_bigquery("coupang_settlements", settlement_rows)
            settlements_synced = len(settlement_rows)

            logger.info(f"Settlement sync completed: {settlements_synced} settlements")
            return {
                "settlements_synced": settlements_synced,
                "synced_at": synced_at.isoformat()
            }

        except Exception as e:
            logger.error(f"Settlement sync failed: {str(e)}")
            raise

    def sync_inventory(self, vendor_item_ids: Optional[List[str]] = None) -> Dict[str, Any]:
        """재고 데이터 동기화"""
        logger.info("Starting inventory sync...")
        synced_at = datetime.utcnow()
        inventory_synced = 0

        try:
            # vendor_item_ids가 없으면 모든 상품의 재고 조회
            if not vendor_item_ids:
                # 먼저 모든 활성 상품의 vendor_item_id 조회
                vendor_item_ids = []
                next_token = None

                while True:
                    response = self.coupang.search_products(
                        status="APPROVED",
                        limit=50,
                        next_token=next_token
                    )

                    products = response.get("data", [])
                    if not products:
                        break

                    for product in products:
                        items = product.get("items", [])
                        for item in items:
                            vendor_item_ids.append(item.get("vendorItemId"))

                    next_token = response.get("nextToken")
                    if not next_token:
                        break

            # 각 아이템별 재고 조회
            inventory_rows = []
            for vendor_item_id in vendor_item_ids:
                try:
                    inventory = self.coupang.get_inventory(vendor_item_id)

                    inventory_row = {
                        "vendor_item_id": vendor_item_id,
                        "vendor_id": self.vendor_id,
                        "product_id": inventory.get("sellerProductId", ""),
                        "seller_product_id": inventory.get("sellerProductId"),
                        "item_name": inventory.get("itemName", ""),
                        "available_quantity": inventory.get("availableQuantity", 0),
                        "onhand_quantity": inventory.get("onhandQuantity", 0),
                        "reserved_quantity": inventory.get("reservedQuantity", 0),
                        "warehouse_quantity": inventory.get("warehouseQuantity", 0),
                        "outbound_shipping_place_code": inventory.get("outboundShippingPlaceCode"),
                        "last_updated_at": inventory.get("lastUpdatedAt", synced_at.isoformat()),
                        "created_at": synced_at.isoformat(),
                        "updated_at": synced_at.isoformat(),
                        "synced_at": synced_at.isoformat(),
                    }
                    inventory_rows.append(inventory_row)

                except Exception as e:
                    logger.warning(f"Failed to get inventory for {vendor_item_id}: {str(e)}")
                    continue

            # BigQuery에 삽입
            if inventory_rows:
                self._insert_to_bigquery("coupang_inventory", inventory_rows)
                inventory_synced = len(inventory_rows)

            logger.info(f"Inventory sync completed: {inventory_synced} items")
            return {
                "inventory_synced": inventory_synced,
                "synced_at": synced_at.isoformat()
            }

        except Exception as e:
            logger.error(f"Inventory sync failed: {str(e)}")
            raise

    def run_full_sync(self) -> Dict[str, Any]:
        """전체 데이터 동기화 실행"""
        logger.info("Starting full Coupang data sync...")
        results = {}

        try:
            # 1. 상품 동기화
            results["products"] = self.sync_products(full_sync=True)

            # 2. 주문 동기화 (최근 30일)
            results["orders"] = self.sync_orders(
                start_date=datetime.utcnow() - timedelta(days=30)
            )

            # 3. 반품 동기화 (최근 30일)
            results["returns"] = self.sync_returns(
                start_date=datetime.utcnow() - timedelta(days=30)
            )

            # 4. 정산 동기화 (최근 30일)
            results["settlements"] = self.sync_settlements(
                start_date=datetime.utcnow() - timedelta(days=30)
            )

            # 5. 재고 동기화
            results["inventory"] = self.sync_inventory()

            logger.info(f"Full sync completed successfully: {results}")
            return results

        except Exception as e:
            logger.error(f"Full sync failed: {str(e)}")
            raise

        finally:
            self.coupang.close()


def run_coupang_sync(
    access_key: str,
    secret_key: str,
    vendor_id: str,
    bigquery_project_id: str,
    dataset_id: str = "coupang_data"
):
    """쿠팡 동기화 실행 함수"""
    # 설정 생성
    config = CoupangConfig(
        access_key=access_key,
        secret_key=secret_key,
        vendor_id=vendor_id
    )

    # BigQuery 클라이언트 생성
    bq_client = bigquery.Client(project=bigquery_project_id)

    # 동기화 실행
    sync = CoupangDataSync(config, bq_client, dataset_id)
    return sync.run_full_sync()


if __name__ == "__main__":
    # 환경 변수에서 설정 읽기
    import sys

    if len(sys.argv) < 5:
        print("Usage: python sync_coupang.py <access_key> <secret_key> <vendor_id> <bigquery_project_id>")
        sys.exit(1)

    result = run_coupang_sync(
        access_key=sys.argv[1],
        secret_key=sys.argv[2],
        vendor_id=sys.argv[3],
        bigquery_project_id=sys.argv[4]
    )
    print(f"Sync result: {result}")