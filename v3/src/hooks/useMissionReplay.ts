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
import type { Mission } from "../types/mission";
import {
  subscribeToMissionReplay,
  subscribeToReplayableMissions,
  type MissionReplayOptions,
  type MissionReplayState,
  type ReplayMissionsState,
} from "../services/missionReplayService";

export type { MissionReplayState, ReplayMissionsState };

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
