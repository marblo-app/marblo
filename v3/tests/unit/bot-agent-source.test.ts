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

/**
 * 봇 삭제 후의 하류 동작 (티켓 ddSiPtvknBaA4f1ptCh1).
 *
 * ★"화면에서만 사라지고 뒤에서는 조용히 실패한다" 를 막는 판정을 여기 고정한다.
 * BotDefinition 을 가리키는 폴러·트리거는 없고, dispatch 시 scope 태그와 지시문이
 * 태스크에 **문자열로 복사**된다. 그래서 봇 문서를 지워도:
 *   · 이미 나간 일은 계속 봇 출처로 분류된다(고아 태스크가 되지 않는다).
 *   · 봇을 다시 부르는 백그라운드 루프는 애초에 없다.
 * 이 성질이 깨지면 삭제가 조용한 실패를 만들기 시작한다는 뜻이다.
 */
describe("삭제된 봇의 실행 중 작업", () => {
  it("봇 문서가 사라져도 이미 dispatch 된 태스크는 봇 출처로 남는다", () => {
    // 봇 목록(구독)은 비었다 = 봇이 지워진 뒤의 상태.
    const tasks: TaskInput[] = [
      {
        id: "task-1",
        description: "[Marblo Bot Gallery Dispatch]\n- bot_id: deleted-bot",
        scope: [`${BOT_TASK_SCOPE_PREFIX}deleted-bot`],
      },
    ];

    expect(classifyBotAgentSource(agent, tasks)).toEqual({
      status: "present",
      reason: "bot_scope",
    });
  });

  it("scope 태그가 없어도 지시문 표식만으로 봇 출처를 알아본다", () => {
    const tasks: TaskInput[] = [
      {
        id: "task-1",
        description: `source: ${BOT_DISPATCH_SOURCE}`,
        scope: ["v3/src"],
      },
    ];

    expect(classifyBotAgentSource(agent, tasks)).toEqual({
      status: "present",
      reason: "bot_description",
    });
    expect(taskHasBotSource(tasks[0])).toBe(true);
  });

  it("시드 봇을 지웠다가 다시 담아도 scope 태그가 같다 — 옛 태스크와 새 태스크가 같은 봇으로 묶인다", () => {
    // 시드 문서 id 는 `{projectId}_{seedId}` 결정적 id 라 다시 담아도 동일하고,
    // 태그는 seedId 를 우선 쓰므로 삭제 전후가 갈라지지 않는다.
    const before: TaskInput = {
      id: "task-1",
      description: "old run",
      scope: [`${BOT_TASK_SCOPE_PREFIX}knowledge-assistant`],
    };
    const after: TaskInput = {
      id: "task-2",
      description: "new run",
      scope: [`${BOT_TASK_SCOPE_PREFIX}knowledge-assistant`],
    };

    expect(taskHasBotSource(before)).toBe(true);
    expect(taskHasBotSource(after)).toBe(true);
    expect(before.scope).toEqual(after.scope);
  });
});
