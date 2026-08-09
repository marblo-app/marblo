# 첫사용자 활성화 퍼널 완성 + 어드민 분석 정합성 — 2026-08-09

- **티켓**: `ygoWP1VJqJMH4nEH0OQx`
- **선행**: `#845 getAdminOnboardingFunnel` · `#888 온보딩 스톨 계측(buildOnboardingStallSummary)` ·
  `#881`(앱 설정 어드민 탭 제거 → **어드민 분석 정본 = marblo.app/admin 웹**)
- **원칙**: 새 파이프라인 없음. 신규 이벤트도 기존 `logTelemetry` choke point(비식별 scrub +
  firstParty 게이트) → `logTelemetryBatch` → BigQuery `marblo_telemetry.events` 로 간다.

## 1. 감사 결과 (BQ 90일 실측, john.kim ADC)

요구된 전 구간: 설치 → 인증 → needsAuth → authedButUnfunded → 폴더연결 → 첫대화 →
첫티켓 → 첫스폰 → 첫머지.

| 구간              | 이벤트                              | 감사 전 상태                                                                  |
| ----------------- | ----------------------------------- | ----------------------------------------------------------------------------- |
| 설치              | `app:installed`                     | ★**한 번도 발신된 적 없음**(0건). SQL 이 first_run 대체                       |
| 최초 실행         | `app:first_run`                     | 있음 (15건)                                                                   |
| 인증              | `auth:login_attempt/success/failed` | 있음 (7/6/1건)                                                                |
| needsAuth         | `onboarding:agent_needs_auth`       | emit 은 있으나 **퍼널 집계에 칸 없음** (데이터 0건)                           |
| authedButUnfunded | `onboarding:funding_guide_shown`    | emit 은 있으나 **퍼널 집계에 칸 없음** (데이터 0건)                           |
| 폴더연결          | `onboarding:folder_connected`       | 있음 (20건)                                                                   |
| 첫대화            | —                                   | ★**계측 전무**                                                                |
| 첫티켓            | `task:created`                      | ★90일 **11건**뿐 — 오케는 MCP(별도 stdio)로 Firestore 직접 write, 렌더러 우회 |
| 첫스폰            | `agent:spawned`                     | 있음 (5,790건)                                                                |
| 첫머지            | `task:merged`                       | 있음(49건)이나 **퍼널 집계에 칸 없음**                                        |

### 어드민 웹(정본) 결함

