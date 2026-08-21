# 사람 축 배선 — 표·뷰를 실제로 만들고 인증 경로에 링크를 붙였다 (2026-08-21)

티켓 `euSq4AwHJrxSagMCjXeM`. 설계 정본은 `person-axis-user-key-design-2026-08-21.md`,
구현 정본은 `person-axis-implementation-2026-08-21.md` 다. **이 문서는 그 둘을 다시
쓰지 않는다.** 여기 적는 것은 셋뿐이다 — 무엇을 실제로 만들었나 / 무엇이 아직 안
흐르나 / 켜려면 배포 머신에서 무엇을 해야 하나.

---

## 0. 한 줄

**구현문서 §10 "켜는 순서" 의 3~6 을 했다. 표·뷰가 프로덕션 BQ 에 실재하고, 인증
경로가 링크를 MERGE 하고, 커버리지가 응답과 화면에 실린다. 그런데 배포 머신에
`PERSON_AXIS_EFFECTIVE_FROM` 이 들어가고 함수가 배포되기 전까지 링크는 0행이다.**

---

## 1. ★먼저 읽어야 할 한 문장 — 링크는 forward-only 다

배선이 끝나도 각 설치는 **다음에 로그인 상태로 앱을 쓸 때** 붙는다. 즉:

> **배포 직후 사람 축은 거의 비어 있다. 그게 정상이다.**

잠자는 설치는 며칠에서 영원히 안 붙는다. 이 사실을 적지 않으면 화면이
"켰는데 왜 비어 있지" 로 읽히고, 더 나쁘게는 **커버리지가 차오르는 동안 리텐션이
저절로 좋아지는 것처럼 보인다**(설계 §10.2). 그래서 이 문장을 세 군데에 박았다.

