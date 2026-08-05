/**
 * Mission Replay — 구독 계층 (Phase 1).
 *
 * 설계 단일소스: `docs/MISSION-REPLAY-DESIGN.md` §3.1 / C2.
 *
 * 하는 일은 하나다: **여섯 소스를 읽어 `lib/replay` 집계 코어에 넘긴다.**
 * 집계·분류·병합은 전부 `lib/replay/{beats,sensitivity,missionReplay}.ts` 가
 * 하고(P1-1), 이 파일은 I/O 와 **권한 판정**만 담당한다. Firestore 에 아무것도
 * 쓰지 않는다(설계 §2.3: 신규 계측 0 / 신규 write 0).
 *
 * ── 왜 소스마다 읽는 방식이 다른가 ─────────────────────────────────────────
 * `denied`(권한 없음)와 `empty`(기록 0건)를 갈라야 하기 때문이다(설계 C2/R4).
 * 그런데 공용 `subscribeToCollection` 은 에러를 **`callback([])` 로 접는다**
 * (services/firestore.ts). 그걸 그대로 쓰면 owner/admin 전용인 `projectAuditLog`
 * 가 일반 멤버 화면에서 "기록 0건"으로 보이고, 사용자는 그걸 "우리 팀은 아무것도
 * 안 했구나"로 읽는다 — 감사에서 가장 나쁜 실패(조용한 누락)다.
 *
 * 그래서:
 *   - **살아 움직이는 축**(미션 목록·미션 문서)만 구독한다. 미션이 완료로 넘어오는
 *     순간과 오케 서사(`contextLog`)가 계속 붙는 것 — 이 둘만 실시간이 의미 있다.
 *   - **완료 미션의 주변 소스**(tasks/activities/원장/머지)는 **1회 읽기**다.
 *     완료된 미션의 과거는 더 이상 변하지 않고, 1회 읽기는 실패하면 **throw 해서**
 *     `denied` 를 정확히 집어낼 수 있다.
 *
 * ── ★`subscribeToTasks` 를 쓰지 않는 이유 ──────────────────────────────────
 * `taskService.subscribeToTasks` 의 해제 함수는 `resetTaskOutcomeObserver()` 를
 * 부른다(ML 라벨 초크포인트의 중복 억제 맵을 비운다). Replay 가 두 번째 리스너를
 * 열었다가 닫으면 **보드의 살아 있는 리스너가 이미 보고한 전이를 다시 보고**하게
 * 된다 — 화면과 무관한 텔레메트리 오염이다. 그래서 여기서는 `getTasks` 1회 읽기를
 * 쓴다(완료 미션이라 실시간일 이유도 없다).
 *
 * 모든 외부 의존은 `MissionReplayDeps` 로 주입 가능하다 — 구독 조립과 권한저하를
 * Firestore 없이 단위테스트로 고정하기 위해서다(tests/unit/mission-replay-service).
 */

import { where, orderBy, limit as limitTo } from "firebase/firestore";
import type { Unsubscribe } from "firebase/firestore";
import type { Activity } from "../types/activity";
import type { Agent } from "../types/agent";
import type { MergeHistoryEntry } from "../types/mergeHistory";
import type { Mission } from "../types/mission";
import type { ProjectAuditEvent } from "../types/projectAudit";
import type { Task } from "../types/task";
import type {
  MissionReplay,
  ReplaySource,
  ReplaySourceState,
} from "../types/missionReplay";
import {
  buildMissionReplay,
  isReplayableMission,
} from "../lib/replay/missionReplay";
import {
  selectMissionTasks,
  type MissionReplaySources,
  type ReplayAuditLogRow,
} from "../lib/replay/beats";
import { isPermissionDenied } from "../lib/projectAuditView";
import { queryDocuments, convertTimestamps } from "./firestore";
import {
  getMission,
  getMissions,
  subscribeToMission,
  subscribeToMissions,
} from "./missionService";
import { getTasks } from "./taskService";
import { getAgents } from "./agentService";
import { getActivities } from "./activityService";
import { getProjectAuditLog } from "./projectAuditService";

