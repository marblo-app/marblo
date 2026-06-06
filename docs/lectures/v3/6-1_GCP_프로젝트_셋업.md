---
tags: [강의, v3, 모듈6]
type: lecture
aliases: [GCP 프로젝트 셋업]
---

# GCP 프로젝트 셋업

> 모듈 6 · 섹션 6-1 · 약 20분
> 관련: [[5-5_모델별_비용성능]] | [[6-2_CloudRun_배포]]

---

## 도입 (3분)

여러분, 모듈 5까지 로컬에서 정말 멋진 프로젝트를 만들었죠? AI 에이전트 군단이 멀티모델로 코드를 작성하고, 칸반 보드에서 관리하고. 근데 이걸 내 컴퓨터에서만 돌리면 아무도 못 보잖아요?

화면: 슬라이드 — "로컬에서 클라우드로"

이번 모듈에서는 만든 프로젝트를 **Google Cloud Platform(GCP)**에 배포합니다. 왜 GCP냐고요?

1. **Cloud Run**: Docker 컨테이너를 서버리스로 배포. 요청이 없으면 비용 0원.
2. **무료 크레딧**: 신규 가입 시 $300 무료 크레딧 제공.
3. **Cloud Scheduler**: 크론잡 자동화가 쉬움.
4. **Cloud Build**: CI/CD 파이프라인 구축이 간편.

오늘은 먼저 GCP 프로젝트를 세팅하는 것부터 시작합니다. 계정 만들기, CLI 설치, API 활성화, 예산 알림까지 한번에 해봅시다.

---

## 본문 1: GCP 계정 + 프로젝트 생성 (5분)

화면: 브라우저 — console.cloud.google.com

**(실습)** 함께 따라해봅시다.

### 1-a: GCP 계정이 없는 경우

1. https://cloud.google.com 접속
2. "무료로 시작하기" 클릭
3. Google 계정으로 로그인
4. 결제 정보 입력 (신용카드 필요하지만, $300 무료 크레딧 제공)
5. **무료 체험 기간에는 자동 과금 안 됨** — 수동으로 업그레이드하지 않으면 괜찮습니다

화면: GCP 콘솔 대시보드

### 1-b: 프로젝트 생성

1. GCP 콘솔 상단의 프로젝트 선택 드롭다운 클릭
2. "새 프로젝트" 클릭
3. 설정:
   ```
   프로젝트 이름: marblo-todo-app
   프로젝트 ID: marblo-todo-app-xxxx (자동 생성, 수정 가능)
   조직: (개인이면 "조직 없음")
   ```
4. "만들기" 클릭

화면: 프로젝트가 생성되고 대시보드로 이동

**프로젝트 ID를 꼭 메모해두세요.** 앞으로 모든 명령에서 이 ID를 사용합니다.

```bash
# 예시
PROJECT_ID="marblo-todo-app-12345"
```

---

## 본문 2: gcloud CLI 설치 + 인증 (5분)

화면: 터미널

GCP를 커맨드라인에서 제어하려면 `gcloud` CLI가 필요합니다.

**(실습)** 설치부터 합시다:

### macOS (Homebrew)

```bash
# 설치
brew install google-cloud-sdk

# 설치 확인
gcloud version
# Google Cloud SDK 4xx.0.0
```

### 다른 OS

```bash
# 공식 설치 스크립트 (Linux/macOS)
curl https://sdk.cloud.google.com | bash

# Windows는 공식 설치 프로그램 다운로드:
# https://cloud.google.com/sdk/docs/install
```

### 인증

```bash
# Google 계정으로 로그인
gcloud auth login
# 브라우저가 열리고 Google 로그인 → 권한 승인
```

화면: 브라우저에서 Google 로그인 → 승인 완료 메시지

```bash
# 프로젝트 설정
gcloud config set project marblo-todo-app-12345

# 기본 리전 설정 (서울)
gcloud config set run/region asia-northeast3

# 설정 확인
gcloud config list
# [core]
# project = marblo-todo-app-12345
# [run]
# region = asia-northeast3
```

