# "첫 10분" 활성화 퍼널 계측 — 이벤트 카탈로그 & BQ 쿼리

- **티켓**: ixQUBdhx59fmVBbuaXIc
- **동기**: `docs/beta-churn-root-cause-analysis-2026-07-21.md` — 베타 이탈의 근본원인이
  "못 쓴 것"(활성화 실패)이고 최대 이탈이 **앱실행→첫스폰(22→6, −73%)** 인데 그 구간
  (로그인·폴더연결·오케 자동오픈·첫스폰)이 미계측이라 "왜 죽는지" 데이터가 없었다(§5).
- **원칙**: 기존 텔레메트리 인프라 **재사용**. 모든 신규 이벤트는 렌더러의 단일 choke
  point `telemetryService.logTelemetry()` 를 통과해(비식별 scrub + firstParty 게이트)
  기존 `logTelemetryBatch` Cloud Function → BigQuery `marblo_telemetry.events` 테이블의
  **같은 경로**로 적재된다. 새 파이프라인·새 테이블·서버 스키마 변경 없음
  (서버는 `event` 문자열을 화이트리스트 없이 그대로 적재하고, `errorCategory`/
  `errorMessage` 컬럼은 이미 스키마에 존재했다 — 렌더러가 안 채웠을 뿐).

## 이벤트 카탈로그

기존 퍼널: `app:first_run` → `auth:login_*` → `onboarding:folder_connected` →
`onboarding:orchestrator_opened`(=첫 스폰) → `agent:spawned`(워커) → `token:usage`
→ `task:completed`.

| 이벤트                             | 발화 지점                                            | 주요 필드(metadata/컬럼)                                                       | 답하는 질문                                                             |
| ---------------------------------- | ---------------------------------------------------- | ------------------------------------------------------------------------------ | ----------------------------------------------------------------------- |
| `app:first_run`                    | `App.tsx` 최초 마운트(설치당 1회, localStorage 가드) | `metadata.platform`                                                            | GA4 다운로드(16) vs 앱 첫실행 규모 대사                                 |
| `auth:login_attempt`               | `AuthProvider` 각 로그인 진입                        | `metadata.method` (google/email/signup/github)                                 | 로그인을 시도는 했나                                                    |
| `auth:login_success`               | 각 로그인 성공 분기                                  | `metadata.method`, `metadata.isNewUser`                                        | 로그인 성공률                                                           |
| `auth:login_failed`                | 각 로그인 catch/실패 분기                            | `errorCategory`=Firebase **코드**, `metadata.method`                           | ★§5-2 최대맹점: 16명이 로그인서 튕겼나                                  |
| `onboarding:folder_connected`      | `useProjectSetup` 등록 성공                          | `metadata.mode`(existing/new/inline), `metadata.hasGitRemote`                  | 폴더 연결까지 갔나                                                      |
| `onboarding:folder_connect_failed` | 프로젝트 쓰기 실패                                   | `errorCategory`=`write_error`                                                  | 폴더는 골랐는데 등록 실패                                               |
| `onboarding:orchestrator_opened`   | `useOrchestratorAutoLaunch` 런치 성공                | `metadata.resumed`                                                             | ★첫 스폰 도달                                                           |
| `onboarding:orchestrator_blocked`  | 런치가 needsAuth/예외로 막힘                         | `errorCategory`=`cli_auth`\|`launch_error`                                     | ★22→6: **시도했으나 CLI 미설치/미인증**                                 |
| `agent:crashed`(보강)              | `agent-manager.ts` 종착 error 분기                   | `errorCategory`=`fast_fail_config`\|`runtime_crash`, `errorMessage`(짧은 사유) | ★§5-4: 스폰 직후 크래시가 바이너리/설정(CLI 미설치) 때문인가 런타임인가 |

`fast_fail_config` = FAST_FAIL 창 내 반복 즉사(바이너리 부재/잘못된 command/모델 설정
오류 계열). `runtime_crash` = 정상 기동 후 재시작 예산 소진.

## 프라이버시 판단 (telemetry_privacy_policy 준수)

- **clientId↔uid 링크는 넣지 않았다.** `anonymize()` 가 uid/email/senderId 를 계속
  strip 하고, 이벤트는 익명 install id 만 싣는다(CEO 승인 "비식별 aggregate" 방침).
- 근거: 활성화 퍼널 분해는 **익명 install 단위**로 충분히 된다 — 한 clientId 가
  login_success → folder_connected → orchestrator_opened 중 어디까지 갔는지 순서로
  읽으면 된다. 개인 식별 없이 목표(왜 죽는지) 달성.
- 잔여 한계(수용): 익명이라 파운더(uid) vs 유튜브 유입 개인 분리는 여전히 불가
  (§5-5). 이건 프라이버시 방침상 의도된 한계다.
- 실패 사유는 **코드/카테고리만** 싣는다(로그인=Firebase 코드, 폴더=사유 문자열,
  크래시=분류+짧은 메시지). 원문 메시지·프롬프트·경로·이메일은 scrub choke point가
  마스킹(`<USER_HOME>`/`<EMAIL>`)하며 자유텍스트 키는 drop 된다.

