# 앱 원장 ↔ GA4 조인 — 키 공간이 갈렸던 건 (2026-08-24)

티켓 `OqSGPuyOTR8t6Bgl0WI5`. 화면 없음. 배선 문제다.

## 1. 무엇이 틀렸나

사장님 요구는 "매체·캠페인명·소재 단위 분석" 이다. 그런데 채널 축(GA4)과
설치·활성화·결제 축(앱 원장)이 **한 건도** 이어지지 않았다.

```
install_attribution.gaClientId    길이 20~21   예 `90752754…`   = 원본 GA client_id
ga4_first_touch_current.gaKey     길이 27      예 `ga_0989c…`    = 가명(ga_ + 24자 HMAC)
```

조인이 "비어서" 가 아니다. **키 공간이 갈렸다.** 한쪽은 원본, 한쪽은 가명이라
`ON i.gaClientId = g.gaKey` 는 문법도 타입도 맞으면서 **영원히 0행**이다.
에러가 안 나기 때문에 표만 보면 "유입이 없네" 로 읽힌다 — 조용한 실패다.

실측(2026-08-24, `marblo-2253d.marblo_telemetry`, US):

| installs | with_ga_client_id | joined | has_content | has_term |
| ---: | ---: | ---: | ---: | ---: |
| 632 | 631 | **0** | 0 | 0 |

같은 함정을 오늘 이미 한 번 밟았다 — #1171 의
`analytics_user_daily.install_key`(원본) vs 링크표 `install_key`(HMAC).

## 2. 왜 "복원" 이 아니라 "컬럼 추가" 인가

가명은 비밀 솔트로 키드된 HMAC 이다. **단방향이라 되돌릴 수 없다.** 그러므로
가명 쪽을 원본으로 되돌리는 해법은 존재하지 않는다. 남는 선택은 하나다 —
**원본이 있는 쪽에 가명 컬럼을 더한다.** #1171 이 `install_key_hmac` 으로 한
선택과 같다.

→ `install_attribution` 에 `gaKeyHmac` 을 더한다. 원시 `gaClientId` 는 **그대로
둔다**(소급 백필의 재료이자 기존 쿼리 호환).

### 가명화 kind 는 `"ga"` — 추측이 아니라 전수 확인

GA4 쪽 가명키 생산자는 코드 전체에서 **정확히 두 곳**이고, 둘 다 같은 kind ·
같은 솔트 · 같은 스킴이다:

| 생산자 | 호출 | 쓰는 곳 |
| --- | --- | --- |
| `index.ts` `syncGa4FirstTouchInternal` (`:16222`) | `deriveGaKey(raw.gaClientId, salt)` — `raw.gaClientId` 는 GA4 export 의 `user_pseudo_id` (`ga4Bridge.ts:381`) | `ga4_first_touch.gaKey` |
| `scripts/backfill-analytics-identity.ts` (`:209`) | `pseudonymizeAnalyticsId("ga", gaRaw, salt)` | `analytics_identity.ga_key` |

둘 다 `analyticsPseudonym.ts:262` 의 `pseudonymizeAnalyticsId("ga", v, salt)` 로
수렴한다. 솔트도 양쪽 다 `readAnalyticsIdSalt()` 다(`index.ts:353`
`getAnalyticsIdSalt` 래퍼). 그래서 원장 쪽도 **같은 `deriveGaKey()` 한 벌**을
쓴다. 여기서 새 kind 를 파면 조인이 다시 0 이 되고, 이번엔 원인이 더 안 보인다.

★`ANALYTICS_ID_SALT` 는 **바꾸지 않는다.** 바꾸면 과거 가명키가 전부 무효가 되고
이미 쌓인 `analytics_identity.ga_key` 550행과 브리지 전량이 죽는다.

## 3. 소재 축이 애초에 수집되지 않았다

