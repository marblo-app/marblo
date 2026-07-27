/**
 * 지정 모델이 **실제 CLI 인자까지** 도달하는지 — 이 티켓의 완료기준 본체.
 *
 * 앞단(파서·레지스트리)은 `model-selection.test.ts` 가 덮는다. 여기서 증명하는
 * 것은 그 결과가 `buildCLICommand` 를 통과해 진짜 argv 가 되는가다. 두 축을 다
 * 본다 — claude 는 `--model <id>`, codex 는 `-c model="…"` + `-c
 * model_reasoning_effort="…"`.
 *
 * 그리고 반대 방향(argv → 무엇으로 떴나)도 같은 파일에서 못박는다. P2-3 의
 * `dispatch:decision.spawnedModel` 이 그 역함수를 쓰기 때문이다.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import os from "os";
import fs from "fs";
import path from "path";
import {
  AgentConfigGenerator,
  resetClaudeResolution,
  resolveAllHarnessVersions,
  type LaunchConfig,
} from "../../electron/agent-config";
import {
  spawnedModelFromArgs,
  formatModelAtEffort,
  type ModelType,
} from "../../electron/agent-manager";
import {
  resolveModelPin,
  orchestratorLaunchPin,
} from "../../electron/model-selection";

const CLI_OK = "2.1.220";
const CLI_OLD = "2.1.100";

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "marblo-pin-"));

/**
 * getLaunchConfig 를 돌려 실제 argv 를 얻는다. `buildCLICommand` 는 private 라
 * 공개 진입점으로 부른다 — 우리가 검증하려는 것이 바로 그 공개 경로다.
 */
function launchArgs(
  model: ModelType,
  modelPin?: {
    claudeModel?: string;
    codexModel?: string;
    codexEffort?: string;
    nativeModel?: string;
  },
  complexity?: "simple" | "standard" | "complex",
): string[] {
  const gen = new AgentConfigGenerator();
  const cfg = gen.getLaunchConfig(
    { id: `ag-${model}-${Math.random()}`, model, role: "backend", command: "" },
    TMP,
    undefined,
    undefined,
    undefined,
    false,
    complexity,
    modelPin,
  );
  return cfg.args;
}

function launchCommand(model: ModelType, baseCommand = ""): string {
  const gen = new AgentConfigGenerator();
  const cfg = gen.getLaunchConfig(
    {
      id: `ag-cmd-${model}-${Math.random()}`,
      model,
      role: "backend",
      command: baseCommand,
    },
    TMP,
  );
  return cfg.command;
}

function launchConfig(
  model: ModelType,
  agentId = `ag-cfg-${model}-${Math.random()}`,
): LaunchConfig {
  const gen = new AgentConfigGenerator();
  return gen.getLaunchConfig(
    { id: agentId, model, role: "backend", command: "" },
    TMP,
  );
}

/** `--model` 뒤 값. 없으면 undefined(= 모델을 핀하지 않은 launch). */
function claudeModelArg(args: string[]): string | undefined {
  const i = args.indexOf("--model");
  return i >= 0 ? args[i + 1] : undefined;
}

/** codex `-c key="value"` 쌍에서 value 추출. */
function codexConf(args: string[], key: string): string | undefined {
  for (let i = 0; i < args.length - 1; i++) {
    if (args[i] !== "-c") continue;
    const m = new RegExp(`^${key}="(.*)"$`).exec(args[i + 1]);
    if (m) return m[1];
  }
  return undefined;
}

