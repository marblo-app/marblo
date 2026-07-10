# Marblo 베타 테스터 온보딩 가이드 / Beta Tester Onboarding

> 이 문서는 디스코드 `#start-here` 채널에 핀 고정 + 웹(marblo.app/beta 등)에 게시하는 용도.
> 한국어와 영어를 나란히 둡니다 (国内+海外 공용).
>
> **Marblo = control plane for AI-native teams** — 이종 멀티에이전트를 한 화면에서 오케스트레이션하고, 티켓→PR 을 추적하며 안전하게 병합하는 데스크톱 앱.

---

## 🇰🇷 한국어

### 환영합니다 👋

Marblo 파운더 베타에 오신 걸 환영해요. 여러분은 **여러 AI 에이전트 팀을 한 화면에서 관제하는** 새 방식을 가장 먼저 써보는 분들입니다. 솔직한 피드백이 제품을 만듭니다.

### 1) 역할 받기

- `#rules` 에서 규칙 확인 → 동의(규칙 스크리닝 또는 ✅ 반응) → **Founder Beta** 역할 부여
- 언어 선택: `#roles` 에서 🇰🇷(한국어) / 🇬🇧(English) → 해당 언어 채널 열림
  _(초기 MVP 서버에선 언어 채널이 아직 하나로 합쳐져 있을 수 있어요 — 아무 언어나 환영!)_

### 2) 앱 설치

- 다운로드: **https://marblo.app/download** (권장 — 칩/OS 자동 감지)
- 실제 릴리스 자산 위치: **https://github.com/melocream/marblo-releases/releases** (버전별 `.dmg`/`.exe` 직접 내려받기)
- **Mac**: `Marblo-3.0.12-arm64.dmg` — ⚠️ **Apple Silicon(M1 이상) 전용**. Intel Mac 미지원.
  - dmg 열고 Marblo 를 응용 프로그램으로 드래그 → 실행
- **Windows**: `Marblo-Setup-3.0.12.exe`
  - 실행 → 설치

> 최신 버전은 다운로드 페이지 기준(현재 **v3.0.12**). 파일명은 버전에 따라 숫자만 바뀝니다.

#### ⚠️ 첫 실행 경고 우회 (정상입니다)

**Mac — Gatekeeper**

- 정상적으로는 경고가 안 떠요(공증됨). 그래도 "확인되지 않은 개발자" / "손상되어 열 수 없음"이 뜨면:
  1. **Finder 에서 Marblo 우클릭 → 열기 → 다시 열기** (더블클릭 말고 우클릭이 핵심)
  2. 그래도 막히면 `시스템 설정 → 개인정보 보호 및 보안` 하단의 **"확인 없이 열기"** 클릭
  3. 계속 안 되면 스크린샷을 `#bugs` 에 올려주세요.

**Windows — SmartScreen**

- `Windows 의 PC 보호` 파란 창이 뜨면 → **`추가 정보` 클릭 → `실행`**
- 백신이 인스톨러를 잡으면 예외 추가 후 재실행, 안 되면 `#bugs` 로.

### 3) 첫 실행 → 첫 프로젝트 연결

1. 로그인(Google/이메일)
2. **GitHub 레포 하나 연결** → 프로젝트 열기
3. 보드에서 **티켓 생성** → 오케스트레이터에게 **자연어로 지시** → 에이전트 병렬 실행
4. 티켓 → PR 로 이어지는 흐름을 확인 (누가 뭘 했는지 추적됨)
5. 막히면 `#help-ko` 에 편하게 질문

### 4) 피드백 & 혜택 🎁

며칠 써본 뒤 **6문항 설문**을 **가입/신청 후 3일 안**에 제출해주세요. 제출·선정에 따라 **Pro 구독**을 드립니다.

| 조건                       | 혜택          |
| -------------------------- | ------------- |
| 선정 (기본)                | **Pro 1개월** |
| **6문항 설문 완료** + 선정 | **Pro 3개월** |
| 위 + **30분 인터뷰**       | **총 6개월**  |

- ⚠️ **자동 지급이 아닙니다.** 운영진 확인·**승인 후** 부여돼요 (보통 빠르게 처리). "제출했는데 아직 안 들어왔다"고 조급해하지 않으셔도 됩니다.
- 설문 제출: **https://marblo.app/founders/feedback** (로그인 필요) 또는 앱 내 제출 창
- 논의는 `#feedback-ko`

### 5) 버그 신고 요령

- **앱 내에서 바로**: 앱 **상단바 오른쪽의 🐛 버그 신고** 버튼을 누르면 어느 화면에서든 신고 창이 열려요. (**설정 → 버그리포트** 탭에서도 동일한 창이 열립니다.) 앱 버전·OS 등이 자동 첨부되니 무슨 일이 있었는지만 적으면 됩니다.
- **웹에서**: 앱을 열 수 없을 때는 `marblo.app/bugs` 에서 로그인 후 바로 신고할 수 있어요.
- **디스코드로**: 논의가 필요하거나 급한 이슈는 `#bugs` 채널에 스크린샷과 함께 아래 형식으로 남겨주세요:

```
- OS: macOS 14 (M2) / Windows 11
- 버전: 3.0.12
- 무엇을 했는지: ...
- 기대한 결과 / 실제 결과:
- 스크린샷/로그:
```

### FAQ

- **Q. 완전 무료인가요?** 네, 베타 기간 무료. 피드백 주시고 선정되면 Pro 까지 드려요.
- **Q. Pro 는 자동으로 들어오나요?** 아니요 — 6문항 설문 제출 후 **운영진 승인**으로 지급됩니다(기본 선정 1개월, 설문 완료 3개월, 인터뷰까지 6개월).
- **Q. 내 코드가 서버로 가나요?** 코드는 로컬에서 동작. 텔레메트리는 익명·옵트인. (자세한 건 `#announcements`)
- **Q. Intel Mac 은요?** 이번 빌드는 arm64 전용. universal 빌드는 준비 중이에요.
- **Q. 어떤 AI 모델을 쓰나요?** Claude·Codex 등 여러 모델을 섞어 씁니다(BYO 키).

---

## 🇬🇧 English

### Welcome 👋

Welcome to the Marblo Founder Beta. You're among the first to run a whole **team of AI agents from one control plane**. Your honest feedback shapes the product.

### 1) Get your role

- Read `#rules` → agree (rules screening or ✅ reaction) → you get the **Founder Beta** role
- Pick a language in `#roles`: 🇰🇷 (Korean) / 🇬🇧 (English) to unlock your channels
  _(On the early MVP server the language channels may still be merged into one — any language is welcome!)_

### 2) Install the app

- Download: **https://marblo.app/download** (recommended — auto-detects chip/OS)
- Actual release assets: **https://github.com/melocream/marblo-releases/releases** (grab the per-version `.dmg`/`.exe` directly)
- **Mac**: `Marblo-3.0.12-arm64.dmg` — ⚠️ **Apple Silicon (M1+) only**. Intel Macs are not supported yet.
  - Open the dmg, drag Marblo to Applications, launch.
- **Windows**: `Marblo-Setup-3.0.12.exe` — run it and install.

> Latest version tracks the download page (currently **v3.0.12**). Only the version number in the filename changes.

#### ⚠️ First-launch warnings (this is normal)

**Mac — Gatekeeper**

- It shouldn't appear (the app is notarized). If you still see "unidentified developer" / "damaged and can't be opened":
  1. In Finder, **right-click Marblo → Open → Open again** (right-click, not double-click)
  2. If still blocked: `System Settings → Privacy & Security`, then click **"Open Anyway"** near the bottom
  3. Still stuck? Screenshot it in `#bugs`.

**Windows — SmartScreen**

- If "Windows protected your PC" appears → **click `More info` → `Run anyway`**
- If antivirus flags the installer, add an exception and retry, or post in `#bugs`.

### 3) First run → connect your first project

1. Sign in (Google/email)
2. **Connect a GitHub repo** → open the project
3. **Create tickets** on the board → tell the orchestrator in **plain language** → agents run in parallel
4. Watch tickets flow into PRs (every decision is tracked)
5. Stuck? Ask in `#help-en`.

### 4) Feedback & perks 🎁

After a few days, submit the **6-question survey** **within 3 days of signup**. Depending on submission and selection, you get **Pro**:

| Condition                       | Perk                |
| ------------------------------- | ------------------- |
| Selected (base)                 | **1 month of Pro**  |
| **Survey completed** + selected | **3 months of Pro** |
| Above + **30-min interview**    | **6 months total**  |

- ⚠️ **Not automatic.** Perks are granted **after the team reviews & approves** (usually quick). No need to worry if it isn't credited the instant you submit.
- Submit: **https://marblo.app/founders/feedback** (sign-in required) or the in-app form
- Discuss in `#feedback-en`

### 5) How to report a bug

- **Right inside the app**: Click the **🐛 Report Bug** button on the **right side of the top bar** to report from any screen. (The same dialog is also under **Settings → Report a Bug**.) Your app version, OS, etc. are auto-attached — just describe what happened.
- **On the web**: If you can't open the app, report it straight from `marblo.app/bugs` after signing in.
- **On Discord**: For anything urgent or worth discussing, drop it in `#bugs` with a screenshot, using this format:

```
- OS: macOS 14 (M2) / Windows 11
- Version: 3.0.12
- What you did: ...
- Expected / Actual:
- Screenshot/logs:
```

### FAQ

