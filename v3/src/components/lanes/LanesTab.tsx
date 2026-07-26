import { useEffect, useMemo, useState } from "react";
import { useAuth } from "../../hooks/useAuth";
import { useProjectStore } from "../../stores/projectStore";
import { useEditorStore } from "../../stores/editorStore";
import { useTaskStore } from "../../stores/taskStore";
import { useAgentStore } from "../../stores/agentStore";
import { useSubscriptionStore } from "../../stores/subscriptionStore";
import { useUiStore } from "../../stores/uiStore";
import { useWorktreeStore } from "../../stores/worktreeStore";
import { useTerminalStore } from "../../stores/terminalStore";
import { useAgentSessionMap } from "../../stores/agentSessionMap";
import { useAgentFocusStore } from "../../stores/agentFocusStore";
import * as taskService from "../../services/taskService";
import * as agentService from "../../services/agentService";
import { checkAgentSpawn } from "../../lib/planLimits";
import { buildLaneContextId, isLaneContext } from "../../lib/laneContext";
import { laneStatusPill } from "../../lib/laneStatus";
import {
  buildModelPin,
  describeSelection,
  type QuickLaneSelection,
} from "../../lib/quickLaneModel";
import {
  spawnedModelLabel,
  spawnedModelTitle,
} from "../../lib/spawnedModelLabel";
import type { Agent } from "../../types/agent";
import type { ModelType } from "../../types/agent";
import { LaneCreateModal, type LaneLaunchInput } from "./LaneCreateModal";
import { LaneDeleteConfirmModal } from "./LaneDeleteConfirmModal";
import type { Task } from "../../types/task";
import type { Worktree } from "../../types/worktree";
import { useTranslation } from "../../lib/i18n";

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
  grok: "⚡",
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

/**
 * 아직 보드/에이전트 스토어에 나타나기 전의 레인 — **낙관적 카드**.
 *
 * 왜 필요한가: "시작" 을 누르고 나서 티켓 doc 생성 → 에이전트 doc 생성 → 워크트리
 * 준비 → PTY 스폰 이 끝나고 Firestore 구독이 그 문서를 되돌려줄 때까지 화면에는
 * **아무 일도 일어나지 않는다**. 병렬로 세 개를 띄우려는 사용자에게 그 공백은
 * "안 눌렸나?" 로 읽히고, 실제로 중복 클릭을 유발한다. 그래서 누른 즉시 카드가
 * 서고, 그 카드가 자기 단계(티켓 생성 → 스폰 → 워크트리)를 스스로 보고한다.
 *
 * 실패해도 카드는 남는다 — 사유를 그 자리에 적어야 어떤 레인이 왜 실패했는지
 * 알 수 있다(배너 하나에 몰아넣으면 병렬 상황에서 누구 얘긴지 알 수 없다).
 */
type PendingPhase = "creating" | "spawning" | "failed";

