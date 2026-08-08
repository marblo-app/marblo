# 관리자 대시보드 v1 — 백엔드 콜러블 API 스키마

작성일: 2026-07-12
상태: **구현 완료(리뷰 대기)** — 기획 `docs/analytics-dashboard-plan.md` §6 Phase 0/1/2 백엔드(T0-1·T1-1·T1-3·T2-1·T2-2) 통합 구현.
대상: 다음 UI 단계(`marblo-web /admin › Analytics` 탭). 클라는 `httpsCallable(functions, '<name>')({ days })` 로 호출.

---

## 공통

- **위치:** `v3/functions/src/index.ts` (Firebase Cloud Functions, `onCall`).
- **권한:** 모든 콜러블 `requireAdmin(context)` — `ADMIN_UID` env 와 `context.auth.uid` 일치만 허용. 불일치/미설정 시 `HttpsError('permission-denied', 'Admin only')`. 클라는 이 에러로 어드민 여부 판정(기존 /admin 패턴 재사용).
  - ⚠️ **배포 전 `ADMIN_UID` env 확인 필수** — 미설정이면 전 콜러블 차단(파운더 봇 런북과 동일).
- **파라미터:** `{ days?: number }` — 조회 기간(일). 기본 30, 양의 정수만, 상한 365(BQ 스캔 가드). 위반 시 `HttpsError('invalid-argument')`.
  - **`includeAdmin?: boolean`** — 운영자(존킴) 자기활동 포함 토글. **기본 `false`(제외)**, `true` 면 전체 포함. `getAdminUsageSummary`·`getAdminModelSummary`·`getAdminDrilldown`·`getAdminOnboardingFunnel`·`getAdminReleaseHealth` 에 적용(텔레메트리/비용 계열). `getAdminBusinessSummary`(Firestore)는 항상 제외라 무관.
    - ★**하위호환:** 구버전 functions 는 이 param 을 무시(기존=항상 제외), 신규 functions 는 param 이 없으면 `false`(제외)로 기존 동작 유지. 어느 방향 배포순서든 안전.
    - ★**포함/제외 비교:** 토글을 켜고/끄며 두 수치를 대조한다. 제외 모드에서도 `adminExcluded.clientIdCount` 로 "제외 시 몇 개가 빠지는지"를 노출한다.
- **BQ location:** `US` 고정(`BQ_LOCATION`). 과거 us-central1 조회 500 버그 회피.
- **프라이버시(§5 준수):**
  - PII(이메일·이름·전화·개별 uid) 미노출. 집계·카운트·비율만 반환. 개별 row 안 내림.
  - `events`/`task_outcomes`/`heartbeats` 의 `userId` 는 **익명 clientId** — 일반 사용자 재식별에는 쓰지 않고 DISTINCT 카운트(표본 크기)와 운영자 제외에만 사용.
- **운영자 자기계정 제외:** 도그푸드 표본이 30 수준이라 운영자 본인 활동이 KPI 를 오염시킨다. 모든 집계에서 `ADMIN_UID` 소유분을 뺀다.
  - **정확 제외(uid 보유):** Firestore `subscriptions`(doc id=uid) · `billingCharges.userId` · `founders.proSubscriptionUid` · `agents.ownerId`, BQ `cost_logs.userId`.
  - **추정 제외(익명 clientId):** `events`/`task_outcomes` 의 `userId` 는 익명 clientId 라 uid 로 못 지운다. 대신 `cost_logs`(uid 보유) 의 `agentId` 로 `events` 를 역참조해 어드민 clientId 를 유추하고 그 분만 제외한다(`resolveAdminClientIds`). 실패해도 대시보드는 살아야 하므로 **fail-open**(제외 포기 후 계속).
  - ⚠️ **`ADMIN_UID` 값 자체는 응답·로그에 절대 안 나간다.** 제외 "건수"만 `adminExcluded` 로 반환하고, resolution 실패 시 원시 에러 메시지도 로깅하지 않는다.
  - ⚠️ 이 역참조는 `events` 익명성이 `agentId` 조인으로 부분 해제됨을 뜻한다. 운영자 제외 용도로만 쓰고 일반 사용자 재식별에는 쓰지 말 것.
  - `betatester50_waitlist` 는 `count()` 집계라 doc 필드 필터가 안 걸려 제외 미적용(운영자가 대기자 명단에 있을 가능성 낮음).
