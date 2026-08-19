import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";

const { startBridge, stopBridge, ptySpawns, FakePty } = vi.hoisted(() => ({
  startBridge: vi.fn(() => ({
    baseUrl: "http://127.0.0.1:45678/v1",
    port: 45678,
    stop: stopBridge,
  })),
  stopBridge: vi.fn(async () => undefined),
  ptySpawns: [] as Array<{
    command: string;
    args: string[];
    options: { env?: Record<string, string> };
  }>,
  FakePty: class {
    write() {}
    resize() {}
    kill() {}
    onData() {
      return { dispose: () => undefined };
    }
    onExit() {
      return { dispose: () => undefined };
    }
  },
}));

vi.mock("../../electron/codex-chat-bridge", () => ({
  startCodexChatBridgeSync: startBridge,
}));

vi.mock("node-pty", () => ({
  spawn: (
    command: string,
    args: string[],
    options: { env?: Record<string, string> },
  ) => {
    ptySpawns.push({ command, args, options });
    return new FakePty();
  },
}));

vi.mock("electron", () => ({ BrowserWindow: class {} }));

import { AgentConfigGenerator } from "../../electron/agent-config";
import { AgentManager } from "../../electron/agent-manager";
import { PtyManager } from "../../electron/pty-manager";
import { resolveModelPin } from "../../electron/model-selection";

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "marblo-codex-bridge-"));

function withEnv<T>(
  patch: Record<string, string | undefined>,
  fn: () => T,
): T {
  const prev: Record<string, string | undefined> = {};
  for (const key of Object.keys(patch)) {
    prev[key] = process.env[key];
    const next = patch[key];
    if (next === undefined) delete process.env[key];
    else process.env[key] = next;
  }
  try {
    return fn();
  } finally {
    for (const [key, value] of Object.entries(prev)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

function codexPin(modelId: string) {
  const pin = resolveModelPin(modelId);
  expect(pin?.harness).toBe("gpt");
  return {
    codexModel: pin?.codexModel,
    codexEffort: pin?.codexEffort,
  };
}

function readGeneratedConfig(modelId: string): {
  gen: AgentConfigGenerator;
  toml: string;
} {
  const gen = new AgentConfigGenerator();
  const cfg = gen.getLaunchConfig(
    {
      id: `agent-${modelId}-${Math.random().toString(36).slice(2)}`,
      model: "gpt",
      role: "backend",
      command: "",
    },
    TMP,
    undefined,
    undefined,
    undefined,
    false,
    "standard",
    codexPin(modelId),
  );
  const toml = fs.readFileSync(
    path.join(String(cfg.env.CODEX_HOME), "config.toml"),
    "utf-8",
  );
  return { gen, toml };
}

beforeEach(() => {
  startBridge.mockClear();
  stopBridge.mockClear();
  ptySpawns.length = 0;
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("AgentConfigGenerator Codex chat bridge wiring", () => {
  it("Solar 실 스폰 config 는 Upstage upstream chat provider 를 직결하고 bridge 를 시작하지 않는다", () => {
    withEnv(
      {
        UPSTAGE_API_KEY: "test-upstage-key",
        VITEST: "false",
        MARBLO_CODEX_SKIP_CHAT_BRIDGE: undefined,
      },
      () => {
        const { gen, toml } = readGeneratedConfig("solar-pro4");

        expect(startBridge).not.toHaveBeenCalled();
        expect(toml).toContain('model_provider = "upstage"');
        expect(toml).toContain("[model_providers.upstage]");
        expect(toml).toContain('base_url = "https://api.upstage.ai/v1"');
        expect(toml).toContain('wire_api = "chat"');
        expect(toml).not.toContain('base_url = "http://127.0.0.1:45678/v1"');

        gen.cleanupAll();
        expect(stopBridge).not.toHaveBeenCalled();
      },
    );
  });

  it("DeepSeek 는 Responses 지원 upstream 을 그대로 쓰고 bridge 를 시작하지 않는다", () => {
    withEnv(
      {
        DEEPSEEK_API_KEY: "test-deepseek-key",
        VITEST: "false",
        MARBLO_CODEX_SKIP_CHAT_BRIDGE: undefined,
      },
      () => {
        const { gen, toml } = readGeneratedConfig("deepseek-v4-flash");

        expect(startBridge).not.toHaveBeenCalled();
        expect(toml).toContain('model_provider = "deepseek"');
        expect(toml).toContain("[model_providers.deepseek]");
        expect(toml).toContain('base_url = "https://api.deepseek.com"');

        gen.cleanupAll();
        expect(stopBridge).not.toHaveBeenCalled();
      },
    );
  });
});

describe("AgentManager Solar spawn path", () => {
  it("agent-manager launch 경로도 Solar provider=upstage 에서 upstream chat config 를 주입하고 bridge 를 시작하지 않는다", () => {
    withEnv(
      {
        UPSTAGE_API_KEY: "test-upstage-key",
        VITEST: "false",
        MARBLO_CODEX_SKIP_CHAT_BRIDGE: undefined,
      },
      () => {
        const am = new AgentManager(new PtyManager());
        const agent = am.launch({
          id: "solar-agent-manager",
          name: "solar-worker",
          model: "gpt",
          role: "backend",
          command: "codex",
          cwd: TMP,
          codexModelOverride: "solar-pro4",
          codexEffortOverride: "medium",
        });
        const spawn = ptySpawns.at(-1);

        expect(spawn?.command).toBe("codex");
        expect(spawn?.args).toContain('model="solar-pro4"');
        expect(spawn?.args).toContain('model_reasoning_effort="medium"');
        expect(spawn?.args).toContain('model_provider="upstage"');
        expect(spawn?.options.env?.UPSTAGE_API_KEY).toBe("test-upstage-key");

        const codexHome = spawn?.options.env?.CODEX_HOME;
        expect(codexHome).toBeTruthy();
        const toml = fs.readFileSync(
          path.join(String(codexHome), "config.toml"),
          "utf-8",
        );
        expect(toml).toContain('base_url = "https://api.upstage.ai/v1"');
        expect(toml).toContain('wire_api = "chat"');
        expect(toml).not.toContain('base_url = "http://127.0.0.1:45678/v1"');
        expect(startBridge).not.toHaveBeenCalled();

        am.stop(agent.id);
        expect(stopBridge).not.toHaveBeenCalled();
      },
    );
  });
});
