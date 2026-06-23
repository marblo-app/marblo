---
tags: [강의, v3, 모듈7]
type: lecture
aliases: [크론잡 CICD 자동화, 한 번 만들면 알아서 돈다]
---

# 크론잡 / CI·CD 자동화

> 모듈 7 · 섹션 7-3 · 약 25분
> 관련: [[7-2_GCP_CloudRun_배포]] | [[7-4_랜딩페이지_런칭체크리스트]]

---

## 이 강의에서 다루는 것

- **학습목표:** 배포한 ReachWave를 **사람 손 없이** 돌게 만든다. **Cloud Scheduler**로 주기 작업(리드 재수집·A/B 집계)을 자동 실행하고(크론 엔드포인트 + OIDC 인증), **GitHub Actions + WIF**로 "`main`에 머지하면 자동 배포"되는 CI/CD 파이프라인을 건다.
- **시연할 마블로 화면·기능:** **터미널**(gcloud scheduler) + **GitHub Actions** 탭.
- **진행할 프로젝트 단계:** **P3 자동화** — 정기 작업과 배포를 무인화.
- **핵심 메시지:** "**한 번 만들면 알아서 돈다.**"

---

## 도입 — 자동화의 두 축 (3분)

> 화면: 슬라이드 — "사람이 안 건드려도 도는 시스템"

배포까지 했으니([[7-2_GCP_CloudRun_배포]]) 이제 **자동화**입니다. 두 가지를 겁니다.

1. **주기 작업 자동화 (크론잡)** — ReachWave는 매일 할 일이 있어요. 예를 들어 _"새 리드 소스에서 리드를 다시 긁어오고, 어제 발송한 콜드메일의 A/B 오픈율을 집계해 둔다."_ 사람이 매일 손으로? 귀찮죠. **Cloud Scheduler**가 정해진 시간에 알아서 호출합니다.
2. **배포 자동화 (CI/CD)** — 지금은 배포할 때마다 `docker build → push → gcloud run deploy`를 칩니다. 번거롭고 실수도 나죠. **GitHub Actions**로 *"`main`에 머지하면 테스트 통과 시 자동 배포"*를 만듭니다.

공통 원칙은 하나 — **한 번 제대로 만들어 두면, 그다음부터는 알아서 돕니다.**

---

## 본문

### 1. Cloud Scheduler로 주기 작업 (8분)

> 화면: 터미널 — 크론 엔드포인트 + gcloud scheduler

**Cloud Scheduler = GCP의 서버리스 크론잡.** 리눅스 `crontab`처럼 시간 기반으로 동작하지만 서버가 필요 없어요. 지정 시각에 HTTP 요청을 보냅니다.

먼저 크론 표현식 — `분 시 일 월 요일`입니다.

```
"0 9 * * *"     매일 오전 9시
"0 9 * * 1-5"   평일 오전 9시
"*/30 * * * *"  30분마다
"0 3 * * *"     매일 새벽 3시
```

헷갈리면 https://crontab.guru/ 에서 테스트하세요. 시간대는 `--time-zone="Asia/Seoul"`로 한국 기준을 줍니다.

**(실습) ① 크론 전용 엔드포인트를 FastAPI에 추가.** Scheduler가 호출할 라우트를 만들고, 아무나 못 부르게 막습니다.

```python
# backend/app/routers/cron.py (발췌)
from fastapi import APIRouter, Depends
from app.deps import verify_scheduler_oidc   # OIDC 토큰 검증 의존성

router = APIRouter(prefix="/cron")

@router.post("/daily-digest", dependencies=[Depends(verify_scheduler_oidc)])
async def daily_digest():
    new_leads = await refetch_leads()        # 새 리드 재수집
    ab = await aggregate_ab_results()         # 어제 발송분 A/B 오픈율 집계
    return {"leads": new_leads, "ab_variants": len(ab)}
```

> 💡 **보안이 핵심.** 이 URL이 공개돼 있으니 누가 막 호출하면 안 되겠죠. Cloud Scheduler는 **OIDC 토큰**을 실어 보냅니다. `verify_scheduler_oidc`가 그 토큰을 검증해, **스케줄러가 보낸 요청만** 통과시켜요. 변경분은 7-2 방식으로 다시 배포합니다.

**② 스케줄러 전용 서비스 계정 + 크론잡 생성.**

