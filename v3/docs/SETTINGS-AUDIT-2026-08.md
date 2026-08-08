# Settings 페이지 전면 감사 (2026-08-08)

티켓 `8lYqKIYjKZlZCczg3bGU`. 이번 세션의 대량 변경(autoselect · grok · 비기너 셸 ·
권한 버그 수리) 이후 설정 화면이 현행과 얼마나 어긋났는지 전 탭을 훑고, 각 탭을
**작동 / 스테일 / 중복 / 깨짐** 으로 판정한 기록이다.

관련 티켓 — 여기서 **건드리지 않은** 것:

- 모델 프리셋 개편: `mzHNVsHVW78` (같은 `SettingsPage.tsx` 를 병렬 편집 중)
- 비기너 UI 폴리시: `wQL3`

---

## 1. 탭별 판정

| 탭              | 판정                | 근거                                                                                     | 이번 PR 조치        |
| --------------- | ------------------- | ---------------------------------------------------------------------------------------- | ------------------- |
| Profile         | 작동                | 계정 표시 + 비기너/워크스페이스 토글. 토글 둘 다 `flex-shrink-0` 있어 정상               | 유지                |
| Admin Analytics | **깨짐(오판)**      | 백엔드 정상인데 UI 가 `includeAdmin` 미전달 → 전 지표 0. 게다가 비어드민에게도 탭 노출   | **수리**            |
| Agent Models    | 작동 + **부분중복** | 오케 하네스·프리셋은 정상. "구독제 플랜 등록" 이 #853 자동감지와 축이 겹침               | **강등 + 자동감지** |
| Billing         | **스테일(P1)**      | 인앱 Toss/Paddle 체크아웃이 존재하지 않는 라우트로 리다이렉트. 현행 결제선은 PortOne(웹) | 문서화(별도 티켓)   |
| Team            | 작동                | `TeamManagement` 공유 + 프로젝트 탭 포인터. 의도된 재사용                                | 유지                |
| Privacy         | **깨짐**            | 토글 `flex-shrink-0` 누락 → 좁은 창에서 노브가 트랙 밖으로. 팔레트도 이 탭만 catppuccin  | **수리**            |
| Language        | 작동                | ko/en 즉시 반영                                                                          | 유지                |
| Report a Bug    | 작동(중복은 의도)   | 헤더 전역 버튼과 같은 `BugReportModal` 재사용 — 트리거만 둘                              | 유지                |
| API Keys        | 작동 + 문구 스테일  | BYOK 저장·마스킹 정상. 설명의 모델명이 구세대                                            | **문구 현행화**     |

추가: 탭이 9개라 좁은 창에서 라벨이 눌렸다 → 가로 스크롤로 전환.

---

## 2. Admin Analytics — "작동 안 함" 의 진범

### 2.1 아니었던 것 (전부 실측으로 배제)

| 의심             | 실측 결과                                                             |
| ---------------- | --------------------------------------------------------------------- |
| 함수 미배포      | `getAdminRetentionCohorts` / `getAdminActiveUserMetrics` 둘 다 ACTIVE |
| 반쪽 배포(IAM)   | 둘 다 `roles/cloudfunctions.invoker: allUsers` 바인딩 있음            |
| 리전 불일치      | 클라 `us-central1` = 배포 리전                                        |
| 호출 자체가 실패 | Cloud Logging: 2026-08-08 01:22 호출 **200**, `auth: VALID`           |

즉 **백엔드는 멀쩡했다.**

### 2.2 진범 (2겹)

**(1) UI 가 `includeAdmin` 을 한 번도 안 보냈다.**
`AdminAnalyticsPanel` 은 `{ days: 30 }` 만 보냈고, 백엔드는 처음부터
`parseIncludeAdmin(data)` 로 이 파라미터를 받고 있었다. 기본값은 "어드민 제외" 다.

BQ 실측 — 최근 65일 clean account activity:

| user 접두 | rows    | active days | last active |
| --------- | ------- | ----------- | ----------- |
| RSAL…     | 194,294 | 46          | 2026-08-08  |
| Y6TG…     | 94      | 2           | 2026-07-31  |
| QxW5…     | 4       | 1           | 2026-07-21  |
| 03BR…     | 3       | 1           | 2026-08-01  |

압도적 1위가 ADMIN_UID 다. 그를 빼면 **DAU 0 · WAU 0 · MAU 3 · 코호트 사실상 빈칸**.
화면은 정상 동작한 결과를 그렸을 뿐인데, 사람 눈엔 "고장" 으로 보였다.

**(2) 탭이 전 유저에게 노출됐다.**
클라이언트 어드민 게이트가 없어, 비어드민은 `requireAdmin` 의 `permission-denied`
를 빨간 에러 카드로 받았다.

### 2.3 조치

- `days`(7/30/90) · `includeAdmin` 스위치를 UI 에 노출 — 백엔드 계약은 그대로.
- `adminExcluded.applied` 를 화면에 명시하고, 전 지표 0 일 때 **왜 0 인지** 적는다.
- `permission-denied` **만** 확정 신호로 보고 `adminAccessStore` 에 uid 별 캐시 →
  다음 실행부터 탭이 사라진다. 판정 전(unknown)은 **보이는 쪽**이 기본이다(미리
  숨기면 진짜 어드민이 탭을 못 찾는 닭-달걀). 네트워크/내부 오류는 숨김 사유가 아니다.
- 나머지 어드민 지표는 marblo-web `/admin` 이 진짜 뷰이므로 패널 헤더에 교차링크.

### 2.4 중복이 아니라는 판정

