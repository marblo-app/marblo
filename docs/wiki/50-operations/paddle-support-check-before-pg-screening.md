---
title: 새 결제수단·새 나라는 국내 PG 심사를 시작하기 전에 Paddle 지원부터 확인한다
tags: [domain/operations, topic/payments, method/source-link, method/web-measure, verdict/adopt]
status: verified
date: 2026-08-31
links: [[jpy-anchors-to-competitors-not-krw]], [[payment-live-key-pg-env-bundle]], [[human-only-ops-backlog]]
---

# 새 결제수단·새 나라는 국내 PG 심사를 시작하기 전에 Paddle 지원부터 확인한다

> **한 줄 판정**: ★채택 — 판정은 "Paddle 이 답이다"가 **아니라 "순서가 틀렸다"**다. KakaoPay · Korean local cards · Naver Pay 는 셋 다 Paddle 에서 **KR/KRW · 정기결제(Subscriptions) 지원**이고 원문이 **"No configuration required."** / **"You don't need to set up a bank account in South Korea."** 다(2026-08-27 공식문서 실측). 같은 기간 우리는 토스페이 가맹 심사 **3회 반려** 후 재접수를 준비하고 있었다. 다만 반대급부가 두 개다 — 실효 수수료가 **국내 PG 의 2.0~2.2배**(Paddle 5% + $0.50 → 우리 가격에서 **5.2~7.6%** vs 국내 빌링 **3.19~3.55%**, VAT 포함 환산), 그리고 Paddle 은 **해외 MoR** 이라 그 거래의 **세금계산서·현금영수증을 우리가 발행하는 구조가 성립하지 않는다** → 한국 법인 상대 판매에는 국내 PG 가 그대로 남는다. ★그래서 **지금 안 엎는다.** 바꾸는 것은 **조사 순서 한 줄**뿐이다.

## 무엇을 물었나

결제수단이나 판매국을 새로 열 때, 우리는 매번 국내 PG 계약·입점심사·카드사 심사부터 시작했다. 그 순서가 맞나.

## 무엇을 했나

Paddle 공식 문서(`developer.paddle.com/concepts`)에서 한국 결제수단 4종·통화표·국가 기본값을 **직접 열어** 읽었다. 비용·MoR 구조는 이미 리포에 있는 실측 문서(`docs/payment/paddle-eval.md` 2026-07-31 · `portone-eval.md`)의 값을 썼다. 국내 심사 이력은 `toss-teardown-prerequisites.md` 에서 읽었다. **코드 변경 0**, 시크릿·채널키 값 미열람.

## 결과 (수치)

### 한국 결제수단 — Paddle 공식 문서 실측 (2026-08-27)

| 수단               | Countries | Currencies | One-time | ★Subscriptions | Refunds | Installments |
| ------------------ | --------- | ---------- | -------- | -------------- | ------- | ------------ |
| KakaoPay           | KR        | KRW        | 지원     | ★**지원**      | 지원    | 지원         |
| Korean local cards | KR        | KRW        | 지원     | ★**지원**      | 지원    | 지원         |
| Naver Pay          | KR        | KRW        | 지원     | ★**지원**      | 지원    | 지원         |
| Payco              | KR        | KRW        | 지원     | ★**미지원**    | 지원    | 지원         |

★Payco 만 정기결제가 **안 된다.** 네 수단을 한 덩어리로 세면 틀린다. 네 수단 모두 `Customers can save` · `Express` 는 미지원이다.

문서 원문 두 줄:

- **"Korean local cards. No configuration required."**
- **"You don't need to set up a bank account in South Korea to add KakaoPay as a payment option with Paddle."**

### 국가 기본값과 통화 소수점 (같은 문서)

| 항목                                                      | 값                                                                             |
| --------------------------------------------------------- | ------------------------------------------------------------------------------ |
| 국가 기본값 (`ISO / Country / Currency / Tax preference`) | JP → **JPY / Inclusive** · KR → **KRW / Inclusive** · US → **USD / Exclusive** |
| 통화 소수점                                               | JPY **Decimals = 0** (최소 100) · KRW **Decimals = 0** (최소 980)              |

소수점 0 은 우리 `pricing.ts` 가 JPY·KRW 를 정수로 쓰는 것과 정합한다([[jpy-anchors-to-competitors-not-krw]]).

### 반대급부 ① — 수수료

Paddle 공식 요금은 **5% + $0.50 / 체크아웃 거래**(올인클루시브). 국내 PG **빌링/수기** 구간은 포트원 공시표 기준 **2.90~3.23%, VAT 별도**.