```bash
PROJECT_ID=$(gcloud config get-value project)
REGION="asia-northeast3"
SERVICE_URL=$(gcloud run services describe reachwave-api \
  --region="${REGION}" --format='value(status.url)')

# Cloud Run을 호출할 권한만 가진 서비스 계정
gcloud iam service-accounts create scheduler-sa --display-name="Scheduler SA"
gcloud run services add-iam-policy-binding reachwave-api --region="${REGION}" \
  --member="serviceAccount:scheduler-sa@${PROJECT_ID}.iam.gserviceaccount.com" \
  --role="roles/run.invoker"

# 매일 오전 9시(KST) 다이제스트 크론잡
gcloud scheduler jobs create http reachwave-daily-digest \
  --location="${REGION}" \
  --schedule="0 9 * * *" --time-zone="Asia/Seoul" \
  --uri="${SERVICE_URL}/cron/daily-digest" --http-method=POST \
  --oidc-service-account-email="scheduler-sa@${PROJECT_ID}.iam.gserviceaccount.com" \
  --oidc-token-audience="${SERVICE_URL}"
```

**③ 즉시 테스트.** 스케줄을 기다릴 필요 없이 바로 한 번 돌립니다.

```bash
gcloud scheduler jobs run reachwave-daily-digest --location="${REGION}"
# 로그로 결과 확인
gcloud logging read 'resource.type=cloud_run_revision AND textPayload:digest' --limit=5
```

이제 **매일 9시에 사람이 안 건드려도** 리드 재수집과 A/B 집계가 돕니다. 같은 패턴으로 "새벽 3시 오래된 임시 데이터 정리", "매주 월요일 주간 리포트" 같은 잡도 얼마든지 추가할 수 있어요.

### 2. GitHub Actions + WIF로 자동 배포 (9분)

> 화면: VS Code(.github/workflows/deploy.yml) + GitHub Actions 탭

다음은 배포 자동화입니다. 목표:

```
main에 머지
   ↓ (자동)
GitHub Actions → 테스트 → Docker 빌드 → push → Cloud Run 배포
```

**(실습) ① 워크플로우 파일.** `.github/workflows/deploy.yml`:

```yaml
name: Deploy ReachWave API
on:
  push:
    branches: [main]
  pull_request:
    branches: [main]

env:
  PROJECT_ID: ${{ secrets.GCP_PROJECT_ID }}
  REGION: asia-northeast3
  SERVICE: reachwave-api
  REPO: reachwave-repo

jobs:
  test: # PR·push 모두 테스트
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-python@v5
        with: { python-version: "3.12" }
      - run: pip install -r backend/requirements.txt
      - run: pytest backend/tests

  deploy: # 테스트 통과 + main push 일 때만 배포
    needs: test
    if: github.event_name == 'push' && github.ref == 'refs/heads/main'
    runs-on: ubuntu-latest
    permissions:
      contents: read
      id-token: write # Workload Identity Federation
    steps:
      - uses: actions/checkout@v4
      - id: auth
        uses: google-github-actions/auth@v2
        with:
          workload_identity_provider: ${{ secrets.WIF_PROVIDER }}
          service_account: ${{ secrets.WIF_SERVICE_ACCOUNT }}
      - uses: google-github-actions/setup-gcloud@v2
      - run: gcloud auth configure-docker ${{ env.REGION }}-docker.pkg.dev
      - name: Build & push
        run: |
          IMAGE="${{ env.REGION }}-docker.pkg.dev/${{ env.PROJECT_ID }}/${{ env.REPO }}/${{ env.SERVICE }}"
          docker build -t "$IMAGE:${{ github.sha }}" ./backend
          docker push "$IMAGE:${{ github.sha }}"
      - name: Deploy
        run: |
          IMAGE="${{ env.REGION }}-docker.pkg.dev/${{ env.PROJECT_ID }}/${{ env.REPO }}/${{ env.SERVICE }}"
          gcloud run deploy ${{ env.SERVICE }} \
            --image="$IMAGE:${{ github.sha }}" --region=${{ env.REGION }} --allow-unauthenticated
```

읽을 포인트만:

- **`test` → `deploy` (needs)** — 테스트 통과해야 배포. **PR은 테스트만**, **main push만 배포**. 머지 전에 문제를 잡는 구조예요.
- **이미지 태그 = `github.sha`** — 어느 커밋에서 나온 이미지인지 추적 가능.
- **버전 핀 주의** — `actions/*`, `google-github-actions/*`의 메이저 버전(@v4/@v2 등)은 배포 시점에 최신인지 한 번 확인하세요. 액션 메이저가 올라가면 갱신합니다.

**② WIF(Workload Identity Federation) — 키 파일 없는 GCP 인증.** 서비스 계정 키 JSON을 GitHub에 저장하는 건 위험합니다. GitHub ↔ GCP를 **OIDC 페더레이션**으로 신뢰시켜 키 없이 인증해요.

