from google.cloud import bigquery


COUPANG_PRODUCTS_SCHEMA = [
    bigquery.SchemaField("product_id", "STRING", mode="REQUIRED", description="쿠팡 상품 ID"),
    bigquery.SchemaField("seller_product_id", "STRING", mode="REQUIRED", description="판매자 상품 ID"),
    bigquery.SchemaField("vendor_id", "STRING", mode="REQUIRED", description="벤더 ID"),
    bigquery.SchemaField("display_product_name", "STRING", mode="REQUIRED", description="노출 상품명"),
    bigquery.SchemaField("brand", "STRING", mode="REQUIRED", description="브랜드"),
    bigquery.SchemaField("general_product_name", "STRING", mode="REQUIRED", description="일반 상품명"),
    bigquery.SchemaField("product_group", "STRING", mode="REQUIRED", description="상품 그룹"),
    bigquery.SchemaField("category_code", "STRING", mode="NULLABLE", description="카테고리 코드"),
    bigquery.SchemaField("category_name", "STRING", mode="NULLABLE", description="카테고리명"),
    bigquery.SchemaField("status", "STRING", mode="REQUIRED", description="상품 상태"),
    bigquery.SchemaField("status_name", "STRING", mode="NULLABLE", description="상태명"),
    bigquery.SchemaField("delivery_charge_type", "STRING", mode="REQUIRED", description="배송비 타입"),
    bigquery.SchemaField("delivery_charge", "INTEGER", mode="REQUIRED", description="배송비"),
    bigquery.SchemaField("free_shipover_amount", "INTEGER", mode="NULLABLE", description="무료배송 기준 금액"),
    bigquery.SchemaField("return_charge_vendor", "INTEGER", mode="REQUIRED", description="판매자 반품 배송비"),
    bigquery.SchemaField("return_charge_customer", "INTEGER", mode="REQUIRED", description="구매자 반품 배송비"),
    bigquery.SchemaField("sale_start_date", "DATETIME", mode="NULLABLE", description="판매 시작일"),
    bigquery.SchemaField("sale_end_date", "DATETIME", mode="NULLABLE", description="판매 종료일"),
    bigquery.SchemaField("created_at", "TIMESTAMP", mode="REQUIRED", description="생성일시"),
    bigquery.SchemaField("updated_at", "TIMESTAMP", mode="REQUIRED", description="수정일시"),
    bigquery.SchemaField("synced_at", "TIMESTAMP", mode="REQUIRED", description="동기화일시"),
]

COUPANG_PRODUCT_ITEMS_SCHEMA = [
    bigquery.SchemaField("vendor_item_id", "STRING", mode="REQUIRED", description="벤더 아이템 ID"),
    bigquery.SchemaField("product_id", "STRING", mode="REQUIRED", description="쿠팡 상품 ID"),
    bigquery.SchemaField("seller_product_id", "STRING", mode="REQUIRED", description="판매자 상품 ID"),
    bigquery.SchemaField("vendor_id", "STRING", mode="REQUIRED", description="벤더 ID"),
    bigquery.SchemaField("item_name", "STRING", mode="REQUIRED", description="아이템명"),
    bigquery.SchemaField("original_price", "INTEGER", mode="NULLABLE", description="정가"),
    bigquery.SchemaField("sale_price", "INTEGER", mode="REQUIRED", description="판매가"),
    bigquery.SchemaField("maximum_buy_count", "INTEGER", mode="NULLABLE", description="최대 구매 수량"),
    bigquery.SchemaField("maximum_buy_for_person", "INTEGER", mode="NULLABLE", description="인당 최대 구매 수량"),
    bigquery.SchemaField("outbound_shipping_place_code", "STRING", mode="NULLABLE", description="출고지 코드"),
    bigquery.SchemaField("contents", "JSON", mode="NULLABLE", description="상품 상세 컨텐츠"),
    bigquery.SchemaField("attributes", "JSON", mode="NULLABLE", description="상품 속성"),
    bigquery.SchemaField("notices", "JSON", mode="NULLABLE", description="상품고시정보"),
    bigquery.SchemaField("created_at", "TIMESTAMP", mode="REQUIRED", description="생성일시"),
    bigquery.SchemaField("updated_at", "TIMESTAMP", mode="REQUIRED", description="수정일시"),
    bigquery.SchemaField("synced_at", "TIMESTAMP", mode="REQUIRED", description="동기화일시"),
]

