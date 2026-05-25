from google.cloud import bigquery


SMARTSTORE_PRODUCTS_SCHEMA = [
    bigquery.SchemaField("product_id", "STRING", mode="REQUIRED", description="네이버 상품 ID"),
    bigquery.SchemaField("channel_product_id", "STRING", mode="NULLABLE", description="채널 상품 ID"),
    bigquery.SchemaField("channel_id", "STRING", mode="REQUIRED", description="채널(스토어) ID"),
    bigquery.SchemaField("name", "STRING", mode="REQUIRED", description="상품명"),
    bigquery.SchemaField("sale_price", "INTEGER", mode="REQUIRED", description="판매가"),
    bigquery.SchemaField("discount_price", "INTEGER", mode="NULLABLE", description="할인가"),
    bigquery.SchemaField("mobile_discount_price", "INTEGER", mode="NULLABLE", description="모바일 할인가"),
    bigquery.SchemaField("cost_price", "INTEGER", mode="NULLABLE", description="원가"),
    bigquery.SchemaField("stock_quantity", "INTEGER", mode="REQUIRED", description="재고수량"),
    bigquery.SchemaField("status", "STRING", mode="REQUIRED", description="상품상태"),
    bigquery.SchemaField("status_type", "STRING", mode="NULLABLE", description="상태타입"),
    bigquery.SchemaField("category_id", "STRING", mode="REQUIRED", description="카테고리ID"),
    bigquery.SchemaField("category_name", "STRING", mode="NULLABLE", description="카테고리명"),
    bigquery.SchemaField("brand", "STRING", mode="NULLABLE", description="브랜드"),
    bigquery.SchemaField("manufacturer", "STRING", mode="NULLABLE", description="제조사"),
    bigquery.SchemaField("origin", "STRING", mode="NULLABLE", description="원산지"),
    bigquery.SchemaField("images", "JSON", mode="NULLABLE", description="상품이미지목록"),
    bigquery.SchemaField("detail_content", "STRING", mode="NULLABLE", description="상세설명"),
    bigquery.SchemaField("delivery_fee_type", "STRING", mode="REQUIRED", description="배송비타입"),
    bigquery.SchemaField("delivery_fee", "INTEGER", mode="NULLABLE", description="배송비"),
    bigquery.SchemaField("delivery_method", "STRING", mode="REQUIRED", description="배송방법"),
    bigquery.SchemaField("sale_start_date", "TIMESTAMP", mode="NULLABLE", description="판매시작일"),
    bigquery.SchemaField("sale_end_date", "TIMESTAMP", mode="NULLABLE", description="판매종료일"),
    bigquery.SchemaField("attributes", "JSON", mode="NULLABLE", description="상품속성"),
    bigquery.SchemaField("created_at", "TIMESTAMP", mode="REQUIRED", description="생성일시"),
    bigquery.SchemaField("updated_at", "TIMESTAMP", mode="REQUIRED", description="수정일시"),
    bigquery.SchemaField("synced_at", "TIMESTAMP", mode="REQUIRED", description="동기화일시"),
]

