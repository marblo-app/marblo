import { useTranslation } from "../../lib/i18n";
import type { MessageKey } from "../../locales/ko";
import { USAGE_PERIODS, type UsagePeriodId } from "../../lib/usageBreakdown";

/**
 * 7 / 30 / 전체 기간 세그먼트 컨트롤 — **사용량 탭과 작업내역 탭의 공용 부품**.
 *
 * 원래 `usage/UsagePage.tsx` 안에만 있었다. 작업내역 탭에도 같은 필터가 필요해
 * 지면서 복사하는 대신 여기로 끌어올린다: 두 화면의 칸 수·라벨·키보드 동작이
 * 갈라지면 "같은 필터인데 다르게 동작한다" 가 되기 때문이다. 칸의 단일소스는
 * 여전히 `lib/usageBreakdown.USAGE_PERIODS` 다.
 *
 * ★두 화면에서 `days` 의 의미가 다르다는 점만 주의:
 *   - 사용량 탭: `loadSummary(projectId, days)` 로 나가는 **서버 WHERE**.
 *   - 작업내역 탭: 이미 구독 중인 태스크 배열에 거는 **클라 컷오프**.
 * 이 컴포넌트는 어느 쪽인지 모른다 — 선택된 id 만 올려보낸다.
 */

const PERIOD_LABEL_KEYS: Record<UsagePeriodId, MessageKey> = {
  "7d": "common.period.7d",
  "30d": "common.period.30d",
  all: "common.period.all",
};

export function periodLabel(
  id: UsagePeriodId,
  t: (key: MessageKey, vars?: Record<string, string | number>) => string,
): string {
  return t(PERIOD_LABEL_KEYS[id]);
}

export function PeriodSelector({
  value,
  onChange,
}: {
  value: UsagePeriodId;
  onChange: (id: UsagePeriodId) => void;
}) {
  const { t } = useTranslation();
  return (
    <div className="flex items-center gap-2">
      <span className="text-[11px] text-gray-500">
        {t("common.period.label")}
      </span>
      <div
        role="group"
        aria-label={t("common.period.label")}
        className="flex overflow-hidden rounded-md border border-gray-700"
      >
        {USAGE_PERIODS.map((p) => {
          const active = p.id === value;
          return (
            <button
              key={p.id}
              type="button"
              aria-pressed={active}
              onClick={() => onChange(p.id)}
              className={`px-3 py-1 text-xs transition-colors ${
                active
                  ? "bg-gray-700 font-medium text-gray-100"
                  : "bg-gray-800/50 text-gray-400 hover:text-gray-200"
              }`}
            >
              {periodLabel(p.id, t)}
            </button>
          );
        })}
      </div>
    </div>
  );
}
