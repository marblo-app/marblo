---
tags: [강의, v3, 모듈2]
type: lecture
aliases: [Claude Code Codex 설치 인증]
---

# Claude Code + Codex 설치 & 인증

> 모듈 2 · 섹션 2-2 · 약 25분
> 관련: [[2-1_하네스스토어_원클릭설치]] | [[2-3_설정탭_BYOK_프라이버시]]

---

## 이 레슨의 4요소

- **학습목표:** 멀티에이전트의 두 주역 CLI(Claude Code·Codex)를 하네스에서 설치하고 각각 로그인까지 끝낸다. 곧 합류할 Antigravity, 빠진 Gemini의 위치를 안다.
- **시연할 마블로 화면·기능:** 하네스 CLI 카테고리 — `@anthropic-ai/claude-code`·`@openai/codex` 설치, 감지(`which`), CLI 인증 상태(인증 중/Ready/인증 필요), Antigravity(agy) 카드, Gemini 단종 표시.
- **진행할 프로젝트 단계:** 셋업.
- **핵심 메시지:** "우리 팀의 기본 2인 = Claude Code + Codex. Gemini는 빠졌고, 그 자리를 Antigravity가 잇는다."

---

## 도입 (2분) — 두 주역

앞 레슨에서 하네스로 토대를 깔았죠. 이제 실제로 코드를 쓰는 **CLI 에이전트**를 깝니다.

마블로의 기본 팀은 두 명입니다.

- **Claude Code** — Anthropic의 CLI. 설계·복잡한 로직·리뷰에 강한 팀의 주력.
- **Codex** — OpenAI의 CLI. 빠른 구현·프론트·테스트 작성에 잘 맞는 두 번째 손.

여기에 **Antigravity(agy)** 가 "곧 합류할 3번째"로 들어와 있고, 예전에 있던 **Gemini는 빠졌습니다.** 왜 빠졌는지는 뒤에서 짚어요.

---

## 본문

### 1. 하네스에서 두 CLI 설치 (5분)

화면: 하네스 탭 → CLI 카테고리

하네스 탭(`⌘⇧H`)을 열고 상단에서 **CLI** 카테고리를 선택합니다. CLI 도구 카드들이 보여요.

**(실습) Claude Code + Codex 설치**

1. **Claude Code** 카드의 [설치]를 누른다.
   - 내부적으로 `@anthropic-ai/claude-code`를 `npm-global` 방식으로 설치한다(당신은 버튼만).
2. **Codex** 카드의 [설치]를 누른다.
   - 내부적으로 `@openai/codex`를 설치한다.

> ⚠️ 패키지명·설치 명령은 버전에 따라 바뀔 수 있습니다. 집필/촬영 직전에 하네스 카드에 표기된 현행 패키지명을 확인하세요.

### 2. 설치 감지 — `which` (2분)

화면: 하네스 카드 — 설치 상태가 '설치됨'으로 바뀜

설치가 끝나면 마블로가 `which claude`, `which codex`로 실제 바이너리가 PATH에 있는지 **감지**해서 카드를 🟢 **설치됨**으로 바꿉니다. 버전도 함께 표시돼요(`v… (최신)`).

> 💡 macOS에서 Finder로 앱을 켜면 터미널 PATH를 못 물려받아 CLI를 못 찾는 일이 있습니다. 마블로는 Homebrew·nvm·npm 등 일반 설치 경로를 자동으로 PATH에 보강하므로, 대부분 추가 설정 없이 감지됩니다. 그래도 안 잡히면 앱을 재시작하세요.

### 3. 인증 — 설치 ≠ 로그인 (7분)

화면: 하네스 CLI 카드 — 인증 상태 배지

여기가 핵심입니다. **설치됐다고 바로 못 씁니다 — 로그인을 해야 해요.** CLI 카드에는 설치 배지와 별도로 **인증 상태**가 붙습니다.

- ⚪ **인증 중…** — 지금 로그인 진행 중(로딩).
- 🟢 **Ready** — 인증 완료. 스폰 가능.
- 🟡 **인증 필요** — 아직 로그인 안 됨.

> ⚠️ **인증 안 된 CLI로 에이전트를 스폰하면 안 됩니다.** 터미널이 로그인 프롬프트에서 멈춰버려서 작업이 진행되지 않아요. 반드시 **Ready**를 확인하고 스폰하세요. 마블로는 claude/codex 두 CLI의 인증 상태를 추적합니다.

**(실습) Claude Code 로그인**

두 가지 길이 있습니다.

- **OAuth(권장):** `claude` 첫 실행 시 브라우저가 열리고 Anthropic 계정으로 로그인. Pro/Max 같은 구독을 그대로 사용.
- **API 키:** 환경변수 `ANTHROPIC_API_KEY`로도 인증 가능(BYOK는 [[2-3_설정탭_BYOK_프라이버시]]에서).

