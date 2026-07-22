# 라이브 지식그래프 라우팅 — 설계 스펙

- 날짜: 2026-07-22
- 상태: 설계 승인 대기 (구현 아님 — 승인 후 별도 티켓)
- 프로젝트: marblo-v3
- 티켓: `zdt3ep9bIAtCfXHBx9Ea`
- 데이터 원천(계약): `CT3prjl4` (SLM·라벨계측, 현재 REVIEW) — 이 스펙은 그 이벤트를 **소비**한다
- 선행 감사: `docs/slm-training-data-coverage-audit-2026-07-22.md` (#555)
- 관련 메모: `routing_data_pipeline_merge_capture`, `spawn_model_policy_v2`, `agent_capability_hints`,
  `agent_working_derived_from_pty_bytes`, `dependson_gate_edge_trigger_flag_stuck`,
  `orch_mcp_handshake_before_auth_timeout`

---

## 1. 배경 / 문제

Marblo v3 오케스트레이터는 dispatch 시점에 **모델을 고른다**. 그 선택은 `dispatch-scoring.ts`의
순수 스코어링(`scoreModelsDetailed`)이 담당하고 — `MODEL_BASE_SCORE` + `MODEL_TAG_BONUSES`/
`MODEL_TAG_PENALTIES` + `costEfficiencyScore` + `simpleAgyBias` 의 가중합 — 이 결정은
`dispatch:decision` 텔레메트리로 `perModelScores`·`decisionReason`·`complexity`·`tags`와 함께
BQ에 적재된다. SLM 감사(#555)가 확인한 대로 **라우팅 피처는 건강하다**(1,276행, 100% 커버).

문제는 **결과가 결정으로 되먹임되지 않는다**는 것이다. 현재 모델별 강점(`MODEL_TAG_BONUSES`)은
**손으로 박은 상수**다 — "claude는 architecture +25", "antigravity는 agentic +30". 이 표는
실제로 어떤 모델이 어떤 작업에서 **성공/실패했는지**를 절대 학습하지 않는다. 감사가 짚은
가장 큰 갭도 정확히 이것이다: 라우팅 결정의 **결과 라벨 부재**(`task:merged` 0행, crash taskId 0,
부정 라벨 전부 `BLOCKED`).

### 동기 사례 (첫 엣지 케이스)

이번에 **antigravity를 복잡·자율 작업에 스폰 → 무활동 스테일**이 발생했다(CT3prjl4가 지목한
`wXOhvdp1`). 이건 버려질 소음이 아니라 **귀중한 부정 라우팅 라벨**이다: "이 작업 모양을 이
모델로 라우팅하면 스테일 난다." 지금은 이 신호가 어디에도 누적되지 않아, **다음 dispatch가
똑같은 실수를 반복**한다. §9에서 이 사례를 그래프가 어떻게 흡수·보정하는지 워크스루한다.

### 핵심 긴장점

- `MODEL_TAG_BONUSES`는 정적이라 **경험에 반응하지 않는다**. 라이브 지식그래프는 이 표의
  **동적·감쇠·관측 기반 버전**이어야 한다 — 재작성이 아니라 **가법 성분 1개 추가**.
- 스코어링은 **메인 프로세스의 동기 순수함수**다(`scoreModelsDetailed`). 따라서 그래프 조회는
  **dispatch 시점에 동기·저지연**이어야 한다 → BQ 왕복 불가, 로컬 집계 스토어가 자연스럽다(§5).
- 실패를 `stale`/`BLOCKED`로 뭉뚱그리면 그래프가 **엉뚱한 사전확률**을 학습한다. `depends_on`
  고착(오케 버그)을 모델 탓으로 돌리면 antigravity가 부당하게 강등된다 → **실패 어트리뷰션**이
  택소노미의 1급 축이어야 한다(§3, §8).

---

## 2. 목표 / 비목표

**목표**

- dispatch 결정에 **관측된 모델 신뢰도 사전확률**을 얹어, 반복 실패하는 (작업모양×모델) 조합을
  점진적으로 회피하고 성공 조합을 강화한다 — **ML 없이 누적 휴리스틱**으로.
- 실패를 **상세 택소노미**로 분류해(§3) 그래프가 "나쁜 라우팅"과 "인프라/오케 버그"를 구분한다.
- 기존 `dispatch:decision`·`routing_data_pipeline`·`CT3prjl4` 이벤트를 **재사용**한다(재작성 금지).
- 그래프의 기여를 `decisionReason`/`perModelScores`에 **기록**해, 그래프 자체의 영향이 다시
  텔레메트리로 감사·학습 가능하게 한다(피드백 루프의 관측 가능성).

**비목표 (YAGNI / 후속)**

- SLM/신경망 라우터 학습·배포. (감사 결론: 아직 라벨 부족 → 학습 금지. 이 스펙은 그 전 단계인
  **결정론적 누적 휴리스틱** 계층이다.)
- 프롬프트 원문 기반 의미 피처. (프라이버시 계약상 hash/length만; §10.)
- 서버측 fleet 전역 그래프(사용자 간 집계). (v1은 **머신 로컬**; 크로스 유저 집계는 opt-in 텔레메트리
  계약이 필요한 후속.)
- 새 실패 감지 로직. (감지는 watchdog·agent-manager가 이미 함 — 스펙은 그 **판정을 소비**만.)

---

## 3. 실패 택소노미 (상세)

단순 `stale`/`BLOCKED` 뭉뚱그림을 탈피한다. 각 실패 모드는 (a) **감지 원천**, (b) **어트리뷰션**
(모델 탓인가 / 인프라·오케 탓인가), (c) **라우팅 신호 강도**, (d) **감쇠 τ**(전이적 vs 지속적)를 가진다.

| #   | 실패 모드 (`outcome`) | 감지 원천                                                                                                   | 어트리뷰션                                      | 라우팅 신호                    | 감쇠 τ                 |
| --- | --------------------- | ----------------------------------------------------------------------------------------------------------- | ----------------------------------------------- | ------------------------------ | ---------------------- |
| 1   | `spawn_failed`        | 스폰 즉사(CLI 바이너리 부재/spawn error/즉시 exit). agent-manager FAST_FAIL                                 | **호스트/가용성** (모델 CLI가 이 머신서 안 뜸)  | 강함 "지금 라우팅 말 것"       | **빠름** (2d) — 전이적 |
| 2   | `auth_failed`         | 스폰됐으나 CLI 미인증(로그인 만료, custom-token 미도달). `orch_mcp_handshake`·#406                          | **호스트/가용성**                               | 강함(전이적)                   | **빠름** (2d)          |
| 3   | `tool_zero`           | 에이전트 살아있으나 MCP 툴 0개(handshake 타임아웃, dist-mcp 부재). `orch_mcp_handshake_before_auth_timeout` | **호스트/환경** (이 모델이 툴 오케에 참여 불가) | 중간                           | **빠름** (3d)          |
| 4   | `crash_loop`          | restartCount ≥ MAX_RESTARTS 내 반복 크래시. agent-manager 크래시루프 backstop                               | **모델 행동** (이 모델이 이 작업서 불안정)      | 중간~강함                      | 중간 (14d)             |
| 5   | `crashed`             | 단발 크래시(exitCode≠0) 후 회복/포기. `agent:crashed`                                                       | **모델 행동** (약)                              | 약~중간                        | 중간 (14d)             |
| 6   | `no_activity_stale`   | 살아있으나 PTY 활동/진척 무(임계 초과). watchdog 스테일 판정. **★antigravity 사례**                         | **모델 행동**                                   | 중간                           | 중간 (21d)             |
| 7   | `dependency_stuck`    | `depends_on` 게이트가 안 풀려 착수 못 함. `dependson_gate_edge_trigger_flag_stuck`                          | **오케/인프라 (모델 무관)**                     | **제외**(모델 사전확률 미반영) | —                      |
| 8   | `blocked`             | 에이전트가 명시적 BLOCKED(입력·미지 대기)                                                                   | **작업 본질 (약한 모델 신호)**                  | 약(≈중립)                      | 중간 (21d)             |
| 9   | `failed`              | 에이전트가 명시적 FAILED(시도 후 실패 보고)                                                                 | **모델/작업 혼재**                              | 중간                           | 중간 (21d)             |
| 10  | `review_rejected`     | 완료됐으나 리뷰 반려(품질 결함). (감사 갭: 아직 미계측 → 후속)                                              | **모델 품질**                                   | **강함(음)**                   | 느림 (45d)             |
| 11  | `completed`           | `submit_for_review`/DONE 전이                                                                               | 성공                                            | **강함(양)**                   | 느림 (45d)             |
| 12  | `merged`              | `task:merged` (수락된 최종 산출). 감사가 지목한 최상위 수락 라벨                                            | 성공(수락)                                      | **최강(양)**                   | 느림 (60d)             |

**감지 원천 정합(현행 코드 확인)**: status enum = `TODO|CLAIMED|IN_PROGRESS|REVIEW|BLOCKED|FAILED|DONE`
(state-machine.ts), agent status = `idle|working|error|stopped`. `spawn_failed`/`crash_loop`은
agent-manager가 exit를 `fast_fail_config`(바이너리·config) vs `runtime_crash`(예산소진)로 이미 분류해
`agentCrashed`에 실어 보낸다 — 그래프는 이 errorCategory를 §3 모드로 매핑만 하면 된다. 반면 **오늘
전용 감지기가 없는 두 모드**는 `tool_zero`(MCP 툴 0 — 현재 `fast_fail_config`에 뭉개짐)와
`review_rejected`(REVIEW 반려 — 별도 상태 없음). 이 둘은 §11의 CT3prjl4 계약 확장에서 계측을
새로 붙여야 신호가 산다. 그 전까지는 이 두 모드가 **부재**할 뿐 그래프 안전성엔 영향 없다(없는
신호 = 0 기여).

### 3.1 어트리뷰션 축 (가장 중요)

라우팅 사전확률에 **모델 탓 실패만** 반영한다. 세 버킷:

- **모델 행동** (4·5·6·9·10·11·12): 그래프 사전확률에 **전량 반영**. 지속적 → 느린 감쇠.
- **호스트/가용성** (1·2·3): 반영하되 **호스트 스코프 + 빠른 감쇠**. "지금 이 머신서 이 모델이 안 뜬다"는
  전이적 사실이지 모델 능력 판단이 아니다. 인증만 고치면 사라져야 한다.
- **오케/인프라 무관** (7): **제외**. `dependency_stuck`을 antigravity 탓으로 학습하면 안 된다.
  (감지는 하되 그래프 사전확률에는 `routingWeight=0`.)

이 축이 없으면 그래프가 "antigravity는 나쁘다"를 오케 버그로부터 잘못 배운다 — 스펙 전체의 안전핀.

### 3.2 스테일 판정의 위양성 주의

`no_activity_stale`은 위양성 위험이 있다(메모 `agent_working_derived_from_pty_bytes`): 끝난 CLI가
스피너로 영구 "working"으로 보이거나(가짜 stale 아님, 가짜 working), 추론 중 무음이라 살아있는데
idle로 보임. 그래프는 이걸 **단일 관측으로 강등하지 않고**(§8 신뢰도 수축) 반복 증거를 요구한다.
스테일 판정 자체의 정밀도 개선은 watchdog 티켓 소관(비목표).

---

## 4. 지식그래프 스토어 스키마

그래프는 원본 이벤트 로그가 **아니다**(그건 BQ `events`가 진실원). 그래프는 그 이벤트에서 파생된
**컴팩트 집계(materialized rollup)** — dispatch 시점에 동기로 읽을 수 있는 카운터 스토어다.

### 4.1 엔티티(노드) · 엣지 모델

- **노드**: `Model`(claude/gpt/antigravity/gemini/local/custom), 그리고 **컨텍스트 팩터** —
  `Role`, `TaskType`, `Tag`, `Complexity`, `FailureMode`(§3).
- **엣지**: `(Model X) —[outcome=Z, N회]→ (컨텍스트팩터 F)`. 즉 "모델 X가 팩터 F를 가진 작업에서
  실패모드 Z를 N회 / 성공 M회 냈다"의 누적.

`tags[]`는 조합 폭발하므로 컨텍스트를 **독립 팩터로 분해**해 팩터별로 셀을 누적한다(naive-bayes 식
가법 누적). 이것이 `MODEL_TAG_BONUSES`가 이미 하는 것(매칭 태그별 보너스 합산)과 **동형**이라
통합이 자연스럽다 — 그래프는 그 표의 **학습된 동적 버전**이다.

### 4.2 저장 형식 (`routing-graph.json`)

`dispatch-scoring.ts`가 이미 쓰는 패턴(`~/.marblo/subscription-plans.json` mtime 캐시 동기 로드,
`loadSubscriptionPlans`)을 그대로 재사용한다.

```jsonc
// ~/.marblo/routing-graph.json  (global)  또는
// ~/.marblo/projects/<projectId>/routing-graph.json  (per-project overlay)
{
  "version": 1,
  "scope": "global",              // "global" | "project:<id>"
  "updatedAt": "2026-07-22T09:00:00Z",
  "halfLifeDays": { "model": 21, "host": 2, "quality": 45 },  // §8 감쇠 파라미터
  "cells": {
    // key = `${factorType}:${factorValue}|${model}`
    "tag:agentic|antigravity": {
      "raw":     { "merged": 1, "completed": 2, "no_activity_stale": 4, "crash_loop": 1 },
      "decayed": { "merged": 0.7, "completed": 1.4, "no_activity_stale": 3.1, "crash_loop": 0.6 },
      "n": 8, "firstSeen": "2026-07-10T…", "lastSeen": "2026-07-22T…"
    },
    "complexity:complex|antigravity": {
      "raw":     { "completed": 1, "no_activity_stale": 4 },
      "decayed": { "completed": 0.8, "no_activity_stale": 3.4 },
      "n": 5, "firstSeen": "…", "lastSeen": "…"
    },
    "role:backend|claude": { "raw": { "merged": 30, "review_rejected": 2 }, … }
  },
  // 멱등: 이미 흡수한 (taskId,agentId,outcome)을 재적재 시 중복 카운트 방지
  "seen": { "<taskId>:<agentId>:<outcome>": "2026-07-22T…" }  // TTL로 프루닝
}
```

- **셀 키 = `(factorType, factorValue, model)`**. 한 dispatch는 여러 팩터 셀을 동시에 갱신
  (예: `tag:agentic`, `tag:autonomous`, `complexity:complex`, `role:backend`, `taskType:refactor`
  각각 × 모델).
- `raw` = 원 카운트(감사·디버그용), `decayed` = 시간감쇠 가중(스코어링이 실제로 읽는 값, §8).
- `n` = 셀 총 관측수(신뢰도 수축용). `seen` = 멱등 가드(불변 원장 교훈: 재시도 유실 방지하되 중복
  금지).
- **크기 관리**: 팩터값은 유한 카테고리(태그 사전·역할·complexity 3종·taskType 분류기 출력)라
  셀 수는 수백~수천 수준으로 바운드. `seen`은 TTL(예 30d) 프루닝.

### 4.3 파생 함수 (그래프 → 스코어 바이어스)

```ts
// dispatch-scoring.ts 에 추가될 순수함수 (승인 후 구현)
graphBiasForModel(
  model: ModelType,
  ctx: { role: string; taskType?: string; tags: string[]; complexity?: Complexity },
  graph: RoutingGraph,
): number   // 반환: [-GRAPH_MAX, +GRAPH_MAX], GRAPH_MAX ≈ 20 (태그 보너스급, 역할 하드게이트는 절대 못 넘음)
```

동작: ctx가 지시하는 모든 셀을 모아, 셀별로 `(성공률_decayed − baseline)`에 **어트리뷰션 가중**과
**신뢰도 수축**(`n/(n+K)`)을 곱해 합산 후 `[-GRAPH_MAX, +GRAPH_MAX]`로 clamp. 콜드스타트(셀 없음/
n 작음) → 0 (§8).

---

## 5. 스토어 위치 · 범위 결정 (근거)

### 5.1 위치: **로컬 파일** (Firestore 아님) — 결정

| 후보                                                 | 근거                                                                                                                                                                                                                                                                                                                                                                                            |
| ---------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **로컬 파일 `~/.marblo/routing-graph.json` ✅ 채택** | 스코어링(`scoreModelsDetailed`)은 **메인 프로세스 동기 순수함수** — dispatch 핫패스에서 async Firestore/BQ 조회 불가. 이미 `dispatch-scoring.ts`가 `subscription-plans.json`을 **동기 mtime 캐시**로 읽는 선례가 있음(동일 패턴 재사용, 신규 인프라 0).                                                                                                                                         |
| Firestore(오케 접근) ✗                               | 메인 프로세스는 Firestore 접근이 되긴 한다(getMissionFirebaseApp custom-token, tasks/activities에 write). 하지만 (a) **async**라 동기 스코어링 핫패스에 부적합, (b) dispatch마다 네트워크 의존 추가, (c) custom-token 인증이 취약(#406: 미인증 → 전면 permission-denied 전례), (d) **원본 라벨은 이미 BQ**에 있어 Firestore 사본은 중복. 결정적 이유는 (a)(d) — 동기 핫패스 + 진실원 중복 회피. |
| BQ 직접 조회 ✗                                       | 감사가 보여준 대로 조인·집계는 오프라인 분석용. dispatch마다 BQ 쿼리 = 지연·비용·인증 폭발.                                                                                                                                                                                                                                                                                                     |

원본 진실은 **BQ `events`**(dispatch:decision + CT3prjl4 outcome), 로컬 그래프는 그 **파생 집계 캐시**.
BQ가 소실돼도 로컬은 라이브 이벤트로 재구축되고(§7), 로컬이 소실돼도 BQ에서 재빌드 가능(§8.4).

### 5.2 범위: **머신-전역 base + per-project overlay** (2계층) — 결정

`bridge-server.ts`의 `enabledModels` 해석이 이미 쓰는 **per-project → global preset 폴백** 패턴과
동형으로 간다.

- **전역**(`~/.marblo/routing-graph.json`): "antigravity는 복잡·자율 작업서 스테일 잦다" 같은
  **프로젝트 불변**(fleet 공통) 사실을 담는다. 대부분의 모델 능력 신호는 코드베이스에 독립적.
- **per-project overlay**(`~/.marblo/projects/<id>/routing-graph.json`): 프로젝트 특유 요인
  (그 레포의 빌드·인증·코드 성격)을 담는다.
- **해석 규칙**: per-project 셀이 `n ≥ N_min`(예 8)이면 project 우선, 아니면 global 폴백, 그것도
  없으면 **콜드스타트=0**(현행 스코어링 그대로 = 무회귀 안전).

크로스 유저(사용자 간) 집계는 **v1 비목표** — 프라이버시상 opt-in 텔레메트리 계약 필요(후속).
v1의 "global"은 어디까지나 **이 머신의 프로젝트 전역**.

---

## 6. 오케 소비점 (dispatch 결정 시점)

### 6.1 통합 지점: `scoreModelsDetailed` 에 가법 성분 1개

`PerModelScore`(dispatch-scoring.ts:578)에 `graphBias` 필드를 추가하고, `total` 합산에 한 항 더한다:

```
total = base + tagBonus + tagPenalty + costEff + agyBias  + graphBias   // ← 신규 성분
```

- `graphBias = graphBiasForModel(model, ctx, graph)` (§4.3). 다른 성분과 **동일 스케일**(±20 이내)
  이라 역할 하드게이트(100)나 reuse 보너스는 절대 못 뒤집고, 태그 경쟁의 **타이브레이커~약우세**
  수준으로만 작동. 콜드스타트 0 → 정확히 현행 동작.
- 시그니처 확장: `scoreModelsDetailed(enabledModels, tags, complexity, ctx?, graph?)` — `ctx`/`graph`
  옵셔널이라 기존 호출·테스트 무영향(무전달 시 graphBias=0).

### 6.2 주입: `bridge-server.ts` spawn 분기

`dispatchSingle`의 스폰 경로(bridge-server.ts:2032)에서 로드된 그래프 + `{role, tags, complexity,
taskType}`를 넘긴다. `taskType`은 dispatch가 이미 아는 값이거나(스코프/분류기), 없으면 생략.

### 6.3 기록: `decisionReason` + `perModelScores`

`emitDispatchDecision`(bridge-server.ts:2085)이 이미 실는 `perModelScores`에 `graphBias`가 자동
포함된다(구조체 필드라). `decisionReason` 문자열에 한 조각 추가:

```
"Scored 3 model(s) → claude (top-score). graph: antigravity −14 (complex+agentic stale 4/5 최근21d), claude +6. Spawned new agent."
```

이로써 **그래프의 영향 자체가 dispatch:decision 텔레메트리로 다시 적재**된다 → 감사·SLM 학습이
"그래프가 이 결정을 얼마나 바꿨나"를 나중에 되짚을 수 있다(관측 가능한 피드백 루프).

---

## 7. 피드백 루프 (결과 → 그래프 갱신 → 다음 dispatch)

ML 없이, 이벤트 도착마다 카운터를 증분하는 **누적 휴리스틱** 루프.

```
dispatch:decision (taskId, model, {role,tags,complexity,taskType})   ── 결정 스냅샷
        │  (dispatchMeta 로 task 문서에 이미 보존: cwd·model·complexity·dispatchReason;
        │   role·tags·taskType 를 추가 보존 — §11 소계약 확장)
        ▼
에이전트 생애 결과 (CT3prjl4 이벤트, taskId+model 로 조인)
   agent:spawn_failed / agent:went_stale / agent:crashed / agent:restarted
   task:completed / status→BLOCKED·FAILED / task:merged
        ▼
[GraphUpdater]  outcome + dispatchMeta(컨텍스트) → 셀 증분
   for factor in {role, taskType, *tags, complexity}:
       cell(`${factor}|${model}`).raw[outcome] += 1
       cell.decayed 갱신 (§8), cell.n += 1
   멱등: seen[`${taskId}:${agentId}:${outcome}`] 있으면 skip
        ▼
다음 dispatch 의 scoreModelsDetailed 가 갱신된 graphBias 반영
```

### 7.1 두 갱신 경로

1. **라이브 인-프로세스 증분(주 경로, v1)**: 메인 프로세스는 watchdog·agent-manager를 통해
   스테일/크래시/스폰실패/완료를 **직접 관측**한다(BQ 왕복 불필요). 관측 즉시 로컬
   `routing-graph.json` 셀을 원자적 write(mtime 캐시)로 갱신 → **다음 dispatch가 곧바로 혜택**.
   이건 텔레메트리 게이트(opt-in)와 **독립** — 그래프 갱신은 로컬 라우팅 개선이라 항상 돈다.
2. **주기적 BQ 재조정(자가치유, 후속)**: 오프라인 잡이 BQ의 조인된 outcome을 읽어 집계를 재빌드
   — drift 교정, 히스토리(2026-04~) 백필, (미래 opt-in) 크로스 머신 병합. v1 필수 아님.

### 7.2 CT3prjl4 계약 소비

CT3prjl4(REVIEW)가 outcome 어휘 `{completed, crashed, stale, spawn_failed, blocked}`를 taskId+model+
dispatchReason(metadata)으로 실어 BQ events에 적재한다. 이 스펙의 GraphUpdater는 **그 이벤트를
그대로 소비**한다. 단 §3의 세분(auth_failed/tool_zero/crash_loop/dependency_stuck)은 CT3prjl4의
5종보다 넓으므로 — **outcome 어휘 확장**을 CT3prjl4 후속 계약으로 제안한다(§11). 확장 전에는
`stale→no_activity_stale`, `crashed→crashed|crash_loop`(restartCount로 파생) 등 **로컬 정규화**로
브리지한다.

### 7.3 taskType 는 온디바이스로 확보 (BQ 컬럼 공백 우회)

감사상 `events.taskType`/`cost_logs.taskType`는 0% 채워져 있으나, 이건 그래프의 블로커가 **아니다** —
`src/lib/telemetry/taskType.ts`의 `classifyTaskType()`이 KO/EN 키워드로 **결정론적·로컬**로 taskType을
뽑는다(`task_outcomes.taskType`는 이미 72% 채움, 이 분류기 출력). GraphUpdater는 outcome 처리 시
dispatchMeta의 원 지시로 `classifyTaskType()`을 **로컬 재계산**해 `taskType:*|model` 셀을 채운다 —
비어 있는 BQ 컬럼에 의존하지 않는다.

### 7.4 두 번째 라벨 소스: `task_outcomes`

CT3prjl4의 생애 이벤트(events 테이블) 외에, `task_outcomes` 행(`taskOutcomeReporter.reportTaskOutcome`)
도 `{role, model, taskType, complexity, success, errorCategory, retriesCount}`를 taskId로 담는 **완성형
라벨**이다. 라이브 인-프로세스 경로(§7.1-1)가 주 경로지만, BQ 재조정(§7.1-2)은 `task_outcomes`를
**성공/실패 정답 라벨의 교차검증 소스**로 써 라이브 증분의 drift를 교정한다.

---

## 8. 갱신정책 · 감쇠 · 콜드스타트 · 어트리뷰션

### 8.1 시간 감쇠 (오래된 실패 가중치 약화)

셀 갱신 시 지수 감쇠:

```
decayed_new = decayed_old * 2^(-Δt / halfLifeDays) + routingWeight(outcome)
```

- **모델 행동**(stale/crash/quality): `halfLifeDays.model = 21` (지속적 능력 신호, 천천히 잊음).
- **호스트/가용성**(spawn_failed/auth_failed/tool_zero): `halfLifeDays.host = 2` (전이적 — 인증
  고치면 빠르게 사라져야 함).
- **품질**(merged/completed/review_rejected): `halfLifeDays.quality = 45` (가장 durable).

Δt는 이벤트에 실린 서버 타임스탬프로 계산(그래프 코드에 벽시계 의존성 주입 — 테스트 결정성).

### 8.2 어트리뷰션 가중 (`routingWeight`)

§3.1 버킷을 수치화. 예시(승인 시 튜닝):

```
merged +3, completed +2, review_rejected −3, no_activity_stale −2, crash_loop −2.5,
crashed −1, failed −1.5, auth_failed/spawn_failed/tool_zero −2 (host-scoped, fast decay),
blocked −0.3 (≈중립), dependency_stuck 0  (제외)
```

### 8.3 신뢰도 수축 (단일 관측 과반응 방지)

`graphBias`는 셀 `n`으로 수축: `effect *= n/(n+K)` (K≈6). 한 번의 antigravity 스테일은 bias를 **거의
안 움직임**(n=1 → 1/7). 반복 증거(n↑)라야 유의미. Laplace 평활 성공률(`(pos+1)/(pos+neg+2)`)로
0/0 폭발 차단. 이게 §3.2 위양성 안전핀이기도 하다.

### 8.4 콜드스타트

- 셀 없음/`n<N_min` → `graphBias=0` → **현행 스코어링 그대로**(무회귀; `MARBLO_AGY_SIMPLE_BIAS`
  기본 0 과 동일 철학 — 신호 없으면 개입 없음).
- 부트스트랩: 원하면 정적 `MODEL_TAG_BONUSES`를 그래프의 **사전 셀**로 시딩(약한 n)해 초기부터
  약한 방향성 부여 가능(옵션). 기본은 0-시작 권장(관측이 손튜닝을 이기게).
- 로컬 소실 시: BQ 재조정(§7.1-2)으로 히스토리에서 재빌드.

### 8.5 갱신 안전

- **원자적 write**(temp+rename), mtime 캐시로 동시 dispatch 읽기 무결.
- **멱등**: `seen` 가드로 재시도·재조정 중복 카운트 차단(불변 원장 교훈).
- **바운드**: 알 수 없는 팩터값은 화이트리스트(태그 사전) 통과분만 셀 생성 → 카디널리티 폭발 방지.

---

## 9. Antigravity 무활동 스테일 — 첫 엣지 워크스루

1. **결정**: 복잡·자율 티켓(tags=[agentic,autonomous], complexity=complex). `scoreModelsDetailed`가
   antigravity를 선정(agentic +30 또는 tie-band round-robin). `dispatch:decision` 적재:
   `{taskId=T, model=antigravity, complexity=complex, tags=[agentic,autonomous], perModelScores}`.
   dispatchMeta에 컨텍스트 보존.
2. **실행 → 스테일**: antigravity 스폰·작업 후 PTY 무음, 임계 초과. watchdog `no_activity_stale`
   판정. CT3prjl4가 `agent:went_stale {taskId=T, model=antigravity, dispatchReason, outcome=stale}`
   emit.
3. **피드백(라이브 증분)**: GraphUpdater가 셀 증분 —
   `complexity:complex|antigravity`.no_activity_stale +1, `tag:agentic|antigravity` +1,
   `tag:autonomous|antigravity` +1, `role:<r>|antigravity` +1. `decayed`에 routingWeight −2,
   `n`↑. `seen[T:agent:stale]` 마킹.
4. **다음 유사 dispatch**: `graphBiasForModel(antigravity, {complex, agentic…})`가 음수. **단 n이
   작으면 수축돼 미미**(한 번으론 antigravity 강등 안 함 — §8.3). 유사 스테일이 **누적**되면 bias가
   커져 antigravity `total`이 claude/gpt에 밀림 → 라우터가 더 신뢰 가능한 모델 선호. `decisionReason`:
   `"graph: antigravity −14 (complex agentic stale 4/5 최근21d)"`. **여전히 tie-band면** antigravity가
   뽑힐 수도 있으나 그 위험이 텔레메트리에 기록됨.
5. **자가교정**: 이후 antigravity가 유사 작업서 성공(merged/completed)하면 양의 가중 누적 + 옛
   스테일이 21d 반감기로 감쇠 → bias가 0으로 회귀. **손 안 대도 스스로 회복**. (watchdog/스폰
   안정성 픽스가 landing되면 정확히 이 회복 곡선을 탐.)

핵심: 그래프가 "이 한 번의 antigravity 스테일"을 **지속적·감쇠·컨텍스트별 라우팅 사전확률**로
바꾼다 — ML 없이, 기존 `dispatch:decision`+CT3prjl4 라벨 이벤트만으로.

---

## 10. 데이터 계약 (재사용 명세)

| 소비 대상                | 원천                                                       | 필드                                                                                                | 상태                                                                 |
| ------------------------ | ---------------------------------------------------------- | --------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------- |
| 결정 스냅샷              | `dispatch:decision` (bridge-server `emitDispatchDecision`) | taskId, role, model(selectedModel), complexity, tags[], perModelScores[], decisionReason            | ✅ 라이브 100% (#555)                                                |
| 컨텍스트 보존            | task 문서 `dispatchMeta`                                   | cwd, model, complexity, dispatchReason                                                              | ✅ 존재 (CT3prjl4가 dispatchReason 추가)                             |
| 컨텍스트 보존(확장 필요) | `dispatchMeta`                                             | **role, tags[], taskType**                                                                          | ⛽ 소계약 확장(§11) — 인-프로세스 조인 키                            |
| 실패/성공 라벨           | CT3prjl4 이벤트                                            | agent:spawn_failed / went_stale / crashed / restarted, task:completed/merged, status→BLOCKED·FAILED | ⏳ REVIEW (이 스펙의 선행)                                           |
| outcome 어휘             | CT3prjl4                                                   | {completed, crashed, stale, spawn_failed, blocked}                                                  | ⏳ §3 세분(auth/tool_zero/crash_loop/dependency_stuck)으로 확장 제안 |
| 정답 라벨(교차검증)      | `task_outcomes` (`taskOutcomeReporter`)                    | role, model, taskType, complexity, success, errorCategory, retriesCount (taskId 키)                 | ✅ 존재(72% taskType) — BQ 재조정 교차검증 소스(§7.4)                |
| taskType 파생            | `classifyTaskType()` (온디바이스, KO/EN 키워드)            | taskType (BQ events 컬럼 공백 무관, 로컬 재계산)                                                    | ✅ 존재 — §7.3                                                       |

**프라이버시**: 그래프는 파생 카운트만 저장(원문 프롬프트·코드·경로 미수집). `promptHash`/`length`
외 의미 피처 없음 — 감사가 짚은 프라이버시 계약 유지. 로컬 그래프는 머신 로컬이라 크로스유저
유출 없음.

---

## 11. 변경 범위 (승인 후 구현 티켓용 — 이 티켓은 스펙까지)

**선행 의존**: CT3prjl4(라벨계측) landing.

**신규**

- `v3/electron/routing-graph.ts` — `RoutingGraph` 타입, `loadRoutingGraph`(mtime 캐시 동기 로드,
  `subscription-plans` 패턴), `applyOutcome`(셀 증분+감쇠+멱등), `graphBiasForModel`(순수), 감쇠/
  수축/어트리뷰션 상수.
- `v3/electron/graph-updater.ts` — watchdog/agent-manager/완료 훅에서 outcome+dispatchMeta → applyOutcome.
- `v3/tests/unit/routing-graph.test.ts` — 감쇠·수축·콜드스타트·멱등·어트리뷰션 제외(dependency_stuck)
  순수 검증.
- `v3/tests/unit/graph-bias-dispatch.test.ts` — antigravity 스테일 워크스루(§9) 재현: 누적 → bias
  음전환 → 회복.

**수정**

- `v3/electron/dispatch-scoring.ts` — `PerModelScore.graphBias` 필드, `scoreModelsDetailed(...,ctx?,
graph?)` 시그니처 확장, `total`에 graphBias 가산.
- `v3/electron/bridge-server.ts` — spawn 분기서 그래프 로드+ctx 주입, `decisionReason`에 graph 조각.
- `dispatchMeta` 퍼시스터(bridge-server:1627 / main.ts:2161) — role·tags·taskType 추가 보존.
- (CT3prjl4 후속 계약) outcome 어휘 확장: auth_failed/tool_zero/crash_loop/dependency_stuck.

**무변경(재사용)**: `dispatch:decision` 스키마, `routing_data_pipeline`, BQ `events`/functions,
텔레메트리 게이트.

---

## 12. 테스트 전략

- **순수 로직 유닛**(벽시계 주입): 감쇠 반감기 정확성, 신뢰도 수축(n=1 거의 무영향), 콜드스타트=0,
  멱등(중복 outcome skip), `dependency_stuck` 제외, 호스트버킷 빠른 감쇠.
- **통합**: `scoreModelsDetailed`가 graph 없을 때 기존 테스트와 byte-동일(무회귀), graph 있을 때
  bias 반영. `graphBias`가 역할 하드게이트/reuse 보너스를 절대 못 뒤집는 상한 검증.
- **시나리오**: §9 워크스루 — 반복 스테일 → antigravity 강등 → 성공 유입+감쇠 → 회복.
- tsc 0, 기존 dispatch-scoring/watchdog 테스트 그린 유지.

---

## 13. 오픈 이슈 / 리스크

- **CT3prjl4 미landing**: 이 스펙의 피드백 루프는 CT3prjl4 outcome 이벤트에 의존 → 그게 REVIEW를
  통과해야 착수 가능. (그 전엔 그래프 파생/스코어링 순수 로직만 선구현 가능.)
- **outcome 어휘 갭**: §3의 10+ 모드 vs CT3prjl4 5종. 확장을 후속 계약으로 밀되, v1은 로컬 정규화로
  브리지 — 세분이 늦으면 `crash_loop`/`tool_zero` 신호가 뭉개짐(품질만 저하, 안전).
- **taskType 정확도**: BQ events/cost의 taskType 0% 공백은 `classifyTaskType()` 로컬 재계산으로
  우회(§7.3)하므로 **블로커 아님**. 잔여 리스크는 분류기 자체의 정밀도(키워드 기반) — 셀 카디널리티/
  정확도가 여기 걸리나, taskType 미확정 시 tag/complexity/role 셀만으로도 그래프는 동작(우아한 저하).
- **스테일 위양성**: §3.2 — 수축·감쇠로 완화하나, watchdog 정밀도 개선(별도 티켓)이 근본 해법.
- **부트스트랩 시딩 여부**: 정적 `MODEL_TAG_BONUSES` 사전 시딩 vs 0-시작. 기본 0-시작 권장,
  플랜 단계서 확정.
- **크로스머신/유저 전역**: v1 머신 로컬. fleet 전역 학습은 opt-in 텔레메트리 계약 필요(후속).
