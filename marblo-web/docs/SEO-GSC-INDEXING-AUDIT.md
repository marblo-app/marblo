# marblo-web 색인 에러 원인 → 수정 매핑 (2026-07-27)

티켓: `MKD5Rh28Kv4P4RmBzieR` · 대상: `marblo-web` (Next.js 16.2.2 App Router + next-intl always-prefix ko/en/ja)
사이트: https://marblo.app (canonical origin = apex, `www` 아님)

**직전 감사** `docs/SEO_GEO_AUDIT_2026_07.md` (티켓 `A4ZCypgy`, 7/22)의 후속이다.
거기서 처리한 A1~A6 / B1~B3 은 다시 다루지 않는다. 이 문서는 **그 라운드 이후에도
라이브에 남아 있던 것**만 담는다.

---

## 0. 방법과 한계 (먼저 읽을 것)

무엇이 **측정된 사실**이고 무엇이 **추정**인지 구분한다. 섞으면 이 문서는 쓸모가 없다.

**측정한 것:**

- 로컬 프로덕션 빌드(`npm run build` + `next start`)의 실제 렌더 HTML 을 curl 로 검사
- **라이브 https://marblo.app 에 Googlebot User-Agent 로 직접 요청**해 HTTP 상태 ·
  `<meta name="robots">` · `robots.txt` · `sitemap.xml` 확인
- 수정 전/후 모두 실측 (아래 §3 증거)

**측정하지 못한 것 — 여기서부터는 추정이다:**

- **Search Console 색인 커버리지 리포트 실데이터에 접근 권한이 없다.** GSC 가 실제로
  어떤 URL 을 어떤 사유로 몇 개 제외했는지는 **보지 못했다.**
- 따라서 아래 "GSC 에 이렇게 잡혔을 것"은 전부 **관측된 코드·응답 동작에서 역산한
  추정**이다. 사실로 단정하지 않는다. 확정은 §4 체크리스트로 사장님이 해야 한다.
- 각 수정이 색인을 얼마나/언제 회복시킬지도 예측하지 않는다. 재크롤 주기는 Google 소관.

### ⚠️ 이번에도 걸린 함정: 로컬 500 → 가짜 사이트 전역 noindex

직전 감사와 **똑같은 오탐을 이번에도 만났고, 똑같이 반증했다.** 기록해 둔다:

로컬 워크트리에 `NEXT_PUBLIC_FIREBASE_API_KEY` 가 없어 전 페이지가 SSR 500 을 냈고,
Next 가 `statusCode > 400` 인 응답에 `<meta name="robots" content="noindex">` 를 주입해
(`next/dist/server/app-render/app-render.js` 의 `NonIndex`) **모든 페이지가 noindex 인
것처럼 보였다.** 더미 키로 재빌드하니 전부 200 + noindex 소멸.

**라이브는 정상이다** — `https://marblo.app/ko` 는 200 + 단일 `index, follow`.
프로덕션 결함으로 보고하지 않는다. 다만 이 메커니즘 자체는 실증됐고, 그게 F2 다.

**로컬에서 marblo-web 을 프로덕션 빌드로 띄울 사람에게**: `.env.local` 에
`NEXT_PUBLIC_FIREBASE_API_KEY` 를 넣어라. 없으면 SEO 를 감사하는 게 아니라 500 페이지를
감사하게 된다.

---

## 1. 색인 에러 원인 → 수정 매핑

