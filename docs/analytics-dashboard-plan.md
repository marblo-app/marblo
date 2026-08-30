# 관리자 사업분석 대시보드 — 기획/스펙

작성일: 2026-07-12
상태: **기획/스펙 (승인 대기 · 전제 일부 낡음 — 2026-08-30 정정)** — 이 문서는 설계까지다. 구현 코드는 승인 후 별도 티켓으로 분해한다.

> **★2026-08-30 정정 — 아래 본문의 전제 두 가지가 더 이상 사실이 아니다.** 본문은 작성 시점(07-12) 실측으로 남겨 두고, 여기서만 고친다.
>
> 1. **1차 텔레메트리는 기본 ON 이다(옵트인 아님).** `v3/src/lib/telemetry/firstPartyGate.ts` `firstPartyTelemetryDefaultEnabled()` 가 `true` 를 돌려준다 — 정당한 이익 근거, 2026-07-17 CEO 승인, PR#397 에서 전환. `VITE_FIRST_PARTY_TELEMETRY` 옵트인 플래그는 폐기됐고 `VITE_DISABLE_TELEMETRY=1` 만 kill-switch 다. 따라서 §0-1(B)·§1 게이트 줄·§2 리스크 "희소" 전제·🟡 "옵트인 편향" 라벨은 **"익명 설치 축(계정과 조인 불가)"** 으로 읽어야 한다. 희소성 문제는 옵트인 때문이 아니라 **외부 실사용자가 적어서**다(설치 7, 외부 4).
> 2. **Sentry 는 설치돼 있다.** `v3/package.json` `@sentry/electron ^7.15.0` · `v3/electron/sentry-main.ts`(main 프로세스, 동의 게이트 + DSN 게이트 + PII 스크럽) · `v3/src/lib/telemetry/sentry.ts`(렌더러). 단 **동의 후에만 init** 되고 DSN 이 없으면 no-op 이므로 "크래시율 KPI 소스 0" 판정은 **"소스 있음 · 동의 표본"** 으로 바뀐다(§1.3 · T0-2 · T3-6).
> 3. 그 사이 실제로 생긴 것: 팀 축 화면 `marblo-web /team`(사용량·감사 탭, `docs/team-usage-overview-design-2026-08-21.md`) · 어드민 콜러블군(`docs/analytics-admin-callables-api.md`) · 사람 축(`events.userKey`, 2026-08-29 13:14:19Z 이후) · `task_outcomes.outcomeMode`. §3 "시각화/집계 레이어만 없다" 는 어드민 쪽은 부분 해소됐고, **팀(B2B) 쪽 성공/실패는 여전히 없다** — 판정: `docs/team-analytics-liveness-audit-2026-08-30.md`.
관련 티켓: `AfhbDvRPXfEsFoR943ON`

> 이 문서의 모든 "있음/없음" 판정은 코드 실측 근거(파일:라인)를 붙였다. 근거 없는 추측은 넣지 않았고, 데이터가 없는 곳은 **공백으로 명시**했다.

---

## 0. TL;DR — 결론 먼저

1. **데이터는 두 개의 분리된 세계에 산다.** 이게 이 대시보드 설계의 가장 중요한 사실이다.

   - **(A) 식별 가능한 사업 데이터** — Firestore(`subscriptions`, `founders`, `betatester50_waitlist`) + BigQuery `cost_logs`/`flow_executions`(둘 다 `userId = Firebase uid`). **항상 켜져 있고 신뢰 가능.** 가입·결제·구독·계정별 비용이 여기 있다.
   - **(B) 익명 제품사용 데이터** — BigQuery `events`/`task_outcomes`/`agent_heartbeats`(모두 `userId = 익명 clientId`). **기본 OFF + 옵트인/도그푸드 빌드만 송신** → 프로덕션에서 희소하고, 계정과 조인 불가.
   - ⇒ "가입 → **활성** → Pro" 퍼널에서 가운데 "활성(제품 사용)"이 **가장 약한 고리**다. 사용 이벤트가 익명 + 옵트인이라 계정 단위 활성/리텐션을 정확히 못 붙인다. (§1, §5)

2. **Sentry 는 실제로 연동돼 있지 않다.** `@sentry/*` 패키지가 어느 `package.json`/lockfile 에도 없다. 옵트인 스캐폴딩(`v3/src/lib/telemetry/sentry.ts`)만 있고 런타임 no-op 이다. ⇒ **크래시/에러율 KPI 는 지금 만들 수 없다.** 대시보드 v1 의 전제(선행 과제)로 명시한다. (§1.3)