COUPANG_ORDERS_SCHEMA = [
    bigquery.SchemaField("order_id", "STRING", mode="REQUIRED", description="주문번호"),
    bigquery.SchemaField("vendor_id", "STRING", mode="REQUIRED", description="벤더 ID"),
    bigquery.SchemaField("vendor_item_id", "STRING", mode="REQUIRED", description="벤더 아이템 ID"),
    bigquery.SchemaField("product_id", "STRING", mode="REQUIRED", description="쿠팡 상품 ID"),
    bigquery.SchemaField("seller_product_id", "STRING", mode="NULLABLE", description="판매자 상품 ID"),
    bigquery.SchemaField("product_name", "STRING", mode="REQUIRED", description="상품명"),
    bigquery.SchemaField("option_name", "STRING", mode="NULLABLE", description="옵션명"),
    bigquery.SchemaField("quantity", "INTEGER", mode="REQUIRED", description="수량"),
    bigquery.SchemaField("unit_price", "INTEGER", mode="REQUIRED", description="단가"),
    bigquery.SchemaField("total_price", "INTEGER", mode="REQUIRED", description="총 금액"),
    bigquery.SchemaField("discount_price", "INTEGER", mode="NULLABLE", description="할인 금액"),
    bigquery.SchemaField("instant_discount_price", "INTEGER", mode="NULLABLE", description="즉시 할인 금액"),
    bigquery.SchemaField("shipping_fee", "INTEGER", mode="REQUIRED", description="배송비"),
    bigquery.SchemaField("remote_fee", "INTEGER", mode="NULLABLE", description="도서산간 배송비"),
    bigquery.SchemaField("buyer_name", "STRING", mode="REQUIRED", description="구매자명"),
    bigquery.SchemaField("buyer_phone", "STRING", mode="REQUIRED", description="구매자 전화번호"),
    bigquery.SchemaField("buyer_email", "STRING", mode="NULLABLE", description="구매자 이메일"),
    bigquery.SchemaField("receiver_name", "STRING", mode="REQUIRED", description="수령자명"),
    bigquery.SchemaField("receiver_phone", "STRING", mode="REQUIRED", description="수령자 전화번호"),
    bigquery.SchemaField("postal_code", "STRING", mode="REQUIRED", description="우편번호"),
    bigquery.SchemaField("address", "STRING", mode="REQUIRED", description="주소"),
    bigquery.SchemaField("address_detail", "STRING", mode="NULLABLE", description="상세주소"),
    bigquery.SchemaField("order_status", "STRING", mode="REQUIRED", description="주문 상태"),
    bigquery.SchemaField("shipping_status", "STRING", mode="NULLABLE", description="배송 상태"),
    bigquery.SchemaField("delivery_company_code", "STRING", mode="NULLABLE", description="택배사 코드"),
    bigquery.SchemaField("delivery_company_name", "STRING", mode="NULLABLE", description="택배사명"),
    bigquery.SchemaField("invoice_number", "STRING", mode="NULLABLE", description="운송장번호"),
    bigquery.SchemaField("shipped_at", "TIMESTAMP", mode="NULLABLE", description="배송일시"),
    bigquery.SchemaField("delivered_at", "TIMESTAMP", mode="NULLABLE", description="배송완료일시"),
    bigquery.SchemaField("purchase_decided_at", "TIMESTAMP", mode="NULLABLE", description="구매확정일시"),
    bigquery.SchemaField("payment_method", "STRING", mode="NULLABLE", description="결제수단"),
    bigquery.SchemaField("payment_at", "TIMESTAMP", mode="NULLABLE", description="결제일시"),
    bigquery.SchemaField("ordered_at", "TIMESTAMP", mode="REQUIRED", description="주문일시"),
    bigquery.SchemaField("created_at", "TIMESTAMP", mode="REQUIRED", description="생성일시"),
    bigquery.SchemaField("updated_at", "TIMESTAMP", mode="REQUIRED", description="수정일시"),
    bigquery.SchemaField("synced_at", "TIMESTAMP", mode="REQUIRED", description="동기화일시"),
]

