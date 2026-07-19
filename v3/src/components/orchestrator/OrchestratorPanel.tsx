import {
  useRef,
  useCallback,
  useState,
  useEffect,
  memo,
  type ChangeEvent,
} from "react";
import { useTranslation } from "../../lib/i18n";
import {
  ORCHESTRATOR_MODEL_OPTIONS,
  isOrchestratorModel,
  useOrchestratorStore,
  type OrchestratorModel,
} from "../../stores/orchestratorStore";
import { useProjectStore } from "../../stores/projectStore";
import { useEditorStore } from "../../stores/editorStore";
import { useTaskStore } from "../../stores/taskStore";
import { upsertOrchestratorAgentDoc } from "../../services/orchestratorAgentDoc";
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

export default memo(function OrchestratorPanel() {
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

  // Close session picker when clicking outside
  useEffect(() => {
    if (!showSessionPicker) return;
    const handleClick = () => setShowSessionPicker(false);
    const timer = setTimeout(
      () => document.addEventListener("click", handleClick),
      0,
    );
    return () => {
      clearTimeout(timer);
      document.removeEventListener("click", handleClick);
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

  const handleStartWithSession = async (resumeSessionId?: string) => {
    setShowSessionPicker(false);
    if (isRunning) return;
    const projectId = currentProject.id;
    const cwd = rootPath || "~";
    try {
      setStatus("starting");
      await window.electronAPI.orchestratorModel.set(selectedModel, projectId);
      // 명시 모델을 launch 에 함께 전달 — main 의 프로젝트별 저장 모델보다
      // 이번 사용자 선택이 우선하게 한다.
      const result = await window.electronAPI.orchestratorSession.launch(
        projectId,
        cwd,
        resumeSessionId,
        selectedModel,
      );
      // Spawn blocked: claude not installed / not logged in. Open the CLI
      // setup gate instead of leaving the orchestrator dead with no reason.
      if (result?.needsAuth) {
        setStatus("stopped");
        window.dispatchEvent(new CustomEvent("marblo:open-cli-setup"));
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

  const handleModelChange = (e: ChangeEvent<HTMLSelectElement>) => {
    e.stopPropagation();
    const next = e.target.value as OrchestratorModel;
    setSelectedModel(next);
    if (!isRunning) {
      window.electronAPI.orchestratorModel
        .set(next, currentProject?.id)
        .catch(() => {});
      return;
    }
    if (next === runningModel) return;
    setPendingSwitchModel(next);
    setShowSwitchConfirm(true);
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
        if (runningModel) setSelectedModel(runningModel);
        window.dispatchEvent(new CustomEvent("marblo:open-cli-setup"));
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
    const cwd = rootPath || "~";
    try {
      const list =
        await window.electronAPI.orchestratorSession.listSessions(cwd);
      setSessions(list);
    } catch {
      setSessions([]);
    }
    setShowSessionPicker(true);
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
      className="flex flex-col flex-shrink-0 border-t border-[#313244] bg-[#181825]"
      style={{ height }}
    >
      {/* Resize handle */}
      {!isCollapsed && isRunning && (
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
        className={`flex items-center gap-2 px-3 py-1.5 text-xs select-none ${
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
        <span className="text-[#cdd6f4] font-medium">Orchestrator</span>

        {isRunning ? (
          <>
            <span className="text-[#6c7086]">
              {isSwitching
                ? "Switching..."
                : status === "running"
                  ? `${ORCHESTRATOR_MODEL_OPTIONS.find((m) => m.value === (runningModel ?? selectedModel))?.label ?? "Claude"} Code`
                  : "Starting..."}
            </span>
            {claudeVersion && (
              <span
                className="rounded bg-[#313244]/60 px-1.5 py-0.5 font-mono text-[10px] text-[#a6adc8]"
                title={`Agents launch with Claude Code v${claudeVersion}`}
              >
                v{claudeVersion}
              </span>
            )}
            <div className="relative ml-1" onClick={(e) => e.stopPropagation()}>
              <select
                value={selectedModel}
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
              {showSwitchConfirm && (
                <div className="absolute bottom-full right-0 z-50 mb-1 w-80 rounded-md border border-[#313244] bg-[#1e1e2e] p-3 text-xs shadow-lg">
                  <div className="mb-1 font-medium text-[#cdd6f4]">
                    Switch orchestrator to{" "}
                    {ORCHESTRATOR_MODEL_OPTIONS.find(
                      (m) => m.value === targetSwitchModel,
                    )?.label ?? "Claude"}
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
                </div>
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
              <select
                value={selectedModel}
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
              <button
                onClick={handleManualStart}
                className="rounded bg-[#89b4fa]/20 px-2.5 py-0.5 text-[#89b4fa] hover:bg-[#89b4fa]/30 transition-colors"
              >
                Start
              </button>
              <button
                onClick={handleShowSessionPicker}
                className="rounded bg-[#313244]/50 px-1 py-0.5 text-[#6c7086] hover:text-[#cdd6f4] hover:bg-[#313244] transition-colors"
                title={t("orchestrator.sessionPicker")}
              >
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
              {showSessionPicker && (
                <div
                  onClick={(e) => e.stopPropagation()}
                  className="absolute bottom-full left-0 mb-1 w-72 rounded-md border border-[#313244] bg-[#1e1e2e] shadow-lg z-50 overflow-hidden"
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
                              handleStartWithSession(i === 0 ? "latest" : s.id)
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
                </div>
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
