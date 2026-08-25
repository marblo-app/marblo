# 차트 라이브러리 실물 비교 — visx vs recharts (2026-08-24)

티켓 `EaWvAqtmijseOgGBTdHw`. 사장님 말씀: **"리차트가 가장 좋지 않나? 수려하고.
프로페셔널해야 돼. AX 대시보드는 와우하게."**

미학은 표로 판정되지 않습니다. 그래서 **같은 데이터로 둘 다 지었습니다.**

> ## ✅ 결론은 났습니다 — 이 문서는 **기록**입니다
> **사장님 결정(2026-08-25): recharts.**
> "기업용 SaaS처럼 다양한 분석을 시각화 대시보드로 구현해야 되고, 그러려면
> 리차트가 맞을 것 같아. 또 차트 클릭하면 인터랙션도 되어야 하고."
>
> 아래 §5 가 제시한 기준(**차트 종류를 10종 넘게 늘릴 계획이면 recharts**)에
> 정확히 해당합니다. 이 문서는 **그 판단의 재료를 지우지 않고 남기기 위해**
> 있습니다 — 나중에 번들이 문제가 되면 여기 숫자가 판단 재료입니다.
>
> 결정과 그 뒤에 무엇을 했는지는 `CHART-LIBRARY-DECISION-2026-08-24.md` 에 있습니다.
>
> ★비교용 정적 페이지(`docs/chart-bakeoff/index.html`, 678 KB)는 **이 저장소에
> 안 실었습니다.** visx 를 지웠으므로 다시 구울 수 없고, 안 쓰는 678 KB 산출물을
> 프로덕션 저장소에 두는 값이 안 맞습니다. 원본은 PR #1210 브랜치
> (`marblo/chart-visual-bakeoff-EaWvAqtm`)에 그대로 있습니다:
> `git show origin/marblo/chart-visual-bakeoff-EaWvAqtm:marblo-web/docs/chart-bakeoff/index.html > /tmp/bakeoff.html`

---

## 0. 요약 한 장

| | **recharts 3.10.1** | **visx 4.0.0** |
| --- | --- | --- |
| 화면 (와우) | 6종 전부 있음 | 6종 전부 있음 — **손으로 만듦** |
| 번들 증가 (gzip 실측) | **+110.3 KB** | **+27.4 KB** |
| 딸려 오는 런타임 | @reduxjs/toolkit · react-redux · immer · reselect (raw 30.0 KB) | d3 모듈뿐 |
| 서버가 그리는 마크 | **0개** (0×0 자리표시자) | 6개 (선 3 + 영역 3) |
| 하이드레이션 (중앙값) | 15~18 ms | 10 ms |
| 만드는 비용 | 코드 200줄 | 코드 362줄 (**+162줄, +81%**) |
| 접근성 기본 제공 | `accessibilityLayer` 있음 | 없음 (`ChartFrame` 이 대신함) |

**어느 쪽을 고르셔도 "모르는 값을 0 으로 안 그린다" 규율은 삽니다** — 두 판 모두
#1208 이 만든 `ChartFrame` 안에 넣었고, 테스트 16개로 고정했습니다.

---

## 1. 공정하게 붙였습니다

한쪽만 유리한 조건이 없도록 다음을 맞췄습니다.

| 조건 | 어떻게 맞췄나 |
| --- | --- |
| 데이터 | 시드 고정 난수 하나(`bakeoff/data.ts`). 새로고침해도 같은 그림입니다 |
| props | 두 구현이 **같은 타입**(`MultiSeriesChartProps`)을 받습니다 — 테스트로 고정 |
| 프레임 | 둘 다 `ChartFrame` 안. 빈 상태·표 보기·접근 가능한 이름이 같습니다 |
| 색 | 둘 다 `var(--viz-*)` 만. 소스에 헥사값 0개 — 테스트로 고정 |
| 범례·툴팁 카드 | **같은 컴포넌트**(`bakeoff/shared.tsx`)를 씁니다 |
| 기간·바탕 전환 | 버튼 하나가 두 차트에 동시에 걸립니다 |