- **Q. Is it really free?** Yes, free during beta. Give feedback and, if selected, you get Pro too.
- **Q. Is Pro credited automatically?** No — after you submit the 6-question survey, the team **approves** the grant (1 month base if selected, 3 months with survey, 6 months with an interview).
- **Q. Does my code leave my machine?** Code runs locally. Telemetry is anonymous & opt-in.
- **Q. Intel Mac?** This build is arm64-only. A universal build is in progress.
- **Q. Which AI models?** A mix — Claude, Codex, etc. (bring your own keys).

---

## 운영 메모 (내부, 게시 X)

- 다운로드 링크는 `marblo.app/download` (locale 리다이렉트 포함). **릴리스 호스트 = `github.com/melocream/marblo-releases`** (public). 현재 버전 **v3.0.12** (`marblo-web/src/app/[locale]/download/page.tsx` 의 `APP_VERSION` 이 단일 진실원).
- 자산 파일명: `Marblo-<ver>-arm64.dmg`(Apple Silicon 단일) / `Marblo-Setup-<ver>.exe`(NSIS).
- **혜택은 자동 지급이 아님.** 신청/설문 onCreate → 관리자 텔레그램 인라인 승인(선정=1개월 / 설문완료+선정=3개월 / 예외·인터뷰=6개월). 클릭 없이 자동 3개월 부여되지 않음 — 문안에서 "자동"이라고 쓰지 말 것.
- 3일 윈도우(설문 마감)는 서버가 강제.
- 이메일 자동화(Resend): 신청확인 메일 env 정합은 티켓 `6baDFFkHVwyzlIkrcK3j` 확인.

---

# 📋 실전 카피 모음 (그대로 붙여넣기용)

> 아래는 디스코드 채널에 **바로 복붙**할 수 있는 실제 문안. `[초대링크]` 등 대괄호만 채우면 됨.
> (실제 초대 링크·토큰은 문서에 넣지 말고 게시 시점에 직접 삽입.)

## A. `#rules` 규칙문 (동의 → Founder Beta)

```
📜 Marblo 파운더 베타 규칙 / Community Rules

한국어
1. 서로 존중해주세요. 차별·괴롭힘·스팸 금지.
2. 베타는 개발 중입니다. 버그는 비난이 아니라 #bugs 로 알려주세요.
3. 아직 공개 안 된 기능/화면은 외부 유출을 삼가주세요 (스크린샷 공유는 OK, 재배포는 X).
4. 홍보·구인 등은 운영진 확인 후에만.
5. 솔직한 피드백을 환영합니다 — 그게 이 커뮤니티의 존재 이유예요.

English
1. Be respectful. No discrimination, harassment, or spam.
2. It's a beta. Bugs aren't complaints — report them in #bugs.
3. Please don't leak unreleased features externally (sharing screenshots is fine, redistribution isn't).
4. Promotions/recruiting only with staff approval.
5. Honest feedback is welcome — that's why we're here.

✅ 아래 체크에 반응하면 규칙에 동의하고 Founder Beta 역할을 받습니다.
✅ React below to agree and get the Founder Beta role.
```

## B. `#roles` 언어 선택 (Reaction Role)

```
🌐 언어를 골라주세요 / Pick your language

🇰🇷 → 한국어 채널 열기 (Korean channels)
🇬🇧 → English channels

둘 다 선택해도 됩니다. / You can pick both.
```

## C. Welcome Screen / `#start-here` 첫 메시지

```
👋 환영합니다! / Welcome!

Marblo = AI 에이전트 팀을 한 화면에서 관제하는 데스크톱 앱.
Marblo = a desktop app to run a whole team of AI agents from one control plane.

시작 3단계 / Get started in 3 steps:
1️⃣  #rules 에서 동의  → 역할 받기 / get your role
2️⃣  #roles 에서 언어 선택 / pick your language
3️⃣  https://marblo.app/download 에서 설치 → 첫 프로젝트 열기 / install & open your first project

막히면 #help-ko / #help-en 로! / Stuck? Ask in #help-ko / #help-en.
🎁 며칠 써보고 6문항 피드백 → 선정 시 Pro (설문 3개월·인터뷰 6개월).
🎁 Use it, send the 6-question feedback → if selected, Pro (3 months with survey, 6 with an interview).
```

## D. `#announcements` 베타 오픈 공지 (한·영 병기)

