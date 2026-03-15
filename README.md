# TaskForce.AI

AI 에이전트 팀을 위한 태스크 오케스트레이션 플랫폼

PM이 칸반 보드에서 태스크를 만들면, Claude Code Agent Teams가 자율적으로 작업하고 실시간으로 진행 상황을 보고합니다.

---

## 어떻게 동작하나요?

```
브라우저 (PM)
    │  칸반 보드에서 태스크 생성/모니터링
    ▼
Next.js Frontend (:3001)
    │  REST API + SSE (실시간)
    ▼
FastAPI Backend (:8001)  ◄──HTTP──  MCP Server (로컬)  ◄──stdio──  Claude Code
    │                                  │
    ├── PostgreSQL (태스크/로그 저장)    └── 에이전트가 MCP 도구로
    └── Redis (실시간 이벤트)               태스크 조회/선점/상태 업데이트
```

**PM 워크플로우:**
1. 칸반 보드에서 태스크 카드 생성 (제목, 역할, 우선순위)
2. Claude Code에서 Agent Teams 실행
3. 에이전트들이 태스크를 자동으로 선점하고 작업
4. 칸반 보드에서 실시간으로 카드 이동 + 활동 로그 확인
5. REVIEW 카드 확인 후 승인/반려

---

## 기술 스택

| 레이어 | 기술 | 용도 |
|--------|------|------|
| Frontend | Next.js 14 + Tailwind CSS | PM 칸반 대시보드 |
| Backend | FastAPI + SQLAlchemy 2.0 | REST API + SSE |
| Database | PostgreSQL 16 | 태스크, 활동 로그 저장 |
| Cache | Redis 7 | SSE 이벤트 브로드캐스트 |
| MCP Server | FastMCP (Python) | Claude Code 에이전트 연동 |
| Container | Docker Compose | 원커맨드 실행 |

---

## 빠른 시작

### 사전 준비

