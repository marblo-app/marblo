/**
 * registry-client 파싱·강건성 스펙: 알 수 없는 schema_version 은 "그 항목만
 * 숨김"(S12), 파싱 실패가 인덱스 전체를 죽이지 않음, v1 skill 은 레포 트리에서
 * files 설치 파생, v1 mcp-server 는 설치 계약 없음 → 설치불가(공시만),
 * 오프라인 degradation(캐시 → 없으면 available:false).
 */
import fs from "fs";
import os from "os";
import path from "path";
import { beforeEach, describe, expect, it } from "vitest";
import {
  deriveFilesInstallFromTree,
  getRegistryIndex,
  parseManifest,
  resetRegistryClientMemo,
  selectManifestEntries,
  type RegistryItem,
} from "../../electron/registry-client";

const COMMIT = "b".repeat(40);

const V1_SKILL = `
schema_version: 1
id: code-review
name: Code Review
type: skill
version: 1.0.0
description: Review agent code.
publisher:
  name: Marblo
  tier: official
permissions:
  - repository:read
license: MIT
`;

const V1_MCP = `
schema_version: 1
id: github-mcp
name: GitHub MCP Server
type: mcp-server
version: 1.7.0
description: Official GitHub MCP server.
publisher:
  name: GitHub
  tier: verified
source:
  repository: https://github.com/github/github-mcp-server
  ref: v1.7.0
permissions:
  - repository:write
license: MIT
`;

const V2_MCP = `
schema_version: 2
id: github-mcp
name: GitHub MCP Server
type: mcp-server
version: 2.0.0
description: Official GitHub MCP server.
publisher:
  name: GitHub
  tier: verified
install:
  kind: mcp-server
  runner: npx
  package: "@github/mcp-server@1.7.0"
  args: []
  env_required: [GITHUB_TOKEN]
  mcp_key: github-registry
license: MIT
`;

describe("parseManifest", () => {
  it("parses a valid v1 skill manifest", () => {
    const item = parseManifest(V1_SKILL, "skills/code-review", "skill", COMMIT);
    expect(item).not.toBeNull();
    expect(item!.id).toBe("code-review");
    expect(item!.tier).toBe("official");
    expect(item!.permissions).toEqual(["repository:read"]);
    expect(item!.permissionsDeclared).toBe(true);
    expect(item!.install).toBeNull(); // 파생은 트리에서 별도로
  });

  it("hides unknown schema_version instead of failing", () => {
    const raw = V1_SKILL.replace("schema_version: 1", "schema_version: 99");
    expect(
      parseManifest(raw, "skills/code-review", "skill", COMMIT),
    ).toBeNull();
  });

  it("hides malformed yaml instead of throwing", () => {
    expect(
      parseManifest(":\n  - {broken", "skills/x", "skill", COMMIT),
    ).toBeNull();
  });

  it("hides manifests whose type does not match the directory", () => {
    expect(
      parseManifest(V1_SKILL, "mcp-servers/x", "mcp-server", COMMIT),
    ).toBeNull();
  });

  it("hides oversized manifests (reject, not truncate)", () => {
    const big = V1_SKILL + `\nkeywords:\n` + `  - k\n`.repeat(20000);
    expect(
      parseManifest(big, "skills/code-review", "skill", COMMIT),
    ).toBeNull();
  });

  it("hides ids that are not kebab-case single identifiers", () => {
    const raw = V1_SKILL.replace("id: code-review", "id: ../escape");
    expect(
      parseManifest(raw, "skills/code-review", "skill", COMMIT),
    ).toBeNull();
  });

  it("v1 mcp-server has no install contract (disclosure only)", () => {
    const item = parseManifest(
      V1_MCP,
      "mcp-servers/github",
      "mcp-server",
      COMMIT,
    );
    expect(item).not.toBeNull();
    expect(item!.install).toBeNull();
  });

  it("v2 mcp-server carries a shape-validated install block", () => {
    const item = parseManifest(
      V2_MCP,
      "mcp-servers/github",
      "mcp-server",
      COMMIT,
    );
    expect(item).not.toBeNull();
    expect(item!.install).toEqual({
      kind: "mcp-server",
      runner: "npx",
      package: "@github/mcp-server@1.7.0",
      args: [],
      envRequired: ["GITHUB_TOKEN"],
      mcpKey: "github-registry",
    });
  });
});

