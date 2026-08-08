import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as actualFs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
  modelToCliAuth,
  looksLikeLoginScreen,
} from "../../electron/harness-manager";

// modelToCliAuth + looksLikeLoginScreen are pure — import once, no mocking.
describe("modelToCliAuth", () => {
  it("maps claude → claude, gpt/codex → codex, grok → grok", () => {
    expect(modelToCliAuth("claude")).toBe("claude");
    expect(modelToCliAuth("gpt")).toBe("codex");
    expect(modelToCliAuth("codex")).toBe("codex");
    expect(modelToCliAuth("grok")).toBe("grok");
  });

  it("returns null for ungated models (no probe → pass-through)", () => {
    for (const m of ["gemini", "antigravity", "custom", "local", "weird"]) {
      expect(modelToCliAuth(m)).toBeNull();
    }
  });
});

describe("looksLikeLoginScreen", () => {
  it("matches the real codex logged-out boot screen", () => {
    // Verbatim from QA vj7ZvHphYOIhsNd340ad PTY capture.
    const codexLogin =
      "Welcome to Codex, OpenAI's command-line coding agent\n" +
      "Sign in with ChatGPT\n" +
      "1. Sign in with ChatGPT  2. Device Code  3. Provide API key\n" +
      "Press enter to continue";
    expect(looksLikeLoginScreen(codexLogin)).toBe(true);
  });

  it("matches the claude login menu", () => {
    expect(
      looksLikeLoginScreen(
        "Select login method\n> Claude account with subscription",
      ),
    ).toBe(true);
    expect(looksLikeLoginScreen("Log in with your Anthropic account")).toBe(
      true,
    );
  });

  it("matches the antigravity (agy) / gemini OAuth flow", () => {
    expect(looksLikeLoginScreen("Waiting for authentication...")).toBe(true);
    expect(looksLikeLoginScreen("Sign in with Google to continue")).toBe(true);
    expect(
      looksLikeLoginScreen(
        "How would you like to authenticate for this project?",
      ),
    ).toBe(true);
  });

  it("matches the Grok browser auth flow", () => {
    // ★ grok 1.0.0 라이브 캡처 실문구(AFfUD3h2DaQZweNdwDhy). 종전의
    //   "Grok Build login required" 는 실물이 아니라 창작 문자열이었고, 그 패턴
    //   (/Grok Build.*(login|auth)/i)은 정작 진짜 로그인 화면을 못 잡으면서
    //   준비 상태 푸터("Grok Build  v1.0.0 … /help for commands")를 오탐했다.
    //   전수 근거는 grok-login-detection.test.ts.
    expect(
      looksLikeLoginScreen("Approve in your browser to finish signing in."),
    ).toBe(true);
    expect(
      looksLikeLoginScreen("Make sure your browser shows this code."),
    ).toBe(true);
    expect(looksLikeLoginScreen("Waiting for approval...")).toBe(true);
    expect(looksLikeLoginScreen("Login with grok.com")).toBe(true);
    expect(looksLikeLoginScreen("Sign in with xAI to continue")).toBe(true);
    // 준비 상태 푸터는 로그인 화면이 아니다 (이 티켓의 오탐).
    expect(looksLikeLoginScreen("Grok Build  v1.0.0   Model grok-4-fast")).toBe(
      false,
    );
    // 'Browser OIDC' 단독은 더는 확정 신호가 아니다 — 정상 인증된 grok 도 부팅 중
    // 인증 '방법' 안내로 뱉기 때문(UO8F2SM7i6YTQcnbqrSX). 로그인 메뉴 맥락이
    // 함께 있을 때만 확정으로 친다. 자세한 축은 login-screen-backstop.test.ts.
    expect(looksLikeLoginScreen("Browser OIDC")).toBe(false);
    expect(
      looksLikeLoginScreen(
        "Select login method\n  1) Browser OIDC\n  2) API key",
      ),
    ).toBe(true);
  });

  it("does NOT match a normal ready CLI prompt (no false blocking)", () => {
    // These are the readiness signatures agent/orchestrator boot into once
    // authenticated — none may look like a login screen.
    expect(looksLikeLoginScreen("? for shortcuts")).toBe(false);
    expect(looksLikeLoginScreen("Loaded 7 MCP tools")).toBe(false);
    expect(looksLikeLoginScreen("Explain this codebase")).toBe(false);
    expect(looksLikeLoginScreen("Type your message...")).toBe(false);
    expect(looksLikeLoginScreen("")).toBe(false);
  });
});

// checkSpawnAuthGate delegates to probeCliAuth — reuse the fake-home mock so
// the gate's block/pass decisions can be asserted without touching real creds.
function makeHome(): string {
  return actualFs.realpathSync(
    actualFs.mkdtempSync(path.join(os.tmpdir(), "marblo-spawn-gate-")),
  );
}

function touchFakeBinary(
  home: string,
  binary: "claude" | "codex" | "grok" | "agy",
): void {
  const binDir = path.join(home, ".npm", "bin");
  actualFs.mkdirSync(binDir, { recursive: true });
  actualFs.writeFileSync(path.join(binDir, binary), "#!/bin/sh\n", "utf-8");
}

