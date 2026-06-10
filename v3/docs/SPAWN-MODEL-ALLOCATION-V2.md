# 스폰 / 태스크 할당 로직 v2 — 모델 믹스·단계분할·Fable5 에스컬레이션

**Status:** 설계문서 (doc-first). 코드 미구현.
**Target:** v3.x — 하네스 모델 할당 고도화
**Owner:** marblo backend / harness
**Spec date:** 2026-06-10
**구현 티켓:** `kYRmosC78fW7wUOyaAKG` (이 문서 사용자 리뷰 후 착수)
**관련 코드:** `v3/electron/agent-config.ts`, `v3/electron/mcp-server/tools.ts`, `v3/electron/bridge-server.ts`, `v3/electron/agent-manager.ts`, `v3/electron/dispatch-scoring.ts`
**관련 문서:** `PRICING-AND-COST-SAFETY-SPEC.md`(비용 안전망), `MISSIONS-DEFERRED-COST-AWARE-DESIGN.md`(미션 비용 인지)

> ⚠️ **이 문서는 설계만 다룬다.** `.ts` 변경은 구현 티켓 `kYRmosC78fW7wUOyaAKG`에서 진행한다.
> 아래 의사코드는 구현 방향을 못 박기 위한 것이며 그대로 복붙용 코드가 아니다.

---

## 0. 한 줄 요약

complexity 한 축으로 단일 에이전트·단일 모델만 고르던 현행 할당 로직을, **(1) 최상위 모델을 env/config 주입으로 견고화**(하드코딩 제거 + Fable5 지원 + CLI 버전가드 + 그레이스풀 폴백), **(2) complex 작업에 Claude 최상위 × Codex 믹스(교차검증/역할분담, opt-in·비용게이트)**, **(3) complex 작업의 단계분할 + 스텝 난도별 모델 매칭**, **(4) ultracode/ultrareview 에스컬레이션 훅**으로 확장한다.

---

## 1. 현행 요약 + 한계

### 1.1 현행 데이터 흐름 (코드 기준)

```
LLM/오케스트레이터
   │  dispatch_task(role, instruction, complexity, model?, tags?)   ← MCP tool (tools.ts)
   ▼
mcp-server/tools.ts
   │  complexity enum = "simple" | "standard" | "complex" (default "standard")
   │  HTTP POST /dispatch-task → bridge (complexity || "standard")
   ▼
bridge-server.ts  dispatchTaskInner()
   │  complexity === "simple"  → action="logical" (스폰 안 함, 내부 서브에이전트 권고)
   │  그 외                     → reuse/restart/spawn 결정 후 complexity 전달
   ▼
agent-manager.ts  spawnNewAgent()  →  AgentLaunchParams.complexity
   ▼
agent-config.ts  getLaunchConfig(..., complexity)
   │  buildCLICommand() → modelTierForComplexity(model, complexity)
   ▼
modelTierForComplexity(model, complexity):
   claude:  simple → "sonnet",  standard | complex → "opus"
   gpt:     simple → "low",     standard → "medium",  complex → "high"
   → claude 는 `--model <claudeModel>`, codex 는 `-c model_reasoning_effort="<level>"` 로 조립
```

별개 축으로 **"어느 프로바이더를 쓸지"**(claude vs codex vs gemini vs antigravity)는 `dispatch-scoring.ts`의 `scoreModels()` / `scoreAgents()`가 태그·비용효율·부하균등·라운드로빈으로 결정한다. **complexity(모델 티어/레벨)와 모델 선택(프로바이더)은 현재 서로 독립적인 두 축**이다.

### 1.2 현행 정책 요약 (품질 우선, 최근 커밋 #48/#49)

| complexity | claude   | codex(gpt) reasoning | 실행 형태                  |
| ---------- | -------- | -------------------- | -------------------------- |
| `simple`   | sonnet   | low                  | logical(내부 서브에이전트) |
| `standard` | **opus** | medium               | 단일 물리 에이전트         |
| `complex`  | **opus** | high                 | 단일 물리 에이전트         |