리전을 `asia-northeast3` (서울)로 설정하면, 한국에서 접속할 때 응답 속도가 빠릅니다.

### Docker 인증 설정

나중에 Docker 이미지를 GCP Artifact Registry에 푸시하기 위해 인증을 미리 설정합니다:

```bash
# Docker 인증 헬퍼 설정
gcloud auth configure-docker asia-northeast3-docker.pkg.dev
```

---

## 본문 3: 필수 API 활성화 (4분)

화면: 터미널

GCP에서는 각 서비스의 API를 명시적으로 활성화해야 사용할 수 있습니다. 필요한 API들을 한번에 활성화합시다.

**(실습)**

```bash
# Cloud Run API — 서버리스 컨테이너 배포
gcloud services enable run.googleapis.com

# Cloud Build API — CI/CD 빌드
gcloud services enable cloudbuild.googleapis.com

# Artifact Registry API — Docker 이미지 저장소
gcloud services enable artifactregistry.googleapis.com

# Cloud Scheduler API — 크론잡 스케줄링
gcloud services enable cloudscheduler.googleapis.com

# Cloud Functions API — 서버리스 함수 (크론잡 트리거용)
gcloud services enable cloudfunctions.googleapis.com

# Cloud SQL Admin API — 매니지드 PostgreSQL
gcloud services enable sqladmin.googleapis.com
```

한 줄로 전부 활성화할 수도 있습니다:

```bash
gcloud services enable \
  run.googleapis.com \
  cloudbuild.googleapis.com \
  artifactregistry.googleapis.com \
  cloudscheduler.googleapis.com \
  cloudfunctions.googleapis.com \
  sqladmin.googleapis.com
```

활성화가 완료되면 확인합시다:

```bash
gcloud services list --enabled --filter="name:run OR name:cloudbuild OR name:artifactregistry OR name:cloudscheduler"
```

화면: 활성화된 API 목록이 출력

각 API가 목록에 보이면 성공입니다.

### Artifact Registry 저장소 생성

Docker 이미지를 저장할 저장소를 만듭니다:

```bash
gcloud artifacts repositories create marblo-repo \
  --repository-format=docker \
  --location=asia-northeast3 \
  --description="Marblo Docker images"
```

확인:

```bash
gcloud artifacts repositories list --location=asia-northeast3
# REPOSITORY   FORMAT  DESCRIPTION               LOCATION
# marblo-repo  DOCKER  Marblo Docker images      asia-northeast3
```

### Cloud SQL for PostgreSQL 인스턴스 생성

ReachWave는 PostgreSQL을 쓰니까, GCP에서는 **Cloud SQL for PostgreSQL**(매니지드 Postgres)을 띄웁니다. 강의 코드(SQLAlchemy/Alembic)는 그대로 두고, 호스팅만 GCP가 맡는 구조입니다.

```bash
# 학습용 최소 사양 (db-f1-micro, 약 $10/월 — 무료 크레딧 안에서 충분)
gcloud sql instances create reachwave-db \
  --database-version=POSTGRES_16 \
  --tier=db-f1-micro \
  --region=asia-northeast3 \
  --storage-size=10GB \
  --storage-type=HDD \
  --backup-start-time=03:00
```

생성에 5-10분 걸립니다. 끝나면 DB와 사용자를 만듭니다:

```bash
# 애플리케이션 DB 생성
gcloud sql databases create reachwave --instance=reachwave-db

# 앱 전용 사용자 (비밀번호는 Secret Manager에 따로 보관할 것)
gcloud sql users create reachwave_app \
  --instance=reachwave-db \
  --password="$(openssl rand -base64 24)"

# 인스턴스 연결 이름 확인 — Cloud Run에서 이 값을 씁니다
gcloud sql instances describe reachwave-db --format='value(connectionName)'
# 예: marblo-todo-app-12345:asia-northeast3:reachwave-db
```

> **💡 왜 BigQuery가 아니라 Cloud SQL인가**
> ReachWave는 OLTP(가입·결제·CRUD)라 BigQuery(OLAP) 부적합. PostgreSQL을 유지하면서 GCP 매니지드 편의만 가져가는 게 Cloud SQL입니다. 수강자가 Supabase·Neon·RDS로 옮겨도 코드 변경 없음.

