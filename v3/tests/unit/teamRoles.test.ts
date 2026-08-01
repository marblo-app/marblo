import { describe, it, expect } from "vitest";
import {
  canMergeAsRole,
  assignableRolesFor,
  canEditMemberRole,
} from "../../src/lib/teamRoles";

describe("canMergeAsRole — 코드 머지는 관리자(owner/admin)만", () => {
  it("owner/admin 은 머지 가능", () => {
    expect(canMergeAsRole("owner")).toBe(true);
    expect(canMergeAsRole("admin")).toBe(true);
  });

  it("member/viewer 는 머지 불가", () => {
    expect(canMergeAsRole("member")).toBe(false);
    expect(canMergeAsRole("viewer")).toBe(false);
  });

  it("role 미상(null/undefined)은 fail-closed", () => {
    expect(canMergeAsRole(null)).toBe(false);
    expect(canMergeAsRole(undefined)).toBe(false);
  });
});

describe("assignableRolesFor — admin 승격은 owner 전용", () => {
  it("owner 는 admin/member/viewer 를 부여할 수 있다", () => {
    expect(assignableRolesFor("owner")).toEqual(["admin", "member", "viewer"]);
  });

  it("admin 은 member/viewer 만 부여할 수 있다(admin 부여 불가)", () => {
    expect(assignableRolesFor("admin")).toEqual(["member", "viewer"]);
  });

  it("member/viewer 는 아무 role 도 부여할 수 없다", () => {
    expect(assignableRolesFor("member")).toEqual([]);
    expect(assignableRolesFor("viewer")).toEqual([]);
  });
});

describe("canEditMemberRole — owner role 불변 + admin 의 admin 강등 불가", () => {
  it("owner role 은 누구도 편집 불가(owner 자신 강등 차단의 근거)", () => {
    expect(canEditMemberRole("owner", "owner")).toBe(false);
    expect(canEditMemberRole("admin", "owner")).toBe(false);
  });

  it("owner 는 admin/member/viewer 를 편집할 수 있다", () => {
    expect(canEditMemberRole("owner", "admin")).toBe(true);
    expect(canEditMemberRole("owner", "member")).toBe(true);
    expect(canEditMemberRole("owner", "viewer")).toBe(true);
  });

  it("admin 은 member/viewer 만 편집, 다른 admin 은 불가", () => {
    expect(canEditMemberRole("admin", "admin")).toBe(false);
    expect(canEditMemberRole("admin", "member")).toBe(true);
    expect(canEditMemberRole("admin", "viewer")).toBe(true);
  });

  it("member/viewer 는 아무도 편집 불가", () => {
    expect(canEditMemberRole("member", "member")).toBe(false);
    expect(canEditMemberRole("viewer", "viewer")).toBe(false);
  });
});
