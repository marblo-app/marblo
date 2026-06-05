# Agent Capability Hints — 설계 스펙

- 날짜: 2026-06-05
- 상태: 설계 승인 대기 (brainstorming 산출물)
- 프로젝트: marblo-v3
- 관련 메모: `marblo_v3_fleet_codex_naming`, `marblo_claude_binary_resolution`

## 1. 배경 / 문제

마블로 v3 오케스트레이터는 이미 멀티에이전트 오케스트레이터다(`dispatch_task` → 물리
에이전트 스폰, TaskForce 티켓·에이전트뷰·cost-tracker로 가시화). 최근 각 에이전트
CLI에 강력한 "특기" 기능들이 등장했다:

- **Claude Code**: `Workflow` 도구(다이내믹 멀티에이전트 fan-out, research preview·유료
  플랜), `/deep-research`(빌트인 워크플로우, v2.1.154+), `/goal <검증가능 조건>`(자율,
  v2.1.139+), `ultrathink` 키워드, `/effort` 레벨.
- **Codex (gpt)**: `/goal <목표>` 자율 모드(마블로 카탈로그에 이미 통합), review/challenge.
- **Antigravity (agy)**: Gemini-3-Flash 백엔드. 고유 킬러 슬래시는 없고, "싸고 빠른
  대용량-컨텍스트 / 리서치·문서·에이전틱 워커"라는 역할 적합성이 강점. 복잡한 멀티스텝
  리팩터/리뷰는 claude/gpt 우선.

목표 용도(사용자 확정): **한 티켓 안에서 개별 에이전트가 내부 fan-out/자율모드로
속도·품질을 끌어올리는 것.** 오케스트레이터의 태스크 분해 구조는 그대로 둔다.

### 핵심 긴장점

- 워커 스킬은 **역할 기반**(`backend_agent.md` …)인데 특기는 **모델 기반**(Workflow=claude,
  `/goal`=claude+codex). backend 티켓이 claude로 갈지 codex로 갈지는 dispatch가 정한다.
  → 특기 가이드를 역할 스킬에 그냥 박으면 안 되고 **모델별 조건부 주입**이 필요.
- Workflow 서브에이전트는 한 claude 프로세스 내부라 마블로 티켓/에이전트뷰에 카드로
  안 잡힌다(코스트는 부모 세션에 롤업되어 합계는 잡힘).

## 2. 목표 / 비목표

**목표**

- 각 워커 에이전트가 자기 모델의 특기를, 티켓 상황에 맞을 때만 발동하도록 유도.
- 변경 범위 최소(역할×모델 곱이 아니라 합), 코스트 추적은 기존 롤업 재사용.
- fast-lane(사소한 티켓)에서는 특기 넛지를 억제해 토큰 폭주 방지.

**목표 (추가 — C-lite)**

- 특기(Workflow/deep-research/goal)가 도는 동안 **보드 티켓 카드에 진행 마커**를 띄워
  가시성 보완(서브에이전트 카드화의 가벼운 슬라이스). 3.4 참조.

**비목표 (YAGNI / 후속)**

- Approach C 풀버전: 서브에이전트를 마블로 1급 개념(Flow 노드/개별 에이전트 카드)으로
  승격. (별도 트랙 — 이번엔 C-lite 마커만)
- 유료플랜/preview 가용성 자동 감지. (graceful 폴백으로 대체)
- Antigravity 고유 특기 커맨드 발굴. (현재 없음 — 역할강점만 기술)

## 3. 설계

### 3.1 모델 조건부 Capability 스니펫 (섹션 1)

프롬프트 조립 시점에 역할 스킬 뒤로 **모델별 특기 스니펫**을 덧붙인다.

```
워커 프롬프트 = {role}_agent.md  +  capability_{model}.md  +  task context(+capabilityHint)
```

- `skills/capability_claude.md` — Workflow(fan-out/pipeline; 대규모 리뷰·리팩터·
  마이그레이션·다파일 검증), `/deep-research`(리서치형), `/goal <검증가능 조건>`,
  `ultrathink`(단일 난제), `/effort`. 플랜/preview 없으면 일반 처리로 폴백.
- `skills/capability_codex.md` — `/goal <목표>` 자율, review/challenge.
- `skills/capability_antigravity.md` — 역할강점(리서치/문서/대용량-컨텍스트/에이전틱,
  Flash 티어). 복잡 리팩터/리뷰는 claude/gpt 우선이라는 자기인식 포함.

역할 스킬 4개 + 특기 스니펫 3개 = 7파일(곱 12 아님). 모델 맞는 스니펫만 들어가므로
Claude-only/Codex-only 가드가 자연 성립. Workflow의 정식 opt-in(=스킬이 지시)도
이 스니펫으로 충족.

**주입 지점:** `electron/agent-config.ts`의 프롬프트 조립부(`composeInitialPrompt` 경로).

### 3.2 상황 게이팅 (섹션 2)

새 태깅 불필요. `dispatch-scoring`이 뽑는 기존 태그 + 오케스트레이터 스킬의 기존
**태그→모델** 라우팅에, **태그→특기 힌트** 매핑만 병렬로 추가한다.

| 티켓 모양 (기존 태그)                                    | 기존 라우팅      | capability 힌트                                     |
| -------------------------------------------------------- | ---------------- | --------------------------------------------------- |
| `research`/`analysis`/`documentation`                    | agy / claude     | 리서치형 → claude `/deep-research`, agy 리서치 모드 |
| `large-context`/`multi-file`/`refactor`/`architecture`   | claude / gpt     | 대규모 → claude `Workflow` fan-out, 또는 `/goal`    |
| `agentic`/`autonomous`/`multi-agent`                     | claude/codex/agy | 자율 다단계 → `/goal <검증가능 조건>`               |
| `simple-fix`/`quick-edit`/`boilerplate`/`fast-execution` | fast lane        | **힌트 없음 (억제)**                                |

