import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as actualFs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

const ENV_KEYS = [
  "ANTHROPIC_API_KEY",
  "ANTHROPIC_AUTH_TOKEN",
  "OPENAI_API_KEY",
] as const;

type EnvSnapshot = Record<(typeof ENV_KEYS)[number], string | undefined>;

function snapshotEnv(): EnvSnapshot {
  return Object.fromEntries(
    ENV_KEYS.map((key) => [key, process.env[key]]),
  ) as EnvSnapshot;
}

function restoreEnv(snapshot: EnvSnapshot): void {
  for (const key of ENV_KEYS) {
    const value = snapshot[key];
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
}

function clearAuthEnv(): void {
  for (const key of ENV_KEYS) delete process.env[key];
}

function makeHome(): string {
  return actualFs.realpathSync(
    actualFs.mkdtempSync(path.join(os.tmpdir(), "marblo-harness-auth-")),
  );
}

function touchFakeBinary(home: string, binary: "claude" | "codex"): void {
  const binDir = path.join(home, ".npm", "bin");
  actualFs.mkdirSync(binDir, { recursive: true });
  actualFs.writeFileSync(path.join(binDir, binary), "#!/bin/sh\n", "utf-8");
}

function writeJson(filePath: string, value: unknown): void {
  actualFs.mkdirSync(path.dirname(filePath), { recursive: true });
  actualFs.writeFileSync(filePath, JSON.stringify(value), "utf-8");
}

async function loadProbeWithFakeHome(home: string): Promise<{
  probeCliAuth: typeof import("../../electron/harness-manager").probeCliAuth;
}> {
  vi.resetModules();
  vi.doMock("os", async () => ({
    ...(await vi.importActual<typeof import("os")>("os")),
    default: {
      ...(await vi.importActual<typeof import("os")>("os")),
      homedir: () => home,
    },
    homedir: () => home,
  }));
  vi.doMock("fs", async () => {
    const fs = await vi.importActual<typeof import("fs")>("fs");
    const existsSync = vi.fn((p: actualFs.PathLike) => {
      const target = String(p);
      if (!target.startsWith(home)) return false;
      return fs.existsSync(p);
    });
    return {
      ...fs,
      default: { ...fs, existsSync },
      existsSync,
    };
  });
  vi.doMock("child_process", async () => {
    const { EventEmitter } = await import("node:events");
    return {
      spawn: vi.fn(() => {
        const child = new EventEmitter() as ReturnType<
          typeof import("node:child_process").spawn
        >;
        child.stdout = new EventEmitter() as typeof child.stdout;
        child.stderr = new EventEmitter() as typeof child.stderr;
        child.kill = vi.fn() as typeof child.kill;
        queueMicrotask(() => child.emit("close", 1));
        return child;
      }),
    };
  });
  return await import("../../electron/harness-manager");
}

describe("probeCliAuth", () => {
  let env: EnvSnapshot;
  let home: string;

  beforeEach(() => {
    env = snapshotEnv();
    clearAuthEnv();
    home = makeHome();
  });

  afterEach(() => {
    restoreEnv(env);
    actualFs.rmSync(home, { recursive: true, force: true });
    vi.doUnmock("os");
    vi.doUnmock("fs");
    vi.doUnmock("child_process");
    vi.resetModules();
  });

  it("reports Claude as not installed when the binary is absent", async () => {
    const { probeCliAuth } = await loadProbeWithFakeHome(home);

    await expect(probeCliAuth("claude")).resolves.toEqual({
      installed: false,
      authenticated: false,
      action: "curl -fsSL https://claude.ai/install.sh | bash",
    });
  });

  it("reports Claude as authenticated from an env API key", async () => {
    touchFakeBinary(home, "claude");
    process.env.ANTHROPIC_API_KEY = "test-key";
    const { probeCliAuth } = await loadProbeWithFakeHome(home);

    await expect(probeCliAuth("claude")).resolves.toEqual({
      installed: true,
      authenticated: true,
    });
  });

  it("reports Claude as authenticated from the local credentials marker", async () => {
    touchFakeBinary(home, "claude");
    writeJson(path.join(home, ".claude", ".credentials.json"), {
      oauth: true,
    });
    const { probeCliAuth } = await loadProbeWithFakeHome(home);

    await expect(probeCliAuth("claude")).resolves.toEqual({
      installed: true,
      authenticated: true,
    });
  });

  it("reports Claude as requiring login when installed without credentials", async () => {
    touchFakeBinary(home, "claude");
    const { probeCliAuth } = await loadProbeWithFakeHome(home);

    await expect(probeCliAuth("claude")).resolves.toEqual({
      installed: true,
      authenticated: false,
      action: "claude login",
    });
  });

  it("reports Codex as not installed when the binary is absent", async () => {
    const { probeCliAuth } = await loadProbeWithFakeHome(home);

    await expect(probeCliAuth("codex")).resolves.toEqual({
      installed: false,
      authenticated: false,
      action: "curl -fsSL https://chatgpt.com/codex/install.sh | bash",
    });
  });

  it("reports Codex as authenticated from an env API key", async () => {
    touchFakeBinary(home, "codex");
    process.env.OPENAI_API_KEY = "test-key";
    const { probeCliAuth } = await loadProbeWithFakeHome(home);

    await expect(probeCliAuth("codex")).resolves.toEqual({
      installed: true,
      authenticated: true,
    });
  });

  it("reports Codex as authenticated from auth.json tokens", async () => {
    touchFakeBinary(home, "codex");
    writeJson(path.join(home, ".codex", "auth.json"), {
      tokens: { access_token: "token" },
    });
    const { probeCliAuth } = await loadProbeWithFakeHome(home);

    await expect(probeCliAuth("codex")).resolves.toEqual({
      installed: true,
      authenticated: true,
    });
  });

  it("reports Codex as requiring login when installed without credentials", async () => {
    touchFakeBinary(home, "codex");
    const { probeCliAuth } = await loadProbeWithFakeHome(home);

    await expect(probeCliAuth("codex")).resolves.toEqual({
      installed: true,
      authenticated: false,
      action: "codex login",
    });
  });
});