COUPANG_RETURNS_SCHEMA = [
    bigquery.SchemaField("return_id", "STRING", mode="REQUIRED", description="반품 ID"),
    bigquery.SchemaField("order_id", "STRING", mode="REQUIRED", description="주문번호"),
    bigquery.SchemaField("vendor_id", "STRING", mode="REQUIRED", description="벤더 ID"),
    bigquery.SchemaField("vendor_item_id", "STRING", mode="REQUIRED", description="벤더 아이템 ID"),
    bigquery.SchemaField("product_id", "STRING", mode="REQUIRED", description="쿠팡 상품 ID"),
    bigquery.SchemaField("product_name", "STRING", mode="REQUIRED", description="상품명"),
    bigquery.SchemaField("option_name", "STRING", mode="NULLABLE", description="옵션명"),
    bigquery.SchemaField("quantity", "INTEGER", mode="REQUIRED", description="반품 수량"),
    bigquery.SchemaField("return_reason", "STRING", mode="REQUIRED", description="반품 사유"),
    bigquery.SchemaField("return_reason_detail", "STRING", mode="NULLABLE", description="반품 상세 사유"),
    bigquery.SchemaField("return_status", "STRING", mode="REQUIRED", description="반품 상태"),
    bigquery.SchemaField("return_shipping_charge", "INTEGER", mode="NULLABLE", description="반품 배송비"),
    bigquery.SchemaField("return_delivery_company", "STRING", mode="NULLABLE", description="반품 택배사"),
    bigquery.SchemaField("return_invoice_number", "STRING", mode="NULLABLE", description="반품 운송장번호"),
    bigquery.SchemaField("refund_amount", "INTEGER", mode="NULLABLE", description="환불 금액"),
    bigquery.SchemaField("requested_at", "TIMESTAMP", mode="REQUIRED", description="반품요청일시"),
    bigquery.SchemaField("approved_at", "TIMESTAMP", mode="NULLABLE", description="반품승인일시"),
    bigquery.SchemaField("rejected_at", "TIMESTAMP", mode="NULLABLE", description="반품거부일시"),
    bigquery.SchemaField("completed_at", "TIMESTAMP", mode="NULLABLE", description="반품완료일시"),
    bigquery.SchemaField("created_at", "TIMESTAMP", mode="REQUIRED", description="생성일시"),
    bigquery.SchemaField("updated_at", "TIMESTAMP", mode="REQUIRED", description="수정일시"),
    bigquery.SchemaField("synced_at", "TIMESTAMP", mode="REQUIRED", description="동기화일시"),
]

