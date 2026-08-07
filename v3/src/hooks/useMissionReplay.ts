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
import { subscribeToMissions } from "../services/missionService";
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

// ── 미션 GIF 선택 인프라 ────────────────────────────────────────

/**
 * 프로젝트의 미션 **전부**(완료 여부 무관).
 *
 * `useReplayableMissions` 와 갈라 둔 이유: 저쪽은 **발행 후보**(완료 미션)를
 * 세는 축이고, 여기는 **고를 수 있는 것**을 세는 축이다. 둘을 한 훅으로 합치면
 * "완료 미션만 목록"이라는 발행 규칙이 선택 UI 에 그대로 새어 들어간다
 * (`lib/replay/missionPicker.ts` 헤더).
 *
 * ★공용 `subscribeToCollection` 은 실패를 빈 배열로 접는다 — 이 훅은 그래서
 * `denied` 를 말하지 못한다. 선택 목록이 비면 화면은 경량 Replay(집계) 로
 * 떨어지므로 사용자가 아무것도 못 하는 상태가 되지는 않는다.
 */
export function useProjectMissions(projectId: string | null | undefined): {
  missions: Mission[];
  loading: boolean;
} {
  const [missions, setMissions] = useState<Mission[]>([]);
  const [loading, setLoading] = useState(Boolean(projectId));

  useEffect(() => {
    if (!projectId) {
      setMissions([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    const unsubscribe = subscribeToMissions(projectId, (next) => {
      setMissions(next);
      setLoading(false);
    });
    return () => unsubscribe();
  }, [projectId]);

  return { missions, loading };
}

export interface MissionExportReplayInput {
  mission: Mission;
  /** 프로젝트 태스크 전부. 소속 판정은 집계 코어가 `contextId` 로 한다. */
  tasks: readonly Task[];
  activitiesByTaskId?: Readonly<Record<string, readonly Activity[]>>;
  mergeHistoryByTaskId?: Readonly<Record<string, MergeHistoryEntry>>;
  now?: Date;
}

/**
 * 선택된 미션 1건 → 익스포트용 `MissionReplay`.
 *
 * ★새로 읽지 않는다. 완료이력 탭이 이미 구독 중인 태스크·activity·머지이력을
 * 그대로 받아 조립한다 — 미션을 고를 때마다 Firestore 를 다시 때리면 선택
 * 자체가 비싸지고(`missionReplayService` 는 미션당 6소스 재읽기다), GIF 는
 * 어차피 화면에 이미 있는 사실만 그린다.
 *
 * 진행 중 미션도 허용한다(`includeIncomplete`) — 그래야 오늘 돌린 미션으로 GIF
 * 를 만들 수 있고, 결론 문구는 데이터 파생이라 완료로 위장하지 않는다.
 */
export function buildMissionExportReplay({
  mission,
  tasks,
  activitiesByTaskId,
  mergeHistoryByTaskId,
  now,
}: MissionExportReplayInput): MissionReplay | null {
  const missionTasks = tasks.filter((task) => task.contextId === mission.id);
  const mergeHistory = missionTasks
    .map((task) => mergeHistoryByTaskId?.[task.id])
    .filter((entry): entry is MergeHistoryEntry => Boolean(entry));

  return buildMissionReplay(
    {
      mission,
      tasks: missionTasks,
      activitiesByTaskId,
      mergeHistory,
      auditLogs: [],
      projectAuditEvents: [],
      agents: [],
    },
    { now, includeIncomplete: true },
  );
}
