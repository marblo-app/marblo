/**
 * Mission Replay — **미션 선택**(어느 미션으로 GIF 를 만들 것인가).
 *
 * ── 왜 이 모듈이 필요했나 ────────────────────────────────────────────────
 * 완료이력 탭에는 "미션 하나를 고른다"는 표면이 사실상 없었다. 미션 목록
 * (`MissionReplayList`)이 `status === "completed"` 만 나열하는데(발행 규칙),
 * 완료로 닫힌 미션이 0건인 프로젝트에서는 목록이 통째로 비고 화면이 프로젝트
 * 전체 집계(경량 Replay)로 떨어진다. 그래서 사용자 눈에는 "집계 뷰만" 보이고,
 * **지금 돌고 있는 내 미션**을 고를 방법이 없다.
 *
 * 선택 목록의 규칙을 발행 규칙에서 떼어 내는 게 이 모듈의 존재 이유다:
 *   - 목록에 필요한 것은 "완료됐는가"가 아니라 **"태스크가 붙어 있는가"** 다.
 *     태스크가 0건인 미션은 GIF 로 만들 게 없다(빈 프레임이 나온다).
 *   - 진행 중 미션도 고를 수 있다. 로컬 GIF 는 발행이 아니고, 결론 문구가
 *     `tasksDone/tasks` 에서 파생되므로 진행 중을 완료로 말하지 않는다
 *     (`gifStoryboard.buildReplayStoryConclusion`). 공개 URL 발행은 여전히
 *     `isReplayPublicationCandidate` 가 완료 미션으로 막는다.
 *
 * ── 표시 이름 ────────────────────────────────────────────────────────────
 * 오케가 dispatch 시점에 준 `mission_label` 은 미션 문서의 `implicitLabel` 로
 * 물질화된다(`electron/mcp-server/implicit-mission.ts`). 라벨이 곧 사람이 부르는
 * 이름이므로 표시 우선순위는 `implicitLabel` → `goal` → "(제목 없음)" 이다.
 *
 * 순수 모듈 — 구독·I/O 없음.
 */

import type { Mission } from "../../types/mission";
import type { Task } from "../../types/task";
import { parsePrNumber } from "./missionOutline";

export interface MissionGifOption {
  missionId: string;
  /** 표시 이름 — `implicitLabel ?? goal`. */
  label: string;
  goal: string;
  status: Mission["status"];
  /** 이 미션에 붙은(= `contextId` 가 일치하는) 태스크 수. */
  taskCount: number;
  doneCount: number;
  /** PR **번호**가 파싱된 태스크 수. URL 은 여기서도 들고 다니지 않는다. */
  prCount: number;
  completed: boolean;
  /** 정렬 기준 — 완료시각 → 마지막 활동. */
  sortedAt: Date | null;
}

const UNTITLED = "(제목 없음)";

function missionLabel(mission: Mission): string {
  const label = mission.implicitLabel?.trim();
  if (label) return label;
  const goal = mission.goal?.trim();
  return goal || UNTITLED;
}

function sortTime(mission: Mission): Date | null {
  return mission.completedAt ?? mission.lastActivityAt ?? null;
}

/**
 * 미션 선택 목록.
 *
 * @param missions 프로젝트의 미션 전부(완료 여부로 미리 거르지 말 것).
 * @param tasks 프로젝트 태스크 전부. 소속 판정은 집계 코어와 **같은 규칙**
 *              (`contextId === mission.id`)을 쓴다 — 여기서만 다른 규칙을 쓰면
 *              목록에 뜬 미션과 GIF 에 들어간 태스크가 어긋난다.
 */
export function buildMissionGifOptions(
  missions: readonly Mission[],
  tasks: readonly Task[],
): MissionGifOption[] {
  const byMission = new Map<string, Task[]>();
  for (const task of tasks) {
    if (task.deleted === true) continue;
    const contextId = task.contextId;
    if (!contextId || contextId === "board" || contextId.startsWith("lane:")) {
      continue;
    }
    const list = byMission.get(contextId);
    if (list) list.push(task);
    else byMission.set(contextId, [task]);
  }

  const options: MissionGifOption[] = [];
  for (const mission of missions) {
    const missionTasks = byMission.get(mission.id) ?? [];
    // 태스크 0건 미션은 목록에 넣지 않는다 — 고를 수는 있는데 GIF 가 비는
    // 상태가 가장 나쁘다(사용자는 그걸 기능 고장으로 읽는다).
    if (missionTasks.length === 0) continue;
    options.push({
      missionId: mission.id,
      label: missionLabel(mission),
      goal: mission.goal?.trim() || missionLabel(mission),
      status: mission.status,
      taskCount: missionTasks.length,
      doneCount: missionTasks.filter((task) => task.status === "DONE").length,
      prCount: missionTasks.filter((task) => parsePrNumber(task.prUrl) !== null)
        .length,
      completed: mission.status === "completed",
      sortedAt: sortTime(mission),
    });
  }

  // 최근 순. 완료를 위로 올리지 않는 이유: 사용자가 찾는 것은 대개 **방금 돌린
  // 미션**이고, 그건 아직 완료가 아닐 수 있다.
  return options.sort((a, b) => {
    const aMs = a.sortedAt?.getTime?.() ?? 0;
    const bMs = b.sortedAt?.getTime?.() ?? 0;
    if (aMs !== bMs) return bMs - aMs;
    return a.label.localeCompare(b.label);
  });
}
