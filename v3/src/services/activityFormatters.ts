/**
 * Activity Stream 카드의 사람 친화 헤드라인 빌더.
 *
 * 원칙:
 * - 카테고리 prefix(영문) + payload 한 줄 (`Category: action {detail}`)
 * - raw `entry.result` 는 헤드라인에 노출하지 않음 (시스템 페이로드 dump 방지).
 *   예외: mission:* 타입은 mission-engine 이 store-impl.ts 의 summarizeEventPayload()
 *   로 이미 정제한 짧은 한국어 요약을 result 에 담아두므로 그대로 사용.
 * - `error` 타입은 result 가 곧 에러 메시지라 노출 OK.
 * - 모르는/빈 타입은 빈 문자열 — 렌더 사이드에서 카드 자체를 그릴지 결정.
 */
import type { ActivityEntry, ActivityType } from "./activityStreamService";

export interface FormattedActivity {
  /** 카드 본문에 표시할 한 줄 헤드라인. 빈 문자열이면 렌더 생략 권장. */
  headline: string;
  /** 펼침 detail — 현재 ActivityStreamPanel 은 자체 detail 패널 사용 중이라 미사용. */
  detail?: string;
}

type Formatter = (e: ActivityEntry) => FormattedActivity;

function str(v: unknown, fallback = ""): string {
  return typeof v === "string" && v.length > 0 ? v : fallback;
}

function title(e: ActivityEntry): string {
  return str(e.params.title, "untitled");
}

const FORMATTERS: Record<ActivityType, Formatter> = {
  "task:created": (e) => ({
    headline: `Task: created "${title(e)}"`,
  }),
  "task:claimed": (e) => ({
    headline: `Task: claimed by ${e.agentId} — "${title(e)}"`,
  }),
  "task:progress": (e) => ({
    headline: `Task: progress "${title(e)}"`,
  }),
  "task:completed": (e) => ({
    headline: `Task: completed "${title(e)}"`,
  }),
  "task:blocked": (e) => {
    const reason = str(e.params.reason, "no reason");
    return { headline: `Task: blocked "${title(e)}" — ${reason}` };
  },
  "agent:spawned": (e) => ({
    headline: `Agent: spawned ${str(e.params.role, "agent")}`,
  }),
  "mission:step": (e) => ({
    headline: `Mission: ${str(e.result, "step")}`,
  }),
  "mission:state": (e) => ({
    headline: `Mission: ${str(e.result, "state change")}`,
  }),
  "mission:note": (e) => ({
    headline: `Mission: ${e.agentId} note — ${str(e.result, "")}`,
  }),
  "activity:note": (e) => ({
    headline: `Note: ${e.agentId} — ${str(e.params.message, "")}`,
  }),
  "pm:feedback": (e) => ({
    headline: `PM: feedback on "${title(e)}"`,
  }),
  error: (e) => ({
    headline: `Error: ${e.toolName} failed — ${str(e.result, "unknown")}`,
  }),
  other: () => ({ headline: "" }),
};

export function formatActivity(entry: ActivityEntry): FormattedActivity {
  const fn = FORMATTERS[entry.type];
  return fn ? fn(entry) : { headline: "" };
}