SMARTSTORE_ORDERS_SCHEMA = [
    bigquery.SchemaField("order_id", "STRING", mode="REQUIRED", description="주문번호"),
    bigquery.SchemaField("channel_id", "STRING", mode="REQUIRED", description="채널(스토어) ID"),
    bigquery.SchemaField("order_date", "TIMESTAMP", mode="REQUIRED", description="주문일시"),
    bigquery.SchemaField("product_id", "STRING", mode="REQUIRED", description="상품ID"),
    bigquery.SchemaField("product_name", "STRING", mode="REQUIRED", description="상품명"),
    bigquery.SchemaField("option_code", "STRING", mode="NULLABLE", description="옵션코드"),
    bigquery.SchemaField("option_name", "STRING", mode="NULLABLE", description="옵션명"),
    bigquery.SchemaField("quantity", "INTEGER", mode="REQUIRED", description="수량"),
    bigquery.SchemaField("unit_price", "INTEGER", mode="REQUIRED", description="단가"),
    bigquery.SchemaField("option_price", "INTEGER", mode="NULLABLE", description="옵션가격"),
    bigquery.SchemaField("discount_amount", "INTEGER", mode="NULLABLE", description="할인금액"),
    bigquery.SchemaField("total_payment_amount", "INTEGER", mode="REQUIRED", description="총결제금액"),
    bigquery.SchemaField("delivery_fee", "INTEGER", mode="REQUIRED", description="배송비"),
    bigquery.SchemaField("order_status", "STRING", mode="REQUIRED", description="주문상태"),
    bigquery.SchemaField("claim_status", "STRING", mode="NULLABLE", description="클레임상태"),
    bigquery.SchemaField("claim_type", "STRING", mode="NULLABLE", description="클레임타입"),
    bigquery.SchemaField("orderer_name", "STRING", mode="REQUIRED", description="주문자명"),
    bigquery.SchemaField("orderer_tel", "STRING", mode="NULLABLE", description="주문자전화"),
    bigquery.SchemaField("orderer_mobile", "STRING", mode="REQUIRED", description="주문자휴대폰"),
    bigquery.SchemaField("orderer_email", "STRING", mode="NULLABLE", description="주문자이메일"),
    bigquery.SchemaField("receiver_name", "STRING", mode="REQUIRED", description="수령자명"),
    bigquery.SchemaField("receiver_tel", "STRING", mode="NULLABLE", description="수령자전화"),
    bigquery.SchemaField("receiver_mobile", "STRING", mode="REQUIRED", description="수령자휴대폰"),
    bigquery.SchemaField("receiver_zipcode", "STRING", mode="REQUIRED", description="우편번호"),
    bigquery.SchemaField("receiver_address", "STRING", mode="REQUIRED", description="주소"),
    bigquery.SchemaField("receiver_detail_address", "STRING", mode="NULLABLE", description="상세주소"),
    bigquery.SchemaField("delivery_message", "STRING", mode="NULLABLE", description="배송메시지"),
    bigquery.SchemaField("delivery_company", "STRING", mode="NULLABLE", description="택배사"),
    bigquery.SchemaField("invoice_number", "STRING", mode="NULLABLE", description="운송장번호"),
    bigquery.SchemaField("dispatched_date", "TIMESTAMP", mode="NULLABLE", description="발송일시"),
    bigquery.SchemaField("delivered_date", "TIMESTAMP", mode="NULLABLE", description="배송완료일시"),
    bigquery.SchemaField("purchase_confirmed_date", "TIMESTAMP", mode="NULLABLE", description="구매확정일시"),
    bigquery.SchemaField("payment_method", "STRING", mode="NULLABLE", description="결제수단"),
    bigquery.SchemaField("payment_date", "TIMESTAMP", mode="NULLABLE", description="결제일시"),
    bigquery.SchemaField("created_at", "TIMESTAMP", mode="REQUIRED", description="생성일시"),
    bigquery.SchemaField("updated_at", "TIMESTAMP", mode="REQUIRED", description="수정일시"),
    bigquery.SchemaField("synced_at", "TIMESTAMP", mode="REQUIRED", description="동기화일시"),
]

SMARTSTORE_RETURNS_SCHEMA = [
    bigquery.SchemaField("return_id", "STRING", mode="REQUIRED", description="반품ID"),
    bigquery.SchemaField("order_id", "STRING", mode="REQUIRED", description="주문번호"),
    bigquery.SchemaField("channel_id", "STRING", mode="REQUIRED", description="채널(스토어) ID"),
    bigquery.SchemaField("product_id", "STRING", mode="REQUIRED", description="상품ID"),
    bigquery.SchemaField("product_name", "STRING", mode="REQUIRED", description="상품명"),
    bigquery.SchemaField("option_name", "STRING", mode="NULLABLE", description="옵션명"),
    bigquery.SchemaField("quantity", "INTEGER", mode="REQUIRED", description="반품수량"),
    bigquery.SchemaField("return_reason", "STRING", mode="REQUIRED", description="반품사유"),
    bigquery.SchemaField("return_reason_detail", "STRING", mode="NULLABLE", description="반품상세사유"),
    bigquery.SchemaField("return_status", "STRING", mode="REQUIRED", description="반품상태"),
    bigquery.SchemaField("return_request_date", "TIMESTAMP", mode="REQUIRED", description="반품요청일"),
    bigquery.SchemaField("return_approved_date", "TIMESTAMP", mode="NULLABLE", description="반품승인일"),
    bigquery.SchemaField("return_completed_date", "TIMESTAMP", mode="NULLABLE", description="반품완료일"),
    bigquery.SchemaField("collect_delivery_company", "STRING", mode="NULLABLE", description="수거택배사"),
    bigquery.SchemaField("collect_invoice_number", "STRING", mode="NULLABLE", description="수거운송장번호"),
    bigquery.SchemaField("refund_amount", "INTEGER", mode="NULLABLE", description="환불금액"),
    bigquery.SchemaField("refund_delivery_fee", "INTEGER", mode="NULLABLE", description="환불배송비"),
    bigquery.SchemaField("refund_date", "TIMESTAMP", mode="NULLABLE", description="환불일시"),
    bigquery.SchemaField("created_at", "TIMESTAMP", mode="REQUIRED", description="생성일시"),
    bigquery.SchemaField("updated_at", "TIMESTAMP", mode="REQUIRED", description="수정일시"),
    bigquery.SchemaField("synced_at", "TIMESTAMP", mode="REQUIRED", description="동기화일시"),
]

