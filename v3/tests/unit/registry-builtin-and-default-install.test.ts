/**
 * 스토어의 **두 가지 "기본 제공"** 을 갈라 못박는 스펙.
 *
 * 이 둘은 이름이 비슷해서 계속 섞이는데, 사용자에게는 정반대의 물건이다:
 *
 *   ① 빌트인(BUILTIN_REGISTRY_ITEM_IDS) — 설치 개념이 **없다**. 앱 번들이나
 *      하네스 CLI 가 이미 들고 있다. 스토어 목록에서 빠지고, id 를 직접 실은
 *      설치 요청도 거부된다. 예: tf-* 워크플로, marblo-control, code-review.
 *
 *   ② official 기본설치(installDefaultRegistryItems) — 설치형 항목이다. 첫
 *      실행에 우리가 대신 한 번 눌러 주고, 원장에 남고, 사용자가 스토어에서
 *      제거할 수 있다. 예: QA Engineer·Reviewer 등 official 티어 에이전트.
 *
 * 섞이면 생기는 사고가 정확히 두 개다 — 빌트인이 스토어에 떠서 "안 깔렸나?"
 * 를 만들거나, 기본설치가 빌트인처럼 굴어서 **사용자가 지운 것이 되살아나는**
 * 것. 아래 케이스들이 그 둘을 각각 막는다.
 */
import fs from "fs";
import os from "os";
import path from "path";
import { describe, expect, it } from "vitest";
import type {
  RegistryIndex,
  RegistryItem,
} from "../../electron/registry-client";
import {
  builtinRegistryItemIds,
  installDefaultRegistryItems,
  installRegistryItem,
  isBuiltinRegistryItem,
  isDefaultInstallCandidate,
  overlayInstallState,
  type InstallerDeps,
} from "../../electron/registry-installer";
import {
  readLedger,
  type RegistryLedger,
} from "../../electron/registry-ledger";

const COMMIT = "a".repeat(40);

function tmpdir(prefix: string): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function agentItem(overrides: Partial<RegistryItem> = {}): RegistryItem {
  return {
    schemaVersion: 1,
    id: "qa-engineer",
    name: "QA Engineer",
    type: "agent",
    version: "1.0.0",
    description: "test",
    tier: "official",
    publisherName: "Marblo",
    status: "active",
    permissions: [],
    permissionsDeclared: true,
    path: "agents/qa-engineer",
    commit: COMMIT,
    install: {
      kind: "files",
      root: "claude-agents",
      dest: "qa-engineer",
      files: ["AGENT.md"],
    },
    installDerived: false,
    ...overrides,
  };
}

function emptyLedger(): RegistryLedger {
  return { schema_version: 1, items: {} };
}

function index(items: RegistryItem[]): RegistryIndex {
  return {
    commit: COMMIT,
    fetchedAt: 0,
    stale: false,
    available: true,
    items,
  };
}

/** 스텁 fetch: 어떤 파일 요청이든 같은 본문을 준다(설치 성공 경로). */
function okFetch(): typeof fetch {
  return (async () => {
    const body = Buffer.from("# agent", "utf-8");
    return {
      ok: true,
      status: 200,
      arrayBuffer: async () =>
        body.buffer.slice(body.byteOffset, body.byteOffset + body.byteLength),
    } as unknown as Response;
  }) as typeof fetch;
}

function makeEnv(fetchImpl?: typeof fetch): {
  deps: InstallerDeps;
  agentsRoot: string;
} {
  const base = tmpdir("marblo-default-install-");
  const agentsRoot = path.join(base, "agents-root");
  fs.mkdirSync(agentsRoot, { recursive: true });
  return {
    agentsRoot,
    deps: {
      ledgerPath: path.join(base, "registry-installs.json"),
      rootsOverride: { "claude-agents": agentsRoot },
      fetchImpl: fetchImpl ?? okFetch(),
    },
  };
}

