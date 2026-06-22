---
tags: [강의, v3, 모듈8]
type: lecture
aliases: [Ralph 반복 자동화]
---

# `/tf-ralph` — 반복 작업 일괄 자동화

> 모듈 8 · 섹션 8-2 · 약 25분
> 관련: [[8-1_일상운영_멀티프로젝트]] | [[8-3_커스터마이즈_스킬_하네스]]

---

## 이 강의에서 다루는 것

- **학습목표:** `/tf-start`(창의적 빌드)와 `/tf-ralph`(반복 배치)의 차이를 이해하고, 패턴이 같은 대량 작업을 Ralph로 한 번에 처리하는 법을 익힌다.
- **시연할 마블로 화면·기능:** 보드 탭(Ralph 배치 그룹) + 레인 탭(배치 실행 관찰).
- **진행할 프로젝트 단계:** **P3(ReachWave) 유지보수** — 테스트 보강, 컴포넌트 접근성 개선 같은 반복 작업.
- **핵심 메시지:** "지루한 반복은 **Ralph**에게."

---

## 도입 (4분)

`/tf-start`로 프로젝트를 빌드하는 건 이제 익숙하시죠? 오케가 요구를 분석하고, 태스크를 만들고, 에이전트에 배정하고. 이 과정은 **창의적인 작업**에 정말 좋습니다.

> 화면: 슬라이드 — "`/tf-start` vs `/tf-ralph`"

그런데 개발에는 **반복적이고 패턴이 비슷한 작업**이 엄청나게 많습니다.

- API 엔드포인트 10개에 대한 pytest 작성 — 패턴이 거의 동일
- React 컴포넌트 8개의 접근성(a11y) 개선 — 규칙이 정해져 있음
- DB 마이그레이션 파일 5개 생성 — 템플릿이 같음
- 린트 에러 20개 수정 — 기계적인 작업

이런 걸 `/tf-start`로 하나하나 시키면 비효율적입니다. 10개 엔드포인트 각각에 대해 태스크를 만들고, 의존성을 분석하고… 오버헤드가 큽니다. **Ralph**가 바로 이 문제를 해결합니다.

### Ralph란?

```
/tf-start  →  "요구사항을 주면 에이전트가 생각하면서 빌드"
/tf-ralph  →  "패턴을 정해주면 에이전트가 배치로 대량 처리"
```

Ralph는 **반복 작업 배치 자동화 엔진**입니다. 공장 라인의 작업자처럼 같은 패턴을 반복 처리한다는 의미에서 온 이름이에요. 동작 방식은 이렇습니다.

```
1. 코드베이스 스캔 → 작업 대상 자동 식별
2. 대상별 티켓 자동 생성 (10개, 20개도 가능)
3. 에이전트에게 배치로 배정
4. 동일 패턴으로 순차/병렬 실행
5. 보드에서 배치 그룹으로 진행 추적
```

---

## 본문

### 1. 데모 1 — pytest 일괄 생성 (9분)

> 화면: 코드 탭 — ReachWave 백엔드 라우트

**(실습)** 첫 데모입니다. P3 ReachWave의 API 엔드포인트에 대한 pytest를 배치로 작성합니다.

**1-a: 현재 테스트 상황 확인**

```bash
# 현재 테스트 파일
ls tests/
# test_health.py   (겨우 1개)

# API 엔드포인트 (예시)
grep -rn "@router\." src/api/routes/ | grep "def "
# POST /api/leads/import     → import_leads      (CSV 리드 임포트)
# GET  /api/leads            → list_leads
# POST /api/campaigns        → create_campaign
# GET  /api/campaigns/{id}   → get_campaign
# POST /api/emails/generate  → generate_email    (톤별 콜드메일 생성)
# POST /api/emails/send      → send_email        (발송 큐)
# GET  /api/emails/{id}      → get_email
# GET  /api/stats/ab         → get_ab_stats      (A/B 집계)
# GET  /api/health           → health_check
```

엔드포인트는 여러 개인데 테스트가 있는 건 `health_check` 하나뿐입니다. 나머지에 테스트를 채워야 해요.

**1-b: Ralph 실행**

```
/tf-ralph 우리 API 엔드포인트에 대한 pytest를 작성해줘.
각 엔드포인트마다 최소 3개의 케이스:
1. 정상 요청 (2xx)
2. 잘못된 입력 (400/422)
3. 존재하지 않는 리소스 (404)
pytest + httpx AsyncClient 사용.
```