3. **어드민 크로스유저 집계 함수가 하나도 없다.** 기존 `getCostSummary`/`getCostLogs` 는 전부 `WHERE userId = @uid` 자기조회다. 대시보드 구현은 **새 `requireAdmin` 게이트 콜러블**을 반드시 신설해야 한다. (§1.4, §4.4)

4. **권장 위치 = marblo-web `/admin` 확장.** 이미 `ADMIN_UID` 게이트 + 탭 + 콜러블 패턴이 있다. 단 **차트 라이브러리가 marblo-web 엔 없다**(recharts 는 v3 렌더러에만 있고 그마저 미사용). (§4.1)

5. **모델 선정 관점의 gold 신호는 이미 발화 중이다** — `dispatch:decision` 이벤트(모델 라우팅 결정 스냅샷)와 `task_outcomes`(model × role × success × cost × duration). 데이터 4-tuple 은 갖췄고 **시각화/집계 레이어만 없다.** (§3)

---

## 1. 데이터소스 맵 (있는 것 / 없는 것)

### 1.1 파이프라인 개요

```
Electron main (agent-manager, cost-tracker)
      │  IPC (telemetry:event, cost:update)
      ▼
Renderer 초크포인트  ── firstPartyGate (기본 OFF) ── anonymize(PII scrub)
      │                                          │
      ├── Firebase Callable Functions ───────────┼──▶ BigQuery  marblo-2253d.marblo_telemetry (US)
      │   (logTelemetryBatch/logCostBatch/…)      │     events / cost_logs / task_outcomes /
      │                                          │     agent_heartbeats / flow_executions
      └── Firestore (live) ───────────────────────┘     agents/<id> · tasks/<id> · missions/<id> ·
                                                        subscriptions · founders · betatester50_waitlist …
```

근거: `docs/telemetry_coverage.md`, `v3/src/services/telemetryService.ts`, `v3/electron/telemetry.ts`, `v3/functions/src/index.ts`.

### 1.2 BigQuery 텔레메트리 — 있음 (단, 게이트 OFF 주의)

- **프로젝트/데이터셋/리전:** `marblo-2253d` · `marblo_telemetry` · **`US`** (`v3/functions/src/index.ts:32-37`; 쿼리 FROM 절에 하드코딩 `:3079,3134,3152`). BQ_LOCATION="US" 로 통일됨(과거 us-central1 조회 500 버그는 해소).
- **테이블 5종 (전부 `functions.https.onCall`, `context.auth` 필수):**

| 테이블             | 적재 콜러블                                                 | 행의 `userId`               | 핵심 컬럼                                                                                                                                                                                                                                                                         |
| ------------------ | ----------------------------------------------------------- | --------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `events`           | `logTelemetryBatch` (`:2903`, 삽입 `:2967`, 최대 100/batch) | **익명 clientId** (`:2931`) | event, projectId, agentId, taskId, flowId, model, role, status, from/toStatus, durationMs, tokensInput/Output, cost, success, exitCode, nodeType, nodeCount, **promptHash·promptLength·parentAgentId·retryOf·taskType·taskComplexity·errorCategory·errorMessage**, metadata(JSON) |
| `cost_logs`        | `logCostBatch` (`:3020`, 삽입 `:3054`)                      | **Firebase uid** (`:3033`)  | projectId, agentId, model, inputTokens, outputTokens, cacheReadTokens, cacheWriteTokens, totalCost, taskId, taskType, sessionId, pricingSnapshot, timestamp                                                                                                                       |
| `task_outcomes`    | `logTaskOutcome` (`:3216`)                                  | **익명 clientId**           | taskType, taskComplexity, role, model(detectedModelId), promptLength, scopeFileCount, success, durationMs, totalCost, retriesCount, errorCategory                                                                                                                                 |
| `agent_heartbeats` | `logHeartbeat` (`:3266`, 최대 50/batch)                     | **익명 clientId**           | agentId, projectId, status, tokensAccumulated, costAccumulated, lastActivityType, timestamp                                                                                                                                                                                       |
| `flow_executions`  | `logFlowExecution` (`:3309`)                                | **Firebase uid**            | flowId, runId, projectId, nodeCount, nodesExecuted(JSON), status, totalDurationMs, success                                                                                                                                                                                        |

