# 구조화된 태스크 티켓 (Structured Task Tickets) — 설계

- 날짜: 2026-06-06
- 상태: 설계 승인 대기 (브레인스토밍 산출물)
- 작성: Claude (brainstorming)

## 1. 문제 (Problem)

오케스트레이터(Claude / Codex / Antigravity)가 생성하는 태스크 티켓의 `description`이
자유서술 한 덩어리로 작성되어 **가독성이 떨어진다**. 실제 사례(워크트리 머지 티켓):

> WorktreeManager에 머지 단언 추가: rebaseOntoBase(...), squashMergeToBase(...) (rebase→squash→...).
> 충돌 시 안전 실패(rollback). 충돌 시 conflict 정보+needsResolve 신호로 충돌. 충돌 시 conflict 정보+needsResolve 신호.
> resolver 에이전트 spawn(...). worktree-ipc: ... v1 ... 완료기준: tests/unit/...merge.test.ts ... merge IPC 노출.

한/영 혼용 + 파일 경로 인라인 + 런온 문장 + 중복("충돌 시 …" 3회)이 한 문단에 뭉쳐 있다.
근본 원인: `description`은 포맷 강제가 전혀 없는 **자유서술 1필드**이고, 작성 가이드도
구조에 대해 침묵한다.

## 2. 목표 / 비목표 (Goals / Non-Goals)

### 목표

- 모든 오케스트레이터가 **일관된 구조**로 티켓을 쓰게 만든다 — 누가 호출하든 같은 레이아웃.
- 포맷팅을 **LLM이 아니라 코드**가 담당하게 한다 (LLM은 "내용"만 채움).
- 사람 가독성 + 에이전트 프롬프트 품질을 **동시에** 개선한다 (description == 에이전트 instruction).
- 진행 상황은 본문(description)이 아니라 **activity(`add_activity`)** 로 분리한다.

### 비목표 (YAGNI)

- 마크다운 렌더링 라이브러리 도입 — 안 함. UI는 구조화 필드를 직접 섹션으로 렌더(아래 선택 (a)).
- 기존 자유서술 티켓을 자동 파싱하여 구조화 — 안 함. legacy fallback으로 그대로 표시.
- 마이그레이션 스크립트 — 안 함. 새 필드는 모두 optional, 기존 티켓 무손상.
- 완료 기준 체크박스의 인터랙티브 토글 — v1은 read-only 표시만.

## 3. 결정 사항 (브레인스토밍 합의)

- **방식**: 스키마 필드로 강제 (코드가 레이아웃 렌더, LLM은 필드만 채움).
- **표준 섹션 4개**: `목표(goal)` / `변경·접근(changes)` / `완료 기준(acceptance)` / `제약·주의(notes)`.
  - `scope`(파일), `dependsOn`(의존)은 **이미 별도 필드**로 존재 — 본문 섹션에서 제외.
- **UI 렌더 = 선택 (a)**: 구조화 필드를 직접 섹션으로 렌더(마크다운 의존 없음, 섹션별 편집·확장 용이).
- **진행 내용 분리**: description은 생성 시점의 **불변 스펙**. 중간 진행은 `add_activity`로 ACTIVITY 탭에 누적.

## 4. 데이터 모델 (Data Model)

### 4.1 필드 추가

태스크 도큐먼트(Firestore `tasks` 컬렉션) 및 `TaskDoc` 인터페이스에 추가:

| 필드          | 타입       | 의미                                   | 비고                             |
| ------------- | ---------- | -------------------------------------- | -------------------------------- |
| `goal`        | `string`   | 목표 — 무엇을/왜 1~2문장               | 신규, optional                   |
| `changes`     | `string[]` | 변경·접근 — 추가/수정할 함수·동작 불릿 | 신규, optional                   |
| `acceptance`  | `string[]` | 완료 기준 — 검증 가능한 체크 항목      | 신규, optional                   |
| `notes`       | `string[]` | 제약·주의 — 롤백/재사용 규칙 등        | 신규, optional                   |
| `description` | `string`   | (기존) 자유서술                        | **legacy 유지**, optional로 완화 |
| `scope`       | `string[]` | (기존) 파일 경로                       | 변경 없음                        |
| `dependsOn`   | `string[]` | (기존) 의존 태스크                     | 변경 없음                        |
| `comment`     | `string`   | (기존) 환경 제약 (`context` 파라미터)  | 변경 없음                        |

참조: `TaskDoc` 정의 = `v3/electron/mcp-server/tools.ts:105-121`.

### 4.2 단일 출처 원칙 (Single Source of Truth)

