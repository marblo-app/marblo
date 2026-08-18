import { describe, it, expect } from "vitest";
import { responsesRequestToChatCompletions } from "../../electron/codex-chat-bridge";

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
});
