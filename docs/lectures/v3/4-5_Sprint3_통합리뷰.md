---
tags: [강의, v3, 모듈4]
type: lecture
aliases: [Sprint 3 통합 리뷰]
---

# Sprint 3 — 통합 + 리뷰

> 모듈 4 · 섹션 4-5 · 약 40분
> 관련: [[4-4_Sprint2_프론트엔드]] | [[4-6_상황별_대응]]

> 🗄️ **[구버전 · M5로 이동]** 이 문서는 구 모듈4(ReachWave / P3) 자료입니다. 강의 재편(재작성 청사진 기준)으로 **모듈 5(실전 SaaS 스프린트, P3)**로 이동·재집필되었습니다. 최신 본문은 신 **[[5-4_Sprint2_프론트_병렬통합]]** 를 보세요.
> 신 모듈4는 **P2 날씨 대시보드 멀티에이전트 협업**(Claude + Codex)으로 바뀌었습니다 → [[4-5_통합_회고]].

---

## 도입 (5분)

Sprint 1에서 백엔드를 만들고, Sprint 2에서 프론트엔드를 만들었습니다. 이제 **모든 것을 하나로 합치는** Sprint 3입니다.

화면: 칸반 보드 — 대부분 DONE, 남은 태스크 몇 개

```bash
/tf-status
```

```
📊 Progress: ███████████████░░ 15/18 (83%)

Remaining:
  🔨 TASK-014  검색 기능                    IN_PROGRESS  @Frontend-Agent
  ⏳ TASK-017  E2E 통합 테스트               TODO (blocked: 013 ✅, 014)
  ⏳ TASK-018  API 유닛 테스트               TODO → unblocked!
```

거의 다 왔습니다! 남은 건 검색 기능 마무리, 유닛 테스트, E2E 통합 테스트입니다.

이번 Sprint에서 할 일은 세 가지예요:

1. **남은 태스크 완료 + 리뷰**
2. **통합 테스트 — 전체 시스템이 함께 돌아가는지**
3. **최종 데모 — 완성된 서비스를 직접 사용해보기**

---

## 본문

### 테스트 에이전트 활성화 (7분)

TASK-014(검색)이 완료되면 드디어 **Test Agent가 활성화**됩니다!

화면: Test Agent 터미널 탭 — 활성화

```
[Test Agent] Dependencies resolved! Starting work.
[Test Agent] Claiming TASK-018: API 유닛 테스트
[Test Agent] Claiming TASK-017: E2E 통합 테스트 (queued after 018)
```

Test Agent가 만드는 테스트 코드를 봅시다:

```python
# backend/tests/test_youtube_api.py
import pytest
from httpx import AsyncClient
from app.main import app

@pytest.mark.asyncio
async def test_get_video_metadata():
    """YouTube 메타데이터 API가 올바르게 동작하는지 테스트"""
    async with AsyncClient(app=app, base_url="http://test") as client:
        response = await client.post(
            "/api/youtube/metadata",
            json={"url": "https://www.youtube.com/watch?v=dQw4w9WgXcQ"}
        )
        assert response.status_code == 200
        data = response.json()
        assert "title" in data
        assert "channel_name" in data
        assert "thumbnail_url" in data

@pytest.mark.asyncio
async def test_invalid_youtube_url():
    """잘못된 YouTube URL에 대해 400 에러를 반환하는지 테스트"""
    async with AsyncClient(app=app, base_url="http://test") as client:
        response = await client.post(
            "/api/youtube/metadata",
            json={"url": "https://not-youtube.com/video"}
        )
        assert response.status_code == 400

@pytest.mark.asyncio
async def test_get_transcript():
    """자막 추출 API가 동작하는지 테스트"""
    async with AsyncClient(app=app, base_url="http://test") as client:
        response = await client.post(
            "/api/youtube/transcript",
            json={"url": "https://www.youtube.com/watch?v=dQw4w9WgXcQ"}
        )
        assert response.status_code == 200
        data = response.json()
        assert "transcript" in data
        assert len(data["transcript"]) > 0

@pytest.mark.asyncio
async def test_analyze_endpoint():
    """Claude API 분석 엔드포인트 테스트"""
    async with AsyncClient(app=app, base_url="http://test") as client:
        # 먼저 로그인
        login_res = await client.post(
            "/api/auth/login",
            data={"username": "test@test.com", "password": "testpassword"}
        )
        token = login_res.json()["access_token"]

        # 분석 요청
        response = await client.post(
            "/api/youtube/analyze",
            json={"url": "https://www.youtube.com/watch?v=dQw4w9WgXcQ"},
            headers={"Authorization": f"Bearer {token}"}
        )
        assert response.status_code == 200
        data = response.json()
        assert "analysis_id" in data
```

