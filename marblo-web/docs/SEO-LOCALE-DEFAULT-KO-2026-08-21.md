# 사이트 기본 로케일을 ko 로, 일본어는 검색에서 잠깐 뺀다 (2026-08-21)

티켓: `am54YYl56KoWIu4sPWz9` · 대상: https://marblo.app

> ### ★ 후속 갱신 — 이 문서의 "URL 변경 없음" 과 "한 줄 롤백" 은 조건부다
>
> 같은 PR 에 `localePrefix: "as-needed"` 가 함께 들어갔다
> (`SEO-LOCALE-AS-NEEDED-2026-08-21.md`, 티켓 `5N8Ttuga3ZQ1XhUdKSqo`).
> 아래 §2 의 "URL 을 바꾸지 않는다" 는 **이 변경 단독의 성질**로서는 여전히
> 참이고 그 측정도 유효하지만, 배포된 결과에서는 URL 이 바뀐다 —
> `/ko/pricing` → `/pricing`. §4 의 `defaultLocale` 한 줄 롤백도 마찬가지로
> 성질이 달라진다: `as-needed` 아래에서 되돌리면 접두사를 잃는 로케일이 바뀌어
> `/en/*` 이 접두사를 잃는다. `searchLocales` 로 ja 를 되돌리는 한 줄만은
> 그대로 유효하다.

선행 문서: `SEO-WHY-NO-TRAFFIC-2026-08-21.md` (도메인 나이·백링크 0 이 진짜 원인이라는 진단).
**이 문서는 그 진단을 뒤집지 않는다.** 이번 변경은 원인 1·2 를 고치는 게 아니라,
검색 신호가 매출과 **반대 방향**을 가리키던 것을 바로 돌려놓는 것이다.

---

## 0. 결론 먼저

바꾼 것은 두 개다.

| #   | 변경                                    | URL 변경 | 되돌리기        |
| --- | --------------------------------------- | -------- | --------------- |
| ①   | `defaultLocale` : `"en"` → `"ko"`       | ❌ 없음  | 한 줄           |
| ②   | 검색 노출 로케일에서 `ja` 제외          | ❌ 없음  | 한 줄 (`searchLocales` 에 `"ja"` 추가) |

**이걸로 트래픽이 오른다고 말하지 않는다.** §5 참조 — 결과는 몇 주 단위이고,
이번 변경은 "잘못된 방향을 가리키던 신호를 바로잡은 것"이지 성장 레버가 아니다.

---

## 1. 왜 ① 인가

Search Console "발견됨 – 색인 생성 안 됨" 목록이 `ja`·`ko` 로케일 전체였다
(`/ja/faq`, `/ja/founders`, `/ja/guide`, `/ja/blog/*`, `/ko/blog/*` … 최종 크롤링
"해당사항 없음" = 한 번도 안 읽힘). `/en/*` 만 크롤링됐다.

그런데 매출은 한국에 있다 — 토스페이, 한국어 강의, 한국어 결제·법무 페이지.
**검색 신호가 매출과 반대를 가리키고 있었다.**

`defaultLocale` 이 하는 일은 두 가지뿐이다:

1. Accept-Language 가 **어느 로케일과도 매칭되지 않을 때**의 폴백
2. `x-default` hreflang 이 가리키는 대상 (`lib/seo.ts`, `app/sitemap.ts`)

둘 다 "우리가 아무것도 모르는 방문자에게 무엇을 보여줄 것인가" 다. 그 답은 이제 한국어다.

Googlebot 은 보통 `Accept-Language` 를 보내지 않는다. 즉 **이 폴백이 곧 Googlebot 의 경로**다.
그래서 이 한 줄이 실제로 의미가 있다.

---

## 2. ① 은 URL 을 바꾸지 않는다 — 실측

이미 색인된 24개가 걸려 있으므로 전제를 코드와 런타임 양쪽으로 확인했다.

### 2.1 코드 근거

`next-intl@4.9.0` `dist/esm/*/routing/config.js`:

```js
function receiveLocalePrefixConfig(localePrefix) {
  return typeof localePrefix === 'object' ? localePrefix : { mode: localePrefix || 'always' };
}
```