// ── ① 빌트인: 스토어에서 숨김 ──────────────────────────────────────

describe("builtin items are not store items", () => {
  it("hides builtins from the store list", () => {
    const items = [
      agentItem({ id: "reviewer", path: "agents/reviewer" }),
      { ...agentItem({ id: "tf-analyze" }), type: "workflow" as const },
      agentItem({ id: "code-review", type: "skill" }),
      agentItem({ id: "marblo-control", type: "mcp-server" }),
    ];
    const shown = overlayInstallState(index(items), emptyLedger()).map(
      (i) => i.id,
    );
    expect(shown).toEqual(["reviewer"]);
  });

  it("★ keeps a builtin visible when the ledger owns it — hiding must not lock the user out of uninstalling", () => {
    const ledger = emptyLedger();
    ledger.items["code-review"] = {
      manifestVersion: "1.0.0",
      commit: COMMIT,
      install: { kind: "files", root: "claude-skills", dest: "code-review" },
      files: [{ path: "SKILL.md", sha256: "0".repeat(64) }],
      permissionsGranted: [],
      installedAt: new Date().toISOString(),
    };
    const shown = overlayInstallState(
      index([agentItem({ id: "code-review", type: "skill" })]),
      ledger,
    );
    expect(shown.map((i) => i.id)).toEqual(["code-review"]);
    expect(shown[0].installState).toBe("installed");
  });

  it("refuses to install a builtin even when the id is passed straight to the installer", async () => {
    const { deps } = makeEnv();
    await expect(
      installRegistryItem(agentItem({ id: "code-review" }), deps),
    ).rejects.toThrow(/앱 내장 항목/);
  });

  it("★ covers every tf-* asset the app bundle actually ships", () => {
    // 목록이 정적이라 번들이 늘면 조용히 어긋난다. 번들 디렉터리를 진실로 삼아
    // 대조한다 — 새 tf-* 커맨드를 추가하고 이 집합을 안 고치면 여기서 깨진다.
    const repoRoot = path.resolve(__dirname, "../../..");
    const commandsDir = path.join(repoRoot, ".claude", "commands");
    if (!fs.existsSync(commandsDir)) return; // 번들 소스가 없는 체크아웃은 건너뛴다
    const bundled = fs
      .readdirSync(commandsDir)
      .filter((n) => n.endsWith(".md"))
      .map((n) => n.replace(/\.md$/, ""));
    expect(bundled.length).toBeGreaterThan(0);
    const covered = new Set(builtinRegistryItemIds());
    expect(bundled.filter((n) => !covered.has(n))).toEqual([]);
  });
});

// ── ② official 기본설치: 설치형인데 첫 실행에 우리가 눌러 준다 ─────

describe("default install candidates", () => {
  it("selects official first-party agents with a files contract", () => {
    expect(isDefaultInstallCandidate(agentItem())).toBe(true);
    expect(isDefaultInstallCandidate(agentItem({ id: "reviewer" }))).toBe(true);
  });

  it.each([
    ["community tier", agentItem({ tier: "community" })],
    ["verified tier", agentItem({ tier: "verified" })],
    ["a skill, not an agent", agentItem({ type: "skill" })],
    ["no install contract", agentItem({ install: null })],
    ["revoked", agentItem({ status: "revoked" })],
    ["deprecated", agentItem({ status: "deprecated" })],
    ["a builtin id", agentItem({ id: "code-review" })],
  ])("does not default-install %s", (_label, item) => {
    expect(isDefaultInstallCandidate(item)).toBe(false);
  });
});

