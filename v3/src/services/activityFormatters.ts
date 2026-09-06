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
import type { MessageKey } from "../locales/ko";
import { spawnedModelLabel, spawnedModelTitle } from "../lib/spawnedModelLabel";
import { scrubString } from "../lib/telemetry/scrub";

/**
 * 번역 함수 시그니처. 호출부(React 컴포넌트)가 `useTranslation()` 의 `t` 를
 * 넘겨 로케일 변경 시 재렌더되게 한다. 모듈 레벨 `t()` 를 직접 쓰면 로케일
 * 토글에 반응하지 않으므로 인자로 받는다.
 */
export type TranslateFn = (
  key: MessageKey,
  vars?: Record<string, string | number>,
) => string;

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

type Formatter = (e: ActivityEntry, t: TranslateFn) => FormattedActivity;

/** 헤드라인 truncation 한계 — Tailwind line-clamp-2 와 별개로 너무 긴 한 줄 방지. */
const HEADLINE_TASK_MAX = 80;

/**
 * params/result 에서 표시용 문자열 한 칸을 꺼낸다.
 *
 * ★`scrubString` 을 여기서 거는 것이 요점이다(티켓 yJLfoRpqvCcvarIXcT23).
 * 이 패널이 읽는 문서는 대부분 **params 정책 이전에 쌓인 원문**이고 원장은
 * 불변이라 그 원문은 못 지운다. 감사 뷰처럼 통째로 끊으면 상시 스트림이 죽으므로
 * (Ciriq5ASEvAlA8TnKxhW 가 못 박은 회귀 금지선), 여기서는 키 화이트리스트 읽기에
 * **표시 직전 스크럽**을 더한다. 이 파일의 모든 params 접근이 이 한 함수를
 * 지나므로 새 필드를 꺼내도 자동으로 걸린다.
 */
