# 온램프 P0 — 현행 env-swap 3벤더 키 종류 확정(구독 vs pay-go)

**티켓** FkNBM6qz4zq66PnywTgx · **조사일** 2026-08-11 · **코드 변경 0**
**상위 문서** `v3/docs/api-reseller-onramp-feasibility-2026-08-09.md` (이하 "정본") §2-I
**목적** L2 유료 온램프 GO 판정의 P0 선행. 재판매 합법성이 "우리가 쥔 키가 구독이냐 pay-go 냐"에 걸린다. **구독 = 전 벤더 NO-GO**, pay-go 만 GO 가능.

---

## 0. 한 줄 결론

**현행 배선된 3벤더 중 GLM·Kimi 는 구독 엔드포인트가 [원문]으로 확정됐고(재판매 NO-GO), MiniMax 만 엔드포인트가 중립이라 키만 pay-go 로 바꾸면 코드 변경 0 으로 GO 후보가 된다.**

그리고 정본이 예상하지 못한 비대칭이 하나 나왔다: **pay-go 로 갈아타는 비용이 벤더마다 다르다.**

| 벤더        | pay-go 전환 비용                                                        |
| ----------- | ----------------------------------------------------------------------- |
| **MiniMax** | **env 값 1개 교체** (엔드포인트 동일)                                   |
| **Kimi**    | **레지스트리 행 데이터 수정** (엔드포인트·모델 id 교체, 배선 모양 동일) |
| **GLM**     | ★**불가에 가까움** — pay-go 축에 Anthropic 호환 엔드포인트가 없다       |

---

## 1. 방법 · 출처 등급

- **[원문]** = 이번 조사에서 벤더 공식 문서를 직접 열어 인용. 아래 §7 에 URL 전부 기재.
- **[코드]** = 이 저장소 파일·행.
- **[프로브]** = 2026-08-11 무인증 라이브 요청의 응답.
- **[미확인]** = 확인하지 못함. **추정으로 메우지 않았다.**

★**이 문서가 확인하지 않은 것 하나를 먼저 밝힌다**: 우리 계정이 실제로 어떤 종류의 키를 쥐고 있는지는 **벤더 콘솔 로그인이 필요해 확인하지 못했다**. 이 워크트리엔 `v3/.env` 파일 자체가 없고(존재 여부만 확인, 값 열람 없음), 키 문자열은 어차피 종류를 말해주지 않는다. 그래서 아래 판정은 **"우리가 배선한 엔드포인트가 어느 과금축의 것인가"** 를 확정한 것이고, 계정 상태 확인은 §5 의 사장님 액션으로 뺐다.

---

## 2. 벤더별 판정표

| 벤더        | 현행 배선 엔드포인트 [코드]        | 인증 방식                       | **판정**                                                        | 재판매 경로에 쓸 수 있나              |
| ----------- | ---------------------------------- | ------------------------------- | --------------------------------------------------------------- | ------------------------------------- |
| **GLM**     | `https://api.z.ai/api/anthropic`   | `ANTHROPIC_AUTH_TOKEN` (Bearer) | ★**구독 확정** — GLM Coding Plan **전용(dedicated)** 엔드포인트 | **NO** (구독약관 다중사용자 금지)     |
| **MiniMax** | `https://api.minimax.io/anthropic` | `ANTHROPIC_AUTH_TOKEN` (Bearer) | ★**엔드포인트 중립** — 구독/pay-go 를 **키 종류**가 가른다      | **조건부 YES** — pay-go 키일 때만     |
| **Kimi**    | `https://api.kimi.com/coding/`     | `ANTHROPIC_AUTH_TOKEN` (Bearer) | ★**구독 확정** — Kimi Code 멤버십 전용 플랫폼                   | **NO** (재판매·리버스프록시 명시금지) |

**우리 계정의 실제 키 종류**: GLM `[미확인→구독으로 강하게 추정]`(엔드포인트가 구독 전용이므로 그 키로 돌고 있다면 구독키다) · MiniMax **[미확인]** · Kimi `[미확인→구독 확정]`(엔드포인트가 구독 전용).

[프로브] 2026-08-11, 4개 엔드포인트 전부 무인증 POST 에 **401 응답 = 실재 확인**:

| 엔드포인트                              | 응답                                                              |
| --------------------------------------- | ----------------------------------------------------------------- |
| `api.z.ai/api/anthropic/v1/messages`    | 401 `Authentication parameter not received in Header` (type 1001) |
| `api.minimax.io/anthropic/v1/messages`  | 401 `authentication_error` · Anthropic 에러 봉투                  |
| `api.kimi.com/coding/v1/messages`       | 401 `authentication_error` · Anthropic 에러 봉투                  |
| `api.moonshot.ai/anthropic/v1/messages` | 401 `incorrect_api_key_error`                                     |

