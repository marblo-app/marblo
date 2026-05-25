import { useEffect, useRef, useState, memo } from "react";
import TerminalTabs from "./TerminalTabs";
import TerminalView from "./TerminalView";
import FeedbackInput from "./FeedbackInput";
import { useTerminalStore } from "../../stores/terminalStore";

let tabCounter = 0;

export default memo(function TerminalPanel() {
  // Fleet 그리드/Activity 점프 흐름이 발행하는 focus 이벤트를 청취해서 패널을
  // 뷰포트로 스크롤해 사용자가 즉시 출력을 볼 수 있게 한다.
  const rootRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const onFocus = () => {
      rootRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
    };
    window.addEventListener("marblo:focus-terminal", onFocus as EventListener);
    return () =>
      window.removeEventListener(
        "marblo:focus-terminal",
        onFocus as EventListener,
      );
  }, []);

  const sessions = useTerminalStore((s) => s.sessions);
  const activeSessionId = useTerminalStore((s) => s.activeSessionId);
  const setActiveSessionId = useTerminalStore((s) => s.setActiveSessionId);
  const createSession = useTerminalStore((s) => s.createSession);
  const closeSession = useTerminalStore((s) => s.closeSession);

  const [showFeedback, setShowFeedback] = useState(false);

  const handleAddTab = async () => {
    tabCounter++;
    await createSession(`Terminal ${tabCounter}`);
  };

  const handleCloseTab = async (id: string) => {
    await closeSession(id);
  };

  return (
    <div
      ref={rootRef}
      className="flex flex-col flex-shrink-0 bg-[#1e1e2e]"
      style={{ height: sessions.length > 0 ? 250 : 48 }}
    >
      <TerminalTabs
        sessions={sessions}
        activeSessionId={activeSessionId}
        onSelectTab={setActiveSessionId}
        onCloseTab={handleCloseTab}
        onAddTab={handleAddTab}
      >
        {/* 피드백 토글 버튼 */}
        {sessions.length > 0 && (
          <button
            onClick={() => setShowFeedback(!showFeedback)}
            className={`ml-auto flex items-center gap-1 rounded px-2 py-0.5 text-xs transition-colors ${
              showFeedback
                ? "bg-[#89b4fa] text-[#1e1e2e]"
                : "text-[#6c7086] hover:text-[#a6adc8]"
            }`}
            title="PM 피드백"
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
                d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z"
              />
            </svg>
            피드백
          </button>
        )}
      </TerminalTabs>
      <div className="flex-1 relative min-h-0">
        {sessions.length === 0 ? (
          <div className="flex items-center justify-center h-full text-[#6c7086] text-sm">
            <button
              className="px-4 py-2 rounded border border-[#313244] hover:border-[#585b70] hover:text-[#a6adc8] transition-colors"
              onClick={handleAddTab}
            >
              + New Terminal
            </button>
          </div>
        ) : (
          sessions.map((session) => (
            <TerminalView
              key={session.id}
              sessionId={session.id}
              isActive={session.id === activeSessionId}
            />
          ))
        )}
      </div>
      {showFeedback && sessions.length > 0 && (
        <FeedbackInput sessionId={activeSessionId} />
      )}
    </div>
  );
});
