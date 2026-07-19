// Regression: an id copied from get_agents is an agent id. get_task should not
// report an ambiguous task not-found when that id has a connected currentTaskId.
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { doc, setDoc, __resetStore } from "../mocks/firebase-firestore";

// firebase.ts 는 이제 익명 폴백 없이 custom token 으로만 로그인한다. 테스트
// 프로세스가 (에이전트 env 로부터) 실제 토큰을 상속받았어도 mock 경로만 타도록
// 지우고, 인증 게이트는 명시적 opt-in 으로 통과시킨다 — import 전에 실행돼야
// 하므로 vi.hoisted 를 쓴다.
vi.hoisted(() => {
  delete process.env.MARBLO_FIREBASE_CUSTOM_TOKEN;
  process.env.MARBLO_MCP_ALLOW_UNAUTHENTICATED = "1";
});

vi.mock("firebase/auth", () => ({
  getAuth: () => ({}),
  signInWithCustomToken: () => Promise.resolve({ user: { uid: "test-user" } }),
}));

import { registerTools } from "../../electron/mcp-server/tools";

interface ToolResult {
  content: Array<{ type: "text"; text: string }>;
}

type ToolHandler = (args: Record<string, unknown>) => Promise<ToolResult>;

const originalBridgePort = process.env.MARBLO_BRIDGE_PORT;

function resultText(result: ToolResult): string {
  return result.content[0]?.text ?? "";
}

function registerHandlers(): Map<string, ToolHandler> {
  const handlers = new Map<string, ToolHandler>();
  const server = {
    tool: (
      name: string,
      _description: string,
      _schema: unknown,
      handler: ToolHandler,
    ): void => {
      handlers.set(name, handler);
    },
  } as unknown as McpServer;

  registerTools(server);
  return handlers;
}

function getHandler(
  handlers: Map<string, ToolHandler>,
  name: string,
): ToolHandler {
  const handler = handlers.get(name);
  if (!handler) throw new Error(`Missing handler: ${name}`);
  return handler;
}

describe("MCP get_task agent id mismatch", () => {
  beforeEach(() => {
    __resetStore();
    process.env.MARBLO_BRIDGE_PORT = "65535";
    vi.stubGlobal(
      "fetch",
      vi.fn(async (): Promise<Response> => {
        return {
          json: async () => ({
            agents: [
              {
                id: "agent-abc123",
                name: "backend-worker",
                model: "codex",
                role: "backend",
                status: "working",
                ptySessionId: "pty-1",
                currentTaskId: "task-xyz789",
                restartCount: 0,
              },
            ],
          }),
        } as Response;
      }),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    if (originalBridgePort) {
      process.env.MARBLO_BRIDGE_PORT = originalBridgePort;
    } else {
      delete process.env.MARBLO_BRIDGE_PORT;
    }
  });

  it("explains that a get_agents id is an agent id and points at currentTaskId", async () => {
    const projectId = process.env.MARBLO_PROJECT || "project-1";
    const db = {} as never;
    await setDoc(doc(db, "agents", "agent-abc123"), {
      projectId,
      name: "backend-worker",
      model: "codex",
      role: "backend",
      status: "working",
      currentTaskId: "task-xyz789",
    });
    await setDoc(doc(db, "tasks", "task-xyz789"), {
      projectId,
      contextId: "",
      title: "Fix task registry lookup",
      description: "real task",
      status: "IN_PROGRESS",
      role: "backend",
      priority: 3,
      dependsOn: [],
      dependsOnCompleted: true,
      claimedBy: "agent-abc123",
      scope: [],
      comment: "",
      prUrl: "",
      hasPmFeedback: false,
    });

    const handlers = registerHandlers();
    const agentsText = resultText(await getHandler(handlers, "get_agents")({}));
    expect(agentsText).toContain("agentId=agent-abc123");
    expect(agentsText).toContain("currentTaskId=task-xyz789");

    const wrongIdText = resultText(
      await getHandler(handlers, "get_task")({ task_id: "agent-abc123" }),
    );
    expect(wrongIdText).toContain("'agent-abc123' is an agent id");
    expect(wrongIdText).toContain("not a task id");
    expect(wrongIdText).toContain("currentTaskId=task-xyz789");

    const taskText = resultText(
      await getHandler(handlers, "get_task")({ task_id: "task-xyz789" }),
    );
    expect(taskText).toContain("ID: task-xyz789");
    expect(taskText).toContain("Title: Fix task registry lookup");
  });
});
