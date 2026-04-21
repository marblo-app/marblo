---
tags: [강의, v3, 모듈8]
type: lecture
aliases: [Ralph 반복 자동화]
---

# `/tf-ralph` — 반복 작업 자동화

> 모듈 8 · 섹션 8-2 · 약 30분
> 관련: [[8-1_일상_운영패턴]] | [[8-3_확장방향]]

---

## 도입 (5분)

여러분, `/tf-start`로 프로젝트를 빌드하는 건 익숙해지셨죠? 오케스트레이터가 요구사항을 분석하고, 태스크를 만들고, 에이전트에게 배정하고. 이 과정이 "창의적인 작업"에는 정말 좋습니다.

화면: 슬라이드 — "/tf-start vs /tf-ralph"

그런데 개발에는 **반복적이고 패턴이 비슷한 작업**이 엄청나게 많습니다:

- API 엔드포인트 10개에 대한 pytest 작성 — 패턴이 거의 동일
- React 컴포넌트 8개의 접근성(a11y) 개선 — 규칙이 정해져 있음
- DB 마이그레이션 파일 5개 생성 — 템플릿이 같음
- 린트 에러 20개 수정 — 기계적인 작업

이런 작업을 `/tf-start`로 하나하나 시키면 비효율적이에요. 10개 엔드포인트 각각에 대해 태스크를 만들고, DAG를 분석하고... 오버헤드가 큽니다.

**Ralph**가 바로 이 문제를 해결합니다.

### Ralph란?

```
/tf-start  →  "PM이 요구사항을 주면 에이전트가 생각하면서 빌드"
/tf-ralph  →  "패턴을 정해주면 에이전트가 배치로 대량 처리"
```

Ralph는 **반복 작업 배치 자동화 엔진**입니다. 이름의 유래는 공장 라인의 작업자처럼 같은 패턴을 반복 처리한다는 의미에서 왔어요.

Ralph의 동작 방식:

```
1. 코드베이스 스캔 → 작업 대상 자동 식별
2. 대상별 티켓 자동 생성 (10개, 20개도 가능)
3. 에이전트에게 배치로 배정
4. 동일 패턴으로 순차/병렬 실행
5. 마블로 칸반 보드에서 진행 상황 추적
```

---

## 본문 1: Demo 1 — pytest 배치 생성 (10분)

화면: 터미널 — 프로젝트 코드

**(실습)** 첫 번째 데모입니다. AI YouTube Insight 프로젝트의 API 엔드포인트 10개에 대한 pytest를 배치로 작성합니다.

### 1-a: 현재 테스트 상황 확인

```bash
# 현재 테스트 파일 확인
ls tests/
# test_health.py   (겨우 1개 파일만 있음)

# API 엔드포인트 확인
grep -r "@app." src/api/routes/ --include="*.py" | grep "def "
# GET  /api/videos          → list_videos
# POST /api/videos          → create_video
# GET  /api/videos/{id}     → get_video
# PUT  /api/videos/{id}     → update_video
# DELETE /api/videos/{id}   → delete_video
# POST /api/analyze         → analyze_video
# GET  /api/reports         → list_reports
# GET  /api/reports/{id}    → get_report
# GET  /api/trends          → get_trends
# GET  /api/health          → health_check
```

10개 엔드포인트 중 테스트가 있는 건 health_check 하나뿐입니다. 나머지 9개에 대한 테스트를 작성해야 해요.

### 1-b: Ralph 실행

```bash
/tf-ralph 우리 API 엔드포인트에 대한 pytest를 작성해줘.
각 엔드포인트마다 최소 3개의 테스트 케이스:
1. 정상 요청 (200 OK)
2. 잘못된 입력 (400/422)
3. 존재하지 않는 리소스 (404)
pytest + httpx AsyncClient 사용.
```

화면: 오케스트레이터 터미널에서 Ralph가 실행되는 모습

### 1-c: Ralph의 동작 과정 관찰

Ralph가 하는 일을 단계별로 봅시다:

**Step 1: 코드베이스 스캔**

```
[Ralph] Scanning codebase for API endpoints...
[Ralph] Found 10 endpoints in src/api/routes/
[Ralph] Excluding already-tested: health_check
[Ralph] Target: 9 endpoints
```

화면: Ralph가 코드를 스캔하는 로그

**Step 2: 티켓 자동 생성**

```
[Ralph] Creating batch tickets...
[Ralph] TASK-030: pytest for GET /api/videos (list_videos)
[Ralph] TASK-031: pytest for POST /api/videos (create_video)
[Ralph] TASK-032: pytest for GET /api/videos/{id} (get_video)
[Ralph] TASK-033: pytest for PUT /api/videos/{id} (update_video)
[Ralph] TASK-034: pytest for DELETE /api/videos/{id} (delete_video)
[Ralph] TASK-035: pytest for POST /api/analyze (analyze_video)
[Ralph] TASK-036: pytest for GET /api/reports (list_reports)
[Ralph] TASK-037: pytest for GET /api/reports/{id} (get_report)
[Ralph] TASK-038: pytest for GET /api/trends (get_trends)
[Ralph] Created 9 tickets.
```

