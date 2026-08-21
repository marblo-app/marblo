# 시작하기 마찰 — 라이브 종단 검증 (PR #1070 병합 후)

**2026-08-21 · claude 2.1.238 · codex-cli 0.149.0 · macOS 26.5 (arm64)**
티켓 `ymRo9BtilQnb48Y5ol68` / 선행 티켓 `K1e5pkaG26GhUaKSrMcV`

여기 적힌 숫자는 전부 **실기동 측정치**다. 손으로 지은 화면이 아니라 실제
`claude` / `codex` 프로세스를 격리 HOME 에 띄우고, `OrchestratorManager.launch()`
· `AgentManager.launch()` · `PtyManager` · `agent-input-wait` · `harness-manager`
를 **진짜 그대로** 태워서 잰 값이다. 하네스와 재현 절차는
[`tests/live/README.md`](../tests/live/README.md).

측정 원칙 하나: **우리가 보낸 바이트만 센다.** `PtyManager.write` /
`writeAndSubmit` 를 감싸 모든 write 를 ms 와 함께 기록했고, 하네스 자신은
PTY 에 아무것도 쓰지 않는다. 그래서 아래 표의 `writes` 열은 "제품이 타이핑한 것"
과 정확히 같다.

---

## 1. 결과 요약

| #   | 시나리오                        | 첫 화면                            | 자동응답                 | 부팅 프롬프트                         | writes | 판정          |
| --- | ------------------------------- | ---------------------------------- | ------------------------ | ------------------------------------- | ------ | ------------- |
| 1   | claude 생 HOME (테마 선택부터)  | 테마 선택 624ms                    | 없음                     | **미전송**                            | **0**  | ✗ 사람 필요   |
| 1b  | claude 온보딩만 끝난 HOME       | 폴더 신뢰 334ms                    | 없음                     | **미전송**                            | **0**  | ✗ 사람 필요   |
| 1c  | claude 폴더 신뢰됨 + 동의화면만 | bypass 동의 379ms                  | `2`@379ms → `\r`@529ms   | 2032ms 전송                           | 3      | ✓ 사람 개입 0 |
| 2   | claude 기존 사용자              | composer 489ms                     | 없음                     | 1990ms 전송                           | 1      | ✓ 회귀 없음   |
| 3   | codex 인증됨                    | 스켈레톤 118ms → 진짜 composer     | 없음                     | 1201ms 전송 → 턴 시작                 | 1      | ✓             |
| 4   | **codex 미인증(새 맥)**         | 스켈레톤 401ms → 로그인 메뉴 444ms | 없음                     | **영구 보류**                         | **0**  | ✓ AUTHBLOCK   |
| R   | 살아있는 composer 에 인용문     | composer 239ms                     | `2`@8244ms → `\r`@8396ms | (이미 전송됨)                         | 3      | ✗ **오발**    |
| A   | claude 워커, 새 워크트리        | 폴더 신뢰 381ms                    | 없음                     | **10068ms 에 신뢰 다이얼로그로 전송** | 1      | ✗ 지시문 소실 |

### 시나리오 1c — PR #1070 이 고친 그 화면 (정상)

```
   0ms  STATUS starting
 379ms  "2. Yes, I accept"  →  자동수락 write "2"
 529ms  write "\r"          →  같은 프레임에 composer(⏵⏵)
2032ms  부팅 프롬프트 제출 (readiness 529ms + claude 1500ms 대기)
2034ms  STATUS running
```

선행 티켓의 측정(291 / 441 / 1944 / 2148ms)과 같은 모양이다. **사람 개입 0.**

### 시나리오 4 — ★가장 중요한 것 (정상)

```
   0ms  STATUS starting
 401ms  codex 스켈레톤(model: loading) — readiness 마커 `Ask Codex` 가 여기 이미 있다
 444ms  로그인 메뉴 "1. Sign in with ChatGPT … Press enter to continue"
 445ms  STATUS error — "Login prompt confirmed (probe-unauthenticated)"
75013ms 하네스가 멈출 때까지 방치 —  writes: 0
```

