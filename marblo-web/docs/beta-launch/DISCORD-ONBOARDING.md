# Marblo 베타 테스터 온보딩 가이드 / Beta Tester Onboarding

> 이 문서는 디스코드 `#start-here` 채널에 핀 고정 + 웹(marblo.app/beta 등)에 게시하는 용도.
> 한국어와 영어를 나란히 둡니다 (国内+海外 공용).

---

## 🇰🇷 한국어

### 환영합니다 👋

Marblo 파운더 베타에 오신 걸 환영해요. 여러분은 **AI 에이전트 팀을 관제하는** 새 방식을 가장 먼저 써보는 분들입니다. 솔직한 피드백이 제품을 만듭니다.

### 1) 역할 받기

- `#rules` 에서 규칙 확인 → ✅ 반응 → **Founder Beta** 역할 자동 부여
- 언어 선택: `#roles` 에서 🇰🇷(한국어) / 🇬🇧(English) 반응 → 해당 언어 채널 열림

### 2) 앱 설치

- 다운로드: **https://marblo.app/download**
- **Mac**: `Marblo-3.0.1-arm64.dmg` — ⚠️ **Apple Silicon(M1 이상) 전용**. Intel Mac 미지원.
  - dmg 열고 Marblo를 응용 프로그램으로 드래그 → 실행
  - "확인되지 않은 개발자" 경고? → 정상이면 안 떠요(공증됨). 뜨면 스크린샷을 `#bugs`에.
- **Windows**: `Marblo-Setup-3.0.1.exe`
  - 실행 → SmartScreen 경고 뜨면 `추가 정보 → 실행` (EV 서명이라 대개 바로 통과)

### 3) 첫 실행

1. 로그인(Google/이메일)
2. GitHub 레포 하나 연결 → 프로젝트 열기
3. 보드에서 티켓 만들고 → 오케스트레이터에게 자연어로 지시 → 에이전트 병렬 실행
4. 막히면 `#help-ko`에 편하게 질문

### 4) 피드백 = Pro 3개월 🎁

- 며칠 써본 뒤 **피드백 6문항**(앱 내 또는 폼)을 **가입 후 3일 안**에 제출
- 제출 → **Pro 3개월 무료** 자동 지급 (결제 안 해도 됨)
- 30분 **인터뷰**까지 응해주시면 → **총 6개월**
- 피드백은 `#feedback-ko` 또는 앱 내 제출 창에서

### 5) 버그 신고 요령

- **앱 내에서 바로**: 앱 **상단바 오른쪽의 🐛 버그 신고** 버튼을 누르면 어느 화면에서든 신고 창이 열려요. (**설정 → 버그리포트** 탭에서도 동일한 창이 열립니다.) 앱 버전·OS 등이 자동 첨부되니 무슨 일이 있었는지만 적으면 됩니다.
- **디스코드로**: 논의가 필요하거나 급한 이슈는 `#bugs` 채널에 스크린샷과 함께 아래 형식으로 남겨주세요:

```
- OS: macOS 14 (M2) / Windows 11
- 버전: 3.0.1
- 무엇을 했는지: ...
- 기대한 결과 / 실제 결과:
- 스크린샷/로그:
```

### FAQ

- **Q. 완전 무료인가요?** 네, 베타 기간 무료. 피드백 주시면 Pro까지 드려요.
- **Q. 내 코드가 서버로 가나요?** 코드는 로컬에서 동작. 텔레메트리는 익명·옵트인. (자세한 건 `#announcements`)
- **Q. Intel Mac은요?** 이번 빌드는 arm64 전용. universal 빌드는 준비 중이에요.
- **Q. 어떤 AI 모델을 쓰나요?** Claude·Codex 등 여러 모델을 섞어 씁니다(BYO 키).

---

## 🇬🇧 English

### Welcome 👋

Welcome to the Marblo Founder Beta. You're among the first to run a whole **team of AI agents from one control plane**. Your honest feedback shapes the product.

### 1) Get your role

- Read `#rules` → react ✅ → you get the **Founder Beta** role
- Pick a language in `#roles`: react 🇰🇷 (Korean) / 🇬🇧 (English) to unlock your channels

