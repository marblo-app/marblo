/**
 * Mission Replay — 뷰가 쓰는 훅 (Phase 1).
 *
 * 설계 단일소스: `docs/MISSION-REPLAY-DESIGN.md` §3.1.
 *
 * 훅은 **구독을 상태로 접기만 한다.** 집계는 `lib/replay/*`(P1-1), I/O·권한
 * 판정은 `services/missionReplayService`(P1-2) 가 한다. 여기서 다시 필터링하거나
 * 수치를 재계산하지 않는다 — 같은 사실을 두 곳에서 계산하면 화면과 익스포트가
 * 서로 다른 숫자를 말하게 된다.
 *
 * ★훅은 절대 throw 하지 않는다. Replay 섹션 하나가 완료이력 탭 전체를
 * 언마운트시키면 안 된다(`useProjectAuditLog` 가 같은 이유로 같은 규칙을 쓴다).
 * 실패는 전부 상태(`denied`/`error`/`sourceErrors`)로 내려온다.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import type { Activity } from "../types/activity";
import type { MergeHistoryEntry } from "../types/mergeHistory";
import type { Mission } from "../types/mission";
import type { Task } from "../types/task";
import type {
  MissionReplay,
  ReplaySource,
  ReplaySourceState,
} from "../types/missionReplay";
import { buildMissionReplay } from "../lib/replay/missionReplay";
import {
  subscribeToMissionReplay,
  subscribeToReplayableMissions,
  type MissionReplayOptions,
  type MissionReplayState,
  type ReplayMissionsState,
} from "../services/missionReplayService";

export type { MissionReplayState, ReplayMissionsState };

export const LIGHTWEIGHT_REPLAY_MISSION_ID = "__work_history_done_summary__";

const ALL_REPLAY_SOURCES: readonly ReplaySource[] = [
  "mission.contextLog",
  "task",
  "task.activity",
  "audit_logs",
  "projectAuditLog",
  "merge_history",
];

export interface LightweightReplayInput {
  projectId: string;
  tasks: readonly Task[];
  activitiesByTaskId?: Readonly<Record<string, readonly Activity[]>>;
  mergeHistoryByTaskId?: Readonly<Record<string, MergeHistoryEntry>>;
  now?: Date;
}

function dateMs(value: Date | null | undefined): number | null {
  return value instanceof Date ? value.getTime() : null;
}

function firstDate(values: Array<Date | null | undefined>, fallback: Date) {
  let best = Number.POSITIVE_INFINITY;
  for (const value of values) {
    const ms = dateMs(value);
    if (ms !== null && ms < best) best = ms;
  }
  return Number.isFinite(best) ? new Date(best) : fallback;
}

function lastDate(values: Array<Date | null | undefined>, fallback: Date) {
  let best = Number.NEGATIVE_INFINITY;
  for (const value of values) {
    const ms = dateMs(value);
    if (ms !== null && ms > best) best = ms;
  }
  return Number.isFinite(best) ? new Date(best) : fallback;
}

/**
 * missions 컬렉션이 비어 있는 프로젝트에서도 완료탭이 가진 DONE task/완료보고/
 * merge_history 만으로 읽기 전용 경량 Replay 를 만든다.
 *
 * 실제 mission 문서를 쓰거나 task 를 변경하지 않는다. 집계 코어의 소속 판정이
 * `task.contextId === mission.id` 이므로, 이 함수 안에서만 얕은 복사본의
 * `contextId` 를 synthetic mission id 로 맞춘다.
 */
