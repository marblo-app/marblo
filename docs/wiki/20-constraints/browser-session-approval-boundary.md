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

## Evidence

- [Aside 자동 브라우징 현재 상태 조사](../../../v3/docs/aside-browser-agent-feasibility-2026-09-05.md) — 공식 자료와 Marblo 현재 경계의 근거 정리
- [인앱 브라우저 정책](../../../v3/electron/in-app-browser-policy.ts) — 세션 파티션과 인증·결제 라우팅
- [웹탭 생성·IPC 구현](../../../v3/electron/main.ts) — `WebContentsView` 표면과 pane 배선, ★스테이지 1의 `agentReadWebTabPane`/`browserPane:setAgentReadAccess`/`browserPane:setGlobalAgentStop`
- [웹탭 preload API](../../../v3/electron/preload.ts) — 렌더러에 노출된 웹탭 조작 표면 + 스테이지 1 읽기 승인/전역 중지 API
- [스테이지 1 읽기 정책(순수, 단위테스트)](../../../v3/electron/browser-pane-agent-read-policy.ts) — 승인 판정·전역 중지·레이트리밋·redaction
- [스테이지 1 읽기 추출(`executeJavaScript`)](../../../v3/electron/browser-pane-agent-read.ts) — CDP를 붙이지 않은 이유가 여기 문서화되어 있다
- [에이전트 YOLO 실행 경로](../../../v3/electron/bridge-server.ts) — 승인 없는 기본 실행, ★`WebTabAgentReadGateway`. ★2026-09-05(티켓 `DmfFZdKpNig5AiZ7Bp3p`) `GET /vendor-secret-presence` 라우트 추가 — 실행 경로가 아니라 벤더 키 존재 여부(값 없음) 조회라 YOLO 실행·승인 경계에는 닿지 않는다. 티켓 `Hw8j7iceXh1SFL5eDcRS`의 base 경고도 spawn prompt만 보강하고 브라우저 권한·승인 경계를 건드리지 않는다. ★2026-09-06(티켓 `rjoTuGmIlXJQpjDvWMMR`) `/notify-orchestrator`의 PTY 거절 사유 진단(`describeNotifyRefusal`)을 추가 — 오케 알림 배달 경로이고 브라우저 실행·승인 경계와는 별개다
- [PTY 위험 명령 방어](../../../v3/electron/danger-command.ts) — 브라우저 행동에 닿지 않는 현재 방어 범위
- [브라우저 세션 유출 가드](../../../v3/electron/web-automation/leakage-guards.ts) — 프롬프트·로그·IPC 경계
- [라이브 GUI 검증 금지](../../../AGENTS.md) — 창을 띄우지 않는 검증 제약
- [Aside 권한 문서](https://docs.aside.com/help/security) · [Aside 개발자/MCP 문서](https://docs.aside.com/help/developers) — 비교 사례의 1차 자료
- [Aside 태스크 실행 문서](https://docs.aside.com/help/tasks) — Incognito/Default 모드, Steer/Queue, 태스크 상태·상세페이지(★2026-09-05 저녁 재조사)
- [Aside 트러블슈팅 문서](https://docs.aside.com/help/troubleshooting) — 인증 화면 도달 시 동작, 승인 popover, 정지 수단 부재 확인(★2026-09-05 저녁 재조사)
- [Aside 패스워드 매니저 문서](https://docs.aside.com/help/password-manager) — 자격증명 값 비노출, 볼트 접근 정책 3값, 되돌릴 수 없는 행동 확인 문구의 공식 문서 출처(★2026-09-05 저녁 재조사)
- [Aside 프라이버시 문서](https://docs.aside.com/help/privacy) — 감사 로그 전용 문서 부재 확인(★2026-09-05 저녁 재조사)
- [Aside 요금제 페이지](https://aside.com/pricing) — Enterprise 카피 재확인, "audit" 단어 부재(★2026-09-05 저녁, 선행 문서 §2.5 정정 근거)

## Backlinks

- [[in-app-link-routing]]
- [[no-live-gui-verify]]
