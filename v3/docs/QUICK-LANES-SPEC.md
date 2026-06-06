# 빠른 레인(Quick Lanes) — 독립 컨텍스트 멀티 작업 · 설계 스펙

- **상태**: 설계 확정 (열린 결정 3건 사용자 승인) — 구현 플랜 대기
- **작성일**: 2026-06-05
- **TaskForce 티켓**: `d27a6197-c5b6-4f6b-9f19-b1924aa0156b`
- **의존**: `v3/docs/WORKTREE-SPEC.md` (`4ac84c57…`, worktree-per-task + ad-hoc 태스크 자동 생성)
- **관련**: `v3/docs/MISSIONS-SPEC.md` (오케스트레이터 · dispatch · contextId 태깅의 원형 `missionId`)

---

## 1. 배경 / 문제

한 프로젝트에서 **큰 메인 작업 A**가 보드 + 오케스트레이터 + 에이전트 여럿으로 돌아가는 중에, 사용자가 떠올린 **작은 개선점 B·C를 병렬로** 하고 싶어 한다. 지금까지는 "**새 터미널이나 에이전트뷰에서 클로드를 새로 켜서**" 처리했다.

이때 기존 컨셉 — "오케스트레이터 하나가 프로젝트의 **모든 맥락을 알고** 티켓을 만든다" — 와 충돌이 생긴다:

- 오케스트레이터 레지스트리가 `projectId` 하나만 키로 쓴다 (`main.ts:428`). 한 프로젝트 = 한 오케 세션 가정.
- 오케스트레이터의 `get_all_tasks`는 `where("projectId","==",projectId)` 로만 거른다 (`mcp-server/tools.ts:239–245`). **프로젝트의 모든 태스크를 긁는다.**
- 그래서 B·C를 보드에 올리면 **A의 오케스트레이터가 B·C 태스크까지 자기 일로 흡수**한다 (컨텍스트 오염).

사용자 합의(브레인스토밍): A/B/C는 **거의 독립(코드 거의 안 겹침), 격리만 필요**. 위에 "다 아는 브레인"을 두는 건 거부. → B·C는 가벼운 **오케스트레이터 없는** 작업 레인으로, A와 격리하되 한 화면에서 같이 보이게 한다.

### 1.1 대안 기각 — "오케에게 inline(btw)으로 시키기"

A의 오케스트레이터에 "겸사겸사 B·C도" 식으로 붙이는 방식은 기각한다. **컨텍스트 윈도우 한계는 가장 약한 이유**(윈도우는 계속 커짐 → 그것만이면 임시 땜빵)이고, 안 사라지는 진짜 이유가 둘:

1. **컨텍스트 오염 (질적)**: 무한 컨텍스트여도 A+B+C를 한 세션 머리에 섞으면 판단·우선순위가 엉킨다. Marblo가 이미 board/mission 오케를 별도 세션으로 쪼갠 이유(`main.ts:612` "컨텍스트 오염 방지")와 동일 — 윈도우가 커져도 사라지지 않는다.
2. **물리적 격리 (결정적)**: inline 방식은 B에게 **자기 브랜치/워크트리를 줄 수 없다**. 같은 워킹카피에서 A·B를 동시 편집 → 파일 충돌, B만 독립 머지/롤백 불가. "거의 독립 = 각자 브랜치로 따로 머지"라는 전제가 inline으론 물리적으로 불가능. 컨텍스트 트릭으로 못 푸는 git/파일시스템 제약이라, 이게 Quick Lanes를 "있으면 좋은"이 아니라 **구조적으로 필요한** 기능으로 만든다.

부수적으로 라이프사이클 독립(B 폐기/C 선머지/A 일시정지)·비용·blast radius 격리(A 오케 폭주가 B·C를 안 죽임)도 inline으론 얻을 수 없다.

## 2. 목표 / 비목표

**목표 (v1)**

- **빠른 레인** 프리미티브: 오케스트레이터 없이, 클로드 세션 1개가 **자기 워크트리**에서 작은 작업을 수행. "새 터미널 클로드"를 앱 안으로 들여온 것.
- **빠른 레인 탭** 1개: 현 에이전트뷰(`AgentList`) 스타일의 리스트뷰. 활성 레인이 카드로 표시.
- **눈(보드 UI) / 브레인(오케 쿼리) 조회 범위 분리**: 보드 UI는 A·B·C 전부 보여주되 `contextId`로 마킹만 다르게; A의 오케스트레이터 기본 쿼리는 자기 컨텍스트로 필터되어 B·C를 안 긁는다.
- **명시적 크로스 컨텍스트 조회**(read-only): 오케가 필요 시 `all_contexts=true`로 일부러 들여다봄 (기존 `all_projects` 가드 철학을 한 단계 잘게).

