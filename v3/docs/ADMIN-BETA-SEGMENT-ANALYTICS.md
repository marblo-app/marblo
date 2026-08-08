# 어드민 — 베타/파운더 세그먼트 사용패턴 뷰

- **티켓**: TdlWmESRnuGr7zltvRKM (backend)
- **상위 설계**: Kgoif8H8vGGn6zZ3q1p6 — `v3/docs/ADMIN-BUSINESS-ANALYTICS-SPEC.md`
  ★**주의: 그 문서는 main 에 없다.** 커밋 `90a29590`(브랜치 `marblo/backend-claude-com5-Kgoif8H8`)에만 있고 PR 도 없다. 읽으려면 `git show 90a29590:v3/docs/ADMIN-BUSINESS-ANALYTICS-SPEC.md`.
- **작성**: 2026-08-08. 수치는 전부 이 날짜 라이브 실측(john.kim ADC → BigQuery REST / Firestore REST).
- **상태**: 구현 완료(코드·테스트·타입체크). **배포는 미실행** — §7 참조.

---

## 0. 한 줄 요약

이 뷰가 답하는 질문은 하나다: **"grant 를 준 사람들이 실제로 쓰는가?"**

실측 답: **grant 31명(운영자 제외) 중 최근 30일 관측 3명 = 9.7%.** 그 3명조차 최소 코호트 가드(5명) 아래라 행동지표는 표시되지 않는다. 즉 **지금 이 뷰의 정직한 산출물은 "숫자"가 아니라 "텔레메트리 ON 이 선행"이라는 근거 있는 판정**이다.

---

## 1. 상위 설계 대비 무엇이 달라졌나 (★중복설계 금지 확인)

상위 스펙은 2026-07-17 작성이고 그 뒤 코드가 크게 움직였다. 편입 전 실제 코드를 확인한 결과:

| 상위 스펙의 전제                                                  | 2026-08-08 실제                                                                                                                                |
| ----------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| "계정↔사용 조인 불가 — events 는 익명 clientId, 매핑 테이블 없음" | ★**해결됨.** `events.metadata.accountUserId` 가 생겼고, `getAdminRetentionCohorts`/`getAdminActiveUserMetrics` 가 이미 계정단위로 착지해 있다. |
| 리텐션 = 신규 `getAdminRetentionSummary` 를 만들어야 함           | 이미 `getAdminRetentionCohorts` 로 존재(코호트 + 순차 활성화 게이트).                                                                          |
| MAU/stickiness 신규 필요                                          | 이미 `getAdminActiveUserMetrics` 에 존재.                                                                                                      |
| `index.ts:4415` 등 라인 참조                                      | 파일이 11,677줄로 커져 라인 참조는 전부 무효. `adminAnalytics.ts`(1,541줄) 순수 빌더 모듈도 신설돼 있다.                                       |

→ **그래서 지표·쿼리를 새로 설계하지 않았다.** 기존 계정 identity 규약을 그대로 재사용하고, 이번에 새로 더한 것은 딱 두 가지다:

1. **uid → 세그먼트 분류**(파운더/베타선정/베타신청)
2. **최소 코호트 가드**(k-익명성)

---

## 2. 계정 identity 규약 (기존과 동일 — 재정의 아님)

```
계정 활동 = events.metadata.accountUserId  ∪  cost_logs.userId
```

- `events.userId` 는 **쓰지 않는다.** 익명 clientId 공간이다.
- UUID 형태 식별자는 agent/client 오염이라 배제(기존 `identityCleanClause`).
- 운영자(`ADMIN_UID`)는 기본 제외. **본 콜러블은 명단 단계에서 미리 빼서 BQ 로 넘기지도 않는다.**

### 2-1. ★실측: identity 공간의 실제 상태

| 사실                                                                                     | 근거(라이브 쿼리)                                                             |
| ---------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| `events` 186,950행. `userId` 는 36자 clientId 가 주류(39개 고유).                        | `GROUP BY LENGTH(userId)`                                                     |
| 28자 uid 형태 12,822행이 있으나 **2026-04-18 ~ 06-13 레거시**로 이미 끊김.               | 같은 쿼리 + 이벤트별 min/max 날짜                                             |
| ★`metadata.accountUserId` 는 **2026-08-06 적재 시작**(이틀 전), **distinct 계정 = 1명**. | `COUNT(DISTINCT JSON_VALUE(metadata,'$.accountUserId'))` → 1, first_day 08-06 |
| `cost_logs` 171,845행, **distinct uid = 4명**. 그중 1명(운영자)이 172,983행/$92,713.     | `GROUP BY userId`                                                             |

> 참고로 `events.agentId ↔ cost_logs.agentId` 로 clientId→uid 를 역추론하는 경로도 실재한다(30일 기준 12 clientId → 4 uid). 다만 이는 **익명 텔레메트리를 사후 식별화**하는 것이라 프라이버시 방침상 세그먼트 지표에 쓰지 않았다. 기존 코드도 이 조인을 **운영자 제외 목적으로만** 쓴다(`resolveAdminClientIds`).