```bash
PROJECT_NUMBER=$(gcloud projects describe "${PROJECT_ID}" --format='value(projectNumber)')
GITHUB_REPO="<github-사용자>/<repo>"

gcloud iam workload-identity-pools create github-pool --location=global
gcloud iam workload-identity-pools providers create-oidc github-provider \
  --location=global --workload-identity-pool=github-pool \
  --attribute-mapping="google.subject=assertion.sub,attribute.repository=assertion.repository" \
  --issuer-uri="https://token.actions.githubusercontent.com"

gcloud iam service-accounts create github-sa --display-name="GitHub Actions SA"
for ROLE in roles/run.admin roles/artifactregistry.writer roles/iam.serviceAccountUser; do
  gcloud projects add-iam-policy-binding "${PROJECT_ID}" \
    --member="serviceAccount:github-sa@${PROJECT_ID}.iam.gserviceaccount.com" --role="${ROLE}"
done
gcloud iam service-accounts add-iam-policy-binding \
  github-sa@${PROJECT_ID}.iam.gserviceaccount.com \
  --member="principalSet://iam.googleapis.com/projects/${PROJECT_NUMBER}/locations/global/workloadIdentityPools/github-pool/attribute.repository/${GITHUB_REPO}" \
  --role="roles/iam.workloadIdentityUser"
```

그다음 GitHub 리포 → Settings → Secrets에 `GCP_PROJECT_ID`, `WIF_PROVIDER`(provider 전체 경로), `WIF_SERVICE_ACCOUNT`(서비스 계정 이메일) 3개를 넣습니다.

### 3. 파이프라인 돌려보기 (3분)

> 화면: GitHub Actions 탭 — 워크플로우 실행

**(실습)** 이제 `main`에 머지하면(7-1에서 배운 그 머지!) 파이프라인이 자동으로 뜹니다.

```
Deploy ReachWave API
├── test ✓     (pytest 통과)
└── deploy ✓   (build → push → Cloud Run)
       → https://reachwave-api-xxxx-du.a.run.app
```

녹색 체크가 다 뜨면, 이제부터 **워크트리 머지가 곧 배포**입니다. PR을 올리면 테스트만 돌아 머지 전에 걸러지고, main에 들어가면 자동으로 클라우드가 갱신돼요.

> 💡 같은 일을 **반복**해서 여러 서비스/잡에 깔아야 한다면 — 예를 들어 "프론트에도 같은 파이프라인, staging 환경도 추가, Slack 알림도" — 모듈 8의 **Ralph**(`/tf-ralph`)로 배치 처리할 수 있습니다([[8-2_Ralph_반복자동화]]). 여기선 한 줄짜리 자동화를 손으로 익혀 두는 게 먼저예요.

> **[설명보드: 7-3 자동화의 두 축]** — Excalidraw (후속 제작)
> 📊 보드 파일: [assets/7-3_자동화의_두축.excalidraw](assets/7-3_자동화의_두축.excalidraw) — Excalidraw 에디터/excalidraw.com 에서 열기
>
> - 왼쪽 축(크론): 시계 아이콘 → Cloud Scheduler → (OIDC 자물쇠) → Cloud Run `/cron/daily-digest` → "리드 재수집 + A/B 집계". 캡션 "정해진 시각에 알아서".
> - 오른쪽 축(CI/CD): 개발자 → `main` 머지 → GitHub Actions(test→build→deploy, WIF 자물쇠) → Cloud Run 새 리비전. 캡션 "머지가 곧 배포".
> - 하단 띠: "한 번 만들면 알아서 돈다 — 사람은 결과만 본다."

---

## 정리 (2분)

1. **자동화 두 축.** 주기 작업(Cloud Scheduler) + 배포(GitHub Actions CI/CD).
2. **크론잡.** FastAPI 크론 엔드포인트 + **OIDC**로 스케줄러만 통과 → 매일 리드 재수집·A/B 집계. `jobs run`으로 즉시 테스트.
3. **CI/CD.** `test`→`deploy(needs)`, PR은 테스트만·main push만 배포, 이미지 태그는 커밋 SHA.
4. **WIF.** 서비스 계정 키 파일 없이 OIDC 페더레이션으로 안전하게 GCP 인증.
5. **머지가 곧 배포.** 한 번 깔면 사람은 결과만 확인. 반복 확장은 Ralph로(8-2).

서비스가 스스로 돌기 시작했습니다. 그런데 사용자가 들어올 **앞문**이 아직 없죠. 다음 섹션에서 **랜딩페이지를 만들고 런칭 체크리스트**로 진짜 출시를 준비합니다.

---

다음: [[7-4_랜딩페이지_런칭체크리스트]]