```
🚀 Marblo 파운더 베타가 열렸습니다 / Founder Beta is live

한국어
AI 개발자 여러 명을 동시에 굴리고, 누가 뭘 했는지까지 추적하는 Marblo — 지금 무료로 써보세요.
• 설치: https://marblo.app/download  (Mac Apple Silicon / Windows)
• 신청·혜택: https://marblo.app/founders
• 6문항 피드백(가입 후 3일 내) → 선정 시 Pro 1개월, 설문 완료 시 3개월, 인터뷰까지 하면 6개월!
  (자동 지급 아님 — 운영진 승인 후 부여)

English
Run multiple AI agents at once — and track every decision. Marblo is free to try right now.
• Install: https://marblo.app/download  (Mac Apple Silicon / Windows)
• Apply & perks: https://marblo.app/founders
• 6-question feedback (within 3 days of signup) → if selected, 1 month of Pro; 3 months with the survey; 6 months with an interview!
  (Not automatic — granted after the team's approval)

궁금한 점은 #help-ko / #help-en. Happy shipping 🚀
```

## D-2. `#announcements` 버그 신고 위치 공지 (한·영 병기)

> **언제:** 베타 오픈 직후 + 신규 테스터 유입 때마다 재고정(pin).
> **참고:** 최신 배포본(v3.0.12)에는 **앱 상단바에 🐛 버튼**이 있어 어디서든 바로 신고할 수 있습니다. (구버전 3.0.1x 이전은 설정 안에 있었음.)

```
🐛 버그 신고, 여기서 하세요 / How to report bugs

한국어
베타 쓰다가 이상한 점 발견하면 꼭 알려주세요 — 제보 하나가 정식 출시 품질을 바꿉니다.
• 앱에서: 상단바 오른쪽 🐛 버튼 → 어느 화면에서든 신고 (설정 → 버그리포트 탭도 동일)
  (앱 버전·OS가 자동 첨부되니, 무슨 일이 있었는지만 적으면 끝)
• 웹에서: 앱을 못 열면 marblo.app/bugs 에서 로그인 후 신고
• 재현 방법 + 기대한 결과를 같이 적어주시면 더 빨라요.
• 논의가 필요하거나 급하면 #bugs 채널에 스크린샷과 함께!

English
Found something off during the beta? Please tell us — one report can change the release quality.
• In-app: 🐛 button on the right of the top bar → report from any screen (Settings → Bug Report works too)
  (your app version & OS are auto-attached — just describe what happened)
• On the web: can't open the app? Report at marblo.app/bugs after signing in.
• Include repro steps + what you expected, and it's even faster to fix.
• Urgent or worth discussing? Drop it in #bugs with a screenshot!

#bugs
```

> 운영 팁: 이 메시지를 `#announcements`에 올리고 **📌 고정(pin)** + `#bugs` 채널 상단에도 복붙.

## E. `#feedback-form` 6문항 안내 (실제 앱 문항과 1:1)

> 실제 제출은 웹 폼(**https://marblo.app/founders/feedback**, 로그인 필요)에서. 디스코드는 안내+미리보기.

```
🎁 피드백 6문항 → 선정 시 Pro / 6 questions → Pro if selected

제출 위치 / Where: https://marblo.app/founders/feedback  (로그인 필요 / sign-in required)
마감 / Deadline: 가입 후 3일 이내 / within 3 days of signup

미리 생각해오면 좋아요 / Preview the questions:
① 무엇을 하려고 했나요?            / What were you trying to do?
② 좋았던 점                        / What you liked
③ 마블로가 해결해 준 내 문제(있다면) / A problem Marblo solved for you (if any) — 선택/optional
④ 막히거나 아쉬운 점                / What felt rough or lacking
⑤ 있었으면 하는 기능/개선           / Features / improvements you'd want
⑥ 10점 만점에 몇 점? + 그 이유      / Out of 10, your score + why

혜택 / Perks: 선정 시 Pro 1개월, 설문 완료 시 3개월, 인터뷰(30분)까지 하면 총 6개월.
Perks: if selected, 1 month of Pro; 3 months with the survey; 6 months total with a 30-min interview.
※ 자동 지급이 아니라 운영진 승인 후 부여됩니다. / Granted after the team's review, not automatically.
```

## F. `#bugs` 신고 템플릿 (핀 고정)

```
🐞 버그 신고 형식 / Bug report format

- OS: macOS 14 (M2) / Windows 11
- 버전 / Version: 3.0.12
- 한 일 / What you did:
- 기대 / 실제 / Expected / Actual:
- 스크린샷·로그 / Screenshot·logs:
```

## G. `#feature-requests` 안내

```
💡 기능 제안 / Feature requests

한 줄 제목 + 왜 필요한지 짧게. 좋은 제안엔 👍 눌러 투표해주세요.
One-line title + why it matters. 👍 to upvote good ideas.
```

> 카피 갱신 시 이 파일과 앱(messages/ko·en·ja.json 의 `founderFeedback`)이 어긋나지 않게 유지. 문항은 현재 앱과 1:1로 맞춰둠. **혜택 문구는 "자동 지급"이 아니라 "선정/승인 후 부여"로 통일**(1개월/3개월/6개월 티어).
