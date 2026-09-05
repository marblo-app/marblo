// P5-1 왕복 — ask_orchestrator → (오케 PTY 알림) → answer_question → 질문자 전달.
// MCP 핸들러를 실제로 등록해 호출한다: questionId 상관, 300자 초과 무손실,
// 답변의 pendingInstructions 큐 등록(=P5-2 하드닝 경로)을 한 번에 고정한다.
//
// ★환경 고정이 필수다(리베이스 후 오케 PTY 에서 4건이 깨진 원인). tools.ts 는
// 모듈 로드 시점에 `MARBLO_AGENT_ID` 를 캡처하고, 그 값이 `orchestrator-*` 면
// answer_question 이 live-session 게이트(ORCHESTRATOR_LIVE_GUARDED_TOOLS)를 타
// "stale orchestrator session" 으로 거부된다 — 오케 PTY 에서 vitest 를 돌리면
// 그 env 를 그대로 물려받으므로 같은 코드가 실행 위치에 따라 다른 결과를 낸다.
// 그래서 여기서는 env 를 워커 에이전트로 **핀 고정**하고 `vi.resetModules()` +
// 동적 import 로 tools.ts 를 그 env 로 다시 로드한다. (게이트 자체가 의도된
// 계약이라는 증명은 mcp-orchestrator-session-guard.test.ts 에 있다.)
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

/**
 * ★감사 스풀은 반드시 격리한다. 기본값은 `~/.marblo/ledger-spool` 이라, 고정하지
 * 않으면 유닛 실행이 **사장님 라이브 앱의 스풀**에 조작된 감사 이벤트를 남기고
 * (실측: 이 파일 실행이 실제 agent/project id 로 task-1 이벤트를 적재했다) MCP
 * 재시작의 restore 가 그걸 진짜 원장에 replay 할 수 있다. ledger-spool.ts 헤더가
 * 경고하는 사고(Me11Ze8kvI35LvONzU9F)와 같은 유형이다.
 */
let spoolDir = "";

/**
 * ★목 firestore 는 **동적으로** 잡는다. `vi.resetModules()` 뒤에 import 되는
 * tools.ts 는 새 모듈 레지스트리의 목 인스턴스(=새 in-memory store)를 쓰므로,
 * 파일 상단에서 정적으로 import 한 목에 seed 하면 서로 다른 store 를 보게 된다
 * ("Task task-1 not found"). 매 테스트에서 리셋 직후의 인스턴스를 쓴다.
 */
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

async function readTaskQuestions(taskId: string) {
  const snap = await fsmock.getDoc(fsmock.doc({}, "tasks", taskId));
  return readQuestions((snap.data() as Record<string, unknown>)?.questions);
}