- **구조화 필드가 canonical.** 구조화 필드가 있으면 `description`은 비워 둔다(중복 저장으로 인한 drift 방지).
- 플랫 문자열이 필요한 곳(에이전트 instruction 등)은 **공유 순수함수 `composeTaskBody()`** 로 on-demand 생성.
- legacy 티켓(구조화 필드 없음 + `description`만 있음)은 `composeTaskBody`가 `description`을 그대로 반환.

## 5. 공유 컴포저 (composeTaskBody)

신규 파일: `v3/electron/task-body.ts` (순수, 단위 테스트 가능, electron 측에서 import).

```ts
export interface TaskBodyFields {
  goal?: string;
  changes?: string[];
  acceptance?: string[];
  notes?: string[];
  description?: string; // legacy fallback
}

// 구조화 필드 → 에이전트/플랫 텍스트용 본문. 빈 섹션은 생략.
export function composeTaskBody(t: TaskBodyFields): string;
```

생성 규칙 (구조화 필드가 하나라도 있으면):

```
## 목표
{goal}

## 변경·접근
- {changes[0]}
- {changes[1]}

## 완료 기준
- [ ] {acceptance[0]}
- [ ] {acceptance[1]}

## 제약·주의
- {notes[0]}
```

- 비어 있는 섹션은 **헤더째 생략**.
- 구조화 필드가 전혀 없으면 → `description ?? ""` 반환 (legacy fallback).
- 섹션 라벨 상수는 한 곳에서 export하여 UI 렌더러와 공유(라벨 일관성).

이 함수가 **에이전트 instruction의 단일 포맷 출처**다. (UI는 사람용으로 별도 JSX 렌더 — §7.)

## 6. MCP 스키마 (모든 오케스트레이터의 단일 통제점)

파일: `v3/electron/mcp-server/tools.ts`.

### 6.1 `create_task` (tools.ts:313-378)

파라미터 추가/변경:

- `goal: z.string().optional().describe(...)` — 작성 규칙 포함
- `changes: z.array(z.string()).optional().describe(...)`
- `acceptance: z.array(z.string()).optional().describe(...)`
- `notes: z.array(z.string()).optional().describe(...)`
- `description: z.string().optional()` — **required → optional** (legacy 경로)
- 유지: `title`, `role`, `priority?`, `depends_on?`, `project_id?`, `context?`, `scope?`

검증(가벼움):

- `goal`(또는 legacy `description`) 둘 다 없으면 에러.
- 구조화 필드가 있으면 `description` 파라미터는 무시(저장 안 함), 구조화 필드만 저장.
- `acceptance`가 비면 경고 메시지(차단하지 않음).

저장: `data`에 `goal/changes/acceptance/notes`(존재 시) 기록. legacy 경로면 `description`만 기록.

`.describe()` 문구는 **각 필드 작성 규칙 + 좋은예/나쁜예**를 박는다 — 스킬을 안 쓰는
Codex/Antigravity도 툴 스키마만 보고 따르도록 하는 핵심 레버. 툴 최상위 description 문자열도
"구조화 필드로 작성하라"로 갱신.

### 6.2 `create_tasks_bulk` (tools.ts:382-543)

각 task 아이템이 `goal/changes/acceptance/notes`를 지원하도록 처리 루프(437-528) 수정.
저장 로직은 `create_task`와 동일 규칙. 툴 description 문자열 갱신.

## 7. UI 렌더링 — 선택 (a): 구조화 필드 직접 렌더

파일: `v3/src/components/board/TaskDetailModal.tsx`.

### 7.1 read-only (현재 578-595, `whitespace-pre-wrap` 단일 블록)

→ **섹션 렌더러**로 교체:

- 구조화 필드가 있으면: 존재하는 섹션마다 헤더(`목표`/`변경·접근`/`완료 기준`/`제약·주의`) + 리스트.
  - `완료 기준`은 체크박스 스타일(read-only 체크 표시).
  - `목표`는 문단, `변경·접근`/`제약·주의`는 불릿 리스트.
- 구조화 필드가 없고 legacy `description`만 있으면: 기존처럼 단일 블록 렌더.
- 작은 하위 컴포넌트 `TaskBodySections`로 추출(보드 카드 요약 등에서 재사용 여지).

### 7.2 edit (현재 495-577 단일 textarea)

- 구조화 티켓: 섹션별 입력 — `목표`(input), `변경·접근`/`완료 기준`/`제약·주의`(textarea, 한 줄 = 한 항목).
  저장 시 줄 단위로 배열 매핑.
- legacy 티켓: 기존 단일 textarea 유지(점진 전환).
- `title`/`priority` 편집은 그대로.

### 7.3 렌더러 측 타입

렌더러의 Task 타입에 `goal/changes/acceptance/notes` 추가(보드 store/types). 정확한 파일은
구현 플랜에서 특정(예: `v3/src/stores/*`).

## 8. 미션 자동 분해 경로 (두 번째 생성 경로)

