# Marblo (마블로) — Project Overview

> AI Agent Teams 기반 태스크 관리 플랫폼
> PM이 대시보드에서 태스크를 만들면, AI 에이전트 군단이 자율적으로 코딩하고, 리뷰하고, 병합한다.

---

## 1. 핵심 컨셉

```
Agent Teams = 실행 엔진 (Anthropic 제공)
Marblo = 거버넌스 레이어 (태스크 관리, 품질 검증, 모니터링)
```

Agent Teams만으로는 태스크 히스토리 저장, PM 대시보드, 품질 검증 체계가 없다.
Marblo는 그 위에 **관제 시스템**을 얹어서 PM이 에이전트 팀을 운영할 수 있게 한다.

---

## 2. 전체 아키텍처

```
┌─────────────────────────────────────────────────────────────────┐
│  PM (사람)                                                        │
│  - 대시보드에서 태스크 카드 생성                                     │
│  - DONE 카드의 작업 내용, PR 링크 최종 확인                          │
│  - 필요시 카드 추가 생성 또는 Team Leader에게 지시                    │
└──────────────────────────┬──────────────────────────────────────┘
                           │ 브라우저
                           ▼
┌─────────────────────────────────────────────────────────────────┐
│  Marblo Dashboard (Next.js 14 + Tailwind CSS)               │
│  http://localhost:3001                                             │
│                                                                    │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌────────┐  │
│  │   TODO   │ │ CLAIMED  │ │ IN_PROG  │ │  REVIEW  │ │  DONE  │  │
│  │          │ │          │ │          │ │          │ │        │  │
│  │ 에이전트가│ │ 에이전트가│ │ 작업내용 │ │ Leader가 │ │ 최종   │  │
│  │ 가져갈   │ │ 선점함   │ │ 실시간   │ │ 코드리뷰 │ │ 결과물  │  │
│  │ 태스크   │ │          │ │ 기록중   │ │          │ │        │  │
│  └──────────┘ └──────────┘ └──────────┘ └──────────┘ └────────┘  │
│                                                                    │
│  각 카드에 표시되는 정보:                                            │
│  - 태스크 제목/설명                                                 │
│  - 담당 에이전트 (claimed_by)                                       │
│  - 역할 뱃지 (backend/frontend/test/devops/merge)                  │
│  - 작업 활동 로그 (에이전트가 기록한 진행 상황)                       │
│  - 커밋 해시, PR URL                                               │
│  - 의존성 상태 (depends_on)                                        │
│  - 상태 히스토리                                                    │
└──────────────────────────┬──────────────────────────────────────┘
                           │ REST API + SSE (실시간)
                           ▼
┌─────────────────────────────────────────────────────────────────┐
│  Backend Server (FastAPI) — http://localhost:8001                  │
│                                                                    │
│  ┌─────────────────────┐  ┌──────────────────────────────┐        │
│  │   REST API          │  │   MCP Server (FastMCP)       │        │
│  │   (대시보드용)       │  │   (Claude Code 에이전트용)    │        │
│  │                     │  │                              │        │
│  │ GET  /api/tasks     │  │ get_available_tasks(role)    │        │
│  │ POST /api/tasks     │  │ claim_task(task_id, agent)   │        │
│  │ PUT  /api/tasks/:id │  │ update_task_status(id, ...)  │        │
│  │ POST /api/.../claim │  │ add_activity(id, message)    │        │
│  │ POST /api/.../review│  │ submit_for_review(id, pr)    │        │
│  │ POST /api/.../approve│ │ get_task_dependencies(id)    │        │
│  │ POST /api/.../reject│  │ get_agent_skill(role)        │        │
│  │ GET  /api/events    │  │                              │        │
│  │      (SSE 스트림)   │  │                              │        │
│  └─────────────────────┘  └──────────────────────────────┘        │
│                                                                    │
│  Task State Machine:                                               │
│  TODO → CLAIMED → IN_PROGRESS → REVIEW → DONE                     │
│                   ↕ BLOCKED    ↕ FAILED                            │
│                   REVIEW → (reject) → TODO                         │
└──────────────────────────┬──────────────────────────────────────┘
                           │
          ┌────────────────┼────────────────┐
          ▼                ▼                ▼
   ┌──────────────┐ ┌──────────────┐ ┌──────────────┐
   │ PostgreSQL 16│ │  Redis 7     │ │  skills/     │
   │              │ │              │ │              │
   │ tasks 테이블 │ │ 캐시         │ │ 에이전트별   │
   │ activity_log │ │ pub/sub      │ │ 스킬 파일    │
   │ agents 테이블│ │ (SSE 이벤트) │ │ (.md)        │
   └──────────────┘ └──────────────┘ └──────────────┘
          ▲                                ▲
          │         MCP Protocol           │
          │                                │
┌─────────┴────────────────────────────────┴──────────────────────┐
│  Claude Opus 4.6 Agent Teams                                      │
│                                                                    │
│  ┌────────────────────────────────────────────────────────┐       │
│  │  Team Leader (Orchestrator)                             │       │
│  │                                                         │       │
│  │  - Sub-agent 스폰 및 역할 할당                           │       │
│  │  - REVIEW 카드 코드 리뷰 → Approve / Reject             │       │
│  │  - 에이전트 간 충돌/블로커 해결                           │       │
│  │  - 진행 상황 모니터링 및 PM에게 보고                      │       │
│  │  - 필요시 추가 태스크 카드 생성                           │       │
│  └────────────┬───────────────────────────────────────────┘       │
│               │                                                    │
│    ┌──────────┼──────────┬──────────┬──────────┐                  │
│    ▼          ▼          ▼          ▼          ▼                  │
│  ┌────────┐┌────────┐┌────────┐┌────────┐┌────────┐              │
│  │Backend ││Frontend││ Test   ││DevOps  ││ Merge  │              │
│  │ Agent  ││ Agent  ││ Agent  ││ Agent  ││ Agent  │              │
│  │        ││        ││        ││        ││        │              │
│  │API,DB  ││UI,칸반 ││테스트  ││Docker  ││Git병합 │              │
│  │스키마  ││컴포넌트 ││QA검증  ││CI/CD   ││충돌해결│              │
│  └────────┘└────────┘└────────┘└────────┘└────────┘              │
│                                                                    │
│  각 Sub-agent의 작업 사이클:                                        │
│  ① MCP로 get_available_tasks(role) 호출                            │
│  ② claim_task(task_id, agent_id) → 카드가 CLAIMED으로 이동          │
│  ③ 코딩하면서 add_activity(task_id, "진행 상황 메시지") 기록         │
│  ④ 완료 → submit_for_review(task_id, pr_url)                      │
│  ⑤ Team Leader가 리뷰 → Approve/Reject                            │
│  ⑥ Merge Agent가 최종 코드 병합                                    │
└─────────────────────────────────────────────────────────────────┘
```

