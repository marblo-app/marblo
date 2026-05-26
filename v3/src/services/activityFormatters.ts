/**
 * Activity Stream 카드의 사람 친화 헤드라인 빌더.
 *
 * 원칙:
 * - 카테고리 prefix(영문) + payload 한 줄 (`Category: action {detail}`)
 * - raw `entry.result` 는 헤드라인에 노출하지 않음 (시스템 페이로드 dump 방지).
 *   예외:
 *   - `mission:*` 타입은 mission-engine 의 store-impl.ts `summarizeEventPayload()` 가
 *     이미 정제한 짧은 한국어 요약을 result 에 담아두므로 그대로 사용.
 *   - `error` 타입은 result 가 곧 에러 메시지라 노출 OK.
 *   - `task:*` 타입은 task title 만 result 에서 정규식으로 추출해서 사용
 *     (update_task_status / claim_task / submit_for_review 의 schema 가 title 을
 *     params 에 받지 않아서 그대로 두면 항상 "untitled" 가 됨).
 * - 모르는 타입은 빈 문자열 — 렌더 사이드에서 카드 자체를 그릴지 결정.
 */
import type { ActivityEntry, ActivityType } from "./activityStreamService";

export interface FormattedActivity {
  /** 카드 본문에 표시할 한 줄 헤드라인. 빈 문자열이면 렌더 생략 권장. */
  headline: string;
  /** 펼침 detail — 현재 ActivityStreamPanel 은 자체 detail 패널 사용 중이라 미사용. */
  detail?: string;
}

type Formatter = (e: ActivityEntry) => FormattedActivity;

const FALLBACKS = {
  title: "untitled",
  reason: "no reason",
  role: "agent",
  missionStep: "step",
  missionState: "state change",
  errorResult: "unknown",
  noteMessage: "(no message)",
} as const;

function str(v: unknown, fallback = ""): string {
  return typeof v === "string" && v.length > 0 ? v : fallback;
}

/**
 * Task title 을 가장 정보량 많은 순으로 시도:
 * 1) params.title (create_task 가 직접 받음)
 * 2) result 정규식 — `Task '...' ...` / `Successfully claimed task: ...`
 * 3) task_id 앞 8자 (`task abc12345`)
 * 4) FALLBACKS.title
 */
function taskIdentifier(e: ActivityEntry): string {
  const fromParams = str(e.params.title);
  if (fromParams) return fromParams;

  const result = typeof e.result === "string" ? e.result : "";
  const quoted = /Task '([^']+)'/.exec(result);
  if (quoted) return quoted[1];
  const claimed = /Successfully claimed task: ([^\n]+)/.exec(result);
  if (claimed) return claimed[1].trim();

  const taskId =
    str(e.params.task_id) || str((e.params as { taskId?: unknown }).taskId);
  if (taskId) return `task ${taskId.slice(0, 8)}`;

  return FALLBACKS.title;
}

/** Body 가 비어 있으면 separator 까지 떼서 trailing dash 가 남지 않게 한다. */
function joinWithDash(prefix: string, body: string): string {
  return body ? `${prefix} — ${body}` : prefix;
}

const FORMATTERS: Record<ActivityType, Formatter> = {
  "task:created": (e) => ({
    headline: `Task: created "${taskIdentifier(e)}"`,
  }),
  "task:claimed": (e) => ({
    headline: `Task: claimed by ${e.agentId} — "${taskIdentifier(e)}"`,
  }),
  "task:progress": (e) => ({
    headline: `Task: progress "${taskIdentifier(e)}"`,
  }),
  "task:completed": (e) => ({
    headline: `Task: completed "${taskIdentifier(e)}"`,
  }),
  "task:blocked": (e) => {
    const reason = str(e.params.reason, FALLBACKS.reason);
    return {
      headline: `Task: blocked "${taskIdentifier(e)}" — ${reason}`,
    };
  },
  "agent:spawned": (e) => ({
    headline: `Agent: spawned ${str(e.params.role, FALLBACKS.role)}`,
  }),
  "mission:step": (e) => ({
    headline: `Mission: ${str(e.result, FALLBACKS.missionStep)}`,
  }),
  "mission:state": (e) => ({
    headline: `Mission: ${str(e.result, FALLBACKS.missionState)}`,
  }),
  "mission:note": (e) => ({
    headline: joinWithDash(
      `Mission: ${e.agentId} note`,
      str(e.result, FALLBACKS.noteMessage)
    ),
  }),
  "activity:note": (e) => ({
    headline: joinWithDash(
      `Note: ${e.agentId}`,
      str(e.params.message, FALLBACKS.noteMessage)
    ),
  }),
  "pm:feedback": (e) => ({
    headline: `PM: feedback on "${taskIdentifier(e)}"`,
  }),
  error: (e) => ({
    headline: `Error: ${e.toolName} failed — ${str(
      e.result,
      FALLBACKS.errorResult
    )}`,
  }),
  other: () => ({ headline: "" }),
};

export function formatActivity(entry: ActivityEntry): FormattedActivity {
  // FORMATTERS 는 ActivityType union 전체를 exhaustive 하게 커버하므로
  // 런타임 null 체크 없음 — 새 ActivityType 추가 시 컴파일 에러로 강제됨.
  return FORMATTERS[entry.type](entry);
}
