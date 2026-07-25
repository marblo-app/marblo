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
import { AgentConfigGenerator } from "../../electron/agent-config";
import {
  spawnedModelFromArgs,
  formatModelAtEffort,
} from "../../electron/agent-manager";
import { resolveModelPin } from "../../electron/model-selection";

const CLI_OK = "2.1.220";
const CLI_OLD = "2.1.100";

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "marblo-pin-"));

/**
 * getLaunchConfig 를 돌려 실제 argv 를 얻는다. `buildCLICommand` 는 private 라
 * 공개 진입점으로 부른다 — 우리가 검증하려는 것이 바로 그 공개 경로다.
 */
function launchArgs(
  model: "claude" | "gpt",
  modelPin?: {
    claudeModel?: string;
    codexModel?: string;
    codexEffort?: string;
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