### 2) Install the app

- Download: **https://marblo.app/download**
- **Mac**: `Marblo-3.0.1-arm64.dmg` — ⚠️ **Apple Silicon (M1+) only**. Intel Macs are not supported yet.
  - Open the dmg, drag Marblo to Applications, launch.
  - "Unidentified developer" warning? It shouldn't appear (notarized). If it does, screenshot it in `#bugs`.
- **Windows**: `Marblo-Setup-3.0.1.exe`
  - Run it. If SmartScreen appears, click `More info → Run` (usually passes instantly — EV signed).

### 3) First run

1. Sign in (Google/email)
2. Connect a GitHub repo → open the project
3. Create tickets on the board → tell the orchestrator in plain language → agents run in parallel
4. Stuck? Ask in `#help-en`.

### 4) Feedback = 3 months of Pro 🎁

- After a few days, submit the **6-question feedback** (in-app or form) **within 3 days of signup**
- Submit → **3 months of Pro, free** (no card needed)
- Do a 30-min **interview** too → **6 months total**
- Post in `#feedback-en` or via the in-app form

### 5) How to report a bug

- **Right inside the app**: Click the **🐛 Report Bug** button on the **right side of the top bar** to report from any screen. (The same dialog is also under **Settings → Report a Bug**.) Your app version, OS, etc. are auto-attached — just describe what happened.
- **On Discord**: For anything urgent or worth discussing, drop it in `#bugs` with a screenshot, using this format:

```
- OS: macOS 14 (M2) / Windows 11
- Version: 3.0.1
- What you did: ...
- Expected / Actual:
- Screenshot/logs:
```

### FAQ

- **Q. Is it really free?** Yes, free during beta. Give feedback and you get Pro too.
- **Q. Does my code leave my machine?** Code runs locally. Telemetry is anonymous & opt-in.
- **Q. Intel Mac?** This build is arm64-only. A universal build is in progress.
- **Q. Which AI models?** A mix — Claude, Codex, etc. (bring your own keys).

---

## 운영 메모 (내부, 게시 X)

- 다운로드 링크는 marblo.app/download (locale 리다이렉트 포함). 릴리스 호스트 melocream/marblo-releases.
- 피드백→Pro 3개월은 `submitFounderFeedback`가 결제 우회로 grant. 3일 윈도우는 서버 강제.
- 이메일 자동화(Resend): 신청확인 메일은 env 정합 티켓 `6baDFFkHVwyzlIkrcK3j` 확인 후 100% 신뢰.

---

# 📋 실전 카피 모음 (그대로 붙여넣기용)

> 아래는 디스코드 채널에 **바로 복붙**할 수 있는 실제 문안. `[초대링크]` 등 대괄호만 채우면 됨.

## A. `#rules` 규칙문 (Reaction Role: ✅ → Founder Beta)

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
1️⃣  #rules 에서 ✅  → 역할 받기 / get your role
2️⃣  #roles 에서 언어 선택 / pick your language
3️⃣  https://marblo.app/download 에서 설치 → 첫 프로젝트 열기 / install & open your first project

막히면 #help-ko / #help-en 로! / Stuck? Ask in #help-ko / #help-en.
🎁 며칠 써보고 피드백 → Pro 3개월 무료. / Use it, give feedback → 3 months of Pro free.
```

## D. `#announcements` 베타 오픈 공지 (한·영 병기)

```
🚀 Marblo 파운더 베타가 열렸습니다 / Founder Beta is live

한국어
AI 개발자 여러 명을 동시에 굴리고, 누가 뭘 했는지까지 추적하는 Marblo — 지금 무료로 써보세요.
• 설치: https://marblo.app/download  (Mac Apple Silicon / Windows)
• 신청·혜택: https://marblo.app/founders
• 피드백(6문항, 가입 후 3일 내) 주시면 Pro 3개월 무료, 인터뷰까지 하면 6개월!

English
Run multiple AI agents at once — and track every decision. Marblo is free to try right now.
• Install: https://marblo.app/download  (Mac Apple Silicon / Windows)
• Apply & perks: https://marblo.app/founders
• Send feedback (6 questions, within 3 days of signup) → 3 months of Pro. Add an interview → 6 months!

궁금한 점은 #help-ko / #help-en. Happy shipping 🚀
```

