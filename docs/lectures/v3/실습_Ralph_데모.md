---
tags: [강의, v3, 모듈8]
type: 실습
aliases: [실습 Ralph 데모]
---

# 실습: Ralph 반복 작업 자동화 데모

> 모듈 8 · 실습 · [[8-2_Ralph_반복자동화]] 보충 자료
> 관련: [[8-1_일상_운영패턴]] | [[8-2_Ralph_반복자동화]] | [[8-3_확장방향]]

---

## 실습 목표

이 실습을 완료하면 다음을 할 수 있습니다:
- `/tf-ralph` 명령으로 반복 작업을 배치 자동화
- Ralph가 코드베이스를 스캔하고 작업 대상을 자동 식별하는 과정을 이해
- 배치 생성된 태스크의 진행 상황을 칸반 보드에서 추적
- Ralph와 `/tf-start`의 사용 시점을 구분

## 사전 요구사항

- [ ] 마블로 v3 앱이 설치되어 있어야 합니다
- [ ] Claude Code CLI 인증 완료 (`claude login`)
- [ ] 모듈 4의 AI YouTube Insight 프로젝트 (또는 API 엔드포인트가 있는 아무 프로젝트)
- [ ] pytest, httpx 설치 (백엔드 프로젝트의 경우)

---

## Step 1: 프로젝트 준비 (3분)

### 1-a: 프로젝트 디렉토리로 이동

```bash
# AI YouTube Insight 프로젝트 사용
cd ~/projects/youtube-insight

# 또는 새 데모 프로젝트 생성
mkdir -p ~/projects/ralph-demo
cd ~/projects/ralph-demo
```

### 1-b: 새 프로젝트로 시작하는 경우

Ralph 데모를 위한 간단한 FastAPI 프로젝트를 만듭니다:

```bash
# 가상환경 생성
python -m venv venv
source venv/bin/activate

# 패키지 설치
pip install fastapi uvicorn httpx pytest pytest-asyncio
```

```python
# src/main.py
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel
from typing import Optional
import uuid

app = FastAPI()

# 인메모리 데이터 저장
items_db: dict = {}

class Item(BaseModel):
    name: str
    description: Optional[str] = None
    price: float

class ItemUpdate(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None
    price: Optional[float] = None

@app.get("/api/health")
def health():
    return {"status": "ok"}

@app.get("/api/items")
def list_items():
    return list(items_db.values())

@app.post("/api/items", status_code=201)
def create_item(item: Item):
    item_id = str(uuid.uuid4())
    data = {"id": item_id, **item.model_dump()}
    items_db[item_id] = data
    return data

@app.get("/api/items/{item_id}")
def get_item(item_id: str):
    if item_id not in items_db:
        raise HTTPException(status_code=404, detail="Item not found")
    return items_db[item_id]

@app.put("/api/items/{item_id}")
def update_item(item_id: str, item: ItemUpdate):
    if item_id not in items_db:
        raise HTTPException(status_code=404, detail="Item not found")
    existing = items_db[item_id]
    update_data = item.model_dump(exclude_unset=True)
    existing.update(update_data)
    return existing

@app.delete("/api/items/{item_id}")
def delete_item(item_id: str):
    if item_id not in items_db:
        raise HTTPException(status_code=404, detail="Item not found")
    del items_db[item_id]
    return {"message": "Deleted"}

@app.get("/api/items/search/{query}")
def search_items(query: str):
    results = [v for v in items_db.values() if query.lower() in v["name"].lower()]
    return results

@app.get("/api/stats")
def get_stats():
    total = len(items_db)
    avg_price = sum(v["price"] for v in items_db.values()) / total if total > 0 else 0
    return {"total_items": total, "average_price": avg_price}
```

```bash
# 서버 실행 확인
uvicorn src.main:app --reload --port 8001

# 다른 터미널에서 테스트
curl http://localhost:8001/api/health
# {"status":"ok"}
```

### 1-c: 현재 테스트 상황 확인