// 공개 레지스트리가 실제로 싣고 있는 모양: schema_version 은 1 이고 install 은
// 그 위의 **옵셔널** 필드다(옵셔널 추가는 breaking change 가 아니므로 기존
// manifest 가 전부 유효하게 남는다). 앱이 install 을 sv===2 로 게이트하면 이
// 계약을 통째로 못 읽는다 — 아래 두 스펙이 그 회귀를 잡는다.
const V1_MCP_WITH_INSTALL = `
schema_version: 1
id: firecrawl-mcp
name: Firecrawl MCP
type: mcp-server
version: 3.22.4
description: Scrapes and crawls web pages into clean markdown for the agent.
publisher:
  name: Firecrawl
  tier: verified
source:
  repository: https://github.com/firecrawl/firecrawl-mcp-server
  ref: 2175de2dfd7e5073e9e743ec31a5e2515fa82df8
install:
  kind: mcp-server
  runner: npx
  package: firecrawl-mcp@3.22.4
  args: []
  mcp_key: firecrawl
  env_required:
    - FIRECRAWL_API_KEY
permissions:
  - network:outbound
  - secrets:read
license: MIT
`;

const V1_SKILL_WITH_INSTALL = `
schema_version: 1
id: code-review
name: Code Review
type: skill
version: 1.0.0
description: Review agent code.
publisher:
  name: Marblo
  tier: official
install:
  kind: files
  root: claude-skills
  dest: code-review
  files:
    - SKILL.md
    - README.md
  integrity:
    algorithm: sha256
    files:
      SKILL.md: "${"c".repeat(64)}"
      README.md: "${"d".repeat(64)}"
permissions:
  - repository:read
license: MIT
`;

const V1_AGENT_WITH_INSTALL = `
schema_version: 1
id: qa-engineer
name: QA Engineer
type: agent
version: 1.0.0
description: Finds the defects a feature's own author would not look for.
publisher:
  name: Marblo
  tier: official
install:
  kind: files
  root: claude-agents
  dest: qa-engineer
  files:
    - AGENT.md
  integrity:
    algorithm: sha256
    files:
      AGENT.md: "${"e".repeat(64)}"
permissions:
  - repository:read
  - shell:exec
license: MIT
`;

