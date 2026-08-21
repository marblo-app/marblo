# x-default 를 어디로 보낼 것인가 — 실측 + 선택지 (2026-08-21)

티켓: `Y8l3srxNdlnPOUwNv7Hp` · 대상: https://marblo.app
측정 시각: 2026-08-21 · 워크트리: `origin/main` 과 동일(0 커밋 뒤처짐, `git rev-list --count HEAD..origin/main` = 0)

선행 문서: `SEO-GSC-INDEXING-AUDIT.md`(7/27) → `SEO-AUDIT-2026-07-29.md`(7/29) →
`SEO-WHY-NO-TRAFFIC-2026-08-21.md`(8/21). 기술 SEO 는 그쪽에서 이미 끝났다.
**이 문서는 딱 하나만 다룬다 — `x-default` 를 `/en` 에 둘 것인가 `/ko` 로 옮길 것인가.**

이 문서는 **결정하지 않는다.** 결정에 필요한 사실을 다 깔고, 선택지와 득실을 놓고,
누가 무엇을 답해야 하는지까지만 적는다. `defaultLocale` 은 이 PR 에서 바꾸지 않았다.

---

## 0. 결론 먼저

| # | 항목 | 실측 결과 |
| --- | --- | --- |
| 1 | **"한국어 사용자가 marblo.app 치면 영어가 뜬다"** | ❌ **사실이 아니다. 그런 문제는 없다.** §1 |
| 2 | `x-default` 가 한국어 사용자에게 미치는 영향 | **0. 전혀 없다.** §2 |
| 3 | `defaultLocale` 을 바꾸면 URL 구조가 바뀌나 | ❌ **안 바뀐다.** always-prefix 라서. §3 |
| 4 | 그럼 `x-default` 는 누구를 정하는 손잡이인가 | **한국어도 영어도 일본어도 아닌 사용자.** §2 |
| 5 | 권고 | **현행 유지(`/en`).** 단 근거는 "미국 시장" 이 아니다. §5 |
| 6 | 이 PR 이 실제로 바꾼 코드 | `sitemap.ts` 의 하드코딩 제거 1건 — **출력 무변화.** §6 |

> **한 줄로:** 사장님이 지적하신 문제("한국어 사용자는 한국 로케일로")는 **이미 그렇게
> 동작하고 있다.** 그리고 `x-default` 는 그 문제를 담당하는 손잡이가 **아니다.**
> `x-default` 를 돌려도 한국어 사용자에게는 아무 일도 일어나지 않는다.

---

## 1. 먼저 정정한다 — "한국 사용자가 영어를 본다" 는 존재하지 않는 문제다

**이 요청은 내(오케스트레이터) 오보에서 출발했다.** `Accept-Language` 헤더 없이 `curl`
한 결과를 일반화한 것이었다. 헤더를 넣고 다시 재면 런타임 감지는 **정상이다.**

```
$ curl -o /dev/null -w "%{http_code} -> %{redirect_url}" \
       -H "Accept-Language: <값>" https://marblo.app/
```

| 보낸 `Accept-Language` | 결과 | 판정 |
| --- | --- | --- |
| `ko-KR,ko;q=0.9,en;q=0.8` | `307 → https://marblo.app/ko` | ✅ |
| `ja-JP,ja;q=0.9` | `307 → https://marblo.app/ja` | ✅ |
| `en-US,en;q=0.9` | `307 → https://marblo.app/en` | ✅ |
| `fr-FR,fr;q=0.9` | `307 → https://marblo.app/en` | ✅ 미매칭 → 기본값 |
| `zh-CN,zh;q=0.9` | `307 → https://marblo.app/en` | ✅ 미매칭 → 기본값 |
| (헤더 없음) | `307 → https://marblo.app/en` | ← **오보의 출처가 이것이다** |

홈뿐 아니라 하위 경로도 같다:

```
$ curl ... -H "Accept-Language: ko-KR,ko;q=0.9" https://marblo.app/pricing
307 -> https://marblo.app/ko/pricing
```

쿠키 우선순위도 정상이다 — 사용자가 언어 토글로 고른 값이 브라우저 설정을 이긴다:

```
NEXT_LOCALE=ko + 헤더 없음        → 307 /ko
NEXT_LOCALE=en + Accept-Language: ko-KR → 307 /en   (사용자 선택이 이긴다)
```

