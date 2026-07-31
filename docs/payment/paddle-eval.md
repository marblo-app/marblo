# 글로벌 결제(Paddle) — 실측 조사

- 티켓: `at3QxW2YWq2yNKfU0tRm`
- 작성: 2026-07-31
- 범위: **조사·문서만. 코드 변경 0줄.**
- 웹 실측은 전부 gstack `/browse` 헤드리스 브라우저로 공식 문서(paddle.com / developer.paddle.com / stripe.com / lemonsqueezy.com)를 직접 열어 확인했다. 문서에 없는 값은 **`확인필요`** 로 표기했고, 추측을 사실로 적지 않았다.
- 짝 문서: `docs/payment/portone-eval.md`(국내 PortOne), `docs/payment/apply-guide.md`(사장님용 신청 가이드)

---

## 0. 결론 먼저

**글로벌은 Paddle 이 맞다. 다만 이건 "여러 좋은 선택지 중 하나를 골랐다"가 아니라, 실측해 보니 한국 사업자에게 사실상 열려 있는 유일한 문이었다.**

이번 조사에서 가장 중요한 발견은 Paddle 의 장점이 아니라 **경쟁 후보 둘이 우리에게는 애초에 성립하지 않는다**는 사실이다.

| 후보              | 한국 사업자 채택 가능?   | 근거(실측)                                                                                                                                                                                                                                   |
| ----------------- | ------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Stripe (직접)** | ❌ **불가**              | Stripe 계정 개설 화면의 **국가 선택 목록 45개국에 South Korea 가 없다**(2026-07-31 실측). Stripe 문서도 한국을 "결제수단을 받을 수 있는 나라"로만 다루고 **판매자 소재국(supported business location)** 목록에서는 제외한다.                 |
| **Lemon Squeezy** | ⚠️ **비권장(정리 수순)** | 2024년 Stripe 에 인수됨. 2026-01-28 자사 CEO 공지 원문: 팀은 **Stripe Managed Payments**(Stripe 자체 MoR)를 만들고 있고, Lemon Squeezy 사용자를 그쪽으로 **이전(migrate)** 시키는 것이 목표. Managed Payments 는 35개국·웨이트리스트/초대제. |
| **Paddle**        | ✅ **가능**              | 공식 미지원국 목록(28개)에 South Korea 가 **없다**. "Paddle works with software businesses anywhere in the world with the exception of the unsupported countries listed below."                                                              |

→ **따라서 "Paddle vs Stripe" 비교표는 우리에게 학술적이다.** Stripe 를 쓰려면 미국/영국 등에 법인을 새로 세워야 하고(그래서 Stripe 가 Atlas 를 팔고 있다), 그건 결제 선택이 아니라 법인 설립 의사결정이다. 현 단계에서 검토 대상이 아니다.

**권고: 조건부 GO — "계정·심사는 지금 걸고, 코드는 수요 신호 뒤에".**

- **지금 하는 것(무료·코드 0줄)**: Paddle 라이브 계정 가입 + 3단계 계정 심사 착수. 심사는 도메인 리뷰 5~7영업일 + 사업자 확인 2~4영업일 + 신원확인 1~3영업일이 걸릴 수 있고, **비용이 0**이며, 통과해 두면 수요가 왔을 때 즉시 켤 수 있다. 옵션 가치가 크고 downside 가 없다.
- **지금 하지 않는 것**: 코드 연동. 현재 외부 실사용≈0이고 파운더 대부분이 국내다(`memory: admin_exclude_johnkim_external_zero_value_2026_07`). 글로벌 체크아웃 코드는 **첫 해외 유료 문의가 실제로 들어온 시점의 fast-follow** 로 충분하다.
- **한 가지 준비 작업은 지금 필요하다**: Paddle 의 도메인 리뷰는 우리 웹사이트에 **이용약관·환불정책·개인정보처리방침이 네비게이션에서 접근 가능**할 것을 요구한다(§3.2). 이건 국내 PG 입점심사 요건과도 겹치므로 어차피 해야 하는 일이다.

---

## 1. Paddle 이 정확히 무엇인가 — MoR(Merchant of Record)

