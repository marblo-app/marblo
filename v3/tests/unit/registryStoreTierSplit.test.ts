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
  categorizeRegistryType,
  isCommunityHighRiskPermission,
  isReferenceOnlyRegistryType,
  isRegistryItemConsentInstallable,
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

describe("isCommunityHighRiskPermission", () => {
  it("community 의 고위험 권한만 경고 톤으로 판정한다", () => {
    expect(
      isCommunityHighRiskPermission({ tier: "community" }, "shell:exec"),
    ).toBe(true);
    expect(
      isCommunityHighRiskPermission({ tier: "community" }, "repository:write"),
    ).toBe(true);
  });

  it("official/verified 는 같은 권한도 정보성 공시로 판정한다", () => {
    for (const tier of ["official", "verified"] as const) {
      expect(isCommunityHighRiskPermission({ tier }, "shell:exec")).toBe(false);
      expect(isCommunityHighRiskPermission({ tier }, "repository:write")).toBe(
        false,
      );
    }
  });

  it("community 라도 일반 권한은 경고하지 않는다", () => {
    expect(
      isCommunityHighRiskPermission({ tier: "community" }, "filesystem:read"),
    ).toBe(false);
  });
});

/**
 * ★설치 판정(§6.3) — (a) 원클릭(official/verified)과 (b) community '동의 필요'
 * 는 상호 배타적인 두 판정으로 분리돼 있다. 이 스위트가 빨개지면 미검수
 * 페이로드에 **동의 절차 없는** 원클릭 설치 버튼이 달린 것이다. UI 판정은
 * 편의일 뿐이고, 실제 강제는 메인 프로세스 registry-installer 가 한다
 * (registry-installer-security.test.ts 의 consent 게이트 스위트).
 */
describe("isRegistryItemInstallable (one-click)", () => {
  const contract = { kind: "files" as const };

  it("official/verified + 설치계약 + active 만 원클릭 설치 가능", () => {
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

  it("★community 는 설치계약이 있어도 원클릭 불가(동의 경로만)", () => {
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
 * ★(b) community '동의 필요' 판정 — 설치 계약이 있는 미검수 항목에만 경고
 * 모달을 거치는 설치 버튼이 달린다. (a)와 상호 배타여야 한다: 같은 항목이
 * 원클릭이면서 동의 필요일 수는 없다.
 */
describe("isRegistryItemConsentInstallable (community consent)", () => {
  const contract = { kind: "files" as const };

  it("community + 설치계약 + active 만 동의-후-설치 대상", () => {
    expect(
      isRegistryItemConsentInstallable({
        tier: "community",
        install: contract,
        status: "active",
      }),
    ).toBe(true);
  });

  it("official/verified 는 동의 경로가 아니다(원클릭 경로)", () => {
    for (const tier of ["official", "verified"] as const) {
      expect(
        isRegistryItemConsentInstallable({
          tier,
          install: contract,
          status: "active",
        }),
      ).toBe(false);
    }
  });

  it("설치계약 없는 community 는 동의로도 설치 대상이 아니다", () => {
    expect(
      isRegistryItemConsentInstallable({
        tier: "community",
        install: null,
        status: "active",
      }),
    ).toBe(false);
  });

  it("★revoked 는 동의 경로도 닫힌다", () => {
    expect(
      isRegistryItemConsentInstallable({
        tier: "community",
        install: contract,
        status: "revoked",
      }),
    ).toBe(false);
  });

  it("두 판정은 상호 배타 — 어떤 tier·상태 조합도 둘 다 true 일 수 없다", () => {
    const tiers = ["official", "verified", "community"] as const;
    const statuses = ["active", "deprecated", "revoked"] as const;
    for (const tier of tiers) {
      for (const status of statuses) {
        for (const install of [contract, null]) {
          const probe = { tier, status, install };
          expect(
            isRegistryItemInstallable(probe) &&
              isRegistryItemConsentInstallable(probe),
          ).toBe(false);
        }
      }
    }
  });
});

/**
 * 카테고리 탭 분류 — 알려진 타입은 각자의 탭으로, '기타'는 진짜 미지 타입만.
 * knowledge→스터디 같은 제품 라벨 매핑이 흔들리면 탭이 조용히 빈 칸이 된다.
 */
describe("categorizeRegistryType", () => {
  it("알려진 타입은 정식 카테고리로 매핑된다", () => {
    expect(categorizeRegistryType("mcp-server")).toBe("mcp");
    expect(categorizeRegistryType("skill")).toBe("skills");
    expect(categorizeRegistryType("agent")).toBe("agents");
    expect(categorizeRegistryType("workflow")).toBe("workflows");
    expect(categorizeRegistryType("knowledge")).toBe("study");
  });

  it("진짜 미지 타입만 '기타'로 간다", () => {
    expect(categorizeRegistryType("hologram")).toBe("other");
    expect(categorizeRegistryType("")).toBe("other");
  });

  it("참조 전용 타입은 workflow/knowledge 뿐이다 — 설치형 타입이 새면 안 된다", () => {
    expect(isReferenceOnlyRegistryType("workflow")).toBe(true);
    expect(isReferenceOnlyRegistryType("knowledge")).toBe(true);
    for (const installable of ["skill", "mcp-server", "agent"]) {
      expect(isReferenceOnlyRegistryType(installable)).toBe(false);
    }
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