export function buildLightweightReplayFromCompletedTasks({
  projectId,
  tasks,
  activitiesByTaskId,
  mergeHistoryByTaskId,
  now = new Date(),
}: LightweightReplayInput): { mission: Mission; replay: MissionReplay } | null {
  const doneTasks = tasks
    .filter((task) => task.status === "DONE")
    .sort((a, b) => {
      const aAt = dateMs(a.updatedAt) ?? dateMs(a.createdAt) ?? 0;
      const bAt = dateMs(b.updatedAt) ?? dateMs(b.createdAt) ?? 0;
      return bAt - aAt;
    });
  if (doneTasks.length === 0) return null;

  const launchedAt = firstDate(
    doneTasks.flatMap((task) => [task.createdAt, task.claimedAt]),
    now,
  );
  const completedAt = lastDate(
    doneTasks.map((task) => task.updatedAt ?? task.createdAt),
    now,
  );
  const taskIds = doneTasks.map((task) => task.id);
  const title =
    doneTasks.length === 1
      ? doneTasks[0].title || "완료 작업 요약"
      : `완료 작업 요약 ${doneTasks.length}건`;

  const mission: Mission = {
    id: LIGHTWEIGHT_REPLAY_MISSION_ID,
    projectId,
    goal: title,
    templateId: "adhoc",
    status: "completed",
    missionKind: "implicit",
    implicitLabel: "work-history",
    ownerOrchestratorSessionId: "work-history",
    steps: [],
    currentStepIndex: 0,
    taskIds,
    contextLog: [
      {
        ts: launchedAt,
        type: "supervisor.note",
        payload: {
          summary: "완료 작업에서 조립한 경량 Replay",
        },
      },
      {
        ts: completedAt,
        type: "step.completed",
        payload: { stepIndex: 0 },
      },
    ],
    launchedAt,
    lastActivityAt: completedAt,
    completedAt,
  };

  const copiedTasks = doneTasks.map((task) => ({
    ...task,
    contextId: mission.id,
  }));
  const mergeHistory = taskIds
    .map((taskId) => mergeHistoryByTaskId?.[taskId])
    .filter((entry): entry is MergeHistoryEntry => Boolean(entry));
  const sourceAccess = Object.fromEntries(
    ALL_REPLAY_SOURCES.map((source) => [source, "ok" as ReplaySourceState]),
  ) as Record<ReplaySource, ReplaySourceState>;
  const replay = buildMissionReplay(
    {
      mission,
      tasks: copiedTasks,
      activitiesByTaskId,
      mergeHistory,
      auditLogs: [],
      projectAuditEvents: [],
      agents: [],
    },
    { now, sourceAccess },
  );
  return replay ? { mission, replay } : null;
}

export interface UseReplayableMissionsResult {
  state: ReplayMissionsState;
  /** `ready` 일 때의 목록. 그 외 상태에서는 빈 배열. */
  missions: Mission[];
  /** 읽기는 성공했는데 완료 미션이 0건 — `denied`/`error` 와 다른 사실이다. */
  isEmpty: boolean;
  reload: () => void;
}

/**
 * 완료 미션 목록.
 *
 * @param projectId 빈 값이면 아무것도 구독하지 않고 빈 `ready` 를 준다
 *                  (프로젝트 미선택은 에러가 아니다).
 */
export function useReplayableMissions(
  projectId: string | null | undefined,
  options: Pick<MissionReplayOptions, "deps"> = {},
): UseReplayableMissionsResult {
  const [state, setState] = useState<ReplayMissionsState>({
    status: "loading",
  });
  const [nonce, setNonce] = useState(0);
  const reload = useCallback(() => setNonce((n) => n + 1), []);

  // deps 는 테스트 주입용이라 매 렌더 새 객체일 수 있다. effect 의존성에 넣으면
  // 구독이 매 렌더 재생성되므로 ref 로 고정한다(값이 바뀌어도 재구독하지 않는다).
  const depsRef = useRef(options.deps);
  depsRef.current = options.deps;

  useEffect(() => {
    if (!projectId) {
      setState({ status: "ready", missions: [] });
      return;
    }
    setState({ status: "loading" });
    const sub = subscribeToReplayableMissions(projectId, setState, {
      deps: depsRef.current,
    });
    return () => sub.unsubscribe();
  }, [projectId, nonce]);

  return {
    state,
    missions: state.status === "ready" ? state.missions : [],
    isEmpty: state.status === "ready" && state.missions.length === 0,
    reload,
  };
}

export interface UseMissionReplayResult {
  state: MissionReplayState;
  reload: () => void;
}

/**
 * 선택된 미션 1건의 Replay.
 *
 * @param missionId `null` 이면 구독하지 않는다 — 그리고 그때의 상태는
 *                  `loading` 이 아니라 `unavailable/not-found` 다. 미선택을
 *                  로딩으로 그리면 아무것도 고르지 않은 화면이 영원히 스피너를
 *                  돌린다.
 */
export function useMissionReplay(
  missionId: string | null | undefined,
  options: MissionReplayOptions & { projectId?: string } = {},
): UseMissionReplayResult {
  const [state, setState] = useState<MissionReplayState>({
    status: "loading",
  });
  const [nonce, setNonce] = useState(0);
  const reload = useCallback(() => setNonce((n) => n + 1), []);

  const optionsRef = useRef(options);
  optionsRef.current = options;

  const projectId = options.projectId;

  useEffect(() => {
    if (!missionId) {
      setState({ status: "unavailable", reason: "not-found" });
      return;
    }
    setState({ status: "loading" });
    const { deps, now, activityTaskCap } = optionsRef.current;
    const sub = subscribeToMissionReplay({ missionId, projectId }, setState, {
      deps,
      now,
      activityTaskCap,
    });
    return () => sub.unsubscribe();
  }, [missionId, projectId, nonce]);

  return { state, reload };
}
