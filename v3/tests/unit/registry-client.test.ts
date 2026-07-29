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
    expect(entries.map((e) => e.path)).toEqual([
      "skills/code-review/marblo.yaml",
      "mcp-servers/github/marblo.yaml",
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
