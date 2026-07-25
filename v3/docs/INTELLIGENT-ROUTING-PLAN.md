# 지능형 라우팅 에픽 — 설계문서

> **★이 문서는 기획이다. 구현이 아니다.**
> 티켓 `JvpZlB9akgsHe2v1qkRh` 산출물. 코드 변경은 이 문서 1개뿐이며, 조사는 읽기전용
> 코드리딩 + 워크트리 밖 CLI 프로브로만 했다. 실제 구현은 사장님 승인 후 §7 의 Phase
> 티켓으로 진행한다.
>
> 작성 2026-07-25 · 기준 커밋 `189468a8` (origin/main)

---

## 0. 한 줄 요약

라우팅에 필요한 인프라는 **이미 대부분 살아 있다**(지식그래프·비용파이프라인·머지캡처·
dispatch 스코어러). 빠진 것은 **해상도(resolution)** 다: 현재 시스템은 "claude vs gpt"
프로바이더 단위로만 학습하고 결정하는데, 사장님이 원하는 건 "gpt-5.5 low vs gpt-5.6-sol
high" 라는 **모델변종 × effort 단위**다. 그래서 이 에픽의 본질은 재구현이 아니라
**기존 파이프라인의 키를 한 단계 잘게 쪼개고, 그 축에 맞춰 데이터를 적재·측정하는 것**이다.

동시에 조사 중 **실재하는 결함 3건**을 발견했다(§1.3). 셋 다 지금 운영에 조용히 영향을
주고 있어서 Phase 1 에 넣었다.

---

## 1. CLI 쿼리 증거 (추측 아님)

모델 사실은 전부 이 Mac 의 실제 CLI 를 쿼리해 확정했다. 카탈로그 기억이나 추론으로
쓴 모델 id 는 이 문서에 하나도 없다.

### 1.1 Claude CLI

```
$ claude --version
2.1.220 (Claude Code)

$ claude --help   (--model 항목 원문)
  --model <model>    Model for the current session. Provide an alias for the
                     latest model (e.g. 'fable', 'opus', or 'sonnet') or a
                     model's full name (e.g. 'claude-fable-5').
```

`--help` 는 목록을 주지 않으므로, **실제로 어떤 모델이 서빙됐는지**를
`--output-format json` 의 `modelUsage` 키로 확인했다. 무효 id 는 `is_error=true` +
`modelUsage` 공백으로 확실히 구분되므로 이 프로브 기법 자체가 검증됐다.

| 입력한 `--model`    | 실제 서빙된 모델 (`modelUsage` 키) | 판정                 |
| ------------------- | ---------------------------------- | -------------------- |
| `claude-opus-5`     | `claude-opus-5`                    | ✅ **존재**          |
| `claude-opus-4-8`   | `claude-opus-4-8`                  | ✅ 존재              |
| `fable`             | `claude-fable-5`                   | ✅ alias             |
| `opus`              | **`claude-opus-5`**                | ✅ alias (★4-8 아님) |
| `sonnet`            | `claude-sonnet-5`                  | ✅ alias             |
| `haiku`             | `claude-haiku-4-5-20251001`        | ✅ alias (날짜형)    |
| `__probe_invalid__` | (없음) `is_error=true`             | ❌ 대조군            |

**★`claude-opus-5` 존재 여부 = 존재한다.** 티켓 본문의 "2026-06-24 카탈로그엔 opus-5 가
없다" 는 서술은 stale 이다. 더 중요한 파생 사실: **alias `opus` 가 이제 `claude-opus-5`
로 해석된다.** 우리 코드가 `"opus"` 리터럴을 쓰는 모든 자리가 CLI 업데이트만으로 조용히
세대 상승했다는 뜻이다(§1.3-①).

### 1.2 Codex CLI

```
$ codex --version
codex-cli 0.145.0

$ codex doctor   (발췌)
      default model provider   openai
      model                    gpt-5.5 · openai
      models etag present      true
```

권위 목록은 서버에서 받아 캐시된 `~/.codex/models_cache.json`
(`fetched_at: 2026-07-25T09:59:42Z`, `client_version: 0.145.0`) 이다:

| slug                  | 기본 effort | 지원 effort                              | priority | ctx  | api         |
| --------------------- | ----------- | ---------------------------------------- | -------- | ---- | ----------- |
| `gpt-5.6-sol`         | low         | low, medium, high, xhigh, **max, ultra** | 1        | 272k | ✅          |
| `gpt-5.6-terra`       | medium      | low, medium, high, xhigh, **max, ultra** | 2        | 272k | ✅          |
| `gpt-5.6-luna`        | medium      | low, medium, high, xhigh, **max**        | 3        | 272k | ✅          |
| `gpt-5.5`             | medium      | low, medium, high, xhigh                 | 7        | 272k | ✅          |
| `gpt-5.4`             | medium      | low, medium, high, xhigh                 | 16       | 272k | ✅          |
| `gpt-5.4-mini`        | medium      | low, medium, high, xhigh                 | 23       | 272k | ✅          |
| `gpt-5.3-codex-spark` | high        | low, medium, high, xhigh                 | 26       | 128k | ❌          |
| `codex-auto-review`   | medium      | low, medium, high, xhigh                 | 43       | 272k | ✅ (hidden) |

설명문 원문: `gpt-5.6-sol` = "Latest frontier agentic coding model",
`gpt-5.6-terra` = "Balanced agentic coding model for everyday work",
`gpt-5.6-luna` = "Fast and affordable agentic coding model",
`gpt-5.5` = "Frontier model for complex coding, research, and real-world work".

**★사장님이 말씀하신 "고가 5.6" 은 단일 모델이 아니라 sol/terra/luna 3변종이다.**
그리고 **effort 축이 우리가 알던 low/med/high 를 넘어 xhigh/max/ultra 까지 있다** —
5.6 계열만 max/ultra 를 지원한다. 즉 에스컬레이션 사다리가 우리가 설계했던 것보다 길다.

### 1.3 조사 중 발견한 실재 결함 3건

이건 설계 논의가 아니라 **지금 돌아가고 있는 버그**다. 근거는 전부 코드다.

**① `standard` 티어가 조용히 Opus 5 로 승격됐다**
`agent-config.ts:768` 은 `standard → { claudeModel: "opus" }` 리터럴이다. 주석은
"standard 는 기존 opus 리터럴 유지(표준작업 비용 무변동)" 라고 명시한다. 그런데 §1.1
에서 확인했듯 `opus` 는 이제 `claude-opus-5` 로 해석된다. **"무변동" 이라는 설계 의도가
CLI 업데이트만으로 깨졌고, 아무도 모르게 표준 작업 전체의 모델 세대가 올라갔다.**
비용·품질 양쪽에 영향이 있는데 관측되지 않고 있다.

**② 라우팅 그래프가 프로바이더 단위로만 학습한다**
`routing-graph.ts:198 cellKeysForContext(model: ModelType, ...)` 의 `ModelType` 은
`dispatch-scoring.ts:15` 에서 `"claude" | "gemini" | "gpt" | "antigravity" | "local"`
이다. cell key 는 `role:backend|claude` 같은 형태다. **즉 "gpt-5.5-low 가 simple 에서
잘했다" 를 표현할 자리가 자료구조에 아예 없다.** 사장님 요청의 핵심("쉬운 건 5.5
low/med, 부족하면 high 이상")이 정확히 이 갭에 걸린다.

실제 적재 상태도 확인했다 (`~/.marblo/routing-graph.json`):
cells 12개, n = claude 72 / gpt 20 / antigravity 2, **raw outcome 은 `merged` 94건이
전부**. `completed`·`review_rejected`·`crashed` 는 0건이고 `updatedAt` 은
2026-07-20 이다. 즉 그래프가 **양성 신호만 먹고 있다** — 모든 모델이 항상 좋아 보이는
상태라 변별력이 0 이다. (메모 `live_routing_graph_v1_pr567` 의 "반쪽학습" 수리 PR#581
이후에도 온디스크 그래프는 여전히 merged-only 이므로, 수리가 실제로 부정신호를
적재하는지 재확인이 필요하다 — Phase 2 검증항목.)

**③ 신규 Claude 모델이 전부 오단가로 계상되고 있다**
`cost-tracker.ts:141 MODEL_PRICING` 에 `claude-fable-5`·`claude-opus-5`·
`claude-sonnet-5` 항목이 **하나도 없다**(grep 실측 0건). `findPricing` 은
최장 프리픽스 매칭 후 실패하면 `default: { inputPer1M: 3, outputPer1M: 15 }` 로
폴백한다. `"claude-opus-5"` 는 기존 어떤 키(`claude-opus-4-7` 등)로도 프리픽스
매칭되지 않는다. **결과: Opus 급 모델이 Sonnet 단가로 기록되고 있다.**
`gpt-5.6-*` 는 `"gpt-5"` 프리픽스에 걸려 $5/$20 로 계상되는데 이것도 5.6 실단가가
아닌 추정치다.

→ **"비용 대비 효과" 를 측정하겠다는 이 에픽의 전제가 지금은 성립하지 않는다.**
비용 축이 틀려 있으면 어떤 라우팅 학습도 잘못된 결론으로 수렴한다. 그래서 ③은
Phase 1(선행 조건)이다.

---