describe("installDefaultRegistryItems", () => {
  it("installs official agents once and records them in the ledger", async () => {
    const { deps, agentsRoot } = makeEnv();
    const res = await installDefaultRegistryItems(
      index([
        agentItem(),
        agentItem({
          id: "reviewer",
          install: {
            kind: "files",
            root: "claude-agents",
            dest: "reviewer",
            files: ["AGENT.md"],
          },
        }),
      ]),
      deps,
    );
    expect(res.installed.sort()).toEqual(["qa-engineer", "reviewer"]);
    expect(res.failed).toEqual([]);
    expect(
      fs.existsSync(path.join(agentsRoot, "qa-engineer", "AGENT.md")),
    ).toBe(true);
    const ledger = readLedger(deps.ledgerPath);
    expect(Object.keys(ledger.items).sort()).toEqual([
      "qa-engineer",
      "reviewer",
    ]);
    expect(typeof ledger.defaultInstallAt).toBe("string");
  });

  it("★ never reinstalls what the user removed — the marker makes the pass once-ever", async () => {
    const { deps, agentsRoot } = makeEnv();
    await installDefaultRegistryItems(index([agentItem()]), deps);

    // 사용자가 스토어에서 제거한 상황을 재현한다(원장 + 디스크 모두 비움).
    const ledger = readLedger(deps.ledgerPath);
    delete ledger.items["qa-engineer"];
    fs.writeFileSync(deps.ledgerPath, JSON.stringify(ledger));
    fs.rmSync(path.join(agentsRoot, "qa-engineer"), {
      recursive: true,
      force: true,
    });

    const second = await installDefaultRegistryItems(
      index([agentItem()]),
      deps,
    );
    expect(second.alreadyRan).toBe(true);
    expect(second.installed).toEqual([]);
    expect(fs.existsSync(path.join(agentsRoot, "qa-engineer"))).toBe(false);
  });

  it("leaves an already-installed item alone instead of overwriting it", async () => {
    const { deps } = makeEnv();
    // 사용자가 스토어에서 직접 먼저 설치한 상태.
    await installRegistryItem(agentItem(), deps);
    const before = readLedger(deps.ledgerPath).items["qa-engineer"].installedAt;

    const res = await installDefaultRegistryItems(index([agentItem()]), deps);
    expect(res.skipped).toEqual(["qa-engineer"]);
    expect(res.installed).toEqual([]);
    expect(readLedger(deps.ledgerPath).items["qa-engineer"].installedAt).toBe(
      before,
    );
  });

  it("★ does not burn the marker when the index carries no candidates", async () => {
    // 인덱스가 비어 있는 실행에서 '완주'를 찍으면 그 사용자는 기본 에이전트를
    // 영영 못 받는다. 후보가 0 이면 아무 일도 없었던 것처럼 남아야 한다.
    const { deps } = makeEnv();
    const res = await installDefaultRegistryItems(index([]), deps);
    expect(res.alreadyRan).toBe(false);
    expect(readLedger(deps.ledgerPath).defaultInstallAt).toBeUndefined();
  });

  it("marks the pass complete even when some items fail, so startup stops retrying", async () => {
    const failing = (async () =>
      ({ ok: false, status: 500 }) as Response) as typeof fetch;
    const { deps } = makeEnv(failing);
    const res = await installDefaultRegistryItems(index([agentItem()]), deps);
    expect(res.installed).toEqual([]);
    expect(res.failed.map((f) => f.id)).toEqual(["qa-engineer"]);
    expect(readLedger(deps.ledgerPath).defaultInstallAt).toBeTruthy();
  });
});

// ── 두 개념이 겹치지 않는다는 것 자체를 못박는다 ────────────────────

describe("builtin vs default-install are disjoint", () => {
  it("no builtin id is ever a default-install candidate", () => {
    for (const id of builtinRegistryItemIds()) {
      expect(isBuiltinRegistryItem(id)).toBe(true);
      expect(isDefaultInstallCandidate(agentItem({ id }))).toBe(false);
    }
  });

  it("default-installed agents stay listed in the store (removable, not hidden)", () => {
    const shown = overlayInstallState(
      index([agentItem(), agentItem({ id: "reviewer" })]),
      emptyLedger(),
    );
    expect(shown.map((i) => i.id).sort()).toEqual(["qa-engineer", "reviewer"]);
  });
});
