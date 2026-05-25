# Marblo Payment System API Documentation

## Overview

Marblo 결제 시스템은 Toss Payments와 NaverPay를 지원하는 포괄적인 결제 솔루션입니다. 일회성 결제, 정기 구독, 빌링키 관리, 웹훅 처리 등을 제공합니다.

## Base URL

- **개발환경**: `http://localhost:8001`
- **프로덕션**: `https://api.marblo.com`

## API 버전

현재 API 버전: `v1`

모든 API 엔드포인트는 `/api/v1` prefix를 사용합니다.

## Authentication

현재는 간단한 user_id 기반 인증을 사용하고 있습니다. 추후 JWT 토큰 기반 인증으로 업그레이드될 예정입니다.

## Supported Payment Methods

- **Toss Payments**: 카드, 가상계좌, 계좌이체, 휴대폰, 상품권, 간편결제
- **NaverPay**: 네이버페이 일반결제 및 정기결제

## API Endpoints

### 1. Payment Operations

#### 1.1 Request Payment (결제 요청)

```http
POST /api/v1/payments/request
```

**Request Body:**

```json
{
  "amount": 10000,
  "order_name": "테스트 상품",
  "customer_email": "customer@example.com",
  "customer_name": "고객명",
  "success_url": "https://your-domain.com/success",
  "fail_url": "https://your-domain.com/fail",
  "payment_method": "TOSS" // Optional: "TOSS" | "NAVERPAY"
}
```

**Response:**

```json
{
  "id": 1,
  "payment_key": null,
  "order_id": "order_abc123_20260502133000",
  "amount": 10000,
  "currency": "KRW",
  "status": "ready",
  "method": null,
  "requested_at": "2026-05-02T13:30:00Z",
  "checkout_url": "https://checkout.toss.com/...",
  "created_at": "2026-05-02T13:30:00Z"
}
```

#### 1.2 Confirm Payment (결제 승인)

```http
POST /api/v1/payments/confirm
```

**Request Body:**

```json
{
  "payment_key": "payment_key_from_toss",
  "order_id": "order_abc123_20260502133000",
  "amount": 10000
}
```

#### 1.3 Cancel Payment (결제 취소)

```http
POST /api/v1/payments/cancel
```

**Request Body:**

```json
{
  "payment_key": "payment_key_from_toss",
  "cancel_reason": "고객 요청",
  "cancel_amount": 10000 // Optional: 부분 취소시 금액 지정
}
```

#### 1.4 Get Payment Status (결제 상태 조회)

```http
GET /api/v1/payments/status/{payment_key}
```

#### 1.5 Get Payment History (결제 내역)

```http
GET /api/v1/payments/history?skip=0&limit=50
```

#### 1.6 Get Payment Detail (결제 상세 정보)

```http
GET /api/v1/payments/{payment_id}
```

### 2. Billing Key Management

#### 2.1 Register Billing Key (빌링키 등록)

**Toss Payments:**

```http
POST /api/v1/payments/billing/register
```

```json
{
  "payment_method": "TOSS",
  "card_number": "1234567812345678",
  "card_expiry_year": "25",
  "card_expiry_month": "12",
  "card_password": "12",
  "birth_or_business_number": "901010"
}
```

**NaverPay:**

```json
{
  "payment_method": "NAVERPAY",
  "return_url": "https://your-domain.com/billing/callback"
}
```

### 3. Subscription Management

#### 3.1 Create Subscription (구독 생성)

```http
POST /api/v1/payments/subscriptions
```

**Request Body:**

```json
{
  "plan": "basic", // "free" | "basic" | "pro" | "enterprise"
  "billing_cycle": "monthly", // "monthly" | "yearly"
  "trial_days": 7 // Optional: 0-30 days
}
```

#### 3.2 Get Current Subscription (현재 구독 조회)

```http
GET /api/v1/payments/subscriptions/current
```

#### 3.3 Update Subscription (구독 변경)

```http
PATCH /api/v1/payments/subscriptions/{subscription_id}
```

