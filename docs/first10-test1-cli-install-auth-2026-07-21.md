# 첫 10분 테스트 1/5 — 하네스 CLI 설치·인증: 신규 유저가 claude/codex 없이 시작하면 무엇을 겪나

- **작성**: 2026-07-21, test 에이전트 (읽기전용 코드 진단, ★수정 없음)
- **티켓**: FOWqen37ymPsCelPp32T
- **선행 문서**: `docs/beta-churn-root-cause-analysis-2026-07-21.md`(2MiRAwZU),
  `docs/onboarding-first10-funnel-instrumentation.md`(ixQUBdhx)
- **규칙 준수**: 코드·git 무변경. 라이브 앱/오케 세션 무접촉(Playwright/Electron 미부착).
  격리 코드·릴리스 아티팩트 정적 분석만. CLI 실설치 시뮬레이션은 미실행(원문 시크릿 미출력).

---

## 0. 한 줄 결론

**베타 최대 이탈(앱실행→첫스폰 22→6, −73%)의 최상단 용의자는 CLI 층이 맞다. dispatch 층은
배제된다.** 스폰은 물리적으로 시작되기도 전에 `checkSpawnAuthGate()`가 인증을 막고
`status:"blocked"`를 돌려주기 때문이다(dispatch/PTY 부수효과 이전). 그리고 CLI 층 안에서
막는 지점은 **①설치(Node/npm 부재)와 ②인증(본인 유료 Claude 계정 부재) 두 개이며, 앱 온보딩은
둘 중 어느 것도 신규 유저에게 명확히 고지하지 않는다.** 특히 **"BYOK = 본인 유료 Claude 구독/
API 키가 필요하다"는 사실이 설치→인증→첫스폰 경로 어디에도 없다.** 게이트 문구는 "로그인"만
말해 무료 로그인이면 되는 것처럼 읽힌다.

**사장님 핵심 질문에 대한 답: "대부분이 BYOK인 줄 모르고 인증을 못한 것"이 코드상 개연성이 매우
높다.** 온보딩이 유료 계정 필요성을 한 번도 고지하지 않고, 비개발자에게는 그 앞단(Node.js/npm
설치)이 또 하나의 무고지 벽이다. BYOK는 실제로 **이중 장벽**(설치 + 유료 인증)이고 비개발자는
둘 다 없다.

---

## 1. 사장님 가설 검증 — 스폰 실패는 dispatch 층인가 CLI 층인가

**결론: CLI 층 확정. dispatch 층 배제.** 근거(코드 경로):

- 에이전트/오케 스폰 진입점은 **PTY·워크트리 부수효과 이전에** `checkSpawnAuthGate(model)`을
  먼저 호출한다 — 에이전트 런치 `v3/electron/main.ts:4604`, 오케 런치 `main.ts:5536`.
  게이트가 막으면 즉시 `{ status:"blocked", needsAuth:{ model, action, installed } }`를 반환하고
  **스폰 자체를 안 한다**(main.ts:4609‑4618 / 5541‑5550).
- `checkSpawnAuthGate`는 claude/codex 만 게이트(`modelToCliAuth`, `harness-manager.ts:977`).
  `probeCliAuth`로 설치·인증을 라이브 프로브해 `reason:"not-installed"|"not-authenticated"`를
  붙인다(`harness-manager.ts:999‑`).
- 즉 오케가 오늘 20기+ 스폰했다는 사실은 **"오퍼레이터(사장님) 머신에 claude/codex가 설치·인증돼
  있을 때 dispatch가 정상"임을 증명**할 뿐이다(이 Mac 실측: `claude`=`~/.local/bin/claude`,
  `codex`=`/opt/homebrew/bin/codex` 존재). 신규 유저는 그 전제가 없어 **dispatch에 도달하기 전에**
  게이트에서 막힌다.
- 텔레메트리 `onboarding:orchestrator_blocked(errorCategory=cli_auth)`가 바로 이 지점이다
  (`useOrchestratorAutoLaunch.ts:86‑94`, 주석이 22→6 −73% 감축을 명시적으로 참조).

**CLI 층 내부 세분: 막는 건 설치·인증 둘 다다.** `probeCliAuth`는 설치 부재 vs 인증 부재를 구분할
수 있으나(`harness-manager.ts:916‑964`), 현재 퍼널 이벤트 `orchestrator_blocked`는 그 구분을
metadata에 안 싣고 `cli_auth` 하나로 뭉친다(§5 계측 갭). → **"설치서 막혔나 인증서 막혔나"는
라이브 데이터로 아직 분해 불가**(테스트 2~5/릴리스로 후행).

