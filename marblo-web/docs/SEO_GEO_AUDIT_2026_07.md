# marblo-web SEO/색인 감사 리포트 (2026-07-22)

티켓: A4ZCypgyhrecnJTQZXmg · 프레임워크: `/seo-geo-full` 스킬
대상: `marblo-web` (Next.js 16.2.2 App Router + next-intl, 3 로케일 ko/en/ja)
사이트: https://marblo.app (canonical origin = apex, `www` 아님)

---

## 0. 방법과 한계

- 기존 SEO 인프라(`sitemap.ts`, `robots.ts`, `lib/seo.ts`, `lib/schema.ts`, 레이아웃
  메타데이터)를 **신규 생성 없이 감사·보강**했다.
- **Search Console 실데이터 접근 권한이 없어**, 라이브 `sitemap.xml`/`robots.txt`
  전수 크롤 + 실페이지 HTTP 응답/메타 검사로 갈음했다. GSC 리포트의 정확한 카운트는
  사장님이 콘솔에서 확인해야 한다(§5 참고).
- 모든 수정은 로컬 프로덕션 빌드(`next build` + `next start`)에서 실제 렌더 HTML을
  curl 로 검증했다(§4 증거).

### ⚠️ '전 페이지 noindex' 는 오탐이었다 (중요)

초기 로컬 검사에서 모든 페이지가 `<meta name="robots" content="noindex">` +
`index, follow` 두 개를 내보내는 것처럼 보였다. **추적 결과 이는 실제 버그가 아니라,
내 로컬 빌드가 Firebase 설정 부재로 500(에러 페이지)을 내면서 Next 의 에러 바운더리가
`noindex` 를 주입한 것**이었다. **라이브 marblo.app 은 `/ko`·`/ko/pricing` 모두
HTTP 200 + 단일 `index, follow` + 정확한 canonical/hreflang** 로 정상이다.
→ "코드 검증 ≠ 라이브" 원칙으로 라이브 확인해 거짓 크리티컬을 회피했다.

---

## 부분 A — 색인 에러 진단

### A0. 사이트맵 자체는 깨끗하다

라이브 `sitemap.xml` 60 URL 전수 HTTP 상태 = **모두 200**(리다이렉트·404 없음).
즉 "사이트맵에 있는데 404/리다이렉트되는 URL" 유형의 에러는 **없다**. GSC 색인
에러의 원인은 사이트맵 밖에 있다(아래).

### 색인 에러 유형별 진단

| #   | 유형                               | 진단                                                                                                                                                                                              | 조치                                                                                                                                                         |
| --- | ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| A1  | **priority 오배분**                | 강의를 어제 '출시 예정'으로 내렸는데 `/lectures` 와 `/lectures/marblo-v3-masterclass` 가 sitemap priority **0.9** — 핵심 전환 페이지(pricing/download 0.8)보다 높음. 크롤러에 잘못된 중요도 신호. | ✅ **코드 수정**: 강의 0.9→**0.5**(coming-soon=2차 콘텐츠). index 자체는 유지(실제 커리큘럼 콘텐츠 + 출시알림 수집이 있어 색인 가치 있음).                   |
| A2  | **기능/폼 페이지가 색인 허용**     | `/checkout`(+`/success`,`/fail`), `/beta-survey`, `/bugs` 가 전부 200 + `index, follow`. 트랜잭션·인증폼·thin 페이지라 GSC "크롤됨-현재 색인 안 됨" 노이즈 유발.                                  | ✅ **코드 수정**: 각 라우트 레이아웃에 `robots: noindex` 부여. robots.txt Disallow 가 아닌 **noindex**(크롤 가능하게 두어 이미 색인된 것도 깨끗이 제거되게). |
| A3  | **소프트 404 리다이렉트**          | `/founders/feedback` 가 **클라이언트 JS 리다이렉트**(→ `/beta-survey`). 크롤러는 200 thin 페이지로 크롤 → "페이지에 리다이렉트가 있음"/소프트404.                                                 | ✅ **코드 수정**: `next.config.ts` 에 **308 서버 리다이렉트** 추가. 크롤 가능한 페이지가 아예 안 생김.                                                       |
| A4  | **법무 페이지 사이트맵 누락**      | `/legal/privacy`, `/legal/terms`, `/legal/refund` 는 200 + index 인데 sitemap 에 없어 발견성 낮음(신뢰 신호 낭비).                                                                                | ✅ **코드 수정**: sitemap 에 priority 0.3 으로 추가. `/legal/business`(사업자정보)는 **의도적으로 제외**(토스 심사 수정불가 항목 존중).                      |
| A5  | **hreflang 대체 페이지 대량 제외** | 60 URL 중 40개가 비-x-default 로케일 대체본 → GSC 에 "적절한 canonical 태그가 있는 대체 페이지"로 대량 표시됨. **이는 에러가 아니라 정상 제외**(hreflang 클러스터의 정상 동작).                   | 조치 불요. GSC 에서 "에러"가 아닌 "제외/유효"로 분류되는지만 확인 권고.                                                                                      |
| A6  | **apex/www 이중 호스트**           | `marblo.app/` → 307 → `/en`, **`www.marblo.app` 도 서빙**(307). canonical 이 항상 apex 절대경로라 Google 이 통합하므로 치명적이진 않음.                                                           | 🔶 **권고(인프라)**: `www` → apex **301** 리다이렉트 설정(코드 아닌 DNS/호스팅 레벨). 로케일 루트 307→308(permanent) 승격도 검토(next-intl 기본값 이슈).     |

---

