# 마블로비서 탭 설계 메모 - 2026-08-24

티켓: `Xxqyj8TSLA4OFFlS0A0S`

범위: 구현 없음. 현재 코드와 문서 근거로, "마블로봇/마블로비서" 탭을 언제, 어떤 순서로 만들지 정리한다.

## 0. 결론

탭부터 만들지 않는다.

이유는 두 가지다.

1. 진입 게이트가 먼저다. 2026-08-24 기존 분석 문서가 보존해야 할 실측으로 둔 값은 `app first run 577 -> first spawn 18 (3.1%) -> first task completed 2` 이고, 핵심 문제를 `96.9% pre-spawn loss` 로 못박았다(`docs/admin-analytics-metric-audit-2026-08-24.md:9`). 개발자도 첫 스폰까지 거의 못 온다. 비개발자는 더 못 온다.
2. "비서"의 핵심 재료는 이미 일부 있다. 새 탭은 빈 방을 꾸미는 일이 될 위험이 크다. 먼저 첫 실행/CLI/로그인/프로젝트 종류/위키/채널 가이드가 하나의 길로 이어져야 한다.

권고 순서:

1. 첫 실행 -> 첫 스폰 게이트를 줄인다.
2. assistant project kind를 진짜 기본 길로 만든다.
3. 비개발 작업의 완료 판정 원장을 먼저 세운다.
4. 역할 enum과 스폰/보드/라우팅 범위를 확장한다.
5. 그 다음 마블로비서 탭을 얹는다.

## 1. 지금 있는 것 / 진짜 없는 것

### 1.1 이미 있는 것

**assistant 프로젝트 종류**

- `ProjectKind`는 이미 `dev | assistant`다. `PROJECT_KINDS = ["dev", "assistant"]`, 기본값은 `dev`다(`v3/src/lib/projectKind.ts:1-41`).
- assistant 프로젝트의 기본 우측 탭은 `code`다. 이유는 "위키/문서; 대화는 좌측 오케 열"이라고 주석에 적혀 있다(`v3/src/lib/projectKind.ts:50-57`).
- assistant 프로젝트 생성 시 `MEMORY.md` 초안을 시드하는 설계가 있다. `ASSISTANT_MEMORY_FILENAME = "MEMORY.md"`, `ensureAssistantMemoryFile()`은 없으면 만들고 있으면 덮지 않는다(`v3/src/lib/projectKind.ts:16-35`, `v3/src/lib/projectKind.ts:97-133`).
- 헤더 번역도 이미 있다. 한국어는 `비서`, 영어는 `Assistant`, 힌트는 "대화·위키·커넥터 중심 비서 워크스페이스"다(`v3/src/locales/ko/header.ts:14-20`, `v3/src/locales/en/header.ts:14-20`).

**위키**

- 공유 위키 루트는 `docs/wiki` 하나다. README가 "공유 위키는 이 저장소의 `docs/wiki` 하나"라고 못박고, `wiki_query({ root_path: "<MARBLO_CLONE>/docs/wiki" })` 규약을 제시한다(`docs/wiki/README.md:11`, `docs/wiki/README.md:55-63`).
- 위키 도구는 MCP에 이미 있다. `wiki_ingest`, `wiki_query`, `wiki_lint`가 `tools.ts`에 등록되어 있다(`v3/electron/mcp-server/tools.ts:8313-8416`).
- 위키 스킬도 있다. `.claude/skills/wiki-note/SKILL.md`, `.claude/skills/wiki-ingest/SKILL.md`, `.claude/skills/wiki-init/SKILL.md`가 존재하고, `wiki-ingest`는 `root_path`를 항상 `docs/wiki`로 쓰라고 한다(`.claude/skills/wiki-ingest/SKILL.md:17-29`).

**Slack / Telegram 채널 배선**

