/**
 * Mission Replay — 비트 민감도 분류 + 공개 게이트 (Phase 1 골격).
 *
 * 설계 단일소스: `docs/MISSION-REPLAY-DESIGN.md` §5.2 / §5.3.
 *
 * ── 이 파일이 지키는 불변식 ────────────────────────────────────────────────
 * **default-deny.** 분류를 모르면 `"private"`, 등급 게이트는 **명시 허용 목록에
 * 있는 것만** 통과시킨다. 반대 설계(기본 공개 + 위험한 것만 차단)를 쓰면 새 필드가
 * 추가되는 순간 조용히 유출된다 — 감사 로깅에서 "조용한 누락"이 최악이듯, 공유
 * 기능에서는 **"조용한 포함"**이 최악이다(설계 §5.2 P1).
 *
 * 그래서 분류표를 `Record<TimelineEventType, …>` 같은 **전수 맵**으로 쓴다.
 * 설계 문서는 "exhaustive switch + `default:` 가 private 반환"이라고 적었는데,
 * 전수 맵은 같은 보증을 **더 강하게** 준다: 누가 `TimelineEventType` 에 값을
 * 하나 더 넣으면 이 파일이 **컴파일 에러**가 나고(분류를 강제로 마주치게 되고),
 * 그걸 놓쳐 옛 클라이언트가 모르는 값을 읽어도 조회 결과가 `undefined` → 런타임
 * 기본값 `"private"` 으로 떨어진다. 컴파일러와 런타임 둘 다에서 안전 방향이다.
 *
 * ★실제 마스킹/드롭(레닭션 룰셋 R1~R16)은 Phase 2 (`lib/replay/redact/`) 다.
 * 이 파일은 "무엇이 어느 등급까지 나갈 수 있는가"라는 **게이트**만 담당한다.
 *
 * I/O 없음 — firebase 도 시계도 만지지 않는다(단위테스트가 그대로 호출한다).
 */

import type { TimelineEventType } from "../../types/mission";
import type { ProjectAuditEventType } from "../../types/projectAudit";
import type {
  ReplayBeat,
  ReplaySensitivity,
  ReplaySource,
  ReplayVisibilityLevel,
} from "../../types/missionReplay";

/** 분류를 모를 때의 값. 이 상수를 우회하는 경로를 만들지 않는다. */
export const DEFAULT_SENSITIVITY: ReplaySensitivity = "private";

// ── 소스별 분류표 ────────────────────────────────────────────────

/**
 * 오케 서사(`mission.contextLog`) 이벤트 → 민감도.
 *
 * 판정 기준은 "이 비트가 **자유 텍스트를 들고 다니는가**" 하나다.
 *   · 구조적 사실(단계 전이·에이전트 배정·미션 상태) → `process`
 *   · 사람의 지시/판단, 감독자 노트, 에이전트 서사 → `private`
 *     (설계 §5.2 P3 — 산문은 마스킹 대상이 아니라 **제외 대상**이다.
 *      `lib/telemetry/scrub.ts` 의 `USER_INPUT_KEY` 가 필드를 통째로 제거하는
 *      것과 같은 결론.)
 *
 * ★`"task.activity"` 가 여기서 private 인 것과, 소스 `"task.activity"` 의
 * 완료보고 비트가 `summary` 인 것은 모순이 아니다. 전자는 오케가 미션 서사로
 * 합성해 넣은 **원문 내레이션**이고, 후자는 4필드로 **구조화된** 완료보고다.
 */
const CONTEXT_LOG_SENSITIVITY: Record<TimelineEventType, ReplaySensitivity> = {
  "step.started": "process",
  "step.completed": "process",
  "step.failed": "process",
  "user.input": "private",
  "user.decision": "private",
  "agent.dispatched": "process",
  "agent.completed": "process",
  "agent.stuck": "process",
  "mission.paused": "process",
  "mission.resumed": "process",
  "supervisor.note": "private",
  "task.status": "process",
  "task.activity": "private",
};

