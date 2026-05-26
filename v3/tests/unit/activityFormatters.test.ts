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

  it("task:progress — IN_PROGRESS / submit_for_review 경로", () => {
    const out = formatActivity(
      entry({
        type: "task:progress",
        toolName: "submit_for_review",
        params: { title: "API 리팩터" },
      })
    );
    expect(out.headline).toBe('Task: progress "API 리팩터"');
  });

  it("mission:note — agent 가 supervisor 노트로 남긴 항목", () => {
    const out = formatActivity(
      entry({
        type: "mission:note",
        toolName: "mission.supervisor.note",
        agentId: "mission:abc12345",
        result: "스텝 2 재시도 결정",
      })
    );
    expect(out.headline).toBe(
      "Mission: mission:abc12345 note — 스텝 2 재시도 결정"
    );
  });

  it("pm:feedback — 피드백 카드 헤드라인", () => {
    const out = formatActivity(
      entry({
        type: "pm:feedback",
        toolName: "acknowledge_feedback",
        params: { title: "백엔드 API 작업" },
      })
    );
    expect(out.headline).toBe('PM: feedback on "백엔드 API 작업"');
  });

  // ── 프로덕션 경로: 실제 tool schema 에 title 없을 때 result 에서 추출 ──

  it("task:completed — params 에 title 없으면 update_task_status result 에서 추출", () => {
    const out = formatActivity(
      entry({
        type: "task:completed",
        toolName: "update_task_status",
        params: { task_id: "abc12345-0000", status: "DONE" },
        result: "Task '백엔드 마이그레이션' status updated to DONE.",
      })
    );
    expect(out.headline).toBe('Task: completed "백엔드 마이그레이션"');
  });

  it("task:claimed — claim_task result 의 'Successfully claimed task:' 패턴 추출", () => {
    const out = formatActivity(
      entry({
        type: "task:claimed",
        toolName: "claim_task",
        agentId: "backend-3",
        params: { task_id: "def67890" },
        result:
          "Successfully claimed task: 프론트엔드 리팩터\nID: def67890\nStatus: CLAIMED",
      })
    );
    expect(out.headline).toBe(
      'Task: claimed by backend-3 — "프론트엔드 리팩터"'
    );
  });

  it("task:progress — title 도 result 도 못찾으면 task_id 8자 폴백", () => {
    const out = formatActivity(
      entry({
        type: "task:progress",
        toolName: "submit_for_review",
        params: { task_id: "ef0e9f11-816a-4ac1" },
        result: "(empty/non-matching)",
      })
    );
    expect(out.headline).toBe('Task: progress "task ef0e9f11"');
  });

  it("activity:note — 빈 message 일 때 trailing dash 안 남기고 '(no message)' 폴백", () => {
    const out = formatActivity(
      entry({
        type: "activity:note",
        toolName: "add_activity",
        agentId: "backend-4",
        params: {},
      })
    );
    expect(out.headline).toBe("Note: backend-4 — (no message)");
  });

  it("mission:note — 빈 body 폴백", () => {
    const out = formatActivity(
      entry({
        type: "mission:note",
        toolName: "mission.supervisor.note",
        agentId: "mission:xyz98765",
        result: "",
      })
    );
    expect(out.headline).toBe("Mission: mission:xyz98765 note — (no message)");
  });
});