describe("ask_orchestrator / answer_question 왕복", () => {
  let handlers: Map<string, ToolHandler>;
  let notified: string[];

  beforeEach(async () => {
    vi.resetModules();
    notified = [];
    // 워커 에이전트로 핀 — 오케 id 를 물려받으면 live-session 게이트가 뜬다.
    process.env.MARBLO_AGENT_ID = "agent-1";
    delete process.env.MARBLO_ORCHESTRATOR_PTY_SESSION_ID;
    process.env.MARBLO_BRIDGE_PORT = "65535";
    process.env.MARBLO_PROJECT = "proj-1";
    process.env.MARBLO_CONTEXT = "board";
    spoolDir = fs.mkdtempSync(path.join(os.tmpdir(), "marblo-qa-spool-"));
    process.env.MARBLO_LEDGER_SPOOL_DIR = spoolDir;
    fsmock = await import("../mocks/firebase-firestore");
    fsmock.__resetStore();
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: { body?: string }) => {
        if (String(url).includes("/notify-orchestrator")) {
          const body = JSON.parse(init?.body ?? "{}") as { message?: string };
          notified.push(body.message ?? "");
          return {
            ok: true,
            json: async () => ({ success: true, injected: true }),
          } as unknown as Response;
        }
        // 기본은 "agent-1 이 이 마블로 앱에 살아 있다" — 대부분의 왕복 테스트가
        // 기대하는 정상 경로다. listener 부재를 다루는 테스트는 이 스텁을
        // 자기 것으로 덮어써서 그 시나리오만 따로 켠다.
        if (String(url).includes("/agents")) {
          return {
            ok: true,
            json: async () => ({
              agents: [{ id: "agent-1", name: "Agent", status: "working" }],
            }),
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

  it("★300자를 훨씬 넘는 질문이 잘리지 않고 오케에 전달된다", async () => {
    const longQuestion = `앞머리 ${"라".repeat(2000)} 꼬리표시`;
    const res = await handler(
      handlers,
      "ask_orchestrator",
    )({
      task_id: "task-1",
      question: longQuestion,
      agent_id: "agent-1",
    });

    const out = resultText(res);
    expect(out).toContain("question_id=task-1#q");
    expect(out).toContain("오케스트레이터 PTY 로 전달됨");

    // 오케로 나간 본문에 질문 전문이 그대로 들어 있다(add_activity 의 300자 프리뷰와 대비).
    expect(notified).toHaveLength(1);
    expect(notified[0]).toContain(longQuestion);
    expect(notified[0].startsWith("[Question]")).toBe(true);

    // 티켓에 open 상태로 저장된다.
    const stored = await readTaskQuestions("task-1");
    expect(stored).toHaveLength(1);
    expect(stored[0]).toMatchObject({ status: "open", askedBy: "agent-1" });
    expect(stored[0].question).toBe(longQuestion);
  });

  it("★답변이 questionId 로 상관되고 질문자 PTY 전달 큐에 무손실로 등록된다", async () => {
    const ask = await handler(
      handlers,
      "ask_orchestrator",
    )({
      task_id: "task-1",
      question: "어느 모델로 갈까요",
      agent_id: "agent-1",
    });
    const questionId = /question_id=(\S+)/.exec(resultText(ask))?.[1];
    expect(questionId).toBeTruthy();

    const longAnswer = `결론: ${"답".repeat(1500)}`;
    // task_id 를 주지 않아도 questionId 만으로 티켓을 되찾는다(자기기술 상관키).
    const answer = await handler(
      handlers,
      "answer_question",
    )({
      question_id: questionId,
      answer: longAnswer,
    });
    expect(resultText(answer)).toContain("answered");
    expect(resultText(answer)).toContain("전달 큐 등록됨");
    expect(resultText(answer)).toContain("listener=local");

    const stored = await readTaskQuestions("task-1");
    expect(stored[0]).toMatchObject({
      id: questionId,
      status: "answered",
      answerDelivery: "queued",
    });
    expect(stored[0].answer).toBe(longAnswer);

    // 전달은 하드닝된 pendingInstructions 경로로 나간다(P5-2 리스너가 재시도/보고).
    const pending = await fsmock.getDocs(
      fsmock.query(
        fsmock.collection({}, "pendingInstructions"),
        fsmock.where("targetAgentId", "==", "agent-1"),
      ),
    );
    expect(pending.size).toBe(1);
    const inst = pending.docs[0].data() as Record<string, unknown>;
    expect(inst.isDelivered).toBe(false);
    expect(String(inst.message)).toContain(longAnswer);
    expect(String(inst.message)).toContain(questionId as string);
  });

  it("★answer_question 도 add_pending_instruction 처럼 listener 없음을 조용히 넘기지 않는다(티켓 D85w7iFHLQUVS8ty5MOF)", async () => {
    const ask = await handler(
      handlers,
      "ask_orchestrator",
    )({
      task_id: "task-1",
      question: "이 브릿지에 없는 에이전트에게 갈 질문",
      agent_id: "agent-1",
    });
    const questionId = /question_id=(\S+)/.exec(resultText(ask))?.[1] as string;

    // /agents 목록이 비어 있다 = 이 마블로 앱은 agent-1 을 호스팅하고 있지 않다
    // (예: 다른 머신, 혹은 아직 attach 되지 않은 세션) — add_pending_instruction
    // 은 바로 이 신호로 "listener=no_listener" 를 돌려준다(dfe34148 #763).
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (String(url).includes("/agents")) {
          return {
            ok: true,
            json: async () => ({ agents: [] }),
          } as unknown as Response;
        }
        return { ok: true, json: async () => ({}) } as unknown as Response;
      }),
    );

    const answer = await handler(
      handlers,
      "answer_question",
    )({
      question_id: questionId,
      answer: "이 에이전트를 아무도 못 찾을 것이다",
    });

    // ★이게 이 테스트의 핵심이다 — 오늘의 코드는 findLocalBridgeAgent 를 전혀
    // 부르지 않고 "전달 큐 등록됨" 만 돌려준다. listener 가 없다는 사실이
    // 호출자(오케)에게 전혀 보이지 않는다.
    expect(resultText(answer)).toContain("no_listener");
  });

  it("이미 답한 질문은 덮어쓰지 않고 기존 답을 알려준다", async () => {
    const ask = await handler(
      handlers,
      "ask_orchestrator",
    )({
      task_id: "task-1",
      question: "Q",
      agent_id: "agent-1",
    });
    const questionId = /question_id=(\S+)/.exec(resultText(ask))?.[1] as string;

    await handler(
      handlers,
      "answer_question",
    )({
      question_id: questionId,
      answer: "첫 답",
    });
    const second = await handler(
      handlers,
      "answer_question",
    )({
      question_id: questionId,
      answer: "둘째 답",
    });

    expect(resultText(second)).toContain("이미 답변됨");
    expect(resultText(second)).toContain("첫 답");
    const stored = await readTaskQuestions("task-1");
    expect(stored[0].answer).toBe("첫 답");
  });

  it("모르는 question_id 는 조용히 성공하지 않고 명시적으로 실패한다", async () => {
    const res = await handler(
      handlers,
      "answer_question",
    )({
      question_id: "task-1#qzzz",
      answer: "a",
    });
    expect(resultText(res)).toContain("찾지 못했습니다");
  });

  it("오케 PTY 주입 실패는 성공으로 보고되지 않는다(질문은 티켓에 남는다)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (String(url).includes("/notify-orchestrator")) {
          return {
            ok: true,
            json: async () => ({
              success: false,
              injected: false,
              error: "Orchestrator not running for project proj-1",
            }),
          } as unknown as Response;
        }
        return { ok: true, json: async () => ({}) } as unknown as Response;
      }),
    );

    const res = await handler(
      handlers,
      "ask_orchestrator",
    )({
      task_id: "task-1",
      question: "죽은 오케에 던지는 질문",
      agent_id: "agent-1",
    });

    expect(resultText(res)).toContain("오케 PTY 주입 실패");
    expect(resultText(res)).toContain("get_open_questions");
    // 알림은 실패했어도 질문 자체는 살아 있어야 회수 가능하다.
    const stored = await readTaskQuestions("task-1");
    expect(stored).toHaveLength(1);
    expect(stored[0].status).toBe("open");
  });

  it("get_open_questions 는 미답만, include_answered 면 전부 보여준다", async () => {
    const first = await handler(
      handlers,
      "ask_orchestrator",
    )({
      task_id: "task-1",
      question: "첫 질문",
      agent_id: "agent-1",
    });
    await handler(
      handlers,
      "ask_orchestrator",
    )({
      task_id: "task-1",
      question: "둘째 질문",
      agent_id: "agent-1",
    });
    const firstId = /question_id=(\S+)/.exec(resultText(first))?.[1] as string;
    await handler(
      handlers,
      "answer_question",
    )({
      question_id: firstId,
      answer: "첫 답",
    });

    const open = resultText(
      await handler(handlers, "get_open_questions")({ task_id: "task-1" }),
    );
    expect(open).toContain("둘째 질문");
    expect(open).not.toContain("첫 질문");

    const all = resultText(
      await handler(
        handlers,
        "get_open_questions",
      )({
        task_id: "task-1",
        include_answered: true,
      }),
    );
    expect(all).toContain("첫 질문");
    expect(all).toContain("A: 첫 답");
  });
});
