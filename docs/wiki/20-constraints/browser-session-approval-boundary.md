---
title: 로그인 세션에 자동 행동을 붙이려면 승인 계층이 먼저다
tags: [domain/constraints, topic/privacy, topic/electron, topic/agents, kind/knowledge]
status: verified
date: 2026-09-05
links: [[in-app-link-routing]], [[no-live-gui-verify]]
---

## 지금 무엇이 참인가

우리에게 없는 건 브라우저가 아니라 **승인 계층**이다. 인앱 웹탭은
`persist:marblo-browser-tab` 파티션을 쓰므로 쿠키와 localStorage가 앱을 다시 켜도 남는다.
즉 사장님이 구글·노션·대시보드에 로그인한 실제 세션이 웹탭 표면에 살아 있다. 여기에
AI의 자동 행동을 연결하면 로그인된 계정으로 돈을 쓰고, 글을 올리고, 메시지를 보내고,
데이터를 지우거나 권한을 바꿀 수 있다. 이것은 브라우저 기능의 문제가 아니라 세션 권한을
누가 어떤 조건에서 행사할 수 있는가의 문제다.

| 층          | 지금 있는 것                                                                                                                                                                                              | 비어 있는 것                                                                                    |
| ----------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| 세션        | `WebContentsView` 웹탭과 디스크에 남는 `persist:marblo-browser-tab` 파티션                                                                                                                                | 태스크별 세션 격리·incognito 경계(★스테이지 1은 pane 단위 승인으로 대신 좁혔다 — §Stage 1 참조) |
| 관찰        | ★스테이지 1(`FQ7nshXHjDWOvD0WWUVV`): pane 단위로 승인된 웹탭 페이지를 `executeJavaScript` 로 읽는 `web_tab_read`/`web_tab_list` MCP 툴(`browser-pane-agent-read.ts`, `browser-pane-agent-read-policy.ts`) | 접근성(AX) 트리 — 지금은 `innerText` 뿐, 요소 구조는 없다                                       |
| 행동        | 웹탭의 이동·새로고침·bounds 같은 표면 관리 API; 새 창 요청은 현재 페인을 덮어쓰지 않고 새 Web 탭으로 라우팅                                                                                               | 페이지 클릭·입력·폼 제출을 실행하는 API와 실패 처리 — ★스테이지 2/3                             |
| 권한        | 라우팅의 `allow`/`external`/`deny` 분류(새 창은 Web 탭 라우팅 후 native 창 생성을 `deny`), 에이전트의 YOLO 실행, ★스테이지 1의 읽기 승인 게이트(pane 단위 grant + 전역 중지, `classifyAgentReadRequest`)  | 클릭·입력·제출·지불·삭제를 나누는 승인 게이트 — ★스테이지 2/3                                   |
| 데이터 경계 | 브라우저 세션 유출 가드와 값 마스킹, 사람에게 묻는 handoff 배관, ★스테이지 1의 읽기 레이트리밋 + 비밀값 정규식 redaction + 기존 MCP 감사 원장(`auditedTool`/`auditLog`) 재사용                            | 스텝 상한(행동에 대해서만 — 읽기는 레이트리밋으로 이미 있음)                                    |

따라서 현재 웹탭은 **보여주고 이동시키는 표면**이지, 로그인 세션을 에이전트에게
넘겨 다루게 하는 자동화 표면이 아니다. Aside의 공식 권한 모델이 `Read only`·`Guard`·
`Full access` 세션 모드와 `Allow`·`Ask`·`Deny` 규칙을 따로 두는 것은 이 가운데 비어
있는 층을 드러내는 비교 사례다. 그 모델을 복사한다고 해서 우리 세션이 안전해지는 것은
아니다. 우리 쪽 승인 계층이 먼저 있어야 한다.

## 멈추는 조건

- `persist:marblo-browser-tab`를 그대로 자동화 세션으로 재사용하지 않는다. 읽기든 쓰기든
  사장님의 실제 로그인 상태가 LLM과 행동 루프에 들어가는 순간 별도의 데이터 경계가
  필요하다.