describe("install contract on schema_version 1 (public registry shape)", () => {
  it("reads an mcp-server install block declared on a v1 manifest", () => {
    const item = parseManifest(
      V1_MCP_WITH_INSTALL,
      "mcp-servers/firecrawl-mcp",
      "mcp-server",
      COMMIT,
    );
    expect(item).not.toBeNull();
    expect(item!.schemaVersion).toBe(1);
    expect(item!.install).toEqual({
      kind: "mcp-server",
      runner: "npx",
      package: "firecrawl-mcp@3.22.4",
      args: [],
      envRequired: ["FIRECRAWL_API_KEY"],
      mcpKey: "firecrawl",
    });
    expect(item!.notInstallableReason).toBeUndefined();
  });

  it("reads a files install block declared on a v1 skill, without deriving", () => {
    const item = parseManifest(
      V1_SKILL_WITH_INSTALL,
      "skills/code-review",
      "skill",
      COMMIT,
    )!;
    expect(item.install).toEqual({
      kind: "files",
      root: "claude-skills",
      dest: "code-review",
      files: ["SKILL.md", "README.md"],
      integrity: { "SKILL.md": "c".repeat(64), "README.md": "d".repeat(64) },
    });
    expect(item.installDerived).toBe(false);

    // 선언이 이겼으므로 트리 파생은 그것을 덮지 않는다.
    deriveFilesInstallFromTree(item, [
      {
        path: "skills/code-review/EXTRA.md",
        mode: "100644",
        type: "blob",
        size: 10,
      },
    ]);
    expect(item.install).toEqual({
      kind: "files",
      root: "claude-skills",
      dest: "code-review",
      files: ["SKILL.md", "README.md"],
      integrity: { "SKILL.md": "c".repeat(64), "README.md": "d".repeat(64) },
    });
  });

  it("a declared-but-invalid block is not installable, and does not fall back to the repo tree", () => {
    // dest 가 경로 탈출을 시도한다 — installer 도 거부하지만, 여기서 떨어지면
    // 파생이 대신 끼어들어 "선언한 것과 다른 것"이 설치되면 안 된다.
    const raw = V1_SKILL_WITH_INSTALL.replace(
      "dest: code-review",
      'dest: "../../evil"',
    );
    const item = parseManifest(raw, "skills/code-review", "skill", COMMIT)!;
    expect(item.install).toBeNull();
    expect(item.notInstallableReason).toMatch(/유효하지 않음/);

    deriveFilesInstallFromTree(item, [
      {
        path: "skills/code-review/SKILL.md",
        mode: "100644",
        type: "blob",
        size: 10,
      },
    ]);
    expect(item.install).toBeNull();
  });

  it("rejects a files block whose integrity does not cover every file", () => {
    const raw = V1_SKILL_WITH_INSTALL.replace(
      `      README.md: "${"d".repeat(64)}"\n`,
      "",
    );
    const item = parseManifest(raw, "skills/code-review", "skill", COMMIT)!;
    expect(item.install).toBeNull();
  });

  it("rejects a files block with no integrity at all", () => {
    const raw =
      V1_SKILL_WITH_INSTALL.split("  integrity:")[0] +
      "permissions:\n  - repository:read\nlicense: MIT\n";
    const item = parseManifest(raw, "skills/code-review", "skill", COMMIT)!;
    expect(item.install).toBeNull();
    expect(item.notInstallableReason).toMatch(/유효하지 않음/);
  });

  it("rejects runners the Phase 1a installer cannot honour (no dead install button)", () => {
    for (const runner of ["docker", "binary", "sh"]) {
      const raw = V1_MCP_WITH_INSTALL.replace(
        "runner: npx",
        `runner: ${runner}`,
      );
      const item = parseManifest(
        raw,
        "mcp-servers/firecrawl-mcp",
        "mcp-server",
        COMMIT,
      )!;
      expect(item.install).toBeNull();
    }
  });

  it("rejects an install block whose kind does not match the item type", () => {
    const raw = V1_SKILL_WITH_INSTALL.replace(
      "kind: files",
      "kind: mcp-server",
    );
    const item = parseManifest(raw, "skills/code-review", "skill", COMMIT)!;
    expect(item.install).toBeNull();
  });

  it("reads a files install block declared on an agent, into the agents root", () => {
    const item = parseManifest(
      V1_AGENT_WITH_INSTALL,
      "agents/qa-engineer",
      "agent",
      COMMIT,
    )!;
    expect(item.type).toBe("agent");
    expect(item.install).toEqual({
      kind: "files",
      root: "claude-agents",
      dest: "qa-engineer",
      files: ["AGENT.md"],
      integrity: { "AGENT.md": "e".repeat(64) },
    });
    expect(item.notInstallableReason).toBeUndefined();
  });

  // root 는 타입에 묶여 있다. 스킬 트리에 떨어진 에이전트, 에이전트 트리에 떨어진
  // 스킬 둘 다 "리뷰된 카테고리 ≠ 착지한 카테고리" 이므로 파서에서 이미 떨군다 —
  // 여기서 통과시키면 스토어가 누르면 installer 가 거부하는 버튼을 그린다.
  it("rejects an agent that declares the skills root", () => {
    const raw = V1_AGENT_WITH_INSTALL.replace(
      "root: claude-agents",
      "root: claude-skills",
    );
    const item = parseManifest(raw, "agents/qa-engineer", "agent", COMMIT)!;
    expect(item.install).toBeNull();
    expect(item.notInstallableReason).toBe("install 블록이 유효하지 않음");
  });

  it("rejects a skill that declares the agents root", () => {
    const raw = V1_SKILL_WITH_INSTALL.replace(
      "root: claude-skills",
      "root: claude-agents",
    );
    const item = parseManifest(raw, "skills/code-review", "skill", COMMIT)!;
    expect(item.install).toBeNull();
  });

  // 에이전트는 트리 파생을 하지 않는다: frontmatter 없는 README 까지 에이전트
  // 트리에 심으면 게시자가 선언하지 않은 파일이 하네스 스캔 대상이 된다.
  it("never derives a files install for an agent from the repo tree", () => {
    const raw = V1_AGENT_WITH_INSTALL.replace(
      /install:[\s\S]*?permissions:/,
      "permissions:",
    );
    const item = parseManifest(raw, "agents/qa-engineer", "agent", COMMIT)!;
    expect(item.install).toBeNull();
    deriveFilesInstallFromTree(item, [
      {
        path: "agents/qa-engineer/AGENT.md",
        mode: "100644",
        type: "blob",
        size: 10,
      },
      {
        path: "agents/qa-engineer/README.md",
        mode: "100644",
        type: "blob",
        size: 10,
      },
    ]);
    expect(item.install).toBeNull();
  });
});

