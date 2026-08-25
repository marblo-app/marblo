/**
 * 차트가 그릴 수 있는 것과, 그리면 **안 되는** 것.
 *
 * ★집계는 여기 없다. 데이터는 밖에서 만들고 차트는 그리기만 한다 — 라이브러리를
 *   넣는 건 보기 좋게 만드는 일이지 숫자를 바꾸는 일이 아니다.
 */

/** 시계열 한 점. `date` 는 정렬 가능한 문자열(보통 `YYYY-MM-DD`). */
export type SeriesPoint = { date: string; value: number };

/**
 * ★차트가 처한 상태. 이걸 차트가 **추론하지 않는다** — 부르는 쪽이 정해서 준다.
 *
 * 왜 추론하면 안 되나: 화면이 이미 쓰고 있는 신뢰도 표기(녹/노랑/빨강 +
 * '적재 전')는 "빈 배열" 하나로는 절대 복원할 수 없는 구분이다. 소스가 없어서
 * 빈 것과, 소스는 있는데 이 구간에 값이 없는 것은 **보는 사람이 할 일이 다르다.**
 * 차트가 그걸 혼자 정하면 그 장치가 무너진다.
 *
 *  | 상태           | 뜻                              | 차트가 하는 일                  |
 *  |----------------|---------------------------------|---------------------------------|
 *  | `ready`        | 그릴 값이 있다                  | 그린다                          |
 *  | `empty`        | 측정은 됐는데 이 구간에 값 없음 | ★안 그린다 — 0 선을 긋지 않는다 |
 *  | `pending`      | 파생표/소스가 아직 없다(적재 전)| ★안 그린다 + '적재 전' 이라고 씀|
 *  | `insufficient` | 그리긴 하는데 표본이 너무 적다  | 그리되 **표본 수를 같이 박는다**|
 *
 * ★`empty` 와 `pending` 이 둘 다 "안 그린다" 인데 왜 가르나 — 문구가 다르고,
 *   보는 사람이 할 일이 다르다. '적재 전' 은 기다리면 채워지고, `empty` 는
 *   기다려도 안 채워진다(그 구간엔 정말 아무 일도 없었다).
 */
export type ChartDataState = "ready" | "empty" | "pending" | "insufficient";

/** 바탕. 어드민은 항상 `dark`, 조직 대시보드는 항상 `light`. */
export type VizSurface = "light" | "dark";

/** 계열 슬롯. 순환 금지 — 모자라면 색을 만들지 말고 '그 외'로 접는다. */
export type SeriesSlot = 1 | 2 | 3 | 4 | 5 | 6 | 7;

/** 슬롯 번호 → CSS 변수. 컴포넌트에 헥사값이 들어오는 걸 막는 유일한 통로다. */
export function seriesVar(slot: SeriesSlot): string {
  return `var(--viz-series-${slot})`;
}

/**
 * ★계열이 **상태를 뜻할 때** 쓰는 색. 이탈·실패·좀비처럼 계열 자체가
 * "나쁜 쪽" 을 가리키는 경우다.
 *
 * ★★색을 더 얻는 통로가 아니다. 계열이 모자라면 여기서 꺼내 쓰지 말고
 *   '그 외'로 접어라(tokens.css §슬롯은 순환하지 않는다). 상태색은 예약돼
 *   있고, 색만으로 뜻을 지지 않도록 **항상 범례 라벨과 함께** 나간다.
 */
export type SeriesTone = "good" | "warn" | "serious" | "critical";

/** 슬롯/톤 → CSS 변수. 톤이 있으면 상태색이 이긴다. */
export function seriesColorVar(slot: SeriesSlot, tone?: SeriesTone): string {
  return tone ? `var(--viz-status-${tone})` : seriesVar(slot);
}

/** 시계열 위의 경계선(단위가 바뀐 날 등). */
export type ChartMarkerSpec = { date: string; label: string; hint?: string };

/**
 * 마커를 그릴 x 인덱스. 구간 밖이면 null — 선을 긋지 않는다.
 * (AnalyticsPanel 의 `markerIndex` 와 같은 규칙: idx<=0 이면 조회 구간 전체가
 * 경계 이후라 선이 화면 밖이다.)
 */
export function markerIndexOf(
  dates: string[],
  marker: ChartMarkerSpec | undefined
): number | null {
  if (!marker) return null;
  const idx = dates.findIndex((d) => d >= marker.date);
  if (idx <= 0) return null;
  return idx;
}

/* ===========================================================================
 * 다계열 계약 — 여러 계열을 한 축 위에 놓을 때.
 *
 * ★#1210(bakeoff)에서 visx 판과 recharts 판이 **같은 props** 를 받게 하려고
 *   만든 계약이다. 사장님이 recharts 를 고르셨으므로 visx 판은 지웠지만, 이
 *   계약은 남긴다 — 라이브러리를 이 타입 뒤에 가둬 두는 것이 다음에 또 갈아탈
 *   때(또는 한 화면만 다른 걸 쓸 때) 값을 하는 자리다.
 * ======================================================================== */

