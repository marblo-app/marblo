import { normalizeLine } from "./ansi";

/**
 * PTY 마지막 줄에서 "사용자 입력 대기" 신호를 검출.
 * false positive 방지 위해 *줄 끝* 마커만 허용 — 일반 로그에 우연히
 * "? " 가 끼는 경우를 거른다. 한 라인의 strip 결과가 마커 패턴과 일치해야
 * 트리거.
 */

const PROMPT_LINE_PATTERNS = [
  /\[y\/n\]\s*$/i,
  /\[Y\/n\]\s*$/,
  /\[y\/N\]\s*$/,
  /\(y\/n\)\s*$/i,
  /Continue\?\s*$/i,
  /Press\s+Enter/i,
  /(^|\s)Proceed\?\s*$/i,
  /(^|\s)Confirm\?\s*$/i,
  /(^|\s)\?\s+$/, // "이거 할까요? " 같은 trailing question mark + space
  /[›❯]\s*$/, // 단독 prompt arrow
];

export function isAwaitingInput(lines: string[] | undefined): boolean {
  if (!lines || lines.length === 0) return false;
  // 가장 마지막의 비어있지 않은 줄만 본다.
  for (let i = lines.length - 1; i >= 0; i--) {
    const norm = normalizeLine(lines[i]).trim();
    if (norm.length === 0) continue;
    return PROMPT_LINE_PATTERNS.some((re) => re.test(norm));
  }
  return false;
}
