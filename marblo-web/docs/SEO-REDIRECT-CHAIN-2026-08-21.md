# 리디렉션 체인 — 실측·수정·그리고 하지 않기로 한 것 (2026-08-21)

티켓: `SYFN5Zs22IabjHiQgVcz` · 대상: https://marblo.app

선행: `SEO-WHY-NO-TRAFFIC-2026-08-21.md` (`3TfYjKcE2PBOUXn1PZhq`).
그 문서가 "왜 트래픽이 없나" 에 답했다면(도메인 나이 94일 · 백링크 0),
이 문서는 그 문서가 남긴 하나의 기술 항목 — **홈 진입점의 리디렉션 체인** — 만 다룬다.

---

## 0. 결론 먼저

| 항목                             | 결정          | 근거    |
| -------------------------------- | ------------- | ------- |
| **A. 체인을 1홉으로**            | ✅ **했다**   | §2      |
| **B. 루트(`/`)를 200 으로**      | ❌ **안 한다** | §3      |
| **C. 사이트맵에 루트 추가**      | ❌ **안 한다** | §4      |

**A 는 순위를 올리지 않는다.** 올릴 거라고 쓰면 거짓말이다. 선행 문서의 결론
(도메인 나이 · 백링크 0)은 그대로 유효하고, 이 변경은 거기에 손대지 않는다.
A 를 한 이유는 두 가지뿐이다 — 크롤 예산 낭비를 줄이고, GSC 의
"리디렉션이 포함된 페이지" 노이즈를 3건에서 1건으로 줄인다.

---

## 1. 실측 — 무엇이 몇 홉이었나

Search Console **도메인 속성**은 http/https × www/apex 4개 진입점을 전부 추적한다.
수정 전 (2026-08-21 측정):

```
http://marblo.app/       308 → https://marblo.app/  → 307 → /en          (2홉)
http://www.marblo.app/   308 → https://www…/ → 301 → …/ → 307 → /en      (3홉)
https://www.marblo.app/  301 → https://marblo.app/  → 307 → /en          (2홉)
https://marblo.app/      307 → /en                                        (1홉)
```

### 1.1 첫 308 은 우리 것이 아니다

`http://…` → `https://…` 308 은 **Vercel 플랫폼이 TLS 종단에서** 내보낸다.
응답이 `HTTP/1.0` 이고 `x-vercel-id` 헤더가 없다 — Next 런타임까지 오지 않았다는 뜻이다.
`next.config.ts` redirects 로도, proxy 로도 가로챌 수 없다.

> **따라서 http:// 진입점의 하한은 2홉이다.** 1홉으로 만들 수 없다.
> 다음에 이 문서를 읽는 사람이 "http 도 1홉으로" 하려고 시도할 텐데, 못 한다.

줄일 수 있는 건 **그 뒤에 우리가 붙인 홉**이다. 거기가 www 에서 2홉이었다.

### 1.2 왜 www 가 2홉이었나

`next.config.ts` 의 www→apex 규칙이 캐치올(`/:path*`)이었다.
Next 라우팅 순서상 **next.config redirects 가 proxy(미들웨어)보다 먼저** 돈다.
그래서 www 요청은 항상 여기서 잘려나갔고, 호스트 교체(301)와
로케일 협상(307)이 서로 다른 두 응답으로 쪼개졌다.

---

## 2. A — 무엇을 바꿨나

**www 정규화를 `next.config.ts` 에서 `src/proxy.ts` 안으로 옮겼다.**
proxy 안에서는 next-intl 이 이미 협상해 놓은 목적지를 읽을 수 있으므로,
호스트 교체와 로케일 협상을 **한 번의 리디렉션**으로 합칠 수 있다.

- `src/lib/canonicalHost.ts` — 순수 함수(`isWwwHost`, `canonicalTarget`). `next/server`
  의존이 없어 단위 테스트가 된다. `src/lib/canonicalHost.test.ts` 5 케이스.
- `src/proxy.ts` — www 호스트면 next-intl 응답의 `Location` 을 받아 apex 로 한 번에 보낸다.
- `next.config.ts` — 캐치올을 없애고, proxy matcher 가 **못 보는** 경로만 남겼다:
  `/api/:path*` 와 확장자를 포함한 경로(`/:file(.*\..*)` — `/sitemap.xml`,
  `/robots.txt`, `/favicon.ico`, `/public` 자산).

