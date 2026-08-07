/** project-scope.ts 단위 테스트 (티켓 4ov5wbQZ25XUXHZVhxdh). */

import { describe, it, expect } from "vitest";
import {
  PROJECT_SCOPED_COLLECTIONS,
  isProjectScopedCollection,
  requireProjectScope,
  isPermissionDeniedError,
  MissingProjectScopeError,
} from "../../electron/mcp-server/project-scope";

describe("requireProjectScope", () => {
  it("스코프 컬렉션 + projectId 있으면 trim 된 값을 돌려준다", () => {
    expect(requireProjectScope("tasks", "  proj-1 ", "op")).toBe("proj-1");
  });

  it("스코프 컬렉션인데 projectId 가 비면 throw — 거부될 쿼리를 쏘지 않는다", () => {
    for (const empty of ["", "   ", undefined, null]) {
      expect(() => requireProjectScope("tasks", empty, "op")).toThrow(
        MissingProjectScopeError,
      );
    }
  });

  it("스코프 컬렉션이 아니면 null (projectId 조건을 붙이면 안 되는 경우)", () => {
    expect(requireProjectScope("activities", "", "op")).toBeNull();
    expect(requireProjectScope("missions", undefined, "op")).toBeNull();
  });

  it("에러 메시지가 원인과 조치를 모두 말한다", () => {
    try {
      requireProjectScope("tasks", "", "get_all_tasks");
      throw new Error("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(MissingProjectScopeError);
      const message = (err as Error).message;
      expect(message).toContain("tasks");
      expect(message).toContain("get_all_tasks");
      expect(message).toContain("projectId");
      expect(message).toContain("MARBLO_PROJECT");
    }
  });
});

describe("PROJECT_SCOPED_COLLECTIONS", () => {
  it("상태쓰기 경로가 쓰는 컬렉션을 포함한다", () => {
    for (const c of ["tasks", "agents", "flows"]) {
      expect(isProjectScopedCollection(c)).toBe(true);
    }
  });

  it("taskId 로 증명되는 activities 와 룰이 열린 missions 는 제외한다", () => {
    expect(isProjectScopedCollection("activities")).toBe(false);
    expect(isProjectScopedCollection("missions")).toBe(false);
    expect(PROJECT_SCOPED_COLLECTIONS).not.toContain("activities");
  });
});

describe("isPermissionDeniedError", () => {
  it("Firebase code / 메시지 / 자체 에러를 모두 인식한다", () => {
    expect(isPermissionDeniedError({ code: "permission-denied" })).toBe(true);
    expect(
      isPermissionDeniedError(new Error("Missing or insufficient permissions")),
    ).toBe(true);
    expect(
      isPermissionDeniedError(new MissingProjectScopeError("tasks", "x")),
    ).toBe(true);
  });

  it("색인 누락 같은 다른 실패는 false (폴백 경로가 살아 있어야 한다)", () => {
    expect(
      isPermissionDeniedError(new Error("The query requires an index")),
    ).toBe(false);
    expect(isPermissionDeniedError(null)).toBe(false);
  });
});
