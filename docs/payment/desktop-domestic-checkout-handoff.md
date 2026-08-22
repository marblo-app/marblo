# 데스크톱 국내 결제 — 인앱 SDK 를 버리고 웹 체크아웃으로 넘긴 이유

티켓 `ZVg1OC3CnscUWlrllTP5`. 대상은 데스크톱 앱(`v3/src`)의 **화면**뿐이다.
서버·웹의 포트원 배선(`v3/functions/src/portone.ts`, `marblo-web /checkout`,
웹훅·검증·원장 적재)과 Paddle 경로는 이 작업에서 **한 줄도 건드리지 않았다.**

## 무엇이 잘못돼 있었나 (실측)

`v3/src/components/settings/BillingPage.tsx` 가 토스페이먼츠 SDK 를 렌더러에
직접 임베드하고 있었다:

```js
await loadTossPaymentsSDK();                       // js.tosspayments.com/v2/standard
window.TossPayments!(import.meta.env.VITE_TOSS_CLIENT_KEY)
payment.requestPayment({
  successUrl: `${window.location.origin}/settings/billing?toss_success=true`,
  failUrl:    `${window.location.origin}/settings/billing?toss_fail=true`,
})
```

**`window.location.origin` 이 Electron 에서는 앱 자신의 로더다** — 패키징 빌드는
`file://`, 개발 빌드는 `127.0.0.1:5173`. PG 가 거기로 리다이렉트해도 결제 결과가
앱 화면으로 돌아오지 않는다. 웹 기준으로 짜인 코드가 데스크톱에 그대로 들어와
있었던 것이고, 국내 결제수단 4종(`card_kr`·`naverpay`·`kakaopay`·`tosspay`)이
전부 이 경로에 걸려 있었다.

## 왜 포트원 SDK 로 갈아끼우지 않았나

★**갈아끼워도 같은 함정이다.** 문제는 결제사가 토스냐 포트원이냐가 아니라,
**결제가 리다이렉트·3DS 인증·PG 팝업을 탄다**는 사실이다. 그걸 Electron 렌더러
안에서 감당하려면 특수 케이스가 계속 붙는다 — 창 열기 정책, 외부 링크 핸들러
예외(`isInternalNavigationUrl`), 인증 창의 세션 쿠키, 복귀 딥링크.

★그리고 결정적인 것: **웹 체크아웃은 이미 있고, 포트원 이니시스 심사와 실제
테스트 결제를 완주한 유일한 경로다.** 앱에 두 번째 결제 구현을 두면 둘 중
하나만 고쳐지는 상태가 반드시 온다. 결제에서 그건 "화면이 안 맞는다"가 아니라
"돈이 안 맞는다"로 끝난다.

→ **앱은 결제를 하지 않는다. 결제로 데려다줄 뿐이다.**

## 어떻게 바꿨나

```
[데스크톱] 플랜 카드 → 업그레이드 → 결제수단
             ├─ 국내 결제(포트원)  → window.open(웹 체크아웃 URL, "_blank")
             │                        → main 의 setWindowOpenHandler 가
             │                          shell.openExternal 로 넘김(새 IPC 없음)
             └─ 해외 결제(Paddle) → 기존 그대로. 앱 안 오버레이 체크아웃.
```

URL 계약은 `v3/src/lib/checkoutLink.ts` 의 `buildWebCheckoutUrl()` 한 곳에만
있다(순수 함수 — `v3/tests/lib/checkoutLink.test.ts` 가 계약을 못박는다):

```
ko  →  https://marblo.app/checkout?plan={pro|team|team_plus}&provider=portone&billing=monthly
en  →  https://marblo.app/en/checkout?plan=...&provider=portone&billing=monthly
```

- ★`provider=portone` 을 **항상 명시한다.** 웹의 기본 결제사는 운영 env
  (`NEXT_PUBLIC_PAYMENT_PROVIDER`)가 정하는 값이라 앱이 알 수 없다. 명시하지
  않으면 앱 사용자가 토스 경로로 흘러들어갈 수 있다.
- `free`·`enterprise` 는 `null` 을 돌려준다 — 웹 가격표에 없어서 링크를 만들면
  금액 0 짜리 빈 결제창이 뜬다. enterprise 는 별도 협의(Contact Sales)다.
- 로케일 접두사는 웹 `routing.ts` 규약(`localePrefix: "as-needed"`,
  `defaultLocale: "ko"`)을 따른다 — **ko 는 접두사를 떼고** en 만 `/en` 을 붙인다.
  `/ko/checkout` 도 301 로 살아나고 쿼리도 보존되지만(실측), 결제 진입에
  리다이렉트 한 번을 공짜로 얹을 이유가 없다.
- 앱 오리진(`file://`, `127.0.0.1`)이 URL 에 실리는 자리가 **없다.** 복귀는
  리다이렉트가 아니라 구독 문서로 온다(아래).

