---
tags: [강의, v3, 모듈6]
type: 실습
aliases: [실습 GCP 배포]
---

# 실습: GCP 배포 Complete Guide

> 모듈 6 · 실습 · [[6-2_CloudRun_배포]] 보충 자료
> 관련: [[6-1_GCP_프로젝트_셋업]] | [[6-3_크론잡_자동화]] | [[6-4_CICD_파이프라인]]

---

## 실습 목표

이 실습을 완료하면 다음을 할 수 있습니다:
- 프로젝트를 Docker 컨테이너로 빌드하여 Cloud Run에 배포
- Cloud Scheduler로 크론잡 자동화 설정
- GitHub Actions CI/CD 파이프라인 구축
- 배포된 서비스의 모니터링과 롤백

## 사전 요구사항

- [ ] GCP 계정 생성 완료 ([[6-1_GCP_프로젝트_셋업]] 참고)
- [ ] gcloud CLI 설치 + 인증 완료
- [ ] 필수 API 5개 활성화 완료
- [ ] Artifact Registry 저장소 생성 완료
- [ ] Docker 설치 (Docker Desktop 또는 Colima)
- [ ] 모듈 4 또는 5에서 만든 프로젝트 코드

---

## Part A: Cloud Run 배포 (15분)

### Step 1: 프로젝트 확인

```bash
cd ~/projects/multi-model-demo  # 또는 본인의 프로젝트 디렉토리

# 프로젝트 구조 확인
ls -la
# package.json, src/, tests/ 등이 있어야 합니다

# 빌드 확인
npm run build
```

### Step 2: Dockerfile 작성

프로젝트 루트에 `Dockerfile` 생성:

```dockerfile
# Build
FROM node:20-alpine AS builder
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --production=false
COPY . .
RUN npm run build

# Run
FROM node:20-alpine
WORKDIR /app
RUN addgroup --system app && adduser --system app --ingroup app
COPY package.json package-lock.json ./
RUN npm ci --production && npm cache clean --force
COPY --from=builder /app/dist ./dist
ENV PORT=8080
EXPOSE 8080
USER app
CMD ["node", "dist/server.js"]
```

`.dockerignore` 파일도 생성:

```
node_modules
dist
.git
*.md
.env*
tests
coverage
.vscode
```

### Step 3: 로컬 테스트

```bash
# 이미지 빌드
docker build -t marblo-app .

# 로컬 실행
docker run -p 8080:8080 -e PORT=8080 marblo-app

# 다른 터미널에서 테스트
curl http://localhost:8080/api/todos
# 정상 응답 확인

# 컨테이너 중지: Ctrl+C
```

### Step 4: GCP에 배포

```bash
# 변수 설정
PROJECT_ID=$(gcloud config get-value project)
REGION="asia-northeast3"
IMAGE="asia-northeast3-docker.pkg.dev/${PROJECT_ID}/marblo-repo/marblo-app"

# 이미지 태그 + 푸시
docker tag marblo-app:latest ${IMAGE}:v1
docker push ${IMAGE}:v1

# Cloud Run 배포
gcloud run deploy marblo-app \
  --image=${IMAGE}:v1 \
  --region=${REGION} \
  --platform=managed \
  --allow-unauthenticated \
  --port=8080 \
  --memory=512Mi \
  --min-instances=0 \
  --max-instances=3
```

### Step 5: 배포 확인

```bash
# 서비스 URL 확인
SERVICE_URL=$(gcloud run services describe marblo-app \
  --region=${REGION} --format='value(status.url)')
echo "URL: ${SERVICE_URL}"

# API 테스트
curl ${SERVICE_URL}/api/todos
```

**체크포인트:**
- [ ] `curl` 명령이 정상 응답을 반환하는가?
- [ ] GCP 콘솔 → Cloud Run에서 서비스가 보이는가?

---

## Part B: 환경변수 + Secret 설정 (5분)

### Step 6: 환경변수 설정

```bash
# 일반 환경변수
gcloud run services update marblo-app \
  --region=${REGION} \
  --set-env-vars="NODE_ENV=production,LOG_LEVEL=info"
```

### Step 7: Secret Manager 사용 (민감 정보)

```bash
# Secret 생성
echo -n "your-database-password" | \
  gcloud secrets create db-password --data-file=-

# Cloud Run 서비스 계정에 Secret 접근 권한 부여
SA_EMAIL=$(gcloud run services describe marblo-app \
  --region=${REGION} --format='value(spec.template.spec.serviceAccountName)')

# 기본 Compute 서비스 계정인 경우
SA_EMAIL="${PROJECT_ID}-compute@developer.gserviceaccount.com"

gcloud secrets add-iam-policy-binding db-password \
  --member="serviceAccount:${SA_EMAIL}" \
  --role="roles/secretmanager.secretAccessor"

# Cloud Run에 Secret 마운트
gcloud run services update marblo-app \
  --region=${REGION} \
  --set-secrets="DB_PASSWORD=db-password:latest"
```

**체크포인트:**
- [ ] `gcloud run services describe marblo-app`에서 환경변수가 보이는가?

