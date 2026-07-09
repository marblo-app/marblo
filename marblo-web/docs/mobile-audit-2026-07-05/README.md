# 모바일 최적화 감사 — marblo-web (2026-07-05)

**태스크:** `[디자인/모바일] 모바일 최적화 감사 — 메뉴 겹침·반응형 깨짐 에러 찾기` (SBHE5faiOoVLZT1hEF28)
**감사 대상:** `marblo-web` (marblo.app 고객 대면 웹)
**방법:** `next dev` (localhost:3100, Next.js 16 / Turbopack) → Playwright 로 뷰포트 **375px(iPhone SE/미니급)** 에서 프로그램 측정(가로 오버플로·요소 겹침·터치타겟) + 풀페이지 스크린샷
**감사 페이지:** 랜딩(`/ko`) · 요금제(`/ko/pricing`) · 로그인(`/ko/auth/login`) · 파운더(`/ko/founders`) + 헤더 모바일 메뉴 OPEN 상태

---

## 요약 (TL;DR)

marblo-web 은 **모바일 반응형이 견고**하다. 감사한 모든 페이지에서:

- ❌ 가로 스크롤(page-level horizontal overflow) **없음**
- ❌ 컨테이너 밖으로 삐져나오는 요소(true overflow) **없음**
- ❌ **모바일 메뉴 겹침 없음** — 햄버거 OPEN 시 링크 6개가 세로로 깔끔히 스택되고 겹치는 요소쌍 0

> ⚠️ **사장님이 보신 "모바일 메뉴 겹침"은 marblo-web 이 아닐 가능성이 높다.** 종목분석/AI리서치/대시보드 등 사장님이 언급한 페이지는 이 워크트리에 존재하지 않으며(= 별도 스택 `stockai-platform` / antcanfly, 다른 워크트리), 본 태스크 스코프 밖이다. **메뉴 겹침 재현·수정은 그 워크트리 담당 에이전트로 라우팅 필요.**

발견된 실제 개선점은 **크리티컬이 아닌 접근성/견고성 항목**들이며 아래에 후속 티켓 후보로 정리한다.

---

## 스코프 확정 (중요)

태스크 본문의 페이지 목록(랜딩/대시보드/AI리서치/종목분석/요금제/로그인)과 "라이브 antcanfly" 는 **두 개의 다른 제품**을 섞고 있다:

| 제품                                              | 위치                                                     | 페이지                                                |
| ------------------------------------------------- | -------------------------------------------------------- | ----------------------------------------------------- |
| **marblo-web** (marblo.app)                       | 본 워크트리 `marblo-web/`                                | 랜딩·요금제·로그인·가입·체크아웃·강의·파운더·다운로드 |
| **antcanfly / stockai-platform** (종목 투자 제품) | **다른 워크트리** (`.../ZfwjozbxD6.../stockai-platform`) | 대시보드·AI리서치·종목분석                            |

antcanfly 코드는 본 워크트리에 **없다**(`grep -ri antcanfly` = 0건). 따라서 본 감사는 접근 가능한 marblo-web 에 한정했다.

---

## 발견 사항

### F1 — (Medium/접근성) 44px 미만 터치타겟 — 사이트 전역

공용 레이아웃(`Header`, `Footer`, `PromoBar`)의 인터랙티브 요소가 WCAG 2.5.5 / 모바일 권장 44×44px 미만.

| 요소                                                    | 크기        | 위치                 |
| ------------------------------------------------------- | ----------- | -------------------- |
| 푸터 링크(기능/가격/다운로드/버그신고/강의/이용약관 등) | ~156×**20** | `Footer.tsx`         |
| 헤더 데스크톱 nav 링크                                  | ~ ×**20**   | `Header.tsx`         |
| 프로모 배너 닫기 버튼(X)                                | **16×16**   | `PromoBar.tsx`       |
| 요금제 "연간 결제로 전환" 토글                          | ~56×**28**  | `PricingSection.tsx` |
| 프로모 "신청하기" CTA                                   | ~66×**20**  | `PromoBar.tsx`       |

- 근거: Playwright 로 `getBoundingClientRect()` 측정, 페이지별 12~17개 검출.
- 참고: 로그인 폼 인풋은 50px 로 양호. 모바일 메뉴 링크는 세로 24~40px(가로 343px full-width 라 탭 자체는 무난하나 세로 여백 부족).
- 주의: `PromoBar` 닫기 버튼을 44px 로 키우면 얇은 배너(py-1.5, ~28px) 높이를 초과 → **디자인 검토 동반 필요**(단순 padding 증가로는 세로 넘침). 그래서 인라인 즉시수정 대신 후속 티켓 권장.

### F2 — (Low/UX) 랜딩 비교표 가로 스크롤 힌트 부재

`src/app/[locale]/page.tsx:212` 의 경쟁사 비교표(vs Cursor/Copilot/Windsurf, 실폭 573px)는 `div.overflow-x-auto` 로 감싸져 **가로 스크롤은 정상 작동(클립 아님)**. 다만 모바일에서 우측 컬럼이 잘려 보여 **스크롤 가능하다는 시각 힌트(그라데이션 페이드/화살표)가 없다** → 발견성 저하. 깨짐은 아님.

### F3 — (Low/견고성) Firebase apiKey 폴백 부재 → 환경변수 누락 시 전 페이지 500

`src/lib/firebase.ts` 는 `authDomain/projectId/storageBucket/messagingSenderId/appId` 에는 하드코드 폴백이 있으나 **`apiKey` 에는 폴백이 없다**. `Header` 가 모듈 스코프에서 `getAuth()` 를 호출하고 Header 는 루트 레이아웃에 있으므로, `NEXT_PUBLIC_FIREBASE_API_KEY` 가 비면 `auth/invalid-api-key` 로 **모든 마케팅 페이지가 500**. 프로덕션엔 env 가 설정돼 실증상은 없으나, 로컬/신규 배포 환경에서 전면 장애 리스크. (감사 중 로컬에서 이 500 을 재현 → gitignore 되는 `.env.local` 플레이스홀더로 우회함.)

> 판단: "환경 오설정 시 조용히 degrade" vs "크게 실패" 는 정책 선택이라 인라인 수정 대신 팀 결정 필요 항목으로 보고.

---

## 후속 티켓 후보

1. **[a11y] 모바일 터치타겟 44px 정합** — Footer/Header/PromoBar/요금제 토글. 디자인 검토(`/plan-design-review`) 동반.
2. **[ux] 랜딩 비교표 모바일 스크롤 어포던스** — 페이드 마스크/힌트 추가 또는 카드 레이아웃 전환.
3. **[robustness] firebase.ts apiKey 누락 방어** — 모듈-스코프 getAuth 지연화 또는 명시적 부트 체크. 정책 결정 후.

## 증거 스크린샷 (375px 풀페이지)

- `landing-375.png` · `pricing-375.png` · `login-375.png` · `founders-375.png`

## 재현 방법

```bash
cd marblo-web
# apiKey 폴백 부재로, 로컬 렌더엔 NEXT_PUBLIC_FIREBASE_API_KEY 필요 (공개 클라이언트 키)
echo 'NEXT_PUBLIC_FIREBASE_API_KEY=<public-web-key>' > .env.local
npm run dev -- -p 3100
# 브라우저/Playwright 375px 로 각 페이지 방문
```
