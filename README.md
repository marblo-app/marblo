# Marblo (마블로)

**Drop your tasks on the board. Let your agents roll.**

태스크를 보드에 올리세요. 목표까지 알아서 도달하는 AI 워크스페이스

PM이 칸반 보드에서 태스크를 만들면, Claude Code Agent Teams가 자율적으로 작업하고 실시간으로 진행 상황을 보고합니다. 내장 웹 터미널에서 에이전트를 직접 실행하고 모니터링할 수 있습니다.

---

## 문제우선 데모: Claude Code alone vs Marblo

Marblo를 "에이전트용 칸반 보드"로만 보면 핵심을 놓칩니다. 보드는 표시 화면이고, 실제 차이는 여러 에이전트가 같은 저장소를 동시에 만질 때 생기는 실패 모드를 운영 가능한 흐름으로 바꾸는 데 있습니다.

데모는 기능 나열이 아니라 문제 장면에서 시작합니다.

- **Claude Code alone:** 한 체크아웃에서 여러 작업 흐름을 동시에 돌리면 브랜치, 인덱스, 미커밋 변경, 리뷰 diff가 한곳에 섞입니다.
- **5-agent end-to-end:** 다섯 에이전트가 공유 타입, 의존성, PM 피드백, 머지 충돌, `merged ≠ done` 상태를 만들며 프로젝트가 애매해집니다.
- **Marblo:** worktree isolation, agent dependency, live replanning, REVIEW gate, safe merge, AI Audit Timeline으로 같은 문제를 추적 가능하고 되돌릴 수 있는 장면으로 바꿉니다.

시나리오/스크립트/스토리보드 초안은 [docs/demo/problem-first-demo.md](docs/demo/problem-first-demo.md)에 있습니다.

---

## 어떻게 동작하나요?

```
┌─────────────────────────────────────────────────────────┐
│                    Claude Code (CLI)                     │
│  ┌──────────┐  ┌──────────────┐  ┌───────────────────┐  │
│  │ Slash     │  │ Hook 시스템   │  │ Agent Teams       │  │
│  │ Skills    │  │ (자동 강제)   │  │ (병렬 협업)       │  │
│  └─────┬────┘  └──────┬───────┘  └────────┬──────────┘  │
│        └──────────────┼────────────────────┘             │
│                       │ MCP (stdio)                      │
└───────────────────────┼─────────────────────────────────┘
                        │
          ┌─────────────▼──────────────┐
          │   Marblo MCP Server     │
          │   (13 Tools + 4 Prompts)   │
          └─────────────┬──────────────┘
                        │ HTTP
┌───────────────────────▼─────────────────────────────────┐
│                  Docker Compose                          │
│  ┌──────────┐  ┌──────────┐  ┌─────┐  ┌─────┐          │
│  │ FastAPI   │  │ Next.js   │  │ PG  │  │Redis│          │
│  │ :8001     │  │ :3001     │  │:5432│  │:6379│          │
│  └──────────┘  └──────────┘  └─────┘  └─────┘          │
└─────────────────────────────────────────────────────────┘
         ┌──────────────────────────┐
         │ Terminal Sidecar (Host)  │
         │ node-pty + WebSocket     │
         │ :7681                    │
         └──────────────────────────┘
```

**PM 워크플로우:**
1. 칸반 보드에서 태스크 카드 생성 (제목, 역할, 우선순위)
2. 보드 내 터미널에서 Claude Code Agent Teams 실행
3. 에이전트들이 태스크를 자동으로 선점하고 작업
4. 칸반 보드에서 실시간으로 카드 이동 + 활동 로그 확인 (SSE)
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
| Terminal | node-pty + xterm.js + WebSocket | 내장 웹 터미널 |
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

### 2.5단계: 터미널 사이드카 실행 (선택)

> 보드 내 웹 터미널 사용 시 필요. 호스트 머신에서 실행해야 합니다.

```bash
cd terminal-sidecar
npm install
npx tsx src/index.ts
# → Terminal sidecar listening on http://0.0.0.0:7681
```

