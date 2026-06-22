---
tags: [강의, v3, 모듈7]
type: lecture
aliases: [GCP Cloud Run 배포, 에이전트 주도 배포]
---

# 에이전트 주도 GCP Cloud Run 배포

> 모듈 7 · 섹션 7-2 · 약 35분
> 관련: [[7-1_워크트리통합_main머지]] | [[7-3_크론잡_CICD_자동화]]

---

## 이 강의에서 다루는 것

- **학습목표:** 깨끗해진 `main`을 **GCP Cloud Run**에 올린다. GCP 프로젝트·API·예산 알림을 빠르게 세팅하고, **DevOps 에이전트에게 Dockerfile을 생성**시킨 뒤, `gcloud run deploy` + **Secret Manager** + **Cloud SQL**로 ReachWave를 클라우드에 띄운다. 나는 결과 URL만 확인한다.
- **시연할 마블로 화면·기능:** **코드 탭**(에이전트가 만든 Dockerfile) + **터미널**(gcloud) + **GCP 콘솔**(Cloud Run 대시보드).
- **진행할 프로젝트 단계:** **P3 클라우드 배포** — 로컬에서만 돌던 ReachWave를 전 세계가 접속할 URL로.
- **핵심 메시지:** "**배포도 에이전트가, 나는 확인만.**"

---

## 도입 — 로컬에서 클라우드로 (3분)

> 화면: 슬라이드 — "내 맥북 → 전 세계가 접속하는 URL"

P3 ReachWave를 `main`에 다 모았습니다([[7-1_워크트리통합_main머지]]). 그런데 지금은 **내 컴퓨터에서만** 돌죠. 사용자가 못 씁니다. 이걸 클라우드에 올려 **누구나 접속하는 HTTPS URL**로 만들 차례예요.

왜 **GCP Cloud Run**이냐:

1. **서버리스 컨테이너** — Docker 이미지를 올리면 GCP가 서버를 알아서 관리. 요청이 없으면 인스턴스를 0으로 줄여 **비용 0원**.
2. **HTTPS 자동** — 배포만 하면 SSL이 붙은 URL이 나옵니다.
3. **무료 크레딧** — 신규 가입 시 $300, Cloud Run은 월 200만 요청까지 무료. 학습엔 차고 넘쳐요.

그리고 이번 강의의 진짜 포인트 — **배포 작업 자체를 에이전트에게 시킵니다.** Dockerfile 작성 같은 정형화된 DevOps 작업은 에이전트가 잘하거든요. 나는 명령을 내리고 **결과를 확인**합니다.

> 💡 **Deploy 탭은?** 마블로에는 배포를 GUI로 묶을 **Deploy 탭**이 준비 중입니다(현재 **dev-only 베타**, [[8-4_베타미리보기_확장_마무리|8-4]]에서 미리보기). 정식 출시 전까지 이번 강의는 **CLI 주도**로 갑니다 — `gcloud` 명령을 에이전트가 짜고 돌리는 방식이 지금은 가장 투명하고 재현 가능해요.

---

## 본문

### 1. GCP 프로젝트 · API · 예산 알림 (8분)

> 화면: 브라우저(console.cloud.google.com) + 터미널

**(실습)** 배포 받을 그릇부터 만듭니다. 빠르게 갑니다.

**① 계정 + 프로젝트.** 처음이면 https://cloud.google.com → "무료로 시작하기"(카드 등록 필요하나 $300 크레딧, 자동 과금 없음). 그다음 프로젝트를 만듭니다.

```bash
# 프로젝트 ID는 본인 것으로 — 강의에선 reachwave-prod 템플릿을 씁니다
PROJECT_ID="reachwave-prod-<숫자>"   # 예: reachwave-prod-12345
REGION="asia-northeast3"             # 서울 리전 (한국 접속 빠름)

gcloud config set project "${PROJECT_ID}"
gcloud config set run/region "${REGION}"
gcloud auth login                    # 브라우저로 Google 로그인 → 승인
gcloud auth configure-docker "${REGION}-docker.pkg.dev"
```

> 💡 프로젝트 ID는 강의 내내 쓰니 메모해 두세요. 본인 서비스라면 `reachwave-prod-` 대신 원하는 이름으로 바꾸면 됩니다 — 이름만 템플릿이고 나머지 명령은 그대로예요.

**② 필수 API를 한 번에 켭니다.** GCP는 서비스별 API를 명시적으로 활성화해야 써요.

```bash
gcloud services enable \
  run.googleapis.com \
  cloudbuild.googleapis.com \
  artifactregistry.googleapis.com \
  cloudscheduler.googleapis.com \
  secretmanager.googleapis.com \
  sqladmin.googleapis.com
```

