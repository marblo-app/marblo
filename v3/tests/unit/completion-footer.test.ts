/**
 * withCompletionFooter — dispatch 완료 규약 footer 테스트.
 *
 * 완료 보고 규약 확장 회귀 가드: footer 가
 *   - taskId 없으면 no-op (one-off dispatch),
 *   - taskId 있으면 기존 완료/실패 도구 + 새 "✅ 완료 보고" 구조화 add_activity 안내를
 *     포함하고, 원본 instruction 을 앞에 보존(append-only)하는지 핀한다.
 */
import { describe, it, expect } from "vitest";
import { withCompletionFooter } from "../../electron/bridge-server";

describe("withCompletionFooter", () => {
  it("taskId 가 없으면 instruction 을 그대로 반환(no-op)", () => {
    expect(withCompletionFooter("do the thing")).toBe("do the thing");
    expect(withCompletionFooter("do the thing", undefined)).toBe(
      "do the thing",
    );
  });

  it("원본 instruction 을 앞에 보존하고 footer 를 뒤에 붙인다", () => {
    const out = withCompletionFooter("ORIGINAL", "task-xyz");
    expect(out.startsWith("ORIGINAL")).toBe(true);
    expect(out).toContain('[완료 규약 — task_id="task-xyz"]');
  });

  it('완료 직전 "✅ 완료 보고" 구조화 add_activity 안내를 포함한다', () => {
    const out = withCompletionFooter("x", "task-xyz");
    expect(out).toContain("✅ 완료 보고");
    // 구조화 필드(문제/접근/변경/검증/PR)를 안내.
    expect(out).toContain("문제");
    expect(out).toContain("접근");
    expect(out).toContain("변경");
    expect(out).toContain("검증");
    // submit_for_review 의 summary 인자 경로도 안내.
    expect(out).toContain("summary");
  });

  // 2026-07-19 회귀 가드: 막힌 에이전트가 사용자에게 직접 묻고 idle 로 멈췄다.
  // footer 는 질문 대상을 오케로 돌리되, "모르면 추측하라"로 읽혀선 안 된다 —
  // 근거 없는 추측 수정은 '머지됨≠동작함' 오판을 재발시킨다.
  describe("막힘 규약", () => {
    it("사용자 직접 질문을 금지하고 오케 보고 경로를 안내한다", () => {
      const out = withCompletionFooter("x", "task-xyz");
      expect(out).toContain("사용자에게 직접 묻지 말 것");
      expect(out).toContain("[질문]");
      expect(out).toContain(
        'update_task_status(task_id="task-xyz", status="BLOCKED"',
      );
    });

    // P5-1: 타입드 질문 채널이 기본 경로가 됐다. 구 경로(add_activity + [질문])는
    // 안내가 남아 있어야 하지만, 우선 안내는 ask_orchestrator 여야 한다.
    it("타입드 질문 채널(ask_orchestrator)을 우선 안내한다", () => {
      const out = withCompletionFooter("x", "task-xyz");
      expect(out).toContain('ask_orchestrator(task_id="task-xyz"');
      expect(out).toContain("question_id");
      expect(out).toContain("answer_question");
    });

    it("질문 자체는 유지하고 추측 수정을 금지한다 (과잉교정 방지)", () => {
      const out = withCompletionFooter("x", "task-xyz");
      expect(out).toContain("추측으로 고치지 마라");
      expect(out).toContain("모르면 묻는 게 맞다");
    });

    it("막혀도 독립적인 잔여 작업은 계속하라고 지시한다", () => {
      const out = withCompletionFooter("x", "task-xyz");
      expect(out).toContain("멈추지 마라");
      expect(out).toContain("잔여 작업");
    });
  });

  it("기존 완료/실패 보고 도구 안내는 그대로 유지(회귀 가드)", () => {
    const out = withCompletionFooter("x", "task-xyz");
    expect(out).toContain('submit_for_review(task_id="task-xyz"');
    expect(out).toContain(
      'update_task_status(task_id="task-xyz", status="FAILED"',
    );
    expect(out).toContain('add_activity(task_id="task-xyz"');
  });
});
