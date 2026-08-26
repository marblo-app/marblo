# Paddle USD Wiring Diagnosis (2026-08-26)

Task: `oPjeFL5kfATWvDgvB1Ny`

Scope: static measurement only. No Electron, browser, Playwright, screenshot, or live payment verification was run.

## Evidence Table

| Question | Answer | Evidence |
| --- | --- | --- |
| Paddle 코드가 어디까지 배선돼 있나 | App(v3) renderer has a Paddle.js loader, checkout opener, and cancel callable wrapper. The settings billing UI exposes a Paddle payment method and passes `user.uid`, `priceId`, and email into `openPaddleCheckout`. Server side has Paddle API config constants, price-id-to-plan mapping, cancel callable, webhook handler, signature verification, and reconciliation scaffolding. | `v3/src/services/billingService.ts:101`, `v3/src/services/billingService.ts:127`, `v3/src/services/billingService.ts:150`, `v3/src/components/settings/BillingPage.tsx:114`, `v3/src/components/settings/BillingPage.tsx:145`, `v3/src/components/settings/BillingPage.tsx:301`, `v3/functions/src/index.ts:851`, `v3/functions/src/index.ts:941`, `v3/functions/src/index.ts:952`, `v3/functions/src/index.ts:1005`, `v3/functions/src/webhookVerify.ts:99`, `v3/functions/src/reconciliation.ts:226` |
| 실제로 호출되는 경로가 있나, 죽은 코드인가 | `openPaddleCheckout` is not dead: there is one real app UI caller in `BillingPage`. `loadPaddleSDK` is only reached through that function. The old `cancelPaddleSubscription` wrapper is not used by the current UI; current UI uses provider-neutral `cancelSubscription`. | `v3/src/components/settings/BillingPage.tsx:307`, `v3/src/services/billingService.ts:132`, `v3/src/components/settings/BillingPage.tsx:397`, `v3/src/services/billingService.ts:150`, `v3/src/services/billingService.ts:159`; call count command: `rg -n "openPaddleCheckout\\(|loadPaddleSDK\\(|cancelPaddleSubscription\\(|cancelSubscription\\(" v3/src` |
| 원래 알려진 Electron origin 함정이 지금도 있나 | Yes for the app-side Paddle checkout. `openPaddleCheckout` still sets `successUrl` from `window.location.origin`, which is exactly the Electron-origin pattern documented as broken for prior in-app payment redirects. The app UI comment says Paddle is left as an in-app overlay because it "does not ride redirect", but the service still provides a `successUrl`. | `v3/src/services/billingService.ts:139`, `v3/src/services/billingService.ts:142`, `v3/src/components/settings/BillingPage.tsx:4`, `v3/src/components/settings/BillingPage.tsx:26`, `v3/src/lib/checkoutLink.ts:8`, `v3/src/lib/checkoutLink.ts:20` |
| Paddle 이 웹(marblo-web)에도 배선돼 있나, 앱(v3)만인가 | Checkout is app-only for Paddle. `marblo-web` has admin/subscription display references to Paddle but no Paddle checkout path. Web checkout provider type is only `toss | portone`, defaults to PortOne, and the checkout page preloads PortOne or legacy Toss SDK, not Paddle. | `marblo-web/src/lib/paymentProvider.ts:1`, `marblo-web/src/lib/paymentProvider.ts:18`, `marblo-web/src/app/[locale]/checkout/page.tsx:140`, `marblo-web/src/app/[locale]/checkout/page.tsx:353`, `marblo-web/src/app/[locale]/checkout/page.tsx:586`; search result: `rg -n "Paddle|paddle|PADDLE" marblo-web/src` shows no checkout SDK/open path |
| Paddle 계정·상품·가격이 설정돼 있나 | Code expects the keys, but actual deployed Paddle account/product/price values were not verified. Local example env has app-side Paddle keys only; `marblo-web` env files have no Paddle keys. Server code expects Functions env keys for API/webhook/price mapping. Product coverage is incomplete for current plan set: app and server map Pro/Team only; no `team_plus` Paddle price id is wired. Values were not printed. | `v3/.env.example` key-only parse: `VITE_PADDLE_CLIENT_TOKEN`, `VITE_PADDLE_ENVIRONMENT`, `VITE_PADDLE_PRO_PRICE_ID`, `VITE_PADDLE_TEAM_PRICE_ID`; `marblo-web/.env.production` key-only parse: no Paddle keys; `marblo-web/.env.example` key-only parse: no Paddle keys; `v3/src/components/settings/BillingPage.tsx:115`, `v3/functions/src/index.ts:851`, `v3/functions/src/index.ts:942`, `v3/PRODUCTION_SETUP.md:93` |
| Cloud Functions 쪽 Paddle 웹훅·검증이 있나 | Yes. There is `paddleWebhook`, it requires POST, validates `paddle-signature` with `verifyPaddleSignature`, handles created/activated/updated/canceled/payment_failed events, and writes/updates `subscriptions`. Verification uses HMAC over raw body. | `v3/functions/src/index.ts:1005`, `v3/functions/src/index.ts:1013`, `v3/functions/src/index.ts:1021`, `v3/functions/src/index.ts:1040`, `v3/functions/src/index.ts:1060`, `v3/functions/src/index.ts:1101`, `v3/functions/src/index.ts:1121`, `v3/functions/src/webhookVerify.ts:96` |
| 구독 상태가 Paddle 과 포트원 중 어디를 정본으로 보나 | Firestore `subscriptions/{userId}` is the app/web entitlement source of truth. Paddle and PortOne both converge by writing `paymentProvider` plus provider-specific ids into the same subscription document. The app listens to `subscriptions` with `subscribeToSubscription`; server entitlement/cancel logic reads that same doc. | `v3/src/services/billingService.ts:12`, `v3/src/services/billingService.ts:65`, `v3/src/App.tsx:296`, `v3/src/components/settings/BillingPage.tsx:211`, `v3/functions/src/index.ts:1040`, `v3/functions/src/index.ts:2485`, `v3/src/types/subscription.ts:12`, `v3/src/types/subscription.ts:17` |

