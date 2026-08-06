# GA4 풀 태깅 가이드 — marblo-web

> marblo-web(Next.js 16 App Router)에 적용된 GA4 이벤트 일람표와, GA4 콘솔에서 측정ID 주입·전환(Key Event) 마킹·검증하는 절차를 정리합니다.
> 사용자가 GA4 속성을 만들고 `NEXT_PUBLIC_GA4_MEASUREMENT_ID` 환경변수만 채우면 모든 이벤트가 자동 수집됩니다. 환경변수가 비어 있으면 스크립트 로드·모든 이벤트가 **no-op** 이라 빌드/런타임 에러가 없습니다.

---

## 1. 작동 흐름

```
사용자 → 페이지 진입 → GoogleAnalytics.tsx 가 gtag.js 로드
                  → NEXT_PUBLIC_GA4_MEASUREMENT_ID 있으면 추적 활성 + 자동 pageview
                  → 비어 있으면 스크립트 미로드 + 모든 sendEvent() no-op (안전)

사용자 → 전환 행동(구매/다운로드/베타신청) → 핸들러가 lib/gtag.ts 헬퍼 호출
                                        → window.gtag('event', ...) 전송
                                        → GA4 실시간/디버그 뷰에 즉시 반영
```

**핵심 파일**

- `src/lib/gtag.ts` — 모든 이벤트의 single source of truth (헬퍼 + no-op 폴백)
- `src/components/GoogleAnalytics.tsx` — gtag.js 로더 + App Router 자동 pageview (`usePathname`/`useSearchParams`)
- `src/app/[locale]/layout.tsx` — `<Suspense>` 로 감싼 `<GoogleAnalytics />` 마운트 지점

> App Router 주의: `GoogleAnalytics` 는 `useSearchParams()` 를 쓰므로 반드시 `<Suspense>` 로 감싸야 합니다(레이아웃에 이미 반영됨).

---

## 2. 이벤트 일람표

### 🎯 전환 (Key Event 로 마킹 — 2개)

> marblo-web 은 **실제 매출·리드만 전환**으로 카운트합니다. 결제 확정 성공·waitlist 문서 쓰기 성공 등 서버 확정 시점에만 발화(단순 클릭·검증 실패는 미포함).

| 이벤트명            | 설명                                              | 파라미터                                                                                                                                 | 발생 위치                                                                                                                                                                                                 |
| ------------------- | ------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **`purchase`**      | 강의·구독 결제 확정 성공 (GA4 표준 ecommerce)     | `transaction_id`, `value`, `currency`(KRW), `items` (`item_category`=`lecture`\|`subscription`, `item_id`=slug 또는 plan)               | `checkout/success/page.tsx` — 확정 성공 직후 1회. 강의(Toss orderId / PortOne paymentId), 구독(Toss authKey / PortOne issueId=`tx`). sessionStorage+ref 중복 가드. amount 없으면 발화 스킵(오값 방지) |
| **`generate_lead`** | 베타(파운더) 신청 폼 제출 성공                    | `lead_source`(home/promo_bar/foundation50_page), `locale`, `currency`, `value`                                                            | `components/BetaTester50SignupForm.tsx` — waitlist `addDoc` 성공 직후                                                                                                                                     |

**GA4 콘솔 설정:** 관리 → 데이터 표시 → 이벤트 → `purchase`·`generate_lead` 각각 **키 이벤트로 표시** ON. 그 외는 OFF 유지.

### 📊 퍼널·인게이지먼트 이벤트 (전환 아님 — 여정 분석용)

| 이벤트명             | 설명                                      | 파라미터                                                            | 발생 위치                                                              |
| -------------------- | ----------------------------------------- | ------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| `begin_checkout`     | 결제 요청(Toss) 직전 (GA4 표준 ecommerce) | `value`, `currency`, `checkout_type`(lecture/subscription), `items` | `checkout/page.tsx` — `requestPayment`/`requestBillingAuth` 직전       |
| `download`           | 데스크톱 앱 설치 파일 다운로드 클릭       | `os`(mac/win), `arch`, `app_version`                                | `download/page.tsx` — Mac/Windows `<a>` onClick (href 네비게이션 유지) |
| `click_pricing`      | 가격/구독 CTA 클릭                        | `cta_location`                                                      | 헬퍼 제공 (필요 시 부착)                                               |
| `click_lecture`      | 강의 상세/구매 CTA 클릭                   | `lecture_slug`, `cta_location`                                      | 헬퍼 제공                                                              |
| `click_download_cta` | 다운로드 페이지로 향하는 CTA              | `cta_location`                                                      | 헬퍼 제공                                                              |
| `view_demo`          | 데모 영상 재생                            | `demo_type`                                                         | 헬퍼 제공                                                              |
| `click_outbound`     | 외부 링크(문서/GitHub/Discord) 클릭       | `outbound_url`, `cta_location`                                      | 헬퍼 제공                                                              |
| `lang_toggle`        | 언어 전환 (KO↔EN↔JA)                      | `from_lang`, `to_lang`                                              | 헬퍼 제공                                                              |
| `sign_up` / `login`  | 가입/로그인 완료 (GA4 권장 이벤트명)      | `method`                                                            | 헬퍼 제공                                                              |