- **데이터 희소성:** 텔레메트리 기본 OFF + 옵트인/도그푸드만 송신 → 프로덕션 BQ 데이터는 6/22 이후 공백 가능. 모든 BQ 콜러블은 **빈 구간을 빈 배열/0 으로 안전 반환**. `getAdminUsageSummary` 는 `sampleClientCount` 를 함께 반환하니 UI 는 "옵트인 N명 기준" 라벨을 달 것.
- **공통 응답 필드:** `rangeDays`(에코), `generatedAt`(ISO8601).

---

## 1. `getAdminBusinessSummary` — 사업 KPI (🟢 Firestore, 항상 켜짐·신뢰축)

소스: Firestore `subscriptions` / `founders` / `betatester50_waitlist` / `agents`.

**Request:** `{ days?: number }` (신규 가입/이탈 윈도우)

**Response:**

```ts
{
  rangeDays: number;
  generatedAt: string;
  // 운영자 제외 "건수"만(uid 미노출). 아래 total/분모는 전부 제외 후 값이다.
  adminExcluded: {
    subscriptions: number;
    billingCharges: number;
    founders: number;
    agents: number;
  }
  subscriptions: {
    total: number; // 구독 doc 총계(전 상태, 운영자 제외)
    byStatus: Record<string, number>; // {active, past_due, canceled, ...}
    byPlanActive: Record<string, number>; // status=active 중 {free, pro, team, team_plus}
    byProviderActive: Record<string, number>; // status=active 중 {toss, paddle, founder_grant}
    paidProActive: number; // active ∩ plan∈{pro,team,team_plus} ∩ provider≠founder_grant (실유료 Pro)
    founderGrantActive: number; // active ∩ provider=founder_grant (무료 부여)
    pastDue: number;
    newInWindow: number; // createdAt ∈ [now-days, now]
    churnedInWindow: number; // canceled/past_due 이면서 canceledAt ∈ 윈도우
    proConversionRateVsSubscribers: number; // paidProActive / total
    proConversionRateVsWaitlist: number; // paidProActive / waitlist.total
  }
  founders: {
    total: number;
    accessGranted: number; // accessGrantedAt 존재
    interviewCompleted: number;
    feedbackSubmitted: number;
  }
  waitlist: {
    total: number; // count() aggregate (이메일 미노출)
    newInWindow: number; // createdAt ≥ cutoff count()
  }
  agents: {
    // ⚠️ 라이브 로스터(가변 doc). "전체 스폰 이력" 아님 → 스폰수는 BQ(usage)로.
    liveCount: number;
    byStatus: Record<string, number>;
    rollingTotalCost: number; // Σ agents.totalCost
    rollingTotalTokens: number; // Σ totalTokens (없으면 in+out 합)
  }
}
```

> Pro 전환율: 정확한 "활성 사용자" 분모는 익명 BQ 라 계정단위 산출 불가(§0-1) → 신뢰 가능한 식별 분모(구독 총계·대기자)로 **두 비율을 명시 반환**. UI 에서 라벨 구분.

---

## 2. `getAdminUsageSummary` — 제품 사용/활성 (🟡 BQ, 옵트인 표본)

소스: BQ `events` + `task_outcomes` (userId 필터 없음 = 전체 집계).

**Request:** `{ days?: number }`

**Response:**

```ts
{
  rangeDays: number;
  generatedAt: string;
  // 운영자 제외 현황(값 미노출). uidFiltered=false 면 ADMIN_UID 미설정 → UI 가 경고.
  adminExcluded: {
    applied: boolean; // 이번 응답에 제외가 실제 적용됐는지(=!includeAdmin). false 면 전체 포함.
    uidFiltered: boolean;
    clientIdCount: number; // 제외 대상(=포함 시 추가로 잡히는) 관리자 clientId 수. 포함 모드에서도 계속 노출(비교용).
  }
  sampleClientCount: number; // 윈도우 내 고유 clientId 수 = 표본 크기(옵트인 라벨용)
  wau: number; // 최근 7일 고유 clientId
  activeByDay: {
    date: string;
    dau: number;
    events: number;
  }
  []; // DAU + 일별 총이벤트(히스토리)
  topEvents: {
    key: string;
    count: number;
  }
  []; // events.event 랭킹 top25
  spawnsByDay: {
    date: string;
    count: number;
  }
  []; // event='agent:spawned'
  spawnsByRole: {
    key: string;
    count: number;
  }
  [];
  spawnsByModel: {
    key: string;
    count: number;
  }
  [];
  tasks: {
    total: number;
    succeeded: number;
    successRate: number; // succeeded/total (0 안전)
    avgDurationMs: number;
  }
}
```

