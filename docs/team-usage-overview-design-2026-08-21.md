# 팀 오버뷰 설계 — 오너가 보는 멤버별·오케별 토큰 사용량

작성일: 2026-08-21 · 티켓 `RpscJs0sc8IKFgdpSKKj` · 역할 backend
상태: **구현됨(2026-08-30 정정)** — 서버 `v3/functions/src/teamUsage.ts` + `index.ts getTeamUsageSummary` · 화면 `marblo-web/src/app/[locale]/team/*`(TeamUsageView · TeamAuditView · 계약/테스트). ★단 **게이트는 닫혀 있고 뷰는 적재 전**이다: 배포 env 에 `TEAM_USAGE_EFFECTIVE_FROM` 없음(08-29 13:12Z 배포 기준) · BQ `v_team_usage_daily`/`v_team_usage_unattributed` 미프로비저닝(08-30 실측). 지금 팀 스코프를 열면 `disabled` + 사유 문장만 보인다. 살아있음 판정표: `docs/team-analytics-liveness-audit-2026-08-30.md`
(이전 상태 문구: "설계 doc (구현 없음) → eng-review 후 §10 구현 티켓으로 분해")

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

★**콜러블 이름은 `getTeamProjectAudit` 로 확정됐다**(티켓 `IcjPf2SEs0ORUGLZgCHS`).
매퍼 재사용은 그대로지만, 매퍼 결과를 **그대로 내려보내지 않는다** — 팀 축은 운영자 축보다
좁아야 한다. 경계·응답 계약·근거는 전부 **§12** 에 있다.
★§12 를 읽지 않고 이 응답에 필드를 더하지 마라.

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
| **owner** | ✅ | ✅ (게이트 open 시) | ✅ | ✅ 프로젝트 전체 (§12) |
| **admin** | ✅ | ✅ (게이트 open 시) | ✅ | ✅ 프로젝트 전체 (§12) |
| **member** | ❌ | ❌ | ✅ | ✅ **본인 것만** (§12.1) |
| **viewer** | ❌ | ❌ | ✅ | ✅ **본인 것만** (§12.1) |

★감사 열의 ✅ 는 "원장 전부" 가 **아니다.** `getTeamProjectAudit` 은 허용목록을 통과한
**프로젝트 사건**만 내고 코드·프롬프트·자유 텍스트·금액은 내지 않는다 — 무엇을 빼는지와
그 근거는 **§12.3** 이다. 감사 탭은 §5.1 게이트 **밖**이며, 그것이 안전한 이유는 §12.4 다.

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
| **T11** | ★`getTeamProjectAudit` 콜러블(감사 탭) | `teamAudit.ts` 순수 로직 + 팀 역할 축(★`requireAdmin` 재사용 금지) + 툴 허용목록 + 키셋 페이징 + `node --test`. **경계와 근거는 §12** | — (T1~T4 와 병렬) |
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

---

## 12. 감사 탭 경계 — `getTeamProjectAudit`

티켓 `IcjPf2SEs0ORUGLZgCHS` 의 산출물. §3.2 가 "매퍼를 재사용한다" 까지만 정했고,
**무엇을 보여주고 무엇을 안 보여주는지**는 여기서 정한다.
구현: `v3/functions/src/teamAudit.ts`(순수 로직 + `node --test`) ·
`index.ts` 의 `getTeamProjectAudit`(역할 확인 + Firestore fetch).

### 12.0 왜 사용량과 따로 결정해야 했나

사용량은 **"얼마 썼나"** 지만 감사는 **"무엇을 했나"** 다. 후자는 사람의 행동 이력이라
선을 잘못 그으면 팀 운영 도구가 아니라 감시 도구가 된다. 그어진 선은 한 문장이다:

> ★**공유 산출물에 일어난 사건은 보여준다. 그 사람이 무슨 명령을 쳤는지는 안 보여준다.**

티켓·머지·에이전트·플로우는 팀이 함께 쥔 물건이고, 거기 일어난 변경에 대한 책임 추적은
팀 운영의 정의다. 반면 어떤 툴을 몇 번 호출했는지, 무엇을 읽었는지, 무엇을 물었는지는
그 사람의 **작업 방식**이지 프로젝트의 상태가 아니다.

### 12.1 권한 축 — ★운영자 축과 섞지 않는다

|  | `getAdminProjectAudit` | `getTeamProjectAudit` |
| --- | --- | --- |
| 주체 | 마블로 운영자(단일 `ADMIN_UID`) | 팀 오너 / admin / member |
| 게이트 | `requireAdmin` | `resolveTeamProjectRole` (새 축) |
| 스코프 | 전 테넌트 | 프로젝트 하나 |
| 자유 텍스트 | 실린다(scrub 된 지시문·결과) | ★**하나도 안 실린다** |
| 금액 | `workload[].totalCost` 실림 | ★**하나도 안 실림** |

★`requireAdmin` 을 재사용하지 않는다. 한번 섞으면 "이 사람이 왜 이걸 보나" 를 두 번 다시
풀 수 없다. ★그리고 **Admin SDK 는 보안 규칙을 우회하므로**, 이 콜러블은 `firestore.rules` 의
`isProjectOwner` / `isAdminOrOwner` / `isProjectMember` 와 **같은 판정을 서버가 다시** 한다.

| 역할 | 판정(룰과 동일) | 스코프 |
| --- | --- | --- |
| owner | `projects/{id}.ownerId == uid` | `team` |
| admin | `memberRoles/{id}_{uid}.role == 'admin'` | `team` |
| member | `uid in projects/{id}.members` | `self` |
| none | 위 어느 것도 아님 | ★`state:"disabled"` + 0행. **프로젝트 존재 여부를 말하지 않는다**(§5.3) |

- **멤버 본인은 자기 이력을 본다.** 본인 기록 열람은 감시가 아니라 정보주체 권리이고,
  룰상 이미 자기 프로젝트 원장을 읽을 수 있어 새 노출이 아니다.
- **멤버는 남의 행을 못 본다.** `self` 스코프는 Firestore 쿼리에 `actorUid == uid` 를 붙여
  **남의 행을 애초에 읽지 않고**, 순수 좁히기가 한 번 더 거른다(이중 방어).
- ★`self` 스코프에서 사건 요약(`summary.eventsInWindow`·`eventsByKind`)도 self 로 접힌다.
  총계를 열면 §5.2 의 차분 공격 논거가 감사 탭에서 그대로 재현된다.
