/**
 * Claude Code 온보딩 설치가 npm 전역(EACCES/exit 243) 대신 공식 네이티브
 * 인스톨러(curl -fsSL https://claude.ai/install.sh | bash)로 뜨는지 고정하는
 * 회귀 테스트 (b9GdrB9sym3eEYPDHehF).
 *
 * ★기존 cleanroom E2E 는 설치 IPC 를 스텁해 실제 스폰 커맨드를 절대 태우지
 * 않는다 — 그게 이 버그가 여태 안 잡힌 이유다. 여기서는 child_process.spawn
 * 만 목으로 갈아끼우고 나머지는 실물 harness-manager 로직을 그대로 태워
 * "어떤 커맨드가 spawn 되는지" shape 을 검증한다.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EventEmitter } from "node:events";

type SpawnCall = { command: string; args: string[] };

async function loadHarnessWithSpawnMock(spawnCalls: SpawnCall[]) {
  vi.resetModules();
  vi.doMock("child_process", async () => {
    const spawn = vi.fn((command: string, args: string[]) => {
      spawnCalls.push({ command, args });
      const child = new EventEmitter() as ReturnType<
        typeof import("node:child_process").spawn
      >;
      child.stdout = new EventEmitter() as typeof child.stdout;
      child.stderr = new EventEmitter() as typeof child.stderr;
      child.kill = vi.fn() as typeof child.kill;
      queueMicrotask(() => child.emit("close", 0));
      return child;
    });
    return { spawn };
  });
  const harnessManager = await import("../../electron/harness-manager");
  const harnessCatalog = await import("../../electron/harness-catalog");
  return { ...harnessManager, CATALOG: harnessCatalog.CATALOG };
}

describe("Claude Code native (curl|bash) installer", () => {
  let platformDescriptor: PropertyDescriptor | undefined;

  beforeEach(() => {
    platformDescriptor = Object.getOwnPropertyDescriptor(process, "platform");
    Object.defineProperty(process, "platform", {
      configurable: true,
      value: "darwin",
    });
  });

  afterEach(() => {
    if (platformDescriptor) {
      Object.defineProperty(process, "platform", platformDescriptor);
    }
    vi.doUnmock("child_process");
    vi.resetModules();
  });

  it("catalog entry is kind='shell' from claude.ai, not npm-global", async () => {
    const { CATALOG } = await loadHarnessWithSpawnMock([]);
    const claude = CATALOG.find((p) => p.id === "cli-claude-code");
    expect(claude).toBeDefined();
    expect(claude!.install.kind).toBe("shell");
    expect(claude!.install.source).toBe("https://claude.ai/install.sh");
    expect(claude!.install.kind).not.toBe("npm-global");
    expect(claude!.detect.binary).toBe("claude");
    expect(claude!.category).toBe("required");
  });

  it("installPackage('cli-claude-code') spawns the official curl|bash installer, never npm", async () => {
    const spawnCalls: SpawnCall[] = [];
    const { installPackage } = await loadHarnessWithSpawnMock(spawnCalls);

    await installPackage("cli-claude-code");

    expect(spawnCalls).toHaveLength(1);
    expect(spawnCalls[0].command).toBe("bash");
    expect(spawnCalls[0].args).toEqual([
      "-c",
      "curl -fsSL 'https://claude.ai/install.sh' | bash",
    ]);
    expect(spawnCalls[0].args.join(" ")).not.toMatch(/npm/);
  });

  it("rejects an installer host outside the curated allowlist (regression: allowlist isn't a rubber stamp)", async () => {
    const { installPackage, CATALOG } = await loadHarnessWithSpawnMock([]);
    const claudeEntry = CATALOG.find((p) => p.id === "cli-claude-code")!;
    const originalSource = claudeEntry.install.source;
    claudeEntry.install.source = "https://evil.example.com/install.sh";
    try {
      await expect(installPackage("cli-claude-code")).rejects.toThrow(
        /not whitelisted/,
      );
    } finally {
      claudeEntry.install.source = originalSource;
    }
  });

  it("Codex stays on npm-global (this ticket is Claude Code only)", async () => {
    const { CATALOG } = await loadHarnessWithSpawnMock([]);
    const codex = CATALOG.find((p) => p.id === "cli-codex");
    expect(codex!.install.kind).toBe("npm-global");
    expect(codex!.install.source).toBe("@openai/codex");
  });

  it("probeCliAuth reports the native curl|bash command when claude isn't on PATH", async () => {
    const { probeCliAuth } = await loadHarnessWithSpawnMock([]);
    const result = await probeCliAuth("claude");
    if (!result.installed) {
      expect(result.action).toBe(
        "curl -fsSL https://claude.ai/install.sh | bash",
      );
      expect(result.action).not.toMatch(/npm/);
    }
  });
});