---

## 3. `getAdminModelSummary` — 모델 선정/라우팅 (🟡 BQ)

소스: BQ `cost_logs`(admin, uid 필터 제거) + `task_outcomes` + `events.metadata`(dispatch:decision JSON).

**Request:** `{ days?: number }`

**Response:**

```ts
{
  rangeDays: number;
  generatedAt: string;
  adminExcluded: {
    uidFiltered: boolean;
    clientIdCount: number;
  }
  costByModel: {
    model: string;
    totalTokens: number;
    cost: number;
    count: number;
  }
  []; // getCostSummary 의 admin 버전
  costByDay: {
    date: string;
    cost: number;
  }
  []; // 일별 총비용(히스토리)
  // 일별 × 모델 비용(기간별 분해). 상위 6종 + '그 외'로 접되 총합은 보존한다.
  costByDayModel: {
    dates: string[];
    models: { model: string; total: number; share: number }[];
    matrix: number[][]; // models 순서와 1:1 대응, 각 행 길이 = dates.length
    grandTotal: number;
    truncatedModels: number; // '그 외'로 접힌 모델 종수
  };
  // ★하위모델 분해 — 스폰축(events.model=하네스)과 비용축(cost_logs.model=구체
  // 모델 id)을 agentId 로 조인한 2단 트리. env-swap 벤더(MiniMax·GLM·Kimi)가
  // 하네스 claude 밑에 숨는 문제를 이 표가 드러낸다.
  modelBreakdown: {
    harnesses: {
      harness: string; // claude · gpt · gemini · antigravity · grok …
      agents: number; // 하네스 그레인 COUNT(DISTINCT agentId)
      cost: number;
      tokens: number;
      costRows: number;
      share: number;
      subModels: {
        model: string;
        agents: number;
        cost: number;
        tokens: number;
        costRows: number;
        share: number;
        unattributed: boolean; // unknown/<synthetic>/하네스명 그대로 = 모델 미기록
      }[];
      hasDecomposition: boolean;
    }[];
    totalCost: number;
    totalAgents: number;
    note: string;
  };
  modelRoleStats: {
    model: string;
    role: string;
    total: number;
    succeeded: number;
    successRate: number;
    avgDurationMs: number;
    avgCost: number;
    costEfficiency: number | null; // successRate / avgCost (avgCost 0/미기록이면 null)
  }
  [];
  routing: {
    // dispatch:decision 라우팅 결정 분포 (metadata JSON_VALUE 파싱)
    bySelectedModel: {
      key: string;
      count: number;
    }
    [];
    byDecisionReason: {
      key: string;
      count: number;
    }
    [];
    byReuseVsSpawn: {
      key: string;
      count: number;
    }
    [];
    byModelSelectionMode: {
      key: string;
      count: number;
    }
    [];
  }
}
```

> `dispatch:decision` 은 renderer union 에 없어 `events.metadata`(JSON STRING) 로 접혀 저장됨 → `JSON_VALUE(metadata,'$.selectedModel')` 등으로 파싱. 키셋: `selectedModel·decisionReason·reuseVsSpawn·modelSelectionMode` (그 외 `perModelScores`/`tags`/`eligibleModels` 는 향후 확장).

---

## 4. `getAdminDrilldown` — 차트 클릭 → 상세 분해

대시보드 차트는 전부 집계치라 "왜 이 날 튀었나"를 답하지 못한다. 이 콜러블은 **하루** 또는 **세그먼트 하나**를 받아 그 조각만 다시 분해한다.

**Request (둘 중 하나):**

```ts
{ scope: "usage:day" | "spawn:day" | "cost:day" | "subscription:day",
  date: "YYYY-MM-DD",   // UTC 기준 하루. 형식 위반 시 invalid-argument
  days?: number }

{ scope: "segment:event" | "segment:model" | "segment:role"
       | "segment:plan"  | "segment:status" | "segment:provider",
  key: string,          // 1~200자. 위반 시 invalid-argument
  days?: number }
```