// ── 읽기 상한 ───────────────────────────────────────────────────
//
// 상한은 성능이 아니라 **정직성** 때문에 명시적으로 상수화한다. 잘린 창은
// `provenance` 가 아니라 분모(`stats.reportsScanned`)로 드러나야 하고(설계 R5),
// 뷰가 "N건 창"이라고 말하려면 그 N 을 어디선가 읽을 수 있어야 한다.

/** activities 리스너/읽기를 붙일 태스크 수 상한. 완료이력 탭의 `MAX_TRACKED` 와 같은 값. */
export const REPLAY_ACTIVITY_TASK_CAP = 50;
/** `audit_logs` 최신 N건. 미션 귀속 필터는 집계 코어가 taskId 로 한다(설계 C1). */
export const REPLAY_AUDIT_LOG_CAP = 300;
/** `projectAuditLog` 최신 N건. owner/admin 전용(설계 C2). */
export const REPLAY_PROJECT_AUDIT_CAP = 200;
/** `merge_history` 최신 N건. */
export const REPLAY_MERGE_HISTORY_CAP = 200;

// ── 주입 가능한 의존 ────────────────────────────────────────────

/**
 * 이 서비스가 만지는 Firestore 표면 전부.
 *
 * 함수 하나하나가 **실패하면 throw 하는** 계약이다(빈 배열 위장 금지). 권한
 * 판정이 이 파일의 존재 이유라, 실패를 삼키는 의존을 넣으면 그 순간 C2 가
 * 깨진다.
 */
export interface MissionReplayDeps {
  loadMissions(projectId: string): Promise<Mission[]>;
  subscribeToMissions(
    projectId: string,
    callback: (missions: Mission[]) => void,
  ): Unsubscribe;
  loadMission(missionId: string): Promise<Mission | null>;
  subscribeToMission(
    missionId: string,
    callback: (mission: Mission | null) => void,
  ): Unsubscribe;
  loadTasks(projectId: string): Promise<Task[]>;
  loadAgents(projectId: string): Promise<Agent[]>;
  loadActivities(taskId: string): Promise<Activity[]>;
  loadAuditLogs(
    projectId: string,
    max: number,
  ): Promise<readonly ReplayAuditLogRow[]>;
  loadProjectAuditEvents(
    projectId: string,
    max: number,
  ): Promise<readonly ProjectAuditEvent[]>;
  loadMergeHistory(
    projectId: string,
    max: number,
  ): Promise<readonly MergeHistoryEntry[]>;
}

/**
 * `audit_logs` 1회 읽기.
 *
 * `auditService.subscribeToAuditLogs` 를 쓰지 않는다 — 그쪽은 공용
 * `subscribeToCollection` 이라 permission-denied 를 빈 배열로 접는다(파일 상단
 * 주석). 여기서는 throw 가 필요하다.
 *
 * 렌더러의 `AuditLog` 타입에는 `taskId` 가 없지만 원장 writer
 * (`electron/mcp-server/ledger.ts`)는 그 필드를 쓴다. 그래서 `AuditLog` 로 캐스팅하지
 * 않고 `ReplayAuditLogRow`(두 모양을 다 받는 읽기용 모양)로 읽는다.
 */
async function loadAuditLogsFromFirestore(
  projectId: string,
  max: number,
): Promise<readonly ReplayAuditLogRow[]> {
  const docs = await queryDocuments<Record<string, unknown>>(
    "audit_logs",
    where("projectId", "==", projectId),
    orderBy("createdAt", "desc"),
    limitTo(max),
  );
  return docs.map((raw) =>
    convertTimestamps<ReplayAuditLogRow>(raw, ["createdAt"]),
  );
}