## Web vs App Judgment

| Surface | Current state | Judgment |
| --- | --- | --- |
| Web `marblo-web /checkout` | Real payment route is PortOne/KG Inicis, KRW-only. The SDK type and GA4 events use `currency: "KRW"`, and provider resolution does not include Paddle. | USD overseas payment path must be newly built or explicitly routed elsewhere. Current web checkout cannot charge USD. |
| App `v3 Settings > Billing` | Paddle option exists and can call `openPaddleCheckout`, but it is an in-app Electron overlay with `successUrl` based on Electron `window.location.origin`. | Existing code is only a partial app-side prototype. It still carries the known Electron-origin risk and should not be treated as production-ready USD checkout. |
| Server/entitlement | Paddle webhook/cancel/status writes exist and converge into `subscriptions`, same as PortOne. | Backend foundation partially exists, but live correctness depends on real Paddle env/product setup and end-to-end webhook delivery that was not verified here. |

## What Remains To Open Overseas USD Payment

| Item | Bucket | Size | Notes |
| --- | --- | --- | --- |
| Preserve domestic PortOne/KRW path | Already done | None | Do not touch; app already links domestic payment to web checkout with `provider=portone`. |
| Firestore subscription SoT after payment | Already done | Small/no-op | Both Paddle and PortOne write `subscriptions/{userId}`. Entitlement reader path already listens to that doc. |
| Paddle webhook signature verification and basic event handling | Already done | Small/no-op, pending live config | Static code exists. Live webhook endpoint registration and deployed secrets were not confirmed. |
| App Paddle checkout origin handling | Small repair if keeping app checkout; otherwise avoid | Small to medium | The direct issue is `successUrl: window.location.origin`. A small code repair could remove/replace the bad successUrl, but Electron in-app payment still has session/overlay risk. |
| Paddle product/price mapping for current plans and USD 19 | Small repair to medium setup | Small code, external dashboard work | Code maps only Pro/Team and current app display still has old USD amounts. Actual Paddle dashboard price ids were not verified. `team_plus` is missing from app/server Paddle maps. |
| Web USD checkout route | Newly build | Medium to large | `marblo-web` checkout has no Paddle provider type, no Paddle SDK, no USD amount model, and no server create/complete flow for web Paddle. This is the likely path if overseas users should pay in a browser instead of inside Electron. |
| Payment decision: Paddle vs Stripe vs defer | Product decision needed | Non-code decision | The repo can support building either path, but this ticket does not decide or implement that route. |

## Verification

- Static search only: `rg -n "openPaddleCheckout|loadPaddleSDK|cancelPaddleSubscription|PADDLE|paddle" v3/src v3/functions/src marblo-web/src`.
- Line inspection only with `nl -ba` for the files cited above.
- Env/key inspection printed key names only, never values.
- Existing focused test evidence inspected: `v3/tests/unit/billing-web-checkout.test.ts` asserts domestic web checkout opens `provider=portone` and Paddle remains in-app overlay.
- No GUI, Electron, browser, Playwright, screenshot, or live payment verification was run.