- 렌더러 패널이 있다. `SlackChannelPanel()`과 `TelegramChannelPanel()`이 각각 `window.electronAPI`의 `slackChannel`, `telegramChannel` API를 사용한다(`v3/src/components/harness/SlackChannelPanel.tsx:85-118`, `v3/src/components/harness/TelegramChannelPanel.tsx:52-86`).
- preload API가 있다. `telegramChannel:get/list/set/status/remove`, `slackChannel:list/set/status/remove/probe`가 노출된다. Slack은 `get`이 없고 "시크릿 원문은 렌더러로 안 내려온다"는 주석이 있다(`v3/electron/preload.ts:1210-1245`).
- main IPC도 있다. Telegram은 `telegramChannel:get/list/set/status/remove`, Slack은 `slackChannel:list/set/status/remove/probe` 핸들러가 있다(`v3/electron/main.ts:7906-7985`).
- 패널 내부의 기본 연결 가이드도 이미 있다. Telegram은 4단계 가이드와 chatId 안내를 렌더한다(`v3/src/components/harness/TelegramChannelPanel.tsx:342-384`). Slack은 7단계 앱 설정 가이드와 channel ID 안내를 렌더한다(`v3/src/components/harness/SlackChannelPanel.tsx:541-578`).

따라서 "채널 배선이 없다"는 말은 틀리다. 없는 것은 비서 탭 관점의 통합 가이드다. 지금 가이드는 하네스 연결 패널 안의 setup guide이고, "비개발자가 위키/채널/오케비서/서브에이전트를 어떤 순서로 쓰는가"를 안내하는 제품 표면은 아니다.

**역할별 스폰**

- `dispatch_task(role=...)`는 이미 역할을 받아 물리 에이전트/보드 태스크를 만들거나 재사용한다(`v3/electron/mcp-server/tools.ts:5516-6068`).
- `dispatch_task`는 성공 시 agent doc에 `role: result.agentRole || role`를 저장하고, 보드 task도 해당 agent에 바인딩한다(`v3/electron/mcp-server/tools.ts:5918-6033`).

**비기너/assistant 기본 탭**

- 비기너 기본 탭은 항상 `chat`이다(`v3/src/lib/beginnerTabs.ts:51-72`).
- `defaultBeginnerTabForProjectKind()` 주석은 "assistant도 채팅-퍼스트(슬랙식); 위키/커넥터는 code·harness 큐레이트"라고 적고 실제로 `chat`을 반환한다(`v3/src/lib/beginnerTabs.ts:122-130`).

### 1.2 진짜 없는 것

**비서 탭 자체**

- `beginnerTabs.ts`에는 assistant project kind 언급이 있지만, 새 `assistant`/`marbloBot` 탭 id는 없다. 현재는 `chat + curated expert tabs` 구조다(`v3/src/lib/beginnerTabs.ts:51-88`).

**비개발 역할**

- MCP task role enum은 4개다. `TASK_ROLE_VALUES = ["backend", "frontend", "test", "devops"]`(`v3/electron/mcp-server/tools.ts:293-303`).
- renderer `Task.role` 타입도 4개다. `export type AgentRole = "backend" | "frontend" | "test" | "devops"`(`v3/src/types/task.ts:1-24`).
- orchestrator decomposer도 4개만 유효 역할로 보고, 다른 role은 `backend`로 폴백한다(`v3/electron/orchestrator/task-decomposer.ts:59-69`).
- `v3/skills`에도 `backend_agent.md`, `frontend_agent.md`, `test_agent.md`, `devops_agent.md`, `orchestrator_agent.md`만 있고, marketer/writer/researcher는 없다.

**비개발 완료 판정**

