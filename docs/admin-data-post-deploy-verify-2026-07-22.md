# 배포(#546) 후 어드민 데이터 실측 — 3증상 재검증

- **티켓**: i7I5G35msghl6pqKgUr0
- **작성일**: 2026-07-22
- **데이터 소스**: BigQuery `marblo-2253d.marblo_telemetry` (events, cost_logs) — john.kim ADC, read-only, 무과금
- **성격**: 조회·분석 전용. **코드·데이터 무변경.**
- **접근**: gcloud active=temu SA(CLI 403) → john.kim ADC access-token + BQ REST `jobs.query`(python urllib, `x-goog-user-project: marblo-2253d`, location US). ADMIN_UID 은 배포 `getAdminUsageSummary`(us-central1) 런타임 env 에서 취득해 파라미터로만 사용(원문 미출력).
- **재현 로직**: 배포된 `v3/functions/src/index.ts`(`getAdminOnboardingFunnel` L6036, `getAdminModelSummary` L6147, `resolveAdminClientIds` L5409, `adminUidExclusion` L5465, `adminClientExclusion` L5453)와 `adminAnalytics.ts`(`ONBOARDING_FUNNEL_STEPS`) BQ 로직 1:1 재현.
- **대조 문서**: `admin-usage-exclude-johnkim-measurement-2026-07-21.md`, `onboarding-telemetry-live-verify-3018-2026-07-21.md`.
- **스냅샷 주의**: events/cost_logs 는 라이브 스트리밍 — 총계는 조회 시점에 ±수 건 변동.

---

## 0. 한 줄 결론

**배포 후 어드민 계측 3증상 모두 정상 동작으로 확인.** 특히 07-21 두 문서가 남긴 두 개의 미확인 사각지대가 **데이터로 해소**됐다:

1. **온보딩 퍼널** 라이브 — `onboarding:folder_connected` 🔴 사각지대가 **07-21 06:47 UTC 3.0.18 에서 `mode:"new"` 로 실발화** → "emit 미배선" 가설 **반증**. 계측 정상, 그간은 트리거(신규 폴더연결)가 안 밟혔을 뿐.
2. **includeAdmin 토글 정상** — 모델비용 include ≈ **$79,963** vs exclude **$0.11**, 이벤트 75,283 vs 2,194, 스폰 4,138 vs 824. 토글이 모든 지표를 실제로 갈랐다.
3. **$0.11 은 blind-spot 세션이 아니라 진짜 외부 인증 세션.** cost_logs 에 **두 번째 인증 uid** 가 등장(07-21 문서 시점엔 1개) — 3.0.18, gpt-5.6-terra, $0.1115. 첫 외부 인증 사용자의 실 모델비용이다.

**단, 활성화 절벽은 그대로:** 외부 `task:completed` = **0** (변화 없음). 외부 유입·비용은 미미하고 완주는 아직 0.

---

## 1. 증상1 — 온보딩 "첫 10분" 퍼널 (`getAdminOnboardingFunnel`)

`ONBOARDING_FUNNEL_STEPS` 6단계 + 실패 4종을, `resolveAdminClientIds`(lookback=clamp(days,90,365)) + `adminClientExclusion` 그대로 재현(days=30).

### 1-A. 단계별 도달 (distinct clientId / 이벤트수)

| 단계          | 이벤트                         | include: client / evt | exclude: client / evt |
| ------------- | ------------------------------ | --------------------: | --------------------: |
| 앱 최초 실행  | app:first_run                  |                 4 / 7 |                 1 / 1 |
| 로그인 시도   | auth:login_attempt             |                 2 / 2 |                 1 / 1 |
| 로그인 성공   | auth:login_success             |                 2 / 2 |                 1 / 1 |
| **폴더 연결** | onboarding:folder_connected    |             **1 / 1** |             **1 / 1** |
| 오케 오픈     | onboarding:orchestrator_opened |                 4 / 8 |                 1 / 2 |
| 에이전트 스폰 | agent:spawned                  |            13 / 2,504 |               4 / 824 |

- **비단조(folder_connected 1 < orchestrator_opened 4)는 정상** — 대부분 세션이 기존 프로젝트 resume 경로라 folder_connect 단계를 건너뛴다(buildOnboardingFunnel note 의 "엄격 순차 아님"). 버그 아님.
- **spawn 단계만 크게 튐(13c/2,504evt)** — 이는 온보딩 유입이 아니라 도그푸드/dev 스폰이 agent:spawned 를 공유하기 때문(exclude 하면 4c/824evt = 07-21 문서의 null-appVersion dev 버스트 잔여, 822→824).

