/**
 * "작업내역"(완료이력) 탭 필터 — 순수 로직 (I/O 없음).
 *
 * ── 왜 클라 필터인가 ────────────────────────────────────────────────────
 * 사용량 탭의 기간 선택기는 `getCostSummary(projectId, days)` 로 나가는 **서버
 * WHERE** 다. 여기선 다르다: 작업내역은 이미 `taskStore` 가 프로젝트 전체 태스크를
 * 구독하고 있어서 기간을 좁히려고 새 쿼리를 쏠 이유가 없다. 같은 컨트롤(7/30/전체)
 * 을 쓰되 컷오프는 메모리에서 건다.
 *
 * ── 필터 → 슬라이스 순서가 중요한 이유 ──────────────────────────────────
 * 탭은 activities 리스너 폭발을 막으려고 상위 N건만 추적한다(MAX_TRACKED). 그
 * 슬라이스를 **필터보다 먼저** 하면 "frontend 역할만" 이 사실상 "최근 50건 중
 * frontend" 가 되어, 51번째부터의 frontend 완료는 영영 안 보인다. 그래서
 * `filterDoneTasks` 로 먼저 좁히고, 슬라이스는 그 결과에 건다.
 *
 * ── 모델 축이 없는 이유 ─────────────────────────────────────────────────
 * ★Task 문서에는 모델 필드가 없다(role/claimedBy/costTotal 만 있다). 어떤 모델이
 * 돌았는지는 완료 시점에 `agents/{claimedBy}` 스냅샷을 읽어 BigQuery
 * `task_outcomes` 에만 실린다. agent doc 은 cleanup 으로 사라지므로 과거 완료
 * 태스크의 모델은 렌더러에서 재구성할 수 없다 — 없는 축을 추정으로 채우지 않는다.
 */

import type { AgentRole, Task } from "../types/task";
import {
  ALL_PERIOD_DAYS,
  periodById,
  type UsagePeriodId,
} from "./usageBreakdown";

/** 역할 필터 값 — 실제 역할 4종 + "전체". */
export type RoleFilterValue = AgentRole | "all";

export interface WorkHistoryFilter {
  periodId: UsagePeriodId;
  role: RoleFilterValue;
  /** 제목/설명 부분일치 검색어(대소문자 무시). 공백만이면 미적용. */
  query: string;
}

export const DEFAULT_WORK_HISTORY_FILTER: WorkHistoryFilter = {
  periodId: "30d",
  role: "all",
  query: "",
};

/** 기본값과 다른 칸이 하나라도 있으면 true — "필터 초기화" 노출 조건. */
export function isFilterActive(filter: WorkHistoryFilter): boolean {
  return (
    filter.periodId !== DEFAULT_WORK_HISTORY_FILTER.periodId ||
    filter.role !== DEFAULT_WORK_HISTORY_FILTER.role ||
    filter.query.trim() !== ""
  );
}

const MS_PER_DAY = 86_400_000;

/**
 * 선택 기간의 컷오프 시각. "전체"(= ALL_PERIOD_DAYS) 는 컷오프 없음(null)으로
 * 다룬다 — 사용량 탭에선 10년치 서버 쿼리로 나가는 값이지만, 여기선 그냥
 * "자르지 않는다" 가 정확한 의미다.
 */
export function periodCutoff(periodId: UsagePeriodId, now: Date): Date | null {
  const { days } = periodById(periodId);
  if (days >= ALL_PERIOD_DAYS) return null;
  return new Date(now.getTime() - days * MS_PER_DAY);
}

function matchesQuery(task: Task, needle: string): boolean {
  if (!needle) return true;
  const haystack = `${task.title ?? ""}\n${task.description ?? ""}`;
  return haystack.toLowerCase().includes(needle);
}

/**
 * DONE 태스크를 기간·역할·검색으로 좁히고 최신순(updatedAt DESC)으로 정렬한다.
 *
 * `updatedAt` 이 없는 태스크(구 스키마/쓰기 중간 스냅샷)는 기간을 판정할 수
 * 없으므로 컷오프가 걸린 기간에선 **제외**하고, "전체" 에서만 보인다. 날짜를
 * 모르는 행을 최근인 척 남기면 "7일" 이 7일이 아니게 된다.
 */
export function filterDoneTasks(
  tasks: Task[],
  filter: WorkHistoryFilter,
  now: Date = new Date(),
): Task[] {
  const cutoff = periodCutoff(filter.periodId, now);
  const needle = filter.query.trim().toLowerCase();

  return tasks
    .filter((task) => {
      if (task.status !== "DONE") return false;
      if (filter.role !== "all" && task.role !== filter.role) return false;
      if (cutoff) {
        if (!task.updatedAt) return false;
        if (task.updatedAt.getTime() < cutoff.getTime()) return false;
      }
      return matchesQuery(task, needle);
    })
    .sort((a, b) => {
      const at = a.updatedAt ? +a.updatedAt : 0;
      const bt = b.updatedAt ? +b.updatedAt : 0;
      return bt - at;
    });
}