- readiness 마커가 로그인 메뉴보다 **43ms 먼저** 왔다. 지연값으로는 못 고치는
  그 순서가 실기동에서도 그대로 재현됐고, write 직전 화면 재확인이 그걸 막았다.
- 전사에 OAuth 대기화면(`Finish signing in via your browser`)이 **없다** — 예전에
  사장님이 보신 브라우저 창은 우리 CR 이 `1. Sign in with ChatGPT` 를 확정해서
  뜬 것이었고, 지금은 그 확정이 일어나지 않는다.

---

## 2. 남은 마찰 (고치지 않고 목록만 — 무엇을 고칠지는 별도 판단)

### F-1 (High) — claude 폴더 신뢰 다이얼로그를 **아무도 답하지 않는다**

`FIRST_RUN_DIALOG_MARKERS` 는 이 화면을 **잡아서 보류**한다(그래서 아무것도
타이핑하지 않는다 — 안전하다). 그런데 **답하는 주체가 없다.** 그래서 부팅이
영원히 안 끝나고, 60s 후 `setStatus("error")` + "the orchestrator needs a human"
로그로 끝난다(측정: 70.1s).

실측한 claude 2.1.238 의 신뢰 기록 규칙:

| 화면        | 저장 위치                                                     | 범위                                                       |
| ----------- | ------------------------------------------------------------- | ---------------------------------------------------------- |
| bypass 동의 | `~/.claude/settings.json` `skipDangerousModePermissionPrompt` | **머신 1회**                                               |
| 폴더 신뢰   | `~/.claude.json` `projects["<dir>"].hasTrustDialogAccepted`   | **디렉터리마다** (하위 디렉터리는 상속, 형제는 상속 안 함) |

즉 PR #1070 이 자동수락하는 화면은 머신당 한 번뿐이고, **매번 새로 뜨는 쪽은
폴더 신뢰다.** 새 프로젝트를 열 때마다 오케가 여기서 멈춘다.

> ★사장님 맥이 멀쩡한 이유: `~/.claude.json` 에 **`/` (루트)** 가 신뢰 항목으로
> 들어가 있다. 그래서 이 머신의 모든 경로가 이미 신뢰 상태이고, 워크트리
> 45개 중 `.marblo/worktrees` 항목이 0개인 것도 그 때문이다. 새 맥에는 그게 없다.
> (`skipAutoPermissionPrompt: true` 도 갖고 계시지만, 격리 HOME 실험 결과 그
> 플래그는 폴더 신뢰를 없애주지 **않는다** — 검증함.)

### F-2 (High) — 워커 경로에는 first-run 다이얼로그 게이트가 **아예 없다**

`looksLikeFirstRunDialog` 는 `orchestrator-manager.ts` 에서만 쓰인다.
`agent-manager.ts` 에는 `STARTUP_DIALOG_MATCHERS`(antigravity 신뢰 + codex 업데이트)
뿐이고 claude 폴더 신뢰는 거기 없다. 라이브 결과(시나리오 A, 새 워크트리):

```
 381ms  폴더 신뢰 다이얼로그
10068ms  블라인드 폴백이 6447자 지시문을 그 다이얼로그에 타이핑
10395ms  composer 등장 — 뒤따른 \r 이 "1. Yes, I trust this folder" 를 확정
        composer 는 비어 있다 → 지시문 소실, 에이전트는 할 일 없이 부팅
        (상태는 "working" 으로 승격되어 있다)
```

PR #1070 이 오케에서 고친 것과 **정확히 같은 사고**가 워커 경로에 그대로 있다.
현재 사장님 맥에서 안 터지는 이유는 F-1 과 같다(루트가 신뢰됨).

부수 사실: `agent-manager.ts` 의 주석은 신뢰 다이얼로그 기본 선택이 "No" 라고
말하지만, 2.1.238 실측 기본 하이라이트는 **`❯ 1. Yes, I trust this folder`** 다.
그래서 오늘의 결과는 "즉사" 가 아니라 "조용한 지시문 소실" 이다.

### F-3 (High) — ★자동수락이 **부팅 창 밖에서** 발동한다