- **⚠️ 게이트 (핵심 제약):** 모든 1차 텔레메트리는 `v3/src/lib/telemetry/firstPartyGate.ts` 로 **기본 OFF**. `VITE_FIRST_PARTY_TELEMETRY=1`(내부/도그푸드 빌드) 또는 런타임 옵트인(`setTelemetryEnabled(true)`)에서만 송신. `VITE_DISABLE_TELEMETRY=1` 은 하드 kill-switch.

  - ⇒ **BigQuery `events`/`task_outcomes`/`agent_heartbeats` 는 프로덕션 일반 사용자 데이터가 희소할 수 있다.** 대시보드에서 "제품 사용/활성" KPI 는 이 희소성을 전제로 하고, 표본이 도그푸드+옵트인 편향임을 UI에 라벨링해야 한다. **(데이터 공백)**

- **`dispatch:decision` 이벤트 (모델 라우팅 결정 스냅샷) — 있음:** main 에서 발화(`v3/electron/telemetry.ts:159-205`, `bridge-server.ts:2085`). 필드: role, complexity, tags[], eligibleModels[], selectedModel, perModelScores[], modelSelectionMode, decisionReason, reuseVsSpawn, explicitModel, agentScore. **단** renderer `TelemetryEvent` union 엔 없어 `events.metadata`(JSON STRING) 컬럼으로 접혀 들어감 → 쿼리 시 JSON 파싱 필요. (§3 gold)

### 1.3 Sentry — **없음 (미설치, 런타임 no-op)**

- `@sentry/*` 패키지가 `v3/package.json`, `v3/functions/package.json`, **양쪽 lockfile 어디에도 없다.**
- 코드 스캐폴딩만 존재: `v3/src/lib/telemetry/sentry.ts` 의 `maybeInitSentry(consented)` 가 `@sentry/react`(주의: `@sentry/electron` 아님)를 **동적 import(문자열 조립으로 Vite 해석 회피)** 하고, 패키지 부재 시 `.catch(() => ({}))` → null → no-op. `VITE_SENTRY_DSN` 도 필요(미설정).
- 옵트인 UI 배선만 있음: `PrivacySettings.tsx:58`, `PrivacyConsentGate.tsx:16` → `maybeInitSentry(consent.sentry)`.
- (GA4 도 동일 패턴, `ga4.ts`, "not used in the app.")
- ⇒ **크래시/에러/릴리스별 안정성 KPI 는 현재 데이터 소스가 0.** 대시보드에 넣으려면 Sentry 실설치가 선행 과제. 지금은 유일한 에러 근사치가 `events.exitCode` + `errorCategory`(단, exit 시 대부분 미채움 — `telemetry_coverage.md`) 로 매우 제한적. **(데이터 공백)**

### 1.4 비용 집계 — 있음 (단, 자기조회 전용)

- 두 경로: **(1) Firestore `agents/<id>` 롤링 누적**(atomic `increment` — totalCost, total*Tokens, detectedModelId, detectedPlanType, rateLimit*; `v3/src/hooks/useCostWriter.ts:41-60`) = 라이브 읽기. **(2) BigQuery `cost_logs`** = 히스토리 분석.
- 콜러블 `getCostLogs`(`:3060`), `getCostSummary`(`:3095`) — **둘 다 `WHERE userId = @uid AND projectId = @projectId`** (자기 데이터만). 소비: `v3/src/services/costService.ts`, 스토어 `costStore.ts`, UI `v3/src/components/usage/UsagePage.tsx`(차트=CSS 막대, 차트 라이브러리 미사용) · `agents/CostWidget.tsx`.
- ⇒ **어드민(전체 사용자) 비용 뷰는 없다.** 신규 `requireAdmin` 콜러블로 `userId` 필터를 제거/그룹바이 해야 함.

### 1.5 Firestore 사업 데이터 — 있음 (항상 켜짐, 식별 가능)

