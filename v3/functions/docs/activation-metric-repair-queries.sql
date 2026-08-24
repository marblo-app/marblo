-- ═══════════════════════════════════════════════════════════════════════════
-- 첫스폰 활성화 지표 수리 — 검증 쿼리 (ticket sx56j9XA26yEXka8QIhr)
-- ═══════════════════════════════════════════════════════════════════════════
--
-- 측정: 2026-08-24 · marblo-2253d.marblo_telemetry · BQ location US
-- 실행: john.kim ADC REST (bq CLI 또는 jobs.query). ★전부 읽기 전용이다.
--
-- v3/docs/activation-metric-repair-2026-08-24.md 의 모든 숫자가 여기서 나온다.
-- 숫자가 안 맞으면 대상이 아니라 **쿼리를 먼저 의심해라** — 이 티켓의 교훈이다.


-- ─────────────────────────────────────────────────────────────────────────
-- Q1. 왜 깨졌나 — 프로필 606행을 출처별로 가른다.
--     기대: 어트리뷰션만 564 / 이벤트만 43 / 둘 다 1
--     ★분모 577(=564+12+1)의 98%가 이벤트를 한 줄도 안 남긴 설치다.
-- ─────────────────────────────────────────────────────────────────────────
WITH p AS (
  SELECT
    install_key, first_run_at, first_spawn_at, active_days,
    install_key IN (SELECT installId FROM `marblo-2253d.marblo_telemetry.install_attribution`) AS has_attr,
    install_key IN (SELECT DISTINCT userId FROM `marblo-2253d.marblo_telemetry.events`) AS has_ev
  FROM `marblo-2253d.marblo_telemetry.analytics_install_profile`
)
SELECT
  has_attr, has_ev,
  COUNT(*)                                  AS installs,
  COUNTIF(first_run_at   IS NOT NULL)       AS with_first_run,
  COUNTIF(first_spawn_at IS NOT NULL)       AS with_first_spawn,
  SUM(active_days)                          AS active_days_total
FROM p
GROUP BY has_attr, has_ev
ORDER BY installs DESC;


-- ─────────────────────────────────────────────────────────────────────────
-- Q2. 키 공간은 안 갈렸다 — 두 축 모두 36자 소문자 UUID 원본이다.
--     ★가설(HMAC vs 원본) 배제용. 교집합이 1건인 건 키 공간이 아니라 모집단 탓.
-- ─────────────────────────────────────────────────────────────────────────
WITH ev  AS (SELECT DISTINCT userId    AS k FROM `marblo-2253d.marblo_telemetry.events` WHERE event = 'agent:spawned'),
     att AS (SELECT DISTINCT installId AS k FROM `marblo-2253d.marblo_telemetry.install_attribution`)
SELECT
  (SELECT COUNT(*) FROM ev)                  AS event_keys,
  (SELECT COUNT(*) FROM att)                 AS attribution_keys,
  (SELECT COUNT(*) FROM ev JOIN att USING (k)) AS overlap;


