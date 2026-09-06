---
title: 웹 탭 목적지 문제는 세션과 UA 축을 독립적으로 떼어낸다
tags: [domain/investigations, topic/routing, topic/electron, verdict/undecidable]
status: active
date: 2026-09-06
links: [[in-app-link-routing]], [[control-must-differ-on-the-tested-axis]], [[no-live-gui-verify]]
---

> **한 줄 판정**: ★확인 못 함 — `쿠키 없음 + 우리 Electron UA` 조건이 `www.naver.com`에 머문 것이 확인돼 UA 단독 원인은 제외됐다. 사용자 Web 탭에는 네이버 쇼핑 계열 쿠키가 있고 `쿠키 있음 + 우리 Electron UA`에서만 `recoshopping.naver.com`으로 튄다. 남은 미측정 칸은 `쿠키 있음 + Chrome UA`라서, 쿠키만으로 충분한지 쿠키와 우리 UA 조합이 필요한지는 아직 확정하지 않는다.
>
> **두 번째 사례(2026-09-06, §로그인 목적지)**: ★채택 — 로그인 목적지는 세션 축도 정책 축도 아니었다. `claude.ai`는 분류상 이미 `allow`이고 이메일 폼 로그인 세션은 웹 탭에 남는다. 막고 있던 것은 **화면**이다 — notice 하나가 네이티브 뷰를 통째로 숨겨 살아 있는 로그인 페이지가 사라졌고, 돌아갈 길이 화면에 없었다.

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

### 다음 사람이 하는 일

★**같은 보고의 다른 반쪽 "하얀 쪼그만 창"은 아직 확인 못 함이다.** 코드로는 여기까지 좁혔다.

- 앱 전체에서 `new BrowserWindow`는 `createWindow()` 하나뿐이고 `minWidth 800`/`minHeight 600`이다. 따라서 "쪼그만" 창은 `setWindowOpenHandler`가 `{action:"allow"}`를 돌려줬을 때 Electron이 만드는 창밖에 없다.
- `allow`를 돌려주는 곳은 `applyExternalLinkHandling` 한 곳이고, 조건은 `isInternalNavigationUrl`이다 — app origin, firebase authDomain, `*.firebaseapp.com`, `*.web.app`, `accounts.google.com`, `github.com/login/oauth`, 그리고 **파싱 불가·비 http(s)(`about:blank` 포함)**.
- ★웹 탭 pane 자신의 handler는 **항상 deny**다. 등록 순서도 확인했다 — 전역 훅이 `WebContentsView` 생성 시 먼저 붙고 pane handler가 나중에 덮는다. **pane 안에서 클릭한 링크로는 네이티브 창이 안 생긴다.**
- 우리 렌더러·preload 어디에도 인자 없는/빈 문자열 `window.open(`은 없다. 그 2단계 패턴을 쓰던 xterm 기본 핸들러는 대체됐고(`terminalLinkOpen.ts`), 그 addon의 링크 정규식은 스킴을 요구하므로 스킴 없는 URL은 애초에 링크로 잡히지 않는다.
- 남는 갈래는 **"목적지가 왜 안 들어갔는가"** 하나다. `about:blank`를 `allow` 목록에서 떼는 것은 수리가 아니다 — 정당한 팝업 경로(Firebase `signInWithPopup`)가 같은 분기를 쓴다. 먼저 갈라야 한다.

그래서 사람이 화면에서 확인할 것 셋: (1) 그 창에 macOS 신호등 버튼이 있는가(있으면 별도 OS 창, 없으면 pane), (2) 어디서 클릭했는가, (3) 그 창의 주소가 무엇인가. GUI 자동화로 Electron 창을 띄우지 않는다.

수리는 `ADgrUCqL64oSiWJp0Qu4`(그 `allow` 창이 마블로 preload를 상속하는 보안 이슈)와 같은 분기를 건드리므로 함께 간다.

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

## Backlinks

- [[in-app-link-routing]]
- [[control-must-differ-on-the-tested-axis]]
- [[no-live-gui-verify]]