- `complexity === undefined` → override 없음(오케스트레이터 등 기본 모델 상속).
- 기본(standard)은 최상위 유지, 작은 작업(simple)만 한 단계 하향 = "quality-first" 정책.

### 1.3 한계 (v2가 푸는 문제)

1. **복잡 작업도 단일 에이전트·단일 모델로만 처리된다.** `complex`여도 결국 `opus` 하나(또는 codex high 하나)가 끝까지 혼자 작업한다. 교차검증·역할분담·다관점이 없다.
2. **최상위 모델이 문자열 하드코딩이다.** `modelTierForComplexity`가 리터럴 `"opus"`를 박아 둔다. 더 강한 모델(예: Fable5)이 나와도 코드를 고치지 않으면 못 쓰고, 모델별 폴백/버전가드 분기 지점이 없다.
3. **complex 작업의 내부 분해가 없다.** 설계·기계적 변경이 한 태스크에 섞여 있어도 통째로 최상위 모델에 던진다 — 기계적 스텝까지 비싼 모델이 처리(비용 낭비)하거나, 반대로 설계 난도를 작은 모델이 떠안는다(품질 저하).
4. **에스컬레이션 경로가 코드에 없다.** "이건 단일 에이전트로 안 된다 → 멀티에이전트 워크플로(ultracode)" 또는 "리뷰를 더 깊게(ultrareview)" 같은 상위 경로로 넘기는 훅이 없다.

---

## 2. 모델 티어 v2

complexity → (프로바이더별 모델/레벨) 매핑을 아래로 재정의한다. **표의 모델/레벨 값은 전부 상수가 아니라 §3의 resolver를 거쳐 결정**된다(하드코딩 제거).

| complexity | 의미       | claude 티어                               | codex(gpt) reasoning | 실행 형태                              |
| ---------- | ---------- | ----------------------------------------- | -------------------- | -------------------------------------- |
| `simple`   | cheap      | sonnet                                    | low                  | logical(내부 서브에이전트) — 현행 유지 |
| `standard` | top-single | **TOP_CLAUDE**(기본 opus)                 | medium               | 단일 물리 에이전트 — 현행 유지         |
| `complex`  | top + 믹스 | **TOP_CLAUDE** + (opt-in) Codex high 믹스 | high                 | 단일 또는 믹스(§4) / 단계분할(§5)      |

핵심 변화:

- **`simple`/`standard`는 동작 의미 그대로 유지**(하위호환). 바뀌는 건 "opus"가 리터럴이 아니라 `resolveTopClaudeModel()` 결과라는 점뿐(기본값 opus라 무변동).
- **`complex`만 새 능력을 얻는다**: 최상위 모델 + (옵트인 시) 모델 믹스(§4) + (옵트인 시) 단계분할(§5). 어느 것도 켜지 않으면 현행과 동일하게 단일 최상위 모델로 동작 → **무옵션 = 무회귀(no regression)**.

> `TOP_CLAUDE`는 §3에서 정의하는, env/config로 주입되고 버전가드·폴백을 거친 "현재 사용 가능한 최상위 Claude 모델 id"다.

---

## 3. 최상위 모델 견고화 (★하드코딩 금지)

### 3.1 원칙

- `modelTierForComplexity` 내부의 리터럴 `"opus"`를 제거하고 **`resolveTopClaudeModel()`** 결과로 치환한다.
- 최상위 모델은 **환경변수/config로 주입**한다. 기본값은 `"opus"`(현행과 동일 → 무변동).
- 주입된 모델이 **CLI 버전·런타임 제약을 통과하지 못하면 `"opus"`로 그레이스풀 폴백**한다(절대 spawn 실패로 끝내지 않는다).

### 3.2 새 env / config