## 2. 축 A — 모델 레지스트리

**목표**: 신규 모델 편입이 "한 곳에 데이터 추가" 로 끝나게. 지금은 모델 지식이
`agent-config.ts`(alias·티어정책)·`cost-tracker.ts`(단가)·`dispatch-scoring.ts`
(태그보너스)·`tools.ts`(파라미터 설명문) 4곳에 흩어져 있어서 모델 하나 추가에
4곳 수술이 필요하다.

### 재사용 범위

- `CLAUDE_MODEL_ALIASES`(`agent-config.ts:601`) — alias→id 정규화 개념 그대로 계승.
- `resolveTopClaudeModelDetailed`(:665) — **CLI 버전가드 + 그레이스풀 폴백 + 구조화
  로그** 패턴이 이미 정확하다. 신규 모델은 "CLI 가 지원해야 쓸 수 있다" 는 제약을
  똑같이 받으므로 이 게이트를 레지스트리 전체로 일반화하면 된다.
  (`FABLE5_MIN_CLI` 기본 2.1.170 < 현재 2.1.220 → 현재 fable5 는 게이트 통과 상태.)
- `MODEL_PRICING` 의 최장-프리픽스 매칭 + 구독제(`subscriptionPlans`) 이중 스킴 —
  단가 표현 방식 자체는 유지, 데이터만 레지스트리에서 공급.

### 넷-뉴

1. **`v3/electron/model-registry.ts` + 데이터파일 1개**. 항목 스키마:
   `{ id, provider, aliases[], tier, efforts[], defaultEffort, pricing{in,out}, minCli, verifiedAt, status }`.
   `tier` 는 기존 `simple|standard|complex` 와 직교하는 **능력등급**(cheap/mid/top/frontier)
   으로 두고, 티어→모델 매핑은 §4 정책이 담당(레지스트리는 사실만, 정책은 별도).
2. **CLI-verified 만 등록하는 규율**. 각 항목에 `verifiedAt` + 검증방법을 남긴다.
   §1 의 프로브 절차(`--output-format json` 의 `modelUsage` 대조,
   `models_cache.json` 파싱)를 `scripts/verify-models.ts` 로 고정해 재현 가능하게.
3. **effort 를 1급 축으로**. Codex 는 모델과 effort 가 곱집합이고(5.6계열은
   max/ultra 까지) Claude 는 effort 축이 없다 — 이 비대칭을 레지스트리가 명시적으로
   표현해야 라우팅이 두 프로바이더를 같은 언어로 다룰 수 있다.

### 의존성

없음. 이 에픽의 **루트**다. B/C 가 전부 이 위에 선다.

### 검증법

- `scripts/verify-models.ts` 가 레지스트리 전 항목을 실제 CLI 로 프로브해
  불일치(등록됐는데 CLI 가 거부 / CLI 엔 있는데 미등록)를 리포트. CI 아닌 수동
  런북으로 충분(모델 목록은 네트워크 의존이라 CI 에 넣으면 플레이키해진다).
- 유닛: alias 해석·프리픽스 단가매칭·minCli 게이트 폴백이 §1.1 표를 재현하는지
  (표를 fixture 로 고정).
- **회귀 가드**: `"opus"` 같은 alias 리터럴이 코드에 남아 있지 않은지 grep 테스트.
  ①번 결함의 재발 방지가 이것이다.

---

## 3. 축 B — 라우팅 데이터·효과측정

**목표**: 모델변종·effort 별로 "성공률" 과 "비용 대비 효과" 가 실제 적재된 데이터로
나오게. ★수치 날조 금지 — 아래 어떤 임계값도 실적재 데이터를 본 뒤에 정한다.

### 재사용 범위 (★재구현 금지 — 이미 살아 있다)

- **지식그래프 전체**(`routing-graph.ts`): 감쇠 반감기(host 2d / model 21d /
  quality 45d), 신뢰수축 `n/(n+K)`, 멱등 `seen` 가드, 원자적 저장, 프로젝트 오버레이,
  `dependency_stuck` 제외 규율 — 이 설계는 그대로 옳다. **바꿀 건 cell key 하나뿐이다.**
- **결과 분류 12종**(`OutcomeMode`) + `ROUTING_WEIGHT`. `merged:+3`, `completed:+2`,
  `review_rejected:-3` 이미 정의돼 있다.
- **비용 파이프라인**: `cost-tracker.ts` 는 CLI 세션로그에서 **구체 모델 id 를 이미
  기록한다**(`model: string`). 그리고 `main.ts:3119` 가 cost 행에 `taskId` 를
  스탬프한다(메모상 join 성공률 98.6%).
  → **핵심 통찰: 비용 쪽은 이미 구체 모델 해상도를 갖고 있고, 그래프 쪽만 프로바이더
  해상도다.** 즉 "모델별 비용대비효과" 의 절반은 이미 적재 중이다.
