# 어드민 분석 화면을 사람 축에 연결한다 — 축 조사 + 배선 (2026-08-30)

티켓 `ymfPL2AorfuEniHpVpCT`. 선행 실측 셋(`#1320` 각인 ON · `#1321` GA4 사슬 검증 ·
`#1322` 링크 커버리지)을 **재조사하지 않고** 그대로 전제로 삼았다. 이 문서는
(1) 지금 어드민 화면 블록이 각각 어느 축으로 세는지, (2) 무엇을 붙였는지, (3)
기존 숫자가 바뀌었는지(회귀)를 적는다.

## 0. 한 줄

**기존 숫자는 하나도 안 바뀌었다.** 사람 축은 기존 블록을 갈아치우지 않고
**옆에** 붙였고, 붙은 모든 숫자에는 축 배지가 있다. 경계(전환 시점)는 env 가 아니라
`events.userKey` 첫 각인 행의 `MIN(timestamp)` 에서 읽는다. GA4 유입 × 사람키
코호트는 지금 **0행**이고, 화면은 그 0 을 "데이터 없음" 으로 뭉개지 않고 **사슬
어느 단계에서 0 이 됐는지**(s3: `analytics_identity` 08-20 정지)를 숫자로 그린다.

## 1. ★축 조사 — 지금 화면 블록이 무엇으로 세는가

축 어휘는 `person-axis-event-stamp-2026-08-29.md §8.2` 그대로다:
**I** 설치(installId/`in_`) · **A** 계정(uid) · **P** 사람(`us_`) · **B** 브라우저(`ga_`)
· **F** Firestore doc(=A).

`person-axis-event-stamp-2026-08-29.md §8.3` 의 census 를 **현재 코드로 다시 대조**했다
(`marblo-web/src/app/[locale]/admin/AnalyticsPanel.tsx` 의 각 뷰가 읽는 봉투 기준).
★화면마다 축이 다르고, 한 탭 안에서도 블록마다 다르다.

| 탭       | 블록 (뷰 컴포넌트)                                              | 봉투(콜러블)                                      | 축             | 화면에 축이 적혀 있었나                                         |
| -------- | --------------------------------------------------------------- | ------------------------------------------------- | -------------- | --------------------------------------------------------------- |
| ⓪ KPI    | 11지표 격자 `ScorecardMetricCard` — Activated·D7/14/30·Power 등 | `getAdminKpiCockpit.betaScorecard`                | **I**          | ✅ `AxisBadge`(metric.axis) + measuredAs 에 "단위는 설치" 명시  |
| ⓪ KPI    | Qualified Beta 사다리 · Paying Users                            | `getAdminBusinessSummary`                         | **F→A**        | ✅ 제목에 "(계정 축)"                                           |
| ⓪ KPI    | 사람 축 원수 3종(linked/with_task/active)                       | 같은 봉투 `personAxisCounts`                      | **P**          | ✅ 제목 "사람 축 (별도 축)" — 단 카드 자체엔 배지 없음          |
| ⓪ KPI    | 리텐션 정의 둘(신규 vs 기존 게이지)                             | 같은 봉투                                         | **I**          | △ "설치" 는 툴팁에만                                            |
| ① 획득   | 설치·채널 커버리지 헤드라인 / 채널표 / 국가표 / 일별 설치       | `getAdminInstallUnified`                          | **I**(+B)      | ✅ 제목 "(설치 축)" + AxisLimitNote                             |
| ① 획득   | 사람 추정 범위(5~47명)                                          | 같은 봉투 `hygiene.humanEstimate*`                | I→**추정**     | ✅ "범위의 폭이 정보"                                           |
| ① 획득   | 국가 퍼널 · 의심 유입                                           | `getAdminCountryFunnel`                           | **I+B**        | ✅ "방문 축" 명시                                               |
| ② 광고   | CAC · UTM · 광고 퍼널                                           | `getAdminCacSummary` / `getAdminOnboardingFunnel` | **B+I**        | ✅ 광고비는 브라우저 축이라고 적혀 있음                         |
| ③ 활성화 | 온보딩 퍼널                                                     | `getAdminOnboardingFunnel`                        | **I**          | ✅ INSTALL_COUNT_UNIT "건"                                      |
| ③ 활성화 | 통합 활성화·좀비 분리                                           | `getAdminInstallUnified.activation`               | **I**          | ✅                                                              |
| ④ 리텐션 | 헤드라인·코호트·채널                                            | `getAdminInstallUnified.retention`                | **I**          | ✅ `AnalyticsAxisSwitch`(event/person) 로 축 이름이 화면에 있음 |
| ④ 리텐션 | 사람 축 대조 `UnifiedPersonAxisComparison`                      | `retention.personAxis`                            | **P**          | ✅                                                              |
| ⑤ 수익   | MRR·결제                                                        | `getAdminBusinessSummary`                         | **A**          | ✅                                                              |
| ⑤ 수익   | 통합 수익·분류·결손 사유                                        | `getAdminInstallUnified.revenue`                  | **I**/P        | ✅ basis 라벨                                                   |
| ⑥ 운영   | 사용량·모델·릴리스·베타 세그먼트·드릴다운                       | 5개 콜러블                                        | **I / A 혼재** | △ 모델 요약은 cost(A)+events(I) 가 한 표에 — 라벨은 부분        |

