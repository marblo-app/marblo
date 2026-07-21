# 베타 이탈 근본원인 분석 — "못 쓴 것" vs "안 쓴 것"

- **작성**: 2026-07-21, backend 에이전트 (읽기전용 데이터 분석)
- **티켓**: 2MiRAwZU7kxf6Ld33kge
- **데이터 소스**: BigQuery `marblo-2253d` (john.kim ADC, read-only, 무과금)
  - `marblo_telemetry.events` / `agent_heartbeats` / `cost_logs` / `task_outcomes` (앱 텔레메트리, location=US)
  - `analytics_543991508.events_*` (GA4, marblo.app 랜딩, location=asia-northeast3)
- **규칙 준수**: 데이터·코드 무변경. BQ read-only 조회만. 라이브 앱/git 무접촉.

---

## 0. 한 줄 결론

**지배적 원인은 "못 쓴 것"(온보딩·설치·신뢰성)이다. "안 쓴 것(써봤는데 가치를 못 느낌)"은 데이터상 성립하지 않는다** — 유튜브 유입 유저 중 제품의 가치 순간(작업 완료)에 도달한 사람이 **단 한 명도 없기 때문**이다. 가치를 못 느끼려면 먼저 제품이 동작하는 걸 봐야 하는데, 그 지점까지 간 유입 유저가 0이다.

사장님 가설("설문 침묵은 증상이고 리텐션이 원인")은 데이터와 **정합**한다. 다만 리텐션 붕괴의 원인은 "제품 가치 부재"가 아니라 **"가치를 경험하기 전에 막힌 것"**이다. 대응은 제품 재설계가 아니라 **활성화(activation) 구간 — 설치·로그인·첫 스폰까지 —의 수리**다.

---

## 1. 전체 퍼널 (실측)

두 개의 독립 데이터셋을 이어붙였다. 웹(랜딩)과 앱(텔레메트리)은 **식별자가 달라 개인 단위로 조인 불가**(§4 공백 참조)이므로 규모(magnitude) 체인으로 읽는다.

### 1-A. 프리앱 웹 퍼널 — GA4 marblo.app (2026-07-13 ~ 07-19)

| 단계                                       | 인원    | 직전 대비 |
| ------------------------------------------ | ------- | --------- |
| 랜딩 방문 (distinct visitor)               | **291** | —         |
| 스크롤 (페이지 관여)                       | 109     | −63%      |
| 폼 시작 (form_start)                       | 42      | −61%      |
| 리드 전환 (generate_lead)                  | 31      | −26%      |
| **다운로드 클릭** (download/file_download) | **16**  | −48%      |

- 방문→다운로드 전환 **5.5%** (291→16). 최상단 이탈이 가장 큼(랜딩이 다운로드를 설득 못 함) — 단 이건 마케팅/랜딩 문제이며 아래 앱 퍼널과는 별개 층.
- 유입 출처(7/13-16 first_visit): `(direct) 129`, `youtube.com 54`, `l.threads.com 21`, facebook 3, bing/google organic 소수. → **유튜브 공개가 트래픽 드라이버 확정**(direct 129 상당수도 영상 시청 후 URL 직접 입력으로 추정).
- 지역: 한국 184, 미국 13, 기타 소수. 사실상 국내 런칭.

### 1-B. 인앱 활성화 퍼널 — 텔레메트리 events (7/14 런칭 코호트, 22명)

`userId`는 **익명 UUID(설치별 clientId)**. 7/14에 처음 관측된 22명(= 유튜브 유입 실체)만 코호트로 격리:

| 단계                     | 측정 이벤트       | 인원   | 직전 대비           |
| ------------------------ | ----------------- | ------ | ------------------- |
| 앱 실행                  | `session:started` | **22** | —                   |
| 첫 에이전트 스폰         | `agent:spawned`   | **6**  | **−73%** ★최대 이탈 |
| 첫 실작업(LLM 토큰 발생) | `token:usage`     | **5**  | −17%                |
| **첫 작업 완료**         | `task:completed`  | **0**  | **−100%**           |