- **머지 캡처**: `task:merged` → events 적재(`routing_data_pipeline_merge_capture`).

### 넷-뉴

1. **cell key 해상도 상승** — `cellKeysForContext(model: ModelType, ...)` 를
   `modelKey` (예: `gpt-5.5@medium`, `claude-fable-5`) 로. ★마이그레이션 주의:
   기존 12개 cell(`...|claude`)이 무효화되므로 **구키를 폴백으로 함께 읽는 2단
   조회**가 필요하다. 안 그러면 축적된 94건이 증발해 콜드스타트로 회귀한다.
   (그래프는 콜드=0 이라 안전하게 회귀하지만, 데이터를 버릴 이유가 없다.)
2. **dispatch 시점에 구체 모델을 기록** — 지금 `dispatch:decision` 텔레메트리는
   프로바이더만 남긴다. 스폰이 실제로 어떤 `model@effort` 로 떴는지를 남겨야
   결과와 join 된다. (`agent-config.ts:857` 의 `modelResolution` 필드가 complex
   티어 한정으로 이미 비슷한 걸 하고 있다 — 전 티어로 일반화.)
3. **효과 지표 정의** — `task_outcomes ⋈ cost_logs on taskId` 로
   `(modelKey, taskType, complexity) → {성공률, 평균비용, 비용당성공}`.
   성공 = `merged` 우선, `completed` 보조. 실패 = `review_rejected`·`failed`·
   `no_activity_stale`.
4. **부정신호 적재 재확인** — §1.3-② 대로 현재 그래프는 merged-only 다. PR#581
   수리가 실제로 crash/stale/reject 를 적재하는지 **라이브 관측으로** 확인하고,
   안 되면 그게 B 의 최우선 작업이다. **부정신호 없이는 학습이 성립하지 않는다.**

### 의존성

A(레지스트리) → B. 그리고 **§1.3-③ 단가 수리가 B 의 선행조건**이다(틀린 비용 위에
비용대비효과를 계산하면 안 된다).

### 검증법

- 유닛: 새 키 스킴에서 `applyOutcome`→`graphBiasForModel` 왕복, 구키 폴백 조회,
  멱등성 유지.
- **라이브**: 실제 dispatch 를 몇 건 돌린 뒤 `~/.marblo/routing-graph.json` 에
  `gpt-5.5@medium` 류 키가 생기는지 + 부정 outcome 이 실제로 들어오는지 육안 확인.
- **판정 보류**: "5.5 low 로 충분한가" 같은 결론은 **데이터가 쌓인 뒤** 내린다.
  이 문서는 임계값을 제시하지 않는다(근거 없는 수치를 박으면 그게 곧 날조다).

---

## 4. 축 C — 난도→모델 에스컬레이션

**목표**: "쉬운 건 저가·저effort, 부족하면 한 단계 위" 를 정책으로 명문화 + 재시도 시
자동 상향.

### 재사용 범위

- `spawn_model_policy_v2` = `getModelOverrides(complexity)`(`agent-config.ts:760`).
  현행 매핑(실측):
  | complexity | claude | codex |
  |---|---|---|
  | simple | `resolveSimpleClaudeModel()` 기본 sonnet | `resolveSimpleCodexReasoning()` 기본 low |
  | standard | `"opus"` 리터럴 (→ 실제 opus-5, §1.3-①) | medium |
  | complex | `resolveTopClaudeModel()` 기본 fable5 | `resolveTopCodexReasoning()` |
- `dispatch_task` 의 `complexity` enum + `mix`(cross-check/split-role) +
  `stages`(단계분할) — 난도 기반 분기 골격이 이미 있다.
- 런타임 강등 재시작 경로(`agent-config.ts:1421` `modelOverride`) — **방향만 반대인
  기존 메커니즘**. 상향 재시도는 이 배선을 그대로 뒤집어 쓰면 된다(신규 배선 불필요).

### 넷-뉴

1. **사다리(ladder)를 레지스트리 데이터로**. 현재는 티어→모델이 코드 분기다.
   `simple → [gpt-5.5@low, gpt-5.5@medium] → standard → [.. @high] → [gpt-5.6-sol@high]`
   식의 순서 배열을 레지스트리에 두면 신규 모델 편입이 배열 삽입으로 끝난다.
   ★effort 사다리가 §1.2 대로 low→medium→high→xhigh→max→ultra 까지 있으므로
   사다리 설계 시 5.6 계열만 상단 2칸이 더 있다는 비대칭을 반영해야 한다.