async function loadGateWithFakeHome(home: string) {
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
    return { ...fs, default: { ...fs, existsSync }, existsSync };
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

describe("checkSpawnAuthGate", () => {
  const authEnv = [
    "ANTHROPIC_API_KEY",
    "ANTHROPIC_AUTH_TOKEN",
    "OPENAI_API_KEY",
    "XAI_API_KEY",
  ];
  let saved: Record<string, string | undefined>;
  let home: string;

  beforeEach(() => {
    saved = Object.fromEntries(authEnv.map((k) => [k, process.env[k]]));
    for (const k of authEnv) delete process.env[k];
    home = makeHome();
  });

  afterEach(() => {
    for (const k of authEnv) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k]!;
    }
    actualFs.rmSync(home, { recursive: true, force: true });
    vi.doUnmock("os");
    vi.doUnmock("fs");
    vi.doUnmock("child_process");
    vi.resetModules();
  });

  it("passes ungated models through without probing", async () => {
    const { checkSpawnAuthGate } = await loadGateWithFakeHome(home);
    await expect(checkSpawnAuthGate("gemini")).resolves.toEqual({
      ok: true,
      model: null,
      installed: true,
      authenticated: true,
    });
  });

  it("blocks claude when the binary is not installed", async () => {
    const { checkSpawnAuthGate } = await loadGateWithFakeHome(home);
    const gate = await checkSpawnAuthGate("claude");
    expect(gate.ok).toBe(false);
    expect(gate.reason).toBe("not-installed");
    expect(gate.action).toBe("curl -fsSL https://claude.ai/install.sh | bash");
  });

  it("blocks claude (gpt→codex) when installed but not logged in", async () => {
    touchFakeBinary(home, "codex");
    const { checkSpawnAuthGate } = await loadGateWithFakeHome(home);
    const gate = await checkSpawnAuthGate("gpt");
    expect(gate.ok).toBe(false);
    expect(gate.model).toBe("codex");
    expect(gate.reason).toBe("not-authenticated");
    expect(gate.action).toBe("codex login");
  });

  it("blocks grok when installed but not logged in", async () => {
    touchFakeBinary(home, "grok");
    const { checkSpawnAuthGate } = await loadGateWithFakeHome(home);
    const gate = await checkSpawnAuthGate("grok");
    expect(gate.ok).toBe(false);
    expect(gate.model).toBe("grok");
    expect(gate.reason).toBe("not-authenticated");
    expect(gate.action).toBe("grok login");
  });

  it("passes grok when installed + XAI_API_KEY is present", async () => {
    touchFakeBinary(home, "grok");
    process.env.XAI_API_KEY = "test-key";
    const { checkSpawnAuthGate } = await loadGateWithFakeHome(home);
    await expect(checkSpawnAuthGate("grok")).resolves.toEqual({
      ok: true,
      model: "grok",
      installed: true,
      authenticated: true,
    });
  });

  it("passes claude when installed + authenticated (existing users unaffected)", async () => {
    touchFakeBinary(home, "claude");
    process.env.ANTHROPIC_API_KEY = "test-key";
    const { checkSpawnAuthGate } = await loadGateWithFakeHome(home);
    await expect(checkSpawnAuthGate("claude")).resolves.toEqual({
      ok: true,
      model: "claude",
      installed: true,
      authenticated: true,
    });
  });

  it("leaves antigravity ungated at spawn (backstop covers it instead)", async () => {
    // agy is spawn-ungated even when logged out — checkSpawnAuthGate passes it
    // through; the readiness login-screen backstop handles an unauthed agy.
    const { checkSpawnAuthGate } = await loadGateWithFakeHome(home);
    await expect(checkSpawnAuthGate("antigravity")).resolves.toEqual({
      ok: true,
      model: null,
      installed: true,
      authenticated: true,
    });
  });
});

describe("probeCliAuth — antigravity (agy)", () => {
  const authEnv = ["GOOGLE_API_KEY", "GEMINI_API_KEY"];
  let saved: Record<string, string | undefined>;
  let home: string;

  beforeEach(() => {
    saved = Object.fromEntries(authEnv.map((k) => [k, process.env[k]]));
    for (const k of authEnv) delete process.env[k];
    home = makeHome();
  });

  afterEach(() => {
    for (const k of authEnv) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k]!;
    }
    actualFs.rmSync(home, { recursive: true, force: true });
    vi.doUnmock("os");
    vi.doUnmock("fs");
    vi.doUnmock("child_process");
    vi.resetModules();
  });

  it("reports agy not installed when the binary is absent", async () => {
    const { probeCliAuth } = await loadGateWithFakeHome(home);
    await expect(probeCliAuth("antigravity")).resolves.toEqual({
      installed: false,
      authenticated: false,
      action: "curl -fsSL https://antigravity.google/cli/install.sh | bash",
    });
  });

  it("reports agy requiring login when installed without the OAuth token", async () => {
    touchFakeBinary(home, "agy");
    const { probeCliAuth } = await loadGateWithFakeHome(home);
    await expect(probeCliAuth("antigravity")).resolves.toEqual({
      installed: true,
      authenticated: false,
      action: "agy",
    });
  });

  it("reports agy authenticated from the antigravity-oauth-token file", async () => {
    touchFakeBinary(home, "agy");
    const tokenPath = path.join(
      home,
      ".gemini",
      "antigravity-cli",
      "antigravity-oauth-token",
    );
    actualFs.mkdirSync(path.dirname(tokenPath), { recursive: true });
    actualFs.writeFileSync(tokenPath, "{}", "utf-8");
    const { probeCliAuth } = await loadGateWithFakeHome(home);
    await expect(probeCliAuth("antigravity")).resolves.toEqual({
      installed: true,
      authenticated: true,
    });
  });
});
