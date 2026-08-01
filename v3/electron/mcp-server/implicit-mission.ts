/**
 * 암묵적 미션 (Implicit Mission) — ad-hoc 보드 작업을 Replay 단위로 묶는 라벨.
 *
 * 설계 단일소스: `docs/MISSION-REPLAY-DESIGN.md` §2.1.
 *
 * ── 왜 새 그룹핑 경로를 만들지 않았나 ──────────────────────────────────────
 * Replay 파이프라인은 이미 미션을 잡는다. 1급 조인키가
 * `tasks.contextId === missionId` 이고(설계 §2.1), Replay 대상 판정은
 * `mission.status === "completed"` 하나뿐이다(`lib/replay/missionReplay.ts`
 * `isReplayableMission`). 그래서 ad-hoc 작업을 Replay 로 잡는 데 필요한 것은
 * **집계 로직이 아니라 라벨**이다 — 가벼운 미션 문서 1건을 만들고 그 배치의
 * 티켓 `contextId` 를 그 missionId 로 돌려놓으면 P1-1/P1-2/P1-3 이 무수정으로
 * 그걸 Replay 로 본다.
 *
 * ── 왜 시간·세션으로 묶지 않나 ────────────────────────────────────────────
 * "최근 N분 안에 만들어진 보드 티켓"류의 기계적 시간묶기는 **의미 없는 묶음**을
 * 만든다(서로 무관한 두 지시가 한 Replay 로 붙고, 하나의 지시가 점심시간을
 * 사이에 두고 둘로 쪼개진다). 오케 세션 id 로 묶는 것도 설계 §2.1 이 이미
 * 배제했다 — 오케 PTY 는 재시작되고(세션 id 가 바뀌어도 일은 계속된다), 한
 * 세션이 여러 묶음을 병렬로 굴린다.
 *
 * 그래서 경계는 **오케가 dispatch 시점에 선언한다**. 관련된 배치에 같은 라벨을
 * 주면 그게 한 미션이다. 이건 기계가 추측할 수 없고 오케만 아는 사실이다
 * (사장님 지시 1건 = 라벨 1개).
 *
 * ── 순수 모듈 ────────────────────────────────────────────────────────────
 * firebase 를 import 하지 않는다(`context.ts` 와 같은 이유) — 라벨 정규화·합류
 * 판정·입양 규칙·완료 판정이 전부 여기 있고, `tools.ts` 는 Firestore I/O 만 한다.
 * 규칙이 순수 함수라 단위테스트로 전수 고정된다
 * (`tests/unit/mission-implicit-grouping.test.ts`).
 */

/** 암묵적 미션의 templateId. 실행 가능한 5개 템플릿과 섞이지 않는 별도 값. */
export const IMPLICIT_MISSION_TEMPLATE_ID = "adhoc";

/** `missions/{id}.missionKind` 마커. 엔진 구동 대상에서 제외하는 유일한 근거. */
export const IMPLICIT_MISSION_KIND = "implicit";

/** 라벨 최대 길이. 넘으면 잘라 쓴다(거부하지 않는다 — 라벨은 사람이 읽는 이름). */
export const MISSION_LABEL_MAX_LENGTH = 60;

/** goal 최대 길이. 미션 문서 goal 은 Replay 헤드라인에 그대로 뜬다. */
export const MISSION_GOAL_MAX_LENGTH = 400;

/**
 * 라벨 정규화 — 앞뒤 공백 제거 + 연속 공백 1칸 + 길이 상한.
 *
 * 합류 판정이 문자열 동등비교라, 정규화하지 않으면 `"replay 배선"` 과
 * `"replay  배선 "` 이 서로 다른 미션이 된다(오케가 매번 똑같이 칠 거라고
 * 가정하면 안 된다). 대소문자는 **보존**한다 — 라벨이 곧 사람이 읽는 이름이라
 * 강제 소문자화는 표시 품질을 깎는다. 매칭 키가 필요하면 `missionLabelKey`.
 */
export function normalizeMissionLabel(
  raw: string | undefined | null,
): string | null {
  if (typeof raw !== "string") return null;
  const collapsed = raw.replace(/\s+/g, " ").trim();
  if (!collapsed) return null;
  return collapsed.slice(0, MISSION_LABEL_MAX_LENGTH);
}

/** 합류 판정용 매칭 키. 표시는 원문 라벨, 매칭은 이 키(대소문자 무시). */
export function missionLabelKey(label: string): string {
  return label.toLocaleLowerCase();
}