---

## Part C: 크론잡 설정 (10분)

### Step 8: 크론 엔드포인트 추가

서버 코드에 크론 전용 엔드포인트를 추가합니다:

```typescript
// src/routes/cron.ts
import { Router } from 'express';

const router = Router();

router.post('/cron/health-check', async (req, res) => {
  console.log(`Cron executed at ${new Date().toISOString()}`);
  res.json({ success: true, timestamp: new Date().toISOString() });
});

export default router;
```

변경사항 배포:

```bash
docker build -t ${IMAGE}:v2 .
docker push ${IMAGE}:v2
gcloud run deploy marblo-app --image=${IMAGE}:v2 --region=${REGION}
```

### Step 9: Cloud Scheduler 설정

```bash
# 서비스 계정 생성
gcloud iam service-accounts create cron-sa \
  --display-name="Cron Scheduler SA"

# Cloud Run 호출 권한
gcloud run services add-iam-policy-binding marblo-app \
  --region=${REGION} \
  --member="serviceAccount:cron-sa@${PROJECT_ID}.iam.gserviceaccount.com" \
  --role="roles/run.invoker"

# 크론잡 생성 (5분마다 실행 — 테스트용)
gcloud scheduler jobs create http test-cron \
  --location=${REGION} \
  --schedule="*/5 * * * *" \
  --time-zone="Asia/Seoul" \
  --uri="${SERVICE_URL}/api/cron/health-check" \
  --http-method=POST \
  --oidc-service-account-email="cron-sa@${PROJECT_ID}.iam.gserviceaccount.com" \
  --oidc-token-audience="${SERVICE_URL}"
```

### Step 10: 크론잡 테스트

```bash
# 즉시 실행
gcloud scheduler jobs run test-cron --location=${REGION}

# 로그 확인 (30초 기다린 후)
gcloud logging read \
  "resource.type=cloud_run_revision AND textPayload:Cron" \
  --limit=5 --format='table(timestamp,textPayload)'
```

**체크포인트:**
- [ ] `gcloud scheduler jobs list`에서 크론잡이 보이는가?
- [ ] 즉시 실행 후 Cloud Run 로그에 기록이 남는가?

테스트가 끝나면 5분마다 도는 크론잡을 삭제하거나 일시 정지합니다:

```bash
# 일시 정지
gcloud scheduler jobs pause test-cron --location=${REGION}

# 또는 삭제
# gcloud scheduler jobs delete test-cron --location=${REGION}
```

---

## Part D: CI/CD 파이프라인 (15분)

### Step 11: GitHub 리포 준비

```bash
cd ~/projects/multi-model-demo

# GitHub 리포 생성 (gh CLI 사용)
gh repo create multi-model-demo --private --source=. --push

# 또는 GitHub 웹에서 리포 생성 후:
# git remote add origin https://github.com/username/multi-model-demo.git
# git push -u origin main
```

### Step 12: Workload Identity Federation 설정

```bash
PROJECT_NUMBER=$(gcloud projects describe ${PROJECT_ID} --format='value(projectNumber)')
GITHUB_REPO="your-username/multi-model-demo"

# Pool 생성
gcloud iam workload-identity-pools create github-pool \
  --location=global \
  --display-name="GitHub Pool"

# Provider 생성
gcloud iam workload-identity-pools providers create-oidc github-provider \
  --location=global \
  --workload-identity-pool=github-pool \
  --display-name="GitHub Provider" \
  --attribute-mapping="google.subject=assertion.sub,attribute.repository=assertion.repository" \
  --issuer-uri="https://token.actions.githubusercontent.com"

# 서비스 계정
gcloud iam service-accounts create github-sa \
  --display-name="GitHub Actions SA"

# 권한 부여
for ROLE in roles/run.admin roles/artifactregistry.writer roles/iam.serviceAccountUser; do
  gcloud projects add-iam-policy-binding ${PROJECT_ID} \
    --member="serviceAccount:github-sa@${PROJECT_ID}.iam.gserviceaccount.com" \
    --role="${ROLE}"
done

# WIF 바인딩
gcloud iam service-accounts add-iam-policy-binding \
  github-sa@${PROJECT_ID}.iam.gserviceaccount.com \
  --member="principalSet://iam.googleapis.com/projects/${PROJECT_NUMBER}/locations/global/workloadIdentityPools/github-pool/attribute.repository/${GITHUB_REPO}" \
  --role="roles/iam.workloadIdentityUser"
```

### Step 13: GitHub Secrets 설정

```bash
# WIF Provider 전체 이름 확인
WIF_PROVIDER=$(gcloud iam workload-identity-pools providers describe github-provider \
  --workload-identity-pool=github-pool --location=global --format='value(name)')

echo "WIF_PROVIDER: ${WIF_PROVIDER}"
echo "WIF_SERVICE_ACCOUNT: github-sa@${PROJECT_ID}.iam.gserviceaccount.com"
echo "GCP_PROJECT_ID: ${PROJECT_ID}"
```

GitHub 리포 → Settings → Secrets and variables → Actions에서 추가:

