---
tags: [강의, v3, 모듈6]
type: lecture
aliases: [CloudRun 배포]
---

# Cloud Run 배포

> 모듈 6 · 섹션 6-2 · 약 30분
> 관련: [[6-1_GCP_프로젝트_셋업]] | [[6-3_크론잡_자동화]]

---

## 도입 (3분)

자, GCP 셋업이 완료됐으니 이제 진짜 배포를 해봅시다! **(실습)**

화면: 슬라이드 — Cloud Run 개요 다이어그램

Cloud Run이 뭔지 간단히 설명드릴게요.

**Cloud Run = Docker 컨테이너를 서버리스로 실행**

- Docker 이미지를 올리면, GCP가 알아서 서버를 관리합니다
- 요청이 오면 자동으로 인스턴스를 띄우고, 없으면 0으로 줄입니다
- HTTPS URL을 자동으로 생성해줍니다
- 비용: 요청당 과금 — 트래픽이 없으면 $0

서버 관리가 필요 없다는 게 핵심이에요. EC2처럼 24시간 서버를 유지할 필요가 없습니다.

이번 섹션에서는:
1. Dockerfile 작성 (마블로 에이전트가 생성한 것 활용)
2. 이미지 빌드 + 푸시
3. Cloud Run 배포
4. 환경변수 설정
5. 커스텀 도메인 연결

전부 해봅니다.

---

## 본문 1: Dockerfile 작성 (6분)

화면: VS Code — Dockerfile 편집

먼저 Dockerfile이 필요합니다. 마블로 에이전트에게 생성시킬 수도 있지만, 여기서는 직접 작성하면서 이해해봅시다.

**(실습)** 프로젝트 루트에 `Dockerfile`을 만듭니다:

```dockerfile
# ---- Build Stage ----
FROM node:20-alpine AS builder

WORKDIR /app

# 의존성 먼저 설치 (캐시 활용)
COPY package.json package-lock.json ./
RUN npm ci --production=false

# 소스 복사 + 빌드
COPY . .
RUN npm run build

# ---- Production Stage ----
FROM node:20-alpine AS runner

WORKDIR /app

# 보안: non-root 사용자로 실행
RUN addgroup --system appgroup && adduser --system appuser --ingroup appgroup

# 프로덕션 의존성만 설치
COPY package.json package-lock.json ./
RUN npm ci --production && npm cache clean --force

# 빌드 결과물 복사
COPY --from=builder /app/dist ./dist

# 포트 설정 — Cloud Run은 PORT 환경변수를 주입합니다
ENV PORT=8080
EXPOSE 8080

# non-root로 전환
USER appuser

# 실행
CMD ["node", "dist/server.js"]
```

중요한 포인트를 짚어볼게요:

### Multi-stage 빌드

```dockerfile
FROM node:20-alpine AS builder   # 빌드 스테이지 (devDependencies 포함)
FROM node:20-alpine AS runner    # 실행 스테이지 (프로덕션 의존성만)
```

두 단계로 나누면 최종 이미지 크기가 훨씬 줄어듭니다. 빌드에만 필요한 TypeScript 컴파일러, 테스트 도구 등이 최종 이미지에 포함되지 않으니까요.

### Cloud Run의 PORT 환경변수

```dockerfile
ENV PORT=8080
```

Cloud Run은 `PORT` 환경변수를 자동으로 주입합니다. 서버 코드에서 이걸 읽어야 해요:

```typescript
// src/server.ts
const PORT = process.env.PORT || 8080;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
```

### non-root 사용자

```dockerfile
RUN addgroup --system appgroup && adduser --system appuser --ingroup appgroup
USER appuser
```

보안 모범 사례입니다. 컨테이너 안에서 root로 실행하면 보안 취약점이 될 수 있어요.

### 마블로 에이전트가 Dockerfile을 생성하게 하기

직접 작성하는 대신, 마블로 에이전트에게 시킬 수도 있습니다:

```
오케스트레이터에 입력:
"이 프로젝트에 맞는 프로덕션용 Dockerfile을 만들어줘.
 Cloud Run 배포용이고, multi-stage build를 사용하고,
 non-root 사용자로 실행해야 해."
```

에이전트가 프로젝트 구조를 분석해서 알맞은 Dockerfile을 생성해줄 겁니다.

---

## 본문 2: .dockerignore 작성 (2분)

화면: VS Code — .dockerignore 편집

Docker 빌드 컨텍스트에서 불필요한 파일을 제외합시다:

**(실습)** `.dockerignore` 파일 생성:

```
node_modules
dist
.git
.gitignore
*.md
.env
.env.*
tests
coverage
.vscode
```

특히 `node_modules`를 제외하는 게 중요합니다. 이걸 빼면 빌드 컨텍스트가 수백 MB가 되어서 빌드가 느려져요.

---

## 본문 3: 로컬에서 빌드 + 테스트 (4분)

화면: 터미널

Cloud Run에 올리기 전에 로컬에서 먼저 테스트합시다.

**(실습)**

```bash
# Docker 이미지 빌드
docker build -t marblo-todo-app .

# 빌드 성공 확인
docker images | grep marblo-todo-app
# marblo-todo-app   latest   abc123   10 seconds ago   150MB
```

150MB 정도면 꽤 가볍습니다. Alpine 기반이라 그래요.

```bash
# 로컬에서 실행 테스트
docker run -p 8080:8080 \
  -e PORT=8080 \
  -e DATABASE_URL="sqlite://./test.db" \
  marblo-todo-app

# 다른 터미널에서 테스트
curl http://localhost:8080/api/todos
# {"data":[],"count":0}
```

정상 응답이 오면 성공! `Ctrl+C`로 컨테이너를 중지합니다.

---

## 본문 4: GCP에 이미지 푸시 + Cloud Run 배포 (8분)

화면: 터미널

이제 진짜 배포합니다.

**(실습)**

### Step 1: 이미지 태그 + 푸시

```bash
# 변수 설정
PROJECT_ID=$(gcloud config get-value project)
REGION="asia-northeast3"
REPO="marblo-repo"
IMAGE_NAME="marblo-todo-app"
TAG="v1.0.0"

# 이미지에 Artifact Registry 태그 추가
docker tag ${IMAGE_NAME}:latest \
  ${REGION}-docker.pkg.dev/${PROJECT_ID}/${REPO}/${IMAGE_NAME}:${TAG}

# Artifact Registry에 푸시
docker push ${REGION}-docker.pkg.dev/${PROJECT_ID}/${REPO}/${IMAGE_NAME}:${TAG}
```

화면: Docker push 진행 중... 레이어가 하나씩 업로드

처음 푸시할 때는 시간이 좀 걸립니다. 다음부터는 변경된 레이어만 올라가서 빠릅니다.

### Step 2: Cloud Run 배포

```bash
gcloud run deploy marblo-todo-app \
  --image=${REGION}-docker.pkg.dev/${PROJECT_ID}/${REPO}/${IMAGE_NAME}:${TAG} \
  --region=${REGION} \
  --platform=managed \
  --allow-unauthenticated \
  --port=8080 \
  --memory=512Mi \
  --cpu=1 \
  --min-instances=0 \
  --max-instances=3 \
  --set-env-vars="NODE_ENV=production"
```

각 옵션 설명:

| 옵션 | 설명 |
|------|------|
| `--allow-unauthenticated` | 누구나 접근 가능 (공개 API) |
| `--port=8080` | 컨테이너가 리스닝하는 포트 |
| `--memory=512Mi` | 인스턴스당 메모리 |
| `--cpu=1` | CPU 코어 수 |
| `--min-instances=0` | 요청 없으면 0으로 줄임 (비용 절감) |
| `--max-instances=3` | 최대 3개까지 자동 스케일 |

화면: 배포 진행 중...

```
Deploying container to Cloud Run service [marblo-todo-app]...
✓ Deploying new service... Done.
  ✓ Creating Revision...
  ✓ Routing traffic...
Done.
Service [marblo-todo-app] revision [marblo-todo-app-00001-abc]
  has been deployed and is serving 100% of traffic.
Service URL: https://marblo-todo-app-xxxx-dt.a.run.app
```

**Service URL이 나왔습니다!** 이 URL로 전 세계 어디서든 접속할 수 있어요.

### Step 3: 배포 확인

```bash
# URL 변수 저장
SERVICE_URL=$(gcloud run services describe marblo-todo-app \
  --region=${REGION} --format='value(status.url)')

echo "Service URL: ${SERVICE_URL}"

# API 테스트
curl ${SERVICE_URL}/api/todos
# {"data":[],"count":0}
```

성공입니다! 로컬에서 돌리던 것과 똑같은 응답이 나옵니다.

---

## 본문 5: 환경변수 설정 (4분)

화면: 터미널

프로덕션 환경에서는 API 키, 데이터베이스 연결 정보 등을 환경변수로 관리합니다.

**(실습)**

