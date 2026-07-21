# 존킴(운영자) 제외 후 실사용 활동 실측 — 스폰·토큰·이벤트

- **티켓**: p1TmESsDBlHzUeZ1l4Vt
- **작성일**: 2026-07-21
- **데이터 소스**: BigQuery `marblo-2253d.marblo_telemetry` (john.kim ADC, read-only, 무과금)
- **스냅샷 시점**: events 테이블 라이브 스트리밍 중 — 전기간 events 총계는 조회 시점에 따라 ±수십 건 변동(이 리포트는 72,964건 시점 기준)
- **성격**: 조회·분석 전용. **코드·데이터 무변경.**

---

## 0. 사장님 질문에 대한 한 줄 답

> 어드민 분석에서 존킴(운영자) 계정을 빼면 스폰수·토큰 사용량이 정말 다 못한 수준인지.

**그렇다.** 존킴을 빼면 **가치를 생성한 외부 활동은 사실상 0**이다:

- **토큰·LLM 비용은 100% 존킴.** cost_logs 63,487행 전부가 존킴 uid 하나(distinct uid=1). 외부 사용자 토큰·비용 = **0**. 익명 telemetry 의 `token:usage` 이벤트(63,225건)도 **100% 존킴**, 외부 토큰 = 0.
- 존킴 제외 후 남는 명목 외부 활동(전기간 spawn 822건)은 **① 토큰 0의 dev/미패키지 버스트**와 **② 서명 릴리스(3.0.0) 베타 코호트가 열어만 보고 이탈**한 것으로 분해된다. **어느 쪽도 실작업(토큰·완료)을 남기지 못했다.**

이 결론은 별도 관점의 [베타 이탈 근본원인 분석(2026-07-21)](./beta-churn-root-cause-analysis-2026-07-21.md)과 **정합**한다(그쪽은 7/14 유튜브 코호트 22명 기준, 이쪽은 존킴 제외 전기간 기준).

---

## 1. 제외 메커니즘 검증 — resolveAdminClientIds 는 8개 clientId 를 잡는다 (0 아님)

`getAdminUsageSummary`/`getAdminModelSummary`/`getAdminDrilldown` 이 쓰는 제외 로직을 **코드 그대로** BQ 에서 재현(`v3/functions/src/index.ts:5401`):

- cost_logs 에서 `userId = ADMIN_UID` 인 agentId 집합을 뽑고 → events 에서 그 agentId 를 가진 익명 `userId`(clientId)를 역참조.
- lookback = clamp(rangeDays, 90, 365).

| lookback | 잡힌 admin clientId 수 |
| -------- | ---------------------- |
| 90일     | **8**                  |
| 365일    | **8**                  |

→ **제외기는 실제로 작동한다**(clientId 8개 확보 → 이 8개가 전체 events 의 97%를 차지). "0개라 제외가 사실상 무효"인 케이스는 **아니다.**

### ⚠️ 제외기의 blind spot (반드시 인지)

이 제외기는 **cost_logs 에 agentId 흔적이 있는 세션만** 존킴으로 인식한다. 즉 **토큰 비용이 로깅되지 않은 세션(무인증/dev 빌드/크래시 루프)**에서 만든 agentId 는 cost_logs 에 없으므로, 그 clientId 는 존킴 것이라도 **제외되지 않고 '외부'로 계상된다.** 아래 3장의 null-appVersion 버스트가 정확히 이 사각지대에 해당한다.

---

## 2. 존킴 포함 vs 제외 — 나란히 대조 (events)

익명 events 테이블(`userId` = 설치별 익명 clientId). 제외 = 위 8개 admin clientId 를 뺀 값. `userId IS NULL` 행은 코드와 동일하게 '외부'로 유지.

| 구간   | events 포함 | events 제외 | spawn 포함 | spawn 제외 | distinct client 포함 | distinct client 제외 | distinct agent 포함 | distinct agent 제외 |
| ------ | ----------: | ----------: | ---------: | ---------: | -------------------: | -------------------: | ------------------: | ------------------: |
| 7일    |      21,784 |   **2,186** |      2,335 |    **822** |                   33 |               **26** |               1,228 |             **386** |
| 30일   |      36,538 |   **2,186** |      2,491 |    **822** |                   33 |               **26** |               1,443 |             **386** |
| 전기간 |      72,964 |   **2,186** |      4,106 |    **822** |                   34 |               **26** |               1,882 |             **386** |

**읽는 법:**

- 제외 후 수치(2,186 / 822 / 26 / 386)가 **7·30·전기간 모두 동일** → 존킴 제외 후 남는 외부 활동은 **전부 최근 7일 안에** 몰려 있다. 그 이전 기간의 활동은 거의 100% 존킴이었다.
- 존킴은 events 의 **97%**(72,964→ 제외 후 2,186), spawn 의 **80%**(4,106→822), agent 의 **79%**(1,882→386)를 차지. 운영자 도그푸드가 지표 대부분을 채우고 있었다.

---

## 3. 토큰·비용 — 100% 존킴, 외부 = 0

### 3-A. cost_logs (인증된 비용 파이프라인, 실제 uid 보관)