★프로브가 증명하는 것은 **엔드포인트 실재와 프로토콜 일치**뿐이다. **구독/pay-go 를 가르지 못한다** — 그 판정은 전부 아래 [원문] 근거에서 나온다.

---

## 3. 벤더별 상세 · 근거

### 3-A. GLM (Z.ai) — ★구독 확정

**현행 배선** [코드] `v3/electron/model-registry.ts:545-546` (`glm-5.2`), `:576-577` (`glm-4.7`)

```ts
ANTHROPIC_BASE_URL: "https://api.z.ai/api/anthropic",
ANTHROPIC_AUTH_TOKEN: "${ZAI_API_KEY}",
```

**근거 ①(결정적)** [원문] `docs.z.ai/guides/develop/http/introduction` — 일반(pay-go) API 문서가 자기 엔드포인트를 이렇게 적고, 곧바로 경고를 붙인다:

> **General API Endpoint**: `https://api.z.ai/api/paas/v4/`
> ⚠️ "When using GLM Coding Plan, please follow the tutorial to configure **your dedicated endpoint**."

→ **일반 종량제 엔드포인트는 `/api/paas/v4/` 이고, Coding Plan 은 별도의 "전용 엔드포인트" 를 쓴다.** 우리가 배선한 `/api/anthropic` 이 바로 그 전용 엔드포인트다(근거 ②).

**근거 ②** [원문] `docs.z.ai/devpack/tool/claude` — Coding Plan 의 Claude Code 설정 절차가 그대로 우리 배선이다:

> `"ANTHROPIC_AUTH_TOKEN": "your_zai_api_key"`, `"ANTHROPIC_BASE_URL": "https://api.z.ai/api/anthropic"`

**근거 ③** [원문] `docs.z.ai/devpack/overview` — "The GLM Coding Plan is **a subscription package** designed specifically for AI-powered coding." 과금축이 5-hour/weekly **credits** 이고, 스스로 별도 축의 존재를 인정한다: "…compared with calling GLM-5.2 through the **standard on-demand usage API**."

**근거 ④(재판매 판정)** [원문] `docs.z.ai/devpack/usage-policy`:

> "**Subscription benefits are exclusive to the subscriber: Account sharing or multi-user access is prohibited.** Violations may result in restrictions…"
> "**Use limited to supported tools**: GLM Coding Plan may only be used within officially supported tools and products."

→ 유저 여러 명의 요청을 우리 구독키로 태우는 것이 정확히 "multi-user access" 다. **NO-GO.**

**★키 발급처가 같다는 함정**: Coding Plan 설정 문서조차 키를 **Z.AI Open Platform 의 API Keys 페이지**에서 받으라고 안내한다(근거 ②). 즉 **키 문자열만 봐서는 구독인지 pay-go 인지 구분할 수 없다.** 구분하는 것은 **(엔드포인트) × (계정의 구독 상태)** 다. 이 함정은 3벤더 전부에 해당한다.

**pay-go 전환에 필요한 것 — ★여기가 문제다**

| 항목        | 값                                                                                |
| ----------- | --------------------------------------------------------------------------------- |
| 엔드포인트  | `https://api.z.ai/api/paas/v4/chat/completions`                                   |
| 인증        | `Authorization: Bearer <API_KEY>` (JWT 방식도 지원)                               |
| 프로토콜    | ★**Anthropic 호환 아님** (Z.ai 자체/OpenAI 계열 포맷)                             |
| 리스트 단가 | GLM-5.2 $1.4 / $4.4 per 1M (레지스트리 `pricing` 값과 일치) [원문] pricing 페이지 |

★**`docs.z.ai` 전체 문서 색인(`llms.txt`)에 "anthropic" 문자열이 0건이다** — api-reference 17개 devpack 페이지를 포함해 전부. 즉 **Anthropic 호환 엔드포인트는 Coding Plan(devpack) 전용으로만 제공되고, pay-go 축에는 문서화된 Anthropic 호환 경로가 없다.**

**함의**: GLM 을 pay-go 로 갈아타는 것은 "레지스트리 행 1개 수정" 이 아니다. `claude` 하네스는 `ANTHROPIC_BASE_URL` 에 Anthropic Messages 엔드포인트를 요구하므로, pay-go GLM 을 쓰려면 **(a) OpenAI 호환 하네스로 붙이거나 (b) 프로토콜 변환 프록시를 우리가 세워야** 한다. 정본 §4 표의 "env-swap 1행" 은 **구독 배선 기준**이고 pay-go 에는 적용되지 않는다(§6 정정 항목).