| 키                           | 기본값    | 의미                                                                              |
| ---------------------------- | --------- | --------------------------------------------------------------------------------- |
| `MARBLO_TOP_CLAUDE_MODEL`    | `opus`    | complex/standard에서 쓸 최상위 Claude 모델 id. `fable`/`claude-fable-5` 지정 가능 |
| `MARBLO_TOP_CODEX_REASONING` | `high`    | complex에서 쓸 Codex 최상위 reasoning effort                                      |
| `MARBLO_FABLE5_MIN_CLI`      | `2.1.170` | Fable5 최소 요구 claude CLI 버전(버전가드 임계값)                                 |

> env 우선, 없으면 향후 도입 가능한 사용자 config(예: `~/.marblo/model-policy.json`)를 읽고, 그것도 없으면 기본값. 구현 단순화를 위해 **1차 구현은 env만** 지원하고 config 파일은 후속으로 둔다.

### 3.3 Fable5 지원 (★검증값만 사용 — 임의 창작 금지)

아래는 **검증된 사실값**이며, 이 문서/구현은 이 값들 외의 Fable5 사양(버전·가격·동작)을 창작하지 않는다.

| 항목          | 검증값                                                             |
| ------------- | ------------------------------------------------------------------ |
| 모델 id       | `claude-fable-5`                                                   |
| alias         | `fable` (→ `claude-fable-5`로 정규화)                              |
| 최소 CLI 버전 | claude CLI **≥ 2.1.170** (현재 설치 버전 **2.1.163** → **미지원**) |
| 가격          | **$10 / $50** per 1M 토큰 (input / output)                         |
| 안전분류 동작 | Anthropic 안전분류 트리거 시 **서버측에서 Opus 4.8로 자동 폴백**   |

- **alias 정규화:** `fable` 입력은 `claude-fable-5`로 접는다. (모델 _프로바이더_ 정규화 `normalizeModel()`(dispatch-scoring.ts)과는 다른 층 — 이건 claude 내부의 _모델 id_ alias다. claude 계열 모델 id alias 테이블을 `agent-config.ts`에 둔다.)
- **안전분류 자동 폴백 명시:** Fable5로 보낸 요청이라도 Anthropic 안전분류가 트리거되면 응답이 Opus 4.8로 자동 폴백된다. 이는 **우리 코드가 제어할 수 없는 서버측 동작**이므로, 비용/동작이 조용히 바뀔 수 있음을 (a) 관측(텔레메트리, §8)으로 잡고 (b) 사용자 문서에 명시한다.

### 3.4 ★CLI 버전가드 + 그레이스풀 폴백

`resolveClaudeBinary()`(agent-config.ts)는 이미 설치된 claude의 **버전 문자열을 파싱해 반환**한다(`ResolvedCli.version`). 이를 재활용해 버전가드를 만든다 — 별도 프로세스 spawn·네트워크 불필요.

폴백 규칙:

1. `MARBLO_TOP_CLAUDE_MODEL`이 Fable5(`fable`/`claude-fable-5`)면 설치된 claude CLI 버전을 `MARBLO_FABLE5_MIN_CLI`(기본 2.1.170)와 비교한다.
2. **미달 또는 버전 파싱 실패 시 → `"opus"`로 폴백**하고 그 사실을 로깅(§8)한다.
3. spawn 후 런타임에서 Fable5가 거부/실패(미지원 모델 오류 등)해도 → 동일하게 `"opus"`로 재시도하는 경로를 둔다(2차 안전망, §8.3).
4. Fable5가 아닌 임의 모델 id가 주입돼도 동일한 골격(검증 못 하면 opus 폴백)을 따른다.

> 현재 dev 환경 claude=2.1.163(< 2.1.170)이므로, 이 문서를 구현해도 **지금 당장은 Fable5가 자동으로 opus로 폴백**된다. CLI가 2.1.170+로 업데이트되면 비로소 Fable5가 활성화된다. 이 "기본 안전" 동작이 의도된 것이다.

### 3.5 비용 게이트 연동

