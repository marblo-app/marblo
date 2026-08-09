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
import { useNavigationStore } from "../../stores/navigationStore";
import * as taskService from "../../services/taskService";
import * as agentService from "../../services/agentService";
import * as missionService from "../../services/missionService";
import { checkAgentSpawn } from "../../lib/planLimits";
import { buildLaneContextId, isLaneContext } from "../../lib/laneContext";
import { laneStatusPill } from "../../lib/laneStatus";
import { groupLaneRows, laneGroupDef } from "../../lib/laneGroups";
import { harnessIcon, laneToneColor } from "../../lib/laneVisuals";
import { findTaskWorktree } from "../../lib/taskWorktree";
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
import type { Mission } from "../../types/mission";
import type { TaskStatus } from "../../types/task";
import { MissionStatusBadge } from "../missions/MissionStatusBadge";
import { templateMeta } from "../missions/templates";
import { LaneCreateModal, type LaneLaunchInput } from "./LaneCreateModal";
import { LaneDeleteConfirmModal } from "./LaneDeleteConfirmModal";
import { LaneDetailDrawer } from "./LaneDetailDrawer";
import { LaneTerminalButton } from "./LaneTerminalButton";
import type { LaneRow } from "../../types/lane";
import type { Worktree } from "../../types/worktree";
import { useTranslation } from "../../lib/i18n";
import { reportOnrampExecBlocked } from "../../services/onrampBlockSignal";

// 빠른 작업 task 는 규약대로 contextId="lane:<laneId>" 로 태깅된다(lib/laneContext).
// 보드 카드 마킹(좌측 amber 바)은 lib/laneContext.isLaneTask 가, 여기 Lanes 탭
// 리스트는 isLaneContext 로 lane 전용 필터링한다 — 미션 등 다른 컨텍스트가 섞여
// 들어오는 것을 막기 위함. (보드 마킹 semantics 은 의도적으로 안 건드림.)
const isLaneRow = (contextId: string | undefined | null): boolean =>
  isLaneContext(contextId);

type LaneRowAction = "delete" | "restart";

const TASK_STATUS_ORDER: TaskStatus[] = [
  "TODO",
  "CLAIMED",
  "IN_PROGRESS",
  "REVIEW",
  "BLOCKED",
  "FAILED",
  "DONE",
];

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

interface MissionProgress {
  done: number;
  total: number;
  percent: number;
  label: string;
  statusCounts: Array<{ status: TaskStatus; count: number }>;
}

function missionTitle(mission: Mission): string {
  const raw =
    mission.implicitLabel || templateMeta(mission.templateId)?.label || "";
  return raw ? `${raw}: ${mission.goal}` : mission.goal;
}

function missionProgress(mission: Mission): MissionProgress {
  const rawCounts = mission.projection?.statusCounts ?? {};
  const statusCounts = TASK_STATUS_ORDER.map((status) => ({
    status,
    count: Number(rawCounts[status] ?? 0),
  })).filter((item) => item.count > 0);
  const countedTotal = statusCounts.reduce((sum, item) => sum + item.count, 0);

  if (countedTotal > 0 || mission.taskIds.length > 0) {
    const total = Math.max(countedTotal, mission.taskIds.length);
    const done = Number(rawCounts.DONE ?? 0);
    const percent = total > 0 ? Math.round((done / total) * 100) : 0;
    return {
      done,
      total,
      percent,
      label: `${done}/${total} tasks`,
      statusCounts,
    };
  }

  const total = mission.steps.length;
  const done = mission.steps.filter(
    (step) => step.status === "success" || step.status === "skipped",
  ).length;
  const percent = total > 0 ? Math.round((done / total) * 100) : 0;
  return {
    done,
    total,
    percent,
    label: total > 0 ? `${done}/${total} steps` : "No dispatched tasks",
    statusCounts: [],
  };
}