★범례와 툴팁 **카드 디자인**을 공유한 것은 디자인을 맞추기 위해서입니다. 그래도
recharts 만 공짜로 받는 것들(호버 감지·활성 인덱스·툴팁 위치 계산·진입 애니메이션·
축 눈금·반응형 크기)은 그대로 recharts 쪽 이점으로 남습니다. visx 는 그 여섯 개를
전부 손으로 만들었습니다 — 그게 §4 의 비용입니다.

### 와우 요소 — 양쪽 다 켰습니다

| 요소 | recharts | visx |
| --- | --- | --- |
| 진입 애니메이션 | `isAnimationActive` (라이브러리) | `pathLength`+`strokeDashoffset` 키프레임 (손) |
| 호버 하이라이트 | `activeDot` + 계열 dim (반은 손) | 전부 손 |
| 툴팁 | `<Tooltip content>` (위치 계산 라이브러리) | 좌표 역산 + clamp 전부 손 |
| 범례 토글 | 손 (상태는 우리 몫) | 손 |
| 그라데이션 채움 | 손 (`<defs>`) | 손 (`<defs>`) |
| 기간 전환 재애니메이션 | `key` 교체 | `key` 교체 |
| 경계선(요금제 변경) | `<ReferenceLine>` | 손 |
| 값 없는 날 끊기 | `connectNulls={false}` | 구간 분할 직접 |

---

## 2. 번들 — 실측 (redux 런타임 포함, #1208 수치 갱신)

`npx tsx scripts/measure-chart-bundle.tsx` — esbuild · minify · gzip -9 ·
react/react-dom 은 external(앱이 어차피 갖고 있으므로 **차트 때문에 늘어난 몫**만 잽니다).

| 케이스 | raw | gzip | 기준선 대비 gzip | 파싱/컴파일 |
| --- | --- | --- | --- | --- |
| baseline (`ChartFrame` 만) | 2.0 KB | 0.9 KB | — | 0.0 ms |
| **visx** | 80.6 KB | 28.3 KB | **+27.4 KB** | 1.2 ms |
| **recharts** | 378.1 KB | 111.3 KB | **+110.3 KB** | 5.8 ms |

★**recharts 번들 안에 실제로 들어온 상태관리 런타임**(esbuild metafile 기준, raw):

```
@reduxjs/toolkit         13.4 KB
immer                     9.3 KB
react-redux + reselect + use-sync-external-store   나머지
─────────────────────────────────────────
합계                      30.0 KB
```

이건 주장이 아니라 번들 입력 목록입니다. 차트 하나 그리자고 상태관리 런타임 한 벌이
고객 브라우저로 갑니다.

★정직하게 반대편도 적습니다: **visx 도 완전히 깨끗하지는 않습니다.**
`@visx/scale` 이 `math-expression-evaluator`(raw 11.6 KB)를 끌고 옵니다. 다만 규모가
recharts 쪽의 1/3 이고 상태관리 런타임처럼 앱 전역에 영향을 주는 종류는 아닙니다.

**더 내려받아야 하는 양: 82.9 KB (gzip)**

| 회선 | 추가 다운로드 시간 |
| --- | --- |
| Lighthouse Slow 4G (1.6 Mbps) | ≈ **425 ms** |
| 보통 LTE (10 Mbps) | ≈ 68 ms |
| 사무실 유선 (50 Mbps) | ≈ 14 ms |

---

## 3. 하이드레이션 — 오케의 정정을 검증했습니다

> 오케가 자기 판단을 정정했습니다: "recharts 의 SSR 미렌더링을 큰 감점으로 든 것은
> 과대평가였다." **재보니 그 정정이 맞습니다.**

### 3.1 서버가 실제로 보내는 것

`renderToStaticMarkup` 산출물입니다(비교 페이지 안에도 **그대로 박아** 두었습니다 —
JS 없이 보이는 것이 곧 그 화면입니다).

| | 서버 HTML | `<path>` 마크 |
| --- | --- | --- |
| recharts | 8,458 B | **0개** |
| visx | 27,018 B | 6개 |

recharts 가 보내는 것은 이게 전부입니다:

```html
<div class="recharts-responsive-container" style="width:100%;height:100%;min-width:0">
  <div style="width:0;height:0;overflow:visible"></div>
</div>
```

