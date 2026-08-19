import { describe, it, expect } from "vitest";
import {
  flattenNamespacedToolName,
  responsesRequestToChatCompletions,
  type NamespacedToolName,
} from "../../electron/codex-chat-bridge";

describe("responsesRequestToChatCompletions", () => {
  it("maps instructions + string input to system/user messages", () => {
    const chat = responsesRequestToChatCompletions({
      model: "solar-pro4",
      instructions: "You are helpful.",
      input: "Say hi",
      stream: true,
    });
    expect(chat.model).toBe("solar-pro4");
    expect(chat.stream).toBe(true);
    expect(chat.messages).toEqual([
      { role: "system", content: "You are helpful." },
      { role: "user", content: "Say hi" },
    ]);
  });

  it("maps Responses function tools to Chat nested function shape", () => {
    const chat = responsesRequestToChatCompletions({
      model: "solar-pro4",
      input: "x",
      tools: [
        {
          type: "function",
          name: "exec_command",
          description: "run",
          parameters: { type: "object", properties: {} },
        },
        { type: "web_search" },
      ],
      tool_choice: "auto",
    });
    expect(chat.tools).toEqual([
      {
        type: "function",
        function: {
          name: "exec_command",
          description: "run",
          parameters: { type: "object", properties: {} },
        },
      },
    ]);
    expect(chat.tool_choice).toBe("auto");
  });

  it("maps function_call_output items to role=tool messages", () => {
    const chat = responsesRequestToChatCompletions({
      model: "solar-pro4",
      input: [
        {
          type: "function_call",
          call_id: "call_1",
          name: "exec_command",
          arguments: '{"cmd":"ls"}',
        },
        {
          type: "function_call_output",
          call_id: "call_1",
          output: "ok",
        },
      ],
    });
    expect(chat.messages).toEqual([
      {
        role: "assistant",
        content: null,
        tool_calls: [
          {
            id: "call_1",
            type: "function",
            function: {
              name: "exec_command",
              arguments: '{"cmd":"ls"}',
            },
          },
        ],
      },
      {
        role: "tool",
        tool_call_id: "call_1",
        content: "ok",
      },
    ]);
  });

  // ★2026-08-19 회귀 방지. codex 0.148.0 은 MCP 도구를 개별 function 이 아니라
  //   {type:"namespace"} 한 덩어리로 보낸다. 종전 필터가 이걸 버려서 solar
  //   에이전트가 marblo 도구를 하나도 못 봤다(녹음 프록시 실측: 23개 전량 소실).
  it("flattens namespace tool groups into Chat function tools", () => {
    const toolNames = new Map<string, NamespacedToolName>();
    const chat = responsesRequestToChatCompletions(
      {
        model: "solar-pro4",
        input: "x",
        tools: [
          { type: "function", name: "exec_command", parameters: {} },
          {
            type: "namespace",
            name: "mcp__marblo",
            description: "Tools in the mcp__marblo namespace.",
            tools: [
              {
                type: "function",
                name: "add_activity",
                description: "log",
                strict: false,
                parameters: { type: "object", properties: {} },
              },
              {
                type: "function",
                name: "update_task_status",
                description: "status",
                parameters: { type: "object", properties: {} },
              },
            ],
          },
          { type: "web_search", external_web_access: true },
        ],
      },
      toolNames,
    );

    const names = (chat.tools as Array<{ function: { name: string } }>).map(
      (t) => t.function.name,
    );
    expect(names).toEqual([
      "exec_command",
      "mcp__marblo__add_activity",
      "mcp__marblo__update_task_status",
    ]);
    expect(toolNames.get("mcp__marblo__add_activity")).toEqual({
      name: "add_activity",
      namespace: "mcp__marblo",
    });
    // 평탄화 대상이 아닌 top-level function 은 맵에 넣지 않는다.
    expect(toolNames.has("exec_command")).toBe(false);
    // hosted 도구는 Chat 규격에 없어 여전히 제외된다.
    expect(names).not.toContain("web_search");
  });

  it("re-flattens namespaced function_call history so upstream sees one name", () => {
    const chat = responsesRequestToChatCompletions({
      model: "solar-pro4",
      input: [
        {
          type: "function_call",
          call_id: "call_1",
          name: "add_activity",
          namespace: "mcp__marblo",
          arguments: '{"task_id":"t"}',
        },
        { type: "function_call_output", call_id: "call_1", output: "ok" },
      ],
    });
    const messages = chat.messages as Array<Record<string, unknown>>;
    const toolCalls = messages[0].tool_calls as Array<{
      function: { name: string };
    }>;
    expect(toolCalls[0].function.name).toBe("mcp__marblo__add_activity");
  });

  it("keeps flattened names inside the OpenAI 64-char function-name limit", () => {
    const long = "a".repeat(80);
    const flat = flattenNamespacedToolName("mcp__marblo", long);
    expect(flat.length).toBeLessThanOrEqual(64);
    // 서로 다른 도구가 같은 이름으로 무너지지 않는다.
    expect(flat).not.toBe(flattenNamespacedToolName("mcp__marblo", long + "b"));
    // namespace 가 없으면 이름을 건드리지 않는다.
    expect(flattenNamespacedToolName("", "add_activity")).toBe("add_activity");
  });
});
