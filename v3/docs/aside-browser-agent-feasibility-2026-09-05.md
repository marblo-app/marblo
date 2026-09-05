판정: ★자체 구축은 "지금은 아니다". 우리가 가진 것과 Aside 사이의 간극은 **브라우저 기술이 아니라 승인 계층**이고, 우리 에이전트는 전원 YOLO(`--dangerously-skip-permissions`)로 돈다. 승인 계층 없이 살아 있는 로그인 세션에 자동 행동을 붙이는 것은 기능이 아니라 사고 경로다. 대신 **수요를 먼저 계측하는 0.5일짜리 첫 수(하네스 카탈로그에 Aside MCP 등재)** 를 권한다.

# Aside 류 AI 자동 브라우징 — 우리 웹탭에서 구현 가능한가

작성일: 2026-09-05 KST
티켓: `vJqIXvmeisTj1znKMXVb`
범위: Aside의 공식 제품·문서·벤더 발행 실행 아티팩트와 현재 Marblo 코드 기준. **코드 변경 0.** `v3/src`·`v3/electron` 무변경, Electron/GUI 실행 없음.

---

## 1. ★위험과 권한 경계 — 이 절이 설계의 첫 절이다

이 절을 먼저 쓰는 이유는 형식이 아니다. 아래 세 사실이 동시에 참이기 때문이다.

| #   | 사실                                                                                                                                                                       | 근거(파일:줄)                                                                                                                                                                                       |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| ①   | 인앱 웹탭은 **디스크에 남는 세션**으로 돈다. `persist:` 접두사가 붙은 파티션은 앱을 꺼도 쿠키·localStorage 가 살아 있다 → 사장님의 구글/노션/대시보드 로그인이 그대로 있다 | `v3/electron/in-app-browser-policy.ts:1` (`persist:marblo-browser-tab`), `v3/electron/main.ts:6314` (pane 생성 시 주입), `main.ts:6056` (렌더러에 보고되는 security 필드)                           |
| ②   | 우리 에이전트는 **전원 승인 없이** 돈다. 하네스 자체의 "정말 실행할까요?" 확인이 꺼져 있다                                                                                 | `v3/electron/bridge-server.ts:1037` ("every agent/orchestrator runs YOLO (--dangerously-skip-permissions"), `v3/electron/agent-config.ts:4104`, `v3/electron/telegram-channels.ts:36` (`YOLO_FLAG`) |
| ③   | 지금 있는 유일한 방어는 **PTY stdin 문자열 패턴 매칭**이다. 브라우저 클릭에는 닿지 않는다                                                                                  | `v3/electron/danger-command.ts` (순수 함수, 파괴적 셸 명령 탐지), 소비처는 `pty-manager.ts:6` 하나                                                                                                  |

①+②+③을 합치면 결론은 하나다. **오늘 상태에서 "웹탭을 AI 가 조작한다"를 켜면, 승인 없는 에이전트가 사장님의 실제 로그인으로 돈을 쓰고 글을 올리고 데이터를 지울 수 있다.** 그리고 그것을 막을 계층이 코드에 존재하지 않는다. Aside 는 이 문제를 우리보다 먼저 알았고, 제품의 절반을 거기에 썼다(§2.3).

### 1.1 무엇을 허용하고 무엇을 승인받는가 (제안 기준선)

구현하기로 결정한다면 아래를 **먼저** 만들고 그 다음에 능력을 붙인다. 순서가 반대면 문서가 위험해진다.

| 등급               | 행위                                            | 기본값                                                           | 근거                                                                                                                                                            |
| ------------------ | ----------------------------------------------- | ---------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| R (관찰)           | 현재 페이지의 텍스트·접근성 트리 읽기, 스크린샷 | **허용 가능** — 단 origin allowlist + 원문 마스킹                | 되돌릴 수 있다. 유출 위험은 남으므로 §1.2                                                                                                                       |
| N (이동)           | 같은 origin 안에서의 링크 이동, 뒤로가기        | 허용 가능                                                        | 부작용 없음. 단 이동만으로 상태가 바뀌는 URL(`?delete=1`)이 있으므로 GET 이 안전하다는 가정은 금지                                                              |
| W (쓰기)           | 클릭, 입력, 폼 제출                             | **건별 승인**                                                    | 여기서부터 되돌릴 수 없다                                                                                                                                       |
| $ (지불·발신·삭제) | 결제, 게시·전송, 삭제, 권한 변경                | **항상 사람 승인. 자동 허용 옵션을 만들지 않는다**               | 승인 피로가 생기면 "전부 허용" 스위치가 생기고, 그 스위치가 사고다                                                                                              |
| X (인증)           | 로그인 화면, OAuth, 결제 페이지                 | **에이전트 진입 금지** — 기존 라우팅 규칙이 이미 밖으로 내보낸다 | `in-app-browser-policy.ts` `classifyInAppBrowserNavigation()` 이 `google-auth`/`auth`/`payment` 를 `external` 로 분류. 자동화도 같은 분류를 **재사용**해야 한다 |

정지 장치 3개는 능력보다 먼저 있어야 한다.