> 화면: 하단 오케 PTY에서 Ralph가 스캔을 시작하는 모습

**1-c: Ralph의 동작 과정 관찰**

Ralph가 하는 일을 단계별로 봅니다.

```
[Ralph] Scanning codebase for API endpoints...
[Ralph] Found 9 endpoints in src/api/routes/
[Ralph] Excluding already-tested: health_check
[Ralph] Target: 8 endpoints
```

그다음 대상마다 티켓을 자동으로 만들고, 보드에 **하나의 배치 그룹**으로 묶어 올립니다.

```
[Ralph] Creating batch tickets...
[Ralph] TASK-030: pytest for POST /api/leads/import
[Ralph] TASK-031: pytest for GET  /api/leads
[Ralph] TASK-032: pytest for POST /api/campaigns
[Ralph] ...
[Ralph] TASK-037: pytest for GET  /api/stats/ab
[Ralph] Created 8 tickets → assigned to test agent (Codex)
```

> 화면: 보드 탭 — 8개 태스크가 "[Ralph Batch] pytest 생성"으로 묶여 한꺼번에 생기는 모습

그리고 동일 패턴 템플릿으로 배치를 실행합니다. 레인 탭에서 카드가 순서대로 DONE으로 넘어가는 걸 볼 수 있어요.

```
[Ralph] Starting batch execution...
[Ralph] [1/8] TASK-030 → DONE
[Ralph] [2/8] TASK-031 → DONE
[Ralph] ...
[Ralph] [8/8] TASK-037 → DONE
[Ralph] Batch complete: 8/8 tasks done.   (소요 시간은 환경·모델에 따라 다름)
```

> 💡 위 소요 시간·개수는 **예시**입니다. 실제 시간은 엔드포인트 복잡도, 모델, 동시 실행 수에 따라 달라집니다. 중요한 건 "사람이 하나씩 만들지 않아도 배치로 처리된다"는 흐름이에요.

**1-d: 결과 확인**

```bash
pytest tests/ -v
# 통과한 테스트 케이스 수가 한 번에 늘어남
```

생성된 코드는 패턴이 일관적입니다.

```python
# tests/test_create_campaign.py
import pytest
from httpx import AsyncClient
from src.main import app

@pytest.mark.asyncio
async def test_create_campaign_success():
    """정상적인 캠페인 생성"""
    async with AsyncClient(app=app, base_url="http://test") as client:
        resp = await client.post("/api/campaigns", json={
            "name": "Q3 콜드메일", "tone": "친근함",
        })
    assert resp.status_code == 201
    assert "id" in resp.json()

@pytest.mark.asyncio
async def test_create_campaign_invalid_tone():
    """허용되지 않은 톤 값"""
    async with AsyncClient(app=app, base_url="http://test") as client:
        resp = await client.post("/api/campaigns", json={
            "name": "X", "tone": "존재하지않는톤",
        })
    assert resp.status_code == 422
```

패턴이 통일되죠? 이게 Ralph의 강점입니다. 동일 패턴을 반복 적용하니 코드 스타일이 일관되고, 빠뜨리는 엔드포인트가 없습니다.

### 2. 데모 2 — 컴포넌트 접근성(a11y) 일괄 개선 (8분)

> 화면: 브라우저 — Lighthouse 접근성 점수

**(실습)** 두 번째 데모입니다. ReachWave 프론트엔드 컴포넌트의 접근성을 배치로 개선합니다.

**2-a: 현재 접근성 상황**

```bash
npx lighthouse http://localhost:3000 --only-categories=accessibility \
  --output=json | jq '.categories.accessibility.score'
# 예시: 0.68
```

주요 문제: 이미지 `alt` 누락, 버튼에 접근 가능한 이름 없음, 색상 대비 부족, 폼 요소에 `label` 미연결, 키보드 탐색 불가.

**2-b: Ralph로 배치 수정**

```
/tf-ralph 프론트엔드 컴포넌트의 접근성(a11y)을 개선해줘.
WCAG 2.1 AA 기준으로:
1. 모든 img에 의미 있는 alt 텍스트
2. 버튼에 aria-label
3. 색상 대비 4.5:1 이상
4. 폼 요소에 label 연결
5. 키보드 탐색 가능하게 tabIndex/onKeyDown
```

**2-c: Ralph 동작 관찰**