`utm_content` · `utm_term` 은 `marblo-web` · `v3/functions` **어디에도 파싱
코드가 없었다**(`utm_source` 17지점 · `utm_medium` 7 · `utm_campaign` 7 뿐).
`install_attribution` 스키마에도 `utmContent`/`utmTerm` 이 없었다.

소재(크리에이티브) 축은 이 두 값이 유일하다. 지금은 유기적 유입뿐이라 거의 항상
비지만 — **광고를 켠 뒤에 수집을 시작하면 그 전 구간은 복구되지 않는다**
(BigQuery 는 과거 파티션에 값을 소급 생성해 주지 않는다). 그래서 지금 만든다.
GA4 브리지가 `content`/`term` 컬럼을 비어 있는 채로 미리 만든 것과 같은 이유다
(`ga4Bridge.ts` 머리말).

## 4. 광고 URL 규약 (갱신)

```
https://marblo.app/?utm_source=…&utm_medium=…&utm_campaign=…&utm_content=…&utm_term=…
```

`utm_content` 는 소재 식별자(배너/카피/영상 버전), `utm_term` 은 검색 키워드다.
**소재별로 값을 반드시 다르게** 넣어야 소재 단위 분석이 성립한다. 광고 랜딩을
GitHub 릴리즈 직링으로 잡으면 어떤 방법으로도 못 잡는다
(`install-attribution-utm-rate.md`).

## 5. 검증 쿼리 (이 티켓의 증거)

### 5-1. 수정 전 — joined 가 0 이다

```sql
SELECT
  COUNT(*)                          AS installs,
  COUNTIF(i.gaClientId IS NOT NULL) AS with_ga_client_id,
  COUNTIF(g.gaKey IS NOT NULL)      AS joined
FROM `marblo-2253d.marblo_telemetry.install_attribution` i
LEFT JOIN `marblo-2253d.marblo_telemetry.ga4_first_touch_current` g
  ON i.gaClientId = g.gaKey;      -- ★원본 = 가명. 항상 0행.
-- 실측 2026-08-24: 632 / 631 / 0
```

### 5-2. 키 공간이 실제로 맞는지 — 배포 전에 확인할 수 있다

`analytics_identity.ga_key` 는 **바로 이 `install_attribution.gaClientId` 를**
`pseudonymizeAnalyticsId("ga", …)` 로 가명화한 값이다
(`backfill-analytics-identity.ts:209`). 즉 `gaKeyHmac` 이 채워졌을 때 성립할
조인과 **같은 조인**이다. 이게 0 이 아니면 kind·솔트 선택이 맞다는 뜻이다.

```sql
SELECT
  COUNT(*)                        AS identity_rows_with_ga_key,
  COUNTIF(g.gaKey IS NOT NULL)    AS joined,
  COUNTIF(g.campaign IS NOT NULL) AS has_campaign,
  COUNTIF(g.content IS NOT NULL)  AS has_content
FROM `marblo-2253d.marblo_telemetry.analytics_identity` i
LEFT JOIN `marblo-2253d.marblo_telemetry.ga4_first_touch_current` g
  ON i.ga_key = g.gaKey
WHERE i.ga_key IS NOT NULL;
-- 실측 2026-08-24: 550 / 483 / 483 / 0
--   → joined 483 (88%). 키 공간은 맞다. content 0 은 §3 그대로 — 아직 유기적 유입뿐.
```

### 5-3. 배포 후 — 새로 들어오는 설치가 조인된다

`start_ts` 를 **이 PR 배포 시각**으로 바꾼다. 그 전 행은 `gaKeyHmac` 이 NULL
이므로(소급 재작성 없음) 분모에서 빼야 정직한 숫자가 나온다.