판정:

- **이미 축 라벨이 대부분 있다.** 이 화면은 축 규율을 오래 지켜 왔다(`AxisLimitNote`,
  `AxisBadge`, `INSTALL_COUNT_UNIT`). 그래서 이 티켓은 기존 라벨을 다시 쓰지 않고,
  **없던 사람 축 블록을 붙이면서 그 블록에 배지를 강제**하는 데 집중했다.
- **KPI 의 Activated / D30 은 설치 축이다.** `buildBetaScorecard` 가
  `analytics_user_daily`(설치 단위)로 세고 `axis:"install"` 로 선언한다. 사람 축으로
  재계산되지 않는다 → 이 티켓이 사람 축 재계산을 **옆에** 붙였다(§2.3). 격자의 값은
  건드리지 않았다.
- **한 화면에 두 축이 라벨 없이 놓인 곳은 없었다.** 있었다면 회귀가 아니라 버그였을
  것이다. 다만 ⑥ 운영 모델 요약(cost_logs A + events I)은 라벨이 부분적이다 — 이 티켓
  범위 밖(운영 탭은 별 티켓)이라 손대지 않았고 여기 적어 둔다.

## 2. 붙인 것

### 2.1 서버 — `getAdminPersonAxisCohort` (`v3/functions/src/personAxisCohort.ts` + `index.ts`)

순수 로직(SQL 조립·경계 판정·끊긴 자리 판정)은 `personAxisCohort.ts`, I/O 는
`index.ts` 콜러블. `getAdminInstallUnified` 와 같은 규약(실패 → `unavailable` + 사유,
숫자 0 없음). 매니페스트는 `getAdmin*` 이름을 자동으로 싣는다.

| 봉투 필드               | 무엇                                                                                       | 출처                                                                        |
| ----------------------- | ------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------- |
| `boundary`              | ★실측 경계 `firstStampedAt` + env 선언 `declaredStampFrom` **나란히**                      | `buildEventStampBoundarySql` (`#1315` §2.4 의 그 함수 — 이제 실제로 쓰인다) |
| `sinceBoundary`         | 경계 이후 사람·설치·각인 행·미인증 행                                                      | `events` WHERE `timestamp >= @boundary`                                     |
| `daily[]`               | 일별 `activeInstalls`(I) 와 `people`(P). ★경계 이전 날 `people = null`                     | `events` 일별 GROUP BY; 경계 판정은 서버 조립측(SQL 에 경계 없음)           |
| `chain`                 | s1 브라우저 → s2 설치 → s3 사람 → s4 경계 이후 활동. `breakAtKey` + 사유 + identity 신선도 | `#1321` §3 쿼리 그대로 + `MAX(linked_at)` vs 원장 `MAX(linkedAt)`           |
| `cohortRows[]`          | GA4 source/medium/campaign/country × 링크 사람·활동 사람·각인 행·task 완료                 | `#1321` §6 정식 사슬 쿼리 그대로                                            |
| `installFallbackRows[]` | 같은 표를 **설치 축까지만** (사람 열 없음)                                                 | `ga4_first_touch_current ⋈ analytics_identity`                              |
| `personScorecard`       | 사람 축 Activated(task≥3) · D30(cohort/retained/pending) · linked                          | `v_person_since_link ⋈ analytics_user_daily`, 방침 게이트 열릴 때만         |

