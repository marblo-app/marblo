# 링크 라우팅 사양 — 무엇을 앱 안에서 열고, 무엇을 밖으로 보내나

티켓 `pmpcvaEsswlsOLJDwer6`. 이 문서가 기준이고, 코드가 이 문서를 따른다.
동작은 `v3/tests/unit/route-app-external-link.test.ts` 와
`v3/tests/unit/web-tab-link-open.test.ts` 가 못박는다.

## 왜 사양부터 쓰나

"링크가 앱 밖으로 열린다" 는 버그 보고를 코드에서 갈랐더니, 코드는 **의도한 대로**
동작하고 있었다. `#1389` 이후 정책은 "loopback 의 다른 포트(로컬 데모)만 앱 탭,
나머지 외부는 전부 OS 브라우저" 였다. 즉 이건 구현 결함이 아니라 **사양이 사장님
기대와 어긋난 것**이었고("마블로 탭을 크롬 탭처럼"), 그래서 고칠 대상은 분기 하나가
아니라 사양이다.

## 원칙

1. **앱 안 Web 탭은 브라우저다.** 주소창에 쳐서 열 수 있는 것은 링크를 눌러서도
   열려야 한다. 이 둘이 갈리면 사용자는 규칙을 배울 수 없다.
2. **밖으로 나가는 건 예외이고, 예외는 이유를 말한다.** 조용히 나가는 경로는 없다.
3. **밖으로 보내는 이유는 하나뿐이다: 임베디드 브라우저 안에서 깨지기 때문.**
   "외부 사이트라서" 는 이유가 아니다.

## 규칙표

앱 자신의 콘텐츠(`isInternalNavigationUrl`)는 애초에 이 경로를 타지 않는다 —
앱 origin, Firebase auth 핸들러, GitHub OAuth 콜백이 그렇다. 그 밖의 클릭·
`target="_blank"`·`will-navigate` 가 `routeAppExternalLink` 로 온다.

| 링크 | 어디서 열리나 | 안내 |
|---|---|---|
| 일반 http(s) — `github.com`, `example.com`, 사내 문서 | **앱 안 Web 탭** | 없음(정상 동작) |
| 로컬 데모 — `localhost:8791` 등 앱 origin 이 아닌 loopback | **앱 안 Web 탭** | 없음 |
| 구글 로그인 — `accounts.google.com`, `oauth2.googleapis.com` | OS 브라우저 | `google-auth-external` |
| 그 밖의 로그인/OAuth — `login.microsoftonline.com`, `appleid.apple.com`, `github.com/login/oauth` | OS 브라우저 | `auth-external` |
| 결제 — Stripe checkout/billing, PayPal, 토스, 카카오페이, 이니시스, KCP | OS 브라우저 | `payment-external` |
| http(s) 가 아닌 스킴 — `mailto:`, `tel:`, `sms:`, `slack:`, `zoommtg:` | OS 기본 앱 | `external-protocol` |
| 지원하지 않는 스킴 — `javascript:`, `data:` 등 | **아무 데서도 안 열림** | `unsupported-protocol` |
| 깨진 URL | 안 열림 | `invalid-url` |

### 앱 탭으로 못 보내는 경우

| 상황 | 결과 | 안내 |
|---|---|---|
| Web 탭을 띄울 창이 없다(워크스페이스 셸이 안 떠 있음) | OS 브라우저 | `no-tab-target` |
| 렌더러가 1500ms 안에 ack 을 안 보냄 | OS 브라우저 | `tab-open-failed` |
| OS 브라우저 열기 자체가 실패 | 아무 일도 안 일어남 | `open-failed` |

안내는 OS 알림(`Notification`)으로 뜬다. **"조용히 밖에서 열림" 은 어느 칸에도 없다** —
그게 사장님이 겪으신 증상이었다.

## 로그인·결제를 왜 계속 밖으로 보내나

BrowserPane 은 `WebContentsView` 라 `X-Frame-Options` 와 무관하게 대부분의 사이트를
띄울 수 있다. 그런데도 이 둘은 예외로 남긴다:

- 구글은 임베디드 user agent 의 로그인을 **정책으로 거부한다**(`disallowed_useragent`).
  탭 안에서 열어 봐야 사용자는 막힌 화면을 본다.
- 마블로가 쓰는 loopback PKCE 플로우는 시스템 브라우저에서 끝나도록 설계돼 있고,
  그래야 사용자의 기존 로그인 세션·비밀번호 관리자를 쓸 수 있다.
- 결제는 사용자가 **주소창을 직접 보고** 신뢰를 판단할 수 있어야 한다. 앱이 그린
  주소창 안에서 카드번호를 넣게 만들 이유가 없다.

목록은 `in-app-browser-policy.ts` 의 `isGoogleAuthUrl` / `isKnownAuthUrl` /
`isKnownPaymentUrl` 에 있다. 새 사이트가 임베디드에서 깨지는 게 확인되면 그때 여기에
추가한다 — 추측으로 미리 넓히지 않는다.

## 앱 탭 쪽 보안

Web 탭이 임의의 웹을 앱 안에서 실행하는 건 맞다. 경계는 이렇다:

- `nodeIntegration: false`, `contextIsolation: true`
- 세션 파티션 분리(`persist:marblo-browser-tab`) — 앱의 Firebase 세션과 쿠키가 섞이지 않는다
- 페이지는 렌더러의 DOM 자식이 아니라 main 이 띄우는 별도 `WebContentsView` 다.
  preload 도 IPC 도 붙지 않는다

이건 이번 변경이 새로 연 게 아니다 — 주소창으로 임의 사이트를 여는 경로가 이미
같은 조건으로 돌고 있었고, 이번 변경은 **클릭이 주소창과 같은 자리로 가게** 했을 뿐이다.