`shouldAutoAcceptBypass` 의 게이트는 넷이다: 플래그 보유 모델 · 180s 창 ·
1회 래치 · 마커. 문제는 **래치가 동의화면을 실제로 만나야 켜진다**는 점이다.
기존 사용자는 그 화면을 영영 안 보므로 `bypassConsentAnswered` 가 계속 false 고,
스폰 후 180초 동안 출력에 `yes, i accept` 가 한 번이라도 뜨면 발동한다.

라이브 재현(시나리오 R — 첫 바이트부터 준비 완료인 대역 CLI, 실 PTY·실 배선):

```
 239ms  composer
1741ms  부팅 프롬프트 제출  ← 여기서부터 살아있는 대화다
8243ms  CLI 가 "…the marker list is: 2. Yes, I accept (from agent-input-wait.ts)" 출력
8244ms  write "2"
8396ms  write "\r"     ← 살아있는 composer 에 그대로 들어갔다
```

회귀 테스트는 "180s **밖**에서는 안 쏜다" 만 못박고 있고, **안쪽**은 비어 있다.
현실적으로 이 파일을 읽는 워커/오케가 마커를 인용하는 일은 드물지 않다.

### F-4 (High) — 실패 사유가 화면에 **안 뜬다** (예전 버그의 가장 나쁜 부분이 남아 있다)

`setStatus("error")` 는 `onStatusChange` → `main.ts:2751` 에서
`orchestrator:statusChanged` 로 `{ status }` 만 보낸다. 그런데 **보드 렌더러에
그 채널 구독자가 없다** (`src/App.tsx:194` 의 dev IPC 카운터가 유일한 등장이고,
`MissionOrchestratorPanel.tsx:53` 는 별도 `missionOrchestrator` API 다).
`OrchestratorPanel` 의 점/라벨은 렌더러 로컬 스토어를 읽으므로 `launch` 가
성공 반환한 뒤로 **초록 "running" 그대로** 남는다.

- 배지·배너·토스트·네이티브 알림: **없음**
- 사유("codex needs auth" / "a first-run dialog is on screen"): IPC 페이로드에
  **애초에 실리지 않는다** — `console.error` 에만 있다.
- 유일한 `role="alert"` 배너(`OrchestratorPanel.tsx:1013`)는 `launch` 가 동기로
  돌려주는 `result.needsAuth` 로만 켜진다. 로그인 백스톱은 PTY 가 뜬 **뒤**에
  발화하므로 그 배너에 절대 못 닿는다.

즉 시나리오 4 는 "안전하게 멈춘다" 는 맞지만, 사용자 눈에는 여전히
**초록불인 채 아무 일도 안 일어나는 패널**이다.

### F-5 (Medium) — 비기너 모드: 경로는 같고, 화면은 더 나쁘다

비기너 모드는 별도 런치 경로가 없다. `App.tsx:555` → `BeginnerShell` →
`useAppLifecycle`(`useAppLifecycle.ts:42`) → `useOrchestratorAutoLaunch` 로
**advanced 모드와 완전히 같은 IPC** 를 탄다. `BeginnerShell.tsx:704` 가 같은
`OrchestratorPanel` 을 마운트하므로 터미널도 렌더된다 — 즉 멈춘 다이얼로그가
비기너에게 **원시 PTY 출력으로 보인다**. 위에 초록 "실행 중" 라벨을 단 채로.
F-4 와 겹쳐 최악의 조합이다: 상태는 정상이라고 하고, 화면에는 답을 요구하는
영문 다이얼로그가 떠 있고, 무엇을 눌러야 하는지는 아무도 말해주지 않는다.

### F-6 (Low) — 60s 보류 후 승격이 실제로는 70s 다

`ORCH_FIRST_RUN_DIALOG_GIVE_UP_MS` 는 60s 지만, 카운터는 **첫 보류 시도**부터
돌기 시작하고 그 시도는 claude 의 10s 블라인드 폴백에서 처음 일어난다.
그래서 실측 승격 시점이 70.1s 였다. 의도라면 그대로 두면 되고, 아니라면 기점이
스폰 시각이어야 한다.

---

## 3. 사장님 실제 설정 무변경 확인