`routing.ts` 에 `localePrefix` 가 없으므로 `{mode:'always'}` 로 해석된다.
그리고 defaultLocale 때문에 접두사를 **떼는** 코드 경로는 딱 하나다:

```js
// middleware/middleware.js:62
if (bestMatchingDomain.defaultLocale === locale && resolvedRouting.localePrefix.mode === 'as-needed')
```

`as-needed` 가 아니면 defaultLocale 이 무엇이든 접두사는 붙는다.
**URL 구조는 defaultLocale 과 독립이다.**

### 2.2 런타임 근거

`next build` → `next start` 로 변경 전/후 동일 프로브를 돌리고 diff 했다.

**바뀌지 않은 것** (전부 동일, 200):

```
/en /en/pricing /en/guide /en/faq /en/founders /en/blog /en/legal/terms
/ko /ko/pricing /ko/guide /ko/faq /ko/founders /ko/blog
/ja /ja/pricing /ja/guide /ja/faq /ja/founders /ja/blog
```

**런타임 언어 감지도 안 바뀌었다:**

```
/  Accept-Language: en-US -> 307 /en     (변경 없음)
/  Accept-Language: ko-KR -> 307 /ko     (변경 없음)
/  Accept-Language: ja-JP -> 307 /ja     (변경 없음)
```

**바뀐 것은 매칭 실패 케이스 하나뿐이다:**

```
/           Accept-Language 없음 :  307 /en      →  307 /ko
/pricing    Accept-Language 없음 :  307 /en/…    →  307 /ko/…
/  Accept-Language: de-DE       :  307 /en      →  307 /ko
/  Accept-Language: fr-FR       :  307 /en      →  307 /ko
```

★ 정확히 말하면 **페이지 URL 은 하나도 안 바뀌었지만, 로케일 없는 URL 의 리다이렉트
목적지는 바뀌었다.** 색인된 24개는 `/en/*` 이고 그건 직접 200 이라 영향이 없다.
영향을 받는 건 로케일 없는 경로(`/pricing` 같은 외부 링크)뿐이고, 그게 이제
한국어로 간다 — 의도한 바다.

---

## 3. ② 는 "빼둔다" 지 "지운다" 가 아니다

`src/i18n/routing.ts` 에 검색 노출 로케일 목록을 하나 만들었다:

```ts
export const searchLocales = ["ko", "en"] as const satisfies readonly Locale[];
```

`app/sitemap.ts` 와 `lib/seo.ts` 가 **둘 다 여기서 파생**된다. 목록은 하나뿐이다.

### 한 것

- `sitemap.ts` 에서 `/ja/*` 제외 → 75 URL → 55 URL (ko 28·en 27 은 **그대로**)
- hreflang `alternates` 에서 `ja` 제외 → sitemap 의 `hreflang="ja"` 60개 → 0개
- `x-default` 를 하드코딩 `"en"` 에서 `xDefaultLocale` 파생값으로 교체

### 하지 않은 것 (의도적)

- ❌ ja 페이지 삭제 — `/ja/*` 전부 여전히 200
- ❌ 라우팅에서 제외 — `routing.locales` 는 `["ko","en","ja"]` 그대로
- ❌ `noindex` — `/ja/pricing` 은 여전히 `<meta name="robots" content="index, follow">`.
  noindex 를 걸면 **이미 색인된 ja 페이지를 잃는다.** "잠깐"이므로 걸지 않는다.
- ❌ robots.txt 로 차단 — 차단하면 크롤러가 페이지를 읽지도 못한다
- ❌ 언어 토글에서 일본어 제거 — `LanguageToggle.tsx` 그대로, 日本語 선택 가능
- ❌ `og:locale:alternate` 에서 ja 제거 — OG 는 검색 크롤러가 아니라 소셜 언퍼러가 읽는다.
  검색에서 빼는 것과 일본어로 공유한 링크를 감추는 것은 다른 문제다.

### 결과 상태

`/ja/pricing` 은 이제 이렇다:

```html
<link rel="canonical" href="https://marblo.app/ja/pricing"/>   ← 자기 자신
<link rel="alternate" hrefLang="ko" .../>
<link rel="alternate" hrefLang="en" .../>
<link rel="alternate" hrefLang="x-default" href=".../ko/pricing"/>
<meta name="robots" content="index, follow"/>                  ← noindex 아님
```