**Response — 스코프 불문 동일한 제네릭 봉투.** UI 모달이 스코프 분기 없이 그대로 렌더한다.

```ts
{
  scope: string;
  date: string | null; // day 스코프면 에코, 아니면 null
  key: string | null; // segment 스코프면 에코, 아니면 null
  rangeDays: number;
  generatedAt: string;
  title: string; // 모달 제목(서버 생성)
  note: string; // 출처·기준 캡션
  stats: {
    label: string;
    value: number;
    format: Fmt;
  }
  [];
  breakdowns: {
    title: string;
    rows: {
      key: string;
      count: number;
    }
    [];
    format: Fmt;
  }
  [];
  trend: {
    date: string;
    value: number;
  }
  [] | null;
  trendLabel: string | null;
  trendFormat: Fmt;
}
// Fmt = "int" | "cost" | "pct" | "duration" — 클라가 포매터를 고르는 토큰.
```

스코프별 소스:

| scope                          | 소스                                     | 분해 축                                   |
| ------------------------------ | ---------------------------------------- | ----------------------------------------- |
| `usage:day`                    | `events`                                 | 이벤트/역할/모델/앱버전/시간대(UTC)       |
| `spawn:day`                    | `events` (`agent:spawned`)               | 역할/모델/앱버전/시간대                   |
| `cost:day`                     | `cost_logs`                              | 모델별·태스크유형별·시간대별 비용         |
| `subscription:day`             | Firestore `subscriptions`                | 신규·이탈 × 플랜/결제수단, 당일 마감 활성 |
| `segment:event`                | `events`                                 | 모델/역할/앱버전 + 일별 발생 추이         |
| `segment:role`                 | `events` + `task_outcomes`               | 모델/이벤트/앱버전 + 성공률·평균시간      |
| `segment:model`                | `cost_logs` + `task_outcomes` + `events` | 태스크유형별 비용·역할별 건수 + 일별 비용 |
| `segment:plan/status/provider` | Firestore `subscriptions`                | 상태/플랜/결제수단 교차 + 활성 추이       |

> 날짜 경계는 **UTC 반개구간** `[TIMESTAMP(@date), +1 DAY)` — 상위 차트의 `FORMAT_DATE('%F', DATE(timestamp))` 와 같은 기준이고 파티션 프루닝도 유지된다. 모달 캡션이 "UTC 기준"을 명시한다.

---

## 5. `getAdminOnboardingFunnel` — 온보딩 "첫 10분" 활성화 퍼널 (🟡 BQ, 옵트인 표본)

소스: BQ `events` (온보딩·auth·spawn·crash 이벤트만 IN 절로 좁혀 단일 스캔). 티켓 `zvTXXZj1`.
배경: `docs/beta-churn-root-cause-analysis-2026-07-21.md`(퍼널 정의) · `docs/onboarding-telemetry-live-verify-3018-2026-07-21.md`(이벤트 페이로드 실 스키마).

**Request:** `{ days?: number, includeAdmin?: boolean }`

**Response:**

```ts
{
  rangeDays: number;
  generatedAt: string;
  adminExcluded: {
    applied: boolean;
    uidFiltered: boolean;
    clientIdCount: number;
  }
  // 본선 6단계 — 각 단계 "도달 고유 clientId"(clients)와 이벤트 발생량(events).
  // ★엄격 순차 아님(도달 기준). dropFromPrev 는 직전 단계 대비 감소(≥0 clamp).
  //   비단조(folder_connected=0 인데 orchestrator_opened>0=resume 경로)면 drop=0.
  // isMaxDrop = 최대 이탈 구간 1곳(★22→6 같은 활성화 절벽).
  steps: {
    key: "first_run" |
      "login_attempt" |
      "login_success" |
      "folder_connected" |
      "orchestrator_opened" |
      "agent_spawned";
    event: string; // 소스 이벤트명
    label: string;
    clients: number;
    events: number;
    dropFromPrev: number | null; // 첫 단계=null
    dropRateFromPrev: number | null; // dropFromPrev / prev.clients
    isMaxDrop: boolean;
  }
  [];
  // 실패-분기(퍼널 밖 이탈 사유) — errorCategory 로 세분.
  // ★orchestrator_blocked 는 cli_auth vs launch_error 로 분해된다.
  failureBranches: {
    key: "loginFailed" |
      "folderConnectFailed" |
      "orchestratorBlocked" |
      "agentCrashed";
    event: string;
    label: string;
    clients: number;
    events: number;
    byCategory: {
      key: string;
      count: number;
      clients: number;
    }
    []; // count 내림차순
  }
  [];
  note: string; // 측정 방법·한계(auth-gated flush, 비단조 resume) 고지 문자열
}
```

