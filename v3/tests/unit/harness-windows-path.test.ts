import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EventEmitter } from "node:events";
import * as actualFs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

type SpawnCall = {
  command: string;
  args: string[];
};

const ENV_KEYS = ["APPDATA", "OPENAI_API_KEY", "PATH", "PATHEXT"] as const;

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
    actualFs.mkdtempSync(path.join(os.tmpdir(), "marblo-win-path-")),
  );
}

function writeFile(filePath: string, content: string): void {
  actualFs.mkdirSync(path.dirname(filePath), { recursive: true });
  actualFs.writeFileSync(filePath, content, "utf-8");
}

function touchWindowsShim(home: string, binary: string): string {
  const binDir = path.join(home, "AppData", "Roaming", "npm");
  const shim = path.join(binDir, `${binary}.cmd`);
  writeFile(shim, "@echo off\r\n");
  return shim;
}

async function loadHarnessWithWindowsMocks(spawnCalls: SpawnCall[]) {
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
      homedir: () => currentHome,
    },
    homedir: () => currentHome,
  }));
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
  return await import("../../electron/harness-manager");
}

let currentHome = "";

describe("harness manager Windows PATH handling", () => {
  let env: EnvSnapshot;
  let platformDescriptor: PropertyDescriptor | undefined;

  beforeEach(() => {
    env = snapshotEnv();
    platformDescriptor = Object.getOwnPropertyDescriptor(process, "platform");
    Object.defineProperty(process, "platform", {
      configurable: true,
      value: "win32",
    });
    currentHome = makeHome();
    process.env.APPDATA = path.join(currentHome, "AppData", "Roaming");
    process.env.PATHEXT = ".CMD;.EXE";
    delete process.env.OPENAI_API_KEY;
  });

  afterEach(() => {
    restoreEnv(env);
    if (platformDescriptor) {
      Object.defineProperty(process, "platform", platformDescriptor);
    }
    actualFs.rmSync(currentHome, { recursive: true, force: true });
    vi.doUnmock("path");
    vi.doUnmock("os");
    vi.doUnmock("child_process");
    vi.resetModules();
  });

  it("finds codex.cmd on a semicolon-delimited Windows PATH", async () => {
    const codexShim = touchWindowsShim(currentHome, "codex");
    process.env.PATH = `C:\\Program Files\\nodejs;${path.dirname(codexShim)}`;
    writeFile(
      path.join(currentHome, ".codex", "auth.json"),
      JSON.stringify({ tokens: { access_token: "test-token" } }),
    );

    const { probeCliAuth } = await loadHarnessWithWindowsMocks([]);

    await expect(probeCliAuth("codex")).resolves.toEqual({
      installed: true,
      authenticated: true,
    });
  });

  it("runs npm.cmd through cmd.exe for npm-global installs (gemini)", async () => {
    const npmShim = touchWindowsShim(currentHome, "npm");
    process.env.PATH = `C:\\Program Files\\nodejs;${path.dirname(npmShim)}`;
    const spawnCalls: SpawnCall[] = [];
    const { installPackage } = await loadHarnessWithWindowsMocks(spawnCalls);

    await installPackage("cli-gemini");

    // 첫 spawn 은 EACCES 폴백 판정용 `npm prefix -g` (mock stdout 빈값 →
    // prefix 미상 → 폴백 없이 기본 전역 설치).
    expect(spawnCalls[0]).toEqual({
      command: "cmd.exe",
      args: ["/c", npmShim, "prefix", "-g"],
    });
    expect(spawnCalls[1]).toEqual({
      command: "cmd.exe",
      args: ["/c", npmShim, "install", "-g", "@google/gemini-cli"],
    });
  });

  it("runs the official PowerShell installer (irm|iex) for shell CLIs on Windows", async () => {
    // powershell.exe pre-flight 는 enriched PATH 의 실제 파일을 확인한다.
    const psDir = path.join(currentHome, "System32");
    writeFile(path.join(psDir, "powershell.exe"), "");
    const codexShim = touchWindowsShim(currentHome, "codex");
    process.env.PATH = `${psDir};${path.dirname(codexShim)}`;
    const spawnCalls: SpawnCall[] = [];
    const { installPackage } = await loadHarnessWithWindowsMocks(spawnCalls);

    await installPackage("cli-codex");

    expect(spawnCalls[0]).toEqual({
      command: "powershell.exe",
      args: [
        "-NoProfile",
        "-ExecutionPolicy",
        "Bypass",
        "-Command",
        "irm 'https://chatgpt.com/codex/install.ps1' | iex",
      ],
    });
    // postInstallExec (codex features enable goals) 는 shell 설치 후에도 돈다.
    expect(spawnCalls[1]).toEqual({
      command: "cmd.exe",
      args: ["/c", codexShim, "features", "enable", "goals"],
    });
    expect(spawnCalls[0].args.join(" ")).not.toMatch(/curl|bash|npm/);
  });

  it("refuses honestly on Windows when the vendor ships no Windows installer", async () => {
    const harness = await loadHarnessWithWindowsMocks([]);
    const { CATALOG } = await import("../../electron/harness-catalog");
    const agy = CATALOG.find((p) => p.id === "cli-antigravity")!;
    const originalWinSource = agy.install.winSource;
    delete agy.install.winSource;
    try {
      await expect(harness.installPackage("cli-antigravity")).rejects.toThrow(
        /Windows용 공식 인스톨러를 제공하지 않습니다/,
      );
    } finally {
      agy.install.winSource = originalWinSource;
    }
  });
});
