# 어드민 분석 콜러블 통합 뷰 이관 분류

작성일: 2026-08-25  
티켓: `pE2xqhy6VV2R0Ts4doBt`

정본 문서:

- `v3/docs/chart-data-integrity-2026-08-25.md`
- `v3/docs/admin-analytics-replan-2026-08-24.md`

원칙: "이 값이 X 면 우리는 Y 를 한다" 를 한 줄로 못 쓰면 버린다. 세는 단위가 설치 1행이 아니면 `v_install_unified` 로 억지 이관하지 않는다.

## 화면 호출 분류표

| 콜러블 | 분류 | 세는 단위 | 결정 문장 / 남기는 이유 |
| --- | --- | --- | --- |
| `getAdminInstallUnified` | 이관 가능 | 설치 1행 | 채널을 아는 설치와 첫스폰 도달이 낮으면 유입 품질 또는 온보딩을 고친다. `v_install_unified` 위의 얇은 읽기 경로다. |
| `getAdminCacSummary` | 유지, 통합 뷰와 대조 | 광고비 원장 행 + 설치 1행 | CAC 가 LTV 를 넘으면 그 채널 광고를 끈다. 광고비는 설치 이전 원장 축이라 뷰로 흡수하지 않고, 획득 설치 분모만 `v_install_unified` 로 대조한다. |
| `getAdminKpiCockpit` | 부분 이관/삭제 | clientId 이벤트 표본 | 첫스폰/첫완주 설치축 헤드라인은 통합 뷰로 옮긴다. 표본 한 자릿수 게이지와 정의 불가 KPI는 삭제한다. |
| `getAdminBetaSegmentUsage` | 삭제/운영 보류 | founderGrant 1건 | 축이 은퇴했고 표본이 작다. 분모가 차기 전 사업 탭 판단에 쓰지 않는다. |
| `getAdminUsageSummary` | 운영 탭으로 이전 | clientId 이벤트 표본 | 이벤트량이 튀면 배포/계측 이상을 본다. 사업 판단 지표가 아니라 운영 표본이다. |
| `getAdminModelSummary` | 운영 탭으로 이전 | 토큰 쓴 계정/라우팅 결정 | 모델 비용이 튀면 라우팅을 조인다. 설치 통합 테이블 축이 아니다. |
| `getAdminReleaseHealth` | 운영 탭으로 이전 | 버전 x clientId | 크래시율이 튀면 롤백한다. 설치 퍼널이 아니라 배포 헬스다. |
| `getAdminOnboardingFunnel` | 유지 | clientId 이벤트 표본 | 최대 이탈 구간이 이번 주 고칠 곳이다. 로그인/폴더연결/오케오픈 같은 중간 단계는 통합 뷰에 없다. |
| `getAdminBusinessSummary` | 유지 | Firestore 구독/계정 | past_due/이탈이 늘면 결제·리텐션 대응을 한다. Firestore 구독 원장은 설치축으로 접으면 안 된다. |
| `getAdminCountryFunnel` | 유지, 설치 이후 단계만 축소 | GA4 브라우저/방문 + 설치 | 다운로드 0 국가가 큰 시장이면 로케일·결제수단을 본다. 방문/다운로드는 설치 이전 축이라 통합 뷰로 옮기지 않는다. |
| `getAdminDrilldown` | 유지 | 요청별 다름 | 차트 이상치 원인 확인용이다. 헤드라인 집계 정본이 아니라 상세 조회 경로다. |

`getAdminCallableManifest` 는 배포 메타 콜러블이라 화면 호출 대조에서 제외한다.

## 화면 미호출 삭제 후보