- 개발 완료는 PR/merge 근거가 있다. `submit_for_review`는 PR URL을 찾아 `REVIEW`로 보낸다(`v3/electron/mcp-server/tools.ts:4496-4618`). `merge_and_close`는 GitHub PR이 실제 merged인지 확인한 뒤 `DONE`으로 닫는다(`v3/electron/mcp-server/tools.ts:10035-10205`).
- merge history가 있으면 renderer도 `REVIEW -> DONE`만 자동 허용한다. 주석은 "merge_history row is hard evidence that the PR landed"라고 한다(`v3/src/services/mergeHistoryKgForwarder.ts:147-158`).
- 자기보고 close를 거부하는 규율은 이미 있다. 다만 워크체인 항목 한정이고, 근거가 "연결 티켓의 보드 상태" 하나뿐이다. `work-chain-core.ts`는 티켓이 연결된 항목의 `self_reported` 종료를 거부하고, 저장된 `self_reported` close를 normalize하며, `deriveItemState()`에서 보드 근거와 자기보고 근거를 구분하고, reason 없는 자기보고도 거부한다(`v3/electron/mcp-server/work-chain-core.ts:37`, `v3/electron/mcp-server/work-chain-core.ts:325-333`, `v3/electron/mcp-server/work-chain-core.ts:440`, `v3/electron/mcp-server/work-chain-core.ts:607-633`). `tools.ts`의 work-chain update 설명도 `close=self_reported`는 티켓/mission_label 연결 항목에서 거부된다고 말한다(`v3/electron/mcp-server/tools.ts:6744`). 비개발 작업에는 아직 그 보드 상태에 해당하는 근거가 없다.

**비서 사용법의 한 장**

- 연결 패널별 setup guide는 있지만, "개인/회사/프로젝트 지식을 어디에 놓고, Slack/Telegram을 어떻게 묶고, 오케비서에게 어떤 형식으로 요청하고, 역할별 서브에이전트 결과를 어디에서 승인하는가"를 묶은 assistant guide는 없다.

## 2. 비개발 작업 완료 판정

가장 어려운 문제다. 개발은 `PR -> REVIEW -> merge 확인 -> DONE`이라는 외부 근거가 있다. 비개발 작업을 같은 보드에 올리려면, 없는 원칙을 새로 발명하는 것이 아니라 이미 있는 자기보고 거부 규율에 비개발용 근거를 물려야 한다.

제안: 비개발 작업은 `Artifact Contract` 없이는 생성/디스패치하지 않는다.

최소 필드:

- `artifact.kind`: `marketing_draft | research_summary | wiki_note | plan | outreach_copy | report`
- `artifact.paths`: 산출물이 놓일 경로. repo 내부라면 `docs/...`, `docs/wiki/...`, `v3/docs/...`. 외부 문서라면 Drive/Notion 문서 id와 URL.
- `artifact.acceptance`: 자동 확인 가능한 조건. 예: 파일 존재, frontmatter 존재, source/citation 개수, wiki lint 0, 금지어/시크릿 스캔 0.
- `artifact.approver`: 사람 또는 별도 reviewer agent. creator와 같으면 안 된다.
- `artifact.approval_required`: `external_facing`, `spend_money`, `legal/medical/finance`, `brand_voice`는 true.

상태 판정:

- `REVIEW`: 산출물 경로가 실제 존재하고, acceptance 자동 검사가 통과했으며, `add_activity`에 경로/검증 로그가 남았다.
- `DONE`: `approval_required=false`이면 reviewer agent가 별도 검토 activity를 남긴 뒤 닫는다. `approval_required=true`이면 사람 승인 또는 오케가 owner 승인을 받아야 닫는다.
- `BLOCKED`: artifact path가 없거나, acceptance를 자동으로 확인할 수 없거나, 승인자가 없으면 닫지 않는다.

예시:

- 마케팅 초안: `docs/marketing/outreach/<date>-<campaign>.md` + tone checklist + reviewer approval. 산출물 존재만으로 DONE 금지. 외부 발송물이라 사람 승인이 DONE 근거다.
- 리서치 요약: `docs/wiki/30-investigations/<topic>.md` + sources section + `wiki_lint` 0 + reviewer approval. 사람 승인 없이도 내부 참고용이면 DONE 가능하지만, 근거 없는 문장은 reviewer가 반려할 수 있어야 한다.
- 위키 노트: `docs/wiki/...` + `/wiki-ingest` + `wiki_lint` 0. 단순 정리 작업은 이것만으로 REVIEW까지 가능하다. "정확하다"는 품질은 별도 리뷰가 필요하다.
- Slack/Telegram 연결 가이드 작성: `v3/docs/...` 또는 `docs/wiki/40-methodology/...` 파일 + 링크/스크린샷 없이 재현 가능한 절차 + reviewer approval.

