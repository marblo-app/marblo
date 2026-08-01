import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { MessageCircle, X } from "lucide-react";
import { useAuth } from "../../hooks/useAuth";
import { useChatStore } from "../../stores/chatStore";
import {
  getMessagesAfterWatermark,
  readChatReadWatermark,
} from "../../stores/chatReadWatermark";
import { useProjectStore } from "../../stores/projectStore";
import type { ChatMessage } from "../../types/chat";

interface ChatToast {
  id: string;
  senderName: string;
  content: string;
}

interface TopToastProps {
  toast: ChatToast;
  isLeaving: boolean;
  onDismiss: () => void;
  onPauseChange: (paused: boolean) => void;
}

const TOAST_DURATION_MS = 3600;
const EXIT_DURATION_MS = 180;
const SUMMARY_LIMIT = 120;

function summarizeMessage(content: string): string {
  const compact = content.replace(/\s+/g, " ").trim();
  if (compact.length <= SUMMARY_LIMIT) return compact;
  return `${compact.slice(0, SUMMARY_LIMIT - 1)}...`;
}

function TopToast({
  toast,
  isLeaving,
  onDismiss,
  onPauseChange,
}: TopToastProps) {
  return (
    <div className="pointer-events-none fixed left-0 right-0 top-4 z-[1000] flex justify-center px-4">
      <button
        type="button"
        aria-label="Dismiss chat notification"
        onClick={onDismiss}
        onMouseEnter={() => onPauseChange(true)}
        onMouseLeave={() => onPauseChange(false)}
        className={`pointer-events-auto flex w-full max-w-md items-start gap-3 rounded-lg border border-gray-700 bg-gray-900/95 px-4 py-3 text-left shadow-2xl shadow-black/30 backdrop-blur transition-all duration-200 ${
          isLeaving ? "-translate-y-2 opacity-0" : "translate-y-0 opacity-100"
        }`}
      >
        <span className="mt-0.5 flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full bg-blue-500/15 text-blue-300">
          <MessageCircle className="h-4 w-4" aria-hidden="true" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-semibold text-gray-100">
            {toast.senderName}
          </span>
          <span className="mt-0.5 block line-clamp-2 text-sm leading-5 text-gray-300">
            {toast.content}
          </span>
        </span>
        <X
          className="mt-0.5 h-4 w-4 flex-shrink-0 text-gray-500"
          aria-hidden="true"
        />
      </button>
    </div>
  );
}

export function ChatToastHost() {
  const { user } = useAuth();
  const projectId = useProjectStore((s) => s.currentProject?.id ?? null);
  const messages = useChatStore((s) => s.messages);
  const loading = useChatStore((s) => s.loading);
  const subscribeToMessages = useChatStore((s) => s.subscribeToMessages);

  const [toast, setToast] = useState<ChatToast | null>(null);
  const [isLeaving, setIsLeaving] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const hydratedRef = useRef(false);
  const snapshotBaselineRef = useRef<ChatMessage | null>(null);
  const dismissTimerRef = useRef<number | null>(null);
  const exitTimerRef = useRef<number | null>(null);

  useEffect(() => {
    return subscribeToMessages(projectId ?? "");
  }, [projectId, subscribeToMessages]);

  useEffect(() => {
    hydratedRef.current = false;
    snapshotBaselineRef.current = null;
    setToast(null);
    setIsLeaving(false);
    setIsPaused(false);
  }, [projectId]);

  const clearTimers = useCallback(() => {
    if (dismissTimerRef.current !== null) {
      window.clearTimeout(dismissTimerRef.current);
      dismissTimerRef.current = null;
    }
    if (exitTimerRef.current !== null) {
      window.clearTimeout(exitTimerRef.current);
      exitTimerRef.current = null;
    }
  }, []);

  const dismissToast = useCallback(() => {
    if (!toast) return;
    clearTimers();
    setIsLeaving(true);
    exitTimerRef.current = window.setTimeout(() => {
      setToast(null);
      setIsLeaving(false);
      setIsPaused(false);
      exitTimerRef.current = null;
    }, EXIT_DURATION_MS);
  }, [clearTimers, toast]);

  useEffect(() => {
    if (!toast || isPaused) return;
    dismissTimerRef.current = window.setTimeout(
      dismissToast,
      TOAST_DURATION_MS,
    );
    return () => {
      if (dismissTimerRef.current !== null) {
        window.clearTimeout(dismissTimerRef.current);
        dismissTimerRef.current = null;
      }
    };
  }, [dismissToast, isPaused, toast]);

  useEffect(() => {
    return clearTimers;
  }, [clearTimers]);

  useEffect(() => {
    if (!projectId || loading) return;

    const latestMessage =
      messages.length > 0 ? messages[messages.length - 1] : null;

    if (!hydratedRef.current) {
      hydratedRef.current = true;
      snapshotBaselineRef.current = latestMessage;
      return;
    }

    if (latestMessage?.id === snapshotBaselineRef.current?.id) return;

    const baselineMessages = getMessagesAfterWatermark(
      messages,
      snapshotBaselineRef.current
        ? {
            messageId: snapshotBaselineRef.current.id,
            timestamp: snapshotBaselineRef.current.createdAt.getTime(),
          }
        : null,
    );
    snapshotBaselineRef.current = latestMessage;

    const persistentWatermark = readChatReadWatermark(
      typeof window === "undefined" ? null : window.localStorage,
      projectId,
    );
    const candidates = getMessagesAfterWatermark(
      baselineMessages,
      persistentWatermark,
    );
    const incomingAll = candidates.filter(
      (msg): msg is ChatMessage =>
        msg.type === "user" &&
        (!user?.uid || msg.senderId !== user.uid) &&
        msg.content.trim().length > 0,
    );

    if (incomingAll.length === 0) return;

    // B4: 사이드바 CHAT 패널이 닫혀 있으면 미읽음 배지 증가. 이 컴포넌트가
    // 전역 채팅 리스너의 단일 소유자라 신규 수신 판정을 여기서 재사용한다.
    // (패널이 열려 있으면 ProjectChat 이 즉시 읽음 처리하므로 세지 않는다.)
    const { chatPanelOpen, incrementUnread } = useChatStore.getState();
    if (!chatPanelOpen) incrementUnread(incomingAll.length);

    const incoming = incomingAll[incomingAll.length - 1];

    clearTimers();
    setIsLeaving(false);
    setIsPaused(false);
    setToast({
      id: incoming.id,
      senderName: incoming.senderName || "Chat",
      content: summarizeMessage(incoming.content),
    });
  }, [clearTimers, loading, messages, projectId, user?.uid]);

  if (!toast || typeof document === "undefined") return null;

  return createPortal(
    <TopToast
      key={toast.id}
      toast={toast}
      isLeaving={isLeaving}
      onDismiss={dismissToast}
      onPauseChange={setIsPaused}
    />,
    document.body,
  );
}
