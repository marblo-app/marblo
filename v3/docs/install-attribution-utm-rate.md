# 설치 유입 포착 — 귀속률 조회 · 광고 URL 규약

티켓 `1hLxESWqnAT3eFf4MAhg`. 화면 없음. 첫 광고 뒤 아래 쿼리를 그대로 쓴다.

## 광고 URL 규약

광고 랜딩은 `https://marblo.app/?utm_source=…&utm_medium=…&utm_campaign=…&utm_content=…&utm_term=…` 이어야 한다. GitHub 릴리즈 직링을 광고에 쓰면 어떤 방법으로도 못 잡는다.

★`utm_content`(소재) · `utm_term`(키워드) 는 2026-08-24 부터 포착된다 — 그 전에는 파싱 자체가 없었다(티켓 `OqSGPuyOTR8t6Bgl0WI5`). **소재별로 값을 다르게** 넣어야 소재 단위 분석이 성립한다. 앱 원장 ↔ GA4 조인은 원시 `gaClientId` 가 아니라 **`gaKeyHmac`** 으로 한다 — 근거·검증 쿼리·소급 백필 계획은 [`install-attribution-ga-key-join-2026-08-24.md`](./install-attribution-ga-key-join-2026-08-24.md).

## 귀속률 쿼리

기간 내 신규 설치 중 utm 이 실린 비율. 프로젝트 `marblo-2253d`, 데이터셋 `marblo_telemetry`, 리전 `US`. 결과가 비면 대상이 아니라 조회(프로젝트·리전·날짜 필터)를 먼저 의심한다.

`start_ts` 를 광고 시작일(또는 이 포착 수정 배포일)로 바꾼다.

```sql
DECLARE start_ts TIMESTAMP DEFAULT TIMESTAMP('2026-08-24');

SELECT
  COUNT(*) AS new_installs,
  COUNTIF(ft_utm_source IS NOT NULL AND ft_utm_source != '') AS with_utm,
  SAFE_DIVIDE(
    COUNTIF(ft_utm_source IS NOT NULL AND ft_utm_source != ''),
    COUNT(*)
  ) AS utm_rate
FROM `marblo-2253d.marblo_telemetry.analytics_install_profile`
WHERE first_run_at >= start_ts
  AND IFNULL(ft_build_channel, 'prod') != 'dev';
```

`dev` 채널은 소스 재실행이라 분모에서 뺀다. `buildChannel` 이 없던 구버전 행은 `prod` 로 본다.

## 한계 (정직하게)

- GitHub 릴리즈 직링으로만 받은 설치는 여전히 미상이다. 그 브라우저는 다운로드 전에 `marblo.app?utm=` 을 본 적이 없다.
- 다운로드 브라우저 ≠ 기본 브라우저면 `/link` 가 빈 first-touch 를 보낸다. 그 비율은 아직 실측이 없다. 클립보드 핸드오프(안 A)는 사용자 클립보드를 덮어쓰므로 미뤘다.
- `/link` 는 설치당 1회다. first-non-direct 업그레이드는 **그 전송 전에** 같은 브라우저가 utm/referrer 를 만났을 때만 BQ 행에 실린다.
- 과거 591건(utm·referrer 전무)은 영영 미상이다. 새로 오는 사람부터다.
- 원시 식별자를 만들지 않는다. `ANALYTICS_ID_SALT` 를 바꾸지 않는다. IP 지문 없음.
