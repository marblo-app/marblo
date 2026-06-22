---
tags: [강의, v3, 모듈2]
type: lecture
aliases: [설정 탭 BYOK 프라이버시]
---

# 설정 탭 — BYOK · 프로필 · 프라이버시 · 언어

> 모듈 2 · 섹션 2-3 · 약 15분
> 관련: [[2-2_ClaudeCode_Codex_설치인증]] | [[2-4_프로젝트연결_워크트리체크]]

---

## 이 레슨의 4요소

- **학습목표:** 설정 탭을 한 바퀴 돌며 모델 프리셋을 고르고, 내 API 키(BYOK)를 안전하게 넣고, 프라이버시·언어를 처음에 한 번 맞춘다.
- **시연할 마블로 화면·기능:** 설정 탭(SettingsPage) — Profile / Models / Billing / Team / Privacy / Language / API Keys 7개 섹션. 특히 BYOK(Anthropic·OpenAI·Google AI) 키 저장과 프라이버시 동의.
- **진행할 프로젝트 단계:** 셋업.
- **핵심 메시지:** "키는 내 것을(BYOK), 동의·언어는 처음에 한 번."

---

## 도입 (2분)

CLI까지 인증했으면 이제 마블로 안에서 "내 환경"을 한 번 맞춥니다. 설정 탭은 처음에 5분 투자해두면 이후 내내 편한 곳이에요.

상단 탭바에서 **설정(Settings)** 탭을 엽니다. 왼쪽에 7개 섹션이 있습니다.

```
Profile · Models · Billing · Team · Privacy · Language · API Keys 🔒
```

하나씩 빠르게 돌아봅니다.

---

## 본문

### 1. Profile — 내 계정 (1분)

화면: 설정 탭 → Profile

이름·이메일·UID 같은 계정 정보가 보입니다. 2-1에서 로그인한 계정이 그대로 묶여 있어요. 확인만 하고 지나갑니다.

### 2. Models — 에이전트 모델 프리셋 (3분)

화면: 설정 탭 → Models

에이전트를 스폰할 때 어떤 모델을 쓸지의 **기본 프리셋**을 고르는 곳입니다. 다섯 가지예요.

| 프리셋                        | 구성                                       |
| ----------------------------- | ------------------------------------------ |
| **Claude 100%**               | 모든 에이전트를 Claude로 (최고 품질)       |
| **Marblo Recommended** (기본) | Claude 60% + Antigravity 20% + Codex 20%   |
| **Balanced**                  | Claude / Antigravity / Codex 균등 로테이션 |
| **Codex 100%**                | 모든 에이전트를 Codex로                    |
| **Antigravity 100%**          | 모든 에이전트를 Antigravity로              |

처음에는 **Marblo Recommended**를 그대로 두면 됩니다. 품질·비용 균형이 기본값이에요. 멀티모델 배합의 원리는 모듈 5에서 깊게 다룹니다. (여기서도 Gemini는 빠져 있고 Antigravity가 그 자리를 차지한 걸 확인할 수 있어요.)

### 3. Billing · Team (1분)

화면: 설정 탭 → Billing / Team

- **Billing** — 구독·결제 정보.
- **Team** — 팀원 관리(플랜에 따라 열림).

지금 단계에서는 넘어가도 됩니다. 혼자 셋업 중이니까요.

### 4. API Keys — BYOK (5분)

화면: 설정 탭 → API Keys 🔒

여기가 이 레슨의 핵심입니다. **BYOK(Bring-Your-Own-Key)** — 내 키를 내가 넣습니다. 세 제공자를 지원해요.

| 제공자        | 용도                                            | 키 형식(placeholder) |
| ------------- | ----------------------------------------------- | -------------------- |
| **Anthropic** | Claude 모델 (claude-sonnet-4, claude-opus-4 등) | `sk-ant-api03-...`   |
| **OpenAI**    | GPT·o 시리즈 (gpt-4o, o3, o4-mini 등)           | `sk-proj-...`        |
| **Google AI** | Gemini 모델 (gemini-2.5-pro/flash 등) — 레거시  | `AIza...`            |