---

## 3. 워크플로우 상세

### 3.1 PM의 하루

```
아침:
  1. 대시보드(localhost:3001)에서 태스크 카드 5~10개 생성
     - 제목, 설명, 역할(role), 우선순위, 의존성(depends_on) 설정
  2. Team Leader 실행:
     $ claude code
     > "Marblo MCP 서버에 연결해서
        Backend, Frontend, Test, DevOps, Merge 에이전트 스폰하고
        각자 TODO 태스크를 claim해서 처리해"
  3. 에이전트 군단이 자동으로 작업 시작

중간 (선택):
  - 대시보드에서 실시간으로 카드 이동 확인 (SSE)
  - 필요시 카드 추가 생성
  - BLOCKED 카드 발견 시 코멘트로 가이드

저녁:
  - DONE 카드들의 작업 내용, PR 링크 확인
  - 최종 결과물 검증
```

### 3.2 에이전트 작업 사이클

```
Sub-agent (예: Backend Agent):
  │
  ├─ ① get_available_tasks("backend")
  │     → TODO 상태 + role=backend + depends_on 충족된 태스크 목록
  │
  ├─ ② claim_task(task_id, "backend-agent")
  │     → 카드: TODO → CLAIMED
  │     → SELECT FOR UPDATE SKIP LOCKED (동시 claim 방지)
  │
  ├─ ③ 코딩 시작 (IN_PROGRESS)
  │     → add_activity(task_id, "DB 스키마 설계 시작, models.py 생성 중")
  │     → add_activity(task_id, "API 엔드포인트 8개 구현 완료")
  │     → add_activity(task_id, "pytest 15개 전체 통과")
  │     → 대시보드 카드에 실시간으로 작업 내용 표시
  │
  ├─ ④ submit_for_review(task_id, pr_url)
  │     → 카드: IN_PROGRESS → REVIEW
  │     → PR URL이 카드에 첨부됨
  │
  ├─ ⑤ Team Leader 리뷰
  │     → Approve: REVIEW → DONE
  │     → Reject: REVIEW → TODO (피드백 코멘트 포함)
  │
  └─ ⑥ 다음 태스크 자동 탐색 → ①로 반복
```

