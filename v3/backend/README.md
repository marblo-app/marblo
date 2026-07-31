# Marblo Backend API

내부용 FastAPI 서비스. 채널 데이터 조회와 BigQuery 캐시 계층을 제공한다.

> **결제 API는 이 백엔드에 없다.** 예전에는 Toss/NaverPay 라우터가 여기 있었으나 호출하는
> 클라이언트가 0건인 죽은 코드여서 제거했다. 라이브 결제 경로는 **Cloud Functions**(`v3/functions`)
> 와 **marblo-web** 이며, 시크릿도 그쪽에서만 관리한다.

## 기능

- **채널 데이터** — 쿠팡 상품/대시보드 조회
- **캐시 계층** — Redis 기반 API·BigQuery 쿼리 캐시, 캐시 통계/무효화

## 시작하기

### 환경 설정

1. `.env` 파일 생성:

```bash
cp .env.example .env
```

2. 필수 환경 변수 설정:

- `DATABASE_URL`: PostgreSQL 연결 정보
- `SECRET_KEY`: 앱 서명 키
- `GOOGLE_CLOUD_PROJECT`: BigQuery 프로젝트 ID

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

### 채널

- `GET /api/channels/coupang/products` - 쿠팡 상품 조회
- `GET /api/channels/coupang/dashboard` - 쿠팡 대시보드

### 캐시

- `GET /cache/status` - 캐시 상태
- `GET /cache/stats` - 캐시 통계
- `GET /cache/keys` - 캐시 키 목록
- `DELETE /cache/keys/{key}` - 개별 키 삭제
- `POST /cache/invalidate` - 캐시 무효화
- `GET /cache/bigquery/metrics` - BigQuery 캐시 메트릭
- `GET /cache/performance/report` - 캐시 성능 리포트

### 헬스체크

- `GET /health` - 서비스 상태