### 1-B. ★표본 크기 정직성 — 계측버그 아님, 유입 적음

- **`app:first_run` 은 전 기간 통틀어 7건 / 4 client, 전부 2026-07-21 일자**(3.0.18 3c + 3.0.17 4evt/1c). 즉 first_run 계측 자체가 **07-21 에 막 켜졌다.** 퍼널이 "작은 수"인 건 신규 빌드(3.0.17+) 설치가 적고 계측이 하루밖에 안 됐기 때문이지 **계측 결함이 아니다.**
- 따라서 베타이탈 문서의 **"22→6" 스폰 급락은 이 퍼널에서 재현되지 않는다** — 그건 7/14 유튜브 코호트를 `session:started`(온보딩 계측 이전 빌드)로 측정한 별개 표본이다. 온보딩 퍼널은 3.0.17+ 설치만 커버하므로 두 표본이 겹치지 않음. **미재현 = 정상**(측정 대상이 다름).

### 1-C. 실패 분기 (all-time)

| 이벤트                           | errorCategory |     n | client |
| -------------------------------- | ------------- | ----: | -----: |
| auth:login_failed                | —             | **0** |      0 |
| onboarding:folder_connect_failed | —             | **0** |      0 |
| onboarding:orchestrator_blocked  | —             | **0** |      0 |
| agent:crashed                    | (none)        |   957 |      8 |

- login_failed / folder_connect_failed / orchestrator_blocked = 0 → 해피패스 성공으로 인한 정상 부재(배선 자체는 실패경로 미실행이라 여전히 미검증, 07-21 문서와 동일).
- agent:crashed 957건은 errorCategory 전부 `(none)` — 크래시는 찍히나 **카테고리 태깅은 비어 있음**(errorCategory 분해 경로 미채움, 마이너 갭).

---

## 2. 증상2 — includeAdmin 토글 실동작 (`getAdminModelSummary` / events)

토글이 실제로 값을 가르는지: include=true(존킴 포함, 제외절 비활성) vs false(제외).

### 2-A. 모델별 비용 — `adminUidExclusion`(cost_logs 는 실 uid 보유 → 정확 제외)

| 구간   | 지표              |        include |                exclude |
| ------ | ----------------- | -------------: | ---------------------: |
| 전기간 | 총 모델비용       | **$79,963.17** |            **$0.1115** |
| 전기간 | claude-opus-4-8   |     $72,259.97 |                  $0.00 |
| 전기간 | \<synthetic\>     |      $4,137.81 |                  $0.00 |
| 전기간 | gpt-5.5           |      $2,375.23 |                  $0.00 |
| 전기간 | **gpt-5.6-terra** |          $0.11 | **$0.11** ✅ 유일 잔존 |
| 30일   | 총 모델비용       |        ~$3,672 |                $0.1115 |

- **토글이 확실히 작동한다.** exclude 시 admin uid 소유 비용이 전액 사라지고(모든 모델 $0.00), **gpt-5.6-terra $0.1115 하나만** 남는다.
- 기대치("include≈$79,782 전액, exclude≈0")와 정합 — include 는 도그푸드 성장으로 $79,782→$79,963, exclude 는 "≈0" 이 이제 **$0.11**(아래 3장 = 첫 외부 인증 세션).

### 2-B. events — 토글 (all-time)

| 지표                   | include | exclude |
| ---------------------- | ------: | ------: |
| 총 이벤트              |  75,283 |   2,194 |
| distinct client        |      36 |      26 |
| agent:spawned          |   4,138 |     824 |
| token:usage (이벤트수) |  65,400 |   **4** |
| task:completed         |      32 |   **0** |

- 존킴이 이벤트 97%, 스폰 80%, token:usage 99.99% 를 차지 — 07-21 문서(97/80/전부존킴)와 동일 구조.
- **변화점**: 외부 `token:usage` 가 07-21 문서의 **0 → 4** 로 바뀜(= 3장의 외부 3.0.18 세션). 외부가 처음으로 토큰을 실제로 뽑았다.
- **불변점**: 외부 `task:completed` = **0** (변화 없음). 외부 사용자 중 티켓 완주자는 여전히 없음 = 활성화 절벽 지속.

---

## 3. 증상3 — "$0.11 하나"는 blind-spot 세션인가? → **아니다. 진짜 외부 인증 세션.**

### 3-A. cost_logs 에 두 번째 인증 uid 등장 (07-21 문서: distinct uid=1 → 현재 **2**)

