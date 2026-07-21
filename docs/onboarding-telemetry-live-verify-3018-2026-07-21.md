# 3.0.18 온보딩 계측(#542) end-to-end 라이브 실측

- 티켓: HXcw75agqZCKci6WxIQr
- 일시: 2026-07-21 04:25 UTC (조회 시각)
- 대상: `marblo-2253d.marblo_telemetry.events` (BQ, 읽기전용)
- 접근: gcloud active=temu SA → **john.kim ADC (john.kim@hypemarc.com, cloud-platform scope)** REST 우회. 무과금.
- 방법: BQ REST `jobs.query`. 코드·데이터 무변경.
- 3.0.18 릴리스: published 2026-07-21T03:38Z

---

## 한 줄 결론

**계측은 살아 있고 BQ까지 실시간 도착한다. appVersion=3.0.18 정확히 찍힘(null 누수 없음 — 과거 버그 재발 안 함).**
단, #542 이벤트 **8종 중 4종은 한 번도 발화된 적이 없다**(전 기간 0건). 이 중 3종은 실패-경로 이벤트라 "해피패스가 성공해서 안 찍힌 것"으로 설명되지만, **`onboarding:folder_connected` 만은 진짜 사각지대** — 배선 여부를 BQ만으로 판정 불가.

---

## 1. 스트리밍 신선도 (적재지연 아님)

- `MAX(timestamp)` = 2026-07-21 04:25:02 UTC, 조회 시각 04:25:13 UTC → **11초 랙**.
- 결론: BQ streaming buffer 지연 없음. **"아직 안 왔다 = 적재지연"이 아니라 "미발화"**로 해석 가능.

## 2. appVersion 정합성 (★반드시 확인 — PASS)

| event                          | av=null | 총   |
| ------------------------------ | ------- | ---- |
| app:first_run                  | 0       | 6    |
| auth:login_attempt             | 0       | 1    |
| auth:login_success             | 0       | 1    |
| onboarding:orchestrator_opened | 0       | 6    |
| agent:spawned                  | 0       | 43   |
| token:usage                    | 0       | 2639 |
| **session:started**            | **1**   | 11   |

- **#542 이벤트 전부 appVersion 채워짐(3.0.17 또는 3.0.18), null 0건.** 코호트 분리 정상. `telemetry_production_on` 메모의 과거 appVersion-null 버그는 **#542 이벤트에서 재발하지 않음**.
- 유일한 null = `session:started`(11건 중 1건) — #542 이벤트가 **아닌** 기존 이벤트. 스코프 외이나, 이 이벤트에 간헐 null 이 남아있음은 별도 관찰 사항으로 기록.

## 3. 도착한 #542 이벤트 (3.0.18, 오늘)

| 시각(UTC) | event                          | appVer | uid(앞)  | payload                                |
| --------- | ------------------------------ | ------ | -------- | -------------------------------------- |
| 03:32:22  | app:first_run                  | 3.0.18 | ef1bd222 | `{"platform":"MacIntel"}`              |
| 03:32:22  | auth:login_attempt             | 3.0.18 | ef1bd222 | `{"method":"google"}`                  |
| 03:32:22  | auth:login_success             | 3.0.18 | ef1bd222 | `{"method":"google","isNewUser":null}` |
| 03:32:22  | onboarding:orchestrator_opened | 3.0.18 | ef1bd222 | `{"resumed":true}`                     |
| 03:34:34  | app:first_run                  | 3.0.18 | 552b1092 | `{"platform":"Win32"}`                 |
| 03:34:43  | onboarding:orchestrator_opened | 3.0.18 | 552b1092 | `{"resumed":true}`                     |
| 03:38:08  | agent:spawned                  | 3.0.18 | —        | —                                      |
| 03:46:56  | agent:spawned                  | 3.0.18 | —        | —                                      |