interface PendingLane {
  id: string;
  title: string;
  selection: QuickLaneSelection;
  phase: PendingPhase;
  /** 티켓이 만들어진 뒤 채워진다 — 진짜 레인 행이 나타나면 이 카드를 걷는다. */
  taskId?: string;
  error?: string;
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
  const { t } = useTranslation();
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
            ? t("lanes.terminal.view")
            : t("lanes.terminal.connect")
          : t("lanes.terminal.noSession")
      }
      onClick={() => {
        if (!ptySessionId) return;
        useTerminalStore.getState().openTerminalForSession(ptySessionId, label);
        useAgentFocusStore.getState().setFocusedAgent(agent.id);
      }}
      className="rounded bg-gray-700 px-2 py-0.5 text-[11px] text-gray-200 hover:bg-gray-600 disabled:cursor-not-allowed disabled:opacity-40"
    >
      {t("lanes.terminal.label")}
      {canOpen && !hasLiveSession && (
        <span className="ml-1 text-[10px] text-gray-400">
          {t("lanes.terminal.connectBadge")}
        </span>
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
  const { t } = useTranslation();

  const [showCreate, setShowCreate] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<LaneRow | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [pending, setPending] = useState<PendingLane[]>([]);
  const [busy, setBusy] = useState<{
    taskId: string;
    action: LaneRowAction;
  } | null>(null);

  const patchPending = (id: string, patch: Partial<PendingLane>) =>
    setPending((prev) =>
      prev.map((p) => (p.id === id ? { ...p, ...patch } : p)),
    );

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

  /** 실제 레인 행이 아직 안 나타난 진행중 카드만 그린다(중복 방지). */
  const activePending = useMemo(
    () =>
      pending.filter(
        (p) =>
          p.phase !== "failed" &&
          !(p.taskId && laneRows.some((r) => r.task.id === p.taskId)),
      ),
    [pending, laneRows],
  );
  const failedPending = useMemo(
    () => pending.filter((p) => p.phase === "failed"),
    [pending],
  );

  // 행이 나타난 진행중 카드는 상태에서도 걷어낸다 — 안 걷으면 배열이 세션 내내
  // 자라고, activePending 이 매번 그 전부를 다시 훑는다.
  useEffect(() => {
    setPending((prev) => {
      const next = prev.filter(
        (p) =>
          p.phase === "failed" ||
          !(p.taskId && laneRows.some((r) => r.task.id === p.taskId)),
      );
      return next.length === prev.length ? prev : next;
    });
  }, [laneRows]);

  const dismissPending = (id: string) =>
    setPending((prev) => prev.filter((p) => p.id !== id));

  /**
   * "지금 동시에 굴러가는" 레인 수 — 아직 터미널 상태가 아닌 레인 행 + 비행 중인
   * 낙관적 카드. 완료/실패/차단된 레인은 목록에 남아도 병렬도에 포함되지 않는다.
   */
  const runningCount = useMemo(
    () =>
      laneRows.filter(
        (r) => !["DONE", "FAILED", "BLOCKED"].includes(r.task.status),
      ).length + activePending.length,
    [laneRows, activePending],
  );

  /**
   * 레인 하나를 띄운다 — **fire-and-forget**.
   *
   * 종전엔 `await` 하는 async 핸들러였고 모달이 그 프라미스를 기다렸다. 그래서
   * 레인 생성이 직렬화됐다: 첫 레인의 워크트리 준비 + PTY 스폰이 끝나야 두 번째
   * 레인을 시작할 수 있었다. 병렬이 이 탭의 존재 이유인데 정작 **입구가** 병렬이
   * 아니었던 셈이다. 이제 모달은 즉시 닫히고, 진행 상황은 각 레인의 낙관적
   * 카드가 자기 몫만 보고한다 — 서로를 기다리지 않는다.
   *
   * 실패는 던지지 않고 그 레인의 카드에 남긴다. 병렬 상황에서 배너 하나에
   * 몰아넣으면 "어느 레인이 실패했는지" 를 알 수 없다.
   */
  const launchLane = ({ title, selection }: LaneLaunchInput) => {
    const pendingId = crypto.randomUUID();
    setPending((prev) => [
      ...prev,
      { id: pendingId, title, selection, phase: "creating" },
    ]);
    void runLaneLaunch(pendingId, title, selection);
  };

  const runLaneLaunch = async (
    pendingId: string,
    title: string,
    selection: QuickLaneSelection,
  ) => {
    const fail = (reason: string) =>
      patchPending(pendingId, { phase: "failed", error: reason });

    if (!user || !projectId) return fail(t("lanes.error.noProject"));
    // 격리의 핵심 전제: 워크트리는 repo 루트(cwd)에서만 만들어진다. rootPath 가
    // 비면 worktreeCoordinator.prepare 가 조용히 plain cwd 로 폴백해 격리가 깨지므로,
    // 레인을 만들기 전에 막고 사용자에게 알린다 (orphan 태스크도 방지).
    if (!rootPath) return fail(t("lanes.error.noRepoRoot"));

    // 플랜 동시 실행 한도 게이트: 이 핸들러는 agentStore.spawnAgent 를 우회해
    // agentService.createAgent + electronAPI.agent.launch 를 직접 호출하므로
    // (AgentsTab.handleLaunch 와 동일 사정) 여기서 checkAgentSpawn 을 재검사한다.
    // 진실의 원천은 lib/planLimits.ts. task/agent doc 생성 전에 막아 orphan 방지.
    //
    // ★비행 중인 레인도 슬롯을 센다. 이제 여러 레인이 동시에 뜰 수 있는데
    // `agents` 는 Firestore 왕복 뒤에야 갱신되므로, 한도가 1 남았을 때 세 개를
    // 연속으로 누르면 세 개가 전부 게이트를 통과해 버린다(모두 같은 stale 카운트를
    // 읽는다). 아직 doc 이 없는 pending 을 활성 에이전트로 세어 그 창을 닫는다.
    const inFlight = pending.filter((p) => p.phase !== "failed").length;
    const plan = useSubscriptionStore.getState().getPlan();
    const spawnCheck = checkAgentSpawn(plan, [
      ...agents,
      ...Array.from({ length: inFlight }, () => ({ status: "idle" }) as Agent),
    ]);
    if (!spawnCheck.allowed) {
      // Free hit the fair-use agent cap → also open the upgrade modal
      // (routes to Settings → Billing).
      useUiStore.getState().showUpgrade("agents", "pro");
      return fail(spawnCheck.reason ?? t("lanes.error.agentLimit"));
    }

    try {
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
      patchPending(pendingId, { taskId, phase: "spawning" });

      const agentData = {
        projectId,
        ownerId: user.uid,
        name: title.length > 36 ? `${title.slice(0, 33)}…` : title,
        // 에이전트 doc 의 `model` 은 **하네스**(스폰할 바이너리)다. 구체 모델은
        // 별도 축(spawnedModel)이고, 아래 launch 가 실제로 뜬 값을 돌려준다.
        model: selection.harness as ModelType,
        role: "backend",
        status: "idle" as const,
        currentTaskId: taskId,
        command: selection.command,
        skillFile: "",
      };
      const agentId = await agentService.createAgent(agentData);
      const agent = {
        ...agentData,
        id: agentId,
        createdAt: new Date(),
      } as Agent;
      const prompt = `빠른 개선 작업입니다: ${title}\n\n이 워크트리(독립 브랜치) 안에서 변경하고 완료되면 커밋하세요. 다른 작업과 격리돼 있습니다.`;
      const result = await window.electronAPI.agent.launch(
        agent,
        rootPath,
        prompt,
        undefined,
        projectId,
        taskId,
        // ★구체 모델 핀. main 이 dispatch_task 와 같은 resolveModelPin 으로 풀어
        // claude/codex/native 축에 맞는 CLI 인자로 바꾼다.
        buildModelPin(selection),
      );

      // CLI 미설치/미로그인이면 main 이 PTY 를 만들기 전에 막고 needsAuth 를
      // 돌려준다. 그 경우 ptySessionId 는 빈 문자열이라 매핑에 박으면 안 된다.
      if (result?.needsAuth) {
        return fail(
          t("lanes.error.needsAuth", {
            model: result.needsAuth.model,
            action: result.needsAuth.action,
          }),
        );
      }

      // launch 가 돌려준 진짜 ptySessionId 를 매핑에 박아 둔다 — lane row 의
      // "터미널" 버튼이 이걸 reactive 로 읽어 활성화된다.
      useAgentSessionMap.getState().set(agentId, result.ptySessionId);
      // 실제로 뜬 구체 모델 스탬프(핀 없는 launch 면 no-op). 이 값이 레인 카드의
      // 모델 배지(#605)가 되고, 요청값이 아니라 **서빙된 값**이라 버전가드 폴백도
      // 그대로 드러난다.
      agentService.stampSpawnedModel(agentId, result?.spawnedModel);
      // ★attachSession 이 아니라 openTerminalForSession — 탭을 붙이는 데 그치지
      // 않고 활성 탭으로 세우고 터미널 영역에 포커스를 보낸다. "티켓을 만들면
      // 곧바로 터미널이 열려 작업이 시작되는" 흐름이 이 한 줄에 달려 있다.
      useTerminalStore
        .getState()
        .openTerminalForSession(
          result.ptySessionId,
          `${HARNESS_ICON[selection.harness] ?? "⚪"} ${agentData.name}`,
        );
      refreshWorktrees().catch(() => {});
    } catch (err) {
      fail(err instanceof Error ? err.message : String(err));
    }
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
        t("lanes.delete.fatalStep", { step, error: describe(err) }),
      ];
      if (completed.length > 0)
        lines.push(
          t("lanes.delete.completedSteps", { steps: completed.join(", ") }),
        );
      if (warnings.length > 0)
        lines.push(
          t("lanes.delete.warningsLine", { warnings: warnings.join(" / ") }),
        );
      lines.push(t("lanes.delete.retryHint"));
      setError(lines.join("\n"));
    };

    try {
      if (row.agent) {
        try {
          await window.electronAPI.agent.stop(row.agent.id);
          completed.push(t("lanes.delete.step.stopAgent"));
        } catch (err) {
          warnings.push(
            t("lanes.delete.warn.stopAgent", { error: describe(err) }),
          );
        }
      }
      if (row.worktree) {
        try {
          await removeWorktree(row.worktree.repoRoot, row.worktree.path, true);
          completed.push(t("lanes.delete.step.removeWorktree"));
        } catch (err) {
          failFatal(t("lanes.delete.step.removeWorktree"), err);
          return;
        }
      }
      if (row.agent) {
        try {
          await window.electronAPI.agent.remove(row.agent.id);
        } catch (err) {
          warnings.push(
            t("lanes.delete.warn.removeAgentProc", { error: describe(err) }),
          );
        }
        try {
          await agentService.deleteAgent(row.agent.id);
          completed.push(t("lanes.delete.step.deleteAgent"));
        } catch (err) {
          failFatal(t("lanes.delete.step.deleteAgent"), err);
          return;
        }
      }
      try {
        await taskService.deleteTask(row.task.id);
        completed.push(t("lanes.delete.step.deleteTask"));
      } catch (err) {
        failFatal(t("lanes.delete.step.deleteTask"), err);
        return;
      }
      if (row.agent) {
        useAgentSessionMap.getState().remove(row.agent.id);
      }
      setMessage(t("lanes.msg.deleted", { title: row.task.title }));
      if (warnings.length > 0) {
        setError(
          t("lanes.msg.deletedWithWarnings", {
            warnings: warnings.join(" / "),
          }),
        );
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
      setError(t("lanes.error.noAgentToRestart"));
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
      setMessage(t("lanes.msg.restarted", { title: row.task.title }));
      refreshWorktrees().catch(() => {});
    } catch (err) {
      setError(
        err instanceof Error ? err.message : t("lanes.error.restartFailed"),
      );
    } finally {
      setBusy(null);
    }
  };

  if (!projectId) {
    return (
      <div className="flex h-full items-center justify-center p-6 text-sm text-gray-400">
        {t("lanes.noProjectPlaceholder")}
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col gap-3 p-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-sm font-semibold text-gray-200">
            {t("lanes.header.title")}
          </h2>
          <p className="text-xs text-gray-500">{t("lanes.header.subtitle")}</p>
        </div>
        <div className="flex items-center gap-2">
          {/* 병렬 실행 카운터 — 여러 레인이 동시에 돈다는 사실을 숫자로 못박는다.
              (카드가 여러 장 보이는 것과 별개로, 그중 몇 개가 "지금 굴러가는
              중"인지는 카드만 봐서는 세어야 알 수 있다.) */}
          {runningCount > 0 && (
            <span className="rounded-full border border-emerald-500/40 bg-emerald-500/10 px-2 py-0.5 text-[11px] font-medium text-emerald-300">
              {t("lanes.header.runningCount", { count: String(runningCount) })}
            </span>
          )}
          <button
            onClick={() => setShowCreate(true)}
            className="rounded bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-500"
          >
            {t("lanes.newButton")}
          </button>
        </div>
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

      {/* 실패한 레인 시도 — 티켓이 생기기 전에 죽은 것도 있으므로 목록 카드로는
          표현할 수 없다. 각자 자기 사유를 달고 서고, 사용자가 개별로 닫는다. */}
      {failedPending.length > 0 && (
        <div className="space-y-1.5">
          {failedPending.map((p) => (
            <div
              key={p.id}
              className="flex items-start justify-between gap-2 rounded border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-300"
            >
              <div className="min-w-0">
                <div className="truncate font-medium">{p.title}</div>
                <div className="mt-0.5 whitespace-pre-line text-red-300/80">
                  {p.error}
                </div>
              </div>
              <button
                type="button"
                onClick={() => dismissPending(p.id)}
                className="flex-shrink-0 rounded px-1.5 text-red-300/70 hover:text-red-200"
                aria-label={t("lanes.pending.dismiss")}
              >
                ✕
              </button>
            </div>
          ))}
        </div>
      )}

      {laneRows.length === 0 && activePending.length === 0 ? (
        <div className="flex flex-1 items-center justify-center rounded-xl border border-dashed border-gray-700 bg-gray-800/30 p-6 text-center">
          <div>
            <p className="text-sm text-gray-300">{t("lanes.empty.title")}</p>
            <p className="mt-1 text-xs text-gray-500">
              {t("lanes.empty.hint")}
            </p>
          </div>
        </div>
      ) : (
        // ★한 줄 리스트가 아니라 카드 그리드다. 병렬로 도는 레인들이 세로로
        // 한 줄씩 쌓이면 "큐" 처럼 읽히고, 나란히 서면 "동시에 도는 것들" 로
        // 읽힌다. 좁은 폭(터미널 컬럼이 넓을 때)에서는 자연히 1열로 접힌다.
        <div className="grid flex-1 auto-rows-min grid-cols-1 gap-2 overflow-y-auto md:grid-cols-2 2xl:grid-cols-3">
          {/* 낙관적 카드: 누른 즉시 여기 선다(티켓 doc 이 돌아오기 전). */}
          {activePending.map((p) => (
            <div
              key={p.id}
              className="animate-pulse rounded-lg border border-blue-500/40 bg-gray-800 p-3"
            >
              <div className="flex items-center gap-2">
                <span className="text-sm">
                  {HARNESS_ICON[p.selection.harness] ?? "⚪"}
                </span>
                <span className="truncate text-sm font-medium text-gray-200">
                  {p.title}
                </span>
              </div>
              <div className="mt-1 flex flex-wrap items-center gap-x-2 text-xs text-gray-400">
                <span className="font-mono text-gray-500">
                  {describeSelection(p.selection)}
                </span>
                <span className="text-blue-300">
                  {p.phase === "creating"
                    ? t("lanes.pending.creating")
                    : t("lanes.pending.spawning")}
                </span>
              </div>
            </div>
          ))}
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
                    {/* #605 구체 모델 배지 — 스탬프가 있을 때만. 없으면(핀 없는
                        스폰·구 doc) 왼쪽 하네스 아이콘만 남는 종전 표시로
                        자연스럽게 되돌아간다. 값은 요청이 아니라 argv 를 되읽은
                        **서빙된 모델**이라, 버전가드 폴백도 여기서 드러난다. */}
                    {agent && spawnedModelLabel(agent.spawnedModel) && (
                      <div className="mt-1">
                        <span
                          className="inline-block max-w-full truncate rounded border border-[#45475a] bg-[#181825] px-1.5 py-0.5 font-mono text-[10px] text-[#a6adc8]"
                          title={spawnedModelTitle(
                            spawnedModelLabel(agent.spawnedModel) as string,
                            agent.model,
                          )}
                        >
                          {spawnedModelLabel(agent.spawnedModel)}
                        </span>
                      </div>
                    )}
                    <div className="mt-0.5 flex flex-wrap items-center gap-x-3 text-xs text-gray-400">
                      {worktree ? (
                        <span className="font-mono text-gray-500">
                          {worktree.branch}
                        </span>
                      ) : (
                        <span className="text-gray-600">
                          {t("lanes.row.worktreePreparing")}
                        </span>
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
                        title={t("lanes.row.restartTip")}
                        onClick={() => restartLane(row)}
                        className="rounded border border-amber-500/40 px-2 py-0.5 text-[11px] text-amber-300 transition hover:bg-amber-500/10 disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        {busyAction === "restart"
                          ? t("lanes.row.restarting")
                          : t("lanes.row.restart")}
                      </button>
                    )}
                    {showDelete && (
                      <button
                        type="button"
                        disabled={busyAction !== null}
                        title={t("lanes.row.deleteTip")}
                        onClick={() => setDeleteTarget(row)}
                        className="rounded border border-red-500/40 px-2 py-0.5 text-[11px] text-red-300 transition hover:bg-red-500/10 disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        {busyAction === "delete"
                          ? t("lanes.row.deleting")
                          : t("lanes.row.delete")}
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
