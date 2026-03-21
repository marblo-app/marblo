# Marblo (마블로) 설치 가이드

AI 에이전트 팀을 위한 태스크 오케스트레이션 플랫폼 설치 가이드입니다.

---

## 사전 준비

시작하기 전에 아래 3가지가 설치되어 있어야 합니다.

| 도구 | 최소 버전 | 설치 링크 |
|------|----------|----------|
| **Docker Desktop** | 4.0+ | https://www.docker.com/products/docker-desktop |
| **Python** | 3.11+ | https://www.python.org/downloads |
| **Claude Code** | 최신 | `npm install -g @anthropic-ai/claude-code` |

### Docker Desktop 설치

**Mac:**
```bash
# Homebrew로 설치 (권장)
brew install --cask docker

# 또는 공식 사이트에서 다운로드:
# https://www.docker.com/products/docker-desktop
```
설치 후 Applications에서 Docker.app을 실행하세요. 메뉴바에 고래 아이콘이 나타나면 준비 완료입니다.

**Windows:**
1. https://www.docker.com/products/docker-desktop 에서 다운로드
2. 설치 시 **"Use WSL 2 instead of Hyper-V"** 체크
3. 설치 후 재부팅
4. Docker Desktop 실행 → 트레이에 고래 아이콘 확인

**Linux (Ubuntu/Debian):**
```bash
# Docker Engine 설치
curl -fsSL https://get.docker.com | sh
sudo usermod -aG docker $USER
# 로그아웃 후 재로그인
```

### Python 3.11+ 설치

**Mac:**
```bash
brew install python@3.12
python3.12 --version   # 확인
```

**Windows:**
https://www.python.org/downloads 에서 3.12 다운로드 → 설치 시 **"Add to PATH"** 체크

### Claude Code 설치

```bash
npm install -g @anthropic-ai/claude-code
claude --version   # 확인
```

> Node.js가 없는 경우: https://nodejs.org 에서 LTS 버전 설치

### 설치 확인

```bash
docker --version          # Docker version 24.0+
docker compose version    # Docker Compose version v2.0+
python3.12 --version      # Python 3.12+
claude --version          # Claude Code
```

---

## 1단계: 프로젝트 클론 + 환경변수 설정

```bash
git clone <저장소_URL>
cd TaskForce_AI
```

환경변수 파일을 생성합니다:

```bash
cp .env.example .env
```

기본값 그대로 사용해도 됩니다. 포트 충돌이 있으면 `.env`에서 수정하세요:

```env
# 기본 포트 설정
BACKEND_PORT=8001      # 백엔드 API
FRONTEND_PORT=3001     # 칸반 대시보드
POSTGRES_PORT=5432     # PostgreSQL
REDIS_PORT=6379        # Redis
```

> **포트 충돌 확인**: `lsof -i :8001` (Mac/Linux) 또는 `netstat -ano | findstr :8001` (Windows)

---

## 2단계: Docker 실행

Docker Desktop이 실행 중인지 확인한 후:

```bash
docker compose up --build -d
```

첫 실행 시 이미지 빌드에 2~3분 소요됩니다.

### 실행 확인

```bash
docker compose ps
```

4개 컨테이너 모두 `Up` 또는 `healthy` 상태여야 합니다:

```
NAME                     STATUS
marblo-db        Up (healthy)
marblo-redis     Up (healthy)
marblo-backend   Up
marblo-frontend  Up
```

### 서비스 접속 확인

| 서비스 | URL | 확인 방법 |
|--------|-----|----------|
| 칸반 대시보드 | http://localhost:3001 | 브라우저에서 열기 |
| Backend API | http://localhost:8001 | 브라우저에서 열기 |
| API 문서 (Swagger) | http://localhost:8001/docs | 브라우저에서 열기 |

> 모든 URL에서 `3001`, `8001`은 `.env`에서 변경한 포트로 대체하세요.

---