> ### ⛔ 다음 사람에게
> **런타임 로케일 감지를 "고치지" 마라. 고장나 있지 않다.**
> `src/proxy.ts` + `src/i18n/routing.ts` 의 협상 로직을 건드리는 변경은 회귀다.
> 브라우저 없이 `curl` 로 재려면 **반드시 `Accept-Language` 를 붙여라.** 안 붙이면
> "미매칭" 경로를 타고, 그건 한국 사용자의 경험이 아니다.

---

## 2. `x-default` 가 실제로 하는 일 — 규격 근거

현재 모든 페이지 `<head>` 가 내보내는 것 (라이브 확인):

```html
<link rel="canonical"  href="https://marblo.app/ko"/>
<link rel="alternate" hrefLang="ko"        href="https://marblo.app/ko"/>
<link rel="alternate" hrefLang="en"        href="https://marblo.app/en"/>
<link rel="alternate" hrefLang="ja"        href="https://marblo.app/ja"/>
<link rel="alternate" hrefLang="x-default" href="https://marblo.app/en"/>
```

`/ko`·`/en`·`/ja`·`/ko/pricing` 전부 같은 4줄 세트를 낸다(자기 자신 포함 → 상호링크 요건 충족).
sitemap 75 URL 도 같은 값을 낸다.

### 2.1 규격이 뭐라고 하는가

Google Search Central, *Localized Versions of your Pages*
(https://developers.google.com/search/docs/specialty/international/localized-versions,
최종 갱신 2025-12-22) 원문:

> The reserved `x-default` value is used **when no other language/region matches the
> user's browser setting.** This value is recommended for specifying the fallback page
> for users whose language settings **don't match any of your site's localized versions.**

그리고:

> There's no need to specify a language code for the `x-default` value; the page is
> targeted to users whose language settings are unmatched on your site, thus
> **the language of the page is irrelevant.**

> While you can use the `x-default` value for any page, **it was designed for language
> selector pages** and so it will work best with those.

### 2.2 그래서 뭐가 달라지는가 — 정확히 이것만 달라진다

우리 사이트는 `ko`·`en`·`ja` 세 개를 명시적으로 선언한다. 규격상 `x-default` 는
**"이 셋 중 어느 것에도 매칭되지 않은 사용자"** 에게만 적용된다.

| 사용자 브라우저 언어 | 어느 hreflang 이 매칭되나 | `x-default` 관여 |
| --- | --- | --- |
| 한국어 | `hreflang="ko"` → `/ko` | **관여 안 함** |
| 영어 | `hreflang="en"` → `/en` | **관여 안 함** |
| 일본어 | `hreflang="ja"` → `/ja` | **관여 안 함** |
| 독일어·프랑스어·중국어·힌디어·포르투갈어 … | 없음 | ✅ **여기서만 작동** |

> ★ **`x-default` 를 `/en` → `/ko` 로 옮겨도 한국어 사용자에게 일어나는 일은 없다.**
> 한국어 사용자는 이미 `hreflang="ko"` 로 매칭되기 때문이다.
> 즉 사장님 요청("한국어 사용자는 한국 로케일로")은 `x-default` 로 달성되는 것이
> 아니고, **이미 달성돼 있다.**

`x-default` 가 실제로 답하는 질문은 이것이다:

> **"한국어도 영어도 일본어도 안 쓰는 사람이 검색해서 왔을 때, 우리는 무엇을 보여줄
> 것인가?"**

### 2.3 부수적으로 알아둘 규격 사실 두 가지

- **hreflang 은 페이지의 언어를 선언하는 태그가 아니다.**
  > Google **doesn't use `hreflang` or the HTML `lang` attribute to detect the language
  > of a page;** instead, we use algorithms to determine the language.

  → `hreflang="en"` 을 붙였다고 그 페이지가 영어로 취급되지 않는다. 본문으로 판정한다.
  이게 §7 의 법무 페이지 쟁점으로 이어진다.

