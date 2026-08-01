import { describe, it, expect } from "vitest";
import {
  resolveMemberDisplayName,
  sortMembersByRole,
} from "../../src/lib/teamMembers";
import type { User } from "../../src/types/user";
import type { InvitationRole } from "../../src/types/invitation";

function user(id: string, over: Partial<User> = {}): User {
  return {
    id,
    email: `${id}@example.com`,
    displayName: "",
    photoURL: "",
    createdAt: new Date("2026-01-01"),
    ...over,
  };
}

describe("resolveMemberDisplayName", () => {
  it("users 문서 displayName 이 있으면 그대로 쓴다", () => {
    expect(
      resolveMemberDisplayName(user("u1", { displayName: "Ada" }), "Ignored")
    ).toBe("Ada");
  });

  it("displayName 이 비어 있으면 presence displayName 으로 폴백한다", () => {
    expect(
      resolveMemberDisplayName(user("u1", { displayName: "" }), "Grace")
    ).toBe("Grace");
  });

  it("presence 도 없으면 email 로 폴백한다", () => {
    expect(
      resolveMemberDisplayName(
        user("u1", { displayName: "", email: "grace@example.com" })
      )
    ).toBe("grace@example.com");
  });

  it("email 마저 없으면 uid 로 폴백한다(빈 이름을 남기지 않는다)", () => {
    expect(
      resolveMemberDisplayName(user("u1", { displayName: "", email: "" }))
    ).toBe("u1");
  });
});

describe("sortMembersByRole", () => {
  const roles: Record<string, InvitationRole> = {
    owner1: "owner",
    admin1: "admin",
    member1: "member",
    member2: "member",
    viewer1: "viewer",
  };

  it("owner → admin → member → viewer 순으로 정렬한다", () => {
    const members = [
      user("viewer1", { displayName: "Viewer" }),
      user("member1", { displayName: "Zed" }),
      user("owner1", { displayName: "Owner" }),
      user("admin1", { displayName: "Admin" }),
    ];

    const sorted = sortMembersByRole(members, roles);
    expect(sorted.map((m) => m.id)).toEqual([
      "owner1",
      "admin1",
      "member1",
      "viewer1",
    ]);
  });

  it("오너가 배열 맨 뒤에 있어도 항상 맨 위로 온다", () => {
    const members = [
      user("member1", { displayName: "Zed" }),
      user("member2", { displayName: "Amy" }),
      user("owner1", { displayName: "Owner" }),
    ];

    const sorted = sortMembersByRole(members, roles);
    expect(sorted[0].id).toBe("owner1");
  });

  it("같은 role 안에서는 이름순으로 정렬한다", () => {
    const members = [
      user("member1", { displayName: "Zed" }),
      user("member2", { displayName: "Amy" }),
    ];

    const sorted = sortMembersByRole(members, roles);
    expect(sorted.map((m) => m.id)).toEqual(["member2", "member1"]);
  });

  it("memberRoles 에 없는 uid 는 member 취급한다", () => {
    const members = [
      user("owner1", { displayName: "Owner" }),
      user("unknown1", { displayName: "Unknown" }),
    ];

    const sorted = sortMembersByRole(members, { owner1: "owner" });
    expect(sorted.map((m) => m.id)).toEqual(["owner1", "unknown1"]);
  });

  it("원본 배열을 변형하지 않는다", () => {
    const members = [
      user("member1", { displayName: "Zed" }),
      user("owner1", { displayName: "Owner" }),
    ];
    const original = [...members];

    sortMembersByRole(members, roles);
    expect(members).toEqual(original);
  });
});
