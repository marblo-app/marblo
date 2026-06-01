// Spec: v3/docs/specs/2026-05-28-orch-live-awareness-design.md §13.3
// MCP 도구 4종 (claim_task / update_task_status / submit_for_review / add_activity)
// 이 projection 을 어떻게 갱신하는지를 pure function 으로 검증.
// 트랜잭션 wrapper (applyProjection) 의 Firestore 호출 자체는 통합 테스트 영역.

import { describe, it, expect } from "vitest";
import { Timestamp } from "firebase/firestore";
import {
  computeTaskProjection,
  applyMissionStatusDelta,
  type TaskProjection,
} from "../../electron/mcp-server/projection";

const TID = "task-123";
const NOW = Timestamp.fromMillis(1_750_000_000_000);
const LATER = Timestamp.fromMillis(1_750_000_060_000);

describe("computeTaskProjection — MCP 도구 4종 시나리오", () => {
  it("claim_task: TODO 상태에서 호출되면 currentStatus=CLAIMED, lastAgentId 갱신", () => {
    const next = computeTaskProjection(undefined, "TODO", TID, NOW, {
      newStatus: "CLAIMED",
      lastAgentId: "backend-claude-3",
      lastActivitySummary: "claimed by backend-claude-3",
    });
    expect(next.currentStatus).toBe("CLAIMED");
    expect(next.lastAgentId).toBe("backend-claude-3");
    expect(next.lastActivityAt).toBe(NOW);
    expect(next.lastActivitySummary).toBe("claimed by backend-claude-3");
    expect(next.milestonesPassed).toEqual([]);
    expect(next.blockerSummary).toBeUndefined();
  });

  it("update_task_status → BLOCKED: blockerSummary 가 comment 로 set", () => {
    const prev: TaskProjection = {
      currentStatus: "IN_PROGRESS",
      lastAgentId: "backend-claude-3",
      lastActivityAt: NOW,
      lastActivitySummary: "started",
      milestonesPassed: [],
    };
    const next = computeTaskProjection(prev, "IN_PROGRESS", TID, LATER, {
      newStatus: "BLOCKED",
      lastAgentId: "backend-claude-3",
      lastActivitySummary: "DB migration conflict",
      blockerSummary: "DB migration conflict — 0042 slot already on main",
    });
    expect(next.currentStatus).toBe("BLOCKED");
    expect(next.blockerSummary).toBe(
      "DB migration conflict — 0042 slot already on main",
    );
    expect(next.lastActivityAt).toBe(LATER);
  });

  it("update_task_status: BLOCKED → IN_PROGRESS 전이 시 blockerSummary 가 빈 문자열로 clear", () => {
    const prev: TaskProjection = {
      currentStatus: "BLOCKED",
      lastAgentId: "backend-claude-3",
      lastActivityAt: NOW,
      lastActivitySummary: "blocked on migration",
      milestonesPassed: [],
      blockerSummary: "DB migration conflict",
    };
    const next = computeTaskProjection(prev, "BLOCKED", TID, LATER, {
      newStatus: "IN_PROGRESS",
      lastAgentId: "backend-claude-3",
      lastActivitySummary: "resumed",
    });
    expect(next.currentStatus).toBe("IN_PROGRESS");
    expect(next.blockerSummary).toBe("");
  });

  it("add_activity: status 유지, lastActivitySummary 200자 자름, milestonesPassed 보존", () => {
    const prev: TaskProjection = {
      currentStatus: "IN_PROGRESS",
      lastAgentId: "backend-claude-3",
      lastActivityAt: NOW,
      lastActivitySummary: "started",
      milestonesPassed: [],
    };
    const longMsg = "x".repeat(300);
    const next = computeTaskProjection(prev, "IN_PROGRESS", TID, LATER, {
      // newStatus 미지정 — add_activity 는 status 안 바꿈
      lastAgentId: "backend-claude-3",
      lastActivitySummary: longMsg,
    });
    expect(next.currentStatus).toBe("IN_PROGRESS"); // 유지
    expect(next.lastActivitySummary).toHaveLength(200);
    expect(next.lastActivitySummary).toBe("x".repeat(200));
    expect(next.lastActivityAt).toBe(LATER);
  });

  it("submit_for_review: currentStatus=REVIEW, milestonesPassed 에 taskId append (중복 방지)", () => {
    const prev: TaskProjection = {
      currentStatus: "IN_PROGRESS",
      lastAgentId: "backend-claude-3",
      lastActivityAt: NOW,
      lastActivitySummary: "implemented",
      milestonesPassed: [],
    };
    const next = computeTaskProjection(prev, "IN_PROGRESS", TID, LATER, {
      newStatus: "REVIEW",
      lastAgentId: "backend-claude-3",
      lastActivitySummary: "submitted PR #123",
      appendMilestone: true,
    });
    expect(next.currentStatus).toBe("REVIEW");
    expect(next.milestonesPassed).toEqual([TID]);

    // 두 번째 submit 호출은 중복 추가 안 함
    const again = computeTaskProjection(next, "REVIEW", TID, LATER, {
      newStatus: "REVIEW",
      lastAgentId: "backend-claude-3",
      appendMilestone: true,
    });
    expect(again.milestonesPassed).toEqual([TID]);
  });

  it("lastAgentId 가 빈 문자열이면 prev 값 유지 (덮어쓰기 X)", () => {
    const prev: TaskProjection = {
      currentStatus: "IN_PROGRESS",
      lastAgentId: "backend-claude-3",
      lastActivityAt: NOW,
      lastActivitySummary: "ongoing",
      milestonesPassed: [],
    };
    const next = computeTaskProjection(prev, "IN_PROGRESS", TID, LATER, {
      lastAgentId: "", // env 에 MARBLO_AGENT_ID 없을 때
      lastActivitySummary: "tick",
    });
    expect(next.lastAgentId).toBe("backend-claude-3");
  });
});

describe("applyMissionStatusDelta — mission statusCounts 점진 갱신", () => {
  it("TODO → CLAIMED: TODO 카운트 -1, CLAIMED +1", () => {
    const next = applyMissionStatusDelta(
      { TODO: 3, CLAIMED: 1, IN_PROGRESS: 2 },
      "TODO",
      "CLAIMED",
    );
    expect(next).toEqual({ TODO: 2, CLAIMED: 2, IN_PROGRESS: 2 });
  });

  it("기존 counts 없을 때: old=0(floor), new=1 로 초기화", () => {
    const next = applyMissionStatusDelta(undefined, "TODO", "CLAIMED");
    expect(next).toEqual({ TODO: 0, CLAIMED: 1 });
  });

  it("같은 status (no-op): prev 사본 그대로", () => {
    const prev = { TODO: 3, CLAIMED: 1 };
    const next = applyMissionStatusDelta(prev, "TODO", "TODO");
    expect(next).toEqual(prev);
    expect(next).not.toBe(prev); // 새 객체
  });

  it("0 floor: 이미 0인 status 에서 빼도 음수 X", () => {
    const next = applyMissionStatusDelta(
      { CLAIMED: 0, IN_PROGRESS: 1 },
      "CLAIMED",
      "IN_PROGRESS",
    );
    expect(next.CLAIMED).toBe(0);
    expect(next.IN_PROGRESS).toBe(2);
  });
});
