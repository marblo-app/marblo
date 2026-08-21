/**
 * DeepSeek **off-peak 할인 시간대** — 순수 함수만.
 *
 * ── 이 파일이 있는 이유 ────────────────────────────────────────────────────
 * 우리 모델 정보표의 DeepSeek 단가는 **peak 정가**다(레지스트리 DeepSeek 블록
 * 주석: 과소보고 방지). 그런데 DeepSeek 의 peak 은 하루 종일이 아니라 **7시간**
 * 뿐이고 나머지 17시간은 정확히 절반이라, 정가만 적어두면 화면이 실제 청구액의
 * 최대 2배를 말하는 시간이 하루의 70%다. 그 간극을 **단가를 바꾸지 않고** 한 줄로
 * 메우는 것이 이 파일의 전부다 — 표시 단가는 그대로 peak 정가로 둔다.
 *
 * ── 출처 ──────────────────────────────────────────────────────────────────
 * https://api-docs.deepseek.com/quick_start/pricing (2026-08-21 확인)
 *   peak     01:00-04:00, 06:00-10:00 UTC  (합 7시간)
 *   off-peak 그 외 전 시간 — input/output 단가가 정확히 절반
 *
 * ── ★왜 컴포넌트가 아니라 lib 인가 ────────────────────────────────────────
 * `lib/modelFactFormat.ts` 상단과 같은 이유다: 이 레포엔 렌더러 컴포넌트 테스트
 * 하네스가 없다(jsdom/testing-library 미도입). 그런데 여기서 **틀린 시간대 판정은
 * 곧 거짓 정보**라 회귀 가드가 반드시 있어야 한다 — "지금 off-peak" 배지가
 * 한 시간이라도 어긋나면, 화면이 없는 할인을 약속하는 셈이다. 그래서 판정을
 * 렌더 없이 검증할 수 있는 순수 함수로 떼어 둔다
 * (`tests/unit/deepseek-off-peak.test.ts` 가 경계 6개를 전부 못박는다).
 *
 * ── ★UTC 를 기준 축으로 삼는 이유 ─────────────────────────────────────────
 * 벤더가 UTC 로 고시하고, UTC 엔 서머타임이 없다. 로컬시간으로 접어 두면 사용자
 * 기기의 타임존/DST 가 판정에 끼어들어 같은 순간이 기기마다 다르게 읽힌다.
 * `Date` 의 `getUTC*` 는 기기 타임존과 무관하게 같은 순간을 같은 값으로 준다.
 * KST 표기는 **표시용 파생**일 뿐이고(고정 +9, 한국은 DST 가 없다), 판정에는
 * 쓰이지 않는다.
 */

/** 하루 안의 구간 [start, end) — 자정 기준 분(minute). */
export interface DayWindow {
  startMinute: number;
  endMinute: number;
}

/** 분 단위 상수. 문자열 "01:00" 을 코드 안에서 다시 파싱하지 않으려고 숫자로 둔다. */
const H = 60;

/**
 * DeepSeek **peak** 구간(UTC). 반열림 [start, end) 이다 — 04:00 정각은 peak 이
 * 아니라 off-peak 다(공식 표기 "01:00-04:00" 의 끝은 경계이지 포함이 아니다).
 */
export const DEEPSEEK_PEAK_WINDOWS_UTC: readonly DayWindow[] = [
  { startMinute: 1 * H, endMinute: 4 * H },
  { startMinute: 6 * H, endMinute: 10 * H },
];

/** KST = UTC+9. 한국은 서머타임이 없어 연중 고정이다. */
export const KST_OFFSET_MINUTES = 9 * H;

/** off-peak 단가는 peak 의 정확히 절반이다(공식 pricing 표). */
export const DEEPSEEK_OFF_PEAK_MULTIPLIER = 0.5;

/** `61` → `"01:01"`. 하루를 넘으면 접는다(24h 모듈로). */
function formatMinuteOfDay(minute: number): string {
  const m = ((minute % 1440) + 1440) % 1440;
  const hh = String(Math.floor(m / 60)).padStart(2, "0");
  const mm = String(m % 60).padStart(2, "0");
  return `${hh}:${mm}`;
}

/**
 * peak 구간을 사람이 읽는 한 줄로. `offsetMinutes` 만큼 밀어서 그린다.
 *
 *   `deepseekPeakWindowsLabel(0)`                  → "01:00-04:00, 06:00-10:00"
 *   `deepseekPeakWindowsLabel(KST_OFFSET_MINUTES)` → "10:00-13:00, 15:00-19:00"
 *
 * ★KST 문자열을 상수로 적어두지 않고 여기서 **파생**하는 이유: 두 벌을 손으로
 * 적으면 한쪽만 고쳐지는 날이 온다. 벤더가 고시를 바꿀 때 손댈 곳은
 * `DEEPSEEK_PEAK_WINDOWS_UTC` 하나뿐이어야 한다.
 */
export function deepseekPeakWindowsLabel(offsetMinutes: number): string {
  return DEEPSEEK_PEAK_WINDOWS_UTC.map(
    (w) =>
      `${formatMinuteOfDay(w.startMinute + offsetMinutes)}-${formatMinuteOfDay(
        w.endMinute + offsetMinutes,
      )}`,
  ).join(", ");
}

/**
 * 지금(또는 주어진 순간)이 peak 인가. off-peak 면 false.
 *
 * ★입력을 `Date` 로 받아 테스트가 임의 순간을 넣을 수 있게 한다. 내부는
 * `getUTC*` 만 쓰므로 기기 타임존이 결과를 바꾸지 않는다.
 */
export function isDeepSeekPeak(at: Date): boolean {
  const minuteOfDay = at.getUTCHours() * 60 + at.getUTCMinutes();
  return DEEPSEEK_PEAK_WINDOWS_UTC.some(
    (w) => minuteOfDay >= w.startMinute && minuteOfDay < w.endMinute,
  );
}
