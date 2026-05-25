# Marblo 결제 시스템 API 문서

## 개요

Marblo 결제 시스템은 **Toss Payments**와 **NaverPay** 두 가지 결제 게이트웨이를 지원합니다.

## 지원 기능

### 1. 기본 결제 처리

- ✅ 결제 요청 (Toss, NaverPay)
- ✅ 결제 승인/확인
- ✅ 결제 취소 (전체/부분)
- ✅ 결제 상태 조회
- ✅ 결제 이력 관리

### 2. 구독/정기결제

- ✅ 빌링키 등록 (Toss, NaverPay)
- ✅ 구독 생성/수정/취소
- ✅ 자동 결제 처리
- ✅ 빌링 이력 관리

### 3. 웹훅 처리

- ✅ Toss Payments 웹훅 (`/webhook/toss`)
- ✅ NaverPay 웹훅 (`/webhook/naverpay`)
- ✅ 결제 상태 자동 업데이트
- ✅ 백그라운드 처리

### 4. 통계 및 분석

- ✅ 결제 통계 (매출, 성공률, 실패율)
- ✅ 구독 통계 (MRR, ARR, 해지율)

---

## API 엔드포인트

### 기본 결제

#### 1. 결제 요청

```http
POST /api/v1/payments/request
Content-Type: application/json

{
    "amount": 10000,
    "order_name": "상품명",
    "customer_email": "customer@example.com",
    "customer_name": "고객명",
    "success_url": "https://yoursite.com/success",
    "fail_url": "https://yoursite.com/fail",
    "payment_method": "TOSS"  // 또는 "NAVERPAY"
}
```

#### 2. 결제 승인

```http
POST /api/v1/payments/confirm
Content-Type: application/json

{
    "payment_key": "payment_key_from_gateway",
    "order_id": "order_123456",
    "amount": 10000
}
```

#### 3. 결제 취소

```http
POST /api/v1/payments/cancel
Content-Type: application/json

{
    "payment_key": "payment_key",
    "cancel_reason": "고객 요청",
    "cancel_amount": 5000  // 부분 취소 시 (선택사항)
}
```

#### 4. 결제 상태 조회

```http
GET /api/v1/payments/status/{payment_key}
```

#### 5. 결제 이력 조회

```http
GET /api/v1/payments/history?skip=0&limit=50
```

---

### 빌링/정기결제

#### 1. 빌링키 등록

**Toss Payments:**

```http
POST /api/v1/payments/billing/register
Content-Type: application/json

{
    "payment_method": "TOSS",
    "card_number": "1234567890123456",
    "card_expiry_year": "25",
    "card_expiry_month": "12",
    "card_password": "12",
    "birth_or_business_number": "901201"
}
```

**NaverPay:**

```http
POST /api/v1/payments/billing/register
Content-Type: application/json

{
    "payment_method": "NAVERPAY",
    "return_url": "https://yoursite.com/billing/callback"
}
```

#### 2. 구독 생성

```http
POST /api/v1/payments/subscriptions
Content-Type: application/json

{
    "plan": "PRO",
    "billing_cycle": "monthly",  // 또는 "yearly"
    "trial_days": 7
}
```

#### 3. 구독 조회

```http
GET /api/v1/payments/subscriptions/current
```

#### 4. 구독 수정

```http
PATCH /api/v1/payments/subscriptions/{subscription_id}
Content-Type: application/json

{
    "plan": "ENTERPRISE",
    "billing_cycle": "yearly"
}
```

#### 5. 구독 취소

```http
POST /api/v1/payments/subscriptions/{subscription_id}/cancel
Content-Type: application/json

{
    "cancel_reason": "서비스 불만족",
    "immediate": true  // 즉시 취소 여부
}
```

---

### 웹훅

#### 1. Toss Payments 웹훅

```http
POST /api/v1/payments/webhook/toss
Content-Type: application/json
X-Toss-Webhook-Signature: signature
X-Toss-Webhook-Timestamp: timestamp

{
    "eventType": "PAYMENT_STATUS_CHANGED",
    "data": {
        "paymentKey": "payment_key",
        "status": "DONE"
    }
}
```

#### 2. NaverPay 웹훅