COUPANG_SETTLEMENTS_SCHEMA = [
    bigquery.SchemaField("settlement_id", "STRING", mode="REQUIRED", description="정산 ID"),
    bigquery.SchemaField("vendor_id", "STRING", mode="REQUIRED", description="벤더 ID"),
    bigquery.SchemaField("settlement_date", "DATE", mode="REQUIRED", description="정산일"),
    bigquery.SchemaField("order_id", "STRING", mode="REQUIRED", description="주문번호"),
    bigquery.SchemaField("vendor_item_id", "STRING", mode="REQUIRED", description="벤더 아이템 ID"),
    bigquery.SchemaField("product_id", "STRING", mode="REQUIRED", description="쿠팡 상품 ID"),
    bigquery.SchemaField("product_name", "STRING", mode="REQUIRED", description="상품명"),
    bigquery.SchemaField("option_name", "STRING", mode="NULLABLE", description="옵션명"),
    bigquery.SchemaField("quantity", "INTEGER", mode="REQUIRED", description="수량"),
    bigquery.SchemaField("unit_price", "INTEGER", mode="REQUIRED", description="단가"),
    bigquery.SchemaField("sales_amount", "INTEGER", mode="REQUIRED", description="판매금액"),
    bigquery.SchemaField("order_amount", "INTEGER", mode="REQUIRED", description="주문금액"),
    bigquery.SchemaField("discount_amount", "INTEGER", mode="NULLABLE", description="할인금액"),
    bigquery.SchemaField("instant_discount_amount", "INTEGER", mode="NULLABLE", description="즉시할인금액"),
    bigquery.SchemaField("commission_rate", "FLOAT", mode="REQUIRED", description="수수료율"),
    bigquery.SchemaField("commission_amount", "INTEGER", mode="REQUIRED", description="수수료"),
    bigquery.SchemaField("partner_support_amount", "INTEGER", mode="NULLABLE", description="파트너지원금액"),
    bigquery.SchemaField("coupon_discount_amount", "INTEGER", mode="NULLABLE", description="쿠폰할인금액"),
    bigquery.SchemaField("shipping_fee", "INTEGER", mode="NULLABLE", description="배송비"),
    bigquery.SchemaField("shipping_fee_discount", "INTEGER", mode="NULLABLE", description="배송비할인"),
    bigquery.SchemaField("remote_fee", "INTEGER", mode="NULLABLE", description="도서산간배송비"),
    bigquery.SchemaField("promotion_fee", "INTEGER", mode="NULLABLE", description="프로모션비용"),
    bigquery.SchemaField("settlement_amount", "INTEGER", mode="REQUIRED", description="정산금액"),
    bigquery.SchemaField("payment_date", "DATE", mode="NULLABLE", description="지급일"),
    bigquery.SchemaField("payment_amount", "INTEGER", mode="NULLABLE", description="지급금액"),
    bigquery.SchemaField("payment_status", "STRING", mode="NULLABLE", description="지급상태"),
    bigquery.SchemaField("tax_type", "STRING", mode="NULLABLE", description="세금타입"),
    bigquery.SchemaField("tax_amount", "INTEGER", mode="NULLABLE", description="세금금액"),
    bigquery.SchemaField("ordered_at", "TIMESTAMP", mode="REQUIRED", description="주문일시"),
    bigquery.SchemaField("purchase_decided_at", "TIMESTAMP", mode="NULLABLE", description="구매확정일시"),
    bigquery.SchemaField("created_at", "TIMESTAMP", mode="REQUIRED", description="생성일시"),
    bigquery.SchemaField("updated_at", "TIMESTAMP", mode="REQUIRED", description="수정일시"),
    bigquery.SchemaField("synced_at", "TIMESTAMP", mode="REQUIRED", description="동기화일시"),
]

COUPANG_INVENTORY_SCHEMA = [
    bigquery.SchemaField("vendor_item_id", "STRING", mode="REQUIRED", description="벤더 아이템 ID"),
    bigquery.SchemaField("vendor_id", "STRING", mode="REQUIRED", description="벤더 ID"),
    bigquery.SchemaField("product_id", "STRING", mode="REQUIRED", description="쿠팡 상품 ID"),
    bigquery.SchemaField("seller_product_id", "STRING", mode="NULLABLE", description="판매자 상품 ID"),
    bigquery.SchemaField("item_name", "STRING", mode="REQUIRED", description="아이템명"),
    bigquery.SchemaField("available_quantity", "INTEGER", mode="REQUIRED", description="가용 재고"),
    bigquery.SchemaField("onhand_quantity", "INTEGER", mode="REQUIRED", description="실재고"),
    bigquery.SchemaField("reserved_quantity", "INTEGER", mode="NULLABLE", description="예약 재고"),
    bigquery.SchemaField("warehouse_quantity", "INTEGER", mode="NULLABLE", description="창고 재고"),
    bigquery.SchemaField("outbound_shipping_place_code", "STRING", mode="NULLABLE", description="출고지 코드"),
    bigquery.SchemaField("last_updated_at", "TIMESTAMP", mode="REQUIRED", description="최종 업데이트일시"),
    bigquery.SchemaField("created_at", "TIMESTAMP", mode="REQUIRED", description="생성일시"),
    bigquery.SchemaField("updated_at", "TIMESTAMP", mode="REQUIRED", description="수정일시"),
    bigquery.SchemaField("synced_at", "TIMESTAMP", mode="REQUIRED", description="동기화일시"),
]

