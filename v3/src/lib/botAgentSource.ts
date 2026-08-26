import type { Agent } from "../types/agent";
import type { Task } from "../types/task";
import { BOT_DISPATCH_SOURCE, BOT_TASK_SCOPE_PREFIX } from "./botDefinition";

export type BotAgentSourceStatus = "present" | "absent" | "unknown";

export interface BotAgentSourceVerdict {
  status: BotAgentSourceStatus;
  reason:
    | "bot_scope"
    | "bot_description"
    | "no_task"
    | "task_not_loaded"
    | "not_bot_task";
}

type AgentSourceInput = Pick<Agent, "currentTaskId">;
type TaskSourceInput = Pick<Task, "id" | "description" | "scope">;

export function taskHasBotSource(
  task: Pick<Task, "description" | "scope">,
): boolean {
  if (task.scope.some((item) => item.startsWith(BOT_TASK_SCOPE_PREFIX))) {
    return true;
  }
  return (
    task.description.includes(`[Marblo Bot Gallery Dispatch]`) ||
    task.description.includes(`source: ${BOT_DISPATCH_SOURCE}`) ||
    task.description.includes(`source=${BOT_DISPATCH_SOURCE}`)
  );
}

export function classifyBotAgentSource(
  agent: AgentSourceInput,
  tasks: TaskSourceInput[],
): BotAgentSourceVerdict {
  if (!agent.currentTaskId) {
    return { status: "unknown", reason: "no_task" };
  }

  const task = tasks.find((item) => item.id === agent.currentTaskId);
  if (!task) {
    return { status: "unknown", reason: "task_not_loaded" };
  }

  if (task.scope.some((item) => item.startsWith(BOT_TASK_SCOPE_PREFIX))) {
    return { status: "present", reason: "bot_scope" };
  }

  if (taskHasBotSource(task)) {
    return { status: "present", reason: "bot_description" };
  }

  return { status: "absent", reason: "not_bot_task" };
}
