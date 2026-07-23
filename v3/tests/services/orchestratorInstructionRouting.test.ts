import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * routeInstructionToOrchestrator 라우팅 계약:
 *   - 로컬 오케에 in-process inject 로 실제 전달(committed)됐을 때만 "local".
 *   - inject 미커밋(오케 없음/미실행/미커밋)·예외·API 부재 → durable 큐로 fall
 *     through 후 "queued" (또는 enqueue 실패 시 "failed").
 *
 * 회귀 방지 대상: 예전 fast path 는 전역 pty.list() 로 첫 'orchestrator' PTY 에
 * fire-and-forget writeAndSubmit 후 무조건 "local" 을 반환 → detached 창(비오너)
 * 에서 main 이 조용히 drop 해도 성공 토스트가 뜨고 큐 폴백도 못 탔다.
 */

// addPendingInstruction 이 Firestore 를 때리지 않도록 모듈 자체를 모킹한다.
const addPendingInstruction = vi.fn();
vi.mock("../../src/services/pendingInstructionService", () => ({
  addPendingInstruction: (...args: unknown[]) => addPendingInstruction(...args),
}));

vi.stubGlobal("window", {});

const { routeInstructionToOrchestrator } =
  await import("../../src/services/orchestratorInstructionService");

type InjectAck = { delivered: boolean; reason?: string };

function installElectronAPI(
  inject:
    | ((projectId: string, message: string) => Promise<InjectAck>)
    | undefined,
) {
  (window as unknown as { electronAPI?: unknown }).electronAPI = {
    orchestrator: inject ? { injectMessage: inject } : {},
  };
}

const baseInput = {
  projectId: "proj-1",
  message: "리뷰 부탁",
  fromUserId: "u1",
  fromUserName: "User",
  taskId: "task-1",
};

beforeEach(() => {
  addPendingInstruction.mockReset();
  addPendingInstruction.mockResolvedValue("pending-doc-id");
});

afterEach(() => {
  delete (window as unknown as { electronAPI?: unknown }).electronAPI;
});

describe("routeInstructionToOrchestrator", () => {
  it("inject 커밋(delivered:true) → 'local', 큐 미사용", async () => {
    const inject = vi.fn().mockResolvedValue({ delivered: true });
    installElectronAPI(inject);

    const result = await routeInstructionToOrchestrator(baseInput);

    expect(result).toBe("local");
    expect(inject).toHaveBeenCalledWith("proj-1", "리뷰 부탁");
    expect(addPendingInstruction).not.toHaveBeenCalled();
  });

  it("inject 미커밋(오케 미실행) → durable 큐 fall through, 'queued'", async () => {
    const inject = vi
      .fn()
      .mockResolvedValue({
        delivered: false,
        reason: "orchestrator-not-running",
      });
    installElectronAPI(inject);

    const result = await routeInstructionToOrchestrator(baseInput);

    expect(result).toBe("queued");
    expect(addPendingInstruction).toHaveBeenCalledTimes(1);
    expect(addPendingInstruction).toHaveBeenCalledWith(
      expect.objectContaining({
        projectId: "proj-1",
        targetAgentId: "orch-proj-1",
        taskId: "task-1",
        message: "리뷰 부탁",
        sourceType: "orchestrator",
      }),
    );
  });

  it("로컬 오케 없음(no-local-orchestrator) → 'queued'", async () => {
    const inject = vi
      .fn()
      .mockResolvedValue({ delivered: false, reason: "no-local-orchestrator" });
    installElectronAPI(inject);

    const result = await routeInstructionToOrchestrator(baseInput);

    expect(result).toBe("queued");
    expect(addPendingInstruction).toHaveBeenCalledTimes(1);
  });

  it("inject 예외 → 큐로 fall through, 'queued'", async () => {
    const inject = vi.fn().mockRejectedValue(new Error("ipc boom"));
    installElectronAPI(inject);

    const result = await routeInstructionToOrchestrator(baseInput);

    expect(result).toBe("queued");
    expect(addPendingInstruction).toHaveBeenCalledTimes(1);
  });

  it("injectMessage API 부재(구버전 preload) → 큐로 fall through, 'queued'", async () => {
    installElectronAPI(undefined);

    const result = await routeInstructionToOrchestrator(baseInput);

    expect(result).toBe("queued");
    expect(addPendingInstruction).toHaveBeenCalledTimes(1);
  });

  it("inject 미커밋 + enqueue 실패 → 'failed'", async () => {
    const inject = vi
      .fn()
      .mockResolvedValue({ delivered: false, reason: "inject-not-committed" });
    installElectronAPI(inject);
    addPendingInstruction.mockRejectedValue(new Error("firestore down"));

    const result = await routeInstructionToOrchestrator(baseInput);

    expect(result).toBe("failed");
  });

  it("free-form(taskId 없음)도 큐 targetAgentId 는 orch-<projectId>", async () => {
    const inject = vi
      .fn()
      .mockResolvedValue({ delivered: false, reason: "no-local-orchestrator" });
    installElectronAPI(inject);

    const result = await routeInstructionToOrchestrator({
      projectId: "proj-9",
      message: "diff 코멘트",
    });

    expect(result).toBe("queued");
    expect(addPendingInstruction).toHaveBeenCalledWith(
      expect.objectContaining({
        projectId: "proj-9",
        targetAgentId: "orch-proj-9",
        taskId: null,
      }),
    );
  });
});