## 결제 후 상태 갱신 — 폴링을 새로 만들지 않았다

`BillingPage` 는 이미 `subscribeToSubscription()`(Firestore `onSnapshot`)을 걸고
있다. 서버가 결제를 검증하고 `subscriptions/{uid}` 를 쓰는 순간 앱에 도착한다.
**새 폴링 루프를 만드는 건 이미 있는 실시간 경로 위에 두 번째 진실을 얹는 것**이라
하지 않았다.

브라우저를 다녀오는 동안 렌더러가 백그라운드로 눌려 스냅샷이 늦을 수 있으므로
보조 장치만 덧댔다:

- **창 포커스 복귀 / `visibilitychange`** 시 `getSubscription()` 1회 재조회.
  대기 중일 때만 붙고, 대기가 끝나면 리스너를 뗀다.
- **수동 "결제 상태 새로고침"** 버튼.
- **"결제창 다시 열기"** — 결제창을 실수로 닫는 일이 흔하다.

★대기 안내를 접는 판정 기준은 앱의 추측("결제창을 열었으니 됐겠지")이 아니라
**서버가 쓴 구독 문서**다. 앱은 결제 결과를 직접 관측하지 못하므로 그것만이
믿을 수 있는 신호다.

## 지운 것 / 남긴 것

지웠다 (데스크톱 화면 한정):

- `loadTossPaymentsSDK()` · `window.TossPayments` 타입 선언 · `VITE_TOSS_CLIENT_KEY`
  사용처 — `v3` 전체에 토스 SDK 참조가 0건이 됐다.
- `createTossCheckout` / `confirmTossPayment` **호출부**(import 포함).
  서비스 쪽 함수 자체는 형제 티켓 `eaFlha8f` 소관이라 손대지 않았다.
- `?toss_success=true` 리다이렉트 콜백 `useEffect` — Electron 에서 애초에
  도달하지 않는 코드였다.
- 결제수단 4종과 그 i18n 라벨(`billing.data.method.{cardKr,naverpay,kakaopay,tosspay}`).

★남겼다:

- `billing.data.provider.toss`("토스페이먼츠") — **기존 토스 구독자의 결제사
  표시에 아직 쓴다.** 지우면 과거 결제자의 화면이 깨진다.
- `cancelSubscription` 단일 해지 경로(toss/portone/paddle 서버 분기) — 그대로.
- Paddle 전 경로 — 그대로. 오버레이 체크아웃이라 리다이렉트를 타지 않는다.

## `filterAvailablePaymentMethods()` 를 왜 호출하지 않았나

형제 티켓 `eaFlha8f`(PR #1129)이 `billingService.ts` 에 만들어 둔 함수다.
`provider !== "toss"` 인 항목만 통과시킨다.

이 화면은 **provider `"toss"` 항목을 목록에서 아예 삭제**했다 — 가린 게 아니라
없앴다. 남은 목록은 `portone`·`paddle` 둘뿐이라 그 필터는 항등함수가 된다.
정책이 중복되지 않으므로 같은 함수를 새로 만들지도, 억지로 끼워 넣지도 않았다.
(작업 시점에 #1129 는 아직 main 에 머지되지 않아 import 하면 타입체크가 깨지는
사정도 있었다.)

## ★인수인계 — 이 티켓 범위 밖에서 발견한 것

`marblo-web/src/app/[locale]/checkout/page.tsx:237` — 비로그인 상태로 체크아웃에
들어오면 로그인으로 튕기는데, 돌아올 경로를 `/checkout?plan=${plan}` 으로만
만든다. **`provider`·`billing` 파라미터가 사라진다.**

영향: 데스크톱이 `provider=portone` 을 명시해 보내도, 그 브라우저가 웹에 로그인돼
있지 않으면 로그인 후 provider 가 날아가 웹 기본값으로 떨어진다. #1129 가 그
기본값을 `portone` 으로 바꾸므로 머지 후에는 실질 위험이 사라지지만, 로그인
리다이렉트가 쿼리를 통째로 보존하도록 고치는 게 맞다.

★`/checkout` 은 이 티켓의 절대 경계라 **고치지 않고 보고만 한다.** 웹 티켓으로
분리해야 한다.

## 검증

- `npx tsc --noEmit` (renderer) · `tsc -p electron/tsconfig.json --noEmit` — 0 에러
- `v3/tests/lib/checkoutLink.test.ts` — URL 계약 8건
- `v3/tests/unit/billing-web-checkout.test.ts` — 화면 배선 9건
  (토스 4종 부재 / 브라우저 핸드오프 / 구독 문서 기반 완료 판정 / 포커스 재조회 /
  다시 열기 / ★Paddle 회귀 0)
- `v3/tests/unit/billing-cancel-modal-render.test.ts` — 기존 해지 경로 회귀 0
- eslint 클린
