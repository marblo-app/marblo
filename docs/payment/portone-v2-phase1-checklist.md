# PortOne V2 Phase1 Test Checklist

Phase1 scope: PortOne V2 test-mode wiring only. Toss remains in place and is not removed.

## Architecture Decision

- Provider abstraction: `paymentProvider` now supports `toss | paddle | portone`.
- Current subscription materialization remains `subscriptions/{uid}`.
- Payment ledger remains append-only by convention: PortOne writes use `billingCharges/portone_{paymentId}` and never trust client amount/status.
- Idempotency key: PortOne `paymentId` is the provider-side idempotency key; Firestore claim doc is `portone_{paymentId}`.
- Server verification: client sends `paymentId` or `billingKey`; Cloud Functions query or charge through PortOne V2, then validate `payment.id`, `payment.storeId`, `payment.status === "PAID"`, `payment.amount.total`, and `payment.currency`.

## Required Console Values

Obtain these from the owner PortOne console before real E2E:

- `PORTONE_STORE_ID`
- `PORTONE_API_SECRET` for V2 REST API
- `PORTONE_INICIS_ONETIME_CHANNEL_KEY` for KG Inicis `INIpayTest`
- `PORTONE_INICIS_BILLING_CHANNEL_KEY` for KG Inicis `INIBillTst`

Client-side opt-in:

- `NEXT_PUBLIC_PAYMENT_PROVIDER=portone`, or append `provider=portone` to checkout URLs during testing.

## PortOne Console Setup

- Create or select the Marblo store and copy Store ID.
- Payment integration > channel management > test integration > KG Inicis.
- Add general payment channel with PG MID `INIpayTest`; copy its channel key.
- Add billing-key channel with PG MID `INIBillTst`; copy its channel key.
- Payment integration > API Keys > V2 API: issue an API secret for server verification.
- Configure allowed redirect/origin URLs for the staging or local web checkout host.

## Test Flow

- Subscription: `/checkout?plan=pro&billing=monthly&provider=portone`
  - Browser SDK calls `requestIssueBillingKey`.
  - Cloud Function `completePortOneBillingKey` charges first cycle through PortOne billing-key API.
  - Function verifies PortOne payment response before writing `subscriptions/{uid}`.
- One-time: payment SDK calls `requestPayment`; `completePortOnePayment` verifies `paymentId` through `GET /payments/{paymentId}` before materializing access.

## Out Of Scope

- Production PortOne activation.
- Card-company review or KG Inicis production contract.
- Toss removal or Toss cron migration.
- PortOne recurring renewal cron beyond first billing-key charge.
