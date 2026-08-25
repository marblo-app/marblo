export const TERMINAL_CJK_RATIO_TARGET = 2;
export const TERMINAL_CJK_RATIO_TOLERANCE = 0.001;
export const TERMINAL_CJK_SCREEN_RATIO_TOLERANCE = 0.1;
export const TERMINAL_CJK_LETTER_SPACING_TOLERANCE_PX = 0.05;

export interface TerminalCjkMetricSample {
  fontLoaded?: boolean;
  asciiWidth: number;
  hangulWidth: number;
  screenCellWidth?: number | null;
  rowsLetterSpacingPx?: number | null;
  maxAbsSpanLetterSpacingPx?: number | null;
}

export interface TerminalCjkMetricHealth {
  ok: boolean;
  failures: string[];
  hangulToAsciiRatio: number | null;
  hangulToScreenCellRatio: number | null;
}

function isPositiveFinite(value: number): boolean {
  return Number.isFinite(value) && value > 0;
}

function isClose(actual: number, expected: number, tolerance: number): boolean {
  return Math.abs(actual - expected) <= tolerance;
}

function pushRatioFailure(
  failures: string[],
  label: string,
  ratio: number | null,
  tolerance: number,
): void {
  if (ratio === null) {
    failures.push(`${label} ratio could not be measured`);
    return;
  }
  if (!isClose(ratio, TERMINAL_CJK_RATIO_TARGET, tolerance)) {
    failures.push(
      `${label} ratio ${ratio.toFixed(4)} is not ${TERMINAL_CJK_RATIO_TARGET}`,
    );
  }
}

function pushSpacingFailure(
  failures: string[],
  label: string,
  spacingPx: number | null | undefined,
): void {
  if (spacingPx === null || spacingPx === undefined) return;
  if (!Number.isFinite(spacingPx)) {
    failures.push(`${label} letter-spacing is not finite`);
    return;
  }
  if (Math.abs(spacingPx) > TERMINAL_CJK_LETTER_SPACING_TOLERANCE_PX) {
    failures.push(
      `${label} letter-spacing ${spacingPx.toFixed(3)}px is not zero`,
    );
  }
}

export function evaluateTerminalCjkMetrics(
  sample: TerminalCjkMetricSample,
): TerminalCjkMetricHealth {
  const failures: string[] = [];
  if (sample.fontLoaded === false) {
    failures.push("Marblo D2Coding is not loaded");
  }

  const hangulToAsciiRatio =
    isPositiveFinite(sample.asciiWidth) && isPositiveFinite(sample.hangulWidth)
      ? sample.hangulWidth / sample.asciiWidth
      : null;
  const hangulToScreenCellRatio =
    sample.screenCellWidth !== null &&
    sample.screenCellWidth !== undefined &&
    isPositiveFinite(sample.screenCellWidth) &&
    isPositiveFinite(sample.hangulWidth)
      ? sample.hangulWidth / sample.screenCellWidth
      : null;

  pushRatioFailure(
    failures,
    "Hangul/ASCII",
    hangulToAsciiRatio,
    TERMINAL_CJK_RATIO_TOLERANCE,
  );
  if (sample.screenCellWidth !== null && sample.screenCellWidth !== undefined) {
    pushRatioFailure(
      failures,
      "Hangul/xterm-cell",
      hangulToScreenCellRatio,
      TERMINAL_CJK_SCREEN_RATIO_TOLERANCE,
    );
  }
  pushSpacingFailure(failures, "xterm rows", sample.rowsLetterSpacingPx);
  pushSpacingFailure(failures, "xterm spans", sample.maxAbsSpanLetterSpacingPx);

  return {
    ok: failures.length === 0,
    failures,
    hangulToAsciiRatio,
    hangulToScreenCellRatio,
  };
}
