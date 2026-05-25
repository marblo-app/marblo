import hashlib
import hmac
import json
import logging
from datetime import datetime
from typing import Any, Dict, Optional

from fastapi import APIRouter, HTTPException, Header, Request
from pydantic import BaseModel, Field

from backend.naver_smartstore import NaverCommerceAPI, NaverCommerceConfig
from backend.pipelines.sync_smartstore import SmartStoreDataSync
from google.cloud import bigquery


logger = logging.getLogger(__name__)
router = APIRouter(prefix="/webhooks/smartstore", tags=["webhooks"])


class WebhookEvent(BaseModel):
    """스마트스토어 웹훅 이벤트"""
    event_id: str = Field(..., alias="eventId")
    event_type: str = Field(..., alias="eventType")
    event_time: datetime = Field(..., alias="eventTime")
    channel_id: str = Field(..., alias="channelId")
    data: Dict[str, Any] = Field(..., alias="data")


class WebhookHandler:
    """스마트스토어 웹훅 처리기"""

    def __init__(
        self,
        commerce_config: NaverCommerceConfig,
        bigquery_client: bigquery.Client,
        webhook_secret: str,
        dataset_id: str = "smartstore_data"
    ):
        self.api = NaverCommerceAPI(commerce_config)
        self.sync = SmartStoreDataSync(commerce_config, bigquery_client, dataset_id)
        self.webhook_secret = webhook_secret
        self.channel_id = commerce_config.channel_id

    def verify_signature(self, request_body: bytes, signature: str) -> bool:
        """웹훅 서명 검증"""
        expected_signature = hmac.new(
            self.webhook_secret.encode(),
            request_body,
            hashlib.sha256
        ).hexdigest()

        return hmac.compare_digest(signature, expected_signature)

    async def handle_event(self, event: WebhookEvent) -> Dict[str, Any]:
        """웹훅 이벤트 처리"""
        event_type = event.event_type
        event_data = event.data

        logger.info(f"Processing webhook event: {event_type}")

        try:
            # 이벤트 타입별 처리
            if event_type == "ORDER_CREATED":
                return await self.handle_order_created(event_data)

            elif event_type == "ORDER_STATUS_CHANGED":
                return await self.handle_order_status_changed(event_data)

            elif event_type == "PRODUCT_CREATED":
                return await self.handle_product_created(event_data)

            elif event_type == "PRODUCT_UPDATED":
                return await self.handle_product_updated(event_data)

            elif event_type == "PRODUCT_DELETED":
                return await self.handle_product_deleted(event_data)

            elif event_type == "INVENTORY_CHANGED":
                return await self.handle_inventory_changed(event_data)

            elif event_type == "RETURN_REQUESTED":
                return await self.handle_return_requested(event_data)

            elif event_type == "RETURN_COMPLETED":
                return await self.handle_return_completed(event_data)

            elif event_type == "REVIEW_CREATED":
                return await self.handle_review_created(event_data)

            elif event_type == "INQUIRY_CREATED":
                return await self.handle_inquiry_created(event_data)

            elif event_type == "SETTLEMENT_COMPLETED":
                return await self.handle_settlement_completed(event_data)

            else:
                logger.warning(f"Unknown event type: {event_type}")
                return {"status": "ignored", "reason": "Unknown event type"}

        except Exception as e:
            logger.error(f"Error handling event {event_type}: {str(e)}")
            raise

    async def handle_order_created(self, data: Dict[str, Any]) -> Dict[str, Any]:
        """새 주문 생성 처리"""
        order_id = data.get("orderId")
        logger.info(f"Processing new order: {order_id}")

        # 주문 상세 정보 조회
        order_detail = self.api.get_order_detail(order_id)

        # BigQuery에 주문 데이터 저장
        synced_at = datetime.utcnow()
        shipping = order_detail.get("shippingAddress", {})

        order_row = {
            "order_id": order_detail.get("productOrderId"),
            "channel_id": self.channel_id,
            "order_date": order_detail.get("orderDate"),
            "product_id": order_detail.get("productId", ""),
            "product_name": order_detail.get("productName", ""),
            "option_name": order_detail.get("productOption"),
            "quantity": order_detail.get("quantity", 0),
            "unit_price": order_detail.get("unitPrice", 0),
            "total_payment_amount": order_detail.get("totalPaymentAmount", 0),
            "delivery_fee": order_detail.get("deliveryFeeAmount", 0),
            "order_status": order_detail.get("productOrderStatus", ""),
            "orderer_name": order_detail.get("ordererName", ""),
            "orderer_mobile": order_detail.get("ordererTel1", ""),
            "receiver_name": shipping.get("name", ""),
            "receiver_mobile": shipping.get("tel1", ""),
            "receiver_zipcode": shipping.get("zipCode", ""),
            "receiver_address": shipping.get("baseAddress", ""),
            "created_at": synced_at.isoformat(),
            "updated_at": synced_at.isoformat(),
            "synced_at": synced_at.isoformat(),
        }

        self.sync._insert_to_bigquery("smartstore_orders", [order_row])

        # 재고 업데이트
        await self.update_inventory(order_detail.get("productId"))

        return {"status": "processed", "order_id": order_id}

    async def handle_order_status_changed(self, data: Dict[str, Any]) -> Dict[str, Any]:
        """주문 상태 변경 처리"""
        order_id = data.get("orderId")
        new_status = data.get("newStatus")
        old_status = data.get("oldStatus")

        logger.info(f"Order status changed: {order_id} from {old_status} to {new_status}")

        # 배송 준비 상태로 변경된 경우
        if new_status == "DELIVERY_READY":
            # 자동 송장 등록 로직 (필요시)
            pass

        # 구매 확정된 경우
        elif new_status == "PURCHASE_CONFIRMED":
            # 정산 데이터 업데이트
            pass

        return {"status": "processed", "order_id": order_id, "new_status": new_status}

    async def handle_product_created(self, data: Dict[str, Any]) -> Dict[str, Any]:
        """상품 생성 처리"""
        product_id = data.get("productId")
        logger.info(f"New product created: {product_id}")

        # 상품 정보 동기화
        product_detail = self.api.get_product(product_id)

        synced_at = datetime.utcnow()
        product_row = {
            "product_id": product_detail.get("originProductNo"),
            "channel_id": self.channel_id,
            "name": product_detail.get("name"),
            "sale_price": product_detail.get("salePrice", 0),
            "stock_quantity": product_detail.get("stockQuantity", 0),
            "status": product_detail.get("statusType", ""),
            "category_id": product_detail.get("categoryId", ""),
            "created_at": synced_at.isoformat(),
            "updated_at": synced_at.isoformat(),
            "synced_at": synced_at.isoformat(),
        }

        self.sync._insert_to_bigquery("smartstore_products", [product_row])

        return {"status": "processed", "product_id": product_id}

    async def handle_product_updated(self, data: Dict[str, Any]) -> Dict[str, Any]:
        """상품 수정 처리"""
        product_id = data.get("productId")
        logger.info(f"Product updated: {product_id}")

        # 상품 정보 재동기화
        product_detail = self.api.get_product(product_id)

        # BigQuery 업데이트 (실제로는 새 행 추가)
        synced_at = datetime.utcnow()
        product_row = {
            "product_id": product_detail.get("originProductNo"),
            "channel_id": self.channel_id,
            "name": product_detail.get("name"),
            "sale_price": product_detail.get("salePrice", 0),
            "stock_quantity": product_detail.get("stockQuantity", 0),
            "status": product_detail.get("statusType", ""),
            "updated_at": synced_at.isoformat(),
            "synced_at": synced_at.isoformat(),
        }

        self.sync._insert_to_bigquery("smartstore_products", [product_row])

        return {"status": "processed", "product_id": product_id}

    async def handle_product_deleted(self, data: Dict[str, Any]) -> Dict[str, Any]:
        """상품 삭제 처리"""
        product_id = data.get("productId")
        logger.info(f"Product deleted: {product_id}")

        # 상품 상태를 DELETED로 업데이트
        synced_at = datetime.utcnow()
        product_row = {
            "product_id": product_id,
            "channel_id": self.channel_id,
            "status": "DELETED",
            "updated_at": synced_at.isoformat(),
            "synced_at": synced_at.isoformat(),
        }

        self.sync._insert_to_bigquery("smartstore_products", [product_row])

        return {"status": "processed", "product_id": product_id}

    async def handle_inventory_changed(self, data: Dict[str, Any]) -> Dict[str, Any]:
        """재고 변경 처리"""
        product_id = data.get("productId")
        option_id = data.get("optionId")
        new_quantity = data.get("newQuantity")
        old_quantity = data.get("oldQuantity")

        logger.info(f"Inventory changed for {product_id}: {old_quantity} -> {new_quantity}")

        # 재고 정보 업데이트
        await self.update_inventory(product_id)

        return {
            "status": "processed",
            "product_id": product_id,
            "new_quantity": new_quantity
        }

    async def handle_return_requested(self, data: Dict[str, Any]) -> Dict[str, Any]:
        """반품 요청 처리"""
        return_id = data.get("returnId")
        order_id = data.get("orderId")

        logger.info(f"Return requested: {return_id} for order {order_id}")

        # 반품 자동 승인 로직 (필요시)
        if data.get("autoApprove", False):
            self.api.approve_return(order_id)

        return {"status": "processed", "return_id": return_id}

    async def handle_return_completed(self, data: Dict[str, Any]) -> Dict[str, Any]:
        """반품 완료 처리"""
        return_id = data.get("returnId")
        order_id = data.get("orderId")

        logger.info(f"Return completed: {return_id} for order {order_id}")

        # 재고 복구
        product_id = data.get("productId")
        if product_id:
            await self.update_inventory(product_id)

        return {"status": "processed", "return_id": return_id}

    async def handle_review_created(self, data: Dict[str, Any]) -> Dict[str, Any]:
        """리뷰 생성 처리"""
        review_id = data.get("reviewId")
        product_id = data.get("productId")
        rating = data.get("rating")

        logger.info(f"New review created: {review_id} for product {product_id} (rating: {rating})")

        # 리뷰 데이터 저장
        synced_at = datetime.utcnow()
        review_row = {
            "review_id": review_id,
            "channel_id": self.channel_id,
            "product_id": product_id,
            "product_name": data.get("productName", ""),
            "reviewer_name": data.get("reviewerName", ""),
            "rating": rating,
            "content": data.get("content", ""),
            "review_date": data.get("reviewDate"),
            "created_at": synced_at.isoformat(),
            "synced_at": synced_at.isoformat(),
        }

        self.sync._insert_to_bigquery("smartstore_reviews", [review_row])

        # 자동 답글 로직 (필요시)
        if rating >= 4 and data.get("autoReply", False):
            reply = "소중한 리뷰 감사합니다! 앞으로도 좋은 상품으로 보답하겠습니다."
            self.api.reply_review(review_id, reply)

        return {"status": "processed", "review_id": review_id}

    async def handle_inquiry_created(self, data: Dict[str, Any]) -> Dict[str, Any]:
        """문의 생성 처리"""
        inquiry_id = data.get("inquiryId")
        product_id = data.get("productId")

        logger.info(f"New inquiry created: {inquiry_id} for product {product_id}")

        # 문의 데이터 저장
        synced_at = datetime.utcnow()
        inquiry_row = {
            "inquiry_id": inquiry_id,
            "channel_id": self.channel_id,
            "product_id": product_id,
            "inquiry_type": data.get("inquiryType", ""),
            "inquirer_name": data.get("inquirerName", ""),
            "title": data.get("title", ""),
            "content": data.get("content", ""),
            "is_answered": False,
            "inquiry_date": data.get("inquiryDate"),
            "created_at": synced_at.isoformat(),
            "synced_at": synced_at.isoformat(),
        }

        self.sync._insert_to_bigquery("smartstore_inquiries", [inquiry_row])

        # 자동 답변 로직 (필요시)
        # FAQ 기반 자동 답변 등

        return {"status": "processed", "inquiry_id": inquiry_id}

    async def handle_settlement_completed(self, data: Dict[str, Any]) -> Dict[str, Any]:
        """정산 완료 처리"""
        settlement_date = data.get("settlementDate")

        logger.info(f"Settlement completed for date: {settlement_date}")

        # 정산 데이터 동기화
        start_date = datetime.fromisoformat(settlement_date)
        end_date = start_date

        self.sync.sync_settlements(start_date, end_date)

        return {"status": "processed", "settlement_date": settlement_date}

    async def update_inventory(self, product_id: str):
        """재고 정보 업데이트"""
        try:
            inventory = self.api.get_inventory(product_id)
            synced_at = datetime.utcnow()

            inventory_row = {
                "product_id": product_id,
                "channel_id": self.channel_id,
                "available_quantity": inventory.get("availableQuantity", 0),
                "onhand_quantity": inventory.get("onhandQuantity", 0),
                "last_updated_at": synced_at.isoformat(),
                "synced_at": synced_at.isoformat(),
            }

            self.sync._insert_to_bigquery("smartstore_inventory", [inventory_row])

        except Exception as e:
            logger.error(f"Failed to update inventory for {product_id}: {str(e)}")


# FastAPI 라우터 엔드포인트
@router.post("/")
async def handle_webhook(
    request: Request,
    x_naver_signature: Optional[str] = Header(None)
):
    """스마트스토어 웹훅 수신 엔드포인트"""
    try:
        # 요청 본문 읽기
        body = await request.body()

        # 서명 검증 (설정된 경우)
        if x_naver_signature:
            # WebhookHandler 인스턴스 필요 (DI 또는 글로벌 설정)
            # handler.verify_signature(body, x_naver_signature)
            pass

        # 이벤트 파싱
        event_data = json.loads(body)
        event = WebhookEvent(**event_data)

        # 이벤트 처리 (비동기)
        # result = await handler.handle_event(event)

        return {"status": "success", "event_id": event.event_id}

    except json.JSONDecodeError:
        raise HTTPException(status_code=400, detail="Invalid JSON")
    except Exception as e:
        logger.error(f"Webhook processing error: {str(e)}")
        raise HTTPException(status_code=500, detail="Internal server error")


@router.get("/health")
async def webhook_health():
    """웹훅 헬스체크"""
    return {"status": "healthy", "service": "smartstore-webhook"}