import { describe, expect, it } from "vitest";
import {
  classifyBotAgentSource,
  taskHasBotSource,
} from "../../src/lib/botAgentSource";
import {
  BOT_DISPATCH_SOURCE,
  BOT_TASK_SCOPE_PREFIX,
} from "../../src/lib/botDefinition";
import type { Agent } from "../../src/types/agent";
import type { Task } from "../../src/types/task";

type AgentInput = Pick<Agent, "currentTaskId">;
type TaskInput = Pick<Task, "id" | "description" | "scope">;

const agent: AgentInput = { currentTaskId: "task-1" };

describe("classifyBotAgentSource", () => {
  it("봇 scope 표식이 있으면 봇 출처로 판정한다", () => {
    const tasks: TaskInput[] = [
      {
        id: "task-1",
        description: "ordinary task body",
        scope: [`${BOT_TASK_SCOPE_PREFIX}jarvis`],
      },
    ];

    expect(classifyBotAgentSource(agent, tasks)).toEqual({
      status: "present",
      reason: "bot_scope",
    });
  });

  it("scope가 없어도 dispatch description 표식이 있으면 봇 출처로 판정한다", () => {
    const task: TaskInput = {
      id: "task-1",
      description: `[Marblo Bot Gallery Dispatch]\nsource: ${BOT_DISPATCH_SOURCE}`,
      scope: [],
    };

    expect(taskHasBotSource(task)).toBe(true);
    expect(classifyBotAgentSource(agent, [task])).toEqual({
      status: "present",
      reason: "bot_description",
    });
  });

  it("연결 티켓에 표식이 없으면 봇 출처가 아니라고 판정한다", () => {
    const tasks: TaskInput[] = [
      { id: "task-1", description: "manual frontend task", scope: ["v3/src"] },
    ];

    expect(classifyBotAgentSource(agent, tasks)).toEqual({
      status: "absent",
      reason: "not_bot_task",
    });
  });

  it("에이전트의 연결 티켓을 모르면 unknown으로 둔다", () => {
    expect(classifyBotAgentSource({ currentTaskId: null }, [])).toEqual({
      status: "unknown",
      reason: "no_task",
    });
    expect(classifyBotAgentSource(agent, [])).toEqual({
      status: "unknown",
      reason: "task_not_loaded",
    });
  });
});
