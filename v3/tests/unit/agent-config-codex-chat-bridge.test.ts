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

function withEnv<T>(patch: Record<string, string | undefined>, fn: () => T): T {
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
  // mockClear 로는 부족하다 — 실패 케이스가 심는 throw 구현이 다음 테스트로
  // 새면 "브리지가 안 뜬다" 는 상태가 조용히 전파된다.
  startBridge.mockReset();
  startBridge.mockImplementation(() => ({
    baseUrl: "http://127.0.0.1:45678/v1",
    port: 45678,
    stop: stopBridge,
  }));
  stopBridge.mockClear();
  ptySpawns.length = 0;
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("AgentConfigGenerator Codex chat bridge wiring", () => {
  // ★이 스위트의 모든 단언은 withEnv 로 VITEST="false" + MARBLO_CODEX_SKIP_CHAT_BRIDGE
  //   해제 상태에서 돈다. 그 가드가 켜져 있으면 buildCodexVendorProviderToml 이
  //   브리지 경로를 통째로 건너뛰어 "브리지가 안 떠도 초록불" 인 가짜 통과가 된다.
  // ★Solar 케이스는 추가로 MARBLO_UPSTAGE_FORCE_CHAT_BRIDGE=1 을 준다 — 티켓
  //   hj7tpt0FFdyc1oGhSGgz 로 Upstage 기본값이 네이티브(브리지 불필요)로
  //   바뀌었으니, 강제하지 않으면 이 브리지 기동 코드 자체가 실행되지 않는다.
  //   "브리지 경로를 지우지 마라" 는 지시대로 코드는 남기되, 이 스위트는 그
  //   롤백 플래그로 강제 기동시켜 여전히 실제로 도는지를 잰다.
  it("Solar 를 강제 브리지로 돌리면 config 가 브리지를 띄우고 base_url 을 그 localhost 로 가리킨다", () => {
    withEnv(
      {
        UPSTAGE_API_KEY: "test-upstage-key",
        VITEST: "false",
        MARBLO_CODEX_SKIP_CHAT_BRIDGE: undefined,
        MARBLO_UPSTAGE_FORCE_CHAT_BRIDGE: "1",
      },
      () => {
        const { gen, toml } = readGeneratedConfig("solar-pro4");

        expect(startBridge).toHaveBeenCalledTimes(1);
        expect(startBridge).toHaveBeenCalledWith(
          expect.objectContaining({
            upstreamBaseUrl: "https://api.upstage.ai/v1",
            apiKey: "test-upstage-key",
          }),
        );
        expect(toml).toContain('model_provider = "upstage"');
        expect(toml).toContain("[model_providers.upstage]");
        expect(toml).toContain('base_url = "http://127.0.0.1:45678/v1"');
        // codex 0.148.0 은 wire_api="chat" 을 설정 로드 단계에서 거부한다
        // (`no longer supported`, EXIT=1). responses 만 유효하다.
        expect(toml).toContain('wire_api = "responses"');
        expect(toml).not.toContain('wire_api = "chat"');
        expect(toml).not.toContain('base_url = "https://api.upstage.ai/v1"');

        gen.cleanupAll();
        expect(stopBridge).toHaveBeenCalled();
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
        expect(toml).toContain('wire_api = "responses"');

        gen.cleanupAll();
        expect(stopBridge).not.toHaveBeenCalled();
      },
    );
  });

  // ★티켓 hj7tpt0FFdyc1oGhSGgz — 기본값 자체(강제 플래그 없음)가 네이티브임을
  //   여기서 잰다. 위 "강제 브리지" 테스트가 롤백 축이 여전히 도는지를 재는
  //   것과 대칭이다: 이 테스트는 그 축을 안 건드렸을 때 실제로 브리지가 하나도
  //   안 뜨고 실제 Upstage base_url 로 바로 가는지를 잰다.
  it("★Solar 는 강제 플래그 없이 기본값만으로 브리지 없이 실제 Upstage base_url 을 그대로 쓴다", () => {
    withEnv(
      {
        UPSTAGE_API_KEY: "test-upstage-key",
        VITEST: "false",
        MARBLO_CODEX_SKIP_CHAT_BRIDGE: undefined,
        MARBLO_UPSTAGE_FORCE_CHAT_BRIDGE: undefined,
        MARBLO_UPSTAGE_NATIVE_RESPONSES: undefined,
      },
      () => {
        const { gen, toml } = readGeneratedConfig("solar-pro4");

        expect(startBridge).not.toHaveBeenCalled();
        expect(toml).toContain('model_provider = "upstage"');
        expect(toml).toContain("[model_providers.upstage]");
        expect(toml).toContain('base_url = "https://api.upstage.ai/v1"');
        expect(toml).toContain('wire_api = "responses"');
        expect(toml).not.toContain('base_url = "http://127.0.0.1:45678/v1"');

        gen.cleanupAll();
        expect(stopBridge).not.toHaveBeenCalled();
      },
    );
  });
});

describe("브리지 기동 실패는 조용한 upstream 폴백 대신 스폰을 중단한다", () => {
  // ★이 스위트가 이 티켓의 핵심 회귀 방어선이다. 종전 구현은 실패 시
  //   console.warn 만 남기고 base_url 을 upstream 으로 뒀는데, 그러면
  //   wire_api="responses" 가 존재하지 않는 api.upstage.ai/v1/responses 를 때려
  //   `404 page not found` 가 나고 진짜 실패 지점(브리지 기동 실패)이 가려진다.
  it("startCodexChatBridgeSync 가 throw 하면 getLaunchConfig 도 사유를 실어 throw 한다", () => {
    withEnv(
      {
        UPSTAGE_API_KEY: "test-upstage-key",
        VITEST: "false",
        MARBLO_CODEX_SKIP_CHAT_BRIDGE: undefined,
        MARBLO_UPSTAGE_FORCE_CHAT_BRIDGE: "1",
      },
      () => {
        startBridge.mockImplementation(() => {
          throw new Error("codex chat bridge failed to start: child exited");
        });

        expect(() => readGeneratedConfig("solar-pro4")).toThrow(
          /codex chat bridge failed to start: child exited/,
        );
        // 폴백 금지 — upstream 으로 물러섰다는 어떤 흔적도 없어야 한다.
        expect(() => readGeneratedConfig("solar-pro4")).toThrow(
          /Refusing to fall back to https:\/\/api\.upstage\.ai\/v1/,
        );
      },
    );
  });
});

describe("AgentManager Solar spawn path", () => {
  it("agent-manager launch 경로도 강제 브리지에서는 Solar 브리지를 띄우고 그 base_url 을 주입한다", () => {
    withEnv(
      {
        UPSTAGE_API_KEY: "test-upstage-key",
        VITEST: "false",
        MARBLO_CODEX_SKIP_CHAT_BRIDGE: undefined,
        MARBLO_UPSTAGE_FORCE_CHAT_BRIDGE: "1",
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
        expect(toml).toContain('base_url = "http://127.0.0.1:45678/v1"');
        expect(toml).toContain('wire_api = "responses"');
        expect(toml).not.toContain('base_url = "https://api.upstage.ai/v1"');
        expect(startBridge).toHaveBeenCalledTimes(1);

        am.stop(agent.id);
        expect(stopBridge).toHaveBeenCalled();
      },
    );
  });
});