**[미확인]** — 구독이 없는 순수 pay-go 잔액 계정의 키로 `/api/anthropic` 이 열리는지. 문서상 "dedicated endpoint" 표현은 구독 전용을 강하게 시사하지만, 벤더가 명시적으로 "구독 없으면 401" 이라고 적은 문장은 찾지 못했다.

---

### 3-B. MiniMax — ★엔드포인트 중립, 키가 가른다

**현행 배선** [코드] `v3/electron/model-registry.ts:625-626` (`MiniMax-M3`), `:655-656` (`MiniMax-M2.7`)

```ts
ANTHROPIC_BASE_URL: "https://api.minimax.io/anthropic",
ANTHROPIC_AUTH_TOKEN: "${MINIMAX_API_KEY}",
```

**근거 ①(결정적)** [원문] `platform.minimax.io/docs/api-reference/text-anthropic-api` — 이 페이지는 Token Plan 섹션이 아니라 **일반 플랫폼 API 레퍼런스**다. 거기서 같은 엔드포인트를 안내한다:

> `export ANTHROPIC_BASE_URL=https://api.minimax.io/anthropic`
> `export ANTHROPIC_API_KEY=${YOUR_API_KEY}`

**근거 ②** [원문] `platform.minimax.io/docs/api-reference/text-chat-anthropic` (Messages API, OpenAPI 스펙) — `servers: https://api.minimax.io`, `paths: /anthropic/v1/messages`. **일반 API 표면의 일부**다.

→ Z.ai 와 결정적으로 다르다. **MiniMax 의 Anthropic 호환 엔드포인트는 구독 전용 "dedicated endpoint" 가 아니라 플랫폼 공통 엔드포인트다.**

**근거 ③(과금축을 무엇이 가르는가)** [원문] `platform.minimax.io/docs/guides/pricing-paygo`:

> "**Pay-as-you-go uses standard Open Platform API Keys** and consumes your account balance by actual usage. **Credits are a separate prepaid balance used through a Subscription Key** with the same resource coverage as Token Plan."

→ **키가 두 종류다**: `standard Open Platform API Key`(pay-go, 잔액 차감) vs `Subscription Key`(Token Plan credits). 엔드포인트는 같고 **키가 과금축을 결정한다.**

**근거 ④** [원문] `platform.minimax.io/docs/token-plan/claude-code` — Token Plan 섹션의 Claude Code 가이드조차 키 출처를 "the API Key obtained from the **MiniMax Developer Platform**" 이라고만 적는다(Subscription Key 라고 특정하지 않는다).

**판정**: **현행 배선 엔드포인트는 재판매 판정을 가르지 않는다.** 정본 §2-F 의 오픈플랫폼 ToS 판정(**모양 A = GO**, "outside of any integrated applications" 카브아웃)이 그대로 적용되며, 조건은 단 하나 — **우리가 쓰는 키가 pay-go standard key 여야 한다.**

**pay-go 전환에 필요한 것 — ★가장 싸다**

| 항목       | 값                                                                                 |
| ---------- | ---------------------------------------------------------------------------------- |
| 엔드포인트 | `https://api.minimax.io/anthropic` — ★**변경 없음**                                |
| 인증       | `ANTHROPIC_AUTH_TOKEN` — ★**변경 없음**                                            |
| 모델 id    | `MiniMax-M3` / `MiniMax-M2.7` — ★**변경 없음**                                     |
| 필요 작업  | **잔액이 충전된 standard Open Platform API Key 를 `MINIMAX_API_KEY` 에 넣는 것뿐** |
| 코드 변경  | **0** (레지스트리 행 수정조차 불필요)                                              |

**[미확인] 3건**

1. 우리 계정의 `MINIMAX_API_KEY` 가 standard key 인지 Subscription Key 인지 — 콘솔 확인 필요(§5).
2. 두 키 종류가 **문자열 형태로 구분되는지**(prefix 등) — 문서에 언급 없음.
3. [프로브] 무인증 401 응답이 `'X-Api-Key' 필드에 키를 실으라`고 안내했는데, 우리 배선과 벤더 Claude Code 문서는 둘 다 `ANTHROPIC_AUTH_TOKEN`(=`Authorization: Bearer`)을 쓴다. 두 헤더 형태를 모두 받는 것으로 보이나(문서가 AUTH_TOKEN 을 지시하므로), **인증 성공 경로로는 확인하지 못했다.** 현행 배선이 실제로 돌고 있다면 이미 답이 나온 문제다.

---

### 3-C. Kimi (Moonshot) — ★구독 확정, 재판매 금지 [원문] 확보

