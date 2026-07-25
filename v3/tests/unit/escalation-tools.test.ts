// P3-1 승인 왕복 + P5-3 사장님 왕복 — MCP 핸들러를 실제로 등록해 호출한다.
//
// 여기서 증명하는 계약 4개:
//   1. 고비용 칸(max/ultra)은 요청만으로 열리지 않는다 — pending 레코드가 남고,
//      승인 없이는 스폰 경로가 쓸 수 있는 승인이 존재하지 않는다.
//   2. 승인/거부는 **사용자의 결정을 적는 행위**다 — decided_for 로 판단 주체가
//      남고, 결과가 요청 에이전트 PTY 전달 큐(pendingInstructions)에 들어간다.
//   3. 예산(티켓당 1건)과 중복요청 억제가 실제로 동작한다.
//   4. 사장님 승격은 텔레그램으로 나가고, **전달 실패도 티켓에 남는다**
//      (성공만 기록하면 "올렸는데 답이 안 온다" 를 진단할 수 없다).
//
// ★환경 고정: question-channel-tools.test.ts 헤더와 같은 이유로 MARBLO_AGENT_ID
// 를 핀하고 vi.resetModules() + 동적 import 로 tools.ts 를 다시 로드한다. 오케
// 전용 툴(escalate_to_owner / resolve_model_escalation)은 오케 id 로 돌리면
// live-session 게이트를 타므로, 여기서는 워커 id 로 고정해 그 게이트를 우회하고
// (게이트 자체의 증명은 mcp-orchestrator-session-guard.test.ts 가 한다) 승인
// 프로토콜만 검증한다.
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

import { readQuestions } from "../../electron/mcp-server/question-channel";
import {
  readEscalationApprovals,
  usableApproval,
} from "../../electron/mcp-server/escalation-approval";

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
  MARBLO_LEDGER_SPOOL_DIR: process.env.MARBLO_LEDGER_SPOOL_DIR,
};

let spoolDir = "";
type FirestoreMock = typeof import("../mocks/firebase-firestore");
let fsmock: FirestoreMock;

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

async function taskData(taskId: string): Promise<Record<string, unknown>> {
  const snap = await fsmock.getDoc(fsmock.doc({}, "tasks", taskId));
  return (snap.data() as Record<string, unknown>) ?? {};
}

