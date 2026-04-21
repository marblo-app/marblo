---
tags: [강의, v3, 모듈4]
type: 실습
aliases: [AI SaaS 실습 시나리오]
---

# 실습: AI YouTube 인사이트 서비스 빌드

> 모듈 4 · 실습 · 전체 시나리오
> 관련: [[4-1_요구사항_분석]] | [[4-2_태스크생성_에이전트스폰]] | [[4-3_Sprint1_백엔드]] | [[4-4_Sprint2_프론트엔드]] | [[4-5_Sprint3_통합리뷰]] | [[4-6_상황별_대응]] | [[4-7_프로젝트_마무리]]

---

## 실습 개요

**목표:** 마블로를 사용해 AI YouTube 인사이트 서비스를 처음부터 끝까지 빌드합니다.

**결과물:** YouTube URL 입력 → AI 분석 → 요약 + 인사이트 카드 + 대시보드

**기술 스택:**
- Backend: FastAPI + PostgreSQL + SQLAlchemy
- Frontend: Next.js + TailwindCSS
- AI: Claude API (anthropic SDK)
- External: YouTube Data API v3
- Infra: Docker Compose

**예상 소요 시간:** 약 3-4시간 (에이전트 작업 시간 포함)

**에이전트:** Backend Agent, Frontend Agent, DevOps Agent, Test Agent (4개)

---

## 사전 준비

### 1. API 키 준비

다음 3개의 API 키가 필요합니다:

| API | 발급처 | 용도 |
|-----|--------|------|
| Claude API Key | [console.anthropic.com](https://console.anthropic.com) | AI 영상 분석 |
| YouTube Data API Key | [console.cloud.google.com](https://console.cloud.google.com) | 영상 메타데이터 + 자막 |
| (선택) PostgreSQL | 로컬 Docker | 데이터 저장 |

### 2. 프로젝트 디렉토리 생성

```bash
mkdir youtube-insight
cd youtube-insight
```

### 3. 환경 변수 설정

```bash
# .env 파일 생성
cat > .env << 'EOF'
CLAUDE_API_KEY=sk-ant-api03-...
YOUTUBE_API_KEY=AIza...
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/youtube_insight
JWT_SECRET_KEY=your-super-secret-key-change-this
EOF
```

### 4. 마블로 연결 확인

- 마블로 데스크탑 앱 실행
- Claude Code 세션 연결 확인
- MCP 서버 `Connected` 상태 확인

```bash
/tf-status
# → "No active project" 가 나오면 정상
```

---

## Phase 1: 기획 (30분)

### Step 1-1: 요구사항 분석

```bash
/tf-analyze AI YouTube 인사이트 서비스. YouTube URL을 넣으면 AI가 영상을 분석해서 요약 + 핵심 인사이트를 추출. FastAPI + Next.js + Claude API + YouTube Data API. 사용자별 분석 히스토리 저장. 간단한 이메일 로그인.
```

### Step 1-2: Socratic Questions 응답 가이드

| 질문 영역 | 추천 답변 |
|-----------|----------|
| 인증 방식 | 이메일 + 비밀번호, JWT 토큰 |
| 자막 없는 영상 | "자막 없음" 에러 메시지 표시 |
| 일일 사용 제한 | 사용자당 10회 |
| 인사이트 형태 | 요약(3-5문장), 핵심 포인트(5개), 키워드(10개), 추천 행동(3개) |
| 대시보드 | 최근 분석 목록 + 개별 상세 페이지 |
| 검색 | 분석 결과 내 키워드 검색 |
| 배포 | Docker Compose (로컬) |

### Step 1-3: PRD 확인

생성된 PRD에서 다음을 확인하세요:

- [ ] 핵심 기능 6개가 모두 포함되어 있는가?
- [ ] 기술 스택이 올바른가?
- [ ] 비기능 요구사항(응답 시간, 동시 사용자 등)이 있는가?
- [ ] 빠진 기능이 없는가?

필요하면 피드백을 주세요:
```bash
"모바일 반응형 추가, 분석 결과 공유 링크 기능은 v2로 미뤄주세요."
```

### Step 1-4: 태스크 목록 확인

**예상 태스크 (18개):**

```
Backend (7):
  [001] DB 스키마 설계 + 마이그레이션
  [002] 사용자 인증 API (회원가입/로그인)
  [003] YouTube 메타데이터 수집 API
  [004] YouTube 자막 추출 API
  [005] Claude API 분석 엔드포인트
  [006] 분석 결과 저장/조회 API
  [007] 사용량 제한 미들웨어

Frontend (7):
  [008] 로그인/회원가입 UI
  [009] URL 입력 폼 컴포넌트
  [010] 분석 진행 상태 UI (로딩)
  [011] 인사이트 카드 컴포넌트
  [012] 분석 상세 페이지
  [013] 대시보드 (히스토리 목록)
  [014] 검색 기능

DevOps (2):
  [015] Docker Compose 설정
  [016] 환경 변수 + 설정 관리

Test (2):
  [017] E2E 통합 테스트
  [018] API 유닛 테스트
```

**의존성 체크:**
- [ ] 백엔드 API → 프론트엔드 UI 순서가 맞는가?
- [ ] DB 스키마(001)가 다른 백엔드 태스크보다 앞에 있는가?
- [ ] 테스트 태스크가 마지막에 있는가?

### 체크포인트

- [ ] PRD 승인 완료
- [ ] 태스크 18개 확인 + 의존성 검토 완료
- [ ] 수정 사항 반영 완료

---

## Phase 2: 실행 (20분)

### Step 2-1: 태스크 생성

```bash
/tf-create-tasks
```

확인:
- [ ] 칸반 보드에 18개 카드 생성
- [ ] 각 카드에 올바른 상태 표시 (TODO / blocked)

### Step 2-2: 에이전트 스폰

```bash
/tf-spawn-agents
```

확인:
- [ ] Backend Agent 스폰 및 작업 시작
- [ ] Frontend Agent 스폰 (대기 상태)
- [ ] DevOps Agent 스폰 및 작업 시작
- [ ] Test Agent 스폰 (대기 상태)

### Step 2-3: 초기 상태 확인

```bash
/tf-status
```

확인:
- [ ] TASK-001, 002, 003이 IN_PROGRESS
- [ ] TASK-015가 IN_PROGRESS (DevOps)
- [ ] 나머지 태스크는 TODO 또는 blocked

---

## Phase 3: Sprint 1 — 백엔드 (50분)

### Step 3-1: 병렬 백엔드 태스크 모니터링

5분마다 상태 확인:

```bash
/tf-status
```

### Step 3-2: 첫 번째 리뷰 (TASK-001, 002, 003)

3개 태스크가 REVIEW로 올라오면:

```bash
/tf-review TASK-001
```

**TASK-001 (DB 스키마) 체크리스트:**
- [ ] User, Video, Analysis 모델 정의
- [ ] relationship에 `selectinload` (또는 `lazy="selectin"`) 적용
- [ ] Alembic 마이그레이션 파일 생성
- [ ] 인덱스 설정 (email, youtube_id)

```bash
/tf-review TASK-002
```

**TASK-002 (인증 API) 체크리스트:**
- [ ] POST /api/auth/register
- [ ] POST /api/auth/login → JWT 토큰 반환
- [ ] 비밀번호 bcrypt 해싱
- [ ] 이메일 중복 체크

```bash
/tf-review TASK-003
```

**TASK-003 (YouTube 메타데이터) 체크리스트:**
- [ ] YouTube URL 파싱 (다양한 형태 지원)
- [ ] YouTube Data API v3 연동
- [ ] 제목, 채널, 길이, 썸네일 반환

### Step 3-3: 2차 태스크 리뷰 (TASK-004, 005)

```bash
/tf-review TASK-004  # 자막 추출
/tf-review TASK-005  # Claude API 분석 ← 핵심! 꼼꼼히 리뷰
```

**TASK-005 특별 체크:**
- [ ] 프롬프트가 한국어/영어 모두 대응하는가?
- [ ] JSON 형태로 응답을 파싱하는가?
- [ ] 토큰 제한(10,000자 등) 처리가 있는가?
- [ ] 타임아웃 처리가 있는가?

---

## Phase 4: Sprint 2 — 프론트엔드 (50분)

### Step 4-1: Frontend Agent 활성화 확인

```bash
/tf-status
```

- [ ] Frontend Agent가 WORKING 상태인가?
- [ ] Backend Agent와 병렬로 진행 중인가?

### Step 4-2: 프론트엔드 태스크 리뷰

```bash
/tf-review TASK-008  # 로그인 UI
/tf-review TASK-009  # URL 입력 폼
/tf-review TASK-011  # 인사이트 카드 ← 핵심 UI! 꼼꼼히 리뷰
/tf-review TASK-013  # 대시보드
```

### Step 4-3: 피드백 연습

최소 1개 태스크에 Reject + 피드백을 줘보세요:

```bash
/tf-review TASK-011
R
> 인사이트 카드에 분석 날짜를 추가해주세요. 그리고 키워드 태그 클릭 시 해당 키워드로 검색되게 해주세요.
```

피드백 후 수정된 결과를 다시 리뷰하세요.

---

## Phase 5: Sprint 3 — 통합 + 테스트 (40분)

### Step 5-1: 테스트 에이전트 확인

```bash
/tf-status
```

- [ ] Test Agent가 활성화되었는가?
- [ ] TASK-017, 018이 IN_PROGRESS인가?

### Step 5-2: 테스트 결과 확인

```bash
/tf-review TASK-018  # 유닛 테스트
/tf-review TASK-017  # E2E 테스트
```

- [ ] 모든 테스트가 통과하는가?
- [ ] 엣지 케이스(자막 없는 영상, 잘못된 URL 등)가 포함되어 있는가?

### Step 5-3: 전체 시스템 실행

```bash
cd youtube-insight
docker compose up -d --build
```

### Step 5-4: 기능 테스트

| 테스트 | URL / 작업 | 예상 결과 |
|--------|-----------|----------|
| 회원가입 | /register | 계정 생성 성공 |
| 로그인 | /login | 대시보드 리다이렉트 |
| URL 분석 | YouTube URL 입력 | 분석 결과 페이지 |
| 인사이트 확인 | 분석 결과 페이지 | 요약 + 포인트 + 키워드 |
| 대시보드 | / | 히스토리 목록 |
| 검색 | 키워드 입력 | 필터링된 결과 |
| 사용 제한 | 11번째 분석 | 제한 초과 메시지 |

---

## Phase 6: 상황별 대응 연습 (선택)

### 시나리오 A: API 키 오류 시뮬레이션

```bash
# .env에서 CLAUDE_API_KEY를 일부러 잘못 설정
# 분석 요청 → FAILED
/tf-fix TASK-005
# 원인 확인 → .env 수정 → Retry
```

### 시나리오 B: 새 기능 추가

```bash
/tf-add "다크 모드 지원" --type frontend --depends-on 013 --priority low
```

### 시나리오 C: 세션 복구

```bash
# 마블로 앱 종료 후 재시작
/tf-resume
# 프로젝트 상태 복원 확인
```

---

## Phase 7: 마무리

### Step 7-1: 프로젝트 통계

```bash
/tf-stats
```

기록할 것:
- [ ] 총 태스크 수 / 완료 수
- [ ] 에이전트별 작업 시간
- [ ] 총 생성 파일 수 / 코드 줄 수
- [ ] 리뷰/피드백 횟수

### Step 7-2: 아카이브

```bash
/tf-archive
```

### Step 7-3: 회고

| 질문 | 나의 답변 |
|------|----------|
| 가장 잘 된 부분? | |
| 가장 어려웠던 부분? | |
| 에이전트에게 더 잘 지시할 수 있었던 부분? | |
| 태스크 분해를 다시 한다면? | |
| 다음 프로젝트에 적용할 교훈? | |

---

## 보너스: 확장 아이디어

이 프로젝트를 더 발전시키고 싶다면:

1. **다국어 지원** — 여러 언어 자막 분석
2. **플레이리스트 분석** — 여러 영상 한꺼번에
3. **비교 분석** — 두 영상의 인사이트 비교
4. **PDF 내보내기** — 분석 결과를 보고서로
5. **팀 기능** — 여러 사용자가 분석 결과 공유
6. **알림** — 특정 채널 새 영상 자동 분석

각 아이디어를 `/tf-add`로 추가하고, 에이전트에게 맡겨보세요!

---
다음: [[5-1_왜_멀티모델인가]]