**현행 배선** [코드] `v3/electron/model-registry.ts:726-727` (`k3`), `:762-763` (`k3-256k`), `:784-785` (`kimi-for-coding`)

```ts
ANTHROPIC_BASE_URL: "https://api.kimi.com/coding/",
ANTHROPIC_AUTH_TOKEN: "${KIMI_API_KEY}",
```

**근거 ①(결정적)** [원문] `www.kimi.com/code/docs/en/` — 벤더가 직접 만든 **Platform Comparison 표**가 두 플랫폼을 갈라 적는다:

| Comparison Item | Kimi **Code** Platform                                                                   | Kimi Platform                                     |
| --------------- | ---------------------------------------------------------------------------------------- | ------------------------------------------------- |
| Base URL        | OpenAI: `https://api.kimi.com/coding/v1` · **Anthropic: `https://api.kimi.com/coding/`** | `https://api.moonshot.cn/v1`                      |
| **Billing**     | ★**"Membership subscription, monthly/annual payment, with rate limiting"**               | ★**"Pay-as-you-go, top up and use"**              |
| Best For        | Terminal/IDE Agent programming                                                           | **"Product integration, enterprise-level calls"** |

→ **우리가 배선한 정확히 그 URL 이 "Membership subscription" 행에 있다.** 구독 확정. 같은 페이지 서두도 "Kimi Code is an intelligent programming service for developers **included in Kimi membership benefits**" 라고 적고, 모델 id 가용성이 멤버십 등급(Moderato/Allegretto)별로 갈린다.

**근거 ②(재판매 판정 — ★정본의 [미확인]을 이 문서가 닫는다)** [원문] `www.kimi.com/code/docs/en/kimi-code/community-guidelines.html`:

> **Scope of Use**: "Kimi Code subscriptions are **for interactive use only**. … For enterprise integrations, **commercial services**, or other platform-related inquiries, visit the **Kimi Platform**."
> "**Don't resell your account or API access**"
> "**Don't resell Kimi Code's capabilities as a service** — Using Kimi Code to support your own work is completely fine. **Repackaging it as a product to sell to others** bypasses our pricing and service structure…"
> "**Don't spoof or alter client identity information**"
> "**Don't use Kimi Code for non-interactive automation** — … such as **scripted batch execution** or data annotation pipelines"
> FAQ Q2: "Accessing Kimi through a forward proxy (like a VPN or company network) is fine. **Sharing your account with others through a reverse proxy is a violation.**"

→ 정본 §5 가 "유일하게 가능한 구현" 이라고 결론지은 **계량 리버스 프록시가 이 문장에 정면으로 걸린다.** Kimi Code 구독 = **NO-GO 확정**(종전 "미확인 → 보수적 NO-GO" 에서 승격).

**★재판매와 별개 축의 리스크 하나 — 우리 사내 현행 사용**
"Don't use Kimi Code for **non-interactive automation** … scripted batch execution" 과 "for interactive use only" 는, 우리 오케스트레이터가 에이전트를 자동 스폰해 티켓을 배치 처리하는 **현재 사내 사용 패턴**에도 읽히는 여지가 있다. ★이건 **우리 읽기이지 벤더의 판정이 아니다** — 다만 재판매 GO/NO-GO 와 무관하게 별도로 검토할 값어치가 있어 기록한다(후속 티켓 후보).

**pay-go 전환에 필요한 것** [원문] `platform.kimi.ai/docs/guide/claude-code-kimi`

| 항목       | 값                                                                                            |
| ---------- | --------------------------------------------------------------------------------------------- |
| 엔드포인트 | `https://api.moonshot.ai/anthropic` (국제) · `https://api.moonshot.cn/v1` (중국, OpenAI 호환) |
| 인증       | `ANTHROPIC_AUTH_TOKEN` = `${MOONSHOT_API_KEY}` — ★**키 이름·헤더 형태 모두 현행과 동형**      |
| 모델 id    | `kimi-k3` / `kimi-k3[1m]` / `kimi-k2.7-code` / `kimi-k2.7-code-highspeed` / `kimi-k2.6`       |
| 키 발급    | `platform.kimi.ai/console/api-keys`                                                           |
| 부가 env   | 벤더 문서는 `CLAUDE_CODE_AUTO_COMPACT_WINDOW=1048576`, `CLAUDE_CODE_EFFORT_LEVEL=max` 병기    |
| 코드 변경  | 레지스트리 행 3개의 base URL·모델 id·시크릿 참조 교체 (배선 **모양**은 그대로)                |

