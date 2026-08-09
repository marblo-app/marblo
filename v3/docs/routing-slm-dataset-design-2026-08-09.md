# 모델 라우팅 SLM — 실행가능 데이터 설계 (태스크 정의 · 데이터셋 · 스키마 · 향후 계측)

- **티켓**: `D8lmKZkxIswgknrTiHRl`
- **작성일**: 2026-08-09
- **성격**: 방향성·설계 문서. **코드 무변경**(이 문서 1개만 추가)
- **답하는 질문**: #887 이 "첫 오너십 타깃"으로 고른 **모델 라우팅 SLM** 을, 지금 있는 텔레메트리로 **실제로 학습 가능한 형태**로 못박는다 — 무엇을 입력으로 받고, 무엇을 출력하며, 어떤 행이 훈련 1행이고, 오늘 그 행이 몇 개나 있고, 무엇을 지금부터 더 담아야 하는가

### 자매 문서 — 역할을 갈라 놓았다(중복 금지)

| 문서                                                                                                            | 무엇의 정본                                                          | 이 문서와의 관계                                                                                                 |
| --------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| [`own-model-finetune-serving-roadmap-2026-08-09.md`](./own-model-finetune-serving-roadmap-2026-08-09.md) (#887) | Phase 0~3 로드맵 · 후보 채점 · 승격 기준 · GPU 금지                  | **이 문서는 그 §4-A "(b) 라우팅 autoselect" 한 칸을 확대한 것**이다. 로드맵을 바꾸지 않고 실행 가능하게만 만든다 |
| [`bq-ml-training-data-audit-2026-08-08.md`](./bq-ml-training-data-audit-2026-08-08.md)                          | 5테이블 스키마 · fill rate · 갭 **G1~G15**                           | 스키마·fill rate 를 **다시 적지 않는다**. 갭은 G번호로 인용만 한다                                               |
| [`research/routing-slm-data-collection.md`](./research/routing-slm-data-collection.md)                          | 라벨 결함 A/B/C · **"유효 라벨" 4조건** · 최소 라벨 수 · 다양성 요건 | 4조건을 **그대로 쓰고**, 라우팅 전용 3조건만 위에 얹는다(§3-B)                                                   |
| [`research/slm-router-summary.md`](./research/slm-router-summary.md)                                            | 2026-07 "SLM 라우터 GO 아님"                                         | **여전히 유효**. 이 문서는 그 판정을 뒤집지 않는다 — 판정을 뒤집을 **조건을 수치화**한다                         |
| [`free-slm-tier-feasibility-2026-08-09.md`](./free-slm-tier-feasibility-2026-08-09.md) (#885)                   | 원가 · 게이트웨이 · GPU 손익분기                                     | 서빙 원가는 거기가 정본. 여기서 재계산하지 않는다                                                                |

> **이 문서가 새로 만든 사실**: §3-C 의 실측은 **2026-08-09 라이브 BQ 재조회**다. 특히 (a) explicit 우회율 재측정(#887 §10 이 "2026-08-08 에 재측정되지 않았다"고 명시한 칸), (b) 라우팅 학습 가능 풀의 실제 크기, (c) 그 풀의 음성 비율·유저 수·셀 분포는 **어느 선행 문서에도 없던 수치**다.

---

## 0. 한 줄 결론

| 질문                     | 판정                                                                                                                                                   |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 무엇을 예측하는 모델인가 | **후보 한 칸씩** 채점하는 **pointwise** 모델. "어느 모델?"을 직접 뱉는 multiclass 가 **아니다**(§1-B)                                                  |
| 분류인가 회귀인가        | **둘 다 필요하고, 착수 순서가 다르다.** ①비용 **회귀**(오늘 학습 가능) ②성공 **이진분류**(음성 라벨 게이트 뒤). 최종 배포는 두 헤드의 가법 결합(§1-C)  |
| 오늘 당장 학습 가능한가  | **비용 회귀는 226행으로 가능. 성공 분류는 불가능**(음성 4건)                                                                                           |
| 라우팅 학습 가능 풀 크기 | **226행**(1층=하네스 해상도) / **7행**(2층=`model@effort` 해상도) — §3-C                                                                               |
| ★가장 아픈 사실          | **#887 이 고른 첫 타깃(autoselect)은 2층인데, 2층 라벨이 7건이다.** 액션(`spawnedModel`)이 dispatch 의 7.6% 에만 기록된다(§4-A F-1)                    |
| baseline 은 무엇인가     | `model-autoselect.ts`(2층) + `dispatch-scoring.ts`(1층)의 가법 가중합. **점수 분해가 이미 로그에 남아** shadow 비교가 공짜(§5-A)                       |
| 정확도로 평가하면 되나   | **안 된다.** "항상 성공" 이 **98.4%** 를 먹는다. 평가축은 정확도가 아니라 **동일 품질 하 기대비용**(§5-B)                                              |
| 지금 비용만 학습하면     | **전부 최저가로 몰린다.** 같은 `standard` 셀에서 claude 중앙값 $10.63 vs gpt $0.82 인데 라벨상 성공률은 둘 다 ~99% — **라벨이 품질차를 못 본다**(§5-C) |
| 그래서 1순위 계측은      | **무산출·모델귀책 실패 라벨**(G11+G10). 비용 라벨은 이미 충분하다. 없는 건 **품질의 반대쪽**이다(§4-A)                                                 |
| 학습을 시작할 조건은     | §6 게이트 4개. 그 전엔 **F-1~F-4 계측만** 한다(비용 $0)                                                                                                |

**권고 한 줄**: 라우팅 SLM 의 병목은 모델링도, 라벨 **개수**도 아니다. **액션 해상도(`model@effort`)와 실패의 귀책 구분** 두 가지다. 둘 다 스키마 소급이 불가능하므로 **지금 담는 것 말고는 방법이 없고**, 담는 비용은 $0 이다.

---

## 1. 태스크 정의

### 1-A. 어느 결정을 배우는가 — 라우팅은 **2층**이다

`model-autoselect.ts` 헤더 주석이 정확히 이 구조를 적어 놨고, 학습 타깃도 그 구조를 그대로 따라야 한다.

```
① 1층 — 프로바이더/하네스 선택        dispatch-scoring.scoreModelsDetailed()
        claude / gpt / grok / antigravity / local …
        성분: MODEL_BASE_SCORE + tagBonus/Penalty + costEff + budgetBias + agyBias + graphBias
        선택모드: top-score / round-robin-no-tags / tie-band-round-robin

② 2층 — 그 하네스 **안의 어느 칸**     model-autoselect.selectAutoModel()
        claude-opus-5 / claude-sonnet-5 / gpt-5.6-terra@high …
        성분: fit + cost + bench + capability + kg + diversity + usage + weeklyLimit
        선택모드: single / top-score / tie-rotate / explore
```

**두 층은 같은 모양(가법 성분 합 → 정렬 → 동률 회전)이지만 후보 공간이 다르다.** #887 이 고른 "(b) 모델 라우팅 autoselect" 는 **②층**이고, opus5 편중이라는 원래 증상도 ②층에서 났다.

> **설계 결정**: 학습층은 **두 층 모두에 같은 형태로 얹는다.** 성분 하나를 더하는 것뿐이라 코드 모양이 동일하고(`graphBias` 가 이미 두 층에 다 있다), 데이터는 ①층이 훨씬 많으므로 **①층으로 먼저 검증하고 ②층으로 내린다**. 이건 §3-C 실측(1층 226행 vs 2층 7행)이 강제하는 순서다.

### 1-B. 정식화 — 4개 후보 중 pointwise

| 정식화                                     | 모양                                                   | 채택?                                     | 이유                                                                                                                                                                                                                                                                                                        |
| ------------------------------------------ | ------------------------------------------------------ | ----------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **A. Multiclass**                          | `f(task) → argmax over {claude, gpt, …}`               | ❌                                        | 후보집합이 **매 dispatch 마다 다르다**(가용성·인증·프리셋·쿼터 소진으로 필터됨 — `modelAvailable`, `budgetBiasScore`가 `null` 이면 제외). 클래스가 유동적인데 multiclass 는 고정 출력층을 요구한다. 모델 1종 추가 = 전면 재학습. 게다가 라벨 분포가 극단(§3-D)이라 사실상 "claude 를 예측" 이 최적해가 된다 |
| **B. Pointwise 이진분류**                  | `f(task ⊕ candidate) → p(success)`                     | ✅ **주 헤드**                            | 후보를 **한 칸씩** 넣으므로 후보집합 가변에 무관. 새 모델은 피처(단가·벤치·능력등급)만 있으면 **콜드에서도 점수가 난다**. 출력이 확률이라 그대로 가법 성분으로 변환 가능                                                                                                                                    |
| **C. Pointwise 회귀**                      | `f(task ⊕ candidate) → log(cost)` 또는 `log(duration)` | ✅ **부 헤드 · ★오늘 유일하게 학습 가능** | 목표변수가 연속이라 **음성 라벨이 필요 없다**. §3-C 기준 226행으로 즉시 학습 가능                                                                                                                                                                                                                           |
| **D. Pairwise ranker / contextual bandit** | 후보쌍 비교 · 온라인 학습                              | ⏸ Phase 2 이후                            | counterfactual 문제를 정면으로 다루는 올바른 틀이지만, **탐색 데이터가 있어야** 의미가 있다. ε-greedy 케이스를 따로 세기 시작한 뒤(F-3) 재검토                                                                                                                                                              |

**★B 와 C 를 하나의 모델로 합치지 않는다.** 성공확률과 비용은 **승격 기준에서 역할이 다르다** — #887 §5-C 는 "품질 유지 AND (더 싸거나 더 빠름)" 이라는 **논리곱**이다. 한 스칼라로 뭉개면 "조금 나쁜데 많이 싼" 후보가 이겨 버리고, 그건 우리 제품의 실패모드("싸게 틀리는 것")를 그대로 학습하는 것이다.

### 1-C. 출력 계약 — `graphBias` 와 동형

학습층의 출력은 **모델 선택이 아니라 점수 성분 하나**다. 이 계약이 이 설계의 안전장치 전부다.

```ts
// 개념(코드 아님) — 두 층 공통
mlBias(task, candidate) =
    clamp(-20, +20,
        W_Q * (p̂_success(task ⊕ candidate) - p̄_context)        // B 헤드: 문맥 평균 대비
      + W_C * log2(ĉ_baseline / ĉ_candidate) )                   // C 헤드: 비용 배수(log)
```

| 불변식                    | 왜                                                                        | 어디서 온 패턴                           |
| ------------------------- | ------------------------------------------------------------------------- | ---------------------------------------- |
| **가법 성분 ±20**         | 기존 점수를 대체하지 않고 **경합**한다                                    | `routing-graph.graphBias` · `budgetBias` |
| **콜드 = 0**              | 관측 없는 문맥에서는 **정확히 종전 동작**(무회귀)                         | `graphBias` 콜드 0                       |
| **클램프**                | 학습층이 폭주해도 `role` 하드게이트·`reuseBonus` 를 못 넘는다             | `PerModelScore` 주석                     |
| **즉시 폴백**             | 모델 로드 실패·추론 예외 = 0 반환, dispatch 는 그대로 진행                | `removeColdStartPriors` 롤백 패턴        |
| **`p̄_context` 로 센터링** | 성공률이 98%대라 절대확률은 정보가 없다. **문맥 평균 대비 편차**만 신호다 | 이 문서(§5-B)                            |
| **비용은 log 배수**       | $3 과 $30 의 차이가 티어를 넘나들며 일관된 의미를 갖는다                  | `model-autoselect.log2Ratio`             |

### 1-D. 이 모델이 **하지 않는** 것

- 태스크 **분해**·티켓 생성 (#887 §4-A 채점표에서 마지막 — 실패가 조용하고 하류를 통째로 낭비)
- reuse vs spawn vs restart **결정** — 별 축이고, `reuseBonus` 는 운용 정책(정책은 학습 대상이 아니다)
- 승인게이트 칸(`max`/`ultra`) 선택 — `usableRungs()` 가 구조적으로 후보에서 제외한다. 학습층이 이 상한을 우회하면 #602 승인 왕복이 무의미해진다
- **핀 없는 하네스의 모델 결정** — `pinsModel=false` 인 하네스는 사용자 config 가 모델을 정한다. 우리가 고르는 건 effort 뿐이다

---

## 2. 입력 피처 — ★추론 시점에 아는 것만

### 2-A. 리키지 판정 기준

> **한 문장 규칙**: `emitDispatchDecision()` 이 호출되는 **그 순간** 메인 프로세스가 이미 손에 쥐고 있는 값만 피처다.

그 시점 이후에 생기는 값은 전부 **결과**다. 아래 표의 ⛔ 를 피처로 쓰면 오프라인 지표만 좋아지고 라이브에서는 그 값이 없다 — 조용히 실패하는 종류의 버그다.

### 2-B. 피처 표 (추론시점 가용 = ✅)

| #                                        | 피처                                | 타입        | 훈련시 출처(BQ)                                                          | 추론시 출처(코드)                                                     |    가용    | 현 상태                                              |
| ---------------------------------------- | ----------------------------------- | ----------- | ------------------------------------------------------------------------ | --------------------------------------------------------------------- | :--------: | ---------------------------------------------------- |
| **태스크 축**                            |                                     |             |                                                                          |                                                                       |            |
| T1                                       | `role`                              | cat(5)      | `events.role` (`dispatch:decision`)                                      | `dispatchTask` params                                                 |     ✅     | 100%                                                 |
| T2                                       | `complexity`                        | ord(3)      | `metadata.$.complexity`                                                  | dispatch 인자                                                         |     ✅     | 100%                                                 |
| T3                                       | `taskType`                          | cat(7)      | `task_outcomes.taskType`                                                 | ★`classifyTaskType(task)` — **순수·결정적 함수**라 추론시 그대로 계산 |     ✅     | 훈련측 85.5%                                         |
| T4                                       | `scopeFileCount`                    | int         | `task_outcomes.scopeFileCount`                                           | `task.scope.length`                                                   |     ✅     | 100%(0 기본)                                         |
| T5                                       | `promptLength`                      | int         | `task_outcomes.promptLength` (=description 길이) / `events.promptLength` | `task.description.length`                                             |     ✅     | 828/829                                              |
| T6                                       | `priority`                          | int         | `task_outcomes.taskComplexity` (★실제로는 priority)                      | `task.priority`                                                       |     ✅     | 채워짐                                               |
| T7                                       | `tags[]`                            | multi-hot   | `metadata.$.tags`                                                        | dispatch 인자                                                         |     ✅     | 대다수 빈 배열                                       |
| T8                                       | `hourOfDay` / `dayOfWeek`           | int         | `events.timestamp`                                                       | 시스템 시각                                                           |     ✅     | 100%                                                 |
| T9                                       | `projectIdHash`                     | cat         | `events.projectId`                                                       | params                                                                |     ✅     | 100% · ★고카디널리티 — 해시버킷 또는 제외(과적합 R6) |
| **후보 축**(모든 후보에 대해 1행씩 전개) |                                     |             |                                                                          |                                                                       |            |
| C1                                       | `harness`                           | cat(7)      | `metadata.$.eligibleModels` 원소                                         | `enabledModels`                                                       |     ✅     | 100%                                                 |
| C2                                       | `modelKey`(`model@effort`)          | cat         | ★`metadata.$.spawnedModel` — **선택된 칸만**                             | `autoCandidates()` 전체 후보                                          |     ⚠️     | **7.6%** — F-1                                       |
| C3                                       | `ladderStepsFromEntry`              | int(부호)   | 재구성(`model-ladder` 순수함수)                                          | `candidate.index - entryIndex`                                        |     ✅     | 재구성 가능                                          |
| C4                                       | `costIndex`(blended $/1M)           | float       | 재구성 — ★**당시 단가 스냅샷 부재**(F-4)                                 | `costIndexForModel`                                                   |     ⚠️     | 시점 드리프트                                        |
| C5                                       | `benchScore` / `benchmark`          | float / cat | `model-guidance` 재구성                                                  | 동일                                                                  |     ✅     | 일부 결측(정상)                                      |
| C6                                       | `capabilityTier`                    | ord(4)      | `model-registry`                                                         | 동일                                                                  |     ✅     | 100%                                                 |
| C7                                       | `isSubscriptionMetered`             | bool        | 재구성                                                                   | `isSubscriptionMeteredModel`                                          |     ✅     | 100%                                                 |
| **상태 축**(★전부 미기록 — F-2)          |                                     |             |                                                                          |                                                                       |            |
| S1                                       | `budgetUsedPercent`                 | float       | ⛔ **BQ 에 없음**                                                        | `budgets[model].usedPercent`                                          | ✅(런타임) | **0%** — F-2                                         |
| S2                                       | `weeklyTokenShare`                  | float       | ⛔ 없음                                                                  | `usageRollup`                                                         | ✅(런타임) | **0%** — F-2                                         |
| S3                                       | `kgObservations n`                  | int         | ⛔ 없음                                                                  | `observationCountForModel`                                            | ✅(런타임) | **0%** — F-3                                         |
| S4                                       | `activeAgentCount` / `perRoleCount` | int         | ⛔ 없음                                                                  | `checkSpawnConstraints`                                               | ✅(런타임) | **0%** — F-2                                         |
| S5                                       | `reuseVsSpawn`                      | cat(3)      | `metadata.$.reuseVsSpawn`                                                | 결정의 일부                                                           |     ⚠️     | 100% · ★§2-D                                         |

**★S 축 전체가 훈련 데이터에 없다는 것이 이 표의 핵심이다.** 추론시엔 전부 있고 baseline 은 이미 이 값들로 점수를 매기는데, **BQ 에는 그 입력이 하나도 안 남는다.** 그래서 오프라인 리플레이가 baseline 을 재현조차 못 한다 — F-2 가 F-1 다음으로 급한 이유다.

### 2-C. ⛔ 리키지 — 결과 이후에만 아는 필드 (명시적 제외)

| 필드                                                         | 출처                   | 왜 리키지인가                                                            |
| ------------------------------------------------------------ | ---------------------- | ------------------------------------------------------------------------ |
| `success`                                                    | `task_outcomes`        | **이게 라벨이다**                                                        |
| `errorCategory`                                              | `task_outcomes`        | 라벨의 일부(실패 사유)                                                   |
| `durationMs`                                                 | `task_outcomes`        | 완료 후. 게다가 티켓 리드타임이라 의미도 오염(`taskOutcome.ts` 주석)     |
| `totalCost` · `totalInputTokens` · `totalOutputTokens`       | `task_outcomes`        | **회귀 목표변수**                                                        |
| `cost_logs.*` 집계                                           | `cost_logs`            | 동상                                                                     |
| `retriesCount`                                               | `task_outcomes`        | 재시도는 결과                                                            |
| `filesChanged` · `linesChanged` · `changeType`               | `events` `task:merged` | 머지는 결정보다 **며칠 뒤**. 라벨 후보이지 피처가 아니다                 |
| `task_outcomes.model` · `detectedModelId`                    | 과금 세션 관측         | 스폰 **후에** 관측된 값                                                  |
| `agent:crashed` / `agent:restarted` / `agent:stopped` 카운트 | `events`               | 실행 중·후                                                               |
| `agentScore` (reuse 경로)                                    | `metadata`             | 후보 에이전트가 **존재할 때만** 있는 값 — spawn 경로엔 없다. 축이 다르다 |

### 2-D. ★리키지는 아니지만 **금지**인 두 필드

| 필드                                      | 왜 위험한가                                                                                                                                                                                                            | 처분                                                 |
| ----------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------- |
| **`perModelScores`** (baseline 성분 분해) | 추론시점에 **있긴 하다**(baseline 이 방금 계산했다). 그런데 이걸 피처로 넣으면 학습층은 **baseline 을 모방**하는 게 최적해가 되고, 그 순간 "baseline 을 이기는가" 라는 유일한 평가 질문이 **정의상 답할 수 없게** 된다 | **피처 금지. 비교축 전용**(§5-A)                     |
| **`explicitModel`**                       | 사람이 모델을 명시했는지 여부. 이걸 피처로 넣으면 라우터가 아니라 **"사람이 무엇을 고르는지 흉내내는 모델"** 이 나온다(#887 R2 · 라우팅 SLM §7.3)                                                                      | **피처 금지. 샘플 선택 축**(=`false` 인 행만 학습셋) |
| `spawnedModel`                            | 실제로 스폰된 칸                                                                                                                                                                                                       | **액션(라벨의 조건부)** 이지 피처가 아니다           |

### 2-E. 프라이버시 불변식 (#887 §2 계약 그대로)

- 원장(`audit_logs`) `params` **원문은 학습셋에 절대 들어가지 않는다.** 행위층에서 쓸 수 있는 건 툴 이름 시퀀스·성공/실패·소요시간 같은 **파생 특징**뿐
- 프롬프트·티켓 본문 금지 — **해시 + 길이만**(T5). `classifyTaskType`(T3)은 본문을 읽지만 **로컬 순수함수**이고 나가는 값은 7종 enum 하나다
- 스크럽은 **denylist** — 새 피처 필드를 추가할 때 `lib/telemetry/scrub.ts` 규칙 동반 검토가 **계약상 필수**(#887 R8)

---

## 3. 데이터셋 구성

### 3-A. 조인 — 4테이블, 축이 셋 (`taskId` · `agentId` · 재구성)

```
events(dispatch:decision)                      ← 결정 피처 + 액션 (1행 = 1 dispatch)
   │  agentId ──► events(agent:spawned)        ← promptHash/promptLength, harness 확인
   │  agentId ──► cost_logs  ──┐
   │                            ├─ SUM(totalCost) 실비용  ★agentId 로 붙여야 정확
   │  taskId  ──► cost_logs  ──┘                 (cost.taskId 는 행 기준 26.9%, G4)
   │  taskId  ──► task_outcomes                ← success / errorCategory / taskType / scopeFileCount
   │  taskId  ──► events(task:merged)          ← ★사람이 수용했나(강한 품질 라벨)
   └─ 재구성: model-ladder / model-registry / model-guidance  ← C3~C7 후보 피처
```

```sql
-- 학습단위 뷰의 뼈대 (#887 P0-1 `training_decisions` 의 라우팅 슬라이스)
-- ★1 dispatch = 1행. 후보 전개(§3-E)는 이 위에서 한다.
WITH d AS (
  SELECT
    taskId, agentId, timestamp AS decided_at,
    model                                        AS harness,          -- C1
    role,                                                             -- T1
    JSON_VALUE(metadata, '$.complexity')         AS complexity,       -- T2
    JSON_QUERY_ARRAY(metadata, '$.tags')         AS tags,             -- T7
    JSON_QUERY_ARRAY(metadata, '$.eligibleModels') AS eligible,       -- 후보집합
    JSON_VALUE(metadata, '$.explicitModel')      AS explicit_model,   -- ★샘플 선택 축
    JSON_VALUE(metadata, '$.reuseVsSpawn')       AS reuse_vs_spawn,
    JSON_VALUE(metadata, '$.selectedModel')      AS selected_harness, -- 액션(1층)
    JSON_VALUE(metadata, '$.spawnedModel')       AS spawned_model_key,-- 액션(2층) ★7.6%
    JSON_VALUE(metadata, '$.modelSelectionMode') AS selection_mode,   -- 준-실험 표식
    JSON_QUERY_ARRAY(metadata, '$.perModelScores') AS per_model_scores-- ★비교축 전용
  FROM `marblo-2253d.marblo_telemetry.events`
  WHERE event = 'dispatch:decision' AND taskId IS NOT NULL
),
-- ★outcome 은 taskId 당 여러 행이 있을 수 있다(927행 / 897 distinct).
--   dedup 없이 LEFT JOIN 하면 조인 팬아웃으로 카운트가 부풀어 오른다.
o AS (
  SELECT taskId,
    ANY_VALUE(success) AS success, ANY_VALUE(errorCategory) AS error_category,
    ANY_VALUE(taskType) AS task_type, ANY_VALUE(scopeFileCount) AS scope_file_count,
    ANY_VALUE(promptLength) AS prompt_length, ANY_VALUE(taskComplexity) AS priority
  FROM `marblo-2253d.marblo_telemetry.task_outcomes` GROUP BY taskId
),
-- 실비용은 agentId 로 붙인다. cost_logs 1행 = 15초 폴 델타(턴 아님)이므로 SUM.
c AS (
  SELECT agentId, SUM(totalCost) AS cost_usd,
         SUM(inputTokens) AS tok_in, SUM(outputTokens) AS tok_out,
         STRING_AGG(DISTINCT model ORDER BY model LIMIT 3) AS observed_model_ids
  FROM `marblo-2253d.marblo_telemetry.cost_logs` GROUP BY agentId
),
m AS (SELECT DISTINCT taskId, TRUE AS merged FROM `marblo-2253d.marblo_telemetry.events` WHERE event='task:merged')
SELECT d.*, o.*, c.cost_usd, c.tok_in, c.tok_out, IFNULL(m.merged, FALSE) AS merged
FROM d LEFT JOIN o USING(taskId) LEFT JOIN c USING(agentId) LEFT JOIN m USING(taskId);
```

**조인 함정 3개** (전부 실측으로 밟았다):

1. **outcome 팬아웃** — `task_outcomes` 는 taskId 당 1행이 아니다(927행 / 897 distinct). dedup 없이 조인하면 249 가 273 으로 보인다
2. **비용은 `agentId`, 라벨은 `taskId`** — `cost_logs.taskId` 는 **행 기준 26.9%**(G4)지만 `agentId` 는 100%. 단 한 에이전트가 여러 태스크를 처리하면 `agentId` 집계가 과대계상되므로, `taskId` 가 있는 행이 있으면 그쪽을 우선한다
3. **`userId` 로 조인 금지** — `task_outcomes.userId`(clientId)와 `cost_logs.userId`(Firebase uid)는 **다른 공간**이라 교집합이 0이다. `taskId` 만이 다리다(메모 `cost_axis_userid_spaces_and_reread_dupes`)

### 3-B. "유효 라벨" 정의 — 기존 4조건 + 라우팅 전용 3조건

> **재정의하지 않는다.** 조건 1~4 는 `research/routing-slm-data-collection.md` §7.1 그대로다.

| #     | 조건                                                                                                                    | 출처                                               |
| ----- | ----------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------- |
| 1     | `taskId` 로 **결정 ↔ 결과**가 실제 조인됨                                                                               | 기존 §7.1                                          |
| 2     | 결과가 **성공/실패 양쪽**을 표현 (음성 클래스 존재)                                                                     | 기존 §7.1                                          |
| 3     | **비용/토큰이 태스크 귀속** (에이전트 생애 누적 아님)                                                                   | 기존 §7.1                                          |
| 4     | 태스크 특징(complexity·changeType·규모)이 **NULL 아님**                                                                 | 기존 §7.1                                          |
| **5** | ★**비-explicit** — 스코어링이 실제로 작동한 결정                                                                        | **이 문서** — 조건 5 없이는 "사람 흉내" 학습(§2-D) |
| **6** | ★액션이 **`model@effort` 해상도**로 기록됨 (`spawnedModel` non-null)                                                    | **이 문서** — 2층 학습의 전제                      |
| **7** | ★실패가 **모델 귀책과 구분**됨 (`errorCategory ∈ {MODEL_FAIL, NO_OUTPUT, TIMEOUT, TOOL}`; `BLOCKED_DEP`·`AUTH` 는 제외) | **이 문서** — G10                                  |

**조건 7 의 논리**: 지금 음성 라벨 39건 중 **33건이 BLOCKED**(의존성 대기·권한 문제)이고 **FAILED 는 6건**이다. BLOCKED 를 음성으로 학습하면 분류기가 배우는 것은 "이 모델이 못한다" 가 아니라 **"이 태스크가 막혔다"** 다. 그건 모델 선택으로 고칠 수 없는 것이고, 라우터가 그걸 학습하면 **막히기 쉬운 태스크에 비싼 모델을 붙이는** 정반대 정책이 나온다.

**★"재시도"의 처분**: `retriesCount` 는 라벨 축이지 피처가 아니다. 다만 **오늘은 신호가 죽어 있다**(927행 중 >0 은 1행 — G6). 살아나면 **약한 음성**(=성공했지만 N회 재시도)으로 쓰는 것이 옳다 — 이진 라벨보다 정보량이 크고, 음성이 희소한 우리 상황에서 특히 값지다. **F-5** 로 둔다.

### 3-C. ★오늘 실제로 몇 행인가 — 유효 라벨 퍼널 (2026-08-09 실측)

```sql
-- §3-A 의 d / o / c CTE 위에서 (설명용 축약)
SELECT
  COUNT(*)                                                            AS f1_joined,
  COUNTIF(explicit_model='false')                                     AS f2_nonexplicit,
  COUNTIF(explicit_model='false' AND cost_usd > 0)                    AS f3_cost_attributed,
  COUNTIF(explicit_model='false' AND cost_usd > 0
          AND task_type IS NOT NULL AND complexity IS NOT NULL)       AS f4_features_ok,
  COUNTIF(... AND spawned_model_key IS NOT NULL)                      AS f5_action_at_effort,
  COUNTIF(explicit_model='false' AND success = FALSE)                 AS f_negative
FROM joined;
```

| 단계   | 조건                                |     **행 수** |    통과율 |
| ------ | ----------------------------------- | ------------: | --------: |
| 볼륨   | `dispatch:decision` distinct taskId |     **1,408** |         — |
| F1     | + outcome 조인 (조건 1)             |       **829** |     58.9% |
| F2     | + 비-explicit (조건 5)              |       **249** |     30.0% |
| F3     | + 비용 태스크 귀속 (조건 3)         |       **247** |     99.2% |
| F4     | + 피처 non-NULL (조건 4)            |       **226** |     91.5% |
| **F5** | + **`model@effort` 액션** (조건 6)  |        **★7** |  **3.1%** |
| —      | 그중 **음성**(조건 2)               | **★4** (1.6%) |         — |
| —      | 그중 조건 7(모델 귀책) 통과         |        **★0** | 어휘 부재 |

**읽는 법 — 세 문장**

1. **1층(하네스) 회귀는 오늘 학습 가능하다.** 226행이면 피처 8~10개짜리 log-cost 회귀에 부족하지 않다(라우팅 SLM §7.2 의 ML-3 회귀 하한 500 에는 못 미치지만, **셀당 분산**이 크므로 PoC 는 선다).
2. **2층(`model@effort`)은 7행이다.** #887 이 고른 첫 타깃이 정확히 이 층이고, 원래 증상(opus5 편중)도 이 층이다. **F-1 없이는 이 층은 영원히 학습 불가**다.
3. **성공 분류는 어느 층에서도 불가능하다.** 음성 4건이고, 그마저 조건 7 을 못 통과한다.

**부수 실측 (전부 신규)**

| 축                                | 값                                                                                                       | 비고                                                                                            |
| --------------------------------- | -------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| **explicit 우회율**               | **83.6%** (1,937 / 2,316)                                                                                | 07-18 의 **97.8% → 83.6%** 로 개선. #887 §10 이 "재측정 안 됨"으로 남긴 칸                      |
| `perModelScores` 비어있지 않은 행 | 379                                                                                                      | ★비-explicit 379 와 **정확히 일치** — 점수 스냅샷은 explicit 경로에서 여전히 0(G13 미수리 확진) |
| `spawnedModel` 기록률             | **176 / 2,316 (7.6%)**                                                                                   | 08-02 주부터 유입 시작(P2-3). 그 주에도 160/468 = 34%                                           |
| `spawnedModel` 값 종류            | **5종** (`claude-opus-5` 97 · `grok-4.5` 68 · `MiniMax-M2.7` 8 · `gpt-5.6-luna@high` 2 · `MiniMax-M3` 1) | ★`@effort` 접미사가 붙은 건 **1종 2행**                                                         |
| `task:merged`                     | 48 태스크, 그중 **45(94%)가 outcome 과 조인**                                                            | ★가장 건강한 라벨 경로. 수가 적을 뿐 품질은 최상                                                |
| `errorCategory` 어휘              | `(null)` 888 · `BLOCKED` 33 · `FAILED` 6                                                                 | 상태 문자열 그대로(`taskOutcome.ts:209`) — G10 미수리                                           |
| 유효 풀 유저 수                   | **4명** (전체 outcome 유저 7명)                                                                          | 운영 요건 ≥20 (R6 과적합)                                                                       |

### 3-D. 다양성 — 9셀 중 2셀만 산다

유효 풀 249행의 (하네스 × 복잡도) 분포:

| harness     | complexity      |       n | 음성 |
| ----------- | --------------- | ------: | ---: |
| claude      | standard        | **146** |    1 |
| gpt         | standard        |  **82** |    1 |
| claude      | complex         |      10 |    1 |
| antigravity | standard        |       5 |    0 |
| gpt         | simple          |       3 |    0 |
| gpt         | complex         |       2 |    1 |
| antigravity | complex         |       1 |    0 |
| —           | **simple 전체** |   **3** |    0 |

- 요건(라우팅 SLM §7.2)은 **모델 3종 × 복잡도 3단 = 9셀, 셀당 ≥30**. 충족 셀은 **2개**
- **`simple` 이 3행**이다. 그런데 `simple` 은 비용 절감 여지가 가장 큰 구간이고 `COST_WEIGHT` 가 가장 높은(12) 티어다 — **학습층이 가장 이득을 낼 곳에 데이터가 없다**
- **`grok`·`local`·env-swap 벤더는 이 표에 아예 없다** — 유효 풀에 0행

### 3-E. 후보 전개 — 1 dispatch → N 훈련행

pointwise(§1-B)는 **후보마다 1행**이 필요하다. 그런데 **관측된 결과는 선택된 후보에만 있다** — 이것이 라우팅 오프라인 학습의 원리적 상한이다(counterfactual, #887 §5-A).

| 전개 방식                                          | 라벨           | 쓸 수 있나                                                                                                                 |
| -------------------------------------------------- | -------------- | -------------------------------------------------------------------------------------------------------------------------- |
| **선택된 후보 1행**                                | 실측 결과      | ✅ 항상                                                                                                                    |
| **비선택 후보 N-1행**                              | 없음           | ❌ 지어내지 않는다                                                                                                         |
| **비선택 후보 — 다른 태스크의 유사 문맥에서 관측** | 문맥 매칭 추정 | ⚠️ `routing-graph` 가 이미 하는 일. **학습셋에 넣지 않는다**(같은 사실 이중계상)                                           |
| **★ε-greedy / tie-rotate 로 실제 눌러 본 칸**      | 실측 결과      | ✅ **유일한 준-실험 데이터** — `selection_mode ∈ {explore, tie-rotate, tie-band-round-robin, round-robin-no-tags}` 로 식별 |

> **그래서 `selection_mode` 를 학습셋에 **표식으로** 보존한다.** 준-실험 서브셋은 표본이 작지만 **편향이 없는 유일한 부분집합**이라, 평가(§5)에서 가중치가 다르다. `modelSelectionMode` 는 이미 380행에 기록돼 있다.

---

## 4. 훈련 1행 — 예시 스키마

### 4-A. JSON 예시 (비식별 · 값은 실측 분포에서 뽑은 대표값)

```jsonc
{
  "schema_version": "routing-v1",
  "row_id": "TdlWmESRnuGr7zltvRKM::claude-opus-5", // taskId::candidateKey
  "decided_at": "2026-08-08T00:37:28Z",

  // ── 피처: 추론 시점에 전부 알 수 있는 값만 ─────────────────────────────
  "features": {
    // 태스크 축 (§2-B T1~T9)
    "role": "backend", // cat(5)   ← events.role
    "complexity": "standard", // ord(3)   ← metadata.$.complexity
    "task_type": "feature", // cat(7)   ← classifyTaskType() 순수함수
    "scope_file_count": 3, // int      ← task_outcomes.scopeFileCount
    "prompt_length": 2199, // int      ← task_outcomes.promptLength
    "priority": 2, // int      ← task_outcomes.taskComplexity
    "tags": [], // multi-hot← metadata.$.tags
    "hour_of_day": 0, // int      ← events.timestamp
    "day_of_week": 5, // int      ← events.timestamp
    "project_bucket": 7, // cat(16)  ← hash(projectId) % 16  ★고카디널리티 방어

    // 후보 축 (§2-B C1~C7) — 이 행이 채점하는 "한 칸"
    "candidate_harness": "claude", // cat(7)
    "candidate_model_key": "claude-opus-5", // cat    ← ★spawnedModel (오늘 7.6%)
    "candidate_pins_model": true, // bool     ← ladder.pinsModel
    "ladder_steps_from_entry": 0, // int      ← candidate.index - entryIndex
    "cost_index_blended": 15.0, // float    ← costIndexForModel  ★F-4 스냅샷 필요
    "bench_score": 80.0, // float?   ← model-guidance (없으면 null)
    "bench_name": "SWE-bench Pro", // cat?     ← ★같은 벤치끼리만 비교 가능
    "capability_tier": 3, // ord(4)   frontier=3
    "is_subscription_metered": true, // bool
    "candidate_set_size": 6, // int      ← eligibleModels.length

    // 상태 축 (§2-B S1~S4) — ★오늘 전부 null. F-2/F-3 이 채운다
    "budget_used_percent": null, // float?   ← budgets[harness].usedPercent
    "weekly_token_share": null, // float?   ← usageRollup
    "kg_observations_n": null, // int?     ← observationCountForModel
    "active_agent_count": null, // int?     ← checkSpawnConstraints
  },

  // ── 액션: 이 후보가 실제로 선택됐는가 ────────────────────────────────
  "action": {
    "chosen": true, // false 인 행은 라벨이 없다(§3-E)
    "selection_mode": "top-score", // ★준-실험 식별자
    "reuse_vs_spawn": "spawn",
  },

  // ── 라벨: 결정 이후에만 아는 값 (⛔ 절대 피처로 쓰지 않는다) ──────────
  "label": {
    "success": true, // ← task_outcomes.success (DONE=true)
    "error_category": null, // ← ★오늘 "FAILED"/"BLOCKED" 뿐. F-6 이 세분화
    "merged_by_human": true, // ← events task:merged  ★DONE 보다 강한 라벨
    "cost_usd": 25.58, // ← SUM(cost_logs.totalCost) BY agentId
    "tokens_in": 418,
    "tokens_out": 207398,
    "duration_ms": 1612560, // ⚠️ 티켓 리드타임 — 목표변수로 쓰지 말 것
    "retries_count": 0, // ← ★오늘 신호 죽음(927행 중 1행만 >0)
    "label_quality": "weak", // strong = merged_by_human 있음 / weak = DONE 클릭만
  },

  // ── 메타: 학습에 안 쓰고 평가·감사에만 쓴다 ──────────────────────────
  "meta": {
    "baseline_scores": [
      // ★§2-D — 피처 금지, 비교축 전용
      {
        "model": "claude",
        "total": 78,
        "base": 50,
        "costEff": 2,
        "budgetBias": 6,
        "graphBias": 0,
        "agyBias": 0,
        "tagBonus": 20,
        "tagPenalty": 0,
      },
    ],
    "baseline_reason": "auto-model[standard] claude-opus-5 (entry claude-opus-5 유지; fit +0, cost +0, kg +0(cold), diversity +3.2 …)",
    "explicit_model": false, // ★샘플 선택 축 — false 만 학습셋에
    "client_user_bucket": 1, // 유저 축(과적합 진단용, 피처 아님)
    "app_version": "3.0.19",
  },
}
```

### 4-B. 목표변수 — 두 헤드

| 헤드        | 목표변수                                        | 변환                                                                                                    | 손실                    | 오늘 학습 가능?  |
| ----------- | ----------------------------------------------- | ------------------------------------------------------------------------------------------------------- | ----------------------- | :--------------: |
| **C(비용)** | `label.cost_usd`                                | `log1p(cost)` — 분포가 로그정규에 가깝다(중앙값 $10.63, 최대 $73.25)                                    | Huber(이상치 방어)      |   ✅ **226행**   |
| **B(품질)** | `label.success` **AND** `label.merged_by_human` | 2단 라벨: `merged=true` → 1.0 / `DONE only` → 0.8 / `FAILED(모델귀책)` → 0.0 / `BLOCKED_DEP` → **제외** | 로지스틱 + class weight |  ❌ **음성 4**   |
| (보조)      | `label.retries_count`                           | `min(n, 3)`                                                                                             | 순서형                  | ❌ 신호 죽음(G6) |

**★`merged_by_human` 을 0.8/1.0 로 가르는 이유**: DONE 클릭은 에이전트가 셀프 보고한 것이고, 머지는 **사람이 실제로 수용한 것**이다. 두 라벨을 같은 1.0 으로 뭉개면 우리가 가진 **유일하게 벤더가 못 가지는 신호**(#887 §7-A)를 스스로 버리는 것이다. 오늘 머지 라벨은 48건이지만 **94% 가 outcome 과 조인**된다 — 수는 적어도 품질이 가장 높다.

---

## 5. 평가축 — ★baseline 을 못 이기면 학습할 이유가 없다

### 5-A. baseline 은 공짜로 이미 있다

| baseline                | 어디                                   | 무엇이 이미 로그에 있나                                         |
| ----------------------- | -------------------------------------- | --------------------------------------------------------------- |
| **B0. 현행 규칙 (1층)** | `dispatch-scoring.scoreModelsDetailed` | `perModelScores` 성분 분해 + `modelSelectionMode` (380행)       |
| **B1. 현행 규칙 (2층)** | `model-autoselect.selectAutoModel`     | `decisionReason` 문자열에 **8성분 전부** + `mode` + `decidedBy` |
| **B2. 최빈 클래스**     | —                                      | "항상 `claude-opus-5`"                                          |
| **B3. 항상 성공 예측**  | —                                      | 성공률 상수                                                     |

> **shadow 인프라가 사실상 이미 있다**(#887 §4-A). `formatAutoReason()` 이 `fit/cost/swe/cap/kg/diversity/usage/weekly` 를 전부 문자열로 남기므로, 학습층 예측과 현행 점수의 **사후 대조가 지금 데이터로도 가능하다**. 다만 문자열이라 파싱이 필요하다 — **F-3 이 이걸 구조화 필드로 올린다.**

### 5-B. ★정확도로 평가하면 안 된다

```
유효 풀 249행 중 성공 245 → "항상 성공" 예측의 정확도 = 98.4%
```

**어떤 학습 모델도 이 숫자를 유의미하게 못 넘는다.** 정확도를 지표로 쓰면 "모델이 잘 작동한다"는 착시가 나오고, 실제로는 상수함수를 배운 것이다. 지표는 **결정과 직결된 것**이어야 한다:

| 지표                         | 정의                                                                    | 왜 이것인가                                                               |
| ---------------------------- | ----------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| **★기대비용 / 성공**         | `Σ cost / Σ success` (라우터 정책별)                                    | #887 §5-C 승격 기준의 직접 번역                                           |
| **오프라인 리플레이 regret** | baseline 이 고른 칸 vs 학습층이 고른 칸 — **둘 다 관측된 태스크에서만** | counterfactual 한계를 정직하게 인정하는 유일한 형태                       |
| **준-실험 서브셋 승률**      | `selection_mode ∈ {explore, tie-*, round-robin}` 인 행에서 A/B          | ★유일하게 편향 없는 부분집합(§3-E)                                        |
| **비용 회귀 지표**           | Spearman ρ (순위), MAE(log-cost)                                        | 회귀 헤드는 **절대값이 아니라 순위**가 쓰인다                             |
| **캘리브레이션**             | Brier score / reliability curve                                         | `p̂` 를 ±20 점수로 바꿀 때 캘리브레이션이 안 맞으면 클램프가 상시 포화된다 |
| **셀 커버리지**              | 9셀 중 예측이 실제로 다른 셀 수                                         | 상수함수 조기 검출                                                        |

### 5-C. ★지금 비용만 학습하면 무슨 일이 나는가 (실측 경고)

같은 `complexity=standard` 셀 안에서:

| harness         |   n |    p25 | **중앙값** |    p75 |   최대 | 라벨상 성공률 |
| --------------- | --: | -----: | ---------: | -----: | -----: | ------------: |
| claude          | 147 |  $7.03 | **$10.63** | $17.23 | $73.25 |          ~99% |
| gpt             |  81 |  $0.54 |  **$0.82** |  $1.67 | $13.94 |          ~99% |
| claude(complex) |  10 | $11.90 |     $16.85 | $43.85 | $55.39 |           90% |

**중앙값 13배 차이인데 라벨상 성공률은 같다.** 비용 헤드만 켜면 라우터는 **전부 gpt 로 몰고**, `success` 라벨은 그걸 **문제로 인식하지 못한다**.

그런데 우리 실측은 정반대를 말한다 — **gpt·grok 은 복잡 in-repo 코딩에서 무산출**이었다(메모 `spawn_model_pref_codex_grok_save_claude`, #885 §7-B). 즉 **비용차의 상당 부분은 "일을 덜 한 것"** 일 수 있는데, 지금 라벨 체계는 무산출을 **성공으로 기록**한다(무산출 전용 카테고리 부재 — G11, BQ 감사 §5.3).

> **★이것이 이 문서의 가장 중요한 결론이다.** 라우팅 SLM 의 1순위 계측은 **더 많은 라벨**이 아니라 **무산출·모델귀책 실패를 성공과 가르는 라벨**이다. 그게 없으면 학습층은 **품질을 팔아 비용을 사는** 정책으로 수렴하고, 평가 지표는 그걸 못 잡는다.

**계약**: **품질 헤드(B) 없이 비용 헤드(C) 단독 배포 금지.** C 단독은 **오프라인 분석용**으로만 쓴다.

### 5-D. 승격·폐기 판정 (#887 §5-C 를 이 태스크에 특화)

```
승격 ⟺ 준-실험 서브셋에서 품질 무회귀
        AND 기대비용/성공 개선 ≥ 10%
        AND shadow 2주 이상
        AND 셀 커버리지 ≥ 4/9
폐기 ⟺ 오프라인 regret 이 B1(현행 규칙) 대비 개선 없음
        (= 학습층이 baseline 을 못 이긴다 → 여기서 멈추는 것이 가장 싼 실패다)
```

**폐기가 이 프로젝트의 정상적 결말일 수 있다.** `model-autoselect.ts` 는 손튜닝이지만 **근거 기반**이고(#654~656), 8성분이 이미 비용·벤치·쿼터·관측·탐색을 전부 본다. 226행짜리 회귀가 이걸 이길 이유는 **선험적으로 없다**. 이기지 못하면 그 사실 자체가 결과이고, 우리는 $0 로 그걸 알게 된다.

---

## 6. 착수 게이트 — 무엇이 초록이 되면 학습을 시작하나

| #       | 게이트                                        | 목표 |       **2026-08-09 실측** | 막는 갭           |
| ------- | --------------------------------------------- | ---: | ------------------------: | ----------------- |
| **G-a** | 유효 라벨(1층, 조건 1·3·4·5)                  |  300 |                   **226** | 시간/유저         |
| **G-b** | 유효 라벨(2층, +조건 6)                       |  300 |                    **★7** | **F-1**           |
| **G-c** | 음성 라벨 비율(조건 2·7)                      | ≥15% | **1.6%** (모델귀책 **0**) | **F-6** (G10/G11) |
| **G-d** | 셀 커버리지 (모델 3종 × 복잡도 3단, 셀당 ≥30) |  9/9 |                   **2/9** | 유저·다양성       |
| **G-e** | dispatch↔outcome 조인율                       | ≥80% |                 **58.9%** | G9                |
| **G-f** | 상태 축(S1~S4) 기록률                         | ≥90% |                    **0%** | **F-2**           |
| **G-g** | 유저 수                                       |  ≥20 |                     **4** | 활성화·배포       |

> **G-b·G-c·G-f 는 코드로 고칠 수 있다(전부 $0). G-a·G-d·G-g 는 못 고친다 — 유저가 만든다.** #887 §3-E 와 같은 결론이고, 이 문서의 실측이 그걸 한 번 더 확인한다.

---

## 7. ★향후 계측 — 지금부터 담아야 할 것 (스키마 소급 불가)

**우선순위 기준**: ①이 필드 없이는 학습이 **원리적으로** 불가능한가 ②소급 불가인가 ③비용이 $0 인가.

| #        | 무엇                                                                                                                                                                                                                                 | 어디에                                                  | 왜 이 순위인가                                                                                                       | 크기 | 대응 갭   |
| -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- | :--: | --------- |
| **F-1**  | ★**`spawnedModel` 을 모든 dispatch 에 강제** — 핀 안 하는 하네스도 최소 `resolveConcreteModel()` 관측값으로 채우고, **비선택 후보집합도 `model@effort` 해상도로** 기록(`candidateKeys[]`)                                            | `bridge-server.emitDispatchDecision`                    | **2층 학습의 유일한 전제.** 오늘 7.6%·유효 7행. 이게 없으면 #887 이 고른 첫 타깃이 영원히 학습 불가                  |  S   | — (신규)  |
| **F-2**  | ★**결정 시점 상태 스냅샷** — `budgetUsedPercent`, `weeklyTokenShare`, `activeAgentCount`, `poolTokens` 를 `metadata` 에                                                                                                              | 동상                                                    | baseline 이 **이 값들로 점수를 매기는데 BQ 에 하나도 없다.** 없으면 오프라인 리플레이가 baseline 을 재현조차 못 한다 |  S   | — (신규)  |
| **F-3**  | ★**결정 근거 구조화** — `decisionReason` 문자열에만 있는 8성분(`fit/cost/bench/cap/kg/diversity/usage/weeklyLimit`)과 `mode`·`decidedBy`·`observations`·`totalObservations` 를 **필드로**. explicit 경로에서도 후보 점수 스냅샷 강제 | 동상                                                    | 지금은 문자열 파싱 = 취약. 그리고 **explicit 83.6% 경로에 점수가 0개**라 그 구간이 통째로 비교 불가                  |  S   | **G13**   |
| **F-4**  | **단가 스냅샷** — 결정 시점 `costIndex`·`pricingSnapshot` 을 함께 기록                                                                                                                                                               | 동상 + `cost_logs.pricingSnapshot`(현재 0%)             | 단가는 바뀐다. 6개월 뒤 재구성하면 **당시 결정 근거가 아닌 값**으로 학습한다                                         |  S   | **G5**    |
| **F-5**  | **재시도 실값** — 재스폰·재클레임 시 `retriesCount` increment + `retryOf`/`parentAgentId` 링크                                                                                                                                       | `agent-manager` / `taskService`                         | 음성이 희소한 상황에서 **약한 음성**은 정보량이 크다(§3-B)                                                           |  M   | **G6·G7** |
| **F-6**  | ★**`errorCategory` 세분화** — `MODEL_FAIL / NO_OUTPUT / TIMEOUT / TOOL / AUTH / BLOCKED_DEP / CANCELLED`                                                                                                                             | `taskOutcome.buildTaskOutcome` (현재 상태문자열 그대로) | **조건 7 의 전제.** 오늘 음성 39 중 33 이 BLOCKED 라 그대로 학습하면 정반대 정책이 나온다                            |  S   | **G10**   |
| **F-7**  | ★**무산출 판정** — 에이전트 종료 시 `outputChars`/`filesChanged`/`prUrl` 집계 → `success=false, errorCategory=NO_OUTPUT`                                                                                                             | `agent-manager` stop 훅                                 | §5-C 의 13배 비용차가 **품질차인지 무산출인지** 가르는 유일한 신호                                                   |  M   | **G11**   |
| **F-8**  | **outcome 무조건 upsert** — DONE/FAILED/BLOCKED 상태전이 시 + 실패 시 dead-letter                                                                                                                                                    | `taskService`                                           | 조인율 58.9 → 80%                                                                                                    |  M   | **G9**    |
| **F-9**  | **`agent:spawned.taskId`** 부착                                                                                                                                                                                                      | `agent-manager`                                         | 스폰 단위 조인의 최단 경로(현재 0%)                                                                                  |  S   | **G1**    |
| **F-10** | **탐색 케이스 별도 집계** — `selection_mode` 별 카운터 + 대시보드                                                                                                                                                                    | 뷰                                                      | 준-실험 서브셋(§3-E)이 **유일하게 편향 없는 평가 데이터**인데 지금 세지 않는다                                       |  S   | — (신규)  |
| **F-11** | (선택) **교사 출력 저장 계약** — 프론티어가 이미 내는 출력을 distillation 라벨로                                                                                                                                                     | —                                                       | #887 §7-B. 라우팅과는 별 축이지만 **저장 계약은 지금 잡아야** 한다                                                   |  S   | —         |

### 7-A. F-1·F-2·F-3 을 한 묶음으로 — 같은 한 줄에서 나온다

세 개 모두 **`emitDispatchDecision()` 호출부의 payload 확장**이다. `DispatchDecisionPayload` 에 필드를 더하고 `telemetry.dispatchDecision` 이 `metadata` 로 접으면 끝이다 — **서버·BQ 마이그레이션 0**(functions 의 `buildMetadata` 가 first-class 컬럼 외 키를 JSON 으로 통과시킨다. PR#480 이 같은 이유로 마이그레이션 없이 착지했다).

> **★단 `metadata` 는 스크럽 denylist 를 지난다**(#887 R8). 새 키를 넣을 때 `lib/telemetry/scrub.ts` 규칙 동반 검토가 필요하다 — 위 필드는 전부 숫자·enum·모델 id 라 통과가 맞지만, **그 판단을 명시적으로 하고 지나가야 한다.**

### 7-B. 담아도 **학습을 시작하지 않는다**

F-1~F-10 은 전부 **계측**이다. 훈련은 §6 게이트 뒤다. 이 구분이 흐려지면 #887 §5-A 의 "평가 하네스 없는 flip 금지" 가 무너진다.

---

## 8. 리스크 등록부 (이 태스크 고유분만 — #887 §9 와 중복 제외)

| #   | 리스크                                                  | 심각도   | 완화                                                                                 |
| --- | ------------------------------------------------------- | -------- | ------------------------------------------------------------------------------------ |
| D1  | **2층 라벨 7건** — 첫 타깃이 데이터가 가장 없는 층      | **높음** | F-1. 안 되면 **1층만** 학습하고 2층은 규칙 유지                                      |
| D2  | **비용만 학습 → 품질 매도**(§5-C, 13배 차)              | **높음** | F-6·F-7 선행. **B 헤드 없이 C 단독 배포 금지**                                       |
| D3  | **`perModelScores` 를 피처로 넣어 baseline 모방**       | **높음** | §2-D 계약. 학습 파이프라인 입력 스키마에서 **물리적으로 제외**                       |
| D4  | **상태 축 0%** → 오프라인 리플레이가 baseline 재현 불가 | **높음** | F-2                                                                                  |
| D5  | 유효 풀 유저 **4명** → 오너 워크플로 과적합             | 중간     | `client_user_bucket` 을 **평가 층화 축**으로 강제(피처 아님). 유저별 holdout         |
| D6  | 단가 드리프트로 과거 결정을 **잘못된 근거**로 재구성    | 중간     | F-4                                                                                  |
| D7  | `simple` 3행 — **가장 이득 큰 구간에 데이터 없음**      | 중간     | ε-greedy 를 `simple` 에서 일시 증대(코드에 이미 레버 있음: `MARBLO_ROUTING_EXPLORE`) |
| D8  | outcome 팬아웃(927행/897 taskId)으로 카운트 과대        | 낮음     | §3-A 조인 함정 1 — 뷰에서 dedup 강제                                                 |
| D9  | 학습층 도입이 탐색을 죽여 자기강화 루프 고착            | 중간     | #887 §5-D. 도입 **직후 ε 를 오히려 키운다**                                          |

---

## 9. 한계 · 정직성

- **수치는 2026-08-09 스냅샷**이다. `dispatch:decision` 은 실시간 유입 중이라 재조회하면 달라진다. 비율은 안정적이다.
- **explicit 83.6% 는 전 기간 누적**이다. 주별로 보면 07-12 주 1,106행 중 비-explicit 24 → 07-26 주 484 중 212 로 **경로가 실제로 열리는 중**이다. 즉 이 비율은 계속 내려갈 것이고, 그 추세가 G-a 를 앞당긴다.
- **§5-C 의 13배 비용차는 confounded 다.** claude 와 gpt 에 **같은 태스크가 배정되지 않았다**(explicit 지정이 대다수). 난이도·범위 차이가 비용차의 일부를 설명한다. 이 표는 "gpt 가 13배 싸다"는 주장이 **아니라**, "지금 라벨로는 그 차이가 품질인지 절약인지 **가를 수 없다**"는 주장의 근거다.
- **`durationMs` 는 여전히 티켓 리드타임**이다(`taskOutcome.ts:141-150` 주석이 스스로 그렇게 적었다). "더 빠름" 승격 기준(#887 §5-C)을 판정하려면 **에이전트 활성시간 시계가 따로 필요**하다 — 이 문서는 그걸 설계하지 않았다. 미해결 항목이다.
- **최소 라벨 수 300/1,000/15%/80% 는 인용이지 재도출이 아니다**(라우팅 SLM §7.2, 그 문서 스스로 "실무 하한"이라고 적었다). 조건 5·6·7 은 이 문서가 추가한 것이라 **그 임계치에 대응하는 수치가 없다** — 관측하며 정할 값이다.
- **모델 아키텍처를 정하지 않았다.** 로지스틱/GBM/작은 MLP 중 무엇인지는 데이터가 게이트를 통과한 뒤의 문제이고, 226행 규모에서는 **정규화된 선형/GBM 외에는 선택지가 없다**(#887 §4-C 가 이미 "LLM 아님"이라고 적었다).
- **이 문서는 코드를 한 줄도 바꾸지 않았다.** F-1~F-10 은 전부 미실행 제안이다.

---

## 10. 다음 — 티켓 분해 (스케치)

| 티켓 | 무엇                                                                              | 역할    | 크기 | 게이트              |
| ---- | --------------------------------------------------------------------------------- | ------- | :--: | ------------------- |
| R-1  | **F-1** `spawnedModel` 전 경로 강제 + `candidateKeys[]` (`model@effort` 후보집합) | backend |  S   | G-b                 |
| R-2  | **F-2 + F-3** 결정 시점 상태 스냅샷 + 8성분 구조화 + explicit 경로 점수 스냅샷    | backend |  S   | G-f · G13           |
| R-3  | **F-6** `errorCategory` 세분화(7종 어휘)                                          | backend |  S   | G-c                 |
| R-4  | **F-7** 무산출 판정(`outputChars`/`filesChanged`/`prUrl` → `NO_OUTPUT`)           | backend |  M   | G-c                 |
| R-5  | **F-8** outcome 무조건 upsert + dead-letter                                       | backend |  M   | G-e                 |
| R-6  | `training_decisions` **뷰 + 유효 라벨 퍼널 대시보드**(§3-C 표를 쿼리 한 번으로)   | backend |  S   | 전 게이트 상시 관측 |
| R-7  | **F-10** `selection_mode` 별 준-실험 케이스 집계                                  | backend |  S   | §5-B 평가           |
| R-8  | (게이트 통과 후) 비용 회귀 PoC — 오프라인 전용, 배포 금지                         | backend |  M   | G-a                 |

**R-1 과 R-6 을 먼저 한다.** R-1 은 소급 불가 손실을 오늘 멈추고, R-6 은 나머지 진척을 **쿼리 한 번**으로 보이게 한다.

---

## 11. 출처

### 사내 — 전부 이 레포/BQ 에서 직접 확인

| 사실                                                                      | 위치                                                                                    |
| ------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| 2층 라우팅 구조 · 8성분 · ε-greedy · UCB1 · tie-band · 자기강화 루프 경고 | `v3/electron/model-autoselect.ts` (1,010줄)                                             |
| 1층 스코어러 · `PerModelScore` 성분 · `TIED_SCORE_BAND` · 선택모드 4종    | `v3/electron/dispatch-scoring.ts` (1,410줄, `WEIGHTS` :89, `scoreModelsDetailed` :1069) |
| `dispatch:decision` 페이로드 계약(피처·액션·근거의 실제 필드)             | `v3/electron/telemetry.ts:428-464` · `bridge-server.ts:2405, 2884, 3202`                |
| outcome 라벨 빌더 · 결함 ①~⑤ 수리 상태 · `errorCategory = 상태문자열`     | `v3/src/lib/telemetry/taskOutcome.ts:129-216`                                           |
| `classifyTaskType` 순수·결정적·이중언어 (T3 이 추론시 가용인 근거)        | `v3/src/lib/telemetry/taskType.ts` (+ MCP 미러 `mcp-server/task-type.ts`)               |
| `graphBias` 가법 ±20 · 콜드 0 · 클램프 · 프라이어 제거(롤백 패턴)         | `v3/electron/routing-graph.ts` (`GraphContext` :256)                                    |
| 머지 단일소스 이중사용(감사 + 학습 라벨) · `taskId` 없으면 emit skip      | `v3/electron/telemetry.ts:360-383` · `worktree-ipc.ts:365-389`                          |
| 스크럽은 denylist · 프롬프트는 해시+길이만                                | `v3/src/lib/telemetry/scrub.ts` · `agent-manager.ts:887-890`                            |
| Phase 0~3 로드맵 · 후보 채점 · 승격 기준 · GPU 금지                       | `v3/docs/own-model-finetune-serving-roadmap-2026-08-09.md` (#887)                       |
| 5테이블 스키마 · fill rate · 갭 G1~G15 · E2E 조인 경로                    | `v3/docs/bq-ml-training-data-audit-2026-08-08.md`                                       |
| "유효 라벨" 4조건 · 최소 라벨 수 · 다양성 요건 · 결함 A/B/C               | `v3/docs/research/routing-slm-data-collection.md`                                       |
| SLM 라우터 "GO 아님" 판정(2026-07)                                        | `v3/docs/research/slm-router-summary.md`                                                |
| gpt·grok 복잡 in-repo 무산출                                              | 메모 `spawn_model_pref_codex_grok_save_claude` · #885 §7-B                              |
| `taskId` 만 정합한 비용 축 · `userId` 공간 분리 · 전역 SUM 금지           | 메모 `cost_axis_userid_spaces_and_reread_dupes`                                         |
| 외부 실사용 ≈0(데이터가 사실상 오너 1인분)                                | 메모 `admin_exclude_johnkim_external_zero_value_2026_07`                                |

### 라이브 BQ 실측 (2026-08-09, `marblo-2253d.marblo_telemetry`)

john.kim ADC + BigQuery REST `jobs.query`, 헤더 `x-goog-user-project: marblo-2253d`.
§3-C·§3-D·§5-B·§5-C 의 모든 수치가 여기서 나왔고, 재현 쿼리는 §3-A/§3-C 에 첨부돼 있다.

| 쿼리           | 결과                                                                                                |
| -------------- | --------------------------------------------------------------------------------------------------- |
| 볼륨           | `task_outcomes` 927 / `events` 202,917 / `dispatch:decision` 2,316(1,408 taskId) / `task:merged` 49 |
| explicit 우회  | 1,937 / 2,316 = **83.6%** (비-explicit 379 = `perModelScores` 비어있지 않은 행 수와 정확히 일치)    |
| 유효 라벨 퍼널 | 829 → 249 → 247 → 226 → **7** (§3-C)                                                                |
| 음성           | 전체 39 (`BLOCKED` 33 / `FAILED` 6) · 유효 풀 내 **4**                                              |
| 셀 분포        | claude·standard 146 / gpt·standard 82 / 나머지 7셀 합 21 (§3-D)                                     |
| 비용 분포      | claude·standard 중앙값 $10.63 vs gpt·standard $0.82 (§5-C)                                          |
| 유저           | outcome 전체 7명 · 유효 풀 **4명**                                                                  |
| `spawnedModel` | 176/2,316(7.6%) · 값 5종 · `@effort` 접미사 1종                                                     |

---

_작성: backend agent · 티켓 `D8lmKZkxIswgknrTiHRl`. 코드 무변경 — 이 문서 1개._