| 컬렉션                  | 문서 ID           | 핵심 필드                                                                                                                                                                                                                                                                                                                                                       | 용도                       |
| ----------------------- | ----------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------- |
| `subscriptions`         | userId            | planType(**`free`/`pro`/`team`/`team_plus`**), status(`active`/`past_due`/`canceled`), paymentProvider(`paddle`/`toss`/`founder_grant`), currentPeriodStart/End, createdAt, canceledAt, billingFailedCount — **CF-only write, owner read-only**(`firestore.rules:281`). 가격 `billing.ts:12`(pro 19000/team 29000/team_plus 290000 KRW), 실패 3회→canceled+free | 구독/Pro 전환·이탈         |
| `billingCharges`        | `{uid}_{cycleMs}` | amount, planType, reason(`first`/`renewal`/`manual`), status(`pending`/`succeeded`/`comped`/`failed`)                                                                                                                                                                                                                                                           | 멱등 청구 원장=실매출 근거 |
| `betatester50_waitlist` | auto              | email, locale, (신청 메타) — 클라가 직접 write, `onCreate` 확인메일 트리거(`:1827`)                                                                                                                                                                                                                                                                             | 가입/신청 top-of-funnel    |
| `founders`              | email             | accessGrantedAt, beta 만료, rubric score, interview 상태, Pro months (`FOUNDERS_COLLECTION` `:1253`)                                                                                                                                                                                                                                                            | 파운더 선정/활성           |
| `founder_feedback`      | auto              | 설문 응답, rubric 점수                                                                                                                                                                                                                                                                                                                                          | 정성 피드백                |
| `bugReports`            | auto              | status(new/triaged/resolved) 등                                                                                                                                                                                                                                                                                                                                 | 버그 트리아지              |
| `agents/<id>`           | agentId           | totalCost, total*Tokens, detectedModelId, detectedPlanType, rateLimit*, costUpdatedAt                                                                                                                                                                                                                                                                           | 라이브 에이전트/비용       |
| `tasks/<id>`            | taskId            | status, role, priority, timestamps (텔레메트리 `task:*` 이벤트와 연동)                                                                                                                                                                                                                                                                                          | 태스크 라이프사이클        |
| `missions/<id>`         | missionId         | 미션/스텝 (Firestore `missions`, 테스트용 in-mem 폴백 `missionService.ts:29`)                                                                                                                                                                                                                                                                                   | 미션 완료율                |
| 기타                    | —                 | `pendingOrders`, `coupons`, `couponRedemptions`, `lecturePurchases`, `billingCharges`, `projects`, `lectures`                                                                                                                                                                                                                                                   | 결제/쿠폰/강의             |

- ⚠️ **`agents/<id>` 는 라이브 상태 doc(가변) — 스폰당 불변 로그가 아니다.** 문서 ID 가 에이전트당 멱등이라 in-place 갱신·reaper 삭제·오케 단일 doc 재사용됨. ⇒ 라이브 로스터+롤링 누적비용은 되지만 **"전체 스폰 이력 카운트"는 안 된다.** 스폰/런 히스토리 분석은 BigQuery(`events`/`agent_heartbeats`)로.
- ⚠️ **`users/{uid}` 프로필 doc = 데이터 공백:** 가입 시 Firestore `users` doc 을 안 만든다(`AuthProvider.tsx:345` 는 Firebase Auth 계정만; `privacyConsent` 맵만 lazy write). ⇒ 가입일/플랜을 `users` 에서 못 읽음. 가입일 = Firebase Auth `metadata.creationTime`(Admin SDK) 또는 `betatester50_waitlist.createdAt`, 플랜 = `subscriptions/{uid}`.
- ⚠️ **Firestore `cost_logs`·`telemetry_events` 컬렉션은 rules 에만 있고 writer 부재(비어있음).** 비용/이벤트는 전부 BigQuery. 이 위에 대시보드를 짓지 말 것.
- ⇒ **가입·구독·결제 퍼널은 Firestore(식별)로 신뢰성 있게 계산 가능.** 문제는 "활성(제품 사용)"만 익명 BQ 에 있다는 점(§0-1).

### 1.6 데이터 공백 요약 (명시)

| 공백                          | 원인                                                                | 영향                                                         |
| ----------------------------- | ------------------------------------------------------------------- | ------------------------------------------------------------ |
| 프로덕션 제품사용 이벤트 희소 | 텔레메트리 기본 OFF + 옵트인                                        | DAU/WAU·리텐션·스폰수·미션완료율이 도그푸드+옵트인 편향 표본 |
| 계정 ↔ 사용 조인 불가         | events=익명 clientId, 매핑 테이블 없음(`telemetryService.ts:72-95`) | "가입한 이 사람이 얼마나 쓰나"를 계정 단위로 못 붙임         |
| 크래시/에러율 없음            | Sentry 미설치                                                       | 안정성 KPI 불가                                              |
| per-task 정확 비용            | task_outcomes.totalCost=누적값, cost_logs.taskId 채움 검증 필요     | 작업당 평균 비용 근사만                                      |
| 에이전트 트리                 | parentAgentId 스키마만 있고 미전달                                  | 오케↔자식 패턴 분석 불가                                     |
| errorCategory/fast_fail       | exit 시 미채움                                                      | 실패 원인·신뢰성 분해 불가                                   |