describe("claude — 지정 모델이 --model 로 나간다", () => {
  it("★완료기준: model='opus5' → --model claude-opus-5", () => {
    const pin = resolveModelPin("opus5", CLI_OK);
    expect(claudeModelArg(launchArgs("claude", pin))).toBe("claude-opus-5");
  });

  it("model='fable' → --model claude-fable-5", () => {
    const pin = resolveModelPin("fable", CLI_OK);
    expect(claudeModelArg(launchArgs("claude", pin))).toBe("claude-fable-5");
  });

  it("model='opus4.8' → --model claude-opus-4-8", () => {
    const pin = resolveModelPin("opus4.8", CLI_OK);
    expect(claudeModelArg(launchArgs("claude", pin))).toBe("claude-opus-4-8");
  });

  it("★안전 폴백: 미자격 CLI 는 opus 로 떨어지고 argv 는 여전히 유효하다", () => {
    const pin = resolveModelPin("fable5", CLI_OLD);
    const args = launchArgs("claude", pin);
    expect(claudeModelArg(args)).toBe("opus");
    // spawn 이 깨지지 않는다는 증거 — 나머지 필수 플래그가 그대로 있다.
    expect(args).toContain("--dangerously-skip-permissions");
    expect(args).toContain("--strict-mcp-config");
  });

  it("모델 핀이 complexity 티어보다 우선한다", () => {
    // complexity='simple' 이면 원래 sonnet 이 붙는다. 핀이 그걸 덮어야 한다.
    const pinned = launchArgs(
      "claude",
      { claudeModel: "claude-opus-5" },
      "simple",
    );
    expect(claudeModelArg(pinned)).toBe("claude-opus-5");
  });

  it("★무회귀: 핀도 complexity 도 없으면 --model 자체가 안 붙는다(오케 경로)", () => {
    const args = launchArgs("claude", undefined, undefined);
    expect(args).not.toContain("--model");
  });

  it("★무회귀: 빈 핀 객체는 미지정과 같다", () => {
    const args = launchArgs("claude", {}, undefined);
    expect(args).not.toContain("--model");
  });
});

describe("codex — 지정 모델·effort 가 -c 로 나간다", () => {
  it("model + effort 가 둘 다 붙는다", () => {
    const pin = resolveModelPin("gpt-5.6-terra@xhigh", CLI_OK);
    const args = launchArgs("gpt", pin);
    expect(codexConf(args, "model")).toBe("gpt-5.6-terra");
    expect(codexConf(args, "model_reasoning_effort")).toBe("xhigh");
  });

  it("effort 지정이 complexity 파생값을 덮는다", () => {
    // complexity='simple' → 원래 low. 명시 max 가 이겨야 한다.
    const args = launchArgs(
      "gpt",
      { codexModel: "gpt-5.6-terra", codexEffort: "max" },
      "simple",
    );
    expect(codexConf(args, "model_reasoning_effort")).toBe("max");
  });

  it("★무회귀: 모델 핀이 없으면 -c model= 이 안 붙는다(사용자 config 유지)", () => {
    const args = launchArgs("gpt", undefined, "standard");
    expect(codexConf(args, "model")).toBeUndefined();
    // complexity 파생 effort 는 종전대로 붙는다.
    expect(codexConf(args, "model_reasoning_effort")).toBe("medium");
  });

  it("★무회귀: unattended 플래그가 그대로 살아 있다", () => {
    const args = launchArgs("gpt", { codexModel: "gpt-5.6-luna" });
    expect(codexConf(args, "approval_policy")).toBe("never");
    expect(codexConf(args, "sandbox_mode")).toBe("danger-full-access");
  });
});

describe("grok — 지정 모델이 -m 으로 나간다", () => {
  it("model='grok-4.5' → -m grok-4.5", () => {
    const pin = resolveModelPin("grok-4.5", CLI_OK);
    const args = launchArgs("grok", pin);
    expect(args).toContain("--permission-mode");
    expect(args[args.indexOf("--permission-mode") + 1]).toBe(
      "bypassPermissions",
    );
    expect(args).not.toContain("--dangerously-skip-permissions");
    expect(args).toContain("-m");
    expect(args[args.indexOf("-m") + 1]).toBe("grok-4.5");
  });

  it("핀 없음 → 기본 grok-4.5", () => {
    const args = launchArgs("grok");
    expect(args[args.indexOf("-m") + 1]).toBe("grok-4.5");
  });

  it("nativeModel 핀이 기본 grok-4.5 를 덮는다", () => {
    const args = launchArgs("grok", { nativeModel: "grok-code-fast-1" });
    expect(args[args.indexOf("-m") + 1]).toBe("grok-code-fast-1");
  });
});