규율:

- **경계 하드코딩 0.** 테스트가 SQL 본문에 날짜 리터럴이 없음을 잰다. 스캔 하한은
  env 선언일(각인은 게이트가 켜진 뒤에만 생기므로 읽을 범위일 뿐 경계가 아니다).
  경계 쿼리가 실패하면 통째로 `unavailable` — 나머지는 전부 경계에 기댄다.
- **사슬 수리 0.** `analytics_identity` 를 읽기만 한다. `breakReason` 은 행이 말하는
  만큼만: "링크된 설치 N대 중 ga_key 가진 설치 M대, identity 마지막 갱신 T, 그 뒤
  원장 K건 미반영(별건 수리)".
- 가명 공간끼리만 조인(`us_`/`in_`/`ga_`). 솔트·원시 uid 없음.

### 2.2 화면 — `marblo-web/src/app/[locale]/admin/PersonAxisCohortPanel.tsx`

`AnalyticsPanel.tsx`(11.5k줄)에 넣지 않고 별 파일로 뒀다(순환 import 없음, 테스트가
firebase 초기화 없이 렌더). AnalyticsPanel 은 상태 하나·`runOptional` 한 줄·렌더
자리 넷만 늘었다.

| 컴포넌트                  | 자리           | 하는 일                                                                                                                                                                              |
| ------------------------- | -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `AxisTag` / `AxisStat`    | 전부           | ★축 배지가 **필수 prop**. 배지 없이 숫자를 그릴 방법이 타입에 없다. 단위도 축을 따른다(명/건/대/행)                                                                                  |
| `PersonAxisBoundaryView`  | ⓪ KPI          | 경계 카드(실측이 주인공, env 는 옆자리, 다르면 경고) · 경계 이후 원수 4장 · ★**차트 둘**: 설치 축(전 구간, 경계 세로선) / 사람 축(경계 이후만, 이전 날은 점 없음)                    |
| `PersonAxisScorecardView` | ⓪ KPI          | Activated(사람)·D30(사람, 분수만·분모 0 은 '판단 불가')·링크 사람. "위 격자는 설치 축이고 값 안 바꿨다" 고 화면이 말함                                                               |
| `Ga4PersonCohortView`     | ⓪ KPI · ① 획득 | 사슬 4단계(축 배지·남은 수·끊긴 단계 빨강 "★여기서 끊김"·왜 0 인가·identity 신선도) · 코호트 표(0행이면 "데이터가 없어서가 아니다 + 사슬 sN" + 복구되면 같은 자리) · 설치 축 폴백 표 |

상태 셋(연결 전 / 읽기 실패 / 로딩)과 각인 꺼짐·첫 행 없음에서 **숫자 0 을 그리지
않는다** — 테스트가 `BARE_ZERO`·`tabular-nums` 부재로 잰다.

### 2.3 KPI Activated / D30 — 축이 어디서 바뀌나

- 격자(설치 축): 값·정의·`measuredAs` **불변**.
- 새 블록(사람 축): 같은 정의(누적 task ≥ `ACTIVATED_MIN_TASKS_COMPLETED`=3 /
  첫 완료 task 날 +30일 창)를 `v_person_since_link` 위에서 사람 단위로. 화면 제목이
  "위 격자는 설치 축" 이라고 못 박고, 퍼센트는 만들지 않는다.

## 3. ★회귀 — 기존 숫자가 바뀌었나

