---
title: 웹 탭 목적지 문제는 세션과 UA 축을 독립적으로 떼어낸다
tags: [domain/investigations, topic/routing, topic/electron, verdict/undecidable]
status: active
date: 2026-09-06
links: [[in-app-link-routing]], [[control-must-differ-on-the-tested-axis]], [[no-live-gui-verify]]
---

> **한 줄 판정**: ★확인 못 함 — `쿠키 없음 + 우리 Electron UA` 조건이 `www.naver.com`에 머문 것이 확인돼 UA 단독 원인은 제외됐다. 사용자 Web 탭에는 네이버 쇼핑 계열 쿠키가 있고 `쿠키 있음 + 우리 Electron UA`에서만 `recoshopping.naver.com`으로 튄다. 남은 미측정 칸은 `쿠키 있음 + Chrome UA`라서, 쿠키만으로 충분한지 쿠키와 우리 UA 조합이 필요한지는 아직 확정하지 않는다.

## 무엇을 물었나

사장님이 Marblo Web 탭 주소창에 `naver.com`을 입력하면 최종 주소가 `https://recoshopping.naver.com/`이 된다고 보고했다. 이때 원인이 네이버의 사용자 세션 개인화 리다이렉트인지, Marblo 코드가 목적지를 바꾸는지, 또는 헤더/지역/시간대 차이인지 가르는 것이 질문이다.

## 먼저 떼어낼 축

**세션/쿠키와 UA 축을 독립적으로 떼어낸다.** 깨끗한 클라이언트에서 안 튀는 현상은 "네이버가 모두를 튕긴다"를 약하게 만들지만, 그 자체로 세션 원인을 확정하지 않는다. `temp:` agent 탭이 실제 Marblo Electron UA로도 안 튀면서 UA 단독 원인은 빠졌다. 다음 판별의 핵심은 같은 `persist:marblo-browser-tab` 세션에서 쿠키를 유지한 채 UA만 바꾸는 것이다.

| 축 | 대조 |
| --- | --- |
| 사용자 세션 | `persist:marblo-browser-tab`의 기존 네이버 쿠키 |
| 깨끗한 세션 | `temp:marblo-agent-browser` 또는 새 프로필/headless/curl |
| UA | 앱 기본 UA와 데스크톱 Chrome UA override |
| URL | `https://www.naver.com/`처럼 scheme과 host를 고정 |
| 금지 | 사장님 쿠키 삭제, 쿠키 값 출력, 앱 재시작, GUI 자동 검증 |

## 이번에 확인한 것

깨끗한 클라이언트 실측은 티켓 본문에 있다. 헤드리스 Chromium 새 프로필, `curl -IL`, 데스크톱 Chrome UA를 붙인 `curl -IL` 모두 최종 URL이 `https://www.naver.com/`이었다. 오케가 `web_tab_navigate`로 `temp:` agent 탭에서 `https://httpbin.org/user-agent`를 열어 확인한 실제 UA에는 `marblo-v3/3.0.38`, `Chrome/130.0.6723.191`, `Electron/33.4.11`이 들어 있었다. 이 UA로 `temp:` agent 탭에서 네이버를 열었을 때도 쇼핑으로 튀지 않았다.

로컬 사용자 Web 탭 partition의 Cookies DB에는 네이버 관련 `host_key`가 있었다. 값과 이름은 조회하지 않았다.

| host_key | 개수 |
| --- | ---: |
| `.naver.com` | 6 |
| `www.naver.com` | 4 |
| `shopsquare.naver.com` | 1 |

이 사실은 세션/쿠키 가설과 맞지만, 이것만으로 `recoshopping.naver.com` 리다이렉트의 원인을 확정할 수는 없다. 이전 실험에서 쿠키와 클라이언트가 동시에 바뀌었기 때문이다.

## 필요한 관측 행렬

GUI 자동화로 Electron 창을 띄우지 않는다. 사장님 화면에서는 오케가 아래 조합을 직접 관측해야 한다.

| 조건 | partition | 쿠키 | UA | 상태 |
| --- | --- | --- | --- | --- |
| A. 현재 재현 | `persist:marblo-browser-tab` | 있음 | 앱 기본값: `marblo-v3/... Electron/...` 포함 | 이미 재현: `recoshopping.naver.com` |
| B. 같은 세션, Chrome UA | `persist:marblo-browser-tab` | 있음 | 데스크톱 Chrome override | ★필수 다음 관측 |
| C. 깨끗한 앱 partition | `temp:marblo-agent-browser` | 없음 | 앱 기본값: `marblo-v3/... Electron/...` 포함 | 이미 안 튐. UA 단독 원인 제외 |
| D. 외부 깨끗한 클라이언트 | 새 프로필/headless/curl | 없음 | 기본 또는 Chrome UA | 이미 안 튐 |
| E. 실제 Web 탭 UA | `persist:marblo-browser-tab` | 있음 | 앱 기본값 | 확인됨: 앱 토큰과 Electron 토큰 모두 포함 |

판정 규칙은 좁게 둔다.

| 관측 | 판정 |
| --- | --- |
| B도 튀고 C/D는 안 튐 | 세션/쿠키/계정 개인화 가능성이 가장 높다. 그래도 쿠키 값은 보지 않고 삭제하지 않는다. |
| B에서 멈추고 A만 튐 | 쿠키+우리 Electron UA 조합이 필요했을 가능성이 높다. 전역 UA 변경은 다른 사이트 동작을 바꾸므로 별도 승인 없이 머지하지 않는다. |
| C도 튐 | 쿠키만으로 설명되지 않는다. 앱 기본 UA, Electron 헤더, partition 동작, 네트워크 조건을 다시 판다. |
| 관측이 충돌하거나 부족함 | `확인 못 함`으로 남긴다. |