async function loadMergeHistoryFromFirestore(
  projectId: string,
  max: number,
): Promise<readonly MergeHistoryEntry[]> {
  const docs = await queryDocuments<Record<string, unknown>>(
    "merge_history",
    where("projectId", "==", projectId),
    orderBy("mergedAt", "desc"),
    limitTo(max),
  );
  return docs.map((raw) =>
    convertTimestamps<MergeHistoryEntry>(raw, ["mergedAt"]),
  );
}

/** 실제 Firestore 배선. 테스트는 이 자리에 페이크를 꽂는다. */
export const firestoreMissionReplayDeps: MissionReplayDeps = {
  loadMissions: getMissions,
  subscribeToMissions,
  loadMission: getMission,
  subscribeToMission,
  loadTasks: getTasks,
  loadAgents: getAgents,
  loadActivities: getActivities,
  loadAuditLogs: loadAuditLogsFromFirestore,
  loadProjectAuditEvents: (projectId, max) =>
    getProjectAuditLog(projectId, { limit: max }),
  loadMergeHistory: loadMergeHistoryFromFirestore,
};

// ── 상태 ────────────────────────────────────────────────────────

/**
 * 완료 미션 목록 상태.
 *
 * `ready` + 빈 배열이 "빈 상태"다. `denied`/`error` 와 **다른 값**이어야 한다 —
 * `lib/projectAuditView.AuditLoadState` 가 같은 이유로 이미 이 구분을 지킨다.
 */
export type ReplayMissionsState =
  | { status: "loading" }
  | { status: "denied" }
  | { status: "error"; message: string }
  | { status: "ready"; missions: Mission[] };

/** 단건 Replay 를 못 만드는 이유. "없음"과 "권한 없음"을 안 섞는다. */
export type MissionReplayUnavailableReason =
  | "not-found"
  | "not-completed"
  | "denied";

/**
 * 소스별 **비권한** 로드 실패 사유.
 *
 * `provenance.sources` 는 `ok|denied|empty` 3칸뿐이라(P1-1 타입, 바꾸지 않는다)
 * 네트워크 실패 같은 것을 담을 자리가 없다. 그렇다고 실패한 소스를 `empty` 로만
 * 표기하면 "읽어봤는데 기록이 없다"라는 거짓말이 된다. 그래서 provenance 의
 * 의미는 그대로 두고(=`denied` 는 오직 권한), 나머지 실패는 이 칸으로 **따로**
 * 올려 보낸다. 뷰는 이 칸이 찬 레인을 "불러오지 못함"으로 그려야 한다.
 */
export type ReplaySourceErrors = Partial<Record<ReplaySource, string>>;

export type MissionReplayState =
  | { status: "loading" }
  | { status: "unavailable"; reason: MissionReplayUnavailableReason }
  | { status: "error"; message: string }
  | {
      status: "ready";
      replay: MissionReplay;
      sourceErrors: ReplaySourceErrors;
    };

export interface MissionReplaySubscription {
  unsubscribe(): void;
  /** 주변 소스를 다시 읽는다(권한이 방금 바뀌었거나 사용자가 새로고침). */
  reload(): void;
}

export interface MissionReplayOptions {
  deps?: MissionReplayDeps;
  /** 집계 시각 주입 — 골든 스냅샷/테스트 고정용. */
  now?: () => Date;
  /** activities 를 읽을 태스크 수 상한. */
  activityTaskCap?: number;
}

function errorMessage(err: unknown): string {
  const message = (err as { message?: unknown } | null)?.message;
  return typeof message === "string" && message.trim()
    ? message.trim()
    : String(err);
}

function testReplayMissions(projectId: string): Mission[] | null {
  if (typeof window === "undefined" || typeof localStorage === "undefined") {
    return null;
  }
  if (!window.electronAPI?.testMode?.bypassAuth) return null;
  try {
    const raw = localStorage.getItem("marblo:test:replayMissions");
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Record<string, Mission[]>;
    return parsed[projectId] ?? null;
  } catch {
    return null;
  }
}

// ── 완료 미션 목록 ──────────────────────────────────────────────