| 도구 | 설치 |
|------|------|
| Docker Desktop | `brew install --cask docker` (Mac) / [다운로드](https://www.docker.com/products/docker-desktop) |
| Python 3.11+ | `brew install python@3.12` (Mac) / [다운로드](https://www.python.org/downloads) |
| Claude Code | `npm install -g @anthropic-ai/claude-code` |

### 1단계: 프로젝트 설정

```bash
git clone https://github.com/melocream/TaskForce.AI.git
cd TaskForce.AI
cp .env.example .env
```

### 2단계: Docker 실행

```bash
# Docker Desktop 실행 후
docker compose up --build -d

# 확인 — 4개 컨테이너 모두 Up
docker compose ps
```

| 서비스 | URL |
|--------|-----|
| 칸반 대시보드 | http://localhost:3001 |
| API 문서 (Swagger) | http://localhost:8001/docs |

### 3단계: MCP 서버 설치

```bash
# 가상환경 생성 + 패키지 설치
python3.12 -m venv .venv
source .venv/bin/activate        # Mac/Linux
pip install -r requirements.txt

# 확인
python -c "from mcp.server.fastmcp import FastMCP; import httpx; print('OK')"
```

### 4단계: Claude Code 연동 (글로벌 MCP 설정)

절대 경로를 확인합니다:

```bash
echo "$(pwd)/.venv/bin/python"
echo "$(pwd)/backend/mcp_server.py"
```

`~/.claude/.mcp.json` 파일을 생성합니다:

```json
{
  "mcpServers": {
    "taskforce": {
      "command": "/절대경로/TaskForce.AI/.venv/bin/python",
      "args": ["/절대경로/TaskForce.AI/backend/mcp_server.py"],
      "env": {
        "TASKFORCE_API_URL": "http://localhost:8001"
      }
    }
  }
}
```

Agent Teams를 사용하려면 `~/.claude/settings.json`에 추가:

```json
{
  "env": {
    "CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS": "1"
  }
}
```

### 5단계: Claude Code 자동 설정 (권장)

TaskForce 슬래시 스킬 + 상시 강제 Hook을 설치합니다:

```bash
./scripts/setup-claude.sh
```

이 스크립트가 설치하는 것:
- **슬래시 스킬 15개** → `~/.claude/skills/` (어디서든 `/tf-plan`, `/tf-start` 등 사용)
- **상시 강제 Hook** → 매 프롬프트마다 "코드 수정 전 티켓 확인" 강제 주입 (모든 프로젝트 자동 적용)
- **CLAUDE.md** → TaskForce MCP 워크플로우 규칙

> 기존 설정이 있으면 백업(`.bak`) 후 덮어쓰며, 훅이 이미 있으면 건너뜁니다.

### 6단계: 연동 확인

```bash
claude
# Claude Code에서 입력:
# "taskforce MCP로 backend 역할의 사용 가능한 태스크를 조회해줘"
```

---

## 슬래시 스킬 (`/tf-*`)

`./scripts/setup-claude.sh` 실행 후, 아무 프로젝트에서 `claude` 실행 → `/tf` 입력하면 사용 가능합니다.

### 프로젝트 시작

| 스킬 | 설명 |
|------|------|
| `/tf-plan` | PRD 작성 + 태스크 분해 계획 (소크라틱 질문 → 구조화) |
| `/tf-start` | PRD 기반으로 태스크 생성 + 에이전트 스폰 + 작업 시작 |

### 작업 진행

| 스킬 | 설명 |
|------|------|
| `/tf-work` | 태스크 claim → 코딩 + 진행 상황 자동 기록 |
| `/tf-status` | 전체 태스크 현황 대시보드 요약 |
| `/tf-add` | 새 태스크 추가 / 기존 태스크 수정 (우선순위, 설명 등) |

### 중단 / 재개

| 스킬 | 설명 |
|------|------|
| `/tf-hold` | 작업 일시 중단 + 현황 정리 + 다음 행동 제안 |
| `/tf-resume` | 중단된 작업 이어하기 (컨텍스트 자동 복원) |

### 리뷰 / 문제 해결

| 스킬 | 설명 |
|------|------|
| `/tf-review` | PM 코드 리뷰 — 승인/반려 |
| `/tf-feedback` | PM 피드백 확인 + 답변 (양방향 소통) |
| `/tf-fix` | FAILED/BLOCKED 태스크 진단 + 복구 + 태스크 취소 |
| `/tf-handoff` | 에이전트 실패 → 직접 이어받기 |

### 동기화

| 스킬 | 설명 |
|------|------|
| `/tf-sync` | 코드 상태와 티켓 상태 불일치 감지 + 동기화 |

### 프로젝트 완료

| 스킬 | 설명 |
|------|------|
| `/tf-done` | 프로젝트 완료 — 결과 요약 + 아카이브 + 회고 |

### 반복 작업

| 스킬 | 설명 |
|------|------|
| `/tf-ralph` | 같은 작업을 N개 대상에 반복 (티켓 단위 추적) |

### 도움말

| 스킬 | 설명 |
|------|------|
| `/tf-guide` | 전체 슬래시 명령어 가이드 + 상황별 추천 |

---

## MCP 도구 목록

| 도구 | 설명 |
|------|------|
| `get_available_tasks` | 역할별 TODO 태스크 조회 |
| `get_all_tasks` | 전체 태스크 조회 (상태 무관) |
| `claim_task` | 태스크 선점 |
| `update_task_status` | 태스크 상태 변경 |
| `add_activity` | 작업 진행 로그 기록 |
| `submit_for_review` | 리뷰 제출 (PR URL 첨부) |
| `get_task_dependencies` | 의존성 확인 |
| `get_agent_skill` | 에이전트 스킬 파일 조회 |
| `create_task` | 태스크 생성 |
| `create_tasks_bulk` | 태스크 일괄 생성 (한글 지원) |

---

## 태스크 상태 흐름

```
TODO → CLAIMED → IN_PROGRESS → REVIEW → DONE
                  ↕ BLOCKED    ↕ FAILED
                  REVIEW → (reject) → TODO
```

| 전환 | 트리거 |
|------|--------|
| TODO → CLAIMED | 에이전트가 `claim_task` 호출 |
| CLAIMED → IN_PROGRESS | `update_task_status(start_work)` |
| IN_PROGRESS → REVIEW | `submit_for_review` (PR URL 첨부) |
| REVIEW → DONE | PM/Leader가 승인 |
| REVIEW → TODO | PM/Leader가 반려 (피드백 포함) |

---

## 주요 기능

- **칸반 보드**: 5컬럼 (TODO/CLAIMED/IN_PROGRESS/REVIEW/DONE), 역할별/프로젝트별 필터
- **실시간 업데이트**: SSE로 카드 이동, 활동 로그 실시간 반영
- **프로젝트 분리**: `project_id`로 여러 프로젝트 태스크 격리
- **환경 컨텍스트**: `context` 필드로 에이전트에게 제약조건 전달 (Python 버전, 라이브러리 등)
- **파일 스코프**: `scope` 필드로 담당 파일 명시 (에이전트 간 충돌 방지)
- **프로젝트 병합**: 이름이 다른 동일 프로젝트 태스크를 하나로 합치기 (예: `hello-api` → `hello_api`)
- **활동 로그**: 에이전트 작업 진행 상황 실시간 기록 + PM 코멘트
- **스킬 파일**: `skills/` 디렉토리에 에이전트별 코딩 규칙 정의
- **원자적 Claim**: `SELECT FOR UPDATE SKIP LOCKED`로 동시 선점 방지

---

## 프로젝트 구조

```
TaskForce.AI/
├── docker-compose.yml          # 4개 컨테이너 정의
├── .env.example                # 환경변수 템플릿
├── requirements.txt            # MCP 서버 Python 패키지
├── CLAUDE.md                   # 프로젝트별 Claude Code 규칙
├── config/claude/              # Claude Code 설정 템플릿
│   └── skills/tf-*/SKILL.md   # TaskForce 슬래시 스킬 15개
├── scripts/setup-claude.sh     # Claude Code 자동 설정 스크립트
│
├── backend/
│   ├── app/
│   │   ├── main.py             # FastAPI REST API + SSE
│   │   ├── models.py           # Task, ActivityLog, Agent 모델
│   │   ├── schemas.py          # Pydantic 스키마
│   │   ├── state_machine.py    # 상태 전환 규칙
│   │   ├── mcp_tools.py        # 비즈니스 로직
│   │   ├── events.py           # Redis pub/sub
│   │   └── sse.py              # SSE 엔드포인트
│   ├── mcp_server.py           # FastMCP 서버 (Claude Code 연동)
│   └── alembic/                # DB 마이그레이션
│
├── frontend/
│   └── src/
│       ├── components/         # 칸반 보드 UI 컴포넌트
│       ├── hooks/useTasks.ts   # 데이터 + SSE 훅
│       └── lib/                # API 클라이언트, 타입
│
└── skills/                     # 에이전트 스킬 파일 (.md)
    ├── team_leader.md
    ├── backend_agent.md
    ├── frontend_agent.md
    ├── test_agent.md
    ├── devops_agent.md
    └── merge_agent.md
```

---

## 종료 및 재시작

```bash
# 종료 (데이터 유지)
docker compose down

# 재시작
docker compose up -d

# 완전 초기화 (DB 데이터 삭제)
docker compose down -v
docker compose up --build -d
```

---

## 트러블슈팅

| 증상 | 해결 |
|------|------|
| 컨테이너 시작 안됨 | `docker compose logs backend` 로그 확인 |
| "Failed to fetch" | `docker compose ps`로 backend 상태 확인 |
| 포트 충돌 | `.env`에서 `BACKEND_PORT`, `FRONTEND_PORT` 변경 후 `docker compose up --build -d` |
| MCP 연결 실패 | Docker 실행 중인지 + `curl http://localhost:8001/api/tasks` 응답 확인 |
| Alembic 에러 | `docker compose down -v && docker compose up --build -d` (DB 초기화) |

---

## 라이선스

MIT
