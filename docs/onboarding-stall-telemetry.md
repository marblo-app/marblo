# 온보딩 스톨 계측 — 이벤트 스키마 & BQ 쿼리

- **티켓**: 9dXgBdkGn1LyJokShh1g
- **동기**: 온램프 스파이크 두 건 — #883(API 요금제 재판매 온램프)·#885(자체 SLM 무료
  제로마찰 티어) — 이 같은 결론에 도달했다: **막고 있는 것은 원가가 아니라 증거다.**
  "구독/크레딧이 없어 최초에 멈추는 유저가 몇 명인가" 를 모르는 채로는 무료→유료
  온램프에 얼마를 써야 하는지 정할 수 없는데, 그 순간의 이벤트가 BigQuery `events`
  에 **0건**이었다(grep 0건 — 발화 지점 자체가 없었다).
- **범위**: 계측만. 온램프 설계·과금은 별도 티켓(fsJCyrqW / #883 / #885).
- **원칙**: 새 파이프라인 없음. 모든 이벤트는 렌더러의 단일 choke point
  `telemetryService.logTelemetry()`(비식별 scrub + firstParty 게이트)를 지나
  기존 `logTelemetryBatch` Cloud Function → BigQuery `marblo_telemetry.events`
  로 간다. **서버 스키마 변경 0** — 서버는 `event` 문자열을 화이트리스트 없이
  적재하고, 쓰는 컬럼(`model`/`errorCategory`/`success`/`agentId`/`metadata`)은
  이미 전부 존재한다.

## 이벤트 카탈로그 (5종)

| 이벤트                           | 발화 지점                                                                      | 주요 필드                                                                                                                                                                                                          | 답하는 질문                                               |
| -------------------------------- | ------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------- |
| `onboarding:spawn_blocked`       | main `harness-manager.checkSpawnAuthGate` (관측자 주입 → `electron/telemetry`) | `model`, `errorCategory`=`not-installed`\|`not-authenticated`\|`vendor-not-configured`, `metadata.surface`(agent_launch/orchestrator_launch/orchestrator_switch), `metadata.vendor`, `metadata.missingEnvKeyCount` | ★첫 작업이 **실행 전에** 게이트에서 막힌 횟수·설치 수     |
| `onboarding:agent_needs_auth`    | main `agent-manager` 로그인화면 백스톱 발화                                    | `agentId`, `model`, `errorCategory`=`no-probe`\|`probe-unauthenticated`\|`grace-expired`                                                                                                                           | 스폰은 됐는데 CLI 가 로그인 화면에서 죽은 횟수            |
| `onboarding:agent_auth_resolved` | 같은 백스톱의 **철회**(readiness 도달 = 오탐 확정)                             | `agentId`, `model`                                                                                                                                                                                                 | ★위 수치에서 오탐을 빼기 위한 짝 이벤트                   |
| `onboarding:funding_probe`       | 렌더러 — #884 프로브 판정(자동 1회 + 가이드 모달 "다시 확인")                  | `model`, `metadata.verdict`=`ok`\|`unfunded`\|`blocked`\|`inconclusive`, `metadata.trigger`=`auto`\|`recheck`, `errorCategory`(=verdict 또는 `blocked:<사유>`)                                                     | ★인증까지 온 설치 중 몇 %가 구독/크레딧이 없어 못 도는가  |
| `onboarding:funding_guide_shown` | 렌더러 `FundingGuideHost` — 모달이 실제로 뜬 순간(판정 종류당 1회)             | `model`, `errorCategory`=`authedButUnfunded`\|`authedButBlocked`                                                                                                                                                   | **눈으로** 막힌 사람 수(판정과 갈린다 — 닫았으면 안 뜬다) |

### 왜 이 다섯인가 — 세 가지 설계 결정

1. **정상(`ok`) 판정도 싣는다.** unfunded 건수만으로는 "인증까지 온 유저 중 몇
   %가 막히나" 에 답할 수 없다. 그 비율이 온램프 투자 판단의 실제 입력값이므로
   `funding_probe` 는 판정 4종을 전부 발행한다(분모 확보).
2. **needsAuth 는 철회될 수 있다.** 로그인화면 백스톱은 CLI 부팅 중 스쳐 지나간
   인증 문구로 오탐을 낸 전력이 있고(인증 팝업 재발 saga), readiness 도달 시
   판정을 철회한다. 철회 이벤트를 함께 세지 않으면 **오탐이 그대로 문제 크기로
   둔갑한다.** 집계는 항상 `needs_auth agents − resolved agents` 를 쓴다.
3. **`blocked` 는 하위 사유까지 싣는다.** `rate_limit` 은 요금제가 **있다는**
   증거다(한도에 걸린 유료 유저). 이걸 스톨로 세면 온램프가 없는 문제를 풀게 된다.

## 프라이버시 판단 (telemetry_privacy_policy 준수)

- **비식별 유지.** 익명 install id(`clientId`)만 나간다. uid/email/senderId 는
  기존 `anonymize()` 가 계속 strip 하고, 계정 조인은 하지 않는다.
- **프로브 원문(`FundingProbeOutcome.detail`)은 절대 싣지 않는다.** 그 값은 벤더
  CLI 출력의 꼬리(자유 텍스트)라 무엇이 섞여 있을지 알 수 없다. 텔레메트리에는
  판정 코드(`verdict`/`blockedReason`)만 간다. 화면에는 그대로 보여준다(조용한
  실패를 만들지 않는다는 #884 의 계약) — 화면과 텔레메트리는 별개다.
- **벤더 키 이름·값 모두 싣지 않는다.** 스폰차단이 env-swap 벤더 크레덴셜 때문일
  때도 `vendor` id 와 빠진 키의 **개수**만 보낸다(`missingEnvKeyCount`).
- **동의 게이트 그대로.** `firstPartyTelemetryDefaultEnabled()`(하드 kill-switch
  `VITE_DISABLE_TELEMETRY=1` + 런타임 옵트아웃)를 지나야 전송된다. 옵트아웃 상태면
  스톨 이벤트도 0건 — 유닛 테스트로 못박았다.
- **경로/프롬프트 금지.** 기존 scrub choke point 가 `<USER_HOME>`/`<EMAIL>` 마스킹과
  자유텍스트 키 drop 을 그대로 수행한다.

## ★전송 한계 (정직성)

- `flushTelemetry()` 는 `auth.currentUser` 가 있을 때만 서버로 나간다(anti-abuse).
  스톨 이벤트는 전부 **로그인 이후** 국면(CLI 인증·스폰·구독)이라 이 한계에 잘
  걸리지 않지만, 로그인 없이 앱만 켠 사용자의 스폰차단은 다음 성공 로그인 때
  함께 flush 된다.
- `clientId` 는 **설치** 단위다. 한 사람이 두 기계를 쓰면 2로 세고, 스토리지를
  비우면 새 id 가 된다. 아래 쿼리의 "유저수" 는 전부 **설치 수**로 읽어야 한다.
- 이 계측은 **새 빌드가 사용자에게 나가야** 데이터를 모은다(main 프로세스 변경
  포함 → 재빌드·릴리스 후행). 배포 전 값은 전부 0 이며, 그 0 은 "문제 없음" 이
  아니라 "아직 관측 안 됨" 이다.

## BQ 집계 쿼리

`marblo-2253d.marblo_telemetry.events`(location=US), 익명 `userId`(=clientId).
읽기는 john.kim ADC REST(메모 `bq_telemetry_adc_rest_access`).

```sql
-- ① 스톨 규모 한 장 — "몇 건이고 몇 설치인가"
SELECT
  COUNT(DISTINCT IF(event='onboarding:spawn_blocked', userId, NULL))  AS spawn_blocked_installs,
  COUNTIF(event='onboarding:spawn_blocked')                           AS spawn_blocked_events,
  COUNT(DISTINCT IF(event='onboarding:agent_needs_auth', agentId, NULL))
                                                                      AS needs_auth_agents,
  COUNT(DISTINCT IF(event='onboarding:agent_auth_resolved', agentId, NULL))
                                                                      AS needs_auth_retracted,
  COUNT(DISTINCT IF(event='onboarding:funding_guide_shown', userId, NULL))
                                                                      AS guide_shown_installs,
  -- ★어느 신호든 하나라도 맞은 고유 설치 = 이 티켓이 세려던 그 수
  COUNT(DISTINCT IF(
    event IN ('onboarding:spawn_blocked','onboarding:agent_needs_auth',
              'onboarding:funding_guide_shown')
    OR (event='onboarding:funding_probe'
        AND JSON_VALUE(metadata,'$.verdict') IN ('unfunded','blocked')),
    userId, NULL))                                                    AS stalled_installs
FROM `marblo-2253d.marblo_telemetry.events`
WHERE timestamp >= TIMESTAMP_SUB(CURRENT_TIMESTAMP(), INTERVAL 30 DAY);

-- ② ★핵심 비율 — 인증까지 온 설치 중 구독/크레딧이 없어 못 도는 비율.
--   분모는 '판정이 난 설치'(ok 포함). inconclusive 는 아무 주장도 아니라 제외.
WITH v AS (
  SELECT userId, JSON_VALUE(metadata,'$.verdict') AS verdict
  FROM `marblo-2253d.marblo_telemetry.events`
  WHERE event='onboarding:funding_probe'
    AND timestamp >= TIMESTAMP_SUB(CURRENT_TIMESTAMP(), INTERVAL 30 DAY))
SELECT
  COUNT(DISTINCT IF(verdict='ok', userId, NULL))          AS ok_installs,
  COUNT(DISTINCT IF(verdict='unfunded', userId, NULL))    AS unfunded_installs,
  COUNT(DISTINCT IF(verdict='blocked', userId, NULL))     AS blocked_installs,
  SAFE_DIVIDE(
    COUNT(DISTINCT IF(verdict='unfunded', userId, NULL)),
    COUNT(DISTINCT IF(verdict IN ('ok','unfunded','blocked'), userId, NULL)))
                                                          AS unfunded_rate
FROM v;

-- ③ 어디를 고쳐야 하나 — 스폰차단 사유 × 표면
SELECT
  errorCategory                              AS reason,
  JSON_VALUE(metadata,'$.surface')           AS surface,
  JSON_VALUE(metadata,'$.vendor')            AS vendor,
  COUNT(*)                                   AS events,
  COUNT(DISTINCT userId)                     AS installs
FROM `marblo-2253d.marblo_telemetry.events`
WHERE event='onboarding:spawn_blocked'
  AND timestamp >= TIMESTAMP_SUB(CURRENT_TIMESTAMP(), INTERVAL 30 DAY)
GROUP BY reason, surface, vendor
ORDER BY events DESC;

-- ④ ★오탐 보정 — 로그인화면 판정 중 철회되지 않은 것만이 진짜 스톨이다
WITH fired AS (
  SELECT DISTINCT agentId FROM `marblo-2253d.marblo_telemetry.events`
  WHERE event='onboarding:agent_needs_auth' AND agentId IS NOT NULL
    AND timestamp >= TIMESTAMP_SUB(CURRENT_TIMESTAMP(), INTERVAL 30 DAY)),
resolved AS (
  SELECT DISTINCT agentId FROM `marblo-2253d.marblo_telemetry.events`
  WHERE event='onboarding:agent_auth_resolved' AND agentId IS NOT NULL
    AND timestamp >= TIMESTAMP_SUB(CURRENT_TIMESTAMP(), INTERVAL 30 DAY))
SELECT
  (SELECT COUNT(*) FROM fired)                                   AS fired_agents,
  (SELECT COUNT(*) FROM resolved)                                AS retracted_agents,
  (SELECT COUNT(*) FROM fired WHERE agentId NOT IN (SELECT agentId FROM resolved))
                                                                 AS truly_stalled_agents;

-- ⑤ 온램프 효과 측정(사후) — 구독을 붙이고 실제로 풀렸나.
--   같은 설치에서 auto=unfunded 를 본 뒤 recheck=ok 가 나온 케이스.
WITH p AS (
  SELECT userId, timestamp AS ts,
         JSON_VALUE(metadata,'$.verdict') AS verdict,
         JSON_VALUE(metadata,'$.trigger') AS trigger
  FROM `marblo-2253d.marblo_telemetry.events`
  WHERE event='onboarding:funding_probe'
    AND timestamp >= TIMESTAMP_SUB(CURRENT_TIMESTAMP(), INTERVAL 90 DAY))
SELECT COUNT(DISTINCT userId) AS recovered_installs
FROM p a
WHERE a.verdict='ok'
  AND EXISTS (SELECT 1 FROM p b
              WHERE b.userId=a.userId AND b.verdict='unfunded' AND b.ts < a.ts);
```

## 어드민 경로

BQ 직접 쿼리 외에, 같은 수치가 어드민 콜러블
`getAdminKpiCockpit` 응답의 `onboardingStall` 로도 나온다(순수 조립은
`functions/src/adminAnalytics.ts: buildOnboardingStallSummary`, `node --test` 로
단위검증 — `npm run test:admin-analytics`). 계산 규칙은 위 쿼리와 동일하다:
철회분 차감·`ok` 포함 분모·`inconclusive` 제외. 분모가 0 이면 `0%` 가 아니라
`null`("데이터 대기")을 돌려준다 — 관측 전 상태를 "문제 없음" 으로 읽지 않게.

marblo.app/admin 화면에 이 블록을 그리는 것은 별도 작업이다(marblo-web 은 이
티켓의 scope 밖). 응답에는 이미 실려 나간다.

## 검증

- `v3` 렌더러 + electron typecheck 통과(`npm run typecheck`), `functions` 빌드
  (`tsc`) 통과.
- `v3/tests/unit/onboarding-stall-telemetry.test.ts` — 발화·기존 배치 경로 전송·
  `ok` 분모 탑재·비식별(uid/email/경로)·옵트아웃 시 0건.
- `v3/tests/unit/harness-spawn-gate.test.ts` — 차단 시 관측치 발생, **통과 시 무발생**,
  관측자가 던져도 스폰 판정 불변.
- `v3/tests/unit/funding-guide-render.test.ts` — 모달이 뜰 때만, 판정 종류당 1회.
- `functions/src/adminAnalytics.test.ts` — 철회 차감(음수 방지)·분모 규칙·데이터
  없을 때 `null`·구버전 호출부 하위호환.
- 실사용자 데이터는 릴리스 후행(위 §전송 한계).
