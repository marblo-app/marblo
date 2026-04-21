---
tags: [강의, v3, 모듈6]
type: lecture
aliases: [CICD 파이프라인]
---

# CI/CD 파이프라인

> 모듈 6 · 섹션 6-4 · 약 20분
> 관련: [[6-3_크론잡_자동화]] | [[실습_GCP_배포]]

---

## 도입 (3분)

지금까지 배포는 수동으로 했죠? `docker build`, `docker push`, `gcloud run deploy` — 이 세 단계를 매번 터미널에서 치는 건 번거롭고 실수하기 쉽습니다.

화면: 슬라이드 — "Push to Deploy"

CI/CD 파이프라인을 만들면, **GitHub에 코드를 푸시하는 것만으로** 자동 배포가 됩니다:

```
git push origin main
    ↓ (자동)
GitHub Actions → 빌드 → 테스트 → Docker 이미지 → Cloud Run 배포
```

사람이 해야 할 일은 `git push` 한 번. 나머지는 전부 자동입니다.

이번 섹션에서는 GitHub Actions + Cloud Build를 연동해서 이 파이프라인을 구축합니다.

---

## 본문 1: GitHub Actions 워크플로우 작성 (7분)

화면: VS Code — `.github/workflows/deploy.yml`

**(실습)** 프로젝트에 GitHub Actions 워크플로우 파일을 만듭니다:

```bash
mkdir -p .github/workflows
```

`.github/workflows/deploy.yml`:

```yaml
name: Build and Deploy to Cloud Run

on:
  push:
    branches: [main]
  pull_request:
    branches: [main]

env:
  PROJECT_ID: ${{ secrets.GCP_PROJECT_ID }}
  REGION: asia-northeast3
  SERVICE_NAME: marblo-todo-app
  REPO_NAME: marblo-repo

jobs:
  # ── 테스트 ──
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - uses: actions/setup-node@v4
        with:
          node-version: '20'
          cache: 'npm'

      - run: npm ci
      - run: npm run lint
      - run: npm test

  # ── 빌드 + 배포 ──
  deploy:
    needs: test  # 테스트 통과해야 배포
    if: github.event_name == 'push' && github.ref == 'refs/heads/main'
    runs-on: ubuntu-latest

    permissions:
      contents: read
      id-token: write  # Workload Identity Federation용

    steps:
      - uses: actions/checkout@v4

      # GCP 인증 (Workload Identity Federation)
      - id: auth
        uses: google-github-actions/auth@v2
        with:
          workload_identity_provider: ${{ secrets.WIF_PROVIDER }}
          service_account: ${{ secrets.WIF_SERVICE_ACCOUNT }}

      # gcloud CLI 설정
      - uses: google-github-actions/setup-gcloud@v2

      # Docker 인증
      - run: gcloud auth configure-docker ${{ env.REGION }}-docker.pkg.dev

      # Docker 이미지 빌드 + 태그
      - name: Build Docker image
        run: |
          IMAGE="${{ env.REGION }}-docker.pkg.dev/${{ env.PROJECT_ID }}/${{ env.REPO_NAME }}/${{ env.SERVICE_NAME }}"
          docker build -t ${IMAGE}:${{ github.sha }} -t ${IMAGE}:latest .
          docker push ${IMAGE}:${{ github.sha }}
          docker push ${IMAGE}:latest

      # Cloud Run 배포
      - name: Deploy to Cloud Run
        run: |
          IMAGE="${{ env.REGION }}-docker.pkg.dev/${{ env.PROJECT_ID }}/${{ env.REPO_NAME }}/${{ env.SERVICE_NAME }}"
          gcloud run deploy ${{ env.SERVICE_NAME }} \
            --image=${IMAGE}:${{ github.sha }} \
            --region=${{ env.REGION }} \
            --platform=managed \
            --allow-unauthenticated \
            --port=8080

      # 배포 URL 출력
      - name: Show deployed URL
        run: |
          URL=$(gcloud run services describe ${{ env.SERVICE_NAME }} \
            --region=${{ env.REGION }} --format='value(status.url)')
          echo "Deployed to: ${URL}"
```

