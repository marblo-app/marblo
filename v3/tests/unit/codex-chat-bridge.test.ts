import { describe, it, expect } from "vitest";
import {
  extractFreeformToolInput,
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

/**
 * ★apply_patch 왕복.
 *
 * codex 는 apply_patch 를 JSON function 이 아니라 lark 문법을 실은
 * `type:"custom"` 도구로 보낸다. Chat Completions 규격엔 그 타입이 없어서 종전
 * 변환기는 이 도구를 통째로 버렸다 — 모델 카탈로그를 고쳐 codex 가 apply_patch 를
 * 등록해도 Upstage 는 브리지에서 다시 잃어버린다는 뜻이다(실측: 브리지가
 * upstream 에 넘긴 tools 에 apply_patch 부재 → 편집 실패).
 */
interface ChatFunction {
  name: string;
  description?: string;
  parameters?: unknown;
}
type ToolFn = string | ChatFunction;

describe("freeform (custom) tools — apply_patch", () => {
  const APPLY_PATCH_TOOL = {
    type: "custom",
    name: "apply_patch",
    description: "The `apply_patch` tool can be used to edit files.",
    format: {
      type: "grammar",
      syntax: "lark",
      definition: "start: begin_patch hunk+ end_patch",
    },
  };

  it("folds a custom tool into a Chat function with a single `input` string", () => {
    const toolNames = new Map<string, NamespacedToolName>();
    const chat = responsesRequestToChatCompletions(
      { model: "solar-pro4", input: "x", tools: [APPLY_PATCH_TOOL] },
      toolNames,
    );
    const tools = chat.tools as Array<Record<string, ToolFn>>;
    expect(tools).toHaveLength(1);
    expect(tools[0]!.type).toBe("function");
    const fn = tools[0]!.function as ChatFunction;
    expect(fn.name).toBe("apply_patch");
    expect(fn.parameters).toEqual({
      type: "object",
      properties: { input: { type: "string", description: expect.any(String) } },
      required: ["input"],
      additionalProperties: false,
    });
    // 문법을 강제할 수 없으니 description 으로 실어 보낸다.
    expect(fn.description).toContain("start: begin_patch hunk+ end_patch");
    // 응답 복원 때 custom 으로 되펴야 하므로 표식이 남는다.
    expect(toolNames.get("apply_patch")).toEqual({
      name: "apply_patch",
      freeform: true,
    });
  });

  it("keeps namespace flattening (#1046) working alongside custom tools", () => {
    const toolNames = new Map<string, NamespacedToolName>();
    const chat = responsesRequestToChatCompletions(
      {
        model: "solar-pro4",
        input: "x",
        tools: [
          APPLY_PATCH_TOOL,
          {
            type: "namespace",
            name: "mcp__marblo",
            tools: [
              { type: "function", name: "add_activity", parameters: {} },
            ],
          },
        ],
      },
      toolNames,
    );
    const names = (chat.tools as Array<Record<string, ToolFn>>).map(
      (t) => (t.function as ChatFunction).name,
    );
    expect(names).toEqual(["apply_patch", "mcp__marblo__add_activity"]);
    expect(toolNames.get("mcp__marblo__add_activity")).toEqual({
      name: "add_activity",
      namespace: "mcp__marblo",
    });
  });

  it("replays custom_tool_call history as the same function upstream saw", () => {
    const chat = responsesRequestToChatCompletions({
      model: "solar-pro4",
      input: [
        { type: "message", role: "user", content: [{ type: "input_text", text: "go" }] },
        {
          type: "custom_tool_call",
          call_id: "call_1",
          name: "apply_patch",
          input: "*** Begin Patch\n*** End Patch\n",
        },
        {
          type: "custom_tool_call_output",
          call_id: "call_1",
          output: "Success. Updated the following files:\nM a.txt\n",
        },
      ],
    });
    expect(chat.messages).toEqual([
      { role: "user", content: "go" },
      {
        role: "assistant",
        content: null,
        tool_calls: [
          {
            id: "call_1",
            type: "function",
            function: {
              name: "apply_patch",
              arguments: JSON.stringify({
                input: "*** Begin Patch\n*** End Patch\n",
              }),
            },
          },
        ],
      },
      {
        role: "tool",
        tool_call_id: "call_1",
        content: "Success. Updated the following files:\nM a.txt\n",
      },
    ]);
  });
});

describe("extractFreeformToolInput", () => {
  const patch = "*** Begin Patch\n*** Update File: a.txt\n@@\n-a\n+b\n*** End Patch\n";

  it("unwraps the documented {\"input\": ...} shape", () => {
    expect(extractFreeformToolInput(JSON.stringify({ input: patch }))).toBe(patch);
  });

  it("falls back to the raw text when the model ignores the schema", () => {
    // 인자를 버리면 편집이 조용히 사라진다 — 원문으로 본다.
    expect(extractFreeformToolInput(patch)).toBe(patch);
  });

  it("accepts a bare JSON string and a single-key object", () => {
    expect(extractFreeformToolInput(JSON.stringify(patch))).toBe(patch);
    expect(extractFreeformToolInput(JSON.stringify({ patch }))).toBe(patch);
    expect(extractFreeformToolInput(JSON.stringify({ whatever: patch }))).toBe(patch);
  });

  it("returns empty for empty arguments", () => {
    expect(extractFreeformToolInput("   ")).toBe("");
  });
});