**무료 크레딧 안에 들어오게 하기**: `db-f1-micro` + HDD 10GB + 백업 보관 7일 기본값 정도면 월 $10 안쪽. $300 크레딧으로 강의 기간 충분히 커버됩니다.

---

## 본문 4: 예산 알림 설정 (3분)

화면: GCP 콘솔 — 결제 → 예산 및 알림

**이건 정말 중요합니다.** 클라우드 비용이 예상치 못하게 폭발할 수 있거든요. 예산 알림을 반드시 설정하세요.

**(실습)**

1. GCP 콘솔 → 좌측 메뉴 "결제" → "예산 및 알림"
2. "예산 만들기" 클릭
3. 설정:
   ```
   이름: Marblo Monthly Budget
   프로젝트: marblo-todo-app
   금액 유형: 지정된 금액
   대상 금액: $10 (학습용이니 넉넉하게)
   ```
4. 알림 임계값 설정:
   ```
   50% ($5) → 이메일 알림
   80% ($8) → 이메일 알림
   100% ($10) → 이메일 알림
   ```
5. "저장" 클릭

화면: 예산 설정 완료 화면

CLI로도 할 수 있습니다:

```bash
# 예산 생성 (gcloud beta billing 사용)
gcloud beta billing budgets create \
  --billing-account=YOUR_BILLING_ACCOUNT_ID \
  --display-name="Marblo Monthly Budget" \
  --budget-amount=10USD \
  --threshold-rule=percent=0.5 \
  --threshold-rule=percent=0.8 \
  --threshold-rule=percent=1.0
```

**무료 크레딧 팁:**

- 신규 가입하면 $300 무료 크레딧을 줍니다.
- Cloud Run은 월 200만 요청까지 무료입니다.
- 학습 목적이면 무료 범위 안에서 충분히 가능합니다.

---

## 본문 5: 환경 최종 확인 (2분)

화면: 터미널

모든 셋업이 끝났습니다. 최종 확인을 해봅시다.

**(실습)** 체크 스크립트:

```bash
echo "=== GCP Setup Check ==="

# 1. gcloud 설치 확인
echo "gcloud version:"
gcloud version --format='value(version)' 2>/dev/null && echo "OK" || echo "FAIL"

# 2. 프로젝트 설정 확인
echo "Project:"
gcloud config get-value project

# 3. 리전 설정 확인
echo "Region:"
gcloud config get-value run/region

# 4. 인증 확인
echo "Auth:"
gcloud auth list --filter=status:ACTIVE --format="value(account)"

# 5. Docker 인증 확인
echo "Docker auth:"
cat ~/.docker/config.json | grep "asia-northeast3" && echo "OK" || echo "FAIL"

# 6. API 확인
echo "APIs:"
gcloud services list --enabled --filter="name:run" --format="value(name)"
```

모든 항목이 정상이면 다음으로 진행할 준비가 된 겁니다.

---

## 정리 (2분)

화면: 체크리스트 슬라이드

오늘 GCP 셋업에서 한 일을 정리합니다:

- [x] **GCP 계정 생성** + $300 무료 크레딧 확인
- [x] **프로젝트 생성** — `marblo-todo-app`
- [x] **gcloud CLI 설치** + 인증 + 프로젝트/리전 설정
- [x] **필수 API 6개 활성화** — Cloud Run, Build, Artifact Registry, Scheduler, Functions, **Cloud SQL Admin**
- [x] **Artifact Registry 저장소 생성** — Docker 이미지 저장용
- [x] **Cloud SQL for PostgreSQL 인스턴스 생성** — `reachwave-db` (`db-f1-micro`, asia-northeast3)
- [x] **예산 알림 설정** — $10 한도, 50%/80%/100% 알림

이 기반 위에 다음 섹션에서 실제 배포를 진행합니다. Cloud Run으로 배포하면, 전 세계 어디서든 접속할 수 있는 URL을 받게 됩니다.

---

다음: [[6-2_CloudRun_배포]]
