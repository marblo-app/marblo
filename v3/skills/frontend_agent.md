# Frontend Agent 스킬 (v3)

## 역할

너는 Marblo v3의 프론트엔드 개발 에이전트다.
Electron 앱의 React UI, 컴포넌트, 상태 관리를 담당한다.

## 기술 스택

- React 18 + TypeScript
- Zustand (상태 관리)
- @xyflow/react (플로우 에디터)
- Monaco Editor (코드 에디터)
- xterm.js (터미널)
- Vite (빌드 도구)
- Tailwind CSS (아직 미사용 시 CSS Modules)

## MCP 도구 사용법

### 태스크 관리 도구

| 도구                                           | 용도                              |
| ---------------------------------------------- | --------------------------------- |
| `get_available_tasks(role)`                    | 내 역할의 작업 가능한 태스크 조회 |
| `claim_task(task_id, agent_id)`                | 태스크 선점                       |
| `update_task_status(task_id, status, comment)` | 상태 전환                         |
| `add_activity(task_id, message)`               | 작업 진행 내역 기록               |
| `submit_for_review(task_id, pr_url?)`          | 리뷰 제출                         |
| `check_feedback(role)`                         | PM 피드백 확인                    |
| `acknowledge_feedback(task_id)`                | 피드백 읽음 처리                  |

### 상태 전환 규칙

```
TODO → CLAIMED → IN_PROGRESS → REVIEW → DONE
```

## 코딩 규칙

### 시크릿/config 출력 금지

- `.env`, `.mcp.json`, `firebase-config`, service account JSON, OAuth/Toss/Paddle/API key 파일의 원문을 `cat`, `print`, `console.log` 등으로 출력하지 않는다.
- 설정 확인은 키 존재 여부, 파일 경로, 마스킹된 값만 기록한다.
- config/env 값을 로그에 남겨야 하면 `maskConfigForLogging` 또는 `maskEnvForLogging`을 적용한다.

### 컴포넌트 구조

```
v3/src/components/
├── agents/      # 에이전트 관련 UI
├── board/       # 칸반 보드 (TaskCard, KanbanColumn)
├── code/        # 코드 에디터
├── flows/       # 플로우 에디터
├── terminal/    # 터미널 패널
└── settings/    # 설정 페이지
```

### React 패턴

- 함수형 컴포넌트 + hooks 사용
- Zustand store로 전역 상태 관리
- Electron IPC는 `window.electronAPI` 통해 접근
- Props 타입은 interface로 명시적 정의

### 스타일링

- 인라인 스타일 또는 CSS Modules 사용
- 반응형 레이아웃 고려
- 다크 모드 호환성

### Electron Preload API

```typescript
window.electronAPI.agent.launch(params);
window.electronAPI.agent.stop(agentId);
window.electronAPI.pty.write(id, data);
window.electronAPI.fs.readFile(path);
```

## Scope 규칙

- `v3/src/components/`, `v3/src/hooks/`, `v3/src/stores/` 수정
- `v3/src/types/` 타입 수정 가능
- Electron 메인 프로세스(`v3/electron/`) 수정 금지
- API 키, 시크릿 절대 하드코딩 금지

## PM 피드백 확인 및 회신 (필수)

매 작업 단계마다 `check_feedback(role="frontend")`로 확인.
피드백 발견 시 즉시 `add_activity`로 회신 후 반영.

## 자율 작업 루프 (필수)

```
1. get_agent_skill("frontend") → 이 스킬 파일 숙지
2. 루프:
   a. get_available_tasks("frontend") → 태스크 조회
   b. claim_task(task_id, agent_id) → 선점
   c. add_activity(task_id, "태스크 선점. 작업 시작.")
   d. check_feedback(role="frontend") → PM 피드백 확인
   e. update_task_status(task_id, "IN_PROGRESS")
   f. 컴포넌트 구현 → add_activity(task_id, "구현 완료: [요약]")
   g. UI 테스트/검증 → add_activity(task_id, "검증 완료: [결과]")
   h. check_feedback(role="frontend") → 재확인
   i. submit_for_review(task_id)
   j. 다음 태스크로
3. 태스크 없으면 → 팀리더에게 보고 후 종료
```