왜 게임 가능하지 않은가:

- 에이전트가 "완료했다"고 말하는 것만으로는 DONE이 되지 않는다.
- 산출물은 경로/문서 id로 남고, 재검증할 수 있다.
- 자동 검사는 파일 존재/링크/위키 lint/시크릿 스캔처럼 에이전트 감상과 무관하다.
- 품질 판단은 creator와 다른 주체가 해야 한다. 같은 agent가 만들고 승인하면 self-report와 같다.
- 외부 발송/브랜드/비용/법무성 작업은 사람 승인 없이는 DONE 불가다. 이건 병목이 아니라 책임 경계다.

즉, 비개발 보드의 완료 근거는 `산출물 경로 + 자동 검증 + 독립 승인`의 조합이어야 한다. `wiki note 착지`는 좋은 근거지만 품질 승인의 대체물은 아니다.

확장 지점 판단: `rejectSelfReportReason()`은 "연결 근거가 있으면 self_reported 거부" 규칙의 현재 초크포인트라 방향은 맞다. 다만 지금은 `taskIds/missionLabel`만 보므로, Artifact Contract를 붙이려면 `artifactIds`나 `artifactEvidence` 같은 새 근거 축을 `deriveItemState()`와 같은 판정 경로에 먼저 넣어야 한다.

## 3. 역할 확장의 번지는 범위

역할 추가는 `TASK_ROLE_VALUES` 한 줄이 아니다. 사장님 결정은 "마케터·기획자·디자이너를 미리 만들어둔다"가 아니라, 사용자가 오케와 정의해 추가하는 역할 레지스트리다. 따라서 고정 enum을 넓히는 것이 최종형이 아니라, 사용자 정의 role registry를 원장으로 두고 MCP/보드/스폰/라우팅이 그 레지스트리를 검증해 쓰는 구조가 최종형이다.

### 3.1 MCP 서버

- role domain: `TASK_ROLE_VALUES`, `isTaskRole()`(`v3/electron/mcp-server/tools.ts:293-303`).
- `get_available_tasks(role)`: Firestore `where("role", "==", role)`로 TODO를 찾는다(`v3/electron/mcp-server/tools.ts:3508-3595`).
- `create_task`: role 설명과 입력 검증이 4개 역할에 묶여 있다. invalid role은 생성 거부된다(`v3/electron/mcp-server/tools.ts:3613-3693`).
- `create_tasks_bulk`: 설명/검증/실패 메시지가 4개 역할에 묶여 있다(`v3/electron/mcp-server/tools.ts:3774-3979`).
- `dispatch_task`: role 설명이 4개 역할로 되어 있고, bridge로 `role`을 넘긴다(`v3/electron/mcp-server/tools.ts:5516-6068`).
- `get_agent_skill`: available list는 `backend, frontend, test, devops, merge, team_leader, flutter`이다. marketer/writer/researcher 스킬 파일을 만들고 이 경로에서 읽히게 해야 한다(`v3/electron/mcp-server/tools.ts:4660-4684`).

### 3.2 오케 분해 / 온램프

- `task-decomposer.ts`의 `VALID_ROLES`가 4개이고 invalid role은 `backend`로 폴백한다(`v3/electron/orchestrator/task-decomposer.ts:59-69`). 비개발 role을 추가하지 않으면 LLM이 `researcher`를 내도 backend 티켓이 된다.
- `onrampDecompose.ts`는 "실제 보드의 Task.role은 backend|frontend|test|devops 넷뿐"이라는 주석 아래 `AgentRole`만 쓴다(`v3/src/lib/onrampDecompose.ts:41-46`). 온램프 룰과 번역도 확장 대상이다.

### 3.3 렌더러 타입 / 보드