★**모델 id 가 다르다**: Code 표기(`k3`, `kimi-for-coding`) ≠ Platform 표기(`kimi-k3`, `kimi-k2.7-code`). 레지스트리 주석(`:719-720`)이 이미 이 사실을 적어뒀고, 이번 조사가 벤더 문서로 확증했다. 그리고 [원문] 가이드가 못박는다: "Make sure `ANTHROPIC_BASE_URL` **matches the platform where you created the API key**" — 두 플랫폼의 키는 서로의 엔드포인트에서 통하지 않는다.

★레지스트리 주석 `:714-717`(“`MOONSHOT_API_KEY` 는 Platform pay-go 키의 공식 이름, 우리가 쓰는 건 Code Console 구독 키”)은 **이번 조사로 전부 사실 확인됐다.** 별도 env 이름을 쓴 판단도 옳았다 — 두 키가 섞이면 크레덴셜이 남의 백엔드로 새는 축이 된다.

---

## 4. pay-go 전환에 필요한 키 · 엔드포인트 요약

| 벤더             | pay-go 엔드포인트                               | 인증 env                | env 키 이름(제안)          | Anthropic 호환    | 코드 변경량              |
| ---------------- | ----------------------------------------------- | ----------------------- | -------------------------- | ----------------- | ------------------------ |
| **MiniMax**      | `https://api.minimax.io/anthropic` (동일)       | `ANTHROPIC_AUTH_TOKEN`  | `MINIMAX_API_KEY` (동일)   | ✅ 예             | **0** — 키 값만 교체     |
| **Kimi**         | `https://api.moonshot.ai/anthropic`             | `ANTHROPIC_AUTH_TOKEN`  | `MOONSHOT_API_KEY` (신설)  | ✅ 예             | 레지스트리 행 3개 데이터 |
| **GLM**          | `https://api.z.ai/api/paas/v4/chat/completions` | `Authorization: Bearer` | `ZAI_PAYGO_API_KEY` (신설) | ❌ **아니오**     | ★하네스/프록시 신규 필요 |
| _(참고)_ **xAI** | `https://api.x.ai/v1`                           | 네이티브 grok 하네스    | `XAI_API_KEY`              | ❌ **deprecated** | 기존 grok 경로 사용      |

★**xAI 신규 발견** [원문] `docs.x.ai` 색인: "**The Anthropic SDK compatibility is fully deprecated.** Please migrate to the Responses API or gRPC." → xAI 는 ToS 가 가장 명시적으로 우리 모양을 허용하지만(정본 §2-D), **env-swap 으로는 붙일 수 없다.** grok 네이티브 하네스 경로만 유효하다. 정본 §4 표의 "xAI · 하네스 있음(Shape A 네이티브)" 와 모순되지 않으나, "env-swap 으로 싸게 붙인다" 는 오해를 막기 위해 명시해 둔다.

---

## 5. ★사장님 액션 체크리스트 (계정개설 · 서면요청)

★**이 절만 사장님 액션이다.** 아래는 전부 **엔지니어가 대신할 수 없는 항목**(콘솔 로그인·결제수단·법인정보·서면 커뮤니케이션)이다. 재판매 착수 결정이 아니라 **GO 판정을 위한 사실 확인**이 목적이다.

### 5-0. 선행 — 현재 키 종류 확인 (가장 싸고, 가장 먼저)

우리가 이미 쥔 키가 무엇인지부터 확인하면 아래 절반이 불필요해질 수 있다.

- [ ] **MiniMax 콘솔** 로그인 → 현행 `MINIMAX_API_KEY` 가 **standard Open Platform API Key** 인지 **Subscription Key(Token Plan)** 인지 확인. → `platform.minimax.io` · Billing/잔액 페이지에서 "account balance" 소비 여부로 판별 가능
- [ ] **Z.ai 콘솔** → GLM Coding Plan 구독이 활성인지 확인 → `z.ai/manage-apikey/apikey-list`
- [ ] **Kimi Code Console** → 구독 등급(Moderato/Allegretto/…) 확인
- [ ] 확인 결과를 엔지니어에게 전달(키 값 자체는 전달 불필요 — **종류만**)

★**MiniMax 가 standard key 로 밝혀지면 그것만으로 온램프 MVP 의 벤더 후보가 확보된다**(코드 변경 0).

### 5-1. Anthropic — pay-go 계정 + ★서면 확인 **병행**