- ★**정직하게 밝힐 것 하나:** `self` 로 좁혀지는 것은 **사건 목록**이고,
  `tickets`·`missions`·`workload` 는 프로젝트 전체 값이다. 그 셋은 `firestore.rules` 상
  이미 프로젝트 멤버 누구나 읽는 **공유 보드 상태**라 새 노출이 아니다. 응답 `notes` 가
  이 사실을 싣는다 — "좁혔다" 고 뭉뚱그리면 화면이 실제보다 좁다고 오해한다.

### 12.2 보여주는 것 — ★차단목록이 아니라 허용목록

`teamAudit.PROJECT_EVENT_TOOLS` 에 **없는 툴은 응답에 안 실린다.** 차단목록이면 새 툴이
생길 때마다 조용히 새지만, 허용목록은 분류되기 전까지 **fail-closed** 다. 프라이버시 경계가
실패하는 방향은 이쪽이어야 한다.

| 분류 | 툴 | 답하는 질문 |
| --- | --- | --- |
| `task_create` | `create_task` `create_tasks_bulk` | 티켓이 생겼나 |
| `task_transition` | `claim_task` `update_task_status` `submit_for_review` | ★누가 티켓을 옮겼나 |
| `merge` | `merge_and_close` + `merge_history` 행 | ★누가 머지했나 |
| `agent_spawn` | `spawn_agent` | 누가 에이전트를 띄웠나 |
| `flow_change` | `create_flow` `update_flow` | 누가 플로우를 바꿨나 |

행위자는 **`memberKey`(`tm_` + HMAC, §5.4 의 `teamMember` 가명 공간)** 로만 표기한다.
원시 uid·이메일·표시 이름은 안 나간다. 표시용 이름은 UI 티켓이 별도로 해결한다.

### 12.3 ★안 보여주기로 한 것 — 이 결정의 본체

★이 표를 지우거나 줄이지 마라. 응답의 `withheld` 필드가 같은 목록을 **안정 코드와 함께**
싣고 있어서, 표만 고치고 코드를 안 고치면 계약이 갈라진다.
(`teamAudit.TEAM_AUDIT_WITHHELD` — `{ code: "withheld_…", text: "ko 문장" }` 10줄.)

| 뺀 것 | 왜 |
| --- | --- |
| 원장 `params` | 자격증명이 섞일 수 있고 원장은 불변이라 지울 수 없다(매퍼가 이미 차단) |
| `instructionRedacted` | scrub 됐어도 **지시문 = 프롬프트**다 |
| 원장 `result` | 툴 실행 결과 = 코드·파일 내용이 그대로 들어올 수 있다 |
| `activities[].message` | 에이전트 자유 서술 — 코드·경로·에러 덤프 원문 |
| **activity 행 자체** | 텍스트를 빼면 "누가 언제 뭔가 적었다" 만 남는다. 운영 정보 0, 분(分) 단위 행동 추적 1. 카운트만 남겨 주의 필요 판정에 쓴다 |
| **허용목록 밖 툴 호출 전부** — `Bash` `Read` `Edit` `Write` `Grep` … | ★이게 "그 사람이 무슨 명령을 쳤는지" 다. 티켓이 감시라고 부른 바로 그것 |
| 열람 기록 — `get_*` `search_tasks` `get_agent_skill` `run_skill` | "누가 무엇을 봤나" 는 어떤 해석으로도 감시다 |
| 통신·보고 — `add_activity` `ask_orchestrator` `answer_question` `check_feedback` `acknowledge_feedback` `add_pending_instruction` `mark_instruction_delivered` `escalate_to_owner` | 공유 산출물이 아니고 빈도가 가장 높다. 넣는 순간 피드 전체가 개인 행동 로그가 된다 |
| 에스컬레이션 — `request_model_escalation` `resolve_model_escalation` | "이 사람이 얼마나 어려워했나" 의 기록 = 성과 평가. 승인만 넣고 요청을 빼면 비대칭이라 계열 전체를 뺐다 |
| `mission.*` 원장 이벤트 | 미션은 `missions` 블록(id·상태·카운트)으로 이미 표현된다. 넣으면 같은 사실이 두 번 나오고 `in` 절이 열거 불가능해진다 |
| `missions[].goal` | 사람이 친 목표 문장 = 에이전트 프롬프트로 들어가는 지시문 |
| `merges[].repoRoot` | 남의 기기 로컬 경로 |
| ★**금액·토큰 수치 전부**(`workload[].totalCost` 포함) | §12.4 |
| 원시 `actorUid`·이메일·`displayName` | `memberKey` 가명으로만 표기 |

**남긴 것 중 판단이 갈릴 만한 하나 — 티켓 제목(`tickets[].title`, `events[].taskTitle`).**
제목이 없으면 감사 뷰가 `"티켓 a7f3 가 DONE 으로 옮겨졌다"` 가 되어 쓸 수 없다. 그리고
제목은 **공유 보드에 이미 떠 있는 라벨**이라 프로젝트 멤버에게 새 노출이 아니다.
★남은 위험은 인정한다: 사람이 제목에 코드 조각을 붙여넣을 수 있다. 그건 제목 **입력 지점**의
문제이지 이 응답의 문제가 아니라고 판단했다(매퍼의 200자 절단이 완화책).

**기준선 한 문장으로:** 이 응답은 **공유 산출물의 식별자와 라벨**만 싣고,
**모델에 들어갔거나 모델에서 나온 텍스트**는 싣지 않는다.

#### 12.3.1 ★값도 본다 — 키 스캐너가 못 잡는 자리

`findForbiddenKeys` 는 **키**를 본다. 그런데 응답에는 사람이 자유롭게 지은 문자열이
셋 실린다: `tickets[].claimedBy` · `workload[].name` · `agentId`. 에이전트 이름은
`spawn_agent` 의 `name: z.string()`(`tools.ts:4243`)이라 무엇이든 들어가고,
`claimedBy` 는 **id 일 수도 이름일 수도 있다**(`projectAudit.ts:157`).
→ 누군가 에이전트를 자기 이메일로 이름 지으면 키 스캐너를 그대로 통과한다.

`scrubIdentityLike()` 가 그 셋의 **값**을 훑어 이메일과 uid 모양을 `"(가려짐)"` 으로
바꾼다. ★`null`(이름 없음)과 다른 값이다 — 화면이 두 경우를 같은 칸으로 그리면 안 된다.

★**과잉 차단도 화면을 거짓말하게 만든다.** 둘로 나눠 좁혔다:

- **이메일은 그 부분만** 바꾼다 — `backend-auth <ops@corp.com>` → `backend-auth <(가려짐)>`.
  문자열 전체를 버리면 **어느 에이전트인지도 못 읽게 된다.**
- **uid 는 문자열 전체가 uid 일 때만.** "정확히 28자 영숫자 + 대·소문자·숫자 혼재" 다.
  부분 일치를 허용하면 28자 토막을 품은 멀쩡한 이름이 잘려 나간다.

★깨지는 자리를 테스트로 못박았다 — 28자 **소문자뿐** / 29자 / 25자 / `agent-<uid>` 는
**통과**하고, 28자 혼재만 걸린다. `backend-1`·`orchestrator-claude-p1`·`John Kim`·`프론트-2`
도 통과.

★**정규식은 모듈 상수가 아니라 팩토리다.** `g` 플래그는 `lastIndex` 를 들고 다니고,
모듈 상수면 그 상태가 호출 사이에 살아남는다. 지금은 `String.replace` 가 스펙상 되감아
줘서 안전하지만 그건 **우연**이다 — 다음 사람이 방어 삼아 `if (re.test(v))` 한 줄을
앞에 넣으면 상태가 섞이고, 그 실패는 **예외도 안 나고 값만 틀린다.** `lastIndex = 0` 을
명시하는 것도 **호출 순서를 사람이 계속 맞게 유지해야** 성립하므로, 매 호출 새로 만들어
그 실수를 **불가능**하게 했다.

그리고 "지금 맞다" 로 넘기면 나중에 깨져도 **조용한** 성질 넷을 고정했다: 상태 비공유
(3연속 호출) · 구분자 보존(쉼표·세미콜론·문장 끝 마침표) · 한 문자열의 **여러 개를 전부**
가림 · **멱등**(가린 뒤 또 가려도 같다).

이건 UI 티켓(`pTQuNVOI1MTzwaowegSR`)의 렌더 경계 방어와 **이중 방어**다. 화면 하나가
막는 것과 응답이 안 싣는 것은 다르다 — **응답은 화면 말고도 갈 데가 있다.**

### 12.4 ★금액을 뺀 이유 — 이게 없으면 게이트가 무의미해진다

`projectAudit.buildProjectAudit` 는 `workload[].totalCost` 를 낸다. 그걸 그대로 실으면
**§5.1 의 `TEAM_USAGE_EFFECTIVE_FROM` 게이트가 감사 탭 경유로 통째로 우회된다** —
멤버별 지출은 고지 개정 전까지 닫혀 있는데, 감사 탭은 그 게이트 **밖**이기 때문이다.

→ 감사 응답에 금액·토큰 필드가 **하나도 없다.** 돈은 `getTeamUsageSummary` 와 그 게이트로만
나간다. ★**이것이 감사 탭이 고지 게이트 없이 배포돼도 안전한 이유다.** §8 의 v1 이
"게이트 닫힌 채로 배포 가능" 인 것과 같은 성질이다.

**그래서 감사 탭에는 별도 고지 게이트를 두지 않는다.** 근거 셋:

1. **새로 수집하는 개인정보가 없다** — 전부 이미 쌓인 원장을 읽기만 한다.
2. **대상이 공유 산출물의 변경**이라, 멤버가 그 프로젝트에 참여한 목적 범위 안이다.
3. **새 목적(개인별 지출 측정)은 전부 금액 쪽에 있고** 그건 §5.1 게이트 뒤에 있다.

★(3)이 성립하는 것이 (1)(2)를 지탱한다. **금액을 여기 넣는 순간 이 근거가 무너진다** —
넣으려면 §5.1 게이트를 감사 탭에도 걸어야 한다.

### 12.5 응답 계약 (§7 규약 계승)

```ts
// getTeamProjectAudit({ projectId?: string, limit?: number, cursor?: string })
{
  generatedAt: string;
  projectId: string | null;
  projects: Array<{ id, name, role: "owner"|"admin"|"member" }>;  // ★호출자가 역할을 가진 것만

  teamAudit: {                       // ★usage 탭과 같은 봉투 규약
    state: "disabled" | "empty" | "partial" | "complete";
    reasonCode: "no_role" | "no_project" | "no_events"
              | "partial_sources" | "scan_truncated"
              | "self_scope_unattributable" | null;   // ★i18n 키로 써라
    reason: string | null;           // 같은 뜻의 ko 문장 — 키가 없으면 그대로 그려라
    scope: "team" | "self";
    role: "owner" | "admin" | "member" | null;        // 권한 없으면 null
    projectsInScope: number;
    basis: "project_event_ledger";   // ★라벨 없는 목록 금지 — 항상 실린다
  };

  page: { limit, returned, nextCursor: string | null, hasMore: boolean };

  summary: {                          // ★페이지가 아니라 **창** 기준
    eventsInWindow; eventsByKind;
    tasksTotal; tasksOpen; tasksDone; tasksByStatus;
    attentionCount; criticalCount;    // ★목록에서 유도 — §12.5.4
    agentsTotal; missionsTotal; missionsActive;
  };                                  // ★금액 필드 없음 · mergesTotal 없음(§12.5.4)

  events: Array<{
    id;                               // "ledger:<docId>" | "merge:<docId>"
    kind: "task_create"|"task_transition"|"merge"|"agent_spawn"|"flow_change";
    action;                           // 허용목록 툴 이름 그대로
    at; atMs; taskId; taskTitle;
    memberKey: string | null;         // ★tm_ 가명. 원시 uid 아님
    agentId: string | null;           // 프로젝트 산출물(사람 아님)
    success: boolean | null;
    merge: { branch, prNumber, filesChanged, linesAdded, linesDeleted } | null;
  }>;                                 // ★text/message/instruction/result 자리가 **없다**

  tickets; attention;                 // AuditTicket + stalledJudged(§12.9.1). 금액·자유텍스트 없음
  missions: Array<{ id, status, taskCount, doneCount, statusCounts, updatedAt }>;  // goal 없음
  workload: Array<{ agentId, name, model, role, status, currentTaskId,
                    openTasks, doneTasks }>;                                       // totalCost 없음

  withheld: Array<{ code: "withheld_…", text: string }>;   // ★안 보여주기로 한 것 (10줄)
  notes:    Array<{ code: "note_…",      text: string }>;   // ★전부 코드가 있다
}
```