/** goal 정규화. 비면 라벨을 그대로 goal 로 쓴다(빈 헤드라인 방지). */
export function normalizeMissionGoal(
  raw: string | undefined | null,
  label: string,
): string {
  const collapsed =
    typeof raw === "string" ? raw.replace(/\s+/g, " ").trim() : "";
  return (collapsed || label).slice(0, MISSION_GOAL_MAX_LENGTH);
}

// ── 합류 판정 ───────────────────────────────────────────────────

/** 아직 안 끝난 미션 상태 — 여기 속하면 같은 라벨의 새 티켓이 합류한다. */
const OPEN_MISSION_STATUSES = new Set([
  "planning",
  "active",
  "waiting_for_human",
  "sleeping",
]);

/** 합류 후보로 넘길 미션 문서의 읽기용 모양(필요한 필드만). */
export interface ImplicitMissionCandidate {
  id: string;
  status?: string;
  missionKind?: string;
  implicitLabel?: string;
  projectId?: string;
  /** 최근성 비교용 밀리초. 호출부가 Timestamp → millis 로 바꿔 넘긴다. */
  lastActivityMs?: number;
}

export function isImplicitMissionDoc(m: {
  missionKind?: string | null;
}): boolean {
  return m.missionKind === IMPLICIT_MISSION_KIND;
}

/**
 * 같은 라벨의 **열린** 암묵적 미션 1건 — 있으면 합류, 없으면 `null`(새로 생성).
 *
 * ★끝난 미션에는 합류하지 않는다. 그래서 같은 라벨을 다음 주에 다시 써도 그건
 * 새 미션이 되고, 이미 발행된 Replay 에 뒤늦은 티켓이 섞여 들어가지 않는다
 * (Replay 는 완료 미션의 **닫힌 기록**이어야 한다).
 *
 * 후보가 여럿이면 가장 최근 활동. 정상적으로는 1건이지만, 동시 dispatch 가
 * 경합해 둘이 만들어졌을 때 조용히 아무거나 고르지 않기 위해 순서를 못 박는다.
 */
export function selectJoinableImplicitMission(
  candidates: readonly ImplicitMissionCandidate[],
  label: string,
  projectId?: string,
): ImplicitMissionCandidate | null {
  const key = missionLabelKey(label);
  const open = candidates.filter(
    (m) =>
      isImplicitMissionDoc(m) &&
      OPEN_MISSION_STATUSES.has(String(m.status ?? "")) &&
      typeof m.implicitLabel === "string" &&
      missionLabelKey(m.implicitLabel) === key &&
      (!projectId || !m.projectId || m.projectId === projectId),
  );
  if (open.length === 0) return null;
  return [...open].sort(
    (a, b) => (b.lastActivityMs ?? 0) - (a.lastActivityMs ?? 0),
  )[0];
}

// ── 미션 문서 ───────────────────────────────────────────────────

export interface BuildImplicitMissionInput {
  projectId: string;
  label: string;
  goal?: string;
  /** 오케 PTY 세션 id — **귀속 표기용**이지 그룹핑 키가 아니다(설계 §2.1). */
  ownerOrchestratorSessionId?: string;
  now: Date;
}

/**
 * 암묵적 미션 문서.
 *
 * `steps: []` / `contextLog: []` 는 의도된 값이다 — 암묵적 미션은 실행 계획이
 * 아니라 **라벨**이다. 서사는 소속 티켓의 activities·원장·머지에서 나오고,
 * 그건 집계 코어(P1-1)가 이미 taskId 로 모은다.
 *
 * `status: "active"` 로 시작한다(일이 진행 중인 게 사실이므로). 대신
 * `missionKind: "implicit"` 마커를 달아 미션 엔진의 픽업 경로에서 통째로
 * 제외시킨다 — 이 마커가 없으면 부팅 시 `wire.ts` 가 active/sleeping 미션을
 * `recoverInFlight` 로 이어받아 steps 0개짜리 미션을 헛돌린다.
 */
export function buildImplicitMissionDoc(
  input: BuildImplicitMissionInput,
): Record<string, unknown> {
  const label = normalizeMissionLabel(input.label) ?? "";
  return {
    projectId: input.projectId,
    goal: normalizeMissionGoal(input.goal, label),
    templateId: IMPLICIT_MISSION_TEMPLATE_ID,
    status: "active",
    missionKind: IMPLICIT_MISSION_KIND,
    implicitLabel: label,
    ownerOrchestratorSessionId: input.ownerOrchestratorSessionId ?? "",
    steps: [],
    currentStepIndex: 0,
    taskIds: [],
    contextLog: [],
    launchedAt: input.now,
    lastActivityAt: input.now,
    completedAt: null,
  };
}