- **최대 이탈 = 앱 실행 → 첫 스폰 (22 → 6, 73% 증발).** 16명이 앱을 열고 에이전트를 **한 번도** 스폰하지 않았다. 그중 프로젝트 연결 흔적(이후 이벤트의 `projectId` non-null)이 있는 사람은 사실상 0 — 프로젝트 연결 이전 단계에서 멈췄다.
- **작업 완료 = 0.** 유튜브 유입 22명 중 제품의 핵심 산출(에이전트가 티켓을 완료)까지 간 사람이 없다.

### 1-C. 전체 윈도우 퍼널 (7/12~7/21, 도그푸드/파운더 포함 33명)

참고용 상위집합. 완료자 2명은 아래 §3에서 보듯 **전부 런칭 前부터 있던 계정**이다.

| 단계            | 인원                          |
| --------------- | ----------------------------- |
| session:started | 33                            |
| agent:spawned   | 11                            |
| token:usage     | 7                             |
| task:completed  | **2** (둘 다 도그푸드/파운더) |

---

## 2. 이탈자의 마지막 이벤트 — 어디서 멈췄나

7/14 코호트 22명을 마지막 도달 단계로 분류:

- **앱만 열고 끝(스폰 0): 16명 (73%).** 다수가 `session:started` 이벤트 1건, first==last 타임스탬프 — 앱을 열자마자 정확히 이벤트 하나 찍고 사라졌다. 프로젝트 연결도, 스폰도 없음.
- **스폰했으나 크래시/무산출: 스폰 6명 중 크래시·리스타트를 겪은 케이스 다수.** `agent:crashed` = `exitCode 1`, 약 60초 간격 재시작 루프(3f820e30·0fbc8f5d 등이 10분 내 10회 이상 crash→restart→crash). 스폰했지만 토큰을 전혀 못 뽑은 유저 존재 = **에이전트가 뜨자마자 죽는 경험**.
- **실작업까지 간 5명 중 완료 0.** 토큰은 나왔으나 티켓 완료(DONE)에 도달한 유입 유저는 없음.

두 이탈 지점(스폰 이전 / 스폰 직후 크래시)이 **둘 다 "못 쓴 것"** 방향을 가리킨다.

---

## 3. 17→1 붕괴의 시간축 (D0~D7 리텐션)

### 3-A. 랜딩 트래픽 (GA4 일별 distinct user)

| 날짜             | 방문자  |
| ---------------- | ------- |
| 07-12 (런칭 前)  | 2       |
| 07-13            | 45      |
| **07-14 (피크)** | **103** |
| 07-15            | 42      |
| 07-16            | 43      |
| 07-17            | 54      |
| 07-18            | 31      |
| 07-19            | 10      |

### 3-B. 앱 7/14 런칭 코호트 D0~D7 리텐션 (실측)

| 경과일    | 활성 유저 | 비율 |
| --------- | --------- | ---- |
| D0 (7/14) | 22        | 100% |
| D1        | 4         | 18%  |
| D2        | 2         | 9%   |
| D3        | 1         | 4.5% |
| D4        | 1         | 4.5% |
| D6        | 1         | 4.5% |

**이것이 "17→1 붕괴"의 실측 곡선이다.** 런칭일 22명의 신규 앱 유저가 **D3에 1명**으로 수렴. 그 1명조차 신규 유입이 아니라, 이후 데이터에서 보면 지속 활성 계정이다. 즉 붕괴는 "17명이 며칠 쓰다 질려서 떠난 것"이 아니라 **"22명이 첫날 열어봤다가 이튿날 대부분 안 돌아온 것"**이다. 이탈은 D1에 이미 결판났다.

### 3-C. 파운더 코호트 vs 일반 유입 분리 — ⚠️ 부분적으로만 가능

**익명 clientId라 로그인 uid(파운더 grant 대상) 기준 분리는 불가**(§4, 선례 `founder_activation_35v11_grant_gap`). 대신 **최초 관측 시점**으로 근사 분리:

- **런칭 前부터 활성(도그푸드/파운더 추정)**: 7/12 최초 관측 계정 `3a7c6019…`(9일 활성, 81세션, 작업완료 有). 이런 지속 계정이 붕괴 후 살아남은 "DAU 1"의 정체.
- **런칭 유입(7/14~)**: 22명 중 21명이 1일 활성 후 소멸. `token:usage`까지 5명, 완료 0.
- 예외: `394952…`(7/18 최초, 4일 활성, 38세션, 완료 有) — 런칭 後 유입이면서 정착한 유일 케이스이나, 익명이라 파운더 온보딩인지 순수 신규인지 **판정 불가**.

**코호트별 도달 요약(최초관측일 기준):**

| 최초관측일 | 인원 | 스폰 | 실작업 | 완료  | 2일+ 재방문 |
| ---------- | ---- | ---- | ------ | ----- | ----------- |
| 07-12      | 1    | 1    | 1      | **1** | 1           |
| 07-14      | 22   | 6    | 5      | **0** | 4           |
| 07-15      | 4    | 0    | 0      | 0     | 0           |
| 07-16      | 1    | 1    | 0      | 0     | 0           |
| 07-17      | 3    | 2    | 0      | 0     | 1           |
| 07-18      | 1    | 1    | 1      | **1** | 1           |
| 07-19      | 1    | 0    | 0      | 0     | 0           |

→ **작업 완료(reached_complete=1)는 7/12·7/18 계정뿐.** 런칭 유입(7/14·15·16·17·19) 코호트의 완료자 = 0.

---

## 4. 살아남은 소수는 무엇이 달랐나

- 생존자(`3a7c…`, `394952…`) 공통점: **작업 완료(task:completed)를 실제로 경험**, 세션 수 압도적(81·38), 다일 활성.
- 이탈자와의 결정적 차이: 생존자는 **에이전트가 티켓을 끝까지 완료하는 걸 봤고**, 이탈자는 스폰 전에 막히거나 스폰 직후 크래시로 그 순간을 못 봤다.
- 즉 리텐션의 분기점은 "가치 취향"이 아니라 **"첫 완료(first successful task)를 첫 세션에 경험했는가"**. 이건 activation 문제의 교과서적 형태다.

---

## 5. ★데이터 공백 (정직성 요구 — "측정 불가"를 "이탈 없음"으로 반올림하지 않음)

아래는 **답을 못 하는 구간**이며, 그 자체가 발견이다:

1. **다운로드 → 설치 → 앱 첫 실행: 미측정.** GA4 `download` 클릭(16)은 성공 설치도, 실행도 아니다. macOS 서명/공증, Windows EV 토큰, 패키지 로그인 heartbeat hang 등 알려진 설치·기동 버그(메모리 다수)가 이 구간에서 조용히 죽여도 텔레메트리에 안 잡힌다. **다운로드 16 vs 앱 실행 33(윈도우 전체)의 불일치**는 창(window)·도그푸드 혼입 때문이기도 하지만, 이 구간이 미계측이라 정밀 대사(reconcile) 불가.
2. **로그인 성공/실패: 이벤트 자체가 없음.** `events`에 auth/login 계열 이벤트가 0. `session:started`는 로그인 정보를 안 실음(projectId·metadata 전부 NULL, 한 실행에 여러 번 발화하는 노이즈 프록시). → **7/14의 "스폰 안 한 16명"이 로그인에서 튕겼는지, 로그인은 됐는데 프로젝트 연결에서 막혔는지 분해 불가.** 메모리의 로그인 버그 이력(electron43+firebase12 FATAL, packaged heartbeat IndexedDB hang, new-window origin 회귀, dev redirect)을 보면 로그인 실패가 이 16명의 상당 부분일 **개연성이 높지만, 텔레메트리로 정량화 불가.** 이것이 핵심 질문의 최대 맹점.
3. **프로젝트 연결: 전용 이벤트 없음.** 이후 이벤트의 `projectId` 존재로만 역추정. 연결 시도·실패는 안 보임.
4. **크래시 원인: `errorCategory`·`errorMessage` 전부 NULL.** 크래시가 났다는 사실만 있고 왜(인증? CLI 경로? spawn env?)는 미기록. 알려진 갭.
5. **식별자 조인 불가 (4중 단절):** GA4 `user_pseudo_id` ≠ 앱 익명 `clientId` ≠ 설문 응답자 email/login uid ≠ 파운더 grant uid. → (a) 인앱에서 파운더 vs 유튜브 유입 분리 불가, (b) **설문 미응답 40명을 활성 사용 데이터에 조인 불가**(Q5).
6. **6/22~7/12 텔레메트리 블랙아웃:** PR#137로 first-party 텔레메트리 기본 OFF → 6/22 14:54 UTC 하드 컷오프, 7/12 재개(도그푸드 ON). 런칭 직전 베이스라인이 이 공백에 걸림. 상세: `docs/telemetry-ingestion-investigation.md`.
7. **외부 유저 계측 범위 미확정:** 7/14 유입이 텔레메트리에 잡혔다는 것은 해당 빌드가 first-party 게이트 ON이었음을 의미하나, **모든** 외부 다운로더가 계측되는지(빌드/버전별 게이트 상태)는 이 분석 범위에서 확증 못 함. appVersion은 폴백버그로 대부분 `3.0.0`이라 버전 코호팅 신뢰 불가.