- `AgentRole` 타입이 4개다(`v3/src/types/task.ts:1-24`).
- Kanban role filter는 `const ROLES: AgentRole[] = ["backend", "frontend", "test", "devops"]`를 직접 쓴다(`v3/src/components/board/KanbanBoard.tsx:41`, `v3/src/components/board/KanbanBoard.tsx:418-429`).
- Task create modal도 같은 4개 배열을 직접 쓴다(`v3/src/components/board/TaskCreateModal.tsx:10-37`, `v3/src/components/board/TaskCreateModal.tsx:115-124`).
- Task card/detail/preview role 색상도 여러 벌로 흩어져 있다. 기존 감사 문서도 `ROLE_COLORS` 4벌 중복을 지적했다(`v3/docs/ux-beginner-discipline-audit-2026-08-22.md:3` 절, 실제 중복: `v3/src/components/board/TaskCard.tsx:67`, `v3/src/components/board/TaskDetailModal.tsx:56`, `v3/src/components/orchestrator/TaskPreview.tsx:4`, `v3/src/components/orchestrator/DecompositionResult.tsx:3`).
- Work history filter도 4개 역할 배열을 직접 쓴다(`v3/src/components/work-history/WorkHistoryFilterBar.tsx:22`).

### 3.4 에이전트 탭

- 수동 에이전트 추가 모달에는 `Backend, Frontend, Fullstack, DevOps, QA, Data, Design, Other`가 있다(`v3/src/components/agents/AgentAddModal.tsx:82-96`). 이것은 보드 task role enum보다 넓다.
- 즉 이미 "agent role label"과 "claimable task role"이 갈라져 있다. 비개발 role 확장 때 이 둘을 하나로 합칠지, 의도적으로 분리할지 결정해야 한다.

권고: `TaskRole`과 `AgentPersona`를 분리하되, 둘 다 사용자 정의 role registry의 항목을 참조하게 한다. `marketer`, `writer`, `researcher` 같은 기본 seed는 둘 수 있지만, 사용자가 "IR writer", "B2B marketer", "lecture designer"를 추가할 수 있어야 한다. 보드에서 claimable이면 registry 항목에 `claimable=true`와 skill/prompt/evidence contract를 붙이고, 단순 표시/프롬프트 성격이면 persona-only로 둔다.

### 3.5 모델 라우팅 / KG

- agent reuse scoring은 `roleMatchIndex(agent, role)`이 hard gate다. agent.role과 task.role이 같아야 한다(`v3/electron/dispatch-scoring.ts:114-152`, `v3/electron/dispatch-scoring.ts:936-969`).
- routing graph context에는 `role`, `taskType`, `complexity`, `tags`가 들어간다(`v3/electron/routing-graph.ts:239-276`).
- graph updater도 dispatchMeta에서 `role/tags/taskType/complexity/model`을 복구해 outcome을 접는다(`v3/electron/graph-updater.ts:116-223`).
- model autoselect의 rotation key도 role을 포함한다(`v3/electron/model-autoselect.ts:777-789`).

따라서 role을 늘리면 초기에는 새 role의 KG 셀이 cold start가 된다. 이건 나쁜 일이 아니라 정상이다. 다만 기존 backend/front/test/devops 성공률과 섞으면 안 된다.

### 3.6 로케일

- 보드와 create modal의 role 표시가 현재 raw string인 곳이 많다(`v3/src/components/board/KanbanBoard.tsx:429`, `v3/src/components/board/TaskCreateModal.tsx:119-122`).
- 온램프 데모 role label은 i18n 키가 4개다(`v3/src/locales/ko/onboarding.ts`, `v3/src/locales/en/onboarding.ts`의 `onramp.decompose.role.*`).
- 신규 role은 UI raw string으로 끝내지 말고 role registry에서 label/icon/color/i18n key를 함께 제공해야 한다.

## 4. 순서 제안

오케 의견에 동의한다. 탭을 먼저 만들지 않는다.

권장 PR 순서:

1. **PR 1: 첫 스폰 게이트 카피/진입 개선**

   - 목적: 577 -> 18 병목을 줄인다.
   - 범위: StartHere/CliSetup/assistant project kind 안내. Electron/Playwright 검증 금지. vitest/정적 검사만.