- 페이지 읽기는 origin allowlist, 원문 마스킹, 프롬프트 스냅샷 유출 가드, untrusted
  external content 봉인을 모두 통과해야 한다. 읽기도 로그인 데이터의 반출이므로 공짜가
  아니다.
- 클릭·입력·폼 제출은 건별 승인 없이는 실행하지 않는다. 결제·게시·전송·삭제·권한 변경과
  인증 화면은 항상 사람 승인 또는 에이전트 진입 금지다. `kill_agent`만으로는 이미
  WebContentsView에서 진행 중인 행동을 멈출 수 없다.
- 승인 게이트·태스크별 세션 격리·전역 킬 스위치·스텝 상한·행동 감사 원장이 없는 동안
  Aside 같은 자율 브라우징을 제품 경로로 켜지 않는다. 로그인 뒤 콘솔을 확인할 필요가
  생기면 먼저 별도 헤드리스 세션의 읽기 전용 도구로 좁힌다.

## 확인 방법

1. `in-app-browser-policy.ts`와 `main.ts`에서 `persist:marblo-browser-tab`이 웹탭에
   주입되는지 확인한다. 인증·결제 라우팅은 자동화에도 같은 경계를 적용해야 한다.
2. `preload.ts`와 main IPC 표면에 페이지 관찰·행동 API가 있는지 확인한다. ★스테이지 1부터
   읽기 API(`browserPane:setAgentReadAccess`/`agentReadWebTabPane`, `web_tab_read`/
   `web_tab_list` MCP 툴)가 있지만 클릭·입력 실행기는 여전히 없다 — 읽기가 있다고
   자동 브라우징이 완성된 것으로 읽지 않는다.
3. `bridge-server.ts`의 YOLO 권한과 `danger-command.ts`의 PTY 문자열 방어가 브라우저
   행동까지 보호하는지 따로 확인한다. 문자열 방어만으로는 클릭·입력 승인을 증명할 수 없다.
4. 유출 가드와 순수 정책 함수는 vitest·정적 분석으로 검증한다. 사장님이 앱을 쓰는 동안
   Electron 창이나 브라우저를 띄우지 않는다.

## Stage 1 — 읽기·관측·전역 중지가 실제로 만들어진 형태 (ticket `FQ7nshXHjDWOvD0WWUVV`, 2026-09-05)

사장님이 이후 구체화한 목표 워크플로우(광고 캠페인 수정, 웹 블로그 작성)를 향해 설계하되,
이 티켓의 범위는 여전히 **읽기 + 관측 + 전역 중지**뿐이다. 클릭·입력·폼 제출 API는 없다.
아래는 그 설계 질문 3개에 대한 답과 근거, 그리고 사장님이 추가로 확인을 요청한 두 항목이다.

**Q1. 어느 세션에서 읽는가.** `persist:marblo-browser-tab` 그대로 — 격리 세션이 아니다.
값의 절반이 "로그인 없이는 못 보는 화면을 읽는 것"(§5.1의 유일한 진짜 갈증)인데 격리
세션은 그 값을 통째로 지운다. 그 대신 안전장치를 **세션 레벨이 아니라 pane 레벨**로
내렸다 — 사장님이 세션 전체를 열어주는 게 아니라, 지금 열려 있는 **이 탭 하나**를
`BrowserPane`의 "🤖 에이전트 읽기" 토글로 켠다. 끄면 그 즉시 그 pane만 다시 안 보인다.
사장님이 페이지 단위로 고르게 하라는 노트의 제안을 pane = 사장님이 실제로 보고 있는
화면 단위로 구현한 것이다. `classifyAgentReadRequest`(`browser-pane-agent-read-policy.ts`)가
grant 없는 pane·global-stop 중·auth/payment 페이지를 전부 거부로 판정한다.

