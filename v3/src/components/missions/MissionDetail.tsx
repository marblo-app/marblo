import type {
  Mission,
  MissionStep,
  MissionStepStatus,
} from "../../types/mission";
import { MissionStatusBadge } from "./MissionStatusBadge";
import { MissionTimeline } from "./MissionTimeline";
import { TEMPLATE_META } from "./templates";

interface MissionDetailProps {
  mission: Mission;
  onPause: (id: string) => void;
  onResume: (id: string) => void;
  onAbandon: (id: string) => void;
}

const STEP_ICON: Record<MissionStepStatus, string> = {
  pending: "·",
  running: "▶",
  success: "✅",
  failed: "⚠️",
  skipped: "⏭",
};

export function MissionDetail({
  mission,
  onPause,
  onResume,
  onAbandon,
}: MissionDetailProps) {
  const meta = TEMPLATE_META[mission.templateId];
  const canPause = mission.status === "active";
  const canResume =
    mission.status === "sleeping" || mission.status === "waiting_for_human";
  const isTerminal =
    mission.status === "completed" || mission.status === "abandoned";
  const needsAttention = mission.status === "waiting_for_human";
  const failedStep = mission.steps.find((s) => s.status === "failed");

  return (
    <div className="space-y-4">
      <header className="rounded-xl border border-gray-700 bg-gray-800/50 p-4">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span className="text-2xl leading-none">
                {meta?.emoji ?? "🎯"}
              </span>
              <h2 className="truncate text-lg font-semibold text-gray-100">
                {mission.goal}
              </h2>
            </div>
            <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-gray-400">
              <MissionStatusBadge status={mission.status} />
              <span>· {meta?.label ?? mission.templateId}</span>
              <span>· 시작 {formatDate(mission.launchedAt)}</span>
              {mission.completedAt && (
                <span>· 완료 {formatDate(mission.completedAt)}</span>
              )}
            </div>
            {mission.abandonedReason && (
              <p className="mt-2 text-xs text-red-300">
                Abandoned: {mission.abandonedReason}
              </p>
            )}
          </div>
          <div className="flex flex-shrink-0 gap-2">
            {canPause && (
              <button
                onClick={() => onPause(mission.id)}
                className="rounded-lg border border-gray-600 bg-gray-700/50 px-3 py-1.5 text-xs font-medium text-gray-200 transition-colors hover:bg-gray-700"
              >
                ⏸ Pause
              </button>
            )}
            {canResume && (
              <button
                onClick={() => onResume(mission.id)}
                className="rounded-lg border border-emerald-500/50 bg-emerald-500/10 px-3 py-1.5 text-xs font-medium text-emerald-300 transition-colors hover:bg-emerald-500/20"
              >
                ▶ Resume
              </button>
            )}
            {!isTerminal && (
              <button
                onClick={() => {
                  if (
                    confirm(
                      "미션을 종료할까요? 진행 중인 task / agent 는 정리됩니다.",
                    )
                  ) {
                    onAbandon(mission.id);
                  }
                }}
                className="rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-1.5 text-xs font-medium text-red-300 transition-colors hover:bg-red-500/20"
              >
                🛑 Abandon
              </button>
            )}
          </div>
        </div>
        {needsAttention && (
          <div className="mt-3 rounded-lg border border-yellow-500/40 bg-yellow-500/10 p-3 text-sm text-yellow-200">
            <div className="font-medium">개입이 필요합니다.</div>
            <div className="mt-0.5 text-xs text-yellow-200/80">
              {failedStep
                ? `Step ${failedStep.index + 1} (${
                    failedStep.skill ?? failedStep.type
                  }) 실패 · ${failedStep.error ?? "unknown"}`
                : "마지막 step 결과를 확인하고 Resume 또는 Abandon 을 선택하세요."}
            </div>
          </div>
        )}
      </header>

      <section>
        <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-gray-500">
          Steps · {Math.min(mission.currentStepIndex + 1, mission.steps.length)}{" "}
          / {mission.steps.length}
        </h3>
        <ol className="space-y-1.5">
          {mission.steps.map((step, i) => (
            <StepRow
              key={i}
              step={step}
              isCurrent={i === mission.currentStepIndex && !isTerminal}
            />
          ))}
        </ol>
      </section>

      <section>
        <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-gray-500">
          Timeline
        </h3>
        <MissionTimeline
          events={mission.contextLog}
          emptyHint="orchestrator 가 곧 시작합니다."
        />
      </section>
    </div>
  );
}

function StepRow({
  step,
  isCurrent,
}: {
  step: MissionStep;
  isCurrent: boolean;
}) {
  return (
    <li
      className={`flex items-center gap-3 rounded-lg border px-3 py-2 text-sm ${
        isCurrent
          ? "border-blue-500/60 bg-blue-500/10 text-blue-100"
          : "border-gray-700/60 bg-gray-800/40 text-gray-300"
      }`}
    >
      <span className="w-6 flex-shrink-0 text-center text-xs text-gray-500">
        {step.index + 1}
      </span>
      <span className="w-6 flex-shrink-0 text-center">
        {STEP_ICON[step.status]}
      </span>
      <span className="flex-1 truncate font-medium">
        {step.skill ?? `<${step.type}>`}
      </span>
      {step.retryCount && step.retryCount > 0 ? (
        <span className="flex-shrink-0 text-xs text-yellow-400">
          ↻ {step.retryCount}
        </span>
      ) : null}
      {step.error && step.status === "failed" && (
        <span
          className="max-w-[40%] truncate text-xs text-red-400"
          title={step.error}
        >
          {step.error}
        </span>
      )}
    </li>
  );
}

function formatDate(d: Date | null): string {
  if (!d) return "";
  const ts = d instanceof Date ? d : new Date(d);
  return ts.toLocaleString("ko-KR", {
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}