중요한 부분을 하나씩 설명할게요.

### Job 구조

```yaml
jobs:
  test:     # 먼저 테스트 실행
    ...
  deploy:
    needs: test  # 테스트 통과 후에만 배포
    if: github.event_name == 'push' && github.ref == 'refs/heads/main'
    ...
```

- `test` job: lint + 단위 테스트 실행
- `deploy` job: 테스트 통과 후에만, main 브랜치 push 시에만 배포
- PR에서는 테스트만 돌고 배포는 안 됨

### GCP 인증: Workload Identity Federation

```yaml
- uses: google-github-actions/auth@v2
  with:
    workload_identity_provider: ${{ secrets.WIF_PROVIDER }}
    service_account: ${{ secrets.WIF_SERVICE_ACCOUNT }}
```

이게 가장 안전한 GCP 인증 방법입니다. 서비스 계정 키를 파일로 저장하지 않고, GitHub와 GCP 사이의 OIDC 페더레이션을 사용합니다.

### 이미지 태깅 전략

```yaml
docker build -t ${IMAGE}:${{ github.sha }} -t ${IMAGE}:latest .
```

- `${{ github.sha }}`: Git 커밋 해시를 태그로. 어떤 커밋에서 빌드된 이미지인지 추적 가능.
- `latest`: 항상 최신 이미지를 가리킴.

---

## 본문 2: GCP Workload Identity Federation 설정 (5분)

화면: 터미널

GitHub Actions에서 GCP에 접근하려면 Workload Identity Federation을 설정해야 합니다.

**(실습)**

```bash
# 변수 설정
PROJECT_ID=$(gcloud config get-value project)
PROJECT_NUMBER=$(gcloud projects describe ${PROJECT_ID} --format='value(projectNumber)')
GITHUB_REPO="your-username/your-repo"  # GitHub 리포지토리

# Workload Identity Pool 생성
gcloud iam workload-identity-pools create "github-pool" \
  --location="global" \
  --display-name="GitHub Actions Pool"

# Workload Identity Provider 생성
gcloud iam workload-identity-pools providers create-oidc "github-provider" \
  --location="global" \
  --workload-identity-pool="github-pool" \
  --display-name="GitHub Provider" \
  --attribute-mapping="google.subject=assertion.sub,attribute.repository=assertion.repository" \
  --issuer-uri="https://token.actions.githubusercontent.com"

# 서비스 계정 생성
gcloud iam service-accounts create github-actions-sa \
  --display-name="GitHub Actions Service Account"

# 서비스 계정에 필요한 권한 부여
gcloud projects add-iam-policy-binding ${PROJECT_ID} \
  --member="serviceAccount:github-actions-sa@${PROJECT_ID}.iam.gserviceaccount.com" \
  --role="roles/run.admin"

gcloud projects add-iam-policy-binding ${PROJECT_ID} \
  --member="serviceAccount:github-actions-sa@${PROJECT_ID}.iam.gserviceaccount.com" \
  --role="roles/artifactregistry.writer"

gcloud projects add-iam-policy-binding ${PROJECT_ID} \
  --member="serviceAccount:github-actions-sa@${PROJECT_ID}.iam.gserviceaccount.com" \
  --role="roles/iam.serviceAccountUser"

# Workload Identity 바인딩
gcloud iam service-accounts add-iam-policy-binding \
  github-actions-sa@${PROJECT_ID}.iam.gserviceaccount.com \
  --member="principalSet://iam.googleapis.com/projects/${PROJECT_NUMBER}/locations/global/workloadIdentityPools/github-pool/attribute.repository/${GITHUB_REPO}" \
  --role="roles/iam.workloadIdentityUser"
```

이제 GitHub Secrets를 설정합니다.

화면: GitHub 리포지토리 → Settings → Secrets and variables → Actions