| uid 버킷                     |   rows | agents |      i/o 토큰 |      비용 USD | 활동창(UTC)                  |
| ---------------------------- | -----: | -----: | ------------: | ------------: | ---------------------------- |
| ADMIN                        | 65,626 |    950 | 1,170,956,466 |    $79,963.06 | ~전기간                      |
| **OTHER(비-admin 인증 uid)** |      4 |      1 |        10,821 | **$0.111484** | 2026-07-21 09:10:16–09:10:59 |

### 3-B. OTHER 세션의 정체 — 3.0.18 서명 릴리스의 실 사용

OTHER uid 의 agentId(`5fa78938…`) 를 events 로 역참조:

| appVersion | event         |   n | client | 창(UTC)                 |
| ---------- | ------------- | --: | -----: | ----------------------- |
| **3.0.18** | agent:spawned |   1 |      1 | 07-21 09:09:48          |
| **3.0.18** | token:usage   |   4 |      1 | 07-21 09:10:24–09:11:09 |

- 모델 `gpt-5.6-terra`, 총 112,709 토큰, $0.1115, 활동 ~1.5분.
- **결론: 이 $0.11 은 07-21 measurement 문서가 말한 null-appVersion blind-spot(dev 버스트, appVersion 없음·토큰 0·cost_logs 무흔적) 세션이 전혀 아니다.** 정반대로 **appVersion 3.0.18(서명 릴리스) + 실 인증 uid + cost_logs 정상 적재**된 세션이다. exclude 모드에 남는 이유는 blind-spot 이어서가 아니라 **admin 이 아닌 정상 외부 인증 사용자**이기 때문(제외기가 올바르게 admin 만 빼고 외부는 남김).
- 이는 07-21 문서의 열린 질문("외부 인증 경로에서 cost 로깅이 아예 안 되는지")도 **부분 반증**한다 — 외부 인증 uid 가 cost_logs 에 정상 적재됨을 실증.

### 3-C. 정직성 — 이 uid 가 "순수 외부 베타"인지 "존킴 부계정"인지는 미확정

- 인증 uid 라 익명 clientId 보다 강한 신호지만, **개인/계정 소유자를 데이터만으로 특정 불가**(heartbeat 익명성 한계 동일). 확실한 것은 ① ADMIN_UID 와 **다른** 인증 Firebase uid, ② **3.0.18 서명 릴리스**, ③ 실 모델비용 $0.11 발생. 어느 경우든 "blind-spot 계측 아티팩트"는 아니다.

---

## 4. 07-21 문서 대비 델타 요약

| 항목                            | 07-21 문서    | 07-22 현재               | 해석                                  |
| ------------------------------- | ------------- | ------------------------ | ------------------------------------- |
| cost_logs distinct uid          | 1             | **2**                    | 첫 외부 인증 uid 등장                 |
| 외부 모델비용(exclude)          | $0.00         | **$0.11**                | 3.0.18 외부 실사용(gpt-5.6-terra)     |
| 외부 token:usage 이벤트         | 0             | **4**                    | 외부가 처음 토큰 산출                 |
| adminClientIds(lookback 90/365) | 8             | **10**                   | 도그푸드 agent 증가로 +2, 제외기 정상 |
| `onboarding:folder_connected`   | 0 (🔴 미확인) | **1** (mode:new, 3.0.18) | 배선 실증, 사각지대 해소              |
| 외부 task:completed             | 0             | **0**                    | 활성화 절벽 불변                      |
| include 총 모델비용             | $79,782       | $79,963                  | 도그푸드 성장                         |

---

## 5. 한계·정직성 노트

- **날조 없음** — 모든 수치는 위 BQ `jobs.query` 직접 결과. ADMIN_UID·uid·clientId·agentId 원문은 마스킹/축약만(전체 원문 미노출).
- **익명성 한계** — events `userId` 는 설치별 익명 clientId, 개인 분해 불가. cost_logs uid 는 인증 uid 지만 소유자 특정은 데이터 밖(3-C).
- **표본 신선도** — 온보딩 first_run 계측은 07-21 시작(하루). 작은 퍼널 수치는 유입 부족+신규계측이지 버그 아님(1-B).
- **실패경로 배선 미검증** — login_failed/folder_connect_failed/orchestrator_blocked = 0 은 해피패스 성공에 의한 정상 부재이며 배선 정상 증거는 아님(07-21 문서와 동일). agent:crashed errorCategory 는 `(none)` 만 → 카테고리 태깅 미채움(마이너 갭, 별도 티켓 후보).
- **제외기 blind-spot 잔존** — null-appVersion·cost_logs 무흔적 dev 세션(824 스폰 잔여)은 여전히 '외부'로 계상됨(코드 무변경 티켓 범위 밖, 대시보드 해석 시 appVersion=null·토큰0 필터 권장).
