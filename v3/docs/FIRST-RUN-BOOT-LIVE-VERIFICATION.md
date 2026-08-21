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
