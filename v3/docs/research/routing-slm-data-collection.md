# 라우팅 SLM 데이터 수집 체계 — 통합 설명서

> **작성일**: 2026-07-18 · **성격**: 리포트온리(코드 변경 없음) · **기준**: `main @ 14695a2f` + PR#480(OPEN) + BigQuery `marblo-2253d.marblo_telemetry` 실측
>
> **통합 소스**: `docs/bigquery-ml-readiness.md`(2026-04-19 설계) · PR#480(머지결과 캡처 구현) · `docs/slm-router-summary.md`(SLM 라우터 전략 판정)

---

## 0. 세 줄 요약 (사장님용)

1. **배관은 거의 다 깔렸다.** 2026-04 설계문서가 "만들어야 한다"고 적은 것들(테이블 5개, task↔cost 조인키, 디스패치 결정 로깅, 프라이버시 스크럽, 텔레메트리 default-ON)은 **이미 라이브**다. 설계문서의 현황 수치는 전부 stale이니 그 문서로 판단하면 안 된다.
2. **그런데 학습 라벨은 사실상 0이다.** 배관 끝에서 나와야 할 "이 태스크를 이 모델에 줬더니 이런 결과가 나왔다" 한 줄이 안 만들어진다. 디스패치 결정 216건 vs 결과 29건, **실제로 조인되는 완결행 = 1건**.
3. **PR#480은 이 막힌 지점을 우회하는 새 라벨원(머지결과)을 연다.** 다만 실제 유입은 **3.0.17 릴리스 후 유저가 머지할 때부터**다. 지금 필요한 결정은 "SLM 학습 착수"가 아니라 "라벨 3대 결함을 고칠 것인가"다.

**한 문장**: 파이프는 뚫렸고, 물이 안 나온다. 고쳐야 할 건 파이프가 아니라 **수도꼭지(결과 기록 경로)**다.

---

## 1. 수집 항목 — 5개 카테고리

라우팅 SLM이 학습하려면 "**입력 특징 → 결정 → 결과 → 라벨**"이 한 taskId로 꿰여야 한다. 카테고리별 현황:

| #   | 카테고리          | 항목                                                                 | 적재 위치                                                 |                   상태                   |
| --- | ----------------- | -------------------------------------------------------------------- | --------------------------------------------------------- | :--------------------------------------: |
| ①   | **태스크 특징**   | role                                                                 | `events.role`, `task_outcomes.role`                       |                    🟢                    |
|     |                   | 복잡도                                                               | dispatch metadata `.complexity` (simple/standard/complex) |                    🟢                    |
|     |                   | 복잡도(결과행)                                                       | `task_outcomes.taskComplexity` ← **priority 대용**        |                    🟡                    |
|     |                   | taskType (bug-fix/feature/refactor)                                  | `task_outcomes.taskType`, `events.taskType`               |           🔴 **하드코딩 NULL**           |
|     |                   | filesChanged / linesChanged                                          | `events.filesChanged` / `.linesChanged`                   |        🔴 스키마만(PR#480이 채움)        |
|     |                   | 프롬프트 특징                                                        | `events.promptHash` / `.promptLength` (sha256+길이)       |             🟢 실측 1,463건              |
|     |                   | scopeFileCount                                                       | `task_outcomes.scopeFileCount`                            |                    🟢                    |
|     |                   | 의존성 깊이                                                          | —                                                         |              🔴 **미수집**               |
| ②   | **디스패치 결정** | 선택모델·reuse/spawn/restart·매칭점수·후보군·per-model 점수·결정사유 | `events` event=`dispatch:decision` → `metadata` JSON      |             🟢 **가장 건강**             |
| ③   | **작업 결과**     | durationMs                                                           | `task_outcomes.durationMs`                                |          🟡 **의미 오염**(§3.2)          |
|     |                   | 토큰·비용                                                            | `cost_logs`(taskId 조인)                                  |            🟢 조인율 213/216             |
|     |                   | 토큰·비용(결과행)                                                    | `task_outcomes.totalCost/totalInputTokens`                |           🔴 **29/29 전부 0**            |
|     |                   | 재시도·와치독 재스폰                                                 | `events` event=`agent:restarted` (`metadata.attempt`)     |           🟡 **taskId 미부착**           |
|     |                   | 재시도(결과행)                                                       | `task_outcomes.retriesCount`                              |            🔴 **하드코딩 0**             |
| ④   | **머지 결과**     | 머지 성사·변경규모·변경유형                                          | `events` event=`task:merged` (**PR#480**)                 |          🟣 **구현완료·미유입**          |
|     |                   | 충돌·반려·CI·재작업률                                                | —                                                         | 🔴 **미수집**(PR#480 후속으로 명시 유예) |
| ⑤   | **학습 라벨**     | 품질(성공/실패)                                                      | `task_outcomes.success`                                   |          🔴 **상수 TRUE**(§3.1)          |
|     |                   | 비용                                                                 | `cost_logs` 조인으로 산출 가능                            |                    🟢                    |
|     |                   | 재작업률                                                             | —                                                         |              🔴 **미수집**               |

🟢 라이브·데이터 있음 · 🟡 있으나 품질 결함 · 🔴 미수집/미작동 · 🟣 코드 완료, 유입 대기

**읽는 법**: ②(결정)는 튼튼하고 ③의 비용도 살아있다. 무너진 건 **⑤(라벨)** 과 ③의 결과행이다. 라벨 없는 특징은 학습에 못 쓴다.

---

## 2. 수집 파이프라인과 적재 지점

### 2.1 전체 흐름

```
                     [ Electron 메인 프로세스 ]
                                │
   ┌────────────────────────────┼────────────────────────────┐
   │                            │                            │
① 스폰 시점                ② 디스패치 결정 시점          ③ 비용 감지 시점
agent-manager.ts:891       bridge-server.ts               main.ts:2184
promptHash/promptLength    :1670 reuse / :1744 restart     taskId 스탬프
                           :1853 spawn
   │                            │                            │
   └────────────┬───────────────┴────────────────────────────┘
                ▼
        preload IPC → App.tsx:289 (renderer bridge)
                ▼
   ╔═══════════════════════════════════════════════╗
   ║  초크포인트  telemetryService.ts:171-175       ║  ← 프라이버시 게이트
   ║   1) isTelemetryEnabled() 아니면 즉시 return    ║     (§3 참조)
   ║   2) anonymize() → scrubValue() 무조건 통과     ║
   ╚═══════════════════════════════════════════════╝
                ▼
        Firebase Callable Functions (v3/functions/src/index.ts)
                ▼
   ┌────────────────────────────────────────────────────────┐
   │  BigQuery  marblo-2253d.marblo_telemetry  (US)         │
   ├────────────────────────────────────────────────────────┤
   │  events            ← logTelemetryBatch  (:4139, ≤100)  │
   │  cost_logs         ← logCostBatch       (:4261)        │
   │  task_outcomes     ← logTaskOutcome     (:4457)        │
   │  agent_heartbeats  ← logHeartbeat       (:4504, ≤50)   │
   │  flow_executions   ← logFlowExecution   (:4547)        │
   └────────────────────────────────────────────────────────┘

   ※ 별도 경로: 태스크 DONE 전환 → taskService.ts:198 → logTaskOutcome
                 머지 성사     → worktree-ipc.ts:365 → recordMergeHistory (PR#480)
```

**주의**: `task_outcomes`와 `cost_logs`는 렌더러 서비스에서 **콜러블을 직접 호출**하므로 위 초크포인트를 통과하지 않는다. 두 경로 모두 구조화된 숫자/ID만 실어 실질 노출은 낮지만, **서버측 리덕션은 없다**(§4 잔여 리스크).

### 2.2 3대 적재 시점

| 시점                 | 트리거 코드                                                        | 이벤트/테이블                  | 실측                                  |
| -------------------- | ------------------------------------------------------------------ | ------------------------------ | ------------------------------------- |
| **디스패치 결정 시** | `bridge-server.ts:1670/1744/1853` → `emitDispatchDecision` `:2093` | `events` / `dispatch:decision` | **937건** (2026-07-12~, 9유저, 3모델) |
| **태스크 완료 시**   | `taskService.ts:168` — **DONE 전환에서만**                         | `task_outcomes`                | **29건** (2유저, 최근 5일 0건)        |
| **머지 이벤트 시**   | `worktree-ipc.ts:365-389` → `recordMergeHistory` (`main.ts:1869`)  | `events` / `task:merged`       | **0건** (PR#480 OPEN·릴리스 대기)     |

### 2.3 조인키 — taskId

전 테이블 공통 조인키는 `taskId`. **조인 성사 실측이 이 문서의 핵심 수치다**:

```sql
-- 실행일 2026-07-18
dispatch_tasks = 216   -- dispatch:decision 이 남긴 distinct taskId
outcome_tasks  =  29   -- task_outcomes  의 distinct taskId
joined_cost    = 213   -- dispatch ∩ cost_logs      → 98.6%  🟢
joined_outcome =   1   -- dispatch ∩ task_outcomes  →  0.5%  🔴
```

```
   dispatch:decision (216 tasks) ──── 98.6% ────▶ cost_logs   ✅ 비용은 붙는다
             │
             └───────────────────── 0.5% ──────▶ task_outcomes ❌ 결과가 안 붙는다
                                                      ▲
                                    학습 가능한 완결행 = 1건
```

즉 **"어떤 결정을 내렸나"와 "얼마 썼나"는 알지만, "그래서 잘 됐나"를 모른다.** 라우팅 학습은 정확히 이 세 번째를 필요로 한다.

---

## 3. 왜 라벨이 안 쌓이는가 — 구조적 결함 3가지

### 3.1 결함 A — 성공만 기록한다 (음성 라벨 0)

`task_outcomes` 행은 **DONE 전환에서만** 생성되고, `success`는 `true` 상수다 (`taskService.ts:208`). FAILED·BLOCKED·취소·방치는 **한 줄도 남지 않는다**.

```
실측: task_outcomes 29건 중 success = TRUE 29건 (100%)
```

분류 모델은 양성/음성 대비로 학습한다. **음성 클래스가 0이면 ML-1(모델 자동선택)은 학습 자체가 불가능**하다. 설계문서 체크리스트에 없는 항목이며, 라벨 수를 늘려도 해결되지 않는 **종류의** 문제다.

### 3.2 결함 B — 결과행 필드가 비어 있거나 의미가 오염됐다

| 필드                           | 코드                                        | BQ 실측                          |
| ------------------------------ | ------------------------------------------- | -------------------------------- |
| `taskType`                     | `taskService.ts:203` 하드코딩 `null` (TODO) | 29/29 NULL                       |
| `retriesCount`                 | `taskService.ts:216` 하드코딩 `0`           | 합계 0                           |
| `totalCost`                    | 에이전트 **생애 누적**(태스크별 아님)       | 29/29 **0 또는 NULL**            |
| `totalInputTokens`             | 동상                                        | 29/29 **0**                      |
| `model`                        | `detectedModelId ?? model ?? null`          | 24/29 NULL                       |
| `taskComplexity`               | `task.priority` 대용                        | 채워짐(단, 복잡도 아님)          |
| `errorCategory`·`promptLength` | 서버는 받는데 **클라가 안 보냄**            | 전부 NULL                        |
| `durationMs`                   | 태스크 생성→DONE **벽시계**                 | 중앙값 **7.3시간**, 최대 148시간 |

`durationMs` 중앙값 7.3시간은 에이전트 작업시간이 아니라 **티켓 리드타임**이다. 비용 예측(ML-3)의 목표변수로 쓰면 사람이 티켓을 언제 닫았는지를 학습하게 된다.

**결과적으로 ML-1/ML-3에 실제로 투입 가능한 행 = 0건.** (29건은 존재하지만 목표변수·특징이 모두 비었다.)

### 3.3 결함 C — 재시도/크래시가 태스크에 안 붙는다

```
실측: agent:crashed 820건 · agent:restarted 987건
      그중 taskId 가 붙은 것 = 0건 (양쪽 다)
```

와치독 재스폰·크래시루프는 **품질 라벨의 핵심 신호**인데(재시도 많음 = 그 모델이 이 태스크에 안 맞음), agentId로만 관측되어 태스크에 귀속되지 않는다. `task_outcomes.retriesCount`도 하드코딩 0이라 이 신호는 어디에도 도달하지 못한다.

### 3.4 이것이 PR#480의 존재 이유

세 결함 모두 **"태스크 완료 경로"**에 몰려 있다. PR#480은 그 경로를 우회해 **머지라는 별개의 사실**에서 라벨을 뽑는다. 머지는 사람이 실제로 수용했다는 뜻이라 **품질 라벨로서 DONE 클릭보다 강하다**.

---

## 4. 프라이버시 — 파생 특징만, 원문 코드/diff 게이트

### 4.1 3중 방어

**① 원천 차단 — 애초에 파생값만 만든다**

| 원문          | 실제 전송값                                                                                          |
| ------------- | ---------------------------------------------------------------------------------------------------- |
| 프롬프트 본문 | sha256 해시 + 길이(정수)만 (`agent-manager.ts:887-890`)                                              |
| diff 본문     | 파일수·라인±·경로파생 카테고리만 (PR#480)                                                            |
| 커밋 메시지   | `git show --format=` 로 헤더 자체를 제거                                                             |
| 파일 경로     | `classifyChangeType()` 입력으로만 쓰고 **메인 프로세스에서 폐기** — 페이로드·Firestore 어디에도 없음 |

PR#480 가드 주석 (`merge-features.ts:47-51`):

> "These are DERIVED metrics only — counts and a path-shape category — never the raw diff or file contents. Privacy gate: no code text ever leaves the machine; a squash-merged commit yields only 'N files, +X/-Y lines, looks like a docs/test/config/code change'."

**② 초크포인트 스크럽** — `telemetryService.ts:171-175`, 큐 적재 **전** 무조건 통과

- `anonymize()`: metadata에서 `senderId`/`userId`/`uid`/`email` 삭제
- `scrubValue()` (`lib/telemetry/scrub.ts`, 최대 깊이 8):
  - `prompt|initialPrompt|message|userInput|content|raw_input` 키는 **마스킹이 아니라 필드째 삭제**
  - `_KEY|_TOKEN|_SECRET|^MARBLO_|^ANTHROPIC_|^OPENAI_|^GOOGLE_` → `<REDACTED>`
  - API키→`<API_KEY>`, 이메일→`<EMAIL>`, 전화→`<PHONE>`, 홈경로→`<USER_HOME>`

**③ 비식별 식별자** — 5개 콜러블 모두 인증은 요구하되 **익명 `clientId`**를 적재한다.

### 4.2 유저 통제

`firstPartyGate.ts:29-34` 기준 **default-ON**(`VITE_DISABLE_TELEMETRY=1`로 킬), `localStorage: marblo.telemetry.enabled`로 유저 오버라이드. **옵트아웃 시 전송량 0**이며, 이때도 Firestore `merge_history` 감사 기록은 로컬 계약대로 유지된다(§5).

### 4.3 잔여 리스크 (숨기지 않고 기록)

1. **`cost_logs`만 실 uid를 적재한다** (`index.ts:4275` — 나머지는 clientId). 과금 데이터라는 의도된 비대칭이나, "전부 비식별"이라고 대외 표현하면 **부정확**하다.
2. **서버측 리덕션 없음.** `logTaskOutcome`/`logCostBatch`는 초크포인트를 우회한다. 현재 페이로드가 숫자/ID뿐이라 실피해는 낮지만, 향후 이 경로에 문자열 필드를 추가하면 **무방비**다.
3. 스크럽은 **allowlist가 아니라 denylist**다. 새 필드는 기본적으로 통과되므로, 필드 추가 시 스크럽 규칙 동반 검토가 필요하다.

---

## 5. audit 웨지와의 단일소스 이중사용

전략 문서상 **오케스트레이션 엔진 = 해자(primary), audit = 수익화 웨지**다. 머지결과 캡처는 이 둘을 **한 번의 계산으로 동시에** 충족한다.

```
      머지 성사 (worktree-ipc.ts:365)
                │
        git show --numstat -M   ← 딱 1회 실행
                │
        parseDiffNumstat + classifyChangeType   ← 딱 1회 계산
                │
        recordMergeHistory (main.ts:1869)
                │
        ┌───────┴────────┐
        ▼                ▼
  ① task:merged     ② Firestore
    → BQ events        merge_history
  ─────────────     ──────────────
  SLM 학습 라벨      audit provenance
  (파생 특징)        (누가·언제·무엇을 머지했나)
```

**설계상 이점**

- **정합성**: 두 사본이 같은 계산에서 나오므로 "감사 기록과 학습 데이터가 다르다"가 구조적으로 불가능하다.
- **비용 0**: 라벨을 위해 별도 잡·별도 git 호출을 돌리지 않는다.
- **실패 격리**: `mergedCommitDiffStat`는 `git` 실패 시 `null` 반환(15초 타임아웃) — **머지 자체를 절대 깨지 않는다**. 텔레메트리 전송은 `authReady` 대기 **전에** 동기 발화되어 인증 지연이 라벨을 삼키지 않는다.
- **제품 서사와 일치**: "머지를 감사 가능하게 만드는 기능"이 곧 "라우팅을 똑똑하게 만드는 데이터"를 낳는다. 유저에게 파는 가치와 우리가 얻는 자산이 같은 행동에서 나온다.

**정직한 한계**: `task:merged`는 `taskId`가 없으면 **전송 자체를 스킵**한다(`telemetry.ts` 조인키 가드). 애드혹 워크트리 머지는 audit에는 남고 학습 라벨에는 안 남는다 — 조인 불가능한 라벨을 만들지 않겠다는 의도적 선택이다.

---

## 6. SLM 학습 흐름 — 5단계

`slm-router-summary.md`의 판정("지금 GO 아님, 데이터 300건 후 룰 기반 PoC")은 **여전히 유효하며, 오히려 더 보수적으로 봐야 한다** — 그 문서가 가정한 300건은 "유효 라벨"인데 현재 유효 라벨은 0이기 때문이다.

```
[1] 데이터 축적          [2] 룰기반 PoC         [3] BQ ML/SLM 학습
    현재 위치 ▼              300+ 유효라벨          8~12주
 ┌──────────────┐      ┌──────────────┐      ┌──────────────┐
 │ 결함 A/B/C   │─────▶│ 휴리스틱 규칙 │─────▶│ 분류/회귀     │
 │ 수정 + 릴리스│      │ 오프라인 검증 │      │ 모델 학습     │
 └──────────────┘      └──────────────┘      └──────────────┘
                                                     │
        [5] shadow → flip          [4] dispatch-scoring 위 학습층
      ┌──────────────┐            ┌──────────────────────────┐
      │ 예측만 기록  │◀───────────│ 기존 WEIGHTS 유지 +       │
      │ → 승률 검증  │            │ 학습 보정치를 위에 얹음   │
      │ → 점진 flip  │            └──────────────────────────┘
      └──────────────┘
```

**[1] 데이터 축적 (선행조건, 미완)** — 결함 A/B/C 수정 + PR#480 머지 + 3.0.17 릴리스. 이게 안 되면 이후 단계는 전부 무의미.

**[2] 룰기반 PoC (300+ 유효 라벨)** — 학습 없이 `task_outcomes`+`task:merged` 집계로 규칙을 뽑는다. 예: "docs 변경유형 × simple 복잡도 → 저가 모델 승률 X%". **ML 없이 즉시 가치가 나오고, 동시에 ML의 성능 하한선(baseline)을 정의한다.** 여기서 룰이 못 이기면 ML도 못 이긴다.

**[3] BQ ML / SLM 학습 (8~12주)** — 설계문서 §8 템플릿 그대로 사용 가능:

- ML-1 모델선택: `LOGISTIC_REG` — 입력 role·complexity·changeType·filesChanged·linesChanged·promptLength → 출력 최적모델+성공확률
- ML-3 비용예측: `LINEAR_REG` — 목표변수는 `task_outcomes.durationMs`가 아니라 **`cost_logs` 조인 실비용**(결함 B 회피)

**[4] dispatch-scoring 위 학습층** — `dispatch-scoring.ts`(898줄)는 현재 손튜닝 가중합이다: `WEIGHTS`(role/loadBalance/costEfficiency) + `MODEL_BASE_SCORE` + `MODEL_TAG_BONUSES/PENALTIES` + `COST_EFFICIENCY_WEIGHT`. **이 구조를 교체하지 말고 위에 보정층으로 얹는다.**

- 근거: 손튜닝 규칙은 설명가능하고 이미 검증됐다. 학습층이 죽어도 기존 점수로 안전 폴백된다.
- `dispatch:decision`이 이미 `perModelScores`·`agentScore`를 남기므로 **학습층 예측 vs 현행 점수의 차이를 사후 비교할 수 있다** — shadow 모드 인프라가 사실상 이미 있다.

**[5] shadow → flip** — 학습층 추천을 **기록만** 하고 실제 배정은 기존 로직 유지 → 승률/비용 비교 → 우세 확인 후 태스크 유형별 점진 flip. 전사 리스크: 라우팅 회귀는 전략 서사(라이브 오케 엔진 = 해자)를 자기반박한다. **shadow 없는 flip은 금지.**

---

## 7. ★충분한 데이터 기준

### 7.1 "유효 라벨"의 정의 (먼저 합의할 것)

숫자를 세기 전에 무엇을 세는지 정해야 한다. **유효 라벨 = 아래 4개를 모두 만족하는 한 행**:

1. `taskId`로 **디스패치 결정 ↔ 결과**가 실제 조인됨
2. 결과가 **성공/실패 양쪽**을 표현함 (음성 클래스 존재)
3. **비용/토큰이 태스크 귀속**됨 (에이전트 생애 누적 아님)
4. 태스크 특징(complexity·changeType·규모)이 **NULL 아님**

> **현재 유효 라벨 = 0건.** (raw 행은 29건이나 조건 1·2·3·4를 모두 위반)

### 7.2 목표별 최소 요건

| 목표                     | 최소 유효 라벨 | 다양성 요건                                   | 왜 이 수치인가                                                                 |
| ------------------------ | -------------: | --------------------------------------------- | ------------------------------------------------------------------------------ |
| **룰기반 PoC** (§6-2)    |        **300** | 모델 3종 × 복잡도 3단 = 9셀, **셀당 ≥30**     | 셀당 30이 비율차 검정의 실무 하한. 9×30=270 → 300                              |
| **ML-1 모델선택** (분류) |      **1,000** | + 실패 라벨 **≥15%**, 모델별 ≥150             | 특징 6~8개 분류에 클래스당 수백. 실패 15% 미만이면 "항상 성공" 예측이 이겨버림 |
| **ML-3 비용예측** (회귀) |        **500** | changeType 4종 각 ≥50, 비용 분포 2자릿수 스팬 | 회귀는 분류보다 적게 필요하나 **분산**이 필요                                  |
| **SLM 라우팅 운영**      |     **3,000+** | + 유저 **≥20명**, 리포 **≥5개**               | 1인 워크플로 과적합 방지 — 현재 최대 결측                                      |

### 7.3 다양성 — 현재 커버리지 실측

| 축               | 요건          | 현재 (dispatch 937건 기준)                                   | 판정 |
| ---------------- | ------------- | ------------------------------------------------------------ | :--: |
| 모델             | 3종 각 ≥15%   | claude 388 / gpt 537 / antigravity 17 → **antigravity 1.8%** |  🔴  |
| 복잡도           | 3단 모두      | simple 28 / standard 740 / complex 174 → **simple 3.0%**     |  🟡  |
| reuse vs spawn   | 양쪽 유의미   | spawn 940 / reuse 2 / restart 0 → **reuse 0.2%**             |  🔴  |
| 명시 vs 스코어링 | 스코어링 ≥30% | explicit 921 / scored 21 → **스코어링 2.2%**                 |  🔴  |
| 유저             | ≥20명         | **9명** (결과행은 2명)                                       |  🔴  |
| 변경유형         | 4종           | — (task:merged 미유입)                                       |  ⬜  |

> 스냅샷 주의: `dispatch:decision`은 실시간 유입 중이라 총계가 집필 중 937 → **942**로 증가했다(위 표는 942 기준). 비율은 안정적이나 절대수는 재조회 시 달라진다.

**가장 위험한 줄은 4행이다.** 디스패치의 97.8%가 **유저가 모델을 명시**해서 스코어링이 아예 우회됐다(`decisionReason: "Explicit model 'claude' requested — scoring bypassed"`). 이 데이터로 학습하면 라우터가 아니라 **"사람이 무엇을 고르는지"를 흉내내는 모델**이 나온다. SLM의 목적이 사람보다 나은 배정이라면, 사람이 고른 경우만 있는 데이터는 원리적으로 그 목적에 못 쓴다.

> **함의**: 라벨 수만 채우는 건 부족하다. **explicit 우회 비율을 낮추거나**, 최소한 스코어링이 실제로 작동한 케이스를 별도 집계해야 한다.

### 7.4 시간 — 언제쯤 모이나

관측된 처리량으로 계산 (단, 위 다양성 결함이 해소된다는 가정):

```
관측 기준: cost_logs 기준 실작업 태스크 234건 / 약 90일 / 헤비유저 1명
        ≈ 2.5 태스크/일/활성유저   (보수적 추정)
```

| 목표       | 필요 라벨 |   활성 10명 |   활성 30명 |   활성 50명 |
| ---------- | --------: | ----------: | ----------: | ----------: |
| 룰기반 PoC |       300 | **약 12일** |      약 4일 |      약 2일 |
| ML-1 분류  |     1,000 |     약 40일 | **약 13일** |      약 8일 |
| SLM 운영   |     3,000 |    약 120일 |     약 40일 | **약 24일** |

**해석**: 라벨 축적은 **시간 문제가 아니라 활성 유저 수 문제**다. 유저 30명이면 룰PoC까지 1주일, ML-1까지 2주면 닿는다. 반대로 지금처럼 결과행 유저가 2명이면 **영원히 안 모인다**. 데이터 전략의 실제 병목은 ML이 아니라 **배포·활성화**다.

### 7.5 착수 게이트 (체크리스트)

다음이 전부 초록이 되기 전에는 SLM 학습에 리소스를 넣지 않는다:

- [ ] 결함 A 해소 — 실패/차단도 `task_outcomes` 행 생성 (음성 라벨 ≥15%)
- [ ] 결함 B 해소 — `taskType` 실값, `totalCost`를 `cost_logs` 조인 실비용으로, `durationMs`를 작업시간으로
- [ ] 결함 C 해소 — `agent:restarted`/`crashed`에 `taskId` 부착 → `retriesCount` 실값
- [ ] PR#480 머지 + **3.0.17 릴리스** → `task:merged` 실유입 확인
- [ ] dispatch↔outcome **조인율 ≥80%** (현재 0.5%)
- [ ] 유효 라벨 **300건** + 9셀 각 ≥30
- [ ] 스코어링 경로(비-explicit) 라벨 **≥100건**

---

## 8. 현황과 유입 시점

### 8.1 BigQuery 실측 (2026-07-18)

| 테이블             |     행 수 | 기간               | 평가                    |
| ------------------ | --------: | ------------------ | ----------------------- |
| `events`           |    62,218 | 2026-04-18 ~ 07-18 | 🟢 건강                 |
| `cost_logs`        |    54,258 | 〃                 | 🟢 taskId 조인 98.6%    |
| `agent_heartbeats` | 1,329,756 | 〃                 | 🟢 (ML-4 이상탐지용)    |
| `task_outcomes`    |    **29** | 06-15 ~ 07-14      | 🔴 **유효 0건**         |
| `flow_executions`  |     **0** | —                  | 🔴 코드는 있으나 유입 0 |

이벤트 분포 상위: `token:usage` 54,047 · `agent:spawned` 3,588 · `agent:restarted` 982 · **`dispatch:decision` 937** · `session:started` 863 · `agent:crashed` 815 · `task:completed` **29** · `task:merged` **0**.

**설계문서 대비 정정**: 테이블 2개→**5개**, 이벤트 연결률 "7/15"→**20/21**(정의 21종 중 `chat:active_users` 하나만 dead). 설계문서 §2·§9의 현황 수치는 **전부 stale**이므로 인용 금지.

### 8.2 최근 7일 — 병목의 시각화

| 날짜  | dispatch | spawns | **task:completed** | 유저 |
| ----- | -------: | -----: | -----------------: | ---: |
| 07-18 |      106 |    213 |              **0** |    3 |
| 07-17 |      628 |  1,202 |              **0** |    5 |
| 07-16 |       53 |    179 |              **0** |    4 |
| 07-15 |       51 |     97 |              **0** |    8 |
| 07-14 |       53 |    134 |                  2 |   23 |
| 07-13 |       39 |     67 |              **0** |    1 |
| 07-12 |       11 |     14 |                 25 |    1 |

**하루 수백~천 건 스폰이 도는데 결과 라벨은 0이다.** 앞단은 과열, 뒷단은 정지 — §3의 결함이 운영 데이터로 그대로 드러난다.

### 8.3 유입 시점

| 항목                   | 상태           | 유입 조건                                      |
| ---------------------- | -------------- | ---------------------------------------------- |
| `dispatch:decision`    | 🟢 **유입 중** | 이미 라이브 (07-12~)                           |
| `cost_logs.taskId`     | 🟢 **유입 중** | 이미 라이브                                    |
| `task:merged` (PR#480) | 🟣 코드 완료   | **PR#480 머지 → 3.0.17 릴리스 → 유저 머지 시** |
| 유효 라벨              | 🔴 0           | 위 + **결함 A/B/C 수정 필수**                  |

**핵심**: PR#480은 **backend/functions 배포가 필요 없다**(BQ 마이그레이션 0 — `taskType`/`filesChanged`/`linesChanged`가 이미 스키마에 존재하고 서버 writer가 이미 모든 이벤트에 이 키를 보낸다). 순수 클라이언트 변경이므로 **릴리스가 유일한 게이트**다. 서명 릴리스가 안 나가면 `firebase deploy`만으로는 실유저 데이터가 1건도 안 생긴다.

---

## 9. 결론 및 권고

### 사장님이 기억할 3가지

1. **설계문서(2026-04)로 판단하지 마시라.** 거기 적힌 "만들어야 할 것"의 대부분은 이미 만들어졌다. 진짜 문제는 그 문서에 **없던** 문제다.
2. **지금 필요한 건 ML 투자가 아니라 3줄짜리 수리다.** 결함 A(성공만 기록)·B(필드 하드코딩 NULL)·C(재시도 미귀속)는 각각 작은 수정이고, 이게 안 되면 라벨은 몇 년이 지나도 0이다.
3. **라벨 축적 속도는 활성 유저 수에 정비례한다.** 유저 30명이면 룰PoC까지 1주. 즉 **데이터 전략의 병목은 3.0.17 릴리스와 활성화**이지 모델링이 아니다.

### 권고 순서

| 우선순위 | 작업                                 | 근거                                            |
| -------- | ------------------------------------ | ----------------------------------------------- |
| **P0**   | 결함 A/B/C 수정 (별도 티켓)          | 이것 없이는 이후 전부 무의미                    |
| **P0**   | PR#480 머지 + 3.0.17 릴리스          | 라벨 유입의 유일한 게이트                       |
| **P1**   | `flow_executions` 유입 0 원인 조사   | 코드는 있는데 데이터가 없다 = 미진단 결함       |
| **P1**   | explicit 우회 97.8% 대응             | 스코어링 라벨 없이는 라우터 학습 불가           |
| **P2**   | 룰기반 PoC (유효 300 도달 후)        | ML의 baseline 정의 + 즉시 가치                  |
| **P2**   | `cost_logs` uid 비대칭 대외표현 정리 | "전부 비식별"은 부정확                          |
| **보류** | SLM 라우터 본체                      | `slm-router-summary.md` 판정 유지 — **GO 아님** |

---

## 부록 A. 근거 파일 색인

| 주제                     | 위치                                                                                |
| ------------------------ | ----------------------------------------------------------------------------------- |
| 결과행 writer (결함 A/B) | `v3/src/services/taskService.ts:168, 198-222`                                       |
| 디스패치 결정 발화       | `v3/electron/bridge-server.ts:1670, 1744, 1853, 2093`                               |
| 디스패치 페이로드 타입   | `v3/electron/telemetry.ts:159-205`                                                  |
| 손튜닝 스코어러          | `v3/electron/dispatch-scoring.ts` (898줄, `WEIGHTS` :70)                            |
| 프롬프트 해시/길이       | `v3/electron/agent-manager.ts:887-890`                                              |
| cost taskId 스탬프       | `v3/electron/main.ts:2184`                                                          |
| BQ 적재 콜러블 5종       | `v3/functions/src/index.ts:4139, 4261, 4457, 4504, 4547`                            |
| dispatch metadata 폴딩   | `v3/functions/src/index.ts:4075-4127`                                               |
| 텔레메트리 게이트        | `v3/src/lib/telemetry/firstPartyGate.ts:29-34`                                      |
| 초크포인트·익명화        | `v3/src/services/telemetryService.ts:153-175`                                       |
| 스크럽 규칙              | `v3/src/lib/telemetry/scrub.ts:31-81`                                               |
| **PR#480** diff 특징     | `v3/electron/merge-features.ts` (`parseDiffNumstat` :83, `classifyChangeType` :153) |
| **PR#480** 단일소스 지점 | `v3/electron/worktree-ipc.ts:365-389` → `v3/electron/main.ts:1869`                  |
| **PR#480** git 호출      | `v3/electron/worktree-manager.ts:316-327`                                           |

## 부록 B. 재현용 쿼리

```sql
-- 조인 성사율 (이 문서의 핵심 수치)
WITH d AS (SELECT DISTINCT taskId FROM `marblo-2253d.marblo_telemetry.events`
           WHERE event='dispatch:decision' AND taskId IS NOT NULL),
     o AS (SELECT DISTINCT taskId FROM `marblo-2253d.marblo_telemetry.task_outcomes`),
     c AS (SELECT DISTINCT taskId FROM `marblo-2253d.marblo_telemetry.cost_logs`
           WHERE taskId IS NOT NULL)
SELECT (SELECT COUNT(*) FROM d) dispatch_tasks,
       (SELECT COUNT(*) FROM o) outcome_tasks,
       (SELECT COUNT(*) FROM d JOIN o USING(taskId)) joined_outcome,
       (SELECT COUNT(*) FROM d JOIN c USING(taskId)) joined_cost;

-- 라벨 품질 (결함 A/B 확인)
SELECT COUNT(*) n, COUNTIF(success) ok, COUNTIF(taskType IS NULL) null_type,
       COUNTIF(totalCost IS NULL OR totalCost=0) zero_cost, SUM(retriesCount) retries,
       COUNT(DISTINCT userId) users
FROM `marblo-2253d.marblo_telemetry.task_outcomes`;

-- explicit 우회 비율 (다양성 결함)
SELECT JSON_VALUE(metadata,'$.explicitModel') explicit, COUNT(*) c
FROM `marblo-2253d.marblo_telemetry.events`
WHERE event='dispatch:decision' GROUP BY 1;
```

> 실행 방법: `gcloud auth application-default print-access-token`(john.kim ADC) + BigQuery REST,
> 헤더에 `x-goog-user-project: marblo-2253d` 필수. 현 gcloud 활성 계정은 temu SA라 직접 조회 불가.
