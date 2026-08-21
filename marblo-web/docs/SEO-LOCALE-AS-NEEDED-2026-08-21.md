# 루트를 한국어 실제 페이지로 — `localePrefix: "as-needed"` (2026-08-21)

티켓: `5N8Ttuga3ZQ1XhUdKSqo` · 대상: https://marblo.app

선행 문서:

- `SEO-WHY-NO-TRAFFIC-2026-08-21.md` — 트래픽 0 의 진짜 원인은 도메인 나이·백링크 0
- `SEO-REDIRECT-CHAIN-2026-08-21.md` §B — 루트를 200 으로 만드는 안을 **당시엔 기각**했다
- `SEO-LOCALE-DEFAULT-KO-2026-08-21.md` — `defaultLocale` 을 `ko` 로 (URL 변경 없음)

이 문서는 §B 의 기각을 **뒤집는다.** 그때 세운 재개 조건 셋 중 실제로 충족된
것은 하나뿐이다(§6.5 에 있는 그대로 적었다). 뒤집는 근거는 조건 충족이 아니라
**미루는 비용이 계속 오르기 때문**이다 — 색인이 24개인 지금이 가장 싸다.

---

## 0. 결론 먼저

| 무엇                     | 전                      | 후                   |
| ------------------------ | ----------------------- | -------------------- |
| `marblo.app/`            | **307** → `/en`         | **200** 한국어       |
| `/pricing` (접두사 없음) | **307** → `/en/pricing` | **200** 한국어       |
| `/ko/pricing`            | 200 한국어              | **301** → `/pricing` |
| `/en/*` · `/ja/*`        | 200                     | **200 (무변경)**     |
| 사이트맵 루트 포함       | ❌ (리디렉션이라 불가)  | ✅ 55 URL 전부 200   |

되돌리기: `src/i18n/routing.ts` 의 `LOCALE_PREFIX` 를 `"always"` 로. 다만
§6 을 먼저 읽어라 — **한 줄로 되돌아가지만 공짜는 아니다.**

---

## 1. ★사장님 전제 하나를 정정한다 — "ko 는 어차피 크롤링 안 되잖아"

**블로그 기준으로는 맞다. 전부는 아니다.**

`SEO-WHY-NO-TRAFFIC-2026-08-21.md` 가 Startpage 로 건진 색인 목록에 ko 일반
페이지가 들어 있다:

```
/ko   /ko/download   /ko/pricing   /ko/lectures
```

`as-needed` 로 가면 이 4개의 URL 이 **바뀐다**(`/ko/pricing` → `/pricing`).

그래서 이 작업의 전제는 **"잃을 게 없다" 가 아니라 "지금이 잃을 게 가장 적은
시점이다"** 다. 그리고 그게 이 작업을 지금 하는 **이유**이기도 하다:

> 색인된 페이지가 많아질수록 옮길 게 많아진다. 24개인 지금이 가장 싸고,
> 앞으로 계속 비싸지기만 한다.

색인 4개를 잃지 않기 위해 필요한 건 하나뿐이다 — **301**. §3 이 그 이야기다.

---

## 2. 왜 루트가 200 이어야 하나

`marblo.app/` 은 사이트에서 가장 중요한 URL이다. 공유 링크도, 언젠가 생길
백링크도, 명함도, 앱 안의 "홈" 도 전부 그 URL 을 가리킨다. 그런데 그게 307
리디렉션이면:

1. **사이트맵에 넣을 수 없다.** 리디렉션하는 URL 을 넣으면 구글이 "Page with
   redirect" 로 분류하고 버린다. 실제로 `app/sitemap.ts` 에는 "루트를 넣지
   마라" 는 불변식 주석이 박혀 있었다.
2. **링크 자산이 한 홉을 거쳐 샌다.** 리디렉션 체인은 크롤 예산을 쓰고 PageRank
   전달을 희석한다.
3. **그 홉의 목적지가 영어였다.** 매출은 한국어인데.

