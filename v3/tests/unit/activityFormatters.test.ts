import { describe, it, expect } from "vitest";
import { formatActivity } from "../../src/services/activityFormatters";
import type { ActivityEntry } from "../../src/services/activityStreamService";

function entry(over: Partial<ActivityEntry>): ActivityEntry {
  return {
    id: "x",
    type: "other",
    toolName: "noop",
    agentId: "agent-1",
    projectId: "p",
    params: {},
    result: "",
    duration: 0,
    success: true,
    createdAt: new Date(),
    ...over,
  };
}

describe("formatActivity", () => {
  it("task:created — title 으로 헤드라인 구성", () => {
    const out = formatActivity(
      entry({
        type: "task:created",
        toolName: "create_task",
        params: { title: "백엔드 API" },
      })
    );
    expect(out.headline).toBe('Task: created "백엔드 API"');
  });

  it("task:claimed — agent + title", () => {
    const out = formatActivity(
      entry({
        type: "task:claimed",
        toolName: "claim_task",
        agentId: "backend-1",
        params: { title: "API 작업" },
      })
    );
    expect(out.headline).toBe('Task: claimed by backend-1 — "API 작업"');
  });

  it("task:completed — DONE 상태", () => {
    const out = formatActivity(
      entry({
        type: "task:completed",
        toolName: "update_task_status",
        params: { title: "마이그레이션", status: "DONE" },
      })
    );
    expect(out.headline).toBe('Task: completed "마이그레이션"');
  });

  it("task:blocked — reason 포함", () => {
    const out = formatActivity(
      entry({
        type: "task:blocked",
        toolName: "update_task_status",
        params: { title: "Step A", status: "BLOCKED", reason: "DB lock" },
      })
    );
    expect(out.headline).toBe('Task: blocked "Step A" — DB lock');
  });

  it("agent:spawned — role 표시", () => {
    const out = formatActivity(
      entry({
        type: "agent:spawned",
        toolName: "spawn_agent",
        params: { role: "frontend" },
      })
    );
    expect(out.headline).toBe("Agent: spawned frontend");
  });

  it("mission:step — result(이미 정제된 한국어) 그대로 사용", () => {
    const out = formatActivity(
      entry({
        type: "mission:step",
        toolName: "mission.step.started",
        result: "Step 2 · skill_name",
      })
    );
    expect(out.headline).toBe("Mission: Step 2 · skill_name");
  });

  it("mission:state — result 그대로", () => {
    const out = formatActivity(
      entry({
        type: "mission:state",
        toolName: "mission.mission.paused",
        result: "Paused · user-input",
      })
    );
    expect(out.headline).toBe("Mission: Paused · user-input");
  });

  it("activity:note — message 본문", () => {
    const out = formatActivity(
      entry({
        type: "activity:note",
        toolName: "add_activity",
        agentId: "backend-2",
        params: { message: "DB 마이그레이션 시작" },
      })
    );
    expect(out.headline).toBe("Note: backend-2 — DB 마이그레이션 시작");
  });

  it("error — failed tool 이름 + reason", () => {
    const out = formatActivity(
      entry({
        type: "error",
        toolName: "create_task",
        success: false,
        result: "validation failed: title required",
      })
    );
    expect(out.headline).toBe(
      "Error: create_task failed — validation failed: title required"
    );
  });

  it("title 누락 시 'untitled' 폴백", () => {
    const out = formatActivity(
      entry({ type: "task:created", toolName: "create_task", params: {} })
    );
    expect(out.headline).toBe('Task: created "untitled"');
  });

  it("raw result 를 절대 headline 으로 노출하지 않음 (other 타입)", () => {
    const out = formatActivity(
      entry({
        type: "other",
        toolName: "unknown_tool",
        result: "# Orchestrator Agent 스킬 본문...".repeat(20),
      })
    );
    expect(out.headline).toBe(""); // 빈 헤드라인 → 카드 미렌더
  });
});