- [ ] **콘솔 가입·조직 생성**: `https://console.anthropic.com` → (현재 `https://platform.claude.com` 으로 리다이렉트됨, 2026-08-11 확인)
- [ ] 결제수단 등록 + pay-go 크레딧 충전, **API 키 발급**(우리 서버 보관용 — ★유저 머신에 내리지 않는다, 정본 §5-A)
- [ ] ★**`sales@anthropic.com` 서면 확인 요청** — 정본 §2-B 의 "조건부 GO" 에서 그 **조건**에 해당한다. 근거: [원문] `code.claude.com/docs/en/legal-and-compliance` 가 직접 안내한다 — "For questions about permitted authentication methods for your use case, please **contact sales**."

  **요청 문안 초안**(그대로 보내도 됨):

  > We build Marblo, a desktop development tool. We intend to pay for Claude API usage with **our own organization API key**, and meter it to our end users inside our product. End users never receive an API key or endpoint, and we do not route any Claude subscription (Free/Pro/Max) credentials on their behalf.
  > Please confirm in writing whether this usage is permitted under the Commercial Terms (A.1 "power products and services Customer makes available to its own customers and end users") and does not fall under D.4's resale restriction.
  - [ ] 회신을 **서면으로 보관**(GO 판정의 법적 근거물)
  - ★회신 전이라도 **내부 테스트는 진행 가능**. 서면이 필요한 시점은 **유료 확장 시점**이다.

### 5-2. xAI — 계정만, ★서면 불요

- [ ] **콘솔 가입**: `https://console.x.ai` · **API 키 발급** `https://console.x.ai/team/default/api-keys` · **크레딧 충전** `https://console.x.ai/team/default/billing`
      _(주: 이 URL 들은 [원문] `docs.x.ai` 내부 링크로 확인. 콘솔 자체는 Cloudflare 봇 차단으로 이 조사 환경에서 열지 못했다 — 브라우저에서는 정상일 것으로 본다.)_
- [ ] ★**서면 확인 불요** — Enterprise ToS 가 우리 모양("Bundled Services")을 **이름 붙여 명시 허용**한다(정본 §2-D).
- [ ] ★**대신 의무 하나**: 우리 이용약관에 **xAI AUP flow-down** 조항을 넣어야 한다("Customer shall ensure that its agreements with End-Users will contain an acceptable use policy…"). → 법무/약관 작업 항목
- [ ] ★유의: **env-swap 으로는 못 붙인다**(§4 의 Anthropic SDK deprecated). grok 네이티브 하네스 경로 전제

### 5-3. MiniMax — pay-go 잔액 계정 (★MVP 1순위)

- [ ] `https://platform.minimax.io` 가입/로그인 → **Recharge(잔액 충전)**
- [ ] **standard Open Platform API Key** 발급 (★Subscription Key 아님)
- [ ] 그 키를 `MINIMAX_API_KEY` 로 교체 → **코드 변경 없이 pay-go 축으로 이동**
- [ ] 서면 확인 불요 — [원문] ToS 카브아웃("outside of any integrated applications" = 통합 앱 **안에서는** 허용)이 이미 명시적(정본 §2-F)

### 5-4. Kimi Platform — pay-go 계정 (2순위)

- [ ] `https://platform.kimi.ai/console/api-keys` 에서 **API 키 발급**(default project) + 충전
- [ ] 그 키를 **새 env 이름 `MOONSHOT_API_KEY`** 로 보관 (★`KIMI_API_KEY` 와 **절대 같은 이름 금지** — 두 계정 크레덴셜이 서로의 백엔드로 새는 축이 된다)
- [ ] 서면 확인 불요 — [원문] Kimi OpenPlatform ToS 가 "Customer Application… offer those Customer Applications to End Users" 를 명시 허용(정본 §2-G)

### 5-5. Z.ai — ★계정 개설만으로 해결되지 않음

- [ ] ★**계정 액션 보류 권고.** pay-go 축에 Anthropic 호환 엔드포인트가 없어(§3-A) 계정을 열어도 현행 배선으로 못 쓴다. 프로토콜 변환 프록시를 세울지가 **선행 엔지니어링 판단**이고, 그 전에 계정을 여는 건 순서가 뒤집힌 것이다.
- [ ] (참고 링크만) 오픈플랫폼 `https://z.ai/model-api` · 키 관리 `https://z.ai/manage-apikey/apikey-list`

---

## 6. 정본(§2-I) 정합 대조

**결론: 판정이 뒤집힌 행은 없다. 모순 0건.** 확정으로 승격된 행 2개, 근거 문장 교체 권고 1건, **정정이 필요한 서술 2건**이 있다.