## D-2. `#announcements` 버그 신고 위치 공지 (한·영 병기)

> **언제:** 베타 오픈 직후 + 신규 테스터 유입 때마다 재고정(pin). 현재 배포본(3.0.1)에는 **버그 신고가 설정 안에** 있어서, 못 찾는 사람이 많습니다. 이 공지로 위치를 알려주세요.
> **왜 지금 공지로 해결:** 설치된 앱엔 릴리스 없이 팝업을 띄울 수 없어서(원격 공지 채널 부재), 디스코드·이메일 공지가 가장 빠른 안내 수단입니다.
> **다음 릴리스부터:** 상단바에 상시 🐛 버튼이 생겨 이 공지 없이도 바로 보입니다(그때는 "이제 상단 🐛로 더 쉽게"로 문구 교체).

```
🐛 버그 신고, 여기서 하세요 / How to report bugs

한국어
베타 쓰다가 이상한 점 발견하면 꼭 알려주세요 — 제보 하나가 정식 출시 품질을 바꿉니다.
• 지금 버전(3.0.1): 앱 좌측 하단 ⚙️ 설정 → "버그리포트" 탭에서 신고
  (앱 버전·OS가 자동 첨부되니, 무슨 일이 있었는지만 적으면 끝)
• 재현 방법 + 기대한 결과를 같이 적어주시면 더 빨라요.
• 논의가 필요하거나 급하면 #bugs 채널에 스크린샷과 함께!
• 곧 나올 업데이트부터는 앱 상단에 🐛 버튼이 생겨 더 쉽게 신고할 수 있어요.

English
Found something off during the beta? Please tell us — one report can change the release quality.
• Current version (3.0.1): open ⚙️ Settings (bottom-left) → "Bug Report" tab to file it
  (your app version & OS are auto-attached — just describe what happened)
• Include repro steps + what you expected, and it's even faster to fix.
• Urgent or worth discussing? Drop it in #bugs with a screenshot!
• The next update adds a 🐛 button in the top bar for even easier reporting.

#bugs
```

> 운영 팁: 이 메시지를 `#announcements`에 올리고 **📌 고정(pin)** + `#bugs` 채널 상단에도 복붙. 다음 릴리스가 나가면 첫 두 줄을 "이제 앱 상단 🐛 버튼으로 어디서든 바로!"로 갱신.

## E. `#feedback-form` 6문항 안내 (실제 앱 문항과 1:1)

> 실제 제출은 웹 폼(**https://marblo.app/founders/feedback**, 로그인 필요)에서. 디스코드는 안내+미리보기.

```
🎁 피드백 6문항 → Pro 3개월 / 6 questions → 3 months of Pro

제출 위치 / Where: https://marblo.app/founders/feedback  (로그인 필요 / sign-in required)
마감 / Deadline: 가입 후 3일 이내 / within 3 days of signup

미리 생각해오면 좋아요 / Preview the questions:
① 무엇을 하려고 했나요?            / What were you trying to do?
② 좋았던 점                        / What you liked
③ 마블로가 해결해 준 내 문제(있다면) / A problem Marblo solved for you (if any) — 선택/optional
④ 막히거나 아쉬운 점                / What felt rough or lacking
⑤ 있었으면 하는 기능/개선           / Features / improvements you'd want
⑥ 10점 만점에 몇 점? + 그 이유      / Out of 10, your score + why

제출하면 자동으로 Pro 3개월이 지급됩니다. 인터뷰(30분)까지 응해주시면 총 6개월!
Submit and Pro (3 months) is granted automatically. Add a 30-min interview → 6 months total!
```

## F. `#bugs` 신고 템플릿 (핀 고정)

```
🐞 버그 신고 형식 / Bug report format

- OS: macOS 14 (M2) / Windows 11
- 버전 / Version: 3.0.1
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

> 카피 갱신 시 이 파일과 앱(messages/ko·en·ja.json의 `founderFeedback`)이 어긋나지 않게 유지. 문항은 현재 앱과 1:1로 맞춰둠(2026-07-01 기준).
