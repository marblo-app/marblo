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

  it("기존 완료/실패 보고 도구 안내는 그대로 유지(회귀 가드)", () => {
    const out = withCompletionFooter("x", "task-xyz");
    expect(out).toContain('submit_for_review(task_id="task-xyz"');
    expect(out).toContain(
      'update_task_status(task_id="task-xyz", status="FAILED"',
    );
    expect(out).toContain('add_activity(task_id="task-xyz"');
  });
});