**비목표 (v1 제외 → 후속)**

- 빠른 레인 → 정식 보드/미션 **승격** 플로우 (메타데이터만 대비, 액션은 v1.1).
- 레인에 오케스트레이터를 _선택적으로_ 붙이는 모드 (B가 커지는 경우). v1은 "레인=오케 없음"으로 고정.
- 레인 간 자동 의존성·머지 순서 조율. "거의 독립" 가정이므로 충돌은 워크트리 머지 시점에만 git 레벨로 확인(WORKTREE-SPEC 칵핏에 위임).

## 3. 핵심 모델 (확정)

### 3.1 격리 단위 = "컨텍스트"(일의 종류가 아니라 격리 경계)

격리에 필요한 것은 일의 성격(정식 미션 vs 즉석)과 무관하게 항상 동일하다:

```
하나의 컨텍스트 = 세션(에이전트/오케) 1+개  +  워크트리(브랜치)  +  자기 태스크 묶음
```

이 격리 경계를 단일 프리미티브 `contextId`로 묶고, **일의 종류는 그 위의 플레이버**로 둔다:

| 플레이버            | 오케스트레이터      | 무게        | `contextId` 값                  |
| ------------------- | ------------------- | ----------- | ------------------------------- |
| **Board (메인 A)**  | 있음 (board pool)   | 무거움      | `"board"` (예약 기본값)         |
| **Mission**         | 있음 (mission pool) | 무거움/장기 | `missionId` (기존 태깅 일반화)  |
| **빠른 레인 (B·C)** | **없음**            | 가벼움/즉석 | `laneId` (예: `"lane:<uuid8>"`) |

> 핵심: Marblo는 이미 board pool(`main.ts:428`)과 mission pool(`main.ts:615`)을 **별도 세션으로 쪼개 N=2로 이 패턴을 증명**했다. 빠른 레인은 세 번째 변종이되, **오케 세션이 아예 없는** 가장 가벼운 변종이라 새 오케 풀조차 필요 없다 — 에이전트 세션 + 워크트리만 있으면 된다.

### 3.2 빠른 레인 = WORKTREE-SPEC의 "ad-hoc 에이전트"를 제품화

`WORKTREE-SPEC.md §3`는 이미 다음을 확정해 두었다:

> "ad-hoc 에이전트(Board 태스크 없이 즉석 실행)는 즉석 태스크를 자동 생성한다 → 불변식: 모든 워크트리는 태스크를 가진다, Board는 모든 작업의 인덱스다. ad-hoc 태스크는 별도 레인/필터로 Board 잡음 최소화."

→ **빠른 레인이 바로 그 "별도 레인"이다.** 이 스펙은 worktree 인프라 위에 ① `contextId` 태그, ② 전용 탭 UI, ③ 오케 쿼리 범위 분리만 얇게 얹는다.

## 4. 조회 범위 분리 — 이 설계의 심장

두 소비자가 **같은 `tasks` 컬렉션을 서로 다른 범위로** 읽는다. 둘은 이미 **물리적으로 다른 코드 경로**라 분리가 자연스럽다:

| 소비자                      | 코드 경로                                                | 범위                | 동작                                                               |
| --------------------------- | -------------------------------------------------------- | ------------------- | ------------------------------------------------------------------ |
| **눈** (보드 UI)            | 프런트 Firestore `onSnapshot` (`src/components/board/*`) | **프로젝트 전체**   | A·B·C 전부 렌더, `contextId !== "board"`면 다른 마킹(레인 색/뱃지) |
| **브레인** (오케스트레이터) | MCP `get_all_tasks` (`mcp-server/tools.ts:222`)          | **자기 컨텍스트만** | 기본 `where("contextId","==", 내 컨텍스트)` → B·C 안 긁힘          |
| **명시적 크로스**           | MCP `get_all_tasks({all_contexts:true})`                 | 전체(read-only)     | "B가 같은 파일 건드리나?" 같은 의도적 점검에만                     |

→ "섞이게 두냐 / 조회만 하게 하냐"의 답은 **둘 다 아니다**: 눈은 전부 보고, 브레인은 기본 안 보되 필요하면 일부러 볼 수 있다. 자동 흡수 ❌ / 의도적 조회 ✅.

## 5. 데이터 모델 변경

### 5.1 `tasks` 도큐먼트에 `contextId` 추가

- **타입**: `contextId: string` (모든 태스크에 항상 존재).
- **쓰기 시 값 결정**:
  - MCP `create_task` / `create_tasks_bulk` (보드 오케·수동): `contextId = resolveContext()` (아래 5.3, 기본 `"board"`).
  - mission dispatcher (`dispatcher-impl.ts:123` 에서 이미 `missionId` 기록): `contextId = missionId`.
  - 빠른 레인 ad-hoc 태스크 자동 생성(WORKTREE-SPEC): `contextId = laneId`.