function str(v: unknown, fallback = ""): string {
  return typeof v === "string" && v.length > 0 ? scrubString(v) : fallback;
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
function taskIdentifier(e: ActivityEntry, t: TranslateFn): string {
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

  return t("activity.fallback.title");
}

/** spawn_agent result 다중행 텍스트에서 "  Agent ID: xxx" 추출. */
function spawnedAgentId(e: ActivityEntry): string {
  const match = /Agent ID:\s*([^\s]+)/.exec(
    typeof e.result === "string" ? e.result : "",
  );
  return match ? match[1] : "";
}

function spawnedModelFromResult(e: ActivityEntry): string {
  const match = /Spawned model:\s*([^\n]+)/i.exec(
    typeof e.result === "string" ? e.result : "",
  );
  return match ? match[1].trim() : "";
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
  "task:created": (e, t) => {
    const title = taskIdentifier(e, t);
    return {
      headline: t("activity.headline.taskCreated", { title }),
      details: rows(
        [t("activity.label.title"), title],
        [t("activity.label.role"), str(e.params.role)],
        [t("activity.label.description"), str(e.params.description)],
      ),
    };
  },
  "task:claimed": (e, t) => {
    const title = taskIdentifier(e, t);
    return {
      headline: t("activity.headline.taskClaimed", {
        agent: e.agentId,
        title,
      }),
      details: rows(
        [t("activity.label.agent"), e.agentId],
        [t("activity.label.task"), title],
      ),
    };
  },
  "task:progress": (e, t) => {
    const title = taskIdentifier(e, t);
    return {
      headline: t("activity.headline.taskProgress", { title }),
      details: rows(
        [t("activity.label.task"), title],
        [t("activity.label.status"), str(e.params.status)],
      ),
    };
  },
  "task:completed": (e, t) => {
    const title = taskIdentifier(e, t);
    return {
      headline: t("activity.headline.taskCompleted", { title }),
      details: rows([t("activity.label.task"), title]),
    };
  },
  "task:blocked": (e, t) => {
    const title = taskIdentifier(e, t);
    const reason = str(e.params.reason, t("activity.fallback.reason"));
    return {
      headline: t("activity.headline.taskBlocked", { title, reason }),
      details: rows(
        [t("activity.label.task"), title],
        [t("activity.label.reason"), reason],
      ),
    };
  },
  "agent:spawned": (e, t) => {
    const name = str(e.params.name);
    const role = str(e.params.role);
    const model = str(e.params.model);
    const spawnedModel =
      str((e.params as { spawnedModel?: unknown }).spawnedModel) ||
      str((e.params as { spawned_model?: unknown }).spawned_model) ||
      spawnedModelFromResult(e);
    const modelDisplay = spawnedModelLabel(spawnedModel) ?? model;
    const initial = str(e.params.initial_prompt);
    const idFromResult = spawnedAgentId(e);
    const displayName = name || idFromResult || t("activity.fallback.role");
    const roleSuffix = role ? ` (${role})` : "";
    const fullName = `${displayName}${roleSuffix}`;
    const taskPreview = initial
      ? truncate(firstLine(initial), HEADLINE_TASK_MAX)
      : "";
    const headline = taskPreview
      ? t("activity.headline.agentSpawnedWithTask", {
          name: fullName,
          task: taskPreview,
        })
      : t("activity.headline.agentSpawned", { name: fullName });
    return {
      headline,
      details: rows(
        [t("activity.label.name"), name],
        [t("activity.label.agentId"), idFromResult],
        [t("activity.label.role"), role],
        [
          t("activity.label.model"),
          modelDisplay ? spawnedModelTitle(modelDisplay, model) : model,
        ],
        [t("activity.label.task"), initial],
      ),
    };
  },
  "mission:step": (e, t) => {
    const body = str(e.result, t("activity.fallback.missionStep"));
    return {
      headline: t("activity.headline.mission", { body }),
      details: rows([t("activity.label.step"), body]),
    };
  },
  "mission:state": (e, t) => {
    const body = str(e.result, t("activity.fallback.missionState"));
    return {
      headline: t("activity.headline.mission", { body }),
      details: rows([t("activity.label.state"), body]),
    };
  },
  "mission:note": (e, t) => {
    const body = str(e.result, t("activity.fallback.noteMessage"));
    return {
      headline: joinWithDash(
        t("activity.headline.missionNotePrefix", { agent: e.agentId }),
        body,
      ),
      details: rows(
        [t("activity.label.mission"), e.agentId],
        [t("activity.label.note"), body],
      ),
    };
  },
  "activity:note": (e, t) => {
    const message = str(e.params.message, t("activity.fallback.noteMessage"));
    return {
      headline: joinWithDash(
        t("activity.headline.notePrefix", { agent: e.agentId }),
        message,
      ),
      details: rows(
        [t("activity.label.agent"), e.agentId],
        [t("activity.label.message"), message],
      ),
    };
  },
  "pm:feedback": (e, t) => {
    const title = taskIdentifier(e, t);
    return {
      headline: t("activity.headline.pmFeedback", { title }),
      details: rows(
        [t("activity.label.task"), title],
        [
          t("activity.label.comment"),
          str(e.params.comment) || str(e.params.feedback),
        ],
      ),
    };
  },
  error: (e, t) => {
    const result = str(e.result, t("activity.fallback.errorResult"));
    return {
      headline: t("activity.headline.error", { tool: e.toolName, result }),
      details: rows(
        [t("activity.label.tool"), e.toolName],
        [t("activity.label.message"), result],
      ),
    };
  },
  other: () => ({ headline: "", details: [] }),
};

export function formatActivity(
  entry: ActivityEntry,
  t: TranslateFn,
): FormattedActivity {
  // FORMATTERS 는 ActivityType union 전체를 exhaustive 하게 커버하므로
  // 런타임 null 체크 없음 — 새 ActivityType 추가 시 컴파일 에러로 강제됨.
  return FORMATTERS[entry.type](entry, t);
}