**③ Docker 이미지 저장소(Artifact Registry) + 매니지드 Postgres(Cloud SQL).** ReachWave는 PostgreSQL을 쓰니([[5-3_Sprint1_백엔드_라이브빌딩]]), 코드(SQLAlchemy/Alembic)는 그대로 두고 호스팅만 GCP에 맡깁니다.

```bash
# Docker 이미지 저장소
gcloud artifacts repositories create reachwave-repo \
  --repository-format=docker --location="${REGION}"

# 학습용 최소 사양 Postgres (db-f1-micro ≈ 월 $10, 크레딧 안에서 충분)
gcloud sql instances create reachwave-db \
  --database-version=POSTGRES_16 --tier=db-f1-micro \
  --region="${REGION}" --storage-size=10GB
gcloud sql databases create reachwave --instance=reachwave-db
```

**④ 예산 알림 — 이건 꼭.** 클라우드 비용이 예상 밖으로 튈 수 있어요. GCP 콘솔 → 결제 → 예산 및 알림에서 한도 $10, 임계값 50/80/100%에 이메일 알림을 걸어 둡니다. 학습용이라 무료 크레딧 안에서 끝나지만, **안전벨트는 출발 전에** 맵니다.

### 2. DevOps 에이전트에게 Dockerfile 시키기 (8분)

> 화면: 마블로 오케스트레이터 → 코드 탭(생성된 Dockerfile)

직접 손으로 쓸 수도 있지만, 우리에겐 에이전트가 있죠. **(실습)** 오케스트레이터에 요청합니다.

```
ReachWave를 Cloud Run에 배포할 준비를 해줘. devops 역할 에이전트로:
1. backend/ (FastAPI) 프로덕션용 Dockerfile — multi-stage, non-root,
   PORT 환경변수 사용, uvicorn 실행
2. .dockerignore (node_modules·.venv·.git·tests 제외)
배포 명령은 내가 직접 확인하고 돌릴 테니, 파일만 만들어줘.
```

오케스트레이터가 devops 태스크를 만들고 에이전트가 워크트리에서 작업합니다. 끝나면 **코드 탭 diff**로 결과를 봅니다.

```dockerfile
# backend/Dockerfile — 에이전트 생성물 (FastAPI 프로덕션)
# ---- build ----
FROM python:3.12-slim AS builder
WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir --prefix=/install -r requirements.txt

# ---- run ----
FROM python:3.12-slim
WORKDIR /app
RUN useradd --system appuser
COPY --from=builder /install /usr/local
COPY . .
ENV PORT=8080
EXPOSE 8080
USER appuser
# Cloud Run이 주입하는 $PORT로 listen
CMD ["sh", "-c", "uvicorn app.main:app --host 0.0.0.0 --port ${PORT}"]
```

확인 포인트만 짚습니다 — 코드를 한 줄씩 다 읽을 필요는 없어요.

- **multi-stage** — 빌드 도구가 최종 이미지에 안 들어가 가볍다.
- **`$PORT` 사용** — Cloud Run은 포트를 환경변수로 주입합니다. 이걸 안 읽으면 컨테이너가 안 떠요(가장 흔한 배포 실패 원인).
- **non-root(`USER appuser`)** — 컨테이너 보안 기본기.

> 💡 프론트(Next.js)는 별도 서비스로 배포하거나 정적 호스팅으로 분리하는 게 깔끔합니다. 강의에선 **백엔드(API) 배포**에 집중하고, 프론트 배포는 같은 패턴(자체 Dockerfile → `gcloud run deploy`)으로 동일하게 적용된다고만 알아두세요.

### 3. 배포 + 시크릿 + DB 연결 (9분)

> 화면: 터미널 — gcloud 명령 / GCP 콘솔 — Cloud Run

이제 진짜 올립니다. **(실습)**

**① 이미지 빌드 → 푸시.**

```bash
IMAGE="${REGION}-docker.pkg.dev/${PROJECT_ID}/reachwave-repo/reachwave-api"
docker build -t "${IMAGE}:v1" ./backend
docker push "${IMAGE}:v1"
```

**② 민감 값은 Secret Manager에.** DB 비밀번호, 서비스 LLM API 키, Toss 결제 키 등은 코드·환경변수 평문이 아니라 시크릿으로 둡니다.

```bash
# DB 비밀번호 (Cloud SQL 사용자 생성 시 정한 값)
printf '%s' "<DB 비밀번호>" | gcloud secrets create reachwave-db-password --data-file=-
# 서비스 LLM 키 (client.py의 MODEL이 호출하는 그 API)
printf '%s' "<LLM API 키>"   | gcloud secrets create reachwave-llm-key --data-file=-
```

