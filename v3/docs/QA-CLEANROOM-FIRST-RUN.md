# 클린룸 최초실행 QA — 신규 유저 활성화 퍼널 (#579 / #580)

신규 유저가 앱을 **처음** 켰을 때 온보딩이 실제로 굴러가는지 검증한다.
외부 유저 이탈의 대부분이 이 구간(설치 → 인증 → 폴더 연결 → 첫 티켓)에서
발생했으므로, 재초대·신규모집의 전제 조건이다.

- 자동화: `tests/playwright/cleanroom/` (Playwright + Electron, 격리 실행)
- 수동: 아래 §5 체크리스트 (실제 설치/OAuth 소요시간은 자동화가 대체 못 함)

---

## 1. 실행

```bash
cd v3
npm run build                                   # dist-electron/main.js + dist/
npm run test:e2e:pw -- tests/playwright/cleanroom
```

증거물:

- 스크린샷 `v3/test-results/cleanroom/*.png`
- 실패 trace/video `v3/test-results/playwright/**`

## 2. 격리 (기존 사용자 상태 오염 금지)

`helpers/cleanroom.ts` 의 `launchCleanRoom()` 이 매 실행마다 임시 루트를 만든다.

| 축                  | 방법                                                    | 효과                                                        |
| ------------------- | ------------------------------------------------------- | ----------------------------------------------------------- |
| 앱 상태             | `--user-data-dir=<tmp>/userData`                        | localStorage(온보딩 dismissed·위저드 진행·로케일)·세션 리셋 |
| CLI/홈 상태         | `HOME=<tmp>/home`                                       | `~/.claude` · `~/.codex` · 번들 하네스 설치가 임시 홈으로   |
| PATH                | `PATH=<tmp>/bin:/usr/bin:/bin:/usr/sbin:/sbin`          | 가짜 CLI 셸 스크립트로 설치 상태 구성                       |
| 인증 env            | `ANTHROPIC_API_KEY` 등 8종 삭제                         | env 하나만 새도 probe 가 authenticated=true 를 돌려준다     |
| 시나리오(설치/인증) | main process IPC 핸들러 교체(`harness:cliAuthCheck` 등) | 결정적 시나리오 — 렌더러→preload→IPC 경로는 진짜 그대로     |

실제 사용자 프로필(`~/Library/Application Support/Marblo`, `~/.claude`)은
읽지도 쓰지도 않는다.

## 3. 시나리오와 결과 (2026-07-27 실행, 8/8 통과)

