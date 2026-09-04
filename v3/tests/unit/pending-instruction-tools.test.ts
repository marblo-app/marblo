import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

vi.hoisted(() => {
  delete process.env.MARBLO_FIREBASE_CUSTOM_TOKEN;
  process.env.MARBLO_MCP_ALLOW_UNAUTHENTICATED = "1";
});

vi.mock("firebase/auth", () => ({
  getAuth: () => ({ currentUser: { uid: "test-user" } }),
  signInWithCustomToken: () => Promise.resolve({ user: { uid: "test-user" } }),
}));

interface ToolResult {
  content: Array<{ type: "text"; text: string }>;
}
type ToolHandler = (args: Record<string, unknown>) => Promise<ToolResult>;
type FirestoreMock = typeof import("../mocks/firebase-firestore");

const savedEnv = {
  MARBLO_AGENT_ID: process.env.MARBLO_AGENT_ID,
  MARBLO_PROJECT: process.env.MARBLO_PROJECT,
  MARBLO_CONTEXT: process.env.MARBLO_CONTEXT,
  MARBLO_BRIDGE_PORT: process.env.MARBLO_BRIDGE_PORT,
  MARBLO_ORCHESTRATOR_PTY_SESSION_ID:
    process.env.MARBLO_ORCHESTRATOR_PTY_SESSION_ID,
  MARBLO_LEDGER_SPOOL_DIR: process.env.MARBLO_LEDGER_SPOOL_DIR,
};

let fsmock: FirestoreMock;
let spoolDir = "";

/**
 * `settleLedgerWrites` of the EXACT module instance the handlers came from.
 *
 * `vi.resetModules()` in beforeEach gives every test a fresh copy of
 * tools.ts with its own ledger singletons, so the settle hook has to be
 * captured from that same copy — a top-level import would settle a different
 * (empty) instance and wait for nothing.
 */
let settleLedgerWrites: (() => Promise<void>) | null = null;

async function registerHandlers(): Promise<Map<string, ToolHandler>> {
  const tools = await import("../../electron/mcp-server/tools");
  const { registerTools } = tools;
  settleLedgerWrites = tools.settleLedgerWrites;
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

function handler(
  handlers: Map<string, ToolHandler>,
  name: string,
): ToolHandler {
  const h = handlers.get(name);
  if (!h) throw new Error(`Missing handler: ${name}`);
  return h;
}

function resultText(r: ToolResult): string {
  return r.content[0]?.text ?? "";
}

describe("pending instruction MCP tools", () => {
  let handlers: Map<string, ToolHandler>;

  beforeEach(async () => {
    vi.resetModules();
    process.env.MARBLO_AGENT_ID = "agent-1";
    delete process.env.MARBLO_ORCHESTRATOR_PTY_SESSION_ID;
    process.env.MARBLO_PROJECT = "GFB8JnJrrX6AgahqmGB3";
    process.env.MARBLO_CONTEXT = "board";
    process.env.MARBLO_BRIDGE_PORT = "65535";
    spoolDir = fs.mkdtempSync(path.join(os.tmpdir(), "marblo-pi-spool-"));
    process.env.MARBLO_LEDGER_SPOOL_DIR = spoolDir;
    fsmock = await import("../mocks/firebase-firestore");
    fsmock.__resetStore();
    await fsmock.setDoc(fsmock.doc({}, "projects", "GFB8JnJrrX6AgahqmGB3"), {
      ownerId: "test-user",
      members: ["test-user"],
    });
    await fsmock.setDoc(fsmock.doc({}, "tasks", "task-1"), {
      title: "Task one",
      projectId: "GFB8JnJrrX6AgahqmGB3",
      status: "IN_PROGRESS",
      role: "backend",
    });
    handlers = await registerHandlers();
  });

  afterEach(async () => {
    // ★Drain the ledger's write-behind BEFORE removing its directory.
    // Sealing a ledger event schedules a ChainHeadStore write and returns
    // immediately, so a write can still be in flight here. Deleting the spool
    // dir under it made that write fail with ENOENT, and its catch logs via
    // console.error — AFTER this test has finished. vitest ships worker
    // console output over the `onUserConsoleLog` RPC, so a log that lands
    // while the worker is closing that rpc raises
    // `EnvironmentTeardownError: Closing rpc while "onUserConsoleLog" was
    // pending`, failing the whole run with every test green (PR #1406, task
    // FLf4cwy3I0Ty3S3ifqGw). Settling first leaves no async work outliving
    // the test, so there is nothing left to log.
    await settleLedgerWrites?.();
    settleLedgerWrites = null;
    vi.unstubAllGlobals();
    for (const [key, value] of Object.entries(savedEnv)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    if (spoolDir) fs.rmSync(spoolDir, { recursive: true, force: true });
  });

  it("add_pending_instruction reports queued/no_listener instead of silent success", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (String(url).includes("/agents")) {
          return {
            ok: true,
            json: async () => ({ agents: [] }),
          };
        }
        return { ok: false, status: 404, json: async () => ({}) };
      }),
    );

    const out = await handler(
      handlers,
      "add_pending_instruction",
    )({
      task_id: "task-1",
      target_agent_id: "agent-remote",
      message: "please adjust course",
      source_type: "orchestrator",
    });

    const text = resultText(out);
    expect(text).toContain("status=queued/no_listener");
    expect(text).toContain("listener=no_listener");
    expect(text).toContain("verify_with=get_pending_instructions");
    const id = /instruction_id=(\S+)/.exec(text)?.[1];
    expect(id).toBeTruthy();
  });

  it("get_pending_instructions filters by locked project_id so queued docs are verifiable", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (String(url).includes("/agents")) {
          return {
            ok: true,
            json: async () => ({
              agents: [{ id: "agent-1", name: "Agent", status: "working" }],
            }),
          };
        }
        return { ok: false, status: 404, json: async () => ({}) };
      }),
    );

    const queued = await handler(
      handlers,
      "add_pending_instruction",
    )({
      task_id: "task-1",
      target_agent_id: "agent-1",
      message: "continue",
      source_type: "orchestrator",
    });
    expect(resultText(queued)).toContain("status=queued");
    expect(resultText(queued)).toContain("listener=local");

    const listed = await handler(
      handlers,
      "get_pending_instructions",
    )({
      target_agent_id: "agent-1",
      project_id: "GFB8JnJrrX6AgahqmGB3",
      include_delivered: true,
    });
    expect(resultText(listed)).toContain("project=GFB8JnJrrX6AgahqmGB3");
    expect(resultText(listed)).toContain("continue");
  });
});