- Fable5 단가 $10/$50 per 1M은 cost-tracker의 `MODEL_PRICING` 류 테이블/구독 인지(`dispatch-scoring.ts`의 `hasSubscriptionPlan`, `~/.marblo/subscription-plans.json`)와 연동한다.
- 참고: `dispatch-scoring.ts` 주석 기준 Opus 단가 레퍼런스는 ~$15/$75 per 1M. Fable5($10/$50)는 그보다 낮으나, **모델 믹스(§4)는 동시 2모델 = 비용 2배**이므로 비용 게이트의 핵심은 단가가 아니라 **믹스/단계 동시성**이다(§4.4, §8.2).

---

## 4. 모델 믹스 (complex 전용, opt-in)

complex 작업에 한해 Claude 최상위 + Codex(gpt-5.5 high)를 함께 투입한다. 두 모드:

### 4.1 (a) 교차검증 (cross-check)

- 같은 작업을 두 모델이 독립 수행하거나, 한 모델이 1차 산출 → 다른 모델이 적대적 검증(refute) → 불일치 시 사용자/오케에 에스컬레이션.
- 용도: 정확성이 중요한 설계/보안/마이그레이션. (memory: 결제 감사처럼 배포차단급 결함을 놓치면 안 되는 작업)

### 4.2 (b) 역할분담 (split-role)

- Claude 최상위 = 설계/리팩터/멀티파일(태그 보너스상 claude 강점), Codex high = 테스트/기계적 변경/github(codex 강점). `dispatch-scoring.ts`의 `MODEL_TAG_BONUSES`와 정합.
- 두 에이전트가 한 태스크의 다른 서브스텝을 병렬 처리(§5의 단계분할과 결합 가능).

### 4.3 트리거

- **complex 작업에서만** 활성화. simple/standard는 절대 믹스 안 함.
- **명시적 opt-in 플래그 필요**(기본 off). `dispatch_task`의 새 옵션 `mix`(§7.3) 또는 env `MARBLO_MODEL_MIX`.

### 4.4 비용 게이트 (★필수)

동시 2모델 = 토큰 비용 2배. 따라서:

1. `mix`는 `complexity === "complex"`에서만 허용(아니면 무시 + 경고 로깅).
2. opt-in 플래그가 명시돼야 발동(기본 off).
3. quota/플랜 게이트 통과 필요(§8.2) — free/pro 동시성 캡(`AGENT_CONCURRENCY_LIMIT`)과 미션 비용 인지(`MISSIONS-DEFERRED-COST-AWARE-DESIGN.md`)에 종속. 믹스는 슬롯 2개를 점유하므로 캡 계산에 그대로 반영된다.

---

## 5. 복잡 작업 단계분할 (complex 전용, opt-in)

complex 태스크를 하위 스텝으로 분해해 **스텝 단위로 dispatch**하고, 스텝 난도별로 모델을 매칭한다.

- **설계/아키텍처 스텝 → 최상위**(TOP_CLAUDE / codex high)
- **기계적/반복 스텝 → cheap**(sonnet / codex low, 또는 logical 내부 서브에이전트)

### 5.1 분해 주체

- 오케스트레이터(또는 미션 엔진)가 complex 태스크를 받으면, 분해 계획(스텝 배열)을 만들어 스텝별로 `dispatch_task`를 호출한다.
- 각 스텝은 자기 `complexity`/`model`/`tags`를 가질 수 있다 → 기존 dispatch 경로를 그대로 재사용(스텝 = 작은 태스크).
- **분해 자체는 LLM 비용을 추가로 쓴다.** memory(미션 비용 제약)에 따라 분해 판단은 가능한 한 결정적(룰/파이썬)으로, LLM 호출은 최소화한다. 1차 구현은 "오케가 dispatch_task에 `stages` 배열을 넘기면 백엔드가 순차/병렬 디스패치"하는 **수동 분해**만 지원하고, 자동 분해(LLM이 스스로 쪼개기)는 후속으로 둔다.

### 5.2 의존성 / 순서