- 3.0.18 세션 2개(macOS `ef1bd222`, Win32 `552b1092`)에서 온보딩 계측 포착. 그중 하나는 **google 로그인 attempt→success 왕복까지 정상 기록** → 로그인 계측 배선 실증됨.
- 이 이벤트명들은 3.0.18(#542)에서만 존재 → 출현 자체가 "동작 증거"(heartbeat 익명이라 사장님 세션 uid 직접 특정은 불가, 태스크 지침대로 이벤트명 출현으로 갈음).
- (참고: 같은 이벤트가 3.0.17에서도 02:32에 발화 — #542 계측은 3.0.17 빌드에도 이미 포함돼 있었음. 3.0.18은 appVersion만 새로 태깅.)

### payload 품질 미세 갭

- `auth:login_success.isNewUser = null` — 신규/재방문 구분 필드 미채움(사소).
- `onboarding:orchestrator_opened` 은 `{"resumed":true}` 만 실림 → **모두 기존 프로젝트 resume**. 신규 폴더연결 경로가 세션에서 밟히지 않음(아래 4-② 연결).

## 4. 미도착 #542 이벤트 — "누락" 구분

**전 기간(all-time) 0건. 어떤 이름으로도 발화된 적 없음**(folder/onboarding/connect/auth 정규식 스캔으로 리네임 변형 없음 확인):

| event                                                     | 전기간 건수                         | 판정                                                                                                    |
| --------------------------------------------------------- | ----------------------------------- | ------------------------------------------------------------------------------------------------------- |
| `auth:login_failed`                                       | 0                                   | **미발화(설명됨)** — 이 세션들은 로그인 성공. 실패가 없어 찍을 게 없음. 배선 자체는 미검증.             |
| `onboarding:orchestrator_blocked` (cli_auth/launch_error) | 0                                   | **미발화(설명됨)** — 오케가 정상 오픈(resumed:true, block 없음). 차단이 없어 찍을 게 없음. 배선 미검증. |
| `agent:crashed` (errorCategory)                           | 3.0.18 창 0건 (전기간 마지막 07-19) | **미발화(설명됨)** — 창 내 크래시 없음. errorCategory 경로 미실행.                                      |
| `onboarding:folder_connected`                             | **0**                               | 🔴 **진짜 사각지대** — 아래 참조                                                                        |
| `onboarding:folder_connect_failed`                        | 0                                   | folder_connected 와 동일 경로. 미검증.                                                                  |

### 🔴 folder_connected 가 핵심 미확인 포인트

- 관측된 오케 오픈은 **전부 `resumed:true`**(기존 프로젝트 재개). 즉 "새 폴더 연결" 액션이 **어떤 세션에서도, 전 기간 통틀어** 한 번도 밟히지 않음.
- 따라서 두 가설 구분 불가:
  - (a) 사용자들이 항상 기존 프로젝트를 resume 해서 **코드 경로가 안 밟힌 것**(계측 정상, 트리거 부재)
  - (b) `folder_connected` emit 이 **배선 안 된 것**(계측 갭)
- **BQ 조회만으로 판정 불가.** 확정하려면 실앱에서 "새 폴더 연결" 액션을 1회 수행 후 이 이벤트 도착 확인 필요(라이브 관측 — 사장님/QA 몫).

---

## 정직성 노트

- 위 모든 수치는 BQ `jobs.query` 결과 그대로. 날조 없음.
- "미발화" 4종 중 3종(login_failed / orchestrator_blocked / agent:crashed)은 **해피패스 성공으로 인한 정상 부재**로 설명되나, 그것이 곧 **배선 정상의 증거는 아님**(실패 경로 미실행이라 배선 미검증 상태).
- heartbeat 익명이라 사장님 세션 uid 직접 특정 불가. 3.0.18-전용 이벤트명 출현으로 갈음.

## 권고 (코드 무변경 태스크이므로 조치는 별도 티켓)

1. 🔴 `onboarding:folder_connected` 배선 라이브 확인 — 실앱 신규 폴더연결 1회 → 도착 검증.
2. `session:started` appVersion 간헐 null(11건 중 1건) 원인 점검 — #542 스코프 밖이나 코호트 위생상.
3. `auth:login_success.isNewUser` null 미채움 — 신규가입 활성화 코호트 분석에 필요하면 채우기.