---

## 2. KPI 정의

각 KPI 에 **[소스 / 신뢰도]** 를 붙였다. 신뢰도: 🟢 항상 켜짐(식별 Firestore/uid) · 🟡 옵트인/도그푸드 편향(익명 BQ) · 🔴 소스 없음(선행 과제).

### 2.1 사업 퍼널·성장

| KPI                       | 정의                                                                              | 소스 / 신뢰도                               |
| ------------------------- | --------------------------------------------------------------------------------- | ------------------------------------------- |
| 신규 가입/신청            | `betatester50_waitlist` 일별 신규 doc                                             | Firestore / 🟢                              |
| 파운더 선정 활성          | `founders.accessGrantedAt` 존재 수                                                | Firestore / 🟢                              |
| **Pro 전환율**            | (Pro `subscriptions.status=active` ∩ paymentProvider≠founder_grant) ÷ 활성 사용자 | Firestore / 🟢                              |
| 유료 구독 순증(MRR proxy) | Toss/Paddle active 구독 수 · 갱신/이탈                                            | Firestore `subscriptions` / 🟢              |
| 구독 이탈(churn)          | `status`: active→canceled/past_due 전환율                                         | Firestore / 🟢                              |
| **DAU / WAU**             | 일/주 고유 활성 = 사용 이벤트 발화한 고유 clientId                                | BQ `events`/`heartbeats` / 🟡 (익명·옵트인) |
| **리텐션(D1/D7/D30)**     | clientId 코호트 재방문                                                            | BQ / 🟡 (계정 조인 불가 → clientId 기준만)  |
| 상위 이벤트               | `events.event` 빈도 랭킹                                                          | BQ / 🟡                                     |
| **이탈지점(퍼널 드랍)**   | 세션 내 이벤트 시퀀스에서 이탈 노드                                               | BQ (`session:*`, `flow:*`) / 🟡             |

> ★ "가입→활성→Pro" 통합 퍼널: 좌우 끝(가입·Pro)은 🟢, 가운데(활성)는 🟡. **대시보드는 이 두 축을 분리 표기**하고, 통합 퍼널은 "옵트인 표본 기준" 라벨을 단다.

### 2.2 제품 사용·에이전트

| KPI                 | 정의                                        | 소스 / 신뢰도                                   |
| ------------------- | ------------------------------------------- | ----------------------------------------------- |
| **에이전트 스폰수** | `agent:spawned` 카운트(일별/역할별/모델별)  | BQ `events` / 🟡                                |
| 스폰 성공/실패율    | `agent:stopped(success)` vs `agent:crashed` | BQ / 🟡 (fast_fail 미분리)                      |
| **모델별 분포**     | 스폰·태스크의 `model` 비중                  | BQ `events`/`task_outcomes` / 🟡                |
| 태스크 처리량       | `task:created` / `task:completed` 일별      | BQ + Firestore `tasks` / 🟡·🟢                  |
| 태스크 성공률       | `task_outcomes.success` 비율                | BQ / 🟡                                         |
| 평균 완료시간       | `task_outcomes.durationMs` 분포             | BQ / 🟡                                         |
| **미션 완료율**     | 완료 미션 ÷ 생성 미션                       | Firestore `missions` / 🟢(존재) 🟡(스텝 이벤트) |
| 플로우 실행 성공률  | `flow_executions.success`                   | BQ / 🟢(uid) 🟡(옵트인)                         |
| 활성 에이전트 추이  | `agent_heartbeats` 시간대별                 | BQ / 🟡                                         |

### 2.3 안정성 (현재 🔴 — 선행 과제)

| KPI                        | 정의                   | 소스 / 신뢰도     |
| -------------------------- | ---------------------- | ----------------- |
| 크래시율 / 릴리스별 안정성 | Sentry 이벤트          | 🔴 Sentry 미설치  |
| 에러 카테고리 분포         | `events.errorCategory` | 🔴 exit 시 미채움 |

---

## 3. 모델 선정/준비 관점 지표 (라우팅 의사결정 근거)

목표: "어떤 종류의 작업엔 어떤 모델이 싸고·빠르고·잘 하는가"를 데이터로 답해 **라우팅/모델선정 근거**를 만든다.

