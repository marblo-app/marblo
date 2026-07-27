# 신규 벤더/모델 사용법 가이드

> 관련 런북: [`VENDOR-GLM-ZAI.md`](./VENDOR-GLM-ZAI.md),
> [`VENDOR-MINIMAX.md`](./VENDOR-MINIMAX.md),
> [`VENDOR-EXPANSION-SURVEY.md`](./VENDOR-EXPANSION-SURVEY.md)
>
> 작성 2026-07-27. 외부 수치는 공식 문서 또는 위 런북의 2026-07-26 실측값만 사용.
> 확정 못 한 값은 추정하지 않고 `(확인 필요)` 로 둔다.

## 0. 한 줄

Marblo 의 새 모델은 두 갈래다.

- **Grok**: `grok` CLI 를 설치하고 `grok login` 으로 브라우저 인증한다. 이 경로는
  Grok/SuperGrok/X 구독 계정의 브라우저 auth 이고, `XAI_API_KEY` 는 별도의 xAI API
  종량제 키다.
- **GLM(z.ai) / MiniMax**: 새 CLI 가 아니라 기존 `claude` 하네스에 벤더 env 만 얹는
  env-swap 모델이다. `ZAI_API_KEY` 또는 `MINIMAX_API_KEY` 를 `v3/.env` 에 등록하고
  `dispatch_task(model="...")` 로 명시 지정한다.

## 1. 등록 전 규칙

- 키 값은 문서, 코드, 로그, 티켓 activity 에 쓰지 않는다. 키 이름만 쓴다.
- `.env` 를 수정한 뒤에는 앱을 재시작한다. dotenv 는 부팅 시점에 한 번 로드된다.
- GLM/MiniMax 는 자동 라우팅 사다리에 아직 없다. 키 없는 기기에서 조용히 실패하지
  않도록 **명시 지정 전용**이다.
- 검증은 먼저 오프라인으로 한다.

```bash
npm run verify:models -- --offline
```

키와 구독이 준비된 기기에서만 라이브 프로브를 실행한다.

```bash
npm run verify:models
```

## 2. GLM(z.ai)

### API 키 발급 위치

공식 Quick Start 기준:

- Z.AI Open Platform 에 로그인한다.
- Individual Plan 은 **Individual Coding Plan > Plan Overview** 에서 API Key 를 만든다.
- Team Plan 은 **Team Coding Plan > My Plan** 에서 Team Plan Key 를 받는다.
- Team Plan Key 는 다른 Z.AI API Key 와 호환되지 않는다.

### Marblo 등록 방법

`v3/.env` 에 키 이름으로 등록한다.

```bash
ZAI_API_KEY=<발급받은 키>
```

현재 Marblo 레지스트리의 GLM env-swap 모델:

```text
glm-5.2
glm-4.7
```

사용 예:

```text
dispatch_task(role="backend", instruction="...", model="glm-4.7")
dispatch_task(role="backend", instruction="...", model="glm-5.2")
```

확인된 배선:

- Anthropic-compatible endpoint: `https://api.z.ai/api/anthropic`
- OpenAI-compatible endpoint: `https://api.z.ai/api/coding/paas/v4` (Marblo 는 현재 미사용)
- Marblo env profile: `ANTHROPIC_BASE_URL`, `ANTHROPIC_AUTH_TOKEN`,
  `ANTHROPIC_DEFAULT_OPUS_MODEL`, `ANTHROPIC_DEFAULT_SONNET_MODEL`,
  `ANTHROPIC_DEFAULT_HAIKU_MODEL`

주의:

- `glm-5.2[1m]` 같은 1M 컨텍스트 변형은 현재 미등록이다. 최신 Claude Code 동작과
  `CLAUDE_CODE_AUTO_COMPACT_WINDOW=1000000` 조합의 라이브 검증 후 별도 편입한다.
- 가격/쿼터는 최신 공식 런북 값을 참조한다. 새 수치를 확인하지 못하면 `(확인 필요)` 로
  남긴다.

## 3. MiniMax

### API 키 발급 위치

공식 MiniMax Token Plan 문서는 키를 **Subscription Key** 로 부른다.

- MiniMax Developer Platform / Token Plan 계정에서 Subscription Key 를 발급한다.
- international 계정은 `api.minimax.io` endpoint 를 쓴다.
- China 계정은 `api.minimaxi.com` endpoint 를 쓰지만, Marblo 현재 레지스트리는
  international endpoint 만 등록한다.

### Marblo 등록 방법

`v3/.env` 에 키 이름으로 등록한다.

```bash
MINIMAX_API_KEY=<발급받은 키>
```

현재 Marblo 레지스트리의 MiniMax env-swap 모델:

```text
MiniMax-M3
MiniMax-M2.7
```

사용 예:

```text
dispatch_task(role="frontend", instruction="...", model="MiniMax-M3")
dispatch_task(role="frontend", instruction="...", model="minimax-m3")
```

대소문자:

- 벤더 공식 id 는 `MiniMax-M3` 처럼 대소문자 혼합이다.
- Marblo 조회는 대소문자를 접으므로 `minimax-m3` 도 같은 모델로 해석한다.
- API/CLI 로 나가는 실제 id 는 레지스트리 원문 표기(`MiniMax-M3`)를 유지한다.

1M 컨텍스트 뉘앙스:

- 공식 Claude Code 문서는 `MiniMax-M3[1m]` 와
  `CLAUDE_CODE_AUTO_COMPACT_WINDOW=1000000` 조합을 제시한다.