| 구간   | input+output 토큰(포함) | 토큰(제외) | 전체토큰(캐시포함, 포함) | 전체토큰(제외) | 비용 USD(포함) | 비용 USD(제외) | distinct uid |
| ------ | ----------------------: | ---------: | -----------------------: | -------------: | -------------: | -------------: | -----------: |
| 7일    |             101,075,282 |      **0** |            4,444,815,921 |          **0** |      $2,762.38 |      **$0.00** |            1 |
| 30일   |             129,649,749 |      **0** |            5,849,025,166 |          **0** |      $3,625.80 |      **$0.00** |            1 |
| 전기간 |           1,165,880,817 |      **0** |          145,934,464,214 |          **0** |     $79,782.17 |      **$0.00** |            1 |

- cost_logs 63,487행 **전부** `userId = ADMIN_UID`. distinct uid = **1**. 외부 행 = 0.
- → 존킴 uid 제외(`adminUidExclusion`) 적용 시 토큰·비용이 **전액 사라진다.** 외부 사용자가 만든 LLM 비용은 데이터상 **존재하지 않는다.**

### 3-B. events 의 `token:usage` (익명 telemetry 토큰 스트림)

| 구간   | 토큰(포함, evt) | 토큰(제외, evt) | token:usage 건수(포함) | token:usage 건수(제외) |
| ------ | --------------: | --------------: | ---------------------: | ---------------------: |
| 7일    |      98,173,602 |           **0** |                 15,836 |                  **0** |
| 30일   |     126,822,730 |           **0** |                 30,260 |                  **0** |
| 전기간 |   1,161,709,479 |           **0** |                 63,225 |                  **0** |

- 익명 경로에서도 **외부 clientId 는 `token:usage` 이벤트를 단 1건도 남기지 않았다.** 외부는 스폰(agent:spawned)만 찍고 토큰을 뽑지 못했다 = **에이전트가 뜨자마자 죽는 경험**(3장 crash 패턴 참조).

---

## 4. "외부 822 spawn"의 정체 — 2층으로 분해

존킴 제외 후 남는 822 spawn / 2,186 events 는 하나의 균질한 "베타 사용"이 아니다. appVersion 으로 쪼개면:

| appVersion | 외부 events | distinct client | spawn |  토큰 | 정체                       |
| ---------- | ----------: | --------------: | ----: | ----: | -------------------------- |
| **(null)** |       2,044 |               4 |   784 | **0** | dev/미패키지 빌드 — 버스트 |
| **3.0.0**  |         142 |              23 |    38 | **0** | 서명 릴리스 베타 코호트    |

### 4-A. null-appVersion 버스트 (진짜 사용 아님)

- 4개 client 중 **1개(`67e9..f83`)가 지배**: events 2,005 / spawn 770 / 토큰 **0** / 활성일 07-17~07-18 **2일**.
- 이벤트 구성이 `agent:spawned`(822) + `agent:restarted`(436) + `agent:crashed`(383)의 **crash→restart 루프**. 토큰 산출은 0.
- appVersion 이 null = 패키지 릴리스가 아닌 dev/미서명 빌드일 가능성이 높고, **cost_logs 에 흔적이 없어(1장 blind spot) 존킴이라도 제외되지 않는다.** 익명이라 존킴 dev 세션인지 순수 외부 broken-build 인지 **판정 불가**하나, 어느 쪽이든 **가치 생성 사용이 아니다.**

### 4-B. 3.0.0 릴리스 베타 코호트 (열어만 보고 이탈)

- 23개 client, 총 142 events, spawn 38, **토큰 0**. client 당 평균 ~6 events / <2 spawn.
- 대부분 `session:started`(외부 45건, 26 client) 후 후속 없음. 7/14 유입 코호트가 **설치·실행까지는 갔으나 첫 스폰/작업 완료에서 증발**한 그림.

### 4-C. 외부 이벤트 타입 분포 (전기간)

| event               | 건수 | client |
| ------------------- | ---: | -----: |
| agent:spawned       |  822 |      4 |
| agent:restarted     |  436 |      3 |
| dispatch:decision   |  385 |      4 |
| agent:crashed       |  383 |      3 |
| model:tier_resolved |   54 |      3 |
| model:top_fallback  |   53 |      2 |
| session:started     |   45 |     26 |
| agent:stopped       |    4 |      2 |
| chat:message_sent   |    3 |      1 |
| task:created        |    1 |      1 |

- `task:completed` = **0**. 외부 사용자 중 **에이전트가 티켓을 완료한 사람은 없다.**

---

## 5. 외부 활동 일별 타임라인 (최근 21일, 존킴 제외)

| 날짜       | 외부 events | 외부 spawn | 외부 distinct client |
| ---------- | ----------: | ---------: | -------------------: |
| 2026-07-21 |           0 |          0 |                    0 |
| 2026-07-20 |           1 |          0 |                    1 |
| 2026-07-19 |           2 |          0 |                    1 |
| 2026-07-18 |         913 |        346 |                    1 |
| 2026-07-17 |       1,134 |        438 |                    3 |
| 2026-07-16 |          97 |         37 |                    1 |
| 2026-07-15 |           8 |          0 |                    6 |
| 2026-07-14 |          31 |          1 |                   17 |
| 07-13 이전 |           0 |          0 |                    0 |