SMARTSTORE_SETTLEMENTS_SCHEMA = [
    bigquery.SchemaField("settlement_id", "STRING", mode="REQUIRED", description="정산ID"),
    bigquery.SchemaField("channel_id", "STRING", mode="REQUIRED", description="채널(스토어) ID"),
    bigquery.SchemaField("settlement_date", "DATE", mode="REQUIRED", description="정산일"),
    bigquery.SchemaField("order_id", "STRING", mode="REQUIRED", description="주문번호"),
    bigquery.SchemaField("product_id", "STRING", mode="REQUIRED", description="상품ID"),
    bigquery.SchemaField("product_name", "STRING", mode="REQUIRED", description="상품명"),
    bigquery.SchemaField("option_name", "STRING", mode="NULLABLE", description="옵션명"),
    bigquery.SchemaField("quantity", "INTEGER", mode="REQUIRED", description="수량"),
    bigquery.SchemaField("order_amount", "INTEGER", mode="REQUIRED", description="주문금액"),
    bigquery.SchemaField("discount_amount", "INTEGER", mode="NULLABLE", description="할인금액"),
    bigquery.SchemaField("naver_discount_amount", "INTEGER", mode="NULLABLE", description="네이버할인금액"),
    bigquery.SchemaField("seller_discount_amount", "INTEGER", mode="NULLABLE", description="판매자할인금액"),
    bigquery.SchemaField("delivery_fee", "INTEGER", mode="NULLABLE", description="배송비"),
    bigquery.SchemaField("commission_rate", "FLOAT", mode="REQUIRED", description="수수료율"),
    bigquery.SchemaField("commission_amount", "INTEGER", mode="REQUIRED", description="수수료"),
    bigquery.SchemaField("service_fee_amount", "INTEGER", mode="NULLABLE", description="서비스이용료"),
    bigquery.SchemaField("billing_amount", "INTEGER", mode="NULLABLE", description="과금액"),
    bigquery.SchemaField("settlement_amount", "INTEGER", mode="REQUIRED", description="정산금액"),
    bigquery.SchemaField("vat_amount", "INTEGER", mode="NULLABLE", description="부가세"),
    bigquery.SchemaField("settlement_status", "STRING", mode="REQUIRED", description="정산상태"),
    bigquery.SchemaField("purchase_confirm_date", "TIMESTAMP", mode="NULLABLE", description="구매확정일시"),
    bigquery.SchemaField("settlement_start_date", "DATE", mode="NULLABLE", description="정산시작일"),
    bigquery.SchemaField("settlement_end_date", "DATE", mode="NULLABLE", description="정산종료일"),
    bigquery.SchemaField("payment_date", "DATE", mode="NULLABLE", description="지급예정일"),
    bigquery.SchemaField("created_at", "TIMESTAMP", mode="REQUIRED", description="생성일시"),
    bigquery.SchemaField("updated_at", "TIMESTAMP", mode="REQUIRED", description="수정일시"),
    bigquery.SchemaField("synced_at", "TIMESTAMP", mode="REQUIRED", description="동기화일시"),
]