**(실습)** GitHub 리포에서 다음 Secrets를 추가합니다:

```
GCP_PROJECT_ID       = marblo-todo-app-12345
WIF_PROVIDER         = projects/<PROJECT_NUMBER>/locations/global/workloadIdentityPools/github-pool/providers/github-provider
WIF_SERVICE_ACCOUNT  = github-actions-sa@marblo-todo-app-12345.iam.gserviceaccount.com
```

Provider 값은 아래 명령으로 확인:

```bash
gcloud iam workload-identity-pools providers describe github-provider \
  --workload-identity-pool=github-pool \
  --location=global \
  --format='value(name)'
```

---

## 본문 3: 파이프라인 테스트 (3분)

화면: 터미널 + GitHub Actions 탭

설정이 끝났으니 테스트해봅시다.

**(실습)**

```bash
# 변경사항 커밋 + 푸시
git add .
git commit -m "Add CI/CD pipeline with GitHub Actions"
git push origin main
```

화면: GitHub → Actions 탭에서 워크플로우가 실행되는 모습

```
Build and Deploy to Cloud Run
├── test ✓ (2분 30초)
│   ├── Checkout ✓
│   ├── Setup Node ✓
│   ├── npm ci ✓
│   ├── npm run lint ✓
│   └── npm test ✓ (15 passed)
└── deploy ✓ (3분 45초)
    ├── Checkout ✓
    ├── Auth to GCP ✓
    ├── Setup gcloud ✓
    ├── Configure Docker ✓
    ├── Build Docker image ✓
    ├── Deploy to Cloud Run ✓
    └── Show deployed URL ✓
        → https://marblo-todo-app-xxxx-dt.a.run.app
```

녹색 체크가 모두 뜨면 성공입니다!

이제부터 `main` 브랜치에 push하면 자동으로 테스트 → 빌드 → 배포가 됩니다. PR을 올리면 테스트만 돌아서 머지 전에 문제를 잡을 수 있어요.

---

## 본문 4: 마블로 에이전트와 CI/CD 연계 (3분)

화면: 마블로 오케스트레이터

여기서 마블로의 힘이 빛납니다. CI/CD 관련 작업도 에이전트에게 시킬 수 있어요.

오케스트레이터에 이렇게 입력해보세요:

```
CI/CD 파이프라인을 개선해줘:
1. GitHub Actions에 Docker 레이어 캐싱 추가
2. Slack 알림 추가 (배포 성공/실패 시)
3. staging 환경 배포 추가 (develop 브랜치)
```

에이전트가 `.github/workflows/deploy.yml`을 분석하고 수정해줍니다.

또는 모듈 8에서 배울 Ralph를 사용하면:

```
/tf-ralph "CI/CD 파이프라인 설정, Slack 알림 연동, staging 환경 추가"
```

이렇게 한 줄로 여러 CI/CD 태스크를 배치 처리할 수도 있습니다.

---

## 정리 (2분)

화면: 파이프라인 전체 흐름 다이어그램

CI/CD 파이프라인을 정리합니다:

```
개발자: git push origin main
    ↓
GitHub Actions:
    1. test job → lint + unit test
    2. deploy job → Docker build → push → Cloud Run deploy
    ↓
Cloud Run: 새 버전 자동 배포
    ↓
사용자: 최신 버전 자동 접근
```

핵심 포인트:

1. **GitHub Actions**: `.github/workflows/deploy.yml` 하나로 전체 파이프라인 정의
2. **Workload Identity Federation**: 서비스 계정 키 파일 없이 안전하게 GCP 인증
3. **자동 트리거**: main push → 자동 배포, PR → 자동 테스트
4. **이미지 태깅**: Git 커밋 해시로 추적 가능
5. **마블로 연계**: 에이전트가 CI/CD 파이프라인 자체를 만들고 개선

이것으로 모듈 6의 마지막 이론 섹션입니다. 다음은 전체 과정을 처음부터 끝까지 해보는 종합 실습입니다.

---
다음: [[실습_GCP_배포]]