> Claude Code를 쓰려면 Anthropic 유료 플랜(Pro 이상)이 필요합니다. Max 플랜이면 하루 사용량이 넉넉해 에이전트 여러 개 돌리기 좋아요.

**(실습) Codex 로그인**

```bash
codex login
```

`codex login`을 실행하고 안내에 따라 OpenAI 계정으로 인증합니다. 완료되면 하네스의 Codex 인증 상태가 🟢 **Ready**로 바뀝니다.

### 4. Antigravity(agy) — 곧 합류할 3번째 (3분)

화면: 하네스 CLI 카테고리 — Antigravity 카드

**Antigravity**는 Google의 새 CLI 래퍼이고, 마블로에서는 명령어 `agy`로 쓰입니다. 카드에는 "신규 1급, 곧 추가할 3번째 팀원"으로 소개돼 있어요. 인증은 OAuth 방식입니다.

스폰 화면(에이전트 추가 모달)에서도 Antigravity는 🟠 주황 아이콘으로 이미 선택지에 올라와 있습니다. 즉 **Gemini가 빠진 자리를 Antigravity가 잇는 구도**예요.

### 5. Gemini — 왜 빠졌나 (2분)

화면: 슬라이드 — fleet 구성 변화

예전 강의는 "Claude + Gemini + GPT"를 동시에 띄웠습니다. 지금은 다릅니다.

- **Gemini는 스폰 옵션에서 빠졌습니다(soft-removed).** 에이전트 추가 모달의 모델 목록에 더 이상 없습니다.
- 단종 예정 패키지로 분류돼, 하네스에 잔존하는 경우 빨간 **단종 예정 — 설치 비권장** 배지가 붙습니다.
- 다만 **Google AI 키(BYOK)는 호환을 위해 설정 탭에 남아 있습니다**(Gemini 계열 모델용 레거시 지원). 새로 팀에 넣지는 않지만, 키 슬롯은 유지돼요.

정리하면 — **기본 2인은 Claude Code + Codex, 3번째는 Antigravity.** Gemini는 무대에서 내려갔습니다.

[설명보드: "우리 팀의 fleet" 구성도]
📊 보드 파일: [assets/2-2_우리팀_Fleet_구성도.excalidraw](assets/2-2_우리팀_Fleet_구성도.excalidraw) — Excalidraw 에디터/excalidraw.com 에서 열기

- 가로로 카드 3장: 🟣 Claude Code(주력·설계/리뷰) / 🟢 Codex(구현/테스트) / 🟠 Antigravity(곧 합류).
- 그 아래 흐릿한 회색 카드 1장: Gemini — 위에 빨간 "단종 예정" 도장.
- 하단 카피: "기본 2인 + 1. Gemini는 빠졌다."

### 6. Claude Code 핵심 명령·권한 모드 (2분)

화면: 터미널 — Claude Code 실행 중

에이전트를 이해하려면 Claude Code 동작을 조금 알아야 합니다. 자주 쓰는 명령:

- `/compact` — 길어진 대화를 요약·압축(토큰 절약).
- `/cost` — 현재 세션 비용 확인.
- `/clear` — 대화 초기화.
- `/model` — 모델 전환(Sonnet/Opus 등).

> ⚠️ 슬래시 명령 목록은 버전에 따라 달라집니다. 촬영 직전 `claude` 안에서 현행 명령을 확인하세요.

**권한 모드** — 마블로가 스폰하는 에이전트는 **자동 허용** 모드로 돕니다(`--dangerously-skip-permissions`). 그래야 매번 확인 없이 파일을 만들고 명령을 실행하며 자율 작업해요. 사람이 직접 쓸 땐 기본(매번 확인)이나 Plan(분석만) 모드를 골라도 됩니다.

---

## 정리 (2분)

화면: 체크리스트 슬라이드

설치·인증 체크리스트:

- [ ] 하네스 CLI에서 Claude Code 설치 → 🟢 설치됨
- [ ] Claude Code 로그인(OAuth) → 🟢 Ready
- [ ] 하네스 CLI에서 Codex 설치 → 🟢 설치됨
- [ ] `codex login` → 🟢 Ready
- [ ] Antigravity(agy)·Gemini의 위치 이해(3번째 / 단종)

오늘 기억할 것:

1. **설치 ≠ 인증.** 둘 다 🟢 Ready여야 스폰 가능. 인증 안 된 CLI 스폰 금지(로그인 프롬프트에서 멈춤).
2. **기본 2인 = Claude Code + Codex.** Antigravity가 3번째.
3. **Gemini는 빠졌다.** 스폰 옵션에서 soft-removed, 단종 예정 표시. Google AI 키만 BYOK 레거시로 잔존.

다음 섹션에서는 설정 탭에서 **내 API 키(BYOK)** 를 넣고, 프라이버시·언어를 한 번에 맞춥니다.

---

다음: [[2-3_설정탭_BYOK_프라이버시]]