| Secret 이름 | 값 |
|-------------|---|
| `GCP_PROJECT_ID` | (위 출력의 PROJECT_ID) |
| `WIF_PROVIDER` | (위 출력의 WIF_PROVIDER) |
| `WIF_SERVICE_ACCOUNT` | (위 출력의 서비스 계정 이메일) |

### Step 14: GitHub Actions 워크플로우 생성

```bash
mkdir -p .github/workflows
```

`.github/workflows/deploy.yml`을 [[6-4_CICD_파이프라인]]의 YAML 내용으로 작성합니다.

### Step 15: 파이프라인 테스트

```bash
git add .
git commit -m "Add CI/CD pipeline"
git push origin main
```

GitHub → Actions 탭에서 실행 결과 확인.

**체크포인트:**
- [ ] test job이 녹색인가?
- [ ] deploy job이 녹색인가?
- [ ] Cloud Run에 새 리비전이 배포되었는가?

---

## Part E: 롤백 + 모니터링 (5분)

### Step 16: 롤백 방법

문제가 생기면 이전 버전으로 롤백합니다:

```bash
# 리비전 목록 확인
gcloud run revisions list --service=marblo-app --region=${REGION}

# 이전 리비전으로 트래픽 전환
gcloud run services update-traffic marblo-app \
  --region=${REGION} \
  --to-revisions=marblo-app-00001-abc=100
```

### Step 17: 모니터링 확인

```bash
# 최근 요청 로그
gcloud logging read \
  "resource.type=cloud_run_revision AND resource.labels.service_name=marblo-app" \
  --limit=20 --format='table(timestamp,httpRequest.requestUrl,httpRequest.status)'

# 서비스 메트릭
gcloud run services describe marblo-app \
  --region=${REGION} \
  --format='yaml(status)'
```

GCP 콘솔에서도 확인:
- Cloud Run → marblo-app → 지표 (Metrics) 탭
- 요청 수, 지연 시간, 오류율 그래프

---

## 최종 체크리스트

- [ ] Cloud Run에 서비스가 배포되어 있다
- [ ] 서비스 URL로 API 호출이 정상 동작한다
- [ ] 환경변수가 올바르게 설정되어 있다
- [ ] Cloud Scheduler 크론잡이 생성되어 있다
- [ ] GitHub Actions CI/CD 파이프라인이 동작한다
- [ ] main 브랜치 push 시 자동 배포가 된다
- [ ] 롤백 방법을 알고 있다

---

## 트러블슈팅

### 문제: Docker 빌드 실패 — "npm run build" 에러

```bash
# 로컬에서 먼저 빌드 테스트
npm run build

# TypeScript 에러가 있으면 수정
# tsconfig.json의 strict 모드 확인
```

### 문제: Cloud Run 배포 실패 — "Container failed to start"

```bash
# 로그 확인
gcloud logging read \
  "resource.type=cloud_run_revision AND severity=ERROR" \
  --limit=10

# 흔한 원인:
# 1. PORT 환경변수를 읽지 않는 서버 코드
# 2. 시작 시간이 너무 오래 걸림 (기본 타임아웃 240초)
# 3. 누락된 환경변수
```

### 문제: GitHub Actions 인증 실패

```bash
# WIF Provider 이름이 정확한지 확인
gcloud iam workload-identity-pools providers describe github-provider \
  --workload-identity-pool=github-pool --location=global

# GitHub Secrets 값이 올바른지 확인
# 특히 WIF_PROVIDER는 전체 경로여야 함:
# projects/123456/locations/global/workloadIdentityPools/github-pool/providers/github-provider
```

### 문제: Cloud Scheduler "PERMISSION_DENIED"

```bash
# 서비스 계정에 invoker 권한 확인
gcloud run services get-iam-policy marblo-app --region=${REGION}

# 권한 재부여
gcloud run services add-iam-policy-binding marblo-app \
  --region=${REGION} \
  --member="serviceAccount:cron-sa@${PROJECT_ID}.iam.gserviceaccount.com" \
  --role="roles/run.invoker"
```

---

## 정리 비용 (실습 후)

학습이 끝나면 불필요한 리소스를 정리해서 비용을 막습니다:

```bash
# Cloud Run 서비스 삭제
gcloud run services delete marblo-app --region=${REGION}

# Cloud Scheduler 크론잡 삭제
gcloud scheduler jobs delete test-cron --location=${REGION}

# Artifact Registry 이미지 삭제 (선택)
gcloud artifacts docker images delete \
  ${REGION}-docker.pkg.dev/${PROJECT_ID}/marblo-repo/marblo-app --delete-tags

# 또는 프로젝트 전체 삭제 (가장 확실)
# gcloud projects delete ${PROJECT_ID}
```

---

## 다음 단계

- [[7-1_랜딩페이지_Stitch]] — 배포된 서비스에 랜딩페이지 붙이기
- [[8-1_일상_운영패턴]] — 배포 후 운영 패턴
- [[8-2_Ralph_반복자동화]] — Ralph로 배포 자동화 확장

---
다음: [[7-1_랜딩페이지_Stitch]]