**바뀐 숫자: 0.** 기존 콜러블·기존 뷰·기존 SQL 을 한 줄도 고치지 않았다(`git diff`
가 `AnalyticsPanel.tsx` 에서 바꾼 것은 import·상태·콜·렌더 자리·획득 탭 AxisLimitNote
한 문장 추가뿐).

바뀐 **테스트 기대값** 둘 — 숫자가 바뀐 게 아니라 테스트가 오래된 것이었다:

| 테스트                                                           | 전       | 후                                 | 왜                                                                                                                                                                        |
| ---------------------------------------------------------------- | -------- | ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 활성화 분 단위 열이 없으면 daysToFirstSpawn 으로 지어내지 않는다 | `18/577` | `2/12`, `12 / 608`                 | `#1310` 이후 픽스처가 "외부라고 말할 근거가 있는 12건"으로 바뀌었는데(픽스처 주석에 명시) 단언만 안 따라왔다. 이 두 테스트는 `main` 에서도 실패 중이었다(베이스라인 실측) |
| 사람 축 대조는 설치 단일값 대신 사람 추정 범위를 주인공으로 둔다 | `/577/`  | 외부 하한 12 · 전체 608 · 미상 565 | 같은 이유                                                                                                                                                                 |

## 4. 검증

| 항목                                                                                                | 결과                                                                                                                            |
| --------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| `v3/functions` `npm run test:person-axis-cohort`                                                    | 22/22                                                                                                                           |
| `v3/functions` `npx tsc --noEmit -p .`                                                              | exit 0                                                                                                                          |
| `marblo-web` `PersonAxisCohortPanel.test.tsx`                                                       | 19/19 (★빈 상태 = 실측 모양이 기본 케이스)                                                                                      |
| `marblo-web` `AnalyticsPanel.test.tsx` / `AnalyticsPanelStates.test.tsx` / `BetaScorecard.test.tsx` | 전부 통과                                                                                                                       |
| `marblo-web` `npm test` 전체                                                                        | 584 중 583 — 남은 1은 `team/teamCopy.test.ts` 인벤토리 드리프트(이 티켓과 무관, `main` 에서도 실패)                             |
| `marblo-web` `npx tsc --noEmit`                                                                     | exit 0                                                                                                                          |
| `marblo-web` `npx eslint` (바뀐 4파일)                                                              | 0 errors (기존 unused 경고 5건은 원래 있던 것)                                                                                  |
| `marblo-web` `npx next build --webpack`                                                             | ✓ Compiled · `/[locale]/admin` 생성. ★기본 Turbopack 은 이 로컬에 네이티브 바인딩이 없어 못 돌렸다(플랫폼 문제, Vercel 은 무관) |

★빈 상태를 직접 재현했다: `realShape()` 픽스처 = 사람 1(내부)·설치 2·사슬
863→550→0→0·코호트 0행·D30 분모 0. 이게 사장님이 지금 보실 화면이고, 그 화면에서
"데이터 없음" 문구가 없고 끊긴 단계(s3)와 이유(identity 08-20 정지, 원장 98건 미반영)가
찍히는 것을 단언한다.

## 5. 하지 않은 것 · 다음

- **배포 안 함.** functions 는 `firebase deploy` 가 별도(콜러블은 매니페스트가 없으면
  화면이 '연결 전' 으로 접는다 — 머지 직후 web 만 먼저 나가도 빨간 오류가 아니다).
  web 은 Vercel 자동. 실화면 확인은 오케.
- **사슬 수리 안 함.** `analytics_identity` 재백필/동기화는 별건 티켓. 복구되면
  `cohortRows` 가 같은 쿼리로 채워지고 화면의 빈 자리가 그대로 표가 된다.
- ⑥ 운영 탭 모델 요약의 A/I 혼재 라벨은 이 티켓 밖(§1).
- `team/teamCopy.test.ts` 인벤토리 드리프트는 팀 페이지 티켓 몫.
- 경계 이후 미인증(unstamped) 행이 커지면 `sinceBoundary.unstampedRows` 가 그 크기를
  화면에 그대로 보인다 — 결함이 아니라 설계(각인 문서 §2.5)라고 화면이 말한다.