기본적인 API 테스트부터, 에러 케이스, 인증이 필요한 엔드포인트까지 다양한 테스트를 만들어줍니다.

### TASK-017: E2E 통합 테스트 (8분)

화면: Test Agent — E2E 테스트 작성 중

E2E(End-to-End) 테스트는 사용자 시나리오 전체를 검증합니다:

```python
# tests/test_e2e.py
import pytest
from httpx import AsyncClient

@pytest.mark.asyncio
class TestFullAnalysisFlow:
    """사용자 시나리오 전체 흐름 테스트"""

    async def test_complete_flow(self, client: AsyncClient):
        """회원가입 → 로그인 → URL 분석 → 결과 조회 → 검색"""

        # 1. 회원가입
        register_res = await client.post("/api/auth/register", json={
            "email": "e2e@test.com",
            "password": "securepassword123"
        })
        assert register_res.status_code == 200

        # 2. 로그인
        login_res = await client.post("/api/auth/login", data={
            "username": "e2e@test.com",
            "password": "securepassword123"
        })
        assert login_res.status_code == 200
        token = login_res.json()["access_token"]
        headers = {"Authorization": f"Bearer {token}"}

        # 3. YouTube URL 분석 요청
        analyze_res = await client.post(
            "/api/youtube/analyze",
            json={"url": "https://www.youtube.com/watch?v=dQw4w9WgXcQ"},
            headers=headers
        )
        assert analyze_res.status_code == 200
        analysis_id = analyze_res.json()["analysis_id"]

        # 4. 분석 결과 조회
        result_res = await client.get(
            f"/api/analysis/{analysis_id}",
            headers=headers
        )
        assert result_res.status_code == 200
        result = result_res.json()
        assert result["summary"] is not None
        assert len(result["key_points"]) > 0
        assert len(result["keywords"]) > 0

        # 5. 히스토리 조회
        history_res = await client.get(
            "/api/analysis/history",
            headers=headers
        )
        assert history_res.status_code == 200
        assert len(history_res.json()["items"]) >= 1

        # 6. 검색
        search_res = await client.get(
            "/api/analysis/search?q=youtube",
            headers=headers
        )
        assert search_res.status_code == 200
```

화면: 테스트 실행 결과 — 모두 통과

```
[Test Agent] Running pytest...
================================
tests/test_youtube_api.py .... [4/4 PASSED]
tests/test_auth.py ......... [6/6 PASSED]
tests/test_analysis.py ..... [5/5 PASSED]
tests/test_e2e.py ......... [3/3 PASSED]
================================
18 passed in 12.34s
```

테스트가 모두 통과했습니다! 이걸 확인하고 Approve하면 됩니다.

**(실습):**

```bash
/tf-review TASK-017
/tf-review TASK-018
```

### 배치 리뷰 — 효율적인 리뷰 방법 (5분)

남은 태스크가 여러 개일 때, 하나씩 리뷰하는 건 비효율적이죠. 마블로에는 **배치 리뷰** 기능이 있습니다:

**(실습):**

```bash
/tf-review --all
```

화면: 배치 리뷰 화면 — REVIEW 상태인 모든 태스크 목록

```
📝 Batch Review — 3 tasks pending
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

1. [TASK-014] 검색 기능            → View | Approve | Reject
2. [TASK-017] E2E 통합 테스트      → View | Approve | Reject
3. [TASK-018] API 유닛 테스트      → View | Approve | Reject

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
[A]pprove all  [R]eview each  [?] Help
```

각각 확인할 수도 있고, 모두 한꺼번에 Approve할 수도 있어요. 코드를 이미 확인했다면:

```bash
A  # Approve all
```

```
✅ 3 tasks approved!
  TASK-014: DONE
  TASK-017: DONE
  TASK-018: DONE

📊 Progress: ████████████████ 18/18 (100%) ✅
🎉 All tasks completed!
```

화면: 칸반 보드 — 모든 18개 카드가 DONE 열에, 프로젝트 완료 배너

### 전체 시스템 통합 실행 (10분)

자, 이제 완성된 서비스를 직접 돌려봅시다!

화면: 터미널에서 Docker Compose 실행

**(실습)** Docker Compose로 전체 시스템을 올립니다:

```bash
cd youtube-insight
docker compose up -d --build
```

```
[+] Building 42.3s
 ✅ backend    Built and started
 ✅ frontend   Built and started
 ✅ postgres   Started
[+] Running 3/3
```

화면: 브라우저에서 서비스 접속

**시연 시나리오:**

1. **회원가입**: `http://localhost:3000/register`

   - 이메일: test@example.com
   - 비밀번호 설정

2. **로그인**: 로그인 후 대시보드로 이동

3. **첫 번째 분석**:
   - URL 입력: `https://www.youtube.com/watch?v=...` (아무 영상 URL)
   - "분석하기" 클릭
   - 로딩 UI 표시 (30초 내외)
   - 분석 결과 페이지로 이동

화면: 분석 결과 페이지 — 인사이트 카드

4. **결과 확인**:

   - 영상 썸네일 + 제목 표시
   - AI 요약 (3-5문장)
   - 핵심 포인트 5개
   - 키워드 태그
   - 추천 행동 3개

5. **대시보드 확인**: 히스토리에 분석 결과가 저장되어 있음

6. **검색**: "키워드"로 검색 → 관련 분석 결과 필터링

이 모든 게 에이전트 4개가 18개 태스크를 처리해서 만든 결과물입니다. 직접 코딩한 건 없고, PM으로서 기획, 관찰, 리뷰만 했습니다.

### 버그 발견 시 대응 (5분)

데모 중에 버그가 발견될 수 있어요. 예를 들어:

- "자막이 없는 영상에서 에러 메시지가 안 나온다"
- "긴 제목이 카드에서 잘린다"
- "새로고침하면 로그인이 풀린다"

이런 경우:

```bash
/tf-add "자막 없는 영상 에러 핸들링 개선" --type backend --priority high
```

새 태스크를 추가하면 에이전트가 자동으로 클레임해서 처리합니다. 이 부분은 다음 섹션([[4-6_상황별_대응]])에서 자세히 다루겠습니다.

---

## 정리

Sprint 3에서 진행된 내용:

1. **Test Agent 활성화**: 모든 개발 태스크 완료 후 테스트 시작
2. **유닛 테스트 + E2E 테스트**: 개별 API + 전체 흐름 검증
3. **배치 리뷰**: `/tf-review --all`로 여러 태스크를 한꺼번에 처리
4. **통합 실행**: Docker Compose로 전체 시스템 기동
5. **데모**: 회원가입 → 로그인 → URL 분석 → 결과 확인 → 검색

18개 태스크, 4개 에이전트, 약 4시간. 완전한 AI SaaS 서비스가 만들어졌습니다.

---

다음: [[4-6_상황별_대응]]