- Marblo 는 아직 `MiniMax-M3[1m]` 을 등록하지 않았다. 라이브 검증 없이 auto-compact
  threshold 를 올리면 실제 Claude Code/벤더 응답 표기/cost tracker 상호작용을 확인할 수
  없기 때문이다.
- 현재 등록값 `MiniMax-M3` 는 더 일찍 compact 될 수 있다. 이는 긴 컨텍스트를 덜 쓰는
  쪽의 보수적 동작이다.

확인된 배선:

- Anthropic-compatible endpoint: `https://api.minimax.io/anthropic`
- OpenAI-compatible endpoint: `https://api.minimax.io/v1` (Marblo 는 현재 미사용)
- 모델 소개의 `MiniMax-M3`: 1M context window

## 4. Grok

### 설치

공식 설치:

```bash
curl -fsSL https://x.ai/cli/install.sh | bash
```

Windows PowerShell 설치는 xAI Grok Build 문서의 Windows 탭을 따른다. npm 대안은
기존 서베이 기준 `@xai-official/grok` 이다.

### 브라우저 인증

```bash
grok login
```

또는 첫 `grok` 실행에서 브라우저 인증이 열린다. 원격/헤드리스 환경은 공식 CLI
reference 의 device-code 경로를 쓴다.

```bash
grok login --device-auth
```

정리:

- `grok login` / 첫 실행 브라우저 auth: Grok 제품 계정 인증이다. 제품 접근권은
  Grok/SuperGrok/X 구독 상태의 영향을 받는다.
- `XAI_API_KEY`: xAI API 호출용 키다. xAI 공식 FAQ 기준 계정은 공유될 수 있지만
  Grok 앱/웹 결제와 xAI API 결제는 별도다.
- API 키 직접 사용은 비브라우저 환경 fallback 또는 API/SDK 사용 경로로 취급한다.

현재 Marblo Grok 모델:

```text
grok-4.5
grok
```

사용 예:

```text
dispatch_task(role="backend", instruction="...", model="grok")
dispatch_task(role="backend", instruction="...", model="grok-4.5")
```

검증된 수치:

- `grok-4.5`: 공식 models page 기준 context 500k tokens, input $2.00 / 1M,
  output $6.00 / 1M.
- Grok Build 구독/프로모션 과금과 xAI API 단가는 별도 축이므로, Marblo cost 값은
  상한 추정치로 본다.

## 5. dispatch 모델 지정법

`dispatch_task` 의 `model` 파라미터는 두 층위를 받는다.

### 프로바이더/하네스 지정

```text
model="claude"
model="codex"
model="gpt"
model="grok"
model="antigravity"
```

- `codex` 와 `gpt` 는 같은 Codex CLI 로 접힌다.
- 구체 모델은 난도(`complexity`)별 티어 정책이 고른다.

### 구체 모델 지정

```text
model="grok-4.5"
model="glm-4.7"
model="glm-5.2"
model="MiniMax-M3"
model="MiniMax-M2.7"
model="claude-opus-5"
model="gpt-5.6-terra"
```

구체 모델을 지정하면 태그 스코어링을 우회한다. 레지스트리에 없는 id 는 추측으로
스폰하지 않고 기존 스코어링으로 폴백한다.

### effort 포함 지정

Codex 계열은 effort 축을 함께 줄 수 있다.

```text
model="gpt-5.6-terra@xhigh"
model="gpt-5.6-sol@max"
model="gpt-5.6-sol", effort="ultra"
```

- `model="@effort"` 표기가 별도 `effort` 파라미터보다 우선한다.
- `max` / `ultra` 는 고비용 승인 게이트 대상이다.
- Claude 하네스 기반 모델(GLM/MiniMax 포함)은 CLI 인자 effort 축이 없으므로
  `effort` 를 줘도 무시된다.

## 6. 빠른 체크리스트

```text
GLM
1. Z.AI Open Platform 에서 Coding Plan 키 발급
2. v3/.env 에 ZAI_API_KEY 등록
3. 앱 재시작
4. npm run verify:models -- --offline
5. dispatch_task(..., model="glm-4.7")

MiniMax
1. MiniMax Token Plan Subscription Key 발급
2. v3/.env 에 MINIMAX_API_KEY 등록
3. 앱 재시작
4. npm run verify:models -- --offline
5. dispatch_task(..., model="MiniMax-M3")

Grok
1. grok CLI 설치
2. grok login 으로 브라우저 인증
3. dispatch_task(..., model="grok-4.5")
4. XAI_API_KEY 는 별도 API 종량제 경로가 필요할 때만 사용
```

## 7. 공식 근거

- Z.ai Quick Start: `https://docs.z.ai/devpack/quick-start`
- Z.ai Claude Code: `https://docs.z.ai/devpack/tool/claude`
- Z.ai model switching: `https://docs.z.ai/devpack/latest-model`
- MiniMax Claude Code: `https://platform.minimax.io/docs/token-plan/claude-code`
- MiniMax Other Tools: `https://platform.minimax.io/docs/token-plan/other-tools`
- MiniMax Models: `https://platform.minimax.io/docs/guides/models-intro`
- xAI Grok Build: `https://docs.x.ai/build/overview`
- xAI CLI Reference: `https://docs.x.ai/build/cli/reference`
- xAI Accounts FAQ: `https://docs.x.ai/console/faq/accounts`
- xAI Models: `https://docs.x.ai/developers/models`
