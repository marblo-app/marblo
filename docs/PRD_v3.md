# Marblo v3.0 PRD — 에이전트 팀 워크스페이스

## 한 줄 요약

AI 구독들을 하나의 엔지니어링 팀으로 통합 관리하는 로컬 설치형 데스크톱 워크스페이스.

## 핵심 문제

1. **Rate Limit 공유 문제**: Claude Code 서브에이전트는 1개 구독을 공유 → N명이면 1/N 속도
2. **시각화 부재**: CLI 기반 에이전트 관리는 개발자만 가능, PM/비개발자 접근 불가
3. **세션 휘발성**: Claude Code 팀 세션이 끝나면 태스크 히스토리가 사라짐
4. **도구 전환 피로**: 칸반(Jira) + 코드(VS Code) + 터미널 → 3개 앱 전환 필요

## 대상 사용자

- **Primary**: AI 에이전트를 활용해 코딩하는 개발자 (Claude Code Max/Pro 사용자)
- **Secondary**: 에이전트 작업을 관찰/승인하는 PM, Tech Lead
- **Tertiary**: 멀티모델(Claude+Gemini+GPT) 에이전트 팀을 운영하려는 팀

## 기술 스택

### 클라이언트 (데스크톱 앱)

| 영역 | 기술 | 이유 |
|------|------|------|
| Framework | **Electron** | PTY/fs 접근, 크로스플랫폼, 성숙한 생태계 |
| UI | **React 18 + Tailwind CSS** | V1 프론트엔드 스킬 재활용 |
| 상태관리 | **Zustand** | 가볍고 React 친화적 |
| 코드 에디터 | **Monaco Editor** (`@monaco-editor/react`) | VS Code 동일 엔진, Git diff 내장 |
| 터미널 | **xterm.js** + **node-pty** | Electron 메인 프로세스에서 PTY 직접 관리 |
| 빌드 | **electron-builder** | Mac/Win/Linux 패키징 + 자동 업데이트 |

### 클라우드 (서버)

| 영역 | 기술 | 이유 |
|------|------|------|
| 인증 | **Firebase Auth** | Google/GitHub 소셜 로그인, Electron SDK 지원 |
| 데이터베이스 | **Cloud Firestore** | 실시간 동기화, 오프라인 캐시, 팀 협업 기반 |
| 서버 함수 | **Cloud Functions** (필요 시) | Stripe 결제 Webhook, 이메일 알림 등 |
| 스토리지 | **Cloud Storage** (향후) | 파일 공유, 에이전트 아티팩트 저장 |

### 로컬 서비스

| 영역 | 기술 | 이유 |
|------|------|------|
| MCP 서버 | **TypeScript (Node.js)** | Electron 메인 프로세스 내장, V1 Python MCP에서 이관 |
| 파일 시스템 | **Node.js fs/chokidar** | 프로젝트 파일 트리, 변경 감지 |
| Git | **simple-git** | Git status, diff, commit 히스토리 |

---

## 아키텍처 (V3 최종)

```
┌──────────────────────────────────────────────────────────────────┐
│ Marblo Desktop (Electron)                                         │
│                                                                    │
│ ┌─────────────────────────────────────────────────────────────┐  │
│ │ Renderer Process (React + Tailwind)                          │  │
│ │                                                              │  │
│ │  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐   │  │
│ │  │ 📋 Board │  │ 📝 Code  │  │ 🤖 Agents│  │ 🔀 Flows │   │  │
│ │  │ 칸반보드  │  │ Monaco   │  │ 대시보드  │  │ 노드에디터│   │  │
│ │  └──────────┘  └──────────┘  └──────────┘  └──────────┘   │  │
│ │                                                              │  │
│ │  ┌──────────────────────────────────────────────────────┐   │  │
│ │  │ 📂 File Tree (좌측)  │  xterm.js Terminal ×N (하단)   │   │  │
│ │  └──────────────────────────────────────────────────────┘   │  │
│ │                                                              │  │
│ │  Firestore SDK ────────────────────────────── Firebase Auth  │  │
│ └─────────────────────────────────────────────────────────────┘  │
│                                                                    │
│ ┌─────────────────────────────────────────────────────────────┐  │
│ │ Main Process (Node.js)                                       │  │
│ │                                                              │  │
│ │  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐   │  │
│ │  │ node-pty  │  │ MCP      │  │ fs/      │  │ Agent    │   │  │
│ │  │ ×N tabs   │  │ Server   │  │ chokidar │  │ Profile  │   │  │
│ │  │ (에이전트) │  │ (stdio)  │  │ (파일트리)│  │ Manager  │   │  │
│ │  └──────────┘  └──────────┘  └──────────┘  └──────────┘   │  │
│ └─────────────────────────────────────────────────────────────┘  │
│                                                                    │
│ [Cloud]                                                            │
│  ├─ Firebase Auth (인증)                                           │
│  ├─ Cloud Firestore (태스크, 로그, 에이전트, 프로젝트)                │
│  └─ Cloud Functions (결제 Webhook, 알림 — 필요 시)                  │
└──────────────────────────────────────────────────────────────────┘
```

