# 팀 사용량 게이트 Phase 0 개방 — 실행 기록 (2026-08-31)

티켓 `cn8T9fSM4N0tte3ko8Df` · PR [#1347](https://github.com/melocream/marblo/pull/1347)
선행: `docs/team-usage-policy-notice-draft-2026-08-31.md`(#1335 문안 초안) ·
`docs/team-analytics-liveness-audit-2026-08-30.md` §3 · `docs/org-analytics-b2b-design-2026-08-31.md` §6.2

> 이 문서는 **되돌릴 때 읽을 문서**다. 무엇을 어떤 순서로 했고, 무엇이 언제
> 사용자에게 도달했고, 되돌리려면 무엇부터 되돌려야 하는지를 적는다.

---

## 0. 한 줄

사장님 승인(2026-08-31 텔레그램 "1번 승인 7일로")에 따라 **고지를 먼저 배포하고**
그 다음에 게이트를 좁혔다. 발효일은 고지 배포일 + 7 = **2026-09-07**.

---

## 1. ★순서 — 이게 이 작업의 전부다

```
① 방침 문면(앱 ko/en + 웹)  ─┐
② 인앱 4차 고지 배너          ├─ 고지
③ 배포(머지 → Vercel 프로덕션)┘
                              ↓  ★이 화살표를 거꾸로 하면 "고지 없이 목적 외 이용"
④ provision 확인
⑤ TEAM_USAGE_EFFECTIVE_FROM=2026-09-07 + functions 재배포  ─ 게이트
⑥ 실수치 확인
```

되돌릴 때도 역순이다. 게이트를 먼저 닫고, 그 다음에 문면을 되돌린다.

---

## 2. 무엇이 **언제** 사용자에게 도달하는가 ★

| 무엇                                           | 경로                    | 언제 도달하나                         | 상태                               |
| ---------------------------------------------- | ----------------------- | ------------------------------------- | ---------------------------------- |
| 웹 방침(marblo.app/ko/legal/privacy)           | Vercel 자동배포         | **머지 즉시**                         | ✅ 2026-08-31 도달 확인(익명 curl) |
| 인앱 방침(`privacyContent.tsx`)                | 앱 릴리스               | **다음 릴리스가 나가야**              | ⏳ 미도달                          |
| 인앱 4차 배너(`PRIVACY_CLARIFICATION_VERSION`) | 앱 릴리스               | **다음 릴리스가 나가야**              | ⏳ 미도달                          |
| 게이트 개방(`TEAM_USAGE_EFFECTIVE_FROM`)       | functions 배포 + 발효일 | 값은 배포됨, 창은 **2026-09-07** 부터 | ✅ 배포 확인 / ⏳ 창 비어 있음     |

★실측(2026-08-31): 사용자에게 나간 최신 릴리스는 **v3.0.35** 이고 v3.0.36·37·38 은
전부 Draft — 한 번도 안 나갔다. 즉 인앱 고지는 **지금 아무에게도 도달하지 않았다.**

**왜 지금은 문제가 아닌가**: 팀 기능을 쓰는 외부 사용자가 0명이다(#1331 §6 · #1333 §7).
고지의 수신자가 될 사람이 아직 없다.

**언제부터 문제가 되는가**: 외부 팀이 처음 생기는 순간. 그 사람은 웹 방침은 볼 수
있지만 앱 배너는 못 본다. 그래서 **v3.0.36 이상이 실제로 릴리스되기 전에는 외부
팀을 받으면 안 된다.** 이게 이 문서가 남기는 단 하나의 조건이다.

---

## 3. 발효일이 왜 코드가 지키는 약속인가

`TEAM_USAGE_EFFECTIVE_FROM` 은 기능 스위치가 아니라 **BQ 조회 창의 하한**이다
(`teamUsage.clampWindowToGate`, 질의는 `day >= @fromDay`). 그래서 발효일 이전 날짜의
사용량은 게이트를 나중에 열어도 관리자에게 **영원히** 보이지 않는다 — 소급 노출이
구조적으로 불가능하다. 그 사실을 문면에 그대로 적었다("그 이전 날짜의 사용량은
나타나지 않습니다"). 지킬 수 있는 약속만 적었다.

배포 확인(실측): `getTeamUsageSummary` 런타임 env `TEAM_USAGE_EFFECTIVE_FROM=2026-09-07`,
`state=ACTIVE`, `updateTime=2026-08-31T09:00:53Z`. ★다른 env 키는 존재 여부만 확인하고
값을 출력하지 않았다.

부작용을 알고 둔다: **2026-08-31 ~ 2026-09-06 동안 팀 스코프는 비어 있다**
(`state=empty`, `clippedByGate=true`). day >= 2026-09-07 인 행이 0이기 때문이다.
사전 통지 기간의 정상 모습이지 버그가 아니다.

---

## 4. provision — 바꾼 것이 없다

```
$ cd v3/functions && npm run provision:team-usage        # dry-run
[teamUsage] project=marblo-2253d location=US mode=dry-run
[ok] 원본 marblo_telemetry.cost_logs 확인(수정 안 함)
[skip] 뷰 v_team_usage_daily 이미 같은 본문이다 — 아무것도 하지 않는다.
[skip] 뷰 v_team_usage_unattributed 이미 같은 본문이다 — 아무것도 하지 않는다.
[계획] 바꿀 것이 없다.
```

`--apply` 도 같은 출력이다. 뷰 본문이 빌더 출력과 동일해서 `CREATE`/`REPLACE` 가
한 줄도 나가지 않았다.

### 4.1 교체 전 DDL (요구대로 저장 — 지금 살아 있는 본문과 같다)

`marblo_telemetry.v_team_usage_daily` (lastModified 1788112543145):

```sql
SELECT
  DATE(timestamp)                        AS day,
  projectId                              AS project_id,
  -- ★원장에 이미 있는 값. 가명화는 Node 안에서 한다(솔트를 SQL 에 넣지 않는다).
  userId                                 AS account_uid,
  model,
  -- actor_kind 는 새 컬럼이 아니라 기존 agentId 접두 규약의 파생이다.
  IF(STARTS_WITH(agentId, 'orchestrator-'),
     'orchestrator', 'worker')           AS actor_kind,
  COUNT(*)                               AS rows_n,
  -- 델타 0 행 비율을 화면이 스스로 말할 수 있게 같이 낸다.
  COUNTIF(totalCost = 0 AND inputTokens = 0 AND outputTokens = 0)
                                         AS rows_zero,
  SUM(inputTokens)                       AS input_tokens,
  SUM(outputTokens)                      AS output_tokens,
  SUM(cacheReadTokens)                   AS cache_read_tokens,
  SUM(cacheWriteTokens)                  AS cache_write_tokens,
  SUM(totalCost)                         AS cost_usd,
  COUNT(DISTINCT agentId)                AS distinct_agents,
  COUNT(DISTINCT NULLIF(taskId, ''))     AS distinct_tasks,
  COUNTIF(taskId IS NULL OR taskId = '') AS rows_without_task
FROM `marblo-2253d.marblo_telemetry.cost_logs`
-- ★프로젝트 식별자 결측 행은 어느 테넌트 것인지 모르므로 팀에 귀속할 수 없다.
--   규모는 옆의 unattributed 뷰가 행 수로만 낸다.
WHERE projectId IS NOT NULL AND projectId != ''
GROUP BY day, project_id, account_uid, model, actor_kind
```

`marblo_telemetry.v_team_usage_unattributed` (lastModified 1788112544130):

```sql
SELECT
  DATE(timestamp) AS day,
  userId          AS account_uid,
  COUNT(*)        AS rows_n
FROM `marblo-2253d.marblo_telemetry.cost_logs`
WHERE projectId IS NULL OR projectId = ''
GROUP BY day, account_uid
```

### 4.2 뷰 2개 실재 증명 (메타데이터가 아니라 `SELECT`)

| 뷰                          | type | 컬럼 | 행  | day 범위                |
| --------------------------- | ---- | ---- | --- | ----------------------- |
| `v_team_usage_daily`        | VIEW | 15   | 795 | 2026-04-18 ~ 2026-08-31 |
| `v_team_usage_unattributed` | VIEW | 3    | 76  | 2026-04-25 ~ 2026-08-31 |

---

## 5. 실수치 — 좁히기 **전에** 떴다

좁히고 나면 창이 비어서 사라지는 증거라, 배포된 테스트 창(`2026-04-01`, 사장님이
승인한 값)에서 먼저 확인했다.

| 분해 축  | 실수치        |
| -------- | ------------- |
| 멤버     | 5             |
| 프로젝트 | 24            |
| 모델     | 30            |
| 일수     | 81            |
| 토큰     | 1,775,145,563 |
| 비용     | $115,440.85   |

**★`0` 과 `미수집` 이 갈린다**: `cost_usd` 가 정확히 `0` 인 행 207 · 양수 588 ·
`NULL` **0**. 즉 화면의 `0` 은 진짜 0 이고 결측이 아니다.

일별도 실수치다: 08-31 n=16 $504.99 · 08-30 n=12 $384.84 · 08-29 n=24 $1,157.80 ·
08-28 n=14 $252.67 · 08-27 n=14 $280.29.

★축 순수성: 이 확인에서 `account_uid`·`project_id` 원본을 한 줄도 출력하지 않았다
(개수·합계만). 솔트는 SQL·GA4·클라이언트 어느 쪽으로도 나가지 않았다 — 뷰 DDL 이
직접 말하듯 가명화는 Node 안에서만 한다.

### 5.1 ⑥ 화면 검증 — 봉투 층에서 했다

GUI·Electron 실행이 금지라, 화면이 **받는 봉투**를 방금 배포된 바로 그
`teamUsage.js` 로 만들어 확인했다(데이터는 BQ 실행 결과 그대로, 가짜 값 없음).

배포 실측값 `TEAM_USAGE_EFFECTIVE_FROM=2026-09-07`, 2026-08-31 기준:

```
게이트: open=true effectiveFrom=2026-09-07
창:     2026-09-01 .. 2026-09-01 (clippedByGate=true, empty=true)
→ state=empty · 멤버 0 · 프로젝트 0 · 모델 0 · 일별 0
→ orchestratorAxis.state=not_collected
```

발효일 전이라 비어 있는 것이 맞다. **다만 §6.5 의 P0 때문에, 발효일이 지나도
계속 비어 있게 된다** — 그것까지 고쳐야 ⑥ 이 진짜로 끝난다.

★멤버 축을 이 하네스에서 검증하지 못한 이유는 제품 버그가 아니다.
`foldTeamUsage` 는 솔트가 없으면 가명을 못 만들어 멤버 행을 **원시값 폴백 없이
버린다.** 나는 가드레일대로 솔트를 반출하지 않았으므로 멤버 축은 원시 층에서만
확인했다(창 안 distinct `account_uid` = 5). 오히려 축 순수성이 지켜진다는 증거다.

---

## 6. 실행 중에 확인된 정정 2건 (별건 처리 필요)

1. **`teamUsage.ts` 머리주석이 낡았다.** "오케 축은 2026-06-22 이후로 한 행도 안
   잡힌다" 는 지금 사실이 아니다 — `actor_kind='orchestrator'` 가 2026-05-05 ~
   2026-08-31 로 124행 살아 있고 오늘도 5행 잡혔다(비용 $32,557 = 전체의 28%).
   `미수집` 사유가 해소됐다. 판정은 데이터 기반이라 **코드 버그는 없고**, 낡은
   것은 주석뿐이다. 이 티켓 스코프 밖이라 건드리지 않았다.
2. **`assessProvisionGate` 는 `provision-team-usage.ts` 에 없다.**
   `provision-person-axis.ts` · `provision-install-unified.ts` 전용이다. 팀 사용량
   스크립트는 머리주석대로 게이트와 무관하게 동작한다(게이트는 뷰가 아니라 콜러블이
   적용한다). #1327 이 겪은 함정은 사람 축 쪽이다.

---

## 6.5 ★P0 — 화면은 게이트와 무관하게 **항상 0행**이다 (별건 처리 필요)

⑥ 을 하다 찾았다. **이 티켓이 연 게이트를 무의미하게 만드는 결함**이다.

`functions/src/index.ts` 의 팀 사용량 BQ 질의 **3곳**(`:17471` · `:17570` · `:17739`)이
이렇게 부른다:

```ts
params: { fromDay: window.fromDay, /* "YYYY-MM-DD" 문자열 */ ... },
types:  { fromDay: "DATE", toDayExclusive: "DATE", projectIds: ["STRING"] },
```

`@google-cloud/bigquery` **8.3.1** 에서 STRING 값에 `DATE` 타입을 명시하면 파라미터가
**조용히 `NULL` 로 바인딩된다.** `day >= NULL` → `NULL` → 0행. **에러가 나지 않는다.**

실측(프로덕션 뷰에 직접, 창 `2026-08-02..2026-09-01`, `projectIds` 24개):

| 호출 모양                                     | 파라미터 해석  | 행 수   |
| --------------------------------------------- | -------------- | ------- |
| `params` + `types:{DATE}` ← **현행 프로덕션** | `null`         | **0**   |
| `params` only (타입 생략)                     | `"2026-08-02"` | **362** |
| `bq.date()` 사용                              | `"2026-08-02"` | **362** |

362행을 `foldTeamUsage` 까지 태우면 실수치가 나온다 — 프로젝트 13 · 모델 20 ·
일별 30 · $29,305.75 · 토큰 481,633,033 · `rowsInWindow` 147,447 ·
`rowsZeroPct` 60.9 · `hasOrchestratorRows=true`.

★**같은 버그를 이미 한 번 발견해서 다른 곳만 고쳐 놨다.** `index.ts:20489` 에
2026-08-30 자 주석이 있다:

> ★`types: { since: "DATE" }` 를 일부러 안 쓴다 — 실측(2026-08-30):
> @google-cloud/bigquery 8.3.1 에서 STRING 값에 명시적 DATE 타입을 씌우면
> 파라미터가 조용히 NULL 로 바인딩된다(WHERE 절이 0행을 준다, 에러 없음).

그때 고친 것은 그 호출부 하나뿐이고 팀 사용량 3곳은 남았다. `package-lock.json` 이
`8.3.1` 로 고정이라 Cloud Build 의 `npm ci` 도 같은 버전을 쓴다.

**수정안**(검증 완료): 그 3곳에서 `fromDay`·`toDayExclusive` 의 `"DATE"` 타입 선언만
지운다(`projectIds: ["STRING"]` 은 그대로 둔다). `:20489` 와 같은 이유 주석을 남긴다.

이 티켓 Scope 밖(`index.ts`)이라 **고치지 않았다.** 오케에 (a) 스코프 확장 또는
(b) 별건 P0 티켓 중 하나를 요청해 뒀다(`question_id=…#qmth0lmqkkhlz`).

---

## 7. 운영 메모

- **push 대상**: 이 워크트리에는 remote 가 둘이다. 브랜치가 추적하는 것은
  `origin`(melocream/marblo). `marblo-app` 으로 밀면 그쪽 히스토리의 옛 커밋
  `b46318a1`(slack 테스트 토큰) 때문에 GitHub push protection 이 막는다 — 내 커밋과
  무관한 기존 히스토리 문제다.
- **CI**: `lint`·`verify` 잡이 fail 로 뜨지만 코드 실패가 아니다. 잡이 시작조차 못
  했고 사유는 _"The job was not started because recent account payments have failed
  or your spending limit needs to be increased"_ — **GitHub Actions 결제/한도 문제**다.
  ★사장님 조치 필요.
- **`bq` CLI 가 죽어 있다**: "Reauthentication failed. cannot prompt during
  non-interactive execution". ADC(`application_default_credentials`)로 도는
  `@google-cloud/bigquery` Node 클라이언트는 정상이다. `bq` 를 쓰려면
  `gcloud auth login` 이 필요하다.
- **env 실물 위치**: `v3/functions/.env.marblo-2253d` 는 gitignore 라 워크트리에 없다.
  메인 체크아웃 `/Users/dongwonkim/Documents/programming/marblo` 에만 있다.
- **firebase CLI**: `npx firebase` 는 로컬에 없어 죽는다. PATH 에 nvm v22 bin 을
  앞세우고 `firebase` 를 직접 부른다.

---

## 8. ★컴플라이언스 재확인 (2026-09-06, 티켓 `sGPWq9rg9saIHWCaabK2`)

> 발효일(09-07)이 사장님 승인 사전 통지 7일의 만료일이라는 것이 확인되면서,
> "고지가 실제로 나갔는가"를 발효일 전날 다시 잰다. **아무것도 발송·게시하지
> 않았다** — 현황만 코드·설정·공개 API로 확인했다.

### 8.1 "배너 4개"의 정체 — 컴포넌트 1개, 버전 4회

`v3/src/services/privacyClarification.ts`를 코드로 읽었다. 배너는 **하나의
컴포넌트**이고, `PRIVACY_CLARIFICATION_VERSION` 문자열을 올릴 때마다 그 버전을
이미 닫은 사람에게도 다시 뜨는 구조다(로컬 스토리지 억제 키가
`uid:version`이라 버전이 바뀌면 새 사건이 된다). "4개"는 지금까지의 버전
이력 4회분을 가리킨다:

| 차수 | 버전 문자열             | 날짜  | 내용                                                                                     |
| ---- | ----------------------- | ----- | ---------------------------------------------------------------------------------------- |
| 1차  | (2026-08-10 계열)       | 08-10 | 익명화 강화 + 사용량·비용 기록 누락 고지 보완                                            |
| 2차  | `"2026-08-21"`          | 08-21 | 사람 축 분석 개방(가명 구분값) — `PERSON_AXIS_EFFECTIVE_FROM=2026-04-01`(과거 포함) 대응 |
| 3차  | `"2026-08-29"`          | 08-29 | 결합 고지 — 서비스 이용 기록과 웹사이트 방문 기록을 비식별 값으로 연결                   |
| 4차  | `"2026-08-31"`(=현재값) | 08-31 | **팀 요금제 관리자 열람** — `TEAM_USAGE_EFFECTIVE_FROM=2026-09-07` 대응. 이 티켓의 초점  |

### 8.2 8/31 이후 실제로 나간 것이 있는가 — 추측 없이 공개 API로 확인

★이 절만 라이브 값을 읽었다. 근거: 배포 여부를 문서/코드만으로는 답할 수
없고(릴리스는 `origin/main`과 별도로 "빌드 직전 컷"되므로 — §운영 메모의
`release-cut-at-build.md` 규율), 확인 방법이 프로덕션 Firestore 쿼리가
아니라 **공개 GitHub API + 공개 자산 파일**(둘 다 read-only, 시크릿 무관,
`melocream/marblo-releases`는 공개 저장소)이라 사전 보고 없이 바로 확인했다.

```
$ gh release list --repo melocream/marblo-releases
v3.0.36 … Draft   (2026-08-22)
v3.0.35 … Latest  (2026-08-21)   ← published
(v3.0.37/38/39: 목록에 아예 없음 — release 자체가 없다)

$ curl -sL https://github.com/melocream/marblo-releases/releases/download/v3.0.35/latest-mac.yml
version: 3.0.35
```

`docs/wiki/50-operations/release-cut-at-build.md`가 못박은 판정 기준
("사용자가 받나 = `latest-mac.yml`의 `version:` — 이게 진실")을 그대로
적용하면: **지금 이 순간 사용자가 자동 업데이트로 받는 버전은 3.0.35다.**
3.0.36은 GitHub에 Draft로만 있고(비공개, 일반 사용자에게 안 보임),
3.0.37/38/39는 release 자체가 존재하지 않는다(오늘 09-06 15:44 KST에
`package.json` 버전만 3.0.39로 올린 커밋(`eee57bbd`)이 있었지만, 그 문서
자체가 "이건 결번 처리 라벨이고 실제 배포와는 별개"라고 명시한다 — §7 운영
메모의 `release-cut-at-build.md` 인용 참고).

- **4차 고지(팀 사용량 관리자 열람) 커밋**: `1fc5b826`/`60c47525`, 2026-08-31 merge.
- **3.0.35 릴리스 공개**: `2026-08-21T08:13:38Z`(GitHub API `published_at`).
- 4차 고지 커밋이 3.0.35 공개보다 **10일 늦다** → **4차 고지는 3.0.35에 포함될
  수 없다.** 그리고 3.0.35 이후 어떤 published 릴리스도 없으므로(위 확인),
  ★**4차 고지는 지금까지 단 한 명의 사용자에게도 도달하지 않았다** —
  Draft냐 표시 조건이냐를 가를 필요도 없이, **애초에 그 코드가 실린 앱
  자체가 아무에게도 배포되지 않았다.**
- 참고로 2차 고지(`e5b57225`, 2026-08-21T05:14:14Z UTC)는 3.0.35 공개
  3시간 전에 머지됐다 — **3.0.35에 포함됐을 가능성이 높다**(3.0.35
  CHANGELOG 섹션의 "가명처리한 가명 구분값으로 사용자 단위 분석" 문구가
  2차 고지 내용과 일치). 다만 릴리스 브랜치가 정확히 어느 커밋에서
  컷됐는지 타임스탬프로 확정하지는 못했다 — ★**확인 못 함**(개연성 높음
  정도로만 적는다). 이 결론이 이 티켓의 핵심(4차)에는 영향 없다: 3차·4차는
  둘 다 3.0.35 공개보다 확실히 늦다.

### 8.3 표시 조건 — 코드로 짚는다. 새로 초대를 수락한 사람에게도 보이는가?

`shouldShowPrivacyClarification`(`privacyClarification.ts:109-119`)의 조건은
전부 만족해야 뜬다: `uid`가 있고, 동의 레코드를 로드했고(`consentLoaded`),
PIPA 동의 모달이 뜰 차례가 **아니고**(`!needsPolicyPrompt`), 이 기기에서
이 버전을 닫은 적이 없을 것. 코드 주석이 설계 의도를 명시한다: "아직 PIPA
동의 모달을 봐야 하는 사용자에게는 뜨지 않는다 — 그 사람은 지금 최신 문구를
통째로 읽고 동의하는 중이라 고지할 '변경'이 없다."

★그런데 이 설계는 **"최신 문구를 실제로 담은 앱을 그 사람이 쓰고 있을 때"만
성립한다.** 지금은 그 전제가 깨져 있다 — 새로 초대를 수락한 사람이 쓰게 될
앱(3.0.35, 자동 업데이트로 받는 유일한 버전)은 4차 고지 내용이 담긴 문구
**자체가 코드에 없는** 빌드다. 즉:

- **기존 사용자(이미 다른 버전에 동의 완료)**: 4차 배너가 뜰 코드 자체가
  설치된 앱에 없으므로 안 뜬다.
- **내일 초대를 수락할 새 사람(datagadapida·melocream)이 데스크톱 앱을
  설치·로그인할 때**: PIPA 동의 모달을 보게 되겠지만, 그 모달이 보여주는
  "최신 문구"도 **3.0.35에 번들된 정적 문구**다 — 4차 고지에 해당하는
  단락이 그 안에 없다(같은 이유: 코드가 배포 안 됨). ★**두 경우 다
  안 뜬다. Draft냐 표시 조건이냐를 가를 필요가 없는, 더 근본적인 이유다.**

### 8.4 그런데 웹 쪽 경로가 하나 더 있다 — 다른 채널, 다른 강도

★이건 이 티켓이 원래 겨냥한 "인앱 배너"는 아니지만, "약속을 지켰는가"를
정직하게 답하려면 빼놓을 수 없어 같이 적는다.

- `marblo.app/legal/privacy` 웹 페이지는 Vercel로 **머지 즉시** 배포된다
  (§2 실측대로 2026-08-31 도달 확인됨 — 위 인앱과 배포 경로 자체가 다르다).
  이 페이지는 `marblo-web/src/lib/teamUsageDisclosure.ts`에서 문구를
  가져오는데, 그 파일에 4차 고지와 동일한 내용의 문단이 **이미 들어 있다**
  ("2026년 9월 7일부터 회원님이 속한 프로젝트의 관리자와... 사용량을...
  열람할 수 있습니다", 로케일별 원문 확인함).
- 계정이 없는 새 초대자는 `/join/<token>` → "계정 만들기" 버튼 →
  `/auth/signup`으로 간다. 그 화면은 `PrivacyConsentFields` 컴포넌트로
  처리방침 **동의 체크박스 + 링크**를 보여준다(체크 안 하면 가입 진행이
  안 되는 형태로 보인다 — 다른 필수 동의 항목의 표기 패턴과 동일).
  ★그 링크가 가리키는 페이지에는 4차 고지 내용이 이미 있다.
- ★그러나 이건 **능동적 배너가 아니라 "링크를 눌러야 보이는" 수동적
  고지**다. 체크박스에 체크만 하고 링크를 안 열면 그 사람은 문구를 실제로
  보지 못한 채 가입이 끝난다. 사장님이 승인하신 "고지"가 이 정도의 수동적
  경로로도 충분한지는 ★**법무·정책 판단이지 코드로 답할 수 있는 사실이
  아니다** — 나는 "이 경로가 존재하고 지금 라이브다"까지만 확인한다.

### 8.5 두 게이트의 고지가 같은가 다른가

`TEAM_USAGE_EFFECTIVE_FROM`(조직·팀 비용, 미래 발효일 2026-09-07, 사전
통지형)과 `PERSON_AXIS_EFFECTIVE_FROM`(사람 축, 과거 날짜 2026-04-01,
소급 포함형)은 ★**서로 다른 고지(4차 vs 2차)에 대응하는 서로 다른
게이트다** — 같은 사전 통지 메커니즘을 공유하지 않는다. 2차(사람 축)는
발효일이 이미 지난 과거값이라 "사전 통지 기간"이라는 개념 자체가 없고(승인
당시 이미 소급 허용으로 결정됨, `personAxis.ts:18` 주석), 4차(팀 사용량)만
"고지 먼저, 게이트는 +7일 후"라는 사전 통지 구조를 가진다. 그래서 이번
컴플라이언스 위험은 **4차에만 해당한다** — 2차는 애초에 사전 통지를
약속한 적이 없다.

### 8.6 안 나갔다면 — 무엇을, 어떤 순서로 하면 나가는가 (절차만, 실행 안 함)

1. `docs/wiki/50-operations/release-cut-at-build.md`의 절차대로 **사람이**
   서명·공증 빌드를 새로 컷한다(`origin/main` 최신 기준 — 4차 고지 코드는
   이미 `main`에 있다). 이 저장소에서 이 단계는 명시적으로 "에이전트가
   임의로 하지 않는다"로 못박혀 있다.
2. `electron-builder`로 빌드 후 GitHub에 **Draft가 아니라 published**
   릴리스로 올린다(`melocream/marblo-releases`, private 소스가 아니라
   반드시 이 공개 피드).
3. `latest-mac.yml`/`latest.yml`의 `version:`이 새 버전으로 바뀌었는지
   공개 URL로 재확인한다(§8.2와 같은 방법 — 시크릿 불필요).
4. 그 이후에만 "4차 고지가 사용자에게 도달했다"고 말할 수 있다. ★TEAM_USAGE
   게이트는 이미 09-07로 설정돼 있어 별도 조치가 필요 없다 — 이 절차가
   빠진 채 09-07이 지나면, 게이트는 열리는데 고지는 여전히 아무에게도
   안 나간 상태가 된다(이 문서 §0가 걱정하던 "약속을 거뒀는데 아무도
   모르는" 상태 그 자체).
5. (선택, 법무 판단 필요) §8.4의 웹 경로만으로 "고지 완료"로 볼지, 인앱
   배너 도달까지 봐야 할지는 사장님·법무의 판단 영역이다 — 이 문서는
   사실만 남긴다.

### 8.7 확인 못 한 것

- 2차 고지가 3.0.35에 정확히 포함됐는지(§8.2) — 정황 증거(머지 3시간 전 +
  CHANGELOG 문구 일치)는 강하지만 릴리스 브랜치 컷 시각을 직접 확인하지
  못했다.
- `/auth/signup`의 처리방침 체크박스가 실제로 **필수(체크 안 하면 제출
  불가)**인지 화면 실행으로 검증하지 못했다 — 코드 구조상 필수형 UI
  패턴과 동일해 보이지만, GUI 자동 검증 금지 제약과 프로덕션 미실행
  원칙에 따라 코드 읽기로만 판단했다.
- 기존에 이미 앱을 쓰고 있고 팀 요금제가 아니던 사용자가 09-07 이후 새로
  팀 요금제/조직에 결합될 때, 그 순간에 별도 트리거로 무언가 알림이
  가는지는 확인하지 않았다(이 티켓 스코프인 "고지 배너 발송 여부"와는
  결이 다른 질문이라 스코프 밖으로 남긴다).