★`reasonCode`(안정 enum) + `reason`(ko 문장)을 **항상 쌍으로** 준다 —
`personAxis.PersonAxisGate` 와 같은 규약이다. 화면은 `reasonCode` 를 i18n 키로 쓰고,
키가 없으면 `reason` 을 그대로 그린다. (T9 가 물었던 계약이 이것이다.)

★응답 타입에 `text`/`message`/`result` 자리를 `null` 로도 두지 않는다.
**자리가 있으면 언젠가 누가 채운다.** (`withheld`/`notes` 의 `text` 는 예외다 —
그건 **서버가 쓴 고정 문장**이지 사용자 데이터가 아니다. §12.8 의 금지키 스캐너가
그 두 가지만 제외하고 나머지 전부를 훑는다.)

### 12.5.0 ★기준값은 문장이 아니라 `criteria` 로 나간다

`note_stalled_threshold` 문장에 **"여섯 시간"** 을 박아 놓고, 바로 그 위 주석에는
"상한 숫자를 문장에 넣지 마라 — 바꿀 때마다 세 로케일 번역이 낡는다" 고 써 뒀었다.
**정면으로 어긋난다.** UI 티켓(`pTQuNVOI1MTzwaowegSR`)이 잡았다.

★더 나쁜 건 **테스트가 초록이었다는 것**이다. 검사가 `/\d/` 만 봤는데 "여섯" 은 한글
수사라 통과했다 — 규칙의 **글자**만 검사하고 **뜻**은 검사하지 않았다. 거짓 안심이다.

숫자를 그냥 **지우는** 것도 답이 아니다. "일정 시간" 은 오너가 '정체' 배지를 얼마나
심각하게 볼지 판단할 근거를 뺏는다. → **문장에서 빼고 값으로 준다:**

```ts
criteria: { stalledAfterHours: number }   // = projectAudit.STALLED_AFTER_MS 에서 파생
```

화면이 로케일 문장에 끼워 넣으면 번역이 낡지 않고 숫자는 항상 맞다. ★값의 출처가
**판정에 쓰는 상수 그 자체**라 화면이 말하는 숫자와 실제 기준이 갈라질 자리가 없다.
검사도 고쳤다 — 아라비아 숫자와 **한글 수사**를 단위와 함께 잡고, `criteria` 값이
`STALLED_AFTER_MS` 와 일치하는지 확인한다.

### 12.5.1 ★i18n — 문장이 아니라 코드가 계약이다

UI T9 는 **ko·en·ja 세 로케일**을 그린다. 문장만 주면 en/ja 화면이 한국어를 그리므로,
화면에 나가는 모든 줄이 **안정 코드**를 함께 들고 다닌다. 형제 티켓
(`lt9w8LucYFpSbaEzTsgG` / `docs/team-usage-summary-contract-2026-08-21.md`)의
`…Code` / `…` 쌍과 **같은 규약**이다.

| 자리 | 코드 | 문장 |
| --- | --- | --- |
| 봉투 사유 | `teamAudit.reasonCode` | `teamAudit.reason` |
| 안 보여주는 것 | `withheld[].code` (`withheld_*`) | `withheld[].text` |
| 런타임 note | `notes[].code` (`note_*`) | `notes[].text` |

- 정상이면 `reasonCode`·`reason` **둘 다 null**.
- ★**번역 불가한 줄이 하나도 없다.** `notes[].code` 는 항상 채워진다.
- ★그 대가로 **매퍼(`projectAudit.ts`)의 note 를 흘리지 않는다.** 그 문장들은 어드민 뷰
  기준이라 팀 뷰에서 **거짓이 된다** — 실제로 매퍼는 "지시문은 scrub 된 요약만 표시한다"
  고 말하는데 팀 응답은 지시문을 **아예 싣지 않는다.** 흘리면 응답이 스스로 거짓말한다.
  팀 뷰에서 참인 사실(정체 판정 기준, 주인 없는 클레임 판정 생략)만 코드로 다시 만든다.
- ★코드와 문장이 갈라지지 않게 `TEAM_AUDIT_RUNTIME_NOTE_TEXT_KO` 를
  `Record<Code, string>` 으로 두었다 — **코드만 늘리고 문장을 빼먹으면 타입이 잡는다.**
- ★note 문장에 **기준값을 박지 않는다**(§12.5.0). 숫자가 필요하면 `criteria` 로 주고
  화면이 로케일 문장에 끼워 넣는다. "얼마나 잘렸나" 는 `state`/`reasonCode` 가 말한다.
- ★코드 문자열은 사용량 탭의 코드와 **겹치지 않는다**(`no_role` `no_project` `no_events`
  `partial_sources` `scan_truncated` `self_scope_unattributable` · `withheld_*` · `note_*`
  vs `gate_unset` `gate_invalid` `not_provisioned` `no_team_scope` `member_self_only`
  `orchestrator_not_collected`). 그래서 화면은 두 상수를 합쳐 **i18n 표 한 벌**로 쓸 수 있다.
  두 union 을 코드에서 하나로 합치지 않은 이유는 T11 과 T4 가 다른 브랜치에서 동시에
  진행 중이라 교차 의존을 만들면 한쪽 브랜치가 다른 쪽 없이 빌드되지 않기 때문이다 —
  **둘 다 머지된 뒤** 중립 이름(`TEAM_NOTE_CODES`)으로 합치는 것이 맞다(후속 티켓).

  ★**그 후속 티켓의 조건 한 줄:** union 타입만 합치고 **코드 문자열은 한 글자도 바꾸지
  않는다.** 이름이 안 예뻐도 그대로 이관한다. 이름을 정리하고 싶어지는 자리인데, 문자열이
  바뀌면 **배포 시차** 동안 화면이 낡은 코드를 받아 **빈 문장**을 그린다. 그게 `withheld`
  에서 일어나면 화면이 **"숨긴 게 없다"** 고 말하는 셈이고, 그건 그 필드가 존재하는 이유와
  정반대다. (같은 이유로 UI T9 는 옛 모양 폴백을 남겨뒀다.)

### 12.5.2 ★조용한 절단 금지 — 자르는 건 정당해도 숨기는 건 아니다

형제 티켓(`lt9w8LucYFpSbaEzTsgG`)이 자기 쪽에서 `slice(0, 25)` 를 조용히 하고 있던 걸
찾아 알려줬고, 그 경고로 내 쪽을 훑었더니 **자르는 자리 넷이 조용했다**:
에이전트(300) · 미션(200) · 머지(200) · 프로젝트 셀렉터(100).