출처: [How Paddle handles VAT on your behalf](https://www.paddle.com/help/sell/tax/how-paddle-handles-vat-on-your-behalf)

문서 원문의 핵심:

> "Paddle operates as the Merchant of Record for your digital products. This means we take on the responsibility for all aspects of the transaction, from processing payments to handling sales tax compliance. Essentially, when a buyer purchases your product through Paddle, **we act as the seller to them**."

즉 거래 구조가 PG 와 근본적으로 다르다.

```
[PG(토스/포트원) 구조]   구매자 ──결제──> 우리(판매자)
                                  └ PG 는 결제 처리 대행. 세금·인보이스·분쟁은 전부 우리 책임.

[MoR(Paddle) 구조]       구매자 ──결제──> Paddle(법적 판매자) ──월 정산──> 우리
                                  └ Paddle 이 각국 VAT/GST 징수·신고·납부, 인보이스 발행, 환불·분쟁 대응.
                                  └ 우리 → Paddle 은 B2B 소프트웨어 수출(1건)로 단순화된다.
```

Paddle 이 대신 지는 것(문서 원문 기준):

- 고객 정보 수집 → 올바른 세율 계산 → 징수 → **각국 세무당국에 납부(remit)** → 규정에 맞는 인보이스 발행
- "all the **tax-related risk rests with Paddle**, not with you. No additional work is required on your part."
- 결제 관련 구매자 문의·구독 해지·환불 응대(Billing support)를 Paddle 이 처리
- 사기·차지백 대응

### 1.1 MoR 세금대행의 실제 범위 (공식표, Last Updated 2025-08-01)

출처: [Which countries does Paddle charge sales tax or VAT for?](https://www.paddle.com/help/sell/tax/which-countries-does-paddle-charge-sales-tax-or-vat-for)

"Standard Digital Goods" 카테고리 기준으로 Paddle 이 **등록·징수·납부하는** 관할:

| 권역              | 커버리지(공식표)                                                                                                                                                                                                       |
| ----------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **EU 27개국**     | 전 회원국 **VAT OSS** 로 처리(B2C). 오스트리아 20% · 독일 19% · 프랑스 20% · 헝가리 27% · 룩셈부르크 17% 등. 프랑스 해외령(과들루프·마르티니크·레위니옹 8.5%)과 모나코 20%까지 개별 기재                               |
| **영국**          | 20% VAT, **B2B & B2C**                                                                                                                                                                                                 |
| **미국**          | 40개 주 + District of Columbia + Denver. (문서 주석: 미국은 주·지자체별로 디지털재 과세가 제각각이라 **세율은 표에 기재하지 않음**)                                                                                    |
| **캐나다**        | 전 주/준주 개별(연방 GST 5% + 주별 PST/HST/QST). 온타리오 13% HST, 퀘벡 9.975% QST + 5% 등. **B2B & B2C**                                                                                                              |
| **아시아·태평양** | 일본 10% 소비세(B2B & B2C), **대한민국 10% VAT(B2C)**, 싱가포르 9% GST, 호주 10% GST, 뉴질랜드 15% GST, 인도 18% GST, 대만 5%, 태국 7%, 말레이시아 8% SST, 인도네시아 12%, 필리핀 12%, 베트남 FCT 11.11%/17.65%/25% 등 |
| **기타**          | 노르웨이 25% · 스위스 8.1% · 아이슬란드 24% · 터키 20% · 사우디 15% · UAE 5% · 남아공 15% · 멕시코 16% · 칠레 19% · 콜롬비아 19% 등 50여 관할                                                                          |

→ **우리가 팔 만한 시장은 사실상 전부 덮인다.** 이게 Paddle 을 고른 이유 그 자체다. 우리가 직접 하려면 EU OSS 등록 + 영국 VAT 등록 + 미국 40개 주 nexus 판정 + 일본·호주·싱가포르 등록을 각각 해야 한다.

### 1.2 ★한국 항목이 표에 있다는 것의 의미 (주의)

표에 "South Korea 10% VAT B2C" 가 있다. 이건 **Paddle 이 한국 소비자에게 팔 때 한국 부가세를 징수·납부한다**는 뜻이지, 우리가 국내 매출을 Paddle 로 돌려도 된다는 뜻이 아니다.

- 우리(한국 사업자)가 한국 소비자에게 판매하면서 외국 MoR 을 끼우는 구조는 국내 부가세·현금영수증·전자세금계산서 실무와 어긋날 소지가 있다.
- **`확인필요` — 세무사 판단 사항.** 이 문서는 세무 자문이 아니다.
- **실무 결론: 국내 고객은 PortOne, 해외 고객은 Paddle 로 분리한다.** 이것이 이번 이중 운영 설계의 기본 전제이고, 세무적으로도 가장 단순하다(국내는 국내 매출, 해외는 Paddle 로의 소프트웨어 수출 1건).

### 1.3 우리 → Paddle 정산의 세무 처리 (★국내 회계 실무에 직결)

출처: [Should I charge Paddle VAT/tax for payouts?](https://www.paddle.com/help/manage/get-paid/should-i-charge-paddle-vattax-for-payouts) · [Do I need to invoice Paddle for my payout?](https://www.paddle.com/help/manage/get-paid/do-i-need-to-invoice-paddle-for-my-payout)

| 질문                                         | 공식 답변                                                                                                                                                                                                                                                  |
| -------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Paddle 에 VAT 를 청구하나?                   | **아니오.** 우리 → Paddle 은 국경 간 B2B 거래이므로 **reverse charge** 대상. 과세는 매입자(Paddle, 영국) 쪽에서 일어난다.                                                                                                                                  |
| 우리가 Paddle 에 세금계산서를 발행해야 하나? | **아니오.** Paddle 이 정산할 때마다 **자기청구(self-billing) 방식의 'Reverse Invoice'** 를 자동 생성해 계정의 모든 Admin 에게 이메일로 보낸다. 원문: "The Reverse Invoice from Paddle contains all the details you need for your tax accounting purposes." |

→ 우리 입장에서는 **월 1회, Paddle 로부터 받은 Reverse Invoice 1장 = 소프트웨어 수출 매출 1건**. 회계 부담이 대단히 가볍다. 다만 국내 신고 시 이걸 영세율 수출로 처리할지 등은 **`확인필요`(세무사)**.

---

## 2. 수수료

출처: [Paddle Pricing](https://www.paddle.com/pricing)

### 2.1 공식 요금

| 플랜              | 요금                                  | 포함                                                                                                                                                      |
| ----------------- | ------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Pay-as-you-go** | **5% + 50¢ per Checkout transaction** | 글로벌 결제·구독 빌링·국경간 세무 컴플라이언스·사기/차지백 보호·24/7 구매자 지원·수익 회수(dunning). **월 고정비 0, 마이그레이션 비용 0, 숨은 비용 없음** |
| **Custom**        | 별도 협의                             | 대규모 사업자용. 프리미엄 서비스·전담 매니저·맞춤 마이그레이션 지원                                                                                       |

주석(원문): "If you're selling products under $10 or require invoicing, contact us for custom pricing."
→ **우리 Pro 가 ₩19,000(≈$14) 이라 $10 초과이므로 표준 요금 적용 대상.** 단 향후 저가 플랜(월 $5 등)을 만들면 별도 협의 대상이 된다.

### 2.2 실효 부담 계산 (우리 가격 기준)

$14 결제 1건 기준: `$14 × 5% + $0.50 = $1.20` → **실효 8.6%**.
$29 결제 1건 기준: `$29 × 5% + $0.50 = $1.95` → **실효 6.7%**.

★ 고정 50¢ 때문에 **객단가가 낮을수록 실효 수수료가 급격히 오른다.** 국내 PG 빌링 수수료가 3.2% 수준인 것과 비교하면 2~3배다. 다만 그 차액이 사는 것은:

- 각국 VAT 등록·신고·납부 대행(직접 하면 국가당 연간 수백~수천 달러의 회계 비용)
- 세무 리스크 이전(추징 리스크가 Paddle 에 있음)
- 환불·차지백·구매자 CS 대행
- 100+ 통화/결제수단

→ **글로벌 매출이 작을 때는 이 트레이드가 압도적으로 유리하다**(직접 하면 고정비가 매출을 초과). 매출이 커지면 재검토 대상.

### 2.3 Paddle 자사 비교표에 대한 주의

Paddle 요금 페이지는 "Payment service providers = ~7% and above" 라는 비교표를 싣고 있다(세무등록 +0.5%, 구독빌링 +최대 3.9%, 해외카드 +최대 4.4% 등을 합산). **이건 벤더 자사 마케팅 수치이므로 중립적 근거로 인용하지 말 것.** 우리 실제 대안(§5)과 직접 비교한 수치가 아니다.

---

## 3. 가입·심사 (요건·소요) — ★공식값

출처: [Account Verification](https://www.paddle.com/help/start/account-verification/what-is-account-verification) 및 그 하위 3개 문서, [Setup checklist](https://developer.paddle.com/build/set-up-checklist)

### 3.1 3단계 구조와 공식 소요

| 단계                                       | 자동 처리 시                                       | **수동 심사로 넘어갈 경우(공식 추정치)** | 우리가 준비할 것                                       |
| ------------------------------------------ | -------------------------------------------------- | ---------------------------------------- | ------------------------------------------------------ |
| ① **Domain Review**(도메인 심사)           | "We automatically approve most domain submissions" | **estimated 5–7 business days**          | 웹사이트 요건(§3.2)                                    |
| ② **Business Identification**(사업자 확인) | "often instant"                                    | **estimated 2–4 business days**          | 사업자등록증, 25% 이상 주주 명세                       |
| ③ **Identity Verification**(신원 확인)     | "typically instant"                                | **estimated 1–3 business days**          | 대표 신분증 + 주소 증빙(+ 경우에 따라 라이브니스 영상) |

> ★ 문서가 명시적으로 단서를 단다: "Please note that this timeframe is an **estimate, not a guarantee**. Timelines can be affected by our current review backlog or if additional information is required from you."
> → **최악의 경우 합산 2주 내외**로 보는 게 안전하다. 국내 카드사 심사(~2주)와 비슷한 자릿수다.

★ ②는 **개인/개인사업자(individuals or sole traders)에게는 불필요**하다(문서 원문). 법인이면 필수.

### 3.2 ★Domain Review 요건 — 지금 우리 사이트에 없는 것이 있다

문서가 요구하는 항목(원문):

- [ ] 제품/서비스에 대한 명확한 설명
- [ ] 가격 정보 또는 가격 페이지 (아직 없으면 스크린샷도 허용)
- [ ] 구매에 포함되는 핵심 기능/제공물
- [ ] **이용약관(Terms and Conditions), 환불정책(Refund Policy), 개인정보처리방침(Privacy Policy)** — "these must be **clearly accessible via navigation** on your website"
- [ ] 이용약관에 **법인명(개인사업자는 대표자 실명 권장)** 기재
- [ ] 사이트가 라이브 상태이고 **SSL(HTTPS)** 적용
- [ ] (해당 시) 맞춤/엔터프라이즈 가격표 — 요청 시 제공 가능한 PDF

주의사항(원문): 승인된 도메인에서만 결제창을 띄울 수 있고, **서브도메인은 별도 승인**이 필요하다(`domain.com` 승인 ≠ `mystore.domain.com` 승인). 또한 Paddle 로 팔지 않는 무관한 상품이 같은 도메인에 있으면 구매자 혼란·차지백 위험으로 승인에 불리하다.

> ★ **Sandbox 는 도메인 승인 없이 사용 가능**하다("This does not apply to the Sandbox environment, which can be used without domain approval for testing"). 즉 **PortOne 의 테스트 채널과 정확히 같은 성격** — 심사 전에 연동 PoC 를 끝내 둘 수 있다.

### 3.3 심사 관련 서류 (원문)

| 단계 | 요구될 수 있는 서류                                                                                                                                                        | 명시적으로 **받지 않는** 것                                                                            |
| ---- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| ②    | 정부 발행 **사업자 등록 서류**, **주주·지분 구조 서류**(25% 이상 보유자 전원의 이름·지분율 표시). 형식은 **PDF 권장**, 공개 등기부라면 로그인 없이 접근 가능한 링크도 가능 | "utility bills, accounting documents, or tax identification documentation such as your EIN" — **불가** |
| ③    | 정부 발행 **신분증** + **주소 증빙**(파트너사 **Sumsub** 를 통해 업로드). 경우에 따라 **라이브니스 체크**(짧은 셀피 영상)                                                  | —                                                                                                      |

### 3.4 계정 구조 — 샌드박스와 라이브는 완전히 별개

출처: [Setup checklist](https://developer.paddle.com/build/set-up-checklist) · [Go-live checklist](https://developer.paddle.com/build/go-live-checklist)

- 가입 계정이 **두 종류**다: **Sandbox**(테스트 전용, 가짜 결제) / **Live**(실판매). 각각 따로 가입한다.
- 계정 심사(§3.1)는 **라이브 계정에만** 필요하다.
- 문서 권고 원문: "It can sometimes take a few days to complete verification, so we recommend **starting the process in live before you start integrating with sandbox**."
  → **심사를 먼저 걸어두고 그동안 샌드박스로 개발**하라는 것이 Paddle 자신의 권고다. §0 의 권고와 일치한다.
- 두 계정은 API 키·클라이언트 토큰·상품 ID·웹훅 목적지가 전부 별개다. 라이브 전환은 "샌드박스에서 만든 것을 라이브에 다시 만들고 키를 갈아끼우는" 작업이다.

---

## 4. 정기결제·인보이싱·웹훅 (기술 실측)

### 4.1 구독(정기결제) — 필요한 기능은 다 있다

출처: [Paddle Developer Docs — Build](https://developer.paddle.com/build) 내비게이션 및 하위 문서

문서에 개별 가이드가 존재하는 구독 기능:

| 기능                                                      | 문서 존재 |
| --------------------------------------------------------- | --------- |
| 항목 추가/제거, 수량 변경                                 | ✅        |
| 업그레이드/다운그레이드(비례배분)                         | ✅        |
| 일회성 과금을 구독에 청구                                 | ✅        |
| 청구일 변경                                               | ✅        |
| 결제수단 업데이트                                         | ✅        |
| 구독 일시정지(pause)                                      | ✅        |
| 구독 해지(cancel)                                         | ✅        |
| 무료/유료 체험, **무카드 체험**                           | ✅        |
| 고객 포털에서 플랜 변경                                   | ✅        |
| **Retain** — 실패결제 자동 재시도·독촉(dunning)·해지 설문 | ✅        |

★ **PortOne/토스 대비 구조적 차이**: 빌링키를 우리가 보관하고 크론으로 청구하는 방식이 아니다. **구독 객체를 Paddle 이 소유하고 갱신 청구까지 Paddle 이 수행**하며, 우리는 웹훅으로 상태를 따라간다. 즉 현재 `scheduledChargeSubscriptions` 같은 자체 갱신 크론이 글로벌 경로에는 **필요 없다**(`docs/payment/portone-eval.md` §1.2 참조).

### 4.2 인보이싱(B2B 수기 청구)

출처: [Paddle Invoicing Tool](https://www.paddle.com/help/sell/invoicing-tool/what-should-i-know-to-use-paddles-invoicing-tool)

- 대시보드에서 Customer + Product 를 만들고 인보이스 발행. **다중 라인아이템·다중 수량** 지원. 고객 정보(회사명·이메일·VAT 번호)는 저장되어 재사용된다.
- **Paddle Billing 에서는 API 로도 인보이스 생성 가능.**
- ★ 제약(원문): "**product fulfillment is not currently automated via Invoicing**" — 인보이스 결제 시 제품 제공(우리 쪽 권한 부여)은 **웹훅으로 우리가 직접 처리**해야 한다.
- 요금 페이지 주석: 인보이싱이 필요하면 **별도 요금 협의 대상**이다.
- 연체 독촉 주체·정산 시점은 별도 문서가 있으나 이번 범위에서 상세 확인하지 않음 — **`확인필요`**.

### 4.3 웹훅 — 국내 토스보다 낫고 PortOne 과 동급

출처: [Go-live checklist](https://developer.paddle.com/build/go-live-checklist)

- **서명 검증 있음**: "All webhooks sent by Paddle include a signature that you can use to check that they were genuinely sent by Paddle. We recommend that you verify webhook signatures."
- **IP 허용목록 권고**: 샌드박스와 라이브의 발신 IP 가 다르며, 허용목록 설정을 권장.
- 알림 목적지(notification destination)를 샌드박스/라이브 **각각 별도 URL** 로 두는 것을 권장.
- ★ 우리 코드베이스에는 **이미 Paddle HMAC 검증 로직이 존재한다** — `v3/functions/src/webhookVerify.ts` 에 Paddle 검증 함수가 있고 `reconciliation.ts` 도 Toss/Paddle 2종 스켈레톤을 갖고 있다(`docs/payment/portone-eval.md` §1.2 실측). **`확인필요`: 이 기존 Paddle 코드가 Paddle Classic 기준인지 Paddle Billing 기준인지** — Classic 이면 재작성 대상이다.

### 4.4 프론트엔드 — Paddle.js

- `Paddle.Initialize({ token, pwCustomer })` 로 초기화. 샌드박스는 `Paddle.Environment.set("sandbox")` 를 추가하고 라이브 전환 시 **제거**한다.
- 체크아웃은 **오버레이 / 인라인 / 가격 페이지** 3형태 지원. 저장된 결제수단 표시, 업셀 체크아웃, 장바구니 이탈 복구 등 문서 존재.
- ★ 라이브 요건(원문): 기본 결제 링크(default payment link)는 "**a real website (not localhost) that's passed domain verification**" 이어야 한다.
- ★ **`확인필요` — Electron 렌더러에서의 동작.** 현재 앱 결제 UI(`v3/src/components/settings/BillingPage.tsx`)는 CDN 스크립트 + 리다이렉트 콜백 구조다. Paddle.js 오버레이가 Electron 커스텀 스킴 환경에서 정상 동작하는지는 **샌드박스 PoC 로만 확정 가능**하다. (PortOne 도 동일한 미검증 항목이 있다 — `portone-eval.md` R6)

---

## 5. 정산 — ★한국 사업자에게 가장 아픈 지점

출처: [When and how do I get paid?](https://www.paddle.com/help/manage/get-paid/when-and-how-do-i-get-paid) · [Can I be paid in my local currency?](https://www.paddle.com/help/manage/get-paid/can-i-be-paid-in-my-local-currency) · [Is there a fee taken for payouts?](https://www.paddle.com/help/manage/get-paid/is-there-a-fee-taken-for-payouts)

### 5.1 정산 주기 — 월 1회, 온디맨드 출금 불가

원문: "Sellers **cannot withdraw their balance on demand** since there is a monthly payout schedule."

| 시점         | 일어나는 일                                                                       |
| ------------ | --------------------------------------------------------------------------------- |
| 매월 **1일** | 잔액이 설정한 임계값(**최소 $100**) 이상이면 payout 으로 전환되어 대기열에 들어감 |
| **2~15일**   | Paddle 이 송금. "Paddle will send your payment **by the 15th**"                   |
| 송금 후      | 최대 **3영업일** 내 계좌 입금(수령 방식에 따라 다름). Reverse Invoice 이메일 발송 |

임계값은 $100 ~ $100,000 사이로 조정 가능(잔액 통화가 GBP/EUR 이면 £100/€100). 임계 미달분은 다음 달로 이월된다.

→ **현금흐름 함의: 월초 매출이 최대 6주 뒤에 들어온다.** (7/2 결제 → 8/1 payout 전환 → 8/15 송금 → 8/18 입금)

### 5.2 ★정산 통화에 KRW 가 없다

공식 지원 정산 통화 **13종**:

> AUD, GBP, CAD, CNY, CZK, DKK, EUR, HUF, PLN, ZAR, SEK, CHF, USD

**원화(KRW)는 없다.** 문서의 해당 상황 안내 원문: "If your local currency isn't supported we can send the payout in the most competitive Default Currency and **your bank will convert the payout to your local currency**. Any subsequent charges will be from your bank and are incurred by you directly."

실무적 귀결:

| 항목                        | 한국 사업자에게 적용되는 값                                                                                                                                                         |
| --------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 잔액 통화                   | USD 로 두는 것이 자연스럽다(go-live 문서 권고: "We recommend choosing a currency that **matches your bank account**" → 국내 **외화통장(USD)** 개설이 사실상 전제)                   |
| 송금 경로                   | 원화 계좌로 직접 받을 수 없으므로 **SWIFT 국제송금**                                                                                                                                |
| **SWIFT 수수료**            | 문서 원문: "for certain countries, a **$15 SWIFT fee** may be applicable" / 통화와 은행 소재국이 불일치하면 "$/€/£15" 부과. **한국은 무수수료 로컬망(ACH/SEPA/BACS) 대상이 아니다** |
| **환전 마진**               | 잔액 통화와 다른 통화로 받으면 Paddle 이 **최대 1.5%** 환전 마진 부과 가능. USD 잔액 → USD 수령이면 이 마진은 회피 가능하고, 원화 환전은 **국내 은행 스프레드**로 발생              |
| 중개은행(intermediary bank) | 경유 시 각 중개은행 수수료가 추가로 발생하며 우리 부담                                                                                                                              |

→ **월 1회 정산이라 SWIFT $15 는 월 1회만 발생**한다. 월 정산액이 $1,000 이면 1.5%, $5,000 이면 0.3%. **정산액이 작을 때 뼈아프므로 임계값을 $100 이 아니라 더 높게(예: $500~1,000) 잡아 송금 횟수를 줄이는 게 유리하다** — 다만 그만큼 입금이 늦어진다. 사장님 판단 사항.

### 5.3 수령 방식

- Help center: **wire transfer(전신환) 또는 Payoneer**
- Go-live checklist: "bank transfer, **PayPal**, or Payoneer"
- ★ **`확인필요`** — 두 공식 문서의 표기가 불일치한다(PayPal 포함 여부). 실제 선택지는 계정 개설 후 `Business account > Payouts > Payout settings` 에서 확인해야 한다.
- Payoneer 를 쓰면 Payoneer 자체 수수료가 별도로 붙는다(계정 등급에 따라 다름).

### 5.4 정산 계좌 입력 시 주의(문서 원문)

BIC/SWIFT·계좌번호·IBAN 등은 **영숫자만, 공백 없이**. 특수문자(`-`, `'`, `@` 등)나 강세 문자를 넣으면 정산 지연 사유가 된다. 계좌명·은행명·주소도 영숫자만.

---

## 6. 대안 비교표 (짧게)

| 항목                 | **Paddle**                                        | Stripe (직접)                                                                                                                           | Lemon Squeezy                                                     |
| -------------------- | ------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------- |
| **한국 사업자 가입** | ✅ **가능**(미지원국 목록에 한국 없음)            | ❌ **불가** — 계정 개설 국가 목록 45개국에 한국 없음(2026-07-31 실측)                                                                   | ⚠️ 가입 자체는 열려 있으나 **Stripe Managed Payments 로 이전 중** |
| **MoR(세금 대행)**   | ✅ MoR. 100+ 관할 등록, 징수·신고·납부·인보이스   | ❌ 아님. Stripe Tax(+0.5%/건)는 **계산 보조**일 뿐 신고·납부는 우리 몫                                                                  | ✅ MoR                                                            |
| **수수료**           | **5% + 50¢** (올인클루시브)                       | 2.9% + 30¢ (국내카드) / **+1.5%** 해외카드 / **+1%** 환전 / Billing **0.7%** / Tax **0.5%** → 합산 시 5%대 + 세무 실무는 여전히 우리 것 | **5% + 50¢**                                                      |
| **정기결제**         | ✅ 전 기능(체험·일시정지·업/다운그레이드·dunning) | ✅ 업계 최강                                                                                                                            | ✅                                                                |
| **인보이싱(B2B)**    | ✅ (대시보드 + API, 별도 요금 협의)               | ✅ Stripe Invoicing                                                                                                                     | **`확인필요`**                                                    |
| **신규 채택 권고**   | ✅ **채택**                                       | ❌ 해외법인 없이는 불가                                                                                                                 | ❌ **비권장**(제품 정리 수순)                                     |

**Stripe 수치 출처**: [stripe.com/pricing](https://stripe.com/pricing) — "2.9% + 30¢ per successful transaction for domestic cards", "+1.5% for international cards", "+1% if currency conversion is required", Billing "0.7% of Billing volume", Tax Basic "0.5% per transaction, where you're registered to collect taxes".

**Lemon Squeezy 상태 출처**: [2026 Update: Lemon Squeezy + Stripe Managed Payments](https://www.lemonsqueezy.com/blog/2026-update) (2026-01-28, CEO JR Farr). 원문 요지 — Stripe 인수(2024) 이후 팀은 Stripe Managed Payments 를 구축 중이고, "Our goal is to provide Lemon Squeezy users an easy way to **migrate to** Stripe Managed Payments." Managed Payments 는 현재 35개국 지원·초대/웨이트리스트제이며 곧 공개 예정이라고 밝힘.

> ★ **Stripe Managed Payments 를 미래 대안으로 볼 수 있는가?** — Stripe 계정을 전제로 하므로 §6 첫 행의 한국 미지원 문제에 다시 걸릴 가능성이 높다. **`확인필요`**: Managed Payments 가 Stripe 본계정과 별도 판매자 국가 정책을 갖는지는 공개 문서로 확인되지 않았다(docs.stripe.com/managed-payments 는 404). 현 시점에서 우리 선택지가 아니다.

---

## 7. 리스크

| #   | 리스크                                                                                                                                                                          | 심각도   | 완화                                                                                                                    |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- | ----------------------------------------------------------------------------------------------------------------------- |
| G1  | **객단가 대비 실효 수수료가 높다** — $14 결제 시 실효 8.6%(고정 50¢ 때문). 저가 플랜을 만들면 더 악화                                                                           | **HIGH** | 글로벌 전용 가격을 국내보다 높게 책정(예: $19). 저가 플랜은 Paddle 과 별도 요금 협의                                    |
| G2  | **정산 리드타임 최대 6주 + KRW 미지원**(§5.2). 외화통장 필요, SWIFT $15, 은행 환전 스프레드                                                                                     | **HIGH** | 외화(USD) 통장 선개설. payout 임계값을 높여 송금 횟수 축소. 초기 매출 규모에선 현금흐름 영향 미미                       |
| G3  | **도메인 리뷰 요건 미충족 가능성** — 이용약관·환불정책·개인정보처리방침이 네비게이션에서 접근 가능해야 함(§3.2)                                                                 | MED      | 신청 **전에** marblo.app 정비. 국내 PG 입점심사 요건과 겹치므로 중복 투자 아님                                          |
| G4  | **기존 `webhookVerify.ts` 의 Paddle 코드가 Paddle Classic 기준일 수 있다** → 재사용 불가 시 재작성                                                                              | MED      | **`확인필요`** — 코드 전환 티켓 착수 시 첫 항목으로 확인                                                                |
| G5  | **Electron 렌더러에서 Paddle.js 동작 미검증**(§4.4)                                                                                                                             | MED      | **`확인필요`** — 샌드박스 PoC. 심사 전에 무료로 가능                                                                    |
| G6  | **국내/해외 이중 운영 복잡도** — `paymentProvider` 가 `portone`/`paddle` 로 갈리고, 구독 갱신 주체가 다르다(우리 크론 vs Paddle). 라우팅 기준(무엇으로 국내/해외를 가르나) 미정 | MED      | 이미 `paymentProvider` 가 discriminator 로 존재(`v3/src/types/subscription.ts`). 라우팅 기준은 **사장님 판단 필요**(§8) |
| G7  | **한국 매출을 Paddle 로 흘리면 국내 세무와 충돌 소지**(§1.2)                                                                                                                    | MED      | 국내=PortOne / 해외=Paddle 로 엄격 분리. **`확인필요`(세무사)**                                                         |
| G8  | Paddle 이 MoR 이므로 **고객 관계·환불 정책 통제권 일부를 넘긴다**. 구매자 명세서에 Paddle 이 찍힌다                                                                             | LOW      | MoR 의 본질적 트레이드. 대부분의 SaaS 가 수용 중                                                                        |
| G9  | 승인된 도메인에서만 체크아웃 가능. 서브도메인 별도 승인                                                                                                                         | LOW      | 신청 시 필요한 도메인·서브도메인을 한 번에 제출                                                                         |

---

## 8. 권고 플랜

### Phase 0 — 지금(무료, 코드 0줄) ★사장님 액션

1. **웹사이트 정비**: marblo.app 에 이용약관·환불정책·개인정보처리방침을 **네비게이션에서 접근 가능하게** + 이용약관에 법인명 기재 + 가격 페이지(§3.2). — 국내 PG 입점심사와 공통 요건이므로 어차피 필요.
2. **Paddle 라이브 계정 가입 + 심사 착수**(`docs/payment/apply-guide.md` §2). Paddle 자신의 권고이기도 하다(§3.4).
3. **Paddle 샌드박스 계정 가입**(심사 무관, 즉시).
4. **외화(USD) 통장 개설** — 정산 수령용(§5.2). 없으면 정산 자체가 막힌다.

### Phase 1 — 심사 대기 중(코드 0줄~S) ★엔지니어링

5. 샌드박스로 **G5(Electron Paddle.js) PoC** 해소.
6. **G4 확인**: `v3/functions/src/webhookVerify.ts` 의 기존 Paddle 코드가 Billing 기준인지 Classic 기준인지 판정.
7. 글로벌 가격 정책 결정(G1) — 사장님 판단.

### Phase 2 — 코드 연동 (★수요 신호 확인 후 착수)

착수 트리거: **해외 유료 전환 의사가 있는 첫 실사용자/문의 1건**. 그 전에는 착수하지 않는다(현 외부 실사용≈0).

| 티켓 후보 | 내용                                                                                                                                                                             | 규모 |
| --------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---- |
| GP-1      | `functions`: Paddle Billing 콜러블 세트 + `paddleWebhook`(서명 검증 + IP 허용목록) — PortOne/Toss 경로는 남긴 채 추가                                                            | L    |
| GP-2      | `webhookVerify.ts`: Paddle Billing 이벤트 매핑 + 단위테스트(기존 Paddle 코드 재사용 여부는 G4 결과에 따름)                                                                       | M    |
| GP-3      | `billing.ts`/`subscription.ts`: 갱신 주체가 다른 provider(구독을 Paddle 이 소유) 를 수용하도록 분기 — **`selectDueForCharge()` 가 Paddle 구독을 집지 않도록 제외**하는 것이 핵심 | S    |
| GP-4      | `marblo-web` 체크아웃: 국내/해외 라우팅 + Paddle.js 오버레이                                                                                                                     | M    |
| GP-5      | `BillingPage.tsx`: 해외 사용자 경로                                                                                                                                              | M    |
| GP-6      | 정산 리컨실리에이션(`reconciliation.ts`) Paddle 경로                                                                                                                             | S    |

> ★ GP-3 이 조용한 함정이다. Paddle 은 **자기가 구독을 갱신 청구**하므로, 우리 `scheduledChargeSubscriptions` 크론이 Paddle 구독까지 집으면 **이중 청구**가 된다. 연동 시 첫 번째로 막아야 할 지점.

---

## 9. 확인필요 목록 (추측으로 채우지 않은 항목)

1. **국내 사업자가 국내 고객 매출을 MoR 로 처리해도 되는지** — 세무사 판단(§1.2). 이 문서의 "국내=PortOne / 해외=Paddle" 분리 전제의 근거.
2. Paddle 정산 수령 방식에 **PayPal 이 실제로 포함되는지**(공식 문서 2곳 표기 불일치, §5.3).
3. **Paddle 잔액 통화(balance currency) 선택지 목록** — 정산 통화 13종과 동일한지. 계정 개설 후 `Business account > Currencies` 에서만 확인 가능.
4. 기존 `v3/functions/src/webhookVerify.ts` 의 **Paddle 검증 코드가 Billing 기준인지 Classic 기준인지**(G4).
5. **Electron 렌더러에서 Paddle.js** 오버레이/리다이렉트 동작(G5) — 샌드박스 PoC 로 해소 가능.
6. Paddle **인보이싱 별도 요금**과 연체 독촉 주체·정산 시점(§4.2).
7. **Stripe Managed Payments 의 판매자 국가 정책**이 Stripe 본계정과 별도인지(§6). 공개 문서 미확인(404).
8. 우리 서비스가 Paddle 의 **Standard Digital Goods** 카테고리로 충분한지(다른 taxable category 는 별도 승인 필요 — go-live 체크리스트).

---

## 부록. 출처 링크

**Paddle 공식(paddle.com)**

- [Pricing — 5% + 50¢](https://www.paddle.com/pricing)
- [Account Verification 개요](https://www.paddle.com/help/start/account-verification/what-is-account-verification)
- [Domain Review(요건·5~7영업일)](https://www.paddle.com/help/start/account-verification/what-is-domain-verification)
- [Business Identification(서류·2~4영업일)](https://www.paddle.com/help/start/account-verification/what-is-business-verification)
- [Identity Verification(Sumsub·1~3영업일)](https://www.paddle.com/help/start/account-verification/what-is-identity-verification)
- [How Paddle handles VAT on your behalf(MoR 정의)](https://www.paddle.com/help/sell/tax/how-paddle-handles-vat-on-your-behalf)
- [Which countries does Paddle charge sales tax or VAT for?(관할 전수표)](https://www.paddle.com/help/sell/tax/which-countries-does-paddle-charge-sales-tax-or-vat-for)
- [Tax inclusive/exclusive 가격 설정](https://www.paddle.com/help/sell/tax/do-you-support-tax-inclusiveexclusive-pricing)
- [When and how do I get paid?(월 1회·$100·15일)](https://www.paddle.com/help/manage/get-paid/when-and-how-do-i-get-paid)
- [Can I be paid in my local currency?(정산통화 13종)](https://www.paddle.com/help/manage/get-paid/can-i-be-paid-in-my-local-currency)
- [Is there a fee taken for payouts?(SWIFT $15·환전마진 1.5%)](https://www.paddle.com/help/manage/get-paid/is-there-a-fee-taken-for-payouts)
- [Should I charge Paddle VAT/tax for payouts?(reverse charge)](https://www.paddle.com/help/manage/get-paid/should-i-charge-paddle-vattax-for-payouts)
- [Do I need to invoice Paddle?(Reverse Invoice 자동발행)](https://www.paddle.com/help/manage/get-paid/do-i-need-to-invoice-paddle-for-my-payout)
- [How do I set up my payout settings?(계좌 입력 규칙)](https://www.paddle.com/help/manage/get-paid/how-do-i-set-up-my-payout-settings)
- [Which countries are supported by Paddle?(미지원국 28개)](https://www.paddle.com/help/legal/sanctions/which-countries-are-supported-by-paddle)
- [Invoicing tool](https://www.paddle.com/help/sell/invoicing-tool/what-should-i-know-to-use-paddles-invoicing-tool)

**Paddle 개발자 문서(developer.paddle.com)**

- [Setup checklist(샌드박스·심사 순서)](https://developer.paddle.com/build/set-up-checklist)
- [Go-live checklist(라이브 전환 전수)](https://developer.paddle.com/build/go-live-checklist)
- [Quickstart](https://developer.paddle.com/get-started/quickstart)
- [Build(구독·체험·Retain·고객포털 문서 목록)](https://developer.paddle.com/build)

**대안 벤더**

- [Stripe Pricing](https://stripe.com/pricing)
- [Stripe 계정 개설(국가 목록 실측)](https://dashboard.stripe.com/register)
- [Lemon Squeezy Pricing](https://www.lemonsqueezy.com/pricing)
- [Lemon Squeezy — 2026 Update: + Stripe Managed Payments](https://www.lemonsqueezy.com/blog/2026-update)

**사내 문서**

- `docs/payment/portone-eval.md` — 국내 PortOne 전환 타당성(짝 문서)
- `docs/payment/apply-guide.md` — 사장님용 신청 가이드(국내 PortOne + 글로벌 Paddle)
