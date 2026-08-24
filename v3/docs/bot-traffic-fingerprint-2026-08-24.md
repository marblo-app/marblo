# 봇 트래픽 판별 — 단일지문 집중도 (ticket IU1KDbYAv7FEewPkwHPU)

인스타·유튜브·X(해외) 소액 집행을 앞두고 "봇은 거를 수 있나" 가 질문이었다.
거를 수 있다. 이 문서는 **무엇을 재서 어떻게 갈랐는지** 와 그 판정을 **재현하는
쿼리** 를 남긴다.

## 0. 결론 먼저

| 순위 | 방어선 | 비용 | 누가 쓰나 |
|---|---|---|---|
| 1 | **분모를 방문이 아니라 다운로드·설치로** | 0 (규칙 없음) | CAC·채널 표의 기본값 |
| 2 | 단일지문 집중도 판정 | 규칙 2개 | 방문 축을 읽을 때만 |

봇은 Electron 데스크톱을 내려받아 설치하고 실행하지 않는다. 그래서 ①만으로도
봇은 이미 0으로 센다 — ②는 **방문 수를 봐야 할 때** 필요한 두 번째 방어선이다.

## 1. 실측 (analytics_543991508, `asia-northeast3`, 최근 30일, 2026-08-24)

지문 = `device.category` × `device.web_info.browser` × `device.operating_system`.
판정풀 = 다운로드 0 **그리고** 세 축이 모두 해석된 방문자.

| 국가 | 판정풀 | 고유지문 | 최다지문 점유 | 전체 다운로드 | 판정 |
|---|---:|---:|---:|---:|---|
| Iran | 106 | 1 | 100% | 0 | **의심** |
| Luxembourg | 12 | 1 | 100% | 0 | **의심** |
| Netherlands | 9 | 1 | 100% | 0 | **의심** |
| Singapore | 8 | 1 | 100% | 0 | **의심** (티켓에 없던 신규 발견) |
| South Korea | 190 | 14 | 23.7% | 12 | 정상 |
| United States | 19 | 11 | 21.1% | 0 | 정상 |
| Mexico | — | — | — | 2 | 정상(전원 다운로드 → 판정풀 밖) |

의심 지문은 전부 `desktop / Chrome / Macintosh` 하나였다. 106명이 전부 같은
OS·브라우저·기기종류인 인구 집단은 없다. **GA4 기본 봇 필터가 켜져 있는데도
통과했다** — 알려진 봇 리스트로는 안 잡힌다는 뜻이다.

60일 창에서도 구조는 같다: Iran 125 / 1지문, Netherlands 16 / 1지문,
South Korea 488 / 21지문. 티켓의 30일 수치(Iran 129 · Netherlands 89)와 다른
것은 조회창이 굴러간 결과이고 지문 구조는 동일하다.

## 2. ★국가로 차단하지 않는다

판정 축은 국적이 아니라 **행동** 두 개다 — (a) 코호트의 device×browser×os
집중도, (b) 다운로드 0. 국가는 집계 단위일 뿐 차단 목록이 아니다.
위 표가 그 차이를 스스로 증명한다:

- **United States 19명은 다운로드가 0인데도 통과한다** — 지문이 11가지라서.
- **Mexico 2명은 지문이 1가지인데도 통과한다** — 둘 다 다운로드해서 판정풀에
  아예 들어가지 않는다.

국가 목록이었다면 둘 다 틀렸을 것이다. 이란에 진짜 사용자가 생겨 앱을
내려받으면 그 사람은 이란 코호트가 통째로 의심이어도 의심에 들어가지 않는다
(`botTraffic.isJudgeable`, 단위테스트로 고정).

## 3. 규칙

`v3/functions/src/botTraffic.ts`

- `SUSPECT_MIN_COHORT_VISITORS = 8` — 판정풀이 이보다 작으면 판정하지 않는다.
  소수 코호트는 지문이 1가지인 게 정상이다(실측 Japan 2 · Canada 1).
- `SUSPECT_SIGNATURE_SHARE = 0.95` — 판정풀 최다 지문 점유율 임계값.
  대조군 South Korea 는 0.237 이라 여유가 크다.
- 의심으로 세는 것은 **최다 지문을 가진 판정풀 방문자뿐** — 섞여 있던 다른
  지문의 방문자는 들어가지 않는다.
- 세 축 중 하나라도 비면 지문이 아니다 → **판정 불능은 무죄**. 이게 없으면
  GA4 가 device 필드를 못 채운 날 전 세계가 하나의 지문을 공유해 봇이 된다.

## 4. ★판정은 파생이다

원장(BigQuery)에 `bot` 플래그를 굽지 않는다. 규칙이 바뀌면 과거를 다시 못 읽기
때문이다. `classifyBotTraffic()` 은 입력을 변형하지 않고 매 조회마다 다시
계산하며, 임계값을 바꾸면 **같은 원본이 즉시 새 규칙으로 다시 읽힌다**.

