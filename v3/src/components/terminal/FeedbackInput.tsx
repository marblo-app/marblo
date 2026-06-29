import { useState, useRef, useEffect } from "react";
import { addActivity } from "../../services/activityService";
import {
  clipboardEventHasImage,
  insertAtCaret,
  resolveClipboardImagePaths,
} from "../../utils/clipboardImage";
import { useTranslation } from "../../lib/i18n";

interface FeedbackEntry {
  text: string;
  sentAt: Date;
}

interface FeedbackInputProps {
  sessionId: string | null;
  taskId?: string;
}

export default function FeedbackInput({
  sessionId,
  taskId,
}: FeedbackInputProps) {
  const { t } = useTranslation();
  const [text, setText] = useState("");
  const [history, setHistory] = useState<FeedbackEntry[]>([]);
  const [showHistory, setShowHistory] = useState(false);
  const [sending, setSending] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, [sessionId]);

  const handleSend = async () => {
    const trimmed = text.trim();
    if (!trimmed || !sessionId) return;

    setSending(true);
    try {
      // PTY stdin에 메시지 주입 + 제출(Enter). plain write+'\n'는 claude
      // 제출키(\r)가 아니라 composer에 줄바꿈만 남아 제출이 안 됨 →
      // writeAndSubmit(verify-and-retry CR)로 보낸다.
      await window.electronAPI.pty.writeAndSubmit(sessionId, trimmed);

      // 히스토리에 추가
      const entry: FeedbackEntry = { text: trimmed, sentAt: new Date() };
      setHistory((prev) => [entry, ...prev]);

      // Firestore에 기록
      if (taskId) {
        await addActivity(taskId, "pm", `[PM 피드백] ${trimmed}`);
      }

      setText("");
    } catch (err) {
      console.error("피드백 전송 실패:", err);
    } finally {
      setSending(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  // Paste an image → save it to disk and inject its absolute path so the agent
  // can Read it. Plain-text pastes fall through to the default behavior.
  const handlePaste = (e: React.ClipboardEvent<HTMLInputElement>) => {
    if (!clipboardEventHasImage(e)) return;
    e.preventDefault();
    const el = inputRef.current;
    void resolveClipboardImagePaths().then((paths) => {
      if (paths.length === 0 || !el) return;
      const { value, caret } = insertAtCaret(el, paths.join(" "));
      setText(value);
      requestAnimationFrame(() => {
        el.selectionStart = el.selectionEnd = caret;
      });
    });
  };

  const formatTime = (date: Date) => {
    return date.toLocaleTimeString("ko-KR", {
      hour: "2-digit",
      minute: "2-digit",
    });
  };

  return (
    <div className="border-t border-[#313244] bg-[#181825]">
      {/* 히스토리 패널 */}
      {showHistory && history.length > 0 && (
        <div className="max-h-32 overflow-y-auto border-b border-[#313244] px-3 py-2">
          <p className="mb-1 text-xs font-medium text-[#6c7086]">
            {t("terminal.feedback.recent")}
          </p>
          {history.slice(0, 10).map((entry, i) => (
            <div key={i} className="flex items-start gap-2 py-0.5">
              <span className="flex-shrink-0 text-xs text-[#585b70]">
                {formatTime(entry.sentAt)}
              </span>
              <span className="text-xs text-[#a6adc8]">{entry.text}</span>
            </div>
          ))}
        </div>
      )}

      {/* 입력 영역 */}
      <div className="flex items-center gap-2 px-3 py-2">
        {/* 히스토리 토글 */}
        {history.length > 0 && (
          <button
            onClick={() => setShowHistory(!showHistory)}
            className="flex-shrink-0 text-[#6c7086] hover:text-[#a6adc8] transition-colors"
            title={t("terminal.feedback.historyTitle")}
          >
            <svg
              className="h-4 w-4"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"
              />
            </svg>
          </button>
        )}

        <input
          ref={inputRef}
          type="text"
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={handleKeyDown}
          onPaste={handlePaste}
          placeholder={t("terminal.feedback.placeholder")}
          disabled={!sessionId || sending}
          className="flex-1 rounded bg-[#313244] px-3 py-1.5 text-sm text-[#cdd6f4] placeholder-[#6c7086] outline-none focus:ring-1 focus:ring-[#89b4fa] disabled:opacity-50"
        />

        <button
          onClick={handleSend}
          disabled={!text.trim() || !sessionId || sending}
          className="flex-shrink-0 rounded bg-[#89b4fa] px-3 py-1.5 text-sm font-medium text-[#1e1e2e] hover:bg-[#74c7ec] disabled:opacity-40 transition-colors"
        >
          {sending ? "..." : t("terminal.feedback.send")}
        </button>
      </div>
    </div>
  );
}
