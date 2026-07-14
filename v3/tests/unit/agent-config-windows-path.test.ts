import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as actualFs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

const ENV_KEYS = ["APPDATA", "PATH", "PATHEXT"] as const;

type EnvSnapshot = Record<(typeof ENV_KEYS)[number], string | undefined>;

function snapshotEnv(): EnvSnapshot {
  return Object.fromEntries(
    ENV_KEYS.map((key) => [key, process.env[key]]),
  ) as EnvSnapshot;
}

function restoreEnv(snapshot: EnvSnapshot): void {
  for (const key of ENV_KEYS) {
    const value = snapshot[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}

function makeHome(): string {
  return actualFs.realpathSync(
    actualFs.mkdtempSync(path.join(os.tmpdir(), "marblo-agent-config-win-")),
  );
}

function writeFile(filePath: string, content: string): void {
  actualFs.mkdirSync(path.dirname(filePath), { recursive: true });
  actualFs.writeFileSync(filePath, content, "utf-8");
}

async function loadAgentConfigWithWindowsMocks(home: string) {
  vi.resetModules();
  vi.doMock("path", async () => {
    const actual = await vi.importActual<typeof import("path")>("path");
    const mocked = { ...actual, delimiter: ";" };
    return { ...mocked, default: mocked };
  });
  vi.doMock("os", async () => ({
    ...(await vi.importActual<typeof import("os")>("os")),
    default: {
      ...(await vi.importActual<typeof import("os")>("os")),
      homedir: () => home,
      platform: () => "win32",
    },
    homedir: () => home,
    platform: () => "win32",
  }));
  vi.doMock("child_process", async () => ({
    execFileSync: vi.fn((command: string, args: string[]) => {
      if (
        command === "cmd.exe" &&
        args[0] === "/c" &&
        /codex\.cmd$/i.test(args[1] ?? "") &&
        args[2] === "--version"
      ) {
        return "codex-cli 0.123.4\n";
      }
      throw new Error(`unexpected execFileSync: ${command} ${args.join(" ")}`);
    }),
  }));
  return await import("../../electron/agent-config");
}

describe("agent-config Windows PATH handling", () => {
  let env: EnvSnapshot;
  let home: string;

  beforeEach(() => {
    env = snapshotEnv();
    home = makeHome();
    process.env.APPDATA = path.join(home, "AppData", "Roaming");
    process.env.PATHEXT = ".CMD;.EXE";
  });

  afterEach(() => {
    restoreEnv(env);
    actualFs.rmSync(home, { recursive: true, force: true });
    vi.doUnmock("path");
    vi.doUnmock("os");
    vi.doUnmock("child_process");
    vi.resetModules();
  });

  it("resolves codex.cmd from a semicolon-delimited PATH", async () => {
    const binDir = path.join(home, "AppData", "Roaming", "npm");
    const codexShim = path.join(binDir, "codex.cmd");
    writeFile(codexShim, "@echo off\r\n");
    process.env.PATH = `C:\\Program Files\\nodejs;${binDir}`;
    const { resolveHarnessCli } = await loadAgentConfigWithWindowsMocks(home);

    expect(resolveHarnessCli("gpt")).toEqual({
      command: codexShim,
      version: "0.123.4",
    });
  });
});
