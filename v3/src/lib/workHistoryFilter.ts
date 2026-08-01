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
 * ★그리고 그 슬라이스는 **리스너에만** 건다. 리스트/집계까지 슬라이스 결과로
 * 그리면 이번엔 기간 필터가 화면에서 사라진다: 컷오프는 오래된 쪽만 잘라내므로
 * 어떤 기간이든 50건 이상 남아 있으면 "최신 50건" 이 전부 같은 50건이 된다
 * (실측 DONE 938건: 7일 164 / 30일 588 / 전체 938 → 세 기간 전부 상위 50 동일).
 * 자세한 건 `components/work-history/WorkHistoryTab.tsx` 의 MAX_TRACKED 주석.
 *
 * ── 기간축이 `updatedAt` 인 이유(= 완료시각 필드가 없다) ─────────────────
 * ★tasks 문서에는 completedAt/doneAt 이 **없다**(실측: 이 프로젝트 DONE 250건
 * 전수 필드 스캔). 완료 시각에 가장 가까운 대안이던 `merge_history.mergedAt` 은
 * DONE 의 5.6%(14/250)만 덮는다 — 그걸 기간축으로 삼으면 나머지 94%가 "날짜 미상"
 * 이 되어 컷오프가 통째로 무너진다. 그래서 축은 `updatedAt` 이고, 그 한계(완료
 * **후** 활동이 붙으면 갱신된다)는 감수한다. 완료시각 축이 필요하면 쓰기 쪽에
 * 필드를 신설해야 하지 렌더러에서 추정할 일이 아니다.
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

/**
 * 태스크 날짜 → epoch ms 정규화. 판정 불가는 `null`(0 이 아니다 — 0 은 1970년
 * 이라는 **판정**이라 컷오프를 통과/탈락시켜 버린다).
 *
 * 렌더러 로더(`taskService.toTask` → `convertTimestamps` → `toDate`)가 이미
 * `Date` 로 단일소스 정규화하므로 실사용에선 첫 분기에서 끝난다(라이브 실측:
 * DONE 600건 전수 Firestore timestamp → 전부 Date 로 접힌다). 그런데도 다른
 * 모양을 받아 두는 이유는 방어가 아니라 **fail-closed 를 한 곳에 모으기
 * 위해서**다. 필터에서 `task.updatedAt.getTime()` 을 직접 부르면 로더 계약이
 * 한 곳이라도 깨졌을 때 두 갈래로 터진다:
 *   - Timestamp/평문 객체가 그대로 오면 `getTime is not a function` → 탭 전체가
 *     렌더 도중 죽는다.
 *   - `toDate()` 가 `{seconds}` 평문 객체를 `new Date(obj)` 로 접으면 **Invalid
 *     Date** 가 되고 `NaN < cutoff` 는 false → 컷오프가 **조용히 무효화**된다
 *     (오래된 태스크가 "7일" 필터를 그냥 통과한다).
 * 여기서 null 로 모으면 호출부가 "모르는 날짜는 컷 걸린 기간에서 제외" 를
 * 강제할 수 있다.
 */
export function toTaskMillis(value: unknown): number | null {
  const finite = (ms: number): number | null =>
    Number.isFinite(ms) ? ms : null;

  if (value == null) return null;
  if (value instanceof Date) return finite(value.getTime());
  if (typeof value === "number") return finite(value);
  if (typeof value === "string") return finite(Date.parse(value));

  if (typeof value === "object") {
    // Firestore Timestamp — 인스턴스든(다중 SDK 번들이면 instanceof 가 깨진다)
    // `{seconds,nanoseconds}` 평문 객체든 같은 자리로 흡수한다.
    const obj = value as { toDate?: unknown; seconds?: unknown };
    if (typeof obj.toDate === "function") {
      const date = (obj as { toDate: () => unknown }).toDate();
      return date instanceof Date ? finite(date.getTime()) : null;
    }
    if (typeof obj.seconds === "number") return finite(obj.seconds * 1000);
  }
  return null;
}

/**
 * 기간축으로 쓰는 태스크 시각(epoch ms) — 없거나 판정 불가면 null.
 * 축이 `updatedAt` 인 이유는 이 파일 헤더 참조.
 */
export function taskPeriodMillis(task: Task): number | null {
  return toTaskMillis(task.updatedAt);
}

function matchesQuery(task: Task, needle: string): boolean {
  if (!needle) return true;
  const haystack = `${task.title ?? ""}\n${task.description ?? ""}`;
  return haystack.toLowerCase().includes(needle);
}

/**
 * DONE 태스크를 기간·역할·검색으로 좁히고 최신순(updatedAt DESC)으로 정렬한다.
 *
 * 날짜를 판정할 수 없는 태스크(`updatedAt` 부재/구 스키마/쓰기 중간 스냅샷/
 * 타입 어긋남)는 컷오프가 걸린 기간에선 **제외**하고 "전체" 에서만 보인다 —
 * fail-closed. 날짜를 모르는 행을 최근인 척 남기면 "7일" 이 7일이 아니게 된다.
 */
export function filterDoneTasks(
  tasks: Task[],
  filter: WorkHistoryFilter,
  now: Date = new Date(),
): Task[] {
  const cutoff = periodCutoff(filter.periodId, now);
  const cutoffMs = cutoff ? cutoff.getTime() : null;
  const needle = filter.query.trim().toLowerCase();

  return tasks
    .filter((task) => {
      if (task.status !== "DONE") return false;
      if (filter.role !== "all" && task.role !== filter.role) return false;
      if (cutoffMs !== null) {
        const ms = taskPeriodMillis(task);
        if (ms === null || ms < cutoffMs) return false;
      }
      return matchesQuery(task, needle);
    })
    .sort((a, b) => (taskPeriodMillis(b) ?? 0) - (taskPeriodMillis(a) ?? 0));
}