> 페이로드 매핑(실 스키마): `orchestrator_blocked` 의 reason·`agent:crashed` 의 errorCategory·`login_failed` 의 code 는 전부 events 테이블 **top-level `errorCategory` 컬럼**(metadata 아님). `folder_connected.mode`·`orchestrator_opened.resumed`·`login.method` 는 `metadata` JSON.
> 순수 집계·이탈 계산은 `v3/functions/src/adminAnalytics.ts`(`buildOnboardingFunnel`)로 분리 — `npm run test:admin-analytics`(node:test, devDep 무추가)로 단위검증.

---

## 6. `getAdminReleaseHealth` — 앱 빌드/릴리스·버전 헬스 (🟡 BQ, 옵트인 표본)

소스: BQ `events` — **`appVersion` 컬럼**.

> ★**전용 이벤트가 없다.** `lifecycle:app-version` 같은 버전 이벤트는 존재하지 않는다. 앱 버전은 `telemetryService` 가 flush 시 **모든 이벤트에 부착하는 `appVersion` 컬럼**이라, 이 콜러블은 이벤트 필터가 아니라 컬럼 `GROUP BY` 파생이다.

**Request:** `{ days?: number, includeAdmin?: boolean }`

**Response:**

```ts
{
  rangeDays: number;
  generatedAt: string;
  adminExcluded: { applied: boolean; uidFiltered: boolean; clientIdCount: number };
  versions: {
    version: string;      // 미기록(NULL)은 '(미기록)' 라벨
    isSemver: boolean;    // semver 로 해석됐나(정렬·최신 판정 가능 여부)
    isCi: boolean;        // 'github-actions' = CI 스모크 발신(사용자 설치본 아님)
    clients: number;      // 고유 clientId(익명)
    events: number;
    sessions: number;     // session:started
    spawned: number;      // agent:spawned
    crashed: number;      // agent:crashed
    crashRate: number | null; // crashed / spawned. 스폰 0 이면 null('데이터 없음')
    firstSeen: string;    // YYYY-MM-DD
    lastSeen: string;
  }[];                    // semver 최신순 → 라벨 → '(미기록)' 순
  adoption: {
    dates: string[];                                    // 공통 x축(오름차순)
    series: { version: string; values: number[] }[];    // dates 와 길이 동일(결측=0)
  };
  totals: { versions: number; spawned: number; crashed: number; crashRate: number | null };
  note: string;
}
```

> **해석 주의:** `(미기록)` 은 `appVersion` 주입 이전 텔레메트리, `github-actions` 는 CI 스모크 발신이라 **둘 다 실사용 릴리스가 아니다**. `crashRate` 는 스폰 0 인 버전에서 `0` 이 아니라 `null` 이다(0% 로 오도 금지). 이 섹션이 다루는 것은 **에이전트 크래시 이벤트** 기반 안정성이고, 앱 자체의 예외/스택트레이스는 Sentry 연동(별도·미구현) 영역이다.

순수 조립은 `adminAnalytics.buildReleaseHealth` (BQ 무의존, `npm run test:admin-analytics`).

---

## 7. `getAdminBetaSegmentUsage` — 베타/파운더 grant 세그먼트 사용패턴 (🟢 모수 + 🟡 행동지표)

티켓 TdlWmESR. 설계 상세는 [v3/docs/ADMIN-BETA-SEGMENT-ANALYTICS.md](../v3/docs/ADMIN-BETA-SEGMENT-ANALYTICS.md).

**모수**: Firestore `subscriptions.founderGrant === true`. 세그먼트는 `founderGrantReason` 으로 가른다(`paymentProvider` 로 판정 금지 — founder_grant stomp). **활동 identity** 는 `getAdminActiveUserMetrics` 와 동일 규약: `events.metadata.accountUserId ∪ cost_logs.userId`(`events.userId` 는 익명 clientId 라 미사용).

**Request:** `{ days?: number, includeAdmin?: boolean }`

