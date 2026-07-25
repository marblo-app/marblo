import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

let spoolDir = "";

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
  // ★감사 스풀 격리용. 고정하지 않으면 이 테스트의 감사 쓰기 실패분이
  // ~/.marblo/ledger-spool 에 쌓인다(실측: orchestrator-project-1.spool.json.*.tmp
  // 가 라이브 디렉터리에 누적돼 있었다). 라이브 앱 상태를 유닛이 오염시키면 안 된다.
  MARBLO_LEDGER_SPOOL_DIR: process.env.MARBLO_LEDGER_SPOOL_DIR,
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
    spoolDir = fs.mkdtempSync(path.join(os.tmpdir(), "marblo-guard-spool-"));
    process.env.MARBLO_LEDGER_SPOOL_DIR = spoolDir;
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    if (spoolDir) fs.rmSync(spoolDir, { recursive: true, force: true });
    spoolDir = "";
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
      await getHandler(
        handlers,
        "update_task_status",
      )({
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

  // P5-1: answer_question 도 같은 게이트를 탄다 — 의도된 계약이다. 답변은 티켓에
  // 쓰고(질문 상태 flip) 워커 PTY 로 주입까지 하는 쓰기라, 죽은/낡은 오케 세션이
  // 이걸 통과하면 좀비 오케가 티켓에 답을 남기고 워커에게 지시를 밀어넣게 된다.
  // 그래서 게이트를 "실제 전달 시점"으로 미루지 않고 처리 앞단에 둔다.
  it("refuses answer_question from a stale orchestrator session (no ticket write)", async () => {
    const firestore = await import("../mocks/firebase-firestore");
    firestore.__resetStore();
    const db = {} as never;
    await firestore.setDoc(firestore.doc(db, "tasks", "task-1"), {
      projectId: "project-1",
      contextId: "board",
      title: "Q&A",
      status: "IN_PROGRESS",
      role: "backend",
      priority: 3,
      dependsOn: [],
      claimedBy: "agent-backend",
      questions: [
        {
          id: "task-1#qabc",
          question: "무엇을 쓸까요",
          status: "open",
          askedBy: "agent-backend",
          askedAt: 1,
          blocking: false,
        },
      ],
    });

    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          ({
            ok: true,
            json: async () => ({
              success: true,
              valid: false,
              reason: "stale orchestrator PTY session",
            }),
          }) as Response,
      ),
    );

    const handlers = await registerHandlers();
    const output = resultText(
      await getHandler(
        handlers,
        "answer_question",
      )({
        question_id: "task-1#qabc",
        answer: "좀비 오케의 답",
      }),
    );

    expect(output).toContain("Refusing answer_question");
    expect(output).toContain("stale orchestrator PTY session");

    // 티켓의 질문은 open 그대로여야 한다 — 거부가 부분 쓰기를 남기면 안 된다.
    const snap = await firestore.getDoc(firestore.doc(db, "tasks", "task-1"));
    const questions = (snap.data() as { questions?: Array<{ status: string }> })
      ?.questions;
    expect(questions?.[0]?.status).toBe("open");
  });
});