/**
 * 사람 행위(`projectAuditLog`) 이벤트 → 민감도.
 *
 * 이 컬렉션은 애초에 스칼라 메타데이터만 담는다(`ProjectAuditMetadata` 가
 * 중첩을 금지 — 채팅 본문·지시문이 원장에 박히는 것을 막는 의도적 설계).
 * 그래서 전이·스폰 같은 구조적 사실은 `process` 다. 다만 행위자는 항상
 * 익명 별칭(`member-N`)으로만 실린다 — 실명·uid 는 비트에 넣지 않는다(R2b).
 */
const PROJECT_AUDIT_SENSITIVITY: Record<
  ProjectAuditEventType,
  ReplaySensitivity
> = {
  "chat.message.sent": "private", // 채팅은 존재 자체가 사람의 대화 맥락
  "agent.spawned": "process",
  "task.claimed": "process",
  "task.status_changed": "process",
};

/**
 * 태스크 문서에서 파생한 라이프사이클 비트 → 민감도.
 *
 * 전이 자체는 `process` 급 사실이지만, 이 비트들은 **태스크 제목**(자유 텍스트)을
 * title 로 들고 다닌다. 민감도는 비트 단위라 "가장 민감한 내용"에 맞춰야 하므로
 * `summary` 로 내린다 — L1(과정만)에서는 파일명도 제목도 나가지 않는다(설계 §5.3).
 * 오탐(밋밋해짐)은 회복 가능하고 미탐(유출)은 회복 불가라는 §5.2 P2 의 적용.
 */
const TASK_SENSITIVITY: Record<string, ReplaySensitivity> = {
  "task.created": "summary",
  "task.claimed": "summary",
  "task.status": "summary",
};

/** 태스크 activity 비트 → 민감도. 완료보고만 구조화돼 있어 `summary`. */
const TASK_ACTIVITY_SENSITIVITY: Record<string, ReplaySensitivity> = {
  "task.completion_report": "summary",
  "task.activity": "private", // 자유 텍스트 진행 로그
};

/**
 * 병합 성과 비트 → 민감도.
 *
 * `merge_history` 에서 읽는 것은 **비식별 수치**(filesChanged/linesAdded/
 * linesDeleted/changeType)뿐이다. `repoRoot`·`branch`·`headSha` 는 비트에 아예
 * 담지 않는다(R11/R12) — 담지 않으면 레닭션이 실수할 표면 자체가 없다.
 */
const MERGE_SENSITIVITY: Record<string, ReplaySensitivity> = {
  "merge.recorded": "process",
};

// ── 분류 ────────────────────────────────────────────────────────

/**
 * (source, kind) → 민감도. **모르면 private.**
 *
 * `kind` 를 `string` 으로 받는 이유: 비트는 옛 문서/새 문서를 섞어 읽고, 앞으로
 * 추가될 값이 그대로 들어온다. 좁은 유니온으로 받으면 호출부가 캐스팅으로
 * 우회하게 되고 그 캐스팅이 곧 유출 경로가 된다. 여기서 넓게 받고 **안에서**
 * 안전하게 떨어뜨린다.
 */
export function classifyBeatSensitivity(input: {
  source: ReplaySource;
  kind: string;
}): ReplaySensitivity {
  const { source, kind } = input;
  switch (source) {
    case "mission.contextLog":
      return lookup(CONTEXT_LOG_SENSITIVITY, kind);
    case "task":
      return lookup(TASK_SENSITIVITY, kind);
    case "task.activity":
      return lookup(TASK_ACTIVITY_SENSITIVITY, kind);
    case "audit_logs":
      // 원장 비트는 **구조적 사실만** 싣는다(toolName/success/duration).
      // `params` 는 지시문·경로·시크릿이 지나다니는 자유 필드라 비트에 담지
      // 않는다 — 그래서 toolName 값과 무관하게 process 로 고정할 수 있다.
      return "process";
    case "projectAuditLog":
      return lookup(PROJECT_AUDIT_SENSITIVITY, kind);
    case "merge_history":
      return lookup(MERGE_SENSITIVITY, kind);
    default: {
      // 소스 유니온에 값이 추가되면 여기서 컴파일 에러가 난다(분류 강제).
      // 그걸 놓친 런타임에도 결과는 private 이다.
      const _exhaustive: never = source;
      void _exhaustive;
      return DEFAULT_SENSITIVITY;
    }
  }
}