```bash
# tests 디렉토리 확인
ls tests/ 2>/dev/null || echo "tests 디렉토리 없음"

# API 엔드포인트 개수 확인
grep -c "def " src/main.py
# 8개 함수 (8개 엔드포인트)
```

테스트가 전혀 없는 상태에서 시작합니다.

---

## Step 2: 마블로 프로젝트 설정 (2분)

1. 마블로 앱에서 새 프로젝트 생성
   - **프로젝트명**: `ralph-demo`
   - **프로젝트 경로**: `~/projects/ralph-demo`
2. 오케스트레이터 실행
3. 에이전트 1개 이상 생성 (Claude, role: test)

화면: 칸반 보드가 비어 있는 상태

---

## Step 3: Demo 1 — pytest 배치 생성 (15분)

### 3-a: Ralph 실행

오케스트레이터 터미널에 입력합니다:

```
/tf-ralph 모든 API 엔드포인트에 대한 pytest를 작성해줘.
각 엔드포인트마다 3개 테스트 케이스:
1. 정상 요청 (성공 응답)
2. 잘못된 입력 (400 또는 422)
3. 존재하지 않는 리소스 (404)
pytest + httpx AsyncClient 사용.
테스트 파일은 tests/ 디렉토리에 엔드포인트별로 분리.
```

### 3-b: 동작 과정 관찰

**관찰 포인트 1: 코드 스캔**

화면: 터미널에서 Ralph가 코드를 스캔하는 로그

Ralph가 `src/main.py`를 분석해서 8개 엔드포인트를 자동으로 식별합니다:

```
[Ralph] Scanning for API endpoints...
[Ralph] Found: GET /api/health
[Ralph] Found: GET /api/items
[Ralph] Found: POST /api/items
[Ralph] Found: GET /api/items/{item_id}
[Ralph] Found: PUT /api/items/{item_id}
[Ralph] Found: DELETE /api/items/{item_id}
[Ralph] Found: GET /api/items/search/{query}
[Ralph] Found: GET /api/stats
[Ralph] Total: 8 endpoints → 8 batch tickets
```

**관찰 포인트 2: 티켓 생성**

화면: 칸반 보드에 8개 태스크가 생성

```
TASK-001: pytest — GET /api/health
TASK-002: pytest — GET /api/items
TASK-003: pytest — POST /api/items
TASK-004: pytest — GET /api/items/{item_id}
TASK-005: pytest — PUT /api/items/{item_id}
TASK-006: pytest — DELETE /api/items/{item_id}
TASK-007: pytest — GET /api/items/search/{query}
TASK-008: pytest — GET /api/stats
```

**관찰 포인트 3: 배치 실행**

```
[Ralph] Executing batch...
[Ralph] [1/8] TASK-001 → tests/test_health.py ... DONE (8s)
[Ralph] [2/8] TASK-002 → tests/test_list_items.py ... DONE (11s)
[Ralph] [3/8] TASK-003 → tests/test_create_item.py ... DONE (14s)
...
```

화면: 칸반 보드에서 태스크가 순서대로 TODO → IN_PROGRESS → DONE 이동

### 3-c: 결과 확인

```bash
# 생성된 파일 확인
ls tests/
# test_health.py
# test_list_items.py
# test_create_item.py
# test_get_item.py
# test_update_item.py
# test_delete_item.py
# test_search_items.py
# test_stats.py
# conftest.py
```

```bash
# conftest.py 확인 — 공통 설정
cat tests/conftest.py
```

```python
# tests/conftest.py (Ralph가 자동 생성)
import pytest
from httpx import AsyncClient, ASGITransport
from src.main import app

@pytest.fixture
async def client():
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        yield ac

@pytest.fixture
def sample_item():
    return {
        "name": "Test Item",
        "description": "A test item",
        "price": 29.99
    }
```

