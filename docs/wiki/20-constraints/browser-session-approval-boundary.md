---
title: 로그인 세션에 자동 행동을 붙이려면 승인 계층이 먼저다
tags: [domain/constraints, topic/privacy, topic/electron, topic/agents, kind/knowledge]
status: verified
date: 2026-09-06
links: [[in-app-link-routing]], [[no-live-gui-verify]]
---

## 지금 무엇이 참인가

우리에게 없는 건 브라우저가 아니라 **승인 계층**이다. 인앱 웹탭은
`persist:marblo-browser-tab` 파티션을 쓰므로 쿠키와 localStorage가 앱을 다시 켜도 남는다.
즉 사장님이 구글·노션·대시보드에 로그인한 실제 세션이 웹탭 표면에 살아 있다. 여기에
AI의 자동 행동을 연결하면 로그인된 계정으로 돈을 쓰고, 글을 올리고, 메시지를 보내고,
데이터를 지우거나 권한을 바꿀 수 있다. 이것은 브라우저 기능의 문제가 아니라 세션 권한을
누가 어떤 조건에서 행사할 수 있는가의 문제다.

| 층          | 지금 있는 것                                                                                                                                                                                                                                                                                                                       | 비어 있는 것                                                                                    |
| ----------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| 세션        | `WebContentsView` 웹탭과 디스크에 남는 `persist:marblo-browser-tab` 파티션                                                                                                                                                                                                                                                         | 태스크별 세션 격리·incognito 경계(★스테이지 1은 pane 단위 승인으로 대신 좁혔다 — §Stage 1 참조) |
| 관찰        | ★스테이지 1(`FQ7nshXHjDWOvD0WWUVV`): pane 단위로 승인된 웹탭 페이지를 `executeJavaScript` 로 읽는 `web_tab_read`/`web_tab_list` MCP 툴(`browser-pane-agent-read.ts`, `browser-pane-agent-read-policy.ts`)                                                                                                                          | 접근성(AX) 트리 — 지금은 `innerText` 뿐, 요소 구조는 없다                                       |
| 행동        | 웹탭의 이동·새로고침·bounds 같은 표면 관리 API; 새 창 요청은 현재 페인을 덮어쓰지 않고 새 Web 탭으로 라우팅                                                                                                                                                                                                                        | 페이지 클릭·입력·폼 제출을 실행하는 API와 실패 처리 — ★스테이지 2/3                             |
| 권한        | 라우팅의 `allow`/`external`/`deny` 분류(새 창은 Web 탭 라우팅 후 native 창 생성을 `deny` — ★2026-09-06 PR #1485 이후 이 거부는 pane 뿐 아니라 **앱 전체**에 적용되고, 네이티브 창을 얻는 것은 auth 팝업 하나뿐이다), 에이전트의 YOLO 실행, ★스테이지 1의 읽기 승인 게이트(pane 단위 grant + 전역 중지, `classifyAgentReadRequest`) | 클릭·입력·제출·지불·삭제를 나누는 승인 게이트 — ★스테이지 2/3                                   |
| 데이터 경계 | 브라우저 세션 유출 가드와 값 마스킹, 사람에게 묻는 handoff 배관, ★스테이지 1의 읽기 레이트리밋 + 비밀값 정규식 redaction + 기존 MCP 감사 원장(`auditedTool`/`auditLog`) 재사용                                                                                                                                                     | 스텝 상한(행동에 대해서만 — 읽기는 레이트리밋으로 이미 있음)                                    |

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
   자동 브라우징이 완성된 것으로 읽지 않는다. ★2026-09-06(티켓 `nvrzSFU0xJMPuRqr0EeR`)
   `browserPane:getSiteDataPreview`/`browserPane:clearSiteData`가 추가됐다 — 이는
   **에이전트 표면이 아니라 사람이 직접 버튼을 눌러 실행하는** owner-only 파괴적
   동작(웹탭 한 사이트의 쿠키·캐시·서비스워커·로컬스토리지 삭제)이다. 에이전트의
   읽기/쓰기 권한을 넓히지 않는다 — 위 표의 "권한" 층은 그대로다.
3. `bridge-server.ts`의 YOLO 권한과 `danger-command.ts`의 PTY 문자열 방어가 브라우저
   행동까지 보호하는지 따로 확인한다. 문자열 방어만으로는 클릭·입력 승인을 증명할 수 없다.
4. 유출 가드와 순수 정책 함수는 vitest·정적 분석으로 검증한다. 사장님이 앱을 쓰는 동안
   Electron 창이나 브라우저를 띄우지 않는다.
5. ★2026-09-06(티켓 `MXA0mMmF9IHqrMzvkRqH`, PR #1487) `persist:marblo-browser-tab`
   세션의 User-Agent 두 토큰(§"UA 지문" 참조) 중 `Electron/<ver>` **하나만**
   제거했다(`stripElectronUserAgentBranding`). `marblo-v3/<ver>` 토큰은 일부러
   남겼다 — §"UA 지문"이 이미 "관찰만 하고 고치지 않았다"로 남겨 둔 그 축은
   티켓 `DOJ1vHG3Knl6KVyph0yx`가 "조사 먼저, 승인 없이 머지 금지"로 갖고 있다.
   이번 변경은 승인 계층·세션 격리와 무관하다 — 위 표의 "권한"·"데이터 경계"
   층을 넓히지 않는다. 사이트에 이 세션이 일반 브라우저로 보이게 하는 지문
   축이고, [[in-app-link-routing]]과 [[web-tab-destination-debugging]] §"네
   번째 사례"가 다룬다.

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

## Aside 레퍼런스 심화 — 인증 노출·관측/중지·감사 로그 (재조사, 2026-09-05 저녁)

위 §"지금 무엇이 참인가"의 Aside 비교는 권한 모델(Read only/Guard/Full access,
Allow/Ask/Deny)까지만 다뤘다. `v3/docs/aside-browser-agent-feasibility-2026-09-05.md`도
같은 폭이다. 이번 재조사는 docs.aside.com 6페이지(security·tasks·troubleshooting·
password-manager·privacy + pricing 재확인)를 원문으로 읽어 그 모델이 **실제로 무엇을
게이트하는지**와, 선행 문서에 없던 3개 항목(인증 노출·관측/중지·감사 로그)을 채운다.
코드 변경 없음 — 문서만 갱신. 각 소절은 Aside 사실 → 우리 코드 대조 → 다음 설계자가
쓸 결론 순서로 쓴다.

### 승인 입도는 3개의 독립축이다 (2축이 아니라)

| 축                 | 값                                                           | 무엇을 게이트하나                                                                  |
| ------------------ | ------------------------------------------------------------ | ---------------------------------------------------------------------------------- |
| 세션 권한 모드     | Read only / Guard / Full access                              | **파일** 접근(폴더 열람·쓰기)만. 웹 탐색이나 툴 실행을 막지 않는다                 |
| 툴 규칙            | Allow / Ask / Deny (Deny 최우선)                             | 개별 툴 능력(브라우징·fetch·명령 실행)                                             |
| 패스워드 볼트 정책 | Always allow / While unlocked / Never (항목별 override 가능) | 저장된 자격증명을 에이전트의 autofill 행동이 쓸 수 있는지 — 위 두 축과 완전히 독립 |

에이전트 레벨 기본값(Settings>Agents) 위에 세션/태스크 레벨 설정이 얹힌다. 근거:
`docs.aside.com/help/security.md`, `docs.aside.com/help/password-manager.md`
("Control agent access" 절).

대조: 우리 Stage 1 승인은 아직 축이 하나뿐이다 — pane 단위 `granted` 불리언 하나
(`classifyAgentReadRequest`, `browser-pane-agent-read-policy.ts:64-76`)를 global-stop·
rate-limit·sensitive-navigation과 순서대로 통과시키는 단일 체인이다. **결론**: Stage
2(쓰기)에서 우리가 자체 자격증명 자동입력(패스워드 볼트류)을 만들게 되면, "파일/폴더
권한"과 "자격증명 사용 권한"을 Aside처럼 처음부터 별도 축으로 쪼개 놓을 것 — 하나의
승인 스위치에 얹으면 나중에 분리 비용이 더 크다.

### 세션 격리와 자격증명 자동화는 Aside 에서 상호배타다

Aside는 태스크 단위로 `Default`(공유 프로필)와 `Incognito`(격리, "정상 브라우저 프로필
상태 없이 실행")를 고를 수 있다. 단 **Incognito 세션에서는 에이전트가 패스워드
매니저를 쓸 수 없다** — "Agents cannot use password manager access in incognito
sessions." (`help/tasks.md`, `help/password-manager.md`) 즉 Aside 는 "격리해서 안전하게"와
"로그인해서 유용하게" 중 하나를 태스크마다 고르게 만들어 놨지, 동시에 얻는 방법을
제공하지 않는다.

마블로는 `persist:marblo-browser-tab` 파티션 하나뿐이라 이 선택지 자체가 없다
(`in-app-browser-policy.ts:1`). **결론**: 우리가 나중에 자체 세션 격리를 만든다면,
"태스크별 incognito를 켜면 자동 로그인도 같이 꺼진다"는 Aside의 상호배타 규칙을 그대로
따를지, 아니면 격리된 세션에도 스코프가 좁은 별도 자격증명을 쓸 수 있게 할지는 우리가
직접 정해야 하는 질문이다 — Aside 문서는 후자를 시도조차 안 했다(둘 다 가능하게
만들기가 더 어렵다는 암묵적 증거로 읽을 수 있다).

### 되돌릴 수 없는 행동 — 공식 문서로 격상됐지만, 행위별 규칙표는 여전히 없다

선행 문서(§2.3)는 "payments·posts·messages는 항상 사람 확인"을 **마케팅 랜딩에만
있고 공식 문서 18페이지에서는 못 찾음**으로 기록했다. 이번에 `help/password-manager.md`
에서 같은 문장을 공식 문서 Note로 찾았다: "Sensitive actions such as payments, posts,
and messages should still wait for your confirmation when the task asks for approval."
→ **마케팅 주장에서 공식 문서 확인됨으로 격상.** 다만 어떤 행위가 왜 승인 대상인지
분류한 표는 여전히 없다 — 원칙 서술 + "승인 요청이 오면 대기" 라는 태스크 워크플로우
뿐이다.

대조: 우리 §1.1(`v3/docs/aside-browser-agent-feasibility-2026-09-05.md`)의 R/N/W/$/X
5등급 표는 Aside 공식 문서보다 이미 더 구체적이다. **결론**: 이 지점은 베낄 게 없다 —
Aside를 따라가면 오히려 우리 문서의 해상도가 낮아진다. 이대로 유지.

### 인증 페이지 자체 — Aside는 보여주고 숨기고, 마블로는 표면에서 아예 뺀다 (반대 설계)

Aside: 태스크가 로그인 화면에 도달하면 실제로 그 페이지에 들어가고, 저장된 자격증명이
있으면 패스워드 매니저가 **값을 에이전트에 노출하지 않고** autofill 한다. MFA·패스키
승인·CAPTCHA·본인확인이 뜨면 에이전트는 멈추고 "사람이 보이는 화면에서 그 단계를
완료"하도록 요청한다 — 인증 챌린지 화면 자체는 사람에게 그대로 보이고, 사람이 **그
화면에서 직접** 처리한다. 근거: `help/troubleshooting.md` ("If Aside reaches a sign-in
screen, it can use allowed saved credentials through autofill. If the site asks for MFA,
passkey approval, CAPTCHA, or identity verification, complete the visible step..."),
`help/password-manager.md`.

마블로: `classifyInAppBrowserNavigation`(`in-app-browser-policy.ts:65-94`)이 구글
OAuth·알려진 인증 호스트(MS/Apple/GitHub OAuth)·결제 호스트(Stripe/PayPal/Toss/카카오페이/
이니시스/KCP)를 판별해 애초에 `action: "external"`로 분류한다 — 이 페이지는 웹탭
(`WebContentsView`) 안에 **렌더링조차 되지 않고** 시스템 브라우저로 나간다. 그래서
"MFA 화면을 누가 어떻게 처리하는가"라는 질문 자체가 우리 쪽에는 발생하지 않는다 — 그
화면이 처음부터 에이전트 표면 밖에 있기 때문이다.

**결론**: 이건 Aside보다 보수적인 설계고, 트레이드오프가 있다. §5.1의 "로그인 필요한
콘솔 확인" 워크플로우(Aside면 태스크 하나로 로그인부터 확인까지 끝낼 수 있는 일)가
마블로에서는 구조적으로 두 단계로 쪼개진다 — ① 사람이 시스템 브라우저에서 인증을 직접
끝내고, ② 그 다음에야 (지금은 존재하지 않는) 읽기 경로가 로그인된 페이지를 본다. Aside
처럼 "에이전트 앱 하나 안에서 인증까지 끝내고 이어서 작업"은 지금 아키텍처에서 못
나온다 — 미구현이 아니라 설계상 그렇다. 이걸 바꾸려면 §1의 승인 계층 없이 인증 화면을
에이전트 표면에 들이는 셈이라, `classifyInAppBrowserNavigation`의 external 분류를
느슨하게 만드는 모든 변경은 별도 위협 모델 재검토가 필요하다.

**우리 쪽 대가를 한 줄로**: OAuth/결제 패턴에 걸리는 호스트는 최초 로그인이 웹탭 안에서
아예 완료될 수 없다 — 그 호스트로 가는 내비게이션 자체가 `external`이라 시스템
브라우저(별도 프로필, `persist:marblo-browser-tab`과 무관한 쿠키 저장소)로 튕겨 나가고,
로그인 결과 세션이 웹탭 파티션으로 돌아온다는 보장이 없다. 즉 "로그인 필요한 콘솔을
읽고 싶다"는 §5.1의 갈증은, 그 콘솔이 OAuth로 로그인하는 종류라면 **원리적으로 안
풀린다** — 읽기 API를 아무리 잘 만들어도 애초에 읽을 로그인된 페이지가 웹탭 안에
존재하지 않기 때문이다. (사장님이 이미 폼 로그인으로 웹탭 안에서 직접 로그인해 둔
사이트는 예외 — 그 세션은 `persist:marblo-browser-tab`에 살아 있다.)

### 관측면·중지 수단 — Aside도 하드 킬스위치가 없다 (새 발견)

Aside의 관측면: (a) 브라우저 표면에 직접 뜨는 승인 popover, (b) 가시적 태스크 상태
(waiting for approval / waiting for an answer / errored / finished), (c) 태스크 상세
페이지(생성·변경 파일 미리보기, 태스크 트랜스크립트 보관). 중지 수단은 **별도의
"정지 버튼"이 문서화돼 있지 않다** — 대화형 `Steer`(진행 중인 실행에 끼어들어 방향을
바꿈, 공식 예시가 "Stop using the billing page..."라는 자연어 지시)와 `Queue`(현재 실행이
끝난 뒤 적용) 두 가지뿐이다. 즉 Aside의 "중지"는 **에이전트의 협조에 의존하는 소프트
중단**이지, 실행 중인 것을 강제로 끊는 하드 스톱이 아니다. 근거: `help/tasks.md`,
`help/troubleshooting.md`.

대조: 우리 Stage 1 읽기 경로의 중지는 이미 이보다 강하다. `GlobalBrowserAccessSwitch.suspend()`(`browser-pane-agent-read-policy.ts:94-129`)는 등록된 모든 in-flight read를
`abort()`로 실제로 취소하고 몇 개를 멈췄는지(`abortedCount`)까지 반환한다.
`raceAbort()`(`browser-pane-agent-read.ts:76-95`)는 `executeJavaScript`에 네이티브
취소가 없다는 한계를 인정하면서도, `suspend()` 이후에는 이미 실행 중이던 스크립트가
페이지 안에서 끝나더라도 그 결과가 호출자·로그·에이전트 컨텍스트에 **닿지 못하게**
막는다 — "에이전트야 멈춰줘"가 아니라 "결과를 아예 주지 않는다"는 점에서 Aside 문서에
없는 종류의 하드 스톱이다.

단서: 이 강함은 **읽기 한정**이다 — 읽기는 부작용이 없으니 "스크립트는 계속 돌아도
결과만 버리면 안전하다"는 전제가 성립한다. **결론**: Stage 2/3(클릭·입력·제출)에서
같은 패턴(추상적 kill 플래그가 아니라 in-flight 핸들을 등록해 두고 진짜로 abort하는
것)을 반드시 재사용해야 한다 — 그런데 쓰기 행동은 부작용이 있어서 "결과만 버리기"로
안전해지지 않는다(이미 눌린 버튼은 abort해도 눌린 채다). Aside 문서에도 이 문제의 답이
없다 — 참고할 동등한 설계가 없다는 뜻이므로, Stage 2 킬스위치는 우리가 처음부터
설계해야 하는 빈 칸으로 남겨 둔다.

### 감사 로그 — 공개 문서 어디에도 없음 (기존 문서 정정)

`v3/docs/aside-browser-agent-feasibility-2026-09-05.md` §2.5는 Enterprise 카피를
"시트·감사·공유 프로필"로 옮겼다. 오늘 저녁 `aside.com/pricing`을 다시 열어 원문을
확인한 결과 **"audit"이라는 단어가 카피에 없다** — 지금 카피는 "Manage seats, billing,
and team-wide settings", "Control who can run agents, use shared profiles, and access
vaults", "Let approved agents use team logins without exposing raw secrets"뿐이다.
카피가 그 사이 바뀐 것인지 원래 옮길 때 오류였는지는 확인 불가 — **사실만 정정하고
원인은 미상으로 남긴다.** `docs.aside.com`의 18페이지 색인(`llms.txt`)에도 감사 로그
전용 문서가 없고, `help/privacy.md`는 브라우징 데이터 삭제 컨트롤(히스토리·쿠키·캐시를
시간범위별로 지우는 것)만 다룰 뿐 에이전트 행동 단위 감사 원장은 다루지 않는다.
`aside.com/enterprise`, `aside.com/security`는 둘 다 404 — 별도 문서가 없다.

**판정**: "없다"가 아니라 "공개 자료로 확인 안 됨"이다 — 세일즈 대화로만 제공되는
비공개 기능일 가능성은 배제할 수 없다. **결론**: 이 지점은 마블로가 이미 더 구체적으로
답할 수 있는 몇 안 되는 축이다 — `auditedTool`/`auditLog`(`mcp-server/tools.ts`)를
웹탭 읽기에도 그대로 재사용한 것이 Stage 1 Q2의 답이었다(§Stage 1 참조). Aside를
따라갈 이유가 없다.

## 조사 도구 인프라 — CDN 차단과 임시 수리, 되돌아가는 조건 (2026-09-05, 티켓 `0fyx2YK8cWlz0mBsgI6C`)

위 Aside 조사를 하려면 먼저 `/browse`(gstack)가 이 세션에서 살아 있어야 했다. 그 과정에서
나온 사실은 이 노트의 주제(승인 계층)와 무관하지만, **같은 삽질을 다음 사람이 반복하지
않도록** 원인·수리·재발조건을 여기 남긴다.

**증상**: `~/.claude/skills/gstack`(마블로 리포 밖, 사용자 전역 npm 디렉터리)가 vendor한
`playwright@1.58.2`는 `chromium-headless-shell` revision `1208`을 요구하는데, 이 머신의
`~/Library/Caches/ms-playwright/chromium_headless_shell-1208/`에는 `ABOUT`·
`LICENSE.headless_shell` 두 파일만 있고 실행파일이 없었다(`INSTALLATION_COMPLETE` 마커도
없음) — `npx playwright install`은 exit 0을 내면서도 바이너리를 못 받은 상태.

**원인이 revision 문제가 아니라는 근거(대조군)**: `curl`로 CDN을 직접 찔러본 결과 —

| 대상                                                                      | 결과                                                |
| ------------------------------------------------------------------------- | --------------------------------------------------- |
| `cdn.playwright.dev/.../chromium-headless-shell/1208/...` (GET/HEAD 무관) | HTTP 400 `GatewayExceptionResponse`(24바이트), 즉시 |
| 같은 URL의 `1223`(정상 설치돼 있던 리비전)                                | **동일하게** HTTP 400 `GatewayExceptionResponse`    |
| 무관한 임의 Azure blob 호스트                                             | 동일하게 400                                        |
| `registry.npmjs.org`의 3.1MB 패키지 tarball                               | 200, 풀 다운로드 성공                               |

즉 이 리비전이 안 되는 게 아니라, **이 네트워크에서 Playwright 브라우저 바이너리가 걸린
Azure Front Door/Akamai 계열 CDN 자체에 도달이 막혀 있다** — npm 레지스트리 등 다른 CDN은
정상. (실제로 사장님이 그 시각 돌리고 있던 `npx playwright@1.58.2 install` 프로세스도
`LICENSE.headless_shell`을 쓴 다음 지점에서 30분 넘게 진행이 멎어 있었다 — 즉시 에러가
아니라 무한 행. 확인 후 정리함.)

**수리의 정체 — 새 다운로드가 아니라 "이미 있는 걸 쓰게 만든 것"**: v3 리포의
`@playwright/test@^1.60.0`이 이미 revision `1223`을 완전히 설치해 두고 있었다(190MB,
`INSTALLATION_COMPLETE` 존재, 실행 확인됨). gstack의 `playwright`를 `1.58.2`→`1.60.0`으로
올리면(`npm install playwright@1.60.0 --no-save`, package.json의 `^1.58.2` 범위 안이라
선언은 안 바뀜) `browsers.json`이 요구하는 리비전이 `1208`에서 `1223`으로 바뀌어, 캐시에
이미 있는 것과 맞아떨어진다 — **바이트 하나 새로 안 받고** "already installed" 판정이
난다. CDN이 막혀 있어도 문제가 안 되는 이유가 이것이다.

**되돌아가는 조건과 그때의 증상**: 이 수정은 `~/.claude/skills/gstack/node_modules`에
직접 한 것이라 git으로 추적되지 않는다. `/gstack-upgrade`가 돌면 vendored node_modules가
재설치되며 gstack 자체의 `package.json`이 박아둔 playwright 버전(지금은 `^1.58.2`)으로
**조용히 되돌아갈 수 있다**. 그러면 다시 revision `1208`을 요구하게 되고, 이 CDN 차단이
그대로면 `/browse`의 첫 호출이 멈추거나(`$B goto`가 응답 없이 걸림) 새로 뜬 세션의
캐시에 `1208`이 아예 없어 실패한다 — 오늘과 똑같은 증상이다. 다음 사람이 이 증상을 보면:
① 먼저 `~/Library/Caches/ms-playwright/`에 이미 완전 설치된 리비전이 있는지, ②
`node_modules/playwright-core/browsers.json`이 요구하는 리비전과 캐시가 맞는지, ③ CDN이
막혀 있는지(위 curl 대조군 재현)를 순서대로 확인할 것 — "디스크에 파일이 있다/없다"만
보고 결론 내리지 말 것(★이번에 실제로 파일명 패턴 오판(`*headless_shell*` vs
`chrome-headless-shell`)으로 "바이너리 없음"을 잘못 확정한 사례가 있었다).

## Stage 2 — 에이전트가 공개 문서로 이동하는 최소 경로 (ticket `qpNApCLY53eTaqDDuAul`, 2026-09-05)

오늘 막힌 "검색 → 결과 읽기 → 다음 문서" 조사 루프를 위해 `web_tab_navigate`를
추가했다. 다만 1단계의 **사람 pane을 읽기 승인했다**는 사실은 그 pane의 URL을
에이전트가 바꿔도 된다는 권한이 아니다. 따라서 이 도구는 기존 pane을 절대
`loadURL`하지 않는다. 매 호출마다 새 `WebContentsView`를 만들고, 이 pane만
`web_tab_read`의 텍스트 추출 경로로 다시 읽는다. 사장님이 보고 있던 페이지·히스토리·
로그인 세션은 건드리지 않는 것이 팝업 하이재킹과 같은 피해를 막는 핵심 경계다.

이 경로가 푸는 것은 **공개 페이지 조사**뿐이다. OAuth·결제 호스트는
`classifyInAppBrowserNavigation`이 `external`로 분류해 시스템 브라우저로 보내므로,
OAuth 로그인을 쓰는 콘솔의 로그인 세션을 이 pane에서 조사하는 목표는 미구현 문제가
아니라 현재 설계가 의도적으로 남긴 경계다.

**세션과 목적지의 답.** 첫 모양은 `temp:marblo-agent-browser` 비영속 격리
파티션이다. 일반 검색과 공개 문서는 로그인 없이 충분하므로, 가장 자주 쓰는 조사
경로에서 `persist:marblo-browser-tab`의 쿠키/localStorage를 꺼내 줄 이유가 없다.
공개 HTTPS만 허용하고 `localhost`·사설 IP·HTTP는 막는다. 또한
`classifyInAppBrowserNavigation`을 그대로 재사용하여 OAuth/auth/결제 URL도 거부한다.
최초 URL만 검사하고 끝내지 않는다: `will-redirect`에서 모든 서버 리다이렉트 대상에
동일한 공개-HTTPS/auth/payment 판정과 일반 `/login`·`/signin` 경로 거부를 다시
적용해, 공개 검색 결과가 302로 로그인 화면이나 사설망 주소에 도착하는 길도 막는다.
이것이 초기 목적지 선언의 실질적 최소형이다: MCP 호출 URL 하나가 감사 피드에
남고, 그 URL 외의 클릭/입력/리디렉션 조작 권한은 없다. 로그인 뒤 콘솔 조사가
필요한 경우는 이 단계에서 **허용하지 않는다** — 별도 세션 위임/도메인 승인 UI를
설계하는 후속 단계의 문제다.

**읽기 전용과 중지의 답.** CDP는 여전히 붙이지 않는다. 이동은 Electron의
`webContents.loadURL` 한 가지 능력으로 제한하고, 결과는 기존 고정
`executeJavaScript` 텍스트 추출만 통과한다. click/type/submit/download API는 없다.
이동도 읽기와 같은 `GlobalBrowserAccessSwitch`에 in-flight 등록하고 `raceAbort`로
결과를 차단한다. 중지 때는 `webContents.stop()`도 호출해 진행 중 load를 Chromium에
중단 요청한다. 읽기와 이동에는 각자 2초 pane/에이전트 cooldown + 분당 상한 레이트
리미터가 있어, 정상적인 "간다 → 읽는다"는 가능하지만 이동 폭주는 막는다. 활동 바에는
`이동 중`/성공/거부/중지와 URL이 모두 표시된다.

**뮤테이션 검증.** 이동 정책의 전역 중지, 레이트리밋, auth/payment 판정을 각각
무력화해 focused vitest가 실패하는 것을 확인한다(3/3). `runAgentNavigation`의
in-flight abort 테스트는 stop 호출과 `AbortError`를 함께 고정한다.

**★관측면이 실제로 화면에 뜨게 됨 (ticket `OkVRLGAUdZxX4kSm3XGx`, 2026-09-06).**
위 문단의 "활동 바에는 이동 중/성공/거부/중지와 URL이 모두 표시된다"는 문장 그대로는
맞지만 불완전했다 — `agentNavigateWebTab`이 만드는 `temp:marblo-agent-browser` pane은
생성 시 `view.setVisible(false)` + `setBounds(0,0,0,0)`으로 시작하고,
`paneStore`/`LayoutView`에 등록되지 않아 `BrowserPane.tsx`가 마운트되지 않으므로
`browserPane:setBounds`가 단 한 번도 호출되지 않았다 — pane 자체는 화면에 영구히 안
뜨고, 실제로 보이는 건 활동 바의 텍스트 로그 한 줄뿐이었다(사장님이 이 표면을 실제로
본 적이 없다는 지적, 티켓 본문 참조). `web_tab_read` 완료 시의 결과 텍스트도 UI에는
전혀 노출되지 않고 MCP 호출자에게만 돌아갔다. 이 티켓은 `AgentBrowserActivityBar.tsx`
안에(사람 pane 트리와 분리된 자기 컨테이너) `BrowserPane.tsx`와 같은 기법
(`getBoundingClientRect` → `browserPane:setBounds`)으로 최신 agent paneId를 바인딩하는
작은 미리보기 영역을 추가해 실제 페이지가 화면에 렌더되게 했고, read-done broadcast에
`title`/`textPreview`(240자 캡)/`redacted` 필드를 추가해 읽은 내용도 로그에 보이게
했다. ★승인/세션 파티션/레이트리밋/redaction 경계는 전혀 바뀌지 않았다 —
`textPreview`는 `redactLikelySecrets`를 이미 통과한 값을 그대로 자른 것이고
(`agentReadWebTabPane`), 새 IPC 핸들러나 click/type 능력은 추가되지 않았다. 순수
관측면 강화다.

## Stage 3 — 설계 제안: 로그인이 필요한 곳에서 행동까지 (설계 티켓 `TeF5My785UWkpxRQSX5P`; ★3a는 구현됨 — 아래 §Stage 3a 참조)

★이 절 대부분(3b·3c)은 여전히 Stage 1·2와 성격이 다르다 — **구현되지 않았다.**
사장님 지시 원문("마블로봇이랑 연결된 건데 어떤 특정 잡을 웹에서 수행하는 걸
요청하면 그걸 기반으로 웹탭을 열어서 실제로 브라우징을 하고 어떤 작업까지
들어가는 것 … 그냥 읽는 게 아니라")을 향한 단계별 설계 제안이고, 각 소절은
**사실(코드로 확인) → 선택지와 대가 → 권고** 순서로 쓴다. ★2026-09-06에 3a
(되돌릴 수 있는 쓰기)만 구현됐다 — 아래 표의 3a 행과 §Stage 3a를 참조. 3b·3c는
여전히 확정된 결정이 하나도 없다 — 다음 사람이 승인·반려·수정할 대상이다.

### 사장님이 든 예(지메일)는 오늘 코드로 확인하면 목표가 아니라 반례다

사장님의 가치 설명("aside 브라우저의 장점이 로그인되어 있는 지메일로 접속해
메일도 보내고")을 오늘 코드로 그대로 따라가면 다음이 나온다.

- `gmail_search`·`gmail_fetch`·`gmail_draft`·`gmail_send` 네 도구 전부 **"UNAVAILABLE
  IN THIS RELEASE — do not call"** 상태다(`mcp-server/tools.ts`의 각 도구 설명
  문자열, 2026-09-06 확인). 코드에 남아 있는 이유는 삭제가 아니라 보류이지,
  지금 호출 가능하다는 뜻이 아니다.
- 원인은 스코프 정책이다. `gmail.readonly`·`gmail.compose`는 restricted, `gmail.send`는
  sensitive인데, Google 앱 검증 심사는 "sensitive **또는** restricted 요청 시" 발동해
  6개를 1개로 줄여도 심사가 그대로 붙는다. 그래서 **0개**로 갔다 — 남은 Google
  커넥터 요청은 로그인용 `openid`·`email`뿐이다(`google-restricted-scopes.ts` 머리주석,
  ticket `5UI2a7MsD75QqgRB8icV`).
- 대체 발송 경로 `mail_send`(Resend 경유, `mcp-server/tools.ts:10599` 부근)는 **사용자
  본인의 인증 이메일 주소로만** 보낼 수 있다 — 제3자 수신, cc, bcc는 서버가 전부
  거절한다. 발신 주소도 사용자 본인이 아니라 `team@marblo.app`이다.

★즉 "로그인된 지메일로 제3자에게 메일을 보낸다"는 사장님의 예시적 워크플로우는
**오늘 API로도 안 되고, 브라우저로도 아직 안 된다.** 이건 "브라우저가 API보다
못해서"가 아니라 Google 스코프 심사를 피하려고 우리가 스스로 막아 둔 상태다 —
CASA를 통과해 `gmail.send`를 되찾는 조직적 결정이 별도로 있어야 풀리는 문제이지,
이 티켓이 브라우저 자동화로 우회해서 풀 문제가 아니다. 브라우저로 지메일에
"로그인해서 보내기"를 만드는 것은 (a) 이미 자격증명이 있는 채널을 화면 자동화로
재발명하는 것이고 (b) 아래 §"로그인 문제"에서 보듯 Google OAuth 자체가 임베디드
웹뷰를 막아서 최초 로그인조차 웹탭 안에서 못 끝낸다. **지메일은 이 설계의 목표가
아니라, 이미 다른 경로(API, 잠겨 있지만)로 더 낫게 풀리는 특수 사례로 다룬다.**

★그렇다면 브라우저 경로가 실제로 값어치를 갖는 자리는 어디인가 — **API가 없는
롱테일**이다. 사내 관리자 페이지, 거래처 포털, 지자체·공공 사이트, 예약·발주
시스템처럼 애초에 프로그램적으로 두드릴 창구가 없는 화면. 이 설계 전체는 그
쪽을 겨눈다. 지메일 같은 "API가 있는데 잠긴" 사례는 스코프 심사를 통과시키는
조직적 트랙(§5 `GMAIL_DRAFT_REPLACEMENT.md`)의 문제로 남긴다.

### 먼저 가를 것 — "로그인된 세션을 쓰는 것" 대 "그 세션을 웹탭 안에 만드는 것"

이 둘을 섞으면 이후 어떤 안도 안 나온다. 사실부터 본다.

- **폼 로그인은 이미 쌓인다.** 사장님의 웹탭 파티션(`persist:marblo-browser-tab`)에
  네이버 쿠키가 실재했다(`.naver.com` 6·`www.naver.com` 4·`shopsquare.naver.com` 1,
  오케 2026-09-06 관측). 즉 아이디/비밀번호로 로그인하는 사이트는 사람이 웹탭
  안에서 한 번 로그인해 두면 그 세션이 앱을 다시 켜도 남는다 — **이 경로는 이미
  기술적으로 열려 있다.** 막힌 건 그 세션을 에이전트가 "읽는" 것(Stage 1이 이미
  풀었다)과 "행동에 쓰는" 것(이 절의 대상)이다.
- **OAuth만 못 쌓인다.** `classifyInAppBrowserNavigation`(`in-app-browser-policy.ts:65`)이
  구글 OAuth·MS/Apple/GitHub 로그인·결제 호스트를 `external`로 분류해 웹탭
  (`WebContentsView`) 안에 아예 렌더링하지 않고 시스템 브라우저로 내보낸다. 그
  코드 주석이 이유를 명시한다: _"Google rejects embedded OAuth user agents"_
  (`in-app-browser-policy.ts:86-88`) — 이건 우리 정책이기 이전에 **Google 서버가
  임베디드 웹뷰의 OAuth를 감지해 거부하는 실제 제약**이다(구글이 2016년부터
  강제해 온 반-피싱 정책, `disallowed_useragent`). 우리가 `external` 분류를
  느슨하게 풀어도 구글 계정 로그인 자체는 안 될 가능성이 높다 — 이건 정책
  선택이 아니라 기술적 벽이다. Microsoft·Apple·GitHub OAuth는 구글만큼 강하게
  검증됐다는 근거가 코드에 없다 — 이쪽은 순수히 **우리 자신의 보수적 선택**이다.

★그러므로 "로그인 문제"는 사실 세 가지 다른 문제다: (1) 폼 로그인 사이트 —
이미 풀렸다, 다음 절의 진짜 대상. (2) 비-구글 OAuth(MS/Apple/GitHub) — 우리
정책만 풀면 될 수도 있다, 검증 안 됨. (3) 구글 OAuth — 우리가 뭘 하든 구글이
막을 가능성이 높다, 별도 경로(§4 API 트랙) 없이는 원리적으로 안 풀린다.

### 로그인 문제 — 안 넷 + 대가

티켓이 출발점으로 둔 (가)(나)(다)에 앞선 사실 확인으로 얻은 (라)를 더한다.

**(가) OAuth 호스트를 웹탭 안에 들인다 — `external` 분류를 좁힌다.**
비-구글 OAuth(MS/Apple/GitHub)에는 시도해 볼 여지가 있다. 구글에는 위 이유로
거의 안 통한다. 대가: 인증 화면이 에이전트 표면에 들어온다. Aside 참고 모델은
"보여주되 비밀값만 가린다"(패스워드 매니저 autofill), MFA·CAPTCHA는 사람이 그
화면에서 직접 처리한다(`help/troubleshooting.md`, 위 §"인증 페이지 자체" 참조).
우리가 이 모델을 받으려면 자체 자격증명 볼트가 있어야 하는데(§"Aside 상호배타"
참조) 지금 없다 — 값 없이 "화면만 열어 준다"면 사람이 매번 직접 타이핑해야
하고, 그건 지금 시스템 브라우저로 내보내는 것과 자동화 가치 차이가 거의 없다.
**권고: 지금 단계에서 안 한다.** 나중에 볼트가 생긴 뒤, 구글이 아닌 특정
OAuth 공급자 하나를 화이트리스트로 좁혀 재검토.

**(나) 시스템 브라우저에서 로그인시키고 세션만 웹탭으로 가져온다.**
"기술적으로 되는지부터 확인해라"는 지시대로 확인한 결과: 우리에게 이미 있는
"시스템 브라우저 → 앱" 패턴(`google-oauth.ts`의 loopback PKCE, RFC 8252)은
**토큰을 주고받지, 쿠키/세션을 주고받지 않는다.** 우리가 OAuth 클라이언트를
등록한 서비스(구글 로그인·Drive)에서만 성립하는 패턴이다. API가 없는 임의
사이트(이 설계의 실제 표적)에는 교환할 토큰 엔드포인트 자체가 없다 — 남는
방법은 사용자의 실제 기본 브라우저(Chrome/Safari/Edge, 우리 앱과 완전히 다른
프로세스)의 쿠키 저장소를 읽어 오는 것뿐인데, 이는 OS 키체인으로 암호화된
남의 브라우저 프로필을 우리 앱이 파싱하는 일이라 브라우저·OS·사용자 조합마다
깨지기 쉽고, 그 자체로 "웹탭 안에 뭘 들이느냐"보다 훨씬 넓은 신뢰 경계 위반이다
(우리가 관리하지 않는 저장소에서 세션 쿠키를 추출). **권고: 하지 않는다.**
대가가 이미 알려진 (가)보다 크고 불확실하다 — 기술적으로 "안 된다"에 가깝다.

**(다) API가 있는 곳은 API로, 없는 곳만 브라우저로.**
지메일은 이미 (다)로 풀려 있다(다만 스코프 정책 때문에 지금 잠겨 있을 뿐).
대가: 사이트마다 API 유무를 판별하는 규율이 필요하고, 그 판별을 놓치면 있는
API를 두고 브라우저로 어렵게 재발명한다(§1의 지메일 사례가 정확히 그 함정).
**권고: 채택 — 도구 선택의 기본 원칙으로 삼는다.** 다만 이것만으로는 "API가
없는 롱테일"(이 설계의 실제 표적)을 못 푼다 — (라)와 함께 가야 한다.

**(라) 아무것도 새로 열지 않는다 — 사람이 웹탭 안에서 폼 로그인으로 이미 로그인해
둔 사이트만 다룬다.** 위 "먼저 가를 것" 절이 보인 사실 그대로다: 이 범위는
**오늘 이미 기술적으로 성립한다** — 새 정책 완화도, 새 세션 임포트도 필요 없다.
대가: 사람이 그 사이트에 미리 로그인해 둬야 하고(자동 로그인 없음), OAuth로
로그인하는 사이트는 이 범위 밖이다(§"먼저 가를 것"의 (2)(3)). **권고: Stage 3의
출발점.** 위험이 제일 작고, 이미 있는 Stage 1 pane-grant 인프라를 거의 그대로
확장할 수 있다.

### 단계별 설계 — 전부 한 번에 짓지 않는다

| 단계             | 무엇을 여나                                                                                                                                                       | 로그인 안                      | 위험                                                        |
| ---------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------ | ----------------------------------------------------------- |
| **3a (★구현됨)** | 이미 로그인된 pane에서 **되돌릴 수 있는 쓰기**(입력창 타이핑, 초안 저장, 제출 없는 폼 채움) — ticket `m6pSfPKMgNog8qonXsu4`, PR #1482, 2026-09-06. §Stage 3a 참조 | (라) — 새 로그인 경로 없음     | 낮음 — 결과가 로컬 상태라 사람이 확인 후 버릴 수 있다       |
| **3b**           | 3a와 같은 범위에서 **되돌릴 수 없는 행동**(제출·발송·결제·삭제·게시)                                                                                              | (라) 그대로                    | 높음 — §"확인 게이트" 없이는 열지 않는다                    |
| **3c (보류)**    | 로그인 자체를 에이전트 표면에 들인다                                                                                                                              | (가)의 비-구글 한정, 또는 (나) | 가장 높음, 대가가 확정 안 됨 — 자체 볼트 설계 이후로 미룬다 |

★**3c를 먼저 만들면 안 되는 이유**: 로그인 화면을 여는 순간 승인 계층
(§0 "지금 무엇이 참인가")이 가장 얇아지는 지점(자격증명 자체)을 에이전트
표면에 노출하는데, 그걸 지탱할 볼트·감사·격리가 아직 하나도 없다. 3a·3b가
먼저 "쓰기 행동의 승인 계층"을 실전에서 검증해야, 3c가 그 위에 자격증명
계층을 얹을 때 처음부터 다시 설계하지 않는다.

### 각 단계의 승인 모양 — 누가·무엇을·언제

| 단계 | 승인 시점                    | 승인 형태                                                                                                                                                                                                                                                                                                                                                                                             | 근거/재사용                                                                                                                                                                                 |
| ---- | ---------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 3a   | 행동 **이전**, pane 단위 1회 | 게이트·grant 상태(`agentWriteGrantedPanes`, 읽기 grant와 완전 독립)와 실행기(`web_tab_fill`)는 구현됨(ticket `m6pSfPKMgNog8qonXsu4`, PR #1482). ★UI 토글("🤖 에이전트 쓰기(되돌릴 수 있음)" pane 토글, 읽기 토글 옆)은 아직 없다 — `BrowserPane.tsx`가 그 시점에 다른 세 작업이 점유 중이라 후속 티켓 `8ssBnDzFll0eHDKNYqZB`로 뗐다. 그때까지는 IPC(`browserPane:setAgentWriteAccess`)로만 켤 수 있다 | `classifyAgentWriteRequest`(`browser-pane-agent-write-policy.ts`) — grant 없는 pane·global-stop 중·auth/payment 페이지·구글 호스트 거부, `submit` 액션은 무조건 거부(3b 경계를 코드로 그음) |
| 3b   | 행동 **직전**, 매 건         | 대화 턴 승인 — 에이전트가 먼저 "무엇을(대상 URL·요소·정확한 텍스트) 할지" 답으로 보여주고, 사람의 다음 발화로 승인받은 뒤에만 실행. `mail_send`의 confirm 2단 계약과 동일한 모양                                                                                                                                                                                                                      | `mcp-server/tools.ts`의 `mail_send`/`gmail_send` confirm 계약(§"되돌릴 수 없는 행동" 참조) — 같은 계약을 브라우저 행동에 일반화                                                             |
| 3c   | (보류)                       | 미정 — 자격증명 노출 승인은 3a/3b와 다른 축이어야 한다(Aside의 3축 분리, §"Aside 상호배타" 참조)                                                                                                                                                                                                                                                                                                      | —                                                                                                                                                                                           |

3a의 pane 토글은 **읽기 승인과 별개 토글**이어야 한다 — 읽기만 허용하고 쓰기는
막는 조합이 흔할 것이다(§"먼저 답할 질문"의 정신과 같다: 읽기 승인이 쓰기
권한을 내포하면 안 된다).

### 되돌릴 수 없는 행동을 어디서 막나 — 확인 게이트 설계 (3b)

★**메일은 보내면 끝이다.** "Undo"가 없는 행동(발송·게시·결제·삭제·권한 변경)은
사후 킬스위치로 못 막는다 — 막을 수 있는 유일한 지점은 **디스패치 직전**이다.
이미 있는 계약을 일반화한다:

1. 에이전트는 실행 전에 **정확히 무엇을 할지**(대상 URL, 대상 요소 설명, 채워질
   정확한 텍스트/값, 누를 버튼의 라벨)를 답변으로 그대로 보여준다 — 요약하지
   않는다. `GMAIL_DRAFT_REPLACEMENT.md` §4.2가 이미 이 절차를 메일에 대해
   못박아 뒀다: "받는 사람·제목·본문 전문을 그대로 보여준다. 요약하지 않는다."
2. 사람이 승인하면, 그 발화를 근거로 **그 행동 하나에 스코프가 좁혀진
   토큰**(대상 URL+요소+값의 해시)을 발급한다. 다른 URL·다른 값에는 재사용
   못 한다 — `mail_send`가 `confirm=true` 하나로 "무엇이든 승인됨"을 만들지
   않고 매 호출(to/subject/body 포함)을 서버가 다시 검증하는 것과 같은 이유다.
3. 디스패치 직전에 그 토큰과 지금 상태(같은 URL, 같은 요소, 전역 중지 아님)를
   다시 대조한다. 승인과 디스패치 사이에 화면이 바뀌었거나 전역 중지가
   걸렸으면 **거부** — 승인 순간의 화면이 실행 순간의 화면과 같다는 보장이
   없으면 승인이 무엇에 대한 승인인지 알 수 없다.
4. 성공/실패 결과를 활동 피드에 남긴다(§0의 감사 원장 재사용 — `auditedTool`/
   `auditLog`).

이 설계는 "쓰기 전 확인"이지 "쓰고 나서 멈춤"이 아니다 — 다음 절이 그 이유를
다룬다.

### 확인 게이트가 실제로 구현된 선례 (ticket `nvrzSFU0xJMPuRqr0EeR`, 2026-09-06)

★위 확인 게이트의 3번째 단계("디스패치 직전에 그 토큰과 지금 상태를 다시
대조한다")는 이 노트가 3b를 위해 설계해 둔 것이지만, 지금까지는 추상적
설계였다. 웹탭 "사이트 데이터 지우기"(사람이 직접 확인 버튼을 누르는
owner-only 동작이지 에이전트 행동이 아니다)가 이 3번째 단계 하나를 실제로
구현한 첫 사례다: `classifySiteDataClearRequest`
(`browser-pane-site-data-policy.ts`)는 확인 모달이 보여준 origin
(`expectedOrigin`)과 실행 시점 pane의 실제 origin을 대조해, 다르면
`confirmed` 값과 무관하게 `origin-changed`로 거절한다 — 확인 모달을 띄운
뒤 사람이 그 pane에서 다른 사이트로 이동한 채로 확인 버튼을 눌러도, 화면에
없던 사이트가 조용히 지워지지 않는다.

이게 증명하는 것: **승인(확인 클릭) 하나만으로는 부족하다.** "본 것과
지금 실행하려는 것이 같은가"를 별도로 재확인하는 층이 없으면, 승인은
확인 시점의 화면에 대한 것이었는지 실행 시점의 화면에 대한 것이었는지
구분할 수 없다. Stage 3b(에이전트가 발송·삭제 같은 되돌릴 수 없는 행동을
하는 설계)가 같은 재대조 계층을 설계할 때 이 교훈을 처음부터 다시 발견할
필요가 없도록 여기 선례로 남긴다.

★단서: 이 사례는 위 확인 게이트의 3단계 중 **3번째 단계만**의 선례다.
사람이 직접 확인·실행하는 단일 요청이라 2번째 단계("행동 하나에 스코프가
좁혀진 토큰 발급")는 필요하지 않았다 — `expectedOrigin` 자체가 이미
그 확인 요청 하나에 묶인 값이기 때문이다. 에이전트가 여러 단계를 거쳐
디스패치하는 3b에는 2번째 단계(토큰 발급)가 그대로 필요하다.

### 확인 UI 자체가 웹 콘텐츠에 가려질 수 있었던 결함 (ticket `zYzwb3Q5hKT6o3Nl9aZh`, 2026-09-06, PR #1489)

★위 선례가 다룬 것은 "확인 요청과 실행 사이의 상태 불일치"(3번째 단계)였다.
이번 결함은 그보다 앞선 단계 — **확인 모달 자체가 화면에서 실제로 보였는가**다.
같은 "사이트 데이터 지우기" 확인 모달(`ClearSiteDataModal`)에서, 모달이 떠 있는
동안 네이티브 `WebContentsView`(웹 콘텐츠, 예: 네이버 쇼핑 캐러셀)가 그 위로
계속 그려지는 결함이 있었다(사장님 스크린샷으로 확인) — 확인 버튼 자체는 여전히
존재하고 클릭 가능했지만, 화면 절반이 그 위에 그려진 웹 콘텐츠에 가려졌다.

**원인.** `BrowserPane.tsx`의 오버레이 검사(`hasBlockingOverlay`)가 "이 pane
자기 자신이 그린 오버레이"를 일부러 제외하고 있었다(`owner.contains(node)`
이면 건너뛴다). `ClearSiteDataModal`은 정확히 그 pane 자신의 자식으로
렌더링되므로 이 제외에 걸렸다. pane 헤더 주석에는 이미 "모달/팝오버가 있으면
네이티브 뷰를 숨긴다"는 계약이 있었지만, 그 계약이 주석에만 있고 테스트가
없어서 새 모달이 그 계약을 어기고도 아무도 못 잡았다.

**왜 이게 승인 경계의 문제인가.** 네이티브 `WebContentsView`는 DOM 소유권과
무관하게 렌더러 전체 위에 항상 합성된다 — "이 오버레이를 누가 그렸느냐"로
숨김 여부를 가르는 것 자체가 틀린 축이다. 되돌릴 수 없는 동작(사이트 데이터
삭제)의 확인 UI가 자기 자신이 감시해야 할 바로 그 화면(웹 콘텐츠)에 가려질
수 있다는 것은, 사람이 확인 버튼을 누르기 전에 실제로 무엇을 보고 있는지가
화면 렌더링 순서에 좌우된다는 뜻이다 — 승인이 유효하려면 승인 UI 자체가
신뢰할 수 있게 보여야 한다는 전제가 깨질 수 있었다.

**수리.** owner 제외 로직을 제거해, pane 자신이 그린 오버레이도 다른
오버레이와 동일하게(네이티브 뷰를 숨기는 조건으로) 취급한다. 회귀 테스트로
고정 — 모달이 pane 자신의 트리 안에서 열려도 네이티브 뷰가 숨는지 확인한다.
기존 테스트는 오버레이를 `document.body`에 직접 붙여 이 경로를 검증하지
못했다.

**교훈.** 이 pane 자신의 서브트리 안에 새 승인 UI(팝오버·드롭다운·확인창)를
추가하는 다음 사람은 "내 안에 있으니 괜찮다"고 가정하기 쉽다 — 이번 결함이
정확히 그 가정이었다. 이 pane 위에 뜨는 오버레이는 그린 주체와 무관하게
전부 같은 규칙(네이티브 뷰를 숨긴다)을 따라야 한다.

### Stage 2/3 킬스위치 — 왜 베낄 데가 없고, 무엇을 대신 설계하는가

Stage 1의 중지가 강한 이유는 **읽기라서**다: `GlobalBrowserAccessSwitch.suspend()`
가 in-flight를 전부 `abort()`하고, `raceAbort()`는 이미 끝난 스크립트의 결과조차
호출자에게 닿지 못하게 막는다(§"관측면·중지 수단" 참조). 읽기는 부작용이
없으므로 "결과만 버리면 안전하다"가 성립한다. **쓰기는 이 전제가 깨진다** —
이미 눌린 버튼은 `abort()`해도 눌린 채고, 서버는 이미 그 클릭을 받았다.
Aside 공식 문서에도 이 문제의 답이 없다(§"관측면·중지 수단" 참조, 문서화된
"정지 버튼" 자체가 없다) — 참고할 동등한 설계가 없다.

★그래서 "킬스위치 하나"로 풀 문제가 아니라고 판단한다. **행동을 두 종류로
가르고 각각 다른 안전장치를 붙인다**:

- **되돌릴 수 있는 쓰기(3a: 타이핑, 초안 저장, 제출 없는 폼 채움)** — Stage 1과
  **같은 패턴을 그대로 재사용**한다. `GlobalBrowserAccessSwitch`에 in-flight로
  등록하고, 중지 시 `raceAbort` + 대상 pane `webContents.stop()`. 이 행동들은
  로컬 상태만 바꾸므로(서버로 아직 아무것도 안 나갔다) 중지 후 "필드를
  비운다/초안을 지운다" 같은 되돌리기 동작까지 안전하게 정의할 수 있다.
  ★킬스위치가 통하는 이유는 3a가 "쓰기"가 아니라 "아직 제출 안 된 상태를
  화면에 반영하는 것"이기 때문이다 — 이 경계(제출 이전/이후)가 이 설계
  전체에서 가장 중요한 선이다.
- **되돌릴 수 없는 행동(3b: 제출·발송·삭제·결제·게시)** — 킬스위치가 아니라
  위 §"확인 게이트"가 안전장치다. 안전은 "실행 중인 것을 끊는 능력"이 아니라
  "승인과 디스패치 사이의 창을 0에 가깝게 좁히고, 그 창이 열려 있는 동안 상태
  불일치를 감지하면 실행을 거부하는 것"에서 나온다. 전역 중지가 걸려 있으면
  3b는 애초에 확인 게이트를 열지도 않는다(1번 단계 이전에 전역 상태를 본다) —
  "중지 중에 새로 시작하지 못하게" 막는 것이 "이미 시작한 것을 멈추는 것"보다
  이 종류의 행동에는 유일하게 성립하는 안전장치다.

이 구분(제출 이전 vs 이후)을 3a/3b의 경계로 삼으면, 킬스위치를 "쓰기 전용으로
새로 발명"하는 대신 이미 검증된 Stage 1 패턴을 그대로 3a에 옮기고, 3b는 애초에
킬스위치가 필요 없는 형태(사전 확인 + 좁은 창)로 설계해 문제 자체를 비켜간다.

### Aside의 상호배타 — 우리에게도 강제되는 벽인가

**판정: 지금은 아니다 — 우리에게 강제되는 벽이 아니라 Aside의 구현 선택이
낳은 결과로 읽는다. 다만 조건부다.**

Aside의 격리(Incognito)/자동로그인(패스워드 매니저) 상호배타는 Chromium
**네이티브** 패스워드 매니저를 썼기 때문에 생기는 결과일 가능성이 높다 —
네이티브 매니저의 autofill은 디스크에 남는 프로필의 저장된 자격증명을
읽는데, Incognito는 정의상 그 프로필 상태가 없다. 즉 격리와 네이티브
자동로그인은 **같은 저장소를 전제로 설계돼 있어서** 충돌한다.

우리는 네이티브 패스워드 매니저를 쓴 적이 없다 — 지금 두 파티션
(`persist:marblo-browser-tab`, `temp:marblo-agent-browser`)은 둘 다 브라우저의
쿠키/localStorage 저장소일 뿐, Chromium 자격증명 관리자를 켠 적이 없다. 만약
나중에 자체 자격증명 볼트(Chromium이 아니라 우리 코드가 암호화해서 보관하고,
우리 코드가 직접 값을 채워 넣는 것)를 만든다면, 그 주입은 어느 파티션에든 —
격리된 파티션이라도 — 우리가 원하는 대로 할 수 있다. Chromium의 네이티브
경계에 안 걸린다.

★**대가**: 이건 공짜가 아니다. 네이티브 매니저를 안 쓴다는 것은 (a) 값이
"브라우저가 이미 암호화해 둔 저장소"가 아니라 **우리가 직접 암호화·보관**해야
한다는 뜻이고 (b) Aside가 지키는 "값을 에이전트에 노출하지 않고 autofill"을
지키려면 값이 렌더러/에이전트 컨텍스트에 문자열로 닿지 않는 주입 경로(예:
CDP `Input.insertText`류를 메인 프로세스에서만 다루고 렌더러·MCP 응답에는
안 실음)를 새로 설계해야 한다는 뜻이다. 이건 지금 없는 서브시스템이고, 그
자체가 새 위협 모델(비밀 저장 위치, 유출 경로, 볼트 접근 승인)이다.

**결론: 지금 이 질문은 열려 있지 않다.** Stage 3(3a/3b)은 (라) 안만 다루므로
자격증명 저장·주입이 아예 등장하지 않는다 — 사람이 이미 로그인해 둔 세션만
쓴다. 이 질문은 3c(보류)에 가서야 실제로 열린다. 지금 정하지 않는 이유는
정하기 이르기 때문이지, 벽이 있어서가 아니다.

### Aside는 구글메일 발송 세션을 어떻게 갖나 — 확인 결과 (사장님 지시, 티켓 `x1QmdvVqMm14VXqGoxTT`)

★위 (가)/(나) 판단이 세운 가설 — "Aside는 임베디드 웹뷰가 아니라 브라우저
그 자체다" — 은 **참으로 확인됐다.** Aside 자신의 공개 문서가 그렇게 말한다
(2026-09-06, `docs.aside.com` 원문 확인).

- _"There is no separate minimum browser version because **Aside is the
  browser**."_ (`help/get-started.md`) — Aside는 macOS 앱으로 설치하는
  **독립 브라우저**다. 다른 앱 안의 웹뷰가 아니다.
- 온보딩이 Chrome/Safari/Edge의 브라우징 기록·쿠키·북마크를 가져오고
  (`help/get-started.md`), 1Password·Bitwarden·Chrome·Edge·Firefox·LastPass의
  저장된 비밀번호까지 가져온다(`help/passwords.md`). 즉 사용자의 "일상
  브라우저"를 Aside로 **교체**하는 제품이다 — 기존 프로필을 실시간 공유하는
  게 아니라 온보딩 시점에 **일회성으로 복사**해 Aside 자체 프로필에 심는다.
- 로그인은 **Aside 자체 브라우저 창에서, 실제 사이트로 이동해, 자체 패스워드
  매니저의 autofill로** 이뤄진다 — API도, 별도 시스템 브라우저로의 이관도
  없다: _"During a task, Aside can browse sites, ... and sign in with allowed
  autofill."_ (`help/tasks.md`) _"When a task reaches a login page, Aside
  checks the target URL and your password access settings. If a matching
  credential is allowed, Aside can autofill it into the page."_
  (`help/password-manager.md`)
- 발송 경로 자체를 명시한 문서는 없다 — 전체 문서 색인(`llms.txt`, 17페이지)
  어디에도 "Gmail API"·"integrations"·"connectors" 페이지가 없다.
  ★**UI 자동화로 Gmail을 조작해 보낸다는 것은 추정이지 직접 인용된 문장이
  아니다.** 다만 "Aside는 브라우저다 + 로그인은 autofill이 유일하게
  문서화된 경로다"라는 두 사실이 겹치고 API 경로를 뒷받침하는 문서가 하나도
  없는 이상, 이 추정이 가장 설명력이 높다. **확인 못 함으로 남긴다** — 없다고
  단정하지 않는다.
- **되돌릴 수 없는 행동 확인**: _"Sensitive actions such as payments, posts,
  and **messages** should still wait for your confirmation when the task asks
  for approval."_ (`help/password-manager.md`) — 같은 페이지가 "email"을
  로그인 자동화의 대표 용례로 든다(_"payroll tools, dashboards, **email**,
  CRMs, billing pages"_). "messages"라는 단어 자체가 이메일 발송을 명시하진
  않지만, 같은 문서가 email을 별도로 다루면서 "messages"를 승인 대상으로
  못박은 것은 이메일 발송이 그 범주에 들어간다는 합리적 추정이다.

★**왜 구글이 이걸 막지 않는가 — 공식 정책으로 확인.** Google의 OAuth 2.0
정책(`developers.google.com/identity/protocols/oauth2/policies`, "Use secure
browsers" 절, 2026-09-06 확인)은 이렇게 못박는다: _"A developer must not
direct a Google OAuth 2.0 authorization request to an embedded user-agent
under the developer's control. Embedded user-agents include, but are not
limited to, software libraries that allow a developer to insert arbitrary
scripts, alter the default routing of a request to the Google OAuth server,
or access session cookies."_ **우리 웹탭(`WebContentsView` +
`executeJavaScript` 접근)은 정확히 이 범주다** — "개발자가 통제하는, 임의
스크립트 삽입이 가능한 임베디드 user-agent." Aside는 이 범주에 안 걸린다 —
다른 앱이 통제하는 임베디드 웹뷰가 아니라 그 자체가 독립 브라우저이기
때문이다.

★**우리 쪽 재확인 — 실제로 시도한 기록이 있는가.** 없다, 이건 정확히
밝힌다. `git log --all -i --grep` 로 "disallowed_useragent"·임베디드 웹뷰
관련 커밋을 찾으면 0건이다. 관련 실패 기록은 있지만(`2f0f6c89`, `70480e81`)
**다른 문제**다 — Firebase JS SDK의 `signInWithPopup`이 Chromium
COOP(Cross-Origin-Opener-Policy)에 막혀 `window.closed` 폴링이 끊긴 것과,
`signInWithRedirect`가 커스텀 `http://127.0.0.1` origin에서 storage
partitioning에 막혀 네비게이션 자체가 안 뜬 것(`google-oauth.ts` 머리주석)이다
— **둘 다 우리 자신의 로그인 창(앱 최상위 origin)에서 Firebase Auth SDK를
쓰다가 난 문제이지, 웹탭(`persist:marblo-browser-tab`)에서 임의 OAuth
호스트에 접속해 구글이 명시적으로 거부하는 걸 실측한 기록이 아니다.**
`in-app-browser-policy.ts:86`의 "Google rejects embedded OAuth user agents"
주석은 위 공식 정책 문서에 근거한 합리적 판단으로 보이지만, ★**우리 웹탭에서
직접 실측된 사실은 아니다 — 확인 못 함으로 정정한다.** 다만 위 공식 정책
문언 자체가 "시도해 볼 가치"를 없앤다: 기술적으로 통과하더라도 **정책
위반**이므로, 확인 삼아 시도하는 것 자체가 구글 약관 우회 시도가 된다.

**결론 — 사장님 질문에 대한 직접 답:**

- Aside는 구글메일 발송을 **지원한다** — Gmail API가 아니라 \*\*자체 브라우저
  - 패스워드 매니저 autofill로 실제 Gmail 웹 UI를 조작\*\*해서로 보인다
    (문서에 직접 명시되지 않은 추정).
- **우리는 같은 방식을 구현할 수 없다.** 우리 웹탭은 Aside처럼 독립
  브라우저가 아니라 **임베디드 웹뷰**(`WebContentsView`)이고, 이건 정확히
  Google OAuth 정책이 금지하는 범주다. Aside가 이 벽을 안 만나는 이유는
  "구글을 이겨서"가 아니라 **애초에 이 범주 밖에 있기 때문**이다 — 우리
  쪽 웹탭 정책을 아무리 고쳐도 이 구조적 차이는 없어지지 않는다.
- 남는 길은 이 Stage 3의 (다) 뿐이다: CASA 심사를 통과해 `gmail.send`
  스코프를 되찾는 것 — 조직적 결정이고 엔지니어링으로 우회할 문제가 아니다.

## Stage 3a — 되돌릴 수 있는 쓰기, 구현됨 (ticket `m6pSfPKMgNog8qonXsu4`, PR #1482, 2026-09-06)

★위 §"단계별 설계"의 3a가 실제로 착지했다. 무엇이 됐고 무엇이 여전히
안 되는지, 그리고 구현 중 실제로 부딪힌 두 가지 판단을 여기 남긴다 — 다음
사람(3b 설계자)이 다시 조사하지 않도록.

**무엇이 됐나.** `web_tab_fill` MCP 도구 하나 — pane 하나의 input/textarea/
contenteditable **하나**에 값을 설정한다. 그뿐이다. 클릭·제출·다운로드·키
이벤트는 이 경로 어디에도 없다.

**설계 긴장을 어떻게 풀었나 — "사람 pane 을 안 건드린다" vs "(라)안은 로그인
세션이 필요하다".** 둘은 실제로 충돌하지 않았다. Stage 1이 이미 사람의
`persist:marblo-browser-tab` **실제 pane**을 읽는다(격리 사본이 아니다) —
"안 건드린다"의 진짜 의미는 애초에 "그 pane을 안 쓴다"가 아니라 "owner의
명시적 동의(pane 단위 grant, 기본 거부) 없이는 안 쓴다"였다. 안전선은
**어느 pane이냐가 아니라 동의**다. 3a는 그 모델을 그대로 확장했을 뿐이다 —
다만 읽기 grant(`agentReadGrantedPanes`)와 완전히 **독립된** 새 쓰기 grant
(`agentWriteGrantedPanes`)를 둬서, 읽기 허용이 쓰기 허용을 내포하지 않게
했다(설계문이 명시적으로 요구한 분리). 사람이 보는 화면이 곧 에이전트가
쓰는 화면이므로 "화면에서 무슨 일이 일어나는지 보여야 한다"는 요구도 별도
관측 UI 없이 구조적으로 만족된다.

**`change` 이벤트를 안 쏘는 이유 — 코드 리뷰에서 실제로 잡힌 문제.** 처음
구현은 값 설정 뒤 `input`과 `change`를 둘 다 디스패치했다. ★이게 틀렸다:
실제 사람이 타이핑할 때 `change`는 **blur 시점에만** 뜬다. 입력 직후
`change`를 쏘면 에이전트가 사람보다 공격적인 셈이고, `<input onchange="this.form.submit()">`처럼 짜인 페이지에서는 되돌릴 수 있는 fill
호출 하나가 **곧 제출**이 되어 이 티켓의 유일한 계약("되돌릴 수 있는
것만")이 깨진다. `input`만으로 setter 기반 값 변경이 React 같은 controlled
field에 이미 반영되므로 `change`는 애초에 불필요했다 — 지웠고, 생성된
스크립트에 `"change"` 문자열이 없음을 테스트로 고정했다(`tests/unit/ browser-pane-agent-write.test.ts`). `change`가 필요한 프레임워크가 실제로
나오면 그건 3b의 확인 게이트를 거쳐야 할 문제이지, 3a에서 조용히 다시
넣을 게 아니다.

**구글 제외가 OAuth 호스트보다 넓은 이유.** `classifyInAppBrowserNavigation`
은 구글 **OAuth 호스트**(`accounts.google.com` 등)만 `external`로 분류한다.
그런데 Gmail·Drive **본문 페이지**(`mail.google.com`, `drive.google.com`)는
로그인 화면이 아니므로 그 분류를 안 탄다 — `sensitive-navigation` 판정을
그냥 통과해 버린다. 그래서 `isGoogleHost()`(`browser-pane-agent-write- policy.ts`)를 별도로 만들어 `google.com`/`gmail.com`/`youtube.com` 전체를
3a 범위에서 뺐다. OAuth 분류를 재사용하는 것만으로는 사장님 지시("구글은
제외")가 실제로 안 지켜졌을 것이다.

**아직 안 된 것 — 토글 UI.** `browserPane:setAgentWriteAccess`/
`getAgentWriteAccess` IPC와 preload 노출은 있지만, `BrowserPane.tsx`에
"🤖 에이전트 쓰기(되돌릴 수 있음)" 토글은 없다 — 구현 시점에 그 파일이
다른 세 작업(#1477·#1480·#1481)의 대상이라 무게중심을 에이전트 도구 쪽에
묶어 뒀다. 후속 티켓 `8ssBnDzFll0eHDKNYqZB`가 이 토글을 붙인다. 그때까지
3a는 IPC/MCP 도구로만 켤 수 있고, 사장님이 웹탭 화면에서 직접 켤 방법은
없다.

**뮤테이션 검증.** `classifyAgentWriteRequest`의 submit 거부·google-host
거부·not-granted·rate-limited 4개 분기, `isGoogleHost`의 suffix 누락,
`capFillValue`의 off-by-one, `runAgentFillAction`의 사전 abort 체크 누락,
그리고 fill 스크립트에 `click()`을 슬쩍 끼워 넣는 것까지 — 총 8건을
수동으로 적용해 각각 vitest를 돌렸다. **8/8이 테스트를 실제로 빨갛게
만들었다**(원본 30개 통과 → 뮤테이션당 1~9개 실패, 전부 원복 후 재확인
완료). 리뷰에서 잡힌 `change` 제거 건까지 포함하면 9건.

## Evidence

- [Aside 자동 브라우징 현재 상태 조사](../../../v3/docs/aside-browser-agent-feasibility-2026-09-05.md) — 공식 자료와 Marblo 현재 경계의 근거 정리
- [인앱 브라우저 정책](../../../v3/electron/in-app-browser-policy.ts) — 세션 파티션과 인증·결제 라우팅
- [웹탭 생성·IPC 구현](../../../v3/electron/main.ts) — `WebContentsView` 표면과 pane 배선, ★스테이지 1의 `agentReadWebTabPane`/`browserPane:setAgentReadAccess`/`browserPane:setGlobalAgentStop`. ★2026-09-06(티켓 `m6pSfPKMgNog8qonXsu4`) Stage 3a: `agentWriteGrantedPanes`(읽기 grant와 독립)·`agentFillWebTabPane`·`browserPane:setAgentWriteAccess`/`getAgentWriteAccess`를 기존 `browserPane:*` 블록 끝에 추가, 전역 중지가 이제 read+write grant를 모두 clear. ★2026-09-06(티켓 `nvrzSFU0xJMPuRqr0EeR`) `browserPane:getSiteDataPreview`/`browserPane:clearSiteData` 추가 — owner-only 파괴적 동작이고 에이전트 승인 경계는 안 건드린다(§"확인 게이트가 실제로 구현된 선례" 참조)
- [웹탭 preload API](../../../v3/electron/preload.ts) — 렌더러에 노출된 웹탭 조작 표면 + 스테이지 1 읽기 승인/전역 중지 API. ★2026-09-06 Stage 3a: `setAgentWriteAccess`/`getAgentWriteAccess` 노출 — `BrowserPane.tsx` 토글은 아직 없음(§Stage 3a, 후속 티켓 `8ssBnDzFll0eHDKNYqZB`). ★2026-09-06(티켓 `nvrzSFU0xJMPuRqr0EeR`) `getSiteDataPreview`/`clearSiteData` 렌더러 진입점 추가, 계약은 동일
- [사이트 데이터 초기화 정책(순수, 단위테스트)](../../../v3/electron/browser-pane-site-data-policy.ts) — ★2026-09-06(티켓 `nvrzSFU0xJMPuRqr0EeR`) origin 산출, `expectedOrigin` 재대조(`origin-changed`), 쿠키 name/domain/expiry만 남기는 미리보기 — §"확인 게이트가 실제로 구현된 선례"의 근거. ★2026-09-06(티켓 `zYzwb3Q5hKT6o3Nl9aZh`, PR #1489) `planCookieRemoval`/`cookieRemovalUrl`/`broaderCookieDomains` 추가 — 미리보기와 실제 삭제의 스코프를 맞추는 순수 함수, §"확인 UI 자체가 웹 콘텐츠에 가려질 수 있었던 결함"과는 별개 결함이지만 같은 확인 모달의 근거 파일
- [웹탭 브라우저 pane 컴포넌트](../../../v3/src/components/workspace/BrowserPane.tsx) — ★2026-09-06(티켓 `zYzwb3Q5hKT6o3Nl9aZh`, PR #1489) `hasBlockingOverlay`의 owner(pane 자신) 제외 로직 제거 — §"확인 UI 자체가 웹 콘텐츠에 가려질 수 있었던 결함"의 수리
- [사이트 데이터 삭제 확인 모달](../../../v3/src/components/workspace/ClearSiteDataModal.tsx) — ★2026-09-06(티켓 `zYzwb3Q5hKT6o3Nl9aZh`, PR #1489) 부모 도메인 쿠키가 섞여 있으면 그 범위를 확인 버튼 전에 명시하는 경고 UI 추가
- [사이트 데이터 지우기 결함 회귀 테스트](../../../v3/tests/unit/browser-pane-clear-site-data.test.ts) — ★2026-09-06(티켓 `zYzwb3Q5hKT6o3Nl9aZh`) 모달이 pane 자신의 트리 안에서 열려도 네이티브 뷰가 숨는지, 도메인 경고가 뜨는지 고정
- [스테이지 1 읽기 정책(순수, 단위테스트)](../../../v3/electron/browser-pane-agent-read-policy.ts) — 승인 판정·전역 중지·레이트리밋·redaction
- [스테이지 1 읽기 추출(`executeJavaScript`)](../../../v3/electron/browser-pane-agent-read.ts) — CDP를 붙이지 않은 이유가 여기 문서화되어 있다
- [Stage 3a 쓰기 정책(순수, 단위테스트)](../../../v3/electron/browser-pane-agent-write-policy.ts) — `classifyAgentWriteRequest`(submit 무조건 거부·google-host 거부 포함), `isGoogleHost`, `capFillValue`
- [Stage 3a 쓰기 실행(`executeJavaScript`, `input`만 디스패치)](../../../v3/electron/browser-pane-agent-write.ts) — `change`를 안 쏘는 이유(§Stage 3a)가 여기 문서화되어 있다
- [에이전트 YOLO 실행 경로](../../../v3/electron/bridge-server.ts) — 승인 없는 기본 실행, ★`WebTabAgentReadGateway`. ★2026-09-05(티켓 `DmfFZdKpNig5AiZ7Bp3p`) `GET /vendor-secret-presence` 라우트 추가 — 실행 경로가 아니라 벤더 키 존재 여부(값 없음) 조회라 YOLO 실행·승인 경계에는 닿지 않는다. 티켓 `Hw8j7iceXh1SFL5eDcRS`의 base 경고도 spawn prompt만 보강하고 브라우저 권한·승인 경계를 건드리지 않는다. ★2026-09-06(티켓 `rjoTuGmIlXJQpjDvWMMR`) `/notify-orchestrator`의 PTY 거절 사유 진단(`describeNotifyRefusal`)을 추가 — 오케 알림 배달 경로이고 브라우저 실행·승인 경계와는 별개다. ★2026-09-06(티켓 `ndVIU4glmyuKaXPZrBWa`) `dispatchSingle`의 reuse 탈락 사유 진단을 추가 — dispatch 스코어링 경로이고 YOLO 실행·브라우저 승인 경계와는 별개다. ★2026-09-06(티켓 `m6pSfPKMgNog8qonXsu4`) Stage 3a: `WebTabAgentWriteGateway`(읽기 게이트웨이와 별개 인터페이스) + `/web-tab-agent-fill`·`/web-tab-agent-write-list` 라우트 추가 — 알림 배달 축(`resolveNotifyTarget`/`missionOrchestratorLookup`/`routeOrchestratorNotification`)·dispatch 스코어링 축과는 안 겹치는 별도 라우트다
- [PTY 위험 명령 방어](../../../v3/electron/danger-command.ts) — 브라우저 행동에 닿지 않는 현재 방어 범위
- [브라우저 세션 유출 가드](../../../v3/electron/web-automation/leakage-guards.ts) — 프롬프트·로그·IPC 경계
- [Google restricted/sensitive 스코프 보류 단일 진실원](../../../v3/electron/google-restricted-scopes.ts) — ★Stage 3(§"지메일은 반례") gmail 4도구가 전부 잠긴 이유(CASA 회피, sensitive도 0으로), 되살리는 절차
- [Gmail 발송 MCP 도구](../../../v3/electron/mcp-server/tools.ts) — ★`gmail_send`/`gmail_search`/`gmail_fetch`/`gmail_draft`는 "UNAVAILABLE IN THIS RELEASE", 대체 `mail_send`는 사용자 본인 주소로만 발송(제3자 불가) — 이 파일은 심볼 단위로만 이 노트의 근거다(`WIKI-SKIP.md`의 파일 전체 등재 규율과 같은 사유)
- [gmail_draft 대체 경로 설계](../../../v3/docs/GMAIL_DRAFT_REPLACEMENT.md) — ★확인 게이트(§"확인 게이트" 3b)가 그대로 가져온 "행동 전 전문 공개 + 다음 발화로 승인" 계약의 원본
- [시스템 브라우저 loopback OAuth](../../../v3/electron/google-oauth.ts) — ★Stage 3 로그인 안 (나)의 근거: 이 패턴은 토큰 교환이지 쿠키/세션 이전이 아니다(API 없는 사이트에는 적용 안 됨)
- [라이브 GUI 검증 금지](../../../AGENTS.md) — 창을 띄우지 않는 검증 제약
- [Aside 권한 문서](https://docs.aside.com/help/security) · [Aside 개발자/MCP 문서](https://docs.aside.com/help/developers) — 비교 사례의 1차 자료
- [Aside 시작 가이드](https://docs.aside.com/help/get-started) — ★2026-09-06(티켓 `x1QmdvVqMm14VXqGoxTT`) "Aside is the browser" 확인, 브라우저 데이터(기록·쿠키·북마크) 일회성 가져오기 확인
- [Aside 자격증명 가져오기](https://docs.aside.com/help/passwords) — ★2026-09-06 1Password/Bitwarden/Chrome/Edge/Firefox/LastPass 비밀번호 가져오기 확인, 구글 계열 도메인 동등 취급("google.com, youtube.com, gmail.com") 확인
- [Google OAuth 2.0 정책 — "Use secure browsers"](https://developers.google.com/identity/protocols/oauth2/policies#browsers) — ★2026-09-06 "임베디드 user-agent(개발자 통제하의, 임의 스크립트 삽입 가능)에 OAuth 요청을 보내면 안 된다"는 공식 정책 원문 확인. 우리 웹탭(`WebContentsView`)이 이 범주에 정확히 해당한다는 판정의 1차 근거
- [Aside 태스크 실행 문서](https://docs.aside.com/help/tasks) — Incognito/Default 모드, Steer/Queue, 태스크 상태·상세페이지(★2026-09-05 저녁 재조사, ★2026-09-06 "sign in with allowed autofill"이 태스크 중 로그인의 유일한 문서화 경로임을 재확인)
- [Aside 트러블슈팅 문서](https://docs.aside.com/help/troubleshooting) — 인증 화면 도달 시 동작, 승인 popover, 정지 수단 부재 확인(★2026-09-05 저녁 재조사)
- [Aside 패스워드 매니저 문서](https://docs.aside.com/help/password-manager) — 자격증명 값 비노출, 볼트 접근 정책 3값, 되돌릴 수 없는 행동 확인 문구의 공식 문서 출처(★2026-09-05 저녁 재조사)
- [Aside 프라이버시 문서](https://docs.aside.com/help/privacy) — 감사 로그 전용 문서 부재 확인(★2026-09-05 저녁 재조사)
- [Aside 요금제 페이지](https://aside.com/pricing) — Enterprise 카피 재확인, "audit" 단어 부재(★2026-09-05 저녁, 선행 문서 §2.5 정정 근거)

## Backlinks

- [[in-app-link-routing]]
- [[no-live-gui-verify]]
- [[web-tab-destination-debugging]]
