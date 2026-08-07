# 스폰 자동선택 재점검 Findings

**Date:** 2026-08-07  
**Task:** `1nmm8QGoI3dzroeoPeor`  
**Method:** 소스 직독 (read-only). 코드 변경 없음.  
**Architecture doc:** `v3/docs/spawn-autoselect-architecture.md`

판정 표기:

- **반영 O** — 자동선택 핫패스에 실제 연결됨
- **부분** — 다른 층/경로에만 있거나 조건부로만 동작
- **반영 X** — 기대와 달리 핫패스에 없음
- **근거** — 파일:라인 / 관측
- **안 되면 왜** — 구조적 이유

---

## (1) 벤치 반영

| 항목 | 판정 |
| --- | --- |
| **반영** | **O** (2층) · 부분 주의사항 있음 |

### 근거

- 2층 점수 항 `bench`: `BENCH_WEIGHT[tier] × (Δscore)/10`  
  `model-autoselect.ts` 128–133, 651–658.
- 점수는 `modelGuidance(modelId).benchScore` ← `modelGuidanceStatic()` ← `pickBenchRecords`  
  (화면 정보표·오케 가이던스와 **같은 대표 벤치 선정**).  
  346–375, `model-fact-sheet.ts` 194–221, `model-guidance.ts` 95–140.
- MCP `get_model_guidance`는 같은 정적 원산지를 브리지 HTTP로 받아 오케에게 보여 준다  
  (`tools.ts` 7449–7541, `fetchModelGuidanceStatic` 357–390).  
  **2층은 MCP를 부르지 않고 in-process 동일 함수를 쓴다** (317–324 주석).

### 한계 (왜 “완전 동일 벤치 축”은 아닌가)

- **같은 벤치 id끼리만** 차를 낸다 (647–655). Claude 대표가 Verified, 후보가 Pro면 `bench=0` → capability 폴백.
- 벤치 표 자체는 하네스/출처가 다른 자기보고 혼재 (`model-bench-reference.ts` 규율). 순위가 아니라 자릿수 감각.
- 1층(`scoreModelsDetailed`)에는 SWE 항이 **없다** (태그·costEff·budget·graph만).

### 콜드

- 점수 null → bench 0, capability로만 약하게 이동 (`CAPABILITY_WEIGHT`).

---

## (2) 사용량 / 단가 반영 (cost_logs · getCostSummary · COST_WEIGHT · 콜드스타트)

| 신호 | 1층 | 2층 | 오케 툴 |
| --- | --- | --- | --- |
| 레지스트리 list 단가 | costEff 테이블(정적) | **COST_WEIGHT + log2 실단가** O | 정적 행 O |
| 계정 쿼터 `usedPercent` | **budgetBias** O | cost scale/pressure O | (직접 아님) |
| `cost_logs` / task `costTotal` | **X** | **X** | 동적 실적 O |
| Cloud Function `getCostSummary` | **X** | **X** | 화면/어드민 경로 (핫패스 X) |

### 판정 요약

| 기대 | 판정 |
| --- | --- |
| COST_WEIGHT로 칸 단가 경쟁 | **O** — `model-autoselect.ts` 122–126, 605–646 |
| 잔여 쿼터로 비싼 칸 억제 | **O** — `subscriptionCostScaleForHeadroom` / `costPressureForHeadroom` 174–238 |
| cost_logs 실사용 $가 다음 스폰 점수에 직접 | **X** |
| getCostSummary가 autoselect 입력 | **X** |
| 콜드스타트 시 단가 항 | **O (정적 list)** — 그래프 n=0이어도 cost/fit/bench는 동작. `coldStart` 플래그는 KG 관측만 (`690`, reason에 `kg …(cold)`) |

### 근거 · 안 되면 왜

1. **`cost_logs` 경로**  
   - 기록: `cost-tracker` → BQ/Firestore.  
   - 집계: `taskRollups` → `tasks.costTotal`.  
   - 소비: `routing-effectiveness` → `get_model_guidance` / `get_routing_effectiveness` 서술.  
   - **selectAutoModel / scoreModelsDetailed import 경로에 cost_logs·getCostSummary 없음.**  
   설계 의도: 핫패스는 동기·로컬; BQ/Callable은 오케 판단·대시보드용.

2. **1층 `budgetBias` vs 2층 cost**  
   - budgetBias: 하네스 간 쿼터 잔량 (±20, `dispatch-scoring.ts` 233–255).  
   - 2층: **같은 usedPercent**로 구독형 effective 단가만 스케일. “이 달에 opus에 $X 썼다”는 안 봄.

3. **콜드스타트**  
   - KG cold → kg=0, diversity만 저표본 보너스.  
   - 단가·벤치 정적 항은 즉시 유효 → “근거 없으면 진입칸” 주석(종전 티어)과 맞음.  
   - gpt 특수: 콜드+diversity0이면 **entry 고정** (`gptShouldHoldEntry` 705–718) — 변종 편입 직후 정책 보호.