```
[Ralph] Scanning React components for a11y issues...
[Ralph] Found 8 components with a11y issues:
[Ralph] TASK-040: LeadTable.tsx (3 issues)
[Ralph] TASK-041: CampaignCard.tsx (2 issues)
[Ralph] TASK-042: EmailComposer.tsx (4 issues)
[Ralph] ...
[Ralph] TASK-047: Navigation.tsx (3 issues)
[Ralph] Created 8 tickets → assigned to frontend agent (Codex)
```

> 화면: 보드 탭 — "[Ralph Batch] a11y 개선" 그룹에 8개 카드가 생기고, 레인에서 차례로 DONE으로

**2-d: 수정 결과 확인**

```bash
git diff src/components/EmailComposer.tsx
```

```diff
  <img
    src="/preview.png"
+   alt="생성된 콜드메일 미리보기"
  />

  <Button
+   aria-label="이 톤으로 콜드메일 생성"
    size="lg"
  >
    생성하기
  </Button>
```

```bash
# Lighthouse 재확인 (예시)
# 0.68 → 0.95 수준으로 향상
```

> 💡 점수 변화(0.68 → 0.95)도 **예시**입니다. 실제 향상폭은 컴포넌트 상태에 따라 다릅니다. 핵심은 "규칙이 정해진 반복 수정은 배치로 일괄 처리한다"는 것.

### 3. Ralph를 언제 쓸까 (3분)

> 화면: 슬라이드 — "Ralph를 쓸 때 vs 안 쓸 때"

| 상황                | 도구          | 이유             |
| ------------------- | ------------- | ---------------- |
| 새 기능 개발        | `/tf-start`   | 창의적 사고 필요 |
| API 테스트 N개 작성 | `/tf-ralph`   | 동일 패턴 반복   |
| 아키텍처 설계       | `/tf-analyze` | 심층 분석 필요   |
| 린트 에러 N개 수정  | `/tf-ralph`   | 기계적 작업      |
| DB 스키마 변경      | `/tf-start`   | 의존성 고려 필요 |
| 컴포넌트 a11y 개선  | `/tf-ralph`   | 규칙 기반 반복   |
| 버그 디버깅         | `/tf-fix`     | 맥락 파악 필요   |
| API 문서 일괄 생성  | `/tf-ralph`   | 템플릿 기반 반복 |

**핵심 판단 기준:**

```
패턴이 같고 대상이 여러 개?            → Ralph
각 작업이 독립적이고 맥락 공유 불필요?  → Ralph
창의적 판단이나 아키텍처 결정 필요?     → /tf-start 또는 /tf-analyze
```

Ralph로 생성된 태스크도 일반 태스크와 똑같이 보드에서 추적됩니다. 배치 그룹은 접었다 펼 수 있어서, 전체 진행률을 한눈에 보고 개별 카드를 펼쳐 상세를 볼 수 있어요.

```
보드:
├── [Ralph Batch] pytest 생성 (8/8 완료)   ← 접힘
├── [Ralph Batch] a11y 개선 (6/8 진행 중)
│   ├── TASK-040 ✓
│   ├── TASK-042 [IN_PROGRESS]
│   └── ...
```

> ⚠️ Ralph의 자동 재시도·실행 모드(순차/병렬) 같은 세부 동작은 버전에 따라 다를 수 있습니다. 배치가 일부 실패하면 보드에서 FAILED 카드만 골라 `/tf-fix`로 손보면 됩니다 — 반복 처리와 개별 복구를 섞어 쓰세요.

---

## 정리 (1분)

> 화면: 요약 슬라이드

1. **`/tf-ralph`는 반복 작업 전용** — 패턴이 같고 대상이 여러 개인 작업에 최적.
2. **자동 스캔 → 자동 티켓 → 배치 실행** — 사람이 하나하나 태스크를 만들 필요 없음.
3. **보드에서 배치 그룹으로 추적** — 일반 태스크와 동일하게 관리, 실패 카드만 `/tf-fix`로 복구.

데모에서 봤듯, 사람이 했으면 한참 걸렸을 반복 작업을 배치로 한 번에 처리했습니다(수치는 예시). 지루하고 기계적인 일일수록 Ralph가 빛납니다.

다음 섹션에서는 에이전트의 **행동 자체를 바꾸는** 커스터마이즈를 다룹니다 — 스킬 파일, 커스텀 상태, 하네스 MCP 추가까지.

---

다음: [[8-3_커스터마이즈_스킬_하네스]]
