# 광고 UTM 태깅 규약

광고 링크는 항상 `marblo.app` 랜딩에 UTM을 붙인다. **GitHub 릴리즈 직링크로 광고를 돌리지 않는다.** 릴리즈 링크는 채널 정보를 싣지 못해서 설치 귀속이 통째로 빈다.

## 넣는 값

| 항목 | 넣을 것 | 예시 |
| --- | --- | --- |
| `utm_source` | 광고를 산 플랫폼 | `instagram`, `youtube`, `x`, `meta`, `google`, `threads` |
| `utm_medium` | 전달 방식 | `video`, `social-paid`, `cpc` |
| `utm_campaign` | 캠페인명. **광고비 입력 캠페인명과 같은 문자열** | `202608-launch-marblo` |
| `utm_content` | **소재**. 같은 캠페인 안의 이미지·카피·영상 변형. 소재별 분석의 유일한 축 | `video-15s-founder`, `image-workspace-a`, `copy-cac-b` |
| `utm_term` | 검색 키워드. 검색광고가 아니면 비워도 됨 | `ai-coding-agent`, `claude-code-gui` |

## 표기 규칙

전부 **소문자·하이픈**으로 쓴다. 공백, 언더스코어, 슬래시, 괄호를 쓰지 않는다.

X는 `utm_source=x`로 고정한다. `twitter`와 섞으면 같은 채널이 둘로 쪼개져 보이고, 현재 제품명은 X라서 짧은 현재명을 쓴다.

`normalizeCampaignKey`는 대소문자와 공백류를 어느 정도 접어주지만, 이것은 실수 흡수용이다. 처음부터 광고 URL의 `utm_campaign`과 광고비 입력의 캠페인명을 같은 문자열로 맞춘다. 다르면 CAC가 미매칭으로 빠진다.

## 복사용 URL

캠페인명은 광고비 입력에도 그대로 `202608-launch-marblo`를 쓴다. 소재가 바뀌면 `utm_content`만 바꾼다.

```text
인스타그램 - 소재 A/B/C
https://marblo.app/?utm_source=instagram&utm_medium=social-paid&utm_campaign=202608-launch-marblo&utm_content=reels-workspace-a
https://marblo.app/?utm_source=instagram&utm_medium=social-paid&utm_campaign=202608-launch-marblo&utm_content=reels-user-proof-b
https://marblo.app/?utm_source=instagram&utm_medium=social-paid&utm_campaign=202608-launch-marblo&utm_content=image-cac-c

유튜브 - 소재 A/B/C
https://marblo.app/?utm_source=youtube&utm_medium=video&utm_campaign=202608-launch-marblo&utm_content=video-15s-founder
https://marblo.app/?utm_source=youtube&utm_medium=video&utm_campaign=202608-launch-marblo&utm_content=video-30s-workspace
https://marblo.app/?utm_source=youtube&utm_medium=video&utm_campaign=202608-launch-marblo&utm_content=shorts-user-proof

X - 소재 A/B/C
https://marblo.app/?utm_source=x&utm_medium=social-paid&utm_campaign=202608-launch-marblo&utm_content=post-founder-a
https://marblo.app/?utm_source=x&utm_medium=social-paid&utm_campaign=202608-launch-marblo&utm_content=post-workspace-b
https://marblo.app/?utm_source=x&utm_medium=social-paid&utm_campaign=202608-launch-marblo&utm_content=post-cac-c

부록: 메타
https://marblo.app/?utm_source=meta&utm_medium=social-paid&utm_campaign=202608-launch-marblo&utm_content=image-workspace-a

부록: 구글 검색
https://marblo.app/?utm_source=google&utm_medium=cpc&utm_campaign=202608-launch-marblo&utm_content=search-text-a&utm_term=ai-coding-agent

부록: 쓰레드
https://marblo.app/?utm_source=threads&utm_medium=social-paid&utm_campaign=202608-launch-marblo&utm_content=post-cac-a
```

## 성과 볼 때

분모는 방문 수가 아니라 **다운로드·설치 수**다. GA4 원본에서 Iran 129, Netherlands 89, Luxembourg 17, Russia 14, Norway 9가 전부 `desktop/Chrome/Macintosh` 단일 조합이고 다운로드 0건이었다. 해외 광고에는 봇이 더 섞인다. 방문 CPC가 싸 보여도 다운로드가 0이면 그 채널은 봇을 산 것이다.

첫 광고에서 먼저 볼 숫자는 CAC이 아니라 **방문→다운로드**다. 방문은 오는데 다운로드가 안 되면 랜딩 문제지 채널 탓이 아니다. 참고로 지금 웹은 약 97방문 중 다운로드 2건이다.

## 첫 광고 다음날 확인 쿼리

프로젝트 `marblo-2253d`, 데이터셋 `marblo_telemetry`, 리전 `US`. `start_ts`는 광고 시작 시각으로 바꾼다. 무비용 실트래픽 검증 선례는 [`utm-live-verification-2026-08-24.md`](./utm-live-verification-2026-08-24.md)를 본다.

```sql
DECLARE start_ts TIMESTAMP DEFAULT TIMESTAMP('2026-08-24 00:00:00+09');

SELECT
  utmSource,
  utmMedium,
  utmCampaign,
  utmContent,
  utmTerm,
  COUNT(*) AS installs
FROM `marblo-2253d.marblo_telemetry.install_attribution`
WHERE linkedAt >= start_ts
  AND IFNULL(buildChannel, 'prod') != 'dev'
GROUP BY 1, 2, 3, 4, 5
ORDER BY installs DESC;
```
