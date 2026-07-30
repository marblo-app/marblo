/**
 * 스토어는 전 tier 를 **보여주되** 설치는 official/verified 만 허용한다.
 *
 * 이 파일이 지키는 것은 표시 정책이다 — 회귀 위험은 둘: (1) community 가 다시
 * 목록에서 사라져 카탈로그가 자기 카탈로그를 감추는 것, (2) "커뮤니티 N개"
 * 공시의 N 이 화면에 걸린 타입 필터와 다른 모집단에서 세어져 거짓말이 되는 것.
 *
 * ★ 설치 차단(§6.3)은 이 함수가 아니라 카드의 `installable` 판정이 한다. 표시를
 * 여는 변경이 설치까지 열면 안 되므로 두 결정이 분리돼 있고, 여기서 community 가
 * visible 에 들어오는 것은 설치 허용과 아무 관계가 없다.
 */
import { describe, it, expect } from "vitest";
import {
  isRegistryItemInstallable,
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

  it("★community 도 목록에 보이고, 개수는 따로 공시된다", () => {
    const { visible, communityCount } = splitRegistryByTier(items);
    expect(visible).toHaveLength(items.length);
    expect(visible.some((i) => i.tier === "community")).toBe(true);
    expect(communityCount).toBe(3);
  });

  // 감추는 대신 순서로 푼다: 설치 가능한 tier 가 먼저, community 는 뒤로.
  // 레지스트리는 community 가 압도적으로 많아서, 순서를 안 잡으면 official /
  // verified 가 스크롤 아래로 밀려 "보여주기"가 사실상 감추기가 된다.
  it("★official → verified → community 순으로, 같은 tier 안에선 입력 순서 유지", () => {
    const { visible } = splitRegistryByTier(items);
    expect(visible.map((i) => i.id)).toEqual([
      "off-skill",
      "off-mcp",
      "ver-skill",
      "com-skill-a",
      "com-skill-b",
      "com-mcp",
    ]);
  });

  it("타입 필터가 걸리면 목록과 카운트가 같은 모집단을 본다", () => {
    const skills = splitRegistryByTier(items, "skill");
    expect(skills.visible.map((i) => i.id)).toEqual([
      "off-skill",
      "ver-skill",
      "com-skill-a",
      "com-skill-b",
    ]);
    expect(skills.communityCount).toBe(2);

    const mcps = splitRegistryByTier(items, "mcp-server");
    expect(mcps.visible.map((i) => i.id)).toEqual(["off-mcp", "com-mcp"]);
    expect(mcps.communityCount).toBe(1);
  });

  it("community 만 있어도 빈 상태가 아니다 — 목록으로 뜬다", () => {
    const { visible, communityCount } = splitRegistryByTier([
      item("com-1", "community"),
      item("com-2", "community"),
    ]);
    expect(visible.map((i) => i.id)).toEqual(["com-1", "com-2"]);
    expect(communityCount).toBe(2);
  });

  it("빈 상태는 레지스트리가 정말로 비었을 때뿐이다", () => {
    const { visible, communityCount } = splitRegistryByTier([]);
    expect(visible).toEqual([]);
    expect(communityCount).toBe(0);
  });
});

/**
 * ★설치 게이트(§6.3) — 이 스위트가 진짜 보안 불변식이다. 스토어가 community 를
 * 보여주게 된 뒤로 "목록에서 안 보임" 이 더는 차단이 아니므로, 차단은 오직
 * 여기서만 일어난다. 이 테스트가 빨개지면 미검수 페이로드에 원클릭 설치 버튼이
 * 달린 것이다.
 */
describe("isRegistryItemInstallable", () => {
  const contract = { kind: "files" as const };

  it("official/verified + 설치계약 + active 만 설치 가능", () => {
    expect(
      isRegistryItemInstallable({
        tier: "official",
        install: contract,
        status: "active",
      }),
    ).toBe(true);
    expect(
      isRegistryItemInstallable({
        tier: "verified",
        install: contract,
        status: "active",
      }),
    ).toBe(true);
  });

  it("★community 는 설치계약이 있어도 절대 설치 불가", () => {
    expect(
      isRegistryItemInstallable({
        tier: "community",
        install: contract,
        status: "active",
      }),
    ).toBe(false);
    expect(
      isRegistryItemInstallable({
        tier: "community",
        install: { kind: "mcp-server" },
        status: "active",
      }),
    ).toBe(false);
  });

  it("설치계약이 없으면 tier 와 무관하게 설치 불가", () => {
    expect(
      isRegistryItemInstallable({
        tier: "official",
        install: null,
        status: "active",
      }),
    ).toBe(false);
  });

  it("회수된 항목은 설치 불가", () => {
    expect(
      isRegistryItemInstallable({
        tier: "official",
        install: contract,
        status: "revoked",
      }),
    ).toBe(false);
  });

  it("표시 정책과 설치 게이트는 분리돼 있다 — visible 이어도 설치는 막힌다", () => {
    const community = {
      id: "com",
      tier: "community" as const,
      type: "skill" as const,
      name: "com",
      version: "1.0.0",
      description: "",
      permissions: [],
      permissionsDeclared: true,
      install: contract,
      status: "active" as const,
    } as Item;
    const { visible } = splitRegistryByTier([community]);
    expect(visible).toHaveLength(1);
    expect(isRegistryItemInstallable(visible[0])).toBe(false);
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
    i18n: {
      ko: { name: "코드 리뷰", description: "에이전트 코드를 리뷰한다." },
    },
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
