// v3/tests/unit/state-machine-todo-done.test.ts
//
// friction #6 — TODO → DONE 직접 전이 허용(logical / 미claim 태스크).
// 이 전이 규칙은 두 곳에 동일하게 복제돼 있다:
//   - src/services/stateMachine.ts        (렌더러 authoritative)
//   - electron/mcp-server/tools.ts        (MCP update_task_status — 동일 표 미러)
// tools.ts 는 ./firebase.js(real firebase/auth) 를 끌어와 단위 테스트에서 임포트할
// 수 없으므로, 동기화되는 렌더러 복사본으로 규칙을 고정한다.
import { describe, expect, it } from "vitest";
import {
  canTransition,
  getNextStatuses,
} from "../../src/services/stateMachine";

describe("TODO → DONE direct transition (friction #6)", () => {
  it("canTransition(TODO, DONE) is true (no force needed)", () => {
    expect(canTransition("TODO", "DONE")).toBe(true);
  });

  it("getNextStatuses(TODO) includes DONE alongside CLAIMED/IN_PROGRESS", () => {
    const next = getNextStatuses("TODO");
    expect(next).toContain("DONE");
    expect(next).toContain("CLAIMED");
    expect(next).toContain("IN_PROGRESS");
  });

  it("does not loosen unrelated terminal rules (DONE stays terminal)", () => {
    expect(getNextStatuses("DONE")).toEqual([]);
    expect(canTransition("DONE", "TODO")).toBe(false);
  });
});