| 우리 가격                   | Paddle 실효 | 국내 PG(VAT 포함 환산) |      배수 |
| --------------------------- | ----------: | ---------------------: | --------: |
| Pro $19                     |    **7.6%** |                  3.52% | **2.2배** |
| Team $25                    |    **7.0%** |                  3.52% | **2.0배** |
| Team Plus $245              |    **5.2%** |                  3.52% | **1.5배** |
| (참고) Pro ₩19,000 ≈ $13.73 |    **8.6%** |                  3.52% |     2.4배 |

★**고정 $0.50 때문에 객단가가 낮을수록 실효율이 급등한다.** Pro 가 가장 아프고 Team Plus 에서는 격차가 절반으로 줄어든다. 국내 PG 범위의 양끝은 VAT 포함 **3.19%**(KPN 2.90%) ~ **3.55%**(토스페이먼츠 3.23%)다.

### 반대급부 ② — 세금계산서·현금영수증

Paddle 은 MoR(Merchant of Record)이고 문서 원문이 **"we act as the seller to them"** 이다. 즉 그 거래의 **법적 판매자는 Paddle** 이고, 우리 → Paddle 은 월 1건의 소프트웨어 수출로 단순화된다(Paddle 이 self-billing `Reverse Invoice` 를 발행).

귀결: **그 거래에 대해 우리가 국내 구매자에게 세금계산서·현금영수증을 발행하는 구조가 성립하지 않는다.** 한국 법인이 사는 Team 이상은 세금계산서가 구매 조건인 경우가 많다 → **국내 PG 가 없어지지 않는다.**

### 비용 쪽 — 이 판정이 나온 계기

| 경로    | 실제로 든 것                                                                                                                                                                                       |
| ------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 국내 PG | 토스페이 가맹 심사 **3회 반려** 후 재접수 준비(2026-08-22 문서 기준). 카드사 심사는 포트원 문서 원문 **"보통 2주 정도 소요"** 이고, PG 를 갈아타도 **심사 주체가 카드사로 같아서 짧아지지 않는다** |
| Paddle  | 위 4종에 대해 **"No configuration required."** · 한국 은행계좌 불필요. 계정 심사는 3단계, 공식 추정 합산 **최악 2주 내외**                                                                         |

★같은 벽이 Paddle 경로에는 **없었다.** 그런데 우리는 그 사실을 국내 PG 심사에 몇 주를 쓴 **뒤에** 알았다.

### 현재 구조 한 줄

**통화가 PG 를 정한다.** `resolveCheckoutProvider` 는 `currencyForLocale(locale) !== "KRW"` 이면 Paddle, 아니면 PortOne 을 돌려준다(env 강제 스위치는 스테이징용). **결과적으로 맞은 구조다** — 위 두 반대급부가 정확히 "국내는 국내 PG, 해외는 Paddle" 로 갈라지기 때문이다.

## 왜

우리가 틀린 것은 선택지가 아니라 **탐색 순서**다. 국내 PG 심사는 **착수하는 순간 매몰비용이 생긴다** — 서류·홈페이지 동결 요건·카드사 심사 대기가 붙고, 도중에 결제방식을 바꾸면 포트원 문서 원문대로 **"카드사 재심사"** 로 되돌아간다. 반면 "Paddle 이 이 수단·이 나라를 이미 지원하나"는 공식 문서 표 한 장을 **몇 분 만에** 읽으면 끝나고, 비용이 0이며, 심사를 되돌리지도 않는다.

★**싸고 되돌릴 수 있는 확인을 비싸고 못 되돌리는 절차 뒤에 두면, 답이 무엇이든 손해다.** 그래서 판정을 "Paddle 로 간다"가 아니라 **"순서를 바꾼다"** 로 쓴다. Paddle 이 지원하지 않는다는 답이 나와도 몇 분을 쓴 것뿐이다.

## 한계 / 정직성