### 2.1 상태 코드 — 301 과 307 을 나눈 이유

| 상황                                   | 코드    | 이유                                                                                 |
| -------------------------------------- | ------- | ------------------------------------------------------------------------------------ |
| 경로에 이미 로케일이 있다 (`/en/…`)     | **301** | 목적지가 순수 호스트 교체. 모든 방문자에게 동일 → 영구 캐시 안전. 기존과 동일         |
| 로케일이 없다 (`/`, `/pricing`)         | **307** | 목적지가 Accept-Language / `NEXT_LOCALE` 로 **방문자마다 다르다**                     |

로케일 없는 경우에 301 을 쓰면 한국인 방문자 브라우저가 `www/` → `/en` 을
영구 캐시해서 그 사람을 영어에 고정시킨다. 그건 버그다.

**307 로 내려서 링크 가치를 잃지 않나?** 잃지 않는다.
기존 체인 `301 → 307` 도 **마지막 홉이 이미 307** 이었다. 검색엔진이 보는
종단 시그널은 전에도 지금도 temporary 다. 달라진 건 홉이 하나 줄었다는 것뿐이다.

### 2.2 루프가 구조적으로 불가능한 이유

목적지 호스트는 항상 `marblo.app` 이고, `isWwwHost()` 는 `www.marblo.app` 에만
참이다. 목적지가 소스가 되는 경우가 없다. 테스트로 고정해 뒀다.

### 2.3 실측 결과 (로컬 프로덕션 빌드, `next start` + Host 헤더)

```
www /            (AL 없음)  1홉  307 https://marblo.app/en
www /            (AL=ko)    1홉  307 https://marblo.app/ko     ← 로케일 감지 유지
www /            (AL=ja)    1홉  307 https://marblo.app/ja
www /            (AL=fr)    1홉  307 https://marblo.app/en
www /pricing                1홉  307 https://marblo.app/en/pricing   (이전 2홉)
www /en/pricing             1홉  301 https://marblo.app/en/pricing   (기존과 동일)
www /pricing?utm_source=x   1홉  쿼리 보존
www /sitemap.xml            1홉  301 apex
www /robots.txt             1홉  301 apex
www /api/*, /images/*.png   1홉  301 apex

apex /  (AL 없음/ko/ja)     변화 없음  307 /en · /ko · /ja
apex /en/foundation50       변화 없음  308 /en/founders
apex /en/founders/feedback  변화 없음  308 /en/beta-survey
localhost · *.vercel.app · www.marblo.app.attacker.com  영향 없음
```

배포 후 진입점별 최종 체인:

```
http://marblo.app/       308 → https://marblo.app/ → 307 → /en   (2홉, 하한)
http://www.marblo.app/   308 → https://www…/ → 307 → apex/en     (2홉, 이전 3홉)
https://www.marblo.app/  307 → https://marblo.app/en             (1홉, 이전 2홉)
https://marblo.app/      307 → /en                                (1홉, 무변경)
```

**★ URL 구조를 하나도 건드리지 않았다.** 색인된 페이지의 주소는 전부 그대로다.

### 2.4 남는 예외 하나

`www.marblo.app/en/foundation50` 은 여전히 2홉이다(`308 → /en/founders`,
`301 → apex`). 레거시 별칭 × 비정규 호스트의 교집합이고, **수정 전에도 2홉**이었다
(순서만 반대였다). 홈 진입점이 아니라 방치한다.

---

## 3. B — 루트를 200 으로 만들지 않는다

### 3.1 무엇을 저울에 올렸나

제안: `localePrefix: "as-needed"` 로 바꿔 `marblo.app/` 이 실제 200 페이지가 되게 한다.
그러면 `/en/pricing` → `/pricing` 이 되고, 모든 진입점 체인이 1홉씩 짧아진다.

### 3.2 결정: **하지 않는다.** 근거 4개

**(1) 사장님이 직접 결정한 두 항목과 정면으로 충돌한다.**

- `x-default: /en` — as-needed 로 가면 `/en` 이라는 URL 자체가 없어진다
  (`/` 로 301 된다). x-default 가 리디렉트를 가리키게 되므로 이 결정을 깨지 않고는
  B 를 할 수 없다.
- **런타임 로케일 감지** — 루트를 200 으로 만드는 모든 변형(as-needed 든,
  always 를 유지한 채 `/` 만 200 으로 파는 절충안이든) 은 `/` 에서
  협상을 없앤다. `marblo.app/` 에 온 한국인이 `/ko` 로 못 가고 영어를 본다.
  이건 명시적으로 회귀로 규정된 동작이다.

