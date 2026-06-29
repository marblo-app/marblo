/**
 * 완료 보고(completion report) 파싱 — 렌더러용 순수 로직 (I/O 없음).
 *
 * 에이전트는 작업을 마치며 add_activity 로 "✅ 완료 보고\n- 문제: ...\n- 접근: ..."
 * 형태의 평문 activity 한 줄을 남긴다(규약 정의는 electron/mcp-server/completion-report.ts
 * — 그쪽은 main 프로세스에서 *포맷*을 만들고, 이 모듈은 렌더러에서 그 평문을 다시
 * 구조로 *파싱*한다). main 모듈을 import 하면 electron 의존이 렌더러 번들로 새므로,
 * 마커·필드 라벨 규약만 여기 복제한다. 두 파일은 같은 규약을 공유하는 짝이다.
 *
 * firebase/electron 의존이 없어 단위 테스트가 직접 호출한다.
 */

/** 완료 보고 activity 의 선두 마커. 이 문자열로 시작하는 activity 가 "완료 보고"다. */
export const COMPLETION_REPORT_MARKER = "✅ 완료 보고";

/** 완료 보고에서 추출한 provenance 필드. 있는 것만 채워진다. */
export interface ParsedCompletionReport {
  /** 무엇이 문제였나 / 무엇을 하려 했나. */
  problem?: string;
  /** 어떻게 접근/해결했나. */
  approach?: string;
  /** 무엇을 바꿨나 (파일/모듈 요약). */
  changes?: string;
  /** 어떻게 검증했나 (테스트/타입체크/수동확인). */
  verification?: string;
  /** 관련 PR URL 또는 그 설명. */
  pr?: string;
}

/** 라벨(한국어) → 구조 필드 키. electron/mcp-server/completion-report.ts 와 1:1. */
const FIELD_BY_LABEL: Record<string, keyof ParsedCompletionReport> = {
  문제: "problem",
  접근: "approach",
  변경: "changes",
  검증: "verification",
  PR: "pr",
};

/** activity 메시지가 완료 보고인가 (마커로 시작; 선행 공백 허용). */
export function isCompletionReport(
  message: string | null | undefined,
): boolean {
  if (!message) return false;
  return message.trimStart().startsWith(COMPLETION_REPORT_MARKER);
}

/**
 * "✅ 완료 보고" 평문 메시지를 구조화 필드로 파싱.
 *
 * 각 필드는 `- 라벨: 값` 한 줄로 적힌다(formatCompletionReport 가 그렇게 만든다).
 * 라벨 매칭은 첫 콜론 기준이라 값에 콜론(URL 등)이 들어가도 안전하다. 마커가 없거나
 * 인식되는 필드가 하나도 없으면 null.
 */
export function parseCompletionReport(
  message: string | null | undefined,
): ParsedCompletionReport | null {
  if (!isCompletionReport(message)) return null;
  const result: ParsedCompletionReport = {};
  for (const rawLine of message!.split("\n")) {
    const line = rawLine.trim();
    // `- 문제: ...` / `* 문제: ...` 둘 다 허용. 첫 콜론까지를 라벨로.
    const match = line.match(/^[-*]\s*([^:：]+)\s*[:：]\s*(.*)$/);
    if (!match) continue;
    const label = match[1].trim();
    const value = match[2].trim();
    const field = FIELD_BY_LABEL[label];
    if (field && value) result[field] = value;
  }
  return Object.keys(result).length > 0 ? result : null;
}

/** 텍스트에서 첫 http(s) URL 을 뽑는다. 없으면 null. (PR 필드 링크화용) */
export function extractFirstUrl(
  text: string | null | undefined,
): string | null {
  if (!text) return null;
  const match = text.match(/https?:\/\/[^\s)]+/);
  return match ? match[0] : null;
}
