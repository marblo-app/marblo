/**
 * 인앱 Store 는 official/verified 만 보여주고 community 는 GitHub 카탈로그로
 * 보낸다. 회귀 위험은 둘 — (1) community 가 목록으로 새는 것, (2) "커뮤니티 N개"
 * 링크의 N 이 화면에 걸린 타입 필터와 다른 모집단에서 세어져 거짓말이 되는 것.
 */
import { describe, it, expect } from "vitest";
import { splitRegistryByTier } from "../../src/components/harness/RegistryStoreSection";

type Item = Parameters<typeof splitRegistryByTier>[0][number];

function item(
  id: string,
  tier: Item["tier"],
  type: Item["type"] = "skill",
): Item {
  return {
    id,
    tier,
    type,
    name: id,
    version: "1.0.0",
    description: "",
    permissions: [],
    permissionsDeclared: true,
  } as Item;
}

describe("splitRegistryByTier", () => {
  const items = [
    item("off-skill", "official"),
    item("ver-skill", "verified"),
    item("com-skill-a", "community"),
    item("com-skill-b", "community"),
    item("com-mcp", "community", "mcp-server"),
    item("off-mcp", "official", "mcp-server"),
  ];

  it("community 를 목록에서 제외하고 개수만 남긴다", () => {
    const { visible, communityCount } = splitRegistryByTier(items);
    expect(visible.map((i) => i.id)).toEqual([
      "off-skill",
      "ver-skill",
      "off-mcp",
    ]);
    expect(visible.every((i) => i.tier !== "community")).toBe(true);
    expect(communityCount).toBe(3);
  });

  it("타입 필터가 걸리면 목록과 카운트가 같은 모집단을 본다", () => {
    const skills = splitRegistryByTier(items, "skill");
    expect(skills.visible.map((i) => i.id)).toEqual(["off-skill", "ver-skill"]);
    expect(skills.communityCount).toBe(2);

    const mcps = splitRegistryByTier(items, "mcp-server");
    expect(mcps.visible.map((i) => i.id)).toEqual(["off-mcp"]);
    expect(mcps.communityCount).toBe(1);
  });

  it("community 만 있으면 빈 상태 + 카운트가 된다", () => {
    const { visible, communityCount } = splitRegistryByTier([
      item("com-1", "community"),
      item("com-2", "community"),
    ]);
    expect(visible).toEqual([]);
    expect(communityCount).toBe(2);
  });
});