### 3.3 Team Leader 역할

```
Team Leader:
  │
  ├─ Sub-agent 스폰 및 역할 할당
  │   - MCP 서버 연결 지시
  │   - skills/{role}_agent.md 스킬 파일 로드 지시
  │
  ├─ REVIEW 카드 코드 리뷰
  │   - 코드 품질 체크 (스킬 파일 규칙 준수 여부)
  │   - 테스트 통과 여부 확인
  │   - Approve → DONE / Reject → TODO + 피드백
  │
  ├─ 조율
  │   - depends_on 순서 관리
  │   - 같은 파일 수정하는 태스크 → 순차 할당
  │   - BLOCKED 상태 해결 방안 제시
  │   - 에이전트 간 API 스키마 불일치 조정
  │
  └─ Merge Agent 지시
      - 모든 REVIEW 통과 후 코드 병합 지시
      - 통합 테스트 실행 지시
```

### 3.4 Merge Agent 역할

```
Merge Agent:
  │
  ├─ DONE 상태 카드의 PR 수집
  │
  ├─ 충돌 체크
  │   - 자동 해결 가능 → 병합
  │   - 수동 해결 필요 → Team Leader에게 보고
  │
  ├─ main 브랜치에 순차 병합
  │   - feature branch → main
  │   - 각 PR별 squash merge
  │
  ├─ 통합 테스트 실행
  │   - 전체 테스트 통과 → 완료
  │   - 실패 → 해당 카드를 BLOCKED로 전환
  │
  └─ 병합 결과를 카드 activity에 기록
      - "PR #12 → main 병합 완료, 통합 테스트 통과"
```

---

## 4. 기술 스택

| Layer | Technology | 용도 |
|-------|-----------|------|
| Agent Engine | Claude Opus 4.6 Agent Teams | 멀티 에이전트 병렬 실행, 조율 |
| MCP Server | FastMCP (Python) | Agent Teams ↔ 태스크 DB 연결 |
| Backend API | FastAPI (Python 3.11+) | 대시보드용 REST API + SSE |
| Database | PostgreSQL 16 | 태스크, 활동 로그, 에이전트 정보 |
| Cache/PubSub | Redis 7 | SSE 이벤트 브로드캐스트 |
| ORM | SQLAlchemy 2.0 + Alembic | 타입 안전 쿼리, 마이그레이션 |
| Frontend | Next.js 14 (App Router) + Tailwind CSS | PM 대시보드 (칸반 보드) |
| Realtime | Server-Sent Events (SSE) | 카드 상태 실시간 업데이트 |
| Container | Docker + Docker Compose | 원커맨드 실행 |

---

## 5. 태스크 카드 구조

### 5.1 카드 필드

```
Task {
  id:                  UUID (자동 생성)
  title:               "YouTube 자막 추출 API"
  description:         "YouTube URL을 받아 자막 텍스트를 반환하는 API 엔드포인트"
  status:              TODO | CLAIMED | IN_PROGRESS | REVIEW | BLOCKED | FAILED | DONE
  role:                backend | frontend | test | devops | merge
  priority:            0~10 (높을수록 우선)
  depends_on:          ["task-uuid-001", "task-uuid-002"]
  depends_on_completed: true/false (자동 계산)
  claimed_by:          "backend-agent" (에이전트 ID)
  claimed_at:          2026-02-10T12:00:00Z
  pr_url:              "https://github.com/.../pull/12"
  comment:             "Reject 사유 또는 PM 코멘트"
  created_at:          자동
  updated_at:          자동
}
```

### 5.2 활동 로그 (신규)

```
ActivityLog {
  id:         UUID
  task_id:    FK → Task
  agent_id:   "backend-agent"
  message:    "models.py 생성 완료, Task/Agent 모델 정의"
  created_at: 자동
}
```

대시보드 카드 상세 뷰에서 활동 로그를 시간순으로 표시.
에이전트가 작업하면서 실시간으로 기록.

### 5.3 상태 전환 규칙