1. **전역 킬 스위치** — 실행 중 자동화를 한 번에 멈춘다. 기존 `kill_agent` 툴이 프로세스는 죽이지만, WebContentsView 안의 진행 중 행동에는 닿지 않는다. 별도로 필요하다.
2. **스텝 상한** — Aside 도 `200-step maximum trajectory budget` 로 자른다(§2.4). 무한 루프는 비용이자 사고다.
3. **감사 원장** — 무엇을 어느 origin 에서 언제 눌렀는지가 남지 않으면 사후에 피해 범위를 알 수 없다.

### 1.2 읽기조차 공짜가 아니다 — 두 번째 위험

에이전트가 사장님의 로그인된 페이지를 **읽어서 LLM 에 보내는 것** 자체가 데이터 반출이다. 다행히 우리 트리에는 이걸 위해 만든 모듈이 이미 있다.

- `v3/electron/web-automation/leakage-guards.ts` — `assertPromptSnapshotIsSafe()` 가 프롬프트 스냅샷에 쿠키/storageState/헤더/응답본문/hidden DOM 이 섞여 들어가면 **던진다**. `redactBrowserSessionValue()` 는 로그·텔레메트리용 마스킹.
- 같은 파일의 `BROWSER_SESSION_LEAKAGE_GUARDS` 는 유출 경로 6개(logs·telemetry·crash_dumps·agent_prompts·ipc·temp_files)를 각각 무엇이 막는지 문자열로 고정해 놨다.

즉 **읽기 경로를 만들 때 새로 설계할 게 아니라 이 가드를 통과시키면 된다.** 이건 우리가 남보다 앞선 몇 안 되는 지점이다.

### 1.3 프롬프트 인젝션 — 위험 등급이 다르다

일반 브라우저 에이전트의 프롬프트 인젝션은 "이상한 답을 한다"로 끝난다. 우리 경우는 다르다. 에이전트가 **MCP 로 티켓을 만들고 물리 에이전트를 스폰하고 텔레그램을 보낼 수 있다**(`spawn_agent`, `create_task`, `send_telegram_message`, `dispatch_task`). 웹페이지가 심은 문장 하나가 그 툴 표면에 닿으면 피해가 브라우저 밖으로 나간다. 웹 본문은 **반드시 데이터로 봉인**해야 하고(gstack `/browse` 가 `BEGIN UNTRUSTED EXTERNAL CONTENT` 마커로 하는 것과 같은 방식), 그 봉인은 관례가 아니라 코드여야 한다.

---

## 2. Aside 가 실제로 무엇인가 — 1차 자료

### 2.1 자료 등급 표기

| 출처                                                            | 등급                             | 비고                                                 |
| --------------------------------------------------------------- | -------------------------------- | ---------------------------------------------------- |
| `https://aside.com` (= `https://asidebrowser.com`, 동일 콘텐츠) | **1차(공식 마케팅)**             | 법인 표기 "© 2026 Aside Computer Inc.", YC 배출 표기 |
| `https://docs.aside.com` (`/llms.txt` 인덱스 18페이지)          | **1차(공식 문서)**               | 권한 모델·CLI/MCP 는 여기서 인용                     |
| `https://github.com/at-inc/aside-benchmarks` (MIT)              | **1차(벤더 자체 발행 아티팩트)** | 실행 결과 JSON 포함. 단 **벤더 자기 실행분만** 있음  |
| 랜딩의 경쟁사 비교 막대                                         | **출처 미표기 마케팅 주장**      | 아래 §2.4 에서 분리해 다룸                           |

이 문서는 공식 사이트·공식 문서·벤더가 발행한 실행 아티팩트만 제품 사실의 근거로 삼는다. `aside.ai`는 매물 도메인이고 `aside.dev`는 무관한 Chrome 확장 프로젝트이므로 근거로 사용하지 않는다. **동명이인 3개를 구분해야 한다.**

### 2.2 제품 정의 (공식 문서 원문)

> "Aside is an AI browser that gets complex work done across your websites, accounts, and history." — `docs.aside.com/index.md`

> "Aside is a browser rebuilt for people and agents. It works across your logged-in websites and handles complex work other agents can't: messages, payments, internal tools, and everything in between." — `aside.com` 랜딩

핵심 포지션은 **통합(API 커넥터)이 아니라 로그인된 웹 그 자체를 쓴다**는 것이다. 랜딩 문구: "Unlike other AI agents that rely on integrations, Aside just uses websites and accounts directly, just like you do."

### 2.3 권한·승인 모델 (공식 문서 — 우리가 베낄 값어치가 있는 부분)

`docs.aside.com/help/security.md`:

| 축             | 값                                                                                                  |
| -------------- | --------------------------------------------------------------------------------------------------- |
| 세션 권한 모드 | `Read only` / `Guard`(**신규 태스크 기본값**) / `Full access`                                       |
| 툴 규칙        | `Allow` / `Ask` / `Deny` — **Deny 가 ask·allow 를 이긴다**                                          |
| 계층           | 에이전트 기본값(Settings>Agents) 위에 태스크별 세션 설정을 덮어씀                                   |
| 파일           | 폴더 단위 view/edit allowlist + OS 샌드박스 토글                                                    |
| 비밀번호       | 값은 에이전트에게 **노출하지 않고** 사이트에 autofill. 정책·대상 URL 을 확인한 뒤 payload 를 만든다 |