| 파일                      | 실행 전 sha256(앞 16) | 실행 후            | 판정                           |
| ------------------------- | --------------------- | ------------------ | ------------------------------ |
| `~/.claude/settings.json` | `841e4c51dd12389d`    | `841e4c51dd12389d` | 동일 (mtime 도 동일)           |
| `~/.codex/auth.json`      | `3196f14b7372c3b6`    | `3196f14b7372c3b6` | 동일 (mtime 2026-08-16 그대로) |
| `~/.codex/config.toml`    | `b3becbf224e6d6af`    | `b3becbf224e6d6af` | 동일                           |
| `~/.claude.json`          | `89aa7d7efc8c3c7a`    | `9bd95e9fbb906498` | **변했지만 우리가 아니다**     |

`~/.claude.json` 은 **이 검증을 수행한 Claude Code 세션 자신**이 상시 갱신하는
파일이다(`numStartups` 등). 하네스가 건드리지 않았다는 근거:

- `projects` 키 개수 45개로 **변화 없음**, 그중 격리 HOME/임시 경로
  (`mb-firstrun-live`, `/var/folders/**`) 항목 **0개**.
- 파일 크기가 239916 → 239821 로 **줄었다** — 항목 추가가 아니라 내부 정리다.
- 시나리오 3 은 사장님 `auth.json` 을 **심링크**로만 참조했고(운영 코드와 동일),
  그 파일의 해시·mtime 모두 그대로다 = 토큰 갱신 쓰기도 없었다.

---

## 4. 회귀 테스트

`npx vitest run tests/unit/orchestrator-first-run-boot.test.ts` → **18/18 통과**
(현 HEAD `befc6d9a`). `npm run typecheck` · `npx eslint tests/live/` 통과.

---

## 5. 이후 — F-3 / F-1 수정과 재실기동 (2026-08-21, 같은 하네스)

위 1~4절은 **PR #1070 병합 직후의 상태**다. 아래는 F-3(오발)과 F-1(폴더 신뢰)을
고친 뒤 **같은 하네스로 다시 잰 값**이다. 하네스는 새로 만들지 않았다.

### 5.1 무엇을 고쳤나

| #   | 고친 것                              | 방식                                                                                                     |
| --- | ------------------------------------ | -------------------------------------------------------------------------------------------------------- |
| F-3 | 자동수락이 살아있는 composer 에 `2⏎` | **마커는 그대로 두고 무장 조건만 좁혔다** — composer 가 살아있음이 증명되면 그 PTY 에서 영구 해제        |
| F-1 | 폴더 신뢰를 아무도 안 답한다         | **답하지 않는다. 선점한다** — 스폰 전에 `projects[<dir>].hasTrustDialogAccepted` 기록 (오케 + 워커 양쪽) |

★F-3 에서 **마커를 강화하지 않은 이유**는 #1070 주석에 이미 적혀 있다: 청크는
롤링 버퍼 없이 개별 분류되고 경고 헤드라인과 선택지는 5줄 떨어져 서로 다른
write 로 온다 → 결합 조건은 **실제 화면에서 아예 매칭이 안 된다.** 그걸 무시하면
오발 대신 "새 맥에서 자동수락 자체가 안 됨" 이라는 더 큰 사고가 된다.

대신 해제 조건 두 개를 썼다(둘 다 한 번 참이면 영구):

1. **composer 프레임** — bypass 모드 푸터 글리프 `⏵⏵` 를 본 적이 있으면 해제.
2. **우리가 타이핑함** — 부팅 프롬프트/주입 메시지를 그 PTY 에 쓴 적이 있으면 해제.

근거(둘 다 확인함):

- `⏵⏵` 는 동의·신뢰·테마·로그인 **어느 첫실행 화면에도 없다**(라이브 프레임 픽스처
  전수 검사를 회귀 테스트로 못박음).
- claude 2.1.238 바이너리에서 `BypassPermissionsModeDialog` 의 마운트 지점은
  **두 곳뿐이고 둘 다 REPL 이전의 await 모달**이다 → 동의화면이 **부팅 프롬프트
  뒤에 뜨는 경우는 없다.** (티켓이 확인하라고 한 바로 그 질문의 답.)