**Q2. 읽기도 승인이 필요한가.** 그렇다 — 위 pane 단위 grant 자체가 그 승인이고, 기본값은
거부다. 로그로 나가는 부분은 기존 배관을 그대로 썼다: `auditedTool`/`auditLog`
(`mcp-server/tools.ts`)가 이미 `gmail_fetch`/`drive_fetch`와 같은 정책으로 툴 결과를
500자로 잘라 원장에 남긴다 — 새 원장을 만들지 않았다(티켓이 요구한 "기존 배관 확인"의
답). 다만 웹탭은 로그인된 콘솔·광고 대시보드처럼 눈에 보이는 원문 비밀이 이메일/드라이브
본문보다 흔하다고 보고, `redactLikelySecrets`(정규식: provider API 키, AWS 키, Slack/GitHub
토큰, JWT, 카드번호형 숫자열)를 읽기 결과에 **추가로** 통과시킨다 — 에이전트 컨텍스트와
원장 양쪽에 동일하게 적용된다. 일반 텍스트(수치·이름·문장)는 그대로 넘어간다 — 그게
읽기 기능의 존재 이유이기 때문에 가릴 수 없다.

**Q3. 사람과 에이전트가 같은 탭을 쓰면.** 에이전트의 읽기는 스냅샷 하나(`executeJavaScript`)
일 뿐 탈취가 아니다 — 사장님의 내비게이션·입력을 막거나 가로채지 않는다. 대신 아래
CDP 판단이 이 답을 지탱한다.

**★CDP(`webContents.debugger`) 대 `executeJavaScript` — 코드로 확인하고 고른 이유.**
`grep -rn "\.debugger\b" electron` → 0건(2026-09-05 확인, 재확인 가능). Electron의
`webContents.debugger`는 Playwright가 쓰는 바로 그 CDP를 열어준다 — 새로 짜는 게 아니라
붙이는 일이라는 사장님 지적은 사실이다. 그럼에도 스테이지 1에서는 **붙이지 않았다**:
CDP는 읽기 전용 프로토콜이 아니다. `webContents.debugger`를 attach하면 `Input.*`·
`Page.navigate`·`Network.*`가 전부 같은 세션 객체에서 열린다 — "읽기만 한다"는 우리가
어떤 CDP 메서드를 호출하기로 선택했느냐의 약속이 되지, attach 자체가 강제하는 경계가
아니다. 이 티켓의 완료 기준이 "쓰기 API가 존재하지 않는다"인데, 그 API가 한 줄이면 열리는
프로토콜 위에 읽기를 얹는 것은 그 기준과 충돌한다. `executeJavaScript`는 이미 만드는 모든
`WebContentsView`가 갖고 있는 능력이고(디버깅 프로토콜을 켜지 않고 실행됨, Chromium
콘솔과 동일), `nodeIntegration`/`contextIsolation` 변경도 필요 없다. 코드: `browser- pane-agent-read.ts`.

이 선택은 **스테이지 1 한정**이다. 스테이지 2(되돌릴 수 있는 쓰기 — 초안 저장, 제출 없는
폼 입력)·3(되돌릴 수 없는 행동 — 발행·광고 집행·결제)에서 갈림길이 온다: `executeJavaScript`
위에 우리 자체 요소 지목·대기·재시도 레이어를 쌓을 것인가, 아니면 CDP를 붙여 실제
Playwright가 우리 pane을 몰게 할 것인가. "매우 수려하게"의 정직한 답은 — Playwright가
좋은 이유는 CDP 접근 자체가 아니라 그 위층(로케이터, 자동 대기, 재시도 의미론)이다.
CDP만 붙이면 "클릭은 되는데 열 번에 세 번은 엉뚱한 걸 누르는" 물건이 나오고, 그건 광고
캠페인 수정에 못 쓴다. 이 갈림길은 스테이지 2의 결정이고, 쓰기 경계가 이미 선 다음에
내려야 한다 — 여기 남겨 스테이지 2가 다시 조사하지 않게 한다.

**★자동화 탐지 — 속도 제한을 처음부터 넣었다.** `AgentReadRateLimiter`가 pane당 최소
간격(2초)과 전역 분당 상한(20회)을 둘 다 강제한다. 근거 없이 넣은 상수는 아니고, 광고·CMS
플랫폼이 로그인 세션의 비정상 요청 패턴에 계정을 잠그는 것은 우리 코드가 아니라 상대
정책이라 "붙여봐야 안다"는 점을 그대로 인정한 상태에서 고른 보수적인 기본값이다. 조정
필요성은 실측 후 판단.