**③ 배포 — Cloud SQL을 붙이고 시크릿을 주입.** Cloud Run ↔ Cloud SQL은 **Unix 소켓**(`/cloudsql/<connectionName>`)으로 IP 노출 없이 IAM 인증해 붙는 게 표준입니다.

```bash
INSTANCE_CONN=$(gcloud sql instances describe reachwave-db --format='value(connectionName)')

gcloud run deploy reachwave-api \
  --image="${IMAGE}:v1" \
  --region="${REGION}" \
  --allow-unauthenticated \
  --port=8080 --memory=512Mi --cpu=1 \
  --min-instances=0 --max-instances=3 \
  --add-cloudsql-instances="${INSTANCE_CONN}" \
  --set-env-vars="ENV=production,DB_HOST=/cloudsql/${INSTANCE_CONN}" \
  --set-secrets="DB_PASSWORD=reachwave-db-password:latest,LLM_API_KEY=reachwave-llm-key:latest"
```

옵션을 한 줄로:

| 옵션                      | 뜻                                                           |
| ------------------------- | ------------------------------------------------------------ |
| `--allow-unauthenticated` | 공개 API(누구나 접근)                                        |
| `--min-instances=0`       | 요청 없으면 0개 → 비용 $0 (첫 요청 시 콜드스타트 2~3초)      |
| `--max-instances=3`       | 트래픽 늘면 최대 3개까지 자동 스케일                         |
| `--set-secrets`           | 평문 대신 Secret Manager에서 주입(콘솔에서 마스킹·접근 로그) |

> ⚠️ 마이그레이션(Alembic)은 배포와 분리하세요. 첫 배포 전 또는 릴리스 단계에서 `alembic upgrade head`를 한 번 돌려 스키마를 맞춥니다. 컨테이너 부팅에 묶으면 인스턴스가 여러 개 뜰 때 동시에 마이그레이션이 돌아 꼬여요.

### 4. 결과 확인 — 나는 여기만 본다 (5분)

> 화면: 터미널(curl) + GCP 콘솔(Cloud Run 지표)

배포가 끝나면 **Service URL**이 나옵니다. 이게 전 세계 접속 주소예요.

```bash
SERVICE_URL=$(gcloud run services describe reachwave-api \
  --region="${REGION}" --format='value(status.url)')
echo "${SERVICE_URL}"
# 예: https://reachwave-api-xxxx-du.a.run.app

curl "${SERVICE_URL}/health"
# {"status":"ok"}
```

`/health`가 `ok`면 클라우드에서 ReachWave 백엔드가 살아있는 겁니다. GCP 콘솔 → Cloud Run → `reachwave-api`에서 **요청 수·지연 시간(p50/p95)·오류율·인스턴스 수**를 그래프로도 봅니다.

> 💡 문제가 생기면 로그부터. `gcloud logging read "resource.type=cloud_run_revision AND severity=ERROR" --limit=10`. 컨테이너가 안 뜨면 십중팔구 **`$PORT` 미사용**이거나 **누락된 시크릿/환경변수**입니다. 롤백은 `gcloud run services update-traffic reachwave-api --to-revisions=<이전리비전>=100` 한 줄.

배포 명령을 짜고 다듬는 것까지 에이전트에게 맡길 수도 있습니다. 나는 **URL과 지표를 확인**하는 사람이에요 — 이게 "배포도 에이전트가, 나는 확인만"의 실체입니다.

---

## 정리 (2분)

1. **배포 = main을 클라우드로.** Cloud Run은 서버리스 컨테이너 — HTTPS 자동, 요청 없으면 $0.
2. **그릇 먼저.** 프로젝트·리전·API 6종·Artifact Registry·Cloud SQL·예산 알림을 빠르게 세팅(이름만 `reachwave-` 템플릿).
3. **Dockerfile은 에이전트가.** devops 에이전트에게 시키고, `$PORT`·multi-stage·non-root만 확인.
4. **시크릿은 Secret Manager, DB는 Cloud SQL 소켓.** 평문 금지, 마이그레이션은 배포와 분리.
5. **나는 결과만 확인.** Service URL `/health` + 콘솔 지표 + 실패 시 로그·롤백 한 줄.

`main`이 클라우드 URL이 됐습니다. 다음 섹션에서는 이걸 **사람 손 없이 돌게** 만듭니다 — 크론잡으로 주기 작업을, CI/CD로 "푸시하면 자동 배포"를.

---

다음: [[7-3_크론잡_CICD_자동화]]