2. **실패→상향 재시도**. 트리거는 그래프의 부정 outcome 과 같은 신호를 쓴다
   (`review_rejected`·`failed`·`no_activity_stale`). 한 티켓당 상향 **1회로 제한**
   — 무한 에스컬레이션은 비용 폭주다. `restartCount` 평생예산
   (`orch_reliability_audit_2026_07_18`)과 같은 계정에서 차감.
3. **graphBias 와의 관계 명확화**. graphBias 는 ±20 clamp 의 **tie-breaker** 지
   라우터 오버라이드가 아니다(role hard-gate 100, reuse 30). 에스컬레이션은 그와
   별개 층인 **정책 사다리**로 두고, 그래프는 사다리 안에서의 미세 선호만 흔든다.
   → 두 메커니즘이 서로 싸우지 않게 하는 게 이 축의 설계 핵심이다.

### 의존성

A → C. 그리고 **B 의 부정신호가 살아나야 재시도 트리거가 의미를 갖는다**(C 는 B 와
병행 가능하지만, 자동 상향 활성화는 B 이후).

### 검증법

- 유닛: 사다리 전이표(현재티어 + 실패모드 → 다음티어), 상향 1회 제한, 예산 차감.
- **비용 회귀 가드**: 정책 변경 전후 `simple/standard` 티켓의 평균 비용을 비교.
  ①번 결함 같은 "조용한 승격" 이 다시 일어나면 여기서 잡힌다.
- 카나리: 먼저 `simple` 한 티어에만 켜고 실적재 결과를 본 뒤 확대.

---

## 5. 축 D — 스킬 실전달

### ★실측 결론 (티켓 완료기준 항목)

**"스폰된 에이전트가 스킬을 상속하는가?" → 상속한다. 확인됨.**

근거:

1. `CLAUDE_CONFIG_DIR` 을 override 하는 코드가 `electron/`·`src/` 전체에 **없다**(grep 0건).
2. `agent-manager.ts:489` 가 `{...process.env, ...launchConfig.env}` 로 부모 env 를
   통째 물려준다(`CLAUDECODE` 만 중첩방지로 삭제).
3. **실측**: 중립 cwd(`/tmp`)에서 `claude -p` 로 스폰해 "네가 쓸 수 있는 스킬 이름을
   나열하라" 고 물었더니 **88개를 전부 나열**했다 — `seo-geo-full`, `gstack`,
   `superpowers:*`, `tf-*` 포함. cwd 무관하게 사용자 레벨 스킬이 보인다.

**그런데 사장님 걱정은 절반 맞다. 상속은 되지만 나머지 3개가 없다:**

| 갭                    | 실측 근거                                                                                       | 영향                                                                                         |
| --------------------- | ----------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| **이름 불일치**       | 사장님이 말한 `/seo-geo-optimization` 은 없다. 실제 설치명은 **`seo-geo-full`**                 | 그 이름으로 지시하면 에이전트가 스킬을 못 찾는다                                             |
| **Codex 는 스킬 0개** | `~/.codex/skills` = **빈 디렉토리**(0개)                                                        | 스킬 필요 작업을 codex 에 배정하면 **조용히 무효**. 프로바이더 선택이 스킬 가용성을 좌우한다 |
| **지정 수단 부재**    | `dispatch_task` 파라미터에 skill 계열 인자 없음(`role/complexity/model/tags/mix/stages`가 전부) | "이 티켓엔 이 스킬을 써라" 를 전달할 자리가 없다                                             |
| **검증 신호 부재**    | 스킬 사용 여부를 남기는 코드 없음                                                               | "썼다" 는 에이전트 자기보고뿐 → 사장님이 "확인 안 됨" 이라 느낀 근본 원인                    |

**혼선의 진짜 원인**: marblo 에는 이름이 같은 서로 다른 두 층이 있다.

- **역할 스킬** — `composeInitialPrompt`(`agent-manager.ts:273`)가 marblo 의
  `SKILLS_DIR`(`MARBLO_SKILLS_DIR`) 에서 읽어 **초기 프롬프트에 텍스트로 prepend**.
  (지금 이 에이전트가 받은 "[역할 스킬]" 블록이 그것.) 전달이 확실하지만 marblo 전용.
- **CLI 네이티브 스킬** — `~/.claude/skills` 의 88개. CLI 가 자체 발견하며 marblo 는
  관여하지 않는다. 전달은 되지만 **marblo 가 지정도 관측도 못 한다.**

사장님이 "스킬이 전달되는지 확인 못 하겠다" 고 하신 건 후자다. 그리고 정답은
"전달 경로를 새로 만들자" 가 아니라 **"이미 전달되니, 지정과 관측을 붙이자"** 다.

### 재사용 범위