/** 표 조회 — 없는 키는 전부 기본값(private)으로 떨어진다. */
function lookup(
  table: Record<string, ReplaySensitivity>,
  kind: string,
): ReplaySensitivity {
  return (
    (Object.prototype.hasOwnProperty.call(table, kind)
      ? table[kind]
      : undefined) ?? DEFAULT_SENSITIVITY
  );
}

// ── 공개 게이트 ─────────────────────────────────────────────────

/**
 * 등급별 **허용 목록**. 차단 목록이 아니다 — 여기 없는 값은 전부 거부된다.
 *
 * ★`"private"` 은 어떤 등급에도 없다. "전체 공개(L3)"는 *더 많은 종류의 내용*을
 * 뜻하지 *레닭션 해제*를 뜻하지 않는다. 해제 스위치는 만들지 않는다(설계 §5.3).
 *
 * `"detail"` 은 Phase 1 분류기가 **한 번도 부여하지 않는다** — 코드/터미널 발췌는
 * Phase 2 에서 사용자가 명시 동의했을 때만 붙는 등급이라, 지금은 게이트 칸만
 * 열어 두고 실제로 그 칸을 채우는 코드는 없다.
 */
export const VISIBLE_SENSITIVITIES: Record<
  ReplayVisibilityLevel,
  readonly ReplaySensitivity[]
> = {
  L0: [],
  L1: ["process"],
  L2: ["process", "summary"],
  L3: ["process", "summary", "detail"],
};

const ALLOWED_BY_LEVEL: Record<
  ReplayVisibilityLevel,
  ReadonlySet<ReplaySensitivity>
> = {
  L0: new Set(VISIBLE_SENSITIVITIES.L0),
  L1: new Set(VISIBLE_SENSITIVITIES.L1),
  L2: new Set(VISIBLE_SENSITIVITIES.L2),
  L3: new Set(VISIBLE_SENSITIVITIES.L3),
};

/**
 * 이 민감도가 이 등급에서 나갈 수 있는가.
 *
 * 모르는 등급/모르는 민감도가 들어오면 **거부**한다(둘 다 `string` 으로 새어
 * 들어올 수 있는 값이라 방어한다). 판정은 항상 "허용 집합에 있는가"로만 한다.
 */
export function isSensitivityAllowed(
  sensitivity: ReplaySensitivity | string | null | undefined,
  level: ReplayVisibilityLevel | string | null | undefined,
): boolean {
  if (typeof level !== "string") return false;
  if (typeof sensitivity !== "string") return false;
  const allowed = Object.prototype.hasOwnProperty.call(ALLOWED_BY_LEVEL, level)
    ? ALLOWED_BY_LEVEL[level as ReplayVisibilityLevel]
    : undefined;
  if (!allowed) return false;
  return allowed.has(sensitivity as ReplaySensitivity);
}

/**
 * 등급 게이트를 통과한 비트만 남긴다.
 *
 * ★이건 레닭션이 **아니다.** 통과한 비트의 본문에도 시크릿·경로·PII 가 있을 수
 * 있고, 그걸 제거하는 것은 Phase 2 (`redactReplay.ts`)의 일이다. 이 함수는
 * "애초에 나갈 자격이 있는 비트"만 추리는 1차 관문이다. 발행 경로는 이 함수의
 * 출력을 그대로 쓰지 말고 반드시 Phase 2 를 통과시켜야 한다.
 */
export function filterBeatsForVisibility(
  beats: readonly ReplayBeat[],
  level: ReplayVisibilityLevel,
): ReplayBeat[] {
  return beats.filter((beat) => isSensitivityAllowed(beat.sensitivity, level));
}
