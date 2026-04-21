---
tags: [강의, v3, 모듈2]
type: lecture
aliases: [MCP 개념]
---

# MCP란 무엇인가

> 모듈 2 · 섹션 2-1 · 약 15분
> 관련: [[1-5_첫_풀사이클_체험]] | [[2-2_마블로_아키텍처]]

---

## 도입 (2분)

모듈 1에서 첫 풀사이클을 돌려봤습니다.
에이전트가 태스크를 claim하고, 코딩하고, REVIEW로 보내는 걸 봤죠?

근데 잠깐. **에이전트가 어떻게 칸반 보드를 읽고 쓸 수 있었을까요?**

Claude Code는 원래 AI 코딩 도구입니다. 칸반 보드를 모릅니다.
그런데 마블로에서는 `claim_task`, `update_task_status` 같은 걸 호출했죠.

이게 가능한 이유가 바로 **MCP** — Model Context Protocol 때문입니다.

이번 섹션에서는 MCP가 뭔지, 왜 필요한지, 마블로에서 어떻게 쓰이는지 알아보겠습니다.

---

## 본문

### MCP란? (4분)

화면: 슬라이드 — MCP 개념도

MCP는 **Model Context Protocol**의 약자입니다.
2024년 Anthropic이 발표한 오픈 프로토콜이고,
한 줄로 요약하면:

> **AI가 외부 도구를 호출하는 표준 인터페이스**

비유로 설명하면, USB 같은 겁니다.
USB가 나오기 전에는 프린터 연결 방식, 키보드 연결 방식, 마우스 연결 방식이 다 달랐죠.
USB가 표준을 만들어서 뭐든 하나의 포트로 연결할 수 있게 됐습니다.

MCP도 마찬가지입니다.
AI가 GitHub을 쓰려면 GitHub 전용 연동 코드를 짜야 했고,
AI가 JIRA를 쓰려면 JIRA 전용 연동 코드를 짜야 했고...
MCP가 이 표준을 만들어서, **MCP 서버 하나만 만들면 어떤 AI든** 쓸 수 있게 했습니다.

```
MCP 이전:
  Claude ──── (커스텀 코드) ──── GitHub
  Claude ──── (커스텀 코드) ──── JIRA
  Claude ──── (커스텀 코드) ──── 데이터베이스

MCP 이후:
  Claude ──── MCP ──── GitHub MCP 서버
  Claude ──── MCP ──── JIRA MCP 서버
  Claude ──── MCP ──── Marblo MCP 서버  ← 이게 우리 것
```

### MCP의 세 가지 구성 요소 (4분)

화면: 슬라이드 — Tool, Prompt, Resource

MCP에는 세 가지 핵심 개념이 있습니다.

**1. Tool (도구)**
AI가 호출할 수 있는 함수입니다.
마블로에서 가장 많이 쓰는 것들:

```typescript
// 예: create_task 도구
server.tool(
  'create_task',
  'Create a new task.',
  {
    title: z.string().describe('Task title'),
    description: z.string().describe('Task description'),
    role: z.string().describe('Agent role'),
    // ...
  },
  async ({ title, description, role }) => {
    // Firestore에 태스크 생성
    const ref = await addDoc(collection(db, 'tasks'), { ... });
    return text(`Task created: ${ref.id}`);
  },
);
```

AI가 "태스크를 만들어야겠다"고 판단하면,
이 `create_task` 도구를 호출합니다.
마치 API를 호출하는 것처럼요.

**2. Prompt (프롬프트 템플릿)**
미리 정의된 대화 시작점입니다.
마블로에는 4개의 프롬프트가 있습니다:

```typescript
// electron/mcp-server/prompts.ts
server.prompt('team_leader', ...);      // Agent Teams 방식으로 프로젝트 진행
server.prompt('agent_worker', ...);     // 태스크 claim하고 코딩
server.prompt('code_reviewer', ...);    // 코드 리뷰 진행
server.prompt('ralph_runner', ...);     // 반복 작업 일괄 처리
```

프롬프트는 "이 역할로 행동해라"라는 지시를 담고 있습니다.
예를 들어 `team_leader` 프롬프트는:
"사용자에게 프로젝트를 물어보고, 태스크로 분해하고, 에이전트를 스폰해라"

**3. Resource (리소스)**
AI에게 컨텍스트를 제공하는 읽기 전용 데이터입니다.
마블로에서는 스킬 파일이 이 역할을 합니다.
`get_agent_skill("backend")` → 백엔드 에이전트의 행동 규칙을 반환.

### v3 MCP: Node.js stdio → Firebase Firestore (3분)

화면: 슬라이드 — v3 MCP 아키텍처

마블로 v3의 MCP 서버는 이렇게 동작합니다:

```
Claude Code CLI
    ↕ (stdio — 표준 입출력)
마블로 MCP 서버 (Node.js)
    ↕ (Firebase SDK)
Firebase Firestore
    ↕ (실시간 동기화)
마블로 Electron 앱 (칸반 보드)
```

**stdio 통신**: Claude Code와 MCP 서버가 표준 입출력(stdin/stdout)으로 통신합니다.
JSON-RPC 형식의 메시지를 주고받아요.

**Firebase 직접 연결**: v1에서는 FastAPI 프록시 서버를 거쳤지만,
v3에서는 MCP 서버가 Firebase에 직접 연결합니다. 중간 서버가 없으니 빠릅니다.

**실시간 동기화**: MCP 서버가 Firestore에 데이터를 쓰면,
Electron 앱의 칸반 보드에 실시간으로 반영됩니다.
Firestore의 실시간 리스너(onSnapshot) 덕분이죠.

화면: MCP 서버 설정 파일 예시

```json
{
  "mcpServers": {
    "marblo": {
      "command": "node",
      "args": ["/path/to/dist-mcp/index.js"],
      "env": {
        "FIREBASE_PROJECT_ID": "my-project",
        "MARBLO_PROJECT": "hello-world",
        "MARBLO_BRIDGE_PORT": "54321"
      }
    }
  }
}
```

이 설정 파일이 Claude Code에 전달되면,
Claude Code가 MCP 서버 프로세스를 자동으로 실행합니다.
그리고 도구를 호출할 때마다 stdio로 요청을 보내고 응답을 받습니다.

---

## 정리 (2분)

화면: 슬라이드 — 요약

MCP 핵심 정리:

| 개념 | 설명 | 마블로에서의 예 |
|------|------|--------------|
| **MCP** | AI가 외부 도구를 호출하는 표준 프로토콜 | Claude Code → 칸반 보드 연동 |
| **Tool** | AI가 호출할 수 있는 함수 | `create_task`, `claim_task`, `spawn_agent` |
| **Prompt** | 미리 정의된 대화 시작점 | `team_leader`, `agent_worker` |
| **Resource** | 읽기 전용 컨텍스트 | `get_agent_skill("backend")` |
| **stdio** | Claude Code ↔ MCP 서버 통신 방식 | JSON-RPC over stdin/stdout |

한 줄 요약:
**MCP 덕분에 Claude Code가 칸반 보드를 읽고 쓸 수 있는 겁니다.**

다음 섹션에서는 마블로 v3의 전체 아키텍처를 코드 레벨에서 뜯어보겠습니다.

---
다음: [[2-2_마블로_아키텍처]]