- env 상속 경로 — 그대로 둔다(이미 작동).
- `composeInitialPrompt` 의 prepend 자리 — 스킬 지시문 주입 지점으로 재사용.
- `get_agent_skill`(`tools.ts:2723`) + `SKILLS_DIR` — 역할스킬 조회 배선 재사용.
- `run_skill`(:4490) 의 **allowlist + 셸 메타문자 차단 + 절대경로 cwd 검증** 보안
  패턴 — 스킬 지정 파라미터를 만들 때 이 검증 규율을 그대로 계승한다.

### 넷-뉴

1. **`dispatch_task(skills: string[])`**. 값은 실제 설치된 스킬명으로 검증
   (미설치명은 즉시 에러 — `/seo-geo-optimization` 같은 오타가 조용히 무시되지 않게).
2. **프로바이더 가용성 게이트**. `skills` 가 있으면 codex 로 라우팅하지 않는다
   (스킬 0개). 또는 codex 스킬 설치를 별도 티켓으로. **이건 라우팅 결정에 직접
   영향** — 스킬 요구가 프로바이더 선택의 하드 제약이 된다.
3. **사용 검증 신호**. 후보 3개, 신뢰도 순:
   - (상) 스킬이 남기는 **부수효과 검사** — 예: `seo-geo-full` 은 `lib/schema.ts`·
     `app/sitemap.ts` 등 특정 산출물을 만든다. 파일 존재로 판정하면 자기보고에
     의존하지 않는다. **가장 위조 불가능한 신호.**
   - (중) 초기 프롬프트에 "스킬 호출 직후 `add_activity("[skill] <name> invoked")`"
     를 규약으로 넣고 activity 스트림에서 집계. 이미 있는 배선만 쓴다.
   - (하) PTY 바이트 스캔. ★메모 `agent_working_derived_from_pty_bytes` 의 교훈대로
     PTY 파생 판정은 양방향 오판이 잦다 — **보조 신호로만.**

### 의존성

A/B/C 와 **독립**. 병행 가능하고, 사장님 체감이 가장 빠른 축이다.

### 검증법

- 스킬 지정 dispatch 를 실제로 돌려 §5 (상) 부수효과가 나오는지 확인.
- 미설치 스킬명 지정 시 에러가 뜨는지(조용한 무시 금지).
- codex + skills 조합이 차단되는지.

---

## 6. 축 E — 오케 매개 Q&A

### 현재 실측 상태

- **에이전트→오케 전달은 이미 무조건 작동한다.** `add_activity` 는 lane 컨텍스트가
  아니면 **모든** activity 를 `notifyOrchestrator` 로 오케 PTY 에 넣는다
  (`tools.ts:2576-2587`).
  ★**문서·코드 불일치**: 역할스킬은 "`[질문]` 표기가 있어야 오케 PTY 로 전달된다"
  고 안내하지만, 코드엔 `질문` 분기가 없다(grep 0건). 실제로는 전부 전달된다.
  → 표기는 사람이 눈으로 고르라는 관례일 뿐, 기계적 채널이 아니다.
- **오케→에이전트 회신 경로도 있다**: `add_pending_instruction` → Firestore →
  `pending-instruction-listener` → `ptyManager.writeAndSubmit`.
- `orchestrator-manager.injectMessage`(:522)는 **PTY 전환 시 재라우팅 가드**를
  이미 갖췄다(:552 "PTY changed while queued; routing to current PTY") — 메모
  `injectmessage_expectpty_silent_drop_telegram_loss` 의 수리가 반영돼 있다.

### 갭 (전부 코드 근거)

1. **질문이 타입이 아니다.** 질문·진행보고·완료보고가 전부 같은 activity 스트림에
   평문으로 섞인다. 질문 id 도, "답변 대기중" 상태도, 답과 질문의 상관관계도 없다.
   오케가 놓치면 그냥 사라진다.
2. **300자 절단**(`tools.ts:2578`). 질문이 길면 오케 PTY 엔 잘린 채 도착한다.
   질문 채널로 쓰기엔 치명적이다.
3. **회신 전달 실패가 은폐될 수 있다.** `pending-instruction-listener.ts:232` 주석이
   직접 말한다 — "PTY injection failed AFTER we already marked delivered".
   즉 delivered 로 마킹된 뒤 주입이 실패하면 **답변이 유실되는데 성공으로 보인다.**
   §6 은 이 경로를 답변 왕복에 쓰므로 반드시 다뤄야 한다.
4. **에스컬레이션 판정 기준이 없다.** "오케가 답할 수 있는가 vs 사장님께 물어야
   하는가" 를 정하는 규칙이 어디에도 없다.

### 재사용 범위