- **마이그레이션**: 기존 태스크 백필 — `contextId = (missionId ?? "board")`. 더불어 읽기 시 `contextId` 누락은 `"board"`로 간주(이중 안전).

### 5.2 빠른 레인 도큐먼트 (`quickLanes` 컬렉션, 신규)

```
QuickLane {
  id: string            // = contextId 의 laneId 부분
  projectId: string
  title: string         // 사용자가 입력한 한 줄 ("로그인 에러 메시지 개선")
  branch: string        // feat/<slug>-<id8> (WORKTREE-SPEC 네이밍 규칙 재사용)
  worktreeId: string    // WORKTREE-SPEC 의 Worktree 와 1:1
  harness: 'claude' | 'antigravity' | 'codex'  // 생성 시 사용자가 선택 (fleet 3종)
  agentSessionId: string// 오케 없는 단일 에이전트 세션 (선택 하니스로 spawn)
  status: 'running' | 'awaiting-input' | 'review' | 'merged' | 'archived'
  createdAt, updatedAt
}
```

### 5.3 컨텍스트 해석 (`resolveContext`) — 기존 `resolveProject` 패턴 복제

- MCP 서버에 `MARBLO_CONTEXT` env 도입. 세션 spawn 시 주입:
  - 보드 오케 세션 → `MARBLO_CONTEXT=board`
  - mission 오케 세션 → `MARBLO_CONTEXT=<missionId>`
  - 빠른 레인 에이전트 세션 → `MARBLO_CONTEXT=lane:<laneId>`
- `get_all_tasks`(`tools.ts:239`)에 `all_contexts?: boolean` 추가, 기본 필터에 `where("contextId","==", resolveContext())` 한 줄 추가. `all_projects`와 동일한 escape-hatch 형태.
- **주입 지점**(코드 확인 완료): MARBLO_PROJECT를 넣는 **환경변수 생성기와 동일 위치** — 에이전트 `agent-config.ts:287–289`(`resolvedProject` 옆) + Codex `${VAR}` allowlist `agent-config.ts:~801`, 오케 `orchestrator-manager.ts:292·307`. MCP는 `tools.ts:55·77`에서 `process.env.MARBLO_CONTEXT` 읽기만(`|| "board"`). MCP 등록 시점 아님.

## 6. UI

- **Lanes 탭** (독립 최상위 탭): `TabBar.tsx` 탭 배열에 `{ id: "lanes", label: "Lanes" }`를 **`board`와 `missions` 사이**에 삽입(현 순서 Guide·Board·Missions·Code…). 제품 정식명 "Quick Lanes", 탭 라벨은 기존 영문 단어 스타일에 맞춤. 컴포넌트는 새 `src/components/lanes/`, `AgentList` 스타일 리스트뷰. 행 = 레인(제목 · **하니스 배지(Claude/agy/Codex)** · 브랜치 · 상태 pill · 미니 터미널/포커스 액션). "＋ 빠른 작업" 버튼 → **한 줄 입력 + 에이전트 선택(Claude / Antigravity / Codex, fleet 3종)** → 레인 생성(워크트리 add + 선택 하니스로 오케 없는 에이전트 spawn). 에이전트 선택 UI는 `AgentAddModal`의 하니스 선택부를 재사용.
- **보드 마킹**: 칸반 카드에서 `contextId !== "board"`인 태스크는 레인 색/뱃지로 구분(예: 좌측 컬러바 + `B` 칩). 보드는 여전히 "모든 작업의 인덱스".

## 7. 라이프사이클 / 흐름

| 단계   | 동작                                                                                                                                                                                     |
| ------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 생성   | "＋ 빠른 작업" → 제목 + 하니스 선택 → `QuickLane` 도큐 + `git worktree add feat/<slug>-<id8>` + **선택 하니스(claude/agy/codex)로** 오케 없는 에이전트 spawn(`MARBLO_CONTEXT=lane:<id>`) |
| 작업   | 레인 에이전트가 워크트리에서 직접 편집/커밋. 진행 중 ad-hoc 태스크(들) 자동 생성 → `contextId=laneId` → 보드에 마킹되어 노출                                                             |
| A 오케 | `get_all_tasks` 기본 쿼리가 `contextId="board"`라 B·C 무시 (오염 0). 필요 시 `all_contexts=true`로만 점검                                                                                |
| 머지   | WORKTREE-SPEC 머지 칵핏에 위임 — rebase→squash→merge→워크트리/브랜치 삭제. 레인 status `merged`                                                                                          |
| 정리   | 머지/무활동 레인은 `archived`, WORKTREE-SPEC stale cleanup과 함께 정리                                                                                                                   |

## 8. 기존 코드 접점

