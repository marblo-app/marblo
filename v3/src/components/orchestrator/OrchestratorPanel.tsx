import {
  useRef,
  useCallback,
  useState,
  useEffect,
  memo,
  type ChangeEvent,
  type CSSProperties,
} from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "../../lib/i18n";
import type { MessageKey } from "../../locales/ko";
import { placeAnchoredPopup } from "../../lib/anchoredPopup";
import { launchLogin } from "../../services/cliSetupActions";
import {
  planOrchestratorBlockUi,
  orchestratorBlockCopyKeys,
  orchestratorBlockLoginModel,
} from "../../lib/orchestratorLaunchBlock";
import {
  ORCHESTRATOR_MODEL_OPTIONS,
  isOrchestratorModel,
  orchestratorEffortsFor,
  orchestratorModelBase,
  orchestratorModelEffort,
  useOrchestratorStore,
  withOrchestratorEffort,
  type OrchestratorModel,
} from "../../stores/orchestratorStore";
import { useProjectStore } from "../../stores/projectStore";
import { useEditorStore } from "../../stores/editorStore";
import { useTaskStore } from "../../stores/taskStore";
import { upsertOrchestratorAgentDoc } from "../../services/orchestratorAgentDoc";
import { reportOnrampExecBlocked } from "../../services/onrampBlockSignal";
import OrchestratorTerminal from "./OrchestratorTerminal";

const MIN_HEIGHT = 80;
const MAX_HEIGHT = 600;
const COLLAPSED_HEIGHT = 36;
const SWITCH_CLIENT_TIMEOUT_MS = 60_000;

// Default panel height scales with the window — ~1/3 of the viewport gives
// Claude Code's TUI enough rows to render without full-frame redraws, while
// leaving room for the board above. Clamped so it stays sensible on very
// short or very tall displays. (The user can still drag-resize freely.)
const DEFAULT_HEIGHT_RATIO = 0.34;
const DEFAULT_HEIGHT_MIN = 240;
const DEFAULT_HEIGHT_MAX = 420;
function computeDefaultHeight(): number {
  if (typeof window === "undefined") return DEFAULT_HEIGHT_MIN;
  return Math.min(
    DEFAULT_HEIGHT_MAX,
    Math.max(
      DEFAULT_HEIGHT_MIN,
      Math.round(window.innerHeight * DEFAULT_HEIGHT_RATIO),
    ),
  );
}

/**
 * 저장값(`provider[:modelId][@effort]`)을 사람이 읽는 한 줄로. 모델 라벨은 셀렉터
 * 목록에서 가져오고 effort 는 그 뒤에 붙인다 — 지금 오케가 어느 effort 로 도는지
 * 헤더만 보고 알 수 있어야 "왜 이렇게 비싸지" 를 추적할 수 있다.
 */
function describeOrchestratorModel(value: string): string {
  const base = orchestratorModelBase(value);
  // 목록에 없는 값(env·손편집)은 **그 값 그대로** 보여준다. 종전엔 "Claude" 로
  // 접었는데, 그러면 grok 으로 도는 오케가 헤더에선 Claude 라고 말한다.
  const label =
    ORCHESTRATOR_MODEL_OPTIONS.find((m) => m.value === base)?.label ||
    base ||
    "Claude";
  const effort = orchestratorModelEffort(value);
  return effort ? `${label} @${effort}` : label;
}