- 그리고 `sendPrompt()` 는 `looksLikeFirstRunDialog` 가 참이면 제출을 보류하고 그
  마커 목록에 동의 마커가 들어 있으므로, "부팅 프롬프트 제출됨" 은 이미
  "그 순간 동의화면이 없었다" 를 **뜻한다.**

### 5.2 재실기동 결과 (전부 실측)

| #   | 시나리오                    | 이전                                             | **이후**                                                                     | 판정                |
| --- | --------------------------- | ------------------------------------------------ | ---------------------------------------------------------------------------- | ------------------- |
| R   | 살아있는 composer 에 인용문 | `2`@8244 → `\r`@8396, writes 3                   | 8215ms 인용문에 **0바이트**, writes 1(부팅 프롬프트뿐)                       | ✓ **오발 소멸**     |
| 1b  | claude 온보딩만 끝난 HOME   | 폴더신뢰 334ms → **미전송**, writes 0            | 신뢰화면 **안 뜸** → 동의 715ms 자동수락 → composer 1036ms → **부팅 2539ms** | ✓ **개입 0**        |
| 1c  | 신뢰됨 + 동의화면만         | 379/529/2032ms, writes 3                         | 344/496/1978ms, writes 3                                                     | ✓ 회귀 없음         |
| 2   | 기존 사용자                 | composer 489ms, 부팅 1990ms                      | composer 533ms, 부팅 2035ms                                                  | ✓ 회귀 없음         |
| 3   | codex 인증됨                | 부팅 1201ms, writes 1                            | 부팅 1249ms, writes 1                                                        | ✓ 회귀 없음         |
| 4   | codex 미인증                | writes 0, 445ms AUTHBLOCK                        | writes 0, 299ms AUTHBLOCK                                                    | ✓ 회귀 없음         |
| A   | claude 워커, 새 워크트리    | 10068ms 에 **6447자를 신뢰 다이얼로그로** → 소실 | 신뢰화면 **안 뜸**, composer 519ms, 10066ms 에 **진짜 composer 로** 6447자   | ✓ **F-2 소실 해소** |
| 1   | claude 생 HOME              | 테마선택 624ms → 미전송                          | 테마선택 661ms → 미전송 (신뢰 선점은 걸렸다)                                 | ✗ **남음** — 아래   |

★1c 에서 composer(476ms)가 `2`(344ms)와 `\r`(496ms) **사이**에 떴는데도 `\r` 이
정상 발사됐다: 해제는 다음 판정부터 걸리고, 이미 커밋된 답의 나머지 절반은
취소하지 않는다. 이게 의도다 — 취소하면 동의화면이 반쯤 답해진 채 남는다.

### 5.3 시나리오 1 에 남은 것 — 테마 선택 (별개 화면)

생 HOME 은 **폴더 신뢰가 아니라 테마 선택**에서 멈춘다. 신뢰 선점으로는 안 풀린다.
격리 HOME 2개로 프레임 확인한 사실:

| HOME | `.claude.json`                                | 테마 선택 화면 |
| ---- | --------------------------------------------- | -------------- |
| h1   | `{hasCompletedOnboarding:true}`               | **안 뜸**      |
| h2   | `{hasCompletedOnboarding:true, theme:"dark"}` | 안 뜸          |

즉 `theme` 값은 **필요 없다** — 플래그만으로 충분하고, 사용자의 테마 취향을 우리가
대신 고르는 일은 생기지 않는다. 다만 `hasCompletedOnboarding` 은 폴더 신뢰와 달리
**claude 자신의 첫실행 마법사 상태**라 성격이 다르고 티켓 ★항목에도 없었으므로,
임의로 넓히지 않고 오케스트레이터에 판단을 요청해 두었다.

도달 가능성: 오케 스폰은 `checkSpawnAuthGate` 로 막히므로 **미인증 생 HOME 은
프로덕션에서 스폰까지 못 간다.** 단 `ANTHROPIC_API_KEY` 를 env 로 쓰는 사용자는
온보딩을 한 번도 안 거치고 인증됨으로 판정되므로(`claudeAuthenticatedSync` 1번
분기) **그 조합에서만 실제로 도달한다.**