| 정본 위치                        | 종전 서술                                                    | 이번 조사                                                    | 조치                            |
| -------------------------------- | ------------------------------------------------------------ | ------------------------------------------------------------ | ------------------------------- |
| §2-I `Z.ai GLM Coding Plan`      | **NO-GO** · 근거 **[2차, 구독약관]**                         | **NO-GO 유지** · 근거 **[원문]으로 승격**                    | ✅ 정합 (근거 강화)             |
| §2-I `Kimi Code 구독(현행 배선)` | **미확인 → 보수적 NO-GO**                                    | ★**NO-GO 확정** [원문] Community Guidelines                  | ✅ 정합 (**미확인 해소**)       |
| §2-I `MiniMax(오픈플랫폼)`       | 모양 A = **GO**                                              | **GO 유지** — 엔드포인트가 걸림돌 아님                       | ✅ 정합                         |
| §2-F 본문                        | "종량제 키인지 구독 키인지 **주석만으론 확정 불가**"         | ★**엔드포인트는 중립**임이 확정. 남은 미확인은 **키 종류뿐** | ✅ 정합 (범위 축소)             |
| §2-G 본문                        | "현행 Code 구독 키 = **미확인**"                             | ★**구독 확정** + 재판매 금지 [원문]                          | ✅ 정합 (**미확인 해소**)       |
| §2-E 인용문                      | "resell, sub-resell, repackage, aggregate, proxy…" **[2차]** | ★이번 조사에서 **이 문장을 공개 페이지에서 찾지 못했다**     | ⚠️ **근거 문장 교체 권고**      |
| §4 표 · Z.ai 행                  | "하네스 호환: **env-swap 1행**"                              | ★**구독 기준으로만 참**. pay-go 는 Anthropic 호환 없음       | ⚠️ **정정 필요**                |
| §4 표 · MiniMax 행               | "env-swap 1행(단, **구독→pay-go 전환 필요**)"                | ★전환에 **엔드포인트 변경 불요** — 키 교체만                 | ⚠️ **정정 필요**(비용 과대평가) |

**⚠️ 근거 문장 교체 권고 (§2-E) — 중요**

정본 §2-E 가 [2차]로 인용한 "you may not resell, sub-resell, repackage, aggregate, proxy…" 문장을, 이번에 `docs.z.ai/devpack/*` 공개 페이지 전체에서 **찾지 못했다.** 그 문장이 없다는 뜻은 아니다(별도 구독계약서·중국어 페이지·로그인 후 페이지에 있을 수 있다). 다만 **[원문]으로 대체 가능한 문장이 확보됐으므로** 정본의 근거를 이렇게 바꾸는 것을 권고한다:

> [원문] `docs.z.ai/devpack/usage-policy` — "Subscription benefits are exclusive to the subscriber: **Account sharing or multi-user access is prohibited.**" + "GLM Coding Plan **may only be used within officially supported tools and products.**"

**판정(NO-GO)은 바뀌지 않는다.** 다중사용자 접근 금지 하나만으로 재판매 모양이 잘린다. 근거의 **등급이 [2차] → [원문]으로 올라갈 뿐**이고, 이는 GO 판정 근거자료로서 개선이다.

**⚠️ 신규 항목 — 정본에 없던 축**

- **xAI Anthropic SDK 호환 deprecated** (§4) — 정본 §4 표의 xAI "하네스 호환: 있음" 은 grok 네이티브 기준으로 여전히 참이나, env-swap 확장은 불가.
- **Kimi Code 의 비대화형 자동화 금지** (§3-C) — 재판매 축과 무관하게 **우리 현재 사내 사용**에 걸릴 여지. 별도 검토 대상.

---

## 7. 출처

**벤더 1차 문서 (2026-08-11 직접 열람)**

