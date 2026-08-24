/**
 * WorkChainPanel — 오케가 "다음에 할 작정인 것" 을 사장님이 보는 자리
 * (티켓 fQtXQ2NzyYs0MRpqByTS).
 *
 * 한 줄 요약(열림/준비 수 + ▶ 다음 항목)은 항상 보이고, 펼치면 항목마다
 * 무엇·왜·근거 티켓·기다리는 것이 보인다. 상태는 저장값이 아니라 **보드 스토어의
 * 티켓 status 로 파생**한다(`deriveWorkChain` — MCP 의 get_work_chain 과 같은 함수).
 * 그래서 오케가 "했다" 고 적어도 티켓이 DONE 이 아니면 여기선 완료로 안 보인다.
 *
 * 화면에서 할 수 있는 쓰기는 둘뿐이다 — 항목 적기(what/why), 내리기(dropped, 사유
 * 필수). 완료를 적는 버튼은 없다: 완료는 보드가 판정한다.
 *
 * 빈/실패/로딩은 `StateBlock` 이 그린다 — 빈 상태엔 "항목 적기" 가, 실패엔 "다시
 * 시도" 가 붙는다(`loadState.ts` 의 규칙: 다음 행동 없는 상태는 타입이 거부).
 */
import {
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { useTranslation } from "../../lib/i18n";
import { useTaskStore } from "../../stores/taskStore";
import { routeInstructionToOrchestrator } from "../../services/orchestratorInstructionService";
import {
  buildMissionMembership,
  deriveWorkChain,
  referencedTaskIds,
  taskStatusLookupFrom,
  taskTitlesFrom,
  type DerivedWorkChain,
  type DerivedWorkChainItem,
  type WorkChainItem,
} from "../../lib/workChain";
import type { Mission } from "../../types/mission";
import {
  addWorkChainItemFromUi,
  dropWorkChainItemFromUi,
  removeWorkChainEvidenceTaskFromUi,
  subscribeWorkChain,
  subscribeWorkChainMissions,
} from "../../services/workChainService";
import { StateBlock } from "../common/StateBlock";
import type { LoadState } from "../common/loadState";
import {
  DEFAULT_PANEL_HEIGHT,
  MAX_PANEL_HEIGHT,
  clampPanelHeight,
  panelHeightForPointer,
} from "./workChainPanelResize";

export interface WorkChainPanelProps {
  projectId: string | null;
}

type ChainLoad =
  | { kind: "loading"; since: number }
  | { kind: "ready"; items: WorkChainItem[]; exists: boolean }
  | { kind: "failed"; detail: string; reason: "permission" | "load" };

// This is intentionally global rather than project-scoped: it is a display
// preference for the orchestrator surface, and making every project relearn it
// would be surprising. localStorage also keeps this renderer-only change out
// of the Electron main process.
const PANEL_HEIGHT_STORAGE_KEY = "marblo.workChainPanel.height.v1";
function readPanelHeight(): number {
  try {
    const stored = window.localStorage.getItem(PANEL_HEIGHT_STORAGE_KEY);
    if (!stored) return DEFAULT_PANEL_HEIGHT;
    const value = Number(stored);
    return Number.isFinite(value)
      ? clampPanelHeight(value)
      : DEFAULT_PANEL_HEIGHT;
  } catch {
    // Storage may be unavailable in private/test renderer contexts. Resizing
    // still works for this session in that case.
    return DEFAULT_PANEL_HEIGHT;
  }
}

function persistPanelHeight(height: number): void {
  try {
    window.localStorage.setItem(PANEL_HEIGHT_STORAGE_KEY, String(height));
  } catch {
    // Persistence is best-effort; never make the resize handle unusable.
  }
}

const STATE_CHIP: Record<
  DerivedWorkChainItem["state"] | "doneSelf" | "unsplit",
  { cls: string; key: string }
> = {
  ready: {
    cls: "bg-[#a6e3a1]/15 text-[#a6e3a1]",
    key: "orchestrator.chain.state.ready",
  },
  waiting: {
    cls: "bg-[#f9e2af]/15 text-[#f9e2af]",
    key: "orchestrator.chain.state.waiting",
  },
  done: {
    cls: "bg-[#89b4fa]/15 text-[#89b4fa]",
    key: "orchestrator.chain.state.done",
  },
  doneSelf: {
    cls: "bg-[#fab387]/15 text-[#fab387]",
    key: "orchestrator.chain.state.doneSelf",
  },
  dropped: {
    cls: "bg-[#6c7086]/20 text-[#a6adc8]",
    key: "orchestrator.chain.state.dropped",
  },
  unsplit: {
    cls: "bg-[#f9e2af]/15 text-[#f9e2af]",
    key: "orchestrator.chain.state.unsplit",
  },
};

function chipFor(d: DerivedWorkChainItem): keyof typeof STATE_CHIP {
  if (d.unsplit && d.state === "ready") return "unsplit";
  if (d.state === "done" && d.evidence === "self") return "doneSelf";
  return d.state;
}

export default memo(function WorkChainPanel({
  projectId,
}: WorkChainPanelProps) {
  const { t } = useTranslation();
  const tasks = useTaskStore((s) => s.tasks);
  const subscribeToTasks = useTaskStore((s) => s.subscribeToTasks);
  const [load, setLoad] = useState<ChainLoad>({
    kind: "loading",
    since: Date.now(),
  });
  const [retryToken, setRetryToken] = useState(0);
  const [expanded, setExpanded] = useState(false);
  const [showClosed, setShowClosed] = useState(false);
  const [adding, setAdding] = useState(false);
  const [what, setWhat] = useState("");
  const [why, setWhy] = useState("");
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [startedItemIds, setStartedItemIds] = useState<ReadonlySet<string>>(
    () => new Set(),
  );
  const [missions, setMissions] = useState<Mission[]>([]);
  const [panelHeight, setPanelHeight] = useState(readPanelHeight);
  const [isResizing, setIsResizing] = useState(false);
  const panelHeightRef = useRef(panelHeight);
  const resizeFrameRef = useRef<number | null>(null);
  const resizeCleanupRef = useRef<(() => void) | null>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  // Evidence status is the panel's completion authority, so it must not rely
  // on the user first visiting another task-consuming tab.
  useEffect(() => {
    if (!projectId) return;
    return subscribeToTasks(projectId);
  }, [projectId, subscribeToTasks]);

  // Read-only implicit-mission labels for chain membership. Does not start
  // the mission engine (MISSION_DRIVER stays off).
  useEffect(() => {
    if (!projectId) return;
    return subscribeWorkChainMissions(projectId, setMissions);
  }, [projectId]);

  useEffect(() => {
    panelHeightRef.current = panelHeight;
  }, [panelHeight]);

  useEffect(
    () => () => {
      if (resizeFrameRef.current !== null) {
        cancelAnimationFrame(resizeFrameRef.current);
      }
      resizeCleanupRef.current?.();
    },
    [],
  );

  const handleResizeStart = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      if (event.button !== 0) return;
      event.preventDefault();
      const startY = event.clientY;
      const startHeight = panelHeightRef.current;
      const previousCursor = document.body.style.cursor;
      const previousUserSelect = document.body.style.userSelect;
      setIsResizing(true);
      document.body.style.cursor = "row-resize";
      document.body.style.userSelect = "none";

      const applyHeight = () => {
        resizeFrameRef.current = null;
        setPanelHeight(panelHeightRef.current);
      };
      const onMove = (moveEvent: PointerEvent) => {
        // The panel's lower edge moves with the pointer: down increases its
        // height; up decreases it. rAF limits layout/ResizeObserver churn,
        // which in turn throttles the xterm re-fit below this panel.
        panelHeightRef.current = panelHeightForPointer(
          startHeight,
          startY,
          moveEvent.clientY,
        );
        if (resizeFrameRef.current === null) {
          resizeFrameRef.current = requestAnimationFrame(applyHeight);
        }
        if (moveEvent.cancelable) moveEvent.preventDefault();
      };
      const onEnd = () => {
        if (resizeFrameRef.current !== null) {
          cancelAnimationFrame(resizeFrameRef.current);
          resizeFrameRef.current = null;
        }
        // Commit synchronously on release. TerminalView's ResizeObserver then
        // performs its settled rAF fit, including its final xterm refresh.
        setPanelHeight(panelHeightRef.current);
        persistPanelHeight(panelHeightRef.current);
        setIsResizing(false);
        document.body.style.cursor = previousCursor;
        document.body.style.userSelect = previousUserSelect;
        document.removeEventListener("pointermove", onMove);
        document.removeEventListener("pointerup", onEnd);
        document.removeEventListener("pointercancel", onEnd);
        resizeCleanupRef.current = null;
      };

      resizeCleanupRef.current?.();
      resizeCleanupRef.current = onEnd;

      document.addEventListener("pointermove", onMove);
      document.addEventListener("pointerup", onEnd);
      document.addEventListener("pointercancel", onEnd);
    },
    [],
  );

  useEffect(() => {
    if (!projectId) return;
    setLoad({ kind: "loading", since: Date.now() });
    const unsub = subscribeWorkChain(projectId, (res) => {
      if (res.kind === "error") {
        setLoad({
          kind: "failed",
          detail: res.error.message,
          reason: res.reason,
        });
        return;
      }
      setLoad({
        kind: "ready",
        items: res.snapshot.items,
        exists: res.snapshot.exists,
      });
    });
    return unsub;
  }, [projectId, retryToken]);

  useEffect(() => {
    if (!expanded) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!panelRef.current?.contains(event.target as Node)) setExpanded(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setExpanded(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [expanded]);

  const membership = useMemo(
    () => buildMissionMembership(missions, tasks),
    [missions, tasks],
  );

  const derived: DerivedWorkChain | null = useMemo(() => {
    if (load.kind !== "ready") return null;
    const ids = referencedTaskIds(load.items, membership);
    return deriveWorkChain(
      load.items,
      taskStatusLookupFrom(tasks, ids),
      membership,
    );
  }, [load, tasks, membership]);

  const titles = useMemo(() => {
    if (load.kind !== "ready") return {};
    return taskTitlesFrom(tasks, referencedTaskIds(load.items, membership));
  }, [load, tasks, membership]);

  const openForm = useCallback(() => {
    setExpanded(true);
    setAdding(true);
    setFormError(null);
  }, []);

  const submit = useCallback(async () => {
    if (!projectId) return;
    if (!what.trim() || !why.trim()) {
      setFormError(t("orchestrator.chain.form.required"));
      return;
    }
    setBusy(true);
    const res = await addWorkChainItemFromUi(projectId, { what, why });
    setBusy(false);
    if (!res.ok) {
      setFormError(t("orchestrator.chain.writeFailed", { error: res.error }));
      return;
    }
    setWhat("");
    setWhy("");
    setAdding(false);
    setFormError(null);
  }, [projectId, what, why, t]);

  const drop = useCallback(
    async (itemId: string) => {
      if (!projectId) return;
      const reason = window.prompt(t("orchestrator.chain.dropPrompt")) ?? "";
      if (!reason.trim()) {
        setFormError(t("orchestrator.chain.dropReasonRequired"));
        return;
      }
      const res = await dropWorkChainItemFromUi(projectId, itemId, reason);
      if (!res.ok)
        setFormError(t("orchestrator.chain.writeFailed", { error: res.error }));
    },
    [projectId, t],
  );

  const removeMissingEvidence = useCallback(
    async (itemId: string, taskId: string) => {
      if (!projectId) return;
      const result = await removeWorkChainEvidenceTaskFromUi(
        projectId,
        itemId,
        taskId,
      );
      if (!result.ok)
        setFormError(
          t("orchestrator.chain.writeFailed", { error: result.error }),
        );
    },
    [projectId, t],
  );

  const startNow = useCallback(
    async (item: WorkChainItem) => {
      if (!projectId || startedItemIds.has(item.id)) return;
      const result = await routeInstructionToOrchestrator({
        projectId,
        message: `${item.what}\n\nWhy: ${item.why}`,
      });
      if (result === "failed") {
        setFormError(t("orchestrator.chain.startFailed"));
        return;
      }
      // The durable queue/local injector accepted this; it does not prove an
      // occupied terminal composer visibly received the text.
      setStartedItemIds((ids) => new Set(ids).add(item.id));
    },
    [projectId, startedItemIds, t],
  );

  if (!projectId) return null;

  const state: LoadState =
    load.kind === "loading"
      ? { kind: "loading", since: load.since }
      : load.kind === "failed"
        ? {
            kind: "failed",
            reasonCode:
              load.reason === "permission"
                ? "orchestrator.chain.failed.permission"
                : "orchestrator.chain.failed.reason",
            detail: load.detail,
            retry: () => setRetryToken((n) => n + 1),
          }
        : load.items.length === 0
          ? {
              kind: "empty",
              title: "orchestrator.chain.empty.title",
              hint: "orchestrator.chain.empty.hint",
              create: {
                label: "orchestrator.chain.empty.create",
                onClick: openForm,
              },
            }
          : { kind: "ready" };

  const openCount = derived?.open.length ?? 0;
  const readyCount = derived?.ready.length ?? 0;
  const closedCount = derived ? derived.items.length - derived.open.length : 0;
  const next = derived?.next ?? null;
  const visible = derived ? (showClosed ? derived.items : derived.open) : [];

  return (
    <div
      ref={panelRef}
      data-testid="work-chain-panel"
      data-resizing={isResizing ? "true" : undefined}
      className="relative z-20 mx-3 mb-2 rounded border border-[#313244] bg-[#1e1e2e] text-[11px] text-[#cdd6f4]"
      onClick={(e) => e.stopPropagation()}
    >
      {/* 요약 줄 — 항상 보인다. 오케가 다음에 뭘 할 작정인지가 여기 한 줄이다.
          ★진행률·unsplit 은 접힘 줄에 넣지 않는다(#1147→#1150→#1152). */}
      <div
        data-testid="work-chain-summary"
        className="flex min-w-0 items-center gap-x-2 overflow-hidden whitespace-nowrap px-2 py-0.5"
      >
        <span className="shrink-0 font-medium text-[#cba6f7]">
          {t("orchestrator.chain.title")}
        </span>
        {derived && derived.items.length > 0 && (
          <>
            <span className="shrink-0 text-[#a6adc8]">
              {t("orchestrator.chain.countOpen", { open: openCount })} ·{" "}
              {t("orchestrator.chain.countReady", { ready: readyCount })}
            </span>
            {next ? (
              <span
                data-testid="work-chain-next"
                className="min-w-0 flex-1 truncate text-[#a6e3a1]"
                title={next.item.why}
              >
                ▶ {next.item.what}
              </span>
            ) : openCount > 0 ? (
              <span className="min-w-0 flex-1 truncate text-[#f9e2af]">
                ▶ {t("orchestrator.chain.state.waiting")}
              </span>
            ) : (
              <span className="min-w-0 flex-1" aria-hidden="true" />
            )}
          </>
        )}
        {(!derived || derived.items.length === 0) && (
          <span className="min-w-0 flex-1" aria-hidden="true" />
        )}
        <span className="ml-auto flex shrink-0 items-center gap-1">
          {load.kind === "ready" && (
            <button
              type="button"
              onClick={openForm}
              className="rounded border border-[#45475a] px-1.5 py-0.5 text-[10px] text-[#a6adc8] hover:bg-[#313244]"
            >
              + {t("orchestrator.chain.add")}
            </button>
          )}
          <button
            type="button"
            data-testid="work-chain-toggle"
            onClick={() => setExpanded((v) => !v)}
            className="rounded border border-[#45475a] px-1.5 py-0.5 text-[10px] text-[#a6adc8] hover:bg-[#313244]"
            aria-expanded={expanded}
          >
            {expanded
              ? t("orchestrator.chain.toggleHide")
              : t("orchestrator.chain.toggleShow")}
          </button>
        </span>
      </div>

      {expanded && (
        <div
          data-testid="work-chain-overlay"
          className="absolute left-0 right-0 top-full flex flex-col overflow-hidden rounded-b border border-t-0 border-[#313244] bg-[#1e1e2e] shadow-2xl"
          style={{ height: panelHeight, maxHeight: MAX_PANEL_HEIGHT }}
        >
          <div className="min-h-0 flex-1 overflow-y-auto px-2 py-1.5">
            <div className="mb-1 text-[10px] text-[#6c7086]">
              {t("orchestrator.chain.subtitle")}
            </div>
            {formError && (
              <div className="mb-1 rounded bg-[#f38ba8]/10 px-2 py-1 text-[10px] text-[#f38ba8]">
                {formError}
              </div>
            )}
            {adding && (
              <div
                data-testid="work-chain-form"
                className="mb-2 flex flex-col gap-1 rounded border border-[#45475a] p-2"
              >
                <label className="flex flex-col gap-0.5 text-[10px] text-[#a6adc8]">
                  {t("orchestrator.chain.form.what")}
                  <input
                    value={what}
                    onChange={(e) => setWhat(e.target.value)}
                    placeholder={t("orchestrator.chain.form.whatPlaceholder")}
                    maxLength={200}
                    className="rounded border border-[#313244] bg-[#181825] px-1.5 py-1 text-[11px] text-[#cdd6f4] outline-none focus:border-[#89b4fa]"
                  />
                </label>
                <label className="flex flex-col gap-0.5 text-[10px] text-[#a6adc8]">
                  {t("orchestrator.chain.form.why")}
                  <input
                    value={why}
                    onChange={(e) => setWhy(e.target.value)}
                    placeholder={t("orchestrator.chain.form.whyPlaceholder")}
                    maxLength={500}
                    className="rounded border border-[#313244] bg-[#181825] px-1.5 py-1 text-[11px] text-[#cdd6f4] outline-none focus:border-[#89b4fa]"
                  />
                </label>
                <div className="flex justify-end gap-1">
                  <button
                    type="button"
                    onClick={() => {
                      setAdding(false);
                      setFormError(null);
                    }}
                    className="rounded border border-[#45475a] px-2 py-0.5 text-[10px] text-[#a6adc8] hover:bg-[#313244]"
                  >
                    {t("orchestrator.chain.form.cancel")}
                  </button>
                  <button
                    type="button"
                    data-testid="work-chain-submit"
                    disabled={busy}
                    onClick={() => void submit()}
                    className="rounded bg-[#89b4fa]/20 px-2 py-0.5 text-[10px] font-medium text-[#89b4fa] hover:bg-[#89b4fa]/30 disabled:opacity-50"
                  >
                    {t("orchestrator.chain.form.submit")}
                  </button>
                </div>
              </div>
            )}

            <StateBlock
              variant="block"
              state={state}
              minHeight={48}
              skeletonLines={2}
            >
              {() => (
                <ol className="flex flex-col gap-1">
                  {visible.map((d) => {
                    const chip = STATE_CHIP[chipFor(d)];
                    const isNext = next?.item.id === d.item.id;
                    return (
                      <li
                        key={d.item.id}
                        data-testid="work-chain-item"
                        data-state={d.state}
                        data-evidence={d.evidence ?? ""}
                        data-unsplit={d.unsplit ? "true" : undefined}
                        className={`rounded border px-2 py-1 ${
                          isNext
                            ? "border-[#a6e3a1]/50 bg-[#a6e3a1]/5"
                            : "border-[#313244]"
                        } ${d.state === "done" || d.state === "dropped" ? "opacity-70" : ""}`}
                      >
                        <div className="flex items-center gap-2">
                          <span
                            className={`rounded px-1.5 py-0.5 text-[10px] ${chip.cls}`}
                          >
                            {t(chip.key as Parameters<typeof t>[0])}
                          </span>
                          {isNext && (
                            <span className="text-[10px] text-[#a6e3a1]">
                              ▶ {t("orchestrator.chain.next")}
                            </span>
                          )}
                          <span className="truncate font-medium">
                            {d.item.what}
                          </span>
                          {d.state !== "done" && d.state !== "dropped" && (
                            <span className="ml-auto flex shrink-0 gap-1">
                              <button
                                type="button"
                                data-testid="work-chain-start"
                                disabled={startedItemIds.has(d.item.id)}
                                onClick={() => void startNow(d.item)}
                                className="rounded border border-[#a6e3a1]/50 px-1.5 py-0.5 text-[10px] text-[#a6e3a1] hover:bg-[#a6e3a1]/10 disabled:opacity-60"
                              >
                                {startedItemIds.has(d.item.id)
                                  ? t("orchestrator.chain.started")
                                  : t("orchestrator.chain.start")}
                              </button>
                              <button
                                type="button"
                                onClick={() => void drop(d.item.id)}
                                className="rounded border border-[#45475a] px-1.5 py-0.5 text-[10px] text-[#a6adc8] hover:bg-[#313244]"
                              >
                                {t("orchestrator.chain.drop")}
                              </button>
                            </span>
                          )}
                        </div>
                        <div className="mt-0.5 text-[10px] text-[#a6adc8]">
                          <span className="text-[#6c7086]">
                            {t("orchestrator.chain.why")}:
                          </span>{" "}
                          {d.item.why}
                        </div>
                        {d.item.missionLabel && (
                          <div
                            data-testid="work-chain-mission-progress"
                            className="mt-0.5 text-[10px] text-[#a6adc8]"
                          >
                            {d.unsplit
                              ? t("orchestrator.chain.unsplitHint")
                              : t("orchestrator.chain.missionProgress", {
                                  label: d.item.missionLabel,
                                  reached: d.reachedCount,
                                  total: d.totalCount,
                                })}
                            {d.missionCount >= 2 ? (
                              <span
                                data-testid="work-chain-mission-combined"
                                className="ml-1 text-[#f9e2af]"
                              >
                                {t("orchestrator.chain.missionCombined", {
                                  count: d.missionCount,
                                })}
                              </span>
                            ) : null}
                          </div>
                        )}
                        {d.evidenceTaskIds.length > 0 && (
                          <div className="mt-0.5 text-[10px] text-[#a6adc8]">
                            <span className="text-[#6c7086]">
                              {t("orchestrator.chain.evidence")}
                              {` (${d.item.doneWhen})`}:
                            </span>{" "}
                            {d.evidenceTaskIds.map((id) => {
                              const st = tasks.find((x) => x.id === id)?.status;
                              return (
                                <span key={id} className="mr-2">
                                  {titles[id] ?? id}
                                  <span className="text-[#6c7086]">
                                    {" "}
                                    = {st ?? "—"}
                                  </span>
                                </span>
                              );
                            })}
                          </div>
                        )}
                        {d.state === "waiting" && (
                          <div className="mt-0.5 text-[10px] text-[#f9e2af]">
                            <span className="text-[#6c7086]">
                              {t("orchestrator.chain.waitingOn")}:
                            </span>{" "}
                            {[
                              ...d.pendingTaskIds.map((id) => titles[id] ?? id),
                              ...d.pendingItemIds,
                            ].join(", ")}
                          </div>
                        )}
                        {d.missingTaskIds.length > 0 && (
                          <div className="mt-0.5 text-[10px] text-[#f38ba8]">
                            ⚠ {t("orchestrator.chain.missingTask")}:{" "}
                            {d.missingTaskIds.map((id) => (
                              <button
                                key={id}
                                type="button"
                                onClick={() =>
                                  void removeMissingEvidence(d.item.id, id)
                                }
                                className="mr-1 underline decoration-dotted hover:text-[#f9e2af]"
                                title={t("orchestrator.chain.removeEvidence")}
                              >
                                {id}
                              </button>
                            ))}
                          </div>
                        )}
                        {d.item.closed && (
                          <div className="mt-0.5 text-[10px] text-[#6c7086]">
                            {t("orchestrator.chain.closedReason")}:{" "}
                            {d.item.closed.reason}
                          </div>
                        )}
                      </li>
                    );
                  })}
                </ol>
              )}
            </StateBlock>

            {closedCount > 0 && (
              <button
                type="button"
                onClick={() => setShowClosed((v) => !v)}
                className="mt-1 text-[10px] text-[#6c7086] hover:text-[#a6adc8]"
              >
                {showClosed
                  ? t("orchestrator.chain.hideClosed")
                  : t("orchestrator.chain.showClosed", { count: closedCount })}
              </button>
            )}
          </div>
          <div
            data-testid="work-chain-resize-handle"
            onPointerDown={handleResizeStart}
            className="h-2 shrink-0 cursor-row-resize touch-none border-t border-[#313244] bg-[#181825] hover:bg-[#89b4fa]/30"
            role="separator"
            aria-orientation="horizontal"
            aria-label="Resize work chain panel"
            title="Drag to resize work chain panel"
          />
        </div>
      )}
    </div>
  );
});
