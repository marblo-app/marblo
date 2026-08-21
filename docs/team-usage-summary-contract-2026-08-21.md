# `getTeamUsageSummary` 응답 계약 — 프론트(T9)가 보고 만드는 문서

작성일: 2026-08-21 · 티켓 `lt9w8LucYFpSbaEzTsgG` · 역할 backend
정본 코드: `v3/functions/src/teamUsage.ts` (타입·상수 전부 여기서 export)
설계 정본: `docs/team-usage-overview-design-2026-08-21.md` (#1103) §7

> ★이 문서는 **설계를 다시 하지 않는다.** §7 의 응답 계약을 프론트가 분기 없이
> 구현할 수 있을 만큼 구체화하고, 구현하며 **추가된 필드**를 밝힌다. 설계와
> 어긋나는 곳은 없고, 추가된 것만 §0 에 모아 뒀다.

---

## 0.0 ★이 문서를 고칠 때 지킬 세 줄

계약에 약속을 적을 때는 **바로 그 자리에** 아래 셋을 같이 적는다. 이 티켓에서
형제 티켓(감사 탭 `IcjPf2SEs0ORUGLZgCHS`)과 주고받으며 양쪽에서 실제로 데인 자리다.

1. 이 약속을 **값 수준에서** 누가 검사하나 — 필드 이름만 보는 검사는 값 안의
   이메일을 못 잡는다.
2. 그 검사가 규칙 **전부를 덮나** — `/\d/` 만 보면 "여섯 시간" 같은 한글 수사를
   놓친다. **좁은 검사는 버그를 통과시킨다.**
3. 그 검사가 규칙보다 **넓지는 않나** — "한 건도 기록되지 않았습니다" 를 임계값으로
   오인하면 멀쩡한 문장을 고치게 된다. **넓은 검사의 손해는 조용하지도 않다 —
   사람이 직접 멀쩡한 것을 망가뜨린다.**

> ★약속을 적은 자리와 지키는 자리가 **같은 파일 안에 있어도** 틀린다. 거리가
> 문제가 아니라, **약속이 산문이고 지키는 쪽이 코드**라는 게 문제다.

---

## 0. 설계 §7 대비 추가된 것 (전부 **추가**, 변경 아님)

| # | 추가 | 왜 |
| --- | --- | --- |
| 1 | `teamUsage.state` 에 **`not_provisioned`** | §7 은 네 상태였다. 뷰가 아직 없을 때(프로비저닝 미실행)를 `empty` 로 접으면 **`0`·`미수집`·`적재 전` 3분법이 2분법으로 무너진다.** 티켓이 "그 구분이 전부" 라고 못박은 자리다 |
| 2 | `byMember[].hasRows` + **행 없는 명부 멤버도 목록에 남김** | 목록에서 빠지면 오너가 "0 인가 안 보낸 건가" 를 물을 자리조차 없다. §7 화면규칙 4 를 화면이 실제로 그릴 수 있게 |
| 3 | 모든 사유·라벨에 **`…Code` 형제 필드** | §7 은 "화면이 이 문장을 그대로 그린다" 였는데 marblo-web 에 **영문 로케일**이 있다. 문장만 내면 영어 화면에 한국어가 박힌다 (§2) |
| 4 | `teamUsage.fromDay` / `toDayExclusive` | 화면이 "어느 구간의 숫자인지" 를 스스로 말하게. 게이트가 창을 자르면 요청 `days` 와 실제 구간이 다르다 |
| 5 | `coverage.rowsInWindow` | **`0`(합이 0)** 과 **`empty`(행이 0)** 를 화면이 가르려면 행 수가 필요하다 |
| 6 | `orchestratorAxis.legacySegment.note(Code)` | 2026-05~06 오케 행은 규약 이전의 잔재다. 그 구간이 창에 들어오면 화면이 "추세 아님" 을 말해야 한다 |

---

## 1. 호출

```ts
httpsCallable(functions, "getTeamUsageSummary")({
  days?: number,          // 기본 30, 양의 정수, 상한 365 (#1090 규약)
  projectIds?: string[],  // ★권한 근거가 아니다 — 서버 집합과의 교집합 필터로만 쓰인다
  scope?: "team" | "self",// 기본 "team". 볼 팀이 없으면 서버가 self 로 내린다
  refresh?: boolean,      // 수동 새로고침. 프로젝트당 5분 1회 레이트리밋
})
```

- **미인증** → `HttpsError('unauthenticated')`.
- ★`X-Plan` / `X-User-Id` 같은 클라 제어 헤더는 **읽지 않는다.** 신원의 출처는 `context.auth` 하나다.
- ★`projectIds` 를 늘려도 권한이 넓어지지 않는다. 서버가 uid 로 만든 집합과 교집합을 취하고, 교집합이 비면 0행이다. **프로젝트의 존재 여부를 응답이 말하지 않는다.**

---

## 2. ★사유·라벨은 **코드와 문장이 쌍으로** 나간다

```ts
teamUsage.disabledReasonCode   // "gate_unset" — ★i18n 키. 이 값이 계약이다
teamUsage.disabledReason       // "TEAM_USAGE_EFFECTIVE_FROM 미설정 — …" — ko-KR 폴백
```

**프론트 규칙 한 줄: 코드로 번역하고, 번역이 없으면 문장을 그린다.**

★**봉투가 싣는 문장은 전부 오너가 읽을 문장이다.** env 키 이름·`npm run` 명령·
내부 문서 경로·소스 파일명·표 이름은 **하나도 들어 있지 않다**(런타임 테스트로
고정). 운영자용 조치 문장은 `…_OPERATOR_NOTE` 로 따로 있고 **서버 로그로만**
나간다 — 봉투에 실리지 않는다.

> 왜 이게 중요한가: 화면규칙 1 이 `state === "disabled"` 일 때 `disabledReason`
> **문장만** 그리라고 하는데, 게이트는 T10 전까지 닫혀 있는 게 정상이다. 즉
> **배포 직후 이 화면의 기본 모습이 그 문장 하나다.** 거기 env 키가 박혀 있으면
> 오너가 보는 건 제품이 아니라 남의 배포 런북이다.

- 코드만 쓰면 → 번역이 안 붙은 순간 화면이 **아무 사유도 못 그린다.** 이 화면에서 제일 나쁜 결과다(왜 비었는지 말 못 하는 빈 화면).
- 문장만 쓰면 → 영어 화면에 한국어가 박힌다.

코드 목록의 정본은 `TEAM_USAGE_NOTE_CODES`, ko-KR 원문은 `TEAM_USAGE_NOTE_TEXT_KO` 다.
★코드는 **더하는 형태로만** 관리한다 — 지우면 프론트 번역이 조용히 빈 문자열이 된다.

| code | 언제 | 뜻 |
| --- | --- | --- |
| `gate_unset` | `state="disabled"` | 처리방침 고지 개정 전이라 팀 열람이 닫혀 있다 |
| `gate_invalid` | `state="disabled"` | env 값이 `YYYY-MM-DD` 가 아니다(설정 실수) |
| `not_provisioned` | `state="not_provisioned"` | ★**적재 전** — 뷰가 없다. 사용량이 0 이라는 뜻이 아니다 |
| `no_team_scope` | `scope="self"` | 볼 수 있는 팀이 없다(오너/admin 인 프로젝트 없음) |
| `member_self_only` | `scope="self"` | 일반 멤버는 자기 것만 본다. 팀 총계도 안 본다(차분 공격) |
| `orchestrator_not_collected` | 항상(수집 배선 전) | ★오케 사용량은 **0 이 아니라 미수집**이다 |
| `orchestrator_legacy_segment` | 창이 2026-05-05~06-22 와 겹칠 때 | 그 구간 오케 행은 규약 이전 잔재 — 추세로 읽지 마라 |
| `telemetry_opt_out` | 항상 | 0 은 '안 썼다' 가 아니라 '안 보냈다' 일 수 있다 |
| `rows_zero` | 항상 | 델타 0 행이 섞여 있다 — **행 수를 활동 지표로 쓰지 마라** |
| `rows_without_task` | 항상 | 티켓 드릴다운 신뢰구간 |
| `unattributed_rows` | 항상 | 프로젝트 식별자 결측 행은 팀 집계에서 뺐다 |
| `basis_account_ledger` | 항상 | 집계 근거 라벨 |
| `cost_estimated_usage` | 항상 | ★금액 라벨 = **"사용량 환산 비용(추정)"** |
| `cost_not_billing` | 항상 | ★**청구액이 아니다** |

---

## 3. ★`teamUsage.state` — 다섯 값과 각각의 뜻

**이 화면의 전부다.** `0`·`미수집`·`적재 전` 이 셋 다 다른 뜻이고, 화면이 그걸 못 가르면 이 티켓은 실패다.

| state | 뜻 | 화면이 해야 할 일 |
| --- | --- | --- |
| `disabled` | 게이트가 닫혔다(고지 개정 전). **질의 자체를 하지 않았다** | ★**숫자를 아예 그리지 않는다.** `disabledReason(Code)` 문장만 그린다 |
| `not_provisioned` | ★**적재 전.** 뷰가 아직 없다 | 빈 칸 + 사유. ★**0 으로 그리면 거짓말이다** |
| `empty` | 창 안에 **행이 0**. 팀이 아직 안 들어왔을 때의 정상 상태 | 빈 상태 UI. "아직 데이터가 없습니다" + 명부는 0 으로 그린다 |
| `partial` | 행이 있고 창이 게이트 상한에 **잘렸다** | 숫자를 그리되 "발효일 이전 구간 제외" 를 라벨한다(`effectiveFrom`) |
| `complete` | 행이 있고 창 전체가 읽혔다 | 정상 |

★그리고 **`0`** — 위 어디에도 없다. `state === "complete"`(또는 `partial`)인데 `totals.costUsd === 0` 인 경우가 "실제로 0" 이다. `coverage.rowsInWindow > 0` 이면 행은 있었다.

```
rowsInWindow === 0                 →  state "empty"     → "데이터 없음"
rowsInWindow  >  0 && cost === 0   →  state "complete"  → "0"  (진짜 0)
state === "not_provisioned"        →  "적재 전"
orchestratorAxis.state === "not_collected" → "미수집"
```

---

## 4. ★오케 칸 — `0` 으로 그리지 마라

```ts
orchestratorAxis: {
  state: "not_collected" | "collecting";
  reasonCode: "orchestrator_not_collected" | null;
  reason: string | null;
  collectingSince: string | null;                 // 수집 배선 배포일
  legacySegment: { from, to, noteCode, note } | null;
}
```

- 지금은 **항상 `not_collected`** 다. 2026-06-22 이후 한 행도 안 잡힌다. 6월 실측으로 **전체 지출의 29%** 였다.
- 수집 배선 티켓이 배포되면 env `TEAM_USAGE_ORCHESTRATOR_COLLECTING_SINCE` 에 날짜가 들어가고 `collecting` 이 된다. **코드 배포 없이 바뀐다.**
- `byActorKind` 에 **orchestrator 항목이 아예 실리지 않는다**(행이 없을 때). 0 짜리 행을 만들지 않는 것이 규칙이다 — 0 으로 그리면 오너가 "오케는 공짜" 로 읽는다.

---

## 5. ★권한에 따라 봉투가 어떻게 달라지나

| 역할 | `scope` | 팀 총계 | `byMember` | `byProject`/`byModel`/`byDay` |
| --- | --- | --- | --- | --- |
| **owner** | `team` | ✅ 스코프 내 합계 | ✅ 멤버별 분해 | ✅ |
| **admin** | `team` | ✅ | ✅ | ✅ |
| **member** | `self`(서버가 내림) | ❌ 자기 것만 | **`[]`** | ✅ 단 자기 행만 |
| **viewer** | `self` | ❌ | **`[]`** | ✅ 자기 행만 |

★**멤버는 팀 총계도 못 본다.** 2인 팀에서 `팀 총계 − 내 사용량 = 상대방 사용량` 이 정확히 성립하고(차분 공격), 지금 유일한 다중 멤버 프로젝트가 **정확히 2인**이다.

★**봉투의 모양은 역할에 따라 바뀌지 않는다.** 달라지는 것은 값뿐이고, 구조적으로 다른 자리는 `byMember`(팀=채워짐 / self=빈 배열) **하나뿐**이다 — 프론트는 분기 없이 같은 컴포넌트로 그린다. 그 사실은 테스트로 고정돼 있다(`teamUsage.test.ts` §14).

게이트가 닫혀도 **self 스코프는 산다**(게이트 밖). 화면 절반이 죽지 않는다.

---

## 6. 응답 전문

```ts
{
  rangeDays: number;          // 요청 에코 (#1090 규약)
  generatedAt: string;        // ISO8601. ★캐시가 섞이면 **가장 오래된 조각** 기준
  cache: { hit: boolean; ageSeconds: number; ttlSeconds: number };

  teamUsage: {
    state: "disabled" | "not_provisioned" | "empty" | "partial" | "complete";
    disabledReasonCode: TeamUsageNoteCode | null;
    disabledReason: string | null;
    effectiveFrom: string | null;      // 게이트가 열렸을 때만
    basis: "account_ledger";           // ★항상 실린다 — 라벨 없는 숫자 금지
    basisLabelCode: "basis_account_ledger";
    basisLabel: string;
    costLabelCode: "cost_estimated_usage";
    costLabel: "사용량 환산 비용(추정)";   // ★'청구액' 이 아니다
    costNotBillingNoteCode: "cost_not_billing";
    costNotBillingNote: string;
    scope: "team" | "self";
    scopeNoteCode: TeamUsageNoteCode | null;
    scopeNote: string | null;
    projectsInScope: number;
    fromDay: string | null;            // 실제 조회 구간(게이트에 잘린 뒤)
    toDayExclusive: string | null;
  };

  orchestratorAxis: { … };             // §4

  totals: { costUsd, inputTokens, outputTokens,
            cacheReadTokens, cacheWriteTokens, tokens };
            // ★tokens = input + output (IO 토큰). 캐시 토큰은 따로 있다 —
            //   라벨 없이 합치지 않는다.

  byDay:   Array<{ day, costUsd, tokens, partial }>;   // partial = 오늘(미완)
  byMember: Array<{                                    // ★owner/admin 만
    memberKey,        // "tm_…" ★이 화면 전용 가명 공간. 다른 축의 조인 키와 다르다
    displayName,      // string | null — ★이름을 모르면 null. 이메일로 채우지 않는다
    costUsd, tokens, share,
    hasRows,          // ★false = "안 썼다" 가 아니라 "안 보냈다" 일 수 있다
  }>;
  byProject: Array<{ projectId, projectName, costUsd, tokens }>;
  byModel:   Array<{ model, costUsd, tokens }>;         // 모델 미상은 "(미상)"
  byActorKind: Array<{ actorKind: "worker" | "orchestrator", costUsd, tokens }>;
                                                       // ★행이 없으면 항목이 없다

  coverage: {
    rowsInWindow, rowsZeroPct, rowsWithoutTaskPct,
    unattributedRows, membersWithNoRows,
    telemetryOptOutNoteCode, rowsZeroNoteCode,
    rowsWithoutTaskNoteCode, unattributedRowsNoteCode,
    telemetryOptOutNote, rowsZeroNote,
    rowsWithoutTaskNote, unattributedRowsNote,
  };
}
```

---

## 7. 화면 규칙 (설계 §7 의 여섯 줄 + 프론트가 실제로 걸릴 자리 셋)

| # | 규칙 |
| --- | --- |
| 1 | `state === "disabled"` → **숫자를 아예 안 그린다.** `disabledReason(Code)` 만 |
| 2 | `basisLabelCode` 를 배지로 **항상** 그린다 — 라벨 없는 사용량 숫자 금지 |
| 3 | `orchestratorAxis.state === "not_collected"` → 오케 칸은 **빈 칸 + 사유**. 0 금지 |
| 4 | 멤버 순위 옆에 항상 `telemetryOptOutNoteCode` — 0 = 안 씀이 아니라 안 보냄일 수 있음 |
| 5 | `generatedAt` 기준 "N분 전". 오늘 막대(`byDay[].partial`)엔 `진행 중` 배지 |
| 6 | 금액은 `costLabelCode`. ★**"청구액" 이라는 단어를 쓰지 않는다** |
| 7 | `state === "not_provisioned"` 을 `empty` 와 **다른 문구**로 그린다(원인이 다르다) |
| 8 | `byMember[].hasRows === false` 는 0 이 아니라 **"기록 없음"** 으로 표기 |
| 9 | `state === "partial"` 이면 `effectiveFrom` 을 함께 그린다("그 이전 구간 제외") |

---

## 8. 프론트가 하면 안 되는 것

- ★`teamUsageCache` 컬렉션을 **직접 읽지 마라.** `firestore.rules` 에서 `allow read, write: if false` 다. 읽으면 콜러블의 역할 게이트가 통째로 우회된다 — 그건 팀 기능이 아니라 감시다.
- ★`cost_logs` / `audit_logs` 를 클라에서 직접 쿼리하지 마라. 룰 표면 증가는 0 이 목표다(#406/#428 실패 모드).
- ★금액을 "청구액"·"청구서"·"결제 예정액" 으로 부르지 마라. **좌석(seat) 원장이 존재하지 않아** "누구 몫으로 청구되나" 는 이 화면이 답할 수 없다.
- ★`memberKey` 를 다른 화면·다른 축의 키와 **조인하지 마라.** 이 가명은 팀 화면 전용 공간이다(설계 §4.6).

---

## 8.1 ★자유 문자열 두 자리 — 서버가 이미 값 수준으로 거른다

봉투에 **사람이 자유롭게 지은 문자열**이 실리는 자리는 둘이다:

| 필드 | 누가 짓나 |
| --- | --- |
| `byMember[].displayName` | 사용자가 정한 표시명 — **이메일로 정할 수 있다** |
| `byProject[].projectName` | 사용자가 정한 프로젝트 이름 |

★필드 **이름**만 보는 검사로는 안 막힌다. 표시명을 자기 이메일로 해 둔 멤버가
하나만 있어도, 이름 필드를 하나도 안 쓰고 응답에 이메일이 실린다.

→ 서버가 `scrubIdentityLike()` 로 **값 수준**에서 거른다:
- 이메일 모양은 **그 부분만** `(가려짐)` 으로 — `홍길동 <a@b.com>` → `홍길동 <(가려짐)>`
- 계정 uid 모양(**정확히 28자** 영숫자 + 대·소문자·숫자 전부 혼재)만 `(가려짐)` 으로

★**과잉 차단도 결함이다.** `backend-1`·`orchestrator-claude-p1`·`John Kim` 은 통과한다 —
멀쩡한 이름을 가리면 화면이 오너에게 **있지도 않은 문제를 보고**한다. 차단과 통과를
양쪽 다 테스트로 고정했다.

**프론트가 알아야 할 것 한 줄:** `null` 과 `"(가려짐)"` 은 **다른 뜻**이다.
- `null` → 이름을 **모른다** ("이름 미상")
- `"(가려짐)"` → 이름은 **있는데 보여줄 수 없다**

둘을 같게 그리면 안 된다. (렌더 경계에서 한 번 더 막는 것은 환영이다 — 값 수준
검사는 서버·클라 양쪽에 있어도 손해가 없다.)

---

## 8.1.1 ★임계값은 문장이 아니라 `criteria` 로 나간다

```ts
criteria: {
  maxRangeDays: 365,
  maxProjectsInScope: 25,
  cacheTtlSeconds: 900,
  manualRefreshMinIntervalSeconds: 300,
}
```

값의 출처는 **판정에 쓰는 상수 그 자체**다. 화면은 이 값을 로케일 문장에 끼워
넣어라 — 문장에 "최대 365일" 이라고 박아 두면 상한을 바꿀 때마다 세 로케일 번역이
낡고, **코드가 판정하는 숫자와 화면이 말하는 숫자가 조용히 갈라진다.**

`criteria` 는 `state` 와 무관하게 **항상** 실린다(게이트가 닫혀 있어도).

## 8.1.2 ★조용한 절단은 없다 — `projectsOmitted`

프로젝트가 `maxProjectsInScope` 를 넘으면 서버가 자른다. **자른 사실을 숨기지 않는다:**

```ts
teamUsage.projectsInScope             // 실제로 더한 프로젝트 수
teamUsage.projectsOmitted             // ★상한에 걸려 빠진 수. 0 이 아니면 합계는 전체가 아니다
teamUsage.projectsTruncatedNoteCode   // "projects_truncated" | null
teamUsage.projectsTruncatedNote       // ko 폴백 | null
```

★`projectsOmitted > 0` 이면 화면은 합계 옆에 **반드시** 그 사실을 그려야 한다.
안 그리면 오너가 "이번 달 우리 팀 지출" 로 읽는 숫자가 조용히 틀린다. 잘리지
않았으면 세 필드가 `0`/`null` 이라 없는 경고를 그릴 일은 없다.

## 8.1.3 ★절단이 **판정**에 물리면 누락이 아니라 오탐이다

`projectsOmitted > 0` 이면 서버는 "기록 없음" 류의 **부정 판정을 생략한다.**

| 필드 | 잘리지 않았을 때 | ★잘렸을 때 |
| --- | --- | --- |
| `byMember[].hasRows` | `true` / `false` | `true` / **`null`(모른다)** |
| `coverage.membersWithNoRows` | 숫자 | **`null`(모른다)** |
| `coverage.scopeNoteCode` | `null` | `"coverage_partial_scope"` |

왜: 어떤 멤버가 **포함된 프로젝트와 잘린 프로젝트 양쪽**에 속해 있고 이번 창의
사용량이 잘린 쪽에만 있었다면, `hasRows: false` 는 **거짓**이다. 그런데 화면은 그
옆에 "0 은 안 썼다가 아니라 안 보냈다일 수 있습니다" 를 그린다 — ★절단 부작용이
**그 사람의 성실성 문제로 번역된다.** 숫자가 작게 나오는 것과 차원이 다르다.

★**카운트는 목록에서 센다.** `coverage.membersWithNoRows` 는
`byMember.filter(m => m.hasRows === false).length` 와 **항상 같다**(불변식 테스트로
고정). 따로 계산하면 목록과 어긋나고, **"3명" 이라 써 놓고 2명만 보이는 화면**은
숫자가 틀린 것보다 나쁘다 — 오너가 못 찾은 1명을 계속 찾는다.

`membersWithNoRows` 가 `null` 인 경우 둘: 스코프가 잘렸을 때, 그리고 멤버 분해가
없는 스코프(`self`)일 때. `null`(모른다)과 `0`(정말 없다)은 다른 뜻이다.

★**타입과 문장 둘 다 있다.** `null` 타입은 프론트가 `false` 로 **접을 수 없게**
하고(다만 프론트가 지켜야 성립한다), `coverage.memberRowsUnknownNoteCode`
= `"member_rows_unknown"` 문장은 화면이 뭘 그리든 **오너에게 바로 닿는다.**
문장은 "★**기록이 없다는 뜻이 아닙니다**" 를 명시한다 — 판정을 뗀 것이
"문제 없음" 으로 읽히면 오탐을 고치려다 **반대쪽 거짓말**이 된다.

그 문장은 **멤버 목록이 있고 스코프가 잘렸을 때만** 실린다. 안 잘렸으면 `null` 이다 —
없는 불확실성을 그리지 않는다.

★프론트 규칙: `hasRows` 는 **세 값**이다. `null` 을 `false` 로 접지 마라.
- `true` → "기록 있음"
- `false` → "기록 없음(미사용 또는 미전송)"
- `null` → **"확인 불가"** — 절단 때문에 판정하지 않았다

`membersWithNoRows` 도 `null`(모른다)과 `0`(정말 없다)이 다르다.

그리고 멤버 축에서도 이 화면의 3분법이 그대로 성립한다:
`null`(모른다) · `false`(기록 없음) · `hasRows: true` + `costUsd: 0`(썼는데 0).

## 8.1.4 ★어느 짝을 대조해도 되나 (오경보 방지)

화면이 봉투 안의 두 값을 대조해 "숫자가 어긋났다" 를 잡고 싶을 때, **어느 짝이
같아야 하는지 안 적으면 두 가지로 실패한다**: 대조를 아예 안 걸거나, 일부러 다른
짝을 걸어 오경보를 낸다. 목록의 정본은 코드에 있다 —
`TEAM_USAGE_SUMMARY_INVARIANTS` / `TEAM_USAGE_DELIBERATE_MISMATCHES`.

★**금액 짝은 정확 비교하지 마라.** 버킷마다 소수 6자리로 따로 반올림하므로
`Σ byDay.costUsd` 가 `totals.costUsd` 와 **실측 1e-6 만큼 벌어진다.** 정확 비교를
걸면 멀쩡한 응답이 매번 빨개진다 — 안전장치가 반대로 도는 자리다.
허용오차는 `sumToleranceUsd(bucketCount)` 로 응답 쪽과 같은 식을 쓴다.

**같아야 하는 짝**
- `coverage.membersWithNoRows` === `byMember` 중 `hasRows === false` 인 수 (정확. `null` 이면 대조하지 않는다)
- `totals.tokens` === `totals.inputTokens + totals.outputTokens` (정수라 정확)
- `Σ byProject / byModel / byActorKind / byDay 의 costUsd` ≈ `totals.costUsd` (허용오차)

**★일부러 다른 짝 — 대조하면 오경보**
| 짝 | 왜 다른가 |
| --- | --- |
| `projectsInScope` vs `byProject.length` | 스코프에 있어도 이번 창에 사용량이 없는 프로젝트는 `byProject` 에 안 나온다. 앞은 "볼 수 있는 수", 뒤는 "쓴 프로젝트" |
| `byMember.length` vs `totals` | 가명 솔트가 없으면 멤버 분해는 비고 총계는 산다. `self` 스코프에서도 `byMember` 는 계약상 빈 배열 |
| `Σ byMember.costUsd` vs `totals.costUsd` | 위와 같은 이유 + 명부 밖 사용자가 섞일 수 있다. **멤버 축은 총계의 분해가 아니다** |
| `coverage` 비율들끼리 | `rowsZeroPct`·`rowsWithoutTaskPct` 는 **행 수** 기준이라 금액·토큰과 분모가 다르다. 잘렸으면 분모가 더 좁아진다(`coverage.scopeNoteCode`) |

## 8.1.5 `캐시` 는 구현 어휘가 아니라 지표다

T9 이 한글 구현 어휘 스캐너(`서버|클라이언트|콜러블|…|캐시`)를 돌린다면, 이 봉투의
`totals.cacheReadTokens` / `totals.cacheWriteTokens` / `cache.hit` 세 자리는
**예외로 열어야 한다.** 캐시 읽기·쓰기 토큰은 오너가 실제로 보는 지표다
(설계 §2 Q9 "캐시 히트로 얼마 아꼈나"). ★단 낱말 `캐시` 를 목록에서 **빼지는
마라** — "캐시 미스 경로" 같은 진짜 구현 유출이 통과한다. **낱말이 아니라 키별로**
예외를 열어라.

(이 봉투의 ko 사유 문장 자체에는 `캐시` 를 포함해 구현 어휘가 **0건**이다 —
실측 확인. 예외가 필요한 곳은 지표 라벨 쪽뿐이다.)

## 8.2 후속 티켓 — 감사 탭과 코드 목록 합치기 (★지금은 합치지 않는다)

감사 탭(`getTeamProjectAudit`, 티켓 `IcjPf2SEs0ORUGLZgCHS`, 설계 §12.5.1)도 같은
`{code, text}` 규약을 쓴다. 코드 문자열은 두 쪽이 **하나도 겹치지 않으므로**
화면은 두 상수를 `{...A, ...B}` 로 펼쳐 **i18n 표 한 벌**을 지금 바로 만들 수 있다.

★**지금 코드에서 union 을 합치지 않는 이유**: `teamAudit.ts` 가 `teamUsage.ts` 를
import 하면 두 브랜치가 **교차 의존**한다 — 한쪽이 다른 쪽 없이 빌드되지 않는다.
둘 다 머지된 뒤 중립 이름(`TEAM_NOTE_CODES`)으로 합치는 후속 티켓이 맞다.

> ★후속 티켓 문구(감사 탭 §12.5.1 과 **같은 문장**으로 둔다):
> **"union 타입만 합치고 코드 문자열은 한 글자도 바꾸지 않는다. 이름이 안 예뻐도
> 그대로 이관한다 — 문자열이 바뀌면 배포 시차 동안 화면이 빈 문장을 그리고,
> `withheld` 에서 그건 '숨긴 게 없다' 는 거짓이 된다."**

이유를 같이 적는 게 중요하다. "i18n 키가 깨진다" 만 적으면 다음 사람이 "그럼 사전도
같이 고치면 되지" 로 읽는데, 실제 위험은 **배포 시차**다. 사전이 먼저 가고 서버가
늦으면(또는 반대) 화면이 낡은 코드를 받아 빈 문자열을 그린다. 그 필드가 존재하는
이유와 정반대의 결과가 나오는 자리가 있다.

---

## 9. 배포 순서

1. `cd v3/functions && npm run provision:team-usage -- --apply` — 뷰 2벌 생성(원본 무변경)
2. functions 배포 — ★게이트가 닫힌 채로 태어난다. `scope="team"` 은 `disabled` + 사유, self 는 동작
3. Firestore TTL 정책: `teamUsageCache` 컬렉션의 `expiresAt` 필드에 TTL 지정(콘솔/gcloud)
4. 처리방침 개정 + 인앱 통지 배포 **후에만** `TEAM_USAGE_EFFECTIVE_FROM` 투입 — ★그 티켓이 게이트를 여는 근거다. 엔지니어링이 정할 문제가 아니다