```bash
# 전체 테스트 실행
pytest tests/ -v

# 출력 예시:
# tests/test_health.py::test_health_ok PASSED
# tests/test_health.py::test_health_response_format PASSED
# tests/test_health.py::test_health_status_code PASSED
# tests/test_create_item.py::test_create_item_success PASSED
# tests/test_create_item.py::test_create_item_invalid_price PASSED
# tests/test_create_item.py::test_create_item_missing_name PASSED
# ...
# =================== 24 passed in 3.47s ===================
```

8개 파일, 24개 테스트 케이스, 전부 통과!

### 3-d: 생성된 테스트 코드 살펴보기

```bash
cat tests/test_create_item.py
```

```python
# tests/test_create_item.py
import pytest

@pytest.mark.asyncio
async def test_create_item_success(client, sample_item):
    """정상적인 아이템 생성"""
    response = await client.post("/api/items", json=sample_item)
    assert response.status_code == 201
    data = response.json()
    assert "id" in data
    assert data["name"] == sample_item["name"]
    assert data["price"] == sample_item["price"]

@pytest.mark.asyncio
async def test_create_item_invalid_price(client):
    """가격이 문자열인 경우 (유효성 검증 실패)"""
    response = await client.post("/api/items", json={
        "name": "Bad Item",
        "price": "not-a-number"
    })
    assert response.status_code == 422

@pytest.mark.asyncio
async def test_create_item_missing_name(client):
    """필수 필드(name) 누락"""
    response = await client.post("/api/items", json={
        "price": 10.0
    })
    assert response.status_code == 422
```

패턴이 일관적이고, conftest.py의 fixture를 잘 활용하고 있습니다.

---

## Step 4: Demo 2 — 프론트엔드 a11y 개선 (선택, 10분)

프론트엔드 프로젝트가 있는 경우에만 진행합니다.

### 4-a: 접근성 점수 확인

```bash
# 프론트엔드 개발 서버 실행
cd ~/projects/youtube-insight
npm run dev

# 다른 터미널에서 Lighthouse 실행
npx lighthouse http://localhost:3000 --only-categories=accessibility --output=json --chrome-flags="--headless" | jq '.categories.accessibility.score'
```

### 4-b: Ralph로 a11y 배치 수정

```
/tf-ralph React 컴포넌트의 접근성(a11y)을 WCAG 2.1 AA 기준으로 개선해줘.
각 컴포넌트에서:
1. img 태그에 의미 있는 alt 텍스트
2. 버튼에 aria-label
3. 폼 요소에 label 연결
4. 색상 대비 확인 + 수정
5. 키보드 탐색 지원 (tabIndex, onKeyDown)
```

### 4-c: 결과 확인

```bash
# 수정된 파일 확인
git diff --stat

# Lighthouse 재실행
npx lighthouse http://localhost:3000 --only-categories=accessibility --output=json --chrome-flags="--headless" | jq '.categories.accessibility.score'
```

---

## Step 5: Ralph 배치 모니터링 (5분)

### 5-a: 칸반 보드에서 추적

화면: 마블로 칸반 보드

Ralph가 생성한 태스크는 칸반 보드에서 **배치 그룹**으로 표시됩니다:

```
[Ralph Batch: pytest 생성]
├── TASK-001 ✓ DONE
├── TASK-002 ✓ DONE
├── TASK-003 → IN_PROGRESS
├── TASK-004   TODO
├── ...
└── 진행률: 2/8 (25%)
```

### 5-b: 개별 태스크 상세

각 태스크를 클릭하면 상세 정보를 볼 수 있습니다:

```
TASK-003: pytest — POST /api/items
─────────────────────────────────
상태: IN_PROGRESS
에이전트: Claude-Test
시작 시간: 14:23:45
파일 변경: tests/test_create_item.py (new)
활동 로그:
  14:23:45 - 태스크 시작
  14:23:47 - conftest.py 참조
  14:23:52 - test_create_item.py 생성 중
  14:23:59 - pytest 실행 → 3/3 passed
  14:24:00 - DONE
```

### 5-c: 배치 실패 처리