1. `onboardingStall`(#888)을 **화면이 렌더하지 않았다** — 서버는 계산해 내려주는데
   웹 타입에 필드조차 없었다.
2. `getAdminRetentionCohorts`(순차 활성화 게이트 + 리텐션 코호트)를 **호출조차 안 했다**.
   앱 어드민 탭 제거(#881) 이후 이 축은 어디에도 보이지 않았다.
3. `queryStatus` 를 화면이 무시 — 서버 러너(`runAdminAnalyticsQueries`)는 개별 쿼리
   실패를 삼키고 빈 배열을 준다. 그래서 **"쿼리가 죽어서 0"** 과 **"정말 0"** 이
   화면에서 구분되지 않았다.

### ★"데이터가 안 변한다"의 실제 원인 (버그 아님)

`metadata.accountUserId` 주입은 **2026-08-06 부터** 시작됐고(그 이전 전량 NULL),
현재 distinct accountUserId 는 **1개(운영자 본인)** 다. accountUserId 를 필수로 요구하는
활성화 게이트·활성유저 지표·리텐션 코호트는 `includeAdmin=false` 기본값에서 구조적으로
전부 0 이다. 화면은 이제 그 사실을 빈 상태 문구로 말한다(0 을 "아무도 안 왔다"로 읽지
않도록).

## 2. 변경

### 계측 (2건 추가)

| 이벤트                            | 발화 지점                                                                                                        | 필드                                        | 비식별 처리                                                                                                    |
| --------------------------------- | ---------------------------------------------------------------------------------------------------------------- | ------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| `onboarding:first_conversation` | 감지=메인 PTY 제출 초크포인트(`pty:write` CR / `pty:writeAndSubmit`, **오케 PTY `orch-` 한정**), 설치당 1회로 접기=렌더러 | `metadata.surface`, `metadata.lengthBucket` | **내용 미전송**. 글자 수도 원값이 아니라 구간. 터미널 직타는 길이를 알 수 없어 `unknown`(0 으로 지어내지 않음) |
| `onboarding:first_ticket`         | `taskStore` 보드 구독에서 티켓이 처음 보였을 때, **설치당 1회**                                                  | —                                           | 티켓 id·제목 미전송                                                                                            |

`task:created` 를 쓰지 않은 이유는 위 표의 실측(90일 11건) 그대로다. MCP→bridge 새
라우트를 뚫는 대안은 로컬 RCE 하드닝 표면을 넓히므로 택하지 않았다.

★두 이름과 소유권은 오케 조율로 확정됐다(질문 `#qmslitirzjqpk`): 이 두 이벤트의 소유자는
이 티켓이고, VzR1izqW(온램프)는 데모/전환 계층만 소유하며 이 둘을 emit 하지 않는다.
**단일 관측자 원칙** — 데모가 쓴 티켓이든 실제 오케가 만든 티켓이든, `first_ticket` 은
보드 관측자(여기)가 1회만 emit 한다. 이중 계상이 나지 않는다.

미이행(후속): 오케가 제안한 `first_ticket` 의 `metadata.origin`(demo|real) 플래그는
넣지 않았다 — 보드 스냅샷만 보고 데모 티켓을 구분할 수 있는 마커가 아직 없어서,
지금 넣으면 값을 지어내야 한다. VzR1izqW 가 티켓 문서에 그 마커를 정의하면 한 줄로
붙일 수 있다.

### 집계 (`adminAnalytics.ts` / `index.ts`)

- `ONBOARDING_FUNNEL_STEPS` 6+3 → **13칸**: `install` · `first_conversation` ·
  `first_ticket` · `first_merge` 추가.
- **`gating` 도입** — 이탈률/전환율의 기준선을 "배열의 직전 칸"이 아니라
  "직전 **gating** 칸"으로 바꿨다. 계측이 늦게 생긴 칸(첫대화·첫티켓)이나 시간창이
  다른 칸(첫머지 = 7일)을 순차 체인에 강제로 끼우면 그 뒤의 `agent_spawned` 가 통째로
  0 이 되어 **계측 공백이 제품 실패로 둔갑한다.** 기존 칸은 전부 `gating=true` 라
  수치가 한 자리도 바뀌지 않는다(§3 회귀검증).
- `FunnelStep` 에 `conversionFromPrev`(= 1 − 이탈률, 같은 분모) ·
  `conversionFromStart`(설치 대비 누적) 추가.
- `ONBOARDING_FAILURE_EVENTS` 에 `spawnBlocked` · `needsAuth` · `authedButUnfunded`
  추가 → needsAuth/authedButUnfunded 가 퍼널 화면에 **이탈 사유**로 등장한다
  (전진 단계가 아니다 — 스폰하려다 인증에 막힌 사람을 전진했다고 세면 안 된다).
- SQL: 본선 체인은 한 줄도 안 건드리고 `seq_ext` 레이어에서 비-gating 칸을 파생.
  실패 분기의 `COUNTIF`/`SELECT` 는 이제 상수에서 **생성**한다 — 손으로 적던 탓에
  상수에 칸을 늘려도 SQL 이 안 따라와 조용히 0 이 나오던 드리프트를 닫았다.
- ★**잔존 오염 차단**: 새로 스캔에 들어온 이벤트를 `sessions` CTE 에서 제외
  (`FUNNEL_EVENTS_EXCLUDED_FROM_RETENTION`). 이 CTE 는 (프로젝트×날짜) 조합 수로
  "7일 내 2번째 세션"을 근사하므로, 이벤트 종류가 늘면 `d_retained_7d`(베타종료 게이지
  입력)가 저절로 올라간다. 퍼널 칸을 추가했다는 이유로 잔존이 좋아지는 건 착시다.
- `getAdminKpiCockpit` 이 `queryStatus` 를 내려준다(부분 실패 노출).

### 어드민 웹 (`marblo-web/src/app/[locale]/admin/AnalyticsPanel.tsx`)

- 퍼널 뷰: 신규 칸 자동 렌더 + **단계별 전환율**(직전 대비·누적) 표시 +
  비-gating 칸에 `참고` 배지(그 감소를 제품 누수로 읽지 않도록).
- **온보딩 스톨 카드 신설**(#888) — 스톨 설치 수/비율, 스폰 사전차단, 로그인화면 정지
  (★철회 보정 후 `unresolvedAgents` 를 크게 표시하고 오탐률을 같이 보여준다),
  인증됐으나 미결제 비율(분모 = 판정이 난 설치), 차단 사유 분포, 가이드 모달 노출.
- **활성화 게이트 · 리텐션 코호트 섹션 신설**(`getAdminRetentionCohorts`) — 계정
  identity 축이라는 점과 그래서 왜 비어 있을 수 있는지를 빈 상태에 명시.
- **`QueryStatusBanner`** — 부분 쿼리 실패를 "0" 이 아니라 "못 읽음"으로 표기.

앱(v3) 설정의 어드민 탭은 **복원하지 않았다**(#881 유지).

## 3. 검증

- `v3/functions`: `tsc --noEmit` 0, `npm run test:admin-analytics` **71 pass**
  (신규 6: 전 스텝 존재 · 비-gating 격리 · 전환율 계약 · 분모 0 → null · 스톨 분기 ·
  note 정직성).
- `v3`: `tsc --noEmit` 0. `marblo-web`: `tsc --noEmit` 0, `eslint` 0 error.
- ★**라이브 BQ 회귀검증**: 변경 전/후 퍼널 SQL 을 같은 90일 창에 나란히 실행 →
  **기존 26개 컬럼 값이 전부 동일**. 신규 칸 실측:
  `install 10 → first_run 10 → login_attempt 6 → login_success 6 → folder 4 → orch_opened 4 → [첫대화 0 · 첫티켓 0(빌드 전)] → spawn 4 → 완료 0 → 머지 0`.

## 4. 남은 한계 (있는 그대로)

- 신규 이벤트 2종은 그 렌더러/메인 빌드가 실사용에 깔리기 전까지 **0** 이다. 구조가
  먼저고 데이터는 후행한다 — 화면의 `참고` 배지와 note 가 이 점을 말한다.
- `app:installed` 는 여전히 발신처가 없다. 데스크톱 앱에서 "설치"와 "최초 실행"을
  가르는 진짜 신호가 없어서, 없는 이벤트를 지어내는 대신 대체 신호임을 라벨에 적었다.
- 활성화 게이트/리텐션은 accountUserId 축이라 2026-08-06 이전 구간을 볼 수 없다.
  익명 clientId 기준 수치가 필요하면 온보딩 퍼널 쪽을 봐야 한다.