화면: 칸반 보드에 9개 태스크가 한꺼번에 생성되는 모습

**Step 3: 에이전트에 배치 배정**

```
[Ralph] Assigning to test agent...
[Ralph] Agent: Claude-Test → Batch of 9 tasks
[Ralph] Pattern template applied: pytest + httpx + 3 cases/endpoint
[Ralph] Execution mode: sequential (same test file structure)
```

**Step 4: 배치 실행**

```
[Ralph] Starting batch execution...
[Ralph] [1/9] TASK-030: tests/test_list_videos.py → DONE (12s)
[Ralph] [2/9] TASK-031: tests/test_create_video.py → DONE (15s)
[Ralph] [3/9] TASK-032: tests/test_get_video.py → DONE (11s)
...
[Ralph] [9/9] TASK-038: tests/test_get_trends.py → DONE (13s)
[Ralph] Batch complete: 9/9 tasks done in 1m 52s
```

화면: 칸반 보드에서 태스크가 순서대로 DONE으로 이동

### 1-d: 결과 확인

```bash
# 생성된 테스트 파일 확인
ls tests/
# test_health.py
# test_list_videos.py
# test_create_video.py
# test_get_video.py
# test_update_video.py
# test_delete_video.py
# test_analyze_video.py
# test_list_reports.py
# test_get_report.py
# test_get_trends.py

# 테스트 실행
pytest tests/ -v
# =================== 28 passed in 4.52s ===================
```

9개 파일, 각 3개 케이스 = 27개 + 기존 1개 = 28개 테스트. 전부 통과합니다.

생성된 테스트 코드의 예시를 봅시다:

```python
# tests/test_create_video.py
import pytest
from httpx import AsyncClient
from src.main import app

@pytest.mark.asyncio
async def test_create_video_success():
    """정상적인 비디오 생성 요청"""
    async with AsyncClient(app=app, base_url="http://test") as client:
        response = await client.post("/api/videos", json={
            "url": "https://youtube.com/watch?v=abc123",
            "title": "Test Video"
        })
    assert response.status_code == 201
    assert "id" in response.json()

@pytest.mark.asyncio
async def test_create_video_invalid_url():
    """잘못된 URL로 요청"""
    async with AsyncClient(app=app, base_url="http://test") as client:
        response = await client.post("/api/videos", json={
            "url": "not-a-valid-url",
            "title": "Test"
        })
    assert response.status_code == 422

@pytest.mark.asyncio
async def test_create_video_missing_fields():
    """필수 필드 누락"""
    async with AsyncClient(app=app, base_url="http://test") as client:
        response = await client.post("/api/videos", json={})
    assert response.status_code == 422
```

패턴이 일관적이죠? 이게 Ralph의 강점입니다. 동일한 패턴을 반복 적용하니까 코드 스타일도 통일되고, 빠져나가는 것도 없어요.

---

## 본문 2: Demo 2 — 컴포넌트 접근성(a11y) 개선 (10분)

화면: 브라우저 — Lighthouse 접근성 점수

**(실습)** 두 번째 데모입니다. React 컴포넌트 8개의 접근성을 배치로 개선합니다.

### 2-a: 현재 접근성 상황

```bash
# Lighthouse 접근성 점수 확인
npx lighthouse http://localhost:3000 --only-categories=accessibility --output=json | jq '.categories.accessibility.score'
# 0.68 (68점 — 나쁨)
```

화면: Lighthouse 리포트에서 접근성 문제 목록

주요 문제들:
- 이미지에 `alt` 속성 누락
- 버튼에 접근 가능한 이름 없음
- 색상 대비 부족
- 폼 요소에 `label` 연결 안 됨
- 키보드 네비게이션 불가

### 2-b: Ralph로 배치 수정

```bash
/tf-ralph 프론트엔드 컴포넌트의 접근성(a11y)을 개선해줘.
WCAG 2.1 AA 기준으로:
1. 모든 img에 의미 있는 alt 텍스트 추가
2. 버튼에 aria-label 추가
3. 색상 대비 4.5:1 이상 확보
4. 폼 요소에 label 연결
5. 키보드 탐색 가능하게 tabIndex, onKeyDown 추가
```

### 2-c: Ralph 동작 관찰