**부품**

1. 순수함수 `capabilityHintForTags(tags, model): string` — 위 표대로 한 줄 힌트
   (fast-lane이면 `""`). `electron/dispatch-scoring.ts` 옆에 배치.
2. 주입: `dispatch_task`/컨텍스트 빌드부에서 힌트를 워커 task context에 한 줄 추가.
   스니펫(3.1)이 "어떻게", 힌트가 "이 티켓엔 뭘/언제".
3. 오케스트레이터 스킬 규칙 1줄: heavy/research/autonomous 태그 디스패치 시
   capabilityHint를 context에 얹는다. 산문으로 도구 호출 강제 금지(힌트만). fast-lane 생략.

같은 태그에서 (모델 라우팅[기존]) + (특기 힌트[신규]) 둘 다 파생 — 순수함수 2개.
모델 조건부라 "리서치 티켓이 claude면 `/deep-research`, agy면 agy 모드"가 자동 정합.

### 3.3 가드 · 로깅 · 코스트 (섹션 3)

**가드**

1. 모델-특기 매칭: 붙는 `capability_{model}.md`로 자연 강제.
2. 플랜/preview 폴백: Workflow·deep-research 미가용/에러 시 일반 순차 처리로 폴백,
   티켓을 막지 않는다(스니펫에 명시).
3. fast-lane 억제: `capabilityHintForTags` → `""`.
4. 스코프 규율: fan-out 크기·깊이를 티켓 규모에 맞춤.
5. 네스팅: 논리 서브에이전트(Task)가 Workflow 호출 OK(1단계), Workflow-in-Workflow 금지.

**로깅:** 특기 발동 시 `add_activity(task_id, "특기: …")`로 칸반/액티비티피드에 노출.

**코스트:** 특기 서브에이전트·`/goal` 추가턴 토큰은 부모 세션 사용량에 롤업 →
cost-tracker가 티켓/에이전트 합계로 이미 포착(agy는 agy-usage 추출기). 새 배선 불필요.

### 3.4 특기 진행 마커 — C-lite (보드 카드 배지)

특기가 도는 동안 해당 티켓 카드에 "⏳ Workflow 진행중 / 딥리서치 진행중 / Goal 진행중"
배지를 띄운다. 서브에이전트 카드화(C 풀버전)는 안 하고, **기존 티켓 카드 1개에 진행
상태만** 얹는 가벼운 슬라이스.

**마커 규약(텍스트 컨벤션, 추가 스토리지 없음):** capability 스니펫이 특기 시작/종료에
구조화된 activity를 남긴다.

- 시작: `add_activity(task_id, "[cap:start:workflow] N subagents")`
- 종료: `add_activity(task_id, "[cap:end:workflow] done")`
- 종류: `workflow` | `deep-research` | `goal`

**파생:** projection/store가 활동 로그에서 *매칭 end 없는 마지막 start*를 골라
`Task.activeCapability`(옵셔널)로 노출. `TaskCard`가 이 필드로 배지 렌더(기존
`MissionStatusBadge` / 펄스 인프라 재사용).

**스테일 방지:** 다음 중 하나면 `activeCapability`를 클리어 — (a) 매칭 `[cap:end:*]`
도착, (b) 티켓이 종료 상태(DONE/REVIEW/FAILED)로 전이, (c) 소유 에이전트가 idle/offline.

## 4. 변경 범위

**신규**

- `v3/skills/capability_claude.md`
- `v3/skills/capability_codex.md`
- `v3/skills/capability_antigravity.md`
- `v3/tests/unit/capabilityHint.test.ts`
- `v3/tests/unit/activeCapability.test.ts` — 마커 파생(start/end 매칭·스테일 클리어)

**수정**

- `v3/electron/dispatch-scoring.ts` — `capabilityHintForTags(tags, model)` 순수함수
- `v3/electron/agent-config.ts` — 조립부에 `capability_{model}.md` append
- 디스패치/컨텍스트 빌드부(`electron/mission-engine/dispatcher-impl.ts` 또는 task context
  생성 위치) — 힌트 주입
- `v3/skills/orchestrator_agent.md` — capabilityHint 규칙 1줄
- `v3/src/types/task.ts` — `Task.activeCapability?: "workflow" | "deep-research" | "goal" | null`
- projection/MCP 파생부 — 활동 로그 → `activeCapability` 계산 + 스테일 클리어
- `v3/src/components/board/TaskCard.tsx` — 진행 마커 배지 렌더

## 5. 테스트 전략

- `capabilityHint.test.ts`: heavy→workflow, research→deep-research/agy, autonomous→goal,
  fast→`""`, 모델 조건부(claude vs codex vs agy) 매핑 검증.
- `activeCapability.test.ts`: `[cap:start/end:*]` 파생(매칭 end 없는 마지막 start→active,
  end/종료상태→clear) 순수함수 검증.
- 조립 테스트(선택): 모델별로 올바른 `capability_{model}.md`가 붙는지(`agent-config`).

## 6. 오픈 이슈

- Antigravity 고유 특기 커맨드: 현재 없음으로 간주, 역할강점만 기술. 추후 agy가 명령형
  특기를 노출하면 스니펫 보강.
- 유료플랜/preview 미보유 사용자: graceful 폴백으로 처리(자동 감지는 후속).
- 마커 파생 위치: projection 레이어(서버측, 권장 — 모든 클라 일관) vs 프론트 store
  (가벼움)를 플랜 단계에서 확정. 기존 projection 인프라(`get_projection`) 재사용 우선 검토.