---

## (3) 골고루 / 다양성 (ε-greedy · UCB1 · 동률회전) — 실제 분산시키나 / opus 편중?

| 메커니즘 | 구현 | 판정 |
| --- | --- | --- |
| ε-greedy | DEFAULT 0.15, 진입 ±1 창·최소 관측 칸 | **O (조건부)** |
| UCB1 diversity | C=4, total에 가산 | **O (조건부)** |
| 2층 동률 회전 | TIE_BAND=5, **하네스별** 카운터 | **O (조건부)** |
| 1층 동률/무태그 회전 | TIED_SCORE_BAND + modelRoundRobin | **O (조건부)** |

### 조건부로 꺼지는 경우 (분산 무력)

| 조건 | 효과 | 위치 |
| --- | --- | --- |
| **`params.model` 지정** | 1·2층 스코어·ε·UCB·회전 **전부 스킵** | bridge 2548–2570, 2591–2592, 2701–2703 |
| 쿼터 `costPressure > 1` (잔여 스케일 상 50% 미만 구간) | explore/tie-rotate 끔 | autoselect 695–720 |
| `MARBLO_ROUTING_EXPLORE=0` | ε 끔 | 285–291 |
| `MARBLO_ROUTING_DIVERSITY=0` | UCB 항 0; gpt hold 조건 강화 | 297–302, 705–710 |
| 후보 1개 / grok 단일 칸 | mode=single | ladder GROK_RUNGS |
| gpt 콜드 hold | entry 유지 | 705–718 |

### opus 편중 가능 경로 (구조)

1. **auto + standard + claude 승자 + 콜드**  
   - 진입칸 = `claude-opus-5` (`model-ladder.ts` entry.standard=4).  
   - fit=0이 진입 유리; env-swap 칸은 단가 항으로 이길 수 있음(키 있을 때).  
   - 키 없는 기기: env-swap 전부 필터 → sonnet/opus/fable만 → standard는 opus 고정에 가깝고, ε는 ±1(sonnet 또는 MiniMax-M3 쪽)만.

2. **explicit `model="claude"` (하네스만)**  
   - autoselect 스킵 + pin 없음 → **`modelTierForComplexity` 상수** (standard→opus 계열).  
   - 다요소 2층·다양성 **완전 무력**.  
   - 오케 스킬이 사용자 지정 시 `model="claude"`를 강제하도록 되어 있음 (`orchestrator_agent.md` §4).

3. **1층 claude 편향 학습**  
   - 로컬 `~/.marblo/routing-graph.json` (2026-08-07 관측, updatedAt 2026-07-27):  
     관측 합 **claude 72 / gpt 20 / grok 4 / antigravity 2**.  
     키는 대부분 **provider 문자열** (`taskType:code|claude` 등), model@effort 세분 셀은 거의 없음.  
   - graphBias가 claude에 양의 신호가 쌓이면 1층에서 claude 재선택 → 2층은 또 opus 진입 쪽.

### 실제로 분산시키나?

- **코드상**: auto 경로 + 쿼터 여유 + ε>0 이면 **의도적으로** 인접 칸 데이터를 채운다 (자기강화 루프 주석 45–54).  
- **실기 그래프**: 여전히 provider 해상도·claude 편중 → “칸 다양성” 학습은 아직 얇다.  
- **ε=15%**는 “6~7건 중 1건” 탐색; 나머지는 top-score/tie-rotate.  
- **동률 회전이 전역 카운터면 죽던 버그**는 하네스별 카운터로 막음 (548–551) — 구현상 반영 O.

**종합 (3):** 메커니즘은 **구현 O**, 실사용에서 opus/claude 편중을 깨려면 (a) `model` 미지정 auto 경로, (b) 쿼터 여유, (c) env-swap 키/관측 축적, (d) 오케가 매 디스패치에 model을 박지 않을 것이 필요. **명시 모델 비율이 높으면 다양성 코드는 죽은 코드와 같다.**

---

## (4) 오케 explicit model → autoselect 우회? / 실사용 비율

### 우회 여부

| 질문 | 답 |
| --- | --- |
| explicit이면 autoselect 우회? | **예 — 완전 우회** |
| 1층 scoring도 우회? | **예** (`modelSelection=null`, perModelScores=[]) |
| 가용성 사전 필터도? | **예** (null; 게이트에 맡김) |
| 그래프 로드 스킵? | explicit 시 score 경로에 graph 안 탐 (2529: `model ? null : load…` 패턴과 autoPlans 스킵) |

근거:

```
// bridge-server.ts ~2548-2570
// ★명시 모델(params.model)이 있으면 계산 자체를 하지 않는다
const autoPlans = new Map...
if (!model) { for (...) selectAutoModel(...) }

// ~2591-2619
const modelSelection = model ? null : scoreModelsDetailedFn(...)
const selectedModel = model || modelSelection!.selected

// ~2661-2698
const autoPlan = model ? undefined : autoPlans.get(selectedModel)
const effectivePin = modelPin ?? autoPin
```

decisionReason:

- explicit: `Explicit model '${model}' requested — scoring bypassed …` (2701–2702)
- auto: `Scored N model(s) → … auto-model[tier] …` (2703)

### 하네스-only explicit의 숨은 효과

- `model="claude"` / `"codex"` → `resolveModelPin`이 **modelId 없이 harness만** (`model-selection.ts` 269–272).  
- 이 경우에도 `model` truthy → **2층 자동선택 스킵**.  
- pin 비어 → complexity 티어 상수로 CLI 조립.  
→ 오케가 “클로드로 해”만 박아도 **다요소 칸 선택·다양성이 통째로 꺼진다.**

### 실사용 비율 (지금)

이 작업 범위에서 **전역 BQ `dispatch:decision` 집계는 조회하지 않음** (코드·로컬 파일 재점검).  
코드/정책으로 말할 수 있는 것:

| 경로 | 추정 트리거 | autoselect |
| --- | --- | --- |
| A. `dispatch_task` without `model` | tags/complexity만 — 스킬 기본 권장 | **활성** |
| B. 사용자 “codex/claude로” | 스킬 §4 강제 `model=` | **비활성** |
| C. 오케가 guidance 보고 구체 칸 강제 | `model=claude-opus-5` 등 | **비활성** (의도된 override) |
| D. 하네스만 습관적 지정 | `model=claude` | **비활성** + 티어 상수 (의도치 않은 편중 가능) |

로컬 KG 스냅샷(단일 머신, 2026-07-27 갱신 정지): 스폰 결과 관측은 **claude 78%대(72/98)** 로 편중.  
이는 “explicit 비율”의 직접 측정은 아니고, **1층 승자+학습이 claude에 몰린 결과**에 가깝다.

**비율을 숫자로 확정하려면** (후속, 이 티켓 범위 밖):

```text
dispatch:decision 에서
  explicitModel=true  비율
  decisionReason 에 "auto-model[" 포함 비율
  selectedModel × complexity 교차
```

텔레메트리 필드: `bridge-server` `emitDispatchDecision` / `telemetry.ts` dispatch decision.

### 결론 (4)

- **우회: 반영 O (설계 계약).**  
- **부작용:** 오케/사용자가 하네스만 자주 박으면 자동선택·다양성·벤치 항이 **실사용에서 무력**.  
- **지금 실사용 비율:** 이 산출물 기준 **미계측(코드 근거만)**; 로컬 KG는 claude 편중 신호.

---

## 교차 매트릭스 (한눈)

| 요구 | 핫패스 반영 | 비고 |
| --- | --- | --- |
| (1) 벤치 | **O** 2층 | 동일 벤치만; 1층 무 |
| (2) 단가 COST_WEIGHT | **O** 2층 | list price + 쿼터 스케일 |
| (2) cost_logs / getCostSummary | **X** 핫패스 | 오케 동적 툴·BQ만 |
| (2) 콜드 단가 | **O** 정적 | KG cold와 무관 |
| (3) ε / UCB / 동률회전 | **O** 조건부 | explicit·저쿼터·env=0 시 끔 |
| (3) 실분산 vs opus | **부분** | entry=opus + explicit 경로 위험 |
| (4) explicit 우회 | **O** | 자동선택 완전 스킵 |
| (4) 실사용 비율 | **미계측** | 텔레메트리 후속 |

---

## 권고 (문서만 — 코드 변경 없음, 오케/후속 티켓용)

1. **기본 dispatch는 `model` 생략**을 오케 습관으로 유지해야 2층·다양성이 산다. 사용자 강제 외 하네스-only `model="claude"` 남발 지양.  
2. 다양성 감사는 콘솔 `auto-model[…] mode=explore|tie-rotate` 비율 + `dispatch:decision.explicitModel` 로.  
3. cost_logs를 라우팅에 넣으려면 **별 설계**(동기 롤업 vs 오케 판단만) — 현재는 의도적으로 분리.  
4. KG를 model@effort로 채우려면 스폰 쓰기 키가 plan.modelKey와 일치하는지 라이브 재확인 (P2-2 이후 provider 셀이 아직 지배적).

---

## 산출물 목록

| 파일 | 내용 |
| --- | --- |
| `v3/docs/spawn-autoselect-architecture.md` | 흐름도 · 프로세스 경계 · 성분 파일:라인 |
| `v3/docs/spawn-autoselect-findings.md` | 본 재점검 (1)–(4) |

검증: 소스 라인 대조 + 로컬 `routing-graph.json` 관측 합계. 유닛 테스트 실행/코드 수정 없음.