(#1208 은 고정 크기로 테스트해 빈 `recharts-wrapper` 를 봤습니다. `ResponsiveContainer`
를 쓰면 0×0 자리표시자로 더 비어 있습니다. 어느 쪽이든 **그림은 0개**입니다.)

### 3.2 그래서 사용자에게 얼마나 보이나 — 실측

`npx tsx scripts/measure-chart-hydration.tsx` (jsdom · 25회 · 워밍업 제외 · 4회 반복)

| | 중앙값 | p90 | 최소 |
| --- | --- | --- | --- |
| recharts | **15 ~ 18 ms** | 20 ~ 26 ms | 11 ms |
| visx | **10 ms** | 11 ~ 12 ms | 6 ms |

★**측정의 한계를 숨기지 않습니다.** jsdom 에는 레이아웃도 페인트도 네트워크도
없습니다. 그래서 이 숫자는 **CPU 작업분의 하한**입니다. 실제 브라우저에서 빈 칸이
보이는 시간은 대략 이렇게 쌓입니다:

```
빈 칸이 보이는 시간 ≈ (번들 82.9KB 추가 다운로드)  ← 느린 4G 에서 ~425ms, 이게 지배적
                   + (파싱/컴파일 5.8ms − 1.2ms)
                   + (하이드레이션 15~18ms)
                   + 페인트 한 프레임(~16ms)
```

브라우저를 띄우는 GUI 검증이 금지돼 있어 실제 브라우저 수치는 재지 못했습니다.
**추측으로 채우지 않고 못 잰 것은 못 쟀다고 적습니다.**

### 3.3 결론 — 스켈레톤으로 덮으면 안 보입니다

조직 대시보드는 **로그인 게이트 뒤**라 SEO 는 무관합니다. 실제 손해는 "하이드레이션
전 빈 영역이 잠깐 보이는 것"뿐이고, 그 시간은 **CPU 기준 수십 ms** 입니다. 우리가
차트 자리에 높이를 고정해 두었으므로 레이아웃이 튀지도 않습니다(CLS 없음).
스켈레톤 한 겹이면 사용자는 빈 칸을 보지 않습니다. 비교 페이지에 그 모습을
나란히 넣어 두었습니다.

**즉 recharts 의 SSR 미렌더링은 감점이 맞긴 하지만 결정적인 감점은 아닙니다.**
결정적으로 남는 것은 §2 의 번들입니다 — 그건 스켈레톤으로 못 덮습니다.

다만 두 가지는 그대로 비용입니다:
1. 스켈레톤을 **우리가 만들어 붙여야** 합니다(차트마다). visx 는 그럴 자리가 없습니다.
2. 느린 회선에서는 스켈레톤이 **0.4초쯤 더** 떠 있습니다.

---

## 4. visx 로 같은 와우를 만드는 데 든 추가 비용

**이게 사장님 판단의 진짜 재료입니다. 그래서 정직하게 적습니다.**

| | recharts 판 | visx 판 | 차이 |
| --- | --- | --- | --- |
| 코드 (주석·빈 줄 제외) | 200줄 | 362줄 | **+162줄 (+81%)** |
| 구현 소요(이 에이전트 실측) | 45초 | 78초 | +73% |

**손으로 만들어야 했던 것 (visx 쪽만):**

1. **반응형 폭** — `ResizeObserver` 훅 직접 작성 (recharts: `<ResponsiveContainer>` 한 줄)
2. **호버 좌표 역산** — 마우스 x → 데이터 인덱스 (recharts: `<Tooltip>` 이 다 함)
3. **툴팁 위치 clamp** — 가장자리에서 안 잘리게 (recharts: 자동)
4. **진입 애니메이션** — `pathLength` + `strokeDashoffset` 키프레임 + `prefers-reduced-motion` 가드
5. **크로스헤어 + 활성 점 확대** (recharts: `cursor`, `activeDot`)
6. **값 없는 날 구간 분할** (recharts: `connectNulls={false}`)
7. **축 눈금 개수·라벨 위치 조정** (recharts: 기본값이 대체로 맞음)