랜딩에는 "Human approval at the edge — Sensitive actions like payments, posts, and messages always wait for your confirmation" 이라고 쓰여 있다. **문서 쪽에서 이 문장에 대응하는 행위별 승인 규칙표는 찾지 못했다** — `security.md` 의 Allow/Ask/Deny 는 툴 단위이고 "결제/게시/메시지"라는 행위 분류를 명시한 페이지는 인덱스 18개 중 없다. 그래서 이 항목은 **마케팅 주장으로 표기**한다. (우리 §1.1 의 `$` 등급은 이 아이디어를 빌리되 근거는 우리 판단이다.)

기본값이 `Guard`(=물어본다)라는 점은 그대로 눈여겨볼 만하다. 우리 기본값은 YOLO 다.

### 2.4 성능 주장 — 무엇이 검증 가능하고 무엇이 아닌가

아래 수치는 출처의 성격에 따라 나눈다. 벤더 레포의 실행 JSON은 Aside가 자기 환경에서 얻은 결과이고, 랜딩의 비교 막대는 대응 아티팩트가 없는 마케팅 주장이다.

**(a) 벤더 레포에 실행 아티팩트가 있는 것 — 검증 가능한 "Aside 자기 기록"**

| 벤치마크                    | 결과                                                    | 실행 구성                                                                            |
| --------------------------- | ------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| Online-Mind2Web (300 tasks) | 297 pass / 2 fail / 1 impossible = **99.0%**            | model `gpt-5.5`, provider `openai-codex`, thinking high, fast mode, grader `gpt-5.4` |
| Odysseys (200 tasks)        | perfect **151/200 (75.5%)**, rubric 1,050/1,182 (88.8%) | `gpt-5.5`/`openai-codex`, grader `gemini-3.1-flash-lite`, 200-step 상한              |
| BU Bench V1 (100 tasks)     | `gpt-5.5` **93/100**, `kimi-k2.6` 88/100                | thinking high, fast mode, concurrency 6                                              |

**(b) 랜딩 비교 막대 — 대응 아티팩트 없음**

랜딩은 `Aside 99.0% / Browser Use 97.7% / GPT-5.4 92.8% / Claude Opus 4.8 84.0% / ChatGPT Atlas 70.0%` 로 그린다. **레포에는 Aside 자기 실행분만 있고 나머지 넷의 실행 기록이 없다.** 출처 표기도 없다. 이 문서에서는 인용하되 "검증되지 않은 마케팅 주장" 이상으로 쓰지 않는다.

**(c) 가장 중요한 한 줄** — Aside 의 SOTA 실행은 `gpt-5.5` via `openai-codex` 다. 즉 **Aside 는 모델이 아니라 하네스**다. 가격 페이지도 "Bring your own subscription / Use your ChatGPT or Claude subscriptions, or bring your own API key" 라고 쓴다. → 우리가 마주한 격차는 모델 격차가 아니라 **루프·권한·UX 격차**다. 이건 좋은 소식이면서 동시에 "그 루프를 우리가 처음부터 짜야 한다"는 뜻이다.

### 2.5 가격 (공식)

Free $0(500 credits/월, routine 3개) · Pro $20/월(Ultrabrowse, 무제한 routine, 원격 제어 채널, 클라우드 핸드오프) · Max $200/월 · Enterprise 문의(공유 회사 계정으로 에이전트 운영, 시트·감사·공유 프로필).

### 2.6 ★가장 실무적인 발견 — Aside 는 MCP 서버를 판다

`docs.aside.com/help/developers.md`:

```
curl -fsSL https://releases.aside.com/install.sh | bash
aside "Open localhost:3000 and run a smoke test"
aside mcp                     # ← MCP 서버로 다른 에이전트/코딩툴에 붙는다
aside repl "const p = await openTab('https://example.com')"
```

`mcp.json` 예시까지 문서에 있다. **우리 하네스 카탈로그가 정확히 이 형태를 소비한다**(§3.4). 따라서 §6의 첫 권고는 자체 브라우저 구현이 아니라 Aside MCP를 한 항목으로 연결해 수요를 계측하는 것이다.

---

## 3. 우리가 이미 가진 것 — 파일·기능 단위

제로에서 시작하지 않는다. 다만 **가진 것의 성격이 남과 다르다**는 점이 판단의 핵심이다.

### 3.1 인앱 웹탭 — 표면은 있다, 조작 API 는 없다

