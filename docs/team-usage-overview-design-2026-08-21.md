# 팀 오버뷰 설계 — 오너가 보는 멤버별·오케별 토큰 사용량

작성일: 2026-08-21 · 티켓 `RpscJs0sc8IKFgdpSKKj` · 역할 backend
상태: **설계 doc (구현 없음)** → eng-review 후 §10 구현 티켓으로 분해

관련 정본
- 축 규율: `v3/functions/src/analyticsProfiles.ts` (`FORBIDDEN_ON_ANONYMOUS_AXIS` / `FORBIDDEN_ON_ACCOUNT_AXIS` / `assertAxisPurity`)
- 사람 축 게이트: `v3/functions/src/personAxis.ts` (`resolvePersonAxisGate`), `v3/docs/person-axis-user-key-design-2026-08-21.md`
- 어드민 콜러블 규약: `docs/analytics-admin-callables-api.md` (#1090)
- 감사 뷰 매퍼: `v3/functions/src/projectAudit.ts`
- 필드별 allowlist: `v3/firestore.rules` (#1096)

---

## 0. 한 문단 요약

멤버 단위 토큰은 **있다**(`cost_logs.userId` = 계정 uid, 2026-04-18~). 오케 단위 토큰은
**없다** — 2026-06-22 이후 0행이고 지금 코드에는 오케를 비용 트래커에 붙이는 경로가
아예 없다. 그래서 이 설계는 "멤버 축은 뷰로 열고, 오케 축은 수집부터 하는" 두 갈래다.
축 오염은 설계로 막는 게 아니라 **이미 있는 기계**(`assertAxisPurity` + 소스 스캔 가드)에
새 뷰를 등록해서 막는다. 그리고 화면은 처리방침이 아직 고지하지 않은 숫자라
**기본 닫힘(0행 + 사유)** 으로 태어난다 — #1090 과 같은 규약이다.

---

## 1. 실측 — 지금 실제로 수집되는 것

> 방법: `bq query` (john.kim ADC, 읽기 전용). 원시 uid·이메일은 조회·출력 어디에도 쓰지 않았고
> 프로젝트 식별자는 SHA256 앞 8자로 접어서만 봤다. 원본 표는 건드리지 않았다.

### 1.1 `marblo-2253d.marblo_telemetry.cost_logs` — 유일한 사용량 원장

| 항목 | 실측값 |
| --- | --- |
| 스키마 | `userId, projectId, agentId, model, inputTokens, outputTokens, cacheReadTokens, cacheWriteTokens, totalCost, timestamp, taskId, taskType, sessionId, pricingSnapshot` |
| 행 수 / 크기 | 340,632행 / 50.3 MB |
| 기간 | 2026-04-18 ~ 2026-08-21 |
| 합계 | $99,807 · IO 토큰 16.4억 |
| 파티션 / 클러스터 | **둘 다 없음** — 모든 쿼리가 풀스캔 |
| distinct `userId` | **5** |
| distinct `projectId` | 22 |

★ `teamId` · `orgId` · `orchestratorId` · `actorUid` 컬럼은 **없다.** 테넌트 축은 `projectId` 하나뿐이다.

`userId` 의 정체 (`v3/functions/src/index.ts:7046`):

```ts
const userId = context.auth.uid;   // logCostBatch
```

= **토큰을 태운 기기에 로그인한 계정**. 100% 28자 계정 uid. 발주자(actor)가 아니라 실행 호스트다.
한 사람 기기에서 남의 티켓을 돌리면 그 사람 앞으로 찍힌다 — 화면 라벨이 이 사실을 말해야 한다.

### 1.2 ★멤버 단위 토큰 — 있다. 단 팀이 아직 없다

| 프로젝트 내 distinct 멤버 수 | 프로젝트 수 | 비용 |
| --- | --- | --- |
| 1명 | 21 | $31,022 |
| **2명** | **1** | **$67,782 (전체의 68%)** |

멤버 축 자체는 성립한다(같은 projectId 아래 서로 다른 userId 가 실제로 존재한다).
그러나 **멤버 2명 이상인 팀은 도그푸드 1개뿐이고, 전체 계정이 5개다.** 이 화면은
"지금 데이터를 보여주는 화면" 이 아니라 **"팀이 들어왔을 때 답이 준비돼 있는 화면"** 이다.
v1 을 그 전제로 잡아야 하고, 그래서 §7 의 슬라이스가 작다.

### 1.3 ★오케 단위 토큰 — 없다 (2026-06-22 이후 0행)

| 월 | 오케 행 | 오케 비용 | 워커 행 | 워커 비용 |
| --- | --- | --- | --- | --- |
| 2026-04 | 0 | $0 | 141 | $270 |
| 2026-05 | 165 | $2.42 | 549 | $5.75 |
| 2026-06 | 4,711 | **$22,329** | 40,125 | $54,084 |
| 2026-07 | **0** | **$0** | 56,756 | $8,507 |
| 2026-08 | **0** | **$0** | 239,336 | $14,613 |

`agentId LIKE 'orchestrator-%'` 기준. 6월엔 전체 지출의 **29%** 였다가 6/22 부로 끊겼다.

코드 근거 두 줄 — 지금은 붙을 자리가 없다:

- `v3/electron/orchestrator-manager.ts:2257`
  > "The orchestrator is not an agent-manager agent, so it never reaches the cost tracker."
- `v3/electron/main.ts:7458` — PTY 데이터 훅이 `sid.startsWith("agent-")` 일 때만
  `costTracker.processOutput` 을 부른다. 오케 PTY 는 `orch-` 접두라 안 걸린다.
  (실측 대사: `agentId LIKE 'orch-%'` = **0행** — 코드와 데이터가 일치한다.)

`costTracker.trackSession()` 호출부는 4곳뿐이고 전부 `agentManager` 세션 콜백에서 온다.
오케 세션 파일을 보는 코드는 `training-capture.trackOrchestratorSession` **하나**인데
그쪽은 학습데이터 캡처 전용이고 비용을 내보내지 않는다.

과거 4,876행의 정체도 확인했다: `orchestrator-` 접두 id 14개 중 **`orchestrator-<projectId>`
규약과 맞는 것은 4개뿐**이다. 살아있는 시계열이 아니라 규약 이전의 잔재다.
→ **화면에 오케 시계열로 그리면 안 된다.** §4.4 참조.

#### ★정정 (ticket TaDiWyLNi5ihBnjfVmMs, 2026-08-21) — 위 표의 6월 수치는 실지출이 아니다

후속 티켓이 6/22 단절의 원인을 파고 확인한 사실. **"오케가 전체 지출의 29%" 는
모델·벤더 비교의 근거로 쓰면 안 된다.**

- 그 행들에는 `cacheReadTokens` 가 실려 있다 → PTY 스크래핑이 아니라 **JSONL
  파싱(`trackSession`) 경로**의 산물이다. `agent-` 접두 PTY 훅은 이 데이터를
  만들 수 없다 — 즉 위의 "코드 근거 두 줄" 중 `main.ts` 쪽은 6월 행의 출처가 아니다.
- 출처는 **콜드부트 reconnect 의 오귀속**이다. 당시 `agent:reconnect` 에는
  라벨 없는 에이전트 doc 이 `~/.claude` 의 아무 unclaimed JSONL 이나 집어
  `--resume` 하는 fallback 이 있었고, 오케 에이전트 doc(`orchestrator-<projectId>`)이
  그 경로로 되살아나 **남의 살아있는 세션**에 붙었다.
- 실측(읽기 전용): 6월 오케 3,712행 $22,329 중 **953행 $5,605 가 같은 초의 워커
  행과 토큰까지 바이트 동일**하다. 한 토큰 번들을 최대 **11개 agentId** 가 동시
  청구했다. 한 달 cacheRead 34.7B 토큰은 실사용으로 나올 수 없는 값이다
  (#874 가 같은 기간 8월 비용의 32.4% 가 재읽기 중복이라고 이미 확인했다).
- 방증: `agent_heartbeats`(agent-manager 에서만 발화)에 `orchestrator-*` 가
  6/22 까지 존재하고, `agent:spawned(orchestrator-*)` 는 **6/17 이 마지막**이다.
- 단절시킨 변경은 **의도된 수정**이다 — `9c876f47`(#231) unclaimed-session
  fallback 제거, `bcc1fb41`(#235) machineId 게이트. 되살리면 안 된다.

→ 결론은 §1.3 의 방침을 **강화**한다: 오케 축은 "0" 도 아니고 "6월엔 29% 였다"
도 아니다. **2026-08 이전 전 구간이 미수집**이고, 6월 legacy 행은 시계열이 아니라
오귀속 잔재다. 소급 보정(추정 채움)은 금지 — 없는 것을 메우면 표 전체를 못 믿는다.

### 1.4 데이터 품질 — 화면이 거짓말할 수 있는 자리 넷

1. **`sessionId` 는 전 구간 100% NULL.** 스키마에 `"Session link"` 라고 적혀 있지만
   `useCostWriter` 가 payload 에 안 싣는다. 세션 축 드릴다운은 지금 불가능하다.
2. **`taskId` 는 2026-08 기준 83% NULL** (2026-07 은 50%). 티켓별 비용은 반쪽이다.
3. **`projectId` 결측이 2026-08 행의 55.8%.** 단 그 결측행은 사실상 전부 0비용·0토큰이다
   (2026-07 이후 no_project 139,972행 중 **139,912행이 zero**). 비용 기준 결측률은 **0.0%**.
   → **행 수를 활동 지표로 쓰면 안 된다.** 금액/토큰 기준으로만 읽어야 맞다.
4. **원장의 절반이 무의미 행.** projectId 가 있는 행조차 156,135 중 **86,798 이 zero-cost·zero-io**다.
   폴 틱마다 델타 0 인 행이 적재되고 있다. 집계 정확도엔 영향이 없지만 스캔 비용과
   "행=활동" 오독의 원인이다(§10-T7 별건 티켓).

그리고 다섯째, 수치가 아니라 의미의 문제:

5. **텔레메트리 옵트아웃한 멤버는 0 으로 보인다.** `isTelemetryEnabled()` 가 꺼져 있으면
   `useCostWriter` 가 조용히 return 한다. 화면에서 **"안 썼다" 와 "안 보낸다" 가 구분되지 않는다.**
   오너가 이 숫자로 사람을 평가하면 옵트아웃한 사람이 가장 일 안 한 사람이 된다.
   → §5.4 의 화면 규칙으로 강제한다.

### 1.5 결제 원장 — 이 화면의 소스가 아니다

- `billingCharges` (Toss + PortOne 미러) · `lecturePurchases` · PortOne — 전부 **`userId` 키**다.
- `subscriptions` 도 doc id = uid 다.
- `grep -rn 'seats\|seatCount'` → **0건.** 팀 좌석·팀 결제 엔티티가 코드에 존재하지 않는다.

즉 **"누가 얼마 썼나" 는 답할 수 있지만 "누구 몫으로 청구됐나" 는 답할 원장이 없다.**
v1 은 금액을 **"사용량 환산 비용(추정)"** 으로만 부르고 **절대 "청구액" 으로 부르지 않는다.**
청구 연결은 좌석 모델이 생긴 뒤의 별건이다(§9 범위 밖).

### 1.6 권한 현황

- `requireAdmin` = 단일 `ADMIN_UID` env 대조. **플랫폼 운영자 게이트지 팀 오너 게이트가 아니다.**
  → 팀 오버뷰는 `getAdminUsageSummary` **확장이 아니라 net-new 콜러블**이다(§9 답).
- 팀 = 별도 컬렉션이 없고 `projects` 문서다: `ownerId` + `members[]` + `memberRoles/{projectId}_{uid}`.
  `ROLE_PERMISSIONS`: owner 는 `manage_billing` 보유, admin 은 미보유, member 는 `read/write`, viewer 는 `read`.
- `audit_logs` 는 `canReadLedgerDoc()` = `isProjectMember` → **일반 멤버도 남의 활동 행을 읽는다.**
  단 원장에 토큰·비용 컬럼은 없다(`actorUid`/`toolName`/`model`/`instructionHash` 뿐).
  즉 "누가 뭘 했나" 는 이미 공개, "얼마 썼나" 는 아직 비공개 — 이 경계를 오버뷰가 뒤집지 않는다.

### 1.7 ★처리방침이 아직 이 화면을 고지하지 않았다

배포된 처리방침(`v3/src/components/legal/privacyContent.tsx:158` / EN:277):

> "사용량·비용 기록: **구독·정산 확인 목적** 보관"

= **본인** 정산 확인이다. "팀 오너가 개별 멤버의 사용량을 열람한다" 는 문장은 없다.
사람 축이 `PERSON_AXIS_EFFECTIVE_FROM` 을 필요로 했던 것과 **정확히 같은 이유**로,
이 화면도 고지 개정 전에는 열 수 없다. 엔지니어링이 정할 문제가 아니다.
→ §5.1 의 게이트가 이 설계의 전제다.

---

## 2. 화면이 답해야 할 질문 (오너가 실제로 묻는 것)

우선순위 순. 답할 수 있는지/없는지를 실측 근거로 같이 적는다.

| # | 오너의 질문 | 답 가능? | 근거 |
| --- | --- | --- | --- |
| Q1 | 이번 달 우리 팀이 얼마 썼나? 지난달 대비? | ✅ | `cost_logs` 금액 합, projectId 스코프 |
| Q2 | 누가 제일 많이 쓰나? 순위? | ✅ | `userId` × 팀 프로젝트 |
| Q3 | 어느 프로젝트에 쓰이나? | ✅ | `projectId` |
| Q4 | 어느 모델이 돈을 먹나? | ✅ | `model` (distinct 29) |
| Q5 | 언제 튀었나 — 그날 무슨 일이었나? | ⚠️ 반쪽 | 일별 시계열 ✅ / 티켓 드릴다운은 `taskId` 83% NULL |
| Q6 | **오케가 워커보다 많이 먹나?** | ❌ **지금 0건** | §1.3 — 수집부터 |
| Q7 | 누가 뭘 했나(감사) | ✅ | Firestore `audit_logs` (토큰 없음) |
| Q8 | 이 사람 비용이 이번 달 청구서 어디에 붙나 | ❌ **원장 없음** | §1.5 — 좌석 모델 부재 |
| Q9 | 캐시 히트로 얼마 아꼈나 | ✅ | `cacheReadTokens/cacheWriteTokens` (계정축에만 존재) |

**Q6 과 Q8 은 "없는 데이터" 다. v1 화면은 이 두 칸을 0 으로 그리지 않고
"미수집 · 사유" 로 그린다.** 0 으로 그리면 오너가 "오케는 공짜네" 로 읽는다 —
6월 실측으로는 전체의 29% 였다.

---

## 3. 데이터소스 배선

```
                        ┌──────────────────────────────────────────┐
  오너 브라우저          │  marblo-web  /[locale]/team/[projectId]  │
  (Firebase Auth)       │  · Usage 탭   · Audit 탭                  │
                        └──────────────────┬───────────────────────┘
                                httpsCallable (context.auth.uid 만 신뢰)
                                           │
   ┌───────────────────────────────────────▼────────────────────────────────┐
   │  Cloud Functions (v3/functions/src/teamUsage.ts + index.ts 콜러블)      │
   │                                                                        │
   │  ① 게이트      resolveTeamUsageGate(env)   → 닫히면 0행 + 사유, 끝      │
   │  ② 테넌트 해석 Admin SDK: uid → 내가 owner/admin 인 projectId 집합      │
   │                (클라가 준 projectId 는 **교집합 필터**로만 쓴다)        │
   │  ③ 캐시 조회   Firestore `teamUsageCache` (서버 전용 티어)             │
   │  ④ 미스 시     BQ 질의 — 아래 새 뷰만                                  │
   │  ⑤ 라벨 조립   uid → memberKey(가명) + displayName (응답에만, 로그 X)   │
   └───────────┬─────────────────────────────────────┬──────────────────────┘
               │                                     │
   ┌───────────▼──────────────┐        ┌─────────────▼────────────────┐
   │  BigQuery (계정축)        │        │  Firestore                    │
   │  marblo_telemetry         │        │  projects / memberRoles       │
   │   └ v_team_usage_daily ★새 뷰      │  users (표시명)                │
   │      SELECT FROM cost_logs│        │  audit_logs (감사 탭)         │
   │      원본 표 수정 없음    │        │  teamUsageCache ★서버 전용    │
   └───────────────────────────┘        └───────────────────────────────┘

   ✗ 절대 안 읽는 것: events · task_outcomes · agent_heartbeats ·
     analytics_user_daily · analytics_install_profile · analytics_identity ·
     marblo_identity.analytics_user_install (데이터셋 이름부터 등장 금지)
```

### 3.1 새 뷰 — `marblo_telemetry.v_team_usage_daily`

★**원본 `cost_logs` 는 읽기만 한다. 스키마 변경·파티셔닝·삭제 전부 이 티켓 범위 밖이다.**

```sql
CREATE OR REPLACE VIEW `marblo-2253d.marblo_telemetry.v_team_usage_daily`
OPTIONS(description=
  "팀 오버뷰 전용 계정축 뷰. cost_logs 를 (day, project, user, model, actor_kind) 로 접는다. "
  "★계정축이다 — install_key/ga_key/client_id 계열 컬럼은 자리조차 없다(FORBIDDEN_ON_ACCOUNT_AXIS). "
  "★익명축(events/task_outcomes/agent_heartbeats/analytics_user_daily) 과 조인하지 마라. "
  "★링크축(marblo_identity.analytics_user_install) 은 이 뷰와 무관하다 — 계정 uid 가 원장에 이미 있어 "
  "설치를 거칠 이유가 없다. 조인하는 순간 사람 축 게이트를 우회하는 것이다.")
AS
SELECT
  DATE(timestamp)                       AS day,          -- UTC. analytics_user_daily 와 같은 규약
  projectId                             AS project_id,
  userId                                AS account_uid,  -- ★원장에 이미 있는 값. 뷰가 새로 만드는 게 아니다
  model,
  IF(STARTS_WITH(agentId, 'orchestrator-'), 'orchestrator', 'worker') AS actor_kind,
  COUNT(*)                              AS rows_n,
  COUNTIF(totalCost = 0 AND inputTokens = 0 AND outputTokens = 0) AS rows_zero,
  SUM(inputTokens)                      AS input_tokens,
  SUM(outputTokens)                     AS output_tokens,
  SUM(cacheReadTokens)                  AS cache_read_tokens,
  SUM(cacheWriteTokens)                 AS cache_write_tokens,
  SUM(totalCost)                        AS cost_usd,
  COUNT(DISTINCT agentId)               AS distinct_agents,
  COUNT(DISTINCT NULLIF(taskId, ''))    AS distinct_tasks,
  COUNTIF(taskId IS NULL OR taskId = '') AS rows_without_task
FROM `marblo-2253d.marblo_telemetry.cost_logs`
WHERE projectId IS NOT NULL AND projectId != ''
GROUP BY day, project_id, account_uid, model, actor_kind;
```

설계 주석:

- `actor_kind` 는 **새 컬럼이 아니라 기존 `agentId` 접두 규약의 파생**이다.
  판정식은 코드의 정본(`v3/electron/mcp-server/context.ts:46 isOrchestratorAgentId`)과 동일하다.
  → `cost_logs` 스키마를 손대지 않고 오케 축을 열 수 있다. (원본 불변 제약 준수)
- `rows_zero` 를 같이 낸다 — §1.4-4 의 무의미 행 비율을 화면이 스스로 말할 수 있게.
- `rows_without_task` 를 같이 낸다 — Q5 드릴다운의 신뢰구간을 화면이 스스로 말할 수 있게.
- `projectId` 결측 행은 **뷰에서 제외**한다. 그 행은 어느 테넌트 것인지 모르므로 팀에 귀속할 수 없다.
  결측 규모는 별도 카운트 전용 뷰(`v_team_usage_unattributed`, `account_uid` × `day` × 행 수만,
  **금액·토큰 없음**)로 내서 화면이 "이 화면은 전부가 아니다" 를 말하게 한다.
  금액을 빼는 이유: 결측 행은 오너가 속하지 않은 프로젝트의 지출일 수 있다(§5.3 크로스테넌트).

### 3.2 감사 탭

새 저장소를 만들지 않는다. Firestore `audit_logs` 를 Admin SDK 로 읽고
**`projectAudit.ts` 의 기존 매퍼를 그대로 재사용**한다. 그 매퍼가 이미 강제하는 규율:

- `params` 는 절대 응답에 안 넣는다(자격증명 혼입 가능 + 원장 불변).
- 자유 텍스트는 `TEXT_MAX=500` 절단.
- `folderPath`/`folderPaths` 는 응답에서 제거.

★그래서 감사 탭은 **룰 표면을 0 만큼 늘린다** — 클라가 `audit_logs` 를 직접 쿼리하지 않는다
(`projectAudit.ts` 상단이 설명하는 #406/#428 실패 모드를 반복하지 않는다).

---

## 4. 축 오염이 불가능한 이유

"조심하겠다" 가 아니라 **기계가 대신 읽는다.** 네 겹이다.

### 4.1 구조적 — 다리를 놓을 컬럼이 존재하지 않는다

이 화면이 읽는 표는 `cost_logs` **하나**다. 그 스키마에는
`install_key` · `install_id` · `client_id` · `ga_key` · `install_label` 이 **컬럼 자리조차 없다**(§1.1 실측).
`FORBIDDEN_ON_ACCOUNT_AXIS` 의 전 항목이 구조적으로 부재다.
반대 방향도 같다 — 익명축에 `user_key`/`cost_usd`/`cache_*` 를 넣으려는 시도는
`FORBIDDEN_ON_ANONYMOUS_AXIS` 가 이미 막고, 이 설계는 익명 표에 **쓰지 않는다.**

### 4.2 기계적 — 새 뷰를 기존 검사에 등록한다

`analyticsProfiles.ts`:

```ts
export const ACCOUNT_AXIS_TABLES: ReadonlyArray<string> = [
  TABLE_ACCOUNT_PROFILE,
  VIEW_TEAM_USAGE_DAILY,        // ← 추가
  VIEW_TEAM_USAGE_UNATTRIBUTED, // ← 추가
];
```

그러면 `assertAxisPurity()` 가 이 뷰의 컬럼 목록을 `FORBIDDEN_ON_ACCOUNT_AXIS` 로 검사하고,
`analyticsProfiles.test.ts` 가 그 검사를 CI 에서 돌린다. **누가 나중에 뷰에
`install_key` 를 더하면 테스트가 깨진다.** 주석이 아니라 빨간불이다.

### 4.3 소스 스캔 — 금지 표 이름이 등장하면 실패

`v3/tests/unit/project-scoped-query-guard.test.ts` 가 이미 쓰는 규약을 그대로 복제한다.
새 가드(`team-usage-axis-guard.test.ts`)가 `v3/functions/src/teamUsage.ts` 소스를 읽어
아래 문자열이 하나라도 나오면 실패시킨다:

```
marblo_identity · analytics_user_install · v_person_since_link · v_person_all_time
events · task_outcomes · agent_heartbeats · analytics_user_daily · analytics_install_profile
```

★즉 **팀 오버뷰 코드에 `marblo_identity` 라는 데이터셋 이름이 등장하는 것 자체가 설계 위반**이다.

### 4.4 개념적 — 이 화면은 사람 축을 **필요로 하지 않는다**

사람 축(`analytics_user_install`)이 존재하는 이유는 **익명 설치 기록을 사람에게 되짚기 위해서**다.
팀 오버뷰가 세는 것은 처음부터 계정 원장(`cost_logs.userId`)이고, 계정 uid 가 그 행에 이미 있다.
설치를 거칠 이유가 **원리적으로** 없다.

★그러므로 게이트 우회 시나리오는 딱 하나뿐이다:
"오케 사용량이 없네 → `agent_heartbeats`/`events` 로 오케 활동을 추정해서 채우자."
**금지한다.** 그건 익명축 행을 계정에 귀속시키는 것이고, `PERSON_AXIS_EFFECTIVE_FROM`
게이트가 정확히 그 행위를 막으려고 있는 것이다. 오케 축의 정답은 추정이 아니라 **수집**이다(§10-T5).

### 4.5 링크축 게이트를 우회하지 않는다는 증명

| 게이트가 지키는 것 | 이 설계가 하는 일 | 우회 여부 |
| --- | --- | --- |
| 익명 이벤트 → 사람 귀속 | 안 함 (익명 표를 안 읽음) | 해당 없음 |
| `analytics_user_install` 조회 | 안 함 (§4.3 가드가 이름 등장을 막음) | 해당 없음 |
| 소급 상한(`effectiveFrom`) | 계정 원장은 원래 계정축이라 소급 개념이 없음 | 해당 없음 |
| **"기준 라벨 없는 숫자 금지"** | **같은 규약을 새 게이트로 복제**(§5.1) | **준수** |

마지막 줄이 핵심이다. 우회 여부만 따지면 이 화면은 게이트 바깥이지만,
게이트가 **왜** 있는지(고지 없는 목적 확대를 막으려고)를 따르면 **똑같은 장치가 필요하다.**

### 4.6 ★가명 공간 분리 — 응답이 링크표의 이름 사전이 되지 않게

§4.1~4.5 는 전부 "이 화면이 익명축을 **읽지** 않는다" 는 얘기다. 읽지 않아도 오염되는
경로가 하나 남는다: **응답이 내보내는 가명이 다른 축의 조인 키와 같으면**, 조인은
이 화면 밖에서 성립한다. 그 경로를 §5.4 가 `kind='teamMember'` 로 끊는다.

기계 검사(§4.3 가드에 함께 넣는다):

```
// team-usage-axis-guard.test.ts
// 1) 같은 uid 로 만든 memberKey 와 personAxis user_key 가 서로 달라야 한다
// 2) memberKey 접두는 'tm_' 이어야 한다 ('us_' 면 실패)
// 3) teamUsage.ts 소스에 "user:" 리터럴이 등장하면 실패
```

★규칙 한 줄: **바깥으로 나가는 가명은 그 화면 전용 공간이다. 축을 넘나드는 가명은 만들지 않는다.**

---

## 5. 권한 경계 — 설계의 핵심

### 5.1 게이트: `TEAM_USAGE_EFFECTIVE_FROM` (`personAxis.ts` 와 같은 모양)

```ts
// v3/functions/src/teamUsage.ts  — 순수 로직, BQ/Firebase 무의존, node --test
export const TEAM_USAGE_EFFECTIVE_FROM_ENV = "TEAM_USAGE_EFFECTIVE_FROM";

export const TEAM_USAGE_EFFECTIVE_FROM_UNSET_NOTE =
  "TEAM_USAGE_EFFECTIVE_FROM 미설정 — 팀 사용량 열람이 닫혀 있다. 배포된 처리방침은 " +
  "사용량·비용 기록의 목적을 '구독·정산 확인'(본인)으로만 고지하고 있고, 팀 오너가 " +
  "개별 멤버의 사용량을 열람한다는 고지는 아직 없다(privacyContent.tsx:158 / EN:277). " +
  "고지 개정과 인앱 통지가 배포된 뒤 그 발효일을 이 키에 넣어라.";

export function resolveTeamUsageGate(env = process.env): TeamUsageGate;
```

`personAxis.resolvePersonAxisGate` 와 **동일 계약**:

- unset → `{ open: false, reasonCode: "unset", reason, effectiveFrom: null }`
- 'YYYY-MM-DD' 아님 → `{ open: false, reasonCode: "invalid", ... }`
- **던지지 않는다.** 닫힘은 정상 상태다.
- 닫혔으면 **질의 자체를 하지 않고** 0행 + `reason` 을 돌려준다.
- **코드 기본값을 두지 않는다.** 기본값이 있으면 "어느 환경이 열려 있는지" 를 env 가 아니라
  배포 시점이 정하게 되고, 되돌릴 때 코드 배포가 필요해진다.
- ★**"전체를 보여준다" 는 절대 금지.** env 를 빠뜨린 환경에서 조용히 열리는 길이다.

그리고 셋 중 하나를 고르는 이유도 그대로다: 예외를 던지면 팀 탭 전체가 죽고,
전체를 보여주면 고지 없이 열리고, **0행 + 사유면 화면이 왜 비었는지 말한다.**

경계는 `day >= DATE(@effectiveFrom)` **포함**(`personAxis` 의 `buildOpenGateSql` 과 같은 경계).

### 5.2 누가 무엇을 보는가

| 역할 | 팀 총계 | 멤버별 분해 | 본인 것 | 감사 로그 |
| --- | --- | --- | --- | --- |
| **owner** | ✅ | ✅ (게이트 open 시) | ✅ | ✅ |
| **admin** | ✅ | ✅ (게이트 open 시) | ✅ | ✅ |
| **member** | ❌ | ❌ | ✅ | ✅(기존 룰 그대로) |
| **viewer** | ❌ | ❌ | ✅ | ✅(기존 룰 그대로) |

★**멤버는 팀 총계도 못 본다.** "예산 감각" 을 이유로 총계를 열자는 안이 자연스럽지만 틀렸다:

> **차분 공격.** 2인 팀에서 `팀_총계 − 내_사용량 = 상대방 사용량` 이다. 정확히.
> 그리고 §1.2 실측상 **우리의 유일한 다중 멤버 프로젝트가 정확히 2인**이다.
> 총계를 여는 순간 "멤버는 남의 사용량을 못 본다" 는 약속이 산술로 깨진다.
> 3인 이상이면 부분 노출이지만, 규칙에 "N명 이상일 때만" 을 넣으면 팀이 줄어들 때
> 조용히 새는 규칙이 된다. → **멤버 스코프는 self 뿐.** 단순하고 안 샌다.

역할 판정은 UI 게이트와 같은 정본을 쓴다: `isProjectOwner(projectId)` 또는
`memberRoles/{projectId}_{uid}.role == 'admin'` (`firestore.rules` 의 `isAdminOrOwner` 와 동일 판정,
`ROLE_PERMISSIONS` 의 `manage_members` 보유자와 일치).

**본인 조회(self)는 게이트 밖이다.** 배포된 처리방침이 이미 "본인 정산 확인" 목적을 고지하고 있고,
`getCostSummary`/`getCostLogs` 로 이미 제공 중인 기능이다. 새 목적이 아니다.
→ 게이트가 닫혀 있어도 **self 스코프는 정상 동작한다.** 화면이 절반은 산다.

### 5.3 크로스테넌트 — 유출 0 을 만드는 세 가지

1. **클라가 준 `projectId` 를 권한 근거로 쓰지 않는다.**
   서버가 `context.auth.uid` 로 Admin SDK 를 조회해 "내가 owner/admin 인 projectId 집합" 을
   만들고, 클라 입력은 그 집합과의 **교집합 필터**로만 쓴다. 확장은 불가능하다.

   ```
   allowed = resolveOwnedProjectIds(uid)            // 서버가 만든다
   scope   = requested ? requested ∩ allowed : allowed
   if (scope.length === 0) → 0행 + "권한 없음" (존재 여부를 말하지 않는다)
   ```

2. **★헤더를 신뢰하지 않는다.** `X-Plan` / `X-User-Id` 같은 클라 제어 헤더는 읽지 않는다
   (보안티켓 `tOaqZUfQ` 원칙). `onCall` 의 `context.auth` 만이 신원의 출처다.
   `context.auth == null` → `HttpsError('unauthenticated')`.

3. **`projectId` 결측 행은 팀 집계에서 제외한다.** 어느 테넌트 것인지 모르는 행을
   "내 팀 것" 으로 세면 그게 곧 크로스테넌트다. 규모만 카운트로 노출한다(§3.1).

### 5.4 프라이버시 — 원시 uid·이메일은 어디에도 안 남는다

| 값 | BQ 뷰 | 캐시 doc | 응답 | 로그 |
| --- | --- | --- | --- | --- |
| 원시 uid | 원장에 이미 존재(불변) · **뷰가 새로 만들지 않음** | ❌ | ❌ | ❌ |
| 이메일 | ❌ | ❌ | ❌ | ❌ |
| `memberKey` (가명) | — | ✅ | ✅ | ✅ (가명이므로) |
| `displayName` | ❌ | ❌ | ✅ (owner/admin 응답 본문에만) | ❌ |

- `memberKey = 'tm_' + HMAC(ANALYTICS_ID_SALT, 'teamMember:' + uid).slice(0,24)`.
  `analyticsPseudonym` 의 **HMAC 유틸은 재사용하되 `kind` 는 새로 뗀다**(`teamMember`).

  ★**여기서 `user_key`(`us_` + HMAC(salt, `'user:'` + uid))를 재사용하면 안 된다.**
  이 응답은 가명 옆에 `displayName` 을 싣는다. 그런데 `user_key` 는 링크축
  `marblo_identity.analytics_user_install` 의 조인 키다. 두 가명이 같으면

  ```
  (팀 응답) user_key → displayName        ⨝    (링크표) user_key → install_key
  ⇒  install_key → 사람 이름
  ```

  즉 **팀 오버뷰가 링크표의 이름 사전이 된다.** 익명 설치 기록이 이름으로 되짚어진다 —
  `PERSON_AXIS_EFFECTIVE_FROM` 게이트가 막으려던 바로 그 결과가 게이트를 건드리지도 않고
  성립한다. `kind` 를 달리하면 같은 솔트라도 다이제스트가 달라져 조인이 성립하지 않는다.
  (§4.6 에 기계 검사로도 박는다.)
- ★**HMAC 을 SQL 에 넣지 않는다.** BQ 는 쿼리 본문을 job 히스토리에 수개월 보관한다
  (`personAxis.ts` 상단 규율, #915 계승). 가명화는 **전부 Node 안**에서, BQ 결과를 받은 뒤에 한다.
  그래서 §3.1 의 뷰는 `account_uid` 를 그대로 낸다 — 그 값은 원장에 이미 있고
  BQ 밖으로 나가는 것은 가명뿐이다.
- `displayName` 이 응답에 실리는 것은 **새 노출이 아니다.** `firestore.rules:100`
  의 `match /users/{userId} { allow read: if isAuthenticated() }` 로 이미
  로그인한 누구나 읽을 수 있고, 오너는 TeamManagement 화면에서 멤버 이름을 이미 본다.
  새로 노출되는 것은 **이름 옆의 숫자**이고, 그 숫자가 §5.1 게이트의 대상이다.
- 캐시 doc 에는 `displayName` 을 넣지 않는다 — 캐시는 숫자만, 라벨은 매 응답에 조립.
  이름이 바뀌면 캐시가 낡은 이름을 붙드는 문제도 같이 없어진다.

### 5.5 `firestore.rules` — 새 클라이언트 필드 0

#1096 이 `projects` 를 필드별 allowlist 로 좁혔다. 이 설계는 그 목록을 **한 글자도 늘리지 않는다.**

- 캐시는 새 컬렉션 `teamUsageCache/{projectId}__{windowKey}` 에 둔다.

  ```
  // ★서버 전용 티어. Admin SDK 는 룰을 우회하므로 서버는 그대로 읽고 쓴다.
  //   클라가 이걸 직접 읽으면 콜러블의 역할 게이트(§5.2)를 통째로 우회한다.
  match /teamUsageCache/{docId} {
    allow read, write: if false;
  }
  ```

- `projects` · `memberRoles` · `users` 는 **읽기만** 한다. 새 필드를 심지 않는다.
- 클라는 `cost_logs`/`audit_logs`/캐시 어느 것도 직접 쿼리하지 않는다 → **룰 표면 증가 0.**

---

## 6. 캐시 전략

### 6.1 먼저, 정직한 비용 산정

현재 `cost_logs` = 50.3 MB, 파티션 없음 → **1회 풀스캔 ≈ 50 MB**.
온디맨드 $5/TiB 기준 **≈ $0.00024/쿼리**. 하루 1,000회 로드해도 월 $7 수준이다.

★**그러므로 "BQ 비용 때문에 캐시가 필요하다" 는 지금 사실이 아니다.** 캐시가 필요한 진짜 이유:

1. **지연.** BQ 콜드 쿼리는 1.5~4초다. 탭 전환마다 이걸 기다리면 화면이 못 쓸 물건이 된다.
2. **성장.** 행이 월 ~240k 씩 는다(2026-08 실측). 팀 100개 × 10명이 붙으면 표가 수십 GB 가 되고,
   그때 위 산수가 뒤집힌다. 캐시를 나중에 넣으면 그때는 이미 늦다.
3. **동시성.** 오너 여러 명이 같은 대시보드를 새로고침하면 같은 쿼리가 N 번 돈다.

이 구분을 문서에 박아 두는 이유: 다음 사람이 "캐시 왜 있지" 를 물을 때
**"비용" 이라고 잘못 배우면 표가 커진 뒤 캐시를 걷어낼 수도 있어서**다.

### 6.2 4계층 — 위에서부터 싼 순서

**L0. BQ 자체 결과 캐시 (무료, 24시간) — ★지금 꺼져 있다**

기존 어드민 쿼리는 전부 이 모양이다:

```sql
WHERE timestamp >= TIMESTAMP_SUB(CURRENT_TIMESTAMP(), INTERVAL @days DAY)
```

`CURRENT_TIMESTAMP()` 는 비결정적 함수라 **BigQuery 가 결과를 캐시하지 않는다.**
같은 대시보드를 두 번 열면 두 번 다 과금된다.

→ 팀 오버뷰는 **경계를 파라미터로 받는다:**

```sql
WHERE day >= @fromDay AND day < @toDayExclusive      -- DATE 파라미터, 호출측이 계산
```

`@fromDay`/`@toDayExclusive` 를 **UTC 일 단위로 절삭**해서 넣으면 같은 날 같은 창의 쿼리가
문자 그대로 동일해지고, BQ 결과 캐시가 **공짜로** 먹는다. L1~L2 가 다 미스여도 이게 받쳐 준다.
(이 한 줄이 §6.1 의 지연 문제 절반을 무료로 해결한다.)

**L1. 인스턴스 메모리 (TTL 60초)**

`Map<cacheKey, {payload, expiresAt}>` — 같은 인스턴스가 처리하는 연속 요청(탭 전환, 차트 4개가
같은 데이터를 쓰는 경우)을 흡수. 인스턴스 churn 에 사라지므로 **보조 수단**이다.

**L2. Firestore 캐시 doc (TTL 15분) — ★v1 의 본체**

```
teamUsageCache/{projectId}__{windowKey}      // 서버 전용 티어(§5.5)
{
  schemaVersion: 1,          // 뷰/집계 형태가 바뀌면 올린다 → 구 캐시 자동 무효
  gateEffectiveFrom: string, // 게이트 값이 바뀌면 자동 무효
  windowKey: "d30@2026-08-21",
  generatedAt: Timestamp,
  expiresAt: Timestamp,      // TTL 정책으로 자동 삭제
  rows: [...]                // 숫자만. memberKey 는 있고 displayName 은 없다(§5.4)
}
```

- 인스턴스가 죽어도 살아남고, 오너 여러 명이 공유한다.
- `windowKey` 에 **UTC 일자를 포함**해서 날짜가 바뀌면 자동으로 새 키가 된다.
- ★캐시 키에 **`allowed projectId 집합`이 아니라 단일 `projectId`** 를 쓴다.
  집합을 키로 쓰면 권한이 다른 두 사람이 같은 캐시를 나눠 쓸 위험이 생긴다.
  프로젝트 단위로 캐시하고, 여러 프로젝트는 **응답 조립 시 합산**한다.

**L3. 스케줄 롤업 → 작은 집계표 (아직 아님)**

승격 조건을 숫자로 못박는다 — "느려지면" 은 판정 불가다:

> 아래 중 **하나라도** 충족하면 롤업 티켓을 연다:
> - 단일 팀-창 쿼리의 스캔 바이트가 **1 GiB** 를 넘는다
> - 캐시 미스 경로 p95 가 **3초** 를 넘는다
> - `cost_logs` 행이 **1,000만** 을 넘는다 (현재 34만)

**L4. Postgres — 지금은 금지**

대규모 저지연 인터랙티브(임의 필터 조합 · 초 단위 갱신)가 실제 요구로 확인될 때만.
내부 관리자 뷰에 PG 를 넣는 것은 원장을 두 곳으로 만드는 일이다.

### 6.3 무효화 — 시간 기반만

★이벤트 기반 무효화를 **하지 않는다.** `cost_logs` 는 스트리밍 insert 이고 지연 도착이 있어서
"마지막 쓰기" 시점을 신뢰할 수 없다. 대신:

- TTL 만료(15분) + `schemaVersion` 변경 + `gateEffectiveFrom` 변경 → 자동 무효.
- **수동 새로고침**: owner/admin 만, 프로젝트당 **5분에 1회** 레이트리밋, 캐시를 우회하고 재적재.
- 화면은 항상 **`generatedAt` 기준 "N분 전 기준"** 을 헤더에 그린다. 신선도를 숨기지 않는다.
- 오늘 구간은 정의상 미완이다 → **오늘 막대에 `진행 중` 배지**를 붙이고 전일 대비 계산에서 뺀다.

---

## 7. 응답 계약 (스케치) — #1090 규약 계승

`docs/analytics-admin-callables-api.md` 의 공통 규약을 그대로 따른다:
`rangeDays` 에코 · `generatedAt` ISO8601 · 빈 구간은 빈 배열/0 안전 반환 · 개별 row 미노출.

```ts
// getTeamUsageSummary({ projectIds?: string[], days?: number, scope?: "team" | "self" })
{
  rangeDays: number;
  generatedAt: string;
  cache: { hit: boolean; ageSeconds: number; ttlSeconds: number };

  // ★ personAxis 봉투와 같은 계약(§5.1). 프론트는 옵셔널로 읽는다.
  teamUsage: {
    state: "disabled" | "empty" | "partial" | "complete";
    disabledReason: string | null;    // disabled 일 때만. 화면이 이 문장을 그대로 그린다
    effectiveFrom: string | null;     // 게이트가 닫혔으면 null
    basis: "account_ledger";          // ★라벨 없는 숫자 금지 — 항상 실린다
    scope: "team" | "self";
    projectsInScope: number;
  } | null;

  // ★ 오케 축 — 0 이 아니라 상태다(§2 Q6)
  orchestratorAxis: {
    state: "not_collected" | "collecting";
    reason: string | null;            // not_collected 일 때 화면이 그대로 그린다
    collectingSince: string | null;   // 수집 티켓 배포일. 그 이전 구간은 그리지 않는다
    legacySegment: { from: "2026-05-05"; to: "2026-06-22" } | null;
  };

  totals: { costUsd, inputTokens, outputTokens, cacheReadTokens, cacheWriteTokens };
  byDay:     Array<{ day, costUsd, tokens, partial: boolean }>;
  byMember:  Array<{ memberKey, displayName, costUsd, tokens, share }>;  // owner/admin only
                                                    // memberKey = tm_… (팀 전용 가명 공간, §4.6)
  byProject: Array<{ projectId, projectName, costUsd, tokens }>;
  byModel:   Array<{ model, costUsd, tokens }>;
  byActorKind: Array<{ actorKind: "worker" | "orchestrator", costUsd, tokens }>;

  // ★ "이 화면은 전부가 아니다"
  coverage: {
    rowsZeroPct: number;              // 무의미 행 비율(§1.4-4)
    rowsWithoutTaskPct: number;       // 티켓 드릴다운 신뢰도(§1.4-2)
    unattributedRows: number;         // projectId 결측 — 행 수만, 금액 없음(§3.1)
    membersWithNoRows: number;        // ★"안 썼다"와 "안 보낸다"를 구분 못 함(§1.4-5)
    telemetryOptOutNote: string;      // 화면이 그대로 그리는 문장
  };
}
```

**화면 규칙 (#1090 §10.4 와 같은 취지, 여섯 줄)**

| # | 규칙 |
| --- | --- |
| 1 | `state === "disabled"` → 숫자를 아예 안 그린다. `disabledReason` 문장만 그린다 |
| 2 | `basis` 를 배지로 항상 그린다 — **라벨 없는 사용량 숫자 금지** |
| 3 | `orchestratorAxis.state === "not_collected"` → 오케 칸은 **빈 칸 + 사유**. 0 으로 안 그린다 |
| 4 | 멤버 순위 옆에 항상 `telemetryOptOutNote` — "0 = 안 씀이 아니라 안 보냄일 수 있음" |
| 5 | `generatedAt` 기준 "N분 전" 을 헤더에. 오늘 막대엔 `진행 중` 배지 |
| 6 | 금액은 **"사용량 환산 비용(추정)"**. **"청구액" 이라는 단어를 쓰지 않는다**(§1.5) |

---

## 8. MVP 슬라이스

**v1 (게이트 닫힌 채로 배포 가능 — 이게 요점이다)**

- `getTeamUsageSummary` 콜러블 + `resolveTeamUsageGate` + `v_team_usage_daily` 뷰
- self 스코프 동작(게이트 밖) / team 스코프는 `disabled` + 사유
- 감사 탭(기존 `projectAudit` 매퍼 재사용)
- Firestore L2 캐시 + L0 결정적 경계

**v2 (고지 개정 배포 후 env 투입)**

- `TEAM_USAGE_EFFECTIVE_FROM` 설정 → team 스코프 개통
- 멤버별/프로젝트별/모델별 분해 + 일별 시계열

**v3**

- 오케 수집 배선(§10-T5) → `orchestratorAxis.state = "collecting"`
- 스파이크 드릴다운(선행: `taskId` 결측 개선)

---

## 9. 명시적 답변 — 기존 admin 확장인가 net-new 인가

**net-new 다.** 근거 셋:

1. **주체가 다르다.** 기존 `/admin` 은 `requireAdmin` = 단일 `ADMIN_UID` 대조다(§1.6).
   팀 오너는 그 uid 가 아니다. 게이트 함수를 새로 써야 한다.
2. **스코프가 다르다.** 기존 어드민 콜러블은 **전 테넌트 집계**다.
   팀 오버뷰는 **한 테넌트 집합**이고 그 집합을 서버가 uid 로 도출해야 한다.
3. **축이 다르다.** 기존 어드민 분석의 주력은 익명축(`events`/설치 프로필)이고
   운영자 제외까지 익명축 규율에 묶여 있다. 팀 오버뷰는 **순수 계정축**이다.

★단 **규약은 전부 계승한다** — 파라미터 검증(`days` 상한 365), `BQ_LOCATION="US"` 고정,
빈 구간 안전 반환, `generatedAt` 에코, 봉투 패턴, 게이트 0행+사유. 새 규약을 만들지 않는다.

**범위 밖(별건 티켓 필요)**
- 청구 연결(좌석 모델 부재, §1.5) · `cost_logs` 파티셔닝(원본 표 변경 금지) ·
  Sentry 연동 · 웹↔앱 조인

---

## 10. 구현 티켓 분해

| # | 티켓 | 범위 | 선행 |
| --- | --- | --- | --- |
| **T1** | `teamUsage.ts` 순수 로직 | `resolveTeamUsageGate` · 창 계산 · 집계 접기 · 가명화 조립. BQ/Firebase 무의존, `node --test` | — |
| **T2** | BQ 뷰 2개 생성 | `v_team_usage_daily` · `v_team_usage_unattributed`. **CREATE VIEW 만. 원본 표 무변경.** 프로비저닝 스크립트는 `provision-person-axis.ts` 규약 계승 | T1 |
| **T3** | 축 순수성 가드 | `ACCOUNT_AXIS_TABLES` 에 뷰 등록 + `team-usage-axis-guard.test.ts` (소스 스캔 §4.3 + 가명 공간 분리 §4.6) | T2 |
| **T4** | `getTeamUsageSummary` 콜러블 | 테넌트 해석 · 역할 게이트 · L1/L2 캐시 · 봉투 조립 | T1,T2 |
| **T5** | ★**오케 사용량 수집 배선** | `OrchestratorManager` 세션 초크포인트에서 `costTracker.trackSession()` 등록. agentId = 기존 `orchestrator-<kind>-<projectId>` 규약(`isOrchestratorAgentId` 정본). **cost_logs 스키마 무변경** | — (병렬 가능) |
| **T6** | `firestore.rules` + TTL | `teamUsageCache` 서버 전용 티어(`read, write: if false`) + Firestore TTL 정책. 룰 테스트 추가 | T4 |
| **T7** | 델타 0 행 적재 중단 | `useCostWriter` 가 zero-delta 를 안 보내게. 원장 절반이 무의미 행(§1.4-4) | — (독립) |
| **T8** | `sessionId` 배선 | payload 에 `sessionId` 를 싣는다. 지금 100% NULL 인 "ML-ready 컬럼"(§1.4-1) | — (독립) |
| **T9** | marblo-web 팀 오버뷰 UI | Usage/Audit 탭. §7 화면 규칙 6줄 강제 | T4 |
| **T10** | 처리방침 개정 + 인앱 통지 | ★**T4 가 아니라 이 티켓이 게이트를 여는 근거다.** 개정·통지 배포 후에만 `TEAM_USAGE_EFFECTIVE_FROM` 투입 | 법무/사장님 결정 |

★**T10 없이 T4 를 배포해도 안전하다** — 게이트가 닫힌 채 태어나기 때문이다. 그게 §5.1 설계의 목적이다.

---

## 11. eng-review 에 묻고 싶은 것

1. **T5 의 agentId 규약.** 오케를 `orchestrator-<kind>-<projectId>` 로 찍으면 과거
   2026-05~06 legacy 행(14개 중 4개만 규약 일치)과 같은 네임스페이스를 쓴다.
   `collectingSince` 로 구간을 가르는 것으로 충분한가, 아니면 새 접두가 나은가?
2. **멤버가 팀 총계를 못 보는 것(§5.2).** 차분 공격 논거는 확실하지만
   제품상 "예산 감각" 요구가 이길 수도 있다. 이긴다면 **2인 팀에서는 총계를 숨기는**
   예외를 넣어야 하고, 그 예외는 팀이 줄어들 때 조용히 새는 규칙이 된다. 판단 필요.
3. **`cost_logs` 파티셔닝.** L3 승격 조건(§6.2)을 만나면 파티션이 정답인데,
   그건 원본 표 재작성이라 이 티켓이 금지당한 행위다. 별건 티켓 + 명시 승인 경로가 맞나?