## 코드 경로 판정

주소창 submit은 검색 질의로 바뀌지 않는다. 렌더러의 `BrowserPane`은 `naver.com`을 `https://naver.com`으로 정규화해 pane store에 넣고, main의 `browserPane:navigate`는 같은 정규화/분류 뒤 `loadURL`한다.

`setWindowOpenHandler`는 현재 pane을 쇼핑 URL로 덮는 경로로 보이지 않는다. 사용자 Web 탭의 `WebContentsView`는 `persist:marblo-browser-tab` partition으로 만들어지고, pane 전용 handler는 page가 연 새 창 요청을 앱 Web 탭 라우팅으로 보낸다. 전역 `will-navigate`도 in-app browser pane에서는 물러선다.

#1459의 `will-redirect` 재검사는 사용자 pane에 적용되지 않는다. merge commit 기준으로 해당 listener는 `record.partition !== "temp:marblo-agent-browser"`이면 즉시 return한다. 사용자 Web 탭의 기본 partition은 `persist:marblo-browser-tab`이다.

Web 탭 코드에서 `setUserAgent`, `session.setUserAgent`, `app.userAgentFallback`, `--user-agent` 설정 경로는 찾지 못했다. `v3/package-lock.json`의 Electron은 `33.4.11`이다. Electron 공식 문서 기준으로 UA는 `webContents` 또는 `session`에 설정이 없으면 app fallback을 쓰며, `persist:` partition은 persistent session이다. 런타임 실측도 코드 판정과 맞았다. 현재 Web 탭 UA에는 일반 브라우저에 없는 `marblo-v3/3.0.38`과 `Electron/33.4.11`이 둘 다 들어간다.

UA 단독은 이번 네이버 리다이렉트의 원인이 아니지만, Web 탭 일반 정책으로는 별도 계측 대상이다. 기존 위키에도 `Electron/33.4.11 marblo-v3/3.0.38` 지문은 관찰만 하고 고치지 않았다는 기록이 있다. Google OAuth는 embedded user-agent를 공식적으로 거부하므로 이미 외부 브라우저 예외로 빠져 있다. 다른 쇼핑/결제/문서 사이트까지 전역 UA를 바꾸는 것은 영향 범위가 넓어 별도 티켓에서 계측과 설계를 먼저 한다.

## 제품 답

세션/쿠키로 판명되면 Marblo 코드의 목적지 버그가 아니다. 그때 고칠 것은 "왜 튀나"가 아니라 "사용자가 원하는 곳으로 가는 방법"이다.

제품 선택지는 네 가지다.

| 선택지 | 의미 |
| --- | --- |
| 안내 | 네이버가 이 세션에서 개인화 리다이렉트하는 것일 수 있음을 알려 주고 `www.naver.com` 직접 입력 또는 시스템 브라우저 확인을 안내 |
| 세션 분리 | Web 탭에 "새 깨끗한 탭" 같은 비영속/별도 partition 선택지를 둔다 |
| 사이트 설정 안내 | 네이버 맞춤형 광고 차단 설정을 안내한다. 공식 안내에는 쿠키/이용 기록 기반 맞춤형 광고 허용/차단이 있지만, 이 설정이 `recoshopping.naver.com` 리다이렉트를 끄는지는 아직 확인 못 했다. |
| 제한 예외 | `naver.com` -> `recoshopping.naver.com` 같은 특정 리다이렉트만 사용자 확인 후 되돌리는 규칙을 둔다 |

기본값은 안내 또는 세션 분리다. 특정 사이트 리다이렉트를 앱이 임의로 되돌리면 정상적인 사용자 선택과 사이트 정책까지 꺾을 수 있어 근거가 더 필요하다.

사장님이 지금 바로 시도할 수 있는 낮은 비용 조치는 아래다. 둘 다 성공 보장은 아니며, 성공/실패를 관측으로 남긴다.

| 조치 | 경로 | 기대 |
| --- | --- | --- |
| 네이버 맞춤형 광고 차단 | `https://gam.naver.com/optout/main`의 "네이버 내 맞춤형 광고"를 차단 | 쇼핑 행태 기반 개인화가 같은 시스템이면 리다이렉트가 사라질 수 있다. 전용 리다이렉트 토글은 공식 문서에서 확인 못 했다. |
| 네이버앱 콘텐츠탭 수동 정렬 | 네이버앱 주제 탭 마지막 "투데이탭 설정"에서 직접 순서 변경 | 앱 첫 화면/탭 추천 문제에는 관련 가능성이 있지만, Web 탭 PC 리다이렉트에 영향을 주는지는 확인 못 했다. |
| `recoshopping` 페이지 내부 탈출 링크 확인 | 현재 떠 있는 `recoshopping.naver.com` 화면에서 네이버 로고, "네이버 메인", "기본 화면"류 링크 확인 | 공개 쿠키 없는 접근은 빈 본문이라 직접 화면에서만 확인 가능하다. |

## Evidence

- [v3/src/components/workspace/BrowserPane.tsx](../../../v3/src/components/workspace/BrowserPane.tsx) — 주소창 submit과 URL 정규화
- [v3/electron/main.ts](../../../v3/electron/main.ts) — `WebContentsView` 생성, partition, `setWindowOpenHandler`, `will-navigate`, `browserPane:navigate`
- [v3/electron/in-app-browser-policy.ts](../../../v3/electron/in-app-browser-policy.ts) — URL 정규화와 in-app browser navigation 분류
- PR #1459 merge commit `39a4ce91e26465d924416a7c1670527e4793775f` — agent navigation partition과 `will-redirect` 재검사 범위
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

## Backlinks

- [[in-app-link-routing]]
- [[control-must-differ-on-the-tested-axis]]
- [[no-live-gui-verify]]