```sql
DECLARE start_ts TIMESTAMP DEFAULT TIMESTAMP('2026-08-24');

SELECT
  COUNT(*)                            AS installs,
  COUNTIF(i.gaKeyHmac IS NOT NULL)    AS with_ga_key,
  COUNTIF(g.gaKey IS NOT NULL)        AS joined,          -- ★ > 0 이어야 한다
  COUNTIF(g.campaign IS NOT NULL)     AS has_campaign,
  COUNTIF(g.content  IS NOT NULL)     AS has_content,     -- 광고 켠 뒤부터 채워진다
  COUNTIF(i.utmContent IS NOT NULL)   AS ledger_has_content
FROM `marblo-2253d.marblo_telemetry.install_attribution` i
LEFT JOIN `marblo-2253d.marblo_telemetry.ga4_first_touch_current` g
  ON i.gaKeyHmac = g.gaKey           -- ★가명 = 가명. 같은 공간.
WHERE i.linkedAt >= start_ts
  AND IFNULL(i.buildChannel, 'prod') != 'dev';
```

★`gaKeyHmac` 이 아직 GA4 브리지에 없을 수 있다 — 브리지 동기화는 스케줄이고
first-touch 는 나중 값으로 덮지 않는다. 조인이 낮게 나오면 브리지 동기화 지연을
먼저 본다(별개 티켓 `Tscd3JzHec3ahGI6Jgl6`).

★원시 컬럼으로는 **다시 조인하지 마라**. `i.gaClientId = g.gaKey` 는 앞으로도
영원히 0행이다.

## 6. 소급 백필 — 별도 단계 (이 PR 아님)

과거 632행은 원시 `gaClientId` 가 원장에 그대로 남아 있으므로 **나중에 채울 수
있다.** 다만 앞으로 들어오는 것부터 맞추는 게 먼저라서 이 PR 에 섞지 않는다.

실행할 때의 계획:

1. **재료 확인** — `SELECT COUNT(*) FROM install_attribution WHERE gaClientId IS NOT NULL AND gaKeyHmac IS NULL` (2026-08-24 기준 631행).
2. **스크립트** — `scripts/backfill-analytics-identity.ts` 와 같은 모양으로
   `scripts/backfill-install-attribution-ga-key.ts` 를 둔다. 반드시
   `deriveGaKey()` 를 쓴다(새 kind 금지). 솔트는 런타임 env 에서만 읽는다.
3. **쓰기 방식** — `install_attribution` 은 `linkedAt` DAY 파티션 테이블이고
   스트리밍 insert 를 쓴다. UPDATE 는 스트리밍 버퍼 구간에서 실패하므로
   **`MERGE` 로 파티션 단위, 오래된 파티션부터** 처리한다. 최근 90분 이내
   파티션은 건너뛰고 다음 회차에 맡긴다.
4. **멱등** — `WHERE gaKeyHmac IS NULL AND gaClientId IS NOT NULL` 술어로만
   쓴다. 이미 채워진 행은 절대 덮지 않는다(값이 같더라도 재작성하지 않는다).
5. **검증** — 백필 후 §5-3 쿼리를 `start_ts` 없이 돌려 `joined` 가 §5-2 의 483
   근처로 올라오는지 본다. 크게 낮으면 브리지 동기화 창(`GA4_SYNC_DEFAULT_DAYS`)
   부터 의심한다.
6. **하지 않는 것** — `utmContent`/`utmTerm` 의 소급 백필. 그 값은 애초에 웹에서
   수집된 적이 없다. **재료가 없으므로 복구는 불가능하다.** 지난 기간의 소재 축은
   영영 미상이며, 지어내지 않는다.

## 7. 이 변경이 건드리지 않은 것

- `ANALYTICS_ID_SALT` — 무변경(diff 로 증명).
- 원시 `gaClientId` 컬럼 — 보존. 기존 쿼리·백필 재료 그대로.
- 익명축/계정축 경계 — `gaKeyHmac` 은 익명축 키(`ga` kind)다. 계정축과 잇는 표는
  여전히 `marblo_identity.analytics_user_install` 하나뿐이다
  (`analyticsPseudonym.ts` 머리말의 축 경계).
- GA4 브리지 · `analytics_identity` — 손대지 않았다. 같은 공간에 합류만 했다.