### 5.4 곁다리로 확인된 사실 (고치지 않음 — 별도 판단)

- **워커의 readiness 목록에 `⏵⏵` 가 없다.** 오케는 갖고 있는데(`orchestrator-manager`
  readinessPatterns) `CLI_READINESS_PATTERNS` 엔 없다 → 시나리오 A 에서 composer 가
  519ms 에 떴는데도 지시문은 **10s 블라인드 폴백**으로 나갔다. 지시문이 이제 제대로
  꽂히므로 사고는 아니지만, claude 워커 부팅마다 9.5초를 그냥 버린다.
- **`agent-manager` 주석의 "신뢰 기본값 No" 는 틀렸다** — 2.1.238 실측 기본
  하이라이트는 `❯ 1. Yes, I trust this folder`. CLI 번들에서도 교차확인:
  신뢰 다이얼로그는 `<sc confirmLabel="Yes, I trust this folder" …>` 로 `focus` 를
  안 넘기고 `sc` 기본값이 `focus:"confirm"` 이다. 반대로 동의 화면은
  `cancelFirst focus:"cancel"` 이라 기본이 "No, exit" — 그래서 그쪽만 `2` 가 필요하다.
  주석은 이번에 고쳤다.
- **조상 상속은 git 루트에서 멈춘다**(`t3d`). 사장님 맥의 `/`(루트) 신뢰 항목은
  **git 저장소 안 경로까지 덮어주지 않는다** — 면역이 완전하지 않다는 뜻이다.

### 5.5 사장님 실제 설정 무변경

| 파일                      | 실행 전 sha256(앞 16) | 실행 후            | 판정                       |
| ------------------------- | --------------------- | ------------------ | -------------------------- |
| `~/.claude/settings.json` | `841e4c51dd12389d`    | `841e4c51dd12389d` | 동일                       |
| `~/.codex/auth.json`      | `3196f14b7372c3b6`    | `3196f14b7372c3b6` | 동일                       |
| `~/.codex/config.toml`    | `b3becbf224e6d6af`    | `b3becbf224e6d6af` | 동일                       |
| `~/.claude.json`          | `093beaf6d618141d`    | `3eb798314a488a04` | **변했지만 우리가 아니다** |

`~/.claude.json` 은 이 작업을 수행한 Claude Code 세션 자신이 상시 갱신한다(#1082 와
같은 사유). 하네스/신규 코드 무관함의 근거: **`projects` 45개 그대로**, 그중
격리·임시 경로(`mb-firstrun-live`, `/var/folders/**`) 항목 **0개**,
`.marblo/worktrees` 항목 **0개**. 신규 선점 코드가 실제 홈에 쓰려면
`os.homedir()` 가 실제 홈이어야 하는데 라이브 러너는 import 전에 `HOME` 을,
단위 테스트는 `CLAUDE_CONFIG_DIR` 을 격리 경로로 바꾼다.

### 5.6 회귀

- `tests/unit/orchestrator-first-run-boot.test.ts` → **28/28** (18 → 28, 신규 10개)
- `tests/unit/claude-workspace-trust.test.ts` → **17/17** (신규)
- 전체 `npx vitest run` → 7091 passed / 4 failed. 그 4건은
  `model-autoselect` · `onboarding-demo-script` 로 **이 변경 이전 HEAD 에서도 동일하게
  실패**한다(스태시 후 재실행으로 확인). 이 티켓과 무관.
- `npm run typecheck` · `eslint` · `prettier` 통과.

★신규 회귀 10개 중 **"180s 안쪽 오발" 5개는 게이트를 지우면 실제로 빨간불이
된다**(게이트를 주석 처리하고 확인). 지금까지 비어 있던 칸이 이제 막혀 있다.

---

## 6. 워커 경로 (티켓 `f6t9trvIVBvAfEKvtFrt`) — 같은 사고, 반대편