// community files 설치는 3자 source repo 에서 받는다(no-vendor). 파서의 몫은
// 정직한 UI 다: pinned GitHub source 가 없는 community 설치 계약은 눌리는 순간
// installer 가 거부하므로, 여기서 미리 설치불가로 떨궈 죽은 버튼을 없앤다.
// (강제는 installer 가 독립적으로 다시 한다 — 그 스펙은 installer 테스트에.)
describe("community source pin (정직한 UI 게이트)", () => {
  const COMMUNITY_SKILL_WITH_SOURCE = V1_SKILL_WITH_INSTALL.replace(
    "  tier: official",
    "  tier: community",
  ).replace(
    "install:",
    `source:
  repository: https://github.com/acme/claude-skills
  ref: ${"f".repeat(40)}
  path: skills/ext
install:`,
  );

  it("keeps the declared install when the community source is pinned to GitHub", () => {
    const item = parseManifest(
      COMMUNITY_SKILL_WITH_SOURCE,
      "skills/code-review",
      "skill",
      COMMIT,
    )!;
    expect(item.tier).toBe("community");
    expect(item.install?.kind).toBe("files");
    expect(item.sourceRepository).toBe("https://github.com/acme/claude-skills");
    expect(item.sourceRef).toBe("f".repeat(40));
    expect(item.sourcePath).toBe("skills/ext");
  });

  it.each(["main", "HEAD", "feature/x"])(
    "drops the install button when source.ref is the moving ref %j",
    (ref) => {
      const raw = COMMUNITY_SKILL_WITH_SOURCE.replace(
        `ref: ${"f".repeat(40)}`,
        `ref: ${ref}`,
      );
      const item = parseManifest(raw, "skills/code-review", "skill", COMMIT)!;
      expect(item.install).toBeNull();
      expect(item.notInstallableReason).toMatch(/pinned source/);
    },
  );

  it("drops the install button when the repository is not github.com", () => {
    const raw = COMMUNITY_SKILL_WITH_SOURCE.replace(
      "https://github.com/acme/claude-skills",
      "https://evil.example/acme/claude-skills",
    );
    const item = parseManifest(raw, "skills/code-review", "skill", COMMIT)!;
    expect(item.install).toBeNull();
  });

  it("drops the install button when the community item has no source at all", () => {
    const raw = V1_SKILL_WITH_INSTALL.replace(
      "  tier: official",
      "  tier: community",
    );
    const item = parseManifest(raw, "skills/code-review", "skill", COMMIT)!;
    expect(item.install).toBeNull();
    expect(item.notInstallableReason).toMatch(/pinned source/);
  });

  it("official installs are untouched by the source gate", () => {
    const item = parseManifest(
      V1_SKILL_WITH_INSTALL,
      "skills/code-review",
      "skill",
      COMMIT,
    )!;
    expect(item.install?.kind).toBe("files");
  });

  it("never tree-derives an install for a community skill (no integrity → dead button)", () => {
    const raw = V1_SKILL.replace("  tier: official", "  tier: community");
    const item = parseManifest(raw, "skills/code-review", "skill", COMMIT)!;
    deriveFilesInstallFromTree(item, [
      {
        path: "skills/code-review/SKILL.md",
        mode: "100644",
        type: "blob",
        size: 10,
      },
    ]);
    expect(item.install).toBeNull();
    expect(item.notInstallableReason).toMatch(/트리 파생/);
  });
});