---

## 2. 신규 유저(CLI 미설치) 경로를 코드로 밟기

### 2-A. 바이너리 해석 — `resolveClaudeBinary()` (`v3/electron/agent-config.ts:51`)

- 탐색 순서(PATH 순서 불신, 결정적): `~/.local/bin/claude`(네이티브·최고신뢰) →
  `/opt/homebrew/bin/claude` → `/usr/local/bin/claude` → `~/.npm-global/bin/claude`. Windows는
  `.exe`/`.cmd` 변형(agent-config.ts:62‑107).
- **★stray shadow 방어됨**: `~/.bun`, `~/node_modules` 를 realpath로 차단
  (agent-config.ts:59, 138) — 메모리 `marblo_claude_binary_resolution`의 구버전 가림 이슈는
  이미 방어됨. codex도 `resolveHarnessCli`가 동일 stray 차단(agent-config.ts:795‑797). **이건
  현재 신규 유저 블로커가 아니다.**
- **★미설치 시 행동가능 메시지 없음(발견)**: 바이너리를 못 찾으면 **throw 하지 않고** POSIX는
  `{ command:"claude", version:"" }`(agent-config.ts:217), Windows는 `where` 후 bare 폴백
  (182‑215)을 **조용히** 반환한다. 유일한 출력은 `console.info`(219). 즉 리졸버 층은 신규 유저에게
  아무것도 안 알려준다 — 모든 행동가능 텍스트는 별도의 `probeCliAuth` 게이트에서만 나온다.

### 2-B. 사전 인증 게이트 — `probeCliAuth` / `checkSpawnAuthGate` (`harness-manager.ts`)

비대화형(CLI 미실행) 프로브. 설치=`isBinaryOnPath`, 인증=env 키 + 온디스크 크리덴셜.

| 상태          | 판정 근거                                                                                                                            | 반환 `action`(다음 명령)                   |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------ |
| claude 미설치 | `!isBinaryOnPath("claude")`                                                                                                          | `npm install -g @anthropic-ai/claude-code` |
| claude 미인증 | env `ANTHROPIC_API_KEY`/`AUTH_TOKEN`, `~/.claude/.credentials.json`, `~/.claude.json`(oauthAccount/primaryApiKey), macOS 키체인 존재 | `claude login`                             |
| codex 미설치  | `!isBinaryOnPath("codex")`                                                                                                           | `npm install -g @openai/codex`             |
| codex 미인증  | env `OPENAI_API_KEY`, `~/.codex/auth.json`                                                                                           | `codex login`                              |

★인증 판정은 **"oauthAccount 존재"**이지 **"유료 자격(entitlement)"이 아니다**
(`harness-manager.ts:847‑867`). → **무료 Claude 계정으로 `claude login` 하면 게이트는
`authenticated:true`로 통과**시킨다(§4 무성 실패의 씨앗).

### 2-C. UI — `CliSetupGate.tsx` (실제 마운트된 첫 실행 게이트)

- **★핵심 사료(CliSetupGate.tsx:11‑38 헤더 주석)**: 설계된 온보딩 위저드
  (WelcomeScreen/SetupWizard/OnboardingSteps)는 **죽은 코드**였다 — Next.js식 `src/app/onboarding`
  라우트에서만 렌더되는데 이 Vite+Electron SPA는 그걸 안 마운트한다(QA vj7ZvHphYOIhsNd340ad).
  그 결과 **신규 유저는 CLI 설치·로그인 안내 없이 보드에 도달했고 `claude`가 조용히 스폰 실패했다.**
  → 이것이 22→6 무성 이탈의 문서화된 기원. `CliSetupGate`는 그 수리다.
- 동작(현재 코드): 마운트 시 누락 CLI를 **백그라운드 자동설치**(npm), 로그인은 **원클릭**("인증 실행"→
  터미널 탭 스폰 후 `claude login` 자동 타이핑), 폴더 연결 전엔 빈 보드를 안 막고 조용히 자동설치만,
  **차단 오버레이는 오케 자동오픈 시점**에 `marblo:open-cli-setup` 이벤트로 뜬다(CliSetupGate.tsx:290‑298).
- **막힌 화면은 무성이 아니다(발견, 긍정)**: `useOrchestratorAutoLaunch` needsAuth 분기가 텔레메트리
  기록 + 모달 게이트를 띄운다. 수동 Start·모델 전환·`agent:needsAuth` 백스톱 모두 같은 오버레이로
  수렴(OrchestratorPanel.tsx:223/312, Layout.tsx:236‑243). → **"그냥 멈추는" 게 아니라 "설치/로그인
  하라"는 모달을 보여준다.**

