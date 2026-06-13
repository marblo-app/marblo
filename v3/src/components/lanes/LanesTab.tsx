import { useEffect, useMemo, useState } from "react";
import { useAuth } from "../../hooks/useAuth";
import { useProjectStore } from "../../stores/projectStore";
import { useEditorStore } from "../../stores/editorStore";
import { useTaskStore } from "../../stores/taskStore";
import { useAgentStore } from "../../stores/agentStore";
import { useSubscriptionStore } from "../../stores/subscriptionStore";
import { useWorktreeStore } from "../../stores/worktreeStore";
import { useTerminalStore } from "../../stores/terminalStore";
import { useAgentSessionMap } from "../../stores/agentSessionMap";
import { useAgentFocusStore } from "../../stores/agentFocusStore";
import * as taskService from "../../services/taskService";
import * as agentService from "../../services/agentService";
import { checkAgentSpawn } from "../../lib/planLimits";
import { buildLaneContextId, isLaneContext } from "../../lib/laneContext";
import { laneStatusPill } from "../../lib/laneStatus";
import type { Agent } from "../../types/agent";
import { LaneCreateModal, type LaneLaunchInput } from "./LaneCreateModal";
import { LaneDeleteConfirmModal } from "./LaneDeleteConfirmModal";
import type { Task } from "../../types/task";
import type { Worktree } from "../../types/worktree";

// 빠른 작업 task 는 규약대로 contextId="lane:<laneId>" 로 태깅된다(lib/laneContext).
// 보드 카드 마킹(좌측 amber 바)은 lib/laneContext.isLaneTask 가, 여기 Lanes 탭
// 리스트는 isLaneContext 로 lane 전용 필터링한다 — 미션 등 다른 컨텍스트가 섞여
// 들어오는 것을 막기 위함. (보드 마킹 semantics 은 의도적으로 안 건드림.)
const isLaneRow = (contextId: string | undefined | null): boolean =>
  isLaneContext(contextId);

const TONE_COLOR: Record<string, string> = {
  danger: "#f38ba8",
  warning: "#f9e2af",
  behind: "#fab387",
  ready: "#a6e3a1",
  idle: "#6c7086",
  done: "#a6e3a1",
  review: "#89b4fa",
  failed: "#f38ba8",
};
const HARNESS_ICON: Record<string, string> = {
  claude: "🟣",
  gpt: "🟢",
  antigravity: "🟠",
  gemini: "🔵",
  local: "⚫",
  custom: "⚪",
};

type LaneRowAction = "delete" | "restart";

interface LaneRow {
  task: Task;
  agent: Agent | null;
  worktree: Worktree | null;
}

function hasWorktreeConflict(worktree: Worktree | null): boolean {
  const status = worktree?.status;
  return Boolean(status && (!status.mergeable || status.conflicts.length > 0));
}

function canDeleteLane(row: LaneRow): boolean {
  return (
    row.task.status === "DONE" ||
    row.task.status === "FAILED" ||
    row.task.status === "BLOCKED" ||
    row.agent?.status === "stopped" ||
    row.agent?.status === "error" ||
    hasWorktreeConflict(row.worktree)
  );
}

function canRestartLane(row: LaneRow): boolean {
  if (!row.agent || row.task.status === "DONE") return false;
  return (
    row.task.status === "FAILED" ||
    row.agent.status === "error" ||
    hasWorktreeConflict(row.worktree)
  );
}

/**
 * "터미널" 버튼 — 이미 실행 중인 lane 에이전트의 PTY 를 연다.
 *
 * attachSession 의 id 는 반드시 진짜 ptySessionId 여야 한다(표시명 X). lane
 * 에이전트의 ptySessionId 는 launch 시점에 agentSessionMap 에 등록되며, 본
 * 컴포넌트가 reactive 셀렉터로 그 매핑을 읽는다. 아직 매핑이 없으면(=세션
 * 미생성/미등록) 잘못된 id 를 넘기는 대신 버튼을 비활성화한다. AgentStatusCard /
 * TaskDetailModal 이 쓰는 패턴과 동일.
 */
