/**
 * Activity Stream 카드의 사람 친화 헤드라인 + detail 빌더.
 *
 * 원칙:
 * - 카테고리 prefix(영문) + payload 한 줄 (`Category: action {detail}`)
 * - raw `entry.result` / `entry.params` 는 절대 그대로 노출하지 않음
 *   (시스템 페이로드 dump 방지 — orchestrator skill 본문, initial_prompt JSON 등).
 * - `details` 는 type 별 화이트리스트 필드만 통과시킨 KV 목록.
 *   ActivityStreamPanel 디테일 영역이 raw JSON.stringify 대신 이걸 렌더.
 * - 예외 노출 케이스:
 *   - `mission:*` 의 result 는 mission-engine 의 `summarizeEventPayload()` 가
 *     이미 정제한 짧은 한국어 요약이라 그대로 사용.
 *   - `error` 의 result 는 곧 에러 메시지라 노출 OK.
 *   - `task:*` 의 title 은 result 정규식으로 추출
 *     (update_task_status / claim_task / submit_for_review schema 가 title 없음).
 *   - `spawn_agent` 의 result 다중행 텍스트에서 agentId 추출 (params 에 없음).
 * - 모르는 타입은 빈 헤드라인 — 렌더 사이드에서 카드 자체를 그릴지 결정.
 */
import type { ActivityEntry, ActivityType } from "./activityStreamService";

export interface DetailRow {
  label: string;
  value: string;
}

export interface FormattedActivity {
  /** 카드 본문에 표시할 한 줄 헤드라인. 빈 문자열이면 렌더 생략 권장. */
  headline: string;
  /** 펼침 detail — 화이트리스트 KV 만. 빈 배열이면 detail 영역 미렌더. */
  details: DetailRow[];
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

/** 헤드라인 truncation 한계 — Tailwind line-clamp-2 와 별개로 너무 긴 한 줄 방지. */
const HEADLINE_TASK_MAX = 80;

function str(v: unknown, fallback = ""): string {
  return typeof v === "string" && v.length > 0 ? v : fallback;
}

function truncate(s: string, max: number): string {
  return s.length <= max ? s : `${s.slice(0, max - 1)}…`;
}

function firstLine(s: string): string {
  const idx = s.search(/[\r\n]/);
  return idx === -1 ? s : s.slice(0, idx);
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

/** spawn_agent result 다중행 텍스트에서 "  Agent ID: xxx" 추출. */
function spawnedAgentId(e: ActivityEntry): string {
  const match = /Agent ID:\s*([^\s]+)/.exec(
    typeof e.result === "string" ? e.result : ""
  );
  return match ? match[1] : "";
}

/** Body 가 비어 있으면 separator 까지 떼서 trailing dash 가 남지 않게 한다. */
function joinWithDash(prefix: string, body: string): string {
  return body ? `${prefix} — ${body}` : prefix;
}

/** falsy KV 자동 제거 — 호출부에서 if 분기 안 짜도 되게. */
function rows(
  ...entries: Array<[string, string | undefined | null]>
): DetailRow[] {
  return entries
    .filter(([, v]) => typeof v === "string" && v.length > 0)
    .map(([label, value]) => ({ label, value: value as string }));
}

const FORMATTERS: Record<ActivityType, Formatter> = {
  "task:created": (e) => {
    const title = taskIdentifier(e);
    return {
      headline: `Task: created "${title}"`,
      details: rows(
        ["Title", title],
        ["Role", str(e.params.role)],
        ["Description", str(e.params.description)]
      ),
    };
  },
  "task:claimed": (e) => {
    const title = taskIdentifier(e);
    return {
      headline: `Task: claimed by ${e.agentId} — "${title}"`,
      details: rows(["Agent", e.agentId], ["Task", title]),
    };
  },
  "task:progress": (e) => {
    const title = taskIdentifier(e);
    return {
      headline: `Task: progress "${title}"`,
      details: rows(["Task", title], ["Status", str(e.params.status)]),
    };
  },
  "task:completed": (e) => {
    const title = taskIdentifier(e);
    return {
      headline: `Task: completed "${title}"`,
      details: rows(["Task", title]),
    };
  },
  "task:blocked": (e) => {
    const title = taskIdentifier(e);
    const reason = str(e.params.reason, FALLBACKS.reason);
    return {
      headline: `Task: blocked "${title}" — ${reason}`,
      details: rows(["Task", title], ["Reason", reason]),
    };
  },
  "agent:spawned": (e) => {
    const name = str(e.params.name);
    const role = str(e.params.role);
    const model = str(e.params.model);
    const initial = str(e.params.initial_prompt);
    const idFromResult = spawnedAgentId(e);
    const displayName = name || idFromResult || FALLBACKS.role;
    const roleSuffix = role ? ` (${role})` : "";
    const taskPreview = initial
      ? truncate(firstLine(initial), HEADLINE_TASK_MAX)
      : "";
    const headline = taskPreview
      ? `Agent: spawned ${displayName}${roleSuffix} → "${taskPreview}"`
      : `Agent: spawned ${displayName}${roleSuffix}`;
    return {
      headline,
      details: rows(
        ["Name", name],
        ["Agent ID", idFromResult],
        ["Role", role],
        ["Model", model],
        ["Task", initial]
      ),
    };
  },
  "mission:step": (e) => {
    const body = str(e.result, FALLBACKS.missionStep);
    return {
      headline: `Mission: ${body}`,
      details: rows(["Step", body]),
    };
  },
  "mission:state": (e) => {
    const body = str(e.result, FALLBACKS.missionState);
    return {
      headline: `Mission: ${body}`,
      details: rows(["State", body]),
    };
  },
  "mission:note": (e) => {
    const body = str(e.result, FALLBACKS.noteMessage);
    return {
      headline: joinWithDash(`Mission: ${e.agentId} note`, body),
      details: rows(["Mission", e.agentId], ["Note", body]),
    };
  },
  "activity:note": (e) => {
    const message = str(e.params.message, FALLBACKS.noteMessage);
    return {
      headline: joinWithDash(`Note: ${e.agentId}`, message),
      details: rows(["Agent", e.agentId], ["Message", message]),
    };
  },
  "pm:feedback": (e) => {
    const title = taskIdentifier(e);
    return {
      headline: `PM: feedback on "${title}"`,
      details: rows(
        ["Task", title],
        ["Comment", str(e.params.comment) || str(e.params.feedback)]
      ),
    };
  },
  error: (e) => {
    const result = str(e.result, FALLBACKS.errorResult);
    return {
      headline: `Error: ${e.toolName} failed — ${result}`,
      details: rows(["Tool", e.toolName], ["Message", result]),
    };
  },
  other: () => ({ headline: "", details: [] }),
};

export function formatActivity(entry: ActivityEntry): FormattedActivity {
  // FORMATTERS 는 ActivityType union 전체를 exhaustive 하게 커버하므로
  // 런타임 null 체크 없음 — 새 ActivityType 추가 시 컴파일 에러로 강제됨.
  return FORMATTERS[entry.type](entry);
}