- **07-17~07-18 이틀이 spawn 의 대부분(784/822)** 을 차지하고, 그 대부분이 1개 null-appVersion client 의 crash-restart 루프(4-A).
- **07-14 = 17 distinct client** 가 몰려 들어왔으나 events 31·spawn 1 뿐 → 열어보고 즉시 이탈(베타 코호트).

---

## 6. 베타 이탈 분석과의 정합성 (관점 차이 명시)

| 항목      | 이 리포트 (존킴 제외, 전기간)                   | 베타 이탈 분석 (7/14 코호트, 22명)     |
| --------- | ----------------------------------------------- | -------------------------------------- |
| 대상      | 존킴 제외 후 **모든** 외부 client(전기간, 26명) | 7/14 최초 관측 유튜브 유입 22명만 격리 |
| 앱 실행   | session:started 외부 45건 / 26 client           | session:started 22                     |
| 첫 스폰   | spawn 822(단 784가 dev 버스트), 3.0.0 코호트 38 | agent:spawned 6 (22→6, −73%)           |
| 작업 완료 | task:completed = **0**                          | 완료 = **0**                           |
| 토큰      | 외부 = **0**                                    | token:usage 5명 도달, 완료 0           |

- 두 분석은 **표본 정의가 다르다**(이쪽은 전기간·전 외부 client 상위집합, 저쪽은 7/14 코호트 부분집합). 그래서 스폰 절대수는 다르지만(이쪽 822 vs 저쪽 6), **"완료 0 / 토큰 미산출 / 스폰 직후 crash-restart"** 라는 **질적 결론은 완전히 동일**하다.
- 이쪽에서 새로 드러난 것: 822 spawn 중 **784가 단일 dev-버스트 client(토큰 0)** 라는 사실. 저쪽 코호트 격리에서는 이 dev 버스트가 22명 밖이라 안 보였다.

---

## 7. 한계·정직성 노트

- **익명성 한계(founder_activation 선례와 동일).** events/heartbeat 의 `userId` 는 설치별 익명 UUID(clientId)라 개인·계정으로 분해 불가. 특히 4-A 의 대형 dev 버스트가 존킴 dev 세션인지 순수 외부인지 **데이터만으로 확정 불가**. (단 어느 쪽이든 토큰 0 = 가치 생성 아님이라 결론은 불변.)
- **제외기 blind spot(1장).** cost_logs 무흔적 세션은 존킴이라도 '외부'로 샌다. 어드민 대시보드가 이 residual 을 "외부 스폰"으로 표시하면 **과대계상** 위험 → 대시보드 해석 시 appVersion=null·토큰0 조건으로 필터링 권장(후속 개선 후보, 이 티켓 범위 밖).
- **cost_logs 단일 uid.** 외부 사용자의 LLM 비용이 정말 0인지, 아니면 **외부 인증 경로에서 cost 로깅이 아예 안 되는지**는 구분 불가. 익명 events 의 token:usage 도 외부 0이므로 "외부가 토큰을 못 뽑았다"는 방향은 일관되나, cost 파이프라인 커버리지 자체가 도그푸드에 편향됐을 가능성은 열려 있음.
- **날조 없음.** 모든 수치는 위 BQ 쿼리 직접 결과. ADMIN_UID 원문·client id 원문은 문서·로그 어디에도 노출하지 않음(마스킹만).

---

## 부록: 쿼리 재현 방법

- 접근: `gcloud auth application-default`(john.kim@hypemarc.com), REST BigQuery `jobs.query`, 헤더 `x-goog-user-project: marblo-2253d`, location `US`. (gcloud 활성계정은 temu SA 라 CLI 직접 조회 불가 → ADC + REST 우회.)
- ADMIN_UID 는 배포된 `getAdminUsageSummary` 함수의 런타임 env 에서 조회해 변수로만 사용(출력 금지).
- 제외 재현 CTE(코드 `index.ts:5401` 1:1):
  ```sql
  WITH admin_clients AS (
    SELECT DISTINCT e.userId AS clientId
    FROM `marblo-2253d.marblo_telemetry.events` e
    JOIN (
      SELECT DISTINCT agentId FROM `marblo-2253d.marblo_telemetry.cost_logs`
      WHERE userId = @ADMIN_UID AND agentId IS NOT NULL
        AND timestamp >= TIMESTAMP_SUB(CURRENT_TIMESTAMP(), INTERVAL @lookback DAY)
    ) c ON e.agentId = c.agentId
    WHERE e.userId IS NOT NULL
      AND e.timestamp >= TIMESTAMP_SUB(CURRENT_TIMESTAMP(), INTERVAL @lookback DAY)
  )
  -- events 제외:  userId IS NULL OR userId NOT IN (SELECT clientId FROM admin_clients)
  -- cost_logs 제외: userId IS NULL OR userId != @ADMIN_UID
  ```