만약 배치 중 하나가 실패하면:

```
[Ralph] [5/8] TASK-005 → tests/test_update_item.py ... FAILED
[Ralph] Error: test_update_item_partial failed (assertion error)
[Ralph] Retrying TASK-005...
[Ralph] [5/8] TASK-005 → tests/test_update_item.py ... DONE (retry)
```

Ralph는 실패한 태스크를 자동으로 1회 재시도합니다. 재시도도 실패하면 FAILED 상태로 남기고 나머지를 계속 진행합니다.

```bash
# 실패한 태스크만 재실행
/tf-retry TASK-005
```

---

## Step 6: 커스텀 Ralph 패턴 (선택, 5분)

Ralph에 직접 패턴을 정의할 수도 있습니다.

### 6-a: API 문서 자동 생성

```
/tf-ralph 각 API 엔드포인트에 대한 docstring을 추가해줘.
Google 스타일 docstring으로:
- 함수 설명
- Args (파라미터 설명)
- Returns (반환값 설명)
- Raises (에러 설명)
- Example (사용 예시)
```

### 6-b: 타입 힌트 강화

```
/tf-ralph 모든 Python 함수에 완전한 타입 힌트를 추가해줘.
- 반환 타입 명시
- Optional 타입 처리
- Union 타입 처리
- mypy strict 모드 통과 수준
```

---

## 트러블슈팅

### 문제: Ralph가 엔드포인트를 못 찾음

```bash
# 프로젝트 경로가 맞는지 확인
pwd
# ~/projects/ralph-demo

# 소스 파일이 있는지 확인
find . -name "*.py" | head -10

# Ralph에게 경로를 직접 지정
/tf-ralph src/main.py의 API 엔드포인트에 대한 pytest를 작성해줘
```

### 문제: 테스트가 실패함

```bash
# 어떤 테스트가 실패했는지 확인
pytest tests/ -v --tb=short

# 실패한 테스트만 재실행
pytest tests/test_create_item.py -v

# 에이전트에게 수정 요청
/tf-fix TASK-003 test_create_item_invalid_price가 422 대신 200을 반환해요. Pydantic 유효성 검증이 안 되는 것 같아요.
```

### 문제: conftest.py가 생성 안 됨

```bash
# conftest.py를 수동으로 만들고 Ralph 재실행
cat > tests/conftest.py << 'EOF'
import pytest
from httpx import AsyncClient, ASGITransport
from src.main import app

@pytest.fixture
async def client():
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        yield ac
EOF

# Ralph 재실행
/tf-ralph 나머지 엔드포인트에 대한 pytest 작성 이어서 해줘
```

### 문제: 칸반 보드에 태스크가 안 보임

1. MCP 서버 연결 상태 확인: `/mcp`
2. 마블로 앱에서 프로젝트가 선택되어 있는지 확인
3. 브라우저 새로고침
4. 오케스트레이터 재시작

---

## 도전 과제 (선택)

### 도전 1: 테스트 커버리지 100%

Ralph로 생성한 테스트의 커버리지를 확인하고, 누락된 부분을 추가해보세요:

```bash
pip install pytest-cov
pytest tests/ --cov=src --cov-report=html
open htmlcov/index.html
```

### 도전 2: 30개 이상 배치

더 큰 프로젝트에서 Ralph를 실행해보세요. 엔드포인트가 30개 이상인 프로젝트에서 Ralph가 어떻게 동작하는지 관찰해보세요.

### 도전 3: 커스텀 패턴 정의

Ralph에게 완전히 새로운 패턴을 정의해보세요:
- ESLint 에러 배치 수정
- i18n (다국어) 키 추출 및 번역 파일 생성
- Storybook 스토리 파일 자동 생성

---

## 다음 단계

- [[8-3_확장방향]] — 마블로의 미래 방향
- [[8-4_마무리]] — 전체 과정 마무리
- [[HOME]] — 전체 강좌 홈으로 돌아가기

---
다음: [[8-4_마무리]]