function LaneTerminalButton({ agent }: { agent: Agent }) {
  // agentSessionMap 에 launch 시 등록된 진짜 ptySessionId. 미등록이면 undefined
  // (store 의 deterministic "agent-${id}" fallback 은 의도적으로 우회 — 죽은
  // 채널을 attach 하지 않기 위함).
  const ptySessionId = useAgentSessionMap((s) => s.map[agent.id]);
  // 실제로 attach 가능한 세션이 이 윈도우에 존재하는지(=라이브 PTY) 교차 확인.
  const hasLiveSession = useTerminalStore((s) =>
    ptySessionId ? s.sessions.some((sess) => sess.id === ptySessionId) : false,
  );
  const canOpen = Boolean(ptySessionId);

  const label = `${HARNESS_ICON[agent.model] ?? "⚪"} ${agent.name}`;

  return (
    <button
      type="button"
      disabled={!canOpen}
      title={
        canOpen
          ? hasLiveSession
            ? "터미널 보기"
            : "세션에 연결"
          : "실행 중인 세션이 없습니다"
      }
      onClick={() => {
        if (!ptySessionId) return;
        useTerminalStore.getState().openTerminalForSession(ptySessionId, label);
        useAgentFocusStore.getState().setFocusedAgent(agent.id);
      }}
      className="rounded bg-gray-700 px-2 py-0.5 text-[11px] text-gray-200 hover:bg-gray-600 disabled:cursor-not-allowed disabled:opacity-40"
    >
      터미널
      {canOpen && !hasLiveSession && (
        <span className="ml-1 text-[10px] text-gray-400">(연결)</span>
      )}
    </button>
  );
}