| #      | 원인                                                                    | 근거 (측정)                                                                                                                                         | GSC 에 잡혔을 유형 (추정)                                                                | 수정                                                                                                   |
| ------ | ----------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| **F1** | 비공개 경로가 `index, follow` 로 나감 + robots.txt 패턴이 목표를 빗나감 | 라이브: `/ko/my`·`/ko/admin`·`/ko/auth/login` 전부 **200 + `index, follow`**. robots.txt 의 `/*/my/` 는 트레일링 슬래시라 **`/ko/my` 를 안 막는다** | "robots.txt 에 의해 차단되었으나 색인됨"(admin·auth), 그리고 `/ko/my` 는 **그냥 색인됨** | `my`/`auth`/`admin` 에 `robots: noindex` 레이아웃 신설 + **robots.txt Disallow 제거**                  |
| **F2** | SSR 이 한 번 throw 하면 **전 페이지가 5xx + noindex**                   | `src/lib/firebase.ts` 가 모듈 최상단에서 `getAuth()` 실행. `apiKey` 만 폴백이 없고 `.env.example` 에도 없었음. 위 §0 에서 실제 재현                 | "서버 오류(5xx)" + "`noindex` 태그에 의해 제외됨" 이 **동시에 대량 발생**                | `.env.example` 에 Firebase 키 전체 문서화(SEO-critical 경고 포함). **근본 수정은 후속 티켓** — §5 참조 |
| **F3** | 색인 가능한 페이지가 sitemap 에 없음                                    | `/legal/business`·`/founders/faq` → 라이브 3 로케일 전부 **200 + `index, follow`** 인데 sitemap 69 URL 에 부재                                      | "발견됨 - 현재 색인되지 않음"                                                            | sitemap 에 추가 (69 → **75 URL**)                                                                      |
| **F4** | sitemap `lastmod` 가 정적 페이지 전부 빌드 시각                         | `lastModified: new Date()` — 배포할 때마다 전 URL 이 "방금 수정됨"으로 바뀜                                                                         | 직접적 에러는 아님. Google 이 **lastmod 신호 전체를 신뢰하지 않게 됨**                   | 진짜 날짜가 있는 곳(블로그 글, 블로그 인덱스=최신 글 날짜)만 `lastmod` 방출. 나머지는 **생략**         |
| **F7** | 로케일 미접두 URL 이 404                                                | 라이브 `https://marblo.app/pricing` → **404**. proxy matcher 가 `/` 와 `/(ko\|en\|ja)/*` 만 처리                                                    | "찾을 수 없음(404)" — 외부/레거시 링크가 가리키는 만큼                                   | matcher 를 `/((?!api\|_next\|_vercel\|.*\\..*).*)` 로 확대 → `/pricing` 이 **307 → `/en/pricing`**     |

### 왜 robots.txt 차단을 **푸는** 게 맞는가 (F1 의 핵심)