## ★전송 한계 (정직성 — auth-gated 싱크)

`flushTelemetry()` 는 `auth.currentUser` 가 있을 때만 서버로 나간다(anti-abuse, 서버도
`context.auth` 요구). 따라서:

- 로그인-**이전** 이벤트(`app:first_run`, `login_attempt`, `login_failed`)는 큐에
  쌓였다가 **다음 성공적 로그인 시점에** 함께 flush 된다. → 실패 후 재시도 성공한
  유저의 초기 마찰은 잡힌다.
- 끝내 로그인에 **한 번도 성공 못 한** 유저의 실패는 전송되지 않는다. §5-2 맹점을
  완전히는 못 메운다. 완전 해소는 unauthenticated 전송 경로(서버 변경, abuse 리스크)가
  필요하며 이 티켓 범위 밖 — 별도 판단 사항으로 남긴다.
- `app:first_run` ↔ GA4 다운로드는 clientId ≠ user_pseudo_id 라 **개인 조인 불가**,
  집계(magnitude) 대사만 가능.

## BQ 집계 쿼리 (기존 §1-B 퍼널을 그대로 확장)

기존 분석과 동일한 `marblo_telemetry.events`(location=US), 익명 `userId`(=clientId).

```sql
-- 첫 10분 활성화 퍼널 (신규 이벤트 포함). 기존 §1-B 체인의 빈칸을 채운다.
WITH reach AS (
  SELECT userId,
    MAX(IF(event='app:first_run',1,0))                    first_run,
    MAX(IF(event='auth:login_attempt',1,0))               login_try,
    MAX(IF(event='auth:login_success',1,0))               login_ok,
    MAX(IF(event='auth:login_failed',1,0))                login_fail,
    MAX(IF(event='onboarding:folder_connected',1,0))      folder,
    MAX(IF(event='onboarding:orchestrator_opened',1,0))   orch_open,
    MAX(IF(event='onboarding:orchestrator_blocked',1,0))  orch_block,
    MAX(IF(event='agent:spawned',1,0))                    spawned,
    MAX(IF(event='token:usage',1,0))                      did_work,
    MAX(IF(event='task:completed',1,0))                   completed
  FROM `marblo-2253d.marblo_telemetry.events`
  WHERE timestamp >= TIMESTAMP('2026-07-12')
  GROUP BY userId)
SELECT
  COUNTIF(first_run=1)  AS first_run,
  COUNTIF(login_try=1)  AS login_attempt,
  COUNTIF(login_ok=1)   AS login_success,
  COUNTIF(login_fail=1) AS login_failed,
  COUNTIF(folder=1)     AS folder_connected,
  COUNTIF(orch_open=1)  AS orchestrator_opened,
  COUNTIF(orch_block=1) AS orchestrator_blocked,
  COUNTIF(spawned=1)    AS agent_spawned,
  COUNTIF(did_work=1)   AS token_usage,
  COUNTIF(completed=1)  AS task_completed
FROM reach;

-- 첫 스폰 실패 사유 분해 (★22→6). "시도했으나 막힘" 을 사유별로.
SELECT event, errorCategory, COUNT(*) n
FROM `marblo-2253d.marblo_telemetry.events`
WHERE timestamp >= TIMESTAMP('2026-07-12')
  AND event IN ('auth:login_failed','onboarding:orchestrator_blocked',
                'onboarding:folder_connect_failed','agent:crashed')
GROUP BY event, errorCategory ORDER BY event, n DESC;
```

## 검증 상태

- 렌더러 typecheck + electron typecheck **통과**. lint 신규 에러 0.
- `tests/unit/onboarding-funnel-telemetry.test.ts`: 신규 이벤트가 실제 발화 →
  기존 `logTelemetryBatch` 경로로 전송 → 비식별(uid/email 없음, 경로 `<USER_HOME>`
  마스킹) → 실패 사유(코드/카테고리) 탑재까지 **실측 4/4 통과**.
- 호출부 배선(AuthProvider/useProjectSetup/useOrchestratorAutoLaunch/App)은
  typecheck + 정적 리뷰로 검증. 전 구간 end-to-end 발화는 **서명 릴리스 빌드가 있어야**
  실측 가능(라이브 앱에 테스트 부착 금지 규칙).

## ★릴리스 의존성

이 계측은 **새 빌드가 사용자에게 나가야** 데이터를 모은다. 두 가지가 후행 필요:

1. `electron/telemetry.ts` + `electron/agent-manager.ts`(크래시 사유)는 **메인
   프로세스** 변경 → `dist-electron` **재빌드 필요**(사장님 승인 대상, 본 티켓은
   코드만 작성·보고). 렌더러 이벤트는 vite 라 재시작 불필요하나, 결국 릴리스로만
   사용자에게 도달한다.
2. CI 빌링 차단으로 **로컬 빌드**(mac=이 Mac, win=사장님) + 기존 설치자용
   **인앱 업데이트**(별도 티켓)가 있어야 실사용자 데이터가 흐른다. 계측 코드만으로는
   부족 — 릴리스+업데이트와 연동된다.