그리고 `defaultLocale: "ko"`(#1115) 가 이미 들어와 있으므로, 루트가 200 이 되는
순간 그 200 은 **한국어**다. 두 변경이 맞물려야 의미가 생긴다.

---

## 3. ★핵심 — 307 이 아니라 301 이어야 한다

`localePrefix: "as-needed"` 만 켜면 next-intl 이 `/ko/pricing` → `/pricing`
리디렉션을 **알아서** 해준다. 문제는 **상태 코드**다.

next-intl 은 자기가 내는 모든 로케일 리디렉션을 **307** 로 낸다
(`middleware.js` 의 `e.redirect(l.toString())` — 상태 코드를 받지 않는다).
그런데 이 사이트에는 성격이 전혀 다른 두 종류의 로케일 리디렉션이 섞여 있다:

| 리디렉션                   | 무엇에 따라 목적지가 정해지나        | 올바른 코드 |
| -------------------------- | ------------------------------------ | ----------- |
| `/pricing` → `/en/pricing` | Accept-Language / `NEXT_LOCALE` 쿠키 | **307**     |
| `/ko/pricing` → `/pricing` | 아무것도 아님 — 경로가 로케일을 고정 | **301**     |

- 앞의 것을 301 로 내면 **한국 방문자 브라우저가 그 URL 을 영어로 영구 캐시**한다.
  되돌릴 방법이 없다.
- 뒤의 것을 307 로 두면 **구글은 `/ko/pricing` 을 계속 정본으로 취급한다.**
  색인이 안 옮겨간다. 그러면 이 작업의 §1 이 통째로 실패한다.

그래서 `src/lib/localeRedirect.ts` 가 **"기본 로케일 접두사 제거인 경우에만"**
301 로 승격한다. 요청 경로만 보고 판단하지 않고 **목적지까지 대조**한다 —
`/ko/*` 요청이 예상 밖의 곳으로 가면 next-intl 의 307 을 그대로 둔다. 여기서
잘못 판단한 301 은 브라우저 캐시에서 회수할 수 없는 유일한 실수다.

### 승계한 것: `Set-Cookie: NEXT_LOCALE`

직접 301 을 만들지 않고 **next-intl 이 만든 응답의 헤더를 그대로 승계**해
상태 코드만 바꾼다. 이유는 쿠키다.

```
$ curl -sI -H 'accept-language: en-US' /ko/pricing
HTTP/1.1 301 Moved Permanently
location: /pricing
set-cookie: NEXT_LOCALE=ko; Path=/; SameSite=lax
```

이게 없으면 영어권 방문자가 스테일 `/ko/...` 링크를 눌렀을 때 `/pricing` 에서
Accept-Language 로 재협상돼 **영어 페이지로 튕긴다.** 쿠키가 살아 있으면
한국어에 안착한다 — 실측:

```
$ curl -sL --cookie-jar j -H 'accept-language: en-US' /ko/pricing
final: /pricing (200)   →   <html lang="ko">
```

### 호스트까지 겹쳐도 1홉

`#1114` 가 www→apex 를 1홉으로 접어 놨다. 접두사 제거와 겹치면 두 홉이 될 수
있어서 `canonicalTarget()` 에 `permanent` 를 넘겨 하나로 접는다:

```
www.marblo.app/ko/pricing  →  301  →  https://marblo.app/pricing     (1홉)
```

---

## 4. 실측 — 변경 전/후 프로덕션 빌드 프로브 diff

주장이 아니라 실측이다. `origin/main`(c06b5222) 과 이 브랜치를 각각
`next build && next start` 로 띄우고 **동일한 111개 프로브**를 돌려 diff 했다.

> 프로브는 리디렉션을 따라가지 않는다 — 첫 홉의 상태 코드와 `Location` 이 전부다.
> Googlebot 은 보통 `Accept-Language` 를 보내지 않으므로, 헤더 없는 행이 곧
> 크롤러가 보는 모습이다.

**바뀐 111개 중 53개. 나머지 58개는 완전 동일.**

### 4.1 ★`/ko/*` → `/*` 301 전수 (21/21)

```
/ko                                   200  →  301 /
/ko/guide                             200  →  301 /guide
/ko/lectures                          200  →  301 /lectures
/ko/lectures/marblo-v3-masterclass    200  →  301 /lectures/marblo-v3-masterclass
/ko/pricing                           200  →  301 /pricing
/ko/download                          200  →  301 /download
/ko/founders                          200  →  301 /founders
/ko/founders/faq                      200  →  301 /founders/faq
/ko/blog                              200  →  301 /blog
/ko/faq                               200  →  301 /faq
/ko/legal/privacy                     200  →  301 /legal/privacy
/ko/legal/terms                       200  →  301 /legal/terms
/ko/legal/refund                      200  →  301 /legal/refund
/ko/legal/business                    200  →  301 /legal/business
/ko/bugs                              200  →  301 /bugs
/ko/notice                            200  →  301 /notice
/ko/beta-survey                       200  →  301 /beta-survey
/ko/blog/what-is-marblo               200  →  301 /blog/what-is-marblo
/ko/blog/getting-started              200  →  301 /blog/getting-started
/ko/foundation50            308 /ko/founders     →  308 /founders      (2홉 → 1홉)
/ko/founders/feedback       308 /ko/beta-survey  →  308 /beta-survey   (2홉 → 1홉)
```

★색인된 4개(`/ko`, `/ko/download`, `/ko/pricing`, `/ko/lectures`) 전부 301 이다.
빠진 것 없음. 홉 수도 실측했다 — 전부 **1홉**:

```
/ko/pricing            1 hops -> /pricing    (200)
/ko                    1 hops -> /           (200)
/ko/foundation50       1 hops -> /founders   (200)
/foundation50          1 hops -> /founders   (200)
/founders/feedback     1 hops -> /beta-survey(200)
/ko/founders/feedback  1 hops -> /beta-survey(200)
```

### 4.2 ★루트와 접두사 없는 경로가 200 이 됐다 (20개)

```
/                            307 /en                    →  200
/pricing                     307 /en/pricing            →  200
/guide /lectures /download /founders /founders/faq /blog /faq
/legal/{privacy,terms,refund,business} /bugs /notice /beta-survey
/blog/what-is-marblo /blog/getting-started               → 전부 200
/foundation50                307 /en/foundation50       →  308 /founders
/founders/feedback           307 /en/founders/feedback  →  308 /beta-survey
```

`/foundation50` 은 200 이 아니라 308 이 맞다 — 삭제된 라우트의 리네임이다.
영어권 방문자는 여기서 `/founders` → `/en/founders` 로 2홉을 타고 **영어에
안착**한다(실측 확인). 사이트맵에는 애초에 없다.

### 4.3 ★`/en/*`·`/ja/*` 무변경 — diff 에 한 줄도 없다

`/en`·`/ja` 로 시작하는 프로브는 **단 한 행도 diff 에 나타나지 않았다.**
접두사를 잃는 것은 기본 로케일뿐이라는 것의 실측 증거다.

### 4.4 ★런타임 로케일 감지 회귀 0

```
                    전                후
en-US  /            307 /en           307 /en            ← 무변경
en-US  /pricing     307 /en/pricing   307 /en/pricing    ← 무변경
ja-JP  /            307 /ja           307 /ja            ← 무변경
ja-JP  /pricing     307 /ja/pricing   307 /ja/pricing    ← 무변경
ko-KR  /            307 /ko           200                ← 홉이 사라졌다
ko-KR  /pricing     307 /ko/pricing   200                ← 홉이 사라졌다
de-DE  /            307 /en           200 (한국어)        ← #1115 의 의도
fr-FR  /            307 /en           200 (한국어)        ← #1115 의 의도
(헤더 없음) /        307 /en           200 (한국어)        ← Googlebot 이 보는 모습
```

**영어권은 여전히 `/en`, 일본어권은 여전히 `/ja`.** 한국어권은 홉이 하나
사라졌고, 매칭 실패는 #1115 가 정한 대로 한국어로 간다.

---

## 5. 사이트맵과 내부 링크

### 5.1 사이트맵에 루트가 들어갔다

```xml
<url>
  <loc>https://marblo.app</loc>
  <xhtml:link rel="alternate" hreflang="ko" href="https://marblo.app" />
  <xhtml:link rel="alternate" hreflang="en" href="https://marblo.app/en" />
  <xhtml:link rel="alternate" hreflang="x-default" href="https://marblo.app" />
  <changefreq>weekly</changefreq><priority>1</priority>
</url>
```

- 55 URL, `marblo.app/ko` 잔존 **0**, `marblo.app/ja` 잔존 **0**
- **불변식 재검증**: 55개 전부에 `Accept-Language` 없이 요청 → **전부 200**
- `#1114` 가 남긴 "루트를 넣지 마라" 주석은 **삭제가 아니라 갱신**했다. 규칙
  자체("리디렉션하는 URL 을 넣지 마라")는 그대로 살아 있고, 이제 그 규칙이
  금지하는 대상이 `/ko/*` 로 바뀌었다는 것을 명시한다.

한 가지 세부: 루트를 `https://marblo.app/` 이 아니라 **`https://marblo.app`**
(끝 슬래시 없음)으로 낸다. Next 가 `<head>` 의 canonical 을 그 형태로 정규화하기
때문이다. 같은 URL이지만, 사이트맵과 canonical 이 **문자 단위로 일치**해야
그 파일의 불변식 주석이 약속한 바를 지킨다.

### 5.2 내부 링크 — 하드코딩 제거가 곧 링크 점검이다

`/${locale}/...` 형태의 문자열 보간이 **175곳** 있었다. 그대로 두면 한국어
페이지의 모든 링크가 `/ko/...` 를 가리키고, 전부 "리디렉션이 포함된 페이지"가
된다 — `#1114` 가 3건 → 1건으로 줄인 걸 47페이지 규모로 되돌리는 셈이다.

`#1112` 가 만든 `routing` 단일출처 구조를 그대로 쓴다. 새 하드코딩을 만들지
않고, 접두사 규칙을 아는 함수를 **하나만** 둔다:

```ts
// src/i18n/routing.ts
localeHref("ko", "/pricing"); // → "/pricing"
localeHref("en", "/pricing"); // → "/en/pricing"

// src/lib/seo.ts (절대 URL — canonical·hreflang·사이트맵·JSON-LD·RSS)
localeUrl("ko", "/pricing"); // → "https://marblo.app/pricing"
```

바꾼 것:

- 47 파일의 보간 175곳 → `localeHref` / `localeUrl`
- `LanguageToggle` — `pathname.replace(\`/${locale}\`, ...)` 는 ko 가 접두사를
  안 가지면 **바꿀 대상이 없어서 조용히 깨진다.** 경로를 재구성하도록 다시 씀
- `legal/terms` 의 하드코딩 `/ko/legal/{privacy,refund}` 2건 — 한국어 고정은
  의도이므로 유지하되 `localeHref("ko", ...)` 로 파생
- 한국어 블로그 MDX 15개 링크의 `/ko` 접두사 제거 (en·ja 본문은 무변경)
- `robots.ts` 의 스테일 주석 갱신 — "접두사 없는 `/auth/`·`/my/` 는 존재하지
  않는다" 가 이제 거짓이다

**실측 (렌더된 HTML 을 크롤해서 모든 내부 링크의 상태 코드를 확인):**

|                        | 전 (origin/main) | 후        |
| ---------------------- | ---------------- | --------- |
| 크롤한 사이트맵 페이지 | 75               | 55        |
| 서로 다른 내부 링크    | 127              | 94        |
| **리디렉션하는 링크**  | **0**            | **0**     |
| `/ja/*` 16페이지 링크  | 35개 중 0        | 35개 중 0 |

회귀 0. 스크립트는 `docs/` 가 아니라 프로브 결과로만 남긴다 — 재현하려면
§4 와 같은 방식으로 프로덕션 빌드를 띄우고 사이트맵을 크롤하면 된다.

---

## 6. ★되돌리는 법 — 그리고 왜 공짜가 아닌지

`src/i18n/routing.ts`:

```ts
- export const LOCALE_PREFIX = "as-needed" as const;
+ export const LOCALE_PREFIX = "always" as const;
```

`localeHref` / `localeUrl` 이 전부 여기서 파생되므로 내부 링크·canonical·
hreflang·사이트맵이 한꺼번에 `/ko/*` 로 돌아간다. **코드상으로는 한 줄이다.**

★그러나 SEO 상으로는 아니다. 되돌리는 순간 `/pricing` 이 다시 리디렉션이 되고,
그 사이에 구글이 `/pricing` 을 색인했다면 **그 색인을 다시 옮겨야 한다.** 즉
되돌리기는 "원상복구" 가 아니라 **두 번째 이전**이다.

그래서 `#1115` 의 `defaultLocale` 한 줄 롤백도 이 PR 이후에는 성격이 달라진다.
`as-needed` 아래에서 `defaultLocale` 을 `en` 으로 되돌리면 접두사를 잃는 로케일이
바뀌어 **`/en/*` 이 접두사를 잃고 `/ko/*` 가 되찾는다.** #1115 문서의 "한 줄
롤백" 은 그 PR 이 단독으로 main 에 있는 동안에만 유효하다.

**판단**: 그래도 지금 하는 게 맞다. 되돌리기 비용이 오르는 것과 같은 이유로
**미루는 비용도 오르기 때문**이다. 24개일 때가 가장 싸다.

---

## 6.5 ★내가 스스로 세운 조건 중 둘은 충족되지 않았다

`SEO-REDIRECT-CHAIN-2026-08-21.md` §3.3 은 이 작업을 다시 꺼낼 조건 셋을
적어 뒀다. 정직하게 적는다 — **하나만 충족됐다.**

1. **사장님의 명시적 결정** — 충족.
2. **백링크가 붙어서 홈 URL 형태가 값을 갖는다** — **미충족.** 여전히 0 이다.
   다만 이 조건 자체가 틀렸다. 백링크가 붙은 뒤에 옮기면 옮길 것이 더 많아진다.
   "값이 생긴 뒤에 하자" 는 실질적으로 "비싸진 뒤에 하자" 였다.
3. **`createNavigation` 으로 내부 링크 처리를 자동화** — **다른 방식으로 해소.**
   `localeHref()`/`localeUrl()` 단일출처로 175곳을 옮겼다. 이전 비용이 "설정
   한 줄" 로 떨어지진 않았지만(코드모드 + 47파일 리뷰가 들었다), 접두사 규칙을
   아는 지점은 똑같이 한 곳뿐이고 회귀는 실측으로 0 이다.

조건을 충족했다고 쓰지 않고 이렇게 남기는 이유: 이 결정은 **조건이 채워져서**
가 아니라 **미루는 비용이 더 크다는 판단으로** 내려졌다. 나중에 이 문서를 읽는
사람이 근거를 착각하면 안 된다.

---

## 7. ★정직한 기대치

- 구글이 301 을 읽고 색인을 옮기기까지 — **수 주**. 그동안 GSC "Page with
  redirect" 에 `/ko/*` 가 **늘어나는 것이 정상**이다. 그게 301 이 읽히고 있다는
  신호다. 이걸 회귀로 오해하지 마라.
- 루트가 색인되기까지 — sitemap 재크롤 후 **며칠~2주**
- 이 변경도 `SEO-WHY-NO-TRAFFIC-2026-08-21.md` 가 짚은 진짜 원인(도메인 94일,
  백링크 0)을 **하나도 고치지 않는다.** 이건 성장 레버가 아니라 정합성 수정이고,
  **백링크가 붙기 시작할 때 그 자산이 새지 않도록 미리 그릇을 고쳐 두는 일**이다.

측정: 4주 뒤 GSC 에서 (a) `/pricing`·`/download` 같은 무접두사 URL 이 색인에
들어왔는지, (b) `marblo.app/` 이 색인됐는지, (c) `/ko/*` 가 "대체 페이지(적절한
표준 태그 있음)" 로 정리됐는지. 그 전에는 판단하지 마라.

---

## 8. 검증 요약

| 항목                            | 결과                                |
| ------------------------------- | ----------------------------------- |
| `marblo.app/` 200 한국어        | ✅ (헤더 없음·ko·de·fr 전부 200)    |
| `/ko/*` → `/*` 301 전수         | ✅ 21/21, 전부 1홉                  |
| `/en/*`·`/ja/*` 무변경          | ✅ diff 0 행                        |
| 사이트맵 루트 포함, 전 항목 200 | ✅ 55/55                            |
| 내부 링크 `/ko/` 잔존           | ✅ 0 (94개 링크 리디렉션 0, 회귀 0) |
| 런타임 감지 회귀                | ✅ 0 (en→/en, ja→/ja 무변경)        |
| `npm run typecheck`             | ✅ 통과                             |
| `npm run lint`                  | ✅ error 0 (기존 warning 2건만)     |
| `npm test`                      | ✅ 339 pass / 0 fail                |