function sortByCompletion(missions: Mission[]): Mission[] {
  const at = (m: Mission) =>
    m.completedAt?.getTime() ?? m.lastActivityAt?.getTime() ?? 0;
  return [...missions].sort((a, b) => at(b) - at(a));
}

/** 완료 미션만, 최근 완료순. 집계 대상 판정은 P1-1 의 `isReplayableMission`. */
export function selectReplayableMissions(
  missions: readonly Mission[],
): Mission[] {
  return sortByCompletion(missions.filter((m) => isReplayableMission(m)));
}

/**
 * 완료 미션 목록 구독.
 *
 * 1회 읽기로 **권한/에러를 먼저 확정**하고, 그 뒤 구독이 실시간 갱신을 얹는다.
 * 구독만 쓰지 않는 이유: 공용 `subscribeToCollection` 은 실패를 빈 배열로 접어서
 * "미션이 없다"와 "못 읽었다"가 같은 화면이 된다. 1회 읽기는 throw 하므로 그
 * 구분이 살아난다.
 *
 * ★남는 구멍(정직하게 적어 둔다): 게이트를 통과한 **뒤** 실시간 리스너가 죽으면
 * 공용 헬퍼가 그것도 빈 배열로 접으므로, 목록이 조용히 비어 보일 수 있다. 여기서
 * 더 막으려면 `subscribeToCollection` 에 에러 채널을 다는 수밖에 없는데(전 호출부
 * 영향) 이 티켓 범위 밖이다. 최초 진입의 권한 실패 — 실제로 사용자가 부딪히는
 * 경우 — 는 게이트가 잡는다.
 */
export function subscribeToReplayableMissions(
  projectId: string,
  callback: (state: ReplayMissionsState) => void,
  options: Pick<MissionReplayOptions, "deps"> = {},
): MissionReplaySubscription {
  const mock = testReplayMissions(projectId);
  if (mock) {
    callback({ status: "ready", missions: selectReplayableMissions(mock) });
    return {
      unsubscribe() {},
      reload() {
        callback({
          status: "ready",
          missions: selectReplayableMissions(
            testReplayMissions(projectId) ?? [],
          ),
        });
      },
    };
  }

  const deps = options.deps ?? firestoreMissionReplayDeps;
  let disposed = false;
  let gateSettled = false;
  let unsubscribeLive: Unsubscribe | null = null;

  const emitLive = (missions: Mission[]) => {
    if (disposed || !gateSettled) return;
    callback({ status: "ready", missions: selectReplayableMissions(missions) });
  };

  const openGate = () => {
    if (disposed) return;
    callback({ status: "loading" });
    deps
      .loadMissions(projectId)
      .then((missions) => {
        if (disposed) return;
        gateSettled = true;
        callback({
          status: "ready",
          missions: selectReplayableMissions(missions),
        });
        // 게이트를 통과한 뒤에만 실시간을 연다 — 구독이 먼저 빈 배열을 내면
        // 권한 실패가 "미션 없음"으로 먼저 그려진다.
        if (!unsubscribeLive) {
          unsubscribeLive = deps.subscribeToMissions(projectId, emitLive);
        }
      })
      .catch((err) => {
        if (disposed) return;
        gateSettled = false;
        callback(
          isPermissionDenied(err)
            ? { status: "denied" }
            : { status: "error", message: errorMessage(err) },
        );
      });
  };

  openGate();

  return {
    unsubscribe() {
      disposed = true;
      unsubscribeLive?.();
      unsubscribeLive = null;
    },
    reload: openGate,
  };
}

// ── 단건 Replay ─────────────────────────────────────────────────

interface DetailSources {
  tasks: Task[];
  agents: Agent[];
  activitiesByTaskId: Record<string, Activity[]>;
  auditLogs: readonly ReplayAuditLogRow[];
  projectAuditEvents: readonly ProjectAuditEvent[];
  mergeHistory: readonly MergeHistoryEntry[];
}

function emptyDetail(): DetailSources {
  return {
    tasks: [],
    agents: [],
    activitiesByTaskId: {},
    auditLogs: [],
    projectAuditEvents: [],
    mergeHistory: [],
  };
}