`add_activity`→`notifyOrchestrator` 전달, `add_pending_instruction` 왕복,
`injectMessage` 의 PTY 전환 가드, 텔레그램 아웃바운드(`send_telegram_message` +
`main.ts:2461` 의 인바운드 폴러) — **배관은 다 있다.** 넷-뉴는 그 위의 프로토콜이다.

### 넷-뉴

1. **타입드 질문 채널**: `ask_orchestrator(task_id, question, blocking?)` →
   `questionId` 반환. 티켓에 `{questionId, status: open|answered, answer}` 상태 보관.
   답변은 `answer_question(questionId, answer)` 로 상관관계를 명시적으로 잇는다.
   전문(全文)을 오케에 전달(300자 절단 우회).
2. **에스컬레이션 판정 기준** (제안):
   - **오케 자체해결**: 코드베이스·티켓본문·기존 문서·git 이력에서 답이 나오는 것,
     스코프/우선순위 확인, 이미 결정된 사안의 재확인.
   - **사장님 필요**: 제품 판단(무엇을 만들지), 비용/과금 결정, 비가역·외부영향
     행위(배포·머지·발송) 승인, 오케가 관측 불가능한 것(스크린샷·라이브 화면),
     서로 모순되는 지시의 중재.
   - **판정 불명이면 오케가 먼저 답을 시도하고, 근거를 못 찾으면 승격**한다
     (기본값을 "사장님께 묻기" 로 두면 알림 피로가 온다).
3. **비차단 기본**. 역할스킬이 이미 "질문했다고 작업 전체를 멈추지 마라" 를 규정한다.
   `blocking: true` 는 진짜 진행 불가일 때만.
4. **회신 전달 하드닝**: delivered 마킹을 PTY 주입 **성공 이후**로 옮기거나,
   실패 시 되돌리고 재시도. (갭 ③ 수리.)

### 의존성

A~D 와 독립. 단 D 의 "스킬발 질의" 가 이 채널을 타므로 **D 와 함께 가면 시너지**.

### 검증법

- 질문→오케답변→에이전트수신 왕복을 실제로 1건 돌려 상관관계·전문보존 확인.
- 300자 초과 질문이 안 잘리는지.
- **주입 실패 주입 테스트**: PTY 를 죽인 상태에서 답변을 보내고, delivered 가
  거짓으로 마킹되지 않는지 확인(갭 ③ 회귀 가드).

---

## 7. 구현 티켓 분해 제안

오케가 `create_tasks_bulk` 로 만들 수 있게 정리했다. **전부 사장님 승인 후 착수.**

### Phase 1 — 기반 (병행 가능, 나머지 전부의 선행조건)

| #    | 제목                                                                                                                                                     | role    | 의존 | 우선   |
| ---- | -------------------------------------------------------------------------------------------------------------------------------------------------------- | ------- | ---- | ------ |
| P1-1 | **[기존티켓 `OwSU3RjjOC`] 오케 셀렉터 + dispatch 지정모델** — `dispatch_task` 에 구체 `model@effort` 지정 파라미터 추가                                  | backend | —    | P0     |
| P1-2 | **모델 레지스트리 도입** — `model-registry.ts` + 데이터파일. §1 CLI-verified 항목만 등록. alias/티어/effort/minCli/단가 단일소스화                       | backend | —    | P0     |
| P1-3 | **★단가 갭 수리** — `MODEL_PRICING` 에 claude-fable-5/opus-5/sonnet-5, gpt-5.6-sol/terra/luna 실단가 등록. 현재 Opus급이 default $3/$15 로 계상되는 문제 | backend | P1-2 | **P0** |
| P1-4 | **★`standard` 조용한 승격 판정** — `"opus"` 리터럴이 opus-5 로 해석되는 현 상태가 의도인지 사장님 확인 후 명시적 핀 고정. alias 리터럴 grep 회귀테스트   | backend | P1-2 | **P0** |
| P1-5 | `scripts/verify-models.ts` — 레지스트리 ↔ 실제 CLI 대조 런북                                                                                             | backend | P1-2 | P2     |

### Phase 2 — 측정 (P1 이후)

| #    | 제목                                                                                                          | role     | 의존       | 우선   |
| ---- | ------------------------------------------------------------------------------------------------------------- | -------- | ---------- | ------ |
| P2-1 | **★부정신호 적재 라이브 재확인** — 현 그래프가 merged-only(94/94)인 원인 규명. PR#581 수리가 실제 동작하는지  | backend  | —          | **P0** |
| P2-2 | **그래프 cell key 해상도 상승** — `ModelType` → `modelKey(model@effort)`. 구키 폴백 2단 조회로 기존 94건 보존 | backend  | P1-2, P2-1 | P1     |
| P2-3 | **dispatch 시점 구체모델 기록** — `dispatch:decision` 에 실제 스폰 `model@effort` 스탬프                      | backend  | P1-1       | P1     |
| P2-4 | **모델별 효과 집계** — `task_outcomes ⋈ cost_logs` 로 (모델,난도)별 성공률·비용당성공                         | backend  | P1-3, P2-3 | P2     |
| P2-5 | 라우팅 효과 대시보드 (어드민)                                                                                 | frontend | P2-4       | P3     |