**사람 기준 환산 — 추정입니다(에이전트 시간은 사람 시간이 아닙니다).**
위 7가지를 처음부터 짜고 다듬는 데 숙련 프론트엔드 기준 **반나절~하루(4~8시간)**
더 든다고 봅니다. 근거: 항목당 30~60분 × 7 + 통합·미세조정.

★**그런데 이 비용은 일회성입니다.** 지금 `VisxMultiSeriesChart` 가 만들어졌으므로
다음 차트부터는 두 라이브러리의 작성 비용이 거의 같아집니다. 반대로 번들 +82.9 KB 는
**모든 사용자가 매번** 치릅니다.

**★반대로도 정직하게 적습니다 — visx 쪽이 계속 비쌀 것들:**
- 새로운 **차트 종류**(누적 막대, 파이, 산점도, 브러시 줌)를 추가할 때마다 다시 손으로
  만들어야 합니다. recharts 는 컴포넌트 하나 추가면 끝입니다. 이번엔 시계열 하나라
  차이가 작았을 뿐입니다.
- recharts 의 `accessibilityLayer`(방향키 탐색)는 visx 에 없습니다. `ChartFrame` 이
  role·이름·설명·표 보기로 갚고 있지만 **키보드 탐색은 아직 못 갚았습니다.**

---

## 5. 제 의견 (결정은 사장님이 하십니다)

**"수려함"에서 두 판은 사실상 같습니다.** 열어 보시면 아시겠지만, 같은 팔레트·같은
그라데이션·같은 곡선(monotone)·같은 애니메이션 길이를 쓰면 두 그림은 구분이 거의
안 갑니다. **recharts 가 더 수려해 보였던 것은 recharts 가 예뻐서가 아니라, 어드민의
손 SVG 차트에 그라데이션도 호버도 애니메이션도 없었기 때문입니다.** 그건 라이브러리
선택 문제가 아니라 구현 부재 문제였고, 이번에 visx 쪽에도 다 넣으니 같아졌습니다.

**그래서 저는 visx 를 권합니다.** 이유는 미학이 아니라 이것입니다:

1. **화려함이 같다면 남는 건 값입니다.** +82.9 KB gzip 을 고객이 매번 냅니다.
2. **차트 하나에 상태관리 런타임(redux+immer)이 딸려 오는 건 값이 안 맞습니다.**
3. 서버에서 그려진다는 건 스켈레톤을 안 만들어도 된다는 뜻입니다(차트마다 아낍니다).

**recharts 를 고르실 만한 정당한 이유도 있습니다** — 앞으로 차트 종류를 많이 늘리실
계획이라면(누적 막대·파이·산점도·브러시 줌…) recharts 가 확실히 빠릅니다. 그리고
키보드 탐색이 기본으로 옵니다. 조직 대시보드에 차트가 3~4종에서 그친다면 visx,
10종 넘게 붙일 계획이면 recharts 가 유리합니다.

**어느 쪽을 고르셔도 이번에 만든 것은 안 버려집니다** — 두 판 모두 같은 `ChartFrame`
안에서 같은 props 로 돌고, 규율(모르는 값을 0 으로 안 그리기)은 프레임이 지킵니다.
고르시면 나머지 하나를 지우는 PR 만 하면 됩니다.

---

## 6. 무엇을 만들었나 (파일) — ★당시 기준. 지금은 §7 을 보십시오

```
src/components/charts/
├── RechartsMultiSeriesChart.tsx   ← recharts 판 (ChartFrame 안)
├── VisxMultiSeriesChart.tsx       ← visx 판 (와우 전부 손으로)
├── bakeoff/
│   ├── BakeoffApp.tsx             ← 나란히 놓은 비교 화면
│   ├── shared.tsx                 ← 범례·툴팁 카드·표 (양쪽 공용)
│   ├── data.ts                    ← 시드 고정 표본 데이터
│   ├── bakeoff.css                ← 페이지 껍데기 (헥사값 0개)
│   ├── jsdomEnv.ts                ← 계측·테스트용 DOM (제품 코드 아님)
│   └── main.tsx                   ← 정적 페이지 진입점
├── bakeoff.test.tsx               ← 규율 대조 (16개)
└── bakeoff.interaction.test.tsx   ← 범례 토글·툴팁·페이지 전체 마운트 (9개)

scripts/
├── build-chart-bakeoff.tsx        ← 정적 산출물 빌드 (+ SSR 증거 굽기)
├── measure-chart-bundle.tsx       ← 번들·파싱 실측
└── measure-chart-hydration.tsx    ← 하이드레이션 실측

docs/chart-bakeoff/index.html      ← ★사장님이 여실 파일
```

