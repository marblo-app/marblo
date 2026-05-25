import hashlib
import hmac
import json
import time
from datetime import datetime, timedelta
from typing import Any, Dict, List, Optional
from urllib.parse import urlencode

import httpx
from pydantic import BaseModel, Field


class CoupangConfig(BaseModel):
    """쿠팡 파트너스 API 설정"""
    access_key: str = Field(..., description="API Access Key")
    secret_key: str = Field(..., description="API Secret Key")
    vendor_id: str = Field(..., description="Vendor ID")
    base_url: str = Field(default="https://api-gateway.coupang.com", description="API Base URL")
    timeout: int = Field(default=30, description="Request timeout in seconds")


class CoupangProduct(BaseModel):
    """쿠팡 상품 정보"""
    product_id: Optional[str] = None
    seller_product_id: str
    display_product_name: str
    brand: str
    general_product_name: str
    product_group: str
    delivery_charge_type: str = "FREE"  # FREE, NOT_FREE, CONDITIONAL_FREE
    delivery_charge: int = 0
    free_shipover_amount: Optional[int] = None
    return_charge_vendor: int = 0
    return_charge_customer: int = 0
    items: List[Dict[str, Any]]
    attributes: Optional[List[Dict[str, Any]]] = None
    contents: Optional[List[Dict[str, Any]]] = None
    notices: Optional[List[Dict[str, Any]]] = None


class CoupangOrder(BaseModel):
    """쿠팡 주문 정보"""
    order_id: str
    ordered_at: datetime
    product_id: str
    product_name: str
    option_name: Optional[str]
    quantity: int
    unit_price: int
    total_price: int
    shipping_fee: int
    buyer_name: str
    buyer_phone: str
    receiver_name: str
    receiver_phone: str
    postal_code: str
    address: str
    order_status: str
    shipping_status: Optional[str]
    invoice_number: Optional[str]


class CoupangSettlement(BaseModel):
    """쿠팡 정산 정보"""
    settlement_id: str
    settlement_date: datetime
    order_id: str
    product_id: str
    product_name: str
    quantity: int
    sales_amount: int
    commission_amount: int
    shipping_fee: int
    promotion_fee: int
    settlement_amount: int
    payment_date: Optional[datetime]