COUPANG_PRICE_HISTORY_SCHEMA = [
    bigquery.SchemaField("vendor_item_id", "STRING", mode="REQUIRED", description="벤더 아이템 ID"),
    bigquery.SchemaField("vendor_id", "STRING", mode="REQUIRED", description="벤더 ID"),
    bigquery.SchemaField("product_id", "STRING", mode="REQUIRED", description="쿠팡 상품 ID"),
    bigquery.SchemaField("seller_product_id", "STRING", mode="NULLABLE", description="판매자 상품 ID"),
    bigquery.SchemaField("original_price", "INTEGER", mode="NULLABLE", description="정가"),
    bigquery.SchemaField("sale_price", "INTEGER", mode="REQUIRED", description="판매가"),
    bigquery.SchemaField("discount_rate", "FLOAT", mode="NULLABLE", description="할인율"),
    bigquery.SchemaField("effective_from", "TIMESTAMP", mode="REQUIRED", description="적용시작일시"),
    bigquery.SchemaField("effective_to", "TIMESTAMP", mode="NULLABLE", description="적용종료일시"),
    bigquery.SchemaField("is_current", "BOOLEAN", mode="REQUIRED", description="현재가격여부"),
    bigquery.SchemaField("created_at", "TIMESTAMP", mode="REQUIRED", description="생성일시"),
    bigquery.SchemaField("synced_at", "TIMESTAMP", mode="REQUIRED", description="동기화일시"),
]


def create_coupang_tables(client: bigquery.Client, dataset_id: str):
    """쿠팡 관련 BigQuery 테이블 생성"""
    tables = {
        "coupang_products": COUPANG_PRODUCTS_SCHEMA,
        "coupang_product_items": COUPANG_PRODUCT_ITEMS_SCHEMA,
        "coupang_orders": COUPANG_ORDERS_SCHEMA,
        "coupang_returns": COUPANG_RETURNS_SCHEMA,
        "coupang_settlements": COUPANG_SETTLEMENTS_SCHEMA,
        "coupang_inventory": COUPANG_INVENTORY_SCHEMA,
        "coupang_price_history": COUPANG_PRICE_HISTORY_SCHEMA,
    }

    for table_name, schema in tables.items():
        table_id = f"{client.project}.{dataset_id}.{table_name}"
        table = bigquery.Table(table_id, schema=schema)

        # 테이블 파티셔닝 설정
        if table_name in ["coupang_orders", "coupang_returns", "coupang_settlements"]:
            table.time_partitioning = bigquery.TimePartitioning(
                type_=bigquery.TimePartitioningType.DAY,
                field="created_at"
            )

        # 테이블 클러스터링 설정
        if table_name == "coupang_orders":
            table.clustering_fields = ["vendor_id", "order_status"]
        elif table_name == "coupang_products":
            table.clustering_fields = ["vendor_id", "status"]
        elif table_name == "coupang_settlements":
            table.clustering_fields = ["vendor_id", "settlement_date"]

        try:
            table = client.create_table(table)
            print(f"Created table {table.project}.{table.dataset_id}.{table.table_id}")
        except Exception as e:
            print(f"Table {table_id} already exists or error: {e}")