> `click_*`/`view_*` 헬퍼는 `lib/gtag.ts` 에 정의돼 있고, 해당 CTA 컴포넌트에 `onClick` 으로 부착하면 즉시 수집됩니다(후속 작업).

### ⚙️ GA4 자동 수집 (향상된 측정 ON)

코드 변경 없이 콘솔에서 켜면 자동 수집: `page_view`(본 태깅의 pageview 와 별개로 GA4 기본), `scroll`, `click`(outbound), `file_download`, `video_*`, `site_search`.

---

## 3. GA4 설정 절차 (사용자가 직접 — 코드 아님)

### 3-1. 속성/데이터 스트림 생성

1. https://analytics.google.com → 관리 → 속성 만들기 (시간대 대한민국 / 통화 KRW)
2. 데이터 수집 → 웹 → URL `https://marblo.app` → 데이터 스트림 생성
3. 측정 ID(`G-XXXXXXXXXX`) 복사

### 3-2. 환경변수 주입

- **로컬:** `.env.local` 에 `NEXT_PUBLIC_GA4_MEASUREMENT_ID=G-XXXXXXXXXX`
- **배포(Vercel 등):** 프로젝트 → Settings → Environment Variables 에 동일 키 추가 → 재배포

> `.env.example` 에 자리(placeholder)만 있고 값은 비어 있습니다. `.env.local` 은 커밋되지 않습니다(gitignore).

### 3-3. 향상된 측정 ON

데이터 스트림 설정 → 향상된 측정 → 페이지 조회수/스크롤/이탈 클릭/동영상/파일 다운로드 ON.

### 3-4. 키 이벤트 마킹 (전환)

배포 후 이벤트가 GA4에 처음 등장하면(수 시간~48h):

1. 관리 → 데이터 표시 → 이벤트
2. **`purchase`** 와 **`generate_lead`** → **키 이벤트로 표시** ON
3. 그 외는 OFF 유지

### 3-5. 검증

- **디버그 뷰(실시간):** GA4 → 관리 → 디버그 뷰. 로컬은 [GA Debugger] 확장 또는 `?_dbg=1`.
- **실시간 보고서:** GA4 → 보고서 → 실시간. 구매/다운로드/신청 후 30초 내 카운트 확인.
- 브라우저 콘솔에서 `typeof window.gtag === 'function'` 및 `window.dataLayer` 확인.

---

## 4. 프라이버시 규약 (PIPA)

- 이벤트 payload 에 **이메일·이름·전화 등 PII 절대 금지**. `orderId`·금액·`os`/`arch`·`locale`·`source` 같은 **비식별 값만**.
- `purchase` 의 `transaction_id` 는 주문 ID(비식별), `items` 는 강의 slug/제목만.
- `generate_lead` 는 신청자의 이메일을 넣지 않고 `lead_source`/`locale` 만 전송.

---

## 5. 새 이벤트 추가 절차 (개발자용)

```ts
// src/lib/gtag.ts
export function trackNewEvent(label: string, location: string) {
  sendEvent("event_name_snake_case", { label, cta_location: location });
}
```

```tsx
import { trackNewEvent } from "@/lib/gtag";
<button onClick={() => trackNewEvent("value", "page-section")} />;
```

추가 후 본 문서 §2 표에 반드시 등재 (Key Event 마킹 누락 방지).

---

## 6. 명명 규칙 (GA4 베스트 프랙티스)

- **snake_case** 만, 동사 우선(`click_*`/`view_*`/`generate_*`), 이벤트명 ≤ 40자, 파라미터 키 ≤ 40자·값 ≤ 100자.
- 가능하면 GA4 권장 이벤트명 사용: `purchase`, `begin_checkout`, `generate_lead`, `sign_up`, `login`, `view_item`.
- 목록: https://support.google.com/analytics/answer/9267735

---

## 7. 트러블슈팅

- **이벤트 안 나타남:** env 등록·재배포 확인, 광고 차단기 확인, `window.gtag` 정의 확인.
- **디버그 뷰엔 보이는데 보고서엔 없음:** 표준 보고서는 24–48h 지연. 실시간/디버그 뷰로 확인.
- **키 이벤트로 안 잡힘:** §3-4 수동 마킹 필요(자동 아님).

---

## 8. 참고 자료

- [GA4 권장 이벤트](https://support.google.com/analytics/answer/9267735)
- [GA4 ecommerce (purchase/begin_checkout)](https://developers.google.com/analytics/devguides/collection/ga4/ecommerce)
- [gtag.js 레퍼런스](https://developers.google.com/tag-platform/gtagjs/reference)