- **학습 4-tuple `(prompt-shape, model, role, outcome)` 는 이미 갖춰짐**(`telemetry_coverage.md` §3):
  - prompt-shape → `events.promptHash` + `promptLength` (raw 미저장 → 의미 클러스터는 임베딩 별도 필요)
  - model → `events.model` / `task_outcomes.model(detectedModelId)`
  - role → `events.role` / `task_outcomes.role`
  - outcome → `task_outcomes.success` + `durationMs` + `totalCost`
- **대시보드 지표:**

| 지표                     | 계산                                                                          | 소스                                                |
| ------------------------ | ----------------------------------------------------------------------------- | --------------------------------------------------- |
| 모델별 사용량            | 스폰수·토큰·태스크 수 by model                                                | `events`, `cost_logs`, `task_outcomes`              |
| **모델별 비용**          | `SUM(totalCost)` by model (일/주)                                             | `cost_logs` (`getCostSummary` 의 admin 버전)        |
| **모델별 성공률**        | `task_outcomes.success` 비율 by model×role                                    | `task_outcomes`                                     |
| 모델별 평균 완료시간     | `AVG(durationMs)` by model×role                                               | `task_outcomes`                                     |
| **비용 대비 성공(효율)** | 성공률 ÷ 평균비용, by (role, complexity)                                      | `task_outcomes` + `cost_logs`                       |
| **라우팅 결정 분포**     | `dispatch:decision`: selectedModel·decisionReason·perModelScores·reuseVsSpawn | `events.metadata`(JSON)                             |
| 라우팅 결정 ↔ 실제 결과  | selectedModel 이 실제로 성공/저비용이었나                                     | `dispatch:decision` ⋈ `task_outcomes` (taskId 조인) |

- **모자란 것(라우팅 고도화 선행, 우선순위순):** ① `parentAgentId` 미전달(트리 불가, 1줄 보강) ② `agent:fast_fail` 미분리(신뢰성 노이즈) ③ per-task cost delta(claim 시점 스냅샷) ④ `taskType` 분류기(현재 null) ⑤ prompt 임베딩(hash→의미 클러스터, BQ ML/Vertex). — 전부 **별도 티켓**(§6-C).

---

## 4. 대시보드 설계

### 4.1 위치 — **marblo-web `/admin` 확장 (권장)**

| 후보                            | 장점                                                                                                                  | 단점                                                                           | 판정                     |
| ------------------------------- | --------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ | ------------------------ |
| **marblo-web `/admin` 탭 추가** | 이미 `ADMIN_UID` 게이트·탭·콜러블 패턴 존재(`admin/page.tsx`), 어드민이 이미 로그인하는 곳, 사업/결제 컨텍스트와 동거 | 차트 라이브러리 없음(추가 필요), Next 커스텀 빌드 주의(`marblo-web/AGENTS.md`) | ✅ **채택**              |
| Electron 앱 내 탭               | recharts 이미 설치(v3)                                                                                                | 어드민 전용 화면을 일반 사용자 앱에 넣는 건 부적합, 배포=앱 릴리스 결합        | ❌                       |
| 별도 앱/도메인                  | 완전 격리                                                                                                             | 인증·배포·유지보수 중복, 과잉                                                  | ❌ (규모 도달 후 재검토) |

- 결정: **`marblo-web/src/app/[locale]/admin` 에 `analytics` 탭 신설.** 기존 `ADMIN_TABS`(`page.tsx:137`)에 항목 추가, 기존 auth 게이트(onAuthStateChanged + 콜러블 permission-denied 판정) 재사용.

### 4.2 집계 방식 — **서버 집계(신규 admin 콜러블) 우선**

- 기존 `getCostSummary` 서버집계 패턴을 그대로 따르되 **`requireAdmin(context)` 게이트**(`:1284`)를 붙이고 `userId` 필터를 제거/그룹바이. 원시 이벤트를 클라로 내리지 않는다(PII·용량·성능).
- marblo-web 은 현재 **서버 데이터 패칭/`firebase-admin` 사용 전례가 없다**(dependency 는 있으나 `src`에서 미import). ⇒ 데이터는 **v3/functions 의 신규 admin 콜러블**로 뽑는 게 기존 패턴과 일치(클라 `httpsCallable`).

### 4.3 화면 구성 (카드 + 차트)

