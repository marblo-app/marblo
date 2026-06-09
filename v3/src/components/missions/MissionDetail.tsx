import { useEffect, useMemo, useState } from "react";
import type {
  Mission,
  MissionStep,
  MissionStepStatus,
} from "../../types/mission";
import type { Task, TaskStatus } from "../../types/task";
import type { Agent } from "../../types/agent";
import { MissionStatusBadge } from "./MissionStatusBadge";
import { MissionTimeline } from "./MissionTimeline";
import { TEMPLATE_META } from "./templates";
import { useTaskStore } from "../../stores/taskStore";
import { useAgentStore } from "../../stores/agentStore";
import { useTerminalStore } from "../../stores/terminalStore";
import { useAgentSessionMap } from "../../stores/agentSessionMap";
import { useAgentFocusStore } from "../../stores/agentFocusStore";

interface MissionDetailProps {
  mission: Mission;
  onPause: (id: string) => void;
  onResume: (id: string) => void;
  onAbandon: (id: string) => void;
  /** 같은 goal + template 로 새 미션 생성. abandoned / completed 미션에서 호출. */
  onRestart: (mission: Mission) => void;
  /** 미션 문서 영구 삭제. */
  onDelete: (id: string) => void;
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
  onRestart,
  onDelete,
}: MissionDetailProps) {
  const meta = TEMPLATE_META[mission.templateId];

  // 미션 task 는 보드(KanbanBoard)에도 contextId=missionId 로 섞여 표시되지만
  // (TaskCard 의 🎯 카드), 미션탭은 보드 task 를 구독하지 않으므로 여기서 직접
  // 구독한다. agents 구독은 하단 AgentListPanel 도 하지만, 미션탭만 떠 있을 때를
  // 위해 LanesTab 과 동일하게 함께 구독해 둔다(같은 쿼리라 멱등).
  const subscribeToTasks = useTaskStore((s) => s.subscribeToTasks);
  const subscribeToAgents = useAgentStore((s) => s.subscribeToAgents);
  const allTasks = useTaskStore((s) => s.tasks);
  const agents = useAgentStore((s) => s.agents);

  useEffect(() => {
    if (!mission.projectId) return;
    const u1 = subscribeToTasks(mission.projectId);
    const u2 = subscribeToAgents(mission.projectId);
    return () => {
      u1?.();
      u2?.();
    };
  }, [mission.projectId, subscribeToTasks, subscribeToAgents]);

  // 이 미션의 task 들 — dispatcher 가 contextId=missionId 로 태깅한다.
  const missionTasks = useMemo(
    () => allTasks.filter((t) => t.contextId === mission.id),
    [allTasks, mission.id],
  );

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
            {isTerminal && (
              <button
                onClick={() => onRestart(mission)}
                title="같은 목표 + 템플릿으로 새 미션 시작"
                className="rounded-lg border border-blue-500/50 bg-blue-500/10 px-3 py-1.5 text-xs font-medium text-blue-300 transition-colors hover:bg-blue-500/20"
              >
                🔄 다시 실행
              </button>
            )}
            <button
              onClick={() => {
                const msg = isTerminal
                  ? "이 미션 기록을 영구 삭제할까요? 되돌릴 수 없습니다."
                  : "진행 중인 미션입니다. 영구 삭제하면 기록이 사라지고, 진행 중 task/agent 는 자동 정리되지 않을 수 있어요(먼저 🛑 Abandon 권장). 그래도 삭제할까요?";
                if (confirm(msg)) onDelete(mission.id);
              }}
              title="미션 영구 삭제"
              className="rounded-lg border border-gray-600 bg-gray-700/40 px-3 py-1.5 text-xs font-medium text-gray-300 transition-colors hover:border-red-500/40 hover:bg-red-500/15 hover:text-red-300"
            >
              🗑️ 삭제
            </button>
          </div>
        </div>
        {needsAttention &&
          (() => {
            // Timeline 에 user.decision (kind=pty_input_required) 가 있으면 그 정보로 카드 채움.
            const inputReq = [...mission.contextLog]
              .reverse()
              .find(
                (e) =>
                  e.type === "user.decision" &&
                  (e.payload as { kind?: unknown })?.kind ===
                    "pty_input_required",
              );
            const inputPayload = inputReq?.payload as
              | { skill?: string; question?: string; stepIndex?: number }
              | undefined;
            return (
              <div className="mt-3 rounded-lg border border-yellow-500/40 bg-yellow-500/10 p-3 text-sm text-yellow-200">
                <div className="font-medium">
                  {inputPayload
                    ? "🙋 사용자 입력이 필요합니다."
                    : "개입이 필요합니다."}
                </div>
                <div className="mt-0.5 text-xs text-yellow-200/80">
                  {inputPayload
                    ? `Step ${(inputPayload.stepIndex ?? 0) + 1} (${
                        inputPayload.skill ?? ""
                      }) 가 멈췄습니다 — 미션 Orchestrator PTY 에서 직접 답하고 Resume 을 누르세요.`
                    : failedStep
                      ? `Step ${failedStep.index + 1} (${
                          failedStep.skill ?? failedStep.type
                        }) 실패 · ${failedStep.error ?? "unknown"}`
                      : "마지막 step 결과를 확인하고 Resume 또는 Abandon 을 선택하세요."}
                </div>
                {inputPayload?.question && (
                  <div className="mt-2 rounded border border-yellow-500/30 bg-black/30 px-2 py-1 font-mono text-[11px] text-yellow-100/90">
                    {inputPayload.question}
                  </div>
                )}
              </div>
            );
          })()}
      </header>

      <section>
        <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-gray-500">
          Steps · {Math.min(mission.currentStepIndex + 1, mission.steps.length)}{" "}
          / {mission.steps.length}
        </h3>
        <StepperBar
          steps={mission.steps}
          currentStepIndex={mission.currentStepIndex}
          isTerminal={isTerminal}
        />
        <ol className="mt-3 space-y-1.5">
          {mission.steps.map((step, i) => (
            <StepRow
              key={i}
              step={step}
              isCurrent={i === mission.currentStepIndex && !isTerminal}
            />
          ))}
        </ol>
      </section>

      <MissionTasksSection tasks={missionTasks} agents={agents} />

      <MissionReportSection mission={mission} />

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

// agentStore / TaskCard 의 MODEL_ICONS 와 동일 (harness 표식 중복 패턴).
const MODEL_ICONS: Record<string, string> = {
  claude: "🟣",
  gemini: "🔵",
  gpt: "🟢",
  antigravity: "🟠",
  local: "⚫",
  custom: "⚪",
};

const TASK_STATUS_TONE: Record<TaskStatus, string> = {
  TODO: "text-gray-400",
  CLAIMED: "text-blue-300",
  IN_PROGRESS: "text-blue-200",
  REVIEW: "text-purple-300",
  BLOCKED: "text-orange-300",
  FAILED: "text-red-300",
  DONE: "text-emerald-300",
};

function MissionTasksSection({
  tasks,
  agents,
}: {
  tasks: Task[];
  agents: Agent[];
}) {
  // 미션 task 는 보드에도 🎯 카드로 뜨지만, 미션 상세에서도 같은 task 를 모아
  // 각 담당 에이전트의 PTY 로 바로 점프할 수 있게 한다. dispatch 스텝 전이라
  // task 가 아직 없으면 안내만 노출(= 보드에 안 보이는 것도 같은 이유).
  return (
    <section>
      <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-gray-500">
        작업 · {tasks.length}
      </h3>
      {tasks.length === 0 ? (
        <div className="rounded-lg border border-dashed border-gray-700/60 bg-gray-800/30 px-3 py-3 text-xs text-gray-500">
          아직 디스패치된 작업이 없습니다. dispatch 스텝이 실행되면 여기와 칸반
          보드에 미션 작업(🎯)이 나타납니다.
        </div>
      ) : (
        <ul className="space-y-1.5">
          {tasks.map((task) => (
            <MissionTaskRow key={task.id} task={task} agents={agents} />
          ))}
        </ul>
      )}
    </section>
  );
}

/**
 * 미션 task 한 줄 + "🖥️ 에이전트 PTY" 버튼.
 *
 * 동작은 레인 터미널 fix(ab49b54) 와 동일: 담당 에이전트의 진짜 ptySessionId 로
 * 세션을 열고, useAgentFocusStore.setFocusedAgent 로 하단 AgentListPanel 의
 * FocusView 를 그 에이전트 PTY 로 전환한다.
 *
 * claimedBy 는 두 경로로 저장된다 — MCP claim_task(=agent.id) / 수동 할당
 * (=agent.name). TaskCard 와 동일하게 양쪽을 매칭하고, PTY 매핑/포커스는 항상
 * agent.id 를 키로 쓴다. ptySessionId 가 agentSessionMap 에 아직 없으면(세션
 * 미생성/미등록) 죽은 fallback 채널을 attach 하지 않도록 버튼을 비활성화한다.
 */
function MissionTaskRow({ task, agents }: { task: Task; agents: Agent[] }) {
  const claimingAgent = task.claimedBy
    ? agents.find((a) => a.id === task.claimedBy || a.name === task.claimedBy)
    : undefined;
  const agentId = claimingAgent?.id;
  const ptySessionId = useAgentSessionMap((s) =>
    agentId ? s.map[agentId] : undefined,
  );
  const hasLiveSession = useTerminalStore((s) =>
    ptySessionId ? s.sessions.some((sess) => sess.id === ptySessionId) : false,
  );
  const canOpen = Boolean(agentId && ptySessionId);
  const modelIcon = claimingAgent
    ? (MODEL_ICONS[claimingAgent.model] ?? "⚪")
    : "📋";
  const label = claimingAgent
    ? `${MODEL_ICONS[claimingAgent.model] ?? "⚪"} ${claimingAgent.name}`
    : task.title;

  return (
    <li className="flex items-center gap-2 rounded-lg border border-gray-700/60 bg-gray-800/40 px-3 py-2">
      <span className="flex-shrink-0 text-sm" aria-hidden>
        {modelIcon}
      </span>
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-medium text-gray-200">
          {task.title}
        </div>
        <div className="mt-0.5 flex items-center gap-2 text-[11px]">
          <span className={TASK_STATUS_TONE[task.status] ?? "text-gray-400"}>
            {task.status}
          </span>
          <span className="truncate text-gray-500">
            {claimingAgent
              ? `👤 ${claimingAgent.name}`
              : task.claimedBy
                ? `👤 ${task.claimedBy}`
                : "미할당"}
          </span>
        </div>
      </div>
      <button
        type="button"
        disabled={!canOpen}
        title={
          canOpen
            ? hasLiveSession
              ? "이 작업의 에이전트 PTY 보기"
              : "에이전트 세션에 연결"
            : claimingAgent
              ? "실행 중인 PTY 세션이 없습니다"
              : "담당 에이전트가 아직 없습니다"
        }
        onClick={() => {
          if (!agentId || !ptySessionId) return;
          useTerminalStore
            .getState()
            .openTerminalForSession(ptySessionId, label);
          useAgentFocusStore.getState().setFocusedAgent(agentId);
        }}
        className="flex-shrink-0 rounded bg-gray-700 px-2 py-1 text-[11px] text-gray-200 hover:bg-gray-600 disabled:cursor-not-allowed disabled:opacity-40"
      >
        🖥️ 에이전트 PTY
        {canOpen && !hasLiveSession && (
          <span className="ml-1 text-[10px] text-gray-400">(연결)</span>
        )}
      </button>
    </li>
  );
}

function MissionReportSection({ mission }: { mission: Mission }) {
  // 종합 결과 — completed/waiting_for_human/abandoned 미션에서 각 step 출력을 묶어 보여줌.
  // active/sleeping/planning 미션은 step 카드 펼침으로 충분.
  const shouldShow =
    mission.status === "completed" ||
    mission.status === "waiting_for_human" ||
    mission.status === "abandoned";
  if (!shouldShow) return null;

  const stepsWithOutput = mission.steps.filter(
    (s) => typeof s.output === "string" && (s.output as string).length > 0,
  );
  const finalNote = [...mission.contextLog]
    .reverse()
    .find(
      (e) =>
        e.type === "supervisor.note" &&
        typeof (e.payload as { message?: unknown }).message === "string" &&
        (e.payload as { message?: string }).message !== "Mission queued",
    );

  if (stepsWithOutput.length === 0 && !finalNote) return null;

  const headerLabel =
    mission.status === "completed"
      ? "📋 미션 결과"
      : mission.status === "waiting_for_human"
        ? "⚠️ 현재까지의 진행 결과"
        : "🛑 중단된 미션 — 그동안의 결과";

  const synthesisPayload = finalNote?.payload as
    | { synthesisPath?: string | null; synthesisExcerpt?: string | null }
    | undefined;
  const synthesisPath = synthesisPayload?.synthesisPath ?? null;
  const synthesisExcerpt = synthesisPayload?.synthesisExcerpt ?? null;

  return (
    <section className="rounded-xl border border-gray-700 bg-gray-800/40">
      <div className="border-b border-gray-700 px-4 py-3">
        <h3 className="text-sm font-semibold text-gray-200">{headerLabel}</h3>
        {finalNote && (
          <p className="mt-1 text-xs text-gray-400">
            {String((finalNote.payload as { message?: string }).message ?? "")}
          </p>
        )}
      </div>
      {(synthesisPath || synthesisExcerpt) && (
        <details
          open
          className="border-b border-gray-700/60 bg-blue-500/5 px-4 py-3"
        >
          <summary className="flex cursor-pointer items-center gap-2 text-sm font-medium text-blue-200 marker:hidden">
            <span>📑</span>
            <span className="flex-1 truncate">종합 보고서</span>
            {synthesisPath && (
              <code className="rounded bg-blue-500/10 px-2 py-0.5 text-[10px] text-blue-300">
                {synthesisPath}
              </code>
            )}
          </summary>
          {synthesisExcerpt && (
            <pre className="mt-2 max-h-[28rem] overflow-y-auto rounded-lg bg-black/40 px-3 py-2 font-mono text-[11px] leading-relaxed text-gray-200 whitespace-pre-wrap break-words">
              {synthesisExcerpt}
            </pre>
          )}
        </details>
      )}
      <div className="divide-y divide-gray-700/60">
        {stepsWithOutput.map((step) => (
          <details
            key={step.index}
            open={step.status !== "success" || stepsWithOutput.length <= 2}
            className="group px-4 py-3"
          >
            <summary className="flex cursor-pointer items-center gap-2 text-sm font-medium text-gray-200 marker:hidden">
              <span className="text-base">{STEP_ICON[step.status]}</span>
              <span className="flex-1 truncate">
                Step {step.index + 1} · {step.skill ?? `<${step.type}>`}
              </span>
              <span className="text-xs text-gray-500 group-open:hidden">
                펼치기
              </span>
              <span className="hidden text-xs text-gray-500 group-open:inline">
                접기
              </span>
            </summary>
            <pre className="mt-2 max-h-96 overflow-y-auto rounded-lg bg-black/40 px-3 py-2 font-mono text-[11px] leading-relaxed text-gray-300 whitespace-pre-wrap break-words">
              {String(step.output)}
            </pre>
          </details>
        ))}
        {stepsWithOutput.length === 0 && (
          <div className="px-4 py-3 text-xs text-gray-500 italic">
            출력이 저장된 step 이 없습니다.
          </div>
        )}
      </div>
    </section>
  );
}

function StepRow({
  step,
  isCurrent,
}: {
  step: MissionStep;
  isCurrent: boolean;
}) {
  const isRunning = step.status === "running";
  const isTerminal =
    step.status === "success" ||
    step.status === "failed" ||
    step.status === "skipped";
  // terminal step 은 output 유무와 상관없이 토글 노출 — 비어있으면 "출력 없음" 안내.
  const canExpand = isTerminal;
  const outputText =
    typeof step.output === "string" ? (step.output as string) : "";
  const [expanded, setExpanded] = useState(false);
  // running 이면 라이브 패널을 기본 펼침. terminal step 은 사용자가 클릭해야 펼침.
  const showPanel = isRunning || expanded;

  return (
    <li
      className={`rounded-lg border ${
        isCurrent
          ? "border-blue-500/60 bg-blue-500/10"
          : "border-gray-700/60 bg-gray-800/40"
      }`}
    >
      <div
        className={`flex items-center gap-3 px-3 py-2 text-sm ${
          isCurrent ? "text-blue-100" : "text-gray-300"
        } ${canExpand ? "cursor-pointer" : ""}`}
        onClick={() => canExpand && setExpanded((v) => !v)}
      >
        <span className="w-6 flex-shrink-0 text-center text-xs text-gray-500">
          {step.index + 1}
        </span>
        <span
          className={`w-6 flex-shrink-0 text-center ${
            isRunning ? "animate-pulse" : ""
          }`}
        >
          {STEP_ICON[step.status]}
        </span>
        <span className="flex-1 truncate font-medium">
          {step.skill ?? `<${step.type}>`}
        </span>
        {isRunning && step.startedAt && (
          <ElapsedTime startedAt={step.startedAt} />
        )}
        {step.retryCount && step.retryCount > 0 ? (
          <span className="flex-shrink-0 text-xs text-yellow-400">
            ↻ {step.retryCount}
          </span>
        ) : null}
        {step.error && step.status === "failed" && (
          <span
            className="max-w-[35%] truncate text-xs text-red-400"
            title={step.error}
          >
            {step.error}
          </span>
        )}
        {canExpand && (
          <span className="flex-shrink-0 text-xs text-gray-500">
            {expanded ? "▾" : "▸"} 출력 ({outputText.length}자)
          </span>
        )}
      </div>
      {showPanel && (
        <StepOutputPanel
          live={isRunning ? step.liveOutput : undefined}
          finalText={isTerminal ? outputText : undefined}
          isRunning={isRunning}
        />
      )}
    </li>
  );
}

function StepperBar({
  steps,
  currentStepIndex,
  isTerminal,
}: {
  steps: MissionStep[];
  currentStepIndex: number;
  isTerminal: boolean;
}) {
  if (steps.length === 0) return null;
  return (
    <div className="rounded-lg border border-gray-700/60 bg-gray-900/40 px-3 py-2.5">
      <div className="relative flex items-center">
        {/* 베이스 라인 */}
        <div className="absolute left-3 right-3 top-1/2 h-px -translate-y-1/2 bg-gray-700" />
        {/* 진행률 라인 — 완료된 step 까지 채워짐 */}
        <div
          className="absolute left-3 top-1/2 h-px -translate-y-1/2 bg-gradient-to-r from-emerald-500/70 to-blue-500/70 transition-all duration-500"
          style={{
            width: `calc(${
              (Math.min(currentStepIndex, steps.length) / steps.length) * 100
            }% - 0.75rem)`,
          }}
        />
        {steps.map((step, i) => {
          const isDone = step.status === "success" || step.status === "skipped";
          const isFailed = step.status === "failed";
          const isCurrent = i === currentStepIndex && !isTerminal;
          const isRunning = step.status === "running";
          return (
            <div
              key={i}
              className="relative z-10 flex flex-1 flex-col items-center gap-1.5"
              title={step.skill ?? `<${step.type}>`}
            >
              <div className="relative">
                <div
                  className={`flex h-5 w-5 items-center justify-center rounded-full border-2 text-[10px] font-semibold transition-all ${
                    isFailed
                      ? "border-red-500 bg-red-500 text-white"
                      : isDone
                        ? "border-emerald-500 bg-emerald-500 text-gray-900"
                        : isCurrent || isRunning
                          ? "border-blue-400 bg-blue-500 text-white"
                          : "border-gray-600 bg-gray-800 text-gray-500"
                  }`}
                >
                  {isFailed ? "!" : isDone ? "✓" : isRunning ? "" : i + 1}
                </div>
                {/* 현재 step ping 애니메이션 */}
                {(isCurrent || isRunning) && (
                  <span className="absolute inset-0 -m-1 animate-ping rounded-full border-2 border-blue-400 opacity-50" />
                )}
              </div>
              <span
                className={`max-w-[80px] truncate text-[10px] ${
                  isCurrent || isRunning
                    ? "font-semibold text-blue-200"
                    : isDone
                      ? "text-gray-400"
                      : "text-gray-600"
                }`}
              >
                {step.skill?.replace(/^\//, "") ?? step.type}
              </span>
            </div>
          );
        })}
      </div>
      {/* shimmer line 흐르는 효과 — running step 동안만 */}
      {!isTerminal && steps[currentStepIndex]?.status === "running" && (
        <div className="mt-2 h-px overflow-hidden">
          <div className="h-full w-1/3 animate-pulse bg-gradient-to-r from-transparent via-blue-400/70 to-transparent" />
        </div>
      )}
    </div>
  );
}

function StepOutputPanel({
  live,
  finalText,
  isRunning,
}: {
  live?: string;
  finalText?: string;
  isRunning: boolean;
}) {
  const text = live ?? finalText ?? "";
  if (!text) {
    return (
      <div className="border-t border-gray-700/40 px-3 py-2 text-xs text-gray-500 italic">
        {isRunning ? "출력 대기 중... (2초 간격으로 갱신)" : "출력이 없습니다."}
      </div>
    );
  }
  // 마지막 N줄만 보여줘 스크롤 길이 통제. 사용자는 expand 로 전체 확인.
  return (
    <pre className="max-h-64 overflow-y-auto border-t border-gray-700/40 bg-black/40 px-3 py-2 font-mono text-[11px] leading-relaxed text-gray-300 whitespace-pre-wrap break-words">
      {text}
    </pre>
  );
}

function ElapsedTime({ startedAt }: { startedAt: Date }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  const startedTs =
    startedAt instanceof Date ? startedAt.getTime() : Number(startedAt);
  const elapsedSec = Math.max(0, Math.floor((now - startedTs) / 1000));
  const min = Math.floor(elapsedSec / 60);
  const sec = elapsedSec % 60;
  return (
    <span className="flex-shrink-0 text-xs tabular-nums text-blue-300/80">
      {min > 0 ? `${min}분 ` : ""}
      {sec}초
    </span>
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
