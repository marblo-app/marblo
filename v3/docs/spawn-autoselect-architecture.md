# 스폰 자동선택(model-autoselect) 아키텍처

**Status:** 현행 구현 문서 (read-only 재점검 산출물)  
**Date:** 2026-08-07  
**Task:** `1nmm8QGoI3dzroeoPeor`  
**Scope:** 코드 변경 없음. 파일·라인은 이 워크트리 기준.

관련 구현 모듈:

| 층 | 모듈 | 역할 |
| --- | --- | --- |
| 오케 판단 | MCP `get_model_guidance` | 정적+동적 근거 서빙 (선택 자체는 안 함) |
| 디스패치 진입 | `electron/bridge-server.ts` | explicit 우회 / 후보 수집 / 1·2층 호출 / 핀 적용 / `spawnNewAgent` |
| 1층 (하네스) | `electron/dispatch-scoring.ts` | 프로바이더 경쟁 (`scoreModelsDetailed`) |
| 2층 (칸) | `electron/model-autoselect.ts` | 하네스 안 칸 선택 (`selectAutoModel`) |
| 사다리 | `electron/model-ladder.ts` | 난도→진입칸·순서·승인게이트 |
| KG | `electron/routing-graph.ts` | `graphBias` · 관측수 (로컬 파일) |
| 벤치/단가 사실 | `model-bench-reference` · `model-registry` · `model-fact-sheet` · `model-guidance` | 정적 단일소스 |

---

## 1. 한 줄 요약

모델 결정은 **두 층**이다.

1. **1층 — 어느 CLI/하네스** (`claude` / `gpt` / `grok` / …)  
   → `scoreModelsDetailed` (태그 · costEff · `budgetBias` · `graphBias` · 동률 회전)
2. **2층 — 그 하네스 안의 어느 칸** (`claude-opus-5`, `gpt-5.6-terra@medium`, …)  
   → `selectAutoModel` (fit · cost · bench · capability · kg · diversity · ε-greedy · 동률 회전)

`dispatch_task`에 **`model`이 있으면 두 층 모두 스코어링을 건너뛴다.**  
하네스만 지정해도(`model="claude"`) 2층 자동선택이 돌지 않고, 종전 complexity 티어 상수 경로로 핀이 비어 떨어진다.

---

## 2. 프로세스 경계

```
┌─────────────────────────────┐     HTTP POST /dispatch-task
│  MCP 프로세스 (별도)         │ ───────────────────────────►
│  electron/mcp-server/*      │
│                             │     GET /model-guidance
│  · dispatch_task 툴         │ ◄───────────────────────────┐
│  · get_model_guidance       │     (정적 페이로드 JSON)     │
│  · get_routing_effectiveness│                              │
│  · Firestore tasks 집계     │                              │
└─────────────┬───────────────┘                              │
              │ 브리지 포트 (MARBLO_BRIDGE_PORT)              │
              ▼                                              │
┌────────────────────────────────────────────────────────────┴──┐
│  Electron 메인 (bridge-server + agent-manager)                 │
│  · scoreModelsDetailed / selectAutoModel (동기, in-process)    │
│  · loadRoutingGraph(~/.marblo/routing-graph.json)              │
│  · modelGuidanceStatic()  ← get_model_guidance 정적 원산지    │
│  · spawnNewAgent → agent-manager.launch → PTY/CLI              │
└────────────────────────────────────────────────────────────────┘
```

### 왜 분리되는가

- MCP `tsconfig` `rootDir: "."` 때문에 MCP 번들은 `../model-registry` 등을 import 못 한다.  
  → 정적 모델 지식은 메인만 갖고, 브리지 `GET /model-guidance`로 넘긴다  
  (`bridge-server.ts` ~1249–1257, `mcp-server/tools.ts` `fetchModelGuidanceStatic` ~357–390).
- **자동선택 2층은 MCP를 호출하지 않는다.**  
  같은 정적 소스 `modelGuidanceStatic()`를 **in-process**로 읽는다  
  (`model-autoselect.ts` 317–324 주석, `modelGuidance()` 346–375).  
  오케가 툴로 보는 숫자와 라우터가 쓰는 숫자를 맞추기 위함이지, MCP 왕복이 아니다.

### `get_model_guidance`가 하는 일 / 안 하는 일

| 한다 | 안 한다 |
| --- | --- |
| 정적(단가·벤치·컨텍스트·티어) + 동적(보드 실적) 서술 | 스폰 결정, 추천 점수, 자동 핀 |
| 오케가 `dispatch_task(model=…)` 하기 **전** 판단 재료 | bridge-server 핫패스 입력 |

