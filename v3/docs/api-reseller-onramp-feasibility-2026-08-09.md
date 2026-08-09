# API 요금제 재판매 온램프 feasibility — 구독 없는 신규유저에게 카드결제로 토큰을 대신 사 주는 안

- **티켓**: `OF2wawHo58yLuen1fkfe`
- **작성일**: 2026-08-09
- **성격**: 전략·법무 스파이크. **코드 무변경** (이 문서 1개만 추가)
- **판정 대상**: "구독 없는 유저가 우리에게 카드로 결제 → 마블로가 대신 API 토큰을 사서 제공(소폭 마진)" 이 (a)약관상 가능한가 (b)돈이 남는가 (c)무엇을 만들어야 하는가
- **선행 근거**: [`cloud-hosted-feasibility-2026-08-08.md`](./cloud-hosted-feasibility-2026-08-08.md) (#868) · [`activation-friction-diagnosis-2026-08-07.md`](./activation-friction-diagnosis-2026-08-07.md) (#850) · [`VENDOR-EXPANSION-SURVEY.md`](./VENDOR-EXPANSION-SURVEY.md) · `v3/electron/model-registry.ts` (env-swap 축)

---

## 0. 한 줄 결론

| 질문                                   | 판정                                                                                                                                                              |
| -------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 약관이 이걸 허용하는가                 | **모양에 따라 갈린다.** "우리 제품 안에서 우리 키로 토큰을 태운다" = 5개 벤더 중 4개가 **명시 허용**. "유저에게 키·엔드포인트를 준다" = **전 벤더 금지**(§2)      |
| 어느 벤더가 GO 인가                    | **OpenAI · xAI · MiniMax = GO**(번들 한정) / **Anthropic = 조건부 GO**(공식문서가 API 키 경로를 직접 지시, 단 D.4 재판매 경계) / **Z.ai GLM Coding Plan = NO-GO** |
| ★우리가 지금 쓰는 env-swap 키로 되는가 | **안 된다.** GLM/MiniMax/Kimi 배선은 전부 **구독(Coding Plan) 엔드포인트**다. 재판매하려면 **pay-go 플랫폼 키로 갈아끼워야** 한다(§2-E·§5-A)                      |
| 마진이 남는가                          | **산술적으로는 남는다(마크업 5.4% 이상). 사업으로는 안 남는다.** 도매가가 없어서 마진 = 유저에게 정가보다 비싸게 파는 것이고, 유저 대안이 훨씬 싸다(§3)           |
| 유저 입장에서 매력적인가               | **첫 1\~2 티켓까지만.** ₩10,000 충전 = opus-5 기준 **티켓 약 1건**. 3티켓만 넘어도 $20 구독이 이긴다(§3-D)                                                        |
| 기술적으로 얼마나 드는가               | **생각보다 크다.** 데스크탑 앱이라 우리 키를 유저 머신에 못 내린다 → **계량 프록시가 선택이 아니라 필수**. 게다가 과금등급 미터가 지금 없다(§5)                   |
| ★#868 이 이미 답한 부분                | #868 은 "우리가 토큰을 대신 낸다(모델 1)"를 **캡 없이는 불가**로 판정했다. 이 안은 거기에 **결제·세무·재판매 리스크를 더한 변종**이다(§6)                         |
| 추천                                   | **보류.** 단 "결제 배관만 먼저"(토스만)를 차선으로 둔다(§9)                                                                                                       |

**권고 한 줄**: 이건 매출 아이디어가 아니라 **고객획득비용(CAC) 지출 항목**이다. 그렇다면 결제를 붙일 이유가 없다 — #868 의 Cloud Try(우리 키 + 하드캡 + 무료)가 같은 활성화 지문을 **결제·세무·재판매 위험 0으로** 산다. 재판매 온램프는 그 실험이 "설치를 없애면 전환이 오른다"를 증명한 **뒤에** 유료화 수단으로 꺼낼 카드다.

---

## 1. 방법 · 무엇이 원문이고 무엇이 추정인가

| 표기       | 뜻                                     | 예                                             |
| ---------- | -------------------------------------- | ---------------------------------------------- |
| **[원문]** | 벤더 공식 약관 페이지를 직접 열어 인용 | Anthropic Commercial ToS D.4                   |
| **[코드]** | 이 레포에서 직접 읽은 것               | `model-registry.ts` 의 `ANTHROPIC_BASE_URL` 행 |
| **[출처]** | 벤더 공식 문서·가격표(약관 아님)       | Anthropic 캐시 승수 0.1x                       |
| **[추정]** | 위를 곱해 만든 것                      | "₩10,000 = 티켓 1건"                           |
| **[2차]**  | 언론·블로그. 원문 확인 못 한 것        | 2026-04-04 하네스 차단 시점                    |

- 약관은 전부 `gstack /browse` 로 벤더 페이지를 직접 열어 읽었다. WebFetch 가 403 나는 곳(OpenAI·xAI)은 브라우저로 우회했다.
- **이 문서는 법률 자문이 아니다.** 공개 약관 문구 인용과 그 문구를 우리 제품 모양에 대본 결과일 뿐이다. §9 의 조건부 GO 는 서면 확인을 전제로 한다.
- 어떤 벤더와도 접촉하지 않았다.

---

## 2. ToS — 최우선 판정

### 2-A. 모든 벤더 약관이 **같은 두 문장**으로 갈린다

다섯 벤더를 다 읽고 나면 문장 구조가 놀랍도록 같다:

1. **"고객이 자기 제품/애플리케이션 안에 우리 API 를 넣어 자기 End User 에게 제공하는 것" = 허용**
2. **"서비스 자체를 재판매·전대·프록시·시분할하는 것" = 금지**

즉 판정은 벤더별이 아니라 **우리 제품이 어느 쪽 모양인가**에 달렸다. 그래서 이 문서는 두 모양을 분리해 판정한다:

| 모양                                                                                      | 통칭        |
| ----------------------------------------------------------------------------------------- | ----------- |
| **모양 A** — 유저가 마블로에 결제 → 마블로 인프라가 **우리 키로** 토큰 소비 → 결과만 제공 | "번들"      |
| **모양 B** — 유저가 마블로에 결제 → 마블로가 **API 키/엔드포인트를 유저에게 프로비저닝**  | "키 재판매" |

티켓 본문의 "API 요금제로 마블로가 대신 제공"은 문면상 **모양 B 로 읽힌다.** 결론부터: **모양 B 는 전 벤더 금지다.** 살아남는 건 모양 A 뿐이고, 모양 A 는 곧 #868 의 "모델 1(우리 호스팅 토큰)"에 결제를 붙인 것이다(§6).

### 2-B. Anthropic — **조건부 GO** (모양 A) / NO-GO (모양 B)

**[원문]** Commercial Terms of Service, Effective June 17, 2025

> **A.1. Overview.** "Subject to these Terms, Anthropic gives Customer permission to use the Services, including **to power products and services Customer makes available to its own customers and end users ("Users")**."

> **D.4. Use Restrictions.** "Customer may not and must not attempt to (a) access the Services to build a competing product or service, including to train competing AI models **or resell the Services except as expressly approved by Anthropic**; (b) reverse engineer or duplicate the Services; or (c) support any third party's attempt at any of the conduct restricted in this sentence."

같은 문서 안에서 A.1 이 허용하고 D.4 가 금지한다. 경계는 **"제품을 구동하는가"** 대 **"서비스를 되파는가"** 다.

**[원문]** `code.claude.com/docs/en/legal-and-compliance` — Authentication and credential use

> "OAuth authentication is intended exclusively for purchasers of Claude Free, Pro, Max, Team, and Enterprise subscription plans…
> **Developers building products or services that interact with Claude's capabilities, including those using the Agent SDK, should use API key authentication through Claude Console or a supported cloud provider.** Anthropic does not permit third-party developers to offer Claude.ai login or to route requests through Free, Pro, or Max plan credentials on behalf of their users."

★**이 한 줄이 판정을 크게 바꾼다.** 앤트로픽이 "제품을 만드는 개발자는 **API 키 인증을 쓰라**"고 직접 지시한다. 즉 "우리 API 키로, 우리 제품의 유저를 위해 토큰을 태우는 것"은 앤트로픽이 **권장하는 경로**다. D.4 의 "resell" 은 그 반대편 — 제품 없이 서비스를 통째로 되파는 행위 — 을 겨냥한 것으로 읽는 게 자연스럽다.

**그럼에도 남는 노출 하나 (정직하게)**: 다른 SaaS 와 달리 **유저가 마블로에서 소비하는 것이 Claude Code 그 자체**다. 우리 부가가치(보드·오케·워크트리·safe-merge)는 Claude Code **주위**에 있지 그 안에 있지 않다. "resell the Services" 의 경계선에 우리가 다른 앱보다 훨씬 가깝다는 뜻이다. 그리고 §5 대로 **기술적으로 유일하게 가능한 구현이 Anthropic 호환 프록시**인데, 그 프록시는 문면 그대로 "passthrough" 다.

**판정**: 모양 A = **조건부 GO**. 조건 = (1)유저에게 키·엔드포인트를 노출하지 않을 것 (2)유료 확장 전 sales@anthropic.com 서면 확인(문서 자체가 "For questions about permitted authentication methods for your use case, please contact sales" 라고 안내한다). 모양 B = **NO-GO**.

### 2-C. OpenAI — **GO** (모양 A) / NO-GO (모양 B)

**[원문]** OpenAI Services Agreement, Updated December 1, 2025 · **Effective January 1, 2026**

정의절:

> "**"End User"** means any party: (a) who accesses the Services under Customer's Account; **or (b) who uses Customer Applications.**"
> "**"Customer Application"** means Customer's applications, products, or services that integrate with an OpenAI API."

→ 우리 유저는 정의상 **End User** 이고, 마블로는 **Customer Application** 이다. 모양 A 는 약관이 상정한 정상 사용이다.

금지절:

> **3.1. Customer Account.** "…**Customer may not resell or lease access to its Account or any End User Account.**"
> **3.3. Restrictions.** "Customer will not, and will not permit End Users to: … **(g) buy, sell, or transfer API keys from, to, or with a third party**…"

→ 모양 B 는 (g) 정면 위반.

**판정**: 모양 A = **GO**. 모양 B = **NO-GO**.

### 2-D. xAI — **GO** (모양 A, 의무 조건 있음) / NO-GO (모양 B)

**[원문]** xAI Enterprise Terms of Service, Last Updated May 12, 2026

허용절(가장 명시적):

> "xAI grants Customer a limited, non-exclusive right to use xAI's application programming interfaces to develop an integration between the Services and Customer's products (the **"Bundled Services"**) and to: (a) **make available the Bundled Service to Customer's end users ("End-Users")**; and (b) demonstrate the Bundled Services to potential End Users. Customer will provide access to the Services to End-Users only in accordance with this Agreement. This grant does not create any direct contractual relationship between xAI and the End-Users. **Customer shall remain responsible to xAI for each End User.**"

금지절:

> **GENERAL RESTRICTIONS.** "Customer shall not, and shall not allow any third party (including any Permitted User and End-User) to: (a) **sell, rent, lease or use any Service for time sharing purposes**; …"

★**의무 조건**: "Customer shall ensure that its agreements with End-Users will contain an acceptable use policy, terms and…" — 즉 **우리 이용약관에 xAI AUP 를 전가(flow-down)해야 한다.** MVP 필수 항목이다(§7 M6).

**판정**: 모양 A = **GO**(약관이 우리 모양을 이름 붙여 허용한다). 모양 B = **NO-GO**.

### 2-E. Z.ai(GLM) — ★**NO-GO** (우리가 지금 쓰는 키 기준)

**[출처/2차]** Z.ai GLM Coding Plan 구독 약관:

> "you may not **resell, sub-resell, repackage, aggregate, proxy or otherwise provide the GLM Coding Plan to any third party**, whether on a paid or free basis, nor may you use the GLM Coding Plan **to provide model capabilities as a service to third parties**."
> "the GLM Coding Plan subscription is **tied to a single account and is licensed only to the individual natural person** associated with such account."

**[원문]** 반면 Z.ai 일반 Terms of Use(`docs.z.ai/legal-agreement/terms-of-use`) 에는 일반적 재판매 금지 조항이 **없다**. 있는 것은 수출통제 성격의 문장뿐이다("You may not resell, export, or transfer Z.ai products… to specific individuals or countries subject to regulatory restrictions").

→ **금지되는 것은 "Coding Plan 구독"이지 "오픈플랫폼 종량제 API" 가 아니다.** 그런데 **[코드]** `model-registry.ts:545` 가 붙는 곳이 바로 그 Coding Plan 축이다:

```ts
ANTHROPIC_BASE_URL: "https://api.z.ai/api/anthropic",
ANTHROPIC_AUTH_TOKEN: "${ZAI_API_KEY}",
```

**판정**: 현행 배선(Coding Plan 구독 키) = **NO-GO, 예외 없음**. 오픈플랫폼 pay-go 키로 갈아끼우면 재판정 대상이나, 그 API 계약은 이 문서가 **확인하지 못했다**(§10 한계).

### 2-F. MiniMax — **GO** (모양 A) / NO-GO (모양 B)

**[원문]** MiniMax Open Platform Terms of Service, **Effective March 30, 2026**

> "You… may not: … **(c) Independently sublicense, resell, or distribute any or all services outside of any integrated applications**; or (d) Access services in a manner that circumvents fees or otherwise evades usage restrictions."

"**outside of any integrated applications**" 이 카브아웃이다 — 통합 애플리케이션 **안에서는** 허용. OpenAI/xAI 와 같은 모양.

또 다른 절:

> "Except with express permission from us, you may not copy, imitate, modify, translate, adapt, lease, sell, sublicense, distribute over the internet, publish, or transfer any part of our products and services, **any access keys**, technical documents, API lists…"

→ 키 배포(모양 B)는 여기서 잘린다.

**[코드]** 현행 배선은 `https://api.minimax.io/anthropic` + `${MINIMAX_API_KEY}` (`model-registry.ts:625`). 이게 종량제 플랫폼 키인지 코딩 구독 키인지 **레지스트리 주석만으로는 확정할 수 없다**(주석은 "구독이면 실 한계비용은 ≈0" 이라고 적어 구독을 상정한다). §5-A 의 확인 항목.

**판정**: 오픈플랫폼 종량제 기준 모양 A = **GO**. 모양 B = **NO-GO**. 구독 키라면 Z.ai 와 같은 판정으로 떨어질 위험.

### 2-G. Moonshot Kimi — **GO** (플랫폼 종량제, 모양 A) / 현행 배선은 재확인 필요

**[원문]** Kimi OpenPlatform Terms of Service (`platform.kimi.ai/docs/agreement/modeluse`)

> "…**APIs** to integrate the Services into your own applications, products, or Services (each referred to as a **"Customer Application"**) and to **offer those Customer Applications to End Users**."
> 금지: "(9) …**buy, sell, or transfer API keys from, to or with a third party**." · "(6) Copying, transferring, renting, lending, selling, or providing sub-licensing or re-licensing of the Services in whole or in part without authorization."

**[코드]** 그런데 우리 배선은 플랫폼이 아니라 **Kimi Code 구독 콘솔**이다 — `model-registry.ts:726` 이 `https://api.kimi.com/coding/` + `${KIMI_API_KEY}` 를 쓰고, 같은 파일 주석이 명시한다: _"`MOONSHOT_API_KEY` 는 Kimi **Platform**(pay-go, api.moonshot.ai) 키의 공식 이름이고, 우리가 쓰는 것은 Kimi **Code Console** 의 구독 키다."_

**판정**: 플랫폼 종량제 = **GO**(모양 A). 현행 Code 구독 키 = **미확인, GLM 과 동류일 개연 높음 → 보수적으로 NO-GO 취급**.

### 2-H. ★2026-04-04 — #868 의 "회색"이 "사망"으로 바뀌었다

**[원문]** 위 §2-B 의 `legal-and-compliance` 문구 + **[2차]** VentureBeat·The Register 보도:

- 2026-04-04, 앤트로픽이 **서드파티 하네스가 Claude 구독(Free/Pro/Max) OAuth 로 요청을 라우팅하는 것을 차단**했다. OpenClaw·OpenCode·Roo Code·Goose 등의 소비자 OAuth 토큰이 막혔다.
- **공식 API 키·AWS Bedrock·Google Cloud 경유는 영향 없음.**

**함의 둘**:

1. **#868 §5-C 의 "모델 2/4(BYO 구독 토큰) = ToS 회색" 판정은 갱신되어야 한다.** 회색이 아니라 **명시적으로 금지**다. #868 이 인용한 devcontainer/Codespaces 선례는 "유저가 자기 도구로 자기 토큰을 쓰는" 케이스였고, "서드파티 제품이 유저 구독으로 라우팅하는" 케이스는 이제 문서에 못박혀 있다.
2. **그 대신 이 문서의 모양 A(우리 API 키)가 앤트로픽이 지시한 경로임이 확인됐다.** 즉 "구독 대납"은 죽었고 "API 대납"은 열렸다.

### 2-I. 판정표

| 벤더                          | 모양 A(번들: 우리 키로 우리 제품 안에서 소비)                        | 모양 B(유저에게 키/엔드포인트 제공) | 근거                     |
| ----------------------------- | -------------------------------------------------------------------- | ----------------------------------- | ------------------------ |
| **Anthropic**                 | **조건부 GO** — A.1 + Claude Code 법무문서가 API 키 경로를 직접 지시 | **NO-GO** (D.4 resell)              | [원문] 2025-06-17 / docs |
| **OpenAI**                    | **GO** — End User 정의에 "Customer Applications 사용자" 포함         | **NO-GO** (§3.3(g))                 | [원문] 2026-01-01 발효   |
| **xAI**                       | **GO** — "Bundled Service" 명시 (+AUP 전가 의무)                     | **NO-GO** (일반제한 (a))            | [원문] 2026-05-12        |
| **MiniMax(오픈플랫폼)**       | **GO** — "integrated applications 안에서는" 허용                     | **NO-GO**                           | [원문] 2026-03-30        |
| **Moonshot Kimi(플랫폼)**     | **GO** — Customer Application 명시                                   | **NO-GO** ((9))                     | [원문]                   |
| **Z.ai GLM Coding Plan**      | **NO-GO** — resell/repackage/proxy/"as a service" 전면 금지          | **NO-GO**                           | [2차, 구독약관]          |
| **Kimi Code 구독(현행 배선)** | **미확인 → 보수적 NO-GO**                                            | **NO-GO**                           | 미확인                   |
| **Grok 구독(SuperGrok)**      | **NO-GO** — 소비자 약관 "selling, reselling, distributing" 금지      | **NO-GO**                           | [2차]                    |
| **Claude/ChatGPT 구독 대납**  | **NO-GO** — 2026-04-04 차단                                          | **NO-GO**                           | [원문] docs + [2차] 보도 |

★**한 줄 요약**: 종량제 API = 번들이면 대체로 GO. **구독 = 전부 NO-GO.** 그리고 우리가 지금 배선해 둔 env-swap 3벤더는 전부 구독 쪽이다.

---

## 3. 마진 경제

### 3-A. ★도매가가 없다 — 이게 이 사업 모델의 근본 문제다

**[출처]** Anthropic 가격 문서 "Volume discounts":

> "Volume discounts may be available for high-volume users. **These are negotiated on a case-by-case basis.** Standard usage tiers use the pricing shown in Model pricing."

우리가 지금 살 수 있는 가격 = 유저가 직접 살 수 있는 가격 = **정가**. 즉 **마진 = 유저에게 정가보다 비싸게 파는 것**이다. 재판매업의 통상 구조(도매가에 사서 소매가에 판다)가 성립하지 않는다.

우리가 파는 것은 토큰이 아니라 **편의**다: 해외 카드 없이, USD 결제 없이, 콘솔 가입 없이, 원화로. 그 편의의 가격이 마크업이다. 이 프레이밍을 잃으면 숫자가 다 이상해진다.

### 3-B. 티켓 1건이 벤더별로 얼마인가 **[추정]**

**[코드]** `model-registry.ts` 의 라이브 단가표 + **[사내]** 태스크 중앙값 $5.11(cost 축 정합화 메모, taskId 조인 기준).

중앙값 $5.11 이 `claude-opus-5`($5/$25 per M) 에서 났다고 보고, Claude Code 워크로드의 통상 비율인 **input:output ≈ 20:1** 을 가정해 토큰 프로필을 역산하면 output ≈ 40.9k, input ≈ 818k. 이 프로필을 그대로 다른 벤더 단가에 대입한다.

| 모델              | in/out ($/M)  | 티켓 1건 [추정] | opus-5 대비 |
| ----------------- | ------------- | --------------: | ----------: |
| claude-fable-5    | 10 / 50       |          $10.22 |       2.00× |
| **claude-opus-5** | **5 / 25**    |       **$5.11** |   **1.00×** |
| gpt-5.6-sol       | 5 / 30        |           $5.31 |       1.04× |
| claude-sonnet-5   | 3 / 15        |           $3.07 |       0.60× |
| gpt-5.6-terra     | 2.5 / 15      |           $2.66 |       0.52× |
| grok-4.5          | 2 / 6         |           $1.88 |       0.37× |
| glm-5.2           | 1.4 / 4.4     |           $1.32 |       0.26× |
| gpt-5.6-luna      | 1 / 6         |           $1.06 |       0.21× |
| claude-haiku-4.5  | 1 / 5         |           $1.02 |       0.20× |
| kimi-for-coding   | 0.95 / 4.0    |           $0.94 |       0.18× |
| MiniMax-M3        | 0.6 / 2.4     |           $0.59 |       0.12× |
| glm-4.7           | 0.6 / 2.2     |           $0.58 |       0.11× |
| **MiniMax-M2.7**  | **0.3 / 1.2** |       **$0.29** |   **0.06×** |

**★17배 스프레드가 이 사업의 전부다.** 마진이 존재할 수 있는 구간은 표의 아래쪽뿐이다.

### 3-C. 원화 마진 모델 **[추정]**

가정: 환율 **₩1,400/$** · PG **토스페이먼츠 일반 카드 3.4%**[출처] + 수수료 부가세 10% → 실효 **3.74%** · 우리가 USD 로 토큰을 살 때의 해외결제·환전 비용 **1.5%**.

충전 ₩10,000 기준:

| 마크업 | 유저가 받는 토큰(정가 $) | 우리 원가(₩) | PG 차감 후 수취(₩) | **마진(₩)** |   마진율 |
| -----: | -----------------------: | -----------: | -----------------: | ----------: | -------: |
|     0% |                    $7.14 |       10,150 |              9,626 |    **−524** |     적자 |
|  ★5.4% |                    $6.77 |        9,626 |              9,626 |       **0** | 손익분기 |
|    20% |                    $5.95 |        8,458 |              9,626 |   **1,168** |    11.7% |
|    30% |                    $5.50 |        7,808 |              9,626 |   **1,818** |    18.2% |
|    50% |                    $4.76 |        6,766 |              9,626 |   **2,860** |    28.6% |

**결론 둘**:

1. **마크업 5.4% 미만은 적자다.** "원가에 살짝만 얹어서"는 PG 수수료에 먹힌다.
2. 마크업 30% 에서 ₩10,000 이 사 주는 것:

| 모델            | ₩10,000(마크업 30%)으로 도는 티켓 수 |
| --------------- | -----------------------------------: |
| claude-opus-5   |                            **1.1건** |
| claude-sonnet-5 |                                1.8건 |
| grok-4.5        |                                2.9건 |
| claude-haiku    |                                5.4건 |
| glm-4.7 / M3    |                             9\~9.5건 |
| MiniMax-M2.7    |                           **19.0건** |

### 3-D. ★유저 관점 — 프론티어 모델에서는 우리가 이길 수 없다

| 선택지                          |         유저 지출 | 얻는 것                         |
| ------------------------------- | ----------------: | ------------------------------- |
| 마블로 충전(마크업 30%, opus-5) |           ₩10,000 | 티켓 **약 1건**                 |
| 앤트로픽 API 직접 결제          |           ₩10,000 | 티켓 약 1.4건                   |
| **Claude Pro 구독**             | **₩28,000**(≈$20) | 통상 개인 사용 한도 내 **다수** |

즉 **티켓을 3\~4건만 넘겨 돌리면 구독이 압도한다.** 우리 온램프는 구조적으로 **"구독을 만들기 전 첫 한두 건"** 구간에서만 유효하다. 그 구간의 총 지불의사액은 유저당 ₩10,000\~20,000 수준이고, 마진은 유저당 **₩2,000\~4,000**.

#850 의 `/download` 월 141명이 **전원** 충전한다는 비현실적 가정에서도 월 매출총이익 ≈ **₩28만\~56만**. 이건 사업이 아니라 **CAC 회수분**이다.

**마진이 실제로 나는 유일한 구간은 §3-B 표 아래쪽(초저가 모델)이다.** MiniMax-M2.7 이면 ₩10,000 이 19티켓이라 "체험팩"으로 말이 된다. 그러나 **그 모델들의 실제 티켓 완주 품질은 우리 fleet 에서 검증된 적이 없다**(사내 관찰: 저가 모델·타 벤더는 조사/단순 작업엔 되고 복잡한 in-repo 코딩에선 산출이 없었다). 첫 경험을 저품질 모델로 주면 활성화 실험 자체가 오염된다 — **이 안의 목적과 정면 충돌**한다.

### 3-E. 최소 충전단위 · 환불 · 규제 **[추정/출처]**

| 항목                  | 판정                                                                                                                                                                                                                           |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 최소 충전단위         | **₩5,000\~10,000**. PG 는 정률(3.4%)이라 소액도 성립하나, 토스페이먼츠 **연 관리비 ₩110,000**[출처] 을 마진 18%로 회수하려면 연 ₩61만 결제고가 필요 — 연 61건 충전. 낮은 문턱이지만 0 은 아니다                                |
| 미사용 잔액           | **부채**다. 전자상거래법상 미사용분 환불 요구가 가능하므로 잔액을 매출로 잡을 수 없다. 원장 설계에 환불 경로 필수                                                                                                              |
| 선불전자지급수단 등록 | **불필요**로 판단. 법 정의가 "**발행인 외의 제3자**로부터 재화·용역을 구입하는 데 사용"인데 마블로 크레딧은 발행인(우리) 서비스에서만 쓰인다. 2024-09-15 시행 면제기준(발행잔액 30억·연 총발행 500억)에도 한참 못 미친다[출처] |
| 부가세                | B2C 국내 판매 = 10% 과세. **정가 대비 마크업을 계산할 때 VAT 포함/별도를 혼동하면 마진이 통째로 사라진다** — §3-C 표는 VAT 별도 기준                                                                                           |
| 결제 배관             | **절반 있다.** 포트원 구독 결제는 웹에 살아 있다(#820\~#826 saga). **앱 단건/충전 결제 경로는 없다**                                                                                                                           |

### 3-F. 원가를 낮추는 레버 **[출처]**

| 레버                 | 효과                                                              | 우리에게 쓸 수 있나                                              |
| -------------------- | ----------------------------------------------------------------- | ---------------------------------------------------------------- |
| **프롬프트 캐싱**    | 캐시 히트 = 기본 input 의 **0.1×**(5분 쓰기 1.25×, 1시간 쓰기 2×) | ✅ Claude Code 가 이미 쓴다. 단 **유저가 직접 써도 똑같이 싸다** |
| **Batch API**        | input/output **50% 할인**                                         | ❌ 비동기 전용. 라이브 오케 UX 와 양립 불가                      |
| **볼륨 할인**        | 개별 협상                                                         | ❌ 지금 규모로는 협상 테이블에 못 감                             |
| **저가 모델 라우팅** | 최대 17배(§3-B)                                                   | ⚠️ 유일하게 실효 있는 레버. 품질 리스크(§3-D)                    |

★**캐싱이 마진을 못 만든다**는 점이 중요하다. 캐싱은 우리 원가도 유저 원가도 똑같이 낮춘다 — 차익이 아니라 공통 할인이다.

---

## 4. 벤더 선택 — (ToS 허용) ∩ (하네스 호환) ∩ (마진 가능)

| 벤더              | ToS(모양 A)            | 하네스 호환                              |   티켓 단가 | 마진 여지              | 종합                              |
| ----------------- | ---------------------- | ---------------------------------------- | ----------: | ---------------------- | --------------------------------- |
| **Anthropic**     | 조건부 GO              | ★네이티브(우리 기본 하네스)              |       $5.11 | 없음(정가·구독이 이김) | 품질 최고 · 경제성 최악           |
| **OpenAI**        | GO                     | 있음(codex 하네스, 별도 배선)            |       $5.31 | 없음                   | Anthropic 과 같은 문제            |
| **xAI**           | GO(가장 명시적)        | 있음(Shape A 네이티브, 스폰 이슈 이력)   |       $1.88 | 얇음                   | ToS 는 최고. 단가 중간            |
| **MiniMax**       | GO(플랫폼)             | ★env-swap 1행(단, 구독→pay-go 전환 필요) | $0.29\~0.59 | **있음**               | **MVP 1순위 후보**                |
| **Moonshot Kimi** | GO(플랫폼)             | env-swap(단, 현행은 Code 구독 키)        |       $0.94 | 있음                   | 2순위                             |
| **Z.ai GLM**      | **NO-GO**(Coding Plan) | env-swap 1행                             | $0.58\~1.32 | —                      | **제외**(pay-go 계약 확인 전까지) |

**★ToS·하네스·마진 세 조건을 동시에 만족하는 유일한 칸 = MiniMax 오픈플랫폼(pay-go).** 다음이 Kimi 플랫폼. 그러나 §3-D 대로 **거기서 나오는 품질이 활성화 실험을 오염시킬 위험**이 이 선택의 대가다.

만약 "첫 경험은 반드시 최고 품질이어야 한다"면 벤더는 Anthropic 이 되고, 그 순간 **마진은 0 이하로 확정**된다(= CAC 지출). 이 트레이드오프가 이 안의 본질이며, 우회로가 없다.

---

## 5. 엔지니어링 — 왜 "API 키 프로비저닝"이 불가능한가

### 5-A. ★데스크탑 앱이라 우리 키를 유저 머신에 못 내린다

마블로는 Electron 데스크탑 앱이고, 에이전트는 **유저 머신의 로컬 프로세스**로 스폰된다. env 로 내려간 크레덴셜은 유저가 `ps -E`·프로세스 덤프·간단한 래퍼로 **읽을 수 있다.** 우리 벤더 API 키를 그렇게 내려보내면:

- 유저 1명이 우리 계정 전체 한도를 소진 가능 (하드캡이 서버에 없다면 무제한)
- 키가 유출되는 순간 우리가 **문자 그대로 API 재판매업자**가 된다 → §2 의 모양 B → 전 벤더 위반

**따라서 모양 B 는 기술적으로도 불가하다.** 유일하게 가능한 구현은 **마블로가 운영하는 계량 프록시**다.

### 5-B. 프록시 배선은 env-swap 축 그대로다 **[코드]**

역설적으로 **가장 쉬운 부분**이 이거다. `model-registry.ts` 의 벤더 프로파일은 이미 이 모양이다:

```ts
{ id: "glm-5.2", harness: "claude", provider: "zai",
  envProfile: { ANTHROPIC_BASE_URL: "https://api.z.ai/api/anthropic",
                ANTHROPIC_AUTH_TOKEN: "${ZAI_API_KEY}" } }
```

마블로 프록시 행은 **같은 모양의 행 1개**다:

```ts
{ id: "marblo-hosted-<model>", harness: "claude", provider: "marblo",
  envProfile: { ANTHROPIC_BASE_URL: "https://api.marblo.app/anthropic",
                ANTHROPIC_AUTH_TOKEN: "${MARBLO_CREDIT_TOKEN}" } }
```

**하네스 코드 0줄.** GLM(PR#609)·MiniMax·Kimi(PR#626)가 이미 증명한 (B)형 편입 비용이 그대로 적용된다. 티켓이 기대한 "env-swap 축 재사용"은 **정확히 성립한다.**

### 5-C. ★그런데 그 토큰도 유저 머신에 있다 — 이게 진짜 노출이다

프록시로 바꿔도 `MARBLO_CREDIT_TOKEN` 은 유저 머신 env 에 앉는다. 유저가 그 토큰으로 `curl https://api.marblo.app/anthropic/v1/messages` 를 직접 때리면, 우리는 **크레딧 잔액을 파는 Anthropic 호환 API 사업자**가 된다. §2-B 의 D.4 노출이 여기서 실체화된다.

완화는 가능하나 완전 차단은 불가능하다:

| 완화                                        | 효과                                                |
| ------------------------------------------- | --------------------------------------------------- |
| **스폰당 단명 토큰**(TTL 분 단위, 1회 세션) | 큼. 토큰을 훔쳐도 수명이 짧다                       |
| **서버측 하드캡**(유저당 잔액·동시성·RPS)   | 필수. 금전 손실 상한을 확정                         |
| **하네스 지문 검증**(UA·헤더·요청 형태)     | 중간. 우회 가능하나 우발적 남용은 막음              |
| **이상탐지**(비-Marblo 트래픽 패턴)         | 중간                                                |
| **우리 이용약관에 재판매 금지 전가**        | 법적으로 필수(xAI 는 명시 의무). 기술적 방어는 아님 |

### 5-D. ★과금등급 미터가 지금 **없다**

크레딧을 팔려면 "이 유저가 방금 얼마 썼는가"를 **정확히, 중복 없이, 실시간으로** 알아야 한다. 현재 `cost_logs` 는 그게 아니다(사내 실측):

- 1행 = **15초 폴링 델타**(턴 단위 아님)
- **멱등키 없음** → 재읽기 중복 발생(8월 데이터 32%가 가공 행)
- `taskId=null` 행 존재 → 전역 SUM 금지
- `totalCost` = **구독을 무시한 list-price 추정치**

즉 지금 것은 **텔레메트리지 원장이 아니다.** 과금은 프록시가 **자기 응답의 `usage` 를 원장에 직접 기록**하는 축으로만 옳게 만들어진다. → **프록시는 편의가 아니라 과금의 전제조건**이다. 그리고 그 원장은 불변원장(update 금지) + 멱등 재시도 규칙을 그대로 따라야 한다.

---

## 6. #868 과의 관계 — 이건 어떤 변종인가

#868(`cloud-hosted-feasibility`)은 인증 모델 4가지를 나눴다: 1=우리 호스팅 토큰 / 2=BYO 구독 토큰 / 3=BYO API 키 / 4=컨테이너 내 device 로그인.

**이 안 = 모델 1 + 결제.**

| 축            | #868 모델 1 (Cloud Try)              | 이 안 (재판매 온램프)                              |
| ------------- | ------------------------------------ | -------------------------------------------------- |
| 토큰 부담     | 우리                                 | 우리 (유저가 사후 정산)                            |
| 유저 결제     | **없음**                             | **있음** — PG·세무·환불·잔액부채가 새로 붙는다     |
| 실행 위치     | 우리 컨테이너                        | **유저 데스크탑**(그래서 프록시 필요, §5-A)        |
| ToS 리스크    | #868 표기 "없음(우리 키)"            | 같은 우리 키인데 **대가를 받아서** D.4 경계로 이동 |
| 하드캡        | 세션 20분·$0.50                      | 잔액 = 캡                                          |
| 무엇을 사는가 | "설치를 없애면 전환이 오르는가" 가설 | 위 가설 + "돈을 낼 것인가" 가설                    |

**#868 이 이미 내린 판정 하나가 그대로 유효하다**: 모델 1 은 **캡 없이는 불가**(완료 티켓 실비 $3.85\~$13.90 vs 시장 호스티드 세션가 ≈$0.04, 100\~400배). 이 안은 캡을 "유저가 낸 돈"으로 바꾼 것이고, §3-D 대로 그 돈은 **티켓 1건분**이다.

**중복 아님·충돌 아님**: 이 안은 #868 §10 MVP 의 **후속 유료화 단계**로 정확히 끼워진다(#868 §12 의 S7 → 이 안). 순서를 뒤집으면 — 결제부터 붙이면 — 증명 안 된 가설에 결제·세무·법무 비용을 먼저 태우는 것이 된다.

---

## 7. MVP 스케치 (만든다고 가정했을 때)

**전제**: 벤더 1개(MiniMax pay-go 또는 xAI) · 모양 A · 유저에게 키 노출 0 · 하드캡.

| #   | 항목                          | 내용                                                                                                                 | 규모  |
| --- | ----------------------------- | -------------------------------------------------------------------------------------------------------------------- | ----- |
| M1  | **계량 프록시**               | Cloud Run. Anthropic 호환 `/v1/messages` 패스스루 + 유저별 인증 + 응답 `usage` 기준 잔액 차감 + 하드캡 + 동시성 제한 | **L** |
| M2  | **크레딧 원장**               | Firestore 불변원장(충전/차감/환불). 멱등키 필수. `cost_logs` 와 **분리**(그건 텔레메트리)                            | M     |
| M3  | **결제**                      | 포트원 단건/충전(앱 경로 신규) + 환불 정책 + 세금계산                                                                | M     |
| M4  | **레지스트리 행 + 토큰 발급** | `provider: "marblo"` 행 1개 + 스폰 시 단명 토큰 발급/폐기 (`applyVendorEnv` 경로 재사용)                             | **S** |
| M5  | **UI**                        | 잔액 표시·충전·소진 경고·소진 시 graceful 정지                                                                       | M     |
| M6  | **약관**                      | 우리 이용약관에 벤더 AUP 전가(xAI 명시 의무) + 재판매 금지 + 환불 조항                                               | S     |
| M7  | **게이트 배선**               | `spawnNewAgent` 초크포인트에 잔액 게이트(dispatch·HTTP·미션이 UI 를 우회하므로 여기여야 함)                          | S     |

**총 규모: 대(L).** 이 중 M4 만 "env-swap 축 재사용"으로 싸고, 나머지는 전부 신규다. 티켓이 기대한 "env-swap 재사용으로 싸게"는 **배선 한 축에 대해서만 맞다**.

---

## 8. 리스크

| #   | 리스크                                                            | 심각도 | 완화                                                        |
| --- | ----------------------------------------------------------------- | ------ | ----------------------------------------------------------- |
| R1  | **D.4 "resell" 해석** — 우리 프록시가 문면상 passthrough          | 높음   | 유저 키 노출 0 · 단명 토큰 · 서면 확인(§2-B)                |
| R2  | **크레덴셜 유출 = 무제한 지출** (유저 머신 env)                   | 높음   | 서버측 하드캡. 캡이 없으면 사고가 무한대                    |
| R3  | **계량 오차가 곧 손실** — 지금 `cost_logs` 는 중복·추정치         | 높음   | 프록시 원장이 유일 진실. 텔레메트리와 분리(§5-D)            |
| R4  | **마진이 CAC 수준** — 유저당 ₩2,000\~4,000                        | 높음   | 사업이 아니라 획득비용으로 회계 처리. 기대치를 미리 낮출 것 |
| R5  | **저가 모델 품질이 첫인상을 망침** — 활성화 실험 오염             | 높음   | 프론티어 모델은 마진 0. 트레이드오프에 우회로 없음(§3-D)    |
| R6  | **구독키로 배선된 현행 env-swap 을 그대로 쓰면 즉시 ToS 위반**    | 높음   | pay-go 키로 갈아끼우기 전 절대 켜지 말 것(§2-E·§2-G)        |
| R7  | **벤더 가격 인상·모델 교체를 우리가 흡수**                        | 중간   | 크레딧을 "원화 금액"이 아니라 "토큰/티켓 수량"으로 판매     |
| R8  | **미사용 잔액 환불 청구**                                         | 중간   | 잔액을 매출 인식하지 않음. 환불 경로를 M2 에 내장           |
| R9  | **PG 심사** — "AI 토큰 판매" 업종 코드·정산 리스크                | 중간   | 사전 확인. 기존 구독 가맹점 계약 범위 밖일 수 있음          |
| R10 | **유저가 3티켓 만에 구독으로 이탈** — 설계상 정상이나 LTV 가 없음 | 중간   | 그래서 이건 온램프지 SKU 가 아니다. 구독 전환을 성공 지표로 |
| R11 | **부가세·정가 혼동으로 마진 소멸**                                | 낮음   | §3-C 를 VAT 별도로 못박고 가격표를 그 기준으로              |

---

## 9. 추천

### **보류 (Hold)**

세 선택지를 명시하고 고른다.

| 선택지                  | 무엇                                                                | 판정                                                                                         |
| ----------------------- | ------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| **지금 간다**           | 프록시+원장+결제까지 지어 재판매 온램프 출시                        | ❌ 증명 안 된 가설(§6)에 L 규모 + 법무/세무 위험을 선지출                                    |
| **토스만**(결제 배관만) | 포트원/토스 단건·충전 배관만 깔고 토큰 재판매는 하지 않음           | ⚠️ **차선.** 배관은 유료 SKU 에 어차피 필요하다. 단 이 티켓의 질문(재판매)에는 답하지 않는다 |
| **★보류**               | 재판매는 착수하지 않고, #868 Cloud Try(무료·하드캡)로 가설부터 산다 | ✅ **추천**                                                                                  |

**근거 넷**:

1. **마진이 사업이 아니다.** 도매가가 없어서(§3-A) 마진 = 정가 대비 마크업이고, 프론티어 모델에서는 ₩10,000 이 티켓 1건이며 3\~4건만 넘어도 $20 구독이 이긴다(§3-D). 유저당 마진 ₩2,000\~4,000 은 CAC 지 매출이 아니다.
2. **마진이 나는 유일한 구간이 목적과 충돌한다.** 초저가 모델(§3-B 아래쪽)에서만 마진이 나는데, 그 품질로 첫 경험을 주면 "설치를 없애면 전환이 오르는가"라는 실험 자체가 오염된다(§3-D·R5).
3. **가장 싼 부분만 재사용 가능하다.** env-swap 축 재사용은 사실이지만 그건 M4(S) 하나고(§5-B), 프록시·원장·결제·약관은 전부 신규다(§7). 그리고 **프록시 없이는 아예 불가능**하다 — 데스크탑이라 키를 못 내리고(§5-A), 과금등급 미터가 없다(§5-D).
4. **같은 지문을 위험 0으로 사는 방법이 이미 문서화돼 있다.** #868 §10 Cloud Try = 우리 키 + 하드캡 + 결제 없음, 월 $80 수준. 결제를 붙이는 건 그 실험이 성공한 **뒤에** 할 일이다(§6).

### 그래도 "지금 간다"를 고를 경우 — 최소 안전 변종

사장님이 착수를 지시하면, 아래 6개를 **전부** 지킨 형태로만 간다:

1. **벤더 1개**: MiniMax 오픈플랫폼 **pay-go**(또는 xAI). GLM Coding Plan·Kimi Code 구독 키는 **절대 사용 금지**(§2-E·§2-G)
2. **모양 A 만**: 유저에게 API 키·엔드포인트를 어떤 형태로도 주지 않는다
3. **마블로 계량 프록시 필수** + 스폰당 단명 토큰(§5-C)
4. **서버측 하드캡** — 잔액·동시성·RPS. `spawnNewAgent` 초크포인트에(§7 M7)
5. **불변 원장 + 멱등키**, `cost_logs` 와 분리(§5-D)
6. **우리 약관에 벤더 AUP 전가**(xAI 명시 의무) + 환불 조항(§2-D·§3-E)

그리고 **앤트로픽 모델을 이 경로에 태우기 전에는 sales 서면 확인**을 받는다(§2-B). 확인 전에는 GO 벤더로만 돈다.

### 후속 티켓(안)

| #   | 티켓                                                                 | role    | 규모 | 판정 기준                                                   |
| --- | -------------------------------------------------------------------- | ------- | ---- | ----------------------------------------------------------- |
| A1  | **[결정] 사장님 리뷰 — 보류/토스만/지금간다**                        | —       | —    | 이 문서 §9                                                  |
| A2  | **[법무] Anthropic sales 서면 확인** (모양 A 로 유저 결제 허용 여부) | —       | —    | #868 S8 과 통합. 유료 확장의 전제                           |
| A3  | **[조사] 현행 env-swap 3벤더 키 종류 확정** (구독 vs pay-go)         | backend | S    | GLM/MiniMax/Kimi 각각. **재판매 여부와 무관하게 지금 필요** |
| A4  | **[선행] #868 Cloud Try MVP**                                        | —       | —    | 이 안의 전제 가설을 결제 없이 검증                          |
| A5  | (지금간다 선택 시) **계량 프록시 PoC**                               | backend | L    | §7 M1. 판정: 티켓 1건이 프록시 경유로 완주 + 원장 오차 0    |

---

## 10. 한계 · 정직성

- **법률 자문이 아니다.** 공개 약관 원문 인용과 그 문구를 우리 모양에 대본 결과다. 특히 §2-B 의 "조건부 GO" 는 D.4 의 "resell" 을 좁게 읽은 것이고, 앤트로픽이 넓게 읽을 가능성을 배제하지 못한다.
- **Z.ai Coding Plan 조항은 [2차]다.** 검색 결과가 인용한 문구를 그대로 옮겼고, Z.ai 의 Coding Plan 전용 약관 페이지 원문을 직접 열지는 못했다(`docs.z.ai/legal-agreement/*` 의 공개 페이지에는 해당 조항이 없다). **Z.ai 오픈플랫폼 API 계약도 확인하지 못했다.**
- **Kimi Code 구독 약관을 확인하지 못했다.** 플랫폼(pay-go) 약관만 원문으로 읽었고, Code 구독은 GLM 과 동류일 개연으로 보수적 NO-GO 처리했다 — 확정이 아니다.
- **2026-04-04 하네스 차단은 시점·대상이 [2차]다.** 다만 그 정책 자체는 `code.claude.com/docs/en/legal-and-compliance` [원문]으로 확인된다.
- **§3-B 의 티켓 단가는 추정이다.** 중앙값 $5.11 은 실측이지만, 거기서 토큰을 역산할 때 **input:output = 20:1** 을 가정했다. 실제 캐시 히트 비율에 따라 역산 토큰 수가 달라지고, 벤더 간 상대비는 유지되지만 절대값은 흔들린다.
- **$5.11 자체가 list-price 추정치**다(구독을 무시한 값). 다만 이 논점(우리가 API 로 대신 낸다)에서는 그 값이 맞는 축이다.
- **환율 ₩1,400/$ 와 해외결제 1.5% 는 가정**이다. PG 수수료 3.4% 는 공시 일반 요율이며, 실제 요율은 가맹점 계약·등급에 따라 다르다(영세 0.63%\~).
- **저가 모델 품질 주장은 사내 관찰 기반이며 이 문서가 측정하지 않았다.** MiniMax-M2.7 로 실제 티켓 완주율을 재 본 적이 없다 — R5 의 크기를 모른다.
- **선불전자지급수단 판정은 법 정의 대조 수준**이다. 실제 사업 개시 전 확인이 필요하다.
- 날조 없음. §11 의 URL 은 전부 직접 열었고, 코드 인용은 파일·행으로 확인 가능하다.

---

## 11. 출처

**벤더 1차 약관 (2026-08-09 직접 열람)**

| 사실                                                                                              | URL                                             |
| ------------------------------------------------------------------------------------------------- | ----------------------------------------------- |
| Anthropic Commercial ToS A.1(제품 구동 허용) · D.4(재판매 금지) · Effective 2025-06-17            | `anthropic.com/legal/commercial-terms`          |
| ★Claude Code 법무문서 — "제품 개발자는 API 키 인증을 쓰라" · 구독 라우팅 불허                     | `code.claude.com/docs/en/legal-and-compliance`  |
| Anthropic 가격 — 캐시 0.1x/1.25x/2x · Batch 50% · 볼륨할인 개별협상                               | `docs.claude.com/en/docs/about-claude/pricing`  |
| OpenAI Services Agreement — End User/Customer Application 정의 · §3.1 · §3.3(g) · 2026-01-01 발효 | `openai.com/policies/services-agreement/`       |
| xAI Enterprise ToS — Bundled Service 허용 · GENERAL RESTRICTIONS (a) · 2026-05-12                 | `x.ai/legal/terms-of-service-enterprise`        |
| MiniMax Open Platform ToS — "outside of any integrated applications" · 2026-03-30                 | `platform.minimax.io/protocol/terms-of-service` |
| MiniMax 통합 ToS(2026-04-15) — 제품별 약관 링크 구조                                              | `minimax.io/terms-of-service-v2.html`           |
| Kimi OpenPlatform ToS — Customer Application 허용 · API 키 이전 금지                              | `platform.kimi.ai/docs/agreement/modeluse`      |
| Z.ai Terms of Use — 일반 재판매 금지 조항 **부재** 확인                                           | `docs.z.ai/legal-agreement/terms-of-use`        |
| Z.ai Subscription Terms — 요금·갱신(재판매 조항은 이 페이지에 없음)                               | `docs.z.ai/legal-agreement/subscription-terms`  |

**[2차] 언론·요약 (원문 미확인)**

| 사실                                                           | 출처                                                                                          |
| -------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| 2026-04-04 서드파티 하네스 구독 OAuth 차단(시점·대상 목록)     | VentureBeat "Anthropic cracks down on unauthorized Claude usage…" · The Register (2026-02-20) |
| Z.ai GLM Coding Plan 재판매·전대 금지 문구                     | Z.ai 구독약관 인용(검색 경유)                                                                 |
| xAI 소비자 약관 "selling, reselling, distributing" 금지        | `x.ai/legal/terms-of-service`(소비자)                                                         |
| 토스페이먼츠 일반 카드 3.4% · 연 관리비 ₩110,000 · 등급별 요율 | 포트원 PG 비교(2026) · 토스 가맹점 고지                                                       |
| 선불전자지급수단 정의 · 2024-09-15 시행 면제기준(30억/500억)   | 전자금융거래법 · 금융위 보도자료 · 로펌 해설                                                  |

**사내 근거**

| 사실                                                           | 위치                                                                |
| -------------------------------------------------------------- | ------------------------------------------------------------------- |
| 모델별 per-token 단가(라이브 단일소스)                         | `v3/electron/model-registry.ts` (359\~798행)                        |
| GLM/MiniMax/Kimi env-swap 배선이 **구독 엔드포인트**임         | `v3/electron/model-registry.ts:545,625,726`                         |
| `${ENV}` 자리표시자 규율 · 부분주입 금지                       | `v3/electron/model-registry.ts:183` · `agent-config.applyVendorEnv` |
| 클라우드 인증 모델 4종 · 모델 1 캡 없이는 불가 · Cloud Try MVP | `v3/docs/cloud-hosted-feasibility-2026-08-08.md` (#868)             |
| 활성화 퍼널 141→6 · 완료 4건 실비 $3.85\~$13.90                | `v3/docs/activation-friction-diagnosis-2026-08-07.md` (#850)        |
| 태스크 비용 중앙값 $5.11 (taskId 조인)                         | 사내 BQ 비용축 정합화                                               |
| `cost_logs` = 15초 폴 델타 · 멱등키 없음 · list-price 추정     | 사내 BQ 텔레메트리 의미론                                           |
| Pro ₩19,000 / Team ₩29,000                                     | `v3/docs/PRICING-AND-COST-SAFETY-SPEC.md` §4.2                      |
| (B)형 벤더 편입 = 레지스트리 행 2개·코드 0줄                   | PR#609(GLM) · PR#626(Kimi) · `VENDOR-EXPANSION-SURVEY.md`           |
| 스폰 게이트는 `spawnNewAgent` 초크포인트에 둬야 함             | 사내 결정(#660)                                                     |
| 포트원 구독 결제 배선 존재 · 앱 단건 결제 부재                 | 포트원 빌링 saga(#820\~#826)                                        |
