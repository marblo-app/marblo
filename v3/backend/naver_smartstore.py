import base64
import hashlib
import json
import logging
import time
from datetime import datetime, timedelta
from typing import Any, Dict, List, Optional
from urllib.parse import urlencode

import httpx
from pydantic import BaseModel, Field


logger = logging.getLogger(__name__)


class NaverCommerceConfig(BaseModel):
    """네이버 커머스 API 설정"""
    client_id: str = Field(..., description="OAuth Client ID")
    client_secret: str = Field(..., description="OAuth Client Secret")
    redirect_uri: str = Field(..., description="OAuth Redirect URI")
    access_token: Optional[str] = Field(None, description="OAuth Access Token")
    refresh_token: Optional[str] = Field(None, description="OAuth Refresh Token")
    channel_id: Optional[str] = Field(None, description="Channel ID (스토어 ID)")
    base_url: str = Field(default="https://api.commerce.naver.com", description="API Base URL")
    timeout: int = Field(default=30, description="Request timeout in seconds")


class SmartStoreProduct(BaseModel):
    """스마트스토어 상품 정보"""
    product_id: Optional[str] = Field(None, alias="originProductNo")
    channel_product_id: Optional[str] = Field(None, alias="channelProductNo")
    name: str = Field(..., alias="name")
    sale_price: int = Field(..., alias="salePrice")
    discount_price: Optional[int] = Field(None, alias="discountedPrice")
    mobile_discount_price: Optional[int] = Field(None, alias="mobileDiscountedPrice")
    stock_quantity: int = Field(..., alias="stockQuantity")
    status: str = Field(..., alias="statusType")
    category_id: str = Field(..., alias="categoryId")
    brand: Optional[str] = Field(None, alias="brand")
    manufacturer: Optional[str] = Field(None, alias="manufacturer")
    origin: Optional[str] = Field(None, alias="origin")
    images: List[str] = Field(default_factory=list, alias="images")
    detail_content: Optional[str] = Field(None, alias="detailContent")
    delivery_fee_type: str = Field(..., alias="deliveryFeeType")
    delivery_fee: Optional[int] = Field(None, alias="baseFee")
    delivery_method: str = Field(default="DELIVERY", alias="deliveryMethodType")
    sale_start_date: Optional[datetime] = Field(None, alias="saleStartDate")
    sale_end_date: Optional[datetime] = Field(None, alias="saleEndDate")
    attributes: Optional[Dict[str, Any]] = Field(None, alias="detailAttribute")


class SmartStoreOrder(BaseModel):
    """스마트스토어 주문 정보"""
    order_id: str = Field(..., alias="productOrderId")
    order_date: datetime = Field(..., alias="orderDate")
    product_id: str = Field(..., alias="productId")
    product_name: str = Field(..., alias="productName")
    option_name: Optional[str] = Field(None, alias="productOption")
    quantity: int = Field(..., alias="quantity")
    unit_price: int = Field(..., alias="unitPrice")
    total_payment_amount: int = Field(..., alias="totalPaymentAmount")
    delivery_fee: int = Field(..., alias="deliveryFeeAmount")
    order_status: str = Field(..., alias="productOrderStatus")
    claim_status: Optional[str] = Field(None, alias="claimStatus")
    claim_type: Optional[str] = Field(None, alias="claimType")
    orderer_name: str = Field(..., alias="ordererName")
    orderer_tel: Optional[str] = Field(None, alias="ordererTel")
    orderer_mobile: str = Field(..., alias="ordererTel1")
    receiver_name: str = Field(..., alias="shippingAddress.name")
    receiver_tel: Optional[str] = Field(None, alias="shippingAddress.tel")
    receiver_mobile: str = Field(..., alias="shippingAddress.tel1")
    receiver_zipcode: str = Field(..., alias="shippingAddress.zipCode")
    receiver_address: str = Field(..., alias="shippingAddress.baseAddress")
    receiver_detail_address: Optional[str] = Field(None, alias="shippingAddress.detailAddress")
    delivery_message: Optional[str] = Field(None, alias="shippingMemo")
    delivery_company: Optional[str] = Field(None, alias="deliveryCompany")
    invoice_number: Optional[str] = Field(None, alias="trackingNumber")
    dispatched_date: Optional[datetime] = Field(None, alias="dispatchDate")
    delivered_date: Optional[datetime] = Field(None, alias="deliveredDate")