동적 절반 조인 정의: `tasks/{id}`에 물질화된 `costTotal`(← `cost_logs` 롤업) + `dispatchMeta` + status  
(`mcp-server/routing-effectiveness.ts` 1–28).

---

## 3. 작동 원리 흐름도

### 3.1 전체 dispatch → spawn

```
오케 MCP: dispatch_task(role, instruction, complexity?, tags?, model?, effort?, task_id?)
        │
        ▼
bridge-server.dispatchSingle
        │
        ├─ resolveModelPin(model+effort)     # model-selection.ts:262
        │     · harness만 → pin 없음 (label=harness)
        │     · 구체 id    → claudeModel / codexModel@effort / nativeModel
        │
        ├─ ★ explicit model? (requestedModel truthy)
        │     YES ──► 1층 scoreModelsDetailed 스킵
        │            2층 selectAutoModel 스킵
        │            selectedModel = harness
        │            effectivePin  = modelPin (구체 id 있을 때만)
        │            구체 id 없으면 → complexity 티어 상수(modelTierForComplexity) 폴백
        │            spawnDecisionReason: "Explicit model … scoring bypassed"
        │
        │     NO  ──► 아래 자동 경로
        │
        ▼ (auto)
후보 수집
  · enabledModels (요청 / 프로젝트 / MARBLO_MODEL_PRESET)
  · skill vendor 필터
  · 인증 가용성 filterAvailableHarnesses  (explicit 이면 적용 안 함)
  · budget snapshot (claude/gpt rate-limit → usedPercent)
  · loadRoutingGraph(projectId)
        │
        ▼
2층 선행: 후보 하네스마다 selectAutoModel(...)  → autoPlans Map
  · forceExplore = (Math.random() < ε)  # dispatch당 1회 공유
  · modelAvailable = vendorEnvReadiness(id).ready
        │
        ▼
1층: scoreModelsDetailed(scoredModels, tags, complexity, budgets, ctx, graph, graphKeysFor)
  · graphKeysFor = auto plan modelKey 우선 + tier 예측 키 폴백
  · total = base + tagBonus + tagPenalty + costEff + budgetBias + agyBias + graphBias
  · 모드: top-score | tie-band-round-robin | round-robin-no-tags | all-budget-exhausted
        │
        ▼
selectedModel = 1층 승자
autoPlan      = autoPlans.get(selectedModel)
autoPin       = resolveModelPin(autoPlan.modelKey)  if pinsModel
effectivePin  = modelPin ?? autoPin
        │
        ▼
spawnNewAgent({ model: selectedModel, complexity, modelPin: effectivePin, … })
  → agent-manager.launch → buildCLICommand(--model / -c model=… / -m …)
```

### 3.2 2층 `selectAutoModel` 내부

```
autoCandidates(harness, tier)
  · pinsModel=true  → model-ladder usableRungs()  (max/ultra 승인 없으면 제외)
  · pinsModel=false → 상속 모델의 effort 칸만
  · modelAvailable 로 크레덴셜 없는 env-swap 칸 제거
        │
        ▼
후보별 점수 (진입칸 대비):
  fit        FIT_PENALTY[tier] × 칸 거리 (비대칭)
  cost       COST_WEIGHT[tier] × costPressure × log2(entryCost/candCost)
             · 구독형 effective 단가 = list × subscriptionCostScaleForHeadroom(used%)
  bench      BENCH_WEIGHT × (ΔSWE / 10)  — 같은 벤치끼리만
  capability CAPABILITY_WEIGHT × Δ등급   — 벤치 비교 불가 시만
  kg         graphBiasForModel([modelKey, harness], ctx, graph)  ±20
  diversity  UCB1: C × √(ln(totalObs+1)/(n+1))
  total      = fit + cost + bench + capability + kg + diversity
        │
        ▼
승자 선택:
  · gpt + 콜드 KG + diversity off → entry 고정 (gptShouldHoldEntry)
  · 쿼터 pressure>1 (잔여 <50% 스케일) → explore/rotate 끔, top-score만
  · else ε-greedy: 확률 ε → 진입칸 ±1 창에서 관측 최소 칸 (explore)
  · else 동률 밴드 TIE_BAND(5) 안이면 하네스별 회전 (tie-rotate)
  · else top-score
        │
        ▼
AutoModelPlan { model, effort, modelKey, mode, reason, scores… }
```

---

## 4. 현재 구현된 성분 — 파일:라인

### 4.1 2층 (`model-autoselect.ts`)