/**
 * activities 를 읽을 태스크 선별 — 최근 갱신순 상위 N건.
 *
 * 전부 읽지 않는 것은 리스너/읽기 폭발 때문이고(설계 R5), 잘렸다는 사실은
 * 집계 코어가 `stats.reportsScanned`(분모)로 정직하게 드러낸다. 그래서 여기서
 * 중요한 것은 **읽지 않은 태스크의 키를 만들지 않는 것**이다 — 키를 만들면
 * "읽었는데 보고가 없다"가 되어 분모가 부풀고, 12/207 이 12/12 로 읽힌다.
 */
export function selectActivityTasks(
  tasks: readonly Task[],
  cap: number,
): Task[] {
  const at = (t: Task) => t.updatedAt?.getTime() ?? t.createdAt?.getTime() ?? 0;
  return [...tasks].sort((a, b) => at(b) - at(a)).slice(0, Math.max(0, cap));
}

/**
 * 완료 미션 1건의 Replay 구독.
 *
 * 미션 문서는 실시간(오케 서사가 계속 붙는다), 주변 소스는 1회 읽기 +
 * `reload()`. 어떤 소스가 실패해도 **터지지 않고** 나머지로 Replay 를 만들며,
 * 빠진 레인은 `provenance`(권한) 또는 `sourceErrors`(그 외)로 드러난다.
 */