---

## 3. ★그럼에도 비개발자는 설치→인증→첫스폰을 앱 안내만으로 통과할 수 없다

세 개의 무고지 벽. 각각 코드 근거:

### 벽 ① Node.js/npm 부재 (비개발자 하드월)

자동설치와 수동 폴백 모두 `npm install -g …`다. `installNpmGlobal`은 npm 프리플라이트가 있어
없으면 **행동가능 에러**를 던진다: `"npm을 찾을 수 없습니다. Node.js / npm 설치 후 다시 시도하세요. (https://nodejs.org)"`(`harness-manager.ts:422‑427`). 이 텍스트는 게이트의 `installError`로 표시된다
(CliSetupGate.tsx:457‑476). — **긍정**: 무성은 아니고 nodejs.org를 가리킨다. **한계**: 비개발자는
클릭→실패 후에야 이 메시지를 보고, 앱을 떠나 Node.js를 깔고 돌아와 재시도해야 한다. "왜 Node가
필요한지"는 설명 없음. 이탈 유발 우회로.

### 벽 ② BYOK(유료 Claude 계정 필요)가 온보딩 경로에 전혀 없음 — ★최대 갭

- 게이트 부제(ko): **"오케스트레이터를 열려면 먼저 Claude Code 구독 인증(로그인)이 필요합니다"**
  (`locales/ko/onboarding.ts:283‑284`). en: `"Sign in to Claude Code first…"`. → **"로그인"**만 말해
  Marblo 로그인처럼 무료로 읽힌다. "유료 구독"·"API 비용 본인 부담"·"결제" 언급 없음.
- BYOK가 유일하게 평문으로 나오는 곳은 **온보딩 밖**이다: Guide "다음 단계" 마지막 불릿
  `guideContent.tsx:494‑496`("Settings에서 BYOK API 키 등록"), 그리고 Pro 요금제 카드
  `types/payment.ts:251`(`"무제한 에이전트 (BYOK · API 비용 사용자 부담)"`). 둘 다 설치→인증→스폰
  경로에 없다.
- → **신규 유저는 "본인이 돈 내는 Claude 계정이 있어야 한다"는 걸 스폰 실패 전까지 알 방법이 없다.**

### 벽 ③ 무자격 계정이 게이트를 통과한 뒤 무성 스폰사 — ★가장 진단하기 어려운 실패

- §2‑B대로 게이트는 entitlement가 아니라 oauthAccount 존재만 본다. **무료 계정 로그인 → 게이트
  "준비 완료" → 통과.** 이후 첫 스폰에서 claude CLI가 유료 자격 부재로 즉사.
- 그 즉사의 UI는 `agent-manager.ts`의 FAST_FAIL 경로: 2초 내 종료 → `fastFailCount++` → 재시작
  1회 후 중단 → `status:"error"`, 텔레메트리 `agentCrashed(errorCategory="fast_fail_config")`,
  **원문 stderr 미포착**(agent-manager.ts:1111 주석 "원문 stderr 없음"). 행동가능 힌트는
  `console.error`로만 가고 UI엔 죽은 "error" 카드만 남는다(agent-manager.ts:1101‑1135).
  → **유저는 "왜 죽었는지" 모른다.**

**종합**: 앱은 "설치하라/로그인하라"까지는 (모달로) 안내하지만, **"Node.js가 먼저 필요하다"·"유료
Claude 계정이 필요하다"는 두 전제를 인증 시점에 고지하지 않는다.** 비개발자·Claude 무경험자는 바로
이 두 무고지 벽에서 이탈하며, 그 이탈은 텔레메트리에 `cli_auth`(설치/인증 미분해) 또는
`fast_fail_config`(무자격 통과 후)로만 흐릿하게 남는다.

---

## 4. 릴리스 타임라인 — 7/14 이탈 코호트는 게이트를 봤나 (★불확실, 정직 고지)

churn은 7/14 유튜브 유입 22명. 게이트 코드 착지 vs 릴리스 컷:

| 시각(KST)                   | 사건                                                                                 |
| --------------------------- | ------------------------------------------------------------------------------------ |
| 07-11 13:34                 | CliSetupGate 최초 커밋 #368 (`9ad4f12f`)                                             |
| 07-11 13:46                 | 3.0.13 bump                                                                          |
| 07-12 17:00                 | 3.0.14 bump(텔레메트리 기본ON)                                                       |
| **07-14 12:48**             | **게이트 orchestrator-first 재작업 #445 (`281bb138`)** — "auth at launch, not login" |
| 07-14 15:45                 | 다운로드 페이지 v3.0.14                                                              |
| 07-14 17:46 / 18:29 / 18:55 | 3.0.15 / 3.0.16 / 다운로드 페이지 v3.0.16                                            |

- 유튜브 피크는 **7/14 오전~낮**(GA4 당일 103방문). 그 시점 공개 다운로드는 **#445(12:48) 재작업
  이전 빌드(≤3.0.14)**일 개연성이 높다 — 서명·공증·게시 지연 + 다운로드 페이지가 15:45에야 3.0.14로
  이동. 즉 **초기 유입자 상당수는 orchestrator-first 게이트 이전 빌드**를 받았을 수 있다. #368의
  게이트(7/11)가 들어있었더라도 "런치 시점이 아닌 로그인 시점" 구형이라, CliSetupGate 헤더 주석이
  기술한 "안내 없이 보드 도달 → claude 무성 스폰 실패" 경험과 정합.
- **★확증 불가**: 메모리 `telemetry_production_on…`대로 appVersion 폴백버그가 대부분을 `3.0.0`으로
  찍어 **버전 코호팅이 신뢰 불가**하고, 라이브 앱 부착이 금지라 22명 각자가 어떤 빌드를 돌렸는지
  개별 확정 불가. 이건 릴리스 cadence + 코드 착지일로부터의 **추론**이며 그렇게 표기함.
- **함의(긍정)**: 오늘 다운로드하는 유저(3.0.16+/3.0.18)는 churn 코호트보다 나은 경험을 받는다 —
  자동설치 + 원클릭 로그인 모달이 존재하고 막힌 상태가 무성이 아니다. **수리는 부분적으로 이미 배포됨.**
  남은 건 §3의 두 무고지 갭(Node/BYOK)과 §5 계측 세분.

---

## 5. 계측 갭 (다음 테스트/릴리스에 물려야 확정되는 것)

- `orchestrator_blocked`가 `cli_auth` 하나로 뭉쳐 **설치 미비 vs 인증 미비 vs 무자격**을 분해 못 함.
  `probeCliAuth`는 `reason:not-installed|not-authenticated`를 이미 알므로 이벤트 metadata에
  실으면 §3 벽①/②/③를 라이브로 구분 가능(수정 아님, 관찰 제안).
- 벽③(무자격 통과 후 스폰사)은 `fast_fail_config`로만 남고 원문 stderr가 없어 "유료 자격 부재"인지
  다른 런타임 크래시인지 구분 불가(agent-manager.ts:1111).
- 로그인-이전 실패는 auth-gated 싱크라 끝내 로그인 못 한 유저는 전송 안 됨(ixQUBdhx §전송한계) —
  §3 벽①/②에서 죽은 유저의 상당수가 텔레메트리에 안 잡힐 수 있음.

---

## 6. 발견 요약 (★수정 제안 아님, 관찰만)

1. **스폰 실패 = CLI 층 확정, dispatch 층 배제**(게이트가 dispatch 이전에 차단). 사장님 가설 지지.
2. CLI 층 = **설치 + 인증 이중 장벽**, 앱은 둘의 전제(Node.js, 유료 Claude)를 인증 시점에 무고지.
3. **BYOK 무고지가 최대 갭** — 게이트는 "로그인"만 말해 무료처럼 읽힘. 유료 언급은 온보딩 밖(Guide 말단·요금제 카드)에만.
4. **무자격 계정이 게이트 통과 → 첫스폰 무성사**(entitlement 미검사 + stderr 미포착). 가장 진단 어려운 이탈.
5. 리졸버 미설치 시 무성 폴백(행동가능 메시지는 게이트에만). stray ~/.bun 가림은 이미 방어됨.
6. 막힌 화면은 무성이 아니라 모달을 띄움(긍정). npm 부재 시 nodejs.org 안내도 있음(긍정, 단 클릭 후).
7. 7/14 코호트가 구형/무게이트 빌드를 받았을 개연성 높음(추론, appVersion 폴백버그로 확증 불가).

**다음 테스트 연결점**: 2/5(로그인·계정)·3/5(폴더연결)·4/5(첫스폰 크래시 루프)·5/5(가치순간)에서
§5 계측 세분과 벽③ 재현이 이어져야 22→6의 설치/인증/무자격 비중이 수치로 확정된다.
