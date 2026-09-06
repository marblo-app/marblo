import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Design doc §B ("사장님이 실시간으로 본다") for ticket FQ7nshXHjDWOvD0WWUVV:
 * a live feed of which agent is reading which web-tab page, plus the global
 * stop. This is deliberately its own small bar, not folded into
 * `BrowserPane`'s per-pane toolbar — it reports across ALL panes/windows,
 * and the stop button must stay reachable even if the pane an agent is
 * reading isn't the one currently focused.
 *
 * Ticket OkVRLGAUdZxX4kSm3XGx: the isolated `temp:marblo-agent-browser` pane
 * `web_tab_navigate` creates was never attached to `paneStore`/`LayoutView`,
 * so `BrowserPane.tsx` never mounted for it and it stayed hidden at 0x0
 * forever — only this bar's text log was ever visible. Rather than touch
 * `BrowserPane.tsx`/`LayoutView` (owned by ticket JZoA6G01eWRO3FGHO0Mh right
 * now, and that's also the surface that must never show the owner's own
 * pane content in place of the agent's), this file drives the same
 * `browserPane:setBounds` bridge directly for a small preview strip that
 * lives only inside this bar — never overlapping the human pane tree.
 */
interface ActivityEntry {
  key: string;
  agentId: string;
  ticketId?: string;
  paneId: string;
  url: string;
  status: "reading" | "navigating" | "done" | "blocked" | "aborted";
  reason?: string;
  at: number;
  title?: string;
  textPreview?: string;
  redacted?: boolean;
}

const MAX_ENTRIES = 20;
const PREVIEW_HEIGHT = 220;

function statusLabel(entry: ActivityEntry): string {
  switch (entry.status) {
    case "reading":
      return "읽는 중";
    case "navigating":
      return "이동 중";
    case "done":
      return "읽음";
    case "blocked":
      return `거부됨${entry.reason ? ` (${entry.reason})` : ""}`;
    case "aborted":
      return "중단됨";
    default:
      return entry.status;
  }
}

function visualViewportOrigin(): { x: number; y: number } {
  return {
    x: window.visualViewport?.offsetLeft ?? 0,
    y: window.visualViewport?.offsetTop ?? 0,
  };
}

function rectToBounds(rect: DOMRect) {
  return {
    x: Math.max(0, Math.round(rect.left)),
    y: Math.max(0, Math.round(rect.top)),
    width: Math.max(0, Math.round(rect.width)),
    height: Math.max(0, Math.round(rect.height)),
  };
}

export function AgentBrowserActivityBar() {
  const [entries, setEntries] = useState<ActivityEntry[]>([]);
  const [suspended, setSuspended] = useState(false);
  const [pending, setPending] = useState(false);
  const seqRef = useRef(0);

  // The pane currently bound into the preview strip below. Only one at a
  // time — a new navigation call always makes a brand-new isolated pane
  // (fresh paneId), so switching means hiding the previous one first.
  const [activePaneId, setActivePaneId] = useState<string | null>(null);
  const previewContainerRef = useRef<HTMLDivElement | null>(null);
  const activePaneIdRef = useRef<string | null>(null);
  activePaneIdRef.current = activePaneId;

  const hidePane = useCallback((paneId: string | null) => {
    if (!paneId) return;
    void window.electronAPI?.browserPane
      ?.setBounds({ paneId, visible: false })
      .catch(() => {});
  }, []);

  useEffect(() => {
    const api = window.electronAPI?.browserPane;
    if (!api?.getGlobalAgentStop) return;
    void api
      .getGlobalAgentStop()
      .then((result) => {
        if (result.ok) setSuspended(result.suspended);
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    const api = window.electronAPI?.browserPane;
    if (!api?.onAgentReadActivity) return;
    return api.onAgentReadActivity((event) => {
      seqRef.current += 1;
      setEntries((prev) =>
        [{ ...event, key: `${event.at}-${seqRef.current}` }, ...prev].slice(
          0,
          MAX_ENTRIES,
        ),
      );
      if (event.paneId === "*" && event.status === "aborted") {
        setSuspended(true);
      }
      // "*" means the request was denied before any pane existed (e.g. a
      // brand-new navigation blocked by policy) — nothing real to preview.
      if (event.paneId !== "*" && event.paneId !== activePaneIdRef.current) {
        hidePane(activePaneIdRef.current);
        setActivePaneId(event.paneId);
      }
    });
  }, [hidePane]);

  // Keeps the native WebContentsView glued to the preview strip's on-screen
  // rectangle, the same technique `BrowserPane.tsx` uses for the human pane
  // tree — but targeting the agent's own isolated paneId, in a container
  // that never shares space with a human-owned pane.
  useEffect(() => {
    const api = window.electronAPI?.browserPane;
    const container = previewContainerRef.current;
    if (!api || !container || !activePaneId) return;

    let raf = 0;
    const report = () => {
      raf = 0;
      const rect = container.getBoundingClientRect();
      const visible = rect.width >= 8 && rect.height >= 8 && !document.hidden;
      void api
        .setBounds({
          paneId: activePaneId,
          visible,
          bounds: rectToBounds(rect),
          windowOrigin: visualViewportOrigin(),
        })
        .catch(() => {});
    };
    const schedule = () => {
      if (raf) return;
      raf = window.requestAnimationFrame(report);
    };

    schedule();
    window.addEventListener("resize", schedule);
    document.addEventListener("visibilitychange", schedule);
    const resizeObserver =
      typeof ResizeObserver === "undefined"
        ? null
        : new ResizeObserver(schedule);
    resizeObserver?.observe(container);

    return () => {
      if (raf) window.cancelAnimationFrame(raf);
      window.removeEventListener("resize", schedule);
      document.removeEventListener("visibilitychange", schedule);
      resizeObserver?.disconnect();
      hidePane(activePaneId);
    };
  }, [activePaneId, hidePane]);

  const engageStop = useCallback(() => {
    const api = window.electronAPI?.browserPane;
    if (!api?.setGlobalAgentStop) return;
    setPending(true);
    void api
      .setGlobalAgentStop(!suspended)
      .then((result) => {
        if (result.ok) setSuspended(result.suspended);
      })
      .finally(() => setPending(false));
  }, [suspended]);

  const activeEntry = entries.find((e) => e.paneId === activePaneId);

  // The stop button always renders on this screen, even with zero activity —
  // "able to see, therefore able to stop" (design doc §B) can't depend on an
  // agent having already read something first.
  return (
    <div className="flex flex-col gap-1 border-b border-gray-700 bg-gray-950 px-2 py-1.5 text-[11px] text-gray-300">
      <div className="flex items-center gap-2">
        <span className="font-medium text-gray-400">에이전트 웹탭 활동</span>
        {suspended && (
          <span className="rounded bg-red-900/60 px-1.5 py-0.5 text-red-200">
            전역 중지됨
          </span>
        )}
        <div className="flex-1" />
        <button
          type="button"
          onClick={engageStop}
          disabled={pending}
          data-testid="agent-browser-global-stop"
          className={`rounded px-2 py-1 text-[11px] font-semibold disabled:opacity-50 ${
            suspended
              ? "bg-gray-700 text-gray-100 hover:bg-gray-600"
              : "bg-red-700 text-red-50 hover:bg-red-600"
          }`}
        >
          {suspended ? "에이전트 접근 재개" : "🛑 전체 중지"}
        </button>
      </div>
      {activePaneId && (
        <div className="flex flex-col gap-1">
          <div className="flex items-center gap-1.5 text-gray-400">
            <span className="rounded bg-gray-800 px-1.5 py-0.5 text-[10px] text-gray-300">
              에이전트가 보는 화면
            </span>
            {activeEntry && (
              <span className="truncate">
                {statusLabel(activeEntry)}
                {activeEntry.url ? ` · ${activeEntry.url}` : ""}
              </span>
            )}
          </div>
          <div
            ref={previewContainerRef}
            data-testid="agent-browser-preview-anchor"
            className="relative w-full overflow-hidden rounded border border-gray-700 bg-white"
            style={{ height: PREVIEW_HEIGHT }}
          />
        </div>
      )}
      {entries.length > 0 && (
        <ul className="max-h-24 overflow-y-auto">
          {entries.map((entry) => (
            <li key={entry.key} className="truncate text-gray-400">
              <span className="text-gray-200">{entry.agentId}</span>
              {entry.ticketId ? ` (${entry.ticketId})` : ""} —{" "}
              {statusLabel(entry)}
              {entry.url ? ` · ${entry.url}` : ""}
              {entry.status === "done" && entry.textPreview && (
                <span className="block truncate pl-4 text-gray-500">
                  “{entry.title ? `${entry.title}: ` : ""}
                  {entry.textPreview}
                  {entry.redacted ? " (일부 마스킹됨)" : ""}”
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
