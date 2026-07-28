# 클린룸 최초실행 QA — 신규 유저 활성화 퍼널 (#579 / #580 / #635~#639)

신규 유저가 앱을 **처음** 켰을 때 온보딩이 실제로 굴러가는지 검증한다.
외부 유저 이탈의 대부분이 이 구간(설치 → 인증 → 폴더 연결 → 첫 티켓)에서
발생했으므로, 재초대·신규모집의 전제 조건이다.

- 자동화: `tests/playwright/cleanroom/` (Playwright + Electron, 격리 실행)
  - `first-run.spec.ts` — 활성화 퍼널(설치·인증·PRD·첫 티켓)
  - `byom-and-orchestrator.spec.ts` — BYOM 스폰 게이트(#638) · grok 오케 MCP(#639)
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
| 벤더 키 env         | 레지스트리 파생 삭제(`vendorEnvSecretKeys` 전량)        | 개발 셸의 `ZAI_API_KEY`·`MINIMAX_API_KEY` 누수 차단(★실측)  |
| 시나리오(설치/인증) | main process IPC 핸들러 교체(`harness:cliAuthCheck` 등) | 결정적 시나리오 — 렌더러→preload→IPC 경로는 진짜 그대로     |

메인 프로세스 판정(스폰 게이트·grok MCP 프로브)은 스텁이 아니라 **앱이 로드한 그
함수**를 그대로 부른다 — `cr.mainCall(<dist-electron 모듈>, <export>, args)` 가
`process.getBuiltinModule("module").createRequire` 로 같은 require 캐시를 탄다.
`cr.callRealIpc(channel, payload)` 는 스텁되지 않은 진짜 IPC 핸들러를 부른다
(렌더러가 받는 payload 를 그대로 관측하기 위한 것).

> ★벤더 키 격리가 왜 필요했나: 처음 B1 을 돌렸을 때 "키 없음" 시나리오가 통과해
> 버렸다. 개발 셸에 `ZAI_API_KEY`·`MINIMAX_API_KEY` 가 실제로 살아 있었고 그게
> 클린룸으로 그대로 상속됐기 때문이다. 삭제 목록을 레지스트리에서 파생시켜
> (손으로 적지 않고) 막았다 — 벤더가 늘어도 이 격리는 저절로 따라간다.

실제 사용자 프로필(`~/Library/Application Support/Marblo`, `~/.claude`)은
읽지도 쓰지도 않는다.

## 3. 시나리오와 결과 (2026-07-28 재검증 — F2·F3·F4 수정 + #638·#639 착지 후, 15/15 통과 · 2.2분)

`tests/playwright/cleanroom/first-run.spec.ts`(활성화 퍼널) +
`byom-and-orchestrator.spec.ts`(BYOM 스폰 게이트 · grok 오케 MCP).

| ID   | 시나리오                                           | 결과                                                                          |
| ---- | -------------------------------------------------- | ----------------------------------------------------------------------------- |
| A    | codex 만 인증 + 재요청(`marblo:open-cli-setup`) ×3 | ✅ 셸 배너·레거시 모달 모두 재노출 없음 (#579 회귀 없음)                      |
| A'   | 아무 CLI 도 없음 + 재요청 (대조군)                 | ✅ 배너·모달 모두 노출 — A 의 탐지력 유지                                     |
| A2   | 인증됐지만 폴더 미연결 유저, 재시작                | ✅ 제목="작업할 폴더를 연결해 주세요" + ✕ 가 재시작 뒤에도 유지 (**F2 닫힘**) |
| B    | 자동설치 실패(노드/npm 부재)                       | ✅ 자동설치 시도됨 + 수동 명령·공식 문서 대안 노출                            |
| C    | "첫 티켓 만들기" → `orchestrator:injectMessage`    | ✅ projectId·프롬프트 원문 도달 + 완료단계=`[install,auth,prd,firstTicket]`   |
| C'   | 로컬 오케 부재 상태에서 같은 버튼                  | ✅ 성공 오표기 없음 + **firstTicket 이 완료로 안 찍힘** (**F3 닫힘**)         |
| E    | 4스텝 안내(왜/막혔을 때) + 인증 대안 경로          | ✅ 안내 존재 + ②단계에 "벤더 키로 시작하기" (**F4 닫힘**)                     |
| D    | 최초부팅 관측                                      | ✅ 시작하기 탭 착지 + 폴더 연결 CTA / ⚠️ 모달 2겹 5.0s (**F5** 그대로)        |
| B1-a | 벤더 키 없음 + 벤더 모델 핀 스폰                   | ✅ `vendor-not-configured` 로 차단, `agent:launch` → `needsAuth.model=zai`    |
| B1-b | 벤더 키만 등록(가짜 값) + 같은 스폰                | ✅ 게이트 통과 / 같은 런의 키 없는 다른 벤더는 여전히 차단 (**#638 확인**)    |
| B1-c | 오케 설정 정규화                                   | ✅ env-swap 핀은 프로바이더로 강등 · `grok` 은 그대로 산다 (**#638(b)**)      |
| B1-d | env-swap 벤더 키만 가진 유저의 ②단계               | ⚠️ "작업 에이전트 전용" — ②를 못 넘긴다 (**F6**, 특성화)                      |
| B2-a | 가짜 grok(마블로 MCP 못 붙음)                      | ✅ 프로브 실패 → 무력 오케 차단 근거 성립                                     |
| B2-b | 진짜 grok(0.2.112) 실기동                          | ✅ `grok mcp doctor` **41 툴** / 0.53s — 오케 최소 표면 9 초과 (**#639**)     |

핵심 증거(로그 원문):

```
[cleanroom][A2] 첫부팅=true 제목="작업할 폴더를 연결해 주세요" 닫은직후=false 재시작후=false
                { legacyDismissed: '1', progress: {... "dismissed":true} }
[cleanroom][C]  완료로 찍힌 단계: [ 'install', 'auth', 'prd', 'firstTicket' ]
[cleanroom][C'] 완료로 찍힌 단계: [ 'install', 'auth', 'prd' ]        ← firstTicket 없음
[cleanroom][B1-a] 핀 없는 claude 게이트: ok=true installed=true authenticated=true
[cleanroom][B1-a] zai 핀 게이트: ok=false reason=vendor-not-configured vendor=zai missing=ZAI_API_KEY
[cleanroom][B1-b] zai(키 있음) ok=true · minimax(키 없음) ok=false
[cleanroom][B2-b] 실기동 프로브: ok=true tools=41 (542ms) · 오케 최소 표면=9
[cleanroom][D]  firstRunModals: ['language','privacy-consent'] · msUntilModalsCleared: 5012
```

> ★B1-a 가 왜 강한 증거인가: **이 맥에는 Anthropic 계정이 살아 있다**(핀 없는
> claude 게이트가 `authenticated=true`). 그런데도 벤더 키가 없다고 스폰이 막혔다면,
> 그 판정은 Anthropic 계정 축이 아니라 **벤더 크레덴셜 축**이다 — #638 이 바꾼
> 바로 그것. F1(키체인 누수)이라는 한계를 역이용한 셈이다.

## 4. 발견된 활성화 장벽 (우선순위)

### ~~F2 (High) — "CLI 인증이 필요합니다" 배너가 사실과 다르고, 영구히 돌아온다~~ ✅ 닫힘 (kG6in9J9)

<details>
<summary>원래 증상과 원인 (수정 완료)</summary>

- 증거: `test-results/cleanroom/A2-banner-after-restart.png`
  — codex 로그인 완료 상태인데 배너 제목은 "CLI 인증이 필요합니다", 본문은
  "작업할 폴더를 연결해야…". 제목과 본문이 서로 다른 말을 한다.
- 재현: 인증 완료 + 폴더 미연결 → 앱을 켤 때마다 배너가 다시 뜬다. ✕ 로 닫아도
  다음 실행에 또 뜬다.
- 원인: `useCliSetupEngine` 의 post-auth 분기가 `shouldShowPostAuthStep(readFlag(
DISMISSED_KEY))` 로 **레거시 키** `marblo.cliSetupGateDismissed` 만 읽는데,
  그 키를 쓰는 코드는 레거시 모달(`CliSetupGate.tsx`)뿐이다. 기본 표면인 셸에는
  그 키를 세우는 경로가 없어 "다시 보지 않기"가 성립하지 않는다.

</details>

**수정 (2026-07-27)**

1. **제목=사실 일치** — 배너 제목이 `needStep` 을 따라간다
   (`onboarding.startHere.banner.title.{install|auth|prd|firstTicket}`).
   인증을 마치고 폴더만 없는 유저는 이제 "작업할 폴더를 연결해 주세요" 를 본다.
2. **dismissed 단일소스화** — "나중에" 는 `onboardingProgress.dismissed` 한 곳에만
   산다. 레거시 키는 콜드스타트 seed 로만 남고, `onboardingProgressStore` 가
   양방향으로 미러링한다(해제 시 삭제 — 낡은 `"1"` 이 되살아나지 못하게).
   레거시 모달의 dismiss 도 이 store 를 거친다 = writer 가 하나다.
3. **배너 ✕ 가 영속화** — 예전엔 로컬 `useState` 만 지웠다. 이제 dismissed 를
   기록하므로 재시작해도 돌아오지 않는다. 되돌리려면 시작하기 탭의
   "앱을 켤 때 이 탭으로 시작하기".
   ※ 엔진이 부르는 `close()`(세션 중 인증 완료)는 사용자 결정이 아니므로
   dismissed 를 쓰지 않는다 — ✕ 만 쓴다.

검증: A2 가 특성화에서 **회귀 가드**로 뒤집혔다 (첫부팅 배너 제목
"작업할 폴더를 연결해 주세요" / 닫은직후 false / 재시작후 false /
`legacyDismissed="1"` + `progress.dismissed=true`). 대조군 A′ 는 여전히
배너·모달 모두 노출 = 탐지력 유지. 유닛: `tests/unit/onboardingDismissal.test.ts`.

### ~~F3 (High) — 첫 티켓 "전달했어요"가 성공을 보장하지 않는다~~ ✅ 닫힘 (#635)

- 원래 결함: `createFirstTicket` 이 `routeInstructionToOrchestrator` 의 `"local"`
  과 `"queued"` 를 **똑같이 성공**으로 표기했다. 큐를 소비할 오케가 없으면 화면만
  초록색이고 아무 일도 일어나지 않는다(무성공 dead-end).
- 수정: 세 결과(delivered/queued/failed)를 `lib/firstTicketDelivery` 순수 함수가
  가른다 — queued 는 **경고(노랑) + 오케 띄우는 법 안내 + 단계 미완료 + 퍼널은
  fail(`orchestrator_not_running`)** 로 계상한다.
- 재검증(2026-07-28): C 는 `firstTicket` 이 완료로 찍히고, C′ 는 **찍히지 않는다**
  (위 §3 로그). 예전엔 이 축 자체가 없었다.
- ★남은 자동화 한계: 이 클린룸이 만들 수 있는 상태는 delivered / failed 둘뿐이다.
  queued 는 "로컬 오케엔 실패 + Firestore 큐 적재는 성공" 인데, 이 하네스는
  `MARBLO_TEST_BYPASS_AUTH` 라 큐 쓰기가 거절돼 failed 로 떨어진다. 분기 규칙은
  유닛(`first-ticket-queued-vs-delivered.test.ts`)이 못박고, **실계정 queued 화면은
  §5 의 C-3 수동 확인**으로 남는다.

### ~~F4 (Medium) — BYOM(벤더 API 키)으로 시작하는 경로가 온보딩에 없다~~ ✅ 닫힘 (#636)

- 수정: ②단계 본문에 `ByomStartSection`("계정이 없나요? 벤더 키로 시작하기")이
  붙었다 — #624 키 등록 화면 딥링크 + #632 벤더 카드 재사용, 목록은 레지스트리 파생.
- 재검증: E 의 기대값이 `false → true` 로 뒤집혔고(특성화 → 회귀가드), 판정은
  여전히 **열린 스텝의 본문**만 본다(탭 하단 `VendorModelsSection` 오탐 방지).
  거기에 제목 문자열("벤더 키로 시작하기")까지 못박아 "벤더" 낱말이 스친 것과
  구분한다.
- ⚠️ 다만 **안내가 생긴 것이지 길이 뚫린 것은 아니다** → 아래 F6.

### F6 (High) — env-swap 벤더 구독만 가진 유저는 여전히 ②단계를 못 넘는다

- 증거: B1-d (`test-results/cleanroom/B1d-byom-worker-only.png`) — `ZAI_API_KEY`
  만 등록한 신규 유저가 ②단계 BYOM 섹션을 펴면 "이 벤더는 아직 **작업 에이전트
  전용**입니다" 가 뜨고, `auth` 단계는 완료로 찍히지 않는다.
- 원인(설계상 정직한 결과): ③④단계는 전부 오케스트레이터를 거치는데, 오케 선택은
  프로젝트별 **영구 저장**이라 조건부 크레덴셜(env-swap)을 얹지 않는다는 확정
  결정이 있다(`normalizeOrchestratorModelSetting` 이 강등 — B1-c 로 확인). 그래서
  `byomGateContribution` 이 기여하는 벤더는 **오케를 태울 수 있는 것뿐**이고,
  GLM/MiniMax/Kimi 는 거기 못 든다.
- 즉 BYOM 으로 실제 활성화까지 가는 길은 현재 **grok(네이티브 CLI, 브라우저 인증)
  하나**다. GLM/Kimi 구독만 가진 해외 유입은 여전히 ②에서 멈춘다.
- 제안(택1): (a) ②단계에서 "오케는 grok/Claude/Codex 중 하나가 필요합니다" 를
  **먼저** 말하고 grok 경로를 1급으로 노출, (b) env-swap 벤더를 오케 후보로
  편입하되 키 소실 시 fail-closed(현재 결정의 재검토 — 별 티켓 필요).
- ⚠️ 문구 정정 필요: `onboarding.byom.headline.workerOnly` 는 "오케스트레이터는
  아직 **Claude·Codex 로만** 뜨므로" 라고 적는데, #638 이후 grok 도 오케다. 유저를
  가장 가까운 탈출구(grok)에서 멀어지게 하는 문구라 우선 고칠 값어치가 있다.

### F5 (Medium) — 최초실행 전면 모달 2겹이 시차를 두고 뜬다

- 언어 선택 → (약 4-5초 뒤) 개인정보 동의. 둘 다 `fixed inset-0` 전면 오버레이라
  그 사이 화면 클릭이 전부 막힌다(자동화도 같은 이유로 클릭이 인터셉트됐다).
- 제안: 동의 판정을 로그인 완료 시점에 붙여 언어 선택 직후 연속으로 띄우거나,
  동의를 비차단 배너로 강등.
- **2026-07-28 재확인: 그대로 열려 있다.** D 관측 =
  `firstRunModals: ['language','privacy-consent']`, `msUntilModalsCleared: 5012`
  (자동화 기준 5.0초 — 사람은 읽고 판단하는 시간이 더 붙는다).

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
- **BYOM 스폰 게이트(#638)** — 벤더 키가 서면 Anthropic 계정 없이 워커 스폰이
  통과하고, 키가 없으면 Anthropic 계정이 있어도 막힌다(부분 주입 금지). 오케
  설정은 env-swap 핀을 강등하고 grok 은 살린다.
- **grok 오케 MCP 게이트(#639)** — 툴이 안 붙는 무력 오케는 스폰 전에 차단되고,
  붙는 환경에서는 41 툴이 실제로 기동된다(0.53s).

## 5. 수동 클린룸 체크리스트 (다른 맥 / 새 macOS 사용자 계정)

> ★여분 맥으로 실기 테스트할 때는 이 절 대신
> **[QA-CLEANROOM-MACBOOKAIR-RUNBOOK.md](./QA-CLEANROOM-MACBOOKAIR-RUNBOOK.md)** 를 쓴다 —
> 실측 기반 제거 명령(claude/codex/grok 설치 경로·키체인), 릴리스 버전 게이트,
> 경로 A(CLI)/경로 B(BYOM) 분기, F2·F3·F4·#638·#639 판정표까지 복붙 가능한 형태로
> 확장한 판이다. 아래는 그 요약본으로 남긴다.

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
8. **F6 확인** — Claude/Codex 계정 없이 벤더 키(GLM 등)만 등록한 상태로 ②단계를
   넘길 수 있는가? 못 넘긴다면 화면이 **다음에 뭘 해야 하는지**(grok 로그인)를
   말해 주는가?
9. **grok 오케 확인 (#639)** — 오케를 grok 으로 골랐을 때 실제로 뜨고, 보드에서
   `dispatch`/티켓 조작이 되는가? (마블로 MCP 툴이 안 붙으면 스폰 자체가 차단돼야
   한다. 자동화 실측: `grok mcp doctor marblo --json` → 41 툴 / 0.53s)
10. 총 소요: 가입 → 첫 티켓 완료까지 몇 분? (목표 30분)

## 6. 유지보수 메모

- 시나리오 축은 `CleanRoomScenario` 로만 바꾼다(설치/인증/자동설치 성패/오케 기동/
  벤더 키 `extraEnv`/실 CLI 경로 `extraPathDirs`).
- 특성화 테스트는 **현재의 결함을 고정**한다. 고쳐지면 기대값을 뒤집고 이 문서의
  해당 F 를 닫아라 — 테스트 주석에도 같은 지시가 있다. 지금까지 뒤집힌 것:
  A2(F2, 2026-07-27) · E(F4, 2026-07-28). 남아 있는 특성화: **B1-d(F6)**.
- 벤더 id·모델 id 는 테스트에 리터럴로 적지 않는다 — `MODEL_REGISTRY` 파생
  (`twoDistinctVendorModels`)이라 벤더가 늘어도 시나리오가 따라간다.
- B2-b(진짜 grok 실기동)는 머신에 `grok` 이 없으면 자동 skip 된다. skip 이
  녹색으로 보이므로, CI 결과를 읽을 땐 skip 개수를 함께 본다.
- 셸(기본) / 레거시 Layout 두 표면이 공존하는 동안은 두 경로 모두 검증한다
  (`switchToLegacyLayout`).
