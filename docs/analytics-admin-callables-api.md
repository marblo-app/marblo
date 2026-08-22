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
    // ★조회창 안에 metadata.accountUserId 가 **남아 있는 행 수**(실측, ticket 4KqBDPkH).
    //   events 제외절은 그 필드로만 거르는데 계정축 은퇴 이후 row 에는 필드가 없다.
    //   0 이면 applied:true 여도 실제로는 한 행도 안 빠진다 — 화면은 그때 "제외됨"
    //   이라고 말하면 안 된다. null = 측정 실패(단정 금지).
    matchableRows: number | null;
  }
  // 부분 쿼리 실패 상태 — 서버 러너는 개별 쿼리 실패를 삼키고 빈 배열을 준다.
  // ok=false 면 그 칸의 0 은 "정말 0" 이 아니라 "못 읽음" 이다.
  queryStatus: {
    ok: boolean;
    errors: {
      name: string;
      error: string;
    }
    [];
  }
  // 전 구간 13단계 — 각 단계 "도달 고유 clientId"(clients)와 이벤트 발생량(events).
  // ★엄격 순차 아님(도달 기준). dropFromPrev 는 직전 **gating** 단계 대비 감소
  //   (≥0 clamp). 비단조(folder_connected=0 인데 orchestrator_opened>0=resume
  //   경로)면 drop=0. conversionFromPrev = 1 − dropRateFromPrev(같은 분모).
  // ★gating=false 는 화면에만 있고 하류 기준선이 아닌 칸이다(티켓 ygoWP1VJ):
  //   first_conversation·first_ticket 은 계측이 늦게 생겨, first_merge 는 7일 창이라
  //   본선과 축이 다르다. 체인에 끼우면 그 뒤가 통째로 0 이 되어 계측 공백이 제품
  //   실패로 둔갑한다. isMaxDrop 후보도 reach ∧ gating 칸으로 한정.
  // ★install 은 전용 이벤트(app:installed)가 아직 한 번도 발신된 적이 없어
  //   COALESCE(app:installed, app:first_run) 으로 채운다 — 사실상 first_run 과 같다.
  steps: {
    key: "install" |
      "first_run" |
      "login_attempt" |
      "login_success" |
      "folder_connected" |
      "orchestrator_opened" |
      "first_conversation" | // onboarding:first_conversation (gating=false)
      "first_ticket" | // onboarding:first_ticket (gating=false)
      "agent_spawned" |
      "task_completed" |
      "first_merge" | // task:merged, 7일 창 (gating=false)
      "core_experience" |
      "retained_7d";
    event: string; // 소스 이벤트명
    label: string;
    kind: "reach" | "activation";
    gating: boolean;
    clients: number;
    events: number;
    dropFromPrev: number | null; // 첫 단계=null
    dropRateFromPrev: number | null; // dropFromPrev / prevGating.clients
    conversionFromPrev: number | null; // 직전 gating 대비 전환율
    conversionFromStart: number | null; // 최초 단계(install) 대비 누적 전환율
    isMaxDrop: boolean;
    // ★계측 커버리지 (ticket 4KqBDPkH) — 이 칸의 clients 를 믿어도 되는가.
    //   "missing" = 그 이벤트가 **전기간 한 번도** BQ 에 관측된 적이 없다.
    //   "partial" = 처음 관측된 날이 조회창 시작보다 늦다(창 앞부분에 신호 없음).
    //   두 경우의 0 은 "안 했다"가 아니라서, 화면은 숫자 대신 '미수집'/'부분 구간'을
    //   그린다. 커버리지 쿼리가 실패하면 판정을 포기하고 전 칸 "ok" 로 둔다.
    //   ★BQ 가 아는 건 '최초 관측일' 뿐이다 — 계측이 늦게 생긴 것인지 그때까지
    //     아무도 안 한 것인지는 이 축만으로 못 가른다. 라벨도 그렇게 적혀 있다.
    coverage: "ok" | "partial" | "missing";
    firstObservedDay: string | null; // 전기간 최초 관측일(YYYY-MM-DD)
    // 순차 체인을 **무시하고** 조회창 안에 그 이벤트를 낸 고유 설치 수(BQ 원값).
    // clients 와 벌어지면 그 0 은 제품 실패가 아니라 정의의 한계다.
    everInWindow: number | null;
  }
  [];
  // 실패-분기(퍼널 밖 이탈 사유) — errorCategory 로 세분.
  // ★orchestrator_blocked 는 cli_auth vs launch_error 로 분해된다.
  // ★스톨 3종(needsAuth/authedButUnfunded/spawnBlocked)은 전진 단계가 아니라 여기
  //   있다 — 스폰하려다 인증에 막힌 사람을 전진한 것으로 세면 안 되기 때문이다.
  //   needsAuth.clients 는 **철회 보정 전** 원수치다(철회분을 뺀 값은 KPI 코크핏의
  //   onboardingStall.needsAuth.unresolvedAgents).
  failureBranches: {
    key: "loginFailed" |
      "folderConnectFailed" |
      "orchestratorBlocked" |
      "agentCrashed" |
      "spawnBlocked" |
      "needsAuth" |
      "authedButUnfunded";
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
  // ★헤드라인 활성화율. everActivatedInWindow 는 순차 정의를 무시하고 같은 창에서
  //   task:completed 를 실제로 낸 고유 설치 수(실측) — 0% 가 "아무도 완주 안 했다"로
  //   읽히는 걸 막는 유일한 근거다. 커버리지 쿼리가 없으면 null.
  headline: {
    activatedClients: number;
    baseClients: number;
    rate: number | null;
    windowMinutes: number;
    label: string;
    everActivatedInWindow: number | null;
  };
  note: string; // 측정 방법·한계(auth-gated flush, 비단조 resume) 고지 문자열
}
```

### ★단계 ↔ 이벤트 ↔ BQ 실측 대조표 (2026-08-22, 조회창 30일, 운영자 제외절 적용)

티켓 `4KqBDPkH` 에서 실측했다. "화면 순차값" 은 사장님이 보신 그 숫자이고,
"창 안 실측" 은 순차 체인을 무시하고 그 이벤트를 낸 고유 설치 수다.

| 단계 | 이벤트 | 전기간 최초 관측일 | 창 안 실측 | 화면 순차값 | 커버리지 |
| --- | --- | --- | --- | --- | --- |
| 설치 | `app:installed` | **없음(전기간 0건)** | — | 7 (first_run 대체) | `missing` |
| 앱 최초 실행 | `app:first_run` | 2026-04-18 | 7 | 7 | ok |
| 로그인 시도 | `auth:login_attempt` | 2026-04-19 | 5 | 5 | ok |
| 로그인 성공 | `auth:login_success` | 2026-04-19 | 5 | 5 | ok |
| 폴더 연결 | `onboarding:folder_connected` | 2026-04-19 | 6 | 2 | ok |
| 오케 오픈 | `onboarding:orchestrator_opened` | 2026-04-19 | 7 | 2 | ok |
| 첫 대화 | `onboarding:first_conversation` | **2026-08-10** | **4** | **0** | `partial` |
| 첫 티켓 생성 | `onboarding:first_ticket` | **2026-08-09** | **3** | **0** | `partial` |
| 에이전트 스폰 | `agent:spawned` | 2026-04-18 | 6 | 2 | ok |
| 첫 티켓 완료 | `task:completed` | 2026-06-17 | 2 | 0 | ok |
| 첫 머지 | `task:merged` | 2026-07-20 | 1 | 0 | ok |
| 7일 잔존 | `session:started` | 2026-04-19 | 10 | 0 | ok |
| (실패) 스폰 사전 차단 | `onboarding:spawn_blocked` | 2026-08-13 | 2 | — | `partial` |
| (실패) CLI 인증 스톨 | `onboarding:agent_needs_auth` | **없음(전기간 0건)** | — | 0 | `missing` |
| (실패) 크레딧 없음 | `onboarding:funding_guide_shown` | **없음(전기간 0건)** | — | 0 | `missing` |

★**"첫 대화 0 / 첫 티켓 0 / 스폰 2" 의 정체.** 계측이 빠진 게 아니다. 두 칸의 판정식이
`reached_orchestrator_opened AND ts BETWEEN orchestrator_opened_ts AND login_success_ts + 24h`
라서, 첫 대화를 낸 4설치 중 **3개는 조회창 안에 `auth:login_success` 자체가 없고**(그 전에
로그인함) 1개는 **로그인 +289시간 뒤**에 대화해 창 밖으로 버려진다. 스폰 2는 오케 오픈 2의
부분집합이라 체인상 모순이 아니다 — 거짓인 쪽은 0 이다.

★**활성화율 0.0% (0/5).** 그 정의(창 안에 로그인한 설치 중 24h 내 완료) 안에서는 **사실**이다.
다만 같은 창에서 `task:completed` 를 실제로 낸 설치는 **2개** 있고, 둘 다 로그인이 창 밖이라
분모에 없다. 화면은 `everActivatedInWindow` 로 그 차이를 밝힌다.

★**운영자(존킴) 제외는 이 축에서 사실상 작동하지 않는다.** 30일 302,660행 중 `accountUserId`
가 남아 있는 행은 51,031행이고 **그 마지막 날짜가 2026-08-10** 이다 — 최근 구간은 한 행도
제외되지 않는다. `adminExcluded.matchableRows` 가 그 사실을 화면에 드러낸다.

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

## 8. `getAdminStreakRetention` — D7·D14 리텐션 + 연속사용 스트릭 (🟡 BQ)

`{ days?: number, includeAdmin?: boolean }` → `{ rangeDays, generatedAt, historyDays, adminExcluded, install, account }`.
`install` / `account` 는 같은 shape(`StreakRetentionAxisResult`)의 **별개 축**이다 — 한 표에
섞지 않는다(설치 ≠ 사람 ≠ 계정. 실측에서 계정 1개가 설치 9대를 썼다).

지금까지 D7·D14 는 사람이 BQ 를 직접 쳐야만 나왔다(분석 티켓 `9Ns5DYu2hTXlGimIUI8N`).
그 조회를 화면으로 옮긴 콜러블이다. 위 `getAdminRetentionCohorts` 와 다른 점 셋:

1. **활동 정의가 다르다.** 그쪽은 "행이 있었는가", 여기는
   `status="working"` 하트비트 ≥1 **또는** 이벤트 ≥1.
   > ★실측에서 어떤 설치가 14일 중 13일 "활동"으로 잡혔는데 하트비트 35,170건 중
   > `working` 이 0건, 이벤트도 0건인 **좀비 프로세스**였다. 하트비트 존재를 세면
   > 이런 게 코호트에 들어와 숫자를 부풀린다. 좀비는 활동일이 0 이 되어 정의만으로
   > 코호트에서 빠지고, 화면에는 `zombie` 플래그로 남아 **왜 빠졌는지**가 보인다.
2. **비율이 홀로 나가지 않는다.** 모든 값은
   `{ numerator, denominator, rate, display: "1/2 (50.0%)" }`. `rate` 단독 필드는 없다.
   분모 0 이면 `rate=null` / `display="0/0 (—)"` — **0% 가 아니라 판단 불가**다.
   > ★실측 계정이 5개, 유의미 사용이 2개다. 이 화면의 가장 큰 위험은 작은 표본을
   > 퍼센트로 크게 보여주는 것이다.
3. **관측창 미도달을 분모에서 뺀다.** 가입 3일차에게 D7 을 물으면 무조건 이탈로
   찍히므로, 판정 불가한 유닛은 `pending` 으로 따로 센다.

`horizons[]` 는 D1/D7/D14/D30 각각에 대해 **두 정의를 다 낸다** — 업계에 둘 다 쓰이고,
표본이 작을수록 갈려서 어느 쪽을 인용하느냐가 결론을 뒤집는다:

| 필드 | 정의 |
| --- | --- |
| `exact` | 첫 활동일 **+N일 당일**에 활동 (bracket/classic) |
| `window` | 첫 활동일 다음날 ~ +N일 **사이 하루라도** 활동 (rolling/range) |

축별 소스와 한계:

| 축 | 소스 | 한계 |
| --- | --- | --- |
| `install` | `agent_heartbeats`(working/전체) + `events` | `userId` 는 익명 설치 ID. 운영자 제외가 **불완전**하다(아래) |
| `account` | `cost_logs.userId` (Firebase uid) | 유일한 계정 축. `events.metadata.accountUserId` 는 실측상 2026-08-06~08-10 **5일간 uid 1개**에만 존재해 쓸 수 없고, `flow_executions` 는 코드상 계정 축이 맞지만 **row 0** |

**2026-06-13 식별자 스킴 교체.** 그 전 설치 id 는 Firebase uid(28자), 이후는 UUID(36자)다.
`identityScheme` 요약과 유닛별 `legacyIdScheme` / `suspectedIdSwitchChurn` 플래그로 경계를
표시한다.
> ★이 경계를 넘겨 이어붙이면 **같은 사람이 이탈한 것처럼 보인다** — 실측에서 실제로
> 그렇게 보였다. 그렇다고 두 id 를 같은 사람으로 잇지도 않는다(근거 없이 동일인이라
> 단정하는 쪽이 더 위험하다). 끊긴 것을 끊긴 채로 두고, **왜 끊겼는지**를 표시한다.

**`includeAdmin` 토글**(기본 false=제외)은 이 지표에도 걸린다. 계정 축은 uid 로 정확히
빠진다. 설치 축은 익명 세계에 uid 가 없어 `agent_heartbeats.agentId ↔ cost_logs.agentId`
다리로 역추적하고, 2026-06-13 이전 설치 id(=uid 그 자체)는 직접 뺀다.
> ★그 다리는 2026-08 부터 익명 세계의 `agentId` 가 HMAC 가명이라(`analyticsPseudonym.ts`)
> **가명화 이전 과거 row 에서만** 걸린다. 즉 설치 축의 운영자 제외는 불완전하고
> 시간이 지날수록 더 불완전해진다. 숨기지 않고 `mapping.unmappedInstalls` 와
> `adminExcluded.clientIdCount` 로 드러낸다 — 조용히 "제외했다"고 말하는 쪽이 더 위험하다.
> 실측상 운영자가 전체 cost 행의 **99.95%** 라 포함/제외에 따라 화면이 완전히 달라진다.

**원시 식별자는 응답에 없다.** uid/UUID 는 함수 안에서만 살고, 밖으로 나가는 것은
`analyticsUnitLabel` 이 만든 안정 라벨(`I-3f9a1c` / `A-7c21bd` = `sha256("v1:axis:raw")`
앞 6자리)뿐이다. 순번이 아니라 해시인 이유는 **다음 조회에서도 같은 사람이 같은 라벨**
이어야 시계열 추적이 되기 때문이다 — 순번은 조회 창이 바뀌거나 신규 유닛이 끼면 통째로
밀린다. 규칙은 `ANALYTICS_LABEL_VERSION` 으로 고정한다.

`historyDays=400` 전 구간으로 첫 활동일·최대연속을 계산하고, `days` 는 D7/D14 표에 넣을
코호트만 고른다(창을 자르면 창 시작일이 첫 활동일로 둔갑한다). 코호트 창 밖 유닛은
`unitsBeforeWindow` 로 세어서 내보낸다 — 조용히 빼면 인원이 줄어 보인다.

순수 조립은 `adminAnalytics.buildStreakRetention` (BQ/Firestore 무의존,
`npm run test:admin-analytics`).

---

## `buildAnalyticsProfileTables` · `scheduledBuildAnalyticsProfiles` (티켓 EJrLwysi)

파생 분석 테이블 3종을 **다시 만든다**(멱등). 원본은 읽기만 한다.

| | |
| --- | --- |
| 스케줄 | 매일 05:30 KST |
| 수동 | `buildAnalyticsProfileTables({ windowDays?: number })` — 어드민 전용 |
| 응답 | `{ today, windowDays, dailyRows, installProfiles, accountProfiles, skipped[], notes[] }` |

만드는 테이블:

- `analytics_user_daily` — **익명축** `install_key` × `day`
- `analytics_install_profile` — **익명축** 설치당 1행
- `analytics_account_profile` — **계정축** 계정당 1행

★**익명축과 계정축은 조인하지 않는다. 조인 키를 만들지도 마라.** 근거는 배포된
개인정보처리방침 — *"두 기록이 공유하는 조인 키는 없습니다"*
(`v3/src/components/legal/privacyContent.tsx:95`, EN `:210`). 계정축 **안에서의** 조인
(`analytics_account_profile` ↔ `cost_logs` ↔ `analytics_purchase`)은 허용된다.

스키마·정의·컬럼별 축 감사는 `docs/analytics-profile-tables.md` 에 전부 있다. 특히:

- `active` = `status="working"` 하트비트 ≥1 **또는** 이벤트 ≥1 (하트비트 존재로 세지 않는다).
  좀비는 `present_only` 로 격리된다.
- D1/D3/D7/D14/D30 은 **exact / window 두 정의를 다 저장**하고, 관측창 미도달은 `pending`
  으로 분모에서 뺀다.
- 캐시 지표·비용·`is_admin` 은 **계정축에만** 있다 — `cacheReadTokens` 는 `cost_logs` 에만
  존재하기 때문이다.

`assertAxisPurity()` 가 테이블 생성 **전에** 반대 축 컬럼을 검사하고 던진다(BigQuery 는 만든
컬럼을 지울 수 없다).

## `getAdminInstallRetentionSummary` (티켓 EJrLwysi)

`analytics_install_profile` 을 읽어 지평별 **분자·분모**를 돌려준다. 화면이 각자 SQL 로 분모를
세면 정의가 갈라지므로 세는 곳을 한 군데로 모은 것이다(`summarizeInstallRetention`).

```
{
  installsObserved,
  installsNeverActive,          // = installsZombie + installsNeverRan
  installsZombie,               // 하트비트는 왔는데 working·이벤트 0 (떠 있던 프로세스)
  installsNeverRan,             // 어트리뷰션만 있고 신호 자체가 없음 (안 온 사람)
  installsCohort,               // ★모든 분모의 뿌리
  horizons: [{ key:"d7", days:7, pending, exact:{numerator,denominator,rate,display}, window:{...} }],
  activityDefinition, presentOnlyDefinition, horizonDefinitions, notes[]
}
```

`installsZombie + installsNeverRan + installsCohort === installsObserved` 가 항상 성립한다.
프로필은 **활동이 없는 설치도** 행을 만든다 — 안 그러면 "다운로드는 했는데 한 번도 안 쓴
사람" 이 사라져 활성화 퍼널 분모가 무너진다(2026-08-21 실측: 558 vs 8).

분모 0 이면 `rate` 는 `0` 이 아니라 `null`, `display` 는 `"0/0 (—)"` 다 — "아무도 안 돌아왔다"
와 "판단할 표본이 없다" 는 다른 말이다. 유의미 사용 표본이 지금 2개다.

순수 로직은 `analyticsProfiles.ts` (BQ/Firestore 무의존, `npm run test:analytics-profiles`).

★**2026-08-21 갱신.** 이 콜러블은 만들어진 뒤 한동안 **화면이 한 번도 부르지 않았다** —
파생표는 매일 05:30 KST 스케줄로 채워지는데 읽는 쪽이 없어 아무도 안 봤다. 어드민 4탭의
**③ 리텐션** 탭이 이제 이걸 부른다(`InstallRetentionSummaryView`).

호출 인자는 **없다.** 이 축에는 `is_admin` 이 없어 운영자 자기제외가 구조적으로 불가능하고
기간도 받지 않는다(프로필 전량 기준). ★없는 인자를 보내면 화면이 "걸러진다" 고 착각한다 —
그래서 프론트는 `{}` 를 보내고, 리텐션 탭 머리에 **"이 표는 운영자 포함 토글이 동작하지
않습니다"** 를 축 한계 고지로 적는다. 그리고 이 축의 분모는 스트릭 뷰(`getAdminStreakRetention`)
의 설치축과 **다르다**(저쪽은 조회 구간 코호트, 이쪽은 프로필 전량) — 두 수를 나눠 읽으면 안 된다.

---

## ★아직 없는 콜러블 둘 — 이름을 여기 박는다 (백엔드 티켓 `euSq4AwHJrxSagMCjXeM`)

`analytics_user_daily` 와 `analytics_account_profile` 은 **이미 매일 채워지고 있다**
(`scheduledBuildAnalyticsProfiles`, 05:30 KST). 없는 것은 소스가 아니라 **읽어 오는 콜러블**이다.
그래서 어드민 화면의 그 칸은 '적재 전' 이 아니라 **'연결 전'** 으로 접힌다 — 두 사실을 같은
말로 하면 다음 사람이 "적재부터 해야겠네" 로 읽고 이미 있는 표를 다시 만든다.

프론트는 **지금 이 이름으로 이미 호출하고 있다.** 백엔드가 이 이름으로 배포하는 순간
**프론트 변경 없이** 값이 들어온다. ★한쪽이 다른 이름을 쓰면 조용히 `undefined` 가 되고 화면은
영원히 '연결 전' 을 띄운다. 이름은 `AnalyticsPanel.tsx` 의 `CALLABLE_USER_DAILY` /
`CALLABLE_ACCOUNT_PROFILE` 상수이고 테스트가 문자열을 고정한다.

> ⚠️ **`functions/not-found` 로 미배포를 감지하는 방식은 브라우저에서 동작하지 않는다**
> (ticket `4KqBDPkH` 실측). 미배포 콜러블의 404 는 Google Frontend 가 내는 HTML 이라
> `Access-Control-Allow-Origin` 헤더가 없고, 브라우저는 preflight 에서 응답을 통째로 차단한다 →
> fetch 가 TypeError 로 끝나고 firebase-js-sdk 는 status 0 으로 보아 **`functions/internal`** 을
> 준다. 그래서 '연결 전'(회색 상태) 대신 **빨간 내부 오류**가 떴다.
>
> ```
> $ curl -sI -X OPTIONS https://us-central1-marblo-2253d.cloudfunctions.net/getAdminUserDailySummary \
>     -H "Origin: https://marblo.app" -H "Access-Control-Request-Method: POST"
> HTTP/2 404
> content-type: text/html; charset=UTF-8      ← ACAO 헤더 없음
> ```
>
> **판정은 에러 코드가 아니라 아래 매니페스트로 한다.** 프론트는 매니페스트에 없는 이름을
> **아예 호출하지 않고** '연결 전' 으로 접는다.

### `getAdminCallableManifest` — 이 배포본이 실제로 가진 어드민 콜러블 목록

인자 없음(`{}`). 응답:

```ts
{
  generatedAt: string;
  callables: string[]; // 이 배포본이 내보낸 getAdmin* 이름들(정렬)
}
```

★목록은 하드코딩하지 않는다 — CJS 로 컴파일되므로 실행 시점에 `module.exports` 를 읽는다.
그래서 "문서에는 있는데 구현이 없다"(2026-08-22 기준 `getAdminUserDailySummary` /
`getAdminAccountProfileSummary` 가 정확히 그 상태다)가 화면에 그대로 드러나고, 목록이
코드와 어긋날 방법이 없다. 매니페스트 자체가 미배포면 프론트는 예전처럼 그냥 호출해 본다.

### `getAdminUserDailySummary` — ② 활성화 (익명축, `analytics_user_daily`)

인자 `{ days }`. ★`includeAdmin` 을 **받지 마라** — 이 축엔 `is_admin` 이 없어 운영자
자기제외가 구조적으로 불가능하고, 인자를 받으면 화면이 "걸러진다" 고 착각한다.

```
{
  rangeDays, generatedAt,
  installsObserved,        // 구간에 행이 하나라도 있는 설치
  installsActive,          // active 인 날이 하루라도 있는 설치 ★분모의 뿌리
  installsPresentOnly,     // ★present_only 만 있고 active 0일 — 좀비. active 와 합치지 마라
  byDay: [{ day, activeInstalls, presentOnlyInstalls, eventCount, tokensTotal }],
  notes: [],
  personAxis?: PersonAxisCoverage,
}
```

### `getAdminAccountProfileSummary` — ④ 수익 (계정축, `analytics_account_profile`)

인자 없음(`{}`). 계정축이라 기간 창이 의미가 없다(프로필 전량).

```
{
  generatedAt,
  accountsObserved,
  accountsWithSpend,       // cost_logs 흔적이 있는 계정
  accountsWithMrr,         // ★mrr_usd 가 null 이 아닌 계정. 지금 0 이 정상이다
  mrrUsdTotal:  number | null,   // ★null = 미기입. 0 으로 접지 마라
  ltvUsdTotal:  number | null,
  costUsdTotal: number | null,
  notes: [],
}
```

★`mrr_usd` / `ltv_usd` 가 전부 null 인 것은 **적재 전**이다(`analytics_purchase` 대기).
표 자체가 매일 채워지는 것(→ 연결 전)과 그 금액 칸이 비어 있는 것(→ 적재 전)은 **다른 사실**이라
화면이 두 칸으로 나눠 그린다. 응답에서 `null` 을 `0` 으로 바꿔 보내면 그 구분이 무너진다.

### `getAdminPurchaseSummary` — ④ 수익 (실매출, `analytics_purchase`)

인자 없음(`{}`). ★기간 창을 받지 않는다 — 기간을 걸면 "이 기간엔 0" 과 "아예 0" 이
화면에서 구분되지 않는데, 지금 답해야 하는 질문은 후자다.

```
{
  generatedAt,
  state: "not_ingested" | "ingested",   // ★표가 없다 vs 표가 있다
  reason: string | null,                // not_ingested 인 이유. ingested 면 null
  revenue: {                            // ★not_ingested 면 통째로 null
    externalKrw,          // 실매출(외부 고객). state=ingested 면 0 도 **정확한 0**
    externalRows,
    internalRows,         // ★매출에서 뺀 내부(운영자) 결제 건수 — 화면에 보여야 한다
    grantRows,            // 무상 부여(founder_grant) 건수. 매출은 아니지만 경영 정보
    unclassifiedRows,     // account_class 가 null 인 행(표식 이전 / 운영자 축 미설정)
    amountUnknownRows,    // 금액 미상(환불·해지·부여). ★0 이 아니다
    totalRows,
  } | null,
  basis,                  // ★기준 라벨. 화면이 숫자 옆에 그대로 그린다
  notes: [],
}
```

★**`state` 가 이 응답의 전부다.** `not_ingested` 는 '적재 전' 이라 화면이 0 을 그리면
안 되고, `ingested` 의 `externalKrw: 0` 은 **측정된 0** 이라 반드시 0 으로 그려야 한다.
두 상태를 한 칸에 섞는 순간 "아무도 결제 안 했다" 와 "배선이 없다" 가 같은 그림이 된다.

★**갈라내되 지우지 않는다.** 내부·운영자 결제와 무상 부여는 `externalKrw` 에서 빠지지만
`internalRows` / `grantRows` 로 **건수가 그대로 보인다.** 숨기면 다음 사람이 "왜 결제가
하나도 안 잡히지" 로 같은 자리를 다시 판다.

★판정은 `analytics_purchase.account_class`(`internal` | `external` | `null`) 컬럼이 한다.
`internal` 은 **사람이 아니라 성격**이다 — 기존 운영자 축(`ADMIN_UID` → `is_admin`,
`adminExcluded`)을 가명키로 바꿔 비교하며, 운영자가 바뀌면 env 만 바뀐다.
`null`(미분류)은 external 로 접지 않는다 — 접으면 판정 실패가 '고객 결제' 로 승격된다.
★"PG 테스트키로 결제됐나" 는 원장에 표식이 없어 **판정할 수 없다**(채널·스토어 정보가
결제 문서에 저장되지 않는다). 그래서 이 컬럼이 뜻하는 것은 "테스트 채널" 이 아니라
**"내부(운영자) 계정"** 이다.

★응답에 개별 행·uid·이메일·주문번호는 없다. 건수와 합계뿐이다.

---

## `personAxis` — 사람 축 커버리지 봉투 (선행 티켓 `euSq4AwHJrxSagMCjXeM` **완료**)

> ★**2026-08-21 갱신.** 이 봉투는 이제 **실제로 실려 온다.** 서버가 싣는 자리는 아래
> 세 콜러블이고 값은 `personAxis.computePersonAxisCoverage()` 가 그대로 만든다.
> 창(`activeInstalls` 의 분모)은 각 콜러블이 보고 있는 기간을 쓴다 —
> `getAdminInstallRetentionSummary` 는 조회 창이 없어(프로필 전량) 파생표가 도는
> 창(90일)으로 센다. 창이 넓으면 분모가 커져 `complete` 가 늦게 뜰 뿐이라 **안전한
> 쪽으로** 틀린다.
> ★단 링크는 **forward-only** 라 배포 직후 `state` 는 `pending` 이 정상이다.
> 그리고 배포 머신에 `PERSON_AXIS_EFFECTIVE_FROM` 이 없으면 `disabled` 다 —
> 절차는 `v3/docs/person-axis-activation-2026-08-21.md` §6.

설계 §10.3. 사람 축을 쓰는 **모든** 응답에 실린다. 프론트는 이 필드를 **옵셔널**로 읽고,
`getAdminInstallRetentionSummary` → `getAdminStreakRetention` → `getAdminRetentionCohorts`
순으로 처음 있는 것을 쓴다. **없으면 상태가 아니라 배선 전**이라 기존 '적재 전' 규약으로 접힌다 —
그래서 프론트와 백엔드의 머지 순서가 어느 쪽이든 화면이 깨지지 않는다.

```
personAxis?: {
  state: "disabled" | "pending" | "ingesting" | "complete",   // ★넷이다
  disabledReason: string | null,   // disabled 일 때만. 화면이 이 문장을 그대로 그린다
  linkedInstalls, totalInstalls,
  linkedActiveInstalls, activeInstalls,   // ★complete 판정은 이 두 수로 한다
  excludedSharedInstalls,          // 공용 기기로 판정돼 제외된 설치 수 (설계 §5.5)
  effectiveFrom: string | null,    // 소급 상한. 게이트가 닫혔으면 null
  basis: "since_link" | "all_time",
  lastLinkedAt: string | null,
}
```

값은 `personAxis.computePersonAxisCoverage()` 가 그대로 만든다 — 프론트는 계산하지 않는다.

★**전용 콜러블은 없다.** 같은 사실에 두 경로가 생기면 어느 쪽이 맞는지 화면이 스스로
못 말한다. 사람 축만 따로 폴링해야 할 화면이 생기면 그때 후속 티켓으로 낸다.

★**서버가 봉투를 못 만들면 `null` 을 싣는다**(던지지 않는다). 0 으로 채우면 화면이
"사람이 없다" 로 읽고, 던지면 리텐션 탭 전체가 죽는다. `null` 이면 프론트가 다음
콜러블의 봉투로 넘어가고, 셋 다 없으면 '배선 전' 으로 접힌다.

화면이 이 봉투로 하는 일(설계 §10.4 화면 규칙 일곱):

| 규칙 | 화면 |
| --- | --- |
| 1 | `state !== "complete"` 면 퍼센트를 헤드라인으로 안 그린다 — 분수만 (`personAxisHeadlineAllowed`) |
| 2 | 분모 라벨은 "전체 설치" 가 아니라 **"링크된 설치"** |
| 3 | `ingesting` → `IngestionProgress` ("활동한 설치 14대 중 6대 연결됨 · 남은 8대는 다음에 인증할 때") |
| 4 | "이 수치는 아직 커집니다 — 캡처해서 비교하지 마세요" 를 먼저 말한다 |
| 5 | ★`basis` 를 그대로 배지로 (`연결 이후 기준` / **`설치 전체 이력 기준(소급)`**). 라벨 없는 사람 축 숫자 금지 |
| 6 | `pending`(커버리지 0) 은 새 상태를 만들지 않고 기존 `PendingIngestion` 재사용 |
| 7 | 조회 구간이 `effectiveFrom` 왼쪽으로 뻗으면 `AxisLimitNote` + 그 날짜에 점선(06-13 경계선과 같은 장치) |

★`disabled`(넷째 상태)는 설계 §10.3 의 셋에 없던 것이다 — 게이트가 닫힌 것은 '적재 전' 이
**아니다.** 소스가 없는 게 아니라 아직 열면 안 되는 것이고, 같은 말로 그리면 화면이
"곧 채워집니다" 라는 거짓 기대를 만든다. 배지 문구가 다르다(`아직 열지 않음`).

★**forward-only.** 링크는 그 설치가 **다음에 인증할 때** 생긴다. 배포 직후 커버리지가
0 에 가까운 것이 정상이고, 화면이 그 사실을 적는다(`PERSON_AXIS_FORWARD_ONLY_NOTE`) —
안 적으면 "켰는데 왜 비어 있지" 로 읽힌다.

---

## 범위 밖 (기획 §2.3 / §6 후속 티켓)

- **안정성/에러 KPI(🔴):** Sentry 미설치 → v1 제외. 대시보드 안정성 섹션은 "미연동" 고정(T0-2/T3-6).
- **계정↔사용 조인:** events=익명 clientId, 매핑 테이블 없음 → 계정 단위 활성/리텐션 불가(§1.6).
- **에이전트 트리·fast_fail·per-task cost delta·taskType 분류·prompt 임베딩:** 데이터 보강 선행 필요(Phase 3, T3-1~T3-5).
- **리텐션(D1/D7/D30) 코호트:** clientId 기준만 가능, v1 미포함(T3-7 고도화).
  → 2026-08-09 부분 해소: `getAdminKpiCockpit` 의 베타종료 게이지에 D1/D7/D30 이
  **익명 clientId(identity) 기준**으로 들어왔다(티켓 pWSnJeQN, 정의는 세 칸 모두
  "가입 후 N일 창 안에서 2번째 파생세션/프로젝트 도달"로 동일). 계정 identity 기준
  코호트는 여전히 `getAdminRetentionCohorts` 쪽이고 accountUserId 축 한계가 남는다.
- **방문→다운로드 · 다운로드→설치 조인:** web(GA4/Vercel) 과 앱(BigQuery events)의
  **경계**다. 앱은 `app:first_run` 부터만 관측하고 GA4 `user_pseudo_id` 와 앱의 익명
  `clientId` 는 서로 다른 축이라 개인 조인이 불가능하다 — 규모(magnitude) 대사만
  가능하다. 티켓 pWSnJeQN(앱 내부 계측) 범위 밖이며, 이 경계는 `UzvcqHMd`(#901)가
  소유한다: 설계·실측은 `v3/docs/web-app-join-attribution-design-2026-08-09.md`
  (1순위 블로커 = 두 데이터셋의 BigQuery **리전 불일치**, 권장안 = 다운로드
  attribution 토큰이 아니라 웹가입 문서에 유입맥락을 서버측 스탬프하는 옵션 A′).

## 검증

- `cd v3/functions && npm run build` (tsc strict) 통과.
- 프론트: `marblo-web` tsc `--noEmit` + `eslint` + `next build` 통과. 차트 값 라벨·기간 컨트롤(7/30/90/커스텀)·드릴다운 모달은 픽스처 프리뷰 페이지로 헤드리스 렌더 확인(라벨 미충돌, 커스텀 입력 365 클램프, Esc/오버레이 클릭 닫기, body 스크롤 락 복원).
- 배포: `firebase deploy --only functions --project marblo-2253d` (env `.env.marblo-2253d` 단일소스, BQ 마이그레이션 불필요 — 신규 조회 콜러블만).
