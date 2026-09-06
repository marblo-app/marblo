---
title: 웹 탭 목적지 문제는 세션 축을 먼저 떼어낸다
tags: [domain/investigations, topic/routing, topic/electron, verdict/undecidable]
status: active
date: 2026-09-06
links: [[in-app-link-routing]], [[control-must-differ-on-the-tested-axis]], [[no-live-gui-verify]]
---

# 웹 탭 목적지 문제는 세션 축을 먼저 떼어낸다

> **한 줄 판정**: ★확인 못 함 — 깨끗한 클라이언트는 `naver.com`에서 `recoshopping.naver.com`으로 튀지 않았고, 사용자 웹 탭의 persistent partition에는 네이버 쿠키가 있었다. 코드가 목적지를 쇼핑 URL로 바꾸는 경로는 찾지 못했지만, 사장님 화면의 비영속 파티션 대조가 아직 없어 세션 원인으로 확정하지 않는다.

## 무엇을 물었나

사장님이 Marblo Web 탭 주소창에 `naver.com`을 입력하면 최종 주소가 `https://recoshopping.naver.com/`이 된다고 보고했다. 이때 원인이 네이버의 사용자 세션 개인화 리다이렉트인지, Marblo 코드가 목적지를 바꾸는지, 또는 헤더/지역/시간대 차이인지 가르는 것이 질문이다.

## 먼저 떼어낼 축

**세션/쿠키 축을 먼저 떼어낸다.** 깨끗한 클라이언트에서 안 튀는 현상은 "네이버가 모두를 튕긴다"와 "UA가 진범이다"를 약하게 만든다. 같은 URL을 persistent 사용자 Web 탭과 비영속 agent browser partition에서 나란히 열어야 한다.

| 축 | 대조 |
| --- | --- |
| 사용자 세션 | `persist:marblo-browser-tab` |
| 깨끗한 세션 | 새 프로필/headless/curl 또는 `temp:marblo-agent-browser` |
| URL | `https://www.naver.com/`처럼 scheme과 host를 고정 |
| 금지 | 사장님 쿠키 삭제, 쿠키 값 출력, 앱 재시작, GUI 자동 검증 |

## 이번에 확인한 것

깨끗한 클라이언트 실측은 티켓 본문에 있다. 헤드리스 Chromium 새 프로필, `curl -IL`, 데스크톱 Chrome UA를 붙인 `curl -IL` 모두 최종 URL이 `https://www.naver.com/`이었다.

로컬 사용자 Web 탭 partition의 Cookies DB에는 네이버 관련 `host_key`가 있었다. 값과 이름은 조회하지 않았다.

| host_key | 개수 |
| --- | ---: |
| `.naver.com` | 6 |
| `www.naver.com` | 4 |
| `shopsquare.naver.com` | 1 |

이 사실은 세션/쿠키 가설과 맞지만, 이것만으로 `recoshopping.naver.com` 리다이렉트의 원인을 확정할 수는 없다. 쿠키 존재는 원인 후보를 강화할 뿐이다.

## 코드 경로 판정

주소창 submit은 검색 질의로 바뀌지 않는다. 렌더러의 `BrowserPane`은 `naver.com`을 `https://naver.com`으로 정규화해 pane store에 넣고, main의 `browserPane:navigate`는 같은 정규화/분류 뒤 `loadURL`한다.

`setWindowOpenHandler`는 현재 pane을 쇼핑 URL로 덮는 경로로 보이지 않는다. 사용자 Web 탭의 `WebContentsView`는 `persist:marblo-browser-tab` partition으로 만들어지고, pane 전용 handler는 page가 연 새 창 요청을 앱 Web 탭 라우팅으로 보낸다. 전역 `will-navigate`도 in-app browser pane에서는 물러선다.

#1459의 `will-redirect` 재검사는 사용자 pane에 적용되지 않는다. merge commit 기준으로 해당 listener는 `record.partition !== "temp:marblo-agent-browser"`이면 즉시 return한다. 사용자 Web 탭의 기본 partition은 `persist:marblo-browser-tab`이다.

## 다음 관측

사장님 화면에서는 사람이 직접 아래를 확인해야 한다. GUI 자동화로 Electron 창을 띄우지 않는다.

1. Web 탭 주소창에 `naver.com`을 입력했을 때 최종 URL이 `https://recoshopping.naver.com/`인지 본다.
2. 같은 앱에서 비영속 agent browser 경로로 `https://www.naver.com/`을 열었을 때 최종 URL이 `https://www.naver.com/`인지 본다.
3. Web 탭 주소창에 `https://www.naver.com/`을 직접 넣어도 `recoshopping.naver.com`으로 튀는지 본다.

2가 안 튀고 1/3만 튀면 세션/쿠키 개인화 리다이렉트로 판정한다. 2도 튀면 세션이 아니라 요청 헤더, 지역, 시간대, 앱 요청 차이를 다시 봐야 한다.

## 제품 답

세션/쿠키로 판명되면 Marblo 코드의 목적지 버그가 아니다. 그때 고칠 것은 "왜 튀나"가 아니라 "사용자가 원하는 곳으로 가는 방법"이다.

제품 선택지는 세 가지다.

| 선택지 | 의미 |
| --- | --- |
| 안내 | 네이버가 이 세션에서 개인화 리다이렉트하는 것일 수 있음을 알려 주고 `www.naver.com` 직접 입력 또는 시스템 브라우저 확인을 안내 |
| 세션 분리 | Web 탭에 "새 깨끗한 탭" 같은 비영속/별도 partition 선택지를 둔다 |
| 제한 예외 | `naver.com` -> `recoshopping.naver.com` 같은 특정 리다이렉트만 사용자 확인 후 되돌리는 규칙을 둔다 |

기본값은 안내 또는 세션 분리다. 특정 사이트 리다이렉트를 앱이 임의로 되돌리면 정상적인 사용자 선택과 사이트 정책까지 꺾을 수 있어 근거가 더 필요하다.

## Evidence

- [v3/src/components/workspace/BrowserPane.tsx](../../../v3/src/components/workspace/BrowserPane.tsx) — 주소창 submit과 URL 정규화
- [v3/electron/main.ts](../../../v3/electron/main.ts) — `WebContentsView` 생성, partition, `setWindowOpenHandler`, `will-navigate`, `browserPane:navigate`
- [v3/electron/in-app-browser-policy.ts](../../../v3/electron/in-app-browser-policy.ts) — URL 정규화와 in-app browser navigation 분류
- PR #1459 merge commit `39a4ce91e26465d924416a7c1670527e4793775f` — agent navigation partition과 `will-redirect` 재검사 범위
- Marblo ticket `Gy1k4HDh3xXYcuey1hiy` — 깨끗한 클라이언트 실측과 사장님 재현 보고

## Backlinks

- [[in-app-link-routing]]
- [[control-must-differ-on-the-tested-axis]]
- [[no-live-gui-verify]]