```json
{
  "plan": "pro",
  "billing_cycle": "yearly"
}
```

#### 3.4 Cancel Subscription (구독 취소)

```http
POST /api/v1/payments/subscriptions/{subscription_id}/cancel
```

```json
{
  "cancel_reason": "서비스 불만족",
  "immediate": false // true: 즉시 취소, false: 기간 만료시 취소
}
```

#### 3.5 Get Billing History (빌링 내역)

```http
GET /api/v1/payments/subscriptions/{subscription_id}/billing-history
```

### 4. Webhooks

#### 4.1 Toss Payments Webhook

```http
POST /api/v1/payments/webhook/toss
```

**Headers:**

- `X-Toss-Webhook-Signature`: 웹훅 서명
- `X-Toss-Webhook-Timestamp`: 웹훅 타임스탬프

#### 4.2 NaverPay Webhook

```http
POST /api/v1/payments/webhook/naverpay
```

**Headers:**

- `X-Naverpay-Signature`: 웹훅 서명
- `X-Naverpay-Timestamp`: 웹훅 타임스탬프

### 5. Statistics

#### 5.1 Payment Statistics (결제 통계)

```http
GET /api/v1/payments/statistics/payments?start_date=2026-04-01T00:00:00Z&end_date=2026-05-01T23:59:59Z
```

#### 5.2 Subscription Statistics (구독 통계)

```http
GET /api/v1/payments/statistics/subscriptions
```

## Subscription Plans & Pricing

| Plan       | Monthly (KRW) | Yearly (KRW)       | Features           |
| ---------- | ------------- | ------------------ | ------------------ |
| Free       | 0             | 0                  | 기본 기능          |
| Basic      | 9,900         | 95,040 (20% 할인)  | 기본 + 고급 분석   |
| Pro        | 29,900        | 287,040 (20% 할인) | Basic + API 액세스 |
| Enterprise | 99,900        | 959,040 (20% 할인) | Pro + 전용 지원    |

## Error Handling

### HTTP Status Codes

- `200`: 성공
- `400`: 잘못된 요청
- `401`: 인증 실패
- `404`: 리소스 없음
- `422`: 유효성 검사 실패
- `500`: 서버 오류

### Error Response Format

```json
{
  "detail": "Error message description",
  "type": "error_type",
  "code": "ERROR_CODE"
}
```

## SDK & Libraries

### JavaScript/TypeScript

```bash
npm install @marblo/payment-sdk
```

```typescript
import { MarbloPay } from "@marblo/payment-sdk";

const marblo = new MarbloPay({
  apiKey: "your-api-key",
  environment: "development", // or 'production'
});

// 결제 요청
const payment = await marblo.payments.request({
  amount: 10000,
  orderName: "테스트 상품",
  customerEmail: "customer@example.com",
  customerName: "고객명",
});
```

## Testing

### Test Environment

- **API Base URL**: `http://localhost:8001`
- **Test Cards**: Toss Payments 테스트 카드 사용
- **Webhook Testing**: ngrok 등을 사용하여 로컬 웹훅 테스트 가능

### Example Test Scenarios

1. **정상 결제 플로우**
   - 결제 요청 → 사용자 결제 진행 → 결제 승인 → 웹훅 수신

2. **결제 실패 테스트**
   - 잘못된 카드 정보로 결제 시도

3. **부분 취소 테스트**
   - 결제 완료 후 일부 금액 취소

4. **구독 관리 테스트**
   - 구독 생성 → 플랜 변경 → 구독 취소

## Production Considerations

1. **보안**
   - HTTPS 필수 사용
   - API 키 안전한 관리
   - 웹훅 서명 검증 필수

2. **모니터링**
   - Sentry를 통한 에러 트래킹
   - 결제 상태 모니터링
   - 웹훅 처리 실패 알림

3. **백업**
   - 정기적인 데이터베이스 백업
   - 결제 데이터 별도 보관

## Support

- **개발 문의**: dev@marblo.com
- **기술 지원**: support@marblo.com
- **문서**: https://docs.marblo.com
