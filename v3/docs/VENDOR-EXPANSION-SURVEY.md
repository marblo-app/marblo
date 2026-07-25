# 구독형 모델 CLI 총서베이 + 하네스·라우팅·모델레퍼런스 편입 설계

> **★이 문서는 서베이/설계다. 구현이 아니다.**
> 티켓 `db3qs0o62A9uWQvKTEpS` 산출물. 코드 변경은 이 문서 1개뿐이다. 외부 CLI 는
> **하나도 설치하지 않았다** — npm 레지스트리 메타데이터·공식 문서·공식 리포지터리
> README 크롤로만 확인했다. 설치·라우팅 실구현은 사장님 승인 후 §8 의 티켓으로 간다.
>
> 작성 2026-07-25 · 기준 커밋 `bd87195a` (origin/main)
> 선행 문서: [`INTELLIGENT-ROUTING-PLAN.md`](./INTELLIGENT-ROUTING-PLAN.md) (#595) —
> 이 문서는 그 설계의 **모델 레지스트리(P1-2)·단가갱신(P1-3)·그래프 키해상도(P2-2)를
> 벤더중립으로 넓히는** 기획이다. 거기서 이미 결정된 것은 재발명하지 않는다.
>
> 병행 문서: [`MODEL-COMPARISON-SEED.md`](./MODEL-COMPARISON-SEED.md) (#596, `a4c4c2ac`) —
> Claude↔GPT 단가 확정 + 그래프 콜드스타트 `prior` 주입 경로. §6 이 그 위에 선다.
>
> ★**진행중 PR#598**(`marblo/routing-registry-claude-JDOIZOW1`, 2026-07-25 기준 OPEN) —
> `electron/model-registry.ts` + 실단가 수리 + `verify:models`. **#595 P1-2 를 이미
> 구현하고 있다.** 이 문서의 V0-1 은 그걸 새로 만드는 게 아니라 **한 축을 쪼개는
> 후속**이다(§4.5 델타). 착수 전 PR#598 머지 여부부터 확인할 것.

---

## 0. 한 줄 요약

조사 결과 **"벤더를 붙인다"에는 비용이 10배 차이 나는 두 가지 모양이 있다**는 게 드러났다.

- **(A) 신규 하네스** — 벤더가 자기 CLI 바이너리 + 자기 OAuth 구독을 갖는다.
  xAI **Grok Build**(`grok`), Moonshot **Kimi Code**(`kimi`). 편입하려면 우리 코드
  **18개 파일**을 손대야 한다(§4.1 실측).
- **(B) 프로바이더 프로파일** — 벤더가 **CLI 를 아예 안 만들고**, 우리가 이미 가진
  `claude` 바이너리에 **env 3개만 갈아끼우면** 자기 모델이 돈다. Z.ai **GLM Coding
  Plan**, MiniMax **Token Plan** 이 정확히 이 모양이다. 편입 비용이 (A)의 1/10 이고,
  harness-catalog·probe·spawn switch·MCP 생성기·cost 파서를 **한 줄도 안 늘린다**.

티켓은 "설치형 CLI 를 스토어에 편입" 을 전제로 쓰였는데, **가장 싸고 빠른 벤더 확장은
설치형 CLI 가 아니다.** 그래서 §8 의 우선순위를 (B) 먼저로 제안한다. (A)는 그 다음이고,
그중에서도 Grok Build 가 Kimi Code 보다 우리 아키텍처에 덜 아프게 붙는다(§4.3).

**★로컬모델은 이번 범위 밖이다.** 조사도 하지 않았다. 이 문서에 나오는 모델은 전부
호스팅 구독/API 다. (Kimi K3·GLM 은 가중치가 공개되지만, 우리가 보는 건 그 벤더의
**호스팅 구독** 경로뿐이다.)

---

## 1. 조사 방법과 증거 규율

- 웹 조사는 전부 gstack `/browse` 헤드리스 크롬(글로벌 규칙). MCP Chrome 미사용.
- **1차 출처만 인용한다**: 벤더 공식 문서(docs.x.ai, platform.kimi.ai, docs.z.ai,
  platform.minimax.io), 공식 GitHub 리포지터리 raw README, npm 레지스트리 메타데이터.
  블로그 요약·기사·커뮤니티 포스트는 근거로 쓰지 않았다.
- **npm 레지스트리를 "CLI 가 실재하는가" 의 1차 증거로 썼다.** 패키지의 `bin` 필드·
  `os`/`cpu`·최신 publish 시각은 위조가 어렵고, "경쟁사가 붙였다더라" 류 전언보다 훨씬
  강하다.
- **모르는 건 '미확인' 으로 적었다.** 특히 벤치 점수는 확보한 것만 숫자로 쓰고, 못 얻은
  것은 왜 못 얻었는지까지 적었다(§3.3). 추정치를 표에 박지 않았다.
- 검색엔진은 신뢰하지 않았다 — DuckDuckGo 는 봇 챌린지, Bing 은 xAI 질의에
  "설명가능 AI(XAI)" 로 오염된 결과를 줬다. 전부 공식 도메인 직행으로 대체했다.

**크롤 실패로 남은 구멍 2개** (정직하게 남긴다):

| 구멍                     | 원인                                                                                                                                     | 영향                                                                                                                                            |
| ------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| grok-4.5 공식 벤치 점수  | `x.ai/news/grok-4-5` 가 Cloudflare 로 이 IP 를 차단(Ray ID `a20a7e10ea9680a1`). `docs.x.ai` 는 정상이나 벤치는 announcement 로 링크만 함 | Grok 벤치란 '미확인'. 후보 판정 자체엔 영향 없음(설치형 CLI·구독은 확인됨)                                                                      |
| 경쟁사 Orca 의 벤더 목록 | 검색 실패, 공식 도메인 특정 불가                                                                                                         | **판정에 영향 없음** — 우리는 Orca 를 참고하지 않고 벤더별로 직접 크롤 확인했다. 티켓 지시("경쟁사가 붙였다고 우리도 되는 건 아님")와 같은 방향 |

---

## 2. 벤더별 서베이

### 2.1 요약표

판정 기준은 티켓의 (a)설치형 CLI (b)구독접근(종량과금 아님) (c)모델·가격·벤치.

| 벤더                     | (a) 설치형 CLI                                  | (b) 구독접근                                             | 편입 모양               | 판정                     |
| ------------------------ | ----------------------------------------------- | -------------------------------------------------------- | ----------------------- | ------------------------ |
| **xAI Grok Build**       | ✅ `grok` (npm `@xai-official/grok` 0.2.112)    | ✅ `grok login` 브라우저 OIDC → grok.com 계정            | (A) 신규 하네스         | **✅ 후보 — 1순위(A형)** |
| **Moonshot Kimi Code**   | ✅ `kimi` (npm `@moonshot-ai/kimi-code` 0.29.1) | ✅ `/login` device-code OAuth, 구독 $15~$159/월          | (A) 신규 하네스         | **✅ 후보 — 2순위(A형)** |
| **Z.ai GLM Coding Plan** | ❌ 자체 CLI 없음                                | ✅ **$18/월~**, 5시간+주간 프롬프트 캡                   | (B) 프로바이더 프로파일 | **✅ 후보 — 전체 1순위** |
| **MiniMax Token Plan**   | ❌ 코딩 CLI 없음(`mmx-cli`는 멀티모달/쿼터 툴)  | ✅ $20/$50/$120/월, 5시간+주간 윈도우                    | (B) 프로바이더 프로파일 | **✅ 후보 — 전체 2순위** |
| **Nous Research Hermes** | ✅ `hermes` (공식, MIT)                         | ❌ Nous Portal = $20→$22 크레딧 = **사실상 종량**        | —                       | **❌ 제외** (§2.5)       |
| **Qwen Code**            | ✅ `qwen` (npm `@qwen-code/qwen-code` 0.21.0)   | ⏸ flat 구독 크롤 미확인, `/auth`는 provider+API key 중심 | —                       | **⏸ 보류** (§2.7)        |
| Google Gemini CLI        | ✅ (이미 카탈로그)                              | ❌ 개인 티어 2026-06-18 EOL                              | —                       | 이미 `deprecated` 처리됨 |
| 로컬 모델                | —                                               | —                                                        | —                       | **범위 밖 — 조사 안 함** |

### 2.2 xAI Grok Build ✅

**설치형 CLI: 실재한다.** 커뮤니티 포크가 아니라 xAI 1차 제품이다.

- 공식 리포지터리: `github.com/xai-org/grok-build` (Rust). README 원문:
  _"**Grok Build** is SpaceXAI's terminal-based AI coding agent."_ 빌드 산출물은
  `xai-grok-pager`, **공식 배포는 그걸 `grok` 이라는 이름으로 낸다**.
- 설치 경로 2개 (docs.x.ai `/build/overview` 원문):
  ```
  curl -fsSL https://x.ai/cli/install.sh | bash     # macOS / Linux
  irm https://x.ai/cli/install.ps1 | iex            # Windows
  ```
  npm 대안은 엔터프라이즈 문서가 명시한다: _"`npm install -g @xai-official/grok` 은
  이 호스트를 요구하지 않는 대안"_.
- **npm 실재 검증(직접 조회)**: `@xai-official/grok` **v0.2.112, 2026-07-24 publish**,
  `bin: { grok: "bin/grok" }`, `os: [darwin, linux, win32]`, `cpu: [arm64, x64]`.
  → macOS/Windows 양쪽 배포 존재. 마블로 릴리스 타깃과 일치.

**구독접근: 그렇다.** claude/codex 와 같은 모양이다.

- 공식 인증 가이드(`grok-build/.../docs/user-guide/02-authentication.md`) 원문:
  _"On first launch, Grok opens your browser to authenticate with **grok.com**"_,
  _"Grok stores credentials in `~/.grok/auth.json`"_, 파일 권한 `0600`.
- `grok login` (기본 `--oauth`, `auth.x.ai`), `grok login --device-auth` (헤드리스),
  `grok logout`. **`XAI_API_KEY` 는 "세션 토큰이 없을 때의 fallback"** 이라고 명시 —
  즉 1급 경로가 구독 로그인이고 API 키가 2급이다. 우리 claude/codex 와 정확히 동형.
- 엔터프라이즈는 고객 IdP OIDC(Okta/AzureAD/Auth0)와 `force_login_team_uuid` 까지 있다.

**마블로 관점에서 특히 좋은 것들** (전부 docs.x.ai `llms.txt` 원문 확인):

| 능력                                                                                                 | 근거                            | 우리에게 왜 중요한가                                                                             |
| ---------------------------------------------------------------------------------------------------- | ------------------------------- | ------------------------------------------------------------------------------------------------ |
| 헤드리스 `grok -p "..."`, `--output-format streaming-json`                                           | `/build/overview`               | 비용·세션 파싱을 PTY 스크래핑 없이 구조화로 받을 수 있다                                         |
| ACP `grok agent stdio`                                                                               | `/build/cli/reference`          | 미래에 PTY 가 아닌 프로토콜 배선 여지                                                            |
| 스킬 `~/.grok/skills/`, 플러그인/마켓플레이스/훅                                                     | `/build/features/*`             | #595 축 D(스킬 실전달)가 codex(스킬 0개)와 달리 **성립한다**                                     |
| MCP: MCP 서버를 `~/.grok/config.toml` 에 직접 선언 가능, OAuth 토큰은 `~/.grok/mcp_credentials.json` | 동일                            | Marblo MCP 주입 자리가 이미 있다                                                                 |
| 세션 `~/.grok/sessions/`, `--session-id`/`--resume`/`--continue`                                     | `/build/cli/headless-scripting` | 우리 세션 핀/리쥼 모델과 1:1 대응                                                                |
| 커스텀 모델 `[model.x] base_url/env_key`                                                             | `/build/overview`               | **Grok Build 자체가 (B)형 호스트도 된다** — 3rd 프로바이더를 grok 하네스로도 태울 수 있다        |
| `--no-auto-update`, `[cli] auto_update=false`                                                        | `/build/cli/headless-scripting` | 자동업데이트 대화상자가 PTY 를 죽이는 우리 고질(§4.2 codex 사례) 예방 스위치가 **공식으로 있다** |

**모델·가격** (docs.x.ai `/developers/pricing`, 페이지 표기 _Last updated: July 3, 2026_.
short-context 기준, 1M 토큰당 USD):

| 모델                                                    | 컨텍스트 | 입력  | 캐시  | 출력  | 비고                                                  |
| ------------------------------------------------------- | -------- | ----- | ----- | ----- | ----------------------------------------------------- |
| `grok-4.5`                                              | 500k     | $2.00 | $0.30 | $6.00 | 플래그십. long-context(≥200k)는 $4/$0.60/$12          |
| `grok-build-0.1`                                        | 256k     | $1.00 | $0.20 | $2.00 | **Grok Build 를 돌리는 코딩 모델**. long: $2/$0.40/$4 |
| `grok-4.3`                                              | 1M       | $1.25 | $0.20 | $2.50 |                                                       |
| `grok-4.20-*` (multi-agent / reasoning / non-reasoning) | 1M       | $1.25 | $0.20 | $2.50 |                                                       |

`/developers/models` 원문: grok-4.5 는 _"Our flagship model for code and everything
else"_, 지식 컷오프 2026-02-01, reasoning "Configurable". 별칭 규칙도 명시돼 있다
(`<name>` = 최신 stable, `<name>-latest` = 최신, `<name>-<date>` = 고정) — **우리
`CLAUDE_MODEL_ALIASES` 와 같은 패턴이라 레지스트리 스키마가 그대로 맞는다.**

**벤치: 미확인.** docs.x.ai 는 _"For benchmark results and cost-versus-score
comparisons, see the [announcement](https://x.ai/news/grok-4-5)"_ 로 넘기는데 그
페이지가 Cloudflare 차단이다. **추정치를 쓰지 않는다.**

### 2.3 Moonshot Kimi Code ✅

**설치형 CLI: 실재한다.** (티켓의 "Kimi 3" = 실제 표기 **Kimi K3**.)

- npm `@moonshot-ai/kimi-code` **v0.29.1, 2026-07-24 publish**, `bin: { kimi: "dist/main.mjs" }`,
  MIT, `engines.node >= 22.19.0`, repo `github.com/MoonshotAI/kimi-code`.
- 공식 권장 설치는 npm 이 아니라 단일 바이너리 스크립트다(README 원문):
  ```
  curl -fsSL https://code.kimi.com/kimi-code/install.sh | bash   # macOS/Linux
  irm https://code.kimi.com/kimi-code/install.ps1 | iex          # Windows
  ```
  _"The script automatically downloads the latest release, **verifies the checksum**,
  and places the `kimi` executable on your PATH."_
- ⚠️ **Windows 제약**: _"install Git for Windows before first launch because Kimi Code
  CLI uses the bundled Git Bash as its shell environment"_(`KIMI_SHELL_PATH` 로 경로
  지정 가능). 우리 Windows 빌드 사용자에게 추가 선행조건이 생긴다.

**구독접근: 그렇다.**

- `/login` → 두 갈래(공식 getting-started 원문): **Kimi Code (OAuth) — device-code
  플로우**, 또는 Kimi Platform API key. `/logout` 로 해제.
- 구독 요금제(www.kimi.com/membership/pricing 크롤): Moderato **$15/월**($180/년) ·
  Allegretto **$31/월**($372/년) · Allegro **$79/월**($948/년) · Vivace **$159/월**($1,908/년).
  전 유료 플랜이 "Kimi Code" 포함이고 크레딧 배수가 **1x / 5x / 15x / 30x**.
  1M 컨텍스트는 Allegro 이상.
- ⚠️ **주의**: 그 페이지 상단에 _"New Membership Plans Coming Soon — Kimi and Kimi Code
  benefits will be **separated**. Existing subscribers are unaffected."_ 배너가 있고 신규
  플랜 버튼이 "Join Waitlist" 다. **요금제가 개편 중**이라 위 숫자는 개편 시 바뀔 수 있다.
  레지스트리에 `verifiedAt` 을 반드시 남겨야 하는 실제 사례(§7).

**모델·가격** (platform.kimi.ai `/docs/pricing/*.md` 원문 표, 1M 토큰당 USD):

| 모델                       | 컨텍스트  | 입력(캐시 히트) | 입력(미스) | 출력   |
| -------------------------- | --------- | --------------- | ---------- | ------ |
| `kimi-k3`                  | 1,048,576 | $0.30           | $3.00      | $15.00 |
| `kimi-k2.7-code`           | 262,144   | $0.19           | $0.95      | $4.00  |
| `kimi-k2.7-code-highspeed` | 262,144   | $0.38           | $1.90      | $8.00  |
| `kimi-k2.6`                | 262,144   | $0.16           | $0.95      | $4.00  |
| `kimi-k2.5`                | 262,144   | $0.10           | $0.60      | $3.00  |

`/docs/overview` 원문: K3 는 _"2.8 trillion parameters, a 1M-token context window"_,
**`reasoning_effort` 최상위 필드로 `low`/`high`/`max`, 기본 `max`**. K2.7 Code 는
코딩 전용 256K, `-highspeed` 는 출력속도 우선. → **#595 §2 가 말한 "effort 를 1급 축으로"
가 여기서도 그대로 필요하다**(Codex 만의 특성이 아니었다).

**벤치: 일부 확보 — 단, 해석에 함정이 있다.** (§3.3 참조)

### 2.4 Z.ai GLM Coding Plan ✅ ★전체 1순위

**설치형 CLI: 없다. 그리고 그게 장점이다.**

docs.z.ai `/devpack/overview` 원문: _"The GLM Coding Plan is a subscription package
designed specifically for AI-powered coding. The plan can be applied to coding tools
such as **Claude Code**, Cline, and OpenCode"_.

docs.z.ai `/devpack/tool/claude` 에서 추출한 실제 배선(우리가 그대로 쓸 값):

```
ANTHROPIC_BASE_URL=https://api.z.ai/api/anthropic
ANTHROPIC_AUTH_TOKEN=<GLM Coding Plan key>
ANTHROPIC_DEFAULT_OPUS_MODEL / ANTHROPIC_DEFAULT_SONNET_MODEL / ANTHROPIC_DEFAULT_HAIKU_MODEL
```

→ **우리가 이미 스폰하는 `claude` 바이너리에 env 만 다르게 주면 GLM 이 돈다.**
`agent-config.ts` 의 `case "claude"` 런치 컨피그가 이미 `env` 를 조립하고 있으므로
(§4.1), 신규 ModelType·신규 probe·신규 MCP 생성기·신규 cost 파서가 **전부 불필요**하다.

**구독접근: 그렇다 — 우리가 아는 것 중 Claude Code 와 가장 닮은 모양이다.**

- _"Starting at just **18 USD per month**, with Pro and Max plans"_.
- _"we apply usage limits on a **5-hour and weekly** basis"_ — Claude Code 의 5시간
  윈도우와 동일 개념. 플랜별 캡:

  | 플랜 | 5시간 캡       | 주간 캡  |
  | ---- | -------------- | -------- |
  | Lite | 약 80 프롬프트 | 약 400   |
  | Pro  | 약 400         | 약 2,000 |
  | Max  | 약 1,600       | 약 8,000 |

- 지원 모델: **GLM-5.2, GLM-5-Turbo, GLM-4.7** (전 플랜 공통).
- ⚠️ **쿼터 배수 함정**: _"GLM-5.2 and GLM-5-Turbo ... usage will be deducted at **3×
  during peak hours and 2× during off-peak**"_(피크 = 14:00–18:00 UTC+8 = **KST 15:00–19:00**).
  → **우리 라우팅의 비용축이 "시각 의존" 이 되는 첫 사례.** #595 축 B 의 비용대비효과
  계산이 이 벤더에서는 시간대를 모르면 틀린다(§6.3 에서 다룸).
- 토큰 단가: 구독 경로는 프롬프트 캡 방식이라 per-token 리스트가 이 문서에 없다.
  **미확인으로 남긴다**(레지스트리에 "구독제 스킴" 으로 기록 — 우리 `cost-tracker` 는
  이미 `subscriptionPlans` 이중 스킴을 갖고 있다, §6.2).

### 2.5 MiniMax Token Plan ✅ (B형)

- **코딩 CLI 없음.** `mmx-cli`(github.com/MiniMax-AI/cli)는 존재하지만 공식 문서 원문이
  _"one prompt to bring MiniMax into your AI agent ... video generation, speech
  synthesis, music creation"_ 이고, 인증은 `mmx auth login --api-key sk-xxx`,
  용도는 `mmx quota` 등 **멀티모달 능력 + 쿼터 조회 툴**이다. 코딩 에이전트가 아니다.
- 코딩 경로는 문서 제목 그대로 _"Other Tools: Configure the latest MiniMax M-series
  models in **any AI coding tool that supports custom OpenAI-compatible or
  Anthropic-compatible endpoints**"_ → **Z.ai 와 같은 (B)형**.
- 구독(platform.minimax.io `/docs/guides/pricing-token-plan.md` 원문 표):
  **Plus $20/월 · Max $50/월 · Ultra $120/월**, 전 플랜 _"5-hour rolling and weekly
  windows"_, _"Resource coverage: All models on the API Platform"_.
  동시 에이전트 가이드까지 명시돼 있다(Plus 3–4 / Max 4–5 / Ultra 6–7) — **플릿 동시성
  상한을 벤더가 직접 알려주는 드문 경우**라 우리 `MAX_AGENTS` 정책과 맞물린다.
- 크레딧(1,000 credits = $1)은 구독 초과분 커버용 보조 수단이고, 문서가
  _"Token Plan quota is used first; Credits cover eligible overflow"_ 로 순서를 명시한다.
  → **구독이 1급, 종량이 2급**이므로 기준(b) 충족.
- 최신 모델: MiniMax-M3 (사이트 배너 _"MiniMax-M3 is now available! A Frontier Model
  ... for Coding & Agent"_). 구독 경로 per-token 단가는 미확인.

### 2.6 Nous Research Hermes ❌ 제외

**CLI 는 진짜로 있다** — 오해 없게 적는다. `github.com/NousResearch/hermes-agent`
(Python, MIT), 설치 `curl -fsSL https://hermes-agent.nousresearch.com/install.sh | bash`
(Windows PowerShell 원라이너도 있음), 바이너리 `hermes`, 풀 TUI.

**그런데 우리 기준으로는 두 번 탈락한다.**

1. **(b) 구독 불충족.** Nous Portal 요금제(portal.nousresearch.com 크롤):
   Free $0 / **Plus $20 → 월 $22 크레딧** / Super $100 → $110 / Ultra $200 → $220,
   각각 "rollover cap" 있음. 이건 **선불 크레딧이지 정액 구독이 아니다** — 쓰는 만큼
   차감되고 다 쓰면 멈춘다. 티켓이 배제하라고 한 "API 종량과금" 의 월정액 포장이다.
   Claude Code·Codex·GLM·MiniMax 처럼 "정액 + 시간창 레이트리밋" 이 아니다.
2. **성격이 벤더 CLI 가 아니라 경쟁 하네스다.** README 원문: _"Use any model you want —
   Nous Portal, OpenRouter, OpenAI, your own endpoint ... Switch with `hermes model` —
   no code changes, no lock-in."_ 즉 Hermes 는 **우리와 같은 층**(하네스)이지 우리가
   태울 모델 벤더가 아니다. 붙인다면 "모델 편입" 이 아니라 "경쟁 하네스를 우리 플릿에
   워커로 넣는" 별개 의사결정이고, 그건 이 티켓 범위가 아니다.
   (참고: Nous Portal 은 200+ 모델 애그리게이터다. 마블로가 **애그리게이터를 한 번에
   붙이는** 전략을 쓸 거라면 그건 §9-4 로 따로 올린다.)

Nous 자체 모델은 `Hermes-4-70B` / `Hermes-4-405B`(둘 다 128k, portal API docs 원문)로
코딩 플래그십 라인이 아니고, 코딩 벤치 공개도 확인 못 했다.

**결론: 이번 라운드 제외.** 단 "경쟁 하네스 관측 대상" 으로는 가치가 있다 — 스킬 자동생성·
학습루프·6종 터미널 백엔드는 우리 로드맵과 겹친다.

### 2.7 Qwen Code ⏸ 보류

- CLI 실재: npm `@qwen-code/qwen-code` **v0.21.0, 2026-07-24**, `bin: { qwen: "cli-entry.js" }`,
  repo `github.com/QwenLM/qwen-code`. 설치는 npm/brew/standalone 스크립트 3경로.
- 그런데 README 가 스스로를 _"multi-protocol ... Supports OpenAI, Anthropic, Gemini,
  and Qwen APIs. Any third-party provider or local model (Ollama / vLLM)"_ 로 규정하고,
  인증은 `/auth # Configure your provider and API key` 다. → **Hermes 와 같은 BYO
  하네스 성격**이 강하고, 우리가 요구하는 "벤더 구독 로그인" 을 크롤로 확인하지 못했다.
- **보류 사유를 정직하게**: Qwen 계열에 무료/구독 OAuth 티어가 있다는 얘기는 있으나
  **이번 크롤로 확증하지 못했다.** 확증 없이 후보에 올리지 않는다. 2차 조사 대상.

### 2.8 범위 밖 / 이미 처리된 것

- **로컬 모델(Ollama·vLLM·llama.cpp 등): 조사하지 않았다.** 티켓 지시대로 이번은
  구독형만이다. 다음 단계 별도 에픽.
- **Google Gemini CLI**: 이미 `harness-catalog.ts` 에 `deprecated`(2026-06-18 개인
  티어 EOL, Antigravity 로 통합) 로 반영돼 있다. 신규 작업 없음.

---

## 3. 조사에서 나온 판단재료 3개

### 3.1 "구독" 이라는 단어가 두 가지를 가리킨다

| 스킴                         | 예                                                                                         | 라우팅에 주는 의미                                                                   |
| ---------------------------- | ------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------ |
| **정액 + 시간창 레이트리밋** | Claude Code, Codex, **Z.ai($18~, 5h/주간)**, **MiniMax($20~, 5h/주간)**, Kimi(크레딧 배수) | 한계비용 ≈ 0, **한도가 진짜 제약**. 라우팅은 "돈" 이 아니라 "남은 쿼터" 를 봐야 한다 |
| **월정액 선불 크레딧**       | **Nous Portal($20→$22 크레딧)**                                                            | 사실상 종량. 토큰당 단가로 계산해야 맞음                                             |

우리 `cost-tracker.ts` 는 이미 `MODEL_PRICING`(토큰단가)과 `subscriptionPlans`(구독)
**이중 스킴**을 갖고 있다(§6.2). 레지스트리는 이 이분법을 데이터로 표현해야 하고,
**그게 안 되면 #595 축 B 의 "비용 대비 효과" 가 벤더마다 다른 단위를 섞어 계산하게 된다.**

### 3.2 A형 편입의 진짜 비용은 "18개 파일"

`"antigravity"` 리터럴이 등장하는 파일을 실측했다(= 벤더 하나를 1급으로 올렸을 때 실제로
손댄 자리). **18개 파일, 총 52곳**:

| 파일                           | 곳  | 파일                                       | 곳  |
| ------------------------------ | --- | ------------------------------------------ | --- |
| `electron/dispatch-scoring.ts` | 10  | `src/stores/cliSetupStore.ts`              | 2   |
| `electron/agent-config.ts`     | 10  | `src/types/agent.ts`                       | 1   |
| `electron/main.ts`             | 7   | `src/vite-env.d.ts`                        | 1   |
| `electron/bridge-server.ts`    | 5   | `src/hooks/useAppLifecycle.ts`             | 1   |
| `electron/agent-manager.ts`    | 5   | `src/components/Layout.tsx`                | 1   |
| `electron/harness-manager.ts`  | 2   | `src/components/agents/AgentAddModal.tsx`  | 1   |
| `electron/cost-tracker.ts`     | 1   | `src/components/lanes/LaneCreateModal.tsx` | 1   |
| `electron/preload.ts`          | 1   | `electron/orchestrator-manager.ts`         | 1   |
| `electron/mcp-server/tools.ts` | 1   | `electron/orchestrator-handoff.ts`         | 1   |

**이게 §4 설계가 풀어야 할 문제의 크기다.** 벤더 4개를 붙이면 이 수술을 4번 한다.

### 3.3 벤치는 "SWE-bench" 로 끝나지 않는다 — 그리고 하네스에 종속된다

사장님이 말씀하신 SWD/SWE-bench 를 조사하다 확인한 사실이다.

- Moonshot 의 K3 공식 블로그(www.kimi.com/blog/kimi-k3)는 **DeepSWE / SWE Marathon /
  FrontierSWE** 로 평가한다. 고전 SWE-bench Verified 는 주 지표에서 빠졌다.
- **확보한 공식 수치 1건**: 각주 원문 — _"Kimi K3 attains **67.3** with the
  mini-SWE-agent harness. We report the DeepSWE v1.1 tasks."_ (그 외 점수는 공식
  DeepSWE 리더보드 `deepswe.datacurve.ai` 출처라고 명시).
- ★**결정적 함정**: 같은 각주가 _"Depending on the benchmark, each model is evaluated
  under one of three agentic harnesses — **KimiCode, Claude Code, or Codex**"_ 라고
  적는다. 즉 **점수는 (모델)이 아니라 (모델 × 하네스)의 함수다.**
  → 레지스트리에 하네스 표기 없이 점수만 박으면 우리가 우리 데이터로 오해석한다.
  §7 의 레퍼런스 스키마에 `harness` 를 **필수 필드**로 넣은 이유가 이것이다.
- 같은 블로그가 자기 모델에 대해 _"its overall performance still trails the most
  powerful proprietary models, **Claude Fable 5 and GPT 5.6 Sol**"_ 이라고 쓴다.
  **벤더 자신이 우리 기존 2종보다 아래라고 말한다.** → 신규 벤더의 가치는 "더 똑똑함"
  이 아니라 **비용/쿼터 다변화**에 있다는 뜻이고, 이게 §8 우선순위의 근거다.

---

## 4. 하네스 스토어 편입 설계 (코드 근거)

### 4.1 현재 편입 지점 — 실측 9곳

`harness-manager.ts` / `harness-catalog.ts` / `agent-config.ts` / `agent-manager.ts` 를
읽고 정리한, **벤더 하나를 1급 모델로 올릴 때 반드시 지나야 하는 관문**이다.

| #   | 지점                         | 코드                                                                                                                               | 신규 벤더가 해야 할 일                            |
| --- | ---------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------- |
| 1   | **카탈로그 등록**            | `harness-catalog.ts` `CATALOG[]` — `install.kind: git\|mcp\|bundled\|manual\|npm-global\|shell` + `detect: {path\|mcpKey\|binary}` | 엔트리 1개 추가. `npm-global` 또는 `shell`        |
| 2   | **셸 인스톨러 화이트리스트** | `harness-manager.ts:271` `TRUSTED_SHELL_INSTALLER_HOSTS = new Set(["antigravity.google"])`                                         | `curl\|bash` 설치면 호스트 추가 필요(§4.4 보안)   |
| 3   | **설치 상태 감지**           | `detectStatus()` → `isBinaryOnPath()` (enriched PATH)                                                                              | `detect.binary` 만 주면 그대로 동작 (**넷-뉴 0**) |
| 4   | **자동 업데이트**            | `checkAndUpdateHarness()` — npm 은 `npm view` 버전비교 + `isNpmGlobalManaged()` 가드, shell 은 인스톨러 재실행                     | npm 이면 그대로. 단독 바이너리(kimi)는 §4.3       |
| 5   | **인증 프로브**              | `probeCliAuth(model: CliAuthModel)` — env 키 + 크레덴셜 파일 존재검사, 절대 CLI 를 스폰하지 않음                                   | 벤더별 파일경로 1~2줄 추가                        |
| 6   | **스폰 게이트**              | `modelToCliAuth()` + `checkSpawnAuthGate()`                                                                                        | 매핑 1줄                                          |
| 7   | **로그인화면 백스톱**        | `LOGIN_SCREEN_PATTERNS[]` (readiness 루프에서 blind-fallback 억제)                                                                 | 벤더 로그인 문구 정규식 추가                      |
| 8   | **런치 컨피그**              | `agent-config.ts:2298` `buildLaunchConfig()` 의 `switch (model)` — command/args/env/세션핀/MCP 경로                                | `case` 1개 추가 (**가장 큰 덩어리**)              |
| 9   | **MCP 설정 생성**            | `generateMCPConfig()` → `generateClaudeConfig`/`Gemini`/`GPT`/`Antigravity`/`Custom`                                               | 벤더 포맷별 생성기 1개                            |

여기에 **readiness 패턴**(`agent-manager.ts:564`)과 **cost 세션 파서**
(`cost-tracker.ts` — claude=`~/.claude/projects/*.jsonl`, codex/gemini=세션 JSONL,
antigravity=PTY 스크래핑)가 더 붙는다.

### 4.2 재사용 범위 — ★재발명 금지

조사 결론: **1·3·5·6·7 은 지금 설계가 이미 정확하다. 신규 벤더는 데이터만 넣으면 된다.**

- `probeCliAuth` 의 **"CLI 를 절대 스폰하지 않는다"** 규율은 신규 벤더에도 그대로 옳다.
  Grok/Kimi 둘 다 크레덴셜이 **평범한 파일**이다 — `~/.grok/auth.json`(0600, 공식 문서
  명시), Kimi 는 `~/.kimi-code/`(공식 getting-started: _"stores its local data under
  `~/.kimi-code/` by default"_, `KIMI_CODE_HOME` 로 이동 가능). 즉 **claude 의 macOS
  키체인 우회 같은 특수처리가 필요 없다** — 오히려 claude 보다 프로브가 쉽다.
- `LOGIN_SCREEN_PATTERNS` 는 "부팅 직후 버퍼에만 매칭" 규율까지 이미 옳다. 신규 벤더는
  정규식만 추가한다. ★단 패턴은 **라이브 PTY 캡처로 확인한 문구만** 넣어야 한다
  (기존 주석이 codex/agy 를 그렇게 검증했다고 기록한다). 추측 정규식 금지.
- `checkAndUpdateHarness` 의 `isNpmGlobalManaged()` 가드 — "네이티브 자가업데이트 CLI 에
  `npm i -g` 하지 마라" 는 교훈이 **Grok/Kimi 에 정확히 재적용된다**: 둘 다 공식 경로가
  `curl|bash` 단독 바이너리이고 npm 은 대안이다. 이 가드가 없으면 우리가 벤더의
  자가업데이터를 깨뜨린다.
- `--no-auto-update`(grok) / `kimi upgrade`(kimi) 가 있으므로, **자동업데이트는 우리가
  하지 말고 CLI 에 맡기고 대화상자만 억제**하는 선택지가 생긴다. codex 의 "Update
  available!" 대화상자가 PTY 를 죽였던 사고(카탈로그 주석에 기록됨)의 정공법이다.

### 4.3 넷-뉴 — 벤더별로 실제 새로 필요한 것

| 항목              | Grok Build                                                                                      | Kimi Code                                                                         |
| ----------------- | ----------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| 설치 kind         | `npm-global`(`@xai-official/grok`) 또는 `shell`(`x.ai/cli/install.sh`)                          | `shell`(`code.kimi.com/.../install.sh`) 권장, `npm-global` 대안                   |
| 신뢰 호스트 추가  | `x.ai` (shell 선택 시)                                                                          | `code.kimi.com`                                                                   |
| detect.binary     | `grok`                                                                                          | `kimi`                                                                            |
| 인증 프로브       | `~/.grok/auth.json` 존재 + `XAI_API_KEY` env                                                    | `~/.kimi-code/` 크레덴셜 + `MOONSHOT_API_KEY` env ★정확한 파일명 라이브 확인 필요 |
| 로그인 액션       | `grok login` (헤드리스는 `--device-auth`)                                                       | `kimi` 실행 후 `/login`                                                           |
| MCP 주입          | `~/.grok/config.toml` (**TOML** — 우리 생성기는 전부 JSON. 신규 포맷). ★정확한 키 이름은 미확인 | `~/.kimi-code/config.toml` (**TOML**) + `/mcp-config` 대화형                      |
| 세션/리쥼         | `--session-id`/`--resume`/`--continue`, `~/.grok/sessions/`                                     | `-c` 재개, `/sessions`                                                            |
| 헤드리스          | `-p`, `--output-format streaming-json`                                                          | `-p`                                                                              |
| 스킬              | `~/.grok/skills/` ✅                                                                            | 서브에이전트(coder/explore/plan) ✅                                               |
| Windows           | 공식 지원(npm os 목록에 win32)                                                                  | ⚠️ **Git for Windows 선행 필요**                                                  |
| 자동업데이트 억제 | `--no-auto-update` / `config.toml` ✅                                                           | `kimi upgrade` 수동                                                               |

**판단: A형 중에는 Grok Build 가 먼저다.** 이유는 세 가지 모두 코드 근거가 있다 —
① Windows 선행조건이 없고(마블로는 Windows 빌드를 판다), ② `--no-auto-update` 로 우리를
제일 많이 괴롭힌 실패모드를 봉쇄할 수 있고, ③ `~/.grok/skills/` 가 있어 #595 축 D 의
스킬 전달이 codex(스킬 0개)와 달리 성립한다.

**둘 다 공통 넷-뉴 1개: TOML MCP 설정 생성기.** 지금 생성기는 전부 JSON 이다
(`generateClaudeConfig`/`GPT`/`Antigravity`). Grok·Kimi 둘 다 `config.toml` 이므로
**TOML 직렬화가 처음 필요**하다. 다만 필요한 건 우리 MCP 엔트리 한 덩어리뿐이고,
Antigravity 생성기가 이미 "**기존 사용자 항목을 보존하며 머지**" 하는 패턴을 갖고 있으니
그 규율(파괴적 덮어쓰기 금지)을 TOML 로 옮기면 된다.

### 4.4 보안 — 신뢰 호스트를 늘리는 것에 대해

`TRUSTED_SHELL_INSTALLER_HOSTS` 주석이 스스로 규정한다: _"Keep this list small and
curated — the user implicitly trusts whatever runs through here."_

`curl|bash` 는 벤더 서버가 사용자 계정 권한으로 임의 코드를 실행한다는 뜻이다. 그래서:

- **가능하면 `npm-global` 을 고른다.** Grok 은 `@xai-official/grok` 이 있으므로
  **shell 을 안 늘리고 붙일 수 있다** — 신뢰 호스트 확장 0.
- Kimi 는 공식 권장이 shell 이지만 `@moonshot-ai/kimi-code` npm 도 정식 경로다
  (README 가 명시). **npm 경로를 기본으로 하고 shell 은 쓰지 않기를 권한다.**
  (트레이드오프: shell 인스톨러는 체크섬 검증 + Node 불필요라는 장점이 있다. 그래도
  임의코드 실행 허용면을 늘리는 것보다 낫다고 본다.)
- 어느 쪽이든 **설치는 사용자 명시 동의 후 1-click** 이라는 기존 규율을 유지한다.

### 4.5 ★진짜 설계 결정: ModelType 을 늘릴 것인가

지금 `ModelType = "claude" | "gemini" | "gpt" | "antigravity" | "local" | "custom"` 이고,
이게 **agent-manager.ts:22 와 dispatch-scoring.ts:15 에 두 번 중복 정의**돼 있다.
벤더를 union 에 추가하면 §3.2 의 18파일 수술이 매번 반복된다.

**제안: union 을 늘리는 대신 3축으로 분해한다.**

```
harness   — 어떤 바이너리를 스폰하는가       (claude | codex | agy | grok | kimi | custom)
provider  — 어느 백엔드로 붙는가             (anthropic | openai | google | xai | moonshot | zai | minimax)
model     — 어떤 모델 변종·effort 인가        (claude-fable-5 | gpt-5.6-sol@high | grok-4.5 | kimi-k3@max | glm-5.2)
```

이렇게 두면:

- **(B)형 벤더가 코드 없이 데이터로 들어온다.** GLM = `{harness: "claude", provider: "zai", model: "glm-5.2"}`. 스폰 경로는 기존 `case "claude"` 그대로, env 만 프로파일에서
  주입. MiniMax 도 동일. → §2.4/2.5 가 **넷-뉴 케이스 0** 으로 붙는다.
- **(A)형 벤더는 `harness` 축에만 case 를 추가**한다. provider·model 은 데이터.
- `ModelType` 은 **legacy alias 로 남긴다.** 기존 Firestore 문서·라우팅 그래프 셀키·
  텔레메트리에 `"claude"`/`"gpt"` 문자열이 이미 쌓여 있으므로, 삭제가 아니라
  `harness` 로의 **양방향 매핑**을 둔다(§6.4 마이그레이션).

**이건 #595 §2 의 모델 레지스트리를 벤더중립으로 넓힌 것과 정확히 같은 작업**이다.
별개 구조를 새로 만들자는 게 아니라, **레지스트리 항목에 `harness`/`provider`/`envProfile`
필드를 추가**하면 된다.

### 4.5.1 ★진행중 PR#598 과의 델타 (구체적으로 무엇을 더해야 하는가)

이 서베이를 쓰는 동안 **PR#598 이 `electron/model-registry.ts` 를 이미 만들고 있다**
(2026-07-25 기준 OPEN). 그 파일 주석이 이 티켓을 직접 가리킨다 — _"★신규 벤더 추가 절차
= 이 유니온에 한 줄 + 아래 `MODEL_REGISTRY` 에 행 추가. (db3qs0o6 벤더 서베이 결과가
그렇게 편입되도록 만든 구조다.)"_ → **레지스트리를 새로 만들지 마라. 그건 이미 있다.**

다만 서베이 결과, 그 구조에 **한 군데 손봐야 할 곳이 정확히 하나** 있다.

PR#598 의 `ModelProvider` 는 `claude | gemini | gpt | antigravity | local | custom` 으로
**`ModelType` 과 같은 집합**이고, 주석이 그 동일성을 컴파일타임 단언으로 고정한다고 적는다.
즉 지금 구조에서 **provider 와 harness 가 한 축으로 합쳐져 있다.**

**그게 왜 문제인가**: Z.ai GLM 은 provider 로는 `zai` 인데 harness 로는 `claude` 다
(§2.4 — 우리 `claude` 바이너리를 그대로 스폰하고 env 만 바꾼다). 합쳐진 축에 `"zai"` 를
한 줄 넣으면 **`buildLaunchConfig` 의 `switch` 가 `case "zai"` 를 요구하게 되고**,
`ModelType` 과의 동일성 단언 때문에 §3.2 의 18파일 확산이 그대로 되살아난다.
**(B)형 벤더를 데이터로 흡수하겠다는 목적이 축 하나 때문에 깨진다.**

**델타(이것만 하면 된다)**:

1. `ModelProvider`(벤더) 와 `harness`(스폰할 바이너리)를 **별개 필드**로 분리.
   기존 6개 값은 `harness` 쪽이 그대로 승계 → `ModelType` 동일성 단언·회귀가드 유지.
2. 레지스트리 행에 `harness`(기본값 = 기존 provider 값) + `envProfile?` 추가.
   기존 행들은 `harness === provider` 라 **무변경으로 통과**한다.
3. 신규 (B)형 벤더는 `{ provider: "zai", harness: "claude", envProfile: {...} }` 행
   하나로 끝난다 — `switch` 무변경.

→ **PR#598 이 머지되기 전이면 리뷰 코멘트로, 머지된 뒤면 V0-1 티켓으로** 이 델타를 넣는다.

---

## 5. 라우팅 편입 설계

### 5.1 재사용 (재구현 금지 — #595 가 이미 정리했다)

- 지식그래프 전체(`routing-graph.ts`): 감쇠 반감기, 신뢰수축 `n/(n+K)`, 멱등 `seen`,
  원자적 저장, 프로젝트 오버레이 — **그대로 옳다.**
- `graphBias` 는 ±20 clamp 의 tie-breaker 지 오버라이드가 아니라는 층 구분 — 유지.
- `dispatch-scoring.ts` 의 role hard-gate / reuse 보너스 / budget bias 구조 — 유지.

### 5.2 넷-뉴

**(1) cell key 를 `harness+model@effort` 로.** #595 §3 넷-뉴-1 이 이미
`cellKeysForContext(model: ModelType, ...)` → `modelKey` 상승을 제안했다. 이 문서는
**그 키에 provider 를 포함**할 것만 더한다:

```
현재:  role:backend|claude
#595:  role:backend|claude-fable-5
본안:  role:backend|claude/anthropic/claude-fable-5
       role:backend|claude/zai/glm-5.2        ← 같은 하네스, 다른 벤더
```

**provider 를 빼면 안 되는 구체적 이유**: GLM 은 `claude` 하네스로 도는데 모델·쿼터·
장애특성이 Anthropic 과 전혀 다르다. provider 없는 키는 두 벤더의 성과를 한 셀에 섞는다.

★#595 가 경고한 **구키 폴백 2단 조회**는 그대로 필수다 — 안 하면 축적된 94건이 증발한다.

**(2) 벤더중립 레지스트리 = 단일 진입점.** 신규 벤더 편입이 "한 곳 데이터 추가" 가 되려면
레지스트리가 **라우팅이 알아야 할 것을 전부** 갖고 있어야 한다:

```ts
// v3/electron/model-registry.ts (#595 P1-2 를 확장)
interface ModelEntry {
  id: string; // "glm-5.2" | "grok-4.5" | "kimi-k3"
  harness: HarnessId; // 어떤 바이너리로 스폰하는가
  provider: ProviderId; // 어느 백엔드인가
  aliases: string[];
  efforts?: string[]; // kimi-k3: low|high|max / codex: ...|max|ultra
  defaultEffort?: string;
  contextWindow: number;
  billing: // §3.1 이분법을 데이터로
    | {
        kind: "token";
        inputPer1M: number;
        outputPer1M: number;
        cachedInputPer1M?: number;
      }
    | { kind: "subscription"; planId: string; quotaMultiplier?: QuotaRule[] };
  envProfile?: Record<string, string>; // (B)형: ANTHROPIC_BASE_URL 등
  minCli?: string; // CLI 버전가드 (기존 FABLE5_MIN_CLI 패턴 일반화)
  verifiedAt: string; // ★필수 — 무엇을 언제 어떻게 확인했는지
  sourceUrl: string; // ★필수 — 1차 출처
  status: "active" | "deprecated" | "unverified";
}
```

`envProfile` 이 (B)형 벤더를 코드 없이 흡수하는 자리다. `quotaMultiplier` 는 §2.4 의
GLM 피크시간 3× 를 표현하는 자리다.

**(3) 라우팅이 봐야 할 축이 하나 늘어난다: 남은 쿼터.**
정액+시간창 벤더(§3.1)에서는 "비용" 이 아니라 **"이 벤더 5시간 창이 얼마나 남았나"**
가 진짜 제약이다. 마블로엔 이미 `ModelBudgetInfo`(계정 전역 사용률)와 budgetBias 가 있으니
**신규 배선이 아니라 벤더별 확장**이다. 쿼터 조회 수단으로 **문서에서 확인된 것은 2개뿐**이다
— MiniMax `mmx quota`(공식 문서 원문), Z.ai "Usage Statistics"(콘솔, 공식 문서 언급).
**Grok/Kimi 의 쿼터 조회 수단은 확인하지 못했다**(설치 금지 제약). 실제 파싱 방식은
편입 티켓에서 라이브로 확인한 뒤 붙인다 — 지금 추측해서 설계에 박지 않는다.

### 5.3 검증법

- 유닛: 새 키 스킴 `applyOutcome`→`graphBiasForModel` 왕복, 구키 폴백, 멱등성.
- 유닛: `envProfile` 이 있는 (B)형 엔트리가 `buildLaunchConfig("claude")` 의 env 에
  정확히 머지되는지 + **기존 Anthropic 경로에 env 오염이 없는지**(회귀 가드).
- 라이브: 실제 dispatch 후 `~/.marblo/routing-graph.json` 에
  `role:backend|claude/zai/glm-5.2` 류 키가 생기는지 육안 확인.
- **판정 보류**: "GLM 이 simple 에 충분한가" 같은 결론은 데이터가 쌓인 뒤 정한다.
  이 문서는 임계값을 제시하지 않는다.

---

## 6. 지식그래프 모델 레퍼런스 — 지속 관리 설계

티켓의 핵심 요구다: _"모델별 토큰가격 + SWE-bench 점수를 구조화된 레퍼런스로 지식그래프/
레지스트리에 지속 관리. 신규 모델 나오면 갱신하는 흐름."_

### 6.1 두 층을 분리한다 (섞으면 망가진다)

| 층                  | 내용                                      | 갱신 주체                       | 저장                                  |
| ------------------- | ----------------------------------------- | ------------------------------- | ------------------------------------- |
| **사실(reference)** | 모델 존재·컨텍스트·단가·구독플랜·벤치점수 | **사람/런북**(외부 세계가 소스) | `model-registry` 데이터파일, git 추적 |
| **경험(graph)**     | 우리 티켓에서 이 모델이 실제로 어땠나     | **자동**(outcome 파이프라인)    | `~/.marblo/routing-graph.json`        |

★**벤치 점수를 지식그래프에 넣으면 안 된다.** 그래프는 감쇠·신뢰수축이 걸린 *우리 경험*의
자료구조다. 외부 벤치는 감쇠 대상이 아니라 **버전 관리 대상**이다.

**그런데 넣을 자리는 이미 생겼다.** PR#596(`a4c4c2ac`)이 `RoutingGraphCell` 에
**`prior` + `priorNote`** 필드와 베이지안 혼합(`bias = prior·K/(n+K) + netDecayed·n/(n+K)`,
K=6)을 도입했고, 시드는 JSON 직접 편집이 아니라 `npm run graph:seed` 정식 경로로만 하게
막아놨다. → **벤치는 레퍼런스에 사실로 보관하고, 콜드스타트에서만 `prior` 로 주입한다.**
관측이 쌓이면 자동으로 밀려난다. (선례·규율: [`MODEL-COMPARISON-SEED.md`](./MODEL-COMPARISON-SEED.md))

★단 #596 이 확인한 제약이 신규 벤더에도 그대로 적용된다: 시드 가능한 축은 **값 집합이
닫힌 `complexity` enum 뿐**이다(`taskType` 은 읽기경로 부재로 inert, `tags` 는 자유문자열).
신규 벤더 prior 도 같은 제약 안에서만 주입한다.

### 6.2 단가는 이미 있는 이중 스킴 위에 얹는다

`cost-tracker.ts` 는 `MODEL_PRICING`(최장 프리픽스 매칭) + `subscriptionPlans`
(`SUBSCRIPTION_PLANS_FILE` 캐시 로드) 이중 구조를 이미 갖고 있다. **표현 방식은 유지하고
데이터 공급만 레지스트리로 옮긴다**(#595 §2 재사용 범위와 동일 결론).

★현재 `MODEL_PRICING` 실측 상태(신규 벤더를 넣기 전에 이미 문제가 있다):
`claude-opus-4-7`/`sonnet-4-6`/`gpt-5.5`/`gemini-*` 는 있는데 **claude-fable-5·opus-5·
sonnet-5 항목이 없고** `default: {3, 15}` 로 떨어진다(#595 §1.3-③ 이 지적한 그 결함).
신규 벤더 단가를 넣기 전에 **기존 구멍을 먼저 막아야** 비교가 성립한다.

★**PR#596 과의 경계를 명확히 한다**(중복 착수 방지): #596 은 GPT 라인업 단가를 크롤로
확정하고 그 결과를 **그래프 prior 로 주입**했지만, `cost-tracker.ts` 의 `MODEL_PRICING`
자체는 **건드리지 않았다**(리베이스 후 `a4c4c2ac` 실측: 변경파일 5개에 cost-tracker 없음,
키 목록에 여전히 fable-5/opus-5/sonnet-5/gpt-5.6 부재). 즉 #595 P1-3(단가 갭 수리)은
**진행중 PR#598 이 담당한다**(`cost-tracker.ts` + `verify-models.ts` 포함).
→ 이 문서는 그 수리를 **전제**로 하고 중복 착수하지 않는다. PR#598 머지 여부를 먼저 확인할 것.

### 6.3 벤치 레퍼런스 스키마 — `harness` 는 필수다

§3.3 에서 확인했듯 점수는 (모델 × 하네스 × 벤치버전)의 함수다.

```ts
interface BenchScore {
  modelId: string; // "kimi-k3"
  benchmark: string; // "DeepSWE" | "SWE-Marathon" | "FrontierSWE" | "SWE-bench-Verified"
  version: string; // "v1.1"
  harness: string; // ★필수 — "mini-SWE-agent" | "KimiCode" | "Claude Code" | "Codex"
  score: number; // 67.3
  sourceUrl: string; // ★필수 1차 출처
  sourceKind: "vendor-blog" | "official-leaderboard" | "third-party";
  measuredAt: string;
}
```

지금 채울 수 있는 행은 **딱 하나**다 — 그게 정직한 상태다:

| model     | benchmark | version | harness        | score    | source                           |
| --------- | --------- | ------- | -------------- | -------- | -------------------------------- |
| `kimi-k3` | DeepSWE   | v1.1    | mini-SWE-agent | **67.3** | www.kimi.com/blog/kimi-k3 (각주) |

나머지는 `status: unverified` 로 비워 둔다. **빈칸이 가짜 숫자보다 낫다.**

### 6.4 갱신 런북 (신규 모델이 나왔을 때)

```
1. 트리거
   - 정기: 월 1회
   - 이벤트: CLI 자동업데이트가 신버전 감지 / 벤더 릴리스노트 / 사장님 지시
2. 수집 (★1차 출처만)
   a. CLI 프로브 — #595 §1 기법. `codex` 는 ~/.codex/models_cache.json,
      `claude` 는 --output-format json 의 modelUsage 대조.
      신규: `grok inspect`(설정·모델 발견 결과 출력), `kimi /model`.
      ★프로브는 "이미 설치된 CLI" 에만. 조사 목적 설치는 사장님 승인 후.
   b. 단가 — 벤더 공식 pricing 페이지. 이번에 확인한 URL:
      docs.x.ai/developers/pricing · platform.kimi.ai/docs/pricing/*.md ·
      docs.z.ai/devpack/overview · platform.minimax.io/docs/guides/pricing-token-plan.md
      ※ Kimi/MiniMax/Z.ai 문서는 `llms.txt` 인덱스를 제공한다 — 그걸 먼저 받으면
        URL 추측 없이 정확한 문서 목록을 얻는다(이번 조사에서 실제로 그렇게 했다).
   c. 벤치 — 벤더 블로그 각주 + 공식 리더보드. harness 표기 없으면 채택하지 않는다.
3. 기록 — 레지스트리 항목에 verifiedAt / sourceUrl / 확인방법을 함께 커밋.
   ★수치만 바꾸고 출처를 안 바꾸는 커밋은 리뷰에서 반려.
4. 검증 — `scripts/verify-models.ts`(#595 P1-5)를 벤더중립으로 확장:
   레지스트리 ↔ 실제 CLI 대조 → 불일치(등록됐는데 CLI 거부 / CLI 엔 있는데 미등록) 리포트.
   ★CI 말고 수동 런북 (네트워크 의존이라 CI 에 넣으면 플레이키).
5. 파급 — 단가가 바뀌면 그 이후 구간만 새 단가. 과거 cost_logs 소급 재계산 금지
   (과거 실제 청구액을 왜곡한다).
```

**갱신 실패를 감지하는 장치**: 레지스트리 항목의 `verifiedAt` 이 N일보다 오래되면
`status: stale` 로 리포트한다. §2.3 의 Kimi 요금제 개편 배너("plans coming soon,
benefits will be separated")가 정확히 이 장치가 필요한 이유다 — **오늘 맞는 숫자가
다음 달엔 틀린다.**

---

## 7. 프로그레스 가능 후보 우선순위

**정렬 기준**: (편입비용 낮음) × (구독 확실성) × (기존 실패모드 회피). "모델이 더 똑똑함"
은 기준에서 뺐다 — §3.3 에서 벤더 자신이 우리 기존 2종보다 아래라고 말했기 때문이다.

| 순위  | 벤더                     | 편입 모양       | 왜 이 순서인가                                                                                            | 위험                                                              |
| ----- | ------------------------ | --------------- | --------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------- |
| **1** | **Z.ai GLM Coding Plan** | (B) env only    | 신규 CLI·probe·MCP생성기·cost파서 **전부 0**. $18/월로 검증 비용도 최저. 배선값을 이미 확보(§2.4)         | 피크시간 3× 쿼터 배수가 비용축을 시간의존으로 만듦                |
| **2** | **MiniMax Token Plan**   | (B) env only    | 1번과 동일 구조 → 1번 배선 재사용. 동시 에이전트 권장치까지 제공                                          | Anthropic-compatible 엔드포인트 정확 URL 미확보(문서 재확인 필요) |
| **3** | **xAI Grok Build**       | (A) 신규 하네스 | A형 중 유일하게 Windows 선행조건 0 + `--no-auto-update` + `~/.grok/skills/`. npm 경로라 신뢰호스트 확장 0 | TOML MCP 생성기 넷-뉴. 벤치 미확인                                |
| **4** | **Moonshot Kimi Code**   | (A) 신규 하네스 | 3번에서 만든 TOML 생성기·프로브 패턴 재사용. K3 1M 컨텍스트가 차별점                                      | Windows Git Bash 선행조건. 요금제 개편 중                         |
| —     | Qwen Code                | 보류            | 구독 확증 실패                                                                                            | 2차 조사 후 재판정                                                |
| —     | Nous Hermes              | 제외            | 크레딧=종량, 경쟁 하네스                                                                                  | 별도 의사결정 사안                                                |

**★1·2번을 먼저 하면 3·4번이 더 싸진다.** (B)형을 붙이면서 만드는 것 —
벤더중립 레지스트리, `envProfile` 주입, provider 포함 cell key, 벤치 레퍼런스 스키마 —
가 전부 (A)형의 선행조건이다. 즉 순서를 이렇게 잡으면 **같은 작업을 두 번 하지 않는다.**

---

## 8. 구현 티켓 분해 제안

오케가 `create_tasks_bulk` 로 만들 수 있게 정리했다. **전부 사장님 승인 후 착수.**
`V1-*` 는 #595 의 `P*-*` 와 별개 번호이지만 **의존관계는 명시**했다.

### Phase V0 — 기반 (#595 와 공유, 선행조건)

| #    | 제목                                                                                                                                                                                                                                                           | role    | 의존   | 우선   |
| ---- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------- | ------ | ------ |
| V0-1 | **★PR#598 레지스트리에 harness/provider 축 분리 델타** — 레지스트리를 새로 만들지 말 것(PR#598 이 이미 만듦). `ModelProvider`(벤더)와 `harness`(스폰 바이너리)를 별개 필드로 + 행에 `envProfile?` 추가. 기존 행은 `harness===provider` 라 무변경 통과 (§4.5.1) | backend | PR#598 | **P0** |
| V0-2 | **벤치 레퍼런스 테이블 도입** — §6.3 스키마. 초기 데이터는 확인된 1행만, 나머지 `unverified`                                                                                                                                                                   | backend | V0-1   | P1     |
| V0-3 | **모델 레퍼런스 갱신 런북 문서화** — §6.4. PR#598 의 `electron/scripts/verify-models.ts`(`npm run verify:models`)를 신규 벤더까지 확장                                                                                                                         | backend | V0-1   | P2     |

### Phase V1 — (B)형 벤더: 코드 최소, 효과 최대

| #    | 제목                                                                                                                                                | role    | 의존            | 우선   |
| ---- | --------------------------------------------------------------------------------------------------------------------------------------------------- | ------- | --------------- | ------ |
| V1-1 | **`envProfile` 주입 배선** — `buildLaunchConfig` 의 `case "claude"` 가 레지스트리 프로파일 env 를 머지. ★기존 Anthropic 경로 무오염 회귀테스트 필수 | backend | V0-1            | **P0** |
| V1-2 | **Z.ai GLM 프로파일 등록 + 라이브 검증** — 구독 1개 결제 → 실제 티켓 1건을 GLM 으로 완주                                                            | backend | V1-1            | **P0** |
| V1-3 | **provider 포함 cell key + 구키 폴백** — #595 P2-2 를 provider 축까지. 2단 조회로 기존 94건 보존                                                    | backend | V0-1, #595 P2-1 | P1     |
| V1-4 | **MiniMax 프로파일 등록** — V1-1 배선 재사용. Anthropic-compatible 엔드포인트 URL 문서 재확인 포함                                                  | backend | V1-2            | P2     |
| V1-5 | **쿼터 인지 라우팅(정액+시간창 벤더)** — 남은 5시간/주간 쿼터를 budgetBias 축에. GLM 피크 3× 배수 반영                                              | backend | V1-2            | P2     |

### Phase V2 — (A)형 하네스: Grok Build

| #    | 제목                                                                                                                                        | role    | 의존       | 우선 |
| ---- | ------------------------------------------------------------------------------------------------------------------------------------------- | ------- | ---------- | ---- |
| V2-1 | **harness 축 도입** — `ModelType` union 을 `harness` 로 분해, 기존 리터럴은 legacy alias 로 양방향 매핑(§4.5). ★18파일 확산을 여기서 끊는다 | backend | V0-1       | P1   |
| V2-2 | **TOML MCP 설정 생성기** — 기존 사용자 항목 보존 머지(Antigravity 생성기 규율 계승)                                                         | backend | V2-1       | P1   |
| V2-3 | **Grok Build 카탈로그 등록 + probe** — `npm-global @xai-official/grok`, detect `grok`, probe `~/.grok/auth.json`, action `grok login`       | backend | V2-1       | P1   |
| V2-4 | **Grok spawn 경로** — `buildLaunchConfig` case, readiness 패턴(★라이브 PTY 캡처로 확인), `--no-auto-update`, 세션 핀                        | backend | V2-2, V2-3 | P1   |
| V2-5 | **Grok cost 파싱** — `--output-format streaming-json`/세션 파일 기반. PTY 스크래핑 회피                                                     | backend | V2-4       | P2   |
| V2-6 | **Grok 스킬 전달 검증** — `~/.grok/skills/`. #595 P4-3(codex 스킬 0개)의 대안 경로가 되는지                                                 | backend | V2-4       | P2   |

### Phase V3 — (A)형 하네스: Kimi Code

| #    | 제목                                                                                                               | role     | 의존       | 우선 |
| ---- | ------------------------------------------------------------------------------------------------------------------ | -------- | ---------- | ---- |
| V3-1 | **Kimi Code 카탈로그 등록 + probe** — npm `@moonshot-ai/kimi-code`, detect `kimi`, ★크레덴셜 실제 파일명 확인 필요 | backend  | V2-3       | P2   |
| V3-2 | **Kimi spawn + TOML MCP** — V2 산출물 재사용                                                                       | backend  | V3-1, V2-2 | P2   |
| V3-3 | **Windows 선행조건 UX** — Git for Windows 미설치 시 카탈로그가 명확히 안내(설치 실패 후 침묵 금지)                 | frontend | V3-1       | P2   |

### Phase V4 — 후속 조사 (코드 아님)

| #    | 제목                                                                                 | role    | 의존 | 우선 |
| ---- | ------------------------------------------------------------------------------------ | ------- | ---- | ---- |
| V4-1 | **Qwen 구독 확증 2차 조사** — flat 구독 OAuth 존재 여부                              | backend | —    | P3   |
| V4-2 | **Grok 공식 벤치 재수집** — Cloudflare 우회 가능한 경로(다른 네트워크/공식 리더보드) | backend | V0-2 | P3   |
| V4-3 | **로컬모델 에픽** — ★이번 범위 밖. 별도 에픽으로                                     | backend | —    | P3   |

**권장 착수 순서**: V0-1 → V1-1 → **V1-2(GLM 라이브 1건)** → V1-3 → V2-1 → V2-3/4.
V1-2 까지가 "벤더 확장이 실제로 되는가" 를 최소 비용($18)으로 증명하는 구간이다.

---

## 9. 사장님께 확인이 필요한 것

1. **(B)형을 먼저 붙이는 것에 동의하시는지.** 티켓은 "설치형 CLI 편입" 을 전제로 쓰셨는데,
   조사 결과 가장 싼 확장은 **신규 CLI 없이 `claude` 에 env 만 바꾸는 것**이었다(§2.4).
   설치형(A형)도 하되 순서를 뒤로 미루자는 제안이다.
2. **어느 구독을 실제로 결제할지.** 검증엔 실계정이 필요하다. 최소 비용 경로는
   **Z.ai Lite $18/월 1개**다. Kimi 는 $15/월부터지만 요금제 개편 중이라 지금 결제는
   대기를 권한다.
3. **`ModelType` union 분해(§4.5)를 승인하실지.** 18파일 확산을 끊는 리팩터라 파급이 크다.
   승인 없이는 union 에 벤더를 계속 추가하는 방식(싸지만 매번 18파일)으로 간다.
4. **애그리게이터 전략을 볼지.** Nous Portal 같은 곳은 200+ 모델을 키 하나로 준다.
   벤더를 하나씩 붙이는 것과 근본적으로 다른 선택지라 별도 판단이 필요하다.
   (단 크레딧=종량이라 "구독 다변화" 목적에는 안 맞는다.)
5. **Grok 벤치가 미확인인 채로 3순위에 두는 것을 수용하실지.** 점수 없이도 편입 근거
   (Windows 지원·업데이트 억제·스킬 디렉터리)는 충분하다고 판단했다.

---

## 10. 이 문서가 하지 않은 것

- **CLI 를 하나도 설치하지 않았다.** 티켓 지시대로 조사만 했다. 따라서 프로브 파일 경로 등
  "설치해야 확실해지는" 항목은 ★표로 남겨 편입 티켓에서 확인하게 했다.
- **코드를 고치지 않았다.** 발견한 문제(§6.2 의 단가 구멍)도 기존 진행중 작업과 중복이라
  포인터만 남겼다.
- **모델명·가격·벤치를 추론하지 않았다.** 이 문서의 모든 숫자는 §1 의 1차 출처 크롤에서
  왔다. 못 얻은 것은 '미확인' 이라고 적었지 채워 넣지 않았다.
- **임계값을 정하지 않았다.** "GLM 이 simple 에 충분한가" 같은 판단은 실적재 데이터
  이후다(#595 §9 와 같은 규율).
- **로컬 모델을 조사하지 않았다.** 범위 밖이다.