- **HTML / HTTP 헤더 / sitemap 세 방식은 등가다.**
  > The three methods are **equivalent** from Google's perspective.

  → 서로 다른 `x-default` 값을 내보내면 그건 충돌 신호다. 이게 §6 에서 고친 덫이다.
  참고로 next-intl 의 HTTP `Link` 헤더 방식은 `routing.ts` 에서 `alternateLinks: false`
  로 이미 꺼놨다(주석에 이유 기록됨). 지금 신호원은 **head + sitemap 둘뿐**이다.

---

## 3. `defaultLocale` 이 이 코드베이스에서 실제로 제어하는 것 (전수)

### 3.1 ★ 전제 정정: URL 구조는 안 바뀐다

티켓 본문에 "`defaultLocale` 은 URL 구조와 색인에 영향을 준다" 고 적혀 있는데,
**이 코드베이스에서는 부정확하다.** 근거:

`src/i18n/routing.ts` 에 `localePrefix` 설정이 **없다** → next-intl 기본값 `"always"`.
라이브가 이를 뒷받침한다 — 프리픽스 없는 URL 은 존재하지 않고 전부 307 로 나간다:

```
/          → 307 /en          /pricing   → 307 /en/pricing
/ko, /en, /ja  전부 200 실 URL
```

`defaultLocale` 을 `"ko"` 로 바꿔도 정규 URL 집합은 `/{ko,en,ja}{path}` 그대로다.
**색인된 URL 은 하나도 이동하지 않는다.** (참고: `x-default` 를 `/ko` 로 옮기는 §4-B 는
아예 `defaultLocale` 을 건드리지도 않는다.)

`defaultLocale` 참조 전수 (`grep -rn defaultLocale src/`):

| 위치 | 하는 일 | URL 을 만드나 |
| --- | --- | --- |
| `src/i18n/routing.ts:7` | 값 정의 | — |
| `src/lib/seo.ts:40` | `<head>` 의 `x-default` 대상 | ❌ 기존 URL 을 가리킬 뿐 |
| `src/lib/seo.ts:54` | `og:locale` 폴백 | ❌ (ko/en/ja 전부 매핑돼 있어 실제 도달 불가) |
| `src/lib/seo.ts:77-78` | 블로그 `x-default` 우선 로케일 | ❌ 상동 |
| `src/i18n/request.ts:7` | 메시지 번들 폴백 | ❌ |
| next-intl 미들웨어 (`src/proxy.ts` 경유) | **미매칭 시 리다이렉트 대상** | ❌ 착지점만 |

**정규 URL 을 생성하는 곳은 0개다.**

### 3.2 그래도 "무영향" 은 아니다 — 크롤러 착지점은 바뀐다

여기가 진짜 영향 구간이다. **검색 크롤러는 `Accept-Language` 를 보내지 않는다.**

```
$ curl -A "…Googlebot/2.1…" https://marblo.app/       → 307 /en
$ curl -A "…Yeti/1.1…"      https://marblo.app/       → 307 /en
$ curl -A "…Googlebot/2.1…" https://marblo.app/pricing → 307 /en/pricing
```

즉 **한국 시장 전용 크롤러인 네이버 Yeti 도 `/` 에서 영문에 착지한다.**
`defaultLocale` 을 `"ko"` 로 바꾸면 이 착지점이 `/ko` 로 바뀐다. 이건 URL 구조 변경이
아니라 **리다이렉트 타깃 변경**이고, 재평가 기간이 든다.

다만 실효는 제한적이다 — sitemap 75 URL 은 `/ko`·`/en`·`/ja` 를 **전부 명시적으로
직접 제출**한다. 프리픽스 없는 `/` 는 sitemap 에 아예 없다. 크롤러는 `/` 를 거치지
않고도 `/ko` 를 직접 크롤한다.

### 3.3 내가 확인 못 한 것

티켓 본문의 **"이미 색인된 24개"** 는 출처를 확인하지 못했다. 어제자
`SEO-WHY-NO-TRAFFIC-2026-08-21.md` 는 Startpage(Google 프록시)로 **최소 10 URL** 을
확인했고 총계는 못 쟀다고 기록돼 있다. 24 라는 수치는 GSC 실데이터일 수 있으나
나는 GSC 접근 권한이 없다. **추측으로 채우지 않는다.**

다만 이 숫자는 결정에 영향을 주지 않는다 — §3.1 대로 어느 선택지도 정규 URL 을
이동시키지 않으므로, 색인된 URL 이 10개든 24개든 75개든 URL 이 죽는 일은 없다.