### Phase 3 — 에스컬레이션 (P2 이후)

| #    | 제목                                                                                                | role    | 의존       | 우선 |
| ---- | --------------------------------------------------------------------------------------------------- | ------- | ---------- | ---- |
| P3-1 | **난도→모델 사다리 데이터화** — 티어별 모델 순서를 레지스트리로. 5.6 계열 max/ultra 비대칭 반영     | backend | P1-2       | P1   |
| P3-2 | **실패→상향 재시도** — 티켓당 1회 제한, restartCount 예산 공유. 기존 런타임 강등 배선 역방향 재사용 | backend | P3-1, P2-1 | P2   |
| P3-3 | 정책 카나리 + 비용 회귀 가드 (simple 티어부터)                                                      | backend | P3-2       | P2   |

### Phase 4 — 스킬 (독립, 체감 빠름)

| #    | 제목                                                                                                       | role    | 의존 | 우선 |
| ---- | ---------------------------------------------------------------------------------------------------------- | ------- | ---- | ---- |
| P4-1 | **`dispatch_task(skills[])` + 설치검증** — 미설치명 즉시 에러(`seo-geo-full` 오타 방지)                    | backend | —    | P1   |
| P4-2 | **스킬 사용 검증 신호** — 부수효과 기반(상) + activity 규약(중)                                            | backend | P4-1 | P2   |
| P4-3 | **codex 스킬 가용성 대응** — `~/.codex/skills` 0개. 스킬요구 작업의 codex 라우팅 차단 또는 codex 스킬 설치 | backend | P4-1 | P2   |

### Phase 5 — Q&A (독립, D 와 시너지)

| #    | 제목                                                                                              | role    | 의존 | 우선   |
| ---- | ------------------------------------------------------------------------------------------------- | ------- | ---- | ------ |
| P5-1 | **타입드 질문 채널** — `ask_orchestrator`/`answer_question`, questionId 상관관계, 300자 절단 우회 | backend | —    | P1     |
| P5-2 | **★회신 전달 하드닝** — delivered 선마킹 후 PTY 주입 실패 시 답변 유실 경로 수리                  | backend | —    | **P1** |
| P5-3 | **에스컬레이션 판정 + 사장님 왕복** — §6-2 기준 + 텔레그램 라우팅 재사용                          | backend | P5-1 | P2     |
| P5-4 | 역할스킬 문서 정정 — "`[질문]` 표기가 있어야 전달" 은 사실과 다름(전부 전달)                      | backend | —    | P3     |

**권장 착수 순서**: P1-3·P1-4·P2-1·P5-2 (전부 현존 결함) → P1-1·P1-2 → P4-1 →
나머지. 결함 4건을 먼저 처리해야 그 위에 쌓는 측정이 신뢰할 수 있다.

---

## 8. 사장님께 확인이 필요한 것

1. **`standard` 티어를 opus-5 로 둘까, opus-4-8 로 핀할까?** 지금은 "무변동" 이라는
   원 설계 의도와 달리 opus-5 로 조용히 올라가 있다(§1.3-①). 비용에 직접 영향.
2. **gpt-5.6 3변종 중 무엇을 사다리에 넣을지.** sol(frontier)/terra(balanced)/
   luna(fast·affordable) 성격이 다르다. "고가 5.6" 은 sol 로 보이지만 확정 필요.
3. **max/ultra effort 를 사다리에 포함할지.** §1.2 대로 5.6 계열엔 high 위로 2칸이
   더 있다. 비용 상한과 직결.
4. **codex 스킬 0개 문제**: 스킬 요구 작업을 claude 로만 보낼지, codex 에도 스킬을
   설치할지.

---

## 9. 이 문서가 하지 않은 것

- **수치를 정하지 않았다.** "simple 은 5.5 low 로 충분" 같은 임계값은 §3 데이터가
  쌓인 뒤 정한다. 지금 박으면 근거 없는 숫자다.
- **코드를 고치지 않았다.** 발견한 결함 3건도 티켓으로만 제안했다.
- **모델 id 를 추론하지 않았다.** 이 문서의 모든 모델 id 는 §1 의 CLI 프로브
  또는 `models_cache.json` 원문에서 왔다.