export function LanesTab() {
  const { user } = useAuth();
  const currentProject = useProjectStore((s) => s.currentProject);
  const projectId = currentProject?.id;
  const rootPath = useEditorStore((s) => s.rootPath);

  const tasks = useTaskStore((s) => s.tasks);
  const subscribeTasks = useTaskStore((s) => s.subscribeToTasks);
  const agents = useAgentStore((s) => s.agents);
  const subscribeAgents = useAgentStore((s) => s.subscribeToAgents);
  const worktrees = useWorktreeStore((s) => s.worktrees);
  const refreshWorktrees = useWorktreeStore((s) => s.refresh);
  const removeWorktree = useWorktreeStore((s) => s.remove);
  const restartAgent = useAgentStore((s) => s.restartAgent);

  const [showCreate, setShowCreate] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<LaneRow | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState<{
    taskId: string;
    action: LaneRowAction;
  } | null>(null);

  useEffect(() => {
    if (!projectId) return;
    const u1 = subscribeTasks(projectId);
    const u2 = subscribeAgents(projectId);
    refreshWorktrees().catch(() => {});
    return () => {
      u1?.();
      u2?.();
    };
  }, [projectId, subscribeTasks, subscribeAgents, refreshWorktrees]);

  const laneRows = useMemo(() => {
    const lanes = tasks.filter((task) => isLaneRow(task.contextId));
    return lanes.map((task) => {
      const agent = agents.find((a) => a.currentTaskId === task.id) ?? null;
      const worktree = worktrees.find((w) => w.taskId === task.id) ?? null;
      return { task, agent, worktree };
    });
  }, [tasks, agents, worktrees]);

  const launchLane = async ({ title, model, command }: LaneLaunchInput) => {
    if (!user || !projectId) {
      setError("프로젝트를 먼저 선택하세요.");
      throw new Error("no project");
    }
    setError(null);
    // 격리의 핵심 전제: 워크트리는 repo 루트(cwd)에서만 만들어진다. rootPath 가
    // 비면 worktreeCoordinator.prepare 가 조용히 plain cwd 로 폴백해 격리가 깨지므로,
    // 레인을 만들기 전에 막고 사용자에게 알린다 (orphan 태스크도 방지).
    if (!rootPath) {
      setError(
        "프로젝트 폴더 경로가 없어 격리 워크트리를 만들 수 없습니다. 사이드바에서 프로젝트 폴더를 먼저 여세요.",
      );
      throw new Error("no repo root");
    }
    // 플랜 동시 실행 한도 게이트: 이 핸들러는 agentStore.spawnAgent 를 우회해
    // agentService.createAgent + electronAPI.agent.launch 를 직접 호출하므로
    // (AgentsTab.handleLaunch 와 동일 사정) 여기서 checkAgentSpawn 을 재검사한다.
    // 진실의 원천은 lib/planLimits.ts. task/agent doc 생성 전에 막아 orphan 방지.
    const plan = useSubscriptionStore.getState().getPlan();
    const spawnCheck = checkAgentSpawn(plan, agents);
    if (!spawnCheck.allowed) {
      setError(spawnCheck.reason ?? "에이전트 동시 실행 한도에 도달했습니다.");
      throw new Error("agent limit reached");
    }
    // 레인마다 구별되는 contextId 를 규약("lane:<laneId>")대로 부여한다. task 생성
    // 전에 laneId 가 필요하므로(contextId 는 생성 payload 에 들어간다) 여기서 미리
    // 고유 id 를 만든다. 과거의 "lane" 단일 리터럴(B1)은 미션으로 오분류돼 보드
    // 마킹이 깨졌었다 — 이제 buildLaneContextId 로 통일.
    const laneId = crypto.randomUUID();
    const taskId = await taskService.createTask({
      projectId,
      contextId: buildLaneContextId(laneId),
      title,
      description: "",
      status: "TODO",
      role: "backend",
      priority: 3,
      dependsOn: [],
      dependsOnCompleted: true,
      claimedBy: null,
      claimedAt: null,
      scope: [],
      comment: "quick-lane",
      prUrl: "",
      hasPmFeedback: false,
    });
    const agentData = {
      projectId,
      ownerId: user.uid,
      name: title.length > 36 ? `${title.slice(0, 33)}…` : title,
      model,
      role: "backend",
      status: "idle" as const,
      currentTaskId: taskId,
      command,
      skillFile: "",
    };
    const agentId = await agentService.createAgent(agentData);
    const agent = { ...agentData, id: agentId, createdAt: new Date() } as Agent;
    const prompt = `빠른 개선 작업입니다: ${title}\n\n이 워크트리(독립 브랜치) 안에서 변경하고 완료되면 커밋하세요. 다른 작업과 격리돼 있습니다.`;
    const result = await window.electronAPI.agent.launch(
      agent,
      rootPath,
      prompt,
      undefined,
      projectId,
      taskId,
    );
    // launch 가 돌려준 진짜 ptySessionId 를 매핑에 박아 둔다 — lane row 의
    // "터미널" 버튼이 이걸 reactive 로 읽어 활성화된다.
    useAgentSessionMap.getState().set(agentId, result.ptySessionId);
    useTerminalStore
      .getState()
      .attachSession(
        result.ptySessionId,
        `${HARNESS_ICON[model] ?? "⚪"} ${agentData.name}`,
      );
    refreshWorktrees().catch(() => {});
  };

  // cleanup 은 agent.stop → removeWorktree → agent.remove/deleteAgent →
  // deleteTask → sessionMap.remove 순서로 진행된다. 프로세스 정리 계열
  // (stop/remove)의 실패는 비치명 — 이미 죽은 프로세스일 수 있으므로 경고만
  // 남기고 계속 간다. 반면 영구 기록 계열(removeWorktree/deleteAgent/
  // deleteTask)의 실패는 치명 — 여기서 멈춰야 row 가 목록에 남아 같은 버튼으로
  // 재시도할 수 있다 (이미 끝난 단계는 재시도 시 no-op 이거나 skip 된다).
  const performDelete = async (row: LaneRow) => {
    setBusy({ taskId: row.task.id, action: "delete" });
    setError(null);
    setMessage(null);

    const describe = (err: unknown) =>
      err instanceof Error ? err.message : String(err);
    const completed: string[] = [];
    const warnings: string[] = [];
    const failFatal = (step: string, err: unknown) => {
      const lines = [
        `레인 삭제가 "${step}" 단계에서 중단되었습니다: ${describe(err)}`,
      ];
      if (completed.length > 0)
        lines.push(`완료된 단계: ${completed.join(", ")}`);
      if (warnings.length > 0) lines.push(`경고: ${warnings.join(" / ")}`);
      lines.push(
        "항목이 목록에 남아 있으니 문제 해결 후 '삭제'로 재시도할 수 있습니다.",
      );
      setError(lines.join("\n"));
    };

    try {
      if (row.agent) {
        try {
          await window.electronAPI.agent.stop(row.agent.id);
          completed.push("에이전트 중지");
        } catch (err) {
          warnings.push(
            `에이전트 중지 실패(이미 종료됐을 수 있음): ${describe(err)}`,
          );
        }
      }
      if (row.worktree) {
        try {
          await removeWorktree(row.worktree.repoRoot, row.worktree.path, true);
          completed.push("워크트리/브랜치 제거");
        } catch (err) {
          failFatal("워크트리/브랜치 제거", err);
          return;
        }
      }
      if (row.agent) {
        try {
          await window.electronAPI.agent.remove(row.agent.id);
        } catch (err) {
          warnings.push(`에이전트 프로세스 정리 실패: ${describe(err)}`);
        }
        try {
          await agentService.deleteAgent(row.agent.id);
          completed.push("에이전트 기록 삭제");
        } catch (err) {
          failFatal("에이전트 기록 삭제", err);
          return;
        }
      }
      try {
        await taskService.deleteTask(row.task.id);
        completed.push("태스크 기록 삭제");
      } catch (err) {
        failFatal("태스크 기록 삭제", err);
        return;
      }
      if (row.agent) {
        useAgentSessionMap.getState().remove(row.agent.id);
      }
      setMessage(`"${row.task.title}" 레인 항목을 삭제했습니다.`);
      if (warnings.length > 0) {
        setError(`경고(삭제는 완료됨): ${warnings.join(" / ")}`);
      }
    } finally {
      setBusy(null);
      // 치명 실패로 중단된 경우에도 워크트리 목록을 동기화해 둔다 — 재시도
      // 시 이미 제거된 워크트리 단계가 정확히 skip 되도록.
      refreshWorktrees().catch(() => {});
    }
  };

  const restartLane = async (row: LaneRow) => {
    if (!row.agent) {
      setError("재시작할 에이전트가 없습니다.");
      return;
    }

    setBusy({ taskId: row.task.id, action: "restart" });
    setError(null);
    setMessage(null);
    try {
      if (row.task.status !== "IN_PROGRESS") {
        await taskService.updateTaskStatus(row.task.id, "IN_PROGRESS");
      }
      await restartAgent(row.agent.id);
      useAgentSessionMap.getState().set(row.agent.id, `agent-${row.agent.id}`);
      setMessage(`"${row.task.title}" 레인 항목을 다시 시작했습니다.`);
      refreshWorktrees().catch(() => {});
    } catch (err) {
      setError(err instanceof Error ? err.message : "레인 항목 재시작 실패");
    } finally {
      setBusy(null);
    }
  };

  if (!projectId) {
    return (
      <div className="flex h-full items-center justify-center p-6 text-sm text-gray-400">
        프로젝트를 선택하면 빠른 작업을 시작할 수 있습니다.
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col gap-3 p-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-sm font-semibold text-gray-200">Lanes</h2>
          <p className="text-xs text-gray-500">
            메인 작업과 병렬로 — 떠오른 개선점을 독립 워크트리에서 빠르게
          </p>
        </div>
        <button
          onClick={() => setShowCreate(true)}
          className="rounded bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-500"
        >
          ＋ 빠른 작업
        </button>
      </div>

      {error && (
        <div className="whitespace-pre-line rounded border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-300">
          {error}
        </div>
      )}
      {message && (
        <div className="rounded border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-xs text-emerald-300">
          {message}
        </div>
      )}

      {laneRows.length === 0 ? (
        <div className="flex flex-1 items-center justify-center rounded-xl border border-dashed border-gray-700 bg-gray-800/30 p-6 text-center">
          <div>
            <p className="text-sm text-gray-300">
              진행 중인 빠른 작업이 없습니다.
            </p>
            <p className="mt-1 text-xs text-gray-500">
              “＋ 빠른 작업”으로 개선점을 격리된 워크트리에서 시작하세요.
            </p>
          </div>
        </div>
      ) : (
        <div className="flex-1 space-y-1.5 overflow-y-auto">
          {laneRows.map(({ task, agent, worktree }) => {
            const row = { task, agent, worktree };
            // 레인 상태 pill 의 단일 진실의 원천. worktree git 상태만 보던
            // 과거 statusPill 과 달리, 연결된 task 의 터미널 상태를 반영해
            // 완료된 레인이 "작업중"으로 남아 멈춘 것처럼 보이는 오탐을 없앤다.
            const pill = laneStatusPill(task, worktree);
            const st = worktree?.status;
            const busyAction = busy?.taskId === task.id ? busy.action : null;
            const showRestart = canRestartLane(row);
            const showDelete = canDeleteLane(row);
            return (
              <div
                key={task.id}
                className="rounded-lg border border-gray-700/50 bg-gray-800 p-3"
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-sm">
                        {HARNESS_ICON[agent?.model ?? ""] ?? "⚪"}
                      </span>
                      <span className="truncate text-sm font-medium text-gray-200">
                        {task.title}
                      </span>
                    </div>
                    <div className="mt-0.5 flex flex-wrap items-center gap-x-3 text-xs text-gray-400">
                      {worktree ? (
                        <span className="font-mono text-gray-500">
                          {worktree.branch}
                        </span>
                      ) : (
                        <span className="text-gray-600">워크트리 준비 중…</span>
                      )}
                      {st && (
                        <span>
                          ▲{st.ahead} ▼{st.behind} · +{st.insertions}/−
                          {st.deletions}
                        </span>
                      )}
                      <span className="text-gray-500">{task.status}</span>
                    </div>
                  </div>
                  {pill && (
                    <span
                      className="flex flex-shrink-0 items-center gap-1 text-xs font-medium"
                      style={{ color: TONE_COLOR[pill.tone] ?? "#cdd6f4" }}
                    >
                      <span aria-hidden>{pill.icon}</span>
                      {pill.label}
                    </span>
                  )}
                </div>
                {(agent || showRestart || showDelete) && (
                  <div className="mt-2 flex flex-wrap items-center gap-1.5">
                    {agent && <LaneTerminalButton agent={agent} />}
                    {showRestart && (
                      <button
                        type="button"
                        disabled={busyAction !== null}
                        title="충돌/실패 상태의 레인 항목을 다시 시작"
                        onClick={() => restartLane(row)}
                        className="rounded border border-amber-500/40 px-2 py-0.5 text-[11px] text-amber-300 transition hover:bg-amber-500/10 disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        {busyAction === "restart" ? "재시작 중…" : "재시작"}
                      </button>
                    )}
                    {showDelete && (
                      <button
                        type="button"
                        disabled={busyAction !== null}
                        title="완료/중단/충돌/실패 레인 항목 삭제"
                        onClick={() => setDeleteTarget(row)}
                        className="rounded border border-red-500/40 px-2 py-0.5 text-[11px] text-red-300 transition hover:bg-red-500/10 disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        {busyAction === "delete" ? "삭제 중…" : "삭제"}
                      </button>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {showCreate && (
        <LaneCreateModal
          onCancel={() => setShowCreate(false)}
          onLaunch={launchLane}
        />
      )}

      {deleteTarget && (
        <LaneDeleteConfirmModal
          title={deleteTarget.task.title}
          branch={deleteTarget.worktree?.branch ?? null}
          hasAgent={Boolean(deleteTarget.agent)}
          hasWorktree={Boolean(deleteTarget.worktree)}
          onCancel={() => setDeleteTarget(null)}
          onConfirm={() => {
            const row = deleteTarget;
            setDeleteTarget(null);
            void performDelete(row);
          }}
        />
      )}
    </div>
  );
}
