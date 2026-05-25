# Marblo Payment Backend API

Toss Payments를 활용한 결제 시스템 백엔드 API

## 기능

- **결제 처리**
  - 결제 요청/승인/취소
  - 부분 취소 지원
  - 결제 상태 조회
  - 결제 내역 관리

- **구독 관리**
  - 정기결제 등록/해지
  - 구독 플랜 변경
  - 빌링 키 관리
  - 결제 실패 재시도

- **웹훅 처리**
  - 결제 상태 변경 자동 반영
  - 빌링 키 업데이트
  - 비동기 처리

## 시작하기

### 환경 설정

1. `.env` 파일 생성:

```bash
cp .env.example .env
```

2. 필수 환경 변수 설정:

- `DATABASE_URL`: PostgreSQL 연결 정보
- `TOSS_CLIENT_KEY`: Toss Payments 클라이언트 키
- `TOSS_SECRET_KEY`: Toss Payments 시크릿 키
- `TOSS_WEBHOOK_SECRET`: 웹훅 검증용 시크릿

### Docker Compose로 실행

```bash
docker-compose up -d
```

### 로컬 개발 환경

1. 의존성 설치:

```bash
pip install -r requirements.txt
```

2. 데이터베이스 마이그레이션:

```bash
alembic upgrade head
```

3. 서버 실행:

```bash
uvicorn main:app --reload --port 8001
```

## API 문서

서버 실행 후 아래 주소에서 확인:

- Swagger UI: http://localhost:8001/docs
- ReDoc: http://localhost:8001/redoc

## 주요 엔드포인트

### 결제 API

- `POST /api/v1/payments/request` - 결제 요청
- `POST /api/v1/payments/confirm` - 결제 승인
- `POST /api/v1/payments/cancel` - 결제 취소
- `GET /api/v1/payments/status/{payment_key}` - 결제 상태 조회
- `GET /api/v1/payments/history` - 결제 내역 조회

### 구독 API

- `POST /api/v1/payments/billing/register` - 빌링 키 등록
- `POST /api/v1/payments/subscriptions` - 구독 생성
- `PATCH /api/v1/payments/subscriptions/{id}` - 구독 수정
- `POST /api/v1/payments/subscriptions/{id}/cancel` - 구독 취소
- `GET /api/v1/payments/subscriptions/current` - 현재 구독 조회

### 웹훅

- `POST /api/v1/payments/webhook` - Toss Payments 웹훅 처리

### 통계

- `GET /api/v1/payments/statistics/payments` - 결제 통계
- `GET /api/v1/payments/statistics/subscriptions` - 구독 통계