```
┌ /admin › Analytics ─────────────────────────────────────────┐
│ [기간 선택 7/30/90d]  [표본 라벨: 옵트인 N / 전체 M]          │
│                                                              │
│ ── 사업(🟢) ──────────────────────────────────────────────  │
│ [가입]  [활성 파운더]  [Pro 구독]  [Pro 전환율]  [Churn]      │  ← KPI 카드
│ [구독 추이 라인차트: active/canceled/past_due 스택]           │
│ [퍼널: 신청→선정→활성→Pro (막대)]                            │
│                                                              │
│ ── 제품 사용(🟡 옵트인 표본) ──────────────────────────────  │
│ [DAU/WAU 라인]  [상위 이벤트 바]  [스폰수 추이]              │
│ [태스크 성공률·완료시간]  [미션 완료율]  [이탈지점 퍼널]      │
│                                                              │
│ ── 모델 준비(🟡) ─────────────────────────────────────────  │
│ [모델별 비용 스택바]  [모델×role 성공률 히트맵]              │
│ [비용대비효율 표]  [라우팅 결정 분포(dispatch:decision)]      │
│                                                              │
│ ── 안정성(🔴 Sentry 선행) ── "미연동 — Sentry 설치 후 활성"  │
└──────────────────────────────────────────────────────────────┘
```

- **차트 라이브러리:** marblo-web 에 신규 도입 필요. 옵션 (a) `recharts`(v3 와 통일, React 친화) (b) 기존 UsagePage 처럼 CSS 막대(의존성 0, MVP 빠름). **권장: MVP 는 CSS 막대/간단 SVG 로 시작 → 고도화 때 recharts 도입.** (marblo-web 커스텀 Next 빌드 리스크 최소화)
- **카드 스타일:** 기존 `CostWidget`(`rounded-lg border border-gray-700 bg-gray-800 p-4`) · admin 페이지 톤 재사용.

### 4.4 권한 (ADMIN)

- 서버: **모든 신규 애널리틱스 콜러블에 `requireAdmin(context)`**(단일 `ADMIN_UID` env vs `context.auth.uid`, `:1284`). 커스텀클레임/allowlist 아님 — 기존 방식 그대로.
- 클라: 기존 admin 페이지처럼 `permission-denied` 응답으로 어드민 여부 판정(별도 클라 allowlist 없음).
- **주의:** `ADMIN_UID` 미설정이면 전 콜러블 차단(파운더 봇 런북과 동일) → 배포 전 env 확인.

---

## 5. 프라이버시

- **원칙: 관리자 대시보드에서 PII(이메일·이름·전화·경로·키) 노출 금지.** 집계·익명 지표만.
- **두 식별공간 분리 준수:**
  - `events`/`task_outcomes`/`heartbeats` = **익명 clientId**(`crypto.randomUUID`, 계정 uid 와 매핑 없음 `telemetryService.ts:72-95`). 여기서 개인 식별 시도 금지.
  - `cost_logs`/`flow_executions` = **Firebase uid**. 어드민 집계 시 uid 를 **그대로 노출하지 말고** 합계/그룹 통계로만. 개별 uid drill-down 이 필요하면 별도 승인·마스킹.
  - Firestore `founders`/`waitlist` 에는 이메일 등 PII 존재 → **애널리틱스 탭에서는 카운트/전환율만**, 개별 이메일은 기존 파운더 탭에 격리 유지.
- **텔레메트리 방침 준수(`telemetry_coverage.md`, 메모리 telemetry_privacy_policy):** 1차(BQ)=비식별 상시(단 기본 OFF), 3rd-party(Sentry/GA4)=옵트인. 대시보드는 이 방침을 바꾸지 않는다 — **표본이 옵트인/도그푸드 편향임을 UI에 항상 라벨**(“옵트인 N명 기준”).
- 스크럽: 서버 집계 쿼리는 raw metadata/prompt/email 컬럼을 select 하지 않는다.

---

## 6. 단계별 구현계획 + 후속 티켓 분해

> 승인 후 아래를 개별 티켓으로 생성. 각 티켓은 "구현" 티켓(이 기획 티켓과 분리).

### Phase 0 — 선행/전제 (병렬 가능)