| ID  | 시나리오                                           | 결과                                                     |
| --- | -------------------------------------------------- | -------------------------------------------------------- |
| A   | codex 만 인증 + 재요청(`marblo:open-cli-setup`) ×3 | ✅ 셸 배너·레거시 모달 모두 재노출 없음 (#579 회귀 없음) |
| A'  | 아무 CLI 도 없음 + 재요청 (대조군)                 | ✅ 배너·모달 모두 노출 — A 의 탐지력 확인                |
| A2  | 인증됐지만 폴더 미연결 유저, 재시작                | ⚠️ 배너 매번 재노출 (**F2**)                             |
| B   | 자동설치 실패(노드/npm 부재)                       | ✅ 자동설치 시도됨 + 수동 명령·공식 문서 대안 노출       |
| C   | "첫 티켓 만들기" → `orchestrator:injectMessage`    | ✅ projectId·프롬프트 원문 그대로 도달 (#580 배선 정상)  |
| C'  | 로컬 오케 부재 상태에서 같은 버튼                  | ✅ 이 환경에선 실패 표기 (단 **F3** 한계 있음)           |
| E   | 4스텝 안내(왜/막혔을 때) + 인증 대안 경로          | ✅ 안내 존재 / ⚠️ 벤더키 경로 없음 (**F4**)              |
| D   | 최초부팅 관측                                      | ✅ 시작하기 탭 착지 + 폴더 연결 CTA 노출                 |

## 4. 발견된 활성화 장벽 (우선순위)

### F2 (High) — "CLI 인증이 필요합니다" 배너가 사실과 다르고, 영구히 돌아온다

- 증거: `test-results/cleanroom/A2-banner-after-restart.png`
  — codex 로그인 완료 상태인데 배너 제목은 "CLI 인증이 필요합니다", 본문은
  "작업할 폴더를 연결해야…". 제목과 본문이 서로 다른 말을 한다.
- 재현: 인증 완료 + 폴더 미연결 → 앱을 켤 때마다 배너가 다시 뜬다. ✕ 로 닫아도
  다음 실행에 또 뜬다.
- 원인: `useCliSetupEngine` 의 post-auth 분기가 `shouldShowPostAuthStep(readFlag(
DISMISSED_KEY))` 로 **레거시 키** `marblo.cliSetupGateDismissed` 만 읽는데,
  그 키를 쓰는 코드는 레거시 모달(`CliSetupGate.tsx`)뿐이다. 기본 표면인 셸에는
  그 키를 세우는 경로가 없어 "다시 보지 않기"가 성립하지 않는다.
- 제안: (a) 배너 문구를 `needStep` 기준으로 분기 (prd → "작업할 폴더를 연결해
  주세요"), (b) 배너 ✕ / 시작하기 탭의 dismissed 를 `onboardingProgress.dismissed`
  한 곳으로 통일하고 post-auth 분기가 그 값을 읽게.

### F3 (High) — 첫 티켓 "전달했어요"가 성공을 보장하지 않는다

- `createFirstTicket` 은 `routeInstructionToOrchestrator` 의 `"local"` 과
  `"queued"` 를 **똑같이 성공**으로 표기한다. 로컬 오케가 없으면 Firestore
  `pendingInstructions` 큐로 떨어지는데, 그 큐를 소비할 오케가 어디에도 떠 있지
  않으면 유저 화면에선 "전달했어요" 뒤에 아무 일도 일어나지 않는다.
- 자동화 한계: 이 하네스는 로그인 우회(mock 유저)라 큐 쓰기가 실패해 정직한
  실패가 떴다. **실제 로그인 유저는 큐 쓰기가 성공**하므로 오판이 그대로 노출된다.
  → §5 수동 체크리스트의 C-3 로 반드시 확인.
- 제안: `"queued"` 를 별도 문구로 ("대기열에 넣었어요 — 오케스트레이터가 실행
  중이어야 처리됩니다") + 오케 미기동이면 "오케스트레이터 실행" CTA 를 함께.

### F4 (Medium) — BYOM(벤더 API 키)으로 시작하는 경로가 온보딩에 없다

- 시작하기의 ② 인증 스텝은 Claude Code / Codex / Grok / agy **CLI 로그인**만
  제시한다. 벤더 API 키(설정 › 벤더 API 키 · env-swap: GLM/Kimi/MiniMax 등)는
  온보딩 어디에서도 언급되지 않는다.
- 영향: Claude/Codex 계정이 없고 다른 벤더 구독만 가진 신규 유저는 ②에서 막히고,
  설정 탭을 스스로 발견하지 못하면 이탈한다.
- 제안: 인증 스텝의 "막혔을 때" 줄에 "다른 벤더 키로 시작하기(설정 › 벤더 API 키)"
  링크와 지원 벤더 목록 한 줄 추가.

### F5 (Medium) — 최초실행 전면 모달 2겹이 시차를 두고 뜬다

- 언어 선택 → (약 4-5초 뒤) 개인정보 동의. 둘 다 `fixed inset-0` 전면 오버레이라
  그 사이 화면 클릭이 전부 막힌다(자동화도 같은 이유로 클릭이 인터셉트됐다).
- 제안: 동의 판정을 로그인 완료 시점에 붙여 언어 선택 직후 연속으로 띄우거나,
  동의를 비차단 배너로 강등.

### F1 (Medium · QA 신뢰도 High) — CLI 탐지가 PATH 격리를 무시한다

- `harness-manager.getEnrichedPathForDetection()` 이 PATH 와 무관하게
  `/opt/homebrew/bin` · `/usr/local/bin` · `/usr/bin` 등을 하드코딩으로 덧붙이고,
  claude 인증은 macOS 키체인(`security find-generic-password`)까지 조회한다.
- 결과: 개발용 맥에서는 HOME/PATH 를 갈아끼워도 "CLI 미설치" 상태를 만들 수 없다
  (실측: 클린룸 PATH 에 claude 를 두지 않았는데 진짜 probe 는 `installed:true`).
  그래서 이 spec 은 설치/인증 축을 IPC 스텁으로 구동한다.
- 제안: 탐지 결과에 해결된 바이너리 **경로**를 함께 반환(진단·지원 대응에 필수),
  그리고 QA 용 엄격 모드 env(`MARBLO_CLI_PATH_STRICT=1`)로 하드코딩 확장을 끄기.

### 잘 되고 있는 것 (회귀 가드로 고정됨)

- #579 가드(`shouldOpenGateOnReopen`)는 셸·레거시 양쪽에서 정상 — codex 만
  인증돼도 재요청에 아무것도 뜨지 않는다.
- #580 배선 정상 — 버튼 → `routeInstructionToOrchestrator` → main
  `orchestrator:injectMessage` 까지 projectId·프롬프트 원문 그대로 도달.
- 자동설치는 사용자 클릭 없이 최초 실행에서 시도되고, 실패 시 수동 명령 + 공식
  문서 대안이 노출된다.
- 4스텝 각각에 "왜"와 "막혔을 때" 한 줄이 있고, 첫 티켓 버튼은 폴더가 없으면
  비활성 + "먼저 폴더를 연결해 주세요(③ 단계)".

## 5. 수동 클린룸 체크리스트 (다른 맥 / 새 macOS 사용자 계정)

자동화가 대체할 수 없는 것: **실제 npm 설치 시간, 브라우저 OAuth, 오케 실기동,
가입~첫티켓 실측 시간.**

준비(택1)

- 권장: 새 macOS 사용자 계정 생성 (PATH·`~/.claude`·앱 userData 전부 계정별 격리)
- 수동: `npm un -g @anthropic-ai/claude-code @openai/codex` ·
  `rm -rf ~/.claude ~/.codex` · 앱 userData 삭제

체크리스트 (각 단계 타임스탬프 기록)

1. 앱 최초 실행 → 언어 선택 → 로그인 → 개인정보 동의까지 몇 초? (F5)
2. 시작하기 탭에 착지하는가? 4스텝이 전부 "남음"인가?
3. ① 자동설치가 클릭 없이 시작되는가? npm 설치 완료까지 몇 분?
   - node/npm 이 없는 계정에서: 실패 안내 + 공식 문서 링크가 뜨는가? (B)
4. ② "인증 실행" → 브라우저 OAuth 완료 후 자동 재확인으로 ✅ 로 바뀌는가?
   Claude/Codex 중 하나만 해도 통과하는가? (#579)
5. ③ 폴더 연결 → 프로젝트 자동 등록 + 오케스트레이터가 실제로 뜨는가?
6. **C-3 (F3 확인)** ④ "이 PRD로 첫 티켓 만들기" 클릭 →
   - 오케 터미널에 프롬프트가 실제로 들어가는가?
   - 보드에 티켓이 생기고 에이전트 스폰 제안이 오는가?
   - ★ 오케를 일부러 끈 상태에서 눌렀을 때 UI 가 뭐라고 말하는가? "전달했어요"가
     뜨는데 아무 일도 안 일어나면 F3 확정.
7. 앱 재시작 → 배너/팝업이 다시 뜨는가? (F2 — 폴더 연결 전/후 각각)
8. 총 소요: 가입 → 첫 티켓 완료까지 몇 분? (목표 30분)

## 6. 유지보수 메모

- 시나리오 축은 `CleanRoomScenario` 로만 바꾼다(설치/인증/자동설치 성패/오케 기동).
- 특성화 테스트(A2·E)는 **현재의 결함을 고정**한다. 고쳐지면 기대값을 뒤집고
  이 문서의 F2/F4 를 닫아라 — 테스트 주석에도 같은 지시가 있다.
- 셸(기본) / 레거시 Layout 두 표면이 공존하는 동안은 두 경로 모두 검증한다
  (`switchToLegacyLayout`).