2. **PR 2: 비개발 완료 판정 스키마 문서 + 보드 copy**

   - 목적: self-report로 DONE 되는 길을 막는다.
   - 범위: `Artifact Contract` 문서와 UI copy/validation 설계. 구현은 좁게.

3. **PR 3: role registry 도입**

   - 목적: hardcoded role 배열/색상/i18n 분산 제거와 사용자 정의 역할 원장 마련.
   - 범위: renderer 순수 registry부터. 기본 seed는 둘 수 있지만, 최종형은 사용자가 오케와 정의해 추가하는 registry다. `AgentRole` 확장은 아직 하지 않아도 된다.

4. **PR 4: claimable task role 확장**

   - 목적: registry에서 `claimable=true`인 사용자 정의 role을 보드와 MCP가 알게 한다.
   - 범위: `TASK_ROLE_VALUES` 대체/호환층, `AgentRole` 읽기 경로, decomposer, board filters, create modal, skill/prompt lookup, get_agent_skill, tests.

5. **PR 5: assistant guide surface**

   - 목적: 기존 wiki/channel/assistant kind를 한 흐름으로 안내한다.
   - 범위: 아직 탭이 아니라 `Start here`/`Guide`/`Harness` 재배치 또는 assistant project 전용 guide.

6. **PR 6: 마블로비서 탭**
   - 목적: 검증된 흐름을 한 화면으로 묶는다.
   - 범위: 대화, 위키, 커넥터 상태, 역할 요청, 산출물/승인 큐. 이때는 이미 completion contract와 role 확장이 있어야 한다.

## 5. 독립 PR 단위

한 번에 다 바꾸지 않는다.

| PR  | 제목                             | 포함                                                                 | 제외                    |
| --- | -------------------------------- | -------------------------------------------------------------------- | ----------------------- |
| A   | Assistant onboarding copy/gate   | first-spawn cliff copy, assistant project kind 안내, no-GUI tests    | role enum 변경          |
| B   | Non-dev completion contract      | 문서 + 타입 설계 + acceptance wording                                | 실제 DONE 로직 대개편   |
| C   | Role registry renderer           | label/color/icon/i18n registry, board/preview 중복 제거              | 신규 role 활성화        |
| D   | MCP task role expansion          | `TASK_ROLE_VALUES`, `AgentRole`, decomposer, skills, get_agent_skill | assistant tab UI        |
| E   | Wiki/channel guide consolidation | wiki + Telegram/Slack + Drive/Notion guide를 assistant 흐름으로 묶기 | 새 채널 배선            |
| F   | Assistant work artifacts         | artifact path/review evidence 표시                                   | 외부 발송 자동화        |
| G   | MarbloBot tab MVP                | 위 재료를 탭으로 조립                                                | role/완료판정 동시 변경 |

## 6. 탭 MVP가 갖춰야 할 것

탭을 만들 시점의 첫 화면은 마케팅 페이지가 아니라 실제 작업 표면이어야 한다.

- 좌측: 오케비서 대화.
- 중앙: "요청 -> 산출물 -> 승인" 큐. DONE은 자기보고가 아니라 evidence state.
- 우측: 위키/채널 상태. `docs/wiki`, Drive/Notion wiki, Telegram/Slack 연결 상태를 보여주되, 시크릿은 절대 렌더러로 노출하지 않는다.
- 하단 또는 보조 패널: 역할별 서브에이전트 선택. 단, role registry와 claimable role이 분리되어 있어야 한다.

이 탭은 `code`, `harness`, `worktrees`를 숨기는 장식이 아니라, 비개발 작업의 원장과 승인 경계를 보여주는 곳이어야 한다.

## 7. 검증 원칙

- GUI 검증 금지. Playwright/Electron 실행 금지.
- 문서 PR은 정적 검색과 markdown lint 수준으로 검증한다.
- 구현 PR에서도 vitest/순수 함수 테스트를 우선한다.
- 실제 화면 확인이 필요하면 에이전트가 직접 띄우지 않고 오케스트레이터에 요청한다.