| 서비스 | URL |
|--------|-----|
| 칸반 대시보드 | http://localhost:3001/board |
| API 문서 (Swagger) | http://localhost:8001/docs |
| 터미널 사이드카 | http://localhost:7681/health |

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
    "marblo": {
      "command": "/절대경로/TaskForce.AI/.venv/bin/python",
      "args": ["/절대경로/TaskForce.AI/backend/mcp_server.py"],
      "env": {
        "MARBLO_API_URL": "http://localhost:8001"
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

Marblo 슬래시 스킬 + 상시 강제 Hook을 설치합니다:

```bash
./scripts/setup-claude.sh
```

이 스크립트가 설치하는 것:
- **슬래시 스킬 15개** → `~/.claude/skills/` (어디서든 `/tf-plan`, `/tf-start` 등 사용)
- **상시 강제 Hook** → 매 프롬프트마다 "코드 수정 전 티켓 확인" 강제 주입 (모든 프로젝트 자동 적용)
- **CLAUDE.md** → Marblo MCP 워크플로우 규칙

> 기존 설정이 있으면 백업(`.bak`) 후 덮어쓰며, 훅이 이미 있으면 건너뜁니다.

### 6단계: 연동 확인

```bash
claude
# Claude Code에서 입력:
# "marblo MCP로 backend 역할의 사용 가능한 태스크를 조회해줘"
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
| `create_task` | 태스크 생성 |
| `create_tasks_bulk` | 태스크 일괄 생성 (의존성 자동 매핑) |
| `get_available_tasks` | 역할별 TODO 태스크 조회 |
| `get_all_tasks` | 전체 태스크 조회 (상태 무관) |
| `claim_task` | 태스크 선점 (TODO → CLAIMED) |
| `update_task_status` | 태스크 상태 변경 (상태 머신 검증) |
| `add_activity` | 작업 진행 로그 기록 |
| `submit_for_review` | 리뷰 제출 (IN_PROGRESS → REVIEW) |
| `get_task_dependencies` | 의존성 상태 확인 |
| `get_task_activities` | 활동 로그 조회 |
| `check_feedback` | PM 피드백 확인 |
| `acknowledge_feedback` | PM 피드백 읽음 처리 |
| `get_agent_skill` | 에이전트 역할 스킬 파일 로드 |

---

## 태스크 상태 흐름

```
TODO → CLAIMED → IN_PROGRESS → REVIEW → DONE
  ↓                  ↓           ↓
FAILED           BLOCKED    CHANGES_REQUESTED
                                ↓
                            IN_PROGRESS (재작업)
```

| 전환 | 트리거 |
|------|--------|
| TODO → CLAIMED | 에이전트가 `claim_task` 호출 |
| CLAIMED → IN_PROGRESS | `update_task_status(start_work)` |
| IN_PROGRESS → REVIEW | `submit_for_review` (PR URL 첨부) |
| IN_PROGRESS → BLOCKED | 의존성 미충족 시 |
| REVIEW → DONE | PM/Leader가 `approve` |
| REVIEW → CHANGES_REQUESTED | PM/Leader가 `reject` (피드백 포함) |
| CHANGES_REQUESTED → IN_PROGRESS | 에이전트가 재작업 시작 |
| * → FAILED | 작업 실패 / 자동 정리 |

---

## 주요 기능

- **칸반 보드**: 7컬럼 (TODO/CLAIMED/IN_PROGRESS/REVIEW/CHANGES_REQUESTED/DONE/FAILED), 역할별/프로젝트별 필터
- **내장 웹 터미널**: 보드 하단 70:30 분할 레이아웃, xterm.js + node-pty로 실제 호스트 쉘 연결
- **실시간 업데이트**: SSE + Redis Pub/Sub으로 카드 이동, 활동 로그 실시간 반영 + 토스트 알림
- **슬래시 스킬 15개**: `/tf-start`~`/tf-guide`까지 전체 작업 흐름 커버
- **상시 강제 Hook**: 슬래시 스킬 없이 작업해도 매 프롬프트마다 티켓 확인 강제
- **상태 머신**: 7상태 10전이, 잘못된 상태 전환 코드 레벨에서 차단
- **프로젝트 분리**: `project_id`로 여러 프로젝트 태스크 격리
- **환경 컨텍스트**: `context` 필드로 에이전트에게 제약조건 전달 (Python 버전, 라이브러리 등)
- **파일 스코프**: `scope` 필드로 담당 파일 명시 (에이전트 간 충돌 방지)
- **프로젝트 병합**: 이름이 다른 동일 프로젝트 태스크를 하나로 합치기
- **활동 로그**: 에이전트 작업 진행 상황 실시간 기록 + PM 코멘트
- **스킬 파일**: `skills/` 디렉토리에 에이전트별 코딩 규칙 정의
- **원자적 Claim**: `SELECT FOR UPDATE SKIP LOCKED`로 동시 선점 방지

---

## 프로젝트 구조

```
TaskForce.AI/
├── docker-compose.yml          # 4개 컨테이너 (backend, frontend, db, redis)
├── .mcp.json                   # MCP 서버 설정
├── requirements.txt            # MCP 서버 Python 패키지
├── CLAUDE.md                   # 프로젝트별 Claude Code 규칙
├── config/claude/              # Claude Code 설정 템플릿
│   └── skills/tf-*/SKILL.md   # Marblo 슬래시 스킬 15개
├── scripts/setup-claude.sh     # Claude Code 자동 설정 스크립트
│
├── backend/
│   ├── app/
│   │   ├── main.py             # FastAPI 20개 엔드포인트 + SSE
│   │   ├── models.py           # Task, ActivityLog, Agent 모델
│   │   ├── schemas.py          # Pydantic 스키마
│   │   ├── state_machine.py    # 7상태 10전이 상태 머신
│   │   ├── mcp_tools.py        # MCP 비즈니스 로직
│   │   ├── events.py           # Redis pub/sub 이벤트
│   │   └── sse.py              # SSE 스트림 엔드포인트
│   ├── mcp_server.py           # FastMCP 서버 (13 도구, 4 프롬프트)
│   └── alembic/                # DB 마이그레이션 (6개)
│
├── frontend/
│   └── src/
│       ├── app/board/page.tsx  # 칸반 보드 + 터미널 통합 레이아웃
│       ├── components/
│       │   ├── Header.tsx      # 헤더 + 터미널 토글 버튼
│       │   ├── KanbanBoard.tsx # 칸반 보드 컨테이너
│       │   ├── KanbanColumn.tsx
│       │   ├── TaskCard.tsx
│       │   └── terminal/       # 웹 터미널 컴포넌트
│       │       ├── TerminalPanel.tsx
│       │       ├── TerminalToolbar.tsx
│       │       └── ResizableDivider.tsx
│       ├── hooks/
│       │   ├── useTasks.ts     # 태스크 데이터 + SSE 훅
│       │   ├── useTerminal.ts  # xterm.js + WebSocket 훅
│       │   └── useLocalStorage.ts
│       └── lib/
│           ├── api.ts          # REST API 클라이언트
│           ├── sse.ts          # SSE 이벤트 핸들러
│           ├── terminal.ts     # 터미널 상수
│           └── types.ts        # TypeScript 타입
│
├── terminal-sidecar/           # 웹 터미널 백엔드 (호스트에서 실행)
│   └── src/
│       ├── index.ts            # Express + WebSocket 서버 (:7681)
│       └── pty-manager.ts      # node-pty 세션 관리
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
| 터미널 커서만 깜빡임 | `chmod +x terminal-sidecar/node_modules/node-pty/prebuilds/darwin-arm64/spawn-helper` |
| 터미널 연결 안됨 | 사이드카 실행 확인: `curl http://localhost:7681/health` |
| 터미널 포트 충돌 (EADDRINUSE :7681) | `lsof -ti:7681 \| xargs kill` 후 사이드카 재시작 |
| 터미널 내 Claude 버전이 다름/업데이트 안됨 | 아래 "터미널 사이드카 PATH 문제" 참고 |

### 터미널 사이드카 PATH 문제

사이드카 PTY는 **non-login shell**로 실행되어 `~/.zprofile`이 로드되지 않습니다. Homebrew로 설치한 CLI 도구(claude, node 등)의 경로가 `~/.zprofile`에만 있으면 사이드카 터미널에서 찾지 못합니다.

**증상:** 사이드카 터미널에서 `claude --version`이 시스템 버전과 다르거나, `claude update`가 안 먹음

**해결:**
```bash
# ~/.zshrc에 Homebrew PATH 추가 (non-login shell에서도 로드됨)
echo 'eval "$(/opt/homebrew/bin/brew shellenv)"' >> ~/.zshrc

# 사이드카 재시작
lsof -ti:7681 | xargs kill
cd terminal-sidecar && npm run dev
```

**원인:** macOS에서 Homebrew는 기본적으로 `~/.zprofile`에 PATH를 추가합니다. 일반 터미널(login shell)은 `.zprofile`을 읽지만, 사이드카 PTY(non-login shell)는 `.zshrc`만 읽어서 PATH가 누락됩니다.

---

## 라이선스

MIT