**★UA 지문 — 관찰만 하고 고치지 않았다.** 지금 웹탭은 `Electron/33.4.11 marblo-v3/3.0.38`이
UA에 그대로 노출된다(자동화 이전에 이미 문제가 될 수 있는 지점). 이 티켓에서는 **의도적으로
손대지 않았다** — 같은 파일 `main.ts`의 `setWindowOpenHandler` 근처(티켓 `EXojZ4Dp`, 다른
에이전트가 작업 중)와 충돌 위험이 있어, 이번 변경은 그 함수·그 부근 라인을 전혀 건드리지
않았다(새 IPC 핸들러·상태는 기존 `browserPane:*` 핸들러 블록 끝에, 게이트웨이 배선은
`setDriveGateway` 인접 위치에 각각 추가). `git log origin/main --oneline`으로 확인한 결과
`EXojZ4Dp`는 아직 머지되지 않았다(2026-09-05 기준).

**뮤테이션 검증.** `classifyAgentReadRequest`의 5개 분기, `GlobalBrowserAccessSwitch`의
suspend/abort-count 2곳, 레이트리미터의 off-by-one 2곳, redaction 무력화 1곳, `capReadText`
off-by-one 1곳 — 총 11개 뮤테이션을 수동으로 적용해 각각 vitest를 돌렸다. **11/11이
테스트를 실제로 빨갛게 만들었다**(원본 29개 통과 → 뮤테이션당 1~9개 실패, 전부 원복 후
재확인 완료).

## Evidence

- [Aside 자동 브라우징 현재 상태 조사](../../../v3/docs/aside-browser-agent-feasibility-2026-09-05.md) — 공식 자료와 Marblo 현재 경계의 근거 정리
- [인앱 브라우저 정책](../../../v3/electron/in-app-browser-policy.ts) — 세션 파티션과 인증·결제 라우팅
- [웹탭 생성·IPC 구현](../../../v3/electron/main.ts) — `WebContentsView` 표면과 pane 배선, ★스테이지 1의 `agentReadWebTabPane`/`browserPane:setAgentReadAccess`/`browserPane:setGlobalAgentStop`
- [웹탭 preload API](../../../v3/electron/preload.ts) — 렌더러에 노출된 웹탭 조작 표면 + 스테이지 1 읽기 승인/전역 중지 API
- [스테이지 1 읽기 정책(순수, 단위테스트)](../../../v3/electron/browser-pane-agent-read-policy.ts) — 승인 판정·전역 중지·레이트리밋·redaction
- [스테이지 1 읽기 추출(`executeJavaScript`)](../../../v3/electron/browser-pane-agent-read.ts) — CDP를 붙이지 않은 이유가 여기 문서화되어 있다
- [에이전트 YOLO 실행 경로](../../../v3/electron/bridge-server.ts) — 승인 없는 기본 실행, ★`WebTabAgentReadGateway`. ★2026-09-05(티켓 `DmfFZdKpNig5AiZ7Bp3p`) `GET /vendor-secret-presence` 라우트 추가 — 실행 경로가 아니라 벤더 키 존재 여부(값 없음) 조회라 YOLO 실행·승인 경계에는 닿지 않는다
- [PTY 위험 명령 방어](../../../v3/electron/danger-command.ts) — 브라우저 행동에 닿지 않는 현재 방어 범위
- [브라우저 세션 유출 가드](../../../v3/electron/web-automation/leakage-guards.ts) — 프롬프트·로그·IPC 경계
- [라이브 GUI 검증 금지](../../../AGENTS.md) — 창을 띄우지 않는 검증 제약
- [Aside 권한 문서](https://docs.aside.com/help/security) · [Aside 개발자/MCP 문서](https://docs.aside.com/help/developers) — 비교 사례의 1차 자료

## Backlinks

- [[in-app-link-routing]]
- [[no-live-gui-verify]]