절충안(`always` 유지 + `/` 만 200)도 같은 이유로 막힌다. **B 는 사장님 결정을
바꾸지 않고는 성립하지 않는다.** 그래서 여기서 임의로 하지 않는다.

**(2) 실익이 거의 없다.**

as-needed 로 가도 `marblo.app/` 은 영어 페이지다. 한국어·일본어는 여전히
`/ko`, `/ja` 다. 즉 얻는 것은 "홈이 리디렉트가 아니라 200" 하나뿐이고,
`https://marblo.app/en` 은 **지금도 색인되고 지금도 사이트맵에 있다.**
"검색결과가 될 수 있는 형태가 하나도 없다" 는 정확하지 않다 —
`marblo.app/en` 이 그 형태다. 도메인 속성이 리포트하는
"리디렉션이 포함된 페이지" 는 **오류가 아니라 정보성 상태**이고,
호스트 정규화를 하는 모든 사이트가 이 줄을 갖는다.

**(3) 위험이 비대칭이다.**

- 잃을 수 있는 것: 색인된 24개 (전부 `/{locale}/…` 형태 → 전부 주소가 바뀐다)
- 얻는 것: GSC 정보성 3줄 → 1줄

Google 이 24개를 재크롤·재처리하는 동안(통상 2~8주) 순위가 흔들린다.
3개 고치려고 24개를 거는 거래다.

**(4) 이전 비용이 작지 않고, 놓치면 조용히 체인을 만든다.**

실측한 이전 표면:

| 대상                                       | 개수                    |
| ------------------------------------------ | ----------------------- |
| `href={\`/\${locale}/…\`}` 내부 링크        | **96개** (36개 파일)    |
| `router.push/replace(\`/\${locale}/…\`)`    | **10개**                |
| 앱 라우트                                  | 33개                    |
| 추가로 필요                                | `/en/*` → `/*` 301 · sitemap · canonical · hreflang |

이 프로젝트는 next-intl 의 navigation 래퍼(`createNavigation`)를 쓰지 않고
로케일을 직접 문자열로 붙인다. 즉 as-needed 전환은 자동으로 따라오지 않고
**106곳을 손으로 고쳐야 하며, 하나 빠뜨릴 때마다 조용히 301 체인이 생긴다.**
방금 없앤 그 체인이다.

### 3.3 B 를 다시 꺼낼 조건

셋 다 만족할 때만:

1. 사장님이 `x-default: /en` 과 루트 로케일 감지 결정을 **명시적으로** 바꾼다.
2. 백링크가 붙기 시작해서 홈 URL 형태가 실제로 값을 갖는다
   (지금은 0개라 어느 형태든 축적할 링크 가치가 없다 — 선행 문서 §1).
3. `createNavigation` 도입으로 내부 링크가 로케일 처리를 자동화한다
   (그러면 이전 비용이 106곳 → 설정 한 줄로 떨어진다).

**지금은 셋 다 아니다.**

---

## 4. C — 사이트맵에 루트를 넣지 않는다

전수 확인 (로컬 프로덕션 빌드 `/sitemap.xml`, 2026-08-21):

```
<loc> 엔트리                                        75
루트(https://marblo.app/) — <loc> 및 hreflang        0
로케일 프리픽스가 없는 URL                            0
리디렉트 소스인 URL (foundation50 / founders/feedback / www.*)   0
```

깨끗하다. 고칠 게 없다. **넣지 않는 것이 맞다** — 리디렉트하는 URL 을
사이트맵에 넣으면 Google 이 "Page with redirect" 로 떨어뜨리고,
루트가 색인되는 게 아니라 사이트맵이 망가져 보인다.

`src/app/sitemap.ts` 상단에 이 불변식을 주석으로 못박아 뒀다. B 를 해서
루트가 200 이 된 **뒤에만** 넣을 수 있다.

---

## 5. 이 문서가 다루지 않는 것

- **블로그 크롤 예산** — 별건(`NsQ3AMiCOymO5YSXayzD`). 여기서 건드리지 않았다.
- **순위·트래픽** — 선행 문서 `SEO-WHY-NO-TRAFFIC-2026-08-21.md` 소관.
  이 변경은 거기에 영향이 없다.
