# 차트 데이터 정합성 실측 — 통합 테이블 연결 여부와 Recharts 여부

작성일: 2026-08-25  
티켓: `iCH9z13S6NrUB3sjH0eU`  
범위: 사장님 질문 2개에 답한다.

1. 모든 데이터가 통합 테이블로 연결되는가?
2. 차트가 Recharts 기반인가?

결론부터 말하면 둘 다 **아니다**. 더 중요한 결론은 “아니오”의 위험도가 항목별로 다르다는 점이다. 설치 총행과 최근 30일 활성 설치는 현재 숫자가 맞지만, 첫 실행 분모와 매출은 실제로 갈린다.

> 브리프 파일 `v3/docs/chart-data-integrity-audit-2026-08-25.md` 는 이 워크트리에 없었다. `find`/`ls` 로 확인했고, 오케스트레이터에 확인 요청을 올린 뒤 주변 정본 문서와 코드, BigQuery 실측으로 진행했다.

## 1. 판정표

| 질문 | 답 | 위험도 | 근거 |
| --- | --- | --- | --- |
| 모든 데이터가 통합 테이블로 연결되는가 | 아니오 | 높음 | `getAdminKpiCockpit`, `getAdminUsageSummary`, `getAdminPurchaseSummary`, Firestore 구독 원장, GA4 설치-이전 퍼널은 여전히 각자 경로다. 통합 뷰는 `v_install_unified` / `v_install_unified_revenue` 로 존재하지만 전면 대체는 아니다. |
| 같은 지표 숫자가 갈리는가 | 예 | 높음 | `app:first_run` 이벤트 분모 13 vs 통합 설치 `firstRunAt` 644. 외부 유료 매출 원장 19,000 KRW vs 통합 매출 뷰 0 KRW. |
| 전부 위험한가 | 아니오 | 중간 | 설치 총행 675 vs 675, 최근 30일 활성 설치 11 vs 11은 현재 일치한다. 다만 세는 단위가 다르거나 화면 라벨이 “사용자”로 읽히면 다시 위험해진다. |
| 차트가 Recharts 기반인가 | 부분적으로만 | 중간 | `marblo-web/package.json` 에 `recharts`가 있고 공용 `TimeSeriesChart`/`MultiSeriesChart` 는 Recharts다. 그러나 `AnalyticsPanel.tsx` 안에 손 SVG `LineChart`, `TwoLineChart`, `StackedBarChart` 정의와 호출이 남아 있다. |

## 2. 실측 비교

BigQuery: `marblo-2253d`, location `US`, datasets `marblo_telemetry`, `marblo_identity`. 전부 읽기 전용 `SELECT`.

### 2-1. 설치수

| 비교 | 기존 경로 | 세는 단위 | 값 | 통합 경로 | 세는 단위 | 값 | 판정 |
| --- | --- | --- | ---: | --- | --- | ---: | --- |
| 설치 총행 | `analytics_install_profile` (`getAdminInstallRetentionSummary`) | 설치 1행 (`install_key`) | 675 | `v_install_unified` | 설치 1행 (`installKey`) | 675 | 일치 |
| 첫 실행 분모 | `events WHERE event='app:first_run'` | 이벤트를 보낸 clientId 1개 | 13 | `v_install_unified WHERE firstRunAt IS NOT NULL` | 설치 1행 (`installKey`) | 644 | **불일치, 49.5배** |

판정: 설치 총행의 정본은 통합 뷰/프로필 쪽이 맞다. `app:first_run` 이벤트는 옵트인·계측 시점 영향을 받는 이벤트 표본이므로 설치 분모로 쓰면 안 된다.

### 2-2. 매출

| 비교 | 기존 경로 | 세는 단위 | 값 | 통합 경로 | 세는 단위 | 값 | 판정 |
| --- | --- | --- | ---: | --- | --- | ---: | --- |
| 외부 유료 매출 | `analytics_purchase`, `account_class='external'`, `amount_known`, `kind IN ('paid','renew')` | 사람/구매 원장 행 (`user_key`, purchase row) | 19,000 KRW | `v_install_unified_revenue`, `accountClass='external'`, `revenueMissingReason IS NULL` | 설치 1행에 붙은 사람 매출 | 0 KRW | **불일치** |
| 통합 뷰 사람 단위 접기 | 위와 같음 | 사람/구매 원장 행 | 19,000 KRW | `v_install_unified_revenue GROUP BY personKey` | 사람 1명, 설치 반복 제거 | 0 KRW | **불일치** |

