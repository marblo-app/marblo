import { useTranslation } from "../../lib/i18n";
import type { AgentRole } from "../../types/task";
import {
  isFilterActive,
  type RoleFilterValue,
  type WorkHistoryFilter,
} from "../../lib/workHistoryFilter";
import { PeriodSelector } from "../common/PeriodSelector";

/**
 * 작업내역 필터 한 줄: 기간(사용량 탭과 같은 세그먼트 컨트롤) · 역할 · 검색.
 *
 * 상태는 갖지 않는다 — 탭이 소유한 `filter` 를 받아 부분 패치를 올려보낸다.
 * 그래야 "필터 → 슬라이스" 순서(lib/workHistoryFilter 주석)를 탭 한 곳에서만
 * 지키면 된다.
 *
 * ★모델 칸이 없는 것은 누락이 아니다: Task 문서에 모델 축이 없다. 사유는
 * `lib/workHistoryFilter.ts` 헤더 참조.
 */

/** 역할 값은 데이터(dispatch 가 쓰는 리터럴)라 번역하지 않는다 — 보드/티켓과 동일. */
const ROLES: readonly AgentRole[] = ["backend", "frontend", "test", "devops"];

export function WorkHistoryFilterBar({
  filter,
  onChange,
  onReset,
}: {
  filter: WorkHistoryFilter;
  onChange: (patch: Partial<WorkHistoryFilter>) => void;
  onReset: () => void;
}) {
  const { t } = useTranslation();

  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
      <PeriodSelector
        value={filter.periodId}
        onChange={(periodId) => onChange({ periodId })}
      />

      <div className="flex items-center gap-2">
        <label
          htmlFor="work-history-role"
          className="text-[11px] text-gray-500"
        >
          {t("workHistory.filter.role")}
        </label>
        <select
          id="work-history-role"
          value={filter.role}
          onChange={(e) =>
            onChange({ role: e.target.value as RoleFilterValue })
          }
          className="rounded-md border border-gray-700 bg-gray-800/50 px-2 py-1 text-xs text-gray-200 focus:outline-none focus:ring-1 focus:ring-gray-500"
        >
          <option value="all">{t("workHistory.filter.roleAll")}</option>
          {ROLES.map((role) => (
            <option key={role} value={role}>
              {role}
            </option>
          ))}
        </select>
      </div>

      <div className="flex min-w-[10rem] flex-1 items-center gap-2">
        <input
          type="search"
          value={filter.query}
          onChange={(e) => onChange({ query: e.target.value })}
          placeholder={t("workHistory.filter.searchPlaceholder")}
          aria-label={t("workHistory.filter.searchPlaceholder")}
          className="w-full rounded-md border border-gray-700 bg-gray-800/50 px-2 py-1 text-xs text-gray-200 placeholder:text-gray-600 focus:outline-none focus:ring-1 focus:ring-gray-500"
        />
      </div>

      {isFilterActive(filter) && (
        <button
          type="button"
          onClick={onReset}
          className="flex-shrink-0 rounded border border-gray-700 px-2 py-1 text-xs text-gray-400 transition hover:bg-gray-800 hover:text-gray-200"
        >
          {t("workHistory.filter.reset")}
        </button>
      )}
    </div>
  );
}