export function subscribeToMissionReplay(
  params: { missionId: string; projectId?: string },
  callback: (state: MissionReplayState) => void,
  options: MissionReplayOptions = {},
): MissionReplaySubscription {
  const deps = options.deps ?? firestoreMissionReplayDeps;
  const cap = options.activityTaskCap ?? REPLAY_ACTIVITY_TASK_CAP;
  const now = options.now;

  let disposed = false;
  let mission: Mission | null = null;
  let detail = emptyDetail();
  let access: Partial<Record<ReplaySource, ReplaySourceState>> = {};
  let sourceErrors: ReplaySourceErrors = {};
  /** 주변 소스가 한 번이라도 다 정착했는가. 그 전에는 빈 레인을 사실로 말하지 않는다. */
  let detailSettled = false;
  let loadToken = 0;
  let unsubscribeLive: Unsubscribe | null = null;

  const emit = () => {
    if (disposed) return;
    if (!mission) {
      callback({ status: "unavailable", reason: "not-found" });
      return;
    }
    if (!isReplayableMission(mission)) {
      callback({ status: "unavailable", reason: "not-completed" });
      return;
    }
    if (!detailSettled) {
      callback({ status: "loading" });
      return;
    }
    const replay = buildMissionReplay(
      { mission, ...detail } satisfies MissionReplaySources,
      { sourceAccess: access, now: now?.() },
    );
    if (!replay) {
      // isReplayableMission 을 이미 통과했으므로 도달하지 않는다. 그래도
      // 집계 코어의 판정을 이 파일이 다시 구현하지 않으려고 남겨 둔다.
      callback({ status: "unavailable", reason: "not-completed" });
      return;
    }
    callback({ status: "ready", replay, sourceErrors: { ...sourceErrors } });
  };

  /**
   * 소스 1개 읽기 — 실패해도 절대 throw 하지 않는다.
   *
   * permission-denied 는 `provenance` 의 `denied` 로, 나머지 실패는
   * `sourceErrors` 로 간다. 둘을 섞지 않는 게 이 함수의 전부다.
   */
  async function read<T>(
    source: ReplaySource,
    load: () => Promise<T>,
    fallback: T,
  ): Promise<T> {
    try {
      return await load();
    } catch (err) {
      if (isPermissionDenied(err)) {
        access[source] = "denied";
      } else {
        sourceErrors[source] = errorMessage(err);
      }
      return fallback;
    }
  }

  async function loadDetail(target: Mission) {
    const token = ++loadToken;
    const projectId = params.projectId ?? target.projectId;
    const nextAccess: Partial<Record<ReplaySource, ReplaySourceState>> = {};
    const nextErrors: ReplaySourceErrors = {};
    access = nextAccess;
    sourceErrors = nextErrors;

    const tasks = await read("task", () => deps.loadTasks(projectId), []);
    if (disposed || token !== loadToken) return;

    const missionTasks = selectMissionTasks(target, tasks);

    // 태스크 소속이 확정된 뒤에 나머지를 병렬로 읽는다. 하나가 죽어도 나머지는
    // 그대로 온다(Promise.all 이 아니라 각자 read() 로 접힌다).
    const [agents, auditLogs, projectAuditEvents, mergeHistory, activityPairs] =
      await Promise.all([
        // ★agents 는 `ReplaySource` 가 아니다 — 비트를 만들지 않고 캐스트의
        // 벤더 라벨만 채운다. 그래서 실패를 provenance/sourceErrors 에 올리지
        // 않고 조용히 [] 로 떨어뜨린다(캐스트 벤더가 "unknown" 이 될 뿐, 어떤
        // 레인도 사라지지 않는다). 없는 소스 칸에 억지로 태우면 뷰가 "태스크를
        // 못 읽었다"는 거짓 경고를 그린다.
        deps.loadAgents(projectId).catch(() => [] as Agent[]),
        read(
          "audit_logs",
          () => deps.loadAuditLogs(projectId, REPLAY_AUDIT_LOG_CAP),
          [] as readonly ReplayAuditLogRow[],
        ),
        read(
          "projectAuditLog",
          () =>
            deps.loadProjectAuditEvents(projectId, REPLAY_PROJECT_AUDIT_CAP),
          [] as readonly ProjectAuditEvent[],
        ),
        read(
          "merge_history",
          () => deps.loadMergeHistory(projectId, REPLAY_MERGE_HISTORY_CAP),
          [] as readonly MergeHistoryEntry[],
        ),
        Promise.all(
          selectActivityTasks(missionTasks, cap).map(async (task) => {
            // 실패한 태스크는 **키를 만들지 않는다**(안 읽은 것과 같은 사실).
            const loaded = await read<Activity[] | null>(
              "task.activity",
              () => deps.loadActivities(task.id),
              null,
            );
            return [task.id, loaded] as const;
          }),
        ),
      ]);
    if (disposed || token !== loadToken) return;

    const activitiesByTaskId: Record<string, Activity[]> = {};
    for (const [taskId, rows] of activityPairs) {
      if (rows) activitiesByTaskId[taskId] = rows;
    }

    detail = {
      tasks,
      agents,
      activitiesByTaskId,
      auditLogs,
      projectAuditEvents,
      mergeHistory,
    };
    detailSettled = true;
    emit();
  }

  function start() {
    if (disposed) return;
    detailSettled = false;
    callback({ status: "loading" });
    deps
      .loadMission(params.missionId)
      .then((loaded) => {
        if (disposed) return;
        mission = loaded;
        if (!loaded) {
          callback({ status: "unavailable", reason: "not-found" });
          return;
        }
        if (!isReplayableMission(loaded)) {
          callback({ status: "unavailable", reason: "not-completed" });
          return;
        }
        // 미션 문서만 실시간으로 따라간다(contextLog 가 계속 붙는다).
        if (!unsubscribeLive) {
          unsubscribeLive = deps.subscribeToMission(
            params.missionId,
            (next) => {
              if (disposed) return;
              mission = next;
              emit();
            },
          );
        }
        void loadDetail(loaded);
      })
      .catch((err) => {
        if (disposed) return;
        callback(
          isPermissionDenied(err)
            ? { status: "unavailable", reason: "denied" }
            : { status: "error", message: errorMessage(err) },
        );
      });
  }

  start();

  return {
    unsubscribe() {
      disposed = true;
      loadToken += 1;
      unsubscribeLive?.();
      unsubscribeLive = null;
    },
    reload: start,
  };
}