describe("grok — 검증된 CLI 경로와 버전 배지", () => {
  let savedPath: string | undefined;
  let binDir: string;

  beforeEach(() => {
    savedPath = process.env.PATH;
    binDir = fs.mkdtempSync(path.join(os.tmpdir(), "marblo-grok-bin-"));
    const grok = path.join(binDir, "grok");
    fs.writeFileSync(
      grok,
      "#!/bin/sh\nif [ \"$1\" = \"--version\" ]; then echo 'grok 0.2.112'; exit 0; fi\nexit 0\n",
      "utf-8",
    );
    fs.chmodSync(grok, 0o755);
    process.env.PATH = `${binDir}${path.delimiter}${savedPath ?? ""}`;
    resetClaudeResolution();
  });

  afterEach(() => {
    if (savedPath === undefined) delete process.env.PATH;
    else process.env.PATH = savedPath;
    fs.rmSync(binDir, { recursive: true, force: true });
    resetClaudeResolution();
  });

  it("bare grok 스폰은 문자열 grok 대신 버전검증된 경로를 쓴다", () => {
    const command = launchCommand("grok");
    expect(command).not.toBe("grok");
    expect(path.isAbsolute(command)).toBe(true);
    expect(path.basename(command)).toBe("grok");
  });

  it("stale command='claude' 여도 grok 바이너리로 스폰한다", () => {
    const command = launchCommand("grok", "claude");
    expect(command).not.toBe("claude");
    expect(path.isAbsolute(command)).toBe(true);
    expect(path.basename(command)).toBe("grok");
  });

  it("stale command='grok-4.5' 여도 모델 slug 를 스폰하지 않는다", () => {
    const command = launchCommand("grok", "grok-4.5");
    expect(command).not.toBe("grok-4.5");
    expect(path.isAbsolute(command)).toBe(true);
    expect(path.basename(command)).toBe("grok");
  });

  it("resolveAllHarnessVersions 가 grok 배지 키를 포함한다", () => {
    expect(resolveAllHarnessVersions()).toHaveProperty("grok");
  });
});

describe("grok — 격리 GROK_HOME 인증 전파", () => {
  let home: string;
  let savedXaiApiKey: string | undefined;
  let homedirSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    home = fs.mkdtempSync(path.join(os.tmpdir(), "marblo-grok-home-"));
    fs.mkdirSync(path.join(home, ".grok"), { recursive: true });
    savedXaiApiKey = process.env.XAI_API_KEY;
    delete process.env.XAI_API_KEY;
    homedirSpy = vi.spyOn(os, "homedir").mockReturnValue(home);
  });

  afterEach(() => {
    homedirSpy.mockRestore();
    if (savedXaiApiKey === undefined) delete process.env.XAI_API_KEY;
    else process.env.XAI_API_KEY = savedXaiApiKey;
    fs.rmSync(home, { recursive: true, force: true });
  });

  it("auth.json 이 있으면 격리 GROK_HOME 으로 심볼릭 링크한다", () => {
    const sourceAuth = path.join(home, ".grok", "auth.json");
    fs.writeFileSync(sourceAuth, JSON.stringify({ token: "fixture" }), {
      encoding: "utf-8",
      mode: 0o600,
    });

    const cfg = launchConfig("grok", "grok-auth-linked");
    const targetAuth = path.join(String(cfg.env.GROK_HOME), "auth.json");

    expect(fs.existsSync(targetAuth)).toBe(true);
    expect(fs.lstatSync(targetAuth).isSymbolicLink()).toBe(true);
    expect(fs.readlinkSync(targetAuth)).toBe(sourceAuth);
  });

  it("auth.json 이 없으면 전파를 조용히 스킵한다", () => {
    const cfg = launchConfig("grok", "grok-auth-missing");
    const targetAuth = path.join(String(cfg.env.GROK_HOME), "auth.json");

    expect(fs.existsSync(targetAuth)).toBe(false);
  });

  it("XAI_API_KEY 가 있으면 브라우저 인증 파일 전파를 스킵한다", () => {
    fs.writeFileSync(
      path.join(home, ".grok", "auth.json"),
      JSON.stringify({ token: "fixture" }),
      { encoding: "utf-8", mode: 0o600 },
    );
    process.env.XAI_API_KEY = "fixture-key";

    const cfg = launchConfig("grok", "grok-auth-env");
    const targetAuth = path.join(String(cfg.env.GROK_HOME), "auth.json");

    expect(fs.existsSync(targetAuth)).toBe(false);
  });
});