describe("deriveFilesInstallFromTree", () => {
  function baseItem(): RegistryItem {
    return parseManifest(V1_SKILL, "skills/code-review", "skill", COMMIT)!;
  }

  it("derives an allowlist from in-repo payload, excluding marblo.yaml", () => {
    const item = baseItem();
    deriveFilesInstallFromTree(item, [
      {
        path: "skills/code-review/marblo.yaml",
        mode: "100644",
        type: "blob",
        size: 10,
      },
      {
        path: "skills/code-review/SKILL.md",
        mode: "100644",
        type: "blob",
        size: 10,
      },
      {
        path: "skills/code-review/refs/GUIDE.md",
        mode: "100644",
        type: "blob",
        size: 10,
      },
      { path: "skills/other/SKILL.md", mode: "100644", type: "blob", size: 10 },
    ]);
    expect(item.install).toEqual({
      kind: "files",
      root: "claude-skills",
      dest: "code-review",
      files: ["SKILL.md", "refs/GUIDE.md"],
    });
    expect(item.installDerived).toBe(true);
  });

  it("refuses the whole item when the payload contains a symlink", () => {
    const item = baseItem();
    deriveFilesInstallFromTree(item, [
      {
        path: "skills/code-review/SKILL.md",
        mode: "100644",
        type: "blob",
        size: 10,
      },
      {
        path: "skills/code-review/evil-link",
        mode: "120000",
        type: "blob",
        size: 10,
      },
    ]);
    expect(item.install).toBeNull();
    expect(item.notInstallableReason).toMatch(/심링크/);
  });

  it("marks manifest-only skills as not installable", () => {
    const item = baseItem();
    deriveFilesInstallFromTree(item, [
      {
        path: "skills/code-review/marblo.yaml",
        mode: "100644",
        type: "blob",
        size: 10,
      },
    ]);
    expect(item.install).toBeNull();
    expect(item.notInstallableReason).toMatch(/페이로드 없음/);
  });
});

describe("selectManifestEntries", () => {
  it("selects only phase-1a category manifests at exactly two levels", () => {
    const entries = selectManifestEntries([
      {
        path: "skills/code-review/marblo.yaml",
        mode: "100644",
        type: "blob",
        size: 10,
      },
      {
        path: "mcp-servers/github/marblo.yaml",
        mode: "100644",
        type: "blob",
        size: 10,
      },
      {
        path: "agents/reviewer/marblo.yaml",
        mode: "100644",
        type: "blob",
        size: 10,
      },
      {
        path: "skills/nested/deep/marblo.yaml",
        mode: "100644",
        type: "blob",
        size: 10,
      },
      {
        path: "skills/code-review/SKILL.md",
        mode: "100644",
        type: "blob",
        size: 10,
      },
    ]);
    // agents/ 는 phase-1a 카테고리다(에이전트 팩 착지 이후). skills/nested/deep 은
    // 2단이 아니라서, skills/code-review/SKILL.md 는 manifest 가 아니라서 빠진다.
    expect(entries.map((e) => e.path)).toEqual([
      "skills/code-review/marblo.yaml",
      "mcp-servers/github/marblo.yaml",
      "agents/reviewer/marblo.yaml",
    ]);
    expect(entries.map((e) => e.type)).toEqual([
      "skill",
      "mcp-server",
      "agent",
    ]);
  });
});