```
TODO → CLAIMED          claim_task (에이전트가 선점)
CLAIMED → IN_PROGRESS   자동 (작업 시작 시)
IN_PROGRESS → REVIEW    submit_for_review (PR URL 첨부)
IN_PROGRESS → BLOCKED   blocked (외부 의존성/결정 필요)
IN_PROGRESS → FAILED    failed / timeout
REVIEW → DONE           approve (Team Leader 승인)
REVIEW → TODO           reject (피드백과 함께 재작업)
BLOCKED → IN_PROGRESS   resolve (블로커 해결)
FAILED → TODO           retry (재시도)
```

---

## 6. Claim 메커니즘 (이중 안전장치)

### 6.1 DB 레벨 — 충돌 방지

```sql
UPDATE tasks
SET status = 'CLAIMED',
    claimed_by = $agent_id,
    claimed_at = NOW()
WHERE id = (
    SELECT id FROM tasks
    WHERE status = 'TODO'
      AND role = $role
      AND (depends_on IS NULL OR depends_on_completed = TRUE)
    ORDER BY priority DESC, created_at ASC
    LIMIT 1
    FOR UPDATE SKIP LOCKED  -- 이미 락 걸린 행은 스킵
)
RETURNING *;
```

### 6.2 Team Leader 레벨 — 효율 최적화

```
- 같은 파일을 수정하는 태스크 → 순차 할당
- 의존성 체인 → 선행 완료 확인 후 할당
- 에이전트 부하 분산 → 태스크 수 균등 배분
```

---

## 7. 스킬 파일 구조

```
skills/
├── team_leader.md       # Orchestrator: 스폰, 리뷰, 조율
├── backend_agent.md     # TDD, pytest, Pydantic, FastAPI
├── frontend_agent.md    # React, Tailwind, TypeScript
├── test_agent.md        # 테스트 검증, 합격/불합격 기준
├── devops_agent.md      # Docker, CI/CD, 시크릿 관리
└── merge_agent.md       # Git 병합, 충돌 해결, 통합 테스트
```

에이전트가 MCP의 `get_agent_skill(role)`을 호출하면 해당 스킬 파일 내용을 반환.
스킬 파일은 에이전트의 코딩 규칙, 도구 사용법, 품질 기준을 정의.

---

## 8. 프로젝트 구조

```
TaskForce_AI/
├── .env                              # 환경변수
├── docker-compose.yml                # 원커맨드 실행
├── PROJECT_OVERVIEW.md               # 이 문서
├── PRD.MD                            # 원본 PRD
│
├── backend/
│   ├── Dockerfile
│   ├── entrypoint.sh
│   ├── requirements.txt
│   ├── alembic.ini
│   ├── alembic/
│   │   ├── env.py
│   │   └── versions/
│   │       └── 001_initial_schema.py
│   ├── app/
│   │   ├── __init__.py
│   │   ├── main.py                   # FastAPI REST API + SSE
│   │   ├── models.py                 # SQLAlchemy 모델 (Task, Agent)
│   │   ├── schemas.py                # Pydantic 스키마
│   │   ├── database.py               # Async DB 연결
│   │   ├── config.py                 # 설정 관리
│   │   ├── state_machine.py          # 상태 전환 규칙
│   │   ├── events.py                 # Redis pub/sub 이벤트
│   │   ├── sse.py                    # SSE 엔드포인트
│   │   └── mcp_tools.py             # MCP 도구 (REST 버전)
│   └── mcp_server.py                # FastMCP 서버 (신규)
│
├── frontend/
│   ├── Dockerfile
│   ├── package.json
│   ├── next.config.ts
│   ├── tailwind.config.ts
│   └── src/
│       ├── app/
│       │   ├── layout.tsx
│       │   ├── page.tsx
│       │   ├── globals.css
│       │   └── board/
│       │       └── page.tsx
│       ├── components/
│       │   ├── Header.tsx             # 브랜딩, 통계, SSE 상태
│       │   ├── KanbanBoard.tsx        # 5컬럼 칸반 보드
│       │   ├── KanbanColumn.tsx       # 개별 컬럼
│       │   ├── TaskCard.tsx           # 태스크 카드
│       │   ├── TaskCreateModal.tsx    # 태스크 생성 모달
│       │   └── TaskDetailModal.tsx    # 태스크 상세 + 활동 로그
│       ├── hooks/
│       │   └── useTasks.ts            # 데이터 훅 + SSE
│       └── lib/
│           ├── api.ts                 # API 클라이언트
│           ├── types.ts               # TypeScript 타입
│           └── sse.ts                 # SSE 클라이언트
│
└── skills/
    ├── team_leader.md
    ├── backend_agent.md
    ├── frontend_agent.md
    ├── test_agent.md
    ├── devops_agent.md
    └── merge_agent.md                # 신규
```