---

## 4. 선택지

### A. 현행 유지 — `x-default = /en` (`defaultLocale: "en"`)

코드 변경 없음.

| | |
| --- | --- |
| **한국어 사용자 영향** | **없음** (이미 `/ko`) |
| **얻는 것** | 미매칭 언어 사용자(독일·프랑스·브라질·인도 …)가 **읽을 수 있는** 페이지에 착지. 영어가 사실상 링구아 프랑카. 아무것도 흔들지 않는다 — 재평가 기간 0. 공개 repo 신뢰 획득 작업(`0YWSwkHYRbEveApT35XP`, DONE)의 영문 중심 방향과 정합. |
| **잃는 것** | 실질적 손실 없음. 남는 건 "우리는 한국 회사인데 왜 기본이 영어냐" 는 정서적 불편. |
| **네이버 Yeti** | `/` 착지가 영문 유지. 단 §3.2 대로 `/ko` 는 sitemap 으로 직접 크롤됨. |

### B. `x-default` 만 `/ko` 로 (`defaultLocale` 은 `"en"` 유지)

`lib/seo.ts` 에서 `x-default` 를 `defaultLocale` 에서 분리해 별도 상수로 뺀다.
런타임 리다이렉트는 전혀 안 건드린다.

| | |
| --- | --- |
| **한국어 사용자 영향** | **없음** (§2.2) |
| **얻는 것** | 미매칭 언어 검색자에게 노출되는 SERP 버전이 한국어가 된다. 브랜드 국적 신호. 런타임 회귀 위험 0. |
| **잃는 것** | ★ **미매칭 언어 사용자가 읽을 수 없는 페이지에 착지한다.** 규격이 `x-default` 를 "언어 설정이 우리 사이트 어디에도 안 맞는 사용자용 폴백" 으로 정의하는데, 그 사람들에게 한국어는 최악의 폴백이다. 영어는 최소한 제2언어일 확률이 높다. |
| **비용** | `lib/seo.ts` 2줄 + `sitemap.ts` 1줄(§6 리팩터 후 자동 추종). 재크롤/재평가 몇 주. |

### C. `defaultLocale: "ko"` — `x-default` + 미매칭 리다이렉트 동시 전환

`routing.ts` 한 줄. §6 리팩터 덕분에 head·sitemap 이 함께 따라간다.

| | |
| --- | --- |
| **한국어 사용자 영향** | **없음** (§2.2) |
| **얻는 것** | B 의 이점 + **크롤러(`Accept-Language` 없음)가 `/` 에서 `/ko` 에 착지.** 네이버 Yeti 에 한국어 홈이 먼저 보인다. |
| **잃는 것** | B 의 손실 전부 + 미매칭 언어 **실사용자가 307 로 한국어 페이지에 강제 착지**(SERP 노출뿐 아니라 실제 방문 경험이 바뀐다) + 이미 색인된 `/`(어제 Startpage 측정에서 확인됨)의 리다이렉트 타깃 변경 → 재평가 기간. |
| **안 잃는 것** | **URL 구조. 안 바뀐다** (§3.1). 색인된 URL 은 하나도 안 죽는다. |

---

## 5. 권고 — A 유지. 단, 흔한 이유 때문이 아니다

**권고: A(현행 유지).** 그런데 그 근거는 "미국 시장을 노리니까" 가 아니다.
그건 이 손잡이가 답하는 질문이 아니기 때문이다.

논리는 세 단계다.

1. **사장님이 지적하신 문제는 이미 해결돼 있다.** 한국어 사용자는 `/ko` 로 간다(§1).
2. **`x-default` 는 그 문제의 손잡이가 아니다.** 한국어·영어·일본어 사용자에게 `x-default`
   는 작동하지 않는다(§2.2). 돌려도 한국어 사용자에게는 아무 일도 안 일어난다.
3. **그래서 `x-default` 가 실제로 정하는 건 "제4의 사용자" 다** — 한국어도 영어도
   일본어도 안 쓰는 사람. 그 사람에게 한국어 페이지를 주면 읽을 수가 없다.