- 스텝 간 순서가 있으면 기존 `dependsOn`/`dependsOnCompleted` 게이트(tools.ts dispatch의 patent claim 4 가드)를 그대로 사용한다.
- 순서 없는 스텝은 병렬 디스패치(동시성은 §8.2 캡에 종속).

---

## 6. 에스컬레이션 훅

단일 에이전트로 부족한 complex 작업을 상위 경로로 넘기는 두 훅. **둘 다 자동 남발 금지.**

### 6.1 ultracode (멀티에이전트 워크플로)

- 의미: 다수 서브에이전트를 결정적으로 오케스트레이션하는 워크플로(팬아웃 → 검증 → 합성).
- **opt-in 명시 트리거 시에만 발동.** 사용자가 "ultracode"를 명시했거나, 세션에 ultracode 모드가 켜져 있거나, 사용자가 직접 멀티에이전트 오케스트레이션을 요청한 경우에 한함. 그 외 "이득이 될 것 같다"는 추론만으로 자동 발동 금지.
- 할당 로직 연계: complex + 사용자 opt-in일 때, 백엔드는 단일 spawn 대신 ultracode 워크플로 경로를 **제안**할 수 있다. 발동은 명시 트리거에 묶는다.

### 6.2 ultrareview (`/code-review ultra`)

- 의미: 현재 브랜치(또는 GitHub PR)를 클라우드 멀티에이전트로 심층 리뷰. `/ultrareview`는 동일 커맨드의 deprecated alias.
- **★사용자 트리거 전용 — 자동 발동 절대 불가.** 과금/사용자 트리거 커맨드이므로 에이전트/오케가 Bash 등으로 실행하지 않는다.
- 할당 로직 연계: 코드가 할 수 있는 건 **"안내/제안"까지만**. 예) complex 변경 완료 후 "더 깊은 리뷰가 필요하면 `/code-review ultra`를 직접 실행하세요"를 출력. 실제 호출 시도 금지.

---

## 7. 구체 명세 (구현 티켓이 그대로 따라갈 수준)

### 7.1 새 env / 플래그

```
MARBLO_TOP_CLAUDE_MODEL     # default "opus". "fable" | "claude-fable-5" 등 주입 가능
MARBLO_TOP_CODEX_REASONING  # default "high"
MARBLO_FABLE5_MIN_CLI       # default "2.1.170"
MARBLO_MODEL_MIX            # default off. "cross-check" | "split-role" | "off"
```

### 7.2 `modelTierForComplexity` 시그니처/동작 변화

현행:

```ts
// agent-config.ts (현행)
export function modelTierForComplexity(
  model: ModelType,
  complexity: TaskComplexity | undefined
): { claudeModel?: string; codexReasoning?: string };
```

v2(시그니처 자체는 하위호환 유지, 내부에서 리터럴 제거):

```ts
// 의사코드 — 구현 티켓에서 실제 .ts로
function modelTierForComplexity(model, complexity) {
  if (!complexity) return {}; // override 없음(현행 유지)
  if (model === "claude") {
    if (complexity === "simple") return { claudeModel: "sonnet" }; // 현행 유지
    // standard | complex → 하드코딩 "opus" 대신 resolver
    return { claudeModel: resolveTopClaudeModel() };
  }
  if (model === "gpt") {
    if (complexity === "simple") return { codexReasoning: "low" };
    if (complexity === "complex")
      return { codexReasoning: resolveTopCodexReasoning() }; // env, default "high"
    return { codexReasoning: "medium" };
  }
  return {};
}
```

### 7.3 `dispatch_task` 새 옵션

```ts
// tools.ts dispatch_task 입력에 추가 (전부 optional, 미지정 시 현행과 동일)
mix?: "cross-check" | "split-role";   // complex 전용. 모델 믹스(§4). 기본 off
stages?: Array<{                       // complex 전용. 단계분할(§5). 기본 단일
  instruction: string;
  complexity?: "simple" | "standard" | "complex";
  model?: string;                      // 스텝별 프로바이더 힌트
  tags?: string[];
  dependsOnPrevious?: boolean;         // true면 직전 스텝 완료 후 디스패치
}>;
```