class SmartStoreSettlement(BaseModel):
    """스마트스토어 정산 정보"""
    settlement_date: datetime = Field(..., alias="settleDate")
    order_id: str = Field(..., alias="productOrderId")
    product_id: str = Field(..., alias="productId")
    product_name: str = Field(..., alias="productName")
    option_name: Optional[str] = Field(None, alias="productOption")
    quantity: int = Field(..., alias="quantity")
    order_amount: int = Field(..., alias="orderAmount")
    discount_amount: int = Field(..., alias="productDiscountAmount")
    delivery_fee: int = Field(..., alias="deliveryFeeAmount")
    commission_amount: int = Field(..., alias="commissionAmount")
    settlement_amount: int = Field(..., alias="settleAmount")
    purchase_confirm_date: Optional[datetime] = Field(None, alias="purchaseConfirmDate")
    commission_rate: float = Field(..., alias="commissionRate")
    settlement_status: str = Field(..., alias="settleStatus")


class NaverCommerceAPI:
    """네이버 커머스 API 클라이언트"""

    def __init__(self, config: NaverCommerceConfig):
        self.config = config
        self.client = httpx.Client(timeout=config.timeout)
        self._token_expires_at = None

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc_val, exc_tb):
        self.close()

    def close(self):
        """클라이언트 종료"""
        self.client.close()

    def get_authorization_url(self, state: Optional[str] = None) -> str:
        """OAuth 인증 URL 생성"""
        params = {
            "response_type": "code",
            "client_id": self.config.client_id,
            "redirect_uri": self.config.redirect_uri,
            "state": state or base64.b64encode(str(time.time()).encode()).decode()
        }
        return f"https://auth.commerce.naver.com/oauth2/authorize?{urlencode(params)}"

    def get_access_token(self, authorization_code: str) -> Dict[str, Any]:
        """인증 코드로 액세스 토큰 획득"""
        url = "https://auth.commerce.naver.com/oauth2/token"

        data = {
            "grant_type": "authorization_code",
            "client_id": self.config.client_id,
            "client_secret": self.config.client_secret,
            "code": authorization_code,
            "redirect_uri": self.config.redirect_uri
        }

        response = self.client.post(url, data=data)
        if response.status_code != 200:
            raise Exception(f"Failed to get access token: {response.text}")

        token_data = response.json()

        # 토큰 정보 저장
        self.config.access_token = token_data["access_token"]
        self.config.refresh_token = token_data.get("refresh_token")
        self._token_expires_at = datetime.utcnow() + timedelta(seconds=token_data.get("expires_in", 3600))

        return token_data

    def refresh_access_token(self) -> Dict[str, Any]:
        """리프레시 토큰으로 액세스 토큰 갱신"""
        if not self.config.refresh_token:
            raise Exception("Refresh token not available")

        url = "https://auth.commerce.naver.com/oauth2/token"

        data = {
            "grant_type": "refresh_token",
            "client_id": self.config.client_id,
            "client_secret": self.config.client_secret,
            "refresh_token": self.config.refresh_token
        }

        response = self.client.post(url, data=data)
        if response.status_code != 200:
            raise Exception(f"Failed to refresh access token: {response.text}")

        token_data = response.json()

        # 새 토큰 정보 저장
        self.config.access_token = token_data["access_token"]
        if "refresh_token" in token_data:
            self.config.refresh_token = token_data["refresh_token"]
        self._token_expires_at = datetime.utcnow() + timedelta(seconds=token_data.get("expires_in", 3600))

        return token_data

    def _ensure_valid_token(self):
        """토큰 유효성 확인 및 필요시 갱신"""
        if not self.config.access_token:
            raise Exception("Access token not available. Please authenticate first.")

        if self._token_expires_at and datetime.utcnow() >= self._token_expires_at - timedelta(minutes=5):
            logger.info("Access token is expiring soon. Refreshing...")
            self.refresh_access_token()

    def _make_request(
        self,
        method: str,
        endpoint: str,
        params: Optional[Dict] = None,
        json_data: Optional[Dict] = None,
        data: Optional[Dict] = None
    ) -> Dict[str, Any]:
        """API 요청 실행"""
        self._ensure_valid_token()

        url = f"{self.config.base_url}{endpoint}"

        headers = {
            "Authorization": f"Bearer {self.config.access_token}",
            "Content-Type": "application/json"
        }

        response = self.client.request(
            method=method,
            url=url,
            headers=headers,
            params=params,
            json=json_data,
            data=data
        )

        if response.status_code == 401:
            # 토큰 만료시 갱신 후 재시도
            logger.info("Access token expired. Refreshing and retrying...")
            self.refresh_access_token()

            headers["Authorization"] = f"Bearer {self.config.access_token}"
            response = self.client.request(
                method=method,
                url=url,
                headers=headers,
                params=params,
                json=json_data,
                data=data
            )

        if response.status_code >= 400:
            error_data = response.json() if response.text else {}
            raise Exception(f"API Error {response.status_code}: {error_data}")

        return response.json()

    # 상품 관리 API
    def get_products(
        self,
        page: int = 1,
        size: int = 100,
        status: Optional[str] = None
    ) -> Dict[str, Any]:
        """상품 목록 조회"""
        params = {
            "page": page,
            "size": size
        }
        if status:
            params["statusType"] = status

        return self._make_request(
            method="GET",
            endpoint="/partner/products",
            params=params
        )

    def get_product(self, product_no: str) -> Dict[str, Any]:
        """상품 상세 조회"""
        return self._make_request(
            method="GET",
            endpoint=f"/partner/products/{product_no}"
        )

    def create_product(self, product: SmartStoreProduct) -> Dict[str, Any]:
        """상품 등록"""
        return self._make_request(
            method="POST",
            endpoint="/partner/products",
            json_data=product.dict(by_alias=True, exclude_none=True)
        )

    def update_product(self, product_no: str, product: SmartStoreProduct) -> Dict[str, Any]:
        """상품 수정"""
        return self._make_request(
            method="PUT",
            endpoint=f"/partner/products/{product_no}",
            json_data=product.dict(by_alias=True, exclude_none=True)
        )

    def delete_product(self, product_no: str) -> Dict[str, Any]:
        """상품 삭제"""
        return self._make_request(
            method="DELETE",
            endpoint=f"/partner/products/{product_no}"
        )

    def update_product_status(
        self,
        product_no: str,
        status: str  # SALE, SUSPENSION, CLOSE
    ) -> Dict[str, Any]:
        """상품 상태 변경"""
        return self._make_request(
            method="PATCH",
            endpoint=f"/partner/products/{product_no}/status",
            json_data={"statusType": status}
        )

    # 주문 관리 API
    def get_orders(
        self,
        start_date: datetime,
        end_date: datetime,
        status: Optional[str] = None,
        page: int = 1,
        size: int = 100
    ) -> Dict[str, Any]:
        """주문 목록 조회"""
        params = {
            "startDate": start_date.strftime("%Y-%m-%d"),
            "endDate": end_date.strftime("%Y-%m-%d"),
            "page": page,
            "size": size
        }
        if status:
            params["productOrderStatus"] = status

        return self._make_request(
            method="GET",
            endpoint="/partner/orders",
            params=params
        )

    def get_order_detail(self, order_id: str) -> Dict[str, Any]:
        """주문 상세 조회"""
        return self._make_request(
            method="GET",
            endpoint=f"/partner/orders/{order_id}"
        )

    def dispatch_order(
        self,
        order_id: str,
        delivery_company: str,
        invoice_number: str
    ) -> Dict[str, Any]:
        """발송 처리 (송장 등록)"""
        return self._make_request(
            method="POST",
            endpoint=f"/partner/orders/{order_id}/dispatch",
            json_data={
                "deliveryCompany": delivery_company,
                "trackingNumber": invoice_number,
                "dispatchDate": datetime.utcnow().isoformat()
            }
        )

    def cancel_order(self, order_id: str, reason: str) -> Dict[str, Any]:
        """주문 취소"""
        return self._make_request(
            method="POST",
            endpoint=f"/partner/orders/{order_id}/cancel",
            json_data={"cancelReason": reason}
        )

    def approve_return(self, order_id: str) -> Dict[str, Any]:
        """반품 승인"""
        return self._make_request(
            method="POST",
            endpoint=f"/partner/orders/{order_id}/return/approve"
        )

    def reject_return(self, order_id: str, reason: str) -> Dict[str, Any]:
        """반품 거부"""
        return self._make_request(
            method="POST",
            endpoint=f"/partner/orders/{order_id}/return/reject",
            json_data={"rejectReason": reason}
        )

    # 정산 API
    def get_settlements(
        self,
        start_date: datetime,
        end_date: datetime,
        page: int = 1,
        size: int = 100
    ) -> Dict[str, Any]:
        """정산 내역 조회"""
        params = {
            "settleStartDate": start_date.strftime("%Y-%m-%d"),
            "settleEndDate": end_date.strftime("%Y-%m-%d"),
            "page": page,
            "size": size
        }

        return self._make_request(
            method="GET",
            endpoint="/partner/settlements",
            params=params
        )

    def get_settlement_summary(
        self,
        year: int,
        month: int
    ) -> Dict[str, Any]:
        """월별 정산 요약"""
        return self._make_request(
            method="GET",
            endpoint=f"/partner/settlements/summary/{year}/{month:02d}"
        )

    # 통계 API
    def get_sales_statistics(
        self,
        start_date: datetime,
        end_date: datetime,
        interval: str = "DAILY"  # DAILY, WEEKLY, MONTHLY
    ) -> Dict[str, Any]:
        """매출 통계 조회"""
        params = {
            "startDate": start_date.strftime("%Y-%m-%d"),
            "endDate": end_date.strftime("%Y-%m-%d"),
            "interval": interval
        }

        return self._make_request(
            method="GET",
            endpoint="/partner/statistics/sales",
            params=params
        )

    def get_product_statistics(
        self,
        product_no: str,
        start_date: datetime,
        end_date: datetime
    ) -> Dict[str, Any]:
        """상품별 통계 조회"""
        params = {
            "startDate": start_date.strftime("%Y-%m-%d"),
            "endDate": end_date.strftime("%Y-%m-%d")
        }

        return self._make_request(
            method="GET",
            endpoint=f"/partner/statistics/products/{product_no}",
            params=params
        )

    # 재고 관리 API
    def get_inventory(self, product_no: str) -> Dict[str, Any]:
        """재고 조회"""
        return self._make_request(
            method="GET",
            endpoint=f"/partner/products/{product_no}/inventory"
        )

    def update_inventory(
        self,
        product_no: str,
        quantity: int,
        option_id: Optional[str] = None
    ) -> Dict[str, Any]:
        """재고 수정"""
        data = {"quantity": quantity}
        if option_id:
            data["optionId"] = option_id

        return self._make_request(
            method="PATCH",
            endpoint=f"/partner/products/{product_no}/inventory",
            json_data=data
        )

    # 고객 문의 API
    def get_inquiries(
        self,
        start_date: datetime,
        end_date: datetime,
        answered: Optional[bool] = None,
        page: int = 1,
        size: int = 100
    ) -> Dict[str, Any]:
        """고객 문의 조회"""
        params = {
            "startDate": start_date.strftime("%Y-%m-%d"),
            "endDate": end_date.strftime("%Y-%m-%d"),
            "page": page,
            "size": size
        }
        if answered is not None:
            params["answered"] = answered

        return self._make_request(
            method="GET",
            endpoint="/partner/inquiries",
            params=params
        )

    def answer_inquiry(self, inquiry_id: str, answer: str) -> Dict[str, Any]:
        """고객 문의 답변"""
        return self._make_request(
            method="POST",
            endpoint=f"/partner/inquiries/{inquiry_id}/answer",
            json_data={"answerContent": answer}
        )

    # 리뷰 API
    def get_reviews(
        self,
        product_no: Optional[str] = None,
        start_date: Optional[datetime] = None,
        end_date: Optional[datetime] = None,
        page: int = 1,
        size: int = 100
    ) -> Dict[str, Any]:
        """리뷰 조회"""
        params = {
            "page": page,
            "size": size
        }
        if product_no:
            params["productNo"] = product_no
        if start_date:
            params["startDate"] = start_date.strftime("%Y-%m-%d")
        if end_date:
            params["endDate"] = end_date.strftime("%Y-%m-%d")

        return self._make_request(
            method="GET",
            endpoint="/partner/reviews",
            params=params
        )

    def reply_review(self, review_id: str, reply: str) -> Dict[str, Any]:
        """리뷰 답글 작성"""
        return self._make_request(
            method="POST",
            endpoint=f"/partner/reviews/{review_id}/reply",
            json_data={"replyContent": reply}
        )

    # 카테고리 API
    def get_categories(self) -> Dict[str, Any]:
        """카테고리 목록 조회"""
        return self._make_request(
            method="GET",
            endpoint="/partner/categories"
        )

    def get_category_attributes(self, category_id: str) -> Dict[str, Any]:
        """카테고리 속성 조회"""
        return self._make_request(
            method="GET",
            endpoint=f"/partner/categories/{category_id}/attributes"
        )