위 검증이 오케 경로를 찍은 뒤, **같은 게이트가 워커에는 없다**는 것이 시나리오
A 로 드러났다. `looksLikeFirstRunDialog` 는 `orchestrator-manager.ts` 에서만
쓰이고 있었다.

### 6.1 고치기 전 실측 (시나리오 A, 새 워크트리)

```
  381ms  화면: "Do you trust this folder?"
10068ms  블라인드 폴백 → 6447자 지시문을 그 다이얼로그에 타이핑
         뒤따른 \r 이 "❯ 1. Yes, I trust this folder" 를 확정
→ composer 비어 있음 · 지시문 소실 · 상태는 working 으로 승격
```

★즉사가 아니라 **조용한 소실**이다. `agent-manager` 주석이 신뢰 다이얼로그
기본값을 "No"(=즉사) 라고 적어둔 것이 오판의 출처였고, 2.1.238 실측 기본
하이라이트는 **`❯ 1. Yes, I trust this folder`** 다. 그 정정은 §5(P0)에서
이미 들어갔다.

### 6.2 ★선점이 들어온 뒤 다시 잰 값 — 시나리오 A 는 재현되지 않는다

이 문서의 §5(P0 `LIdW3JrjgaQmZ3V92xaM`, `claude-workspace-trust.ts`)가 그
사이 머지됐고, 그 선점은 **워커 경로에도 걸려 있다**
(`agent-manager.launch()` → `preemptClaudeFolderTrust`, 스폰 직전). 그래서
이 PR 을 main 에 리베이스한 뒤 **같은 하네스로 다시 쟀다.**

`node node_modules/.cache/mb-live/agentrunner.mjs a1|a2|a3 <out.json>`
(격리 HOME `mb-firstrun-live/home-agent`, 실 claude 2.1.238)

| 시나리오                        | 화면                   | 우리가 친 키  | 상태 전이               |
| ------------------------------- | ---------------------- | ------------- | ----------------------- |
| a1 새 워크트리 (선점 성공)      | 480ms composer(`⏵⏵`)   | 1980ms 6447자 | 1989ms → `working`      |
| a2 이미 신뢰된 워크트리         | 493ms composer(`⏵⏵`)   | 1994ms 6447자 | 2002ms → `working`      |
| ★a3 새 워크트리 + **선점 실패** | 2368ms 신뢰 다이얼로그 | **writes 0**  | 62111ms → `error`(사유) |

- **a1 에서 신뢰 다이얼로그가 아예 뜨지 않는다.** 로그: `claude folder trust
pre-empted … (2 config key(s) recorded) — the trust dialog will not render.`
  즉 6.1 의 사고는 **선점이 사는 한 발생하지 않는다.** 그래서 이 PR 은 선점을
  중복 구현하지 않았고, 이 PR 에 `hasTrustDialogAccepted` 를 쓰는 코드는 없다.

- **그런데 선점은 실패할 수 있다.** a3 가 그 실측이다. `~/.claude.json` 을
  claude 자신의 `<config>.lock`(proper-lockfile — 락이 곧 디렉터리, 수명이 곧
  mtime) 으로 다른 산 세션이 붙잡고 있으면 선점은 2s 대기 후
  `ok:false / "another writer held the claude config lock"` 로 물러난다. 사장님
  기계의 그 파일은 240KB 고 살아있는 세션들이 계속 다시 쓴다 — 가정이 아니다.
  같은 결과가 나오는 다른 경로: 설정 파일이 파싱 불가·쓰기 불가, `local` 처럼
  선점 대상 밖 모델, 미래 CLI 의 키 모양 변경.
  **a3 에서 다이얼로그는 2.4s 에 되돌아왔다.**

