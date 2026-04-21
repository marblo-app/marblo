---
name: tf-deploy
description: GCP Cloud Run 배포 + Cloud Scheduler 등록. 오케스트레이터가 프로젝트를 배포합니다.
allowed-tools: Bash, Read, Write, Edit, Glob, Grep
---

# GCP 배포 스킬

> Cloud Run 배포 + Cloud Scheduler 등록을 자동으로 진행합니다.
> gcp-automation-skill 레시피를 기반으로 합니다.

---

## 아키텍처

```
[Python 함수] → [Flask 엔드포인트] → [Docker] → [Cloud Run] → [Cloud Scheduler]
 비즈니스 로직   batch_endpoint.py    컨테이너    서버리스        cron 트리거
```

---

## 사전 확인

배포 전에 반드시 확인:

1. **gcloud CLI 설치 여부**: `gcloud version` 실행
2. **인증 상태**: `gcloud auth list` — 활성 계정 확인
3. **프로젝트 설정**: `gcloud config get-value project`
4. **Docker 사용 가능**: `docker version`

미설치/미인증 시 사용자에게 안내:
```bash
# gcloud 설치
curl https://sdk.cloud.google.com | bash

# 로그인
gcloud auth login

# 프로젝트 설정
gcloud config set project PROJECT_ID
```

---

## 워크플로우

### 1단계: GCP 프로젝트 연결

사용자에게 3가지 확인:
- **GCP 프로젝트 ID**: `gcloud config get-value project`
- **리전**: 기본 `asia-northeast3` (서울)
- **서비스 계정**: Cloud Run용 서비스 계정

```bash
GCP_PROJECT="프로젝트-id"
REGION="asia-northeast3"
SERVICE_NAME="서비스-이름"
GCLOUD=$(which gcloud)
```

### 2단계: 빌드 & 배포

```bash
# Docker 이미지 빌드 (Cloud Build)
$GCLOUD builds submit \
  --tag gcr.io/$GCP_PROJECT/$SERVICE_NAME:latest \
  --project=$GCP_PROJECT

# Cloud Run 배포
$GCLOUD run deploy $SERVICE_NAME \
  --image=gcr.io/$GCP_PROJECT/$SERVICE_NAME:latest \
  --project=$GCP_PROJECT \
  --region=$REGION \
  --memory=2Gi \
  --cpu=2 \
  --timeout=900 \
  --min-instances=1 \
  --quiet
```

### 3단계: Cloud Scheduler 등록

```bash
SERVICE_URL=$($GCLOUD run services describe $SERVICE_NAME \
  --project=$GCP_PROJECT --region=$REGION --format='value(status.url)')

$GCLOUD scheduler jobs create http JOB_NAME \
  --project=$GCP_PROJECT \
  --location=$REGION \
  --schedule="CRON_EXPRESSION" \
  --time-zone="Asia/Seoul" \
  --uri="$SERVICE_URL/ENDPOINT_PATH" \
  --http-method=POST \
  --headers="Content-Type=application/json" \
  --body='{}' \
  --oidc-service-account-email=$SA_EMAIL \
  --oidc-token-audience="$SERVICE_URL" \
  --attempt-deadline=900s
```

### 4단계: 검증

```bash
# 수동 트리거
$GCLOUD scheduler jobs run JOB_NAME --project=$GCP_PROJECT --location=$REGION

# 로그 확인
$GCLOUD logging read \
  "resource.type=cloud_run_revision AND resource.labels.service_name=$SERVICE_NAME" \
  --project=$GCP_PROJECT --limit=30 --freshness=10m \
  --format="table(timestamp,textPayload)"
```

---

## 자주 쓰는 cron

| 표현식 | 의미 |
|--------|------|
| `*/30 * * * *` | 30분마다 |
| `0 */4 * * *` | 4시간마다 |
| `0 9 * * 1-5` | 평일 09:00 |
| `0 0 1,15 * *` | 매월 1일, 15일 |

---

## Secret Manager 연동

```bash
# 시크릿 생성
$GCLOUD secrets create SECRET_NAME --project=$GCP_PROJECT

# 값 설정
echo -n "secret-value" | $GCLOUD secrets versions add SECRET_NAME \
  --data-file=- --project=$GCP_PROJECT

# Cloud Run에 환경 변수로 마운트
$GCLOUD run deploy $SERVICE_NAME \
  --set-secrets="ENV_VAR=SECRET_NAME:latest" \
  --project=$GCP_PROJECT --region=$REGION
```

---

## 트러블슈팅

| 문제 | 원인 | 해결 |
|------|------|------|
| 504 Timeout | 작업이 deadline 초과 | `--attempt-deadline=900s` 또는 작업 분리 |
| Cold Start 실패 | min-instances=0 | `--min-instances=1` |
| 429 Rate Limit | Cloud Run 공유 IP | 요청 간 sleep 추가 |
| Permission Denied | 서비스 계정 권한 부족 | IAM 역할 확인 |

---

## 사용자 확인 사항

배포 요청 시 사용자에게 확인:
1. **무슨 서비스?** (프로젝트 내 Dockerfile 위치)
2. **어떤 리전?** (기본: asia-northeast3)
3. **스케줄러 필요?** (cron 표현식)
4. **환경 변수/시크릿?** (Secret Manager 사용 여부)

확인 후 순서대로 진행. 각 단계 결과를 사용자에게 보고.