/**
 * 이름이 붙은 한 계열. 슬롯은 **엔티티를 따라간다** — 순서로 다시 칠하지 않는다.
 * 필터로 계열 수가 바뀌어도 남은 계열의 색이 안 바뀐다는 뜻이다.
 */
export type NamedSeries = {
  /** 계열 식별자. 범례 토글·툴팁·드릴다운이 전부 이걸로 계열을 가리킨다. */
  key: string;
  label: string;
  slot: SeriesSlot;
  /** 계열이 상태를 뜻할 때(이탈·실패). ★색을 더 얻는 통로가 아니다. */
  tone?: SeriesTone;
  points: SeriesPoint[];
  /**
   * ★클릭하면 어디로 가나 — **차트가 정하지 않는다.**
   *
   * 이 값이 없으면 그 계열에는 클릭 핸들러가 **아예 안 붙는다**(커서도 안
   * 바뀌고 힌트도 안 뜬다). 차트가 드릴 대상을 지어낼 수 없게 만든 것이다.
   *
   * 왜 이렇게까지 하나: 조직 대시보드에서 팀장이 차트를 클릭해 남의 팀 행으로
   * 들어가면 그게 유출이다(org-access §3.4). 서버가 "이 사용자에게 실린다"고
   * 판정한 스코프 키를 계열에 **붙여 보내야만** 그 계열이 클릭 가능해진다.
   */
  drillScopeKey?: string;
  /**
   * 전 기간 대비 비교선. `points[i]` 가 아니라 **인덱스로** 지금 구간에 겹친다
   * (8/1~8/7 위에 7/25~7/31 을 얹는 식). 날짜가 다르므로 x 는 지금 구간의
   * 날짜를 쓰고, 툴팁에서만 이전 구간 날짜를 같이 낸다.
   */
  compare?: { label: string; points: SeriesPoint[] };
};

/**
 * 클릭이 데려가는 곳. ★차트가 만들지 않는다 — 계열에 붙어 온 것을 그대로 낸다.
 *
 * 두 종류의 클릭이 있고, 둘 다 여기로 나온다:
 *   · **날짜 단면 클릭**(그림 아무 데나) → `seriesKey` 없음. "그날로 들어간다".
 *   · **점 클릭**(활성 점) → `seriesKey` 와 그 날 그 계열의 값이 실린다.
 */
export type DrillTarget = {
  /** 서버가 이 사용자에게 실린다고 판정한 스코프 키. */
  scopeKey: string;
  date: string;
  /** 계열이 특정된 클릭이면 그 계열. 날짜 단면 클릭이면 `undefined`. */
  seriesKey?: string;
  /** 그 날 그 계열의 값. 값이 없는 날이면 `null` — 0 이 아니다. */
  value?: number | null;
};

/**
 * ★Y축 도메인 — 자동 스케일을 **끄는** 자리.
 *
 * org-access §3.4-10 이 파생값 15개 중 하나로 지목한 누출 경로다: 축을
 * 라이브러리가 자동으로 잡으면 최댓값이 축 눈금에 그대로 인쇄되는데, 그
 * 최댓값이 내 스코프 밖의 값이면 **차트를 안 봐도 축만 보고 새어나간다.**
 * 코드에 안 보이는 종류의 누출이라 특히 잘 잊힌다.
 *
 *  | 종류               | 축 상한                        | 언제                          |
 *  |--------------------|--------------------------------|-------------------------------|
 *  | `visible`(기본)    | **화면에 실제로 그려진 값**의 최대 | 봉투가 이미 스코프로 걸러졌을 때 |
 *  | `fixed`            | 부르는 쪽이 못박은 값           | 여러 화면의 축을 맞출 때        |
 *
 * ★`visible` 이 "데이터 최대" 가 아니라 "**그려진** 값의 최대" 인 게 핵심이다.
 *   범례로 끈 계열, 숨긴 계열은 축에 영향을 주지 않는다. 안 보이는 것이 축을
 *   밀어 올리면 그게 바로 §3.4-9(스택 전체 높이)·§3.4-10 이 말한 뺄셈이다.
 */
export type YDomainSpec =
  | { kind: "visible" }
  | { kind: "fixed"; max: number };

/** 기본값. 명시적으로 적어 두는 이유는 "자동"이 기본값이 아님을 코드로 말하기 위해서다. */
export const DEFAULT_Y_DOMAIN: YDomainSpec = { kind: "visible" };

