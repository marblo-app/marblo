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
