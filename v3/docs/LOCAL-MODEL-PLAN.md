# 로컬 모델 편입 설계 — `provider=local` 을 축분리 위에 얹기

> **★이 문서는 기획이다. 구현이 아니다.**
> 티켓 `vzHgU4TxFWix1zoVoxPw` 산출물. **코드 변경 0** — 이 문서 1개뿐이다.
> 런타임(Ollama/LM Studio/llama.cpp)은 **하나도 설치하지 않았다.** 이 Mac 에는
> `ollama` 도 `lms` 도 PATH 에 없다(실측). 근거는 전부 공식 문서 크롤이고,
> 설치해야만 확실해지는 항목은 ★표로 남겨 구현 티켓에서 라이브 확인하게 했다.
>
> 작성 2026-07-26 · 기준 커밋 `0d01ce98` (main)
> 선행 문서: [`VENDOR-EXPANSION-SURVEY.md`](./VENDOR-EXPANSION-SURVEY.md) (#599) —
> 거기서 **로컬은 명시적으로 범위 밖**(§2.8, §8 V4-3)이었다. 이 문서가 그 V4-3 이다.
> 선행 티켓: `USbdRV4koQyqjRFKJAPf` (provider≠harness 축분리, 2026-07-26 기준 IN_PROGRESS).
> 병행 문서: [`INTELLIGENT-ROUTING-PLAN.md`](./INTELLIGENT-ROUTING-PLAN.md) (#595),
> [`MODEL-COMPARISON-SEED.md`](./MODEL-COMPARISON-SEED.md) (#596).

---

## 0. 한 줄 요약

**로컬 모델은 새 하네스가 아니다. `claude` 바이너리에 env 3개를 갈아끼우는
(B)형 프로바이더 프로파일이고, GLM/MiniMax 와 정확히 같은 축을 탄다.**

Ollama 는 **공식 Anthropic Messages 호환 엔드포인트**(`POST /v1/messages`)를 갖고
있고, 공식 문서가 **Claude Code 를 이름으로 지목해** 배선을 적어 둔다(§2.2).
그래서 편입에 필요한 신규 코드는 서베이가 말한 (B)형과 동일하다 — **레지스트리
한 행 + envProfile**. 새 하네스·새 probe·새 MCP 생성기·새 cost 파서가 전부 0 이다.

**넷-뉴는 로컬 고유의 3개뿐이다:**

1. **가용성 감지** — 클라우드 벤더는 "키가 있나"를 파일 존재로 물으면 됐다.
   로컬은 "서버가 떠 있나 · 모델이 받아져 있나 · 컨텍스트가 충분한가"를 물어야 한다.
2. **비용 = 0(marginal)** — 단가표에 0 을 넣는 게 아니라 **billing 스킴을 하나 더**
   만드는 일이다. 그리고 0 은 무해하지 않다(§7.4의 쏠림 함정).
3. **라우팅 티어 격리** — 로컬 코딩모델은 우리 기존 2종보다 아래다. 콜드 라우팅
   후보집합에서 **아예 빼고**, 명시 지정·정책 플래그일 때만 들어오게 한다.

**가장 큰 리스크는 모델 품질이 아니라 컨텍스트다.** Ollama 기본 컨텍스트는
VRAM 24GiB 미만이면 **4k**, 24~48GiB 면 32k 이고, 공식 문서가 "코딩 툴은 최소
64k" 를 권고한다(§2.2, 1차 출처). 우리 에이전트는 헌법 프롬프트 + 역할 스킬 +
MCP 툴 정의만으로 4k 를 넘는다. **컨텍스트 게이트 없이 로컬을 켜면 "모델이
멍청하다"가 아니라 "대화가 잘린다"로 실패한다.**

---

## 1. 조사 방법과 증거 규율

서베이(#599 §1)의 규율을 그대로 승계한다.

- 웹 조사는 전부 gstack `/browse` 헤드리스 크롬(글로벌 규칙). `mcp__claude-in-chrome`
  미사용.
- **1차 출처만 인용한다**: `docs.ollama.com`, `lmstudio.ai/docs`,
  `raw.githubusercontent.com/ggml-org/llama.cpp` README 원문, GitHub Releases API.
  블로그·기사·커뮤니티 벤치는 근거로 쓰지 않았다.
- **런타임을 하나도 설치하지 않았다.** `command -v ollama` / `command -v lms` 둘 다
  미검출(2026-07-26, 이 Mac). 따라서 **라이브 프로브가 필요한 값은 전부 ★미확인**이다.
- **모델 품질 수치를 하나도 쓰지 않았다.** Ollama 문서가 "코딩엔 qwen3-coder /
  glm-4.7 / minimax-m2.1 권장" 이라고 적은 것은 인용하지만, 그건 **벤더의 권장이지
  벤치가 아니다.** 서베이 §3.3 의 교훈(점수는 모델 × 하네스의 함수)이 로컬에선 더
  심하다 — 양자화 수준까지 변수라서 (모델 × 양자화 × 하네스 × 컨텍스트)다.
  **추정 점수를 표에 박지 않는다.**
- 코드 주장은 전부 이 워크트리 실측이고 `파일:라인` 을 남겼다.

**남긴 구멍 3개**(정직하게 적는다):

| 구멍                                         | 원인                                          | 영향                                                                                                               |
| -------------------------------------------- | --------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| 로컬 모델의 실제 코딩 성능                   | 설치·실행 없이 알 수 없음. 벤더 권장문만 확보 | **판정에 영향 없음** — 이 설계는 로컬을 "약하다고 가정" 하고 티어를 짠다. 반대 가정이면 승격은 데이터로 한다(§7.1) |
| Claude Code ↔ Ollama 의 실제 툴콜·MCP 신뢰도 | 라이브 필요                                   | L7 라이브 검증에서 확인. **여기서 추측해 설계에 박지 않는다**                                                      |
| 로컬 세션의 cost/usage 파싱 실제 모양        | 라이브 필요                                   | `~/.claude/projects/*.jsonl` 이 로컬 모델 id 로 어떻게 남는지 확인 필요(§4-③ 의 유령비용 수리에 직결)              |

---

## 2. 런타임 선택 — Ollama vs LM Studio vs llama.cpp

### 2.1 비교표 (전부 1차 출처 확인)

| 축                            | **Ollama**                                                                                                  | **LM Studio**                                                                                     | **llama.cpp (`llama-server`)**                                               |
| ----------------------------- | ----------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| Anthropic 호환 `/v1/messages` | ✅ 전용 문서 페이지                                                                                         | ✅ 전용 문서 페이지                                                                               | ✅ README 기능 목록 + 전용 섹션                                              |
| OpenAI 호환                   | ✅ `/v1/chat/completions`, `/v1/completions`, `/v1/models`, `/v1/embeddings`, **`/v1/responses`**(v0.13.3+) | ✅ `/v1/chat/completions`, `/v1/completions`, `/v1/embeddings`, `/v1/models`, **`/v1/responses`** | ✅ `/v1/chat/completions`, `/v1/completions`, `/v1/models`, responses 라우트 |
| 기본 포트                     | `11434`                                                                                                     | `1234`                                                                                            | `8080` (README 예제 기준)                                                    |
| localhost 인증                | **불필요**(공식 명시)                                                                                       | 기본 불필요, `Require Authentication` 옵션 시 `x-api-key`/`Bearer`                                | 기본 없음, `--api-key`/`--api-key-file` 로 켬                                |
| 모델 관리                     | ✅ `ollama pull`, `/api/tags`, `/api/ps`, `ollama cp`                                                       | ✅ 앱/`lms` CLI, REST v0 에 load/unload/download                                                  | ❌ GGUF 파일을 사용자가 관리                                                 |
| **가용성 조회 API**           | ✅ `/api/tags`(설치목록·size·parameter_size·quantization), `/api/ps`(**`size_vram`·`context_length`**)      | ✅ REST v0 (loaded/unloaded·max context·quantization·TTFT)                                        | △ `/v1/models`, `/health`                                                    |
| 하네스 공식 통합              | ✅ **Claude Code 전용 문서 + `ollama launch claude`**, Codex 전용 문서 + `ollama launch codex`              | ✅ Claude Code 문서 + Codex(Responses) 문서                                                       | ❌ 문서에 하네스 통합 없음                                                   |
| 헤드리스 운영                 | ✅ `ollama serve`                                                                                           | ✅ 서비스 모드(GUI 없이, 로그인 시 자동시작)                                                      | ✅ 서버 바이너리                                                             |
| 툴콜 전제조건                 | 모델이 지원하면 됨                                                                                          | 모델이 지원하면 됨                                                                                | ⚠️ **`--jinja` 플래그 필요**(+ 템플릿 오버라이드가 필요할 수 있음)           |
| 설치 난이도(우리 사용자 기준) | 낮음(단일 앱/설치 스크립트)                                                                                 | 낮음(GUI 앱)                                                                                      | **높음**(빌드/GGUF/플래그 튜닝)                                              |

### 2.2 Ollama — 1순위. 이유는 "호환" 이 아니라 "감지" 다

셋 다 Anthropic 호환을 준다. **차이는 우리가 물어야 하는 질문에 답해주는가**다.

**(a) 배선이 이미 문서에 있다** — `docs.ollama.com/integrations/claude-code.md`
manual setup 원문:

```
export ANTHROPIC_AUTH_TOKEN=ollama
export ANTHROPIC_API_KEY=""
export ANTHROPIC_BASE_URL=http://localhost:11434
claude --model qwen3.5
```

`docs.ollama.com/api/anthropic-compatibility` 도 같은 값을 적고
_"Ollama provides compatibility with the Anthropic Messages API to help connect
existing applications to Ollama, **including tools like Claude Code**"_ 라고 명시한다.
지원 기능 목록도 우리에게 필요한 것을 덮는다 — Messages / Streaming / **System
prompts** / Multi-turn / Vision / **Tools (function calling)** / **Tool results** /
Thinking, 응답에 `usage(input_tokens, output_tokens)`, 스트리밍 이벤트 8종.

★**`ANTHROPIC_API_KEY=""` 를 문서가 명시적으로 지운다.** 이건 장식이 아니다 —
사용자 셸에 진짜 Anthropic 키가 있으면 그 키가 로컬 서버로 전송된다. 우리 env
조립에서 반드시 **빈 문자열로 덮어써야 한다**(§5 보안).

**(b) 하네스 두 축 다 공식 지원.** `ollama launch claude` 는 모델 선택 →
Claude Code 설정 → 실행까지 한다(`--config` 는 설정만, `--yes --model X -- -p "..."`
로 헤드리스). Codex 쪽은 `codex --oss -m <model>` 또는 `~/.codex/ollama-launch.config.toml`
프로파일(`base_url = "http://localhost:11434/v1/"`, `wire_api = "responses"`).
→ **`harness × provider` 곱집합이 실제로 성립한다**는 증거다(§3.3).

**(c) 감지에 쓸 API 가 정확히 우리가 필요한 것을 준다.**

| 엔드포인트         | 돌려주는 것                                                                         | 우리가 쓰는 곳                  |
| ------------------ | ----------------------------------------------------------------------------------- | ------------------------------- |
| `GET /api/tags`    | 설치된 모델 목록 + `size` + `details.parameter_size` + `details.quantization_level` | G2 모델 pull 여부, 후보 열거    |
| `GET /api/ps`      | 로드된 모델 + **`size_vram`** + **`context_length`** + `expires_at`                 | G3 컨텍스트/메모리 게이트       |
| `GET /api/version` | 서버 버전                                                                           | G1 reachability + 최소버전 가드 |

**(d) ★컨텍스트 — 이 설계의 최대 제약.** `docs.ollama.com/context-length.md` 원문:

> Ollama defaults to the following context lengths based on VRAM:
> **< 24 GiB VRAM: 4k context / 24-48 GiB: 32k / >= 48 GiB: 256k**
> Tasks which require large context like web search, agents, and **coding tools
> should be set to at least 64000 tokens.**

Codex 통합 문서도 같은 말을 한다 — _"Codex requires a larger context window. It is
recommended to use a context window of at least 64k tokens."_
설정은 앱 슬라이더 또는 `OLLAMA_CONTEXT_LENGTH=64000 ollama serve`.

**이 Mac 실측**: MacBook Pro / Apple M3 Pro / **36GB 통합메모리** →
Ollama 표의 24–48GiB 구간 = 기본 **32k**. 권고치 64k 에 미달이므로
**서버 기동 옵션을 바꿔야 우리 에이전트가 성립한다.** 그리고 권장 코딩 모델
`qwen3-coder` 에 대해 Ollama 문서가 _"30B parameter model requiring at least
24GB of VRAM to run smoothly. More is required for longer context lengths"_ 라고
적는다 → **36GB 기기에서 30B + 64k 는 빠듯하다.** "가능은 하나 여유 없음" 이
이 Mac 의 정직한 상태다.

**(e) ⚠️`:cloud` 함정 — 로컬처럼 생겼는데 로컬이 아니다.** `glm-4.7:cloud`,
`minimax-m2.1:cloud`, `gpt-oss:120b-cloud` 는 **Ollama 클라우드로 오프로드**된다.
`ollama.com/pricing` 실측: Free $0(클라우드 모델 접근 포함) / **Pro $20/월**(더 큰
클라우드 모델, **동시 3개**, Free 대비 50배 사용량) / Max $100/월(동시 10개, 신규
가입 중단). → **`:cloud` 태그가 붙은 모델은 marginal cost 0 이 아니고 쿼터·동시성
제약이 있다.** 서베이 §3.1 의 "정액 + 시간창" 스킴 그대로다.
**설계 규칙: `:cloud` 접미사는 `provider: "local"` 이 아니다.** 별도
`provider: "ollama-cloud"` 로 취급하거나, 최소한 `billing.kind` 를 다르게 준다.
이걸 안 나누면 우리 비용 학습이 "공짜인데 왜 느리지" 로 오염된다.

**(f) 버전 앵커**: 최신 릴리스 `v0.32.4`, published **2026-07-25T02:22:12Z**
(GitHub Releases API). 레지스트리 행의 `verified.cli` 에 이 값을 적는다.

### 2.3 LM Studio — 2순위. "엔드포인트만 다른 같은 프로파일"

- Anthropic 호환 전용 문서 존재. 배선 원문:
  ```
  export ANTHROPIC_BASE_URL=http://localhost:1234
  export ANTHROPIC_AUTH_TOKEN=lmstudio
  claude --model openai/gpt-oss-20b
  ```
  → **우리 envProfile 스키마에서 값 3개만 다르다.** 런타임 추가 비용이 사실상 0.
- OpenAI 호환에 `/v1/responses` 가 있어서 **Codex 도 공식 지원**(문서가 명시).
- `Require Authentication` 옵션이 있고, 켜면 `x-api-key` 와 `Authorization: Bearer`
  둘 다 받는다 → **우리 envProfile 에 토큰 자리가 이미 있으므로 그대로 커버**된다.
- REST API v0 가 loaded/unloaded·max context·quantization·TTFT 를 준다 → 감지 가능.
  단 **엔드포인트 모양이 Ollama 와 다르다** → 감지 어댑터가 런타임별로 필요하다(§6).
- GUI 앱 전제지만 서비스(헤드리스) 모드가 있다.

**판정: 2순위.** Ollama 와 동급의 호환성인데, 우리가 먼저 만들 감지 어댑터가
Ollama 쪽이고 `ollama launch claude` 같은 1급 통합이 Ollama 에만 있다.
L6 에서 프로파일 1행 + 어댑터 1개로 붙인다.

### 2.4 llama.cpp — 3순위. 고급 사용자 경로

- README 기능 목록 원문: _"[OpenAI API] compatible chat completions, responses, and
  embeddings routes"_, _"[Anthropic Messages API] compatible chat completions"_.
  전용 섹션도 있다: `POST /v1/messages`, 스트리밍 SSE, `system`/`temperature`/`top_p`,
  `max_tokens` 기본 4096. ⚠️ _"Tool use requires `--jinja` flag"_.
- 인증은 `--api-key KEY`(env `LLAMA_API_KEY`) / `--api-key-file`. 기본은 없음.
- **모델 관리가 없다.** GGUF 선택·양자화·`-c` 컨텍스트·`--jinja`·채팅 템플릿을
  사용자가 직접 맞춘다. 우리 UI 가 "모델 pull 하시겠습니까" 를 물을 수 없다.

**판정: 3순위 — 편입은 하되 "고급/BYO endpoint" 로.** 실제로는 §5 의
**커스텀 base URL 경로**(사용자가 직접 입력)로 흡수하는 게 맞고, 전용 프로파일을
만들 이유가 약하다. 감지는 `/v1/models` 정도로 축소한다.

### 2.5 결론

**Ollama 1순위 · LM Studio 2순위(프로파일 1행) · llama.cpp 는 커스텀 endpoint 로 흡수.**

---

## 3. ★핵심 — `provider=local` 은 (B)형과 같은 축을 탄다

### 3.1 GLM env-swap 과 1:1 대응

서베이 §2.4 가 확보한 Z.ai 배선과 이번에 확보한 Ollama 배선을 나란히 놓으면
**모양이 같다**:

|                        | Z.ai GLM (서베이 §2.4)           | **Ollama (이번 조사)**                  | LM Studio                 |
| ---------------------- | -------------------------------- | --------------------------------------- | ------------------------- |
| harness                | `claude`                         | `claude`                                | `claude`                  |
| `ANTHROPIC_BASE_URL`   | `https://api.z.ai/api/anthropic` | `http://localhost:11434`                | `http://localhost:1234`   |
| `ANTHROPIC_AUTH_TOKEN` | GLM 플랜 키                      | `ollama`(무시됨)                        | `lmstudio`(무시됨)        |
| `ANTHROPIC_API_KEY`    | (문서 언급 없음)                 | **`""` 로 비움(문서 명시)**             | (문서 언급 없음)          |
| 모델 지정              | `ANTHROPIC_DEFAULT_*_MODEL`      | `claude --model <ollama id>`            | `claude --model <lms id>` |
| billing                | 구독(5h/주간 캡)                 | **로컬 = marginal 0** / `:cloud` = 구독 | 로컬 = marginal 0         |

→ **`envProfile` 이라는 같은 자리에, 값만 다르게 들어간다.**

### 3.2 축분리 티켓(`USbdRV4koQyqjRFKJAPf`)과의 관계 — 새 축을 만들지 않는다

축분리 티켓이 하려는 일은 정확히 이것이다(티켓 본문):

> `model-registry` 레코드에 `harness`(실행 CLI) 와 `provider`(벤더) 를 분리 표현.
> 스폰 경로가 harness 로 바이너리를 고르고, provider 로 env 를 주입하도록 분기.

**로컬은 그 위에 데이터 한 행으로 올라탄다.** 이 문서는 축을 하나도 더 만들지
않는다. 요구하는 것은 **축분리 스키마가 `provider: "local"` 을 표현할 수 있어야
한다**는 것뿐이고, 현재 `ModelProvider` 유니온에 `"local"` 이 **이미 있다**
(`electron/model-registry.ts:45`).

**의존 관계**:

```
USbdRV4koQyqjRFKJAPf (축분리)          ─┐
서베이 V1-1 (envProfile 주입 배선)     ─┴→ L2~L4 (이 문서)
```

**L1(런타임 감지)만 선행 없이 착수 가능하다** — 순수 신규 모듈이라 축분리와
파일이 겹치지 않는다.

### 3.3 곱집합이 실제로 성립한다

Ollama 가 Claude Code 와 Codex 를 **둘 다** 공식 지원하므로:

| harness      | provider    | 배선                                                | 상태            |
| ------------ | ----------- | --------------------------------------------------- | --------------- |
| `claude`     | `anthropic` | 현행                                                | 기존            |
| `claude`     | `zai`       | `ANTHROPIC_BASE_URL` 교체                           | 서베이 V1-2     |
| **`claude`** | **`local`** | `ANTHROPIC_BASE_URL=http://localhost:11434`         | **본안 L3**     |
| `codex`      | `openai`    | 현행                                                | 기존            |
| **`codex`**  | **`local`** | `codex --oss -m <id>` 또는 `ollama-launch` 프로파일 | 본안 L6(후순위) |

→ 축이 합쳐져 있으면 이 표의 3·5번 행을 표현할 수 없다. **축분리가 로컬의
선결조건인 이유가 이 표다.**

### 3.4 그래서 로컬 고유의 넷-뉴는 3개뿐

| 항목          | (B)형 클라우드 벤더    | **로컬**                                        |
| ------------- | ---------------------- | ----------------------------------------------- |
| 카탈로그/설치 | 벤더 CLI 불필요        | 런타임 설치 안내만(설치는 사용자)               |
| 인증 프로브   | 키 파일/env 존재검사   | **★넷-뉴: reachability + 모델 존재 + 컨텍스트** |
| 스폰 경로     | `case "claude"` 재사용 | 동일(재사용)                                    |
| MCP 생성기    | 재사용                 | 동일(재사용)                                    |
| cost 파싱     | 재사용                 | **★넷-뉴: marginal 0 스킴 + 유령비용 수리**     |
| 라우팅 후보   | 사다리에 편입          | **★넷-뉴: 콜드 제외 + 조건부 편입**             |

---

## 4. 현행 `local` 플레이스홀더 실측 — 활용 가능한가

**결론: 유니온 값은 그대로 쓴다. 단 의미를 "하네스" 에서 "프로바이더" 로 재해석한다.**

### 4.1 지금 어디에 있나 (실측)

| 위치                                         | 현 상태                                                                                                   |
| -------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| `src/types/agent.ts:6`                       | `ModelType` 유니온에 `"local"`                                                                            |
| `electron/agent-manager.ts:27`               | 같은 유니온(중복 정의)                                                                                    |
| `electron/dispatch-scoring.ts:20`            | 같은 유니온(중복 정의)                                                                                    |
| `electron/dispatch-scoring.ts:470`           | `MODEL_ALIASES` 에 `local: "local"` — 문자열 폴딩만                                                       |
| `electron/model-registry.ts:45`              | `ModelProvider` 유니온에 `"local"`, **행은 0개**(파일 주석이 "CLI-verified 모델 사실이 아직 없다"고 명시) |
| `electron/agent-config.ts:549`               | 오케 모델 허용목록에 `"local"` 포함(실험용)                                                               |
| `electron/agent-config.ts:599`               | `ModelProvider ≡ ModelType` **컴파일타임 양방향 단언**                                                    |
| `electron/bridge-server.ts:164`              | 스폰 요청 model 유니온                                                                                    |
| `electron/mcp-server/tools.ts:2981`          | `spawn_agent` zod enum                                                                                    |
| `src/components/agents/AgentAddModal.tsx:53` | "Local Model" 옵션, **`command: "ollama"`**, `hint: true`                                                 |

### 4.2 진단 — 유니온엔 있는데 배선이 없다 (dead-end 4곳)

1. **런치 컨피그에 `case "local"` 이 없다.** `buildLaunchConfig` 의 `switch(model)`
   (`agent-config.ts:2494~`)는 claude/gemini/gpt/antigravity/custom 만 갖고,
   로컬은 `default: { command: baseCommand, args: [], env }` 로 떨어진다
   (`agent-config.ts:2730`). UI 가 `command: "ollama"` 를 넣으므로
   **`ollama` 를 인자 없이 실행**하게 된다. 그건 에이전트가 아니라 도움말이다.
2. **MCP 설정 생성기도 default 로 떨어진다.** `generateMCPConfig` 의 switch
   (`agent-config.ts:1555~`)에 `local` 이 없어 `default: generateClaudeConfig` 다.
   결과적으로 **claude 포맷 설정이 생성**되는데, 로컬을 claude 하네스로 태울
   거라면 이건 우연히 맞다 — **의도로 만들어야지 우연으로 두면 안 된다.**
3. **★유령 비용.** `cost-tracker.ts` 의 `MODEL_PRICING` 에 로컬 모델 행이 없고,
   `perTokenRateFor`(`cost-tracker.ts:211~`)는 최장 프리픽스 매칭에 실패하면
   `default: { inputPer1M: 3, outputPer1M: 15 }` 를 돌려준다. 즉 `qwen3-coder` 로
   공짜 실행한 세션이 **Sonnet 단가로 청구**된다. 비용 대시보드·budgetBias·
   라우팅의 비용대비효과 학습이 전부 오염된다. **로컬 편입의 필수 선행 수리다.**
4. **인증 게이트가 없다.** `probeCliAuth`/`checkSpawnAuthGate` 는 로컬을 모른다
   (크레덴셜 파일이 없으니 당연하다). 지금은 "인증 없음" 이 아니라 "판정 부재" 다.

**반대로 잘 돼 있는 것 1개**: `MODEL_PRESETS`(`dispatch-scoring.ts:416~`) **어디에도
`local` 이 없다.** 콜드 라우팅이 로컬을 자동 선택할 경로가 지금은 없다는 뜻이고,
§7.2 가 원하는 상태가 이미 기본값이다. **이 성질을 지켜야 한다.**

### 4.3 활용 방안 — 삭제하지 말고 의미를 옮긴다

- `ModelType` 의 `"local"` 은 **legacy alias 로 유지**한다. Firestore 에이전트 문서·
  텔레메트리·그래프 셀키에 이미 문자열이 쌓일 수 있고, 서베이 §4.5 의 결론
  ("삭제가 아니라 양방향 매핑")과 같다.
- 축분리 후 **정본 의미는 `provider: "local"`** 이다. `harness` 는 `claude`(기본)
  또는 `codex`.
- `agent-config.ts:599` 의 `ModelProvider ≡ ModelType` 단언은 축분리 티켓이
  손대는 자리다. **로컬은 그 단언을 깨는 첫 사례가 아니다**(GLM 이 먼저다) —
  로컬은 그 델타의 수혜자일 뿐이다.
- `AgentAddModal` 의 "Local Model" 은 **모델 선택이 아니라 프로파일 선택**으로
  재해석한다: 런타임(Ollama/LM Studio/커스텀) + 모델 목록(감지 결과) + 하네스.
  `command: "ollama"` 리터럴은 **제거**한다 — 스폰하는 바이너리는 `claude` 다.
- `spawn_agent` zod enum 의 `"local"` 은 유지하되, 구체 지정은
  `model: "local:qwen3-coder"` 같은 compound 로 받는다. 이미
  `model-selection.ts` 가 `provider[:modelId][@effort]` compound 를 파싱한다
  (`orchestratorModelValue`/`splitOrchestratorModelValue`) → **재사용**.

---

## 5. 무인증 localhost 엔드포인트 처리

### 5.1 "인증" 의 자리를 "도달성" 이 대신한다

`docs.ollama.com/api/authentication` 원문: _"**No authentication is required** when
accessing Ollama's API locally via `http://localhost:11434`."_ (인증이 필요한 것은
클라우드 모델 실행·모델 게시·비공개 모델 다운로드뿐이고, 그건 `ollama signin` 또는
`OLLAMA_API_KEY` 다.)

우리 `probeCliAuth` 의 규율 — **"CLI 를 절대 스폰하지 않고 파일/env 존재만 본다"** —
은 로컬에서도 옳다. 다만 **볼 대상이 파일이 아니라 소켓**이다.

```
클라우드:  크레덴셜 파일 있나?          → 스폰 게이트
로컬:      서버 살아있나 + 모델 있나 +   → 스폰 게이트 (동일한 자리, 다른 질문)
           컨텍스트 충분한가
```

`checkSpawnAuthGate` 에 로컬 분기를 추가하되 **"인증 성공" 으로 위장하지 않는다.**
게이트 결과 타입에 `reason: "runtime-unreachable" | "model-missing" |
"context-too-small"` 을 남겨 UI 가 정확한 안내를 띄우게 한다.

### 5.2 보안 규칙 6개 (이건 타협하지 않는다)

1. **`ANTHROPIC_API_KEY` 를 반드시 빈 문자열로 덮어쓴다.** 사용자 셸/앱 env 에
   진짜 Anthropic 키가 있으면 그 키가 로컬(또는 사용자가 입력한 임의) 서버로
   전송된다. Ollama 공식 문서도 이걸 명시적으로 지운다. **envProfile 의
   "지울 키 목록" 을 스키마에 넣어야 한다**(`unset: string[]` 또는 빈값 강제).
2. **기본 허용은 loopback 뿐.** `127.0.0.1` / `localhost` / `::1` 만 무인증 허용.
   그 외 호스트는 **사용자 명시 동의 없이는 거부**. 회사 네트워크의 임의 IP 로
   토큰을 던지는 경로를 기본값으로 열지 않는다.
3. **`http://` 는 loopback 에서만.** 원격은 `https://` 강제.
4. **커스텀 base URL 은 1회성 동의 + 저장 시 출처 표기.** 서베이 §4.4 의
   `TRUSTED_SHELL_INSTALLER_HOSTS` 규율("작게 유지하고 큐레이트")과 같은 정신.
5. **토큰·URL 을 원문 로깅 금지.** `maskConfigForLogging`/`maskEnvForLogging` 적용.
   `ANTHROPIC_AUTH_TOKEN=ollama` 는 더미지만, LM Studio `Require Authentication`
   이나 llama.cpp `--api-key` 는 진짜 값일 수 있다. **더미인지 아닌지로 분기하지
   말고 무조건 마스킹**한다.
6. **자동 `ollama pull` 금지.** 모델 하나가 수 GB~수십 GB 다. 다운로드는 항상
   사용자 명시 동의 후. (`ollama launch claude --yes` 가 필요시 pull 을 하는데,
   **우리는 `--yes` 를 쓰지 않는다** — 우리 UI 가 동의를 받는다.)

### 5.3 우리는 `ollama launch` 를 쓰지 않는다 (설계 결정)

`ollama launch claude` 는 편리하지만 **모델 선택 대화상자를 띄우고 Claude Code 설정
파일을 자기 방식으로 고친다.** 우리는 PTY 를 관리하고 세션 id 를 핀하고 MCP 설정을
생성하는 쪽이라, 중간에 대화형 선택기가 끼면 readiness 루프가 깨진다
(codex 자동업데이트 대화상자가 PTY 를 죽였던 선례 — 서베이 §4.2).

**→ 우리는 manual setup 경로(env + `claude --model <id>`)만 쓴다.**
`ollama launch` 는 **사용자가 손으로 검증할 때 쓰라고 문서에 안내**만 한다.

---

## 6. 하드웨어 / 가용성 감지 — 3단 게이트

신규 모듈 `electron/local-runtime.ts` (순수 HTTP, Electron 의존 없음 → 유닛테스트 쉬움).

### 6.1 게이트

| 게이트               | 무엇을 묻나           | 어떻게                                                                                                      | 실패 시                                                            |
| -------------------- | --------------------- | ----------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| **G1 도달성**        | 런타임 서버가 떠 있나 | `GET /api/version` (타임아웃 **2초**, 재시도 없음)                                                          | `unreachable` — 후보에서 제외, UI 배지 "런타임 미실행"             |
| **G2 모델 존재**     | 이 모델이 pull 됐나   | `GET /api/tags` 의 `models[].name` 정확매칭(+ `:latest` 정규화)                                             | `model-missing` — **pull 제안**(자동 pull 금지), 후보 제외         |
| **G3 용량/컨텍스트** | 이 기기에서 쓸 만한가 | `GET /api/ps` 의 `context_length`·`size_vram`, `/api/tags` 의 `details.parameter_size`·`quantization_level` | `context-too-small` — 후보 제외 + **`OLLAMA_CONTEXT_LENGTH` 안내** |

**G3 임계값(초안, 데이터로 조정)**: `context_length >= 64000` 을 **권고선**,
`>= 32000` 을 **하한선**으로 잡는다. 근거는 추정이 아니라 Ollama 공식 문서의
"코딩 툴은 최소 64k" 권고 + Codex 통합 문서의 동일 권고다. 32k 미만(=VRAM 24GiB
미만 기본값 4k 포함)은 **우리 에이전트 프롬프트가 들어가지 않는다고 본다.**
★정확한 하한은 L7 라이브에서 우리 헌법+스킬+MCP 툴 정의 토큰수를 실측해 확정한다.

**★`/api/ps` 는 "로드된 모델" 만 준다** — 한 번도 안 띄운 모델은 안 나온다.
그래서 G3 는 두 경로다: (a) 이미 로드돼 있으면 `/api/ps` 실측값, (b) 아니면
`/api/tags` 의 파라미터 크기 + 서버 기본 컨텍스트 정책으로 **보수적 추정**하고
**추정임을 표시**한다(레지스트리 `pricing.estimated` 와 같은 정신).

### 6.2 graceful skip 의 정의

**"조용한 폴백" 이 아니다.** 마블로의 반복 실패모드가 정확히 그거였다
(needsAuth 오판, dependsOn edge-trigger, submit 누락). 규율:

- 감지 실패는 **구조화 로그 1줄 + UI 배지 + 라우팅 후보 제외**. 예외 throw 금지.
- **에이전트를 스폰한 뒤 실패하게 두지 않는다** — 스폰 직전 G1~G3 재확인 1회.
- 감지 결과는 **TTL 60초 캐시**. 매 스코어링마다 HTTP 를 때리면 dispatch 가 느려진다.
- 사용자가 런타임을 켰다 껐다 하는 것은 **정상 상태**다. 로컬이 사라지는 것은
  에러가 아니라 가용성 변화다. 그래프 outcome 에 **부정 신호로 기록하지 않는다**
  (모델 성능과 무관하므로 — 이걸 섞으면 그래프가 오염된다).

### 6.3 런타임 어댑터 인터페이스

```ts
// electron/local-runtime.ts  (신규, 순수 HTTP)
export type LocalRuntimeId = "ollama" | "lmstudio" | "custom";

export interface LocalModelInfo {
  id: string; // "qwen3-coder", "openai/gpt-oss-20b"
  parameterSize?: string; // "30.5B"
  quantization?: string; // "Q4_K_M"
  sizeBytes?: number;
  loaded: boolean;
  contextLength?: number; // /api/ps 실측치
  contextEstimated?: boolean; // 로드 전 추정치면 true
}

export interface LocalRuntimeStatus {
  runtime: LocalRuntimeId;
  baseUrl: string; // "http://localhost:11434"
  reachable: boolean;
  version?: string;
  models: LocalModelInfo[];
  checkedAt: number;
  error?: "unreachable" | "timeout" | "unexpected-response";
}
```

Ollama/LM Studio 어댑터는 **각각 3개 함수**(version/list/ps)만 구현한다.
llama.cpp/커스텀은 `/v1/models` 만 보는 축소 어댑터.

---

## 7. 라우팅 티어 설계

### 7.1 로컬은 사다리의 어디인가

`model-ladder.ts` 의 규칙은 **"상향 축은 능력등급, 같은 등급 안에서는 실단가"** 다.
로컬은 이 규칙에 그대로 못 얹힌다 — **단가가 0 이라 같은 등급 안에서 무조건
이겨버리기 때문**이다(§7.4 쏠림 함정).

**결정: 로컬은 사다리의 칸이 아니라 별도 레인이다.**

- 레지스트리 행의 `capability` 는 정직하게 `"cheap"`(★근거 확보 전까지 보수적).
- 하지만 **`usableRungs()` 가 돌려주는 기본 사다리에 넣지 않는다.**
  로컬은 `eligibility: "opt-in"` 같은 플래그로 표시하고, 후보집합 구성 단계에서
  **정책이 명시적으로 켰을 때만** 합류한다.
- 승격은 데이터로만 한다 — L7 이후 그래프에 로컬 셀이 쌓이고 `simple` 티어에서
  클라우드 대비 열위가 아니라는 게 보이면 그때 사다리에 넣는다.
  **이 문서는 임계값을 정하지 않는다**(#595 §9 / 서베이 §5.3 과 같은 규율).

### 7.2 콜드 라우팅에서 제외 — 어디를 고치나

**현행이 이미 제외 상태다**(§4.2): `MODEL_PRESETS` 어디에도 `local` 이 없다.
따라서 "제외" 는 새 코드가 아니라 **회귀 가드**다.

| 자리                | 조치                                                                                                                   |
| ------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| `MODEL_PRESETS`     | **로컬을 넣지 않는다.** 유닛테스트로 고정("어떤 프리셋도 local 을 포함하지 않는다")                                    |
| 그래프 `prior` 시드 | **주입하지 않는다.** #596 규율상 prior 는 콜드스타트 편향인데, 후보에 없는 모델에 prior 를 주는 건 무의미하고 위험하다 |
| `graphBias`         | 로컬 셀이 생기더라도 ±20 tie-breaker 층이라 후보집합 밖으로는 못 끌어온다(설계상 안전)                                 |
| 신규: 후보집합 정책 | 로컬이 들어오는 경로를 **3개로 한정**(아래)                                                                            |

**로컬이 후보가 되는 경로는 이 3개뿐이다:**

1. **명시 지정** — 오케/사용자가 `model: "local:qwen3-coder"` 로 스폰.
2. **오프라인 모드** — 네트워크 미가용 또는 사용자가 켠 오프라인 플래그.
   (이때는 클라우드가 후보에서 빠지므로 로컬이 유일 후보가 된다.)
3. **프라이버시 레인** — 티켓/프로젝트에 `privacy: local-only` 태그.
   외부로 코드를 보내면 안 되는 작업. **이게 로컬의 진짜 제품 가치다.**

+선택적 4번(플래그, 기본 OFF): **대량 저가치 배치** — 로그 요약, 파일명 일괄
정규화 같은 기계적 반복. 비용이 아니라 **쿼터 보존**이 목적이다.

### 7.3 적격 / 부적격 작업 클래스

| 적격 ✅                               | 부적격 ❌                                        |
| ------------------------------------- | ------------------------------------------------ |
| simple 난도 · 단일 파일 · 기계적 변환 | 다중 파일 리팩터, 아키텍처 결정                  |
| 오프라인 상황                         | 시간 압박 있는 작업(로컬은 느리다)               |
| 프라이버시 요구                       | 긴 컨텍스트(대형 리포 읽기) — §2.2 컨텍스트 제약 |
| 대량 저가치 반복                      | 툴콜/MCP 를 많이 쓰는 오케 역할 ★신뢰도 미확인   |
| 요약·번역·포맷팅                      | 사용자 대면 산출물의 최종본                      |

★**오케스트레이터를 로컬로 돌리는 것은 이번 범위 밖.** `agent-config.ts:549` 가
이미 `MARBLO_ORCHESTRATOR_MODEL=local` 을 받지만, 오케는 MCP 툴콜 밀도가 가장
높은 자리다. 워커에서 툴콜 신뢰도가 실측된 뒤에 판단한다.

### 7.4 비용 = 0(marginal) 을 어떻게 표현하나

**(a) 스키마.** 서베이 §5.2 가 제안한 `billing` 이분법에 **세 번째 스킴**을 더한다:

```ts
billing:
  | { kind: "token"; inputPer1M: number; outputPer1M: number; ... }
  | { kind: "subscription"; planId: string; quotaMultiplier?: QuotaRule[] }
  | { kind: "local"; marginalUsd: 0; note: "전력·GPU 점유는 과금하지 않는다" }
```

**(b) cost-tracker 수리(필수).** `perTokenRateFor` 가 로컬 모델 id 에 대해
`default $3/$15` 를 돌려주는 현행 동작을 막는다(§4.2-③). 프리픽스 테이블에
0 행을 넣는 것으로는 부족하다 — **`billing.kind === "local"` 이면 요율 조회 자체를
건너뛰고 `cost = 0` 을 확정**해야 한다. 그래야 미등록 로컬 모델 id 도 안전하다.
★토큰 수량은 계속 기록한다(0 원이어도 "얼마나 썼나" 는 라우팅 학습 재료다).

**(c) ★0 은 무해하지 않다 — 쏠림 함정.** 비용축에 0 을 넣으면 비용대비효과
계산에서 로컬이 **어떤 클라우드 모델도 이길 수 없는 점수**를 얻는다(분모가 0).
그래서:

- **비용 0 을 budgetBias 에 그대로 흘리지 않는다.** 로컬은 후보집합 밖이라
  (§7.2) 애초에 비교 테이블에 안 들어온다 — **구조로 막는 게 가중치로 막는 것보다
  안전하다.**
- 로컬이 후보에 들어온 경우(명시/오프라인/프라이버시)엔 **이미 다른 이유로
  선택된 것**이므로 비용 비교가 무의미하다.
- 대시보드에는 **"$0 (local)" 로 표시**하고 클라우드 지출과 같은 축에 합산하지
  않는다. 합산하면 "이번 달 비용이 줄었다" 가 아니라 "측정이 깨졌다" 가 된다.

**(d) `:cloud` 는 로컬이 아니다.** §2.2-(e). 모델 id 가 `:cloud` 로 끝나면
`billing.kind = "subscription"`. 이 판정을 **레지스트리 등록 시점에 강제**한다
(유닛테스트: `id.endsWith(":cloud") → kind !== "local"`).

### 7.5 실패 시 클라우드 폴백

**"실패" 를 먼저 정의한다** (모호하면 폴백이 오작동한다):

| 실패 유형                 | 감지                 | 폴백?                                    |
| ------------------------- | -------------------- | ---------------------------------------- |
| 런타임 미도달(G1)         | 스폰 전 게이트       | **스폰 안 함** — 폴백이 아니라 후보 제외 |
| 모델 미존재(G2)           | 스폰 전 게이트       | 동일                                     |
| 컨텍스트 부족(G3)         | 스폰 전 게이트       | 동일                                     |
| 스폰 후 서버 다운         | PTY 에러 / HTTP 실패 | ✅ 폴백                                  |
| 컨텍스트 초과 런타임 에러 | CLI 에러 출력        | ✅ 폴백(+ G3 임계 상향 신호)             |
| N 분 무진전(툴콜 루프)    | 기존 워치독          | ✅ 폴백 **1회만**                        |
| 결과 품질 미달            | ❌ 자동 판정 불가    | 폴백 안 함 — 사람/오케 판단              |

**규율 4개**:

1. **폴백은 티켓당 1회.** 왕복 무한루프 금지(dependsOn edge-trigger 선례).
2. **폴백 사유를 티켓 activity 에 남긴다.** 조용한 승격은 우리 최대 실패모드다.
3. **그래프 오염 금지.** 로컬 셀에는 "인프라 실패" 를 성능 부정신호로 쓰지 않는다
   (§6.2). 폴백 후 클라우드가 낸 성과는 **클라우드 셀에** 기록한다.
4. **폴백 대상은 그 티켓의 원래 사다리 칸**이지 최상위 모델이 아니다.
   비용 상한을 폴백이 우회하면 안 된다.

★**프라이버시 레인(§7.2-3)은 폴백하지 않는다.** "외부로 보내면 안 되는 코드" 가
실패했다고 클라우드로 보내면 그건 폴백이 아니라 사고다. **BLOCKED 로 세운다.**

### 7.6 그래프 셀키

서베이 §5.2 가 제안한 `harness/provider/model` 키가 로컬에도 그대로 필요하다:

```
role:backend|claude/local/qwen3-coder
role:backend|claude/anthropic/claude-sonnet-5
```

`routing-graph.ts:282` 의 `ModelKeyQuery`(구체→일반 tiered 조회)가 이미 있으므로
**신규 배선이 아니라 키 문자열 확장**이다. 구키 폴백 2단 조회 규율 유지.

★로컬은 **양자화까지 성능 변수**지만 키에 넣지 않는다 — 카디널리티가 폭발해서
셀당 관측이 모이지 않는다. 대신 레지스트리 행에 `quantization` 을 **사실로**
기록하고, 사용자가 다른 양자화로 바꾸면 그건 다른 행(다른 id)로 등록한다.

---

## 8. 페이즈별 구현 티켓 후보 + 작업량·리스크

`L*` 번호는 서베이의 `V*` 와 별개다. 의존은 명시했다.

### Phase L0 — 선결 (이 문서 밖, 이미 진행중)

| #    | 제목                                                             | 상태                                        |
| ---- | ---------------------------------------------------------------- | ------------------------------------------- |
| L0-1 | provider≠harness 축분리                                          | 티켓 `USbdRV4koQyqjRFKJAPf` **IN_PROGRESS** |
| L0-2 | `envProfile` 주입 배선(`buildLaunchConfig` 가 프로파일 env 머지) | 서베이 V1-1                                 |

### Phase L1~L7 — 로컬 편입

| #      | 제목                                                                                                                                                     | role     | 의존                  | 작업량     | 우선              |
| ------ | -------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- | --------------------- | ---------- | ----------------- |
| **L1** | **런타임 감지 서비스** `electron/local-runtime.ts` — G1/G2/G3, Ollama 어댑터, TTL 캐시, 순수 HTTP + 유닛테스트(fetch 목킹)                               | backend  | **없음(선행 불필요)** | **0.5~1d** | P1                |
| **L2** | **비용 스킴 `local` + ★유령비용 수리** — `billing.kind:"local"`, `perTokenRateFor` 우회, `:cloud`≠local 가드, 대시보드 "$0 (local)" 표기                 | backend  | L0-1                  | **0.5d**   | **P0**(현행 버그) |
| **L3** | **스폰 배선** — 레지스트리에 `{provider:"local", harness:"claude", envProfile}` 행, `ANTHROPIC_API_KEY` 비우기, 스폰 게이트를 reachability 게이트로 대체 | backend  | L0-1, L0-2, L1        | **0.5~1d** | P1                |
| **L4** | **라우팅 편입** — 후보집합 정책(명시/오프라인/프라이버시), 프리셋 제외 회귀테스트, 폴백 1회 규율, 셀키 provider 축                                       | backend  | L3                    | **1~2d**   | P2                |
| **L5** | **UI** — AgentAddModal 재해석(런타임·모델·하네스 선택), 감지 배지, pull 안내(자동 pull 금지), 컨텍스트 경고                                              | frontend | L1, L3                | **1d**     | P2                |
| **L6** | **LM Studio 프로파일 + 어댑터** — 값 3개 + 감지 어댑터 1개. `codex --oss` 경로도 여기서                                                                  | backend  | L3                    | **0.5d**   | P3                |
| **L7** | **라이브 검증 런북** — 실제 티켓 1건을 로컬로 완주, 컨텍스트 실측(우리 프롬프트 토큰수), 툴콜/MCP 신뢰도, 결과를 레지스트리 `verified` 에 기록           | backend  | L3                    | **0.5d**   | P1                |

**합계 ≈ 4.5~6.5 man-day**(L0 선결 제외, L5 는 frontend).

**권장 착수 순서**: **L2(유령비용은 지금도 버그) → L1 → L3 → L7(라이브 1건) → L4 → L5 → L6.**
L7 까지가 "로컬이 실제로 되는가" 를 **$0** 로 증명하는 구간이다.
(클라우드 벤더 편입은 구독 결제가 필요했지만 **로컬은 검증 비용이 0 이다** —
이게 로컬 편입의 숨은 장점이다.)

### 리스크 표

| 리스크                                                  | 확률                          | 영향          | 완화                                                                                         |
| ------------------------------------------------------- | ----------------------------- | ------------- | -------------------------------------------------------------------------------------------- |
| **컨텍스트 부족으로 에이전트가 성립 안 함**             | **높음**                      | 높음          | G3 게이트(§6.1) + `OLLAMA_CONTEXT_LENGTH` 안내. L7 에서 우리 프롬프트 토큰 실측 후 하한 확정 |
| **툴콜/MCP 신뢰도 미달**(작은 모델이 tool_use 를 못 냄) | **높음**                      | 높음          | L7 라이브 우선. 실패 시 로컬을 "툴 없는 요약/변환 레인" 으로 축소 — 편입 자체는 유지         |
| 유령 비용(현행 버그)                                    | **확실**(이미 발생 조건 성립) | 중            | **L2 가 P0**                                                                                 |
| `:cloud` 를 로컬로 오인                                 | 중                            | 중            | 등록 시점 가드 + 유닛테스트                                                                  |
| 자동 pull 로 수십 GB 다운로드                           | 중                            | 중            | 자동 pull 금지 규칙(§5.2-6)                                                                  |
| 로컬 쏠림(비용 0 이 라우팅을 지배)                      | 중                            | 높음          | 구조적 제외(§7.2) — 가중치가 아니라 후보집합으로 막는다                                      |
| 이 Mac(36GB)에서 30B+64k 메모리 압박                    | 중                            | 중            | G3 가 사전 차단. 소형 모델부터 검증                                                          |
| 프라이버시 레인이 폴백으로 클라우드에 유출              | 낮음                          | **매우 높음** | §7.5 — 프라이버시 레인은 폴백 금지, BLOCKED                                                  |
| 로컬 세션의 cost/usage 파싱이 다르게 나옴               | 중                            | 낮음          | L7 에서 `~/.claude/projects/*.jsonl` 실물 확인                                               |

---

## 9. 사장님/오케 판단이 필요한 것

1. **로컬의 목적이 "비용 절감" 인가 "프라이버시/오프라인" 인가.**
   이 설계는 **후자**를 1급으로 뒀다. 우리 실사용 비용 구조상 로컬로 아낄 수 있는
   건 simple 티어 일부인데, 그 칸은 이미 `gpt-5.6-luna`($1/$6)·`haiku`($1/$5) 가
   싸다. **로컬의 차별점은 "외부로 안 나간다" 다.** 이 우선순위가 맞는지.
2. **L4(라우팅 편입)까지 갈지, L3+L7(수동 지정만)에서 멈출지.**
   "명시 지정으로 로컬 에이전트를 띄울 수 있다" 까지만 해도 프라이버시 요구는
   충족된다. 자동 라우팅은 그 다음 판단이어도 된다.
3. **Ollama Pro($20/월) 를 볼지.** `:cloud` 모델은 로컬이 아니지만, "설치 없이 큰
   모델" 이라는 별개 가치가 있다(동시 3개 제한). 이건 **로컬 에픽이 아니라 벤더
   에픽**이므로 서베이 §7 우선순위와 함께 판단해야 한다.
4. **오케를 로컬로 돌리는 실험을 허용할지.** `MARBLO_ORCHESTRATOR_MODEL=local` 이
   이미 코드상 허용값이다(`agent-config.ts:549`). 이 문서는 **범위 밖으로 두자**고
   제안한다.

---

## 10. 이 문서가 하지 않은 것

- **런타임을 하나도 설치하지 않았다.** `ollama`·`lms` 모두 이 Mac PATH 에 없다(실측).
  설치해야 확실해지는 항목은 전부 ★표로 남겨 L7 에서 확인하게 했다.
- **코드를 하나도 고치지 않았다.** 발견한 현행 버그(유령 비용, `local` dead-end)도
  `파일:라인` 포인터만 남기고 L2/L3 티켓으로 넘겼다.
- **모델 성능 수치를 추론하지 않았다.** 벤더 권장문은 인용했지만 점수는 한 줄도
  쓰지 않았다. 로컬은 (모델 × 양자화 × 하네스 × 컨텍스트) 함수라 남의 벤치를
  그대로 옮기면 우리 데이터로 오해석한다.
- **임계값을 확정하지 않았다.** G3 컨텍스트 하한도 "공식 권고 64k / 하한 32k" 라는
  **출발점**이지 확정치가 아니다. 확정은 L7 실측 뒤다.
- **새 축을 만들지 않았다.** 로컬은 축분리(`USbdRV4koQyqjRFKJAPf`) 위의 데이터 한
  행이다. 이 문서가 요구하는 스키마 변경은 `billing.kind:"local"` **하나뿐**이다.

---

## 부록 A. 출처 (전부 gstack `/browse`, 2026-07-26 확인)

| #   | URL                                                                          | 이 문서에서 쓴 내용                                                                                                                                                |
| --- | ---------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1   | `docs.ollama.com/api/anthropic-compatibility`                                | `/v1/messages` 호환, "Claude Code" 명시, env 2개, 지원 기능·필드·스트리밍 이벤트, `ollama cp` 별칭                                                                 |
| 2   | `docs.ollama.com/integrations/claude-code.md`                                | manual setup env 3개(**`ANTHROPIC_API_KEY=""` 포함**), `ollama launch claude [--config] [--yes]`, "64k+ 컨텍스트" 권고                                             |
| 3   | `docs.ollama.com/integrations/codex.md`                                      | `codex --oss -m`, `ollama-launch` TOML 프로파일(`wire_api = "responses"`), "최소 64k" 권고                                                                         |
| 4   | `docs.ollama.com/api/openai-compatibility`                                   | `/v1/chat/completions`·`/v1/completions`·`/v1/models`·`/v1/embeddings`·`/v1/responses`(v0.13.3+), `reasoning_effort` 지원, 컨텍스트는 Modelfile 로만               |
| 5   | `docs.ollama.com/api/authentication`                                         | **"No authentication is required ... locally via http://localhost:11434"**, 클라우드는 `ollama signin`/`OLLAMA_API_KEY`                                            |
| 6   | `docs.ollama.com/api/tags`                                                   | 응답 스키마: `name`·`size`·`details.parameter_size`·`quantization_level`                                                                                           |
| 7   | `docs.ollama.com/api/ps`                                                     | 응답 스키마: **`size_vram`·`context_length`**·`expires_at`                                                                                                         |
| 8   | `docs.ollama.com/context-length.md`                                          | **VRAM별 기본 컨텍스트 4k/32k/256k**, "코딩툴 최소 64000", `OLLAMA_CONTEXT_LENGTH`, `ollama ps` PROCESSOR 확인법                                                   |
| 9   | `docs.ollama.com/cloud.md`                                                   | 클라우드 모델 = 오프로드, `ollama signin` 필요                                                                                                                     |
| 10  | `ollama.com/pricing`                                                         | Free $0 / **Pro $20/월(동시 3개, 50배)** / Max $100/월(신규 중단)                                                                                                  |
| 11  | `api.github.com/repos/ollama/ollama/releases/latest`                         | **v0.32.4, 2026-07-25T02:22:12Z**                                                                                                                                  |
| 12  | `lmstudio.ai/docs/developer/anthropic-compat`                                | `/v1/messages`, `ANTHROPIC_BASE_URL=http://localhost:1234`·`ANTHROPIC_AUTH_TOKEN=lmstudio`, `Require Authentication` 시 `x-api-key`/`Bearer`                       |
| 13  | `lmstudio.ai/docs/developer/openai-compat`                                   | 지원 엔드포인트 5종, **Codex 는 `/v1/responses` 로 지원**, 포트 1234                                                                                               |
| 14  | `lmstudio.ai/llms.txt`                                                       | REST API v0(TTFT·loaded/unloaded·max context·quantization), 헤드리스 서비스 모드, JIT 모델 로딩                                                                    |
| 15  | `raw.githubusercontent.com/ggml-org/llama.cpp/master/tools/server/README.md` | 기능 목록의 OpenAI/**Anthropic Messages** 호환, `POST /v1/messages`(max_tokens 기본 4096), **툴콜은 `--jinja` 필요**, `--api-key`/`--api-key-file`, 예제 포트 8080 |

**로컬 실측(이 Mac, 2026-07-26)**: `command -v ollama` → 없음, `command -v lms` → 없음,
`system_profiler` → MacBook Pro / Apple M3 Pro / 36GB.

## 부록 B. 코드 근거 (이 워크트리 실측, 기준 `0d01ce98`)

| 주장                                                           | 근거                                                                                      |
| -------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| `ModelType` 이 3곳에 중복 정의                                 | `src/types/agent.ts:1`, `electron/agent-manager.ts:22`, `electron/dispatch-scoring.ts:15` |
| `ModelProvider ≡ ModelType` 컴파일타임 단언                    | `electron/agent-config.ts:597-600`                                                        |
| 레지스트리에 local 행 0개                                      | `electron/model-registry.ts:310-315` 주석                                                 |
| `local` 에 런치 case 없음 → default 로 baseCommand 무인자 실행 | `electron/agent-config.ts:2494`(switch), `:2729-2731`(default)                            |
| MCP 생성기도 default → claude 포맷                             | `electron/agent-config.ts:1555-1567`                                                      |
| **유령 비용** — 미등록 모델은 `default $3/$15`                 | `electron/cost-tracker.ts:205-207`, `perTokenRateFor` `:211-229`                          |
| 프리셋에 local 없음(=콜드 제외가 현행)                         | `electron/dispatch-scoring.ts:416-444`                                                    |
| UI 가 `command: "ollama"` 를 넣음                              | `src/components/agents/AgentAddModal.tsx:52-59`                                           |
| compound `provider[:modelId][@effort]` 파서 존재               | `electron/model-selection.ts:306-372`                                                     |
| 그래프 tiered 모델키 조회 존재                                 | `electron/routing-graph.ts:270-293`                                                       |
| 오케 허용목록에 local 포함                                     | `electron/agent-config.ts:544-551`                                                        |