- ★그 되돌아온 다이얼로그 앞에서 워커가 하는 일이 이 PR 이다: **writes 0**,
  `working` **0회**, 62.1s 에 사유를 남기고 `error`. 실행 후 격리
  `.claude.json` 의 `projects` 에 그 워크트리가 **없다** = 우리의 `\r` 이 신뢰를
  확정한 적 없다. 선점 없이 이 게이트만 없던 6.1 과 정확히 반대다.
  선점의 실패 경로 주석(`claude-workspace-trust.ts`: "dialog recognised, boot
  prompt held, no keystroke")이 약속하는 동작이 바로 이것이고, 이 PR 이전의
  워커에는 그 동작이 **없었다.**

- 62.1s 는 **스폰 기준 60s** + 1s 재시도 틱이다. 종전 워커 구현은 "홀드가 걸린
  순간" 기준이라 하네스별 블라인드 폴백(claude 10s)만큼 늦게 울렸다(실측
  70.2s). 오케가 §5 에서 스폰 기준으로 옮겼으므로 워커도 같은 기준으로 맞췄다 —
  같은 `FIRST_RUN_DIALOG_GIVE_UP_MS` 하나를 양쪽이 공유하는 이상, 기준점이
  다르면 그 상수가 한쪽에서 거짓말을 한다.

- a1/a2 는 지시문이 **10s 폴백이 아니라 2.0s 에** 나간다 — claude bypass 모드
  composer 푸터 글리프(`⏵⏵`)를 워커 readiness 에 넣었기 때문. 종전 워커 패턴
  8종은 bypass 부팅 실 프레임에 **하나도** 매칭되지 않아 매 부팅이
  블라인드였다(오케는 이미 이 글리프를 갖고 있었다 — 한쪽만 고쳐진 그 모양).
  글리프 리터럴은 `agent-input-wait` 의 `LIVE_COMPOSER_MARKER` 하나를 공유한다.

- 상태 승격이 **지시문 전달 이후**로 이동했다(`bootPromptPending`). 보드가
  "일하는 중" 이라고 거짓말하던 구간이 사라진다 — a3 에서 `working` 이 0회인
  것이 그 값이다.

### 6.3 신뢰 선점을 할 때의 함정 (P0 에 남기는 실측)

`~/.claude.json` 의 `projects[dir].hasTrustDialogAccepted` 로 선점할 때
**키는 realpath 여야 한다.** macOS 에서 `/var/folders/...` 로 적으면 cwd 를
`/private/var/folders/...` 로 해석한 CLI 에는 안 보여서 다이얼로그가 그대로
뜬다 — a2 첫 시도가 정확히 그렇게 실패했고 `fs.realpathSync(cwd)` 로 통과했다.
현 `claudeTrustKeyCandidates` 는 raw·realpath·git main root 를 모두 쓰므로 이
함정을 이미 피한다(a1 로그의 "2 config key(s) recorded" 가 그 두 키다).

### 6.4 사장님 실제 설정 무변경

세 실행 모두 격리 HOME 으로만 돌았다. 실행 후 `~/.claude.json` 의 `projects`
45개 중 격리/임시 경로(`mb-firstrun-live`, `mb-trust-capture`,
`marblo-firstrun`) 항목 **0개**, 파일 크기 239117B, 실 HOME 에 남은
`.claude.json.lock` **없음**. `~/.claude/settings.json` mtime 그대로.

### 6.5 회귀 테스트

★선점이 시나리오 A 를 막는 지금, 이 게이트는 **평소에 발화하지 않는 백스톱**이다.
그래서 회귀 테스트가 유일한 상시 감시자다 — 선점이 나중에 깨졌을 때 워커가
조용히 지시문을 잃지 않는다는 것을 이 8개가 지킨다.

- `tests/unit/agent-first-run-boot.test.ts` **8/8** — 녹화 프레임
  (`tests/fixtures/pty/claude-folder-trust.json`, 실 PTY 캡처)을 실
  `AgentManager.launch()` 에 흘려 넣는다. 게이트를 무력화하면 5개가 깨지고, 그
  실패 내용이 정확히 사고 그대로다 — 지시문이 다이얼로그로 들어가고 상태가
  `working` 이 된다.
- `tests/unit/agent-status-reconcile.test.ts` 21/21 (미전달 승격 억제 2건 추가).
- `tests/unit/orchestrator-first-run-boot.test.ts` 28/28 ·
  `tests/unit/claude-workspace-trust.test.ts` 17/17 (§5 것, 리베이스 후에도 녹색).
- `npm run typecheck` 통과 · 변경 파일 `eslint` 통과.