## 3단계: MCP 서버 설정 (Claude Code 연동)

MCP 서버는 Docker가 아닌 **로컬 머신**에서 실행됩니다.

### 3-1. Python 가상환경 생성 + 패키지 설치

Python 3.11 이상이 필요합니다. 버전 확인:

```bash
python3 --version   # 3.11+ 필요
```

> **Python 3.11 미만인 경우**:
> - Mac: `brew install python@3.12`
> - Windows: https://www.python.org/downloads 에서 3.12 설치
> - 설치 후 `python3.12 --version`으로 확인

프로젝트 폴더에서 가상환경을 생성하고 패키지를 설치합니다:

```bash
cd TaskForce_AI

# 가상환경 생성 (Python 3.12 예시, 본인 버전에 맞게)
python3.12 -m venv .venv

# 활성화
source .venv/bin/activate        # Mac/Linux
# .venv\Scripts\activate         # Windows

# 패키지 설치
pip install -r requirements.txt
```

설치 확인:

```bash
python -c "from mcp.server.fastmcp import FastMCP; import httpx; print('OK')"
```

### 3-2. MCP 서버 동작 테스트

```bash
# 가상환경이 활성화된 상태에서
python backend/mcp_server.py
```

정상이면 MCP 서버가 stdin 대기 상태로 진입합니다 (아무 출력 없이 멈춤 = 정상).
`Ctrl+C`로 종료합니다.

### 3-3. 글로벌 MCP 설정 (권장 — 모든 프로젝트에서 사용 가능)

어떤 폴더에서 Claude Code를 실행해도 Marblo MCP를 사용할 수 있도록 글로벌 설정을 합니다.

먼저 본인의 절대 경로를 확인합니다:

```bash
# Mac/Linux
echo "$(pwd)/.venv/bin/python"
echo "$(pwd)/backend/mcp_server.py"

# 출력 예시:
# /Users/yourname/projects/TaskForce_AI/.venv/bin/python
# /Users/yourname/projects/TaskForce_AI/backend/mcp_server.py
```

`~/.claude/.mcp.json` 파일을 생성합니다:

```json
{
  "mcpServers": {
    "marblo": {
      "command": "/여기에_위에서_확인한_python_절대경로",
      "args": ["/여기에_위에서_확인한_mcp_server_절대경로"],
      "env": {
        "MARBLO_API_URL": "http://localhost:8001"
      }
    }
  }
}
```

**예시 (Mac):**
```json
{
  "mcpServers": {
    "marblo": {
      "command": "/Users/yourname/projects/TaskForce_AI/.venv/bin/python",
      "args": ["/Users/yourname/projects/TaskForce_AI/backend/mcp_server.py"],
      "env": {
        "MARBLO_API_URL": "http://localhost:8001"
      }
    }
  }
}
```

**예시 (Windows):**
```json
{
  "mcpServers": {
    "marblo": {
      "command": "C:/Users/yourname/projects/TaskForce_AI/.venv/Scripts/python.exe",
      "args": ["C:/Users/yourname/projects/TaskForce_AI/backend/mcp_server.py"],
      "env": {
        "MARBLO_API_URL": "http://localhost:8001"
      }
    }
  }
}
```

> **포트를 변경한 경우**: `MARBLO_API_URL`의 포트도 `.env`의 `BACKEND_PORT`와 일치시키세요.
>
> **참고**: 프로젝트 루트에도 `.mcp.json`이 포함되어 있어서, TaskForce_AI 폴더에서 실행하면 상대경로로도 동작합니다. 글로벌 설정은 다른 프로젝트 폴더에서 `claude`를 실행할 때 필요합니다.

### 3-4. 연동 확인

Claude Code를 **아무 폴더**에서 실행합니다:

```bash
claude    # TaskForce_AI 폴더가 아니어도 OK
```

Claude Code 안에서 아래처럼 요청해보세요:

```
"marblo MCP로 backend 역할의 사용 가능한 태스크를 조회해줘"
```

