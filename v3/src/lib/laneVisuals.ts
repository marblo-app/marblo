import type { LaneStatusTone } from "./laneStatus";

/**
 * 퀵레인 표면(카드 · 상세 드로우 · 터미널 버튼)이 공유하는 표시용 상수.
 *
 * 왜 모듈로 뺐나: 종전엔 LanesTab.tsx 안의 파일 지역 상수였다. 상세 드로우가
 * 같은 아이콘/색을 써야 하는데, 드로우를 LanesTab 이 import 하므로 반대 방향
 * import 는 순환이 된다. 표시 상수만 아래로 내려 두 쪽이 같은 값을 읽는다.
 * (앱 전역의 하네스 아이콘 통일은 이 티켓 범위 밖 — 여기서는 lanes 표면이
 * 서로 갈라지지 않게만 한다.)
 */
export const LANE_HARNESS_ICON: Record<string, string> = {
  claude: "🟣",
  gpt: "🟢",
  grok: "⚡",
  antigravity: "🟠",
  gemini: "🔵",
  local: "⚫",
  custom: "⚪",
};

/** 하네스 아이콘(미지 하네스·미배정이면 중립 ⚪). */
export function harnessIcon(model: string | null | undefined): string {
  return LANE_HARNESS_ICON[model ?? ""] ?? "⚪";
}

/** {@link LaneStatusTone} → pill 글자색(catppuccin 팔레트). */
export const LANE_TONE_COLOR: Record<LaneStatusTone, string> = {
  danger: "#f38ba8",
  warning: "#f9e2af",
  behind: "#fab387",
  ready: "#a6e3a1",
  idle: "#6c7086",
  done: "#a6e3a1",
  review: "#89b4fa",
  failed: "#f38ba8",
};

export function laneToneColor(tone: LaneStatusTone): string {
  return LANE_TONE_COLOR[tone] ?? "#cdd6f4";
}