즉 이건 "미국이냐 한국이냐" 의 대리전이 아니다. 그렇게 읽으면 잘못 고른다.
**"우리 3개 언어 어디에도 안 맞는 사람에게 뭘 줄 것인가"** 이고, 거기서 한국어를
고르는 건 한국 우선 전략에서조차 이득이 없다. 한국인은 이미 `hreflang="ko"` 로 잡힌다.

> ### ★ 그리고 이건 엔지니어링이 정할 문제가 맞다
> 티켓은 "누구에게 팔 것인가가 정한다, 엔지니어링이 정할 문제가 아니다" 라고 했다.
> **그 전제에 근거를 들고 반박한다.** `x-default` 가 전략 손잡이라는 전제가 성립하려면
> 그것이 한국 사용자 또는 미국 사용자의 경험을 바꿔야 하는데, 규격상 **둘 다 안 바꾼다.**
> 이건 전략 결정이 아니라 규격 해석 문제다.
>
> 보드의 상충 신호(`0YWSwkHYRbEveApT35XP` 미국 개발자 신뢰 vs 한국어 1차 강의·결제·법무)는
> 실재하지만, **`x-default` 는 그 상충을 해소하는 지점이 아니다.** 그 상충이 실제로
> 걸리는 지점은 §8 에 적었다.

### 그래도 한국 우선을 신호하고 싶으시다면

`x-default` 말고 **C 의 크롤러 착지점** 이 유일하게 실질이 있는 부분이다
(네이버 Yeti → `/ko`). 그 하나만 원하시면, `x-default` 는 `/en` 에 두고
미들웨어의 미매칭 폴백만 분리하는 4번째 선택지도 가능하다. 다만 §3.2 대로
실효가 제한적이라 먼저 제안하지 않는다. **지시하시면 별건으로 만든다.**

---

## 6. 이 PR 이 실제로 바꾼 코드 — `sitemap.ts` 의 덫 하나 (출력 무변화)

결정을 미루더라도 **지금 제거해야 하는 덫**을 코드에서 찾았다.

`lib/seo.ts` 는 `routing.defaultLocale` 을 읽는데, `app/sitemap.ts` 는 **안 읽고
하드코딩하고 있었다:**

```ts
const locales = ["ko", "en", "ja"];                      // routing.ts 사본
languages["x-default"] = `${baseUrl}/en${page}`;         // defaultLocale 사본
const xDefault = available.includes("en") ? "en" : …;    // 상동
```

지금은 둘 다 `/en` 이라 값이 **우연히** 일치한다. 하지만 누군가 §4-B/C 를 골라
`defaultLocale` 을 바꾸는 순간:

```
<head>   x-default → /ko
sitemap  x-default → /en   ← 안 따라간다
```

§2.3 대로 Google 은 두 방식을 **등가**로 본다. 같은 클러스터에 서로 다른 `x-default`
두 개를 내보내는 상태가 된다. **결정을 실행하는 사람이 밟을 지뢰다.**

`sitemap.ts` 를 `routing.ts` / `lib/seo.ts` 에서 파생시켰다. 이제 `routing.ts` 한 줄만
바꾸면 head 와 sitemap 이 함께 움직인다 — **"고를 수 있게 만드는 것" 이 이 티켓의 일이고,
이게 그 실행 부분이다.**

**검증 — 출력이 바뀌지 않았음을 실측으로 증명:**

```
$ npx tsc --noEmit                → exit 0
$ npm run build                   → exit 0
$ diff <라이브 sitemap.xml (패치 전 프로덕션)> <빌드 산출 sitemap.xml (패치 후)>
  (차이 없음)  698줄 / 698줄  ✅ 완전 동일
```

75 URL, `x-default` 75건 중 74건 `/en`, 1건 `/ko`(`korea-ai-news-roundup` — 한국어로만
쓰인 글이라 `available[0]` 폴백이 작동한 정상 동작) — 패치 전후 동일.

---

## 7. 곁가지 실측 — 법무 클러스터는 별개 쟁점이다 (이 티켓에서 안 고침)

`x-default` 를 재는 김에 그 착지점들의 실제 본문 언어를 쟀다.

```
$ /en/<페이지> 본문(<script>·<style> 제거) 의 한글/라틴 문자 비율
```