self-canonical 이 살아 있으므로 **이미 색인된 ja 페이지는 색인에 남는다.**
우리가 그만둔 것은 크롤러에게 ja 를 **가리키는** 일뿐이다.
(ko/en 쪽에서 ja 를 참조하지 않으므로 hreflang 상호참조가 끊기고, 구글은
편도 hreflang 을 무시한다 — 그게 정확히 의도한 "신호 철회" 다.)

---

## 4. ★ 되돌리는 법 (한 줄)

`src/i18n/routing.ts`:

```ts
- export const searchLocales = ["ko", "en"] as const satisfies readonly Locale[];
+ export const searchLocales = ["ko", "en", "ja"] as const satisfies readonly Locale[];
```

**끝이다.** sitemap 도 hreflang 도 전부 이 배열에서 파생된다. 다른 파일은 손댈 필요 없다.

`defaultLocale` 을 되돌리려면 같은 파일에서 `"ko"` → `"en"`. 역시 URL 은 안 바뀐다.

---

## 5. ★ 정직한 기대치 — "고쳤으니 됐다" 가 아니다

- 구글이 sitemap 재크롤 → **며칠~2주**
- hreflang 클러스터 재계산 → **2~6주**
- "발견됨 – 색인 생성 안 됨" 이 실제로 줄어드는지 → **4주 이후에나 판단 가능**

그리고 더 중요한 것:

**이 변경은 `SEO-WHY-NO-TRAFFIC-2026-08-21.md` 가 짚은 진짜 원인(도메인 94일,
백링크 0)을 하나도 고치지 않는다.** ja 20개를 빼서 크롤 예산을 ko/en 에 몰아준다고
해도, 55개짜리 사이트에서 크롤 예산은 애초에 병목이 아니었다(§6 참조).

이번 변경의 정직한 가치는 이것 하나다:
**우리가 구글에게 "이 사이트의 기본은 영어다" 라고 말하고 있었는데, 매출은 한국어다.
그 모순을 없앴다.** 성장 레버가 아니라 정합성 수정이다.

측정 방법: 4주 뒤 GSC 에서 (a) `/ko/*` 의 "최종 크롤링" 이 "해당사항 없음" 에서
실제 날짜로 바뀌었는지, (b) 색인된 URL 중 ko 비중. 그 전에는 판단하지 마라.

---

## 6. 곁다리 — `_next/static/chunks/*.js?dpl=` 는 손대지 마라

**증상**: "크롤링됨 – 현재 색인 생성되지 않음" 에 JS 청크가 대량으로 잡힌다.

**판단: 정상이다. 조치 불필요.**

1. **.js 파일에 대해 "크롤링됨-색인안됨" 은 오류가 아니라 올바른 최종 상태다.**
   구글은 페이지를 렌더링하려고 청크를 받는 것이고, 스크립트를 검색 결과에 색인하지 않는다.
2. **robots.txt 로 막으면 안 된다.** 구글이 명시적으로 금지한다 — 막으면 렌더링이 깨지고
   페이지 내용을 못 읽는다. 이건 실제 회귀다.
3. **`?dpl=` 은 Vercel Skew Protection 이 붙이는 배포 ID** 다 (`next.config.ts` 에
   `deploymentId` 설정은 없다 = Vercel 프로젝트 설정에서 온다). 배포마다 값이 바뀌어
   변경 없는 청크에도 새 URL 이 생기는 건 맞다.
4. **그런데 그게 예산 낭비인가? 아니다.** 구글의 크롤 예산 가이드는 그 대상을
   "주 1회 변경되는 100만 페이지 이상" 또는 "매일 변경되는 1만 페이지 이상" 으로 못박는다.
   marblo.app 은 색인 대상 **55 URL** 이다. 두 자릿수 차수가 아니라 네 자릿수 차수로 미달이다.
   게다가 리소스 fetch 는 구글이 별도로 최대 30일까지 캐시한다.
5. **끄면 잃는 게 더 크다.** Skew Protection 을 끄면 배포 도중 열려 있던 탭이
   청크 로드 실패로 깨진다. 실재하는 사용자 피해와 이론적인 크롤 예산을 맞바꾸는 셈이다.

**결론: 아무것도 하지 마라.** GSC 에서 이 항목은 무시 대상이다.