**Response:**

```ts
{
  rangeDays: number;
  generatedAt: string;
  adminExcluded: { applied: boolean; uidFiltered: boolean; clientIdCount: number };
  queryStatus: { ok: boolean; errors: { name: string; error: string }[] };
  minCohortSize: number;              // k-익명성 임계(5)
  grantCohortSize: number;            // grant 보유자 총원(🟢 Firestore)
  observedUsers: number;              // 그중 관측된 계정 수
  accountAttributionAvailable: boolean; // false = 계정귀속 이벤트 0 → 텔레메트리 ON 선행
  segments: BetaSegmentSummary[];     // 코호트 0 인 세그먼트는 생략
  all: BetaSegmentSummary;            // 전 세그먼트 롤업
}

type BetaSegmentSummary = {
  key: "founder_backfill" | "beta_selected" | "beta_signup" | "other" | "all";
  label: string;
  cohortSize: number;                 // 🟢 텔레메트리 무관하게 정확
  observedUsers: number;
  observedRate: number | null;        // 분모 0 → null (0% 로 오도 금지)
  suppressed: boolean;                // 관측 < minCohortSize → 행동지표 비공개
  suppressionReason: string | null;
  // ↓ suppressed=true 면 전부 [] / null
  featureUsage: { event: string; users: number; count: number }[];
  sessions: { sessions; sessionsPerUser; avgDurationMs; medianDurationMs } | null;
  rhythm: { avgActiveDays; returningUsers; returningRate; avgSpanDays } | null;
  adoption: { orchestratorUsers; spawnUsers; ticketUsers; ...Rate } | null;
};
```

> **★프라이버시:** 응답에 uid·이메일 등 식별자는 어떤 필드로도 포함되지 않는다. 관측 계정이 `minCohortSize` 미만인 세그먼트는 **행동지표를 통째로 억제**한다(카운트만 유지) — 수십 명 규모 베타에서 세그먼트를 쪼개면 행동지표가 개인 지목으로 퇴화하기 때문. 운영자 본인도 grant 보유자라 `includeAdmin=false`(기본)면 **명단 단계에서** 제외해 BQ 로도 넘기지 않는다.

> **★해석 주의:** `accountAttributionAvailable=false` 면 `featureUsage`/`sessions`/`adoption` 의 공백은 "안 썼다"가 아니라 **"측정되지 않았다"**다(`metadata.accountUserId` 는 2026-08-06 적재 시작 + 프로덕션 텔레메트리 기본 OFF). 반면 `grantCohortSize`/`observedUsers` 는 Firestore·`cost_logs` 기반이라 그 상태와 무관하게 정확하다. `session:ended` 는 정상 종료에서만 발사되므로 세션 길이는 clean-exit 표본이다(강제종료·크래시 누락 → 과소집계 가능).

순수 조립은 `betaSegments.buildBetaSegmentUsage` (BQ/Firestore 무의존, `npm run test:beta-segments`).

---

## 범위 밖 (기획 §2.3 / §6 후속 티켓)

- **안정성/에러 KPI(🔴):** Sentry 미설치 → v1 제외. 대시보드 안정성 섹션은 "미연동" 고정(T0-2/T3-6).
- **계정↔사용 조인:** events=익명 clientId, 매핑 테이블 없음 → 계정 단위 활성/리텐션 불가(§1.6).
- **에이전트 트리·fast_fail·per-task cost delta·taskType 분류·prompt 임베딩:** 데이터 보강 선행 필요(Phase 3, T3-1~T3-5).
- **리텐션(D1/D7/D30) 코호트:** clientId 기준만 가능, v1 미포함(T3-7 고도화).

## 검증

- `cd v3/functions && npm run build` (tsc strict) 통과.
- 프론트: `marblo-web` tsc `--noEmit` + `eslint` + `next build` 통과. 차트 값 라벨·기간 컨트롤(7/30/90/커스텀)·드릴다운 모달은 픽스처 프리뷰 페이지로 헤드리스 렌더 확인(라벨 미충돌, 커스텀 입력 365 클램프, Esc/오버레이 클릭 닫기, body 스크롤 락 복원).
- 배포: `firebase deploy --only functions --project marblo-2253d` (env `.env.marblo-2253d` 단일소스, BQ 마이그레이션 불필요 — 신규 조회 콜러블만).