async function withSwitchClientTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_resolve, reject) => {
        timer = setTimeout(
          () =>
            reject(
              new Error(
                `orchestrator switch timed out after ${timeoutMs}ms in renderer`,
              ),
            ),
          timeoutMs,
        );
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

interface SessionInfo {
  id: string;
  updatedAt: number;
  sizeKB: number;
  label?: string;
  agentId?: string;
}

const SESSION_POPUP_WIDTH = 288; // was w-72
const SWITCH_POPUP_WIDTH = 320; // was w-80
const SESSION_POPUP_EST_HEIGHT = 300;
const SWITCH_POPUP_EST_HEIGHT = 160;

/**
 * Inline style for a popup rendered through a portal.
 *
 * These popups used to be `absolute bottom-full` children of the header, which
 * only worked while the orchestrator was pinned to the BOTTOM of the window
 * (legacy Layout). In the Workspace split shell the panel sits at the TOP of
 * the left terminal column under three `overflow-hidden` ancestors, so an
 * upward popup rendered entirely outside the clip rect — the session picker
 * looked like it had disappeared. Anchoring to the trigger's viewport rect and
 * portaling to <body> makes the popup immune to any ancestor clipping.
 */
function anchoredPopupStyle(
  rect: DOMRect | null,
  width: number,
  estHeight: number,
  align: "left" | "right",
): CSSProperties {
  if (!rect) return { display: "none" };
  return {
    position: "fixed",
    ...placeAnchoredPopup(
      rect,
      { width: window.innerWidth, height: window.innerHeight },
      width,
      estHeight,
      align,
    ),
  };
}

interface OrchestratorPanelProps {
  /**
   * Fill mode (Workspace shell vertical split): the panel stretches to fill its
   * parent flex cell instead of owning a fixed pixel height, and its own top
   * resize handle is suppressed (the shell's divider owns resizing). Default
   * false → legacy fixed-height behavior (pixel-identical to before).
   */
  fill?: boolean;
  /**
   * Beginner shell: hide everything in the header that names or picks a model —
   * the model label, the reasoning-effort select, the harness version badge and
   * the session picker.
   *
   * The beginner screen's whole promise is "there is nothing to configure"; a
   * header reading `Claude Opus 5 @high  v2.1.4  [Sessions ▾]` breaks that
   * promise in one line, and the switch flow behind those selects (take over /
   * switch and wait) is a concept that shell deliberately doesn't teach yet.
   * The PTY, the status dot and Start/Stop stay — those are recovery, not
   * configuration. Default false → pixel-identical to before.
   */
  hideModelControls?: boolean;
}

export default memo(function OrchestratorPanel({
  fill = false,
  hideModelControls = false,
}: OrchestratorPanelProps) {
  const { t } = useTranslation();
  const currentProject = useProjectStore((s) => s.currentProject);
  const rootPath = useEditorStore((s) => s.rootPath);
  // Granular selectors — destructuring useOrchestratorStore() would re-render on every action;
  // per-slice subscriptions only re-render when that slice actually changes.
  const ptySessionId = useOrchestratorStore((s) => s.ptySessionId);
  const status = useOrchestratorStore((s) => s.status);
  const isCollapsed = useOrchestratorStore((s) => s.isCollapsed);
  const toggleCollapsed = useOrchestratorStore((s) => s.toggleCollapsed);
  const setSession = useOrchestratorStore((s) => s.setSession);
  const setStatus = useOrchestratorStore((s) => s.setStatus);
  const clear = useOrchestratorStore((s) => s.clear);
  const selectedModel = useOrchestratorStore((s) => s.selectedModel);
  const runningModel = useOrchestratorStore((s) => s.runningModel);
  const switchStatus = useOrchestratorStore((s) => s.switchStatus);
  const lastHandoffSummary = useOrchestratorStore((s) => s.lastHandoffSummary);
  const setSelectedModel = useOrchestratorStore((s) => s.setSelectedModel);
  const setSwitchStatus = useOrchestratorStore((s) => s.setSwitchStatus);
  const setHandoffSummary = useOrchestratorStore((s) => s.setHandoffSummary);
  const launchBlock = useOrchestratorStore((s) => s.launchBlock);
  const setLaunchBlock = useOrchestratorStore((s) => s.setLaunchBlock);
  // 차단 배너의 문구·CTA 는 순수 규칙이 정한다(kind 별 i18n 키, 로그인 가능 CLI).
  const blockCopy = orchestratorBlockCopyKeys(launchBlock?.kind ?? "auth");
  const blockLoginModel = launchBlock
    ? orchestratorBlockLoginModel(launchBlock)
    : null;
  const tasks = useTaskStore((s) => s.tasks);

  // Resolved Claude Code build that agents actually launch with. Shown in the
  // header so a stale shadowing install (old model list) is immediately visible.
  const [claudeVersion, setClaudeVersion] = useState<string>("");
  useEffect(() => {
    let alive = true;
    window.electronAPI.claude
      .version()
      .then((info) => {
        if (alive) setClaudeVersion(info.version);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);
  const [panelHeight, setPanelHeight] = useState(computeDefaultHeight);
  const [showSessionPicker, setShowSessionPicker] = useState(false);
  const [showSwitchConfirm, setShowSwitchConfirm] = useState(false);
  const [pendingSwitchModel, setPendingSwitchModel] =
    useState<OrchestratorModel | null>(null);
  const [sessions, setSessions] = useState<SessionInfo[]>([]);
  const draggingRef = useRef(false);

  // Trigger rects captured at open time — the portaled popups position against
  // these instead of against a clipped `position: relative` ancestor.
  const sessionBtnRef = useRef<HTMLButtonElement | null>(null);
  const sessionPopupRef = useRef<HTMLDivElement | null>(null);
  const switchAnchorRef = useRef<HTMLDivElement | null>(null);
  const [sessionAnchor, setSessionAnchor] = useState<DOMRect | null>(null);
  const [switchAnchor, setSwitchAnchor] = useState<DOMRect | null>(null);

  useEffect(() => {
    let alive = true;
    // 프로젝트별 모델 우선(재시작 연속성) — 전역값은 다른 프로젝트가 마지막으로
    // 만진 값일 수 있어 셀렉터 표시가 실제 뜰 모델과 어긋난다.
    window.electronAPI.orchestratorModel
      .get(currentProject?.id)
      .then((model) => {
        if (!alive) return;
        setSelectedModel(isOrchestratorModel(model) ? model : "claude");
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [setSelectedModel, currentProject?.id]);

  const handleDragStart = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      draggingRef.current = true;
      const startY = e.clientY;
      const startHeight = panelHeight;

      const onMouseMove = (moveEvent: MouseEvent) => {
        if (!draggingRef.current) return;
        const delta = startY - moveEvent.clientY;
        const newHeight = Math.min(
          MAX_HEIGHT,
          Math.max(MIN_HEIGHT, startHeight + delta),
        );
        setPanelHeight(newHeight);
      };

      const onMouseUp = () => {
        draggingRef.current = false;
        document.removeEventListener("mousemove", onMouseMove);
        document.removeEventListener("mouseup", onMouseUp);
        document.body.style.cursor = "";
        document.body.style.userSelect = "";
      };

      document.addEventListener("mousemove", onMouseMove);
      document.addEventListener("mouseup", onMouseUp);
      document.body.style.cursor = "row-resize";
      document.body.style.userSelect = "none";
    },
    [panelHeight],
  );

  // Close session picker when clicking outside. The popup is portaled to
  // <body>, so it is no longer a DOM descendant of this panel — containment is
  // checked against the popup node itself rather than relying on the click
  // bubbling through the React subtree.
  useEffect(() => {
    if (!showSessionPicker) return;
    const handleClick = (e: MouseEvent) => {
      const target = e.target as Node | null;
      if (target && sessionPopupRef.current?.contains(target)) return;
      setShowSessionPicker(false);
    };
    const close = () => setShowSessionPicker(false);
    const timer = setTimeout(
      () => document.addEventListener("click", handleClick),
      0,
    );
    // A fixed-position popup cannot follow its anchor, so any layout shift
    // (window resize, split-divider drag) dismisses it instead of stranding it.
    window.addEventListener("resize", close);
    return () => {
      clearTimeout(timer);
      document.removeEventListener("click", handleClick);
      window.removeEventListener("resize", close);
    };
  }, [showSessionPicker]);

  // Auto-expand when orchestrator starts running
  const setCollapsed = useOrchestratorStore((s) => s.setCollapsed);
  useEffect(() => {
    if (status === "running" && isCollapsed) {
      setCollapsed(false);
    }
  }, [status, isCollapsed, setCollapsed]);

  // 프로젝트가 없으면 패널 자체를 숨김
  if (!currentProject) return null;

  const isRunning = status === "running" || status === "starting";
  const isSwitching = switchStatus !== "idle" && switchStatus !== "error";
  const height = isCollapsed ? COLLAPSED_HEIGHT : panelHeight;
  const activeTaskCount = tasks.filter((task) =>
    ["CLAIMED", "IN_PROGRESS", "BLOCKED", "REVIEW"].includes(task.status),
  ).length;
  const targetSwitchModel = pendingSwitchModel ?? selectedModel;
  // 셀렉터는 두 축이다: 모델(첫째 드롭다운) + reasoning effort(둘째, codex 변형
  // 에서만 뜬다). 저장·IPC 로 오가는 값은 둘을 합친 compound 하나뿐이다.
  const selectedBase = orchestratorModelBase(selectedModel);
  const selectedEffort = orchestratorModelEffort(selectedModel);
  const effortChoices = orchestratorEffortsFor(selectedModel);

  const handleStartWithSession = async (resumeSessionId?: string) => {
    setShowSessionPicker(false);
    if (isRunning) return;
    const projectId = currentProject.id;
    const cwd = rootPath || "~";
    try {
      setStatus("starting");
      setLaunchBlock(null);
      await window.electronAPI.orchestratorModel.set(selectedModel, projectId);
      // 명시 모델을 launch 에 함께 전달 — main 의 프로젝트별 저장 모델보다
      // 이번 사용자 선택이 우선하게 한다.
      const result = await window.electronAPI.orchestratorSession.launch(
        projectId,
        cwd,
        resumeSessionId,
        selectedModel,
      );
      // Spawn blocked. 배너는 **항상** 세우고, 인증 축이면 위저드를 함께 연다
      // (planOrchestratorBlockUi 주석 — 배타 분기였을 때 위저드가 스스로를 억제한
      // grok 전환이 아무 표시 없이 죽었다).
      if (result?.needsAuth) {
        setStatus("stopped");
        const ui = planOrchestratorBlockUi(result.needsAuth);
        if (ui.showPanelNotice) setLaunchBlock(ui.block);
        if (ui.openCliSetup) {
          window.dispatchEvent(new CustomEvent("marblo:open-cli-setup"));
        }
        // 온램프 축 보고(설계 #886 §5-A) — 아직 연결 안 된 유저에게만 M1 이 뜬다.
        reportOnrampExecBlocked(result.needsAuth, "spawn_needs_auth");
        return;
      }
      if (result) {
        setSession(result.sessionId, result.ptySessionId, selectedModel);
        setStatus("running");

        // Upsert the single canonical orchestrator agent doc (stable ID
        // = orchestrator-<projectId>) so the Activity feed's `agentId in
        // [agents.map(a=>a.id)]` filter passes orchestrator events. Same
        // helper is called from the auto-reconnect hook so both paths
        // converge on one row.
        try {
          await upsertOrchestratorAgentDoc(projectId, "working");
        } catch (err) {
          console.warn("[Orchestrator] virtual agent doc upsert failed:", err);
        }
      }
    } catch (err) {
      console.error("[Orchestrator] Manual launch failed:", err);
      setStatus("error");
    }
  };

  /**
   * 모델 축·effort 축 어느 쪽이 바뀌든 최종 compound 값 하나로 수렴시킨다.
   * 두 드롭다운이 각자 저장·스위치 로직을 복제하지 않게 하려는 것 — effort 만
   * 바꾼 것도 실제로는 오케 재기동이라 모델 변경과 완전히 같은 경로를 타야 한다.
   */
  const applyModelSelection = (next: OrchestratorModel) => {
    setSelectedModel(next);
    if (!isRunning) {
      window.electronAPI.orchestratorModel
        .set(next, currentProject?.id)
        .catch(() => {});
      return;
    }
    if (next === runningModel) return;
    setPendingSwitchModel(next);
    setSwitchAnchor(switchAnchorRef.current?.getBoundingClientRect() ?? null);
    setShowSwitchConfirm(true);
  };

  const handleModelChange = (e: ChangeEvent<HTMLSelectElement>) => {
    e.stopPropagation();
    // 현재 effort 를 새 모델로 이월한다. 새 모델이 그 effort 를 지원하지 않으면
    // withOrchestratorEffort 가 모델 축만 남긴다(무효 compound 를 안 만든다).
    applyModelSelection(withOrchestratorEffort(e.target.value, selectedEffort));
  };

  const handleEffortChange = (e: ChangeEvent<HTMLSelectElement>) => {
    e.stopPropagation();
    applyModelSelection(withOrchestratorEffort(selectedBase, e.target.value));
  };

  const handleCancelSwitch = (e?: React.MouseEvent) => {
    e?.stopPropagation();
    if (runningModel) setSelectedModel(runningModel);
    setPendingSwitchModel(null);
    setShowSwitchConfirm(false);
    setSwitchStatus("idle");
  };

  const handleSwitch = async (
    mode: "wait" | "takeover",
    e?: React.MouseEvent,
  ) => {
    e?.stopPropagation();
    if (!currentProject || !isRunning || isSwitching) {
      console.warn("[Orchestrator] Switch ignored by renderer guard", {
        hasProject: Boolean(currentProject),
        isRunning,
        isSwitching,
        switchStatus,
        mode,
        selectedModel,
        runningModel,
        pendingSwitchModel,
      });
      return;
    }
    const targetModel = targetSwitchModel;
    const projectId = currentProject.id;
    const cwd = rootPath || "~";
    try {
      console.info("[Orchestrator] Switch requested", {
        projectId,
        targetModel,
        mode,
        runningModel,
      });
      setSwitchStatus("snapshotting");
      setShowSwitchConfirm(false);
      const result = await withSwitchClientTimeout(
        window.electronAPI.orchestratorSession.switch({
          projectId,
          rootPath: cwd,
          targetModel,
          mode,
          resume: "fresh",
        }),
        SWITCH_CLIENT_TIMEOUT_MS,
      );
      if (result?.needsAuth) {
        setSwitchStatus("error");
        const ui = planOrchestratorBlockUi(result.needsAuth);
        // setSelectedModel 이 launchBlock 을 비우므로 되돌리기가 먼저다 —
        // 순서가 뒤집히면 방금 세운 안내가 즉시 지워진다.
        if (runningModel) setSelectedModel(runningModel);
        if (ui.showPanelNotice) setLaunchBlock(ui.block);
        if (ui.openCliSetup) {
          window.dispatchEvent(new CustomEvent("marblo:open-cli-setup"));
        }
        reportOnrampExecBlocked(result.needsAuth, "spawn_needs_auth");
        return;
      }
      setSwitchStatus("starting");
      setHandoffSummary(result.handoffSummary);
      setSession(result.sessionId, result.ptySessionId, targetModel);
      setStatus("running");
      setSelectedModel(targetModel);
      setPendingSwitchModel(null);
      await window.electronAPI.orchestratorModel.set(targetModel, projectId);

      try {
        await upsertOrchestratorAgentDoc(projectId, "working");
      } catch (err) {
        console.warn("[Orchestrator] virtual agent doc upsert failed:", err);
      }
    } catch (err) {
      console.error("[Orchestrator] Switch failed:", err);
      setSwitchStatus("error");
      if (runningModel) setSelectedModel(runningModel);
    } finally {
      if (useOrchestratorStore.getState().switchStatus !== "error") {
        setSwitchStatus("idle");
      }
    }
  };

  const handleManualStart = async () => {
    // Reconnect to the prior orchestrator session if one exists. Resolution
    // is by label OR content signature (main process), so it works even when
    // marblo-labels.json is missing — which is why plain label matching kept
    // starting a fresh session on every off/on.
    if (isRunning) return;
    const cwd = rootPath || "~";
    try {
      const priorId =
        await window.electronAPI.orchestratorSession.resolvePrevious(
          cwd,
          currentProject?.id,
        );
      if (priorId) {
        handleStartWithSession(priorId);
        return;
      }
    } catch {
      /* ignore, just start new */
    }
    handleStartWithSession("new");
  };

  const handleShowSessionPicker = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (isRunning) return;
    if (showSessionPicker) {
      setShowSessionPicker(false);
      return;
    }
    // Anchor first so the popup is positioned from the click, not from wherever
    // the header sits once the (async) session list resolves.
    setSessionAnchor(sessionBtnRef.current?.getBoundingClientRect() ?? null);
    setShowSessionPicker(true);
    const cwd = rootPath || "~";
    try {
      const list =
        await window.electronAPI.orchestratorSession.listSessions(cwd);
      setSessions(list);
    } catch {
      setSessions([]);
    }
  };

  const handleStop = async (e: React.MouseEvent) => {
    e.stopPropagation();
    const pid = currentProject?.id;
    try {
      await window.electronAPI.orchestratorSession.stop();
      clear();
      if (pid) {
        try {
          await upsertOrchestratorAgentDoc(pid, "stopped");
        } catch {
          /* best-effort */
        }
      }
    } catch {
      /* ignore */
    }
  };

  return (
    <div
      className={
        fill
          ? "flex h-full min-h-0 flex-col border-t border-[#313244] bg-[#181825]"
          : "flex flex-col flex-shrink-0 border-t border-[#313244] bg-[#181825]"
      }
      style={
        // 차단 배너가 서 있는 동안은 고정 높이를 놓는다. 접힘 높이(36px)는 헤더
        // 한 줄분이라, 고정한 채로 배너를 그리면 안내가 패널 밖으로 삐져나온다.
        fill || launchBlock ? undefined : { height }
      }
    >
      {/* Resize handle — suppressed in fill mode (shell divider owns sizing). */}
      {!isCollapsed && isRunning && !fill && (
        <div
          onMouseDown={handleDragStart}
          className="h-1 flex-shrink-0 cursor-row-resize bg-[#313244] hover:bg-[#89b4fa] transition-colors"
          role="separator"
          aria-orientation="horizontal"
          aria-label="Resize orchestrator panel"
        />
      )}
      {/* Header bar */}
      <div
        onClick={isRunning ? toggleCollapsed : undefined}
        className={`flex flex-wrap items-center gap-x-2 gap-y-1 px-3 py-1.5 text-xs select-none ${
          isRunning ? "cursor-pointer hover:bg-[#313244]/50" : ""
        } transition-colors`}
      >
        {/* Status indicator */}
        <span
          className={`inline-block h-2 w-2 rounded-full ${
            status === "running"
              ? "bg-[#a6e3a1]"
              : status === "starting"
                ? "bg-[#f9e2af] animate-pulse"
                : status === "error"
                  ? "bg-[#f38ba8]"
                  : "bg-[#6c7086]"
          }`}
        />
        <span className="inline-flex items-center gap-1.5 text-[#cdd6f4] font-medium">
          {/* Orchestrator badge — conductor/hub glyph in accent mauve marks this
              panel as the special "conductor" above the neutral agent list. */}
          <span
            className="inline-flex h-[18px] w-[18px] items-center justify-center rounded bg-[#cba6f7]/15 text-[#cba6f7]"
            title="Orchestrator — conducts your agents"
            aria-hidden="true"
          >
            <svg
              width="12"
              height="12"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <circle cx="12" cy="12" r="2.5" />
              <circle cx="5" cy="5" r="2" />
              <circle cx="19" cy="5" r="2" />
              <circle cx="12" cy="20" r="2" />
              <path d="M10.3 10.3 6.5 6.5M13.7 10.3l3.8-3.8M12 14.5V18" />
            </svg>
          </span>
          Orchestrator
        </span>

        {isRunning ? (
          <>
            <span className="text-[#6c7086]">
              {/* 종전엔 라벨 뒤에 " Code" 를 붙였다("Claude Code"). 제품명이
                  맞는 건 claude 뿐이고 codex 도 이미 "Codex Code" 로 어긋나 있었다
                  — 하네스가 넷이 된 지금은 "Grok Code"/"Antigravity Code" 라는
                  없는 제품명을 셋 만든다. 라벨만 그대로 보여준다. */}
              {isSwitching
                ? "Switching..."
                : status === "running"
                  ? hideModelControls
                    ? // 비기너: 모델 이름 자리에 상태만. 빈 문자열로 두면 점 옆이
                      // 휑해서 "안 켜졌나" 로 읽힌다.
                      t("beginner.chat.orchestratorRunning")
                    : describeOrchestratorModel(runningModel ?? selectedModel)
                  : "Starting..."}
            </span>
            {claudeVersion && !hideModelControls && (
              <span
                className="rounded bg-[#313244]/60 px-1.5 py-0.5 font-mono text-[10px] text-[#a6adc8]"
                title={`Agents launch with Claude Code v${claudeVersion}`}
              >
                v{claudeVersion}
              </span>
            )}
            <div
              ref={switchAnchorRef}
              className={`relative ml-1 ${hideModelControls ? "hidden" : ""}`}
              onClick={(e) => e.stopPropagation()}
            >
              <select
                value={selectedBase}
                onChange={handleModelChange}
                disabled={isSwitching}
                className="h-6 rounded border border-[#313244] bg-[#1e1e2e] px-1.5 text-[11px] text-[#cdd6f4] outline-none hover:border-[#89b4fa] disabled:opacity-60"
                title="Switch orchestrator model"
              >
                {ORCHESTRATOR_MODEL_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
              {effortChoices.length > 0 && (
                <select
                  value={selectedEffort}
                  onChange={handleEffortChange}
                  disabled={isSwitching}
                  className="ml-1 h-6 rounded border border-[#313244] bg-[#1e1e2e] px-1.5 text-[11px] text-[#cdd6f4] outline-none hover:border-[#89b4fa] disabled:opacity-60"
                  title="Codex reasoning effort"
                >
                  <option value="">effort: default</option>
                  {effortChoices.map((effort) => (
                    <option key={effort} value={effort}>
                      effort: {effort}
                    </option>
                  ))}
                </select>
              )}
              {showSwitchConfirm &&
                createPortal(
                  <div
                    onClick={(e) => e.stopPropagation()}
                    style={anchoredPopupStyle(
                      switchAnchor,
                      SWITCH_POPUP_WIDTH,
                      SWITCH_POPUP_EST_HEIGHT,
                      "right",
                    )}
                    className="z-[60] overflow-auto rounded-md border border-[#313244] bg-[#1e1e2e] p-3 text-xs shadow-lg"
                  >
                    <div className="mb-1 font-medium text-[#cdd6f4]">
                      Switch orchestrator to{" "}
                      {describeOrchestratorModel(targetSwitchModel)}
                    </div>
                    <div className="mb-3 text-[11px] leading-4 text-[#a6adc8]">
                      Snapshot will include active missions and board work.
                      {activeTaskCount > 0
                        ? ` ${activeTaskCount} active board item(s) detected.`
                        : " No active board item is loaded in this window."}
                      {lastHandoffSummary
                        ? ` Last handoff: ${lastHandoffSummary.activeMissionCount} mission(s), ${lastHandoffSummary.inFlightTaskCount} task(s).`
                        : ""}
                    </div>
                    <div className="flex justify-end gap-2">
                      <button
                        onClick={(e) => handleCancelSwitch(e)}
                        className="rounded px-2 py-1 text-[#a6adc8] hover:bg-[#313244]"
                      >
                        Cancel
                      </button>
                      <button
                        onClick={(e) => handleSwitch("takeover", e)}
                        disabled={isSwitching}
                        className="rounded border border-[#45475a] px-2 py-1 text-[#f9e2af] hover:bg-[#45475a]"
                      >
                        Take over now
                      </button>
                      <button
                        onClick={(e) => handleSwitch("wait", e)}
                        disabled={isSwitching}
                        className="rounded bg-[#89b4fa]/20 px-2 py-1 text-[#89b4fa] hover:bg-[#89b4fa]/30"
                      >
                        Switch and wait
                      </button>
                    </div>
                  </div>,
                  document.body,
                )}
            </div>
            {/* Stop button */}
            <button
              onClick={handleStop}
              disabled={isSwitching}
              className="ml-1 rounded px-1.5 py-0.5 text-[#f38ba8] hover:bg-[#f38ba8]/20 transition-colors"
              title="Stop orchestrator"
            >
              Stop
            </button>
            {/* Collapse chevron */}
            <svg
              className={`ml-auto h-3.5 w-3.5 text-[#6c7086] transition-transform ${
                isCollapsed ? "" : "rotate-180"
              }`}
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M5 15l7-7 7 7"
              />
            </svg>
          </>
        ) : (
          <>
            <span className="text-[#6c7086]">
              {status === "error" ? "Error" : "Stopped"}
            </span>
            {/* Start button + session picker toggle */}
            <div className="relative ml-2 flex items-center gap-1">
              {!hideModelControls && (
                <select
                  value={selectedBase}
                  onClick={(e) => e.stopPropagation()}
                  onChange={handleModelChange}
                  className="h-6 rounded border border-[#313244] bg-[#1e1e2e] px-1.5 text-[11px] text-[#cdd6f4] outline-none hover:border-[#89b4fa]"
                  title="Orchestrator model"
                >
                  {ORCHESTRATOR_MODEL_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              )}
              {!hideModelControls && effortChoices.length > 0 && (
                <select
                  value={selectedEffort}
                  onClick={(e) => e.stopPropagation()}
                  onChange={handleEffortChange}
                  className="h-6 rounded border border-[#313244] bg-[#1e1e2e] px-1.5 text-[11px] text-[#cdd6f4] outline-none hover:border-[#89b4fa]"
                  title="Codex reasoning effort"
                >
                  <option value="">effort: default</option>
                  {effortChoices.map((effort) => (
                    <option key={effort} value={effort}>
                      effort: {effort}
                    </option>
                  ))}
                </select>
              )}
              <button
                onClick={handleManualStart}
                className="rounded bg-[#89b4fa]/20 px-2.5 py-0.5 text-[#89b4fa] hover:bg-[#89b4fa]/30 transition-colors"
              >
                Start
              </button>
              <button
                ref={sessionBtnRef}
                onClick={handleShowSessionPicker}
                aria-haspopup="menu"
                aria-expanded={showSessionPicker}
                className={`flex flex-shrink-0 items-center gap-0.5 rounded px-1.5 py-0.5 transition-colors ${
                  hideModelControls ? "hidden" : ""
                } ${
                  showSessionPicker
                    ? "bg-[#313244] text-[#cdd6f4]"
                    : "bg-[#313244]/50 text-[#a6adc8] hover:bg-[#313244] hover:text-[#cdd6f4]"
                }`}
                title={t("orchestrator.sessionPicker")}
              >
                <span className="text-[10px]">
                  {t("orchestrator.sessionPicker")}
                </span>
                <svg
                  className="h-3.5 w-3.5"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M19 9l-7 7-7-7"
                  />
                </svg>
              </button>
              {showSessionPicker &&
                createPortal(
                  <div
                    ref={sessionPopupRef}
                    role="menu"
                    onClick={(e) => e.stopPropagation()}
                    style={anchoredPopupStyle(
                      sessionAnchor,
                      SESSION_POPUP_WIDTH,
                      SESSION_POPUP_EST_HEIGHT,
                      "left",
                    )}
                    className="z-[60] overflow-auto rounded-md border border-[#313244] bg-[#1e1e2e] shadow-lg"
                  >
                    <div className="px-3 py-1.5 text-[10px] text-[#6c7086] border-b border-[#313244] uppercase tracking-wider">
                      Select Session
                    </div>
                    <button
                      onClick={() => handleStartWithSession("new")}
                      className="w-full text-left px-3 py-2 text-xs text-[#a6e3a1] hover:bg-[#313244]/60 transition-colors flex items-center gap-2"
                    >
                      <span className="text-sm">+</span>
                      New Session
                    </button>
                    {sessions.length > 0 && (
                      <div className="border-t border-[#313244]">
                        {sessions.slice(0, 8).map((s, i) => {
                          const date = new Date(s.updatedAt);
                          const timeStr = date.toLocaleString("ko-KR", {
                            month: "short",
                            day: "numeric",
                            hour: "2-digit",
                            minute: "2-digit",
                          });
                          return (
                            <button
                              key={s.id}
                              onClick={() =>
                                handleStartWithSession(
                                  i === 0 ? "latest" : s.id,
                                )
                              }
                              className="w-full text-left px-3 py-2 text-xs hover:bg-[#313244]/60 transition-colors flex items-center justify-between gap-2"
                            >
                              <span className="text-[#cdd6f4] truncate flex items-center gap-1.5">
                                {i === 0 && (
                                  <span className="text-[#89b4fa] text-[10px]">
                                    latest
                                  </span>
                                )}
                                <span className="text-[#6c7086] font-mono text-[10px]">
                                  {s.label || s.id.slice(0, 8) + "\u2026"}
                                </span>
                              </span>
                              <span className="text-[#6c7086] text-[10px] flex-shrink-0">
                                {timeStr} · {s.sizeKB}KB
                              </span>
                            </button>
                          );
                        })}
                      </div>
                    )}
                  </div>,
                  document.body,
                )}
            </div>
            {!rootPath && (
              <span className="ml-1 text-[10px] text-[#f9e2af]">
                {t("orchestrator.autoStartHint")}
              </span>
            )}
          </>
        )}
      </div>

      {/* 스폰 차단 안내 — **모든** 차단 사유가 여기로 온다(인증·MCP 둘 다).
          접힘 상태여도 보여준다: 이 배너가 안 보이면 사용자는 "Start/전환을
          눌렀는데 아무 일도 안 일어난다" 만 겪는다. 인증 축을 위저드에만 맡겼을
          때 grok 전환이 정확히 그렇게 죽었다(planOrchestratorBlockUi 주석). */}
      {launchBlock && (
        <div
          role="alert"
          data-testid="orchestrator-launch-block"
          data-block-kind={launchBlock.kind}
          className="mx-3 mb-2 rounded border border-[#f9e2af]/40 bg-[#f9e2af]/10 px-3 py-2 text-[11px] leading-4 text-[#f9e2af]"
        >
          <div className="font-medium">
            {t(blockCopy.title as MessageKey, { model: launchBlock.model })}
          </div>
          <div className="mt-1 text-[#f5e0dc]">{launchBlock.action}</div>
          <div className="mt-1 text-[10px] text-[#a6adc8]">
            {t(blockCopy.hint as MessageKey)}
          </div>
          <div className="mt-2 flex items-center gap-2">
            {/* 로그인으로 풀리는 차단이면 한 번에 풀어준다 — 온보딩 위저드와
                같은 `launchLogin` 을 그대로 쓴다(터미널 탭에서 실제 로그인). */}
            {blockLoginModel && (
              <button
                data-testid="orchestrator-block-login"
                onClick={(e) => {
                  e.stopPropagation();
                  void launchLogin(blockLoginModel, launchBlock.action);
                }}
                className="rounded border border-[#f9e2af]/60 px-2 py-0.5 text-[10px] font-medium text-[#f9e2af] hover:bg-[#f9e2af]/20"
              >
                {t("orchestrator.blocked.login", { model: launchBlock.model })}
              </button>
            )}
            <button
              onClick={(e) => {
                e.stopPropagation();
                setLaunchBlock(null);
              }}
              className="rounded border border-[#45475a] px-2 py-0.5 text-[10px] text-[#a6adc8] hover:bg-[#313244]"
            >
              {t("orchestrator.blocked.dismiss")}
            </button>
          </div>
        </div>
      )}

      {/* Terminal content */}
      {!isCollapsed && ptySessionId && isRunning && (
        <div className="flex-1 min-h-0 relative">
          <OrchestratorTerminal
            sessionId={ptySessionId}
            panelHeight={panelHeight}
          />
        </div>
      )}
    </div>
  );
});
