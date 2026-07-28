import type { MessageKey } from "../locales/ko";
import type { LaneRow } from "../types/lane";
import type { TaskStatus } from "../types/task";

/**
 * 퀵레인 카드를 **상태 라인**으로 묶는다.
 *
 * 왜: 카드가 하나의 평평한 그리드에 전부 쏟아지면 "지금 굴러가는 것"과 "끝나서
 * 치우면 되는 것"이 같은 무게로 보인다. 레인이 5~6개만 돼도 화면은 그 구분을
 * 사용자에게 떠넘긴다(카드마다 pill 을 읽어야 안다). 라벨 + 건수를 단 라인으로
 * 접으면 그 판단이 한 번에 끝난다 — 완료이력 탭이 쓰는 것과 같은 정리 방식.
 *
 * ★그리드는 유지한다. 라인 안에서 카드는 여전히 나란히 선다: 병렬로 도는
 * 레인들이 세로 한 줄로 쌓이면 "큐"로 읽힌다는 기존 설계 판단(LanesTab)을
 * 뒤집지 않기 위함. 라인은 카드의 배치가 아니라 **묶음**을 바꾼다.
 *
 * 상태 → 라인 매핑은 순수 함수로 두어 유닛 테스트가 가능하고(모든 TaskStatus 가
 * 정확히 한 라인에 속하는지), 새 status 가 생기면 컴파일에서 걸린다.
 */
export type LaneGroupId = "active" | "review" | "attention" | "done";

/**
 * TaskStatus 전수 매핑 — Record 라서 status enum 이 늘면 여기서 컴파일 에러가
 * 난다(누락된 status 가 조용히 사라지는 대신).
 */
const STATUS_GROUP: Record<TaskStatus, LaneGroupId> = {
  TODO: "active",
  CLAIMED: "active",
  IN_PROGRESS: "active",
  REVIEW: "review",
  BLOCKED: "attention",
  FAILED: "attention",
  DONE: "done",
};

export function laneGroupOf(status: TaskStatus): LaneGroupId {
  return STATUS_GROUP[status] ?? "active";
}

export interface LaneGroupDef {
  id: LaneGroupId;
  labelKey: MessageKey;
  /** 라인 헤더 좌측 점 색 — 라인끼리 스캔으로 구분되게. */
  dotColor: string;
}

/**
 * 표시 순서. 지금 굴러가는 것이 맨 위, 손이 필요한 것(리뷰·주의)이 그다음,
 * 치우면 되는 완료가 맨 아래 — 사용자가 위에서부터 읽으면 급한 순서가 된다.
 */
export const LANE_GROUPS: LaneGroupDef[] = [
  { id: "active", labelKey: "lanes.group.active", dotColor: "#89b4fa" },
  { id: "review", labelKey: "lanes.group.review", dotColor: "#cba6f7" },
  { id: "attention", labelKey: "lanes.group.attention", dotColor: "#f38ba8" },
  { id: "done", labelKey: "lanes.group.done", dotColor: "#a6e3a1" },
];

export interface LaneGroup {
  def: LaneGroupDef;
  rows: LaneRow[];
}

/**
 * 라인 정의를 id 로 집는다. 호출부가 `LANE_GROUPS[0]` 같은 인덱스에 기대지
 * 않게 하기 위함 — 표시 순서를 바꾸는 순간 그런 참조가 조용히 다른 라인을
 * 가리킨다.
 */
export function laneGroupDef(id: LaneGroupId): LaneGroupDef {
  const found = LANE_GROUPS.find((g) => g.id === id);
  if (!found) throw new Error(`Unknown lane group: ${id}`);
  return found;
}

/**
 * 행을 라인별로 묶어 표시 순서대로 돌려준다. **빈 라인은 제외** — 비어 있는
 * 라인 헤더 네 개가 상시 서 있으면 화면이 실제 작업보다 라벨로 가득 찬다.
 *
 * 라인 안 정렬은 `createdAt` 내림차순(새 레인이 위). updatedAt 이 아니라
 * createdAt 인 이유: updatedAt 은 에이전트가 한 글자 쓸 때마다 움직여 카드가
 * 작업 중에 계속 자리를 바꾼다(클릭하려던 카드가 도망간다). createdAt 은
 * 불변이라 배치가 안정적이다.
 */
export function groupLaneRows(rows: LaneRow[]): LaneGroup[] {
  const buckets = new Map<LaneGroupId, LaneRow[]>();
  for (const row of rows) {
    const id = laneGroupOf(row.task.status);
    const bucket = buckets.get(id);
    if (bucket) bucket.push(row);
    else buckets.set(id, [row]);
  }
  return LANE_GROUPS.flatMap((def) => {
    const bucket = buckets.get(def.id);
    if (!bucket || bucket.length === 0) return [];
    const sorted = bucket
      .slice()
      .sort(
        (a, b) =>
          (b.task.createdAt?.getTime?.() ?? 0) -
          (a.task.createdAt?.getTime?.() ?? 0),
      );
    return [{ def, rows: sorted }];
  });
}