describe("getRegistryIndex degradation", () => {
  const failingFetch = (async () => {
    throw new Error("offline");
  }) as unknown as typeof fetch;

  beforeEach(() => resetRegistryClientMemo());

  it("offline with no cache → available:false, empty items, no throw", async () => {
    const cacheDir = fs.mkdtempSync(
      path.join(os.tmpdir(), "marblo-reg-cache-"),
    );
    const index = await getRegistryIndex({ fetchImpl: failingFetch, cacheDir });
    expect(index.available).toBe(false);
    expect(index.items).toEqual([]);
  });

  it("offline with cache → serves stale cache", async () => {
    const cacheDir = fs.mkdtempSync(
      path.join(os.tmpdir(), "marblo-reg-cache-"),
    );
    const item = parseManifest(
      V1_SKILL,
      "skills/code-review",
      "skill",
      COMMIT,
    )!;
    fs.writeFileSync(
      path.join(cacheDir, "registry-index-cache.json"),
      JSON.stringify({ commit: COMMIT, fetchedAt: 123, items: [item] }),
    );
    const index = await getRegistryIndex({ fetchImpl: failingFetch, cacheDir });
    expect(index.available).toBe(true);
    expect(index.stale).toBe(true);
    expect(index.items).toHaveLength(1);
    expect(index.commit).toBe(COMMIT);
  });
});

/**
 * i18n 오버레이 파싱. install 블록과 **다른 실패 정책**이라는 게 요점이다:
 * install 은 선언이 깨지면 설치 버튼을 떼지만, i18n 은 표시 문자열 덧씌우기라
 * 깨져도 항목을 숨기지 않는다 — 영어 base 로 그리면 그만이고, 숨기면 번역 오타
 * 하나가 멀쩡한 자산을 스토어에서 지운다.
 */
describe("parseI18nBlock", () => {
  function manifestWithI18n(block: string): RegistryItem | null {
    return parseManifest(
      `${V1_SKILL}\n${block}`,
      "skills/code-review",
      "skill",
      COMMIT,
    );
  }

  it("ko 오버레이를 name·description 으로 싣는다", () => {
    const item = manifestWithI18n(
      "i18n:\n  ko:\n    name: 코드 리뷰\n    description: 리뷰한다.",
    );
    expect(item?.i18n?.ko).toEqual({
      name: "코드 리뷰",
      description: "리뷰한다.",
    });
  });

  it("한쪽 필드만 있는 오버레이도 그대로 싣는다(폴백은 UI 가 필드 단위로)", () => {
    const item = manifestWithI18n("i18n:\n  ko:\n    name: 코드 리뷰");
    expect(item?.i18n?.ko).toEqual({ name: "코드 리뷰" });
    expect(item?.name).toBe("Code Review");
  });

  it("i18n 이 없으면 undefined — 없는 게 정상 상태다", () => {
    const item = parseManifest(V1_SKILL, "skills/code-review", "skill", COMMIT);
    expect(item?.i18n).toBeUndefined();
  });

  it("★깨진 오버레이가 항목을 숨기지 않는다 — 그 필드만 버리고 base 로 산다", () => {
    const item = manifestWithI18n(
      "i18n:\n  ko:\n    name: 코드 리뷰\n    description: 42",
    );
    expect(item).not.toBeNull();
    expect(item?.name).toBe("Code Review");
    expect(item?.i18n?.ko).toEqual({ name: "코드 리뷰" });
  });

  it("모르는 로케일·공백뿐인 값은 버린다", () => {
    expect(
      manifestWithI18n("i18n:\n  fr:\n    name: Revue")?.i18n,
    ).toBeUndefined();
    expect(
      manifestWithI18n('i18n:\n  ko:\n    name: "   "')?.i18n,
    ).toBeUndefined();
  });

  it("한도를 넘는 문자열은 잘라내지 않고 그 필드를 버린다", () => {
    const item = manifestWithI18n(
      `i18n:\n  ko:\n    name: ${"가".repeat(81)}\n    description: 리뷰한다.`,
    );
    expect(item?.i18n?.ko).toEqual({ description: "리뷰한다." });
  });

  it("i18n 이 객체가 아니면 통째로 무시하고 항목은 산다", () => {
    const item = manifestWithI18n("i18n: 코드 리뷰");
    expect(item).not.toBeNull();
    expect(item?.i18n).toBeUndefined();
  });
});