## 5. ★거른 것을 버리지 않는다

의심 유입은 삭제가 아니라 `suspectedVisitors` 로 **따로 표기**된다
(`FunnelRow.visitors` = 의심 제외, `suspectedVisitors` = 의심, `observedVisitors`
= 원본). 어드민 화면에는 표의 별도 칸과 "★ 의심 유입 N방문" 카드로 뜬다.
조용히 뺀 숫자는 이 프로젝트가 이미 세 번 밟은 함정이고, 미매칭 광고비를
보이게 한 #1193 과 같은 원칙이다.

## 6. 재현 쿼리

★`asia-northeast3` 는 **location 을 명시해야** 돈다. US 기본으로 쏘면
`not found in location US` 가 뜨는데 그건 테이블이 없다는 뜻이 **아니다**.

```bash
bq --location=asia-northeast3 query --use_legacy_sql=false < 아래 SQL
```

```sql
WITH ev AS (
  SELECT user_pseudo_id, event_timestamp, event_name,
         geo.country AS country, device.category AS dc,
         device.web_info.browser AS br, device.operating_system AS os
  FROM `marblo-2253d.analytics_543991508.events_*`
  WHERE _TABLE_SUFFIX BETWEEN
      FORMAT_DATE('%Y%m%d', DATE_SUB(CURRENT_DATE('Asia/Seoul'), INTERVAL 30 DAY))
      AND FORMAT_DATE('%Y%m%d', CURRENT_DATE('Asia/Seoul'))
    AND user_pseudo_id IS NOT NULL
),
u AS (  -- 방문자당 1행. first-touch 순서로 첫 non-null 을 고른다.
  SELECT user_pseudo_id,
    IFNULL(ARRAY_AGG(country IGNORE NULLS ORDER BY event_timestamp LIMIT 1)[SAFE_OFFSET(0)],'(unknown)') AS country,
    ARRAY_AGG(dc IGNORE NULLS ORDER BY event_timestamp LIMIT 1)[SAFE_OFFSET(0)] AS dc,
    ARRAY_AGG(br IGNORE NULLS ORDER BY event_timestamp LIMIT 1)[SAFE_OFFSET(0)] AS br,
    ARRAY_AGG(os IGNORE NULLS ORDER BY event_timestamp LIMIT 1)[SAFE_OFFSET(0)] AS os,
    COUNTIF(event_name='download') AS downloads
  FROM ev GROUP BY user_pseudo_id
),
pool AS (  -- ★판정풀 = 다운로드 0 + 지문 3축 모두 해석됨
  SELECT country, CONCAT(dc,' / ',br,' / ',os) AS fp
  FROM u
  WHERE downloads = 0 AND dc IS NOT NULL AND br IS NOT NULL AND os IS NOT NULL
),
fp AS (SELECT country, fp, COUNT(*) AS n FROM pool GROUP BY country, fp),
agg AS (
  SELECT country, SUM(n) AS pool_visitors, COUNT(*) AS distinct_fp, MAX(n) AS top_n,
         ARRAY_AGG(fp ORDER BY n DESC LIMIT 1)[SAFE_OFFSET(0)] AS top_fp
  FROM fp GROUP BY country
)
SELECT a.country, a.pool_visitors, a.distinct_fp,
       ROUND(a.top_n / a.pool_visitors, 4) AS top_share, a.top_fp,
       (SELECT COUNT(*)      FROM u WHERE u.country = a.country) AS all_visitors,
       (SELECT SUM(downloads) FROM u WHERE u.country = a.country) AS all_downloads,
       -- SUSPECT_MIN_COHORT_VISITORS = 8, SUSPECT_SIGNATURE_SHARE = 0.95
       (a.pool_visitors >= 8 AND a.top_n / a.pool_visitors >= 0.95) AS suspected
FROM agg a
ORDER BY a.pool_visitors DESC
```

## 7. 부수 확인 — 브리지 커버리지 (고치지 않고 보고만)

2026-08-24 기준 `marblo_telemetry.ga4_first_touch` 는 **100행**(distinct gaKey
100), `firstVisitDate` 2026-08-19 ~ 2026-08-22, 마지막 `syncedAt`
`2026-08-23T20:30:08Z`(= 05:30 KST, **#1194 이전 스케줄**).
#1194 가 도입한 `ga4_bridge_sync_log` 테이블은 US 리전에 아직 존재하지 않는다
(404) — 즉 **#1194 는 아직 배포되지 않았다.**

따라서 "GA4 원본 30일 한국만 201명 vs 브리지 전체 100행" 커버리지 차이는 그대로
남아 있고, 원인은 동기 주기가 아니라 **배포**다. 배포 후 `chooseSyncDays()` 가
`firstVisitDate` 폭(현재 3일)을 보고 400일 백필을 한 번 고르므로, 배포되면
자동으로 메워질 것으로 예상된다 — 배포 뒤 이 표를 다시 재야 확인된다.
