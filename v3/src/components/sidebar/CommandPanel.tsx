import { useCallback, useState } from "react";
import {
  SLASH_COMMANDS,
  SLASH_PROMPTS,
  CATEGORY_LABELS,
} from "../orchestrator/SlashCommandPopup";
import { useOrchestratorStore } from "../../stores/orchestratorStore";
import { useSubscriptionStore } from "../../stores/subscriptionStore";

interface CommandPanelProps {
  onOpenOrchestrator?: () => void;
  onOpenCreateTask?: () => void;
}

export function CommandPanel({
  onOpenOrchestrator,
  onOpenCreateTask,
}: CommandPanelProps) {
  const ptySessionId = useOrchestratorStore((s) => s.ptySessionId);
  const status = useOrchestratorStore((s) => s.status);
  const canUse = useSubscriptionStore((s) => s.canUse);
  const [sending, setSending] = useState<string | null>(null);

  const isRunning = status === "running";

  const handleCommand = useCallback(
    async (command: string) => {
      const prompt = SLASH_PROMPTS[command];
      if (!prompt || !ptySessionId) return;

      setSending(command);
      try {
        // 주입 메시지는 writeAndSubmit(verify-and-retry CR)로 보낸다. plain
        // write + '\r'는 메인 루프 혼잡 시 CR이 paste 버퍼에 흡수돼 composer에
        // 텍스트만 남고 제출이 안 되는 경합이 있다(FeedbackInput과 동일 버그).
        await window.electronAPI.pty.writeAndSubmit(ptySessionId, prompt);
      } finally {
        setTimeout(() => setSending(null), 500);
      }
    },
    [ptySessionId]
  );

  // Group commands by category
  const categories = [
    "project",
    "project-step",
    "agent",
    "work",
    "pause",
    "review",
    "deploy",
    "sync",
    "repeat",
    "util",
  ] as const;

  return (
    <div className="flex flex-1 flex-col overflow-y-auto py-1">
      {/* Orchestrator status */}
      <div className="px-3 py-2">
        <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-gray-400">
          <svg
            className="h-3.5 w-3.5 text-blue-400"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M13 10V3L4 14h7v7l9-11h-7z"
            />
          </svg>
          오케스트레이터
          <span
            className={`ml-auto h-2 w-2 rounded-full ${
              isRunning ? "bg-green-400" : "bg-gray-600"
            }`}
          />
        </div>
        {!isRunning && (
          <p className="mt-1 text-[11px] text-gray-500">
            오케스트레이터가 실행 중이 아닙니다
          </p>
        )}
      </div>

      {/* Slash commands grouped by category */}
      {categories.map((cat) => {
        const cmds = SLASH_COMMANDS.filter((c) => c.category === cat);
        if (cmds.length === 0) return null;
        const catInfo = CATEGORY_LABELS[cat];

        return (
          <div key={cat}>
            <div className="px-3 pt-2 pb-1">
              <div className="text-[10px] font-medium uppercase tracking-wider text-gray-500">
                {catInfo.icon} {catInfo.label}
              </div>
            </div>
            <div className="space-y-0.5 px-2">
              {cmds.map((cmd) => (
                <button
                  key={cmd.command}
                  onClick={() => handleCommand(cmd.command)}
                  disabled={!isRunning || sending === cmd.command}
                  className={`group flex w-full items-center gap-2.5 rounded-md border px-2 py-1.5 text-left transition-colors ${
                    isRunning
                      ? "border-transparent hover:border-blue-500/40 hover:bg-blue-500/10"
                      : "cursor-not-allowed border-transparent opacity-60"
                  } ${
                    sending === cmd.command
                      ? "border-blue-500/50 bg-blue-500/15"
                      : ""
                  }`}
                >
                  <span
                    className={`flex h-5 w-5 flex-shrink-0 items-center justify-center rounded text-[11px] font-bold transition-colors ${
                      isRunning
                        ? "bg-blue-500/20 text-blue-400 group-hover:bg-blue-500/30"
                        : "bg-gray-700/50 text-gray-500"
                    }`}
                  >
                    /
                  </span>
                  <span className="flex min-w-0 flex-1 flex-col">
                    <span
                      className={`truncate font-mono text-[12px] font-semibold ${
                        isRunning ? "text-blue-300" : "text-gray-500"
                      }`}
                    >
                      {cmd.label}
                    </span>
                    <span className="truncate text-[11px] text-gray-400">
                      {cmd.description}
                    </span>
                  </span>
                  {sending === cmd.command && (
                    <span className="flex-shrink-0 text-[10px] text-blue-400">
                      전송…
                    </span>
                  )}
                </button>
              ))}
            </div>
          </div>
        );
      })}

      {/* Divider */}
      <div className="mx-3 my-2 border-t border-gray-700" />

      {/* Board section */}
      <div className="px-3 py-2">
        <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-gray-400">
          <svg
            className="h-3.5 w-3.5 text-purple-400"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2"
            />
          </svg>
          보드
        </div>
      </div>

      <div className="space-y-0.5 px-2">
        {/* AI Decompose */}
        {canUse("orchestrator") && (
          <button
            onClick={onOpenOrchestrator}
            className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-[13px] text-gray-300 hover:bg-gray-700"
          >
            <span className="flex h-5 w-5 flex-shrink-0 items-center justify-center rounded bg-purple-500/20 text-[10px] text-purple-400">
              <svg
                className="h-3 w-3"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M13 10V3L4 14h7v7l9-11h-7z"
                />
              </svg>
            </span>
            <span className="flex-1">AI 태스크 분해</span>
          </button>
        )}

        {/* Create Task */}
        <button
          onClick={onOpenCreateTask}
          className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-[13px] text-gray-300 hover:bg-gray-700"
        >
          <span className="flex h-5 w-5 flex-shrink-0 items-center justify-center rounded bg-gray-700/50 text-[12px] text-green-400">
            +
          </span>
          <span className="flex-1">새 태스크 추가</span>
        </button>
      </div>
    </div>
  );
}