- `mix`/`stages`는 `complexity !== "complex"`면 **무시 + 경고 로깅**(잘못된 사용을 조용히 삼키지 않는다).
- `stages`가 있으면 dispatch는 스텝 배열을 순차/병렬로 풀어 각각 기존 spawn 경로로 보낸다(스텝 = 작은 dispatch). bridge `DispatchTaskRequest`에 `mix`/`stages`를 그대로 전달.

### 7.4 폴백 · 버전체크 의사코드

```ts
// 의사코드 — agent-config.ts (구현 티켓)

// claude 계열 모델 id alias (프로바이더 정규화와 별개 층)
const CLAUDE_MODEL_ALIASES = { fable: "claude-fable-5" };

function cmpSemver(a: string, b: string): number {
  const pa = a.split(".").map(Number),
    pb = b.split(".").map(Number);
  for (let i = 0; i < 3; i++) {
    const d = (pa[i] || 0) - (pb[i] || 0);
    if (d) return d;
  }
  return 0;
}

function resolveTopClaudeModel(): string {
  const raw = (process.env.MARBLO_TOP_CLAUDE_MODEL || "opus")
    .trim()
    .toLowerCase();
  const id = CLAUDE_MODEL_ALIASES[raw] || raw; // "fable" → "claude-fable-5"

  if (id === "claude-fable-5") {
    const minCli = process.env.MARBLO_FABLE5_MIN_CLI || "2.1.170";
    const { version } = resolveClaudeBinary(); // 이미 파싱된 "X.Y.Z" 재활용
    if (!version || cmpSemver(version, minCli) < 0) {
      logFallback("fable5_version_guard", {
        installed: version || "unknown",
        required: minCli,
      });
      return "opus"; // ★그레이스풀 폴백
    }
    return "claude-fable-5";
  }

  // opus 또는 기타 주입 모델: 검증 불가한 미지 모델이면 보수적으로 opus
  if (id === "opus" || id === "sonnet") return id;
  logFallback("unknown_top_model", { requested: id });
  return "opus";
}

function resolveTopCodexReasoning(): string {
  const r = (process.env.MARBLO_TOP_CODEX_REASONING || "high")
    .trim()
    .toLowerCase();
  return ["low", "medium", "high"].includes(r) ? r : "high";
}
```

런타임 2차 안전망(§3.4-3): Fable5로 spawn한 에이전트가 "미지원 모델" 류로 빠르게 실패(FAST_FAIL_WINDOW)하면, 재시작 시 `--model opus`로 강등하는 경로를 `agent-manager`의 재시작 분기에 둔다(구현 티켓에서 상세화).

### 7.5 흐름 요약 (v2)

```
dispatch_task(complexity="complex", mix?, stages?)
  ├─ stages 있음 → 스텝별 dispatch (난도별 모델 매칭, §5)
  ├─ mix 있음    → Claude TOP + Codex high 동시 spawn (§4, 비용게이트 통과 시)
  └─ 둘 다 없음  → 현행과 동일: 단일 최상위 에이전트
        └─ buildCLICommand → modelTierForComplexity
              └─ resolveTopClaudeModel()  ← env/버전가드/폴백 (§3)
```

---

## 8. 견고성 / 관측

### 8.1 폴백 로깅

- 모든 폴백(버전가드 미달, 미지 모델, 런타임 강등)은 구조화 로그 + 텔레메트리 이벤트로 남긴다. 필드 예: `reason`, `requested`, `installed`, `fallbackTo`, `agentId`, `taskId`.
- 폴백은 **조용히 일어나지 않는다** — dispatch 응답/에이전트 카드에도 "Fable5 미지원 → opus로 폴백" 류 표식을 노출(사용자가 왜 최상위가 아닌지 알 수 있게).

### 8.2 quota / 비용 게이트

