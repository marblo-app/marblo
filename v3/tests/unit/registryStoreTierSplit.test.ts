/**
 * 인앱 Store 는 official/verified 만 보여주고 community 는 GitHub 카탈로그로
 * 보낸다. 회귀 위험은 둘 — (1) community 가 목록으로 새는 것, (2) "커뮤니티 N개"
 * 링크의 N 이 화면에 걸린 타입 필터와 다른 모집단에서 세어져 거짓말이 되는 것.
 */
import { describe, it, expect } from "vitest";
import {
  localizedItemText,
  splitRegistryByTier,
} from "../../src/components/harness/RegistryStoreSection";

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

/**
 * 로케일 오버레이 표시 규칙. 회귀 위험은 둘 — (1) 번역이 있는데도 영어가 나오는
 * 것, (2) **부분 번역이 통째로 사라지는 것**(둘 다 있어야 쓴다는 규칙으로
 * 퇴화하면 이름만 옮긴 항목이 전부 영어로 되돌아간다).
 */
describe("localizedItemText", () => {
  const translated = {
    name: "Code Review",
    description: "Review agent-generated code.",
    i18n: { ko: { name: "코드 리뷰", description: "에이전트 코드를 리뷰한다." } },
  };

  it("ko 로케일에서 ko 오버레이를 쓴다", () => {
    expect(localizedItemText(translated, "ko")).toEqual({
      name: "코드 리뷰",
      description: "에이전트 코드를 리뷰한다.",
    });
  });

  it("en 로케일은 오버레이가 있어도 영어 base 를 쓴다", () => {
    expect(localizedItemText(translated, "en")).toEqual({
      name: "Code Review",
      description: "Review agent-generated code.",
    });
  });

  it("오버레이가 없는 항목은 ko 에서도 영어 base 로 폴백한다", () => {
    const untranslated = { name: "Exa MCP", description: "Web search." };
    expect(localizedItemText(untranslated, "ko")).toEqual(untranslated);
  });

  it("폴백은 필드 단위 — 이름만 번역돼도 그 이름은 살아남는다", () => {
    const half = {
      name: "Marblo Control MCP",
      description: "Run the board.",
      i18n: { ko: { description: "보드를 운영한다." } },
    };
    expect(localizedItemText(half, "ko")).toEqual({
      name: "Marblo Control MCP",
      description: "보드를 운영한다.",
    });

    const nameOnly = {
      name: "Reviewer Agent",
      description: "Claims review tickets.",
      i18n: { ko: { name: "리뷰어 에이전트" } },
    };
    expect(localizedItemText(nameOnly, "ko")).toEqual({
      name: "리뷰어 에이전트",
      description: "Claims review tickets.",
    });
  });

  it("다른 로케일(ja)만 있는 항목은 ko 에서 영어 base 로 폴백한다", () => {
    const jaOnly = {
      name: "Serena MCP",
      description: "Semantic code tools.",
      i18n: { ja: { name: "セレナ MCP" } },
    };
    expect(localizedItemText(jaOnly, "ko")).toEqual({
      name: "Serena MCP",
      description: "Semantic code tools.",
    });
  });
});