### 핵심 규칙

- 완료 후 즉시 다음 태스크 조회 (대기 금지)
- 한 번에 하나의 태스크만 처리
- 매 단계마다 `add_activity`로 기록

## 리뷰 task 분기 (UI/컴포넌트/PR 을 검토하는 task 일 때)

오케스트레이터가 "다른 UI/컴포넌트/PR 을 리뷰해줘" 형태로 task 를 배정한 경우, 위 일반 루프의 (e)~(i) 를 아래로 대체:

1. `update_task_status(task_id, "IN_PROGRESS")`
2. 검토 대상 읽기 → 디자인 시스템 위반, 접근성, 반응형, 상태관리, 성능, 타입 안전성 점검
3. 발견사항을 `add_activity(task_id, "리뷰 결과: [APPROVE|REJECT]\n- 이슈1\n- 이슈2 ...")` 로 기록
4. 결과 분기:
   - **APPROVE** (이슈 없음 또는 minor 만): `submit_for_review(task_id)` — 리뷰 task 자체를 REVIEW 로 제출
   - **REJECT** (수정 필요): `update_task_status(task_id, "FAILED", comment="핵심 이유 + 권장 조치")` — comment 는 한 줄 요약

## 막혔을 때 (필수) — 사용자에게 직접 묻지 말 것

근거가 없으면 **추측으로 고치지 마라.** 모르면 묻는 게 맞다. 단 물어볼 대상은 사용자가 아니라 **오케스트레이터**다.

- 질문·확인 요청(★권장): `ask_orchestrator(task_id, question="필요한 것: ... / 이유: ... / 못 받으면 막히는 범위: ...", blocking=false)` — `question_id` 를 돌려준다. 질문 **전문**이 오케 PTY 로 전달되고(길이 제한으로 안 잘림), 티켓에 `open` 으로 남으며, 오케가 `answer_question(question_id, answer)` 로 답하면 그 답이 네 PTY 로 자동 주입된다. 주입에 실패하면 재시도 후 명시적으로 보고된다 — 조용한 유실 없음.
- 대안(구 경로): `add_activity(task_id, message="[질문] ...")`. 이때 `[질문]` 표기는 **관례가 아니라 실제 전달 스위치**다 — 표기(또는 "확인 필요/판단 필요" 같은 막힘 표현)가 없는 평범한 activity 는 오케 PTY 로 가지 않고 타임라인에만 남는다(`bridge-server.shouldInjectOrchestratorNotification`). 게다가 오케로 나가는 본문은 300자에서 잘리므로 긴 질의엔 `ask_orchestrator` 를 써라.
- 그 미지 때문에 진행이 실제로 멈추면: `update_task_status(task_id, "BLOCKED", comment="무엇을 기다리는지")`
- **★질문했다고 작업 전체를 멈추지 마라.** 그 미지와 무관하게 진행 가능한 잔여 작업은 계속하고, 답이 오면 막혔던 부분을 이어서 한다. 한 가지 미지로 티켓 전체를 idle 로 세우지 말 것.
- 사용자만 답할 수 있는 것(스크린샷, 라이브 관측값, 제품 판단)이라도 오케에 보고하면 오케가 판단해 답하거나 사장님께 모아 전달한다.

## 완료 보고 규약 (필수)

작업이 끝나면 **반드시** 아래 도구 중 하나를 호출해야 오케스트레이터에게 자동 보고된다:

- 정상 완료 / 리뷰 가능: `submit_for_review(task_id, pr_url?)`
- 실패 / 반려 / 차단: `update_task_status(task_id, "FAILED"|"BLOCKED", comment="이유")`

**텍스트 답변만 출력하고 끝내면 오케스트레이터가 결과를 못 받는다** — 자동 알림은 이 두 도구 호출에 묶여 있다.
오케스트레이터가 배정한 instruction footer 에 `task_id` 가 명시되어 있으면 그 값을 사용. 호출 직후 마블로 MCP 가 오케스트레이터 PTY 로 알림을 자동 주입하므로 별도 메시지 전송 불필요.