정상이면 현재 TODO 상태의 태스크 목록을 반환합니다.

> **전제 조건**: Docker Desktop이 실행 중이고 `docker compose up -d` 상태여야 합니다.
> MCP 서버는 Docker 컨테이너의 Backend API(localhost:8001)에 HTTP로 통신하기 때문입니다.

---

## 사용 방법

### PM (당신)의 워크플로우

1. **브라우저**에서 `http://localhost:3001` 접속 → 칸반 보드
2. **태스크 생성**: + 버튼으로 카드 생성 (제목, 설명, 역할, 우선순위)
3. **Claude Code 실행**: Agent Teams으로 에이전트들에게 작업 지시
4. **실시간 모니터링**: 칸반 보드에서 카드 상태 변화 + 활동 로그 확인
5. **리뷰 & 승인**: REVIEW 상태 카드 확인 후 승인/반려

### Claude Code Agent Teams 실행 예시

```bash
claude "Marblo 칸반 보드에서 backend 역할 태스크를 확인하고 작업해줘.
MCP 도구를 사용해서 태스크를 claim하고, 작업 진행 상황을 activity로 기록해."
```

### 사용 가능한 MCP 도구

| 도구 | 설명 |
|------|------|
| `get_available_tasks` | 역할별 사용 가능한 태스크 조회 |
| `claim_task` | 태스크 할당 받기 |
| `update_task_status` | 태스크 상태 변경 |
| `add_activity` | 작업 진행 로그 기록 |
| `submit_for_review` | 리뷰 제출 |
| `get_task_dependencies` | 의존성 확인 |
| `get_agent_skill` | 에이전트 스킬 파일 조회 |
| `create_task` | 새 태스크 생성 |

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

### Docker 컨테이너가 시작되지 않음

```bash
# 로그 확인
docker compose logs backend
docker compose logs db
```

### "Failed to fetch" 에러 (프론트엔드)

Backend 컨테이너가 실행 중인지 확인:
```bash
docker compose ps
curl http://localhost:8001/api/tasks
```

### 포트 충돌 (Address already in use)

`.env`에서 충돌하는 포트를 변경하세요:
```env
BACKEND_PORT=8002
FRONTEND_PORT=3002
```

변경 후 재빌드:
```bash
docker compose down
docker compose up --build -d
```

### MCP 서버 연결 실패

1. Docker가 실행 중인지 확인: `docker compose ps`
2. Backend API 응답 확인: `curl http://localhost:8001/api/tasks`
3. Python 패키지 확인: `python3 -c "import mcp; import httpx; print('OK')"`
4. `settings.json`의 경로가 절대 경로인지 확인

### Alembic 마이그레이션 에러

DB를 완전 초기화합니다:
```bash
docker compose down -v
docker compose up --build -d
```

### Windows 특이 사항

- Docker Desktop에서 WSL2 백엔드가 활성화되어 있어야 합니다
- 경로 구분자: `settings.json`에서 `/` 사용 (Windows에서도)
- PowerShell에서 `curl` 대신 `Invoke-WebRequest` 사용
- Python 명령어가 `python3` 대신 `python`일 수 있습니다

---

## 아키텍처 요약

```
브라우저 (PM) ──────► Next.js Frontend (Docker :3001)
                              │
                         REST API
                              │
Claude Code ──stdio──► MCP Server (로컬) ──HTTP──► FastAPI Backend (Docker :8001)
                                                        │
                                                  ┌─────┴─────┐
                                                  │           │
                                             PostgreSQL    Redis
                                             (Docker)     (Docker)
```

- **Docker 4개 컨테이너**: DB, Redis, Backend API, Frontend (서버 인프라)
- **MCP Server**: 로컬에서 Claude Code와 stdio로 통신, Backend API를 HTTP로 호출
- Docker가 실행 중이어야 MCP를 통한 에이전트 작업이 가능합니다