---

## 3. 세그먼트 정의

모수 = Firestore `subscriptions.founderGrant === true`.

- 판정은 **`founderGrant` 마커**로 한다. `paymentProvider` 로 유/무료·grant 를 판정하면 안 된다(founder_grant stomp — 결제 후 파운더 선정된 유저의 provider 가 덮인다).
- 세그먼트 키 = `founderGrantReason`. 미지의 reason 은 `other` 로 접어 **모수에서 누락되지 않게** 한다.

### 3-1. ★실측 코호트 (2026-08-08)

| 세그먼트  | reason             | 인원                |
| --------- | ------------------ | ------------------- |
| 파운더    | `founder_backfill` | 13                  |
| 베타 선정 | `beta_selected`    | 14 (운영자 제외 13) |
| 베타 신청 | `beta_signup`      | 5                   |
| **합계**  |                    | **32 (제외 후 31)** |

`subscriptions` 32건은 **전부** `founderGrant=true` 이고 전부 `status=active` 다. 즉 현재 유료 결제 기반 구독자는 0이고, **구독 모수 = 베타 모수**다.

> 별개 갭(본 티켓 범위 밖): `founders` 컬렉션은 61건인데 grant 로 materialize 된 건 32건이다. 이 차이는 grant 부여 갭이며 별도 추적 대상.

---

## 4. 지표 정의

전부 세그먼트 단위 집계다. 개별 계정은 어떤 필드로도 나가지 않는다.

| 지표            | 정의                                                                                          | 소스                     |
| --------------- | --------------------------------------------------------------------------------------------- | ------------------------ |
| `cohortSize`    | grant 보유자 수                                                                               | 🟢 Firestore             |
| `observedUsers` | 그중 관측창 안에 활동이 1건이라도 있는 계정 수                                                | 🟢 cost_logs + 🟡 events |
| `observedRate`  | `observed / cohort` — **이 뷰의 헤드라인**. 분모 0 이면 `null`(0% 로 오도 금지)               | 파생                     |
| `featureUsage`  | 이벤트 종류별 (사용자 수, 발생 수). 사용자 수 내림차순                                        | 🟡 events                |
| `sessions`      | `session:ended` 기준 세션 수 / 인당 세션 / 평균·중앙 길이. ★평균은 **세션 기준**(유저 기준 X) | 🟡 events                |
| `rhythm`        | 평균 활동일, 재방문자(활동일 2일+), 재방문율, 첫→마지막 활동 간격                             | 🟢🟡 union               |
| `adoption`      | 오케 / 스폰 / 티켓 축별 **1회 이상 사용한 사용자 수**(같은 축 내 여러 이벤트도 1명으로 계수)  | 🟡 events                |

채택 축 이벤트 매핑:

- **오케**: `onboarding:orchestrator_opened`, `dispatch:decision`
- **스폰**: `agent:spawned`
- **티켓**: `task:created`, `task:completed`, `task:status_changed`

### 4-1. 알려진 편향

- `session:ended` 는 **정상 종료에서만** 발사된다. 강제종료·크래시·OS kill 시 누락 → 세션 길이는 **clean-exit 표본**이며 체계적 과소집계될 수 있다.
- 관측창(`days`) 밖의 활동은 보이지 않는다. `observedRate` 는 "그 창 안에서 쓴 비율"이지 이탈률이 아니다.

---

## 5. ★프라이버시 설계

베타 모수는 수십 명이다. 세그먼트를 쪼개면 행동지표가 사실상 개인 지목이 된다. 그래서:

1. **응답에 식별자를 넣지 않는다.** uid 는 서버 내부 분류에만 쓴다 — `betaSegments.ts` 의 출력 타입에는 uid 필드 자체가 없다.
2. **최소 코호트 가드(k=5)**: 관측 계정이 5명 미만인 세그먼트는 `featureUsage`/`sessions`/`rhythm`/`adoption` 을 **통째로 억제**하고 `suppressed=true` + 사유만 내린다. 카운트(`cohortSize`/`observedUsers`)는 이미 사업지표로 공개되는 값이라 유지한다.
3. **롤업은 별도 판정**: 세그먼트별로는 억제돼도 `all` 롤업이 임계를 넘으면 롤업만 공개된다(정보량은 얻되 개인 지목은 막는다).
4. **운영자 제외가 명단 단계**: 운영자 본인도 grant 보유자다. `includeAdmin=false`(기본)면 Firestore 명단에서 빼고 BQ 파라미터에도 넣지 않는다.

단위테스트가 이 규칙들을 고정한다(`npm run test:beta-segments`, 13 케이스): 임계 미만 억제·정확히 임계면 해제·관측 0 구분·롤업 별도 판정·grant 명단 밖 계정 유입 차단.

---

## 6. ★가용성 판정 — 실측 근거

콜러블이 실제로 도는 3개 쿼리를 라이브 데이터로 그대로 재현한 결과(30일, 운영자 제외):