★그중 **에이전트는 개수가 빠지는 정도가 아니라 판정을 틀리게 만든다.** 잘린 목록으로
'주인 없는 클레임' 을 판정하면 상한 밖 에이전트가 물고 있는 티켓이 **전부 거짓 경보**로
뜬다 — `projectAudit.evaluateAttention` 주석이 경고하는 바로 그 실패 모드("'모름' 을
'없음' 으로 접지 않는다")를 내가 재현하고 있었다.

고친 방식:
- 자르는 자리를 **전부** `scanTruncated` 로 센다 → `state: "partial"`.
- ★에이전트가 잘리면 매퍼에 `agentsLoaded: false` 로 넘겨 **판정을 생략**한다.
  잘린 목록은 "없다" 가 아니라 "모른다" 다.
- `teamAudit.projectsTruncated: boolean` + `note_agents_truncated` /
  `note_projects_truncated`. 안 잘렸으면 **없는 경고를 그리지 않는다.**

★**개수를 세지 않고 boolean 으로 둔 이유:** Firestore 는 "몇 개가 더 있었는지" 를
알려주지 않는다. 모르는 숫자를 필드로 내면 화면이 그걸 사실로 그린다.
`projectsInScope` 는 **하한**이고 그 깃발이 그 사실을 말한다.

### 12.5.3 ★절단이 **사람에 대한 판단**으로 번역되는 자리

형제 티켓이 자기 쪽 `hasRows` 에서 이 부류를 찾아 알려줬다("절단 때문에 행이 없는
멤버에게 '안 썼다가 아니라 안 보냈다일 수 있습니다' 노트가 붙는다"). 내 쪽에도 있었다.

**'정체' 판정이 그렇다.** 매퍼는 "마지막 기록 시각" 으로 정체를 판정하는데, 활동을
안 읽은 티켓은 그 값이 `task.updatedAt` 으로 **폴백**된다. 그런데 활동 스캔은 최근
갱신순 상위 N건만 본다 — 즉 **잘려 나가는 건 정확히 `updatedAt` 이 오래된 티켓들**이고,
그건 6시간 임계를 넘길 후보들이다. 에이전트가 활동을 쓰고 있어도 그 활동을 안 읽었으면
**"정체"** 로 찍힌다.

★그 라벨은 오너에게 **"이 사람 일이 멈췄다"** 로 읽힌다. 누락이 아니라 **오탐**이고,
대상이 사람이다.

고친 방식(형제 티켓의 `hasRows: null` 과 같은 판단):
- `activityScannedTaskIds` 를 넘겨, **훑지 않은 티켓에서는 `stalled` 를 뗀다.**
- ★**전부 훑었으면 그대로 판정한다**(`null`). "모름" 을 남발하면 화면이 말할 수 있는
  것도 못 말한다. 훑은 쪽은 잡히고 안 훑은 쪽은 안 잡히는 걸 **양쪽 다** 테스트한다.
- 정체를 떼도 **다른 근거는 남기고**(`taskFailed` 등) 심각도를 **다시 계산**한다 —
  사라진 근거로 critical 배지가 남으면 안 된다. `idleMs` 도 `null` 로 되돌린다.
- ★`summary.attentionCount`/`criticalCount` 를 매퍼 값이 아니라 **좁힌 목록에서 다시
  센다.** 안 그러면 "주의 3건" 이라 써 놓고 2건만 보이는 화면이 된다.
- `note_stalled_unknown_for_some` 으로 **판정을 뗀 사실을 밝힌다** — "정체가 아니라는
  뜻은 아닙니다" 까지 문장에 넣는다.

**세 건의 등급 (같은 뿌리, 손해가 커지는 순):**

| | 결과 | 오너가 읽는 것 |
| --- | --- | --- |
| 프로젝트·미션·머지 절단 | 숫자가 **작게** 나온다 | "덜 썼구나" (누락) |
| 에이전트 절단 → 고아 클레임 | **없던 문제**를 만든다 | "이 티켓 주인이 없네" (오탐) |
| 활동 절단 → 정체 | 없던 문제를 만드는데 **대상이 사람** | "이 사람 일이 멈췄네" (오탐 + 평가) |

### 12.5.4 ★카운트는 목록에서 **유도**한다 — 출처가 둘이면 갈라진다

형제 티켓이 `membersWithNoRows` 에서 **카운트 1 / 목록 2** 로 어긋난 걸 찾았다. 뿌리는
카운트를 목록과 **따로 계산**한 것이다. 같은 사냥을 내 `summary` 에 돌렸다.

- `attentionCount`·`criticalCount`·`agentsTotal`·`missionsTotal` 을 전부 **좁힌 목록에서
  유도**한다. 매퍼 값을 그대로 쓰면 좁히기가 뭘 떼어낸 순간 어긋난다.
- ★`mergesTotal` 은 **없앴다.** 머지는 사건 피드에도 나오는데 그 숫자만 프로젝트
  전체였다 — `self` 스코프에서 **피드에 머지가 0건인데 "머지 12건" 이라고 말하는 화면**이
  된다. `eventsByKind.merge` 가 보이는 것과 일치하는 유일한 숫자라 그것만 남겼다.
  라벨을 붙여 살리는 것보다 **출처를 없애는** 쪽이 맞다 — 라벨은 다음 사람이 안 읽는다.

★**어느 짝이 불변식인지 코드에 적었다**(`TEAM_AUDIT_SUMMARY_INVARIANTS`). UI 가
"둘이 다른 게 정상인 경우도 있어 대조를 못 걸겠다" 고 물어왔는데, 맞는 조심이다:

★**그리고 첫 표는 "대조" 보다 "유도" 가 낫다** — UI T9 의 판단이 내 조언보다 정확했다.
대조는 **어긋났을 때 화면이 무엇을 그릴지를 안 정해 준다**: 서버 값을 그리면 화면이
거짓말하고, 목록 값을 그리면 대조가 무의미하다. 목록이 화면에 이미 있으면 **처음부터
거기서 세라** — 그러면 그 선택지 자체가 없어진다. 대조는 목록이 화면에 **없는** 값
(`missionsTotal` 처럼 카운트만 그리는 자리)에만 남겨라.
★`eventsInWindow` 는 유도하지 마라 — 창 기준이라 페이지 목록과 다른 게 **정상**이다.

| 항상 같다(유도하라 · 목록이 없으면 대조) | 일부러 다르다(대조하면 오경보) |
| --- | --- |
| `attentionCount` = `attention.length` | `eventsInWindow` vs `events.length` — 창 vs **한 페이지** |
| `criticalCount` = critical 개수 | `tasksTotal` vs `tickets.length` — 삭제된 티켓 제외 |
| `agentsTotal` = `workload.length` | |
| `missionsTotal` = `missions.length` | |
| `eventsInWindow` = `eventsByKind` 합 | |

적어두지 않으면 화면이 대조를 **못 걸거나 틀린 짝을 걸어** 오경보를 낸다. 불변식은
`scope × 활동스캔` 전 조합에서 테스트가 돈다.

★**세 번째 실패 모드는 이 응답에 구조적으로 없다.** 형제 티켓이 "맞는 짝인데 정확히
같지는 않다" 를 찾았다(버킷마다 소수 6자리로 따로 반올림해 `Σ byDay ≠ totals`, 차 1e-6).
화면이 정확 비교를 걸면 **멀쩡한 응답이 매번 빨개지고**, 그러면 사람은 원인을 찾는 대신
**검사를 끈다** — 안전장치가 반대로 도는 자리다(§12.5.3 과 같은 부류).

이 응답은 금액·토큰을 전부 뺐으므로(§12.4) **합산 대상이 전부 정수 카운트**다. 허용오차를
설계할 자리가 아예 없다. ★없는 장치를 미리 만드는 대신 **필요해지는 순간을 잡는다**:
`summary`·`criteria`·`page` 의 모든 숫자가 정수인지 테스트가 확인하므로, 누가 나중에
실수 평균·비율을 넣으면 거기서 먼저 죽고 허용오차를 **의식적으로** 설계하게 된다.

### 12.5.5 ★`empty` 는 주장이다 — 못 읽었으면 `partial` 이다

UI(T9)가 §12.9.2 의 색인 항목을 보고 짚었다:
> `0행` 과 `쿼리 실패로 0행` 이 봉투에서 구분되지 않는다. **봉투가 틀린 상태를 자신 있게
> 말하면 클라 방어가 닿지 않는다.**

맞았다. 상태 기계가 `scoped.length === 0` 을 `sourcesIncomplete` 보다 **먼저** 보고 있어서,
사건 쿼리가 통째로 실패해도 `state: "empty"` 가 나갔다.

★**`empty` 는 "사건이 0 건이다" 라는 적극적 주장**이다. 못 읽었을 때 우리가 아는 건 0 이
아니라 **아무것도 없다.** §12.5.2 에 "'모름' 을 '없음' 으로 접지 않는다" 고 써 놓고
**봉투 상태 기계에서 그걸 하고 있었다** — 오늘 잡은 것들과 같은 자리다(규율을 적은 곳과
지키는 곳이 다르면 적은 쪽만 맞는다).

★특히 위험한 경로: **색인이 없으면** Firestore 가 `FAILED_PRECONDITION` 을 내는데
`auditQuery` 가 그걸 **빈 배열로 삼킨다**(한 소스 때문에 화면 전체를 죽이지 않으려는
설계다). 그러면 **완전 실패가 "사건 없음" 으로 위장**되고, 화면은 봉투 밖에서 그 둘을
구분할 방법이 없다.

→ `sourcesIncomplete` 를 **먼저** 본다. 행 수와 무관하게 `partial`.
→ `self_scope_unattributable` 만 예외로 `empty` 를 유지한다 — 그건 **서버가 가명을 못
  만들어 스스로 0 으로 닫은 것**이라 "0 건" 이 거짓이 아니다. "모름" 이 아니라 "닫았음" 이다.

★**테스트가 없어서 살아남았다.** 기존 검사 둘은 `0건+소스정상`(empty)과
`행있음+소스실패`(partial)만 봤고 **`0건+소스실패` 라는 교차점을 아무도 안 봤다.**
경계는 축 하나씩이 아니라 **축의 곱**에서 깨진다.

### 12.6 페이징 — 오프셋이 아니라 키셋

커서는 `(atMs, id)` 의 base64url 이다. 오프셋을 안 쓰는 이유: 감사 원장은 조회 중에도 계속
늘어나므로 오프셋 페이징은 행을 **건너뛰거나 중복시킨다** — 감사에서 조용한 누락은 가장 나쁜
실패다. 정렬은 `atMs desc, id asc` 로 **전순서**를 잡아 커서가 항상 유일한 경계를 가리킨다.
시각을 못 읽은 행은 버리지 않고 맨 뒤로 보낸다(sentinel `-1`; 0=1970 으로 접지 않는다).
★깨진 커서는 조용히 1페이지로 접지 않고 `invalid-argument` 로 되돌린다 — 접으면 화면이
같은 페이지를 무한히 돈다.

색인은 **새로 만들지 않았다.** `firestore.indexes.json` 에 이미 있다:
`(projectId, toolName, createdAt desc)` — team 스코프,
`(projectId, actorUid, toolName, createdAt desc)` — self 스코프.

### 12.7 실측으로 정정한 것 — "누가 저장소를 연결했나" 는 못 답한다

`merge_history` 문서에 **행위자 필드가 아예 없다**(`v3/electron/main.ts:3603` —
projectId/taskId/repoRoot/branch/baseRef/headSha/mode/mergedAt/diff 카운트뿐).
저장소 연결도 MCP 툴이 아니라 `projects` 문서 갱신이라 원장에 안 남는다.

→ 머지의 **사람**은 `merge_and_close` 원장 행으로만 답한다. `merge_history` 행은
`memberKey: null` 이고 응답 `notes` 가 그 사실을 밝힌다. **없는 걸 있는 척 만들지 않았다.**

### 12.7.1 ★사용자 문장에 운영자의 낱말을 넣지 않는다

형제 티켓(`lt9w8LucYFpSbaEzTsgG`)이 자기 봉투에서 이 부류로 4건을 찾아 경고해줬고,
그 경고로 이 파일에서 **8건**이 나왔다. 실패 모드가 미묘하다 — **문장은 전부 사실이었다.**
틀린 건 독자다: `audit_logs` · `merge_and_close` · `repoRoot` 는 엔지니어의 낱말이지
팀 오너의 낱말이 아니다. 오너가 보는 화면이 남의 배포 런북처럼 읽히면 제품이 아니라 로그다.

★하필 **제일 잘 보이는 자리**가 위험하다. 화면규칙 1 이 `disabled` 일 때 `reason`
**문장만** 그리라고 하므로, 권한 없는 사람이 보는 화면은 그 한 문장이 전부다.

- 운영자에게 필요한 세부(가명 솔트 부재, 스캔 상한, 컬렉션 이름)는 **서버 로그와
  코드 주석·이 문서**에 있다. 응답에 싣지 않는다.
- `allUserFacingTexts()` 가 사용자 문장 **전량**(사유 6 + `withheld` 10 + note 10 = 26)을
  세 상수에서 모으고, `findOperatorOnlyText()` 가 env/상수명 · 컬렉션·표 이름 · 코드
  식별자 · 툴 이름 · 런북/경로 패턴으로 훑는다. **하나라도 걸리면 테스트가 죽는다.**
- ★스캐너가 실제로 잡는지도 테스트한다(위양성 검사). 패턴이 다 죽어 있으면 위 검사가
  조용히 통과하기 때문이다.

### 12.8 기계가 대신 읽는다

`teamAudit.test.ts`(34 케이스, `npm run test:team-audit`)가 약속을 코드로 검사한다:

- `findForbiddenKeys()` — 응답 전체를 훑어 금지 키(자유 텍스트·경로·금액·원시 식별자)를 찾는다.
  ★**매퍼가 새 필드를 늘려도 여기서 걸린다.**
- `containsRawValue()` — 알고 있는 uid 문자열이 응답 어디에도 없음을 확인한다.
- 허용목록 밖 툴 25종(명령 실행·열람·보고·에스컬레이션·미션 이벤트)이 전부 빠지는지.
- self 스코프가 남의 행을 거르고, 사건 요약도 self 로 접히는지.
- 가명을 못 만들면 self 가 **0건으로 닫히는지**(열어두는 쪽으로 실패하지 않는지).
- 페이징이 행을 건너뛰거나 중복시키지 않는지(7행 × 3페이지 완주).
- `withheld` 10줄이 전부 유일한 안정 코드를 갖는지 · 런타임 note 의 코드↔문장 전수 대응 ·
  note 문장에 숫자가 안 박혔는지 · env 키 이름(`ANALYTICS_ID_SALT`)이 응답에 안 새는지.
- ★스캐너 제외 목록이 `["withheld","notes"]` **둘뿐**인지, 그리고 그 제외가
  **최상위에서만** 먹는지(데이터 안쪽의 같은 이름은 여전히 잡히는지). 제외가 늘면
  스캐너가 장식이 된다.
- ★매퍼 note 가 응답에 새지 않는지 — `"scrub"`·`"Phase2"` 문자열로 확인한다.
  팀 뷰에서 거짓이 되는 문장이 흘러들면 여기서 걸린다.
- ★사용자 문장 26개에 운영자 낱말이 없는지(§12.7.1) + 스캐너 위양성 검사.
- ★기준값이 문장에 안 박혔는지(아라비아 숫자 **및 한글 수사** + 단위) 와
  `criteria.stalledAfterHours` 가 판정 상수와 일치하는지(§12.5.0).
- ★`criteria.stalledAfterHours` 가 **양수·유한**인지. literal `6` 을 박지 않는다 —
  그건 임계값을 바꾸면 깨지는 **변경 탐지기**이지 성질 검사가 아니다. 화면이 의존하는
  성질은 "문장에 끼워 넣었을 때 참인가" 다: 0 이나 음수면 화면이 *"0시간 동안 아무
  기록이 없는"* 이라는 **거짓 문장**을 그린다.
- ★신원 스크럽의 조용한 성질 넷: 상태 비공유 · 구분자 보존 · 여러 개 전부 · 멱등.
- ★자른 사실을 밝히는지(§12.5.2), 안 잘렸을 때 **없는 경고를 안 그리는지**, 그리고
  잘린 에이전트 목록으로 **거짓 고아 클레임 경보를 내지 않는지**(완전한 목록에서는
  잡히고 잘린 목록에서는 안 잡히는 걸 **양쪽 다** 확인).
- ★에이전트를 이메일로 이름 지어도 응답에 안 실리는지(§12.3.1), 그리고 멀쩡한 이름과
  **길이 경계**(28자 소문자뿐 / 29자 / 25자 / `agent-<uid>`)가 **과잉 차단되지 않는지**.
  전역 정규식 `lastIndex` 재사용도 세 번 연속 호출로 확인한다.
- ★권한 없음 문장이 `존재`·`있는지`·`없는지`·`숨기` 를 담지 않는지 — **숨긴다는 사실
  자체를 노출하면 숨기는 목적이 절반 무효화된다**("아, 여기 뭔가 있긴 하구나").

### 12.9 ★범위 밖 — 별건 티켓이 필요한 발견

이 콜러블은 경계를 지키지만, **플랫폼 수준에서는 아직 지켜지지 않는다.**

1. **(열려 있음)** `firestore.rules` 의 `audit_logs` read 게이트가 `canReadLedgerDoc()`
   = **프로젝트 멤버 누구나** 원장 원문(`params` 포함)을 직접 읽는다. 즉 "멤버가 남의
   이력을 못 본다" 는 **이 콜러블 수준에서만 참**이다.
2. ~~`missions` · `cost_logs` 의 `allow read: if isAuthenticated()`~~ →
   **닫혔다.** PR #1113(`d93d6228`)이 둘 다 `canReadProjectScopedDoc()` 으로 좁혔다.
   (2026-08-21 `origin/main` 실측 확인.)
3. **(열려 있음 — 2에서 안 닫힌 절반)** `missions` 의 **write 축**이 그대로다:
   ```
   match /missions/{missionId} {
     allow read:   if canReadProjectScopedDoc();   // ← #1113 이 닫음
     allow create: if isAuthenticated();           // ← 그대로
     allow update: if isAuthenticated();           // ← 그대로
     allow delete: if isAuthenticated();           // ← ★그대로
   }
   ```
   즉 **로그인만 하면 남의 테넌트 미션을 지울 수 있다.** read 를 닫는 티켓이 write 를
   같이 보지 않은 것이고, ★**읽기 유출보다 나쁘다** — 유출은 되돌릴 수 있지만 삭제는
   못 되돌린다.

★1·3은 고치지 않고 보고했다. 룰을 좁히면 앱(메인 프로세스·에이전트)의 기존 경로가 같이
죽으므로 실측 없이 건드릴 자리가 아니다 — #1113 이 read 만 닫고 write 를 남긴 것도
같은 조심으로 보인다. ★다만 **그 조심이 기록되지 않으면 다음 사람은 "이미 닫혔다" 고
읽는다.** 그래서 여기 적는다.

### 12.9.1 ★미룬 둘을 되돌렸다 — 미루기의 근거가 검증 안 된 산문이었다

한 시간 전 이 자리에 "머지 전에는 안 한다(계약이 또 바뀌면 UI PR 이 낡는다)" 고 적었다.
형제 티켓이 같은 실수를 자기 쪽에서 먼저 뒤집으며 남긴 문장이 그대로 나에게도 맞았다:

> ★**"지금 하면 큰 변경" 이라는 판단을 검증 없이 내리면 미루기가 정당해 보인다.**

실제 비용을 재보니 둘 다 미룰 근거가 없었다.

- **항목 2는 계약을 아예 안 건드린다** — 테스트와 상수 추가뿐이다. 비싼 항목 1과
  **묶어서** 항목 1의 근거로 같이 미뤘다. 묶음이 근거를 옮겨 준 것이다.
- **항목 1은 추가 필드다.** UI PR 을 낡게 만든 건 `mergesTotal` **제거**와 `withheld`
  **모양 변경**이었지, 필드 추가가 아니다. ★**추가는 무시하면 동작이 그대로다** —
  "계약 변경" 한 낱말로 뭉뚱그리면서 **제거·재구조화와 추가를 같은 비용으로** 셌다.

둘 다 넣었다:

1. **`TeamAuditTicket.stalledJudged: boolean`** — `false` 면 활동 기록을 다 못 읽어
   판정을 **유보**했다는 뜻이다(정체가 아니라는 뜻이 **아니다**).
   ★배열에서 원소를 빼면 **"없음" 과 "모름" 이 같은 모양**이 된다. 형제의 `hasRows` 가
   3값을 가질 수 있었던 건 **스칼라라서**였고, 내 `attention.kinds` 는 배열이라 그 자리가
   없었다. 그래서 옆에 필드를 둔다.
   **문장은 오독을 막고 필드는 접기를 막는다 — 둘 중 하나가 다른 하나를 덮지 못한다.**

   ★**그리고 둘이 갈라지지 않게 같은 술어에서 낸다.** UI 가 "출처가 둘이면 갈라진다" 를
   지적했고(내가 `mergesTotal` 을 없앨 때 쓴 논리 그대로), 답은 출처를 없애는 게 아니라
   **note 와 필드를 같은 `judged()` 에서 파생**시키는 것이었다. 확인하다 note 가
   **덜 말하고 있던 것**도 드러났다 — 전에는 "실제로 `stalled` 를 뗐을 때" 만 냈으므로,
   안 읽은 티켓이 있어도 그중 정체 후보가 없으면 화면이 `stalledJudged: false` 를 보면서
   **이유를 설명하는 문장은 못 받았다.** 안 읽었으면 정체 여부를 모르는 건 결과가 어떻든
   같다. 지금은 **`note 있음 ⟺ 유보 티켓 존재`** 이고 테스트가 네 경우로 확인한다.

   ★UI 는 이 필드를 **지금은 안 쓴다** — 자기 화면이 `notes` 를 접지 않아(전량을 한 줄씩
   그린다) 지금 쓰면 같은 사실을 두 자리에 그리게 되기 때문이다. **punt 가 아니라 근거
   있는 보류**이고, 조건 둘(`notes` 에 접기가 생기면 / 주의 목록에 **행 단위 배지**를 달면)
   중 하나가 오면 그때는 note 한 줄로 **어느 티켓인지 못 가르므로** 이 필드가 유일한
   근거가 된다.
2. **`TEAM_AUDIT_DELIBERATE_MISMATCHES`** — 일부러 다른 짝을 주석이 아니라 **상수**로
   두고 `reason` 을 필수로 만든다. 주석에만 두면 "다를 수 있음" 으로 **근거 없이 미루는**
   자리가 된다. 이유가 비어 있지 않은지, 그리고 같은 짝이 불변식 목록에 **동시에 있지
   않은지**(계약이 스스로 모순되지 않는지) 테스트가 본다.

### 12.9.2 ★배포 후 에뮬레이터로 대조할 것 — 순수 테스트가 못 덮는 자리

`teamAudit.test.ts` 는 **순수 로직**만 덮는다. 아래는 **Firestore 가 실제로 붙어야** 보이는
것들이라, 콜러블이 배포된 뒤 에뮬레이터로 한 번 훑어야 한다. UI(T9)와 합의한 목록이다.

★**세션 대화에만 두지 않고 여기 적는 이유**: 그 대화는 에이전트가 끝나면 사라진다.
이 티켓에서 계속 잡아온 그 부류다 — **기록이 정본 한 군데에 없으면 없는 것과 같다.**

| 볼 것 | 왜 |
| --- | --- |
| `hasMore=true` 인데 `nextCursor=null` 인 조합이 **안 나오는지** | 지금 코드상 나올 수 없다(`nextCursor` 는 `hasMore && last` 일 때만 생기고, `hasMore` 면 페이지에 행이 최소 하나 있다). ★**나오면 불변식이 깨진 것**인데, 화면은 '더 보기' 를 안 켜서 **사용자에겐 안 보인다** — 서버가 먼저 알아채야 한다 |
| `criteria` 유무 두 경로 | 있으면 화면이 시간을 끼운 문장을, 없으면 숫자 없는 문장을 그린다. **빈칸도 자리표시자도 안 뜨는지** |
| `memberKey: null` 인 머지 행 | `merge_history` 에 행위자 필드가 없어 **정상적으로 나온다**(§12.7). '알 수 없음' 으로 그려지는지 — 빈칸이면 버그로 보인다 |
| `(가려짐)` vs `null` 구분 | "담당자를 가렸음" 과 "담당자 없음" 은 다른 사실이다(§12.3.1) |
| `note_stalled_unknown_for_some` 의 **실데이터 빈도** | 안 읽은 티켓이 있으면 **항상** 나간다(전에 안 나오던 게 버그였다 — §12.9.1). 과하게 자주 뜨면 상한(활동 스캔 60건)을 다시 볼 신호다 |
| ★**인덱스가 실제로 붙는지** | `(projectId, toolName, createdAt)` / `(projectId, actorUid, toolName, createdAt)`. 없으면 `FAILED_PRECONDITION` 이 나는데 `auditQuery` 가 그걸 **빈 배열로 삼킨다** → 화면엔 `state: "partial"` 로만 보인다. **조용한 열화라 실측 말고는 알 길이 없다** |