class CoupangAPIClient:
    """쿠팡 윙 파트너스 API 클라이언트"""

    def __init__(self, config: CoupangConfig):
        self.config = config
        self.client = httpx.Client(timeout=config.timeout)

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc_val, exc_tb):
        self.close()

    def close(self):
        """클라이언트 종료"""
        self.client.close()

    def _generate_hmac(self, method: str, url: str, query_params: str = "") -> str:
        """HMAC-SHA256 서명 생성"""
        datetime_str = time.strftime('%y%m%d', time.gmtime()) + 'T' + time.strftime('%H%M%S', time.gmtime()) + 'Z'

        # URL path 추출
        path = url.replace(self.config.base_url, "")

        # 메시지 생성
        message = datetime_str + method + path + query_params

        # HMAC 생성
        signature = hmac.new(
            self.config.secret_key.encode('utf-8'),
            message.encode('utf-8'),
            hashlib.sha256
        ).hexdigest()

        # Authorization 헤더 생성
        authorization = f"CEA algorithm=HmacSHA256, access-key={self.config.access_key}, signed-date={datetime_str}, signature={signature}"

        return authorization

    def _make_request(
        self,
        method: str,
        endpoint: str,
        params: Optional[Dict] = None,
        json_data: Optional[Dict] = None
    ) -> Dict[str, Any]:
        """API 요청 실행"""
        url = f"{self.config.base_url}{endpoint}"

        # 쿼리 파라미터 처리
        query_string = ""
        if params:
            query_string = urlencode(sorted(params.items()))
            url = f"{url}?{query_string}"

        # HMAC 인증 헤더 생성
        authorization = self._generate_hmac(method, url, query_string)

        headers = {
            "Authorization": authorization,
            "Content-Type": "application/json;charset=UTF-8",
            "X-EXTENDED-TIMEOUT": "60000"
        }

        # 요청 실행
        response = self.client.request(
            method=method,
            url=url,
            headers=headers,
            json=json_data
        )

        # 에러 처리
        if response.status_code != 200:
            error_data = response.json() if response.text else {}
            raise Exception(f"API Error: {response.status_code} - {error_data}")

        return response.json()

    # 상품 관리 API
    def create_product(self, product: CoupangProduct) -> Dict[str, Any]:
        """상품 등록"""
        return self._make_request(
            method="POST",
            endpoint="/v2/providers/seller_api/apis/api/v1/marketplace/seller-products",
            json_data=product.dict(exclude_none=True)
        )

    def update_product(self, product: CoupangProduct) -> Dict[str, Any]:
        """상품 수정"""
        return self._make_request(
            method="PUT",
            endpoint="/v2/providers/seller_api/apis/api/v1/marketplace/seller-products",
            json_data=product.dict(exclude_none=True)
        )

    def get_product(self, seller_product_id: str) -> Dict[str, Any]:
        """상품 조회"""
        return self._make_request(
            method="GET",
            endpoint=f"/v2/providers/seller_api/apis/api/v1/marketplace/seller-products/{seller_product_id}"
        )

    def search_products(
        self,
        status: Optional[str] = None,
        limit: int = 50,
        next_token: Optional[str] = None
    ) -> Dict[str, Any]:
        """상품 목록 조회"""
        params = {
            "vendorId": self.config.vendor_id,
            "limit": limit
        }
        if status:
            params["status"] = status
        if next_token:
            params["nextToken"] = next_token

        return self._make_request(
            method="GET",
            endpoint="/v2/providers/seller_api/apis/api/v1/marketplace/seller-products",
            params=params
        )

    def stop_product_sales(self, seller_product_id: str) -> Dict[str, Any]:
        """상품 판매 중지"""
        return self._make_request(
            method="PUT",
            endpoint=f"/v2/providers/seller_api/apis/api/v1/marketplace/seller-products/{seller_product_id}/sales/stop"
        )

    def resume_product_sales(self, seller_product_id: str) -> Dict[str, Any]:
        """상품 판매 재개"""
        return self._make_request(
            method="PUT",
            endpoint=f"/v2/providers/seller_api/apis/api/v1/marketplace/seller-products/{seller_product_id}/sales/resume"
        )

    # 주문 관리 API
    def get_orders(
        self,
        created_at_from: datetime,
        created_at_to: datetime,
        status: Optional[str] = None,
        limit: int = 50,
        next_token: Optional[str] = None
    ) -> Dict[str, Any]:
        """주문 목록 조회"""
        params = {
            "vendorId": self.config.vendor_id,
            "createdAtFrom": created_at_from.strftime("%Y-%m-%dT%H:%M:%S"),
            "createdAtTo": created_at_to.strftime("%Y-%m-%dT%H:%M:%S"),
            "maxPerPage": limit
        }
        if status:
            params["status"] = status
        if next_token:
            params["nextToken"] = next_token

        return self._make_request(
            method="GET",
            endpoint="/v2/providers/openapi/apis/api/v4/vendors/orders",
            params=params
        )

    def get_order_detail(self, order_id: str) -> Dict[str, Any]:
        """주문 상세 조회"""
        return self._make_request(
            method="GET",
            endpoint=f"/v2/providers/openapi/apis/api/v4/vendors/{self.config.vendor_id}/orders/{order_id}"
        )

    def update_shipping_info(
        self,
        order_id: str,
        vendor_item_id: str,
        delivery_company_code: str,
        invoice_number: str
    ) -> Dict[str, Any]:
        """배송 정보 업데이트 (송장 등록)"""
        return self._make_request(
            method="POST",
            endpoint="/v2/providers/openapi/apis/api/v4/vendors/shipments",
            json_data={
                "vendorId": self.config.vendor_id,
                "orderId": order_id,
                "shipments": [
                    {
                        "vendorItemId": vendor_item_id,
                        "deliveryCompanyCode": delivery_company_code,
                        "invoiceNumber": invoice_number
                    }
                ]
            }
        )

    def confirm_purchase_decision(self, order_id: str, vendor_item_id: str) -> Dict[str, Any]:
        """구매 확정"""
        return self._make_request(
            method="PUT",
            endpoint=f"/v2/providers/openapi/apis/api/v4/vendors/{self.config.vendor_id}/orders/{order_id}/items/{vendor_item_id}/purchase-complete"
        )

    # 반품/교환 API
    def get_returns(
        self,
        search_from: datetime,
        search_to: datetime,
        status: Optional[str] = None,
        limit: int = 50
    ) -> Dict[str, Any]:
        """반품 목록 조회"""
        params = {
            "vendorId": self.config.vendor_id,
            "searchFrom": search_from.strftime("%Y-%m-%dT%H:%M:%S"),
            "searchTo": search_to.strftime("%Y-%m-%dT%H:%M:%S"),
            "maxPerPage": limit
        }
        if status:
            params["status"] = status

        return self._make_request(
            method="GET",
            endpoint="/v2/providers/openapi/apis/api/v4/vendors/returns",
            params=params
        )

    def approve_return(self, return_id: str, vendor_item_id: str) -> Dict[str, Any]:
        """반품 승인"""
        return self._make_request(
            method="PUT",
            endpoint=f"/v2/providers/openapi/apis/api/v4/vendors/{self.config.vendor_id}/returns/{return_id}/items/{vendor_item_id}/approve"
        )

    def reject_return(
        self,
        return_id: str,
        vendor_item_id: str,
        reject_reason: str
    ) -> Dict[str, Any]:
        """반품 거부"""
        return self._make_request(
            method="PUT",
            endpoint=f"/v2/providers/openapi/apis/api/v4/vendors/{self.config.vendor_id}/returns/{return_id}/items/{vendor_item_id}/reject",
            json_data={
                "rejectReason": reject_reason
            }
        )

    # 정산 API
    def get_settlements(
        self,
        settlement_date_from: datetime,
        settlement_date_to: datetime
    ) -> Dict[str, Any]:
        """정산 내역 조회"""
        params = {
            "vendorId": self.config.vendor_id,
            "settlementDateFrom": settlement_date_from.strftime("%Y-%m-%d"),
            "settlementDateTo": settlement_date_to.strftime("%Y-%m-%d")
        }

        return self._make_request(
            method="GET",
            endpoint="/v2/providers/openapi/apis/api/v1/revenue/settlements",
            params=params
        )

    def get_settlement_detail(self, settlement_id: str) -> Dict[str, Any]:
        """정산 상세 조회"""
        return self._make_request(
            method="GET",
            endpoint=f"/v2/providers/openapi/apis/api/v1/revenue/settlements/{settlement_id}"
        )

    # 재고 관리 API
    def update_inventory(
        self,
        vendor_item_id: str,
        quantity: int,
        outbound_shipping_place_code: Optional[str] = None
    ) -> Dict[str, Any]:
        """재고 수량 업데이트"""
        json_data = {
            "vendorId": self.config.vendor_id,
            "vendorItemId": vendor_item_id,
            "quantity": quantity
        }
        if outbound_shipping_place_code:
            json_data["outboundShippingPlaceCode"] = outbound_shipping_place_code

        return self._make_request(
            method="POST",
            endpoint="/v2/providers/seller_api/apis/api/v1/marketplace/vendor-items/quantities",
            json_data=json_data
        )

    def get_inventory(self, vendor_item_id: str) -> Dict[str, Any]:
        """재고 조회"""
        params = {
            "vendorId": self.config.vendor_id,
            "vendorItemId": vendor_item_id
        }

        return self._make_request(
            method="GET",
            endpoint="/v2/providers/seller_api/apis/api/v1/marketplace/vendor-items/quantities",
            params=params
        )

    # 가격 관리 API
    def update_price(
        self,
        vendor_item_id: str,
        sale_price: int,
        original_price: Optional[int] = None
    ) -> Dict[str, Any]:
        """판매 가격 업데이트"""
        json_data = {
            "vendorId": self.config.vendor_id,
            "vendorItemId": vendor_item_id,
            "salePrice": sale_price
        }
        if original_price:
            json_data["originalPrice"] = original_price

        return self._make_request(
            method="POST",
            endpoint="/v2/providers/seller_api/apis/api/v1/marketplace/vendor-items/prices",
            json_data=json_data
        )

    # 카테고리 API
    def get_categories(self, display_category_code: str) -> Dict[str, Any]:
        """카테고리 정보 조회"""
        params = {
            "displayCategoryCode": display_category_code
        }

        return self._make_request(
            method="GET",
            endpoint="/v2/providers/seller_api/apis/api/v1/marketplace/meta/categories",
            params=params
        )

    def get_category_attributes(self, display_category_code: str) -> Dict[str, Any]:
        """카테고리 속성 메타 정보 조회"""
        params = {
            "displayCategoryCode": display_category_code
        }

        return self._make_request(
            method="GET",
            endpoint="/v2/providers/seller_api/apis/api/v1/marketplace/meta/category-attributes",
            params=params
        )