```
grant 보유자 총원(Firestore)   : 32  (운영자 포함)
운영자 제외 후 모수            : 31
세그먼트별 코호트              : founder_backfill 13 / beta_selected 13 / beta_signup 5

BQ 3쿼리 모두 성공             : activity 3행 / events 0행 / sessions 0행
관측된 grant 계정              : 3

세그먼트별 판정:
  founder_backfill  cohort= 13  observed= 2  → 억제(<5)
  beta_selected     cohort= 13  observed= 0  → 관측 없음
  beta_signup       cohort=  5  observed= 1  → 억제(<5)
  all(베타 전체)    cohort= 31  observed= 3  → 억제(<5)

[참고] includeAdmin=true: 관측 4 / cohort 32 → 여전히 억제(<5)
       계정귀속 이벤트 13종(상위: token:usage 19,351 / agent:spawned 396 / …) — 전부 운영자 1명분
```

**판정:**

- 🟢 **모수·관측 카운트는 지금 정확하다.** grant 31명 중 3명만 관측 = **관측률 9.7%** 는 텔레메트리 상태와 무관하게 신뢰할 수 있는 사업 신호다(cost_logs·Firestore 기반). 베타 이탈이 "제품 가치"가 아니라 "활성화"라는 기존 진단과 일치한다.
- 🔴 **기능사용·세션·채택은 지금 산출 불가.** 운영자를 빼면 계정귀속 이벤트가 **0행**이다. `metadata.accountUserId` 는 2026-08-06 적재 시작이고 프로덕션 텔레메트리는 기본 OFF다.
- → **텔레메트리 프로덕션 ON 이 선행 조건**(상위 스펙 D-1 결정항목). 그 전까지 이 섹션은 값을 0 으로 꾸미지 않고 `accountAttributionAvailable=false` 배너로 "측정되지 않았다"를 명시한다.

### 6-1. ON 이후 유의미해지는 시점

텔레메트리를 켜도 즉시 열리진 않는다. 세그먼트별로 **관측 5명**을 넘겨야 행동지표가 나온다. 현재 최대 세그먼트가 13명이므로, 그 세그먼트에서 **약 38% 이상이 실제로 앱을 켜야** 지표가 공개된다. 코호트가 더 커지거나(베타 확대) 활성화가 올라가야 한다.

---

## 7. ★배포 필요 (미실행)

이 PR 은 코드만 담는다. 실제로 대시보드에 뜨려면 **두 배포가 모두** 필요하다:

1. **functions 배포** — 신규 콜러블 `getAdminBetaSegmentUsage`
   ```
   cd v3/functions && npm run build
   firebase deploy --only functions:getAdminBetaSegmentUsage --project marblo-2253d
   ```
   env 는 `.env.marblo-2253d` 단일소스. **BQ 마이그레이션 불필요**(조회 전용, 신규 테이블·컬럼 없음).
   ★gen1 멀티 `--only` 는 변경분을 조용히 누락시킨 전례가 있으므로 **단일 `--only`** 로 배포하고 함수별 hash 라벨로 검증할 것.
2. **marblo-web 배포** — Vercel Git 자동배포(main 머지 시).

배포 순서는 **functions 먼저**가 안전하다. web 이 먼저 뜨면 콜러블이 없어 `not-found` 가 나는데, 패널은 콜러블별 독립 catch 라 해당 섹션만 에러 박스로 뜨고 나머지는 정상 렌더된다(기존 soft-fail 규약과 동일).

---

## 8. 변경 파일

| 파일                                           | 내용                                                 |
| ---------------------------------------------- | ---------------------------------------------------- |
| `v3/functions/src/betaSegments.ts` (신규)      | 순수 로직 — 분류·집계·억제 판정. BQ/Firestore 무의존 |
| `v3/functions/src/betaSegments.test.ts` (신규) | node:test 13 케이스(프라이버시 가드 고정)            |
| `v3/functions/src/index.ts`                    | 콜러블 `getAdminBetaSegmentUsage` + import           |
| `v3/functions/package.json`                    | `test:beta-segments` 스크립트 (devDep 추가 없음)     |
| `marblo-web/.../admin/AnalyticsPanel.tsx`      | "베타 세그먼트 사용패턴" 섹션 + 타입 + 콜러블 배선   |
| `docs/analytics-admin-callables-api.md`        | §7 신규 콜러블 스키마                                |

## 9. 범위 밖

- 텔레메트리 프로덕션 ON / 동의 UI — 사장님 결정(상위 스펙 D-1).
- `founders` 61 vs grant 32 materialization 갭 — 별도 티켓.
- clientId→uid 역추론으로 익명 이벤트를 세그먼트에 귀속시키는 것 — 프라이버시 방침상 채택하지 않음(§2-1).
- 상위 스펙 문서(`ADMIN-BUSINESS-ANALYTICS-SPEC.md`)를 main 으로 가져오는 것 — Kgoif8H8 티켓의 산출물이라 본 티켓에서 대신 머지하지 않는다. 오케에 보고함.