추가 실측:

| 항목 | 값 |
| --- | ---: |
| `analytics_purchase` 외부 유료 결제 | 1명 / 1행 / 19,000 KRW |
| 위 외부 유료 결제가 `analytics_user_daily.install_key_hmac` + `analytics_user_install` 다리를 통과한 수 | 0명 / 0 KRW |
| `v_install_unified_revenue` 외부 구매 행 | 1 설치, `revenueTotal=0`, `paidCount=0`, `grantCount=1`, 금액 미상 grant |
| `v_install_unified_revenue` 내부 구매 행 | 2 설치, 직접 합산 208,600 KRW. 같은 내부 사람의 104,300 KRW가 2개 설치에 반복된 모양이다. |

판정: 외부 매출 정본은 현재 `analytics_purchase` 원장이다. 통합 매출 뷰는 구매 축을 “모르는” 행 671개를 사유로 분리하는 점은 좋지만, 실제 외부 유료 19,000 KRW가 링크 다리를 통과하지 못해 수익 탭 정본으로 쓰기에는 아직 위험하다. 내부 행에서 보이는 2배 반복도 `SUM(revenueTotal)` 금지 규칙이 실제로 필요한 근거다.

### 2-3. 활성사용자

| 비교 | 기존 경로 | 세는 단위 | 값 | 통합 경로 | 세는 단위 | 값 | 판정 |
| --- | --- | --- | ---: | --- | --- | ---: | --- |
| 최근 30일 활성 | `events` 최근 30일 `COUNT(DISTINCT userId)` | 이벤트를 보낸 clientId 1개 | 11 | `v_install_unified WHERE lastActiveDate >= CURRENT_DATE()-30` | 활동한 설치 1행 | 11 | 현재 일치 |
| 최근 30일 활성 | `analytics_user_daily WHERE active` | 활동한 설치-일에서 distinct 설치 | 11 | 위와 같음 | 활동한 설치 1행 | 11 | 일치 |
| 전기간 활성 | `events COUNT(DISTINCT userId)` | 이벤트를 보낸 clientId 1개 | 44 | `v_install_unified WHERE activeDaysTotal > 0` | 활동한 설치 1행 | 44 | 일치 |

일별 예시:

| 날짜 | 활성 설치 | 이벤트 수 | working heartbeat |
| --- | ---: | ---: | ---: |
| 2026-08-24 | 3 | 14,578 | 25,680 |
| 2026-08-23 | 2 | 2,506 | 1,723 |
| 2026-08-22 | 3 | 9,487 | 58,698 |

판정: 최근 30일 “활성 설치 수”는 현재 안전하다. 단, 이벤트 수나 heartbeat 수를 사용자 수로 읽으면 바로 틀린다. 화면 라벨은 “활성 사용자”보다 “활성 설치”가 맞다.

## 3. 통합 테이블 연결 상태

실제 BigQuery 객체:

| 객체 | 있음 | 역할 |
| --- | --- | --- |
| `marblo_telemetry.v_install_unified` | 예 | 설치 1행 정본. 채널·활성화·리텐션 포함, 결제 없음. |
| `marblo_identity.v_install_unified_revenue` | 예 | 설치 1행 + 사람/결제 컬럼. 다만 현재 외부 유료 결제 19,000 KRW가 링크되지 않는다. |
| `marblo_telemetry.analytics_purchase` | 예 | 현재 외부 매출 정본. |
| `marblo_telemetry.analytics_user_daily` | 예 | 설치-일 활동 정본. `install_key_hmac` non-null 234행 / distinct 44개. |
| `marblo_identity.analytics_user_install` | 예 | 링크표 4행 / distinct install 4개 / distinct user 3개. |

현재 상태는 “통합 뷰가 생겼고 일부 차트가 옮겨가는 중”이지 “모든 데이터가 통합 테이블 하나로 연결됨”이 아니다. 특히 Firestore 구독 원장과 GA4 설치-이전 방문/다운로드 퍼널은 설치 알갱이로 억지 통합하면 안 되는 별도 축이다.

