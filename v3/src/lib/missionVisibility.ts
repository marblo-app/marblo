/**
 * 미션 가시성 — "지휘자가 실제로 운전할 수 있는 미션"과 "지난 작업에 붙은
 * 이름표"를 가르는 단일 규칙.
 *
 * 왜 필요한가 (티켓 pfEBF4VEhyM1P1iw7Aem, 진단 #1402):
 * 이 프로젝트의 미션 24건 중 active 3건이 **전부** `missionKind: "implicit"`
 * 이고 `steps: []` 였다. implicit 미션은 설계상 실행 계획이 아니라 Replay
 * 라벨이라 미션 엔진 픽업에서 통째로 제외된다(`wire.ts` 의 `isImplicitMission`
 * 가드). 그런데 레인 탭은 둘을 구분하지 않고 같은 자리에 같은 "▶ Active"
 * 배지로 그려서, **운전할 대상이 0건인데 3건이 돌고 있는 것처럼** 보였다.
 *
 * 그래서 "실행 중"을 세는 규칙을 컴포넌트마다 다시 쓰지 않고 여기 한 곳에
 * 둔다. 화면이 implicit 을 실행 중으로 세지 않는다는 사실을 순수 함수로
 * 고정해 두면, 다음에 미션 카운트를 그리는 화면이 생겨도 같은 답을 준다.
 *
 * ★implicit 기능 자체를 없애는 모듈이 아니다. Replay 라벨로서의 역할은
 * 그대로 두고, "실행 중"으로 세지 않게만 한다.
 */
import type { MissionKind, MissionStatus } from "../types/mission";
import { isImplicitMission } from "../types/mission";

/** 버킷 판정에 필요한 최소 필드 — Mission 전체를 요구하지 않아 테스트가 가볍다. */
export interface MissionVisibilityInput {
  status: MissionStatus;
  missionKind?: MissionKind | string | null;
}

/** 종료된 미션인가 — 더 이상 운전 대상이 아니다. */
export function isTerminalMissionStatus(status: MissionStatus): boolean {
  return status === "completed" || status === "abandoned";
}

/**
 * 지휘자가 실제로 운전할 수 있는 미션인가.
 * implicit(Replay 라벨)은 엔진 픽업에서 제외되므로 실행 대상이 아니다.
 */
export function isRunnableMission(mission: MissionVisibilityInput): boolean {
  return !isImplicitMission(mission);
}

export interface MissionVisibilityBuckets<M> {
  /** 실행 가능 + 아직 안 끝남 — 이것만이 "돌고 있는 미션"이다. */
  running: M[];
  /** 실행 가능하지만 끝난 것 (완료/중단). */
  finished: M[];
  /** implicit — 지난 작업에 붙은 이름표. 실행 대상이 아니다. */
  labels: M[];
}

/**
 * 미션을 실행 가능 여부로 가른다.
 *
 * @param isFinished 호출부가 "끝남"을 더 넓게 볼 때 넘긴다(예: 레인 탭은
 *   진행률 100% 도 끝난 것으로 친다). 안 넘기면 상태만 본다.
 *   ★implicit 은 이 판정에 아예 들어가지 않는다 — 끝났든 아니든 라벨이다.
 */
export function bucketMissionsByRunnability<M extends MissionVisibilityInput>(
  missions: readonly M[],
  isFinished?: (mission: M) => boolean,
): MissionVisibilityBuckets<M> {
  const running: M[] = [];
  const finished: M[] = [];
  const labels: M[] = [];
  for (const mission of missions) {
    if (!isRunnableMission(mission)) {
      labels.push(mission);
      continue;
    }
    const done = isFinished
      ? isFinished(mission)
      : isTerminalMissionStatus(mission.status);
    if (done) finished.push(mission);
    else running.push(mission);
  }
  return { running, finished, labels };
}

/**
 * 화면에 "돌고 있다"고 적어도 되는 미션 수. implicit 은 세지 않는다.
 * 이 숫자가 0 이면 화면은 그 사실을 분명히 말해야 한다.
 */
export function countRunningMissions(
  missions: readonly MissionVisibilityInput[],
): number {
  return bucketMissionsByRunnability(missions).running.length;
}