SMARTSTORE_SALES_STATS_SCHEMA = [
    bigquery.SchemaField("stat_date", "DATE", mode="REQUIRED", description="통계일자"),
    bigquery.SchemaField("channel_id", "STRING", mode="REQUIRED", description="채널(스토어) ID"),
    bigquery.SchemaField("interval_type", "STRING", mode="REQUIRED", description="집계구간(DAILY/WEEKLY/MONTHLY)"),
    bigquery.SchemaField("order_count", "INTEGER", mode="REQUIRED", description="주문건수"),
    bigquery.SchemaField("order_amount", "INTEGER", mode="REQUIRED", description="주문금액"),
    bigquery.SchemaField("payment_count", "INTEGER", mode="REQUIRED", description="결제건수"),
    bigquery.SchemaField("payment_amount", "INTEGER", mode="REQUIRED", description="결제금액"),
    bigquery.SchemaField("refund_count", "INTEGER", mode="NULLABLE", description="환불건수"),
    bigquery.SchemaField("refund_amount", "INTEGER", mode="NULLABLE", description="환불금액"),
    bigquery.SchemaField("net_sales_amount", "INTEGER", mode="REQUIRED", description="순매출액"),
    bigquery.SchemaField("visitor_count", "INTEGER", mode="NULLABLE", description="방문자수"),
    bigquery.SchemaField("page_view_count", "INTEGER", mode="NULLABLE", description="페이지뷰"),
    bigquery.SchemaField("conversion_rate", "FLOAT", mode="NULLABLE", description="전환율"),
    bigquery.SchemaField("average_order_value", "FLOAT", mode="NULLABLE", description="평균주문금액"),
    bigquery.SchemaField("created_at", "TIMESTAMP", mode="REQUIRED", description="생성일시"),
    bigquery.SchemaField("synced_at", "TIMESTAMP", mode="REQUIRED", description="동기화일시"),
]

SMARTSTORE_INVENTORY_SCHEMA = [
    bigquery.SchemaField("product_id", "STRING", mode="REQUIRED", description="상품ID"),
    bigquery.SchemaField("channel_id", "STRING", mode="REQUIRED", description="채널(스토어) ID"),
    bigquery.SchemaField("option_id", "STRING", mode="NULLABLE", description="옵션ID"),
    bigquery.SchemaField("option_name", "STRING", mode="NULLABLE", description="옵션명"),
    bigquery.SchemaField("available_quantity", "INTEGER", mode="REQUIRED", description="가용재고"),
    bigquery.SchemaField("onhand_quantity", "INTEGER", mode="REQUIRED", description="실재고"),
    bigquery.SchemaField("reserved_quantity", "INTEGER", mode="NULLABLE", description="예약재고"),
    bigquery.SchemaField("safety_stock_quantity", "INTEGER", mode="NULLABLE", description="안전재고"),
    bigquery.SchemaField("incoming_quantity", "INTEGER", mode="NULLABLE", description="입고예정수량"),
    bigquery.SchemaField("last_updated_at", "TIMESTAMP", mode="REQUIRED", description="최종업데이트일시"),
    bigquery.SchemaField("created_at", "TIMESTAMP", mode="REQUIRED", description="생성일시"),
    bigquery.SchemaField("synced_at", "TIMESTAMP", mode="REQUIRED", description="동기화일시"),
]

SMARTSTORE_REVIEWS_SCHEMA = [
    bigquery.SchemaField("review_id", "STRING", mode="REQUIRED", description="리뷰ID"),
    bigquery.SchemaField("order_id", "STRING", mode="REQUIRED", description="주문번호"),
    bigquery.SchemaField("channel_id", "STRING", mode="REQUIRED", description="채널(스토어) ID"),
    bigquery.SchemaField("product_id", "STRING", mode="REQUIRED", description="상품ID"),
    bigquery.SchemaField("product_name", "STRING", mode="REQUIRED", description="상품명"),
    bigquery.SchemaField("option_name", "STRING", mode="NULLABLE", description="옵션명"),
    bigquery.SchemaField("reviewer_id", "STRING", mode="NULLABLE", description="리뷰어ID"),
    bigquery.SchemaField("reviewer_name", "STRING", mode="REQUIRED", description="리뷰어명"),
    bigquery.SchemaField("rating", "INTEGER", mode="REQUIRED", description="평점"),
    bigquery.SchemaField("title", "STRING", mode="NULLABLE", description="리뷰제목"),
    bigquery.SchemaField("content", "STRING", mode="REQUIRED", description="리뷰내용"),
    bigquery.SchemaField("images", "JSON", mode="NULLABLE", description="리뷰이미지"),
    bigquery.SchemaField("is_best_review", "BOOLEAN", mode="NULLABLE", description="베스트리뷰여부"),
    bigquery.SchemaField("reply_content", "STRING", mode="NULLABLE", description="답글내용"),
    bigquery.SchemaField("reply_date", "TIMESTAMP", mode="NULLABLE", description="답글작성일"),
    bigquery.SchemaField("helpful_count", "INTEGER", mode="NULLABLE", description="도움수"),
    bigquery.SchemaField("review_date", "TIMESTAMP", mode="REQUIRED", description="리뷰작성일"),
    bigquery.SchemaField("created_at", "TIMESTAMP", mode="REQUIRED", description="생성일시"),
    bigquery.SchemaField("updated_at", "TIMESTAMP", mode="REQUIRED", description="수정일시"),
    bigquery.SchemaField("synced_at", "TIMESTAMP", mode="REQUIRED", description="동기화일시"),
]