/**
 * 오케 셀렉터 값이 실제 오케 launch 인자까지 도달하는지 — 이 티켓(aduYHKhp)의
 * 완료기준 본체.
 *
 * 배선은 셀렉터 값 → `orchestratorLaunchPin`(main.ts 가 그대로 호출) →
 * `OrchestratorLaunchOptions.codexModelOverride/codexEffortOverride` →
 * `getLaunchConfig(..., modelPin)` → argv 다. 아래는 그 사슬에서 **main.ts 가 쓰는
 * 것과 같은 함수**로 핀을 만들어 진짜 argv 까지 밀어본다(핀 해석을 테스트가 다시
 * 구현하면 라이브 경로를 증명하지 못한다).
 */
describe("오케 셀렉터 값 → codex launch 인자", () => {
  /** main.ts 의 launch/switch 핸들러가 하는 일과 동일한 순서. */
  const argsForSelector = (value: string): string[] => {
    const pin = orchestratorLaunchPin(value, CLI_OK);
    return launchArgs("gpt", {
      codexModel: pin.codexModel,
      codexEffort: pin.codexEffort,
    });
  };

  it("★완료기준: 'codex:gpt-5.6-sol' → -c model=\"gpt-5.6-sol\"", () => {
    const args = argsForSelector("codex:gpt-5.6-sol");
    expect(codexConf(args, "model")).toBe("gpt-5.6-sol");
  });

  it("★완료기준: effort 선택이 model_reasoning_effort 로 전달된다", () => {
    const args = argsForSelector("codex:gpt-5.6-terra@xhigh");
    expect(codexConf(args, "model")).toBe("gpt-5.6-terra");
    expect(codexConf(args, "model_reasoning_effort")).toBe("xhigh");
  });

  it("sol/terra/luna·5.5 전부 자기 id 그대로 나간다(날조 0)", () => {
    for (const id of [
      "gpt-5.6-sol",
      "gpt-5.6-terra",
      "gpt-5.6-luna",
      "gpt-5.5",
    ]) {
      expect(codexConf(argsForSelector(`codex:${id}`), "model"), id).toBe(id);
    }
  });

  it("★무회귀: 프로바이더만 고른 'codex' 는 종전과 동일(모델 핀 없음)", () => {
    const args = argsForSelector("codex");
    expect(codexConf(args, "model")).toBeUndefined();
    // 오케는 complexity 를 안 태우므로 effort 도 CLI 기본값 그대로다.
    expect(codexConf(args, "model_reasoning_effort")).toBeUndefined();
    expect(codexConf(args, "approval_policy")).toBe("never");
  });

  it("★승인게이트: '@ultra' 를 골라도 CLI 로 나가지 않는다(#602)", () => {
    const args = argsForSelector("codex:gpt-5.6-sol@ultra");
    // 모델 선택은 살아남고 effort 만 떨어진다 — 오케가 아예 안 뜨면 더 나쁘다.
    expect(codexConf(args, "model")).toBe("gpt-5.6-sol");
    expect(codexConf(args, "model_reasoning_effort")).toBeUndefined();
  });

  it("claude 축은 종전 그대로 — 셀렉터 Claude 변형이 --model 로", () => {
    const pin = orchestratorLaunchPin("claude:claude-fable-5", CLI_OK);
    expect(pin.claudeModel).toBe("claude-fable-5");
    expect(pin.codexModel).toBeUndefined();
    expect(claudeModelArg(launchArgs("claude", pin))).toBe("claude-fable-5");
  });

  it("claude 변형도 버전가드를 계속 탄다(미검증 CLI → 폴백)", () => {
    const pin = orchestratorLaunchPin("claude:claude-fable-5", CLI_OLD);
    expect(pin.claudeModel).not.toBe("claude-fable-5");
    expect(claudeModelArg(launchArgs("claude", pin))).toBe(pin.claudeModel);
  });

  it("★프로바이더와 어긋난 핀은 축을 넘기지 않는다(spawn 안 깨짐)", () => {
    // env/손편집으로만 생길 수 있는 값. claude CLI 에 --model gpt-5.5 가 붙으면
    // 즉사한다.
    expect(orchestratorLaunchPin("claude:gpt-5.5", CLI_OK)).toEqual({});
    expect(orchestratorLaunchPin("codex:claude-opus-5", CLI_OK)).toEqual({});
  });
});