### V1 → V3 마이그레이션 매핑

| V1 (현재) | V3 (마이그레이션) |
|-----------|-----------------|
| FastAPI REST API 33개 | Firestore SDK 직접 접속 (CRUD) + MCP 서버 (상태머신) |
| PostgreSQL + Alembic | Cloud Firestore (스키마리스) |
| Redis (SSE/Pub-Sub) | Firestore onSnapshot (실시간 리스너) |
| terminal-sidecar (WebSocket) | Electron Main Process node-pty (직접) |
| Next.js (port 3001) | Electron Renderer (React) |
| Docker Compose 4컨테이너 | 로컬 설치 → 바로 실행 (Docker 불필요) |
| Python MCP 서버 (FastMCP) | TypeScript MCP 서버 (Electron 내장) |
| skills/*.md | 그대로 유지 (에이전트 스킬 문서) |

---

## 핵심 기능 (전체 — 12주)

### 1. 칸반 보드 (Board 탭)
V1의 칸반 기능을 Electron + Firestore 기반으로 마이그레이션.

- 태스크 CRUD (생성, 수정, 삭제)
- 7단계 상태 컬럼 (TODO → CLAIMED → IN_PROGRESS → REVIEW → DONE + BLOCKED/FAILED)
- 프로젝트 필터링, 역할 필터링
- 우선순위 정렬
- 드래그 앤 드롭 상태 이동
- Firestore onSnapshot 실시간 동기화
- 의존성(depends_on) 표시 및 자동 해소

### 2. 코드 뷰어 (Code 탭) — 신규
프로젝트 파일을 앱 내에서 바로 탐색/편집.

- **파일 트리** (좌측): fs 기반 디렉토리 탐색, .gitignore 적용
  - Git status 표시 (M/A/D 아이콘)
  - 에이전트가 수정한 파일에 배지 표시
  - chokidar로 실시간 변경 감지
- **Monaco Editor** (메인):
  - 다중 탭 (파일별 탭 열기/닫기)
  - 구문 강조 (TypeScript, Python, Dart 등)
  - Git diff 뷰 (에이전트 변경사항 리뷰)
  - 읽기/편집 모드 전환

### 3. 멀티 에이전트 터미널 — 신규
각 에이전트를 독립 PTY에서 실행.

- **에이전트 프로필 CRUD**:
  - 이름, 모델(Claude/Gemini/GPT/Custom), 역할(backend/frontend/test/devops)
  - CLI 명령어 자동 설정, MCP 서버 자동 연결
  - 스킬 파일 자동 주입
- **멀티 터미널 탭**:
  - 에이전트별 독립 xterm.js 탭
  - 탭 전환으로 각 에이전트 작업 모니터링
  - PM 메시지 stdin 주입 (피드백 전달)
- **에이전트 라이프사이클**: Ready → Active → Idle → Stopped
  - 원클릭 Launch/Stop
  - 에러 감지 + 재시작 옵션

### 4. MCP 서버 (로컬, TypeScript) — 마이그레이션
V1의 Python FastMCP를 TypeScript로 재작성, Electron 메인 프로세스에 내장.

- **유지할 MCP 도구**:
  - `create_tasks_bulk` — 대량 태스크 생성
  - `claim_next_task` — 다음 태스크 자동 선점
  - `update_task_status` — 상태 업데이트 (상태머신 규칙 적용)
  - `add_activity` — 활동 로그 추가
  - `get_available_tasks` — 역할별 가용 태스크
  - `submit_for_review` — 리뷰 제출
  - `get_task_dependencies` — 의존성 확인
  - `get_agent_skill` — 에이전트 스킬 문서
- **변경점**: Firestore를 데이터 소스로 사용 (PostgreSQL 대체)

### 5. 인증 (Firebase Auth) — 신규
- Google 소셜 로그인
- GitHub 소셜 로그인
- 이메일/비밀번호 로그인
- Electron에서 시스템 브라우저 → 콜백 → 토큰 저장

### 6. Agent Flow 노드 에디터 (Flows 탭) — 신규
시각적 노드 기반 파이프라인 빌더. 에이전트/LLM/API를 조합해 자동화 워크플로우 구성.

- **노드 팔레트** (좌측): 드래그 앤 드롭으로 캔버스에 추가
- **7가지 노드 타입**:
  - **Input**: 수동 입력, URL, 파일 업로드, Webhook, 스케줄(cron), 이전 플로우 출력
  - **LLM**: 1회성 프롬프트 실행 (API 호출, 토큰 과금). 모델 자유 선택 (Claude/GPT/Gemini API)
  - **Agent**: 독립 PTY에서 CLI 에이전트 실행. 실제 코딩, 파일 생성, 테스트 가능. 하위 에이전트 스폰 가능
  - **API**: 외부 서비스 호출 (YouTube API, GitHub API, Slack 등)
  - **Human**: 사람 승인 대기 (PM 리뷰, 코드 리뷰 등). 타임아웃 설정 가능
  - **Branch**: 조건 분기 (if/else, switch). 이전 노드 출력 기반 라우팅
  - **Output**: 결과 출력 (파일 저장, Git 커밋+PR, Slack 알림, 다음 플로우 트리거)
- **캔버스** (우측): 노드 간 연결선 드래그, 실행 흐름 시각화
- **3가지 생성 방식**:
  1. GUI에서 직접 노드 배치/연결
  2. 터미널에서 LLM에게 자연어로 요청 → 자동 생성
  3. 혼합 (LLM 초안 → GUI에서 수정)
- **플로우 + 칸반 통합**: Agent 노드 실행 시 칸반에 자동 티켓 생성/연결
- **플로우 저장/재사용**: JSON 템플릿으로 저장, 반복 실행 가능
- **UI 라이브러리**: React Flow (`@xyflow/react`)

### 7. LLM 오케스트레이터 — 신규
자연어 입력을 태스크로 자동 분해하는 지능형 라우터.

- **자연어 → 태스크 분해**: "회원가입 기능 만들어줘" → BE/FE/Test 태스크 자동 생성
- **의존성 DAG 자동 설정**: 분해된 태스크 간 순서/의존성 자동 구성
- **자동 라우팅**: 태스크 태그/역할 기반으로 적합한 에이전트에 자동 할당
- **칸반 일괄 생성**: 분해 결과를 MCP `create_tasks_bulk`로 즉시 보드에 반영
- **오케스트레이터 ≠ 코딩**: 분해/조율만 담당, 실제 코딩은 워커 에이전트가 수행
- **진행 모니터링**: 전체 태스크 진행률 추적, 병목 감지, 리뷰 승인/반려 중개

### 8. 팀 협업 — 신규
여러 사람이 같은 프로젝트에서 각자 에이전트를 운영.

- **프로젝트 초대**: 이메일로 팀원 초대 → 프로젝트 멤버 등록
- **실시간 공유 보드**: Firestore onSnapshot으로 모든 팀원이 같은 칸반을 실시간 공유
- **에이전트 소유자 표시**: 카드에 "👤민수 / 🤖FE-1 (Claude Max)" 식으로 표시
- **역할 기반 권한**:
  - Owner: 전체 관리 (프로젝트 설정, 멤버 관리, 결제)
  - Admin: 태스크 관리, 에이전트 관리, 리뷰 승인
  - Member: 자기 에이전트 관리, 태스크 수행
  - Viewer: 읽기 전용 (보드 관찰, 로그 확인)
- **충돌 방지**:
  - 티켓 단위 scope 격리 (같은 파일 동시 수정 경고)
  - 에이전트별 feature branch 전략
  - 파일 잠금 표시 (Firestore distributed lock)
- **팀 대시보드**: 전체 에이전트 상태, 팀원별 성과, 통합 활동 피드

### 9. 결제 (Stripe) — 신규
- **Stripe Checkout**: 구독 결제 (월간/연간)
- **Cloud Functions Webhook**: 결제 이벤트 처리 (구독 생성/취소/갱신)
- **Firestore 구독 상태**: `users/{uid}/subscription` 서브컬렉션에 플랜/만료일 저장
- **클라이언트 검증**: 앱 시작 시 구독 상태 확인 → 기능 게이팅

### 10. 요금제 게이팅 — 신규
기능별 접근 제어.

| 기능 | Free ($0) | Pro ($19/월) | Team ($49/월) |
|------|-----------|-------------|--------------|
| 프로젝트 | 1개 | 무제한 | 무제한 |
| 태스크 | 30개 | 무제한 | 무제한 |
| 에이전트 | 1개 | 5개 | 무제한 |
| 칸반 + 코드 뷰어 | O | O | O |
| 멀티 모델 | X | O | O |
| 자동 태스크 라우팅 | X | O | O |
| Agent Flow | X | O | O |
| 에이전트 대시보드 | X | O | O |
| LLM 오케스트레이터 | X | X | O |
| 팀원 (사람) | 1명 | 1명 | 10명 |
| 팀 대시보드 + 권한 관리 | X | X | O |

- **BYOK 모델**: Marblo는 오케스트레이션만 과금, LLM 비용은 사용자가 자기 구독으로 부담
- **게이팅 구현**: Zustand store에서 플랜 확인 → UI 잠금/안내 모달

---

## 화면 목록

| 화면 | 경로/뷰 | 핵심 요소 |
|------|---------|----------|
| 로그인 | /login | Google/GitHub 소셜 로그인 버튼, 이메일 로그인 |
| 워크스페이스 | /workspace | 4탭 (Board/Code/Agents/Flows), 파일트리, 터미널 |
| Board 탭 | — | 칸반 컬럼, 태스크 카드, 필터, 생성 모달, 에이전트 소유자 표시 |
| Code 탭 | — | 파일 트리 + Monaco 에디터 (다중 탭), Git diff 뷰 |
| Agents 탭 | — | 에이전트 리스트, 상태/성과/로그, 팀 서머리, 활동 피드 |
| Flows 탭 | — | 노드 팔레트 + 캔버스 (React Flow), 노드 설정 패널, 실행/중지 |
| 태스크 상세 모달 | — | 상태, 활동 로그, 의존성, PM 피드백, 커밋 히스토리 |
| 에이전트 추가 모달 | — | 이름, 모델 선택 (Claude/Gemini/GPT/Custom), 역할, Launch |
| Flow 생성 모달 | — | 자연어 입력 → LLM 분해 → 노드 자동 생성, 또는 빈 캔버스 |
| 팀 관리 | /settings/team | 멤버 초대, 역할 변경, 멤버 제거 |
| 결제/구독 | /settings/billing | 현재 플랜, Stripe Checkout, 결제 히스토리 |
| 설정 | /settings | 계정, 프로젝트 관리, 에이전트 설정, API 키 (BYOK) |

---

## Firestore 데이터 구조

```
firestore/
├── users/
│   └── {uid}/
│       ├── email: string
│       ├── displayName: string
│       ├── photoURL: string
│       └── createdAt: timestamp
│
├── projects/
│   └── {projectId}/
│       ├── name: string
│       ├── ownerId: string (uid)
│       ├── members: string[] (uid 배열)
│       ├── createdAt: timestamp
│       └── updatedAt: timestamp
│
├── tasks/
│   └── {taskId}/
│       ├── projectId: string
│       ├── title: string
│       ├── description: string
│       ├── status: string (TODO|CLAIMED|IN_PROGRESS|REVIEW|BLOCKED|FAILED|DONE)
│       ├── role: string (backend|frontend|test|devops)
│       ├── priority: number (1~5)
│       ├── dependsOn: string[] (taskId 배열)
│       ├── dependsOnCompleted: boolean
│       ├── claimedBy: string (agentId)
│       ├── claimedAt: timestamp | null
│       ├── scope: string[] (파일 경로)
│       ├── comment: string
│       ├── prUrl: string
│       ├── hasPmFeedback: boolean
│       ├── createdAt: timestamp
│       └── updatedAt: timestamp
│
├── activities/
│   └── {activityId}/
│       ├── taskId: string
│       ├── agentId: string
│       ├── message: string
│       └── createdAt: timestamp
│
├── agents/
│   └── {agentId}/
│       ├── projectId: string
│       ├── ownerId: string (uid — 에이전트를 스폰한 사람)
│       ├── name: string
│       ├── model: string (claude|gemini|gpt|custom)
│       ├── role: string
│       ├── status: string (idle|working|error|stopped)
│       ├── currentTaskId: string | null
│       ├── command: string (CLI 명령어)
│       ├── skillFile: string
│       └── createdAt: timestamp
│
├── flows/
│   └── {flowId}/
│       ├── projectId: string
│       ├── name: string
│       ├── description: string
│       ├── nodes: array
│       │   └── { id, type, position, data: { label, config } }
│       ├── edges: array
│       │   └── { id, source, target, sourceHandle, targetHandle }
│       ├── status: string (draft|running|paused|completed|failed)
│       ├── createdBy: string (uid)
│       ├── createdAt: timestamp
│       └── updatedAt: timestamp
│
├── flow_runs/
│   └── {runId}/
│       ├── flowId: string
│       ├── status: string (running|paused|completed|failed)
│       ├── currentNodeId: string
│       ├── nodeResults: map { nodeId → { status, output, error } }
│       ├── startedAt: timestamp
│       └── completedAt: timestamp | null
│
├── subscriptions/
│   └── {uid}/
│       ├── plan: string (free|pro|team)
│       ├── stripeCustomerId: string
│       ├── stripeSubscriptionId: string
│       ├── status: string (active|canceled|past_due)
│       ├── currentPeriodEnd: timestamp
│       └── updatedAt: timestamp
│
└── invitations/
    └── {invitationId}/
        ├── projectId: string
        ├── invitedEmail: string
        ├── invitedBy: string (uid)
        ├── role: string (admin|member|viewer)
        ├── status: string (pending|accepted|declined)
        └── createdAt: timestamp
```

### Firestore 보안 규칙 (핵심)

```javascript
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    // 프로젝트 멤버만 접근 가능
    match /projects/{projectId} {
      allow read, write: if request.auth.uid in resource.data.members
                          || request.auth.uid == resource.data.ownerId;
    }

    // 태스크: 해당 프로젝트 멤버만
    match /tasks/{taskId} {
      allow read, write: if isProjectMember(resource.data.projectId);
    }

    // 활동 로그: 태스크 소속 프로젝트 멤버만
    match /activities/{activityId} {
      allow read, write: if isProjectMember(getTaskProject(resource.data.taskId));
    }
  }
}
```

---

## 태스크 분해 (전체 12주)

### Phase 1: Foundation (의존성 없음) — Week 1~2

```
TASK-001: Electron + React + Tailwind 프로젝트 셸 구성
  role: devops
  priority: 5
  depends_on: []
  scope: [electron/, package.json, tsconfig.json, tailwind.config.js]
  완료 기준: `npm start`로 빈 Electron 앱 실행, React 렌더링 확인
  예상 산출물: Electron 보일러플레이트 + React + Tailwind 통합

TASK-002: Firebase 프로젝트 설정 + Auth 구현
  role: backend
  priority: 5
  depends_on: []
  scope: [src/lib/firebase.ts, src/auth/]
  완료 기준: Google/GitHub 로그인 → Firestore 유저 문서 자동 생성
  예상 산출물: Firebase 설정, Auth 로직, 로그인 화면

TASK-003: Firestore 데이터 모델 + CRUD 서비스 레이어
  role: backend
  priority: 5
  depends_on: []
  scope: [src/services/firestore.ts, src/types/]
  완료 기준: tasks/projects/activities/agents/flows/subscriptions 컬렉션 CRUD 동작
  예상 산출물: Firestore 서비스 함수, TypeScript 타입 정의

TASK-004: 4탭 레이아웃 + 라우팅 셸
  role: frontend
  priority: 5
  depends_on: [TASK-001]
  scope: [src/components/Layout.tsx, src/components/TabBar.tsx]
  완료 기준: Board/Code/Agents/Flows 탭 전환 동작, 파일트리+터미널 영역 배치
  예상 산출물: 메인 레이아웃 컴포넌트, 탭 네비게이션
```

### Phase 2: Core Features — Week 2~4

```
TASK-005: 칸반 보드 UI (Firestore 연동)
  role: frontend
  priority: 5
  depends_on: [TASK-003, TASK-004]
  scope: [src/components/board/]
  완료 기준: 태스크 CRUD, 7컬럼 상태 이동, 실시간 동기화 (onSnapshot), 에이전트 소유자 표시
  예상 산출물: KanbanBoard, KanbanColumn, TaskCard, TaskCreateModal, TaskDetailModal

TASK-006: Monaco 코드 에디터 + 파일 트리
  role: frontend
  priority: 4
  depends_on: [TASK-004]
  scope: [src/components/code/]
  완료 기준: 파일 트리 클릭 → Monaco 탭 열기, 구문 강조, Git diff 뷰
  예상 산출물: FileTree, CodeEditor, EditorTabs 컴포넌트

TASK-007: 멀티 PTY 터미널 (node-pty + xterm.js)
  role: frontend
  priority: 5
  depends_on: [TASK-001]
  scope: [src/components/terminal/, electron/pty-manager.ts]
  완료 기준: 에이전트별 독립 터미널 탭 생성/삭제, stdin/stdout 동작
  예상 산출물: TerminalTabs, TerminalPanel, PTY 매니저 (IPC)

TASK-008: 에이전트 프로필 CRUD + Launch
  role: frontend
  priority: 4
  depends_on: [TASK-003, TASK-007]
  scope: [src/components/agents/, electron/agent-manager.ts]
  완료 기준: 에이전트 추가 모달 → 모델/역할 선택 → Launch → 터미널에서 CLI 실행
  예상 산출물: AgentAddModal, AgentList, AgentManager (메인 프로세스)
```

### Phase 3: MCP + 에이전트 통합 — Week 4~6

```
TASK-009: MCP 서버 (TypeScript, Electron 내장)
  role: backend
  priority: 5
  depends_on: [TASK-003]
  scope: [electron/mcp-server/]
  완료 기준: Claude Code에서 MCP 도구 호출 → Firestore CRUD 동작
  예상 산출물: MCP 도구 13개 (V1 Python → TypeScript 이관), 상태머신 로직

TASK-010: 에이전트 자동 MCP 설정 + 스킬 주입
  role: backend
  priority: 4
  depends_on: [TASK-008, TASK-009]
  scope: [electron/agent-config.ts, skills/]
  완료 기준: 에이전트 Launch 시 MCP 설정 자동 생성 + 스킬 파일 주입
  예상 산출물: 모델별 MCP 설정 생성 로직, 스킬 파일 매핑

TASK-011: 에이전트 대시보드 (Agents 탭)
  role: frontend
  priority: 3
  depends_on: [TASK-008]
  scope: [src/components/agents/AgentDashboard.tsx]
  완료 기준: 에이전트 상태/현재태스크/완료수 실시간 표시, 활동 피드, 팀 서머리
  예상 산출물: AgentDashboard, AgentStatusCard, ActivityFeed, TeamSummary

TASK-012: PM 피드백 stdin 주입
  role: frontend
  priority: 3
  depends_on: [TASK-007]
  scope: [src/components/terminal/FeedbackInput.tsx]
  완료 기준: 터미널 하단 입력창에서 PM 메시지 → pty.write()로 에이전트에 전달
  예상 산출물: FeedbackInput 컴포넌트, stdin 주입 로직

TASK-013: Zustand 상태관리 통합
  role: frontend
  priority: 3
  depends_on: [TASK-005, TASK-006, TASK-007, TASK-008]
  scope: [src/stores/]
  완료 기준: 전역 상태 관리 (프로젝트, 에이전트, 에디터, 구독 플랜)
  예상 산출물: useProjectStore, useAgentStore, useEditorStore, useSubscriptionStore
```

### Phase 4: Agent Flow 엔진 — Week 6~8

```
TASK-014: Flow 캔버스 UI (React Flow 기반)
  role: frontend
  priority: 4
  depends_on: [TASK-004, TASK-003]
  scope: [src/components/flows/]
  완료 기준: 노드 팔레트에서 드래그 → 캔버스 배치, 노드 간 연결선 드래그, 저장/불러오기
  예상 산출물: FlowCanvas, NodePalette, FlowToolbar 컴포넌트 (React Flow @xyflow/react)

TASK-015: 7가지 노드 타입 구현
  role: frontend
  priority: 4
  depends_on: [TASK-014]
  scope: [src/components/flows/nodes/]
  완료 기준: Input/LLM/Agent/API/Human/Branch/Output 노드 각각 설정 패널 + 렌더링
  예상 산출물: InputNode, LlmNode, AgentNode, ApiNode, HumanNode, BranchNode, OutputNode

TASK-016: Flow 실행 엔진 (런타임)
  role: backend
  priority: 4
  depends_on: [TASK-015, TASK-009]
  scope: [electron/flow-engine/]
  완료 기준: 플로우 실행 → 노드 순서대로 처리 → 결과 전달 → 완료/실패 상태 반영
  예상 산출물: FlowRunner, NodeExecutor (노드 타입별), 실행 상태 Firestore 기록

TASK-017: Flow + 칸반 통합
  role: backend
  priority: 3
  depends_on: [TASK-016, TASK-005]
  scope: [electron/flow-engine/kanban-bridge.ts]
  완료 기준: Agent 노드 실행 시 칸반 자동 티켓 생성, 완료 시 다음 노드 트리거
  예상 산출물: 플로우 → 칸반 브릿지 로직
```

### Phase 5: LLM 오케스트레이터 — Week 8~9

```
TASK-018: LLM 태스크 분해 엔진
  role: backend
  priority: 4
  depends_on: [TASK-009]
  scope: [electron/orchestrator/]
  완료 기준: 자연어 입력 → LLM API 호출 → 태스크 목록 + 의존성 DAG JSON 반환
  예상 산출물: TaskDecomposer, PromptTemplates, DAG 생성기

TASK-019: 자동 라우팅 + 의존성 DAG 해소
  role: backend
  priority: 4
  depends_on: [TASK-018]
  scope: [electron/orchestrator/router.ts, electron/orchestrator/dag-resolver.ts]
  완료 기준: 분해된 태스크를 역할/태그 기반으로 에이전트에 자동 할당, 의존성 완료 시 다음 태스크 자동 트리거
  예상 산출물: AutoRouter, DagResolver

TASK-020: 오케스트레이터 UI (터미널 + 보드 연동)
  role: frontend
  priority: 3
  depends_on: [TASK-018, TASK-005]
  scope: [src/components/orchestrator/]
  완료 기준: 오케스트레이터 채팅 UI → 자연어 입력 → 태스크 분해 결과 프리뷰 → 확인 시 칸반에 일괄 생성
  예상 산출물: OrchestratorChat, TaskPreview, DecompositionResult

TASK-021: LLM 자연어 → Flow 자동 생성
  role: backend
  priority: 3
  depends_on: [TASK-018, TASK-014]
  scope: [electron/orchestrator/flow-generator.ts]
  완료 기준: "YouTube 영상 분석 파이프라인 만들어줘" → Flow 노드/엣지 JSON 자동 생성 → Flows 탭에 반영
  예상 산출물: FlowGenerator (LLM 프롬프트 → React Flow JSON 변환)
```

### Phase 6: 팀 협업 — Week 9~10

```
TASK-022: 팀 멤버 초대 + 권한 관리
  role: backend
  priority: 4
  depends_on: [TASK-002, TASK-003]
  scope: [src/services/team.ts, src/components/settings/TeamManagement.tsx]
  완료 기준: 이메일 초대 → 수락/거절 → 프로젝트 멤버 등록, 역할(Owner/Admin/Member/Viewer) 변경
  예상 산출물: TeamService, InvitationService, TeamManagement UI

TASK-023: 실시간 팀 보드 동기화 + 충돌 방지
  role: backend
  priority: 4
  depends_on: [TASK-022, TASK-005]
  scope: [src/services/collaboration.ts]
  완료 기준: 팀원 A가 태스크 수정 → 팀원 B에 즉시 반영, 동시 수정 시 경고, 파일 잠금 표시
  예상 산출물: CollaborationService, FileLock 로직, 충돌 감지

TASK-024: 팀 대시보드 + 활동 피드
  role: frontend
  priority: 3
  depends_on: [TASK-022, TASK-011]
  scope: [src/components/agents/TeamDashboard.tsx]
  완료 기준: 전체 팀원의 에이전트 상태 통합 뷰, 팀원별 성과, 실시간 활동 피드
  예상 산출물: TeamDashboard, MemberCard, UnifiedActivityFeed

TASK-025: Firestore 보안 규칙 + 권한 적용
  role: backend
  priority: 5
  depends_on: [TASK-022]
  scope: [firestore.rules]
  완료 기준: 프로젝트 멤버만 CRUD 가능, 역할별 쓰기 권한 제한, 비멤버 접근 차단
  예상 산출물: Firestore Security Rules, 테스트
```

### Phase 7: 결제 + 요금제 — Week 10~11

```
TASK-026: Stripe 결제 연동
  role: backend
  priority: 4
  depends_on: [TASK-002]
  scope: [functions/stripe-webhook.ts, src/services/billing.ts]
  완료 기준: Stripe Checkout → 구독 생성 → Firestore 구독 상태 저장 → 취소/갱신 처리
  예상 산출물: Cloud Function (Webhook), BillingService, Stripe 설정

TASK-027: 요금제 게이팅 UI + 로직
  role: frontend
  priority: 4
  depends_on: [TASK-026, TASK-013]
  scope: [src/components/settings/BillingPage.tsx, src/stores/subscriptionStore.ts]
  완료 기준: Free/Pro/Team 플랜별 기능 잠금, 업그레이드 안내 모달, 결제 페이지
  예상 산출물: BillingPage, PlanGate 컴포넌트, UpgradeModal, useSubscriptionStore 확장
```

### Phase 8: Polish + 출시 — Week 11~12

```
TASK-028: electron-builder 패키징 (Mac/Win/Linux)
  role: devops
  priority: 4
  depends_on: [TASK-009, TASK-010]
  scope: [electron-builder.yml, scripts/]
  완료 기준: macOS .dmg, Windows .exe 빌드 성공, 설치 → 실행 동작
  예상 산출물: 빌드 스크립트, 설치 파일

TASK-029: Apple 공증 + Windows 코드 서명
  role: devops
  priority: 3
  depends_on: [TASK-028]
  scope: [scripts/notarize.js, electron-builder.yml]
  완료 기준: macOS 앱 공증 완료 (Gatekeeper 통과), Windows 서명 완료
  예상 산출물: 공증/서명 스크립트, CI 파이프라인

TASK-030: 통합 테스트 + E2E + 안정화
  role: test
  priority: 3
  depends_on: [TASK-005, TASK-007, TASK-009, TASK-016, TASK-022]
  scope: [tests/]
  완료 기준: 핵심 플로우 E2E (로그인→프로젝트→태스크→에이전트→Flow→팀 초대→결제)
  예상 산출물: E2E 테스트 스크립트, 버그 픽스, 성능 최적화
```

### 의존성 그래프

```
Phase 1: Foundation (Week 1~2)
──────────────────────────────
TASK-001 (Electron 셸) ──→ TASK-004 (레이아웃) ──→ Phase 2
                       ──→ TASK-007 (터미널)   ──→ Phase 2
TASK-002 (Firebase Auth) ──→ TASK-022 (팀), TASK-026 (결제)
TASK-003 (Firestore CRUD) ──→ TASK-005 (칸반), TASK-008 (에이전트), TASK-009 (MCP), TASK-014 (Flow)

Phase 2: Core Features (Week 2~4)
──────────────────────────────────
TASK-005 (칸반) ──→ TASK-013 (Zustand), TASK-017 (Flow+칸반), TASK-020 (오케스트레이터 UI)
TASK-006 (코드뷰어) ──→ TASK-013
TASK-007 (터미널) ──→ TASK-008 (에이전트), TASK-012 (피드백)
TASK-008 (에이전트) ──→ TASK-010 (자동 설정), TASK-011 (대시보드)

Phase 3: MCP + 통합 (Week 4~6)
───────────────────────────────
TASK-009 (MCP) ──→ TASK-010 (자동 설정), TASK-016 (Flow 엔진), TASK-018 (LLM 분해)
TASK-013 (Zustand) ──→ TASK-027 (요금제 UI)

Phase 4: Agent Flow (Week 6~8)
──────────────────────────────
TASK-014 (Flow 캔버스) ──→ TASK-015 (노드 타입) ──→ TASK-016 (실행 엔진)
TASK-016 ──→ TASK-017 (칸반 통합), TASK-021 (LLM→Flow)

Phase 5: 오케스트레이터 (Week 8~9)
─────────────────────────────────
TASK-018 (LLM 분해) ──→ TASK-019 (자동 라우팅) ──→ TASK-020 (UI)
                    ──→ TASK-021 (Flow 자동 생성)

Phase 6: 팀 협업 (Week 9~10)
────────────────────────────
TASK-022 (초대/권한) ──→ TASK-023 (충돌 방지), TASK-024 (팀 대시보드), TASK-025 (보안 규칙)

Phase 7: 결제 (Week 10~11)
──────────────────────────
TASK-026 (Stripe) ──→ TASK-027 (요금제 UI)

Phase 8: 출시 (Week 11~12)
─────────────────────────
TASK-028 (패키징) ──→ TASK-029 (공증/서명)
TASK-030 (E2E 테스트)
```

---

## 제외 (NOT in scope)

- **커뮤니티 플로우 마켓플레이스** — v4.0
- **에이전트 간 Git 기반 컨텍스트 동기화** — v3.5 이후 개선
- **프로젝트 아카이빙/병합** — 추후
- **모바일 앱** — 추후
- **자동 업데이트 (electron-updater)** — v3.1 패치

---

## 성공 기준

| 지표 | 목표 |
|------|------|
| 설치 → 첫 에이전트 Launch | 5분 이내 |
| 에이전트 5개 동시 실행 | 안정적으로 동작 (크래시 없음) |
| 칸반 실시간 동기화 | Firestore onSnapshot 지연 < 1초 |
| 패키징 | macOS .dmg + Windows .exe 정상 설치/실행 |
| MCP 도구 | V1의 13개 도구 100% 동작 |
| Flow 실행 | 5노드 이상 파이프라인 정상 실행/완료 |
| 팀 협업 | 2명 동시 접속 → 실시간 보드 동기화 |
| 결제 | Free → Pro 업그레이드 플로우 정상 동작 |

---

## 점진 출시 전략

| 시점 | 버전 | 활성 기능 | 가격 |
|------|------|----------|------|
| Week 6 | v3.0 Alpha | 칸반 + 멀티터미널 + 코드뷰어 + MCP | 내부 테스트 |
| Week 9 | v3.0 Beta | + Agent Flow + LLM 오케스트레이터 | Free (얼리 억세스) |
| Week 11 | v3.0 RC | + 팀 협업 + 결제 | Free / Pro $19 |
| Week 12 | v3.0 GA | 전체 기능 + 안정화 | Free / Pro $19 / Team $49 |

---

## 타임라인 요약

```
Week 1~2: Phase 1 — Foundation
  ├─ TASK-001: Electron + React + Tailwind 셸
  ├─ TASK-002: Firebase Auth
  ├─ TASK-003: Firestore 데이터 모델 + CRUD
  └─ TASK-004: 4탭 레이아웃

Week 2~4: Phase 2 — Core Features
  ├─ TASK-005: 칸반 보드 (Firestore 연동)
  ├─ TASK-006: Monaco 코드 에디터 + 파일 트리
  ├─ TASK-007: 멀티 PTY 터미널
  └─ TASK-008: 에이전트 프로필 CRUD + Launch

Week 4~6: Phase 3 — MCP + 에이전트 통합
  ├─ TASK-009: MCP 서버 (TypeScript)
  ├─ TASK-010: 자동 MCP 설정 + 스킬 주입
  ├─ TASK-011: 에이전트 대시보드
  ├─ TASK-012: PM 피드백 stdin 주입
  └─ TASK-013: Zustand 상태관리 통합

Week 6~8: Phase 4 — Agent Flow 엔진
  ├─ TASK-014: Flow 캔버스 UI (React Flow)
  ├─ TASK-015: 7가지 노드 타입 구현
  ├─ TASK-016: Flow 실행 엔진
  └─ TASK-017: Flow + 칸반 통합

Week 8~9: Phase 5 — LLM 오케스트레이터
  ├─ TASK-018: LLM 태스크 분해 엔진
  ├─ TASK-019: 자동 라우팅 + DAG 해소
  ├─ TASK-020: 오케스트레이터 UI
  └─ TASK-021: LLM → Flow 자동 생성

Week 9~10: Phase 6 — 팀 협업
  ├─ TASK-022: 팀 멤버 초대 + 권한 관리
  ├─ TASK-023: 실시간 보드 동기화 + 충돌 방지
  ├─ TASK-024: 팀 대시보드
  └─ TASK-025: Firestore 보안 규칙

Week 10~11: Phase 7 — 결제 + 요금제
  ├─ TASK-026: Stripe 결제 연동
  └─ TASK-027: 요금제 게이팅 UI

Week 11~12: Phase 8 — Polish + 출시
  ├─ TASK-028: electron-builder 패키징
  ├─ TASK-029: Apple 공증 + Windows 서명
  └─ TASK-030: 통합 테스트 + E2E + 안정화
```
