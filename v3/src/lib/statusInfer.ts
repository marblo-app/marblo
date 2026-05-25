import type { Agent, AgentStatus } from "../types/agent";
import { normalizeLine } from "./ansi";

/**
 * Fleet 그리드 셀 하단에 보이는 "한 줄 요약" 라벨 추론.
 *
 * 우선순위:
 *  1. agent.status === "error"     → "Error"
 *  2. agent.status === "stopped"   → "Stopped"
 *  3. lastActivity (Claude 등 MCP 호출하는 모델) → activity 메시지 요약
 *  4. PTY 마지막 비어있지 않은 줄 (Codex/Gemini fallback)
 *  5. 그 외                         → "Idle"
 *
 * LLM 호출 없음 — false signal 방지 위해 휴리스틱만 사용한다.
 */

export interface InferStatusInput {
  status: AgentStatus;
  /** add_activity 기반의 마지막 activity 메시지 (없으면 undefined). */
  lastActivityMessage?: string;
  /** PTY 마지막 N 줄 (가장 최근이 배열 끝). */
  recentLines?: string[];
}

const MAX_LABEL_LEN = 60;
const PROMPT_MARKERS = [
  /^[>$#%›❯]\s*$/, // 단독 prompt 라인
  /^\s*$/, // 빈 줄
];

function isPromptOrEmpty(line: string): boolean {
  return PROMPT_MARKERS.some((re) => re.test(line));
}

function trim(s: string): string {
  const clean = s.trim();
  if (clean.length <= MAX_LABEL_LEN) return clean;
  return clean.slice(0, MAX_LABEL_LEN - 1) + "…";
}

/**
 * activity 메시지를 한 줄 라벨로 압축. 기존 add_activity 메시지는 자유 텍스트라
 * 첫 줄 + 60자 컷이 가장 안전한 휴리스틱.
 */
export function summarizeActivity(msg: string): string {
  if (!msg) return "";
  const firstLine = msg.split("\n")[0]?.trim() ?? "";
  return trim(firstLine);
}

/**
 * 가장 마지막의 "정보성" 줄 찾기 — prompt/빈 줄은 건너뛴다.
 */
export function lastInformativeLine(lines: string[] | undefined): string {
  if (!lines || lines.length === 0) return "";
  for (let i = lines.length - 1; i >= 0; i--) {
    const norm = normalizeLine(lines[i]);
    if (!isPromptOrEmpty(norm)) return trim(norm);
  }
  return "";
}

export function inferStatusLabel(input: InferStatusInput): string {
  if (input.status === "error") return "Error";
  if (input.status === "stopped") return "Stopped";

  const summary = summarizeActivity(input.lastActivityMessage ?? "");
  if (summary) return summary;

  const tailLine = lastInformativeLine(input.recentLines);
  if (tailLine) return tailLine;

  return input.status === "working" ? "Working…" : "Idle";
}

/**
 * 모델별로 우선순위가 약간 달라야 한다면 여기서 분기. 지금은 동일하지만,
 * 향후 Claude 의 hook 신호를 강화할 여지를 남겨둔다.
 */
export function inferLabelForAgent(
  agent: Pick<Agent, "status" | "model">,
  ctx: { lastActivityMessage?: string; recentLines?: string[] },
): string {
  return inferStatusLabel({
    status: agent.status,
    lastActivityMessage: ctx.lastActivityMessage,
    recentLines: ctx.recentLines,
  });
}