- `v3/electron/mcp-server/tools.ts:222–261` — `get_all_tasks`에 `contextId` 기본 필터 + `all_contexts`. `create_task`/`create_tasks_bulk`(`:304`, `:372`)에 `contextId` 쓰기.
- `v3/electron/mcp-server/tools.ts:90–98` — `resolveProject` 옆에 `resolveContext` 추가.
- `v3/electron/mission-engine/dispatcher-impl.ts:123` — 태스크 doc에 `contextId = missionId` 추가.
- `v3/electron/main.ts:428 / 615` — board/mission 풀은 그대로. 빠른 레인은 **오케 풀 불필요**, 에이전트 spawn 경로(`agent-manager.ts`)에 `MARBLO_CONTEXT` 주입만.
- `v3/src/components/board/*` — 카드 contextId 마킹. `v3/src/components/agents/AgentList.tsx` — 빠른 레인 리스트뷰 참고/재사용.
- `v3/electron/mission-engine/types.ts` — `Task`/`contextId`, `QuickLane` 타입.

## 9. 엣지케이스 / 에러 처리

- **백필 전 누락 태스크 (회귀 주의)**: Firestore `where("contextId","==","board")`는 **필드가 없는 옛 doc을 매칭 못 한다** → 백필 전에 필터를 켜면 A 오케가 자기 기존 태스크를 못 보는 회귀. 따라서 **백필 완료 후** contextId 필터를 켠다(§11-1, 롤아웃 순서). UI 렌더는 클라이언트에서 누락→`"board"` 폴백으로 즉시 안전.
- **레인↔보드 동일 파일**: "거의 독립" 가정이 깨지는 경우 → 워크트리 머지 시 git 충돌로 드러남(머지 칵핏이 처리). v1은 사전 조율 안 함(비목표).
- **오케가 실수로 레인 태스크 dispatch**: 기본 쿼리에서 안 보이므로 구조적으로 차단. `all_contexts`는 read 전용이라 dispatch 경로와 무관.
- **레인 에이전트 크래시**: 오케가 없으므로 자동 복구 주체 없음 → 탭에서 사용자가 재시작/아카이브(가벼운 일회성이라 수용 가능한 trade-off).

## 10. 테스트

- 단위: `resolveContext` 기본값/주입, `get_all_tasks`가 `contextId` 필터링(+`all_contexts` bypass), `create_task` contextId 기록.
- 통합: 레인 2개 동시 생성 → 보드 오케 `get_all_tasks`가 board 태스크만 반환, 보드 UI는 전부 표시(마킹 구분).
- 회귀: 기존 board-only 프로젝트(백필 전)에서 A 오케가 모든 태스크를 여전히 봄(contextId 누락→"board").
- 하니스: 레인을 claude/antigravity/codex 각각으로 생성 → 해당 하니스로 세션 spawn + `MARBLO_CONTEXT=lane:<id>` 주입 검증(Codex는 `${VAR}` allowlist 경유, Antigravity는 agent-config env).
- Playwright @unit: 빠른 레인 탭 smoke, 생성 모달 하니스 선택(3종), 카드 마킹/하니스 배지 렌더.

## 11. 확정된 결정 (사용자 승인 · 2026-06-05)

1. **기존 board 태스크 `contextId` 부여 → 백필 한다.** 마이그레이션으로 기존 `tasks`를 `contextId = (missionId ?? "board")`로 일괄 백필. 백필 완료 **후** 오케 쿼리의 `contextId` 필터를 켠다(§9 롤아웃 순서). UI는 그 전에도 클라이언트 누락→`"board"` 폴백으로 안전.
2. **`MARBLO_CONTEXT` 주입 지점 → 환경변수 생성기(= MARBLO_PROJECT와 같은 자리). MCP 등록 시점 아님.** (코드 확인 완료)
   - 에이전트: `agent-config.ts:287–289`(`resolvedProject` 옆에 `resolvedContext` + `env.MARBLO_CONTEXT`), Codex `${VAR}` allowlist `agent-config.ts:~801`에 `"MARBLO_CONTEXT"` 추가.
   - 오케스트레이터: `orchestrator-manager.ts:292`(MCP env)·`:307`(launchConfig env) — board→`"board"`, mission→`missionId`.
   - MCP: `tools.ts:55·77` 패턴대로 `resolveContext()` = `process.env.MARBLO_CONTEXT || "board"`(읽기만).
   - 근거: MARBLO_PROJECT/MARBLO_AGENT_ID가 이미 이 생성기에서 세션별 주입되고 MCP가 `process.env`로 읽음 → 동일 경로.
3. **빠른 레인 탭 → 독립 최상위 탭, Board와 Missions 사이.** `TabBar.tsx`에 `{ id: "lanes", label: "Lanes" }` 삽입(§6). 제품명 Quick Lanes.