/** 두 구현이 공통으로 받는 props. */
export type MultiSeriesChartProps = {
  series: NamedSeries[];
  title: string;
  description?: string;
  surface?: VizSurface;
  /** ★차트가 추론하지 않는다. 부르는 쪽이 준다. */
  state?: ChartDataState;
  sampleSize?: number;
  emptyLabel?: string;
  pendingLabel?: string;
  format?: (n: number) => string;
  /** 기간 전환 시 진입 애니메이션을 다시 태우는 키. 값이 바뀌면 다시 그린다. */
  animationKey?: string | number;
  marker?: ChartMarkerSpec;
  /** ★자동 스케일 금지. 안 주면 `visible` — 그려진 값만 본다. */
  yDomain?: YDomainSpec;
  /**
   * 클릭 수신. ★이걸 줘도 `drillScopeKey` 가 없는 계열은 클릭이 안 붙는다.
   * 두 조건이 **둘 다** 있어야 클릭이 산다.
   */
  onDrill?: (target: DrillTarget) => void;
  /**
   * 이 사용자에게 실리는 스코프 키 집합. 주면 마지막 관문으로 한 번 더 거른다 —
   * 목록에 없는 스코프는 클릭이 안 붙고 `onDrill` 도 안 불린다.
   */
  visibleScopes?: ReadonlySet<string>;
  /**
   * 진입 애니메이션. 기본 켜짐이되 `prefers-reduced-motion` 이면 자동으로 꺼진다.
   * ★테스트에서 `false` 로 준다 — 애니메이션 중에는 recharts 가 값 라벨을 아직
   *   안 그리는데, 그걸 "라벨이 없다"로 읽으면 검사가 거짓말을 한다.
   */
  animate?: boolean;
};

/** 두 구현이 같은 규칙으로 상태를 정하도록 한 곳에 모은다. */
export function resolveChartState(
  series: NamedSeries[],
  explicit?: ChartDataState
): ChartDataState {
  if (explicit) return explicit;
  const anyPoint = series.some((s) => s.points.some((p) => isFinite(p.value)));
  return anyPoint ? "ready" : "empty";
}

/** 계열들을 가로지르는 날짜 축(합집합, 정렬). 집계가 아니라 축 구성이다. */
export function unionDates(series: NamedSeries[]): string[] {
  const set = new Set<string>();
  for (const s of series) for (const p of s.points) set.add(p.date);
  return [...set].sort();
}

/**
 * ★축 상한. **보이는 계열의 그려진 값만** 본다.
 *
 * `hidden` 에 든 계열은 세지 않는다 — 범례로 끈 계열이 축을 밀어 올리면
 * "안 보이는데 크다"가 축 눈금으로 새어나간다.
 */
export function visibleMax(
  series: NamedSeries[],
  hidden?: ReadonlySet<string>
): number {
  let max = 0;
  for (const s of series) {
    if (hidden?.has(s.key)) continue;
    for (const p of s.points) if (isFinite(p.value) && p.value > max) max = p.value;
    // 비교선도 그려지면 축에 든다 — 그려지는 것만 축을 만든다는 규칙은
    // 비교선에도 똑같이 적용된다.
    for (const p of s.compare?.points ?? [])
      if (isFinite(p.value) && p.value > max) max = p.value;
  }
  return max;
}

/**
 * ★도메인을 **숫자로 확정**한다. recharts 에 `"auto"` 나 `"dataMax"` 를
 * 넘기지 않는 유일한 통로다 — 문자열을 넘기는 순간 축이 라이브러리 것이 된다.
 *
 * 0 을 바닥으로 고정하는 이유: 잘린 축은 같은 데이터로 다른 이야기를 만든다.
 * 상한을 nice 반올림 하지 않는 이유: 반올림은 축 눈금에 **없던 숫자**를
 * 찍는데, 우리는 이전 손 SVG 와 같은 숫자를 유지해야 한다(parity).
 */
export function resolveYDomain(
  series: NamedSeries[],
  hidden: ReadonlySet<string> | undefined,
  spec: YDomainSpec = DEFAULT_Y_DOMAIN
): [number, number] {
  if (spec.kind === "fixed") return [0, spec.max > 0 ? spec.max : 1];
  const max = visibleMax(series, hidden);
  return [0, max > 0 ? max : 1];
}

/**
 * 못박은 상한이 그려질 값을 다 덮나. `false` 면 그림이 잘린다 — 조용히 자르지
 * 않고 차트가 눈에 보이게 말한다(footer 경고).
 */
export function yDomainCoversData(
  series: NamedSeries[],
  hidden: ReadonlySet<string> | undefined,
  spec: YDomainSpec = DEFAULT_Y_DOMAIN
): boolean {
  if (spec.kind !== "fixed") return true;
  return visibleMax(series, hidden) <= spec.max;
}

/**
 * ★클릭이 허용되나. `drillScopeKey` 가 없으면 절대 안 되고, `visibleScopes` 를
 * 받았으면 거기 든 것만 된다. 차트가 이 함수를 거치지 않고 클릭을 내면 안 된다.
 */
export function isDrillAllowed(
  scopeKey: string | undefined,
  visibleScopes?: ReadonlySet<string>
): scopeKey is string {
  if (!scopeKey) return false;
  if (!visibleScopes) return true;
  return visibleScopes.has(scopeKey);
}