직관에 반해 보이므로 명시한다. **robots.txt 차단은 색인을 막지 못하고, 색인 제거를
막는다.** 차단된 URL 이라도 누가 링크하면 Google 은 URL 만으로 색인한다("차단되었으나
색인됨"). 그리고 차단돼 있으니 크롤러가 페이지를 못 읽고 → `noindex` 를 **영영 못 본다**.

그래서 순서가 이것뿐이다: **크롤은 허용 + `noindex` 로 제거 → 빠진 뒤에 차단(원하면).**
`/api/` 만 Disallow 로 남겼다. HTML 이 아니라 meta 태그를 실을 수 없기 때문이다.

---

## 2. 키워드 / GEO 보강

| #      | 문제                                                                                               | 수정                                                                                                                                                       |
| ------ | -------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **F5** | 홈 `<h1>` 에 브랜드·카테고리 키워드가 **하나도 없음** ("혼자서 팀 전체의 성과를 만드세요")         | 브랜드 키워드를 다 가진 eyebrow pill("마블로 · AI 에이전트 오케스트레이션 플랫폼")을 **`<h1>` 안으로** 편입. 카피는 한 글자도 안 바꿨고 숨긴 텍스트도 없다 |
| **F6** | Organization/WebSite JSON-LD 가 /ko·/ja 에서도 **영어** description. `contactPoint`/`address` 부재 | `locale` 을 받아 현지화. `/legal/business` 에 이미 공개된 회사 주소 + 대표 이메일로 `contactPoint`·`address` 추가                                          |
| **F8** | 강의 상세 `<title>` 이 3 로케일 전부 영어 (`title_ko` 가 데이터에 있는데 미사용)                   | ko 는 `title_ko`. 카탈로그에 `title_ja` 가 없으므로 **ja 는 영어 폴백** (번역을 지어내지 않음)                                                             |

**직전 감사 B1 과의 관계**: 그때는 "감성 훅 유지를 위해 badge 보강으로 갈음, H1 재작성은
강제 아님"으로 남겼다. 이번 F5 는 **카피를 재작성하지 않고** H1 을 재그룹핑만 해서 둘
다 얻는다 — 헤드라인 문구는 그대로, `<h1>` 은 "브랜드 · 카테고리 → 약속"으로 읽힌다.
스크린샷으로 픽셀 회귀 없음 확인.

### 의도적으로 넣지 않은 것

- **전화번호를 JSON-LD 에 넣지 않았다.** `010-3019-7778` 은 개인 휴대폰이고
  `/legal/business` 에 전자상거래법 때문에 공개돼 있다. 그건 **한 페이지 공개**고,
  사이트 전역 JSON-LD 는 지식패널·AI 답변 노출을 부추기는 **다른 행위**다. SEO 작업의
  부수효과로 개인 번호를 확산시키지 않는다. 넣기를 원하면 `src/lib/schema.ts` 의
  `contactPoint` 에 `telephone` 한 줄. **사장님 결정 사항.**
- **없는 `sameAs` 프로필을 지어내지 않았다.** 여전히 GitHub 릴리스 저장소 하나뿐.
- **과장 카피 없음.** 스키마·메타에 들어간 사실은 전부 화면에 보이는 것과 일치한다.

### 직전 감사에서 뒤집은 결정 1건 (투명 공개)

`docs/SEO_GEO_AUDIT_2026_07.md` A4 는 `/legal/business` 를 **의도적으로 sitemap 에서
제외**했다("토스 심사 수정불가 항목 존중"). **이번에 뒤집어 sitemap 에 넣었다.**

근거: 그 페이지는 `src/components/Footer.tsx:176` 에서 **전 페이지 푸터로 링크**되고
`index: true` 다. 즉 Google 은 sitemap 과 무관하게 크롤·색인한다 — sitemap 제외가
실제로 감추는 것은 **아무것도 없고**, "sitemap ↔ 색인 가능 라우트 1:1" 만 깨뜨린다.
페이지 내용은 **건드리지 않았다**(토스 심사 대상은 그대로).

원복을 원하면 `src/app/sitemap.ts` 의 `pages` 배열에서 `"/legal/business"` 한 줄 삭제.

---

## 3. 검증 증거

전부 로컬 프로덕션 빌드(`next build` EXIT=0) + `next start` 실렌더 측정.

```
F1  /ko/my            수정전 index, follow   → 수정후 noindex, follow    (200 유지)
    /ko/my/subscription  "                  → noindex, follow
    /ko/auth/login       "                  → noindex, follow
    /en/auth/signup      "                  → noindex, follow
    /ko/admin            "                  → noindex, nofollow
    robots.txt        Disallow 6줄          → Disallow: /api/ 만
    회귀 없음:        /ko · /ko/pricing · /ko/blog · /ko/legal/business
                      · /ko/founders/faq → 전부 200 + index, follow 유지

F3  sitemap.xml       69 URL → 75 URL
                      신규 6 = {ko,en,ja} × {/legal/business, /founders/faq}
                      6개 전부 라이브에서도 200 확인

F4  lastmod 방출      전 URL(75) → 블로그만 36 (33 글 + 3 블로그 인덱스)
                      /ko/pricing  → <lastmod> 없음
                      /ko/blog     → <lastmod>2026-07-21</lastmod> (최신 글 실제 날짜)

F7  /pricing          404 → 307 → /en/pricing   (/download, /guide,
                                                 /blog/what-is-marblo 동일)
    회귀 가드:        /sitemap.xml 200 · /robots.txt 200 · /favicon.ico 200
                      · /ko/blog/rss.xml 200   ← matcher 확대가 메타데이터
                                                  라우트를 삼키지 않음 확인

F5  <h1> 실제 내용    ko "마블로 · AI 에이전트 오케스트레이션 플랫폼 / 혼자서 팀 전체의 성과를 만드세요"
                      en "Marblo · AI Agent Orchestration Platform / One developer. An entire team's output."
                      ja "Marblo · AIエージェント・オーケストレーション・プラットフォーム / 一人で、チーム全体の成果を出す"
                      스크린샷 비교: 시각 변화 없음

F6  /ko Organization  description 한국어로 방출 확인 + contactPoint(email만) + address
F8  강의 <title>      ko "AI 에이전트 군단 마스터클래스 — 마블로 v3로 실전 프로젝트 완성"
                      en/ja 영어 (ja 는 데이터에 title_ja 부재 → 의도된 폴백)

hreflang 무결성       sitemap 75 URL 전부 ko/en/ja + x-default 유지
                      x-default = /en = routing.defaultLocale 일치
canonical             페이지별 자기참조 정확 (x-pathname 경로 정상 동작)
```

---

## 4. 사장님 체크리스트 (Search Console — 권한이 있어야 가능)

이 PR 이 **배포된 뒤에** 하는 게 순서다. 배포 전에는 아직 옛 응답이 나간다.

> 아래 1번은 다른 무엇보다 먼저다. 나머지 항목이 전부 무의미해지는 유일한 시나리오라서.

1. **[최우선] 라이브가 200 을 내고 있는지, `noindex` 가 없는지 확인.**

   - 브라우저 대신 이걸로: `curl -s -o /dev/null -w "%{http_code}\n" https://marblo.app/ko`
     → **200** 이어야 한다.
   - `curl -s https://marblo.app/ko | grep -c 'content="noindex"'` → **0** 이어야 한다.
   - 200 이 아니거나 noindex 가 1 이상이면 **다른 모든 항목을 중단하고** 그것부터.
     §0 에서 봤듯 환경변수 하나로 전 페이지가 이 상태가 될 수 있다.

2. **색인 리포트에서 "에러" vs "제외" 를 구분해서 볼 것.**

   - hreflang 로케일 대체본(75 중 50)은 **"적절한 canonical 태그가 있는 대체 페이지"**
     로 잡히는 게 **정상**이다. 에러가 아니다. 직전 감사 A5 와 동일.
   - 진짜로 볼 것: `robots.txt 에 의해 차단되었으나 색인됨` / `발견됨 - 색인되지 않음`
     / `서버 오류(5xx)` / `찾을 수 없음(404)` 카운트.

3. **F1 검증 — `/ko/my`, `/ko/admin`, `/ko/auth/login` 을 URL 검사에 하나씩 넣어볼 것.**

   - 배포 전 기대: "색인 가능" 또는 "차단되었으나 색인됨"
   - 배포 후 기대: **"`noindex` 태그에 의해 제외됨"**
   - 이미 색인돼 있었다면 여기서 빠지기까지 몇 주 걸린다. 급하면
     **삭제 도구(Removals)** 로 임시 숨김 병행.

4. **사이트맵 재제출** (Google Search Console + 네이버 서치어드바이저 양쪽).

   - `https://marblo.app/sitemap.xml`
   - 제출 후 읽은 URL 수가 **75** 인지 확인 (배포 전이면 69).

5. **F7 검증** — `https://marblo.app/pricing` 이 **404 가 아니라 `/en/pricing` 으로
   리다이렉트**되는지. 404 리포트에 로케일 미접두 URL 이 쌓여 있었다면 여기서 준다.

6. **홈·pricing 색인 요청** (URL 검사 → 색인 생성 요청). F5(H1) 재평가를 앞당긴다.

7. **`www` → apex 301** (직전 감사 A6, **아직 미이행 — 이번에도 라이브에서 확인됨**).

   - 현재 `https://www.marblo.app/` 이 307 로 **`www` 를 유지한 채** 서빙된다.
     canonical 이 apex 라 Google 이 통합해 주고 있어 치명적이진 않으나, 호스트가 둘이면
     신호가 갈린다.
   - **코드가 아니라 호스팅/DNS 설정이다.** 에이전트가 못 고친다.

8. **`sameAs` 에 넣을 공식 프로필이 생기면 알려줄 것** (네이버 스마트플레이스, 링크드인,
   ProductHunt, X 등). 브랜드 디스앰비규에이션에 직접 기여한다. 없는 건 안 지어낸다.

9. **전화번호를 JSON-LD 에 넣을지 결정** (§2 참조). 기본값은 "넣지 않음".

---

## 5. 손대지 않은 것 / 후속 티켓 후보

- **F2 근본 수정**: `src/lib/firebase.ts` 가 모듈 로드 시점에 `getAuth()` 를 호출하는
  구조 자체. 지연 초기화로 바꾸면 env 사고가 마케팅 페이지를 죽이지 못한다. 다만 `auth`
  /`db` 의 export 형태를 바꿔야 해서 **SEO 티켓 범위를 넘는다.** 이번엔 `.env.example`
  문서화까지만. → **별도 티켓 권장**
- **`blog.categories.announcement` i18n 누락**: 빌드 로그에 ko/en/ja 전부 경고.
  **이번 변경 이전부터 있던 것**이고 SEO 범위 밖. → 별도 티켓 (직전 감사도 동일 권고)
- **`www` → apex 301**: 인프라. §4-7.
- **백링크·도메인 권위·콘텐츠 전략**: 마케팅 트랙.
- **페이지별 OG title/description**: 현재 모든 하위 페이지가 사이트 공통 OG 를 상속한다
  (`/ko/pricing` 의 `og:title` 이 홈 타이틀). 색인 에러는 아니고 공유·GEO 품질 이슈.
  → 후속 개선 후보
- **기존 canonical/hreflang/robots 로직**: 정상 동작 확인 → 유지.