## 4. Recharts 상태

Recharts 기반인 것:

| 파일 | 근거 |
| --- | --- |
| `marblo-web/package.json` | `recharts: ^3.10.1` |
| `marblo-web/src/components/charts/TimeSeriesChart.tsx` | `AreaChart`, `ResponsiveContainer`, `Tooltip`, `XAxis`, `YAxis` 를 `recharts`에서 import |
| `marblo-web/src/components/charts/MultiSeriesChart.tsx` | Recharts 기반 공용 다계열 차트 |

아직 Recharts가 아닌 것:

| 파일 | 근거 |
| --- | --- |
| `marblo-web/src/app/[locale]/admin/AnalyticsPanel.tsx` | 손 SVG `LineChart`(1527), `TwoLineChart`(1674), `StackedBarChart`(9522) 정의 |
| 같은 파일 | 손 SVG 호출 6곳: `LineChart` 3곳, `TwoLineChart` 1곳, `StackedBarChart` 2곳 |
| 같은 파일 | Recharts 공용 `MultiSeriesChart` 호출은 3곳뿐 |

판정: “차트 라이브러리는 Recharts로 결정됐고 공용 컴포넌트는 Recharts”가 맞다. 하지만 어드민 분석 페이지 전체가 Recharts로 이관됐다는 말은 아직 틀리다.

## 5. 후속 티켓 제안

이 티켓에서는 고치지 않는다. 발견만 기록한다.

| 제안 | 문제 | 권장 조치 |
| --- | --- | --- |
| 매출 링크 정합성 수리 | 외부 유료 결제 19,000 KRW가 `v_install_unified_revenue` 에서 0 KRW로 보인다. paid user가 `analytics_user_daily.install_key_hmac` + `analytics_user_install` 다리를 통과하지 못한다. | 외부 유료 purchase row의 user_key가 링크표에 왜 없는지 집계 쿼리로 추적하고, 백필/링크 생성 경로를 별도 티켓에서 수리한다. |
| 첫 실행 분모 교체 | `events app:first_run` distinct userId 13 vs 통합 `firstRunAt` 644. | 설치/활성화 헤드라인 분모는 `v_install_unified` 또는 `analytics_install_profile`만 쓰게 한다. events 기반 first_run은 운영 표본으로만 표기한다. |
| 어드민 차트 Recharts 이관 마감 | `AnalyticsPanel.tsx`에 손 SVG 차트가 남아 있다. | 남은 `LineChart`, `TwoLineChart`, `StackedBarChart` 호출을 공용 `TimeSeriesChart`/`MultiSeriesChart`로 이동한다. |
| 라벨 정정 | 최근 30일 값은 맞지만 세는 단위는 사람 1명이 아니라 설치 1개다. | “활성 사용자” 라벨을 “활성 설치” 또는 “활성 설치(clientId)”로 바꾸고, 사람 축은 별도 표에서만 쓴다. |

## 6. 검증 명령

GUI 검증은 하지 않았다. Electron/브라우저/스크린샷 금지 규칙 때문에 BigQuery 읽기, 정적 grep, 문서 작성만 수행했다.

```sh
bq --project_id=marblo-2253d --location=US ls marblo_telemetry
bq --project_id=marblo-2253d --location=US ls marblo_identity
bq --project_id=marblo-2253d --location=US show --schema marblo_telemetry.v_install_unified
bq --project_id=marblo-2253d --location=US show --schema marblo_identity.v_install_unified_revenue
bq --project_id=marblo-2253d --location=US query --use_legacy_sql=false '[설치/매출/활성 비교 SELECT]'
rg -n 'function (LineChart|TwoLineChart|StackedBarChart)|<LineChart|<TwoLineChart|<StackedBarChart|<TimeSeriesChart|<MultiSeriesChart' 'marblo-web/src/app/[locale]/admin/AnalyticsPanel.tsx'
rg -n 'from "recharts"|recharts' marblo-web/src/components/charts 'marblo-web/src/app/[locale]/admin/AnalyticsPanel.tsx' marblo-web/package.json
```