```
[Ralph] Scanning React components for a11y issues...
[Ralph] Scanned: src/components/**/*.tsx
[Ralph] Found 8 components with a11y issues:

[Ralph] TASK-040: a11y fix — HeroSection.tsx (2 issues)
[Ralph] TASK-041: a11y fix — FeaturesSection.tsx (3 issues)
[Ralph] TASK-042: a11y fix — PricingSection.tsx (4 issues)
[Ralph] TASK-043: a11y fix — CTASection.tsx (1 issue)
[Ralph] TASK-044: a11y fix — VideoCard.tsx (3 issues)
[Ralph] TASK-045: a11y fix — SearchBar.tsx (2 issues)
[Ralph] TASK-046: a11y fix — ReportView.tsx (2 issues)
[Ralph] TASK-047: a11y fix — Navigation.tsx (3 issues)

[Ralph] Created 8 tickets.
[Ralph] Assigning to frontend agent...
[Ralph] Agent: Gemini-Frontend → Batch of 8 tasks
```

화면: 칸반 보드에 8개 접근성 태스크 생성

```
[Ralph] Starting batch execution...
[Ralph] [1/8] TASK-040: HeroSection.tsx → DONE (8s)
[Ralph] [2/8] TASK-041: FeaturesSection.tsx → DONE (10s)
...
[Ralph] [8/8] TASK-047: Navigation.tsx → DONE (9s)
[Ralph] Batch complete: 8/8 tasks done in 1m 14s
```

### 2-d: 수정 결과 확인

```bash
# 수정된 코드 예시 확인
git diff src/components/landing/HeroSection.tsx
```

```diff
  <img
-   src="/hero-illustration.png"
+   src="/hero-illustration.png"
+   alt="AI가 유튜브 영상을 분석하는 모습을 나타내는 일러스트레이션"
  />

  <Button
+   aria-label="무료로 YouTube Insight 시작하기"
    size="lg"
    className="bg-purple-600"
  >
    무료로 시작하기
  </Button>
```

```bash
# Lighthouse 재확인
npx lighthouse http://localhost:3000 --only-categories=accessibility --output=json | jq '.categories.accessibility.score'
# 0.95 (95점 — 우수!)
```

화면: Lighthouse 점수가 68점 → 95점으로 올라간 모습

68점에서 95점으로. 27점 향상을 1분 14초 만에 달성했습니다.

---

## 본문 3: Ralph 활용 가이드 (5분)

화면: 슬라이드 — "Ralph를 언제 쓸까?"

### Ralph를 쓸 때 vs 안 쓸 때

| 상황 | 도구 | 이유 |
|------|------|------|
| 새 기능 개발 | `/tf-start` | 창의적 사고 필요 |
| API 테스트 10개 작성 | `/tf-ralph` | 동일 패턴 반복 |
| 아키텍처 설계 | `/tf-analyze` | 심층 분석 필요 |
| 린트 에러 20개 수정 | `/tf-ralph` | 기계적 작업 |
| DB 스키마 변경 | `/tf-start` | 의존성 고려 필요 |
| 컴포넌트 a11y 개선 | `/tf-ralph` | 규칙 기반 반복 |
| 버그 디버깅 | `/tf-fix` | 맥락 파악 필요 |
| API 문서 자동 생성 | `/tf-ralph` | 템플릿 기반 반복 |

### 핵심 판단 기준

```
패턴이 같고 대상이 여러 개? → Ralph
각 작업이 독립적이고 맥락 공유 불필요? → Ralph
창의적 판단이나 아키텍처 결정 필요? → /tf-start 또는 /tf-analyze
```

### Ralph 추적

Ralph로 생성된 태스크도 마블로 칸반 보드에서 추적됩니다:

```
칸반 보드:
├── [Ralph Batch] pytest 생성 (9/9 완료)
│   ├── TASK-030 ✓
│   ├── TASK-031 ✓
│   └── ... (접혀 있음)
├── [Ralph Batch] a11y 개선 (6/8 진행 중)
│   ├── TASK-040 ✓
│   ├── TASK-041 ✓
│   ├── TASK-042 [IN_PROGRESS]
│   └── ...
```

화면: 칸반 보드에서 Ralph 배치 그룹이 접혀 있는 모습

배치 전체의 진행률을 한눈에 볼 수 있고, 개별 태스크를 펼쳐서 상세히 볼 수도 있습니다.

---

## 정리 (3분)

화면: 요약 슬라이드

오늘 배운 핵심 세 가지입니다:

1. **`/tf-ralph`는 반복 작업 전용** — 패턴이 같고 대상이 여러 개인 작업에 최적
2. **자동 스캔 → 자동 티켓 → 배치 실행** — 사람이 하나하나 태스크를 만들 필요 없음
3. **마블로 칸반 보드에서 추적** — Ralph 배치도 일반 태스크와 동일하게 관리

Demo로 봤듯이:
- **pytest 9개** → 1분 52초, 28개 테스트 케이스 전부 통과
- **a11y 개선 8개** → 1분 14초, Lighthouse 68점 → 95점

사람이 했으면 각각 1~2시간은 걸렸을 작업입니다. Ralph의 배치 처리 능력이 여기서 빛나는 거죠.

다음 섹션에서는 마블로의 확장 방향을 다룹니다. 새로운 에이전트 역할, 커스터마이징, 엔터프라이즈 기능까지요.

---
다음: [[8-3_확장방향]]