SMARTSTORE_INQUIRIES_SCHEMA = [
    bigquery.SchemaField("inquiry_id", "STRING", mode="REQUIRED", description="문의ID"),
    bigquery.SchemaField("channel_id", "STRING", mode="REQUIRED", description="채널(스토어) ID"),
    bigquery.SchemaField("product_id", "STRING", mode="NULLABLE", description="상품ID"),
    bigquery.SchemaField("product_name", "STRING", mode="NULLABLE", description="상품명"),
    bigquery.SchemaField("inquiry_type", "STRING", mode="REQUIRED", description="문의유형"),
    bigquery.SchemaField("inquirer_id", "STRING", mode="NULLABLE", description="문의자ID"),
    bigquery.SchemaField("inquirer_name", "STRING", mode="REQUIRED", description="문의자명"),
    bigquery.SchemaField("title", "STRING", mode="REQUIRED", description="문의제목"),
    bigquery.SchemaField("content", "STRING", mode="REQUIRED", description="문의내용"),
    bigquery.SchemaField("is_secret", "BOOLEAN", mode="NULLABLE", description="비밀글여부"),
    bigquery.SchemaField("is_answered", "BOOLEAN", mode="REQUIRED", description="답변여부"),
    bigquery.SchemaField("answer_content", "STRING", mode="NULLABLE", description="답변내용"),
    bigquery.SchemaField("answer_date", "TIMESTAMP", mode="NULLABLE", description="답변일시"),
    bigquery.SchemaField("inquiry_date", "TIMESTAMP", mode="REQUIRED", description="문의일시"),
    bigquery.SchemaField("created_at", "TIMESTAMP", mode="REQUIRED", description="생성일시"),
    bigquery.SchemaField("updated_at", "TIMESTAMP", mode="REQUIRED", description="수정일시"),
    bigquery.SchemaField("synced_at", "TIMESTAMP", mode="REQUIRED", description="동기화일시"),
]


def create_smartstore_tables(client: bigquery.Client, dataset_id: str):
    """스마트스토어 관련 BigQuery 테이블 생성"""
    tables = {
        "smartstore_products": SMARTSTORE_PRODUCTS_SCHEMA,
        "smartstore_orders": SMARTSTORE_ORDERS_SCHEMA,
        "smartstore_returns": SMARTSTORE_RETURNS_SCHEMA,
        "smartstore_settlements": SMARTSTORE_SETTLEMENTS_SCHEMA,
        "smartstore_sales_stats": SMARTSTORE_SALES_STATS_SCHEMA,
        "smartstore_inventory": SMARTSTORE_INVENTORY_SCHEMA,
        "smartstore_reviews": SMARTSTORE_REVIEWS_SCHEMA,
        "smartstore_inquiries": SMARTSTORE_INQUIRIES_SCHEMA,
    }

    for table_name, schema in tables.items():
        table_id = f"{client.project}.{dataset_id}.{table_name}"
        table = bigquery.Table(table_id, schema=schema)

        # 테이블 파티셔닝 설정
        if table_name in ["smartstore_orders", "smartstore_returns", "smartstore_settlements"]:
            table.time_partitioning = bigquery.TimePartitioning(
                type_=bigquery.TimePartitioningType.DAY,
                field="created_at"
            )
        elif table_name == "smartstore_sales_stats":
            table.time_partitioning = bigquery.TimePartitioning(
                type_=bigquery.TimePartitioningType.DAY,
                field="stat_date"
            )

        # 테이블 클러스터링 설정
        if table_name == "smartstore_orders":
            table.clustering_fields = ["channel_id", "order_status"]
        elif table_name == "smartstore_products":
            table.clustering_fields = ["channel_id", "status"]
        elif table_name == "smartstore_settlements":
            table.clustering_fields = ["channel_id", "settlement_date"]
        elif table_name == "smartstore_sales_stats":
            table.clustering_fields = ["channel_id", "interval_type"]

        try:
            table = client.create_table(table)
            print(f"Created table {table.project}.{table.dataset_id}.{table.table_id}")
        except Exception as e:
            print(f"Table {table_id} already exists or error: {e}")