describe("고비용 모델 승인 왕복 + 사장님 승격", () => {
  let handlers: Map<string, ToolHandler>;
  let notified: string[];
  let telegram: Array<{ text: string; chatId?: string }>;
  let telegramOk = true;
  let dispatched: Array<{ model?: string; effort?: string }>;

  beforeEach(async () => {
    vi.resetModules();
    notified = [];
    telegram = [];
    telegramOk = true;
    dispatched = [];
    process.env.MARBLO_AGENT_ID = "agent-1";
    delete process.env.MARBLO_ORCHESTRATOR_PTY_SESSION_ID;
    process.env.MARBLO_BRIDGE_PORT = "65535";
    process.env.MARBLO_PROJECT = "proj-1";
    process.env.MARBLO_CONTEXT = "board";
    spoolDir = fs.mkdtempSync(path.join(os.tmpdir(), "marblo-esc-spool-"));
    process.env.MARBLO_LEDGER_SPOOL_DIR = spoolDir;
    fsmock = await import("../mocks/firebase-firestore");
    fsmock.__resetStore();
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: { body?: string }) => {
        const u = String(url);
        const body = JSON.parse(init?.body ?? "{}") as {
          message?: string;
          text?: string;
          chatId?: string;
        };
        if (u.includes("/notify-orchestrator")) {
          notified.push(body.message ?? "");
          return {
            ok: true,
            json: async () => ({ success: true, injected: true }),
          } as unknown as Response;
        }
        if (u.includes("/dispatch-task")) {
          const b = JSON.parse(init?.body ?? "{}") as {
            model?: string;
            effort?: string;
          };
          dispatched.push({ model: b.model, effort: b.effort });
          return {
            ok: true,
            json: async () => ({
              success: true,
              action: "spawned",
              agentId: "spawn-1",
              agentName: "codex-1",
              agentRole: "backend",
              model: "gpt",
              spawnedModel: b.effort
                ? `${b.model}@${b.effort}`
                : (b.model ?? "gpt-5.5"),
              reason: "test",
              taskId: "task-1",
            }),
          } as unknown as Response;
        }
        if (u.includes("/send-telegram-message")) {
          if (!telegramOk) {
            return {
              ok: true,
              json: async () => ({ ok: false, error: "no active channel" }),
            } as unknown as Response;
          }
          telegram.push({ text: body.text ?? "", chatId: body.chatId });
          return {
            ok: true,
            json: async () => ({ ok: true, chatId: "chat-9" }),
          } as unknown as Response;
        }
        return { ok: true, json: async () => ({}) } as unknown as Response;
      }),
    );
    await fsmock.setDoc(fsmock.doc({}, "tasks", "task-1"), {
      projectId: "proj-1",
      contextId: "board",
      title: "라우팅 티켓",
      description: "d",
      status: "IN_PROGRESS",
      role: "backend",
      priority: 3,
      dependsOn: [],
      claimedBy: "agent-1",
    });
    handlers = await registerHandlers();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    for (const [key, value] of Object.entries(savedEnv)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    if (spoolDir) fs.rmSync(spoolDir, { recursive: true, force: true });
    spoolDir = "";
  });

  async function request(
    over: Record<string, unknown> = {},
  ): Promise<{ out: string; questionId: string }> {
    const res = await handler(
      handlers,
      "request_model_escalation",
    )({
      task_id: "task-1",
      model: "gpt-5.6-sol",
      effort: "max",
      reason: "sol@xhigh 로 두 번 시도했으나 회귀를 못 잡았습니다.",
      agent_id: "agent-1",
      ...over,
    });
    const out = resultText(res);
    return { out, questionId: /question_id=(\S+)/.exec(out)?.[1] ?? "" };
  }

  it("★요청만으로는 열리지 않는다 — pending 레코드 + 쓸 수 있는 승인 0건", async () => {
    const { out, questionId } = await request();
    expect(out).toContain("gpt-5.6-sol@max");
    expect(out).toContain("status=pending");
    expect(questionId).toMatch(/^task-1#q/);

    const data = await taskData("task-1");
    const records = readEscalationApprovals(data.modelEscalations);
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({
      decision: "pending",
      model: "gpt-5.6-sol",
      effort: "max",
      requestedBy: "agent-1",
    });
    // 스폰 경로가 쓸 수 있는 승인은 아직 없다 = 자동으로 뜨지 않는다.
    expect(usableApproval(records, "gpt-5.6-sol", "max")).toBeUndefined();

    // 질문은 owner 판정으로 박히고, 오케 알림엔 "임의 승인 금지" 가 실린다.
    const question = readQuestions(data.questions)[0];
    expect(question.audience).toBe("owner");
    expect(question.approvalFor).toBe("gpt-5.6-sol@max");
    expect(notified[0]).toContain("★고비용 모델 승인 요청");
    expect(notified[0]).toContain("오케가 임의로 승인하지 말고");
    expect(notified[0]).toContain("escalate_to_owner");
  });

  it("승인 게이트 대상이 아닌 칸은 요청 자체를 만들지 않는다(알림 피로 방지)", async () => {
    const { out } = await request({ effort: "high" });
    expect(out).toContain("승인 불필요");
    const data = await taskData("task-1");
    expect(readEscalationApprovals(data.modelEscalations)).toHaveLength(0);
  });

  it("사다리에 없는 칸·미등록 모델은 거절한다(날조 방지)", async () => {
    expect((await request({ model: "gpt-9-mega" })).out).toContain("Error");
    expect(
      (await request({ model: "gpt-5.6-luna", effort: "ultra" })).out,
    ).toContain("Error");
    expect((await request({ effort: "bogus" })).out).toContain("Error");
    expect((await request({ reason: "  " })).out).toContain("Error");
  });

  it("같은 칸 중복 요청은 사장님을 두 번 깨우지 않는다", async () => {
    await request();
    const again = await request();
    expect(again.out).toContain("이미 답을 기다리는 승인 요청");
    const data = await taskData("task-1");
    expect(readEscalationApprovals(data.modelEscalations)).toHaveLength(1);
  });

  it("★승인 기록 시 판단 주체가 남고, 결과가 요청자 PTY 전달 큐에 들어간다", async () => {
    const { questionId } = await request();
    const res = await handler(
      handlers,
      "resolve_model_escalation",
    )({
      question_id: questionId,
      decision: "approve",
      decided_for: "사장님",
      note: "이번 한 번만",
    });
    const out = resultText(res);
    expect(out).toContain("approved");
    expect(out).toContain("판단=사장님");
    expect(out).toContain("전달 큐 등록됨");

    const data = await taskData("task-1");
    const records = readEscalationApprovals(data.modelEscalations);
    expect(records[0]).toMatchObject({
      decision: "approved",
      decidedFor: "사장님",
      decidedBy: "agent-1", // 적은 주체(이 테스트에선 워커 id 로 핀)
    });
    // 이제 스폰 경로가 쓸 수 있는 승인이 정확히 1건 생긴다.
    expect(usableApproval(records, "gpt-5.6-sol", "max")).toBeTruthy();

    // 질문이 닫히고 답이 요청자에게 큐잉된다.
    const question = readQuestions(data.questions)[0];
    expect(question.status).toBe("answered");
    expect(question.answerDelivery).toBe("queued");
    const queue = await fsmock.getDocs(
      fsmock.query(fsmock.collection({}, "pendingInstructions")),
    );
    expect(queue.docs).toHaveLength(1);
    const msg = queue.docs[0].data() as {
      message: string;
      targetAgentId: string;
    };
    expect(msg.targetAgentId).toBe("agent-1");
    expect(msg.message).toContain("승인됨");
    expect(msg.message).toContain("1회용");
  });

  it("거부도 같은 경로로 회신되고, 예산을 태우지 않는다", async () => {
    const { questionId } = await request();
    const out = resultText(
      await handler(
        handlers,
        "resolve_model_escalation",
      )({
        question_id: questionId,
        decision: "deny",
        decided_for: "사장님",
        note: "비용 대비 근거 부족",
      }),
    );
    expect(out).toContain("denied");
    expect(out).toContain("거부는 예산을 쓰지 않습니다");

    const records = readEscalationApprovals(
      (await taskData("task-1")).modelEscalations,
    );
    expect(usableApproval(records, "gpt-5.6-sol", "max")).toBeUndefined();
    // 거부 뒤에도 재요청은 가능하다(예산 미소진).
    const retry = await request();
    expect(retry.out).toContain("status=pending");
  });

  it("이미 결정된 요청은 덮어쓰지 않는다(결정 이력 보존)", async () => {
    const { questionId } = await request();
    await handler(
      handlers,
      "resolve_model_escalation",
    )({ question_id: questionId, decision: "approve", decided_for: "사장님" });
    const second = resultText(
      await handler(
        handlers,
        "resolve_model_escalation",
      )({ question_id: questionId, decision: "deny" }),
    );
    expect(second).toContain("이미 승인");
    expect(second).toContain("덮어쓰지 않았습니다");
  });

  it("★예산 소진 뒤에는 새 요청이 거절된다(티켓당 1건)", async () => {
    const first = await request();
    await handler(
      handlers,
      "resolve_model_escalation",
    )({ question_id: first.questionId, decision: "approve" });
    const second = await request({ effort: "ultra" });
    expect(second.out).toContain("예산");
    expect(second.out).toContain("Error");
  });

  it("없는 question_id 로 결정하려 하면 정직하게 실패한다", async () => {
    const out = resultText(
      await handler(
        handlers,
        "resolve_model_escalation",
      )({ question_id: "task-1#qzzzz", decision: "approve" }),
    );
    expect(out).toContain("Error");
  });

  // ── ★dispatch 경로의 게이트 (PR#601 이 열어 놓은 실제 유입구) ────────
  //
  // #601 이 `dispatch_task(model="…@max")`/`effort="max"` 를 스폰까지 실제로
  // 전달하게 만들었다. 그래서 사장님 지시("승인받고 사용")를 지키려면 이 경로가
  // 반드시 막혀 있어야 한다 — 아래 4건이 그 증명이다.
  async function dispatch(over: Record<string, unknown> = {}): Promise<string> {
    return resultText(
      await handler(
        handlers,
        "dispatch_task",
      )({
        role: "backend",
        instruction: "테스트 작업",
        task_id: "task-1",
        complexity: "complex",
        model: "gpt-5.6-sol",
        ...over,
      }),
    );
  }

  it("★승인 없는 max 는 dispatch 로 스폰되지 않는다(effort 강등 + 사실 통보)", async () => {
    const out = await dispatch({ effort: "max" });
    expect(dispatched).toHaveLength(1);
    expect(dispatched[0].effort).toBeUndefined();
    expect(out).toContain("사용자 승인이 필요한 고비용 칸");
    expect(out).toContain("request_model_escalation");
  });

  it("★model 문자열의 '@ultra' 도 함께 떼어낸다(우회 경로 차단)", async () => {
    const out = await dispatch({ model: "gpt-5.6-sol@ultra" });
    expect(dispatched[0].model).toBe("gpt-5.6-sol");
    expect(dispatched[0].effort).toBeUndefined();
    expect(out).toContain("고비용 칸");
  });

  it("task_id 없는 dispatch 의 고비용 칸도 막힌다(승인은 티켓 단위)", async () => {
    const out = await dispatch({ task_id: undefined, effort: "ultra" });
    expect(dispatched[0].effort).toBeUndefined();
    expect(out).toContain("task_id");
  });

  it("게이트 밖 effort(xhigh)는 그대로 통과한다(무회귀)", async () => {
    await dispatch({ effort: "xhigh" });
    expect(dispatched[0].effort).toBe("xhigh");
  });

  it("★승인이 있으면 통과하고, 스폰 성공 후 그 승인이 소진된다", async () => {
    const { questionId } = await request();
    await handler(
      handlers,
      "resolve_model_escalation",
    )({ question_id: questionId, decision: "approve", decided_for: "사장님" });

    const out = await dispatch({ effort: "max" });
    expect(dispatched[0].effort).toBe("max");
    expect(out).toContain("소진 처리됨");

    const records = readEscalationApprovals(
      (await taskData("task-1")).modelEscalations,
    );
    expect(records[0].consumedAt).toBeGreaterThan(0);
    expect(usableApproval(records, "gpt-5.6-sol", "max")).toBeUndefined();

    // 소진된 뒤 같은 칸을 다시 부르면 이제는 막힌다.
    const again = await dispatch({ effort: "max" });
    expect(dispatched[1].effort).toBeUndefined();
    expect(again).toContain("미소진 승인이 없습니다");
  });

  it("승인된 칸과 다른 모델을 요청하면 통과하지 않는다", async () => {
    const { questionId } = await request();
    await handler(
      handlers,
      "resolve_model_escalation",
    )({ question_id: questionId, decision: "approve" });
    await dispatch({ model: "gpt-5.6-terra", effort: "max" });
    expect(dispatched[0].effort).toBeUndefined();
  });

  // ── P5-3 사장님 승격 ───────────────────────────────────────────────
  it("★사장님 승격은 질문 전문을 텔레그램으로 보내고 티켓에 기록한다", async () => {
    const ask = await handler(
      handlers,
      "ask_orchestrator",
    )({
      task_id: "task-1",
      question:
        "이 PR 을 지금 머지해도 됩니까? CI 는 통과했고 되돌리기는 어렵습니다.",
      agent_id: "agent-1",
    });
    const questionId = /question_id=(\S+)/.exec(resultText(ask))?.[1] ?? "";
    // 판정이 오케 알림에 실려 나간다.
    expect(resultText(ask)).toContain("판정=owner/irreversible-action");
    expect(notified[0]).toContain("★판정: 사장님 필요");

    const out = resultText(
      await handler(
        handlers,
        "escalate_to_owner",
      )({ question_id: questionId, note: "CI green, 사장님 판단 필요" }),
    );
    expect(out).toContain("사장님께 전달됨");
    expect(telegram).toHaveLength(1);
    expect(telegram[0].text).toContain("[사장님 확인 요청] 라우팅 티켓");
    expect(telegram[0].text).toContain("머지해도 됩니까");
    expect(telegram[0].text).toContain("CI green");

    const question = readQuestions((await taskData("task-1")).questions)[0];
    expect(question.ownerEscalation).toMatchObject({ delivery: "sent" });
  });

  it("★텔레그램 전달 실패를 성공으로 위장하지 않는다", async () => {
    telegramOk = false;
    const ask = await handler(
      handlers,
      "ask_orchestrator",
    )({
      task_id: "task-1",
      question: "스크린샷 한 장 부탁드립니다.",
      agent_id: "agent-1",
    });
    const questionId = /question_id=(\S+)/.exec(resultText(ask))?.[1] ?? "";
    const out = resultText(
      await handler(handlers, "escalate_to_owner")({ question_id: questionId }),
    );
    expect(out).toContain("사장님 전달 실패");
    expect(out).toContain("no active channel");
    // 실패 사실이 티켓에 남아야 "올렸는데 답이 없다" 를 진단할 수 있다.
    const question = readQuestions((await taskData("task-1")).questions)[0];
    expect(question.ownerEscalation).toMatchObject({ delivery: "failed" });
    expect(question.status).toBe("open");
  });

  it("이미 답변된 질문은 사장님께 올리지 않는다", async () => {
    const ask = await handler(
      handlers,
      "ask_orchestrator",
    )({ task_id: "task-1", question: "머지해도 될까요?", agent_id: "agent-1" });
    const questionId = /question_id=(\S+)/.exec(resultText(ask))?.[1] ?? "";
    await handler(
      handlers,
      "answer_question",
    )({ question_id: questionId, answer: "제가 확인했습니다. 진행하세요." });
    const out = resultText(
      await handler(handlers, "escalate_to_owner")({ question_id: questionId }),
    );
    expect(out).toContain("이미 답변");
    expect(telegram).toHaveLength(0);
  });
});