| 콜러블 | 분류 | 세는 단위 | 삭제 후보 사유 |
| --- | --- | --- | --- |
| `getAdminInstallRetentionSummary` | 삭제 후보 | 설치 1행 | 화면 실제 호출 지점이 없고 주석에만 남았다. 설치 리텐션은 `getAdminInstallUnified` 응답 확장 뒤 화면에 붙인다. |
| `getAdminRetentionCohorts` | 삭제 후보 | 계정 1개 | 화면 실제 호출 지점이 없고 주석에만 남았다. 계정 코호트는 설치축 이관 PR 범위 밖 별도 사람축 판단으로 남긴다. |
| `getAdminStreakRetention` | 삭제 후보 | 설치 1행 + 계정 1개 | 화면 실제 호출 지점이 없고 주석에만 남았다. 스트릭 격자는 살아 있는 화면 요구가 확인될 때만 새 응답 계약으로 되살린다. |
| `getAdminUserDailySummary` | 삭제 후보 | 설치 1행 | 화면에는 상수만 있고 호출 지점이 없다. 좀비/활동일은 통합 뷰의 `activeDaysTotal`/`observedDays` 로 대체한다. |
| `getAdminAccountProfileSummary` | 삭제 후보 | 계정 1개 | 화면에는 상수만 있고 호출 지점이 없다. `mrr_usd`/`ltv_usd` 도 전량 null 이라 어떤 값에도 행동할 수 없다. |
| `getAdminPurchaseSummary` | 보류 | 사람/구매 원장 행 | 화면에는 상수만 있고 호출 지점이 없다. 다만 `v_install_unified_revenue` 수리 전 외부 매출 정본은 원장이라 서버 삭제는 수리 티켓 뒤 재판정한다. |

## 이 PR에서 잠근 이관

백엔드 PR 단위는 `getAdminInstallUnified` 유지와 검증 보강이다. 이 콜러블은 `marblo_telemetry.v_install_unified` 위에서 획득 설치축만 읽는다.

세는 단위:

- 설치/채널/활성화 헤드라인: 설치 1행(`installKey`)
- first_run 이벤트 대조: 이벤트를 보낸 clientId 1개. 통합 설치 분모와 다르다는 경고용이며, 같아야 하는 값으로 쓰지 않는다.
- 매출: 이번 PR에서 화면 연결 금지. `v_install_unified_revenue` 수리 티켓 `n7FTmf0KMEFshg1F8Npz` 완료 전에는 원장 `analytics_purchase` 를 유지한다.

## 실측 대조

2026-08-25, BigQuery `marblo-2253d`, location `US`.

| 대조 | 기존 경로 | 세는 단위 | 값 | 통합 경로 | 세는 단위 | 값 | 판정 |
| --- | --- | --- | ---: | --- | --- | ---: | --- |
| 설치 행수 | `analytics_install_profile` | 설치 1행 | 675 | `v_install_unified` | 설치 1행 | 675 | 일치 |
| 설치 distinct | `analytics_install_profile.install_key` | 설치 1행 | 675 | `COUNT(DISTINCT installKey)` | 설치 1행 | 675 | 일치 |
| 첫 실행 표본 | `events WHERE event='app:first_run'` | clientId 1개 | 13 | `v_install_unified WHERE firstRunAt IS NOT NULL` | 설치 1행 | 644 | 불일치가 정상 경고 |

재현 쿼리는 `buildInstallUnifiedParitySql()` 이 만든다. 테스트는 `v3/functions/src/adminInstallUnified.test.ts` 에서 이 쿼리가 설치축만 읽고 이벤트축을 설치축과 같다고 잠그지 않는지 확인한다.

## 화면 호출 대조 테스트

`marblo-web/src/app/[locale]/admin/AnalyticsPanel.test.tsx` 는 `AnalyticsPanel.tsx` 의 실제 `httpsCallable(fns, ...)` 호출에서 `getAdmin*` 이름을 추출하고, 이 문서의 `## 화면 호출 분류표` 집합과 비교한다.

규칙:

- `getAdminCallableManifest` 는 배포 메타라 제외한다.
- 주석이나 상수 선언만으로는 화면 호출로 보지 않는다.
- 분류표에 있는 이름과 화면 호출 이름이 갈리면 `npm test` 가 실패해야 한다.