```http
POST /api/v1/payments/webhook/naverpay
Content-Type: application/json
X-NaverPay-Signature: signature
X-NaverPay-Timestamp: timestamp

{
    "eventType": "PAYMENT_COMPLETED",
    "data": {
        "paymentId": "payment_id",
        "transactionId": "tx_123456"
    }
}
```

---

### 통계

#### 1. 결제 통계

```http
GET /api/v1/payments/statistics/payments?start_date=2024-01-01T00:00:00&end_date=2024-12-31T23:59:59
```

#### 2. 구독 통계

```http
GET /api/v1/payments/statistics/subscriptions
```

---

## 환경 설정

### 1. 환경 변수 (.env)

```bash
# Toss Payments
TOSS_CLIENT_KEY=your_toss_client_key
TOSS_SECRET_KEY=your_toss_secret_key
TOSS_API_URL=https://api.tosspayments.com/v1
TOSS_WEBHOOK_SECRET=your_toss_webhook_secret

# NaverPay
NAVERPAY_MERCHANT_ID=your_naverpay_merchant_id
NAVERPAY_API_KEY=your_naverpay_api_key
NAVERPAY_SECRET_KEY=your_naverpay_secret_key
NAVERPAY_API_URL=https://pay.naver.com/api/v1
NAVERPAY_WEBHOOK_SECRET=your_naverpay_webhook_secret
```

### 2. 데이터베이스 설정

결제 시스템에서 사용하는 주요 테이블:

- `payments`: 결제 정보
- `subscriptions`: 구독 정보
- `billing_history`: 빌링 이력
- `payment_webhooks`: 웹훅 로그

---

## 결제 플로우

### 일반 결제 플로우

1. **결제 요청** (`POST /payments/request`)
   - 결제 정보를 받아 게이트웨이에 요청
   - 결제 페이지 URL 반환

2. **사용자 결제** (외부 결제 페이지)
   - 사용자가 결제 정보 입력
   - 결제 승인/거절

3. **결제 확인** (`POST /payments/confirm`)
   - 게이트웨이에서 결제 결과 확인
   - 데이터베이스 상태 업데이트

4. **웹훅 수신** (`POST /webhook/toss|naverpay`)
   - 결제 상태 변경 알림 수신
   - 백그라운드에서 비동기 처리

### 구독 결제 플로우

1. **빌링키 등록** (`POST /billing/register`)
   - 카드 정보 등록 (Toss) 또는 인증 (NaverPay)
   - 자동결제 동의

2. **구독 생성** (`POST /subscriptions`)
   - 구독 플랜 선택
   - 첫 결제 처리 (무료 체험 제외)

3. **정기 결제** (자동 실행)
   - 스케줄링된 작업으로 자동 실행
   - 빌링키를 사용한 결제 처리

---

## 오류 처리

### HTTP 상태 코드

- `200`: 성공
- `400`: 잘못된 요청 (결제 실패 등)
- `401`: 인증 실패 (웹훅 서명 검증 실패)
- `404`: 리소스 없음 (결제/구독 정보 없음)
- `500`: 서버 오류

### 오류 응답 형식

```json
{
  "detail": "오류 메시지"
}
```

---

## 보안 고려사항

1. **웹훅 서명 검증**: 모든 웹훅은 서명을 검증하여 위조 방지
2. **HTTPS 강제**: 모든 API 통신은 HTTPS 사용
3. **민감 정보 암호화**: 카드 정보는 평문 저장 금지
4. **접근 제어**: 사용자별 결제 정보 접근 제한
5. **로깅**: 모든 결제 관련 작업은 로그 기록

---

## 테스트

### 개발 환경 테스트

- Toss: 테스트 API 키 사용
- NaverPay: 개발자 센터에서 제공하는 테스트 환경 사용

### 결제 테스트 카드 정보

- **Toss Payments**: 공식 문서의 테스트 카드 번호 사용
- **NaverPay**: 테스트 계정을 통한 결제 테스트

---

## 모니터링

### 주요 메트릭

- 결제 성공률
- 평균 결제 금액
- 구독 해지율 (Churn Rate)
- 월간 반복 매출 (MRR)
- 연간 반복 매출 (ARR)

### 알림 설정

- 결제 실패율 임계값 초과 시
- 웹훅 처리 실패 시
- API 응답 시간 증가 시

---

## 문의사항

결제 시스템 관련 문의사항이 있으시면 개발팀에 문의하세요.