```bash
# 환경변수 추가 (기존 서비스 업데이트)
gcloud run services update marblo-todo-app \
  --region=${REGION} \
  --set-env-vars="NODE_ENV=production" \
  --set-env-vars="DATABASE_URL=postgresql://user:pass@host:5432/dbname" \
  --set-env-vars="API_SECRET=your-secret-key"
```

**중요: 민감한 값은 Secret Manager를 사용하세요.**

```bash
# Secret 생성
echo -n "super-secret-api-key" | \
  gcloud secrets create api-secret --data-file=-

# Cloud Run에서 Secret을 환경변수로 마운트
gcloud run services update marblo-todo-app \
  --region=${REGION} \
  --set-secrets="API_SECRET=api-secret:latest"
```

Secret Manager를 쓰면 환경변수 값이 GCP 콘솔에서도 마스킹되어 보이고, 접근 로그도 남습니다. 보안상 훨씬 좋습니다.

현재 설정 확인:

```bash
gcloud run services describe marblo-todo-app \
  --region=${REGION} \
  --format='yaml(spec.template.spec.containers[0].env)'
```

---

## 본문 6: 커스텀 도메인 연결 (3분)

화면: GCP 콘솔 — Cloud Run → 도메인 매핑

기본 URL(`xxxxx-dt.a.run.app`)은 길고 외우기 어렵죠. 자신의 도메인을 연결해봅시다.

**(실습)** 도메인이 있는 경우:

```bash
# 도메인 매핑 생성
gcloud run domain-mappings create \
  --service=marblo-todo-app \
  --domain=api.yourdomain.com \
  --region=${REGION}
```

이 명령을 실행하면 DNS 레코드 설정이 필요하다고 안내가 나옵니다:

```
Please add the following DNS records:
  CNAME api.yourdomain.com → ghs.googlehosted.com.
```

도메인 제공업체(Cloudflare, GoDaddy 등)에서 CNAME 레코드를 추가하면 됩니다.

SSL 인증서는 GCP가 자동으로 발급하고 관리합니다 — Let's Encrypt 기반이에요. 별도 설정 불필요.

도메인이 없다면? 기본 URL을 그대로 사용해도 됩니다. HTTPS가 기본 제공되니까 보안 문제도 없어요.

---

## 본문 7: 배포 결과 확인 + 모니터링 (3분)

화면: GCP 콘솔 — Cloud Run 서비스 상세

배포가 완료됐으니, 서비스 상태를 확인합시다.

```bash
# 서비스 상태 확인
gcloud run services describe marblo-todo-app --region=${REGION}

# 최근 리비전(배포 버전) 목록
gcloud run revisions list --service=marblo-todo-app --region=${REGION}

# 로그 확인 (최근 50줄)
gcloud logging read \
  "resource.type=cloud_run_revision AND resource.labels.service_name=marblo-todo-app" \
  --limit=50 --format='table(timestamp,textPayload)'
```

화면: GCP 콘솔 — Cloud Run 대시보드

GCP 콘솔에서 시각적으로도 확인할 수 있습니다:
- **요청 수**: 시간별 요청 그래프
- **지연 시간**: p50, p95, p99 응답 시간
- **오류율**: 4xx, 5xx 에러 비율
- **인스턴스 수**: 현재 활성 인스턴스

`min-instances=0`으로 설정했으니, 요청이 없으면 인스턴스가 0개입니다. 첫 요청 시 약 2~3초의 콜드 스타트가 있을 수 있어요. 이게 싫으면 `min-instances=1`로 설정하면 됩니다 (비용 발생).

---

## 정리 (2분)

화면: 배포 파이프라인 요약

Cloud Run 배포 전체 과정을 정리합니다:

```
Dockerfile 작성
    ↓
docker build (로컬 빌드)
    ↓
docker push (Artifact Registry에 업로드)
    ↓
gcloud run deploy (Cloud Run에 배포)
    ↓
환경변수 + Secret 설정
    ↓
(선택) 커스텀 도메인 연결
    ↓
https://your-app.run.app ← 전 세계 접속 가능!
```

핵심 포인트:
1. **Dockerfile**: Multi-stage 빌드 + non-root 사용자
2. **Cloud Run**: 서버리스, 자동 스케일링, HTTPS 자동
3. **환경변수**: 일반 값은 `--set-env-vars`, 민감한 값은 Secret Manager
4. **비용**: `min-instances=0`이면 요청 없을 때 $0

다음 섹션에서는 배포된 서비스를 크론잡으로 자동화하는 방법을 배우겠습니다.

---
다음: [[6-3_크론잡_자동화]]