-- ─────────────────────────────────────────────────────────────────────────
-- Q3. 시점 — install_attribution 첫 행이 정확히 2026-08-10(#906 배포일)이다.
--     이게 08-03~08-10 경계의 정체다.
-- ─────────────────────────────────────────────────────────────────────────
SELECT
  DATE_TRUNC(DATE(linkedAt, 'Asia/Seoul'), WEEK(MONDAY)) AS wk,
  COUNT(*)                       AS rows_,
  COUNT(DISTINCT installId)      AS installs,
  COUNT(DISTINCT gaClientId)     AS browsers,
  COUNT(DISTINCT appVersion)     AS versions
FROM `marblo-2253d.marblo_telemetry.install_attribution`
GROUP BY wk
ORDER BY wk;


-- ─────────────────────────────────────────────────────────────────────────
-- Q4. ★분모 부풀림 — 631 '설치' 의 고유 브라우저는 5개다(539/69/16/6/1).
--     GA4 client_id 는 브라우저 프로필당 하나다. 539명이 각자 설치했다면
--     브라우저도 539개여야 한다.
-- ─────────────────────────────────────────────────────────────────────────
SELECT installs_per_browser, COUNT(*) AS browsers, SUM(installs_per_browser) AS installs
FROM (
  SELECT gaClientId, COUNT(DISTINCT installId) AS installs_per_browser
  FROM `marblo-2253d.marblo_telemetry.install_attribution`
  WHERE gaClientId IS NOT NULL
  GROUP BY gaClientId
)
GROUP BY installs_per_browser
ORDER BY installs_per_browser DESC;


-- ─────────────────────────────────────────────────────────────────────────
-- Q5. ft_build_channel NULL 594건의 정체 — 버전별 구성.
--     ★채널이 붙은 유일한 버전(3.0.35)은 80건 전부 dev 다. NULL 은 '알 수 없음'
--       이 아니라 '#1071(2026-08-21) 이전이라 c 파라미터가 없었다' 다.
-- ─────────────────────────────────────────────────────────────────────────
SELECT platform, appVersion, buildChannel, linkSource,
       COUNT(*) AS rows_,
       MIN(DATE(linkedAt, 'Asia/Seoul')) AS first_day,
       MAX(DATE(linkedAt, 'Asia/Seoul')) AS last_day
FROM `marblo-2253d.marblo_telemetry.install_attribution`
GROUP BY platform, appVersion, buildChannel, linkSource
ORDER BY rows_ DESC;


-- ─────────────────────────────────────────────────────────────────────────
-- Q6. ★커버리지 검사(analyticsCoverageGuard)의 입력 그대로.
--     파생측(프로필 주차 집계) × 원천측(events 주차 고유 키)을 한 행에 놓는다.
--     기대(2026-08-24):
--       wk         cohort observable filled event_keys browsers
--       2026-05-25      1          1      1          1        1
--       2026-07-13     29         29      7         11       29
--       2026-07-20      7          7      6          6        7
--       2026-07-27      3          3      3          6        3
--       2026-08-03      1          1      0          3        1   ← RED(분자 공백)
--       2026-08-10    199          0      0          3        2   ← RED(3규칙 전부)
--       2026-08-17    368          3      1          4        6   ← RED(혼합·부풀림)
--     ★cohort_day 는 수리 후 프로필에 컬럼으로 존재한다. 아래 COALESCE 는
--       재빌드 이전에도 같은 값을 재현하기 위한 것이다.
-- ─────────────────────────────────────────────────────────────────────────
WITH p AS (
  SELECT install_key, ga_key, first_spawn_at, observed_days,
         COALESCE(DATE(first_run_at, 'Asia/Seoul'), first_active_day) AS cohort_day
  FROM `marblo-2253d.marblo_telemetry.analytics_install_profile`
),
w AS (
  SELECT DATE_TRUNC(cohort_day, WEEK(MONDAY)) AS wk, install_key, ga_key, first_spawn_at, observed_days
  FROM p WHERE cohort_day IS NOT NULL
),
e AS (
  SELECT DATE_TRUNC(DATE(timestamp, 'Asia/Seoul'), WEEK(MONDAY)) AS wk,
         COUNT(DISTINCT userId) AS event_keys
  FROM `marblo-2253d.marblo_telemetry.events`
  WHERE event = 'agent:spawned'
  GROUP BY wk
)
SELECT
  w.wk,
  COUNT(*)                                              AS cohort_installs,
  COUNTIF(w.observed_days > 0)                          AS observable_installs,
  COUNTIF(w.first_spawn_at IS NOT NULL)                 AS filled_installs,
  COALESCE(MAX(e.event_keys), 0)                        AS event_keys,
  COUNT(DISTINCT COALESCE(w.ga_key, w.install_key))     AS distinct_browsers
FROM w LEFT JOIN e USING (wk)
GROUP BY w.wk
ORDER BY w.wk;


-- ─────────────────────────────────────────────────────────────────────────
-- Q7. ★수리 후 분모 — install_class 를 SQL 로 재현해 dev/재설치루프를 뺀다.
--     (프로필 재빌드 뒤에는 install_class · activation_observable 컬럼을
--      그대로 쓰면 된다. 이 쿼리는 재빌드 이전 대조용이다.)
-- ─────────────────────────────────────────────────────────────────────────
WITH b AS (
  SELECT gaClientId, COUNT(DISTINCT installId) AS n
  FROM `marblo-2253d.marblo_telemetry.install_attribution`
  WHERE gaClientId IS NOT NULL
  GROUP BY gaClientId
),
p AS (
  SELECT pr.install_key, pr.ga_key, pr.first_spawn_at, pr.observed_days,
         COALESCE(DATE(pr.first_run_at, 'Asia/Seoul'), pr.first_active_day) AS cohort_day,
         CASE
           WHEN pr.ft_build_channel = 'dev' THEN 'dev_tagged'
           WHEN b.n >= 5                    THEN 'reinstall_loop'
           WHEN pr.ga_key IS NOT NULL       THEN 'distinct'
           ELSE 'unknown'
         END AS install_class
  FROM `marblo-2253d.marblo_telemetry.analytics_install_profile` pr
  LEFT JOIN b ON b.gaClientId = pr.ga_key
)
SELECT
  DATE_TRUNC(cohort_day, WEEK(MONDAY)) AS wk,
  COUNT(*)                                                       AS raw_installs,
  COUNTIF(observed_days > 0)                                     AS observable,
  COUNTIF(observed_days > 0
          AND install_class NOT IN ('dev_tagged', 'reinstall_loop')) AS denominator_fixed,
  COUNTIF(observed_days > 0
          AND install_class NOT IN ('dev_tagged', 'reinstall_loop')
          AND first_spawn_at IS NOT NULL)                        AS first_spawn_fixed,
  COUNT(DISTINCT COALESCE(ga_key, install_key))                  AS browsers
FROM p
WHERE cohort_day IS NOT NULL
GROUP BY wk
ORDER BY wk;


-- ─────────────────────────────────────────────────────────────────────────
-- Q8. ★"분자가 죽지 않았다" 의 증명 — 활동 주차 기준.
--     그 주 스폰한 고유 설치는 계속 3~6명이고, events 실측과 정확히 일치한다.
--     기대: 08-03=3 / 08-10=3 / 08-17=4 / 08-24=2
--     (그 주 '첫' 스폰은 코호트 지표라 0~1 이다. 그게 정상이고, 낮은 건
--      전환 실패가 아니라 **새로 관측되는 설치가 없기 때문**이다.)
-- ─────────────────────────────────────────────────────────────────────────
WITH s AS (
  SELECT userId, MIN(TIMESTAMP(timestamp)) AS first_spawn
  FROM `marblo-2253d.marblo_telemetry.events`
  WHERE event = 'agent:spawned'
  GROUP BY userId
),
inweek AS (
  SELECT DATE_TRUNC(DATE(timestamp, 'Asia/Seoul'), WEEK(MONDAY)) AS wk,
         COUNT(DISTINCT userId) AS spawners_in_week
  FROM `marblo-2253d.marblo_telemetry.events`
  WHERE event = 'agent:spawned'
  GROUP BY wk
),
firsts AS (
  SELECT DATE_TRUNC(DATE(first_spawn, 'Asia/Seoul'), WEEK(MONDAY)) AS wk,
         COUNT(*) AS first_spawners
  FROM s GROUP BY wk
)
SELECT COALESCE(inweek.wk, firsts.wk)        AS wk,
       COALESCE(inweek.spawners_in_week, 0)  AS spawners_in_week,
       COALESCE(firsts.first_spawners, 0)    AS first_spawners
FROM inweek FULL OUTER JOIN firsts ON inweek.wk = firsts.wk
ORDER BY wk;


-- ─────────────────────────────────────────────────────────────────────────
-- Q9. 사장님 질문용 — 온보딩 퍼널의 주차별 고유 설치 수.
--     ★비기너(08-07) 전후를 가르기엔 주당 3~8명이라 표본이 없다.
--       부트게이트·git 스텝은 2026-08-24 배포라 데이터가 0일치다.
--     onboarding:spawn_blocked 는 로그인 이후 이벤트라 지금도 관측된다 —
--     첫스폰 마찰의 유일한 살아 있는 대리 지표다.
-- ─────────────────────────────────────────────────────────────────────────
SELECT
  DATE_TRUNC(DATE(timestamp, 'Asia/Seoul'), WEEK(MONDAY)) AS wk,
  COUNT(DISTINCT IF(event = 'app:first_run',                  userId, NULL)) AS first_run,
  COUNT(DISTINCT IF(event = 'auth:login_success',             userId, NULL)) AS login,
  COUNT(DISTINCT IF(event = 'onboarding:folder_connected',    userId, NULL)) AS folder_connected,
  COUNT(DISTINCT IF(event = 'onboarding:orchestrator_opened', userId, NULL)) AS orchestrator_opened,
  COUNT(DISTINCT IF(event = 'agent:spawned',                  userId, NULL)) AS spawned,
  COUNT(DISTINCT IF(event = 'onboarding:spawn_blocked',       userId, NULL)) AS spawn_blocked,
  COUNT(DISTINCT IF(event = 'task:completed',                 userId, NULL)) AS completed,
  COUNT(DISTINCT userId)                                                     AS any_event
FROM `marblo-2253d.marblo_telemetry.events`
WHERE DATE(timestamp) >= '2026-07-06'
GROUP BY wk
ORDER BY wk;
