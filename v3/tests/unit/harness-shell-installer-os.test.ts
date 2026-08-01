/**
 * OS별 shell 인스톨러 분기 회귀 테스트 (feWGFNNwxOnw1bxcnyk4).
 *
 * #695가 Claude Code 만 네이티브(curl)로 전환한 후속: Codex 도 공식
 * 네이티브 인스톨러로, 전 shell 인스톨러가 Windows(PowerShell irm|iex)를
 * 지원하고, 벤더가 Windows 인스톨러를 안 주면(winSource 부재) 가짜 URL
 * 대신 정직한 "미지원" 에러를 낸다. 신뢰 호스트 allowlist 는 mac/win
 * 공통 적용. Gemini 는 네이티브 인스톨러가 없어(공식문서 실측: npm/brew/
 * MacPorts 만) npm-global 유지 + 사용자쓰기가능 prefix 폴백.
 */
import { describe, expect, it } from "vitest";
import {
  isNpmPrefixWritable,
  resolveShellInstallerSpawn,
} from "../../electron/harness-manager";
import { CATALOG } from "../../electron/harness-catalog";
import type { InstallStrategy } from "../../electron/harness-catalog";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const shellEntry = (id: string): InstallStrategy => {
  const pkg = CATALOG.find((p) => p.id === id);
  expect(pkg, `catalog entry ${id}`).toBeDefined();
  return pkg!.install;
};

describe("catalog: official installer URLs per vendor (실측 고정)", () => {
  it("Codex is kind=shell from chatgpt.com with a Windows installer", () => {
    const codex = shellEntry("cli-codex");
    expect(codex.kind).toBe("shell");
    expect(codex.source).toBe("https://chatgpt.com/codex/install.sh");
    expect(codex.winSource).toBe("https://chatgpt.com/codex/install.ps1");
  });

  it("Claude / Grok / Antigravity all carry official Windows installers", () => {
    expect(shellEntry("cli-claude-code").winSource).toBe(
      "https://claude.ai/install.ps1",
    );
    expect(shellEntry("cli-grok").winSource).toBe(
      "https://x.ai/cli/install.ps1",
    );
    expect(shellEntry("cli-antigravity").winSource).toBe(
      "https://antigravity.google/cli/install.ps1",
    );
  });

  it("Gemini stays npm-global (no official native installer exists)", () => {
    const gemini = shellEntry("cli-gemini");
    expect(gemini.kind).toBe("npm-global");
    expect(gemini.source).toBe("@google/gemini-cli");
    expect(gemini.winSource).toBeUndefined();
  });

  it("Codex keeps its goals post-install hook after the kind switch", () => {
    const codex = shellEntry("cli-codex");
    expect(codex.postInstallExec).toEqual([
      { command: "codex", args: ["features", "enable", "goals"] },
    ]);
  });
});

describe("resolveShellInstallerSpawn: OS-specific command shape", () => {
  const claude = shellEntry("cli-claude-code");

  it("darwin/linux → bash -c curl|bash with the mac/linux URL", () => {
    for (const platform of ["darwin", "linux"] as const) {
      const plan = resolveShellInstallerSpawn(claude, platform);
      expect(plan.command).toBe("bash");
      expect(plan.args).toEqual([
        "-c",
        "curl -fsSL 'https://claude.ai/install.sh' | bash",
      ]);
      expect(plan.url).toBe("https://claude.ai/install.sh");
    }
  });

  it("win32 → powershell irm|iex with the vendor's .ps1 URL", () => {
    const plan = resolveShellInstallerSpawn(claude, "win32");
    expect(plan.command).toBe("powershell.exe");
    expect(plan.args).toEqual([
      "-NoProfile",
      "-ExecutionPolicy",
      "Bypass",
      "-Command",
      "irm 'https://claude.ai/install.ps1' | iex",
    ]);
    expect(plan.url).toBe("https://claude.ai/install.ps1");
    expect(plan.args.join(" ")).not.toMatch(/curl|bash/);
  });

  it("win32 with no winSource → honest unsupported error, never a guessed URL", () => {
    const noWin: InstallStrategy = {
      kind: "shell",
      source: "https://x.ai/cli/install.sh",
    };
    expect(() => resolveShellInstallerSpawn(noWin, "win32")).toThrow(
      /Windows용 공식 인스톨러를 제공하지 않습니다/,
    );
  });

  it("trusted-host allowlist applies on Windows too (winSource is not a bypass)", () => {
    const evilWin: InstallStrategy = {
      kind: "shell",
      source: "https://claude.ai/install.sh",
      winSource: "https://evil.example.com/install.ps1",
    };
    expect(() => resolveShellInstallerSpawn(evilWin, "win32")).toThrow(
      /not whitelisted/,
    );
    // mac 쪽 URL 검증도 그대로 (기존 #695 가드 회귀 방지)
    const evilMac: InstallStrategy = {
      kind: "shell",
      source: "https://evil.example.com/install.sh",
    };
    expect(() => resolveShellInstallerSpawn(evilMac, "darwin")).toThrow(
      /not whitelisted/,
    );
  });

  it("rejects plain-http installer URLs on both platforms", () => {
    const httpWin: InstallStrategy = {
      kind: "shell",
      source: "https://claude.ai/install.sh",
      winSource: "http://claude.ai/install.ps1",
    };
    expect(() => resolveShellInstallerSpawn(httpWin, "win32")).toThrow(
      /must be HTTPS/,
    );
    const httpMac: InstallStrategy = {
      kind: "shell",
      source: "http://claude.ai/install.sh",
    };
    expect(() => resolveShellInstallerSpawn(httpMac, "darwin")).toThrow(
      /must be HTTPS/,
    );
  });

  it("every shell catalog entry resolves cleanly on darwin (hosts all whitelisted)", () => {
    for (const pkg of CATALOG) {
      if (pkg.install.kind !== "shell") continue;
      const plan = resolveShellInstallerSpawn(pkg.install, "darwin");
      expect(plan.command).toBe("bash");
      if (pkg.install.winSource) {
        const winPlan = resolveShellInstallerSpawn(pkg.install, "win32");
        expect(winPlan.command).toBe("powershell.exe");
      }
    }
  });
});

describe("isNpmPrefixWritable: EACCES 회피 폴백 판정", () => {
  it("returns true for a user-owned prefix", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "npm-prefix-"));
    try {
      fs.mkdirSync(path.join(dir, "lib", "node_modules"), { recursive: true });
      expect(isNpmPrefixWritable(dir)).toBe(true);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("returns false for a root-owned system prefix (e.g. /usr)", () => {
    // /usr/lib 은 어느 macOS/Linux 에서도 non-root 쓰기 불가.
    if (process.getuid && process.getuid() === 0) return; // root 로 돌면 스킵
    expect(isNpmPrefixWritable("/usr")).toBe(false);
  });

  it("returns false when the prefix doesn't exist at all", () => {
    expect(isNpmPrefixWritable("/nonexistent-prefix-feWGFNNw")).toBe(false);
  });
});