| 사실                                                                                               | URL                                                             |
| -------------------------------------------------------------------------------------------------- | --------------------------------------------------------------- |
| ★Z.ai 일반 API = `/api/paas/v4/` · "Coding Plan 은 dedicated endpoint" 경고                        | `docs.z.ai/guides/develop/http/introduction`                    |
| Z.ai Coding Plan 의 Claude Code 배선 = `api.z.ai/api/anthropic` + AUTH_TOKEN                       | `docs.z.ai/devpack/tool/claude`                                 |
| "GLM Coding Plan is a **subscription package**" · credits 과금 · on-demand API 별도                | `docs.z.ai/devpack/overview`                                    |
| ★Z.ai 구독 사용정책 — 계정공유·**다중사용자 접근 금지** · 지원 도구 한정                           | `docs.z.ai/devpack/usage-policy`                                |
| Z.ai pay-go 단가 GLM-5.2 $1.4/$4.4                                                                 | `docs.z.ai/guides/overview/pricing`                             |
| Z.ai 전체 문서 색인 — "anthropic" 0건                                                              | `docs.z.ai/llms.txt`                                            |
| ★MiniMax 일반 API 레퍼런스가 `api.minimax.io/anthropic` 안내(구독 전용 아님)                       | `platform.minimax.io/docs/api-reference/text-anthropic-api`     |
| MiniMax Messages API OpenAPI — `servers: api.minimax.io`, `/anthropic/v1/messages`                 | `platform.minimax.io/docs/api-reference/text-chat-anthropic`    |
| ★MiniMax — "pay-as-you-go uses **standard Open Platform API Keys**… Credits… **Subscription Key**" | `platform.minimax.io/docs/guides/pricing-paygo`                 |
| MiniMax Token Plan 의 Claude Code 배선 · 키 출처 = Developer Platform                              | `platform.minimax.io/docs/token-plan/claude-code`               |
| ★Kimi Platform Comparison 표 — `api.kimi.com/coding/` = **Membership subscription**                | `www.kimi.com/code/docs/en/`                                    |
| ★Kimi Code Community Guidelines — 재판매·리버스프록시·비대화형 자동화 금지                         | `www.kimi.com/code/docs/en/kimi-code/community-guidelines.html` |
| ★Kimi Platform(pay-go) Claude Code 배선 = `api.moonshot.ai/anthropic` + MOONSHOT_API_KEY           | `platform.kimi.ai/docs/guide/claude-code-kimi`                  |
| Kimi Platform 일반 API = `api.moonshot.ai/v1` · 모델 id `kimi-k3` 등                               | `platform.kimi.ai/docs/overview`                                |
| ★xAI — Anthropic SDK 호환 **fully deprecated** · 콘솔 키/빌링 URL                                  | `docs.x.ai/llms.txt` · `docs.x.ai/docs/overview`                |

**[프로브] 라이브 (2026-08-11, 무인증 POST)** — §2 표 참조. 엔드포인트 실재·프로토콜 일치만 증명.

**사내 근거**

| 사실                                          | 위치                                                                    |
| --------------------------------------------- | ----------------------------------------------------------------------- |
| GLM 배선                                      | `v3/electron/model-registry.ts:545-546, 576-577`                        |
| MiniMax 배선                                  | `v3/electron/model-registry.ts:625-626, 655-656`                        |
| Kimi 배선 · Code vs Platform 키 구분 주석     | `v3/electron/model-registry.ts:726-727, 714-720`                        |
| `${ENV}` 자리표시자 규율 · 반쪽 프로파일 금지 | `v3/electron/model-registry.ts:180-205` · `agent-config.applyVendorEnv` |
| 재판매 ToS 판정 정본 · 모양 A/B 구분          | `v3/docs/api-reseller-onramp-feasibility-2026-08-09.md`                 |

---

## 8. 한계 · [미확인] 목록

★**환각 금지 원칙에 따라, 확인하지 못한 것을 전부 열거한다.**

1. **[미확인] 우리 계정이 쥔 키의 실제 종류** — 3벤더 전부. 콘솔 로그인이 필요하고 이 조사 환경에서 불가. `v3/.env` 는 이 워크트리에 **존재하지 않으며**, 존재 여부만 확인했고 값을 열람하지 않았다. → §5-0 사장님 액션.
2. **[미확인] Z.ai pay-go 전용 키로 `/api/anthropic` 이 열리는지** — "dedicated endpoint" 표현이 구독 전용을 시사하나 명시 문장은 없음.
3. **[미확인] Z.ai Coding Plan 의 "resell/sub-resell/proxy" 원문 문장의 소재** — 공개 devpack 페이지에서 찾지 못함(§6).
4. **[미확인] MiniMax Token Plan 전용 약관** — 구독 축의 재판매 조항 원문을 열지 못했다. 오픈플랫폼 ToS 만 [원문]으로 확인됨(정본 §2-F 경유).
5. **[미확인] MiniMax 두 키 종류가 문자열로 구분되는지**(prefix 등) — 문서 언급 없음.
6. **[미확인] MiniMax 의 `X-Api-Key` vs `Authorization: Bearer` 동치 여부** — 인증 성공 경로로 확인 못 함(§3-B).
7. **[미확인] pay-go 계정 개설의 KYC/법인 요건·지역 제한·최소 충전액** — 콘솔 로그인 필요.
8. **[미확인] xAI 콘솔 화면** — Cloudflare 봇 차단(403)으로 이 환경에서 열지 못함. URL 은 `docs.x.ai` 내부 링크 [원문]에서 확보.
9. **법률 자문이 아니다.** 공개 문서 문구를 우리 모양에 대본 결과다.
10. **단가·약관은 조사 시점(2026-08-11) 기준**이며 벤더가 언제든 바꾼다.

**이 문서가 하지 않은 것**: 코드 변경 0. 재판매 착수 아님. 벤더 계정 개설·서면 발송 아님(전부 §5 의 사장님 액션으로 분리).