### 다시 만들려면

```bash
cd marblo-web
npx tsx scripts/build-chart-bakeoff.tsx      # 비교 페이지 다시 굽기
npx tsx scripts/measure-chart-bundle.tsx     # 번들 수치 다시 재기
npx tsx scripts/measure-chart-hydration.tsx  # 하이드레이션 다시 재기
npm test                                     # 규율 테스트
```

### 검증

- `npm test` — 468개 중 467 통과. 실패 1건은 `teamCopy.test.ts`(main 에 이미 있던 것,
  이 작업과 무관).
- 차트 테스트 37개 전부 통과 (`bakeoff.test.tsx` 16 + `bakeoff.interaction.test.tsx` 9
  + 기존 `theme` / `parity` 12).
- `npx tsc --noEmit` · `npx eslint src/components/charts scripts` 통과.
- GUI 검증은 하지 않았습니다 — Playwright·Electron 을 띄우지 않았습니다. jsdom 은
  브라우저가 아니라 DOM 구현체입니다.

---

## 7. 이 티켓이 하지 않은 것

- **어느 쪽도 지우지 않았습니다.** 사장님이 고르시면 나머지를 지우는 PR 이 따로 갑니다.
- 어드민의 나머지 차트(`LineChart` 4곳, `TwoLineChart`, `StackedBarChart`)는 안 건드렸습니다.
- `#1206`(조직 대시보드 화면 설계, 머지 보류)은 건드리지 않았습니다.

---

## 8. 그 뒤 (2026-08-25, 티켓 cUsZBatAgMXGeUObwFmV)

사장님 결정에 따라 정리했습니다. 이 문서의 숫자는 **한 줄도 안 고쳤습니다.**

| 이 문서가 만든 것 | 지금 |
| --- | --- |
| `RechartsMultiSeriesChart.tsx` | → `MultiSeriesChart.tsx` (제품 차트로 승격) |
| `VisxMultiSeriesChart.tsx` | ★삭제 |
| `bakeoff/shared.tsx` | → `primitives.tsx` (범례·툴팁 카드·표) |
| `bakeoff/jsdomEnv.ts` | → `testEnv.ts` |
| `bakeoff/BakeoffApp.tsx` · `bakeoff.css` · `main.tsx` · `data.ts` | ★삭제 (비교 화면) |
| `scripts/build-chart-bakeoff.tsx` | ★삭제 (visx 없이는 못 굽는다) |
| `scripts/measure-chart-bundle.tsx` | 유지 — **recharts 만 재도록** 고쳤습니다 |
| `scripts/measure-chart-hydration.tsx` | ★삭제 (두 라이브러리 비교 전용이었습니다) |
| `bakeoff.test.tsx` · `bakeoff.interaction.test.tsx` | → `discipline.test.tsx` · `interaction.test.tsx` |
| `@visx/*` 의존성 5개 | ★package.json · lock · 소스에서 제거 |

**번들 재측정 (2026-08-25, 이 PR 기준):**

```
baseline (ChartFrame만)     3.1 KB raw /   1.4 KB gzip        —
TimeSeriesChart           380.0 KB raw / 112.2 KB gzip  +110.7 KB
MultiSeriesChart          382.8 KB raw / 113.0 KB gzip  +111.5 KB
```

§2 가 잰 +110.3 KB 와 같은 자리입니다(측정 대상 컴포넌트가 조금 커진 만큼만
늘었습니다). 상태관리 런타임(@reduxjs/toolkit 13.4 KB · immer 9.3 KB)도 그대로
들어옵니다 — **사장님이 아시고 고르신 값이고, 이 기록은 그대로 둡니다.**
