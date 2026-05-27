import { useState, useRef, useEffect, useCallback } from "react";
import { useChatStore } from "../../stores/chatStore";
import { useProjectStore } from "../../stores/projectStore";
import { useAgentStore } from "../../stores/agentStore";
import { useAuth } from "../../hooks/useAuth";
import { addPendingInstruction } from "../../services/pendingInstructionService";
import { sendSystemMessage } from "../../services/chatService";
import type { ChatMessage } from "../../types/chat";

function timeAgo(date: Date): string {
  const seconds = Math.floor((Date.now() - date.getTime()) / 1000);
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

interface MentionTarget {
  name: string;
  type: "orchestrator" | "agent";
}

function MentionDropdown({
  filter,
  targets,
  onSelect,
}: {
  filter: string;
  targets: MentionTarget[];
  onSelect: (target: MentionTarget) => void;
}) {
  const filtered = targets.filter((t) =>
    t.name.toLowerCase().includes(filter.toLowerCase())
  );
  if (filtered.length === 0) return null;

  return (
    <div className="absolute bottom-full left-0 mb-1 w-56 rounded-lg border border-gray-600 bg-gray-800 py-1 shadow-xl">
      {filtered.map((t) => (
        <button
          key={t.name}
          onClick={() => onSelect(t)}
          className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm hover:bg-gray-700"
        >
          <span
            className={`h-2 w-2 rounded-full ${
              t.type === "orchestrator" ? "bg-blue-400" : "bg-green-400"
            }`}
          />
          <span className="text-gray-200">@{t.name}</span>
          <span className="ml-auto text-xs text-gray-500">{t.type}</span>
        </button>
      ))}
    </div>
  );
}

function MessageBubble({ msg }: { msg: ChatMessage }) {
  if (msg.type === "system") {
    return (
      <div className="flex items-center justify-center gap-2 py-1">
        <div className="h-px flex-1 bg-gray-700/50" />
        <span className="text-xs text-gray-500">{msg.content}</span>
        <div className="h-px flex-1 bg-gray-700/50" />
      </div>
    );
  }

  const isAgent = msg.type === "agent";
  const isMention = msg.content.startsWith("@");

  return (
    <div className={`flex gap-2.5 ${isAgent ? "items-start" : "items-start"}`}>
      {/* Avatar */}
      {msg.senderPhotoURL ? (
        <img
          src={msg.senderPhotoURL}
          alt={msg.senderName}
          className="h-7 w-7 flex-shrink-0 rounded-full"
        />
      ) : (
        <div
          className={`flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full text-xs font-bold ${
            isAgent ? "bg-blue-600 text-white" : "bg-gray-600 text-gray-300"
          }`}
        >
          {msg.senderName.charAt(0).toUpperCase()}
        </div>
      )}

      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-2">
          <span
            className={`text-xs font-semibold ${
              isAgent ? "text-blue-400" : "text-gray-300"
            }`}
          >
            {msg.senderName}
          </span>
          <span className="text-xs text-gray-600">
            {timeAgo(msg.createdAt)}
          </span>
        </div>
        <div
          className={`mt-0.5 rounded-lg px-3 py-1.5 text-sm ${
            isMention
              ? "border-l-2 border-purple-500 bg-purple-500/10 text-gray-200"
              : isAgent
              ? "border-l-2 border-blue-500 bg-blue-500/10 text-gray-200"
              : "bg-gray-700/50 text-gray-200"
          }`}
        >
          <p className="whitespace-pre-wrap break-words">{msg.content}</p>
          {msg.taskId && (
            <div className="mt-1 flex items-center gap-1 text-xs text-blue-400">
              <span>📋</span>
              <span>{msg.taskTitle || msg.taskId.slice(0, 8)}</span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export function ProjectChat() {
  const { user } = useAuth();
  const currentProject = useProjectStore((s) => s.currentProject);
  const { messages, loading, sendMessage, subscribeToMessages, resetUnread } =
    useChatStore();
  const agents = useAgentStore((s) => s.agents);

  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [showMention, setShowMention] = useState(false);
  const [mentionFilter, setMentionFilter] = useState("");
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // Subscribe to messages
  useEffect(() => {
    if (!currentProject) return;
    const unsub = subscribeToMessages(currentProject.id);
    return unsub;
  }, [currentProject, subscribeToMessages]);

  // Auto-scroll
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  // Reset unread when visible
  useEffect(() => {
    resetUnread();
  }, [messages.length, resetUnread]);

  // Build mention targets
  const mentionTargets: MentionTarget[] = [
    { name: "orchestrator", type: "orchestrator" },
    ...agents
      .filter((a) => a.status !== "stopped")
      .map((a) => ({ name: a.name, type: "agent" as const })),
  ];

  const handleMentionSelect = useCallback((target: MentionTarget) => {
    setInput((prev) => {
      const atIdx = prev.lastIndexOf("@");
      return atIdx >= 0
        ? prev.slice(0, atIdx) + `@${target.name} `
        : `@${target.name} `;
    });
    setShowMention(false);
    inputRef.current?.focus();
  }, []);

  const handleInputChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const value = e.target.value;
    setInput(value);

    // Detect @ mention
    const atIdx = value.lastIndexOf("@");
    if (atIdx >= 0) {
      const afterAt = value.slice(atIdx + 1);
      if (!afterAt.includes(" ")) {
        setShowMention(true);
        setMentionFilter(afterAt);
        return;
      }
    }
    setShowMention(false);
  };

  const handleSend = async () => {
    if (!input.trim() || !currentProject || !user || sending) return;
    const content = input.trim();
    setInput("");
    setSending(true);

    try {
      // Check for @mention → PTY injection
      const mentionMatch = content.match(/^@(\S+)\s+([\s\S]+)/);
      if (mentionMatch) {
        const target = mentionMatch[1];
        const instruction = mentionMatch[2];

        if (target === "orchestrator" || target === "오케") {
          // Fast path: local orchestrator PTY exists → write directly.
          // Otherwise enqueue into pendingInstructions with targetAgentId =
          // `orch-${projectId}`; the machine hosting the orchestrator has
          // a listener attached at that key (see main.ts orchestratorSession
          // launch handler) that atomically flips delivery and injects PTY.
          let injected = false;
          try {
            const ptySessions = await window.electronAPI.pty.list();
            const orchSession = ptySessions.find(
              (s: { id: string; name: string }) =>
                s.name.toLowerCase().includes("orchestrator")
            );
            if (orchSession) {
              await window.electronAPI.pty.write(
                orchSession.id,
                instruction + "\r"
              );
              injected = true;
            }
          } catch (err) {
            console.warn("Failed local orchestrator PTY write", err);
          }

          if (!injected) {
            try {
              await addPendingInstruction({
                projectId: currentProject.id,
                taskId: null,
                targetAgentId: `orch-${currentProject.id}`,
                message: instruction,
                sourceType: "orchestrator",
                fromUserId: user.uid,
                fromUserName: user.displayName || "User",
              });
            } catch (err) {
              console.error(
                "Failed to enqueue orchestrator pending instruction:",
                err
              );
              await sendSystemMessage(
                currentProject.id,
                "⚠️ 오케스트레이터 큐 등록에 실패했습니다."
              );
            }
          }
        } else {
          const agent = agents.find(
            (a) => a.name.toLowerCase() === target.toLowerCase()
          );
          if (agent) {
            // Fast path: agent is hosted on THIS machine — write straight
            // to the local PTY. Cross-machine agents (agent.ownerId !==
            // this user) go through the Firestore `pendingInstructions`
            // queue, where the hosting machine's listener picks it up.
            const isLocalAgent = !!user && agent.ownerId === user.uid;
            let injected = false;

            if (isLocalAgent) {
              try {
                const ptySessionId = `agent-${agent.id}`;
                await window.electronAPI.pty.write(
                  ptySessionId,
                  instruction + "\r"
                );
                injected = true;
              } catch {
                console.warn(
                  `Failed local PTY write to agent "${target}" — falling back to pending queue`
                );
              }
            }

            if (!injected) {
              try {
                await addPendingInstruction({
                  projectId: currentProject.id,
                  targetAgentId: agent.id,
                  message: instruction,
                  sourceType: "chat",
                  fromUserId: user.uid,
                  fromUserName: user.displayName || "User",
                });
              } catch (err) {
                console.error(
                  `Failed to enqueue pending instruction for agent "${target}":`,
                  err
                );
              }
            }
          } else {
            console.warn(`Agent "${target}" not found in project`);
          }
        }
      }

      // Always post to chat
      await sendMessage(
        currentProject.id,
        user.uid,
        user.displayName || "User",
        user.photoURL || "",
        content
      );
    } catch (err) {
      console.error("Failed to send message:", err);
    } finally {
      setSending(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  if (!currentProject) {
    return (
      <div className="flex h-full items-center justify-center">
        <p className="text-xs text-gray-500">프로젝트를 선택하세요</p>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      {/* Messages */}
      <div className="flex-1 overflow-y-auto p-3 space-y-3">
        {loading && messages.length === 0 && (
          <div className="flex h-full items-center justify-center">
            <div className="h-5 w-5 animate-spin rounded-full border-2 border-gray-600 border-t-blue-400" />
          </div>
        )}

        {!loading && messages.length === 0 && (
          <div className="flex h-full items-center justify-center">
            <div className="text-center">
              <p className="text-xs text-gray-500">메시지가 없습니다</p>
              <p className="mt-1 text-xs text-gray-600">팀 채팅을 시작하세요</p>
            </div>
          </div>
        )}

        {messages
          .filter((msg) => msg.type === "user")
          .map((msg) => (
            <MessageBubble key={msg.id} msg={msg} />
          ))}
        <div ref={messagesEndRef} />
      </div>

      {/* Input */}
      <div className="relative border-t border-gray-700 p-2">
        {showMention && (
          <MentionDropdown
            filter={mentionFilter}
            targets={mentionTargets}
            onSelect={handleMentionSelect}
          />
        )}
        <div className="flex items-end gap-2">
          <textarea
            ref={inputRef}
            value={input}
            onChange={handleInputChange}
            onKeyDown={handleKeyDown}
            placeholder="메시지 입력... (@로 멘션)"
            rows={1}
            className="flex-1 resize-none rounded-lg border border-gray-600 bg-gray-800 px-3 py-2 text-sm text-gray-200 placeholder-gray-500 focus:border-blue-500 focus:outline-none"
            disabled={sending}
          />
          <button
            onClick={handleSend}
            disabled={!input.trim() || sending}
            className="rounded-lg bg-blue-600 p-2 text-white hover:bg-blue-700 disabled:opacity-50"
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
                d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8"
              />
            </svg>
          </button>
        </div>
      </div>
    </div>
  );
}