- ★**수치가 갈리면 원본이 옳다** — 결제수단 지원표는 Paddle 공식 문서, 국내 수수료는 포트원 공시표, 우리 가격은 `pricing.ts` 다.
- 수수료 배수는 **정가 기준 산수**다. 실제 부담은 결제 통화·환전·정산 수수료로 달라진다. `확인필요` 로 남는 것: 우리 사업자의 **영세·중소 우대수수료 구간**(카드사 판정 사항), Paddle 의 **인보이싱·저가 플랜 별도 협의** 조건.
- 국내 PG 3.20% 는 **VAT 별도** 공시값이고 Paddle 5%+$0.50 은 올인클루시브다. 위 표는 국내 쪽에 VAT 10% 를 얹어 맞췄다. 이 환산 자체가 근사이며 정산·환전 비용은 양쪽 다 빠져 있다.
- ★세금계산서 문장은 **구조 판단이지 세무 확정이 아니다.** 국내 매출에 외국 MoR 을 끼우는 구조의 세무 처리는 우리 문서가 이미 **`확인필요`(세무사 판단)** 로 표시해 뒀다. 이 노트가 그 표시를 지우지 않는다.
- "몇 주를 썼다"의 **정확한 경과 주수는 리포에 측정값이 없다.** 리포가 갖고 있는 것은 "3회 반려 + 재접수 준비 중"(2026-08-22)과 "카드사 심사 보통 2주"(포트원 문서)뿐이다. 그 이상은 **개략**이다.
- 결제수단 표는 **2026-08-27 스냅샷**이다. Paddle 이 지원 항목을 바꾸면 이 표가 먼저 거짓이 된다. 다시 확인할 곳은 `developer.paddle.com/concepts/payment-methods` 다.
- Paddle 셀러 계정 **심사를 통과한 상태가 아니다.** 신청은 사람 일감으로 남아 있다([[human-only-ops-backlog]]). 이 노트는 "지원한다"를 말하지 "우리가 켤 수 있다"를 말하지 않는다.
- 시크릿 금지 규율상 이 노트에는 **프로바이더 이름과 수단 이름까지만** 적는다. 채널키·API 키·env 값은 없다.

## 실제 영향

**코드 무변경.** 구조도 안 바꾼다. 바뀌는 것은 조사 순서 한 줄이다.

| 언제                    | 무엇을 먼저 하나                                                                                                             |
| ----------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| 새 결제수단이 필요할 때 | `developer.paddle.com/concepts/payment-methods` 에서 그 수단의 `Countries` · `Currencies` · **`Subscriptions`** 를 먼저 본다 |
| 새 나라를 열 때         | 같은 문서의 국가 기본값(통화·Tax preference)과 통화 소수점을 먼저 본다                                                       |
| 그다음에                | 국내 PG 계약·입점심사·카드사 심사를 시작한다                                                                                 |

★**지금 안 엎는 이유**(근거와 함께 남긴다):

1. 카카오페이 단건·정기 **채널키 배선이 이미 코드에 서 있고**, 포트원 승인 후 라이브 전환이 임박했다([[payment-live-key-pg-env-bundle]]).
2. 국내 법인 상대 판매에 **세금계산서가 필요**해서 국내 PG 를 어차피 유지해야 한다 — Paddle 로 옮겨도 국내 경로가 안 없어진다.
3. 국내 객단가에서 Paddle 실효 수수료가 **2배 이상**이다.
4. 심사가 끝나기 직전에 결제방식을 바꾸면 **카드사 재심사**로 되돌아간다.

즉 "순서가 틀렸다"는 판정이 "지금 갈아타라"를 뜻하지 않는다. **다음 결정부터 순서를 바꾼다.**

## Evidence

- Paddle 공식 문서 실측 2026-08-27 — https://developer.paddle.com/concepts/payment-methods/kakaopay · `/korean-cards` · `/naver-pay` · `/payco` · https://developer.paddle.com/concepts/sell/supported-currencies · https://developer.paddle.com/concepts/sell/supported-countries-locales
- [docs/payment/paddle-eval.md](../../payment/paddle-eval.md) — §1 MoR 구조와 `"we act as the seller to them"`, §1.2 국내 매출 MoR 경유의 `확인필요`, §1.3 Reverse Invoice, §2 요금 5% + 50¢ 와 실효율
- [docs/payment/portone-eval.md](../../payment/portone-eval.md) — §5.2 PG 수수료 공시표(빌링/수기 2.90~3.23%, VAT 별도), §2 카드사 심사 "보통 2주 정도 소요"
- [docs/payment/toss-teardown-prerequisites.md](../../payment/toss-teardown-prerequisites.md) — §3.4 토스페이 가맹 심사 3회 반려 후 재접수 준비
- [marblo-web/src/lib/paymentProvider.ts](../../../marblo-web/src/lib/paymentProvider.ts) — `resolveCheckoutProvider`: KRW → PortOne, 그 외 → Paddle
- [marblo-web/src/lib/pricing.ts](../../../marblo-web/src/lib/pricing.ts) — `currencyForLocale`, JPY·KRW 정수 가격

## Backlinks

- [[jpy-anchors-to-competitors-not-krw]] · [[payment-live-key-pg-env-bundle]] · [[human-only-ops-backlog]] · [[payment-routes-live-gated-absent]]