| 조각        | 파일                                                                                                                                                                                  | 상태                                                                                                                                          |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| 웹탭 화면   | `v3/src/components/workspace/BrowserTab.tsx` → `LayoutView` → `PaneGroup` → `BrowserPane.tsx`                                                                                         | 살아 있음. #477 에서 만들어졌다가 아무도 마운트하지 않아 죽어 있던 것을 티켓 `pmpcvaEsswlsOLJDwer6` 가 되살림                                 |
| 네이티브 뷰 | `v3/electron/main.ts:6299` `createBrowserPaneRecord()` — `new WebContentsView({ nodeIntegration:false, contextIsolation:true, sandbox:true, partition: persist:marblo-browser-tab })` | 살아 있음                                                                                                                                     |
| 좌표 보정   | `v3/electron/browser-pane-bounds.ts` (+ PR #1418)                                                                                                                                     | 머지됨 — `7098a37b fix: align web tab native view bounds (#1418)`                                                                             |
| 링크 라우팅 | `v3/electron/in-app-browser-policy.ts` (+ PR #1413)                                                                                                                                   | 머지됨 — `4f824681 fix(webtab): 링크의 주인을 창 단위로 …(#1413)`. 규범은 `docs/wiki/20-constraints/in-app-link-routing.md`                   |
| 렌더러 API  | `v3/electron/preload.ts:227-299`                                                                                                                                                      | **7개뿐**: `openExternal` `attach` `navigate` `reload` `setBounds` `release` `registerOpenTarget` + 이벤트 `onOpenUrl`/`ackOpenUrl`/`onState` |
| main IPC    | `main.ts:10133-10272`                                                                                                                                                                 | 위 7개와 1:1                                                                                                                                  |

★**여기가 간극의 핵심이다.** 이 표면에는 페이지를 **읽는** 함수도, **누르는** 함수도 없다. 검증: `grep -n "executeJavaScript" v3/electron/main.ts` → **0건**. 즉 웹탭은 "보여주는 창"이지 "다룰 수 있는 창"이 아니다.

### 3.2 브라우저 자동화 하부구조 — ★이미 만들어져 있고, 아무도 안 쓴다

`v3/electron/web-automation/` (1,595줄, 8파일). 티켓 `DHkrzbdAWAcBm4thGI4H` 의 "녹화-재생 R3" 산출물.

| 파일                               | 무엇                                                                                                                                                                                                            |
| ---------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `browser-session-manager.ts`       | Playwright `channel:"chrome"` 고정 기동. Edge/Brave 자동 폴백 **안 함**. Chrome 없으면 `NEEDS_BROWSER_INSTALL` 로 멈추고 사람을 부름                                                                            |
| `browser-session-store.ts`         | `safeStorage` 암호화 세션 보관. 만료·검증시각·연속 인증실패 카운트                                                                                                                                              |
| `types.ts`                         | `BrowserSessionHumanActionReason` 8종 — `MFA_REQUIRED` `CAPTCHA_REQUIRED` `AUTH_GATE_DETECTED` `CONSECUTIVE_AUTH_FAILURES` … **사람 호출 사유가 이미 타입으로 열거되어 있다**                                   |
| `leakage-guards.ts`                | §1.2                                                                                                                                                                                                            |
| `intent-script.ts`                 | 의도 스크립트 스키마 v1.0 — step kind `goto/fill/select/click/check/waitFor/assert/handoff/extract`, target 힌트(css·xpath·attrs·text·nearbyText), `onResolveFail: escalate\|skip\|abort`, 결과 검증(`outcome`) |
| `recorder.ts` / `recorder-hook.ts` | CDP 로 페이지에 훅을 심어 사람의 조작을 의도 스크립트로 녹화. `sensitiveValue` 플래그 있음                                                                                                                      |

배관 상태:

- main IPC 6개 존재 — `main.ts:7962-8040` (`webAutomation:chromeProbe` / `sessions:list` / `delete` / `launchStored` / `close` / `leakageGuards`)
- preload 노출됨 — `preload.ts:1263-1277`
- **렌더러에서 쓰는 곳: 0.** `grep -rn "webAutomation" v3 --include=*.ts --include=*.tsx` → `main.ts`·`preload.ts` **두 파일뿐**. UI 도 MCP 툴도 없다.

즉 우리는 "브라우저 자동화 엔진의 아랫도리"를 이미 갖고 있고 화면과 에이전트에 연결하지 않았다. 이게 §6 의 비용을 크게 낮춘다.

★주의: 관련 실측 문서 `v3/docs/record-replay-browser-runtime-measurement-2026-08-28.md` 는 좋은 수치(Chrome `channel` launch 497ms, full Chromium 번들 +341MB 등)를 담고 있지만 한 줄이 **낡았다** — "BrowserPane.tsx 는 `<iframe sandbox=…>`" 는 그 시점 기준이고, 지금은 WebContentsView 다. 그 문서를 다시 읽는 사람은 이 정정을 먼저 봐야 한다.

### 3.3 판단 루프·에이전트 체계 — 여기는 오히려 우리가 앞선다

- 오케스트레이터 + 물리 에이전트 스폰(`agent-manager.ts`, `bridge-server.ts`, `spawn_agent`)
- MCP 툴 표면 ~60종(`v3/electron/mcp-server/tools.ts`) — 티켓 CRUD, `dispatch_task`, `run_skill`, `ask_orchestrator`, `escalate_to_owner`, `answer_question`
- **사람 승인 채널이 이미 존재한다** — `escalate_to_owner` → 텔레그램/슬랙 → 사장님 답변이 오케 PTY 로 주입(`owner-inbound.ts`, `assistant-trigger-delivery.ts`). 브라우저 행동 승인은 **이 배관을 재사용하면 된다. 새로 만들 필요가 없다.**
- 정기 실행(= Aside 의 `routines`) 대응물: `assistant-triggers.ts` (캘린더·Gmail·Sheets 트리거 + 배달 실패 로그)
- 워커 모델 라우팅·비용 추적: `agent-config.ts`, `cost-tracker.ts`

### 3.4 하네스 카탈로그 — 외부 MCP 를 한 항목으로 꽂는 자리

`v3/electron/harness-catalog.ts:312-325` 의 playwright 항목이 형태를 보여준다.

```ts
{ id: "mcp-playwright", name: "playwright (브라우저 자동화)",
  type: "mcp", category: "mcp",
  install: { kind: "mcp", source: "npx", args: ["-y", "@playwright/mcp@latest"] },
  detect: { mcpKey: "playwright" }, url: "https://github.com/microsoft/playwright-mcp" }
```

그리고 `agent-config.ts:2316` 의 역할별 화이트리스트에 **frontend·test 역할은 이미 `playwright` 를 받고 있다.** 즉 우리 워커는 오늘도 헤드리스 브라우저로 페이지를 열고 클릭할 수 있다 — 다만 **사장님 로그인 세션 없이, 공개 페이지에 한해서.**

### 3.5 에이전트가 "문서를 읽는" 경로는 이미 브라우저가 아니다

MCP 툴 목록에 `drive_search` / `drive_fetch` / `drive_write` / `notion_search` / `notion_fetch` / `notion_write` / `gmail_search` / `gmail_fetch` / `gmail_send` / `calendar_list` / `wiki_query` 가 있다. 반면 **범용 `web_fetch` 계열 툴은 없다.**

이건 우연이 아니라 설계다. 우리 에이전트가 실제로 읽어야 하는 것(설계문서·티켓·위키·메일·일정)은 전부 **API 가 있는 곳**에 있고, API 경로가 브라우저 조작보다 싸고 정확하고 안전하다. §5 판단의 근거 절반이 여기서 나온다.

---

## 4. 간극 목록

| 능력                               | 우리 상태                                                                                                                    | 근거                                                    | 간극                                                                               |
| ---------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| **페이지 관찰 (DOM/AX 읽기)**      | 인앱 탭: **없음**(IPC 0개, `executeJavaScript` 0건). 별도 Playwright 경로: 워커가 `playwright` MCP 로 **공개 페이지만** 가능 | `preload.ts:227-299`, `harness-catalog.ts:313`          | 사장님 로그인 세션이 붙은 페이지를 읽는 경로가 없다                                |
| **행동 (클릭·입력·제출)**          | 인앱 탭: **없음**. 의도 스크립트 스키마는 있으나 실행기 미배선                                                               | `intent-script.ts`(스키마만), `web-automation` 소비처 0 | 실행기 + 셀렉터 해소 + 실패 처리 전부 없음                                         |
| **판단 루프(관찰→결정→행동→검증)** | 에이전트 루프는 있으나 **입력이 터미널/파일**이다. 페이지 상태를 관측값으로 받는 경로가 없다                                 | `agent-manager.ts`, `mcp-server/tools.ts`               | 루프 자체는 재사용 가능. 관측 입력만 없다                                          |
| **중단 장치**                      | `kill_agent`(프로세스), `agent-watchdog.ts`, `danger-command.ts`(PTY 문자열)                                                 | `tools.ts`, `pty-manager.ts:6`                          | ★브라우저 행동에 닿는 정지 장치 0. 스텝 상한 0                                     |
| **권한 경계**                      | 라우팅 분류(`allow/external/deny`)는 있음. **에이전트 행동 권한은 0** — 전원 YOLO                                            | `in-app-browser-policy.ts`, `bridge-server.ts:1037`     | Aside 의 Read only/Guard/Full access · Allow/Ask/Deny 에 대응하는 것이 하나도 없다 |
| **세션 격리**                      | `persist:marblo-browser-tab` 단일 파티션. 태스크별 격리·incognito 없음                                                       | `in-app-browser-policy.ts:1`                            | Aside 는 태스크별 `Incognito` 모드를 제공                                          |
| **비밀 취급**                      | `safeStorage` 암호 보관 + 유출 가드 6경로                                                                                    | `browser-session-store.ts`, `leakage-guards.ts`         | ★여기는 있다. 오히려 강점                                                          |
| **사람 호출(handoff)**             | 사유 8종 타입 + 오케↔사장님 승인 채널 배관                                                                                   | `types.ts`, `owner-inbound.ts`                          | ★여기도 있다. 브라우저 쪽 트리거만 없다                                            |
| **감사 원장**                      | 티켓/작업체인 원장은 있음(`ledger*.ts`, `work-chain*.ts`)                                                                    |                                                         | 브라우저 행동 단위 원장 없음                                                       |

한 줄로: **아래(세션·비밀·핸드오프)와 위(에이전트 루프·승인 채널)는 있고, 가운데(관찰·행동·권한 게이트)가 통째로 비어 있다.**

---

## 5. 우리 제품에 값을 하는가

기준은 "핫한가"가 아니다. **에이전트가 문서를 읽고 대시보드를 확인하는 실제 워크플로우가 우리 안에 있는가**이다.

### 5.1 후보 워크플로우를 하나씩 떨어뜨려 본다

| 후보                                                                                | 이미 되는가                                                                | 판정                                               |
| ----------------------------------------------------------------------------------- | -------------------------------------------------------------------------- | -------------------------------------------------- |
| 설계문서·위키·티켓 읽기                                                             | `drive_fetch` `notion_fetch` `wiki_query`                                  | ❌ 브라우저 불필요                                 |
| 메일·일정 확인                                                                      | `gmail_*` `calendar_*`                                                     | ❌ 불필요                                          |
| PR·CI 상태 확인                                                                     | `github` MCP + `gh` CLI                                                    | ❌ 불필요                                          |
| 공개 웹 조사·경쟁사 가격                                                            | `playwright` MCP (frontend/test 역할 기본 지급)                            | ❌ 이미 있다                                       |
| 우리 앱 QA·스모크                                                                   | `playwright` MCP + gstack `/browse`                                        | ❌ 이미 있다                                       |
| **로그인 필요한 콘솔 확인** (Firebase Console, GA4 UI, Cloud Run, 스토어 심사 상태) | API 가 있는 것도 있지만(GA4 Data API) 실제로 사장님이 보는 화면은 콘솔이다 | ⚠️ **유일하게 남는 진짜 갈증**                     |
| 결제·구독 대시보드 조작                                                             | —                                                                          | ⛔ 값어치 있으나 돈을 만진다. **첫 대상으로 최악** |

즉 실제 갈증은 **한 칸**이다: _로그인이 필요해서 지금은 사장님만 볼 수 있는 화면을, 에이전트가 읽어서 보고하게 하는 것._ 그리고 그건 **읽기**다. 조작이 아니다.

### 5.2 우리는 범용 브라우저가 아니다

Aside 는 브라우저를 판다. 사용자가 하루 8시간 그 안에 산다. 우리는 **AI 팀 운영 control plane** 이다. 사장님이 Marblo 를 여는 이유는 웹서핑이 아니라 보드·에이전트·터미널이다. Aside 의 "unlimited capability(뭐든 시켜라)"는 우리 제품 명제와 맞지 않는다. 우리에게 맞는 건 "**에이전트가 일하다 막혔을 때, 로그인 뒤에 있는 화면 한 장을 스스로 확인한다**"이다.

### 5.3 운영 제약이 형태를 이미 결정해 놨다

`docs/wiki/20-constraints/no-live-gui-verify.md`(status: verified) — 사장님이 앱을 쓰는 동안 에이전트가 창을 띄우면 그건 제품이 아니라 방해다. 2026-08-24 실측 1회, 오케가 돌리던 `playwright test` 를 강제 종료했다.

이 제약은 **"AI 가 당신이 보고 있는 탭을 대신 조작합니다"라는 Aside 형 UX 를 우리 앱에서는 그대로 못 쓴다**는 뜻이다. 우리 쪽 형태는 **화면 밖에서(헤드리스/오프스크린) 돌고, 결과만 보드에 올라오는 것**이어야 한다.

### 5.4 기각 원장 확인 — DNR-02 는 낡았다, 그리고 그 사실을 적어 둔다

`docs/wiki/_meta/do-not-retry.md` 의 `DNR-02`: "WebContentsView 로 격리 브라우저 표면 — 2026-08-24 기각. **트리에 구현 없음.** … `M1`(라이브 사용자 간섭)".

그 기각의 사실 근거("코드 검색 0건")는 **지금 참이 아니다.** #1413·#1418 이 머지되어 WebContentsView 웹탭이 트리에 있고 화면에 뜬다. 다만 해금 조건인 `M1`(전용 검증기 또는 `ask_orchestrator` 로 잡은 실화면)은 **여전히 유효**하고, 그것이 §5.3 의 "헤드리스로 가라"와 같은 결론을 낸다. → 위키 갱신은 이 티켓의 범위가 아니므로 §8 에 판단 항목으로 올린다.

### 5.5 판정

**자체 구축(Aside 같은 자율 브라우징): 지금은 아니다.**

세 줄 근거.

1. 실제 갈증이 **한 칸**(로그인 뒤 화면 읽기)이고, 그것은 자율 브라우징이 아니라 읽기 툴 하나면 된다.
2. 간극의 본질이 브라우저 기술이 아니라 **승인 계층**인데, 우리 에이전트는 전원 YOLO 다. 능력을 권한보다 먼저 붙이는 순서는 사고를 만든다.
3. Aside 는 이미 **MCP 서버를 판다**(§2.6). 우리 하네스 카탈로그는 그걸 한 항목으로 먹는다. 직접 짓기 전에 붙여 보고 수요를 재는 게 압도적으로 싸다.

---

## 6. 만든다면 가장 작은 첫 모양 — 3안과 비용

### 0안 (권장) — 하네스 카탈로그에 Aside MCP 를 얹고 수요를 계측한다

무엇: `harness-catalog.ts` 에 항목 1개 추가(`aside mcp`), 필요 시 역할 화이트리스트 1줄, 단위테스트 1개. UI 는 기존 하네스탭이 그대로 그린다.

왜: 코드 위험 ~0, 되돌리기 1커밋. **"에이전트가 로그인 뒤 화면을 봐야 하는 일이 한 달에 몇 번 생기는가"를 실측**할 수 있다. 0건이면 이 주제는 끝난다. 3건 이상이면 1안의 근거가 생긴다.

★단, **이건 우리 앱 안에서 도는 게 아니다.** Aside 는 별도 앱이고 별도 브라우저이며 사장님 자격증명이 Aside 로 간다. 그 신뢰 판단은 §8 에 올린다.

- 엔지니어링 비용: **0.5일**
- 운영 비용: Aside Free $0 (Pro 필요 시 $20/월). 모델 토큰은 BYO — 우리가 이미 내는 것
- ★백로그 중첩: 이건 사실상 `1wN4RQYqfAyNzwFQQ0aA`(스킬·MCP 스토어)의 축소판이다. 그 티켓의 첫 사례로 쓰면 두 개가 하나로 붙는다

### 1안 — `web_read`: 읽기 전용 관찰 MCP 툴 하나 (자체 구축의 최소 단위)

무엇: 에이전트가 **읽기만** 하는 툴 1개. 클릭·입력 없음.

```
web_read(url, origin) -> { title, url, text, ax_tree_digest }
```

배관(전부 기존 조각 재사용):

1. `web-automation/browser-session-manager.ts` 의 `launchStoredSession()` 로 **헤드리스** Chrome 컨텍스트를 연다 → 사장님 창을 건드리지 않는다(`[[no-live-gui-verify]]` 준수). 인앱 `persist` 파티션은 **쓰지 않는다** — 살아 있는 세션과 자동화 세션을 분리하는 것이 §1 의 핵심
2. 페이지 텍스트/접근성 트리를 뽑아 `assertPromptSnapshotIsSafe()` 를 **통과시켜서만** 반환
3. origin allowlist(초기값: 사장님이 지정한 2~3개 콘솔). 목록 밖은 `escalate_to_owner` 로 승인 요청
4. 반환 본문은 **untrusted 봉인**(§1.3)
5. 감사: 호출마다 origin·시각·바이트수만 원장에 기록(본문은 남기지 않는다)
6. 검증은 vitest 단위/순수함수만 — 창을 띄우지 않는다

작업량: main IPC 1 + preload 1 + MCP 툴 1 + 브리지 배관 1 + allowlist 정책 + 원장 + 테스트.

- 엔지니어링 비용: **3~5 엔지니어-일**
- 실행 토큰 비용(추정, 2026-06-24 가격표 기준 — Opus 5 $5/$25 per MTok, Sonnet 5 $2/$10):
  - 페이지 1장 읽고 요약 1회 ≈ 입력 10k + 출력 1k → Opus 5 **약 $0.08/회**, Sonnet 5 **약 $0.03/회**
  - 하루 20회 × 30일: Opus 5 **월 $45 내외**, Sonnet 5 **월 $18 내외**
  - ★가정: AX 트리 스냅샷 8k 토큰(대시보드 1장 기준), 캐싱 미적용. 실제 페이지에 따라 3~15k 로 흔들린다. 이 수치는 **추정이며 실측이 아니다**

### 2안 — 행동(클릭·입력)까지: **지금은 하지 않는다**

필요한 것: 승인 게이트 3등급 + 전역 킬 스위치 + 스텝 상한 + 행동 단위 감사 원장 + 태스크별 세션 격리 + 셀렉터 해소 실패 처리 + 승인 UI. `intent-script.ts` 스키마가 이미 `onResolveFail: escalate|skip|abort` 를 정의해 둔 건 도움이 되지만 실행기는 전부 새로 짜야 한다.

- 엔지니어링 비용: **2~3주 + 상시 운영 부담**
- 실행 토큰 비용(추정): 20스텝 태스크 1회 ≈ 누적 입력 1.2M / 출력 20k → Opus 5 **캐싱 없이 약 $6~7**, 프롬프트 캐싱 적용 시 **약 $1~1.5**. 태스크 실패 재시도까지 넣으면 곱하기 2를 잡아야 한다
- 판정: **§1 의 승인 계층이 먼저 서기 전에는 착수 금지.** 순서를 바꾸면 이 문서의 §1 이 무의미해진다

---

## 7. 기존 백로그와의 중첩

| 티켓                                                | 중첩                                                                                                                                                               | 판정                                                                                       |
| --------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------ |
| `O9s9g4NAdnUZ3GOujvC2` — 모든 탭 새 창 분리(detach) | **거의 없음.** 다만 pane 주소가 `ownerWebContentsId:paneId`(`main.ts:6048` `browserPaneKey`)라 창을 분리하면 "어느 창의 어느 pane"이 자동화 대상 주소로 필요해진다 | 충돌 아님. 1안이 헤드리스 경로라면 아예 안 만난다                                          |
| `1wN4RQYqfAyNzwFQQ0aA` — 스킬·MCP 스토어            | **직접 중첩.** 0안은 이 티켓이 설계하려는 "외부 MCP 를 카탈로그로 설치"의 첫 사례다. 그 티켓의 보안 절(임의 레포 설치 = 코드실행 신뢰경계)이 0안에도 그대로 걸린다 | ★0안을 별도 티켓으로 끊지 말고 **그 티켓의 첫 케이스로 붙이는 것**을 권한다                |
| `DHkrzbdAWAcBm4thGI4H` — 녹화-재생 R3 (완료)        | **가장 큰 중첩.** `v3/electron/web-automation/` 1,595줄이 그 산출물이고 렌더러 소비처가 0이다                                                                      | 1안은 새 기능이 아니라 **그 자산을 배선하는 일**이다. 비용 추정이 3~5일로 낮은 이유가 이것 |

---

## 8. ★사장님이 판단하실 항목

**Q1. 할 것인가**

- (a) **0안만** — 하네스 카탈로그에 Aside MCP 를 얹고 한 달간 "로그인 뒤 화면을 봐야 했던 횟수"를 센다. 0.5일. ← **권고**
- (b) 0안 + 1안 — 계측과 동시에 `web_read`(읽기 전용) 자체 구축. +3~5일
- (c) 아무것도 안 한다 — 지금 갈증이 한 칸뿐이라는 §5.1 을 받아들이면 이것도 정직한 답이다
- (d) 2안까지 — **권하지 않는다.** §1 의 승인 계층이 먼저다

**Q2. 첫 모양은 무엇인가** — 위 판정이 (b)라면: 읽기 전용 `web_read` 한 개, 헤드리스, origin allowlist 2~3개, 인앱 `persist` 세션은 **쓰지 않음**. 이 세 제약 중 하나라도 풀면 §1 의 위험 등급이 R 에서 W 로 올라간다.

**Q3. 예산**

- 0안: 0.5 엔지니어-일 + 월 $0(Free) 또는 $20(Pro)
- 1안: 3~5 엔지니어-일 + 모델 토큰 월 $18(Sonnet 5)~$45(Opus 5) 추정
- 2안: 2~3주 + 태스크당 $1~7 + 상시 운영 부담

**Q4. ★신뢰 판단 — 0안의 진짜 비용** — Aside 를 붙인다는 것은 **사장님의 로그인 자격증명을 3rd-party 앱(Aside Computer Inc., 신생 YC 스타트업)에 맡긴다**는 뜻이다. 이건 엔지니어링 판단이 아니라 사장님 판단이다. 붙인다면 **테스트 계정 한 개로 시작**하고 실계정은 넣지 않는 것을 권한다.

**Q5. 위키 갱신 여부** — `DNR-02`(WebContentsView 격리 브라우저 표면 기각)의 사실 근거 "트리에 구현 없음"이 #1413·#1418 로 더 이상 참이 아니다(§5.4). 기각 자체는 `M1` 축에서 여전히 유효하다. 원장 행을 정정할지, 정정한다면 별도 티켓으로 끊을지.

---

## 9. 한계 / 정직성

- Aside 를 **설치해서 실행하지 않았다.** 능력 서술은 공식 사이트·공식 문서·벤더 발행 벤치 아티팩트에 한정되며, 실제 성공률·속도·실패 양상은 검증하지 않았다.
- 랜딩의 경쟁사 비교 수치(Browser Use 97.7 / GPT-5.4 92.8 / Claude Opus 4.8 84.0 / ChatGPT Atlas 70.0)는 **대응 실행 아티팩트가 없다.** 이 문서는 그것을 사실로 쓰지 않았다.
- 마케팅의 "payments·posts·messages 는 항상 사람 확인" 문장에 대응하는 **행위별 승인 규칙 문서를 공식 문서 18페이지에서 찾지 못했다.** 마케팅 주장으로만 표기했다.
- §6 의 토큰 비용은 **추정**이다. 페이지 스냅샷 8k 토큰·캐싱 미적용을 가정했고 실측이 아니다. 실행하기로 하면 첫 주에 `count_tokens` 로 재보정해야 한다.
- 엔지니어-일 추정은 기존 `web-automation/` 자산이 그대로 쓰인다는 가정 위에 있다. 그 코드가 실제로 도는지는 **단위테스트 파일 존재(`v3/tests/unit/browser-automation-session-store.test.ts`, `intent-recorder.test.ts`)까지만 확인했고 런타임 실행은 하지 않았다**(코드 무변경 원칙 + `[[no-live-gui-verify]]`).
- `record-replay-browser-runtime-measurement-2026-08-28.md` 의 `BrowserPane.tsx = iframe` 서술은 낡았다(§3.2). 원본은 이 티켓에서 고치지 않았다.
- 수치가 갈리면 코드가 옳다. 이 문서의 파일:줄 표기는 2026-09-05 현재 코드 기준이다.