function missionTaskModelLabels(
  mission: Mission,
  agents: readonly Agent[],
): string[] {
  const taskIds = new Set(mission.taskIds);
  const labels = agents
    .filter((agent) => agent.currentTaskId && taskIds.has(agent.currentTaskId))
    .map((agent) => spawnedModelLabel(agent.spawnedModel) || agent.model)
    .filter((label): label is string => Boolean(label));
  return Array.from(new Set(labels)).slice(0, 3);
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
  const requestJump = useNavigationStore((s) => s.requestJump);
  const { t } = useTranslation();

  const [showCreate, setShowCreate] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<LaneRow | null>(null);
  /**
   * 상세 드로우가 열려 있는 레인 — **행 객체가 아니라 taskId 를 들고 있는다.**
   * 행을 스냅샷으로 붙들면 그 순간의 에이전트/워크트리 상태가 드로우 안에서
   * 얼어붙는다(작업이 진행돼도 ahead/behind·상태가 안 움직인다). id 로 들고
   * 매 렌더 laneRows 에서 되찾으면 드로우가 카드와 같은 라이브 데이터를 본다.
   */
  const [detailTaskId, setDetailTaskId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [pending, setPending] = useState<PendingLane[]>([]);
  const [missions, setMissions] = useState<Mission[]>([]);
  const [busy, setBusy] = useState<{
    taskId: string;
    action: LaneRowAction;
  } | null>(null);

  const patchPending = (id: string, patch: Partial<PendingLane>) =>
    setPending((prev) =>
      prev.map((p) => (p.id === id ? { ...p, ...patch } : p)),
    );

  useEffect(() => {
    if (!projectId) {
      setMissions([]);
      return;
    }
    const u1 = subscribeTasks(projectId);
    const u2 = subscribeAgents(projectId);
    const u3 = missionService.subscribeToMissions(projectId, setMissions);
    refreshWorktrees().catch(() => {});
    return () => {
      u1?.();
      u2?.();
      u3?.();
    };
  }, [projectId, subscribeTasks, subscribeAgents, refreshWorktrees]);

  const laneRows: LaneRow[] = useMemo(() => {
    const lanes = tasks.filter((task) => isLaneRow(task.contextId));
    return lanes.map((task) => {
      const agent = agents.find((a) => a.currentTaskId === task.id) ?? null;
      // 보드/티켓 상세와 **같은** 해석기. 종전의 `w.taskId === task.id` 는
      // 워크트리 doc 에 taskId 가 안 찍힌 생성 경로에서 조용히 빗나갔고, 그러면
      // 카드가 영원히 "워크트리 준비 중…" 으로 남는다. findTaskWorktree 는
      // taskId → 경로 → 브랜치 순으로 느슨하게 되짚는다.
      const worktree = findTaskWorktree(worktrees, task);
      return { task, agent, worktree };
    });
  }, [tasks, agents, worktrees]);

  /**
   * 라인(상태 레인)별 묶음. 그룹핑 규칙 자체는 lib/laneGroups 의 순수 함수라
   * 유닛 테스트가 전수로 검증한다.
   */
  const laneGroups = useMemo(() => groupLaneRows(laneRows), [laneRows]);

  const visibleMissions = useMemo(
    () =>
      missions.filter(
        (mission) =>
          mission.status !== "completed" || (mission.taskIds?.length ?? 0) > 0,
      ),
    [missions],
  );

  /** 드로우가 보는 행 — 매 렌더 되찾아 라이브 상태를 따라간다. */
  const detailRow = useMemo(
    () => laneRows.find((r) => r.task.id === detailTaskId) ?? null,
    [laneRows, detailTaskId],
  );

  // 열어 둔 레인이 사라지면(삭제/필터 이탈) 선택도 놓는다 — 안 놓으면 다음에
  // 같은 id 가 살아날 때 드로우가 유령처럼 되살아난다.
  useEffect(() => {
    if (detailTaskId && !detailRow) setDetailTaskId(null);
  }, [detailTaskId, detailRow]);

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

  /**
   * 실제로 그릴 라인들. 비행 중인 낙관적 카드는 "진행 중" 라인에 들어가는데,
   * 그 라인이 아직 비어 있을 수 있다(첫 레인을 방금 눌렀을 때 — 티켓 doc 이
   * 아직 없다). 그때도 헤더가 서야 카드가 라인 밖에 떠 있지 않는다.
   */
  const renderGroups = useMemo(() => {
    if (activePending.length === 0) return laneGroups;
    if (laneGroups.some((g) => g.def.id === "active")) return laneGroups;
    return [{ def: laneGroupDef("active"), rows: [] }, ...laneGroups];
  }, [laneGroups, activePending]);

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
        // 온램프 축 보고(설계 #886 §5-A) — 레인의 인라인 에러는 "무엇이" 를
        // 말하지만 계정이 없는 유저에게 필요한 "그래서 뭘 하면 되나" 는 M1 이
        // 든다. 이미 연결된 유저에게는 스스로 억제된다.
        reportOnrampExecBlocked(result.needsAuth, "spawn_needs_auth");
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
          `${harnessIcon(selection.harness)} ${agentData.name}`,
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
    // relative: 상세 드로우가 이 탭 안쪽 오른쪽에 붙는다(화면 전체를 덮는
    // 모달이 아니라). overflow-hidden 은 드로우가 탭 경계를 넘지 않게 한다.
    <div className="relative flex h-full flex-col gap-3 overflow-hidden p-4">
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

      <div className="flex-1 space-y-5 overflow-y-auto">
        <section>
          <div className="mb-2 flex items-center gap-2">
            <span className="rounded border border-amber-500/30 bg-amber-500/10 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-amber-300">
              {t("lanes.kind.quickLane")}
            </span>
            <h3 className="text-xs font-semibold text-gray-300">
              {t("lanes.section.quickLanes")}
            </h3>
            <span className="h-px flex-1 bg-gray-800" />
          </div>
          {laneRows.length === 0 && activePending.length === 0 ? (
            <div className="flex min-h-[160px] items-center justify-center rounded-lg border border-dashed border-gray-700 bg-gray-800/30 p-6 text-center">
              <div>
                <p className="text-sm text-gray-300">{t("lanes.empty.title")}</p>
                <p className="mt-1 text-xs text-gray-500">
                  {t("lanes.empty.hint")}
                </p>
              </div>
            </div>
          ) : (
        // ★라인(상태 레인)별로 접어 둔다. 라인 안에서는 여전히 **카드 그리드**다:
        // 병렬로 도는 레인들이 세로로 한 줄씩 쌓이면 "큐" 처럼 읽히고, 나란히
        // 서면 "동시에 도는 것들" 로 읽힌다(그 판단은 그대로 유지). 라인이 바꾸는
        // 것은 카드의 배치가 아니라 묶음 — "지금 굴러가는 것"과 "치우면 되는 것"을
        // 카드마다 pill 을 읽어 가려내지 않아도 되게 한다.
        <div className="space-y-4">
          {renderGroups.map(({ def, rows }) => {
            const pendingHere = def.id === "active" ? activePending : [];
            const count = rows.length + pendingHere.length;
            return (
              <section key={def.id}>
                <div className="mb-1.5 flex items-center gap-2">
                  <span
                    aria-hidden
                    className="h-1.5 w-1.5 rounded-full"
                    style={{ backgroundColor: def.dotColor }}
                  />
                  <h3 className="text-xs font-semibold text-gray-300">
                    {t(def.labelKey)}
                  </h3>
                  <span className="text-[11px] text-gray-500">{count}</span>
                  <span className="h-px flex-1 bg-gray-800" />
                </div>
                <div className="grid auto-rows-min grid-cols-1 gap-2 md:grid-cols-2 2xl:grid-cols-3">
                  {/* 낙관적 카드: 누른 즉시 여기 선다(티켓 doc 이 돌아오기 전).
                      아직 티켓이 없어 열어 볼 상세도 없으므로 클릭 대상이 아니다. */}
                  {pendingHere.map((p) => (
                    <div
                      key={p.id}
                      className="animate-pulse rounded-lg border border-blue-500/40 bg-gray-800 p-3"
                    >
                      <div className="flex items-center gap-2">
                        <span className="text-sm">
                          {harnessIcon(p.selection.harness)}
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
                  {rows.map((row) => {
                    const { task, agent, worktree } = row;
                    // 레인 상태 pill 의 단일 진실의 원천. worktree git 상태만 보던
                    // 과거 statusPill 과 달리, 연결된 task 의 터미널 상태를 반영해
                    // 완료된 레인이 "작업중"으로 남아 멈춘 것처럼 보이는 오탐을 없앤다.
                    const pill = laneStatusPill(task, worktree);
                    const st = worktree?.status;
                    const busyAction =
                      busy?.taskId === task.id ? busy.action : null;
                    const showRestart = canRestartLane(row);
                    const showDelete = canDeleteLane(row);
                    const selected = detailTaskId === task.id;
                    return (
                      // ★카드 전체가 클릭 타깃이다. 종전엔 카드 컨테이너에 아예
                      // onClick 이 없어서(pointer-events 문제가 아니라 핸들러 부재)
                      // 안쪽 버튼 말고는 어디를 눌러도 아무 일이 없었다.
                      // <button> 이 아니라 role="button" 인 이유: 카드 안에 이미
                      // 버튼(터미널/재시작/삭제)이 들어 있어 버튼 중첩은 무효
                      // 마크업이 된다. 키보드 접근은 tabIndex + Enter/Space 로 연다.
                      <div
                        key={task.id}
                        role="button"
                        tabIndex={0}
                        aria-label={t("lanes.row.openDetail", {
                          title: task.title,
                        })}
                        title={t("lanes.row.openDetailTip")}
                        onClick={() => setDetailTaskId(task.id)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" || e.key === " ") {
                            e.preventDefault();
                            setDetailTaskId(task.id);
                          }
                        }}
                        className={`cursor-pointer rounded-lg border bg-gray-800 p-3 text-left transition hover:border-gray-500 hover:bg-gray-800/70 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/60 ${
                          selected
                            ? "border-blue-500/60 ring-1 ring-blue-500/30"
                            : "border-gray-700/50"
                        }`}
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0">
                            <div className="flex items-center gap-2">
                              <span className="text-sm">
                                {harnessIcon(agent?.model)}
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
                                    spawnedModelLabel(
                                      agent.spawnedModel,
                                    ) as string,
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
                              <span className="text-gray-500">
                                {task.status}
                              </span>
                            </div>
                          </div>
                          {pill && (
                            <span
                              className="flex flex-shrink-0 items-center gap-1 text-xs font-medium"
                              style={{ color: laneToneColor(pill.tone) }}
                            >
                              <span aria-hidden>{pill.icon}</span>
                              {pill.label}
                            </span>
                          )}
                        </div>
                        {(agent || showRestart || showDelete) && (
                          // ★액션 줄은 카드 클릭에서 떼어 낸다. 안 떼면 "터미널"을
                          // 누를 때 상세 드로우까지 같이 열린다(버블링).
                          <div
                            className="mt-2 flex flex-wrap items-center gap-1.5"
                            onClick={(e) => e.stopPropagation()}
                            onKeyDown={(e) => e.stopPropagation()}
                            role="presentation"
                          >
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
              </section>
            );
          })}
        </div>
          )}
        </section>

        <section data-testid="lanes-missions-section">
          <div className="mb-2 flex items-center gap-2">
            <span className="rounded border border-sky-500/30 bg-sky-500/10 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-sky-300">
              {t("lanes.kind.mission")}
            </span>
            <h3 className="text-xs font-semibold text-gray-300">
              {t("lanes.section.missions")}
            </h3>
            <span className="text-[11px] text-gray-500">
              {visibleMissions.length}
            </span>
            <span className="h-px flex-1 bg-gray-800" />
          </div>

          {visibleMissions.length === 0 ? (
            <div className="rounded-lg border border-dashed border-sky-500/25 bg-sky-500/5 p-5">
              <p className="text-sm font-medium text-gray-200">
                {t("lanes.missions.empty.title")}
              </p>
              <p className="mt-1 max-w-2xl text-xs text-gray-500">
                {t("lanes.missions.empty.hint")}
              </p>
              <button
                type="button"
                onClick={() =>
                  window.dispatchEvent(new CustomEvent("marblo:open-missions"))
                }
                className="mt-3 rounded border border-sky-500/40 px-3 py-1.5 text-xs font-medium text-sky-300 transition hover:bg-sky-500/10"
              >
                {t("lanes.missions.empty.cta")}
              </button>
            </div>
          ) : (
            <div className="space-y-2">
              {visibleMissions.map((mission) => {
                const progress = missionProgress(mission);
                const modelLabels = missionTaskModelLabels(mission, agents);
                const taskCount = mission.taskIds?.length ?? 0;
                return (
                  <div
                    key={mission.id}
                    role="button"
                    tabIndex={0}
                    onClick={() =>
                      requestJump({ type: "mission", missionId: mission.id })
                    }
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        requestJump({
                          type: "mission",
                          missionId: mission.id,
                        });
                      }
                    }}
                    className="cursor-pointer rounded-lg border border-gray-700/60 bg-gray-800/40 p-3 transition hover:border-sky-500/50 hover:bg-gray-800/70 focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-500/60"
                    aria-label={t("lanes.missions.openDetail", {
                      title: mission.goal,
                    })}
                  >
                    <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="truncate text-sm font-medium text-gray-100">
                            {missionTitle(mission)}
                          </span>
                          <MissionStatusBadge status={mission.status} compact />
                        </div>
                        <p className="mt-1 text-xs text-gray-500">
                          {mission.goal}
                        </p>
                        <div className="mt-2 flex flex-wrap items-center gap-1.5">
                          {modelLabels.length > 0 ? (
                            modelLabels.map((label) => (
                              <span
                                key={label}
                                className="rounded border border-[#45475a] bg-[#181825] px-1.5 py-0.5 font-mono text-[10px] text-[#a6adc8]"
                              >
                                {label}
                              </span>
                            ))
                          ) : (
                            <span className="rounded border border-gray-700 bg-gray-900/60 px-1.5 py-0.5 text-[10px] text-gray-500">
                              {t("lanes.missions.model.orchestrator")}
                            </span>
                          )}
                          <span className="text-[11px] text-gray-500">
                            {t("lanes.missions.taskCount", {
                              count: String(taskCount),
                            })}
                          </span>
                        </div>
                      </div>

                      <div className="w-full shrink-0 lg:w-72">
                        <div className="mb-1 flex items-center justify-between text-[11px] text-gray-500">
                          <span>{progress.label}</span>
                          <span>{progress.percent}%</span>
                        </div>
                        <div className="h-1.5 overflow-hidden rounded-full bg-gray-900">
                          <div
                            className="h-full rounded-full bg-sky-400"
                            style={{ width: `${progress.percent}%` }}
                          />
                        </div>
                        {progress.statusCounts.length > 0 && (
                          <div className="mt-1.5 flex flex-wrap gap-1">
                            {progress.statusCounts.map((item) => (
                              <span
                                key={item.status}
                                className="rounded bg-gray-900/70 px-1.5 py-0.5 text-[10px] text-gray-400"
                              >
                                {item.status} {item.count}
                              </span>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </section>
      </div>

      {detailRow && (
        <LaneDetailDrawer
          row={detailRow}
          onClose={() => setDetailTaskId(null)}
        />
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