## 부분 B — 키워드 노출('마블로', '마블로 AI 에이전트')

### 진단

- **홈 `<title>` 은 양호**: "마블로 — AI 에이전트 군단 워크스페이스"(로케일별 현지화됨).
- **B1. 홈 H1 에 브랜드/핵심 키워드 부재**: H1 = "혼자서 팀 전체의 성과를 만드세요"
  (감성 카피, '마블로'·'AI 에이전트' 없음). 브랜드는 badge/본문에만.
- **B2. 하위 페이지 title/description 이 ko/ja 에서도 영어**: `/ko/pricing` →
  "Pricing | 마블로" + 영문 description. '마블로 가격/다운로드/강의' 같은 한국어
  쿼리에 취약.
- **B3. 브랜드 엔티티 신호 약함**: Organization/WebSite JSON-LD 에 한글/가타카나
  브랜드명(`alternateName`)이 없어 "마블로"(한글) 쿼리 ↔ 엔티티 연결이 약함.

### 조치

| #   | 조치                                                                                                                                                            | 유형              |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------- |
| B1  | 홈 hero **badge 에 브랜드 키워드 삽입**: "**마블로 · AI 에이전트 오케스트레이션 플랫폼**"(en/ja 동일 패턴). H1 바로 위 가시 요소에 '마블로'+'AI 에이전트' 노출. | ✅ 코드(messages) |
| B2  | pricing/download/lectures/founders **title 로케일화**(기존 `nav` 라벨 재사용 → 가격/다운로드/강의/파운더 \| 마블로). pricing **description 도 한국어화**.       | ✅ 코드           |
| B3  | Organization + WebSite schema 에 **`alternateName: ["마블로","マブロ"]`** 추가 — 한글/가타카나 브랜드 쿼리를 같은 엔티티로 해석시킴.                            | ✅ 코드(schema)   |

### 🔶 권고(코드 아님 — 사장님/전략 판단)

1. **"마블로" 단일 브랜드 쿼리 미노출은 대부분 온페이지가 아니라 색인/권위 문제**다.
   신생 도메인 + "마블로"는 동음이의(보드게임 카페 등)와 경쟁 → 온페이지만으로 해결 불가.
2. **엔티티 권위 보강**: Organization `sameAs` 가 현재 GitHub 릴리스 저장소 하나뿐.
   실제 공식 프로필(네이버 블로그/스마트플레이스, 링크드인, ProductHunt, X 등)이
   생기면 `sameAs` 에 추가 — 브랜드 디스앰비규에이션에 직접 기여. (없는 프로필을
   지어내지 않음.)
3. **백링크/도메인 권위**: 언론/디렉토리/커뮤니티 인용 확보(별도 마케팅 트랙).
4. **홈 H1 재작성 여부**는 브랜드 카피 결정(디자인/CEO 리뷰). SEO 관점만 보면
   H1 에 '마블로 AI 에이전트' 를 자연스럽게 녹이면 유리하나, 감성 훅을 유지하려면
   현행 badge 보강으로 갈음 가능. 강제 아님.
5. **Google Search Console 등록/사이트맵 재제출** 후 URL 검사 도구로
   `/ko`(홈)와 `/ko/pricing` 색인 요청. Naver 서치어드바이저에도 sitemap 재제출.

---

## 4. 검증 증거 (로컬 prod 렌더, 더미 Firebase 설정으로 200 렌더)

```
sitemap.xml     : 69 URL (기존 60 + 법무 9). /ko=1.0, lectures=0.5, legal=0.3
noindex 확인    : /ko/checkout, /checkout/success, /ko/bugs → "noindex, nofollow" (200)
                  /ko/beta-survey → "noindex, follow" (200)
index 유지+현지화: /ko/pricing "가격 | 마블로" index,follow / desc="마블로 요금제 —…"
                  /ko/download "다운로드 | 마블로" / /ko/lectures "강의 | 마블로"
                  /ko/founders "파운더 | 마블로"
                  /ja/pricing "料金 | Marblo" / /en/pricing "Pricing | Marblo"
리다이렉트       : /ko/founders/feedback → 308 → /ko/beta-survey
schema          : Organization+WebSite 에 "alternateName":["마블로","マブロ"]
badge           : "마블로 · AI 에이전트 오케스트레이션 플랫폼" 렌더 확인
build           : next build EXIT=0 (타입 통과)
```

라이브(marblo.app) 확인: 홈/pricing 200 + 단일 index,follow + canonical 정확,
sitemap 60 URL 전수 200. (배포 후 위 코드 변경이 라이브에 반영되면 §4 로컬 결과와 일치.)

## 5. 사장님 후속 액션 (권한 필요)

1. Search Console → **색인 리포트에서 실제 "에러" vs "제외" 카운트 확인**.
   A5(hreflang 대체본)는 "제외/유효"로 잡히면 정상.
2. `www` → apex **301** 리다이렉트(호스팅/DNS).
3. 새 sitemap 재제출(Google + Naver) 후 홈·pricing URL 색인 요청.
4. 공식 소셜/디렉토리 프로필이 생기면 알려주면 `sameAs` 에 반영.

## 6. 손대지 않은 것 (범위 경계 준수)

- **푸터 사업자정보 / `/legal/business`**: 미변경(토스 심사 수정불가).
- 백링크·도메인 권위·콘텐츠 전략: 권고로만 분리(코드 미변경).
- 기존 canonical/hreflang/robots 로직: 정상 동작 확인 → 유지.
- 사전 존재하던 `blog.categories.announcement` i18n 누락 경고: SEO 범위 밖, 별도 티켓 권고.