// ── 티켓 입양 규칙 ──────────────────────────────────────────────

/**
 * 라벨을 붙일 수 있는 contextId 인가.
 *
 * ★보드 티켓만 입양한다. Quick Lane(`lane:*`)과 **다른 미션**의 티켓은
 * 손대지 않는다 — 레인 격리와 명시적 미션의 소속은 회귀시키면 안 되는 기존
 * 동작이고, 여기서 조용히 덮으면 그 티켓이 원래 Replay/레인에서 사라진다.
 * (설계상 `contextId` 미설정 = 보드로 백필되므로 여기서도 보드로 본다.)
 */
export function canAdoptContextId(
  contextId: string | undefined | null,
): boolean {
  return !contextId || contextId === "board";
}

export interface AdoptionTarget {
  contextId?: string;
  missionId?: string;
}

/**
 * 입양 판정. 문제가 없으면 `null`, 있으면 **사람이 읽는 거부 사유**.
 *
 * 이미 같은 미션이면 `null`(멱등) — 오케가 같은 라벨로 같은 티켓을 두 번
 * dispatch 하는 건 흔한 일이고, 그때마다 에러를 뱉으면 라벨링이 부담이 된다.
 */
export function implicitAdoptionError(
  taskId: string,
  task: AdoptionTarget,
  missionId: string,
): string | null {
  if (
    task.contextId === missionId &&
    (!task.missionId || task.missionId === missionId)
  ) {
    return null;
  }
  if (task.missionId && task.missionId !== missionId) {
    return `Task ${taskId} already belongs to mission '${task.missionId}' — implicit label refused (an explicit mission's membership is never overwritten).`;
  }
  if (!canAdoptContextId(task.contextId)) {
    return `Task ${taskId} has contextId '${task.contextId}' — implicit label refused (only board tasks are grouped; Quick Lane and mission tasks keep their context).`;
  }
  return null;
}

/** 입양 시 티켓에 쓸 패치. 빈 객체면 이미 그 미션 소속(쓰기 불필요). */
export function implicitAdoptionPatch(
  task: AdoptionTarget,
  missionId: string,
): Record<string, string> {
  const patch: Record<string, string> = {};
  if (task.contextId !== missionId) patch.contextId = missionId;
  if (task.missionId !== missionId) patch.missionId = missionId;
  return patch;
}

// ── 완료 판정 ───────────────────────────────────────────────────

/**
 * 아직 굴러가고 있는 티켓 상태.
 *
 * `FAILED` 를 진행중으로 보지 않는 이유: FAILED→TODO 재시도가 가능하긴 하지만,
 * 실패한 채 방치된 티켓 1장이 미션을 **영원히 열어 두면** 그 배치는 영영 Replay
 * 가 안 된다("빈 Replay 방지"가 이 티켓의 목적이다). 재시도로 다시 살아난
 * 티켓은 contextId 가 그대로라 다음 DONE 때 같은 Replay 에 합류한다.
 */
const IN_FLIGHT_TASK_STATUSES = new Set([
  "TODO",
  "CLAIMED",
  "IN_PROGRESS",
  "REVIEW",
  "BLOCKED",
]);

/**
 * 이 배치가 끝났는가 — 소속 티켓이 전부 종단(DONE/FAILED)이고 **DONE 이 최소 1건**.
 *
 * DONE 1건을 요구하는 이유: 전부 FAILED 인 묶음을 "완료 미션"으로 올리면
 * Replay 리스트가 실패 묶음으로 채워진다. 그건 설계 Q1(실패도 콘텐츠인가)이
 * 아직 미결이라, 결정 전에 코드가 앞서 나가지 않는다.
 */
export function isImplicitMissionComplete(
  tasks: readonly { status?: string }[],
): boolean {
  if (tasks.length === 0) return false;
  let done = 0;
  for (const t of tasks) {
    const status = String(t.status ?? "");
    if (IN_FLIGHT_TASK_STATUSES.has(status)) return false;
    if (status === "DONE") done++;
  }
  return done > 0;
}

/**
 * 완료 전이가 필요한가. 이미 completed 면 `false`(멱등 — 재확인이 completedAt 을
 * 뒤로 밀어 Replay 의 소요시간을 조용히 늘리면 안 된다).
 */
export function shouldCloseImplicitMission(
  mission: { status?: string; missionKind?: string },
  tasks: readonly { status?: string }[],
): boolean {
  if (!isImplicitMissionDoc(mission)) return false;
  if (mission.status === "completed" || mission.status === "abandoned") {
    return false;
  }
  return isImplicitMissionComplete(tasks);
}