### 설문 미응답 40명 조인 (Q5) — 판정

직접 조인은 **§5-5로 불가**. 다만 **간접 정합**: 손수 고른 베타 40명조차 설문 응답 0건 + 텔레메트리상 유입 코호트 활성화 ≒ 0(완료 0, D3 생존 ≒ 0). "설문 안 한 사람 = 실제로 안 쓴 사람"이라는 가설은 **개인 매칭으로 증명은 못 하나, 집계 수준에서 강하게 지지**된다. 침묵과 미사용이 같은 방향으로 붕괴.

---

## 6. ★판정: "못 쓴 것" vs "안 쓴 것"

| 근거                                                | 가리키는 방향                               |
| --------------------------------------------------- | ------------------------------------------- |
| 유튜브 유입 22명 중 작업완료 **0**                  | "안 쓴 것" 성립 불가 (가치 순간 미도달)     |
| 최대 이탈이 실행→첫스폰 73% (16명이 스폰조차 안 함) | 초기 온보딩 차단 = **못 쓴 것**             |
| 스폰한 소수가 crash 루프(exit 1) 경험, 무산출 발생  | 신뢰성 파손 = **못 쓴 것**                  |
| D1에 82% 증발 (며칠 쓰다 떠난 게 아님)              | activation 실패 (질려서 떠남 아님)          |
| 완료 경험자만 생존                                  | 분기점 = 가치 취향 아닌 "첫 완료 도달 여부" |

**결론: 못 쓴 것이 지배적.** "안 쓴 것"은 관측되지 않는다 — 그러려면 제품이 동작하는 걸 본 유입 유저가 있어야 하는데 0이다.

단 정직하게: 스폰 안 한 16명의 이탈 사유는 로그인 실패(못 쓴 것)와 "유튜브 보고 호기심에 열었다 닫은 타이어킥"(≈ 안 써본 것) 두 모드가 **텔레메트리로 구분되지 않는다**(§5-2). 그러나 두 모드 **모두** "성숙 유저가 가치 없어 이탈"과는 무관하며, 둘 다 대응은 **첫 세션 activation 강화**로 수렴한다.

---

## 7. ★다음 액션 제안

방향은 **온보딩·신뢰성 수리**이지 제품/가치 재설계가 아니다. 우선순위:

### P0 — 계측 공백부터 메운다 (안 하면 다음 런칭도 장님)

- **로그인 성공/실패 이벤트 추가**(`auth:login_success` / `auth:login_failed` + 사유). §5-2가 핵심 질문의 최대 맹점 — 16명이 로그인에서 막혔는지 지금은 모른다.
- **앱 첫 실행·프로젝트 연결·onboarding 스텝 이벤트** 추가. `session:started`를 로그인 후 1회 발화로 정리(현재 노이즈).
- **크래시 사유 채우기**: `agent:crashed`에 `errorCategory`/`errorMessage`(exit 1의 실제 원인 — auth/CLI path/spawn env 구분).
- 관련 기존 티켓 `TdlWmESRnuGr7zltvRKM`(베타 세그먼트 뷰), #485(어드민 분석)와 계측 항목 정합 확인.

