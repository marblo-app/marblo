import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Design doc §B ("사장님이 실시간으로 본다") for ticket FQ7nshXHjDWOvD0WWUVV:
 * a live feed of which agent is reading which web-tab page, plus the global
 * stop. This is deliberately its own small bar, not folded into
 * `BrowserPane`'s per-pane toolbar — it reports across ALL panes/windows,
 * and the stop button must stay reachable even if the pane an agent is
 * reading isn't the one currently focused.
 */
interface ActivityEntry {
  key: string;
  agentId: string;
  ticketId?: string;
  paneId: string;
  url: string;
  status: "reading" | "done" | "blocked" | "aborted";
  reason?: string;
  at: number;
}

const MAX_ENTRIES = 20;

function statusLabel(entry: ActivityEntry): string {
  switch (entry.status) {
    case "reading":
      return "읽는 중";
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

export function AgentBrowserActivityBar() {
  const [entries, setEntries] = useState<ActivityEntry[]>([]);
  const [suspended, setSuspended] = useState(false);
  const [pending, setPending] = useState(false);
  const seqRef = useRef(0);

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
    });
  }, []);

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
      {entries.length > 0 && (
        <ul className="max-h-24 overflow-y-auto">
          {entries.map((entry) => (
            <li key={entry.key} className="truncate text-gray-400">
              <span className="text-gray-200">{entry.agentId}</span>
              {entry.ticketId ? ` (${entry.ticketId})` : ""} —{" "}
              {statusLabel(entry)}
              {entry.url ? ` · ${entry.url}` : ""}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