---

## 9. 현재 구현 상태

### 완료 (v0.1 MVP)

| 항목 | 상태 | 설명 |
|------|------|------|
| FastAPI REST API | ✅ | CRUD + 상태 전환 엔드포인트 |
| PostgreSQL + SQLAlchemy | ✅ | Task, Agent 모델 + Alembic 마이그레이션 |
| Task State Machine | ✅ | 7개 상태, 9개 전환 규칙 |
| SSE 실시간 업데이트 | ✅ | Redis pub/sub + 프론트엔드 연동 |
| Next.js 칸반 보드 | ✅ | 5컬럼, 역할 필터, CRUD, 다크 테마 |
| Docker + docker-compose | ✅ | PostgreSQL, Redis, Backend, Frontend |
| 스킬 파일 5종 | ✅ | team_leader, backend, frontend, test, devops |

### 구현 완료 (v0.2)

| 항목 | 상태 | 설명 |
|------|------|------|
| FastMCP 서버 | ✅ | Claude Code 에이전트가 연결할 수 있는 실제 MCP 프로토콜 (stdio) |
| 카드 활동 로그 | ✅ | ActivityLog 모델 + API + 대시보드 타임라인 UI |
| Merge Agent 스킬 | ✅ | merge_agent.md + 코드 병합 가이드 |
| Team Leader 자동 리뷰 | ✅ | REVIEW 카드 검증 + 코드 리뷰 프로세스 |

### 향후 확장 (v0.3+)

| 항목 | 우선순위 | 설명 |
|------|----------|------|
| Firebase Authentication | 높음 | 로그인/회원가입 |
| 드래그 앤 드롭 | 높음 | 카드 드래그로 상태 변경 |
| BigQuery 분석 | 중간 | 에이전트 생산성 메트릭, 비용 분석 |
| 에이전트 모니터링 대시보드 | 중간 | 에이전트별 활동 현황, 성공률 |
| 멀티 모델 폴백 | 낮음 (선택) | Claude → Cursor → Codex 자동 전환 |

> **참고**: 멀티 모델 폴백은 Agent Teams 기능 도입 이후 우선순위가 낮아짐.
> Agent Teams가 자체적으로 병렬 에이전트 실행을 지원하므로, 멀티 모델 전환은
> 특정 모델 장애 시 보험용 백업 또는 비용 최적화 목적으로만 의미가 있음.
> 핵심 아키텍처는 **Agent Teams + MCP + Dashboard** 조합으로 충분.

---

## 10. 실행 방법

### 전체 스택 시작

```bash
cd /Users/dongwon-macmini/Documents/programming/TaskForce_AI
docker compose up --build -d
```

### 서비스 URL

| 서비스 | URL |
|--------|-----|
| PM 대시보드 | http://localhost:3001 |
| Backend API | http://localhost:8001 |
| API 문서 | http://localhost:8001/docs |
| PostgreSQL | localhost:5432 |
| Redis | localhost:6379 |

### 환경변수 (.env)

```
POSTGRES_DB=taskforce
POSTGRES_USER=taskforce
POSTGRES_PASSWORD=taskforce123
POSTGRES_PORT=5432
REDIS_PORT=6379
BACKEND_PORT=8001
FRONTEND_PORT=3001
NEXT_PUBLIC_API_URL=http://localhost:8001
```

### Agent Teams 연동 (v0.2 이후)

```bash
# Claude Code 설정에 MCP 서버 추가
# ~/.claude/settings.json
{
  "mcpServers": {
    "taskforce": {
      "command": "python",
      "args": ["backend/mcp_server.py"],
      "env": {
        "TASKFORCE_DATABASE_URL": "postgresql+asyncpg://taskforce:taskforce123@localhost:5432/taskforce"
      }
    }
  }
}

# Agent Teams 실행
$ claude code
> "Marblo MCP 서버에 연결해서
   Backend, Frontend, Test, DevOps, Merge 에이전트 스폰하고
   각자 역할의 TODO 태스크를 claim해서 처리해.
   모든 태스크가 DONE이 될 때까지 계속해."
```
