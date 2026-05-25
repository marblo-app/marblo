from fastapi import APIRouter, HTTPException, Query
from typing import Literal
import logging
from datetime import datetime, timedelta
import random

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/channels", tags=["channels"])


@router.get("/coupang/dashboard")
async def get_coupang_dashboard(
    timeRange: Literal["day", "week", "month"] = Query(..., description="시간 범위")
):
    """쿠팡 대시보드 데이터 조회"""
    try:
        # TODO: 실제 쿠팡 API 연동 로직 구현
        # 현재는 목업 데이터 반환

        now = datetime.now()

        # 시간대별 데이터 생성
        def generate_trends_data():
            data = []
            count = 24 if timeRange == "day" else 7 if timeRange == "week" else 4

            for i in range(count):
                label = (
                    str(i) if timeRange == "day"
                    else f"{i + 1}일" if timeRange == "week"
                    else str(i + 1)
                )

                data.append({
                    "label": label,
                    "value": random.randint(1000000, 5000000),
                    "orders": random.randint(20, 120),
                    "avgOrderValue": random.randint(20000, 70000),
                })
            return data

        # 수익 데이터 생성
        def generate_revenue_data():
            data = []
            for i in range(7):
                date = now - timedelta(days=6-i)
                revenue = random.randint(2000000, 10000000)
                fees = int(revenue * 0.11)

                data.append({
                    "date": date.isoformat(),
                    "revenue": revenue,
                    "fees": fees,
                    "profit": revenue - fees,
                })
            return data

        # 베스트 상품 데이터
        best_products = [
            {
                "id": "1",
                "name": "삼성 갤럭시 버즈2 프로 블루투스 이어폰",
                "salesCount": 156,
                "revenue": 28080000,
                "rank": 1,
                "rankChange": 2,
                "rating": 4.8,
                "reviewCount": 342,
            },
            {
                "id": "2",
                "name": "Apple 에어팟 프로 2세대 MQD83KH/A",
                "salesCount": 142,
                "revenue": 35500000,
                "rank": 2,
                "rankChange": -1,
                "rating": 4.9,
                "reviewCount": 567,
            },
            {
                "id": "3",
                "name": "LG 스탠바이미 27인치 무선 이동식 모니터",
                "salesCount": 89,
                "revenue": 71200000,
                "rank": 3,
                "rankChange": 0,
                "rating": 4.7,
                "reviewCount": 123,
            },
            {
                "id": "4",
                "name": "다이슨 V15 디텍트 무선청소기",
                "salesCount": 76,
                "revenue": 60800000,
                "rank": 4,
                "rankChange": 3,
                "rating": 4.6,
                "reviewCount": 234,
            },
            {
                "id": "5",
                "name": "삼성 비스포크 냉장고 RF85T9013AP",
                "salesCount": 45,
                "revenue": 135000000,
                "rank": 5,
                "rankChange": -2,
                "rating": 4.8,
                "reviewCount": 89,
            },
        ]

        # 카테고리 데이터
        category_data = [
            {
                "id": "1",
                "name": "전자제품",
                "revenue": 285600000,
                "salesCount": 892,
                "percentage": 35.2,
                "growth": 12.5,
            },
            {
                "id": "2",
                "name": "패션",
                "revenue": 156800000,
                "salesCount": 2341,
                "percentage": 19.3,
                "growth": -3.2,
            },
            {
                "id": "3",
                "name": "식품",
                "revenue": 142300000,
                "salesCount": 3567,
                "percentage": 17.5,
                "growth": 28.6,
            },
            {
                "id": "4",
                "name": "생활용품",
                "revenue": 128900000,
                "salesCount": 1893,
                "percentage": 15.9,
                "growth": 8.4,
            },
            {
                "id": "5",
                "name": "뷰티",
                "revenue": 98400000,
                "salesCount": 1234,
                "percentage": 12.1,
                "growth": 15.7,
            },
        ]

        # 판매 데이터 생성
        def generate_sales_data():
            products = [
                "삼성 갤럭시 버즈2 프로",
                "Apple 에어팟 프로 2세대",
                "LG OLED TV 55인치",
                "다이슨 에어랩",
                "나이키 에어맥스",
            ]
            addresses = [
                "서울특별시 강남구 테헤란로",
                "경기도 성남시 분당구",
                "부산광역시 해운대구",
                "대구광역시 수성구",
                "인천광역시 연수구",
            ]
            statuses = ["pending", "confirmed", "shipped", "delivered", "cancelled"]

            sales_data = []
            for i in range(50):
                quantity = random.randint(1, 6)
                unit_price = random.randint(50000, 550000)

                sales_data.append({
                    "id": f"sale-{i}",
                    "productName": random.choice(products),
                    "sku": f"SKU-{random.randint(100000, 999999)}",
                    "orderDate": (now - timedelta(days=random.randint(0, 7))).isoformat(),
                    "quantity": quantity,
                    "unitPrice": unit_price,
                    "totalPrice": unit_price * quantity,
                    "status": random.choice(statuses),
                    "customerName": f"고객{i + 1}",
                    "shippingAddress": f"{random.choice(addresses)} {random.randint(1, 101)}",
                })

            return sales_data

        dashboard_data = {
            "todayRevenue": 12580000,
            "todayOrders": 342,
            "todayFees": 1383800,
            "avgOrderValue": 36783,
            "revenueChange": 15.3,
            "ordersChange": 8.7,
            "feeRate": 11,
            "revenueData": generate_revenue_data(),
            "trendsData": generate_trends_data(),
            "bestProducts": best_products,
            "categoryData": category_data,
            "salesData": generate_sales_data(),
        }

        return dashboard_data

    except Exception as e:
        logger.error(f"쿠팡 대시보드 데이터 조회 실패: {str(e)}")
        raise HTTPException(status_code=500, detail=f"대시보드 데이터 조회에 실패했습니다: {str(e)}")


@router.get("/coupang/products")
async def get_coupang_products(
    page: int = Query(1, ge=1, description="페이지 번호"),
    limit: int = Query(20, ge=1, le=100, description="페이지 당 항목 수")
):
    """쿠팡 상품 목록 조회"""
    try:
        # TODO: 실제 쿠팡 상품 API 연동
        products = []
        for i in range(limit):
            products.append({
                "id": f"product-{(page-1)*limit + i}",
                "name": f"테스트 상품 {(page-1)*limit + i + 1}",
                "sku": f"SKU{random.randint(100000, 999999)}",
                "price": random.randint(10000, 500000),
                "stock": random.randint(0, 100),
                "salesCount": random.randint(0, 1000),
                "rating": round(random.uniform(3.0, 5.0), 1),
                "status": random.choice(["active", "inactive", "sold_out"]),
            })

        return {
            "products": products,
            "total": 1000,  # Mock total count
            "page": page,
            "limit": limit,
            "hasNext": page * limit < 1000,
        }

    except Exception as e:
        logger.error(f"쿠팡 상품 목록 조회 실패: {str(e)}")
        raise HTTPException(status_code=500, detail=f"상품 목록 조회에 실패했습니다: {str(e)}")