- **T0-1 (backend):** 신규 admin 집계 콜러블 뼈대 — `requireAdmin` + BQ/Firestore, `userId` 필터 제거. (`getAdminBusinessSummary`, `getAdminUsageSummary`, `getAdminModelSummary`)
- **T0-2 (decision):** Sentry 실설치 여부 결정 — 안정성 KPI 원함 시 `@sentry/electron` 도입 별도 트랙(현재 🔴). 미도입이면 대시보드에서 안정성 섹션 "미연동" 고정.
- **T0-3 (data):** 표본 신뢰도 라벨링 스펙 확정 — 옵트인/도그푸드 표본 크기 노출 방식.

### Phase 1 — MVP (사업 퍼널, 🟢 데이터 우선)

- **T1-1 (backend):** `getAdminBusinessSummary` — Firestore `subscriptions`/`founders`/`waitlist` 집계(가입·Pro·전환율·churn·구독추이). PII 미노출.
- **T1-2 (frontend):** `/admin › Analytics` 탭 + 사업 KPI 카드 + 구독/퍼널 차트(CSS 막대). 기존 auth 게이트 재사용.
- **T1-3 (backend):** `getAdminUsageSummary` — BQ `events`/`task_outcomes` 로 DAU/WAU·상위이벤트·스폰수·성공률(옵트인 표본 라벨 포함).
- **T1-4 (frontend):** 제품 사용 섹션 카드/차트 + "옵트인 N명 기준" 라벨.

### Phase 2 — 모델 준비 관점

- **T2-1 (backend):** `getAdminModelSummary` — `cost_logs`(admin) 모델별 비용 + `task_outcomes` 모델×role 성공률/완료시간 + 비용대비효율.
- **T2-2 (backend):** `dispatch:decision` 집계 — `events.metadata` JSON 파싱, 라우팅 결정 분포 + 결정↔결과 조인(taskId).
- **T2-3 (frontend):** 모델 준비 섹션(비용 스택바·성공률 히트맵·라우팅 분포).

### Phase 3 — 고도화 (데이터 보강 → 정확도)

- **T3-1:** `parentAgentId` 발화 보강(에이전트 트리) — 1줄, main→telemetry.
- **T3-2:** `agent:fast_fail` 분리 이벤트(신뢰성 노이즈 제거).
- **T3-3:** per-task cost delta(claim 시점 cost 스냅샷) → 정확한 작업당 비용.
- **T3-4:** `taskType` 분류(LLM 추출/수동 태그) — 현재 null.
- **T3-5:** prompt 임베딩(BQ ML/Vertex) → 의미 클러스터 기반 라우팅 추천.
- **T3-6:** (안정성) Sentry 설치 시 크래시/릴리스 안정성 섹션 활성.
- **T3-7:** recharts 도입 + 인터랙티브 차트/드릴다운, 코호트 리텐션.

### 의존성

```
T0-1 ─┬─ T1-1 ── T1-2
      ├─ T1-3 ── T1-4
      └─ T2-1/T2-2 ── T2-3
Phase3 는 Phase1/2 이후 데이터 정확도 보강(독립).
T0-2(Sentry 결정) ── T3-6
```

---

## 7. 근거 파일 인덱스 (실측)

- 텔레메트리 파이프라인/커버리지: `docs/telemetry_coverage.md`
- 이벤트 발화/게이트/익명 clientId: `v3/src/services/telemetryService.ts`, `v3/electron/telemetry.ts`, `v3/src/lib/telemetry/firstPartyGate.ts`
- BQ 적재/집계/어드민 게이트: `v3/functions/src/index.ts` (`:32-37` BQ 상수, `:1284` requireAdmin, `:2903` logTelemetryBatch, `:3020` logCostBatch, `:3060` getCostLogs, `:3095` getCostSummary, `:3216` logTaskOutcome, `:3266` logHeartbeat, `:3309` logFlowExecution)
- 비용 UI/스토어/서비스: `v3/src/components/usage/UsagePage.tsx`, `v3/src/components/agents/CostWidget.tsx`, `v3/src/stores/costStore.ts`, `v3/src/services/costService.ts`, `v3/src/hooks/useCostWriter.ts`
- Sentry(미설치) 스캐폴딩: `v3/src/lib/telemetry/sentry.ts`, `PrivacySettings.tsx`, `PrivacyConsentGate.tsx`
- 기존 /admin: `marblo-web/src/app/[locale]/admin/page.tsx` (`:137` ADMIN_TABS, `:362` auth gate)
- Firestore 사업 컬렉션: `v3/functions/src/index.ts` (`:159` subscriptions, `:1253` founders, `:1827` betatester50_waitlist onCreate), `v3/src/services/missionService.ts`

```

```