MCP 경로 외에 미션 엔진도 티켓을 만든다 — 이쪽도 구조화해야 "모든 오케스트레이터" 커버.

- `DecomposedTask`(`v3/electron/orchestrator/dag-generator.ts:3-11`)에 `goal/changes/acceptance/notes` 추가
  (`description`은 호환 위해 유지하되 미사용 가능).
- `DECOMPOSE_SYSTEM` / `ADD_TASKS_SYSTEM` 프롬프트(`v3/electron/orchestrator/prompt-templates.ts:6-32, 50-72`)의
  출력 JSON을 새 필드로 교체 + 각 필드 작성 규칙·좋은예/나쁜예 명시.
- `dispatcher-impl.ts`:
  - docPayload(108-127)에 구조화 필드 저장.
  - `instruction: t.description`(143) → `instruction: composeTaskBody(t)` 로 교체. 위에 기존
    `withCompletionFooter`(보고 규약) 그대로 부착.
  - fallback 단일 태스크(83-93) 및 `orchestrator/index.ts`(123, 149)의 `DecomposedTask` 생성부도
    새 필드(빈 배열 기본) 포함하도록 갱신.
- 단일 quick-fix 경로 `fix-runner-impl.ts`(59-62): `goal = input.goal`로 자연 매핑, 나머지 빈 값.

## 9. 진행 내용 → activity 분리

- description 4섹션 = 생성 시 불변 스펙. 중간 진행은 `add_activity(task_id, message)` → ACTIVITY 탭/댓글.
- `withCompletionFooter`(`v3/electron/bridge-server.ts`) 및 tf-\* 스킬 문구 강화:
  "진행 상황을 description에 덧붙이지 말고 `add_activity`로 보고하라."

## 10. 프롬프트·스킬 동기화 (준수 보장)

- `prompt-templates.ts` — §8.
- `.claude/skills/tf-create-tasks/SKILL.md` 및 `tf-spawn`/`tf-flow`/`tf-agent` 가이드: 카드 포맷을 4섹션으로
  정렬 + 구조화 파라미터를 쓰는 `create_task` 호출 예시 추가.
- MCP 툴 `.describe()` — §6 (스킬 미사용 오케스트레이터까지 커버하는 최강 레버).

## 11. Back-compat

- 새 필드는 전부 optional. 기존 `description`-only 티켓은 `composeTaskBody` fallback으로 그대로 dispatch/렌더.
- 기존 티켓 마이그레이션 불필요.

## 12. 테스트

- 단위: `composeTaskBody` — 전체 필드 / 부분(빈 섹션 생략) / legacy fallback / 섹션 순서 / 체크박스 포맷.
- 단위: `create_task`·`create_tasks_bulk` 구조화 필드 수용 + 검증(goal-or-description 필수) + 저장 형태.
  (기존 `v3/tests/unit/` MCP 툴 테스트 유무 확인 후 정렬.)
- 스냅샷: 동일 입력 → 동일 본문.
- UI: 구조화 vs legacy 렌더 분기(경량 컴포넌트 테스트 또는 수동 확인).

## 13. 변경 touch points 요약

| 영역            | 파일                                                                                                           | 변경                                                    |
| --------------- | -------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------- |
| 컴포저          | `v3/electron/task-body.ts` (신규)                                                                              | `composeTaskBody` + 섹션 라벨 상수                      |
| MCP 스키마/저장 | `v3/electron/mcp-server/tools.ts`                                                                              | create_task / create_tasks_bulk 필드·검증·저장·describe |
| 타입(저장)      | `tools.ts` `TaskDoc`                                                                                           | 필드 4개 추가                                           |
| 미션 분해       | `dag-generator.ts`, `prompt-templates.ts`, `dispatcher-impl.ts`, `orchestrator/index.ts`, `fix-runner-impl.ts` | 구조화 필드 + instruction=composeTaskBody               |
| UI 렌더/편집    | `v3/src/components/board/TaskDetailModal.tsx` (+ 렌더러 Task 타입)                                             | 섹션 렌더러 + 섹션별 편집                               |
| 진행 분리       | `v3/electron/bridge-server.ts`, tf-\* 스킬                                                                     | "진행은 add_activity" 문구 강화                         |
| 스킬·가이드     | `.claude/skills/tf-create-tasks/SKILL.md`, tf-spawn/flow/agent                                                 | 4섹션 정렬 + 예시                                       |

## 14. 오픈 이슈 (구현 플랜에서 확정)

- 렌더러 Task 타입의 정확한 위치/이름.
- 기존 MCP 툴 단위 테스트 하네스 존재 여부(없으면 `composeTaskBody` 중심으로 커버).
- `완료 기준` 인터랙티브 토글은 후속(v1 read-only).