### P1 — 활성화 차단 요소 라이브 검증 (별도 티켓, 라이브 관측 필요)

- 유튜브 유입과 동일 조건(신규 macOS/Windows 사용자, 클린 머신)에서 **다운로드→설치→로그인→프로젝트 연결→첫 스폰**을 사람이 직접 통과해 보며 어디서 튕기는지 확인. 메모리의 로그인/설치 버그(electron43+firebase12, packaged heartbeat hang, new-window origin, mac 서명)가 살아있는지 재현.
- **첫 스폰 크래시 루프(exit 1)** 재현·근본원인. 스폰한 유저의 60%가 크래시를 겪었다면 이게 P1 최상단.

### P2 — 첫 완료(first successful task) 보장 설계

- 생존자는 전원 "첫 완료"를 경험했다. 신규 유저가 첫 세션에 **에이전트가 티켓 하나를 끝내는 걸 반드시 보게** 하는 가이드/샘플 프로젝트/원클릭 데모. activation의 북극성.

### 하지 말 것

- **제품 가치/포지셔닝 재설계로 직행 금지.** 데이터는 "가치가 없다"가 아니라 "가치를 볼 기회가 없었다"를 말한다. 지금 제품을 갈아엎으면 잘못된 문제를 푸는 것.

---

## 부록 A. 재현 쿼리 (읽기전용)

접근: `gcloud auth application-default print-access-token`(john.kim ADC) → BigQuery REST `jobs.query`, header `x-goog-user-project: marblo-2253d`. `marblo_telemetry`는 location=US, `analytics_543991508`은 asia-northeast3.

```sql
-- 7/14 런칭 코호트 D0-D7 리텐션
WITH c AS (
  SELECT userId FROM marblo_telemetry.events WHERE timestamp>=TIMESTAMP('2026-07-12')
  GROUP BY userId HAVING MIN(DATE(timestamp))=DATE('2026-07-14'))
SELECT DATE_DIFF(DATE(e.timestamp), DATE('2026-07-14'), DAY) day_offset,
       COUNT(DISTINCT e.userId) active_users
FROM marblo_telemetry.events e JOIN c USING(userId)
WHERE e.timestamp>=TIMESTAMP('2026-07-14') GROUP BY day_offset ORDER BY day_offset;

-- 코호트별 퍼널 도달
WITH first_seen AS (
  SELECT userId, MIN(DATE(timestamp)) fday FROM marblo_telemetry.events
  WHERE timestamp>=TIMESTAMP('2026-07-12') GROUP BY userId),
reach AS (
  SELECT userId, MAX(IF(event='agent:spawned',1,0)) spawned,
    MAX(IF(event='token:usage',1,0)) did_work,
    MAX(IF(event='task:completed',1,0)) completed
  FROM marblo_telemetry.events WHERE timestamp>=TIMESTAMP('2026-07-12') GROUP BY userId)
SELECT f.fday, COUNT(*) n, SUM(r.spawned) spawn, SUM(r.did_work) work, SUM(r.completed) done
FROM first_seen f JOIN reach r USING(userId) GROUP BY f.fday ORDER BY f.fday;

-- 웹 퍼널 (GA4, location=asia-northeast3)
SELECT COUNT(DISTINCT user_pseudo_id) visitors,
  COUNT(DISTINCT IF(event_name='form_start',user_pseudo_id,NULL)) form_start,
  COUNT(DISTINCT IF(event_name='generate_lead',user_pseudo_id,NULL)) leads,
  COUNT(DISTINCT IF(event_name IN ('download','file_download'),user_pseudo_id,NULL)) downloaded
FROM `marblo-2253d.analytics_543991508.events_*`
WHERE _TABLE_SUFFIX BETWEEN '20260713' AND '20260719';
```