- 믹스/단계분할은 net-new 활성 에이전트를 늘리므로 `checkPlanConcurrency`(dispatch-scoring.ts)의 free=2/pro=5/team=∞ 캡에 **그대로 종속**. 믹스 = 슬롯 2개.
- 미션 컨텍스트(`MISSIONS-DEFERRED-COST-AWARE-DESIGN.md`)에서는 비용 인지 게이트가 우선. memory(미션 과금 제약): 미션 설계는 LLM 최소·결정적 분해·작은 모델 우선 — 믹스/단계분할은 **명시 opt-in일 때만** 미션에서 발동.
- 안전분류 자동 폴백(§3.3)으로 인한 실제 사용 모델 변동도 비용 추적에 반영(요청 모델 ≠ 응답 모델 가능성 기록).

### 8.3 폴백 안전 기본값

- env 미설정 = `opus`(현행과 100% 동일) → **무설정 = 무회귀**.
- 버전 파싱 실패·CLI 미해결 등 모든 불확실 상황의 기본 귀결은 항상 `opus`. "더 강한 모델을 못 쓰는 것"은 허용, "spawn 자체가 깨지는 것"은 불허.

### 8.4 텔레메트리 이벤트(제안)

| 이벤트                      | 발동 시점                          | 핵심 필드                                |
| --------------------------- | ---------------------------------- | ---------------------------------------- |
| `model_tier_resolved`       | modelTierForComplexity 결정 시     | model, complexity, resolvedClaudeModel   |
| `top_model_fallback`        | 버전가드/미지모델/런타임 강등 폴백 | reason, requested, installed, fallbackTo |
| `model_mix_dispatched`      | 믹스 발동                          | mode(cross-check/split-role), taskId     |
| `complex_stages_dispatched` | 단계분할 디스패치                  | stageCount, perStageComplexity[]         |

(텔레메트리 프라이버시는 memory 방침 — 자체 1차 비식별 상시수집/3rd-party 옵트인 — 을 따른다.)

---

## 9. 비범위 / 후속

- **자동 분해**(LLM이 complex를 스스로 스텝으로 쪼개기) — 1차는 수동(`stages`)만. 비용/품질 검증 후 후속.
- **사용자 config 파일**(`~/.marblo/model-policy.json`) — 1차는 env만.
- **Fable5 외 신모델 일반화** — alias 테이블/resolver 골격은 일반화돼 있으나, 검증 안 된 모델 사양은 이 문서에서 다루지 않는다(임의 창작 금지 원칙).
- **gemini/antigravity 티어링** — 현행처럼 레벨 플래그 없음(기본 유지). v2 범위 밖.

---

## 10. 구현 체크리스트 (티켓 kYRmosC78fW7wUOyaAKG용)

- [ ] `agent-config.ts`: `resolveTopClaudeModel()` / `resolveTopCodexReasoning()` 추가, `modelTierForComplexity` 리터럴 제거
- [ ] `agent-config.ts`: `CLAUDE_MODEL_ALIASES`(fable→claude-fable-5) + semver 비교 + 버전가드(resolveClaudeBinary 재활용)
- [ ] `tools.ts`: `dispatch_task`에 `mix` / `stages` 옵션 추가(+ complexity!=="complex"일 때 무시+경고)
- [ ] `bridge-server.ts`: `DispatchTaskRequest`에 `mix`/`stages` 전달, 믹스 2-spawn / 단계 순차·병렬 디스패치
- [ ] `agent-manager.ts`: Fable5 런타임 실패 시 opus 강등 재시작 경로
- [ ] 비용/quota 게이트 연동(`checkPlanConcurrency`, 구독 인지)
- [ ] 텔레메트리 이벤트 4종(§8.4) + 폴백 사용자 표식(§8.1)
- [ ] env 미설정 시 현행 동작과 byte-identical 회귀 테스트

---

_문서 종료. 코드 변경은 구현 티켓 `kYRmosC78fW7wUOyaAKG`에서._