| 페이지 | 한글자 | 라틴자 | 한글 비율 |
| --- | ---: | ---: | ---: |
| `/en/` | 4 | 6,968 | 0.1% |
| `/en/pricing` | 4 | 3,086 | 0.1% |
| `/en/guide` | 4 | 8,829 | 0.0% |
| `/en/faq` | 4 | 4,801 | 0.1% |
| `/en/blog` | 4 | 3,024 | 0.1% |
| **`/en/legal/terms`** | **4,898** | 939 | **83.9%** |
| **`/en/legal/privacy`** | **2,583** | 1,127 | **69.6%** |
| **`/en/legal/refund`** | **2,030** | 655 | **75.6%** |
| `/en/legal/business` | 245 | 783 | 23.8% |

마케팅 페이지는 전부 진짜 영어다(4자는 nav 의 "마블로" 브랜드 표기).
**법무 페이지 3건만 `hreflang="en"` 을 달고 실제로는 한국어 원문이다.**

이건 버그가 아니라 **의도된 선택**이다 — 페이지에 고지가 있다:

```
/en/legal/terms  : "This page is authored in Korean…"
/ja/legal/terms  : "本ページは韓国の電子商取引法に基づき、韓国語が原本として作成されています。"
```

전자상거래법상 한국어가 원본이어야 하니 타당하다. 다만 **규격상 두 가지가 걸린다:**

- > Google **doesn't use `hreflang` or the HTML `lang` attribute to detect the language
  > of a page**; instead, we use algorithms to determine the language.

  → `hreflang="en"` + `lang="en"` 을 달아도 Google 은 본문을 보고 한국어로 판정한다.
- > Localized versions of a page are **only considered duplicates if the main content of
  > the page remains untranslated.**

  → `/ko`·`/en`·`/ja` 법무 페이지의 main content 가 동일 한국어다. 중복으로 병합될
  조건에 정확히 해당한다.

**이 티켓에서 고치지 않는다.** 범위 밖이고, 법무 문안은 프론트엔드가 판단할 사안이
아니다. 별건 후보로만 기록한다 — 선택지는 (a) 법무 3페이지를 hreflang 클러스터에서
빼고 `/ko` 로 canonical 통합, (b) 실제 번역본 작성, (c) 현행 유지(병합돼도 무방하다고
판단). **어느 것도 지금 결정하지 않는다.**

---

## 8. 안 건드린 것 / 다음 사람에게

- ❌ **런타임 로케일 감지 — 안 건드렸다.** 고장나 있지 않다(§1). 건드리면 회귀다.
- ❌ **`defaultLocale` — 안 바꿨다.** §4 의 선택은 사장님 몫으로 남긴다.
- ❌ **`localePrefix` 전환 — 여기서 같이 안 한다.** 별건에서 실익 재검증 중.
  (참고: 티켓 본문이 그 별건을 `3TfYjKcE2PBOUXn1PZhq` 로 지목했는데, 그 ID 는 실제로는
  "구글 색인이 안 잡힌다" SEO 티켓(REVIEW, PR #1110)이다. 보드를 `localePrefix` 로
  검색하면 이 티켓 하나만 나온다 — **별건 티켓이 아직 없거나 다른 ID 다.** 확인 필요.)
- ❌ **법무 hreflang 클러스터 — 기록만 했다** (§7).
- ⚠️ **GSC 실데이터 — 접근 권한이 없다.** "색인된 24개" 를 검증 못 했다(§3.3).
  총 색인 수와 블로그 33편의 색인 여부는 Search Console 에만 있다.

### 사장님께 필요한 답 — 질문은 하나다

> **"한국어도 영어도 일본어도 쓰지 않는 사람이 검색으로 마블로를 발견했을 때,
> 영어 페이지를 보여줄까요, 한국어 페이지를 보여줄까요?"**

이게 `x-default` 가 정하는 전부다. 한국어 사용자·영어 사용자·일본어 사용자에게는
어느 쪽을 고르셔도 **아무 변화가 없다.**

- 영어 → **선택지 A. 지금 그대로. 코드 변경 없음.**
- 한국어 → **선택지 B.** 지시 주시면 `lib/seo.ts` 2줄로 처리한다(§6 리팩터 덕에 sitemap 자동 추종).
- "크롤러가 `/` 에서 한국어에 착지했으면 좋겠다" 까지 원하시면 → **선택지 C**, 별건으로 만든다.
