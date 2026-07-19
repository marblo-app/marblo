import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("firebase/auth", () => ({
  // 인증된(비익명) 사용자 — main 의 auditedTool 인증 게이트
  // (ensureAuthenticated) 를 통과시켜 이 테스트가 stale-session 가드
  // 동작만 격리 검증하게 한다. 익명이면 게이트가 bridge 재인증 fetch 를
  // 먼저 쏴서 아래 validate 전용 mock 과 충돌한다.
  getAuth: () => ({ currentUser: { uid: "real-user", isAnonymous: false } }),
  signInAnonymously: () => Promise.resolve(),
  signInWithCustomToken: () => Promise.resolve(),
}));

interface ToolResult {
  content: Array<{ type: "text"; text: string }>;
}

type ToolHandler = (args: Record<string, unknown>) => Promise<ToolResult>;

const savedEnv = {
  MARBLO_AGENT_ID: process.env.MARBLO_AGENT_ID,
  MARBLO_PROJECT: process.env.MARBLO_PROJECT,
  MARBLO_CONTEXT: process.env.MARBLO_CONTEXT,
  MARBLO_BRIDGE_PORT: process.env.MARBLO_BRIDGE_PORT,
  MARBLO_ORCHESTRATOR_PTY_SESSION_ID:
    process.env.MARBLO_ORCHESTRATOR_PTY_SESSION_ID,
};

function resultText(result: ToolResult): string {
  return result.content[0]?.text ?? "";
}

function getHandler(
  handlers: Map<string, ToolHandler>,
  name: string,
): ToolHandler {
  const handler = handlers.get(name);
  if (!handler) throw new Error(`Missing handler: ${name}`);
  return handler;
}

async function registerHandlers(): Promise<Map<string, ToolHandler>> {
  const { registerTools } = await import("../../electron/mcp-server/tools");
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

describe("MCP orchestrator live-session guard", () => {
  beforeEach(() => {
    vi.resetModules();
    process.env.MARBLO_AGENT_ID = "orchestrator-project-1";
    process.env.MARBLO_PROJECT = "project-1";
    process.env.MARBLO_CONTEXT = "board";
    process.env.MARBLO_BRIDGE_PORT = "65535";
    process.env.MARBLO_ORCHESTRATOR_PTY_SESSION_ID = "pty-old";
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    for (const [key, value] of Object.entries(savedEnv)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  it("refuses a stale orchestrator write before mutating Firestore", async () => {
    const firestore = await import("../mocks/firebase-firestore");
    firestore.__resetStore();
    const db = {} as never;
    await firestore.setDoc(firestore.doc(db, "tasks", "task-1"), {
      projectId: "project-1",
      contextId: "board",
      title: "Do not let the old orchestrator write",
      description: "",
      status: "IN_PROGRESS",
      role: "backend",
      priority: 3,
      dependsOn: [],
      dependsOnCompleted: true,
      claimedBy: "agent-backend",
      scope: [],
      comment: "",
      prUrl: "",
      hasPmFeedback: false,
    });

    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      const body =
        typeof init?.body === "string"
          ? (JSON.parse(init.body) as Record<string, unknown>)
          : {};
      expect(body).toMatchObject({
        projectId: "project-1",
        contextId: "board",
        ptySessionId: "pty-old",
        agentId: "orchestrator-project-1",
        toolName: "update_task_status",
      });
      return {
        ok: true,
        json: async () => ({
          success: true,
          valid: false,
          reason: "stale orchestrator PTY session",
        }),
      } as Response;
    });
    vi.stubGlobal("fetch", fetchMock);

    const handlers = await registerHandlers();
    const output = resultText(
      await getHandler(handlers, "update_task_status")({
        task_id: "task-1",
        status: "FAILED",
        comment: "stale write should be rejected",
      }),
    );

    expect(output).toContain("Refusing update_task_status");
    expect(output).toContain("stale orchestrator PTY session");
    expect(fetchMock).toHaveBeenCalledTimes(1);

    const snap = await firestore.getDoc(firestore.doc(db, "tasks", "task-1"));
    expect(snap.data()).toMatchObject({
      status: "IN_PROGRESS",
      comment: "",
    });
  });
});
