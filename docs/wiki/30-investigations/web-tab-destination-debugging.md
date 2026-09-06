---
title: 웹 탭 목적지 문제는 세션과 UA 축을 독립적으로 떼어낸다
tags: [domain/investigations, topic/routing, topic/electron, verdict/undecidable]
status: active
date: 2026-09-06
links: [[in-app-link-routing]], [[control-must-differ-on-the-tested-axis]], [[no-live-gui-verify]]
---

> **한 줄 판정**: ★확인 못 함 — `쿠키 없음 + 우리 Electron UA` 조건이 `www.naver.com`에 머문 것이 확인돼 UA 단독 원인은 제외됐다. 사용자 Web 탭에는 네이버 쇼핑 계열 쿠키가 있고 `쿠키 있음 + 우리 Electron UA`에서만 `recoshopping.naver.com`으로 튄다. 남은 미측정 칸은 `쿠키 있음 + Chrome UA`라서, 쿠키만으로 충분한지 쿠키와 우리 UA 조합이 필요한지는 아직 확정하지 않는다.
>
> **세 번째 사례(2026-09-06, §하얀 쪼그만 창)**: ★채택 — 원인은 네 번째 축이었다. `{action:"allow"}` 는 "여기서 로드하라"가 아니라 **창을 새로 만들라**는 뜻인데, "밖으로 쫓아내면 안 되는가"의 술어가 그대로 창 생성 조건으로 재사용됐다. 목적지 없는 요청(빈 URL·`about:blank`·비 http(s)·앱 origin)이 전부 흰 창이 됐다. ★이 절이 이전에 적어 둔 두 가지(파싱 불가 분기가 `about:blank` 를 포함한다 / 팝업이 같은 분기를 쓴다)는 **둘 다 틀렸고 아래에서 정정했다**.
>
> **두 번째 사례(2026-09-06, §로그인 목적지)**: ★채택 — 로그인 목적지는 세션 축도 정책 축도 아니었다. `claude.ai`는 분류상 이미 `allow`이고 이메일 폼 로그인 세션은 웹 탭에 남는다. 막고 있던 것은 **화면**이다 — notice 하나가 네이티브 뷰를 통째로 숨겨 살아 있는 로그인 페이지가 사라졌고, 돌아갈 길이 화면에 없었다.
>
> **네 번째 사례(2026-09-06, §Electron UA 지문, PR #1487)**: ★채택(독립적으로) — `#1480`의 "웹탭은 실제 Chromium + 정상 UA라 Cloudflare 봇 차단과 무관"이라는 판정은 실제 웹탭 UA를 확인하지 않고 내린 것이었다(gstack 헤드리스 브라우저에 수동으로 데스크톱 UA를 지정해 검증했을 뿐). 웹탭 코드 어디에도 UA 오버라이드가 없어 `marblo-v3/3.0.39 … Electron/33.4.11` 두 토큰이 그대로 나간다. PR #1487은 이 중 **`Electron/<ver>` 토큰만** 제거했다(전역 UA 교체 아님, `marblo-v3` 토큰은 별개 티켓 `DOJ1vHG3Knl6KVyph0yx`의 축이라 일부러 남김). ★이 결함은 실재하지만 **오늘 사장님이 본 "에러"의 원인은 아니었다** — §"다섯 번째 사례"에서 사장님이 에러 문구를 직접 주셨고, claude.ai 자신의 404 페이지였다(Cloudflare·봇 차단·로드 실패 아님). PR #1487은 그대로 남되 인과 주장은 뗐다.
>
> **다섯 번째 사례(2026-09-06, §URL 충실도)**: ★채택 — **우리 버그가 아니다.** 사장님이 준 에러 문구("Page not found — Claude can help with many things, but finding this page isn't one of them.")를 이 세션이 실제로 소유·비공개 상태인 claude.ai 아티팩트(`claude.ai/code/artifact/<uuid>`)에 로그아웃 상태로 접속해 재현했다 — 문구가 글자 그대로 일치했다. claude.ai는 비공개 아티팩트에 로그인 없이 접근하면 "이 페이지는 비공개입니다" 류의 구분되는 안내가 아니라 **범용 404를 그대로 보여준다**(존재 여부를 숨기는 프라이버시 설계로 읽힌다). 즉 웹탭이 URL을 옳게 열었더라도 claude.ai 자신이 이 화면을 낸다 — 사장님의 "로그인 페이지로 넘어가야 하는 거 아냐" 기대는 claude.ai가 정하는 동작이라 우리가 못 바꾼다. 이걸로 이 티켓의 원인 조사는 끝난다.

## 무엇을 물었나

사장님이 Marblo Web 탭 주소창에 `naver.com`을 입력하면 최종 주소가 `https://recoshopping.naver.com/`이 된다고 보고했다. 이때 원인이 네이버의 사용자 세션 개인화 리다이렉트인지, Marblo 코드가 목적지를 바꾸는지, 또는 헤더/지역/시간대 차이인지 가르는 것이 질문이다.

## 먼저 떼어낼 축

**세션/쿠키와 UA 축을 독립적으로 떼어낸다.** 깨끗한 클라이언트에서 안 튀는 현상은 "네이버가 모두를 튕긴다"를 약하게 만들지만, 그 자체로 세션 원인을 확정하지 않는다. `temp:` agent 탭이 실제 Marblo Electron UA로도 안 튀면서 UA 단독 원인은 빠졌다. 다음 판별의 핵심은 같은 `persist:marblo-browser-tab` 세션에서 쿠키를 유지한 채 UA만 바꾸는 것이다.

| 축          | 대조                                                     |
| ----------- | -------------------------------------------------------- |
| 사용자 세션 | `persist:marblo-browser-tab`의 기존 네이버 쿠키          |
| 깨끗한 세션 | `temp:marblo-agent-browser` 또는 새 프로필/headless/curl |
| UA          | 앱 기본 UA와 데스크톱 Chrome UA override                 |
| URL         | `https://www.naver.com/`처럼 scheme과 host를 고정        |
| 금지        | 사장님 쿠키 삭제, 쿠키 값 출력, 앱 재시작, GUI 자동 검증 |

## 이번에 확인한 것

깨끗한 클라이언트 실측은 티켓 본문에 있다. 헤드리스 Chromium 새 프로필, `curl -IL`, 데스크톱 Chrome UA를 붙인 `curl -IL` 모두 최종 URL이 `https://www.naver.com/`이었다. 오케가 `web_tab_navigate`로 `temp:` agent 탭에서 `https://httpbin.org/user-agent`를 열어 확인한 실제 UA에는 `marblo-v3/3.0.38`, `Chrome/130.0.6723.191`, `Electron/33.4.11`이 들어 있었다. 이 UA로 `temp:` agent 탭에서 네이버를 열었을 때도 쇼핑으로 튀지 않았다.

로컬 사용자 Web 탭 partition의 Cookies DB에는 네이버 관련 `host_key`가 있었다. 값과 이름은 조회하지 않았다.

| host_key               | 개수 |
| ---------------------- | ---: |
| `.naver.com`           |    6 |
| `www.naver.com`        |    4 |
| `shopsquare.naver.com` |    1 |

이 사실은 세션/쿠키 가설과 맞지만, 이것만으로 `recoshopping.naver.com` 리다이렉트의 원인을 확정할 수는 없다. 이전 실험에서 쿠키와 클라이언트가 동시에 바뀌었기 때문이다.

## 필요한 관측 행렬

GUI 자동화로 Electron 창을 띄우지 않는다. 사장님 화면에서는 오케가 아래 조합을 직접 관측해야 한다.

| 조건                      | partition                    | 쿠키 | UA                                           | 상태                                      |
| ------------------------- | ---------------------------- | ---- | -------------------------------------------- | ----------------------------------------- |
| A. 현재 재현              | `persist:marblo-browser-tab` | 있음 | 앱 기본값: `marblo-v3/... Electron/...` 포함 | 이미 재현: `recoshopping.naver.com`       |
| B. 같은 세션, Chrome UA   | `persist:marblo-browser-tab` | 있음 | 데스크톱 Chrome override                     | ★필수 다음 관측                           |
| C. 깨끗한 앱 partition    | `temp:marblo-agent-browser`  | 없음 | 앱 기본값: `marblo-v3/... Electron/...` 포함 | 이미 안 튐. UA 단독 원인 제외             |
| D. 외부 깨끗한 클라이언트 | 새 프로필/headless/curl      | 없음 | 기본 또는 Chrome UA                          | 이미 안 튐                                |
| E. 실제 Web 탭 UA         | `persist:marblo-browser-tab` | 있음 | 앱 기본값                                    | 확인됨: 앱 토큰과 Electron 토큰 모두 포함 |

판정 규칙은 좁게 둔다.

| 관측                     | 판정                                                                                                                            |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------- |
| B도 튀고 C/D는 안 튐     | 세션/쿠키/계정 개인화 가능성이 가장 높다. 그래도 쿠키 값은 보지 않고 삭제하지 않는다.                                           |
| B에서 멈추고 A만 튐      | 쿠키+우리 Electron UA 조합이 필요했을 가능성이 높다. 전역 UA 변경은 다른 사이트 동작을 바꾸므로 별도 승인 없이 머지하지 않는다. |
| C도 튐                   | 쿠키만으로 설명되지 않는다. 앱 기본 UA, Electron 헤더, partition 동작, 네트워크 조건을 다시 판다.                               |
| 관측이 충돌하거나 부족함 | `확인 못 함`으로 남긴다.                                                                                                        |

## 코드 경로 판정

주소창 submit은 검색 질의로 바뀌지 않는다. 렌더러의 `BrowserPane`은 `naver.com`을 `https://naver.com`으로 정규화해 pane store에 넣고, main의 `browserPane:navigate`는 같은 정규화/분류 뒤 `loadURL`한다.

`setWindowOpenHandler`는 현재 pane을 쇼핑 URL로 덮는 경로로 보이지 않는다. 사용자 Web 탭의 `WebContentsView`는 `persist:marblo-browser-tab` partition으로 만들어지고, pane 전용 handler는 page가 연 새 창 요청을 앱 Web 탭 라우팅으로 보낸다. 전역 `will-navigate`도 in-app browser pane에서는 물러선다.

#1459의 `will-redirect` 재검사는 사용자 pane에 적용되지 않는다. merge commit 기준으로 해당 listener는 `record.partition !== "temp:marblo-agent-browser"`이면 즉시 return한다. 사용자 Web 탭의 기본 partition은 `persist:marblo-browser-tab`이다.

Web 탭 코드에서 `setUserAgent`, `session.setUserAgent`, `app.userAgentFallback`, `--user-agent` 설정 경로는 찾지 못했다. `v3/package-lock.json`의 Electron은 `33.4.11`이다. Electron 공식 문서 기준으로 UA는 `webContents` 또는 `session`에 설정이 없으면 app fallback을 쓰며, `persist:` partition은 persistent session이다. 런타임 실측도 코드 판정과 맞았다. 현재 Web 탭 UA에는 일반 브라우저에 없는 `marblo-v3/3.0.38`과 `Electron/33.4.11`이 둘 다 들어간다.

UA 단독은 이번 네이버 리다이렉트의 원인이 아니지만, Web 탭 일반 정책으로는 별도 계측 대상이다. 기존 위키에도 `Electron/33.4.11 marblo-v3/3.0.38` 지문은 관찰만 하고 고치지 않았다는 기록이 있다. Google OAuth는 embedded user-agent를 공식적으로 거부하므로 이미 외부 브라우저 예외로 빠져 있다. 다른 쇼핑/결제/문서 사이트까지 전역 UA를 바꾸는 것은 영향 범위가 넓어 별도 티켓에서 계측과 설계를 먼저 한다.

## 로그인 목적지 (2026-09-06)

### 무엇을 물었나

사장님이 클로드 아티팩트 링크를 눌렀고 "이건 안 들어가져"라고 보고했다. 로그인이 필요한 사이트를 웹 탭에서 못 쓰는 원인이 **정책 축**(우리가 로그인 URL을 밖으로 쳐낸다)인가, **세션 축**(로그인해도 세션이 웹 탭에 안 남는다)인가, 아니면 **화면 축**(둘 다 되는데 사용자가 거기까지 못 간다)인가.

### 무엇을 했나

정책 축을 코드로 읽고, 세션 축은 로그인 화면을 실제로 열어 무엇을 주는지 확인했다. 로그인은 시도하지 않았고 계정 정보도 넣지 않았다. 스냅샷과 폼 구조만 봤다.

### 관측값

| 축   | 관측                                                                                                                                                                                                                                                                                       | 근거                                                               |
| ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------ |
| 정책 | `classifyInAppBrowserNavigation`은 auth **패턴**이 아니라 **호스트 화이트리스트**다 — `accounts.google.com`·`oauth2.googleapis.com`·`login.microsoftonline.com`·`appleid.apple.com`·`github.com/login/oauth`와 결제 호스트들. `claude.ai`도 `claude.ai/login`도 목록에 없어 `allow`다      | `in-app-browser-policy.ts`                                         |
| 정책 | 경로형 auth 정규식(`/login\|/signin\|/oauth\|/authorize`)은 다른 파일에만 있고, **에이전트 전용 비영속 파티션에서만** 돈다. 사람 웹 탭에는 안 걸린다                                                                                                                                       | `browser-pane-agent-read-policy.ts`의 `isLikelyAuthenticationPath` |
| 세션 | `claude.ai/login`은 `[button] "Continue with Google"`과 `[input type=email]` + `[button type=submit] "Continue with email"`을 **둘 다** 준다. 후자의 form action은 `https://claude.ai/login` — 호스트를 안 벗어난다                                                                        | 헤드리스 스냅샷, 데스크톱 UA                                       |
| 화면 | notice가 **하나라도** 있으면 `shouldShowNativeBrowserView`가 네이티브 뷰를 통째로 숨긴다. OAuth 이동은 취소만 됐을 뿐 로그인 페이지는 그대로 살아 있는데, 화면에서는 사라지고 전체화면 실패 카드가 덮는다. 그 카드의 행동 버튼은 하나 — "외부 브라우저로 열기", 앱이 이미 스스로 한 일이다 | `browser-pane-visibility.ts`, `BrowserPane.tsx`                    |

### 판정

**정책 축은 원인이 아니다.** 티켓들이 들고 있던 "auth 패턴 URL이 external로 쳐내진다"는 믿음은 이 저장소 코드와 다르다. 패턴 규칙은 존재하지만 사람 웹 탭이 아니라 에이전트 파티션의 것이다.

**세션 축도 원인이 아니다.** 폼 로그인은 호스트를 안 벗어나 `allow`로 분류되고, 그 세션은 `persist:marblo-browser-tab`에 남는다. 즉 "한 번 로그인하면 그다음부터 웹 탭에서 그냥 열린다"는 새 정책 완화나 세션 임포트 없이 **오늘 코드로 이미 성립한다**.

**원인은 화면이다.** 구글 로그인이 밖으로 나가는 것 자체는 맞다 — 구글이 임베디드 웹뷰 로그인을 정책으로 거부한다. 틀린 것은 그다음이다. 같은 페이지에 있는 되는 경로(이메일 폼)를 화면이 말해 주지 않았고, 그 페이지로 돌아갈 수단도 없었다. 사용자에게 이것은 "정책이 막았다"가 아니라 **막다른 길**로 보인다.

**일반화: 밖으로 내보내는 분기는 이유만 말하면 부족하다. 앱 안에 되는 경로가 남아 있으면 그것을 말하고, 거기로 돌아갈 수단을 같이 줘야 한다.** 이유만 있는 화면은 "왜 안 되는지 아는 막다른 길"이지 여전히 막다른 길이다.

### 세 번째 사례 — "하얀 쪼그만 창" (2026-09-06, PR #1485)

★**코드로 근본 원인이 잡혔다.** 위 단락들이 좁혀 둔 것 중 **두 가지가 틀렸으므로 아래로 정정한다.**

| 이전에 여기 적혀 있던 것                                                                                   | 실제                                                                                                                                                                                                                                                                                                                      |
| ---------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `isInternalNavigationUrl` 의 파싱 불가 분기가 **`about:blank` 를 포함**한다                                | ★틀렸다. `new URL("about:blank")` 는 정상 파싱돼 **비 http(s) 분기**에서 걸린다. 파싱 실패 분기가 잡는 것은 **스킴 없는 상대 URL 뿐**이다. 옛 소스 주석이 그 예시를 잘못 달아 둔 것을 그대로 옮겨 적었다                                                                                                                  |
| `about:blank` 를 `allow` 에서 떼는 것은 수리가 아니다 — Firebase `signInWithPopup` 이 **같은 분기를 쓴다** | ★틀렸다. 설치본을 열어 호출부까지 따라간 결과 팝업은 그 분기를 **쓰지 않는다**. `_open` 의 `url` 은 선언상 선택 인자라 `window.open(url \|\| '', …)` 의 기본값이 붙어 있을 뿐이고, 실제 호출부는 하나이며 그 인자는 authDomain 단언(없으면 **던진다**) 뒤 `https://…` 템플릿 리터럴로 만들어져 **빈 문자열이 될 수 없다** |

**판정: 원인은 정책 축도 세션 축도 화면 축도 아닌 네 번째 축 — 창 생성 축이다.** `applyExternalLinkHandling` 이 `isInternalNavigationUrl`(= "OS 브라우저로 쫓아내면 안 되는가")을 그대로 "네이티브 창을 만들어도 되는가"의 조건으로 재사용했다. Electron 의 `{action:"allow"}` 는 "여기서 로드하라"가 아니라 **BrowserWindow 를 새로 만들라**는 뜻이므로, 외부 http(s) 가 아니기만 하면(빈 문자열·`about:blank`·`blob:`/`data:`/`javascript:`/`file:`·앱 origin) **목적지 없는 흰 창**이 만들어졌다. 하얀 이유는 로드할 것이 없어서고, 안 채워지는 이유는 실제 내비게이션이 Web 탭으로 라우팅돼 그 창에 영영 아무것도 안 오기 때문이다. 규칙은 [[in-app-link-routing]] §함정 3 으로 옮겼다.

이전 단락의 관찰 중 **살아남은 것**: pane 자신의 handler 는 여전히 항상 `deny` 이고 등록 순서도 그대로다. 우리 렌더러·preload 에 무인자 `window.open(` 은 여전히 없다. ★바로 그것이 "호출부가 아니라 분기를 고쳐야 한다"의 근거였다 — 우리 호출부는 이미 다 고쳐졌는데 증상이 남았다는 건 창을 여는 주체가 **통제 밖 페이지·서드파티 JS** 라는 뜻이고, 그러면 호출부 추적은 끝이 없다.

### 아직 확인 못 한 것

★**"어떤 페이지의 어떤 JS 가 그 창을 열었나"는 특정하지 못했다.** 수리는 창이 만들어지는 유일한 통로를 닫으므로 증상은 원인 신원과 무관하게 사라지지만, 신원 자체는 미지다. 그래서 억제 분기에 지문 로그(사유·opener id·url)를 같이 넣었다 — 다음 재현 때 신원이 거기 남는다.

사람이 화면에서 확인할 것 셋은 그대로다: (1) 그 창에 macOS 신호등 버튼이 있는가, (2) 어디서 클릭했는가, (3) 그 창의 주소가 무엇인가. GUI 자동화로 Electron 창을 띄우지 않는다.

★**(1)이 "없음"으로 오면 이 수리의 대상이 아니다.** 신호등이 없으면 그것은 네이티브 창이 아니라 앱 안에 그려진 흰 pane 이고, 조사는 `BrowserPane` 의 bounds/visibility 축으로 옮겨가야 한다. 그 경우 PR #1485 는 여전히 옳지만(창 생성 축의 실제 결함을 닫는다) 이 증상을 닫지는 못한다.

`ADgrUCqL64oSiWJp0Qu4`(그 `allow` 창이 마블로 preload를 상속하는 보안 이슈)는 같은 분기다. 이 수리가 노출면을 **auth 팝업 하나로** 줄였고, 남은 그 하나의 preload 분리는 그 티켓이 갖는다.

### 네 번째 사례 — "Electron UA 지문" (2026-09-06, PR #1487, 티켓 `MXA0mMmF9IHqrMzvkRqH`)

**무엇을 물었나.** 재시작 직후 사장님이 클로드 아티팩트 링크(`claude.ai`)를 눌렀는데 로그인 화면 대신 에러가 떴다. §"로그인 목적지"가 이미 정책 축·세션 축을 아니라고 좁혀 놨으므로 남은 후보는 pane 로드 자체의 실패였다. `#1480`은 "Cloudflare가 claude.ai 앞에 있지만 마블로 웹탭은 실제 Chromium + 정상 UA라 무관"이라고 판정했었다 — 이 절은 그 판정을 재검증한다.

**관측값.** 위 §"코드 경로 판정"·[[browser-session-approval-boundary]] §"UA 지문"에 이미 남겨 뒀던 실측이 그대로 답이었다: Web 탭 코드 어디에도 `setUserAgent`/`session.setUserAgent`/`app.userAgentFallback` 오버라이드가 없고, 실제 UA에는 두 토큰이 그대로 들어간다 — `marblo-v3/3.0.39 Chrome/130.0.6723.191 Electron/33.4.11`. ★이 문서의 첫 초안은 이 값을 앱 밖에서 돌린 임시 스크립트로 재확인했다가 `marblo-v3/…` 토큰을 놓쳤다 — 그 스크립트가 이 앱의 `package.json`을 못 찾아 `app.getName()`이 Electron 기본값("Electron")으로 떨어졌고, 그 경로에서는 이 토큰이 아예 안 붙는다. 실제 패키지 이름(`marblo-v3`)으로 다시 실행해 정정했다.

**판정.** ★채택(부분) — "정상 UA라 무관"은 틀렸다. 그 판정은 gstack 헤드리스 브라우저에 **수동으로 데스크톱 UA를 지정해서** 검증한 것이지 웹탭의 실제 UA가 아니었다. `Electron/<ver>` 토큰은 어떤 소비자용 브라우저에도 없고, Cloudflare를 비롯한 봇 탐지가 정확히 이런 비표준 토큰으로 가른다. PR #1487은 `stripElectronUserAgentBranding` 순수 함수로 **그 토큰만** 제거해 human web 탭 세션(`persist:marblo-browser-tab`)에 적용했다 — 나머지(OS·WebKit·Chrome 버전)는 이 빌드가 내장한 실제 Chromium 값 그대로라 거짓이 아니다. ★**`marblo-v3/<ver>` 토큰은 일부러 남겼다** — 그건 다른 질문(우리 앱 식별 토큰을 빼도 되는가, 텔레메트리·업스테이지 식별 헤더 논의와 어떻게 다른가)이고, 티켓 `DOJ1vHG3Knl6KVyph0yx`가 "조사 먼저, 승인 없이 머지 금지"로 이미 갖고 있다. 두 토큰을 한 PR에서 같이 떼면 그 조사를 건너뛰게 된다.

**왜.** §"코드 경로 판정"의 결론("UA 단독은 이번 네이버 리다이렉트의 원인이 아니지만 … 별도 티켓에서 계측과 설계를 먼저 한다")과 [[browser-session-approval-boundary]] §"UA 지문"의 "관찰만 하고 고치지 않았다"가 합쳐져 실제 결함(웹탭이 스스로 자동화 프레임워크임을 광고한다) 전체가 방치돼 있었다. 이번 fix는 그중 **`Electron/<ver>` 축만** 닫는다 — 이건 "전역 UA를 다른 값으로 바꾸면 다른 사이트 동작까지 바뀐다"는 경고에 해당하지 않는다고 판단했다: 토큰 전체를 스푸핑하는 게 아니라 브라우저에는 원래 없던 토큰 하나를 빼는 것뿐이라, 결과가 이 Electron 빌드가 내장한 진짜 Chrome UA와 글자 그대로 같아진다. `marblo-v3/<ver>` 축은 그 경고가 그대로 적용되는 다른 질문이라 `DOJ1vHG3Knl6KVyph0yx`로 넘긴다.

**한계.** ★후속(§다섯 번째 사례)에서 확정됨 — 이 fix는 오늘 CEO가 본 "에러"의 원인이 **아니었다.** 사장님이 에러 문구를 직접 주셨고 claude.ai 자신의 404였다. 그렇다고 이 fix를 되돌리지 않는다 — `Electron/<ver>` 토큰 노출은 이 사건과 무관하게 그 자체로 실재하는 결함이다. PR #1487은 인과 주장만 빼고 그대로 남겼다.

**코드 변경(R5).** 있음 — `electron/in-app-browser-policy.ts`(신규 순수 함수), `electron/main.ts`(`persist:marblo-browser-tab` 파티션당 1회 `session.setUserAgent` 적용), `tests/unit/in-app-browser-policy.test.ts`(신규 3건, 함수를 identity로 되돌리는 뮤테이션으로 신규 2건이 red가 됨을 확인).

### 다섯 번째 사례 — "URL 충실도" (2026-09-06, 티켓 `MXA0mMmF9IHqrMzvkRqH`) — ★해결됨, 우리 버그 아님

**무엇을 물었나.** 사장님이 에러 문구를 그대로 주셨다:

> Page not found — Claude can help with many things, but finding this page isn't one of them.

이건 claude.ai 자신의 404 페이지다. 서버가 정상 응답(200/404)했고 우리 pane도 정상적으로 그렸다는 뜻 — 즉 라우팅 실패(첫 번째~네 번째 사례가 살핀 정책·세션·화면·창 생성·UA 전부)가 아니다. 남는 질문은 **claude.ai가 이 문구를 정확히 언제 보여주는가** 하나였다. ★사장님께 더 여쭐 수 없어(클릭 출처·원본 href 둘 다 못 받음) 오케 지시대로 관측 대신 측정으로 갔다.

**어떻게 쟀나.** gstack `/browse`로 claude.ai를 직접 열어 문구를 대조군별로 받아 적었다(로그인 시도 없음, 로그아웃 상태 — 사장님 웹탭 파티션과 같은 축). 첫 시도는 gstack 기본 헤드리스 UA로 403 Cloudflare 챌린지에 막혔고(`#1480`이 이미 문서화한 축, 이 저장소와 무관), 데스크톱 Chrome UA로 바꿔도 `/code/session_*`·`/login`·임의 경로는 여전히 챌린지가 걸렸다(간헐적) — 반면 아티팩트 경로(`/public/artifacts/*`, `/code/artifact/*`)는 대체로 곧장 통과했다.

★**결정적 대조군:** 이 세션이 방금 발행한 **진짜, 실존하는, 비공유(비공개) 아티팩트** `https://claude.ai/code/artifact/43111538-a1a4-4e8c-a9aa-2e92e971ec86`를 로그아웃 상태로 열었다:

```
Page not foundClaude can help with many things, but finding this page isn't one of them.Go back home
```

★**사장님 문구와 글자 그대로 일치한다.** 임의로 지어낸 UUID(`00000000-...`, `11111111-...`)로도 같은 문구가 떴다 — 즉 claude.ai는 "존재하지 않는 아티팩트"와 "존재하지만 비공개/미공유인 아티팩트"를 **같은 화면으로 구분 없이** 보여준다(둘 다 로그인 없이는 접근 불가라는 사실 자체를 숨기는 프라이버시 설계로 읽힌다).

**판정.** ★**우리 버그가 아니다.** claude.ai 아티팩트는 기본이 비공개이고("Artifacts start private" — 발행 도구 자체의 명시된 동작), 웹탭이 그 URL을 한 글자도 안 틀리고 정확히 열었더라도 로그인 없는 세션에는 claude.ai가 이 화면을 보여준다. 웹탭이 정확한 URL을 열었는지(§처음 물었던 "URL 충실도" 질문)는 이 결과로 더 이상 답할 필요가 없어졌다 — **맞았어도 틀렸어도 같은 화면이 뜨기 때문이다.** 사장님의 "로그인 페이지로 넘어가야 하는 거 아냐" 기대는 claude.ai가 정하는 동작이고 웹탭 쪽에서 바꿀 수 없다.

**우리가 할 수 있는 것 — 별도 검토 사안으로 남긴다(이 티켓에서 구현하지 않음).** 404 화면에 "로그인이 필요한 콘텐츠일 수 있습니다" 같은 안내를 웹탭 쪽에서 얹는 것은 가능해 보인다(`did-frame-navigate`가 `httpResponseCode`를 주므로 감지 자체는 어렵지 않다, `#1480`이 이미 notice·복귀 표면을 만들어 뒀다). ★단 404를 "로그인 필요"로 단정하면 안 된다 — 오늘 실측대로 "진짜 없는 페이지"와 "비공개"가 문구로 구분 안 되므로, 안내 문구가 그 불확실성을 정직하게 말해야 한다. 이 재현 티켓의 범위를 넘는 새 UI라 여기서 구현하지 않고 다음 사람이 판단할 근거만 남긴다.

**우리 자신이 뿌리는 `claude.ai/code/session_...` 링크는 어떤가 — 별개 축, 확인 못 함.** 커밋 트레일러·PR 본문에 매번 들어가는 그 링크 형식(`/code/session_*`)은 이번 실측에서 매번 Cloudflare JS 챌린지에 걸렸다(아티팩트 경로와 다르게 일관되게). 실제 사용자의 진짜 Chromium(헤드리스 아님, `navigator.webdriver` 없음)이라면 그 챌린지를 투명하게 통과할 가능성이 높지만, 그 뒤에 진짜 세션 페이지가 뜨는지 접근 거부가 뜨는지는 로그인 세션이 있어야 확인되고 여기서는 확인 못 했다. claude.ai의 URL 규약을 하드코딩해 우리 쪽에서 판단하지 말라는 오케 지시대로, 이 축은 열어만 두고 닫지 않는다 — 필요하면 별도 티켓.

### xterm 정규식 후보 — 닫음(재현 테스트로 고정, 수리는 보류)

§"다섯 번째 사례"가 시작될 때 세운 후보(`WebLinksAddon`의 기본 `urlRegex`가 URL 본문의 괄호에서 매치를 끊는다)는 **이 사건의 원인이라는 근거가 끝내 없었다** — 클릭 출처(터미널인지조차)를 확인 못 했고, 오늘 원인은 claude.ai의 프라이버시 설계로 이미 설명됐다. ★그래도 결함 자체는 실재하므로 [v3/tests/unit/terminal-link-open.test.ts](../../../v3/tests/unit/terminal-link-open.test.ts)에 재현 테스트로 고정했다(`@xterm/addon-web-links@0.11.0`의 기본 정규식으로 `.../wiki/Bracket_(disambiguation)` 같은 URL이 `.../wiki/Bracket_`으로 잘리는 것을 직접 실행해 확인).

★**수리는 시도했다가 보류했다.** 괄호를 한 겹까지 허용하는 대체 정규식을 프로토타입했는데, **바로 그 테스트 케이스에서 원래 정규식과 똑같이 잘렸다** — 원인은 정규식이 "본문\* + 트레일링 제외 문자 1개" 형태라 그리디 매칭이 마지막에 통째 괄호 단위를 한 겹 되돌리면서 트레일링 검사가 다시 그 여는 괄호에 걸리는 구조적 문제였다. 손으로 다시 짜는 것 자체가 보기보다 까다롭다는 것을 직접 증명한 셈이라, **확정되지 않은 원인 하나 때문에 검증 안 된 정규식을 라이브 코드에 넣는 위험**을 감수하지 않기로 했다. 고칠 값이 있다는 판단엔 동의하지만, 별도 티켓에서 제대로 테스트 스위트를 갖추고 시도하는 게 맞다.

## 제품 답

세션/쿠키로 판명되면 Marblo 코드의 목적지 버그가 아니다. 그때 고칠 것은 "왜 튀나"가 아니라 "사용자가 원하는 곳으로 가는 방법"이다.

제품 선택지는 네 가지다.

| 선택지           | 의미                                                                                                                                                                                   |
| ---------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 안내             | 네이버가 이 세션에서 개인화 리다이렉트하는 것일 수 있음을 알려 주고 `www.naver.com` 직접 입력 또는 시스템 브라우저 확인을 안내                                                         |
| 세션 분리        | Web 탭에 "새 깨끗한 탭" 같은 비영속/별도 partition 선택지를 둔다                                                                                                                       |
| 사이트 설정 안내 | 네이버 맞춤형 광고 차단 설정을 안내한다. 공식 안내에는 쿠키/이용 기록 기반 맞춤형 광고 허용/차단이 있지만, 이 설정이 `recoshopping.naver.com` 리다이렉트를 끄는지는 아직 확인 못 했다. |
| 제한 예외        | `naver.com` -> `recoshopping.naver.com` 같은 특정 리다이렉트만 사용자 확인 후 되돌리는 규칙을 둔다                                                                                     |

기본값은 안내 또는 세션 분리다. 특정 사이트 리다이렉트를 앱이 임의로 되돌리면 정상적인 사용자 선택과 사이트 정책까지 꺾을 수 있어 근거가 더 필요하다.

사장님이 지금 바로 시도할 수 있는 낮은 비용 조치는 아래다. 둘 다 성공 보장은 아니며, 성공/실패를 관측으로 남긴다.

| 조치                                      | 경로                                                                                               | 기대                                                                                                                    |
| ----------------------------------------- | -------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| 네이버 맞춤형 광고 차단                   | `https://gam.naver.com/optout/main`의 "네이버 내 맞춤형 광고"를 차단                               | 쇼핑 행태 기반 개인화가 같은 시스템이면 리다이렉트가 사라질 수 있다. 전용 리다이렉트 토글은 공식 문서에서 확인 못 했다. |
| 네이버앱 콘텐츠탭 수동 정렬               | 네이버앱 주제 탭 마지막 "투데이탭 설정"에서 직접 순서 변경                                         | 앱 첫 화면/탭 추천 문제에는 관련 가능성이 있지만, Web 탭 PC 리다이렉트에 영향을 주는지는 확인 못 했다.                  |
| `recoshopping` 페이지 내부 탈출 링크 확인 | 현재 떠 있는 `recoshopping.naver.com` 화면에서 네이버 로고, "네이버 메인", "기본 화면"류 링크 확인 | 공개 쿠키 없는 접근은 빈 본문이라 직접 화면에서만 확인 가능하다.                                                        |

## 수단이 생겼다 (2026-09-06, 티켓 `nvrzSFU0xJMPuRqr0EeR`)

위 "제한 예외" 안과 가장 가까운 형태로 **사이트 데이터 초기화 경로**가 생겼다.
`BrowserPane.tsx` 툴바의 "사이트 데이터 지우기" 버튼 → 확인 모달(지워질 항목
쿠키·캐시·서비스워커·로컬스토리지, 저장된 쿠키의 name/domain/expiry 미리보기 —
값은 보여주지 않는다) → 확인 클릭 시 `browserPane:clearSiteData` IPC →
`session.fromPartition(record.partition).clearStorageData({ origin, storages })`
(`browser-pane-site-data-policy.ts`)까지 실제로 배선됐다.

★**왜 origin 스코프인가.** `persist:marblo-browser-tab` 파티션 전체를 지우면
사장님이 그 탭에서 로그인해 둔 다른 모든 사이트(구글·노션 등)의 로그인이 같이
죽는다. `naver.com` 하나를 고치려고 그걸 전부 잃을 이유가 없다 — 그래서
`clearStorageData`에 `origin` 하나만 좁혀 넘긴다. 파티션 전체를 지우는 버튼은
만들지 않았다.

★**아직 눌러서 확인한 게 아니다.** "수단이 생겼다"와 "이걸로
`recoshopping.naver.com` 리다이렉트가 실제로 사라진다"는 서로 다른 주장이다.
사장님이 직접 이 버튼으로 `naver.com` 사이트 데이터를 지우고 다시
`naver.com`을 열어 `www.naver.com`에 머무는지 확인해야 이 조사의 판정이
"확인됨"으로 바뀐다. 그때까지 위 상단의 "★확인 못 함" 판정은 그대로 유효하다
— 이 절은 **수단이 생겼다는 사실만** 기록하고, 고쳤다고 선언하지 않는다.

## Evidence

- [v3/src/components/workspace/BrowserPane.tsx](../../../v3/src/components/workspace/BrowserPane.tsx) — 주소창 submit과 URL 정규화, 그리고 notice가 떴을 때 무엇을 그리는가(§로그인 목적지의 화면 축)
- [v3/electron/main.ts](../../../v3/electron/main.ts) — `WebContentsView` 생성, partition, `setWindowOpenHandler`, `will-navigate`, `browserPane:navigate`
- [v3/electron/in-app-browser-policy.ts](../../../v3/electron/in-app-browser-policy.ts) — URL 정규화와 in-app browser navigation 분류. ★external 판정은 호스트 화이트리스트다
- [v3/electron/browser-pane-agent-read-policy.ts](../../../v3/electron/browser-pane-agent-read-policy.ts) — 경로형 auth 정규식 `isLikelyAuthenticationPath`가 사는 곳. 에이전트 비영속 파티션 전용이다
- [v3/src/lib/browser-pane-visibility.ts](../../../v3/src/lib/browser-pane-visibility.ts) — notice 하나에 네이티브 뷰를 통째로 숨기는 규칙
- [v3/src/lib/browser-pane-external-notice.ts](../../../v3/src/lib/browser-pane-external-notice.ts) — 로그인 계열 외부화에 대안 문구와 복귀 경로를 붙이는 순수 판정
- [v3/electron/browser-pane-site-data-policy.ts](../../../v3/electron/browser-pane-site-data-policy.ts) — ★2026-09-06(티켓 `nvrzSFU0xJMPuRqr0EeR`) §"수단이 생겼다"의 근거 — origin 산출, 카테고리→storages 매핑, 확인 게이트
- [v3/src/components/workspace/ClearSiteDataModal.tsx](../../../v3/src/components/workspace/ClearSiteDataModal.tsx) — ★2026-09-06(티켓 `nvrzSFU0xJMPuRqr0EeR`) 지워질 항목과 쿠키 미리보기(값 없음)를 보여주는 확인 모달
- [Stage 3 (라)안 — 사람이 폼 로그인해 둔 사이트만 다룬다](../20-constraints/browser-session-approval-boundary.md)
- PR #1459 merge commit `39a4ce91e26465d924416a7c1670527e4793775f` — agent navigation partition과 `will-redirect` 재검사 범위
- PR #1480 — §로그인 목적지의 화면 축 수리(문구 + "이 페이지로 돌아가기"). 렌더러만 바꿨다
- PR #1481 — ★2026-09-06(티켓 `nvrzSFU0xJMPuRqr0EeR`) §"수단이 생겼다"의 사이트 데이터 초기화 UI·IPC. 검증(리다이렉트가 실제로 사라지는지)은 사장님 몫으로 남아 있다
- Marblo ticket `Gy1k4HDh3xXYcuey1hiy` — 깨끗한 클라이언트 실측과 사장님 재현 보고
- Marblo ticket `hN350qFSgsohYhkrn1nM` — 같은 persistent 세션에서 UA만 바꾸는 후속 판별 요청
- Naver 맞춤형 광고 안내 `https://gam.naver.com/optout/main` — 쿠키/이용 기록 기반 맞춤형 광고 허용/차단 설정은 확인됨. 리다이렉트 차단 토글 여부는 확인 못 함.
- Naver 고객센터 `https://help.naver.com/service/30016/contents/23557?lang=ko&osType=COMMONOS` — 맞춤형 광고는 브라우저 쿠키/모바일 앱 광고 식별자를 사용하며 설정으로 허용/차단 가능
- Naver 고객센터 `https://help.naver.com/service/5630/contents/24226?osType=COMMONOS` — 네이버앱 콘텐츠탭은 AI 추천 순서와 직접 순서 변경이 있음
- Naver 고객센터 `https://help.naver.com/service/5630/contents/1096` — 네이버앱에는 재실행 시 네이버앱 홈으로 이동 ON/OFF가 있음
- Naver 고객센터 `https://help.naver.com/service/30016/contents/18042?lang=ko&osType=PC` — 브라우저 시작 페이지를 `https://www.naver.com/`으로 지정하는 공식 안내
- Naver Ads 공지 `https://ads.naver.com/notice/16407?page=1&searchValue=` — 로그인 사용자의 쇼핑 이력 기반 네이버 PC 메인 쇼핑 광고/추천 노출은 공식적으로 설명됨.
- Electron app docs `https://www.electronjs.org/docs/latest/api/app#appuseragentfallback` — app-level UA fallback
- Electron session docs `https://www.electronjs.org/docs/latest/api/session#sessetuseragentuseragent-acceptlanguages` — session-level UA override and persistent partitions
- Marblo ticket `6iultrqezxzGXD8a9zIl` / `hnNTDAoEzKVysTM3Q6BI` — 2026-09-06 사장님 보고("하얀 쪼그만 창" + "이건 안 들어가져")
- PR #1485 — ★§하얀 쪼그만 창의 수리. 창 생성 판정을 라우팅 술어에서 분리했다
- [v3/tests/unit/app-window-open-policy.test.ts](../../../v3/tests/unit/app-window-open-policy.test.ts) — 창을 내주는 조건과 억제 사유를 못박는 테스트
- [v3/tests/unit/firebase-auth-popup-url-invariant.test.ts](../../../v3/tests/unit/firebase-auth-popup-url-invariant.test.ts) — ★"팝업이 같은 분기를 쓴다"가 틀렸다는 판정의 근거를 설치본에서 계속 지킨다
- Marblo ticket `MXA0mMmF9IHqrMzvkRqH` — 2026-09-06 사장님 재현("클로드 아티팩트는 에러 나와 이거 로그인 페이지로 넘어가야 되는 거 아냐?")
- PR #1487 — ★§네 번째 사례("Electron UA 지문")의 수리. `stripElectronUserAgentBranding`으로 human web 탭 세션에서 `Electron/<ver>` 토큰만 제거
- [v3/tests/unit/in-app-browser-policy.test.ts](../../../v3/tests/unit/in-app-browser-policy.test.ts) — ★`stripElectronUserAgentBranding`을 이 저장소 Electron 33.4.11로 실측한 UA 문자열로 못박는 테스트
- Marblo ticket `DOJ1vHG3Knl6KVyph0yx` — `marblo-v3/<ver>` 토큰 축(앱 식별 토큰을 빼도 되는가). PR #1487이 이 축을 건드리지 않기로 한 결정의 근거
- 사장님 관측(2026-09-06, §다섯 번째 사례) — 에러 문구 원문: "Page not found — Claude can help with many things, but finding this page isn't one of them." claude.ai 자신의 404임을 확정한 근거
- gstack `/browse` 실측(2026-09-06) — `https://claude.ai/code/artifact/43111538-a1a4-4e8c-a9aa-2e92e971ec86`(이 세션이 발행한 실존·비공개 아티팩트, 로그아웃 상태로 접속)가 사장님 문구와 글자 그대로 일치하는 404를 반환함을 직접 확인. 임의 UUID(`00000000-...`, `11111111-...`) 대조군도 동일. `/code/session_*`·`/login`·임의 경로는 매번 Cloudflare 챌린지에 걸려 대조군으로 못 씀
- [v3/src/lib/terminalLinkOpen.ts](../../../v3/src/lib/terminalLinkOpen.ts) — 터미널 링크 클릭이 실제 URL을 한 단계로 넘기는 경로(이미 #1413에서 고침)
- [v3/src/components/terminal/TerminalView.tsx](../../../v3/src/components/terminal/TerminalView.tsx) — `new WebLinksAddon(openTerminalLink)` — `urlRegex`를 오버라이드하지 않아 라이브러리 기본 정규식(괄호가 URL 본문 어디에 있어도 매치를 끊음)을 그대로 쓴다. §"xterm 정규식 후보" 근거
- [v3/tests/unit/terminal-link-open.test.ts](../../../v3/tests/unit/terminal-link-open.test.ts) — ★`@xterm/addon-web-links@0.11.0` 기본 정규식이 URL 본문 괄호에서 매치를 끊는 것을 재현 테스트로 고정(버전 핀 포함). 이 사건의 원인이라는 주장은 하지 않는다
- `v3/node_modules/@xterm/addon-web-links@0.11.0` 소스 — 기본 `urlRegex`가 `(`·`)`를 URL 끝뿐 아니라 본문에서도 매치 종료 문자로 다룬다는 것을 직접 확인

## Backlinks

- [[in-app-link-routing]]
- [[control-must-differ-on-the-tested-axis]]
- [[no-live-gui-verify]]
- [[browser-session-approval-boundary]]
