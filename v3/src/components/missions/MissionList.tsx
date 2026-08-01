import type { Mission } from "../../types/mission";
import { useTranslation } from "../../lib/i18n";
import { MissionStatusBadge } from "./MissionStatusBadge";
import { templateMeta } from "./templates";

type TranslateFn = ReturnType<typeof useTranslation>["t"];

interface MissionListProps {
  missions: Mission[];
  selectedMissionId: string | null;
  onSelect: (missionId: string) => void;
  onAbandon: (missionId: string) => void;
  // 영구 삭제(미션 문서 제거). 미지정이면 삭제 버튼을 숨긴다.
  onDelete?: (missionId: string) => void;
}

export function MissionList({
  missions,
  selectedMissionId,
  onSelect,
  onAbandon,
  onDelete,
}: MissionListProps) {
  const { t } = useTranslation();
  if (missions.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-gray-700 bg-gray-800/30 p-6 text-center">
        <div className="text-3xl">🌱</div>
        <p className="mt-2 text-sm font-medium text-gray-300">
          {t("missions.list.emptyTitle")}
        </p>
        <p className="mt-1 text-xs text-gray-500">
          {t("missions.list.emptyHint")}
        </p>
      </div>
    );
  }
  return (
    <ul className="space-y-2">
      {missions.map((m) => {
        const meta = templateMeta(m.templateId);
        const total = m.steps.length;
        const completed = m.steps.filter(
          (s) => s.status === "success" || s.status === "skipped",
        ).length;
        const isTerminal = m.status === "completed" || m.status === "abandoned";
        const canAbandon = !isTerminal;
        return (
          <li key={m.id}>
            <div
              role="button"
              tabIndex={0}
              onClick={() => onSelect(m.id)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  onSelect(m.id);
                }
              }}
              className={`group block w-full cursor-pointer rounded-lg border p-3 text-left transition-colors ${
                selectedMissionId === m.id
                  ? "border-blue-500/60 bg-blue-500/10"
                  : "border-gray-700/70 bg-gray-800/40 hover:border-gray-600 hover:bg-gray-800/70"
              }`}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="text-lg leading-none">
                      {meta?.emoji ?? "🎯"}
                    </span>
                    <span className="truncate text-sm font-medium text-gray-100">
                      {m.goal}
                    </span>
                  </div>
                  <div className="mt-1.5 flex flex-wrap items-center gap-2 text-xs text-gray-400">
                    <MissionStatusBadge status={m.status} />
                    <span>
                      · {completed} / {total} step
                    </span>
                    <span>· {formatRelative(m.lastActivityAt, t)}</span>
                  </div>
                </div>
                <div className="flex flex-shrink-0 items-center gap-0.5">
                  {canAbandon && (
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        if (confirm(t("missions.confirmAbandon"))) {
                          onAbandon(m.id);
                        }
                      }}
                      className="rounded p-1 text-xs text-gray-500 transition-colors hover:bg-red-500/15 hover:text-red-400"
                      title={t("missions.list.abandonTitle")}
                    >
                      🛑
                    </button>
                  )}
                  {onDelete && (
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        const msg = isTerminal
                          ? t("missions.confirmDeleteTerminal")
                          : t("missions.confirmDeleteActive");
                        if (confirm(msg)) onDelete(m.id);
                      }}
                      className="rounded p-1 text-xs text-gray-500 transition-colors hover:bg-red-500/15 hover:text-red-400"
                      title={t("missions.list.deleteTitle")}
                    >
                      🗑️
                    </button>
                  )}
                </div>
              </div>
            </div>
          </li>
        );
      })}
    </ul>
  );
}

function formatRelative(d: Date, t: TranslateFn): string {
  const ts = d instanceof Date ? d : new Date(d);
  const diffMs = Date.now() - ts.getTime();
  if (diffMs < 0) return t("missions.time.justNow");
  const sec = Math.floor(diffMs / 1000);
  if (sec < 60) return t("missions.time.secondsAgo", { count: sec });
  const min = Math.floor(sec / 60);
  if (min < 60) return t("missions.time.minutesAgo", { count: min });
  const hr = Math.floor(min / 60);
  if (hr < 24) return t("missions.time.hoursAgo", { count: hr });
  const day = Math.floor(hr / 24);
  return t("missions.time.daysAgo", { count: day });
}
