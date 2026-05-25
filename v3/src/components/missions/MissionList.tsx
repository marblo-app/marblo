import type { Mission } from "../../types/mission";
import { MissionStatusBadge } from "./MissionStatusBadge";
import { TEMPLATE_META } from "./templates";

interface MissionListProps {
  missions: Mission[];
  selectedMissionId: string | null;
  onSelect: (missionId: string) => void;
  onAbandon: (missionId: string) => void;
}

export function MissionList({
  missions,
  selectedMissionId,
  onSelect,
  onAbandon,
}: MissionListProps) {
  if (missions.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-gray-700 bg-gray-800/30 p-6 text-center">
        <div className="text-3xl">🌱</div>
        <p className="mt-2 text-sm font-medium text-gray-300">
          아직 진행 중인 미션이 없습니다.
        </p>
        <p className="mt-1 text-xs text-gray-500">
          아래에서 템플릿을 골라 첫 미션을 시작하세요.
        </p>
      </div>
    );
  }
  return (
    <ul className="space-y-2">
      {missions.map((m) => {
        const meta = TEMPLATE_META[m.templateId];
        const total = m.steps.length;
        const completed = m.steps.filter(
          (s) => s.status === "success" || s.status === "skipped",
        ).length;
        const canAbandon = m.status !== "completed" && m.status !== "abandoned";
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
                    <span>· {formatRelative(m.lastActivityAt)}</span>
                  </div>
                </div>
                {canAbandon && (
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      if (
                        confirm(
                          "이 미션을 종료할까요? 진행 중인 task / agent 는 정리됩니다.",
                        )
                      ) {
                        onAbandon(m.id);
                      }
                    }}
                    className="rounded p-1 text-xs text-gray-500 transition-colors hover:bg-red-500/15 hover:text-red-400"
                    title="Abandon mission"
                  >
                    🛑
                  </button>
                )}
              </div>
            </div>
          </li>
        );
      })}
    </ul>
  );
}

function formatRelative(d: Date): string {
  const ts = d instanceof Date ? d : new Date(d);
  const diffMs = Date.now() - ts.getTime();
  if (diffMs < 0) return "방금";
  const sec = Math.floor(diffMs / 1000);
  if (sec < 60) return `${sec}초 전`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}분 전`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}시간 전`;
  const day = Math.floor(hr / 24);
  return `${day}일 전`;
}
