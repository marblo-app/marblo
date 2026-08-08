# 오카(Orca) 온보딩 경쟁분석 + 마블로 갭 대조 + 이탈 진범

- **티켓**: `wzb8oDWmqltgIRBAOljU`
- **작성일**: 2026-08-08
- **성격**: 경쟁 실조사 · 진단 문서. **코드 무변경.** 개입안은 §8 후속 티켓 후보로 쪼갠다.
- **웹 실조사**: gstack `/browse` (전역 규칙: `mcp__claude-in-chrome__*` 미사용). 조회 시각 2026-08-08.
- **우리쪽 근거**: [`v3/docs/activation-friction-diagnosis-2026-08-07.md`](./activation-friction-diagnosis-2026-08-07.md) (#850) · [`docs/first-run-cohort-investigation-2026-08-07.md`](../../docs/first-run-cohort-investigation-2026-08-07.md) (7u7G) + v3 렌더러 코드 직접 확인
- **선행 벤치**: [`v3/docs/research/orca-worktree-ux-benchmark.md`](./research/orca-worktree-ux-benchmark.md) (2026-07-17, worktree UX 축)

---

## 0. 한 줄 결론

**"오카가 우리보다 복잡한데도 유저가 잘 따라간다"는 전제는 절반만 맞다.**

오카의 **복잡도 총량**은 우리보다 크다(worktree 병렬 + 25종 이상 CLI + 스플릿 + 임베디드 Chromium + SSH/CloudVM + 오케스트레이션). 그런데 그 복잡도 중 **첫 가치까지의 필수 경로에 놓인 것은 하나도 없다.** 오케스트레이션·Cloud VM·에이전트 대시보드는 전부 `Settings → Experimental` 뒤 옵트인이고, CLI 설치·인증은 아예 **온보딩 퍼널 밖**이다.

마블로는 정반대다. 가장 복잡한 것(오케 중심 티켓 파이프라인)과 가장 잘 깨지는 것(남의 CLI 설치·인증)을 **필수 4단계 위저드**로 첫 실행 앞에 세웠다.

| 축            | 오카                                                   | 마블로                                    |
| ------------- | ------------------------------------------------------ | ----------------------------------------- |
| 계정/가입     | **없음** ("Orca has no account system")                | Google 로그인 **필수**                    |
| CLI 설치·인증 | 퍼널 **밖**(전제) + `~/.claude`·`~/.codex` 자동 임포트 | 위저드 **①②단계**(차단 게이트)            |
| 첫 가치       | worktree 1개 + 에이전트 1기가 터미널에서 즉시 돔       | 오케가 첫 티켓을 만들어야 함(무표면 대기) |
| 복잡 기능     | Experimental 뒤 옵트인                                 | 필수 경로에 편입                          |
| 완료 알림     | 시스템 알림 + 사운드 + Dock 배지 + 벨 이력             | **없음**(알림 2곳 = 리소스경고·미션차단)  |
| 텔레메트리    | 익명, 계정 불필요 → 설치 즉시 관측                     | 로그인 후에만 flush                       |

**이탈 진범은 '시작하기 스텝이 어렵다'가 아니다.** #850 실측과 합치면 진범 순서는 (1)측정 축 오류 (2)재방문 장치 부재 (3)퍼널 경계를 잘못 그은 것 (4)첫 가치 정의. "스텝이 어렵다"는 3위의 한 증상이다. 자세한 판정은 §7.

---

## 1. 방법 — 실조사와 추론을 분리한다

**실조사(직접 조회한 것)**

| 소스                                    | 무엇을 얻었나                                                                           |
| --------------------------------------- | --------------------------------------------------------------------------------------- |
| `onorca.dev` 홈                         | 포지셔닝, 지원 에이전트, 비교표, 소셜프루프                                             |
| `onorca.dev/docs` (What is Orca?)       | 대상 오디언스 명시, "무엇이 아닌가"                                                     |
| `onorca.dev/docs/install`               | ★**First launch 3동작** — 이 문서 최대 근거                                             |
| `onorca.dev/docs/first-session`         | 첫 세션 6스텝 + 공식 TTFV 주장                                                          |
| `onorca.dev/docs/agents/supported`      | 33종 프리셋, Auto-setup 여부                                                            |
| `onorca.dev/docs/agents/claude-code`    | ★**"Log in once from any terminal"**                                                    |
| `onorca.dev/docs/cli/orchestration`     | Run/Task/Dispatch/decision gate, Experimental 게이트                                    |
| `onorca.dev/docs/ways-to-run`           | 호스티드 여부(로컬/SSH/자체서버/BYO CloudVM)                                            |
| `onorca.dev/docs/model/session-restore` | 데몬 PTY 소유, 완전 복원                                                                |
| `onorca.dev/docs/model/agents-sessions` | 상태 글리프, Needs You                                                                  |
| `onorca.dev/docs/notifications`         | 완료 알림·Dock 배지·벨                                                                  |
| `onorca.dev/docs/telemetry`             | ★**"Orca has no account system"**                                                       |
| `onorca.dev/download`                   | 게이트 없는 직접 다운로드                                                               |
| GitHub API `repos/stablyai/orca`        | ★39,668 / fork 2,789 / open issues 3,307 / MIT / repo 생성 2026-03-17 / push 2026-08-08 |
| GitHub API issue search                 | 온보딩 마찰 실증 이슈 87건, 그중 #11459 정독                                            |
| `marblo.app/ko/download`                | 우리 다운로드 페이지 문구 대조                                                          |

**하지 않은 것 (★중요)**

- **오카 트라이얼 미실시.** 오카는 데스크탑 앱이고, 이 티켓은 조사·문서 범위(scope=`v3/docs/`)라 앱 설치·실행을 하지 않았다. 따라서 §2 의 첫 실행 플로우는 **공식 문서가 명시한 동작**이지 내가 관측한 화면이 아니다. 원문 인용으로 표기한다.
- 클릭 수·초 단위 TTFV 는 오카 **자체 주장**(`"under five minutes"`)을 인용한 것이고 내 측정이 아니다.
- 스크린샷 픽셀 대조 없음.

**우리 쪽**은 전부 기존 실측(#850, 7u7G) 재인용 + 코드 직접 확인이다. 새 BQ 쿼리는 돌리지 않았다 — #850 스냅샷(2026-08-07)에서 하루밖에 안 지났고, 이 문서의 결론은 그 표본 위에 얹는다.

---

## 2. 오카 첫 실행 플로우 맵 (스텝별 · 출처 명시)

### 2-A. 획득 → 설치

| #   | 동작                                                                                                     | 게이트                                                                                              | 출처                             |
| --- | -------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- | -------------------------------- |
| 1   | `onorca.dev/download` 에서 DMG/EXE/AppImage 직접 다운로드. 또는 `brew install --cask stablyai/orca/orca` | **없음** — 이메일·가입·대기열 전부 없음. "Email yourself a link" 는 기기 이동용 편의일 뿐 필수 아님 | `/download`, `/docs/install`     |
| 2   | 설치. macOS 서명·공증 완료(Electron 확인 프롬프트는 정상이라 문서에 미리 적어둠)                         | 없음                                                                                                | `/docs/install` → Platform notes |

### 2-B. First launch — ★공식 문서 원문

> On first launch Orca will:
>
> 1. Ask for access to your home directory so it can add repos.
> 2. Offer to import `~/.claude`, `~/.codex`, and Ghostty terminal settings if present.
> 3. Drop you on an empty landing screen where you add your first repo.
>
> — `onorca.dev/docs/install`, "First launch"

세 줄이 전부다. **언어 선택 없음, 동의 모달 없음, 로그인 없음.**

②번이 이 문서의 핵심 관찰이다. 오카는 CLI 인증을 **요구하지 않고 상속한다.** 이미 `claude login` 을 해둔 개발자에게 오카는 인증을 한 번도 묻지 않는다.

### 2-C. 첫 세션 (`/docs/first-session`, 제목 자체가 "Your first 3-agent session")

> From empty app to three agents running in parallel in under five minutes.

| #   | 동작                                                                   | 상세                                                                         |
| --- | ---------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| 1   | **Add Repo** — 로컬 체크아웃 지정                                      | git 상태를 읽어 기본 브랜치를 base ref 로 자동 채택                          |
| 2   | 리포 옆 **`+`** → worktree 생성                                        | 태스크명 입력. **비워두면 해양생물 이름으로 자동 명명** (이름 짓기조차 선택) |
| 3   | start-from ref 확인                                                    | 기본값 = base ref. 그냥 넘어가면 됨                                          |
| 4   | 열린 터미널의 **에이전트 콤보박스**에서 Claude Code 선택               | 오케이 CWD 를 worktree 로 잡고 구독 크레덴셜을 전달해 CLI 실행               |
| 5~6 | (선택) 2~3번 반복해 3 에이전트 병렬 → 스플릿 → diff 리뷰 → commit/push | 여기부터는 "첫 가치 이후"                                                    |

**단일 에이전트 기준 첫 가치까지 = 리포 추가 + `+` + 에이전트 선택 ≈ 3~4 인터랙션.** 그 결과 화면은 **사용자가 이미 아는 Claude Code TUI** 다. 새로 배울 개념은 "worktree" 하나뿐이고 그것도 자동 생성된다.

### 2-D. CLI 는 어떻게 되나 — ★비대칭의 핵심

`/docs/agents/claude-code` 원문:

> **Setup**
>
> 1. Install Claude Code (`npm i -g @anthropic-ai/claude-code` or follow Anthropic's docs).
> 2. Log in once from any terminal.
> 3. Orca picks up `~/.claude` automatically — no extra config needed.

같은 설치·인증 작업이 **존재하지만 오카의 퍼널 안에 없다.** 그리고 실패했을 때의 귀인까지 문서가 명시적으로 밀어낸다:

> Open the terminal and run the agent's CLI manually. **If it fails there, it's an auth or install problem in the CLI itself — not Orca.**
> — `/docs/troubleshooting`

즉 오카는 (a) 그 단계를 자기 온보딩 진행률에 넣지 않고 (b) 실패를 자기 제품 실패로 계상하지 않는다.

예외: Claude/Codex/Cursor 를 **뺀** 나머지 30종에는 "Auto-setup"(원클릭 설치)이 붙어 있다. 즉 오카는 _깊게 통합한 3종은 사용자에게 맡기고, 얕게 붙인 30종은 자동 설치한다._ 자동 설치가 없어서가 아니라, **주력 3종의 인증만큼은 자기 화면에 안 들인다.**

### 2-E. 호스티드인가 — **아니다**

`/docs` "What Orca is not" 원문:

> **Not a hosted VPS product.** Orca runs on your desktop by default. Remote compute uses machines and cloud accounts you control.

`/docs/ways-to-run` 도 같은 말을 반복한다: "Orca does not sell managed VPS hosting." 4가지 실행 모드(로컬 / SSH 타깃 / 자체호스팅 Orca 서버 / BYO Cloud VM) 전부 사용자 소유 머신이다.

### 2-F. 오카의 오케스트레이션 — ★있다. 단 Experimental 뒤에.

`/docs/cli/orchestration`:

- 모델: **Run**(네임스페이스 + 코디네이터 인박스) / **Task**(spec·의존성·상태 pending→ready→dispatched→completed/failed/blocked) / **Dispatch**(1회 시도, worker_done·heartbeat 권한 보유) / **Message**(인박스 메일) / **Decision gate**(코디네이터 소유 질문, 태스크 차단).
- `orca orchestration worker-start --task <id> --worktree new-child --agent codex` 로 워커 스폰. `--model`/`--effort` per-worker 오버라이드. `--on windows` 로 페더레이션(원격 호스트) 워커.
- 그룹 주소 `@all` `@idle` `@claude` `@codex` `@worktree:<id>`.

**우리 아키텍처와 개념적으로 같은 것을 하고 있다.** 그런데 배치가 완전히 다르다:

> **Experimental** — Enable orchestration under Settings → Experimental before using these commands.

그리고 **GUI 가 없다.** 전부 `orca orchestration ...` CLI 명령이다. 게다가 문서가 스스로 "Legacy commands retired — `orca orchestration run` and `run-stop` perform no effects" 라고 적을 만큼 회전 중이다.

> **이 문서에서 가장 중요한 대비 한 줄**: 오카는 오케스트레이션을 **"첫 가치를 본 사람이 나중에 켜는 것"** 으로 뒀고, 마블로는 **"첫 가치를 보기 위해 반드시 통과해야 하는 것"** 으로 뒀다.

### 2-G. 첫 가치 이후 — 오카가 붙여둔 재방문 장치

| 장치            | 내용                                                                                                                                                       | 출처                          |
| --------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------- |
| 상태 글리프     | 스피너=작업중 / 앰버 `?`=사용자 대기 / 에메랄드=완료 / 빨강=차단·실패 / 회색=idle. **worktree 카드에 인라인, 기본 ON**. OSC 타이틀 + 에이전트 훅에서 파생  | `/docs/model/agents-sessions` |
| 완료 알림       | working→idle 전이마다 **시스템 알림 + 사운드 + worktree 칩**                                                                                               | `/docs/notifications`         |
| Dock 배지       | macOS Dock 아이콘에 미읽음 카운트 미러링                                                                                                                   | 같음                          |
| 벨(bell)        | 헤더 벨에 전 worktree 미읽음. 클릭 시 해당 worktree·pane 로 점프. 우클릭 "mark unread"                                                                     | 같음                          |
| 세션 복원       | 재실행 시 worktree·스플릿·**스크롤백**·포커스 탭 전부 복원                                                                                                 | `/docs/model/session-restore` |
| ★데몬 PTY 소유  | **앱을 꺼도 에이전트 프로세스가 계속 돈다.** 백그라운드 데몬이 PTY 를 소유. 다음 실행에 warm-reattach. 앱이 크래시해도 살아 있음. 호스트 리부트에서만 죽음 | 같음                          |
| 모바일 컴패니언 | iOS/Android 로 라이브 상태 확인·터미널 조작                                                                                                                | `/docs/mobile`, 홈            |
| Needs You 칸반  | 에이전트 대시보드(Experimental)의 "Needs You / Working / Done / Idle" 칼럼                                                                                 | `/docs/model/agents-sessions` |

여기서도 층위 분리가 보인다: **기본 ON = 글리프·알림·배지·복원**(가치 유지 장치), **Experimental = 대시보드·맵**(파워 유저 장치).

---

## 3. 마블로 첫 실행 플로우 맵 (코드 근거)

| #   | 동작                                                                                                                       | 코드                                                                                          | 성격                                   |
| --- | -------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- | -------------------------------------- |
| 1   | `marblo.app/ko/download` → macOS universal DMG (v3.0.22)                                                                   | —                                                                                             | 게이트 없음(동등)                      |
| 2   | 페이지가 미리 경고: _"설치 후 Claude Code·Codex 등 AI CLI를 설치하고 로그인해 기존 계정을 연결해야 에이전트가 동작합니다"_ | 다운로드 페이지                                                                               | 정직하지만 **설치 전 마찰 예고**       |
| 3   | 설치·실행                                                                                                                  | —                                                                                             |                                        |
| 4   | **언어 선택** (전체화면)                                                                                                   | `onboarding/LanguageFirstRun.tsx`, `FirstRunFlow.tsx`                                         | 블로킹 게이트                          |
| 5   | **개인정보·텔레메트리 동의** (전체화면)                                                                                    | `FirstRunFlow.tsx` → `PrivacyConsentModal`                                                    | 블로킹 게이트                          |
| 6   | **Google 로그인 (필수)**                                                                                                   | 로그인 없이는 텔레메트리 flush 자체가 안 됨 (#850 §4)                                         | ★오카에 없는 층                        |
| 7   | 시작하기 탭 4단계 위저드                                                                                                   | `lib/cliSetupGate.ts` `WIZARD_STEPS = install → auth → prd → firstTicket`, `StartHereTab.tsx` | ★핵심 대비 지점                        |
| 7①  | **install** — CLI 설치(자동 `npm i -g` + 실패 시 공식문서 폴백)                                                            | `cliSetupStore`, `useCliSetupEngine`, `CliSetupRows`                                          | 차단 게이트 (`canAdvanceWizard`)       |
| 7②  | **auth** — Claude **또는** Codex 로그인(터미널 왕복). BYOM 대안 있음                                                       | `authSatisfied()` = `requiredReady \|\| byomReady`                                            | 차단 게이트                            |
| 7③  | **prd** — 폴더 연결 + 샘플 PRD 시드                                                                                        | `cliSetupActions.connectFolder/seedSamplePrd`                                                 | 차단 게이트                            |
| 7④  | **firstTicket** — 오케에 첫 프롬프트 전달                                                                                  | `createFirstTicket()`, `FirstTicketResultNote`                                                | 가치 순간                              |
| 8   | 오케가 티켓 생성 → 에이전트 스폰 → 완료                                                                                    | —                                                                                             | **수십 초~수 분, 표면 없음**(#850 §S4) |

우리 쪽에도 오카에 없는 강점이 있고 그건 이미 배송돼 있다:

- **설치 전 가치 노출이 오히려 우리가 더 많다** — `StartHereTab` 상단에 자동 로드되는 오케스트레이션 데모 영상(`ValuePreview`) + 0원 인터랙티브 `DemoMode`. 오카 앱 안에는 이런 게 없다(홈페이지 목업뿐).
- 스텝이 **사라지지 않는다** — 건너뛰어도 리스트에 남고 재진입 시 resume (`onboardingProgress`, `resumeStep`). 오카는 애초에 스텝 개념이 없어서 비교 대상이 아니다.
- BYOM 축(F4)이 ②단계 대안으로 이미 있다 (`ByomStartSection`, `useByomOptions`).

---

## 4. 단계별 갭 표 (오카 vs 마블로)

| 단계                | 오카                                                    | 마블로                                                                                            | 갭 판정                           |
| ------------------- | ------------------------------------------------------- | ------------------------------------------------------------------------------------------------- | --------------------------------- |
| 획득                | 직접 DMG/brew, 게이트 0                                 | 직접 DMG, 게이트 0                                                                                | **동등**                          |
| 설치 전 기대설정    | "이미 코드 짜는 사람용" 명시                            | "CLI 설치·로그인 필요" 명시                                                                       | 동등(둘 다 정직)                  |
| 언어/동의           | 없음 (텔레메트리는 설정에서 옵트아웃)                   | 전체화면 2단 블로킹                                                                               | 마블로 **+2 스텝**                |
| **계정**            | **없음**                                                | Google 로그인 필수                                                                                | ★**마블로만 있는 장벽**           |
| CLI 설치            | 퍼널 밖(주력 3종) / Auto-setup(나머지 30종)             | 위저드 ①(자동설치+probe)                                                                          | 성격 **반대**                     |
| **CLI 인증**        | 퍼널 밖. `~/.claude` **자동 임포트**                    | 위저드 ②(터미널 왕복, 차단)                                                                       | ★**진짜 장벽**                    |
| 프로젝트 연결       | Add Repo 1클릭, base ref 자동                           | 폴더 연결 + PRD 시드                                                                              | 마블로 +1                         |
| 첫 작업 단위        | worktree 생성(이름 생략 가능)                           | 오케에 첫 티켓 프롬프트 전달                                                                      | ★**가치 정의 자체가 다름**        |
| 첫 가치 도달 화면   | 익숙한 Claude Code TUI 가 즉시 돔                       | 초록 텍스트 한 줄 + 대기                                                                          | ★**S4 dead-end**                  |
| 진행 중 표면        | 글리프 기본 ON(스피너/앰버?/체크/빨강/회색)             | 에이전트 패널은 있으나 **첫티켓 구간 표면 0**                                                     | 마블로 결손                       |
| 중복 전송 가드      | (스텝 개념 없음)                                        | **없음** — `disabled = sendingTicket \|\| !hasProject`                                            | 마블로 결손 (#850 §S4 실측 3연타) |
| 완료 알림           | 시스템 알림 + 사운드 + Dock 배지 + 벨 이력              | **없음.** `Notification` 호출 2곳뿐 = 리소스 누적 경고(`main.ts:929`) · 미션 차단(`main.ts:3227`) | ★**마블로 결손**                  |
| 앱 종료 시 에이전트 | **데몬이 PTY 소유 → 계속 돈다**                         | 앱과 함께 종료                                                                                    | ★큰 격차                          |
| 세션 복원           | worktree·스플릿·스크롤백·포커스 완전 복원               | resume 되나 콜드 재시작 시 검은 화면(alt-screen) 체감                                             | 마블로 열위                       |
| 재방문 유인         | 알림→클릭→해당 worktree 점프 / 모바일                   | **없음**(첫 완료 후 다음 행동 제안 표면 0)                                                        | ★**최대 절벽**                    |
| 복잡 기능 배치      | Experimental 뒤 옵트인(오케스트레이션·CloudVM·대시보드) | 오케가 **필수 경로**                                                                              | ★**구조적 차이**                  |
| 계측                | 익명 로컬 ID, 계정 불필요 → **설치 즉시 관측**          | 로그인 후에만 flush, 큐 인메모리                                                                  | ★**우리 사각**(#850 §4)           |
| 커뮤니티            | Discord + GitHub Issues(3.3k open) + 인앱 Send Feedback | GitHub + 텔레그램                                                                                 | 규모 차                           |

---

## 5. TTFV(첫 가치까지 시간) 대조 — 정직한 버전

|                      | 오카                                                                    | 마블로                                                                                                                                                         |
| -------------------- | ----------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 공식/설계상          | "under five minutes" (3 에이전트 기준). 단일 에이전트는 사실상 1분 이내 | 4단계 위저드 통과 후 오케 응답 대기                                                                                                                            |
| **실측**             | 없음(자체 주장 인용)                                                    | ★**측정 불가** — #850 §3: 서버가 모든 이벤트에 수신 시각을 박고 클라는 발생 시각을 안 보냄. 로그인 전 큐는 로그인 순간으로 붕괴                                |
| 유일한 실측 트레이스 | —                                                                       | `b304e231`: 00:38:33 첫 실행·로그인 → 00:38:56 ①install 진입 → **2시간 15분 공백** → 02:54 재실행 → 02:58:39 ②auth 성공 → 같은 날 버그수정 1건 **11.9분** 완료 |
| 사전 비용(퍼널 밖)   | Claude Code 설치 + `claude login`. **오카를 알기 전에 이미 치른 비용**  | 같은 작업이 **퍼널 안**이라 우리 시계에 계상됨                                                                                                                 |

**여기서 이 문서가 가장 정직해야 하는 지점:** 오카와 마블로의 TTFV 를 같은 자로 재면 **차이의 상당 부분이 "누구의 시계로 재느냐"** 에서 온다. 오카는 CLI 설치·인증 시간을 자기 TTFV 에 넣지 않는다. 마블로는 넣는다. 실제 사람이 겪는 총 시간은 생각만큼 다르지 않을 수 있다 — 다만 **그 시간이 누구 제품 안에서 흐르느냐**가 이탈률을 가른다. `b304e231` 은 그 시간을 우리 화면 안에서 겪었고, 2시간 15분 세션이 끊겼다.

★**결론적으로 TTFV 비교는 지금 우리 계측으로는 불가능하다.** #850 P1-3(`occurredAt` 컬럼)이 선행 조건이다.

---

## 6. 5가설 판정

### H1 — "오카는 셋업 마찰이 적다(호스티드/CLI 불필요)"

**판정: 결론 지지 / 근거 기각.**

- **기각되는 부분**: 오카는 호스티드가 **아니다**. 공식 문서 "Not a hosted VPS product" / "Orca does not sell managed VPS hosting". 데스크탑 앱 설치도 필요하고, CLI 도 필요하다. 심지어 CLI 설치·인증을 **대신 해주지도 않는다**(주력 3종 기준).
- **지지되는 부분**: 그럼에도 체감 마찰은 실제로 적다. 이유는 셋이다.
  1. **계정 없음** — "Orca has no account system"(공식 telemetry 문서). 마블로는 Google 로그인 하드 게이트.
  2. **CLI 작업이 퍼널 밖** — "Log in once from any terminal. Orca picks up `~/.claude` automatically."
  3. **자동 상속** — 첫 실행에 `~/.claude`·`~/.codex` 임포트 제안.
- 즉 마찰이 적은 이유는 **"호스티드라서"가 아니라 "퍼널 경계를 좁게 그어서"** 다. 이 구분이 개선안의 방향을 바꾼다 — 우리가 호스티드로 가야 한다는 결론이 아니라, **퍼널 경계를 다시 그으면 된다**는 결론이 나온다(§8 NEW-B).

### H2 — "단일 챗이라 친숙하다"

**판정: 문자 그대로는 기각 / 변형은 강하게 지지.**

- **기각**: 오카는 단일 챗이 전혀 아니다. worktree 병렬, 25종 이상 CLI, 무한 스플릿, 임베디드 Chromium + Design Mode, SSH/원격서버/CloudVM, 오케스트레이션 CLI. **개념 총량은 마블로보다 많다.**
- **지지되는 변형**: 오카의 **첫 가치 단위가 "사용자가 이미 매일 쓰는 Claude Code TUI"** 다. 새로 배울 개념은 worktree 하나뿐이고 그것도 이름을 안 지어도 된다. 반면 마블로의 첫 가치 단위는 "오케가 티켓을 만든다"라 **가치 이전에 신개념 4개**(오케스트레이터 · 티켓/보드 · 역할 · 디스패치)를 요구한다.
- 재진술하면: **"단일 챗이라 친숙"이 아니라 "제로 신개념 첫 가치"** 다.

### H3 — "오디언스 자기선택"

**판정: 강하게 지지. 그리고 오카는 이걸 의도적으로 한다.**

- 공식 문서 원문(`/docs`, "Who it's for"):
  > Orca is designed for people who already write code for a living and want to use AI as leverage — not as a replacement. It assumes you read diffs, care about commits, and keep a worktree tidy. **If you're looking for a no-code tool, Orca is not that.**
- **자기선택이 깨지는 지점의 실증**: GitHub 이슈 **#11459** — 비개발자(C레벨, 기계공학 배경이나 10년 이상 현업 이탈) 사용자가 _"Orca's onboarding and documentation assume a reader who already comes from a development background"_ 라며 용어집(worktree/ADE/pane/session/agent), 인앱 `?` 도움말, 공식 영상, "Orca 101" 을 요구. 설정 문구에 대해서는 _"Settings copy says what a toggle is called, not what it costs me"_.
  → **오카도 오디언스 밖에선 똑같이 막힌다.** 마찰이 없는 게 아니라 **마찰을 겪을 사람이 애초에 안 들어온다.**
- **★그런데 이 가설은 우리 이탈의 답이 아니다.** #850 §5-B: 우리 외부 6명은 **전원 오케 오픈까지 갔고**, 그중 3명(50%)이 첫 완료에 도달했다. 우리 코호트도 이미 개발자 자기선택을 통과한 사람들이다. 문제는 그 **다음**에 있다(§7).

### H4 — "셋업 전 가치 노출"

**판정: 부분 지지 / 그러나 우리 병목이 아니다.**

- 오카의 설치 전 노출: 홈페이지 인터랙티브 목업(에이전트 5기 돌아가는 화면), 기능별 "Click to inspect" 카드, 트위터 소셜프루프 14건, GitHub 39.7k★.
- **마블로는 이미 이걸 더 많이 한다.** `StartHereTab` 상단 `ValuePreview` 가 오케스트레이션 데모 영상을 자동 로드하고, "0원" 인터랙티브 `DemoMode` 도 있다(`demoScript.ts` 324줄). 오카 **앱 안에는 이런 게 없다.**
- 그러므로 차이는 "설치 전 노출량"이 아니라 **"설치 후 첫 실물 가치까지의 거리"** 다. 오카는 데모 없이도 30초면 실물이 돈다. 우리는 데모를 보고 나서도 4스텝이 남는다.
- 판정: 가설의 방향(가치를 앞으로)은 맞지만, **우리가 부족한 건 데모가 아니라 데모와 실물 사이의 거리**다.

### H5 — "국내 위주"

**판정: 활성화 이탈 원인으로는 기각 / 성장 상한 요인으로는 지지.**

- **규모 지지 근거**: 30일 GA4 방문 542 · lead 52 · `/download` 141 (7u7G §3-B) vs 오카 39,668★ · fork 2,789 · open issues 3,307 · repo 생성 후 5개월. **두 자릿수 규모 차이.** 이건 #850 이 이미 "규모 면에서 압도적 최대 누수"로 판정한 S1(유입) 구간이고, 앱 내 어떤 UI 개선으로도 안 움직인다.
- **이탈 원인으로는 기각**: 활성화(설치→첫 완료)는 국적과 무관한 6명 표본에서 **50%** 다(#850 §5-B). "한국어라서 이탈했다"는 인과를 지지하는 데이터가 우리 텔레메트리에 없다. `events` 에 로케일 축이 있지만 외부 코호트 6명 전원 MacIntel·경로 동일이라 분해할 표본도 없다.
- 다만 하나는 사실이다: 오카는 영어 단일 시장에서 시작해 **개발자 자기선택 + 오픈소스 배포(MIT, GitHub)** 로 규모를 벌었고, 그 규모가 다시 소셜프루프·Discord·이슈 3.3k 라는 온보딩 자산이 됐다. 우리에겐 그 자산이 없다. 이건 **온보딩 설계 문제가 아니라 GTM 문제**다.

### 가설 판정 한 장 요약

| 가설                 | 판정                                | 한 줄 근거                                                   |
| -------------------- | ----------------------------------- | ------------------------------------------------------------ |
| H1 셋업 마찰 적음    | **결론 지지 / 근거 기각**           | 호스티드 아님·CLI 필요. 마찰이 적은 건 계정 부재 + 퍼널 경계 |
| H2 단일 챗 친숙      | **기각 / 변형 지지**                | 오카가 개념은 더 많음. 다만 첫 가치가 "이미 아는 CLI"        |
| H3 오디언스 자기선택 | **강 지지**                         | 공식 "not a no-code tool" + 이슈 #11459 반증사례             |
| H4 셋업 전 가치노출  | **부분 지지 / 우리 병목 아님**      | 우리가 오히려 데모를 더 많이 함                              |
| H5 국내 위주         | **이탈 원인 기각 / 성장 상한 지지** | 활성화 50%는 국적 무관. 규모 차이는 GTM 축                   |

---

## 7. 이탈 진범 — 결론

**"시작하기 스텝이 어렵다"는 틀린 진단은 아니지만, 잘못된 우선순위다.** 진범을 영향 순으로:

### 1위 — [측정] 결승선이 잘못 그려져 활성화가 0%로 보인다

- #850 §2: `events.task:completed` 는 **사람이 보드에서 카드를 옮긴 경우만** 센다. 정상 사용법(오케가 티켓 만들고 에이전트가 끝냄)일수록 안 찍힌다. `task_outcomes` 로 보면 외부 3명이 성공 완료 4건.
- 오카에는 이 문제가 **구조적으로 없다** — 계정이 없으니 인증 게이트가 없고, 익명 로컬 ID 라 설치 시점부터 관측된다.
- **이걸 고치기 전에는 아래 어떤 개입도 효과를 못 잰다.** 그래서 1위다.

### 2위 — [재방문] 첫 완료 후 다음 날이 없다 (현재 최대 절벽)

- #850 §5-C: 외부 6명 중 **5명이 활동일 1일**. 첫 완료에 도달한 3명 중 2명도 하루만 썼다.
- 오카가 이 축에 쏟은 장치가 우리에겐 **사실상 전부 없다**:
  | 오카 | 마블로 |
  | --- | --- |
  | 에이전트 완료 시스템 알림 + 사운드 | 없음 |
  | Dock 배지 미읽음 카운트 | 없음 |
  | 벨 이력 + 클릭 점프 + mark unread | 없음 |
  | 앱 종료해도 데몬이 에이전트 유지 | 없음 |
  | 스크롤백까지 복원 | 부분 |
  | 모바일 컴패니언 | 없음 |
  | 첫 완료 후 다음 행동 제안 | 없음 |
- 코드 확인: `v3/electron/main.ts` 전체에서 `new Notification` 호출은 **2곳뿐** — 리소스 누적 경고(`:929`)와 미션 차단(`:3227`). **작업 완료 알림이 없다.**

### 3위 — [퍼널 경계] 남의 CLI 설치·인증을 우리 필수 스텝으로 삼킨 것

- 실측된 이탈 지문 2건이 **전부 여기**다: `b304e231` 의 ①install 2시간 15분 세션 단절, `1b733e44` 의 `auth:login_failed / loopback/no-token`.
- 오카는 같은 작업을 퍼널 밖에 두고, 트러블슈팅 문서로 귀인까지 밀어낸다("not Orca").
- **여기서 "스텝이 어렵다"가 맞는 부분이 나온다.** 다만 정확히는 *스텝이 어려운 게 아니라, 어려운 남의 일을 우리 진행률 막대 안에 넣은 것*이다.
- 부수 비용: probe 층이 새 실패 모드를 만든다(PATH/nvm — 기존 티켓 `DTnNfzHult14Y6whCpoy`), 그리고 이미 CLI 를 갖춘 개발자에게 "① 설치 ✓ ② 인증 ✓" 를 보여주는 건 안심이 아니라 **"이 앱은 설치가 4단계짜리구나"라는 첫인상**이다.

### 4위 — [가치 정의] 첫 가치가 "오케가 티켓을 만든다"라 신개념 + 무표면 대기

- #850 §S4 의 dead-end(30초 안에 "첫 티켓 만들기" 3연타, 전부 `delivered` 성공)의 구조적 원인.
- 오카의 첫 가치는 "worktree 하나에 에이전트 하나가 지금 돈다" — 즉시 보이고, 이미 아는 화면이고, 실패해도 터미널이 이유를 말해준다.

### ★그리고 진짜 구조적 교훈 하나

오카의 오케스트레이션(Run/Task/Dispatch/decision gate/federated worker)은 **개념적으로 우리와 같은 것**을 한다. 차이는 기능 유무가 아니라 **배치**다.

> 오카: 첫 가치 → (원하면) Experimental 켜고 오케스트레이션
> 마블로: 오케스트레이션 → (통과하면) 첫 가치

메모리 `marblo_vs_orca_strategy_and_moat` 가 정한 primary 해자는 **라이브 오케**다. 이 문서는 그 판단을 뒤집지 않는다. 뒤집는 건 **순서**다: 해자를 첫 30초의 관문으로 쓰면 해자가 필터가 된다. 오케는 두 번째 화면에서 팔아야 하고, 첫 화면은 "지금 내 리포에서 에이전트가 돈다"여야 한다.

---

## 8. 개선 우선순위 (오카 대비 구체안)

원칙은 #850 과 같다: **(a) 지표를 먼저 고치고 → (b) 관측된 dead-end 를 고치고 → (c) 재방문을 설계한다.** 이 문서는 거기에 **퍼널 경계 재설정** 하나를 추가한다.

### P0 — 측정 (#850 과 동일. 중복 제안이 아니라 재확인)

- **T1** 완료 sink 통일(`taskOutcomeReporter` 에서 `telemetry.taskCompleted()` 동시 발화) — #850 P0-1.
- **T5** `occurredAt` 컬럼 — TTFV 측정 개설. **이 문서의 §5 가 계산 불가로 남은 직접 원인.** #850 P1-3.
- **NEW-A. 익명 install-ping 의 설계 선례 확보** — #850 P1-1 은 3안 중 B(미인증 콜러블 + App Check)를 권고했다. 오카가 상용에서 **계정 없는 익명 로컬 ID + PostHog** 로 정확히 그 축을 돌고 있다는 것이 근거로 추가된다(수집 항목: 앱 버전·OS·아키텍처·릴리스 채널·익명 ID / 리포명·경로·브랜치·프롬프트·에러 원문은 **절대** 미수집). 우리 P1-1 B안 payload(clientId·platform·appVersion·locale)와 거의 동일. → **설계 재검토 없이 B안으로 진행 가능**하다는 근거 보강.

### P1 — ★퍼널 경계 재설정 (이 문서의 신규 축)

**NEW-B. ①install/②auth 를 "차단 스텝"에서 "조용한 전제 점검"으로 강등**

- 현재: `WIZARD_STEPS = [install, auth, prd, firstTicket]` 선형 + `canAdvanceWizard` 게이트. `StartHereTab` 은 `stepViews()` 로 **done 인 스텝도 리스트에 계속 렌더**한다.
- 제안 3종:
  1. **이미 충족된 ①②는 리스트에서 접는다.** probe 가 `installSatisfied && authSatisfied` 면 두 스텝을 "환경 확인됨 ✓" 한 줄로 접고, 진행률 막대를 `prd → firstTicket` **2스텝 기준**으로 다시 그린다. (오카의 "import if present" 와 같은 효과 — 이미 된 사람에게 4단계를 안 보여준다.)
  2. **실패 문구를 오카식 귀인으로.** 현재 `onboarding.startHere.alt.*` 폴백은 공식문서 링크다. 여기에 _"터미널에서 `claude` 를 직접 실행해 보세요. 거기서도 실패하면 CLI 쪽 문제입니다"_ 를 넣어 사용자가 우리 제품을 의심하지 않게 한다.
  3. **①②를 건너뛰고 ③④로 갈 수 있게 한다.** 지금도 `skipStep` 은 있지만 `cli_auth` 실패로 계상되고 다음 스텝으로 밀 뿐이다. BYOM 축(F4)이 이미 `authSatisfied` 를 OR 로 열어뒀으므로, **"CLI 없이 먼저 둘러보기"** 진입을 명시적 1급 경로로 승격.
- 범위: `v3/src/lib/onboardingProgress.ts`(스텝 뷰 축약), `v3/src/components/onboarding/StartHereTab.tsx`, `v3/src/locales/*` — 중.
- 기대: #850 §S2 의 유일한 실측 이탈 지문(①install 2시간 단절)의 직접 표적.

**NEW-C. 첫 가치를 오케 앞으로 — "에이전트 1기 바로 띄우기"**

- 오카의 첫 가치 = _worktree 1개 + 에이전트 1기가 지금 내 리포에서 돈다_. 우리는 그걸 만들 primitive 를 전부 갖고 있다(`worktree.*` IPC, `spawn_agent`, 터미널 탭).
- 제안: ③(폴더 연결) 직후, ④(오케 첫 티켓) **전에** _"이 폴더에 에이전트 1기 띄우기"_ 버튼을 둔다. 오케 파이프라인(티켓 생성 대기)을 통과하지 않고 30초 내 실물 화면이 나온다. 오케 서사는 그 다음 화면에서.
- ★**해자와 충돌하지 않는다**: 오케를 빼자는 게 아니라 **첫 30초의 필수 경로에서 빼자**는 것. 오카가 orchestration 을 Experimental 뒤에 둔 것과 정확히 같은 층위 분리다.
- 범위: `StartHereTab` ③단계 + 기존 스폰 경로 재사용 — 중. **선행 확인 필요**: 스폰 게이트가 `spawnNewAgent` 초크포인트에 있으므로(#660) 온보딩 경로도 같은 게이트를 타야 한다.
- **불확실성**: 이건 제품 방향 판단이 섞인 제안이다. "오케 우선" 서사와의 우선순위는 사장님/오케 판단 영역 — 이 문서는 근거만 댄다.

**NEW-D(=#850 T3). 첫 티켓 전달 후 진행 가시화 + 중복 전송 가드** — 우선순위 **상향**.

- 오카 대비 구체 기준: 첫 티켓 카드에 **오카식 상태 글리프**(스피너=오케 작업중 / 앰버 `?`=사용자 확인 대기 / 체크=티켓 생성됨)를 직접 붙인다. 텍스트 한 줄이 아니라 글리프여야 하는 이유는 오카 문서가 말하는 그대로다 — _"without you having to click into each tab to check."_
- 중복 가드는 #850 §S4 실측(30초 3연타)의 직접 해소.

### P2 — 재방문 (오카가 가장 크게 앞선 축, 현재 우리 최대 절벽)

**NEW-E. ★작업 완료 시스템 알림 + Dock 배지 + 알림 이력**

- 현재 `new Notification` 호출 2곳(리소스 경고·미션 차단)뿐. **에이전트/태스크 완료 알림이 없다.**
- 제안: `task_outcomes` terminal 전이(= T1 이 이미 손댈 자리) + 에이전트 working→idle 전이를 트리거로 ①시스템 알림 ②macOS Dock 배지 미읽음 카운트 ③헤더 벨 이력(클릭 시 해당 에이전트/보드로 점프).
- **코드량 대비 재방문 효과가 가장 큰 칸**이라고 본다: T1 이 만드는 트리거를 그대로 재사용하고, Electron `Notification` + `app.dock.setBadge` 는 이미 있는 API 다.
- ★주의: 에이전트 "working" 은 PTY 바이트 파생이라 양방향 오판 이력이 있다(메모리 `agent_working_derived_from_pty_bytes`). **완료 알림은 PTY 파생 상태가 아니라 `task_outcomes` terminal 전이에 걸어야** 오탐 알림 폭탄을 피한다.
- 범위: `v3/electron/main.ts` + 완료 구독 훅 — 중.

**NEW-F(=#850 T6). 첫 완료 직후 결과 요약 + 다음 작업 제안** — 유지. NEW-E 와 **같은 트리거**를 쓴다.

**NEW-G. 데몬 PTY 소유(앱 종료해도 에이전트 계속) — 검토 항목으로만 등록**

- 오카의 재방문 우위에서 가장 큰 단일 항목. 우리는 앱과 함께 죽는다.
- 크기 **대**(아키텍처 변경), 그리고 우리는 PTY 층에 사고 이력이 있다(마스터 fd 누수 `pty_master_fd_leak_kill_vs_destroy`, `injectMessage` 유실). **지금 착수 권고 아님.** 오케 안정성 투자(전략 로드맵 Phase0)와 묶어 판단할 항목으로만 남긴다.

### P3 — 문서·언어

**NEW-H. 용어집 + 인앱 `?` 도움말** — 오카 이슈 #11459 가 요구한 것(worktree/ADE/pane/session/agent 평문 용어집, 설정 항목마다 _무엇을 하나 / 언제 쓰나 / 무엇이 깨지나_ 3줄 패턴)은 **우리에게 그대로 적용된다.** 우리 용어는 더 많다(오케스트레이터·티켓·역할·디스패치·워크트리·플릿·하네스). 기존 티켓 `9nDmcUQfH0llwuPGvAuX`(Guide 탭 CLI 선행단계)와 같은 표면.

### 우선순위 한 장 요약

| 순위 | 항목                                   | 무엇이 좋아지나                 | 크기 | 출처                         |
| ---: | -------------------------------------- | ------------------------------- | ---- | ---------------------------- |
|    1 | T1 완료 sink 통일                      | 활성화율 실값화 (0%→실제)       | S    | #850                         |
|    2 | **NEW-E 완료 알림 + Dock 배지**        | **최대 절벽(재방문) 직접 공략** | M    | 이 문서                      |
|    3 | NEW-B 퍼널 경계 재설정(①② 강등)        | 실측 이탈 지문의 표적           | M    | 이 문서                      |
|    4 | NEW-D(T3) 첫 티켓 후 글리프 + 중복가드 | 관측된 유일 dead-end 해소       | M    | #850 + 이 문서               |
|    5 | T5 `occurredAt`                        | TTFV 최초 측정                  | S    | #850                         |
|    6 | NEW-C 에이전트 바로 띄우기             | 첫 가치까지 거리 단축           | M    | 이 문서 (★제품 판단 필요)    |
|    7 | NEW-F(T6) 첫 완료 후 다음 행동         | 재방문 2차                      | M    | #850                         |
|    8 | NEW-A install-ping(B안)                | 설치→로그인 전환율              | M    | #850, 근거 보강              |
|    9 | NEW-H 용어집·인앱 도움말               | 신개념 부담 완화                | S    | 이 문서                      |
|   10 | NEW-G 데몬 PTY                         | 세션 지속성                     | L    | 이 문서 (**착수 권고 아님**) |

---

## 9. 후속 실행 티켓 후보 (쪼갠 목록)

기존 #850 §9 목록과 **중복되지 않는 것만** 신규로 적고, 겹치는 것은 참조로 표기한다.

| #   | 제목(안)                                                                               | role     | 범위                                                         | 크기 | 비고                                                              |
| --- | -------------------------------------------------------------------------------------- | -------- | ------------------------------------------------------------ | ---- | ----------------------------------------------------------------- |
| O1  | [활성화·P2] 작업 완료 시스템 알림 + Dock 배지 + 알림 이력                              | frontend | `electron/main.ts`, 완료 구독 훅                             | M    | ★T1 트리거 재사용. PTY 파생 상태 금지                             |
| O2  | [활성화·P1] 시작하기 ①install/②auth 를 충족 시 접기 + 진행률 재산정                    | frontend | `lib/onboardingProgress.ts`, `StartHereTab.tsx`, `locales/*` | M    | 오카 "import if present" 벤치                                     |
| O3  | [활성화·P1] CLI 실패 문구를 자기귀인에서 CLI 귀인으로 (+ "CLI 없이 둘러보기" 1급 승격) | frontend | `locales/*`, `ByomStartSection`                              | S    | 오카 troubleshooting 문구 벤치                                    |
| O4  | [활성화·P1] 첫 티켓 카드에 오카식 상태 글리프(스피너/앰버?/체크)                       | frontend | `FirstTicketResultNote.tsx` 외                               | S    | #850 T3 의 UI 기준 구체화                                         |
| O5  | [활성화·P1] ③단계 직후 "이 폴더에 에이전트 1기 띄우기"                                 | frontend | `StartHereTab.tsx` + 기존 스폰 경로                          | M    | ★제품 판단 선행. `spawnNewAgent` 게이트(#660) 준수                |
| O6  | [문서·P3] 마블로 용어집 + 설정 3줄 패턴(무엇/언제/무엇이 깨지나)                       | frontend | Guide 탭, `9nDmc` 와 합칠 것                                 | S    | 오카 이슈 #11459 벤치                                             |
| —   | 완료 sink 통일 / `occurredAt` / install-ping / 첫 완료 후 제안                         | —        | —                                                            | —    | **#850 T1·T5·T4·T6 그대로.** 신규 생성 금지, 그쪽 우선순위만 갱신 |

---

## 10. 한계·정직성

- **오카 트라이얼 미실시.** §2 의 첫 실행 플로우는 공식 문서 원문 인용이고 내 관측이 아니다. 실제 첫 실행에서 문서에 없는 프롬프트가 더 뜰 가능성은 배제 못 한다.
- **TTFV 를 두 제품 같은 자로 재지 못했다.** 오카 쪽은 자체 주장("under five minutes"), 우리 쪽은 계측상 계산 불가(#850 §3). §5 의 비교는 그래서 **정성 비교**다.
- **우리 표본은 n=6.** 50%·17% 같은 비율은 방향 판단용이다(#850 §11 과 동일 한계).
- **오카의 실제 활성화율·리텐션 수치는 모른다.** 39.7k★ 는 인기 지표지 활성화 지표가 아니다. open issues 3,307 은 활발함의 증거이자 미해결 마찰의 증거로 **양쪽 다 읽힌다** — 어느 쪽으로도 단정하지 않았다.
- **H5 판정의 한계**: 로케일별 이탈을 분해할 표본이 없어 "국내라서 이탈"을 **기각**했지만, 이는 *기각을 지지하는 증거가 있다*가 아니라 *지지하는 증거가 없다*에 가깝다.
- **NEW-C(에이전트 바로 띄우기)는 제품 방향 판단이 섞여 있다.** 오케 우선 서사와의 우선순위는 이 문서가 결정할 사안이 아니며, 근거만 제시했다.
- 오카 수치(★39,668 / fork 2,789 / open issues 3,307)는 2026-08-08 GitHub REST API 실측이다. 홈페이지 표기 39.6k 와 일치.
- 날조 없음. 오카 인용은 전부 위 URL 에서 직접 읽은 문장이고, 마블로 코드 인용은 파일·행으로 확인 가능하다.

---

## 부록 A. 인용 출처 (웹, 2026-08-08 조회)

- `https://www.onorca.dev/` — 히어로·기능·비교표·소셜프루프
- `https://www.onorca.dev/docs` — "What is Orca?" (오디언스·"무엇이 아닌가")
- `https://www.onorca.dev/docs/install` — ★First launch 3동작·Homebrew·업데이트 채널
- `https://www.onorca.dev/docs/first-session` — 첫 세션 6스텝·"under five minutes"
- `https://www.onorca.dev/docs/agents/supported` — 33종 프리셋·Auto-setup·권한 기본값
- `https://www.onorca.dev/docs/agents/claude-code` — ★"Log in once from any terminal"
- `https://www.onorca.dev/docs/cli/orchestration` — Run/Task/Dispatch/decision gate·Experimental 게이트
- `https://www.onorca.dev/docs/ways-to-run` — 4가지 실행 모드·"does not sell managed VPS hosting"
- `https://www.onorca.dev/docs/model/session-restore` — 데몬 PTY 소유·복원 범위
- `https://www.onorca.dev/docs/model/agents-sessions` — 상태 글리프·Needs You 칸반
- `https://www.onorca.dev/docs/notifications` — 완료 알림·Dock 배지·벨
- `https://www.onorca.dev/docs/telemetry` — ★"Orca has no account system"·수집/미수집 항목·PostHog
- `https://www.onorca.dev/docs/troubleshooting` — "it's an auth or install problem in the CLI itself — not Orca"
- `https://www.onorca.dev/download` — 게이트 없는 직접 배포
- `https://api.github.com/repos/stablyai/orca` — ★39,668 / 2,789 / 3,307 / MIT / 2026-03-17 생성
- `https://github.com/stablyai/orca/issues/11459` — 비개발자 온보딩 마찰 실증
- `https://marblo.app/ko/download` — 우리 다운로드 페이지 "설치 후 준비물" 문구

## 부록 B. 인용 출처 (마블로 코드, v3)

- `src/lib/cliSetupGate.ts:50-58` — `WizardStep` / `WIZARD_STEPS` 선형 4단계
- `src/lib/cliSetupGate.ts:85-129` — `installSatisfied` / `authSatisfied` / `canAdvanceWizard` (차단 게이트)
- `src/components/onboarding/StartHereTab.tsx:120-135` — `stepViews`·`resumeStep` (done 스텝도 리스트 유지)
- `src/components/onboarding/StartHereTab.tsx:185-198, 694-722` — 첫 티켓 전달·`FirstTicketResultNote`(초록 텍스트 한 줄)
- `src/components/onboarding/StartHereTab.tsx:700-708` — `disabled = sendingTicket || !hasProject` (중복 전송 가드 부재)
- `src/components/onboarding/StartHereTab.tsx:416-462` — `ValuePreview` (설치 후 가치 노출 — 오카 앱엔 없음)
- `src/components/onboarding/FirstRunFlow.tsx:55-107` — 언어 → 동의 2단 전체화면 게이트
- `src/components/onboarding/ByomStartSection.tsx`, `hooks/useByomOptions` — F4 BYOM 축
- `electron/main.ts:929`, `electron/main.ts:3227` — ★`new Notification` **전체 2곳** (완료 알림 부재의 코드 근거)
- `v3/docs/activation-friction-diagnosis-2026-08-07.md` — 퍼널 실측·S1~S7·개입 우선순위
- `docs/first-run-cohort-investigation-2026-08-07.md` — 유입 규모 체인·first_run 계측 한계
