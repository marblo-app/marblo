import { describe, expect, it } from "vitest";
import {
  formatClaimOwnershipError,
  getClaimOwnershipError,
  shouldReleaseClaimForStoppedAgent,
  taskStatusAfterClaimRelease,
} from "../../electron/mcp-server/task-ownership";

describe("task ownership guard", () => {
  it("allows the claiming agent to update its own claimed task", () => {
    expect(
      getClaimOwnershipError({
        claimedBy: "agent-a",
        actorAgentId: "agent-a",
      }),
    ).toBeNull();
  });

  it("rejects a different agent with the explicit ownership error", () => {
    expect(
      getClaimOwnershipError({
        claimedBy: "agent-a",
        actorAgentId: "agent-b",
      }),
    ).toBe(
      "Task is claimed by agent agent-a; only the claiming agent can update it",
    );
    expect(formatClaimOwnershipError("agent-a")).toBe(
      "Task is claimed by agent agent-a; only the claiming agent can update it",
    );
  });

  it("lets force=true bypass the ownership guard", () => {
    expect(
      getClaimOwnershipError({
        claimedBy: "agent-a",
        actorAgentId: "agent-b",
        force: true,
      }),
    ).toBeNull();
  });
});

describe("stopped-agent claim release guard", () => {
  it("releases only tasks claimed by the stopped agent", () => {
    expect(
      shouldReleaseClaimForStoppedAgent({
        claimedBy: "dead-agent",
        stoppedAgentId: "dead-agent",
      }),
    ).toBe(true);
    expect(
      shouldReleaseClaimForStoppedAgent({
        claimedBy: "live-agent",
        stoppedAgentId: "dead-agent",
      }),
    ).toBe(false);
    expect(
      shouldReleaseClaimForStoppedAgent({
        claimedBy: null,
        stoppedAgentId: "dead-agent",
      }),
    ).toBe(false);
  });
});

// ────────────────────────────────────────────────────────────────────────────
// 회수가 티켓을 **실제로 되살리는가** — 티켓 nzkdcE7W6P2uGYqCa3rU (진단 §5.3-b)
//
// 문제였던 것: releaseTaskClaimsForDeadAgent 가 claimedBy/claimedAt 만 지우고
// status 는 IN_PROGRESS 그대로 뒀다. 그런데 양쪽 입구가 전부 TODO 만 받는다 —
// get_available_tasks 는 status=="TODO" 만 쿼리하고, claim_task 는 TODO 가 아니면
// "not available for claiming" 으로 거부한다.
// ⇒ 회수돼도 아무도 다시 집을 수 없는 유령 티켓이 됐다(실측 9시간 방치).
// ────────────────────────────────────────────────────────────────────────────
describe("taskStatusAfterClaimRelease — 죽은 claim 회수 시 상태 복원", () => {
  it("집혔지만 제출 전인 상태만 TODO 로 되살린다", () => {
    expect(taskStatusAfterClaimRelease("IN_PROGRESS")).toBe("TODO");
    expect(taskStatusAfterClaimRelease("CLAIMED")).toBe("TODO");
  });

  it("REVIEW 는 되돌리지 않는다 — 산출물이 이미 제출됐다", () => {
    // 되돌리면 제출된 작업이 통째로 사라지고 처음부터 다시 하게 된다.
    expect(taskStatusAfterClaimRelease("REVIEW")).toBeNull();
  });

  it("BLOCKED 는 되돌리지 않는다 — 답을 기다리는 중이다", () => {
    expect(taskStatusAfterClaimRelease("BLOCKED")).toBeNull();
  });

  it("종결 상태와 미지의 값은 손대지 않는다", () => {
    for (const s of ["DONE", "FAILED", "TODO", "", null, undefined, 7]) {
      expect(taskStatusAfterClaimRelease(s)).toBeNull();
    }
  });

  it("★회수 → 재클레임이 실제로 이어진다 (입구 조건과 맞물리는지)", () => {
    // 회수 대상 판정 → 상태 복원 → 그 결과가 두 입구의 조건("TODO")을 만족한다.
    const claimedBy = "dead-agent";
    expect(
      shouldReleaseClaimForStoppedAgent({
        claimedBy,
        stoppedAgentId: claimedBy,
      }),
    ).toBe(true);
    const revived = taskStatusAfterClaimRelease("IN_PROGRESS");
    expect(revived).toBe("TODO"); // get_available_tasks 의 where 조건과 동일
  });

  it("★반대방향: 살아 있는 다른 에이전트의 claim 은 회수 대상이 아니다", () => {
    expect(
      shouldReleaseClaimForStoppedAgent({
        claimedBy: "live-agent",
        stoppedAgentId: "some-other-dead-agent",
      }),
    ).toBe(false);
  });
});