> Google AI 슬롯이 남아 있는 건 **호환을 위한 레거시**입니다(자세한 건 [[2-2_ClaudeCode_Codex_설치인증]]). 기본 팀은 Claude + Codex예요.

각 키 슬롯에는:

- 상태 배지 — **Configured**(설정됨, 초록) / **Not set**(미설정, 회색)
- 👁 보기/숨기기 토글
- 🗑 삭제 버튼(키가 있을 때)

**(실습) Anthropic 키 넣기**

1. API Keys 섹션을 연다.
2. **Anthropic** 슬롯에 `sk-ant-api03-…` 키를 붙여넣는다.
3. 저장 → 배지가 **Configured**(초록)로 바뀐다.

> ⚠️ **중요 — 키는 평문으로 로컬에 저장됩니다.** 마블로는 키를 당신 컴퓨터의 `~/.marblo/api-keys.json` 파일에 **평문**으로 보관합니다. 그래서 화면에도 "API keys are stored as plaintext in your local filesystem. Do not share the `~/.marblo/` directory."라는 경고가 떠요. **`~/.marblo/` 폴더를 절대 공유·업로드하지 마세요.** 키는 내 기계 밖으로 나가지 않습니다 — 그게 BYOK의 핵심이자, 동시에 내가 직접 지켜야 할 책임입니다.

> 💡 Claude Code를 이미 OAuth로 로그인했다면(2-2), 그 경로로도 Claude를 쓸 수 있어요. BYOK 키는 키 기반으로 쓰고 싶을 때, 또는 다른 제공자 모델을 붙일 때 채웁니다.

### 5. Privacy — 동의·텔레메트리 (2분)

화면: 설정 탭 → Privacy

프라이버시 섹션에는 토글이 하나 있습니다.

- **익명 크래시 리포트 (Sentry)** — 켜면 앱이 죽었을 때 스택 트레이스를 보냅니다. 힌트: "스택 트레이스에서 PII 자동 마스킹."

알아둘 점:

- 켜면 **국외 이전 동의**가 함께 요구됩니다(개인정보보호법 제15조 제2항).
- 마블로의 내부 운영 지표는 **BigQuery에 비식별로** 적재됩니다 — PII 없이, 익명 설치 ID·토큰/비용/이벤트 종류만.
- 데이터 삭제를 원하면 화면의 메일 링크(support@marblo.app, 양식 자동 채움)로 요청할 수 있어요(개인정보보호법 제36조, 30일 처리).

처음에 **한 번** 결정하고 넘어가면 됩니다. 끄든 켜든 자유예요.

### 6. Language — 한국어 / 영어 (1분)

화면: 설정 탭 → Language

마지막으로 언어. 🇰🇷 **한국어(ko)** / 🇺🇸 **영어(en)** 중에 고릅니다. UI 전체가 즉시 바뀌어요. 한 번 정하면 끝입니다.

---

## 정리 (2분)

화면: 체크리스트 슬라이드

설정 체크리스트:

- [ ] Models 프리셋 = **Marblo Recommended**(기본) 확인
- [ ] API Keys에 내 키 입력 → **Configured**(최소 Anthropic 또는 OpenAI)
- [ ] `~/.marblo/` 폴더는 공유 금지(평문 저장) 인지
- [ ] Privacy(크래시 리포트) 동의 여부 결정
- [ ] Language 선택

오늘 기억할 것:

1. **BYOK = 내 키는 내 기계에.** `~/.marblo/api-keys.json`에 평문 저장 — 편하지만 폴더 공유는 절대 금지.
2. **모델 프리셋은 한 번 고르면 스폰에 자동 적용.** 기본 Recommended로 시작.
3. **동의·언어는 처음에 한 번.** 이후 신경 안 써도 됨.

다음 섹션에서는 드디어 작업할 **프로젝트를 연결**하고, 마블로의 핵심 안전장치인 **워크트리**를 처음 만납니다.

---

다음: [[2-4_프로젝트연결_워크트리체크]]
