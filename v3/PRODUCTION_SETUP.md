# Production Setup Checklist

## 1. Required Production Credentials

### Domain and SSL

- [ ] `DOMAIN`: 실제 도메인명 (예: marblo.co.kr)
- [ ] SSL 인증서 설정

### Database Configuration

- [ ] `POSTGRES_PASSWORD`: 강력한 데이터베이스 비밀번호 생성
- [ ] `DATABASE_URL`: Cloud SQL 인스턴스 연결 문자열

### Security

- [ ] `SECRET_KEY`: 강력한 JWT 시크릿 키 생성 (32+ 자리)

### External Services

- [ ] `SENTRY_DSN`: Sentry 프로젝트 DSN
- [ ] `GOOGLE_CLOUD_PROJECT`: GCP 프로젝트 ID

### Payment Gateways (Production)

- [ ] `TOSS_CLIENT_KEY`: TossPayments 라이브 클라이언트 키
- [ ] `TOSS_SECRET_KEY`: TossPayments 라이브 시크릿 키
- [ ] `TOSS_WEBHOOK_SECRET`: TossPayments 웹훅 시크릿
- [ ] `NAVERPAY_MERCHANT_ID`: NaverPay 상점 ID
- [ ] `NAVERPAY_API_KEY`: NaverPay API 키
- [ ] `NAVERPAY_SECRET_KEY`: NaverPay 시크릿 키
- [ ] `NAVERPAY_WEBHOOK_SECRET`: NaverPay 웹훅 시크릿

### E-commerce APIs

- [ ] `COUPANG_ACCESS_KEY`: 쿠팡 Wing Partners API 액세스 키
- [ ] `COUPANG_SECRET_KEY`: 쿠팡 Wing Partners API 시크릿 키
- [ ] `COUPANG_VENDOR_ID`: 쿠팡 벤더 ID
- [ ] `NAVER_CLIENT_ID`: 네이버 SmartStore API 클라이언트 ID
- [ ] `NAVER_CLIENT_SECRET`: 네이버 SmartStore API 클라이언트 시크릿
- [ ] `NAVER_ACCESS_TOKEN`: 네이버 SmartStore API 액세스 토큰
- [ ] `NAVER_REFRESH_TOKEN`: 네이버 SmartStore API 리프레시 토큰

## 2. GCP Setup Commands

```bash
# 1. Set project
gcloud config set project YOUR_PROJECT_ID

# 2. Create Cloud SQL instance
./scripts/setup-database.sh

# 3. Create Secret Manager secrets
gcloud secrets create marblo-env-prod --data-file=.env.prod
```

## 3. GitHub Secrets (Repository Settings > Secrets and variables > Actions)

### GCP & Infrastructure

- `GCP_PROJECT_ID`: GCP 프로젝트 ID
- `GCP_REGION`: 배포 리전 (기본값: asia-northeast3)
- `GCP_SA_KEY`: GCP 서비스 계정 JSON 키 (base64 인코딩)

### Database

- `DATABASE_URL_PROD`: 프로덕션 데이터베이스 URL
- `DATABASE_URL_MIGRATION`: 마이그레이션용 데이터베이스 URL

### Application Security

- `SECRET_KEY_PROD`: JWT 시크릿 키

### Monitoring

- `SENTRY_DSN_PROD`: Sentry DSN
- `VITE_SENTRY_DSN_PROD`: 프론트엔드 Sentry DSN

### Payment Gateways

- `TOSS_CLIENT_KEY_PROD`: TossPayments 클라이언트 키
- `TOSS_SECRET_KEY_PROD`: TossPayments 시크릿 키
- `TOSS_WEBHOOK_SECRET_PROD`: TossPayments 웹훅 시크릿
- `VITE_TOSS_CLIENT_KEY_PROD`: 프론트엔드 TossPayments 키
- `NAVERPAY_MERCHANT_ID_PROD`: NaverPay 상점 ID
- `NAVERPAY_API_KEY_PROD`: NaverPay API 키
- `NAVERPAY_SECRET_KEY_PROD`: NaverPay 시크릿 키
- `NAVERPAY_WEBHOOK_SECRET_PROD`: NaverPay 웹훅 시크릿

