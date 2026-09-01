// 오케 알림 전달 판정 회귀 (티켓 tHQzXPvFaR29fy0I82rM).
//
// 고정하는 계약: notifyOrchestrator 경로는 더 이상 실패를 삼키지 않는다.
// 브리지 응답의 3분기(delivered / suppressed / failed)가 정확히 갈라져야
// 호출부가 "기록해야 할 실패" 와 "의도된 억제" 를 구분할 수 있다 —
// suppressed 를 실패로 세면 진행 보고마다 오탐 기록이 쌓이고(폭주),
// failed 를 delivered 로 세면 2026-09-01 의 조용한 유실이 재발한다.

import { describe, expect, it, vi } from "vitest";
import {
  classifyNotifyResponse,
  postOrchestratorNotification,
} from "../../electron/mcp-server/notify-delivery";

describe("classifyNotifyResponse — 브리지 응답 3분기", () => {
  it("injected:true → delivered", () => {
    expect(
      classifyNotifyResponse(true, 200, { success: true, injected: true }),
    ).toEqual({ outcome: "delivered" });
  });

  it("의도적 억제(success:true + injected:false + reason) → suppressed", () => {
    const res = classifyNotifyResponse(true, 200, {
      success: true,
      injected: false,
      reason: "timeline-only notification suppressed",
    });
    expect(res.outcome).toBe("suppressed");
  });

  it("오케 미기동(success:false + error) → failed, 사유 보존", () => {
    const res = classifyNotifyResponse(true, 200, {
      success: false,
      error: "Orchestrator not running for project p1",
    });
    expect(res.outcome).toBe("failed");
    expect(res.reason).toContain("not running");
  });

  it("PTY 거절(success:true + injected:false + error) → failed", () => {
    const res = classifyNotifyResponse(true, 200, {
      success: true,
      injected: false,
      error: "orchestrator PTY did not accept the message",
    });
    expect(res.outcome).toBe("failed");
  });

  it("HTTP 에러 → failed", () => {
    const res = classifyNotifyResponse(false, 500, null);
    expect(res.outcome).toBe("failed");
    expect(res.reason).toContain("500");
  });

  it("본문 없는 200 → failed 기본 사유(성공으로 위장하지 않는다)", () => {
    expect(classifyNotifyResponse(true, 200, null).outcome).toBe("failed");
  });
});

describe("postOrchestratorNotification — 절대 throw 하지 않는 전달 시도", () => {
  const base = {
    headers: { "Content-Type": "application/json" },
    projectId: "p1",
    contextId: "",
    message: "[Review Submitted] test",
  };

  it("브리지 포트가 없으면 failed(no bridge port)", async () => {
    const res = await postOrchestratorNotification({
      ...base,
      bridgePort: undefined,
    });
    expect(res.outcome).toBe("failed");
    expect(res.reason).toContain("no bridge port");
  });

  it("정상 주입 응답 → delivered, 요청 본문에 message/projectId/contextId 포함", async () => {
    const fetchImpl = vi.fn(async (_url: unknown, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
      expect(body.message).toBe("[Review Submitted] test");
      expect(body.projectId).toBe("p1");
      expect(body.contextId).toBe("");
      return {
        ok: true,
        status: 200,
        json: async () => ({ success: true, injected: true }),
      } as Response;
    }) as unknown as typeof fetch;
    const res = await postOrchestratorNotification({
      ...base,
      bridgePort: "45123",
      fetchImpl,
    });
    expect(res).toEqual({ outcome: "delivered" });
  });

  it("네트워크 실패 → failed(bridge unreachable), throw 없음", async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error("ECONNREFUSED");
    }) as unknown as typeof fetch;
    const res = await postOrchestratorNotification({
      ...base,
      bridgePort: "45123",
      fetchImpl,
    });
    expect(res.outcome).toBe("failed");
    expect(res.reason).toContain("ECONNREFUSED");
  });

  it("JSON 아닌 응답 본문 → failed 로 판정(성공으로 위장하지 않는다)", async () => {
    const fetchImpl = vi.fn(async () => {
      return {
        ok: true,
        status: 200,
        json: async () => {
          throw new Error("not json");
        },
      } as unknown as Response;
    }) as unknown as typeof fetch;
    const res = await postOrchestratorNotification({
      ...base,
      bridgePort: "45123",
      fetchImpl,
    });
    expect(res.outcome).toBe("failed");
  });
});