describe("역방향 — argv 에서 '실제로 뭘로 떴나' 를 되읽는다(P2-3)", () => {
  it("claude argv → 모델 id", () => {
    const args = launchArgs("claude", resolveModelPin("opus5", CLI_OK));
    expect(spawnedModelFromArgs("claude", args)).toEqual({
      modelId: "claude-opus-5",
    });
  });

  it("codex argv → model@effort", () => {
    const args = launchArgs(
      "gpt",
      resolveModelPin("gpt-5.6-terra@max", CLI_OK),
    );
    expect(formatModelAtEffort(spawnedModelFromArgs("gpt", args))).toBe(
      "gpt-5.6-terra@max",
    );
  });

  it("grok argv → 모델 id", () => {
    const args = launchArgs("grok", resolveModelPin("grok-4.5", CLI_OK));
    expect(formatModelAtEffort(spawnedModelFromArgs("grok", args))).toBe(
      "grok-4.5",
    );
  });

  it("★폴백된 launch 는 요청이 아니라 폴백된 모델을 보고한다", () => {
    // 요청은 fable5, 설치 CLI 는 미자격 → 실제로 뜬 건 opus.
    const args = launchArgs("claude", resolveModelPin("fable5", CLI_OLD));
    expect(formatModelAtEffort(spawnedModelFromArgs("claude", args))).toBe(
      "opus",
    );
  });

  it("모델을 안 핀한 launch 는 undefined — CLI 기본값을 지어내지 않는다", () => {
    const args = launchArgs("claude", undefined, undefined);
    expect(
      formatModelAtEffort(spawnedModelFromArgs("claude", args)),
    ).toBeUndefined();
  });

  it("effort 만 있고 모델이 없으면 라벨을 만들지 않는다", () => {
    const args = launchArgs("gpt", undefined, "complex");
    expect(codexConf(args, "model_reasoning_effort")).toBe("high");
    expect(
      formatModelAtEffort(spawnedModelFromArgs("gpt", args)),
    ).toBeUndefined();
  });
});

describe("env 격리", () => {
  const KEYS = ["MARBLO_TOP_CLAUDE_MODEL", "MARBLO_STANDARD_CLAUDE_MODEL"];
  let saved: Record<string, string | undefined>;
  beforeEach(() => {
    saved = {};
    for (const k of KEYS) {
      saved[k] = process.env[k];
      delete process.env[k];
    }
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });
  afterEach(() => {
    for (const k of KEYS) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
    vi.restoreAllMocks();
  });

  it("핀은 env 티어 설정과 무관하게 이긴다", () => {
    process.env.MARBLO_STANDARD_CLAUDE_MODEL = "claude-sonnet-5";
    const args = launchArgs(
      "claude",
      { claudeModel: "claude-opus-4-8" },
      "standard",
    );
    expect(claudeModelArg(args)).toBe("claude-opus-4-8");
  });
});