### Frontend Configuration

- `VITE_API_BASE_URL_PROD`: 프로덕션 API Base URL
- `VITE_PADDLE_CLIENT_TOKEN_PROD`: Paddle 클라이언트 토큰

### Firebase Configuration

- `FIREBASE_SERVICE_ACCOUNT_PROD`: Firebase 서비스 계정 JSON
- `FIREBASE_PROJECT_ID_PROD`: Firebase 프로젝트 ID
- `VITE_FIREBASE_API_KEY_PROD`: Firebase API 키
- `VITE_FIREBASE_AUTH_DOMAIN_PROD`: Firebase Auth 도메인
- `VITE_FIREBASE_PROJECT_ID_PROD`: Firebase 프로젝트 ID (프론트엔드용)
- `VITE_FIREBASE_STORAGE_BUCKET_PROD`: Firebase Storage 버킷
- `VITE_FIREBASE_MESSAGING_SENDER_ID_PROD`: Firebase 메시징 센더 ID
- `VITE_FIREBASE_APP_ID_PROD`: Firebase 앱 ID

### Notifications

- `SLACK_WEBHOOK_URL`: Slack 알림 웹훅 URL

## 4. Deployment Workflow

### Quick Start (Recommended Order)

```bash
# 1. Setup database
export GCP_PROJECT_ID=your-project-id
./scripts/setup-database.sh

# 2. Configure GitHub secrets (interactive)
./scripts/setup-github-secrets.sh

# 3. Configure domain and SSL
./scripts/configure-domain.sh setup

# 4. Deploy via GitHub Actions
git push origin main

# 5. Test deployment
./scripts/test-production.sh all
```

### Manual Deployment (Alternative)

```bash
# Deploy directly to Cloud Run
./scripts/deploy-cloudrun.sh

# Test deployment
./scripts/test-production.sh quick
```

## 5. Deployment Scripts

| Script                    | Purpose                     | Usage                                 |
| ------------------------- | --------------------------- | ------------------------------------- |
| `setup-database.sh`       | Cloud SQL PostgreSQL setup  | `./scripts/setup-database.sh`         |
| `setup-github-secrets.sh` | GitHub repository secrets   | `./scripts/setup-github-secrets.sh`   |
| `configure-domain.sh`     | Domain mapping & SSL        | `./scripts/configure-domain.sh setup` |
| `deploy-cloudrun.sh`      | Manual Cloud Run deployment | `./scripts/deploy-cloudrun.sh`        |
| `test-production.sh`      | Production testing suite    | `./scripts/test-production.sh all`    |

## 6. Testing and Verification

### Comprehensive Testing

```bash
# Run all production tests
./scripts/test-production.sh all

# Quick service tests only
./scripts/test-production.sh quick

# Domain and SSL tests only
./scripts/test-production.sh domain
```

### Manual Verification Checklist

- [ ] Health check: `https://api.your-domain.com/health`
- [ ] API docs: `https://api.your-domain.com/docs`
- [ ] Database connectivity test
- [ ] Payment gateway integration test
- [ ] E-commerce API connection tests
- [ ] SSL certificate verification
- [ ] Custom domain mapping
- [ ] Autoscaling configuration
- [ ] Environment variables setup
- [ ] Monitoring and logging (Sentry)

## 7. Post-Deployment Monitoring

### Health Monitoring

- Cloud Run service metrics
- Database connection monitoring
- API response time tracking
- Error rate monitoring via Sentry

### Security Monitoring

- SSL certificate expiration alerts
- Security header validation
- API rate limiting effectiveness
- Payment gateway webhook security

### Performance Monitoring

- Autoscaling behavior
- Memory and CPU usage
- Database query performance
- BigQuery sync job status