| 성분 | 상수/함수 | 위치 | 스케일·의미 |
| --- | --- | --- | --- |
| 난도 적합 `fit` | `FIT_PENALTY` | 111–119, 점수 625–632 | 진입칸 거리 감점; simple 상향 강벌 / complex 하향 강벌 |
| 단가 `cost` | `COST_WEIGHT` | **122–126**, 605–646 | simple:12 / standard:7 / complex:2 (반값당 점수, log2) |
| 잔여 쿼터 → 단가 | `subscriptionCostScaleForHeadroom` · `costPressureForHeadroom` · `effectiveCostIndexForModel` | 174–260, 227–238 | 구독형 list 단가 스케일 + cost 항 증폭; **별도 budgetBias 항 아님** |
| 벤치 `benchScore` | `BENCH_WEIGHT` + `modelGuidance().benchScore` | 128–133, 346–375, 651–658 | SWE 10pt당 점수; 같은 `benchmark` id끼리만 차감 |
| 능력 폴백 | `CAPABILITY_WEIGHT` | 140–144, 660–663 | 벤치 비교 불가 시만; 티어 라벨은 **점수에 안 넣음**(이중계상 금지 29–31) |
| KG `kg` | `graphBiasForModel` | 664–666 | ±20; model@effort 키 + harness 폴백 |
| 다양성 UCB1 | `DEFAULT_DIVERSITY_C=4`, `diversityBonus` | **268–273, 305–314, 668–672** | 저표본 상시 보너스; env `MARBLO_ROUTING_DIVERSITY` |
| ε-greedy | `DEFAULT_EPSILON=0.15`, `resolveEpsilon` | **265–266, 285–291, 722–730** | env `MARBLO_ROUTING_EXPLORE`; 빈 문자열=기본(0 아님) |
| 동률 회전 | `TIE_BAND=5`, `nextRotation(harness)` | **262–263, 553–559, 732–735** | 하네스별 카운터 (#654/#656 계열: 전역 공유 시 회전 사망 방지 주석 548–551) |
| 승인게이트 | `usableRungs()` 무승인 호출 | 427–429, ladder 697–706 | max/ultra 후보 제외 |
| 결정 사유 한 줄 | `formatAutoReason` | 815–845 | dispatchReason에 부착 |

### 4.2 1층 (`dispatch-scoring.ts`)

| 성분 | 위치 | 비고 |
| --- | --- | --- |
| `budgetBias` | 212–255, 834, 883 | ±20; 잔여 0 → hard block (`bias=null`); no-data → 0 |
| `costEff` | 158–186, 270–312, 833 | 정적 비용효율 테이블 + 구독 플랜 시 MAX |
| `graphBias` | 854–860 | 2층과 같은 KG, 키는 bridge `graphKeysFor` 주입 |
| 동률/무태그 회전 | `TIED_SCORE_BAND=5` 471; `modelRoundRobin` 703, 912–932 | mode: `tie-band-round-robin` / `round-robin-no-tags` |
| 합산 | 867–874 | base+tags+costEff+budget+agy+graph |

### 4.3 사다리 (`model-ladder.ts`)

| 항목 | 위치 |
| --- | --- |
| claude 진입: simple=sonnet5(idx3), standard=opus5(4), complex=fable5(9) | 302–353, 564–568 |
| gpt: luna@low / terra@medium / sol@high + max/ultra 게이트 | 368–429, 573–578 |
| grok: 단일 칸 `grok-4.5` (그래프 읽기/쓰기 키 정합) | 454–460, 581–586 |
| `costIndexForModel` (blended list price) | 141–149 |
| `usableRungs` / `gateRung` | 231–266, 697–706 |

### 4.4 KG (`routing-graph.ts`)

| 항목 | 위치 |
| --- | --- |
| `GRAPH_BIAS_MAX=20`, `SHRINKAGE_K=6` | 147–151 |
| `graphBiasForModel` | 617–631 |
| `observationCountForModel` (ε 탐색의 “빈 셀”) | 644–665 |
| `loadRoutingGraph` (동기 mtime 캐시) | 791+ |
| 저장 | `~/.marblo/routing-graph.json` (+ project overlay) |

### 4.5 벤치·가이던스 단일소스

| 모듈 | 역할 | 핵심 위치 |
| --- | --- | --- |
| `model-bench-reference.ts` | 공개 SWE 참조표 (라우팅이 **직접** import 안 함 — 테스트 강제) | 상단 규율 1–11 |
| `model-fact-sheet.ts` | 조인 + `pickBenchRecords` (화면·오케 대표 벤치 동일) | 194–221 |
| `model-guidance.ts` | 정적 페이로드 `modelGuidanceStatic()` | 95–140 |
| `mcp-server/model-guidance-report.ts` | 정적×동적 합류 (MCP 전용) | `mergeModelGuidance` 144–167 |
| `mcp-server/tools.ts` | `get_model_guidance` 툴 | 7449–7541 |
| bridge `GET /model-guidance` | 메인→MCP 정적 전달 | ~1249–1257 |

### 4.6 디스패치 배선 (`bridge-server.ts`)

| 단계 | 대략 라인 |
| --- | --- |
| pin 해석 / explicit `model` | 2075–2107 |
| budget snapshot | 2231–2244 부근 |
| explicit budget 소진 차단 | 2482–2500 |
| 가용성 필터 (explicit 제외) | 2518–2524 |
| routing graph 로드 (explicit이면 null 취급 분기) | 2529 |
| **autoselect 우회 계약** | **2548–2570** |
| 1층 score | 2591–2601 |
| pin 합성: `modelPin ?? autoPin` | 2661–2698 |
| decisionReason explicit vs scored | 2701–2703 |
| `spawnNewAgent` | 2704–2722 |
| 텔레메트리 `explicitModel` | 2767+ |

---

## 5. 데이터 피드백 루프 (학습)

```
스폰 argv 관측 → cost_logs (메인 cost-tracker)
              → tasks.costTotal 롤업 (taskRollups)
              → task_outcomes / status

              ┌─► get_model_guidance 동적 절반 (오케 눈)
              │
결과 이벤트 ──┼─► graph-updater → routing-graph.json
              │         └─► 다음 dispatch graphBias / observations
              │
              └─► (BQ 분석; 핫패스 아님)
```

**2층 스코어링 핫패스는 `cost_logs` / `getCostSummary`를 읽지 않는다.**  
실시간으로 읽는 사용량 신호는 **계정 rate-limit 스냅샷 `usedPercent`** 뿐이고, 그건 cost 항 스케일(2층)과 `budgetBias`(1층)로만 들어간다.

---

## 6. 환경변수 · 정책 스위치

| 키 | 기본 | 효과 |
| --- | --- | --- |
| `MARBLO_ROUTING_EXPLORE` | 0.15 (`DEFAULT_EPSILON`) | ε-greedy 확률. `0`=탐색 끔. **미설정≠0** |
| `MARBLO_ROUTING_DIVERSITY` | 4 (`DEFAULT_DIVERSITY_C`) | UCB1 계수. `0`=diversity 항 끔 |
| `MARBLO_MODEL_PRESET` | (프로젝트 설정) | enabled harness 집합 |
| 승인 게이트 max/ultra | 사용자 1회/티켓 | 사다리 상단; 자동선택 후보 제외 |

---

## 7. 오케스트레이터 계약과의 관계

오케 스킬(`v3/skills/orchestrator_agent.md` §3-3, §4):

1. 근거는 `get_model_guidance`로 읽는다.
2. 사용자가 모델을 말하면 `dispatch_task(model=…)`로 **강제**.
3. tags 권장; 없으면 1층이 무태그 round-robin 가능.

따라서:

- **auto 경로** (`model` 생략): 1·2층 다요소 + 다양성 활성.
- **explicit 경로** (`model` 지정): 스코어링·autoselect·ε·UCB1·2층 동률회전 **전부 비활성**.  
  하네스만 지정 시 2층은 **옛 티어 상수**로 떨어질 수 있다 (`resolveModelPin` harness-only: `model-selection.ts` 269–272 + bridge 2548–2570).

---

## 8. 감사 방법 (구현 변경 없이)

1. 콘솔: `[BridgeServer] Dispatch: spawned … — …` 한 줄에 1층 mode + `auto-model[…]` reason  
   (`bridge-server.ts` 2755–2762).
2. 텔레메트리 `dispatch:decision`: `explicitModel`, `perModelScores`, `decisionReason`.
3. 로컬 KG: `~/.marblo/routing-graph.json` 셀 키·`n`.
4. 유닛: `tests/unit` 의 model-autoselect / routing-graph / model-ladder / model-guidance.

---

## 9. 비범위 / 구문서 주의

- `SPAWN-MODEL-ALLOCATION-V2.md` 는 **설계(미구현) 문서**이며 당시 `modelTierForComplexity` 고정 리터럴 세계를 그린다. 현행 2층은 이 문서의 `model-autoselect` 가 대체한다.
- `model-bench-reference` 점수는 **KG에 주입되지 않는다** (벤더 마케팅 수치와 우리 관측 혼입 금지). 2층은 가이던스 경로로만 벤치를 읽는다.