| 자리 | 무엇                                                                                 |
| ---- | ------------------------------------------------------------------------------------ |
| 코드 | `personAxis.PERSON_AXIS_FORWARD_ONLY_NOTE` — ★프론트 미러와 **글자까지 같다**(테스트가 고정) |
| 응답 | 기존 세 콜러블의 옵셔널 `personAxis` 봉투 — ★문자열이 아니라 **봉투의 존재**가 신호다(§5.1) |
| 화면 | 프론트(#1090)가 `personAxis` 가 있을 때만 **자기 상수로** 그 문장을 탭 머리에 그린다 |

★소급(`v_person_all_time`)은 forward-only 의 예외가 아니다. 소급은 **링크가 생긴
설치**의 과거 행을 그 사람에게 귀속하는 것이라, 링크가 없으면 소급할 것도 없다.

---

## 2. 실제로 만든 것 (프로덕션 `marblo-2253d`, US)

`npm run provision:person-axis -- --apply` 한 번으로 만들어졌고, **재실행하면
`(변경 없음)` + exit 0** 이다.

| 객체                                         | 종류     | 비고                                                                  |
| -------------------------------------------- | -------- | --------------------------------------------------------------------- |
| `marblo_identity`                            | 데이터셋 | ★기본 ACL 이 아니라 **좁힌 ACL**(§3)                                  |
| `marblo_identity.analytics_user_install`     | 표       | PARTITION `DATE(first_linked_at)` / CLUSTER `(user_key, install_key)` |
| `marblo_identity.v_person_since_link`        | 뷰       | 기본. `day >= GREATEST(first_linked_at, 2026-04-01)`                  |
| `marblo_identity.v_person_all_time`          | 뷰       | 캠페인 귀속 전용. `day >= 2026-04-01`                                 |
| `marblo_telemetry.analytics_user_daily`      | 표       | 사람 축 뷰의 원천. 스케줄 빌드가 채운다                               |
| `marblo_telemetry.analytics_install_profile` | 표       | 〃                                                                    |
| `marblo_telemetry.analytics_account_profile` | 표       | 계정축. 〃                                                            |

**손대지 않은 것:** `analytics_identity` · `events` · `analytics_purchase` ·
`install_attribution` · `cost_logs`. 존재 확인만 했고 `ALTER`/삭제 계열 **0건**.

### 2.1 뷰를 **열린 형태**로 만들었다 — 그 판단의 근거

구현문서 §10-4 는 "닫힌 상태로 먼저 만들어도 안전하다(0행)" 라고 **부가적으로**
허용한다. 그래도 열린 형태(상한 `2026-04-01`)로 만들었다.

- 뷰의 상한은 런타임 env 가 아니라 **DDL 시점에 박히는 값**이다. 닫힌 스텁으로
  만들면 배포 머신에서 env 를 넣은 뒤 `--replace-views` 재실행이라는 단계가 하나
  더 생기고, **잊으면 뷰가 조용히 0행으로 남는다** — 정확히 이 티켓이 막으라는
  오독이다.
- 소프트 오픈 위험이 없다: 적재 게이트(`planUserInstallLink`)는 여전히 런타임
  env 를 보므로, env 미설정 동안 링크가 0행이고 열린 뷰도 **붙일 게 없어 0행**이다.
  즉 이 선택이 연 것은 **뷰의 정의**이지 데이터가 아니다.

### 2.2 프로비저닝 스크립트가 하지 않는 것

`v3/functions/scripts/provision-person-axis.ts`:

- 삭제·덮어쓰기 계열 DDL(`DROP`/`ALTER`/`DELETE`/`TRUNCATE`)을 **한 줄도 내보내지
  않는다.**
- 이미 있는 객체를 **조용히 넘어가지 않는다** — 스키마를 대조하고 타입·모드·파티션이
  기대와 다르면 **exit 1 + 사유**. 조용히 덮으면 어느 쪽이 살아있는지 아무도 모른다.
- 뷰가 이미 있고 본문이 다르면 `--replace-views` 없이는 바꾸지 않는다(덮어쓰기는
  되돌릴 수 없다).
- 기본이 dry-run. `-- --apply` 를 명시해야 실행한다.
- 표를 만들기 **전에** `assertAxisPurity` 를 돌린다 — BigQuery 는 한 번 만든 컬럼을
  못 지우므로, 잘못된 축의 컬럼은 생성 전에 막는 것 말고 되돌릴 방법이 없다.

★스크립트를 쓰면서 **오탐 3건**을 잡아 고쳤다. 셋 다 스크립트 버그였고 스키마
문제가 아니었는데, 안 고쳤으면 매 실행마다 거짓 경고가 나서 경고가 늑대소년이 된다.

| 오탐                            | 원인                                                           |
| ------------------------------- | -------------------------------------------------------------- |
| `BOOL≠BOOLEAN`, `INT64≠INTEGER` | BQ API 가 표준 타입을 **레거시 별칭**으로 돌려준다             |
| 뷰 본문이 항상 "다르다"         | DDL 문자열을 `" AS "` 로 잘랐는데 본문 안에도 `" AS "` 가 있다 |
| 뷰 본문이 여전히 "다르다"       | BQ 가 뷰의 **선·후행 주석 블록을 저장하지 않는다**             |

---

## 3. ★권한 분리 — 이름이 아니라 IAM 으로 갈렸다는 증거

데이터셋을 나누는 것 자체는 분리가 아니다. 두 데이터셋의 principal 집합이 같으면
**이름표만 다른 같은 방**이다(설계 §4.2-3). 그래서 확인 가능한 형태로 남긴다.

### 3.1 ACL

| 데이터셋           | ACL                                                                                                     |
| ------------------ | ------------------------------------------------------------------------------------------------------- |
| `marblo_telemetry` | `projectOwners`(OWNER) · `projectWriters`(WRITER) · `projectReaders`(READER) · 소유자 1인(OWNER)        |
| `marblo_identity`  | `projectOwners`(OWNER) · **함수 런타임 SA 1개**(WRITER) — ★`projectWriters`/`projectReaders` **미부여** |

### 3.2 기계 확인 — 재실행 가능하다

```
cd v3/functions && npm run check:person-axis-isolation
```

```
── 사람 축 권한 분리 점검 ─────────────────────────────────────
  marblo_telemetry principal 수 : 4
  marblo_identity principal 수 : 2
  양쪽 다 읽는 principal          : 1   (projectowners)
  링크표만 읽는 principal         : 1   (함수 런타임 SA, 마스킹)
[ok] 데이터셋 이름이 아니라 IAM 으로 갈려 있다.
```

이 스크립트는 데이터를 한 행도 읽지 않고 메타데이터 `access[]` 만 보며, 이메일은
마스킹해서 찍는다. 분리가 깨지면 exit 1 이라 배포 게이트에 그대로 걸 수 있다.

### 3.3 ★그 차이가 **실제** 차이인가 — 확인했다

ACL 에서 `projectWriters` 를 뺀 것이 진짜 차단인지, 아니면 프로젝트 기본역할이
그걸 우회하는지가 이 절의 전부다. 우회하면 위 [ok] 는 **의미 없는 초록**이다.

```
gcloud iam roles describe roles/owner | roles/editor | roles/viewer
```

| 역할           | `bigquery.tables.getData`                                   |
| -------------- | ----------------------------------------------------------- |
| `roles/owner`  | **없음**                                                    |
| `roles/editor` | **없음** (`bigquery.tables.*` 15개 중 `getData`/`get` 없음) |
| `roles/viewer` | **없음**                                                    |

즉 **BQ 데이터 읽기는 프로젝트 기본역할이 아니라 데이터셋 ACL 로만 흐른다.**
따라서 `projectWriters` 미부여가 실제 차단이다 — 이 프로젝트의 `roles/editor`
서비스계정 2개(compute default / cloudservices)와 모든 Viewer 는
`marblo_telemetry` 는 읽고 **링크표는 못 읽는다.**

### 3.4 못 한 검증 하나 — 숨기지 않고 적는다

editor-only 서비스계정으로 실제 `SELECT` 를 때려 거부를 눈으로 보려 했으나
`gcloud auth print-access-token --impersonate-service-account` 이 PERMISSION_DENIED
다(현 계정에 `serviceAccountTokenCreator` 없음). **그 권한을 스스로 붙이는 것은
기존 IAM 수정이라 승인 대상**이므로 하지 않았고, 대신 §3.3 의 역할 권한 목록으로
같은 결론을 기계 확인 가능한 형태로 대체했다.

---

## 4. 인증 경로 배선 (설계 §5.1)

`logTelemetryBatch` 는 auth 강제라 이미 `context.auth.uid` 를 갖고 있다. 그 uid 를
**저장하지 않고 파생만** 한다.

```
인증된 텔레메트리 배치 도착
  → events insert (기존 그대로 — ★uid 안 붙음)
  → recordPersonAxisLink(uid, clientId, now)
      게이트 확인 → 솔트 확인
      → user_key = HMAC('user:'+uid) / install_key = HMAC('install:'+clientId)
      → planUserInstallLink (게이트·상한 판정)
      → MERGE ... ON T.row_id = S.row_id   (멱등)
```

- **클라이언트 변경 0.** 앱이 새로 보내는 값이 없다.
- **수집 항목 증가 0.** uid 는 이미 auth 로 오고 있고 저장하지 않는다.
- **이벤트 행 무변경.** 1,100만행을 건드리지 않는다.
- **실패해도 텔레메트리는 성공한다.** 링크는 분석 편의고 텔레메트리는 제품
  기능이다. 다만 조용히 삼키지 않고 사유를 로그에 남기고, 응답의
  `personAxisLink` 필드가 결과 코드를 돌려준다(`merged`/`throttled`/
  `gate_closed:unset`/`no_salt`/`no_install_id`/`not_written`/`error`).

### 4.1 ★스테이징 대신 인라인 MERGE — 설계 변경이 아닌 이유

설계 §6.1 은 "스테이징 로드 + MERGE" 라고 적었고, 그 **근거**는 "스트리밍 insert 의
insertId 중복제거는 수 분 창의 best-effort 라 재실행 중복을 못 막는다" 였다.
`buildUserInstallInlineMergeSql` 은 그 성질(=`row_id` MERGE 멱등)을 그대로 두고
스테이징 표만 뺀다.

뺀 이유: 부여 시점이 "그 설치의 로그인 후 첫 인증 요청" 이라 한 번에 들어오는
링크가 **한 줄**이다. 한 줄 때문에 스테이징 표를 만들고·로드하고·MERGE 하고·지우면
요청당 BQ 잡이 3~4개가 되고, 하나라도 실패하면 스테이징 표가 고아로 남는다.

★두 함수의 `WHEN MATCHED` / `WHEN NOT MATCHED` 절이 **글자까지 같아야 한다**는 것을
테스트가 지킨다(`★인라인 MERGE 는 스테이징 판과 같은 갱신 규칙이다`). 갈라지면
백필과 실시간 배선이 서로 다른 `first_linked_at` 을 남긴다.

여러 줄을 한꺼번에 넣는 백필 경로는 그대로 `buildUserInstallMergeSql`(스테이징 판)을
쓴다.

### 4.2 ★6시간 throttle — 무엇을 사는가

같은 `(user_key, install_key)` 는 인스턴스 메모리에서 6시간 동안 재-MERGE 하지
않는다. **정확성이 아니라 비용·쿼터** 때문이다 — 텔레메트리는 배치마다 오는데
링크는 설치당 사실상 한 번 정해지는 값이라, 배치마다 DML 을 돌리면 같은 한 줄을
하루에 수백 번 다시 쓰고 BQ 의 테이블당 DML 동시성에 그대로 부딪힌다.

대가는 `last_seen_at` 이 최대 6시간 늦는 것이다. 그 컬럼은 **소급 경계가 아니고**
(경계는 `first_linked_at` 이다) "최근 확인 시각" 이라 6시간 해상도로 충분하다.

---

## 5. 커버리지 노출 — ★별도 콜러블이 아니라 **기존 응답의 봉투**로

프론트(#1090)가 먼저 머지됐고, 거기엔 양쪽에 확정된 계약이 이미 구현돼 있다:
**기존 콜러블 응답에 옵셔널 `personAxis` 필드**. 계약 정본은
`docs/analytics-admin-callables-api.md` §`personAxis` 다.

```
personAxis?: {
  state, disabledReason, linkedInstalls, totalInstalls,
  linkedActiveInstalls, activeInstalls, excludedSharedInstalls,
  effectiveFrom, basis, lastLinkedAt
}
```

실은 곳(프론트가 이 **우선순위로 처음 있는 것**을 쓴다):

| # | 콜러블 | 커버리지 창 |
| --- | --- | --- |
| 1 | `getAdminInstallRetentionSummary` | 파생표 창(90일) — 이 축엔 조회 창이 없다(프로필 전량) |
| 2 | `getAdminStreakRetention` | 그 카드의 `rangeDays` |
| 3 | `getAdminRetentionCohorts` | 그 카드의 `rangeDays` |

★**별도 콜러블(`getAdminPersonAxisCoverage`)을 만들지 않았다.** 같은 사실에 두
경로가 생기면 어느 쪽이 맞는지 화면이 스스로 못 말한다. 초안에서 만들었다가
계약에 맞춰 걷어냈다.

★**없으면 상태가 아니라 '배선 전'** 이다 — 그때 화면은 기존 `PendingIngestion`
규약으로 접힌다. 그래서 프론트·백엔드 머지 순서가 어느 쪽이든 화면이 안 깨진다.
`loadPersonAxisCoverage()` 는 **던지지 않고**, 조회에 실패하면 0 으로 채우는
대신 `null` 을 돌려준다(0 으로 채우면 화면이 "사람이 없다" 로 읽는다).

값은 `computePersonAxisCoverage()` 가 그대로 만든다 — 프론트는 계산하지 않는다.

- 값을 만들지 않고 **센다.** 분자·분모가 전부 `COUNT`(`buildPersonAxisCoverageSql`)
- `complete` 판정은 `linkedActiveInstalls === activeInstalls` (잠자는 설치를
  기다리면 영원히 complete 가 안 되고 이 장치가 늑대소년이 된다)
- 공용 기기(`excludedSharedInstalls`)를 같이 센다. 현재 실측 **0건**
- 게이트가 닫혔으면 BQ 를 **아예 조회하지 않고** `state: "disabled"` + 사유

### 5.1 ★forward-only 를 화면이 말하게 하는 법 — 문자열이 아니라 **봉투**다

프론트는 `PERSON_AXIS_FORWARD_ONLY_NOTE` 를 **자기 상수로** 갖고 있고,
`personAxis` 봉투가 **있을 때만** 그 문장을 탭 머리에 띄운다(AnalyticsPanel
`personAxis ? PERSON_AXIS_FORWARD_ONLY_NOTE : null`).

즉 **봉투를 싣는 것이 곧 그 문장을 화면에 띄우는 것**이다. 서버가 같은 문장을
한 벌 더 실어 보내면 화면에 두 번 찍힌다 — 그래서 안 보낸다.

서버에도 같은 이름의 상수가 남아 있는 이유는 문서·로그용인데, **프론트 미러와
글자까지 같아야 한다.** 갈라지면 서버 문서와 화면이 서로 다른 말을 하고 어느
쪽이 맞는지 아무도 못 말한다. 테스트가 그 문자열을 통째로 고정한다.

## 6. ★배포 절차 — 이걸 안 하면 켜지지 않는다

### 6-1. 배포 머신(메인 체크아웃)에 env 를 직접 넣는다

```
# v3/functions/.env.marblo-2253d  (★gitignore 대상 — PR 로 배포되지 않는다)
PERSON_AXIS_EFFECTIVE_FROM=2026-04-01
```

값·근거: 사장님 결정(2026-08-21, **과거 포함**), 설계 §5.4-a,
`personAxis.ts` 상수 주석. **이 한 줄이 적재를 여는 스위치다.**

### 6-2. 확인

```
cd v3/functions && npm run check:deploy-env
```

`PERSON_AXIS_EFFECTIVE_FROM` 은 2026-08-21(#1089)부터 `REQUIRED_KEYS` 이고 값
형식(`YYYY-MM-DD`)까지 본다. **안 넣으면 배포가 막힌다** — 조용한 열화보다 시끄러운
실패가 낫다는 그 파일의 원칙이다.

### 6-3. 함수 배포

```
cd v3/functions && npm run deploy
```

★현재 프로덕션에 **배포되지 않은** 함수가 있다(코드에는 있는데 `gcloud functions list` 에 없다):

- `scheduledBuildAnalyticsProfiles` — 매일 05:30 KST. `analytics_user_daily` /
  두 profile 을 채운다. **이게 안 돌면 사람 축 뷰의 원천이 비어 있어 링크가
  쌓여도 0행이다.**
- `buildAnalyticsProfileTables` — 수동 트리거(멱등). 배포 직후 한 번 눌러
  스케줄을 기다리지 않고 채울 수 있다.
- `getAdminInstallRetentionSummary` — ★`personAxis` 봉투를 싣는 세 콜러블 중 첫째다

### 6-4. 배포 후 확인

```
cd v3/functions && npm run check:person-axis-isolation      # [ok] 여야 한다
```

```sql
-- 링크가 쌓이기 시작했는가 (forward-only 라 처음엔 0 이 정상)
SELECT COUNT(*) AS links, COUNT(DISTINCT user_key) AS people
FROM `marblo-2253d.marblo_identity.analytics_user_install`;

-- 원천이 채워졌는가
SELECT COUNT(*) FROM `marblo-2253d.marblo_telemetry.analytics_user_daily`;
```

그리고 어드민 → 리텐션 탭에서 사람 축 카드가 `적재 중 · N/M` 을 말하는지 본다.

### 6-5. 되돌리기

| 되돌릴 것               | 방법                                                                                                           |
| ----------------------- | -------------------------------------------------------------------------------------------------------------- |
| 적재만 멈춘다           | env 에서 `PERSON_AXIS_EFFECTIVE_FROM` 제거 → 게이트가 닫히고 `planUserInstallLink` 가 안 쓴다                  |
| 소급을 취소한다         | 링크표를 비운다(전체) 또는 `WHERE user_key = ?` 한 줄(1인, PIPA 제36조) — 뷰가 그 자리에서 그 사람을 못 찾는다 |
| 사람 축을 통째로 없앤다 | 링크표 하나를 지운다 — 나머지 축은 무사하다                                                                    |
| 상한을 내린다           | 뷰 정의 한 줄. `--replace-views` 로 재실행                                                                     |

★이벤트 행에 `user_key` 컬럼이 **없기 때문에** 이 표가 이렇게 짧다. 저장 소급이었다면
이 자리가 1,100만행 UPDATE 다.

---

## 7. 검증

```
npm run test:person-axis          49 pass / 0 fail   (38 → 49)
npm run test:analytics-profiles   48 pass / 0 fail
npm run test:analytics-pseudonym  19 pass / 0 fail
npm run test:analytics-id-scheme  14 pass / 0 fail
npm run test:admin-analytics      97 pass / 0 fail   (무회귀)
npm run build                     OK (index.ts 포함 전체)
marblo-web: tsc --noEmit OK / eslint 0 errors / 113 tests pass (★이 PR 은 프론트를 한 줄도 안 고친다)
```

### 7.1 ★뮤테이션으로 축 가드를 다시 확인했다

프로비저닝 스크립트가 BQ 를 만들기 **전에** 부르는 그 가드다.

| 뮤테이션                                        | 결과                                  |
| ----------------------------------------------- | ------------------------------------- |
| `analytics_user_daily` 스키마에 `user_key` 추가 | `FORBIDDEN_ON_ANONYMOUS_AXIS` 가 잡음 |
| 링크축에 `user_key` + `install_key` 동시        | **통과**(허용된 유일한 자리)          |
| 링크축에 `email` 추가                           | `FORBIDDEN_ON_LINK_AXIS` 가 잡음      |

### 7.2 ★배포된 뷰 SQL 을 합성 데이터로 실행해 봤다 (읽기 전용)

BQ 에 **저장된** 뷰 본문을 그대로 꺼내 원천 두 개만 합성 CTE 로 바꿔 돌렸다.
빌더가 아니라 **실제로 배포된 텍스트**를 검증한 것이다.

| 입력                     | `v_person_since_link` | `v_person_all_time` |
| ------------------------ | --------------------- | ------------------- |
| 상한(2026-04-01) 이전 행 | 제외                  | 제외                |
| 링크 이전 행             | **제외**              | **포함**            |
| 링크 이후 행             | 포함                  | 포함                |
| 공용 기기(계정 2개) 설치 | **제외**              | **제외**            |

`basis` 배지와 `effective_from`(2026-04-01)이 두 뷰 모두에 실려 나오는 것도 확인했다.

### 7.3 커버리지 SQL 을 프로덕션에 실제로 돌렸다 (읽기 전용)

전부 0 을 돌려준다 — 링크 0행, 원천 0행이므로 **맞는 값**이고, 그때
`computePersonAxisCoverage` 는 `pending` 을 돌려준다(0% 를 100% 로 그리지 않는다).

---

## 8. 이 티켓에서 하지 않은 것

| 미완                                                   | 이유                                                                                                                                                                             |
| ------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 실제 배포                                              | 배포 머신에만 `.env.<project>` 가 있다(§6). 이 워크트리에는 없다 — 정상                                                                                                          |
| `analyticsUserKey.ts` 배선 / `analytics_purchase` 백필 | 그 파일이 이 브랜치에 **없다.** 미머지 브랜치 `marblo/backend-claude-qm8n-6EnTiEzL` 의 커밋 `92da0c6d` — 여기서 같은 이름을 새로 만들면 머지 시 두 벌이 된다(구현문서 §9 그대로) |
| `uid28` 구간 백필(`link_source='uid28_inline'`)        | 설계 §11-3 의 열린 질문. 상한은 이제 그 구간을 덮지만 **백필을 만들지 않았다** — 별도 판단이 필요하다                                                                            |
| 솔트 Secret Manager 이관                               | 설계 §7 의 별건 권고. 사람 축이 열리면서 솔트가 "계정 연결을 막는 물건" 이 됐으므로 무게가 달라졌다 — 별도 티켓 권함                                                             |
| `analytics_user_daily` 실제 적재                       | 스케줄 함수가 아직 **배포되지 않았다**(§6-3). 코드는 있고 멱등이다                                                                                                               |