marblo-web `AnalyticsPanel` 이 가진 것: Drilldown · BusinessSummary · UsageSummary ·
ModelSummary · OnboardingFunnel · KpiCockpit · ReleaseHealth · BetaSegmentUsage.
**없는 것**: `getAdminRetentionCohorts` · `getAdminActiveUserMetrics` — 이 둘은
Electron Settings 에만 있다. 그래서 이 탭은 삭제 대상이 아니라 **수리 + 교차링크**다.

---

## 3. "구독제 플랜 등록" vs #853 자동감지 — 부분 중복, 제거 아니라 강등

### 3.1 두 축은 같은 것을 재지 않는다

| 질문                        | #853 `getAccountRateLimits` | 수동 `subscription-plans.json` |
| --------------------------- | --------------------------- | ------------------------------ |
| 이 하네스가 구독제인가?     | ✅ `planType` 실측          | 중복                           |
| 한도를 얼마나 썼나?         | ✅ 창별 %                   | ❌                             |
| **월정액 금액(USD)은?**     | ❌ CLI 가 안 알려줌         | ✅ 유일한 소스                 |
| claude / gpt / grok 외 벤더 | ❌ 프로브 없음              | ✅ 선언만이 유일한 길          |

마지막 줄의 근거는 `lib/vendorBilling.ts` 의 1차 문서 조사다 — zai · minimax 는
잔액/쿼터 **공개 API 자체가 없다**.

### 3.2 삭제하면 안 되는 이유

`~/.marblo/subscription-plans.json` 은 죽은 설정이 아니라 두 곳에 라이브로 물려 있다:

- `cost-tracker.findPricing` — 정액 vs 토큰 단가를 가른다.
- `dispatch-scoring.costEfficiencyScore` — 등록된 모델은 **cost-eff MAX** 를 받아
  오토셀렉트를 편향시킨다.

UI 를 지우면 **이미 등록해 둔 항목을 지울 방법이 사라진다**. 오래된 잘못된 등록이
라우팅을 계속 왜곡하는데 손댈 수 없는 상태가 최악이다.

### 3.3 결론 — 강등

- 섹션 제목을 "구독제 플랜 등록" → "구독제 과금" 으로 바꾸고,
- 맨 위에 **자동 감지 결과**(claude / gpt / grok 의 planType + 소진율)를 먼저 보여 주고,
- 수동 입력칸은 `<details>` 로 접어 "월정액 금액 등록 (고급)" 으로 내렸다.
  이미 등록된 항목이 있으면 열린 채로 렌더한다(숨겨서 못 지우는 일 방지).

---

## 4. Privacy 토글 깨짐

`PrivacySettings` 토글 버튼에 `flex-shrink-0` 이 없었다. 형제 라벨이
`flex-1`(basis 0) 이라 축소분을 **버튼이 전부 흡수**하는데, 노브는 `absolute` 고정폭
16px 이라 같이 줄지 않는다 → 트랙만 찌그러지고 노브가 밖으로 튀어나온다("핀 나감").
`SettingsPage` 의 다른 토글 둘은 이미 `flex-shrink-0` 을 갖고 있었다.

함께 정리한 것:

- `aria-pressed` → `role="switch"` + `aria-checked` + `aria-label` (다른 토글과 일치).
- ON 위치 `translate-x-4`(16px) → `translate-x-[18px]` — w-9 트랙 · w-4 노브에서
  좌우 여백이 2px 로 대칭이 된다.
- 이 탭만 쓰던 catppuccin 하드코딩 hex 를 설정 전체가 쓰는 gray/blue/amber 토큰으로 통일.

---

## 5. 비기너 모드 진입 발견성

되돌아갈 문이 **설정 › 프로필 안쪽 토글 하나뿐**이었다. 승격은 비기너 상단바 버튼
한 번(#857)인데 복귀가 3단계면 사실상 한 방향 문이다.

조치: `Header` 우측(버그리포트·Activity 옆)에 "간단 모드" 버튼 추가.
`beginnerModeStore.revertToBeginner` 를 그대로 재사용한다 — 새 상태 축을 만들지
않는다. Header 는 Layout · WorkspaceShell · pre-project 브랜치 전부에 마운트되는
유일한 공통 상단이라 어떤 화면에서든 보인다.

---

## 6. 이번 PR 범위 밖 — 후속 티켓 후보

### P1. Settings › Billing 인앱 체크아웃이 막다른 길

- `BillingPage` 는 Toss SDK 를 직접 띄우고 `successUrl` 을
  `${window.location.origin}/settings/billing?toss_success=true` 로 준다.
- **v3 에는 라우터가 없다.** 패키지 빌드에서 origin 은 `file://` 이라
  `file:///settings/billing` 은 그냥 죽는 경로다. (`billingService` 의 Paddle
  successUrl 도 같은 모양이다.)
- 한편 현행 결제선은 #862 의 PortOne 간편결제(EASY_PAY) 정기결제이고, 그 배선은
  **marblo-web `/checkout` 에만** 있다(`getPortOneCheckoutConfig` ·
  `createPortOnePaymentIntent` · `completePortOneBillingKey`).
- 선택지: (a) 인앱 결제를 marblo.app 체크아웃 외부 링크로 대체, (b) 앱에도 PortOne
  배선을 복제. **매출 경로라 제품 판단이 필요해 여기서 임의로 바꾸지 않았다.**

### P2. API Keys 탭 i18n 미적용

`APIKeysSettings` 는 문자열이 전부 하드코딩 영어다(설정 탭 중 유일). 이번엔 스테일
모델명만 현행화했고, 네임스페이스 분리는 별도 작업.

### P3. Admin Analytics 어드민 판정의 정식화

지금은 "서버가 거절했다" 는 관측을 캐시하는 방식이다. 정석은 custom claim(예:
`admin: true`)을 ID 토큰에 실어 클라가 렌더 전에 아는 것 — 백엔드 작업이라 분리.
