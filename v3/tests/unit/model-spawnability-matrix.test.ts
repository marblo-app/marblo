/**
 * ★스폰가능성 매트릭스 — 레지스트리 **전 행**이 실제로 뜰 수 있는가(sAw2jP3G).
 *
 * 종전 테스트들은 축마다 따로 있었다: `model-pin-launch-args`(argv), `model-ladder`
 * (사다리), `vendor-*`(벤더별 배선), `byom-spawn-gate`(크레덴셜). 축이 다 초록인데도
 * **한 모델이 통째로 못 뜨는** 상태는 그 사이에 숨을 수 있다 — 실제로 grok-4.5 가
 * 그랬다(레지스트리엔 있고 argv 도 맞는데 사다리에 없어 자동선택이 영원히 못 고름,
 * 게다가 하네스별 필터 때문에 완결성 가드도 그 행을 건너뛰었다).
 *
 * 그래서 이 파일은 **모델 하나를 한 행으로** 보고 다섯 칸을 한꺼번에 세운다:
 *
 *   해석 — `resolveModelPin` 이 그 id 를 제 하네스·제 핀 축으로 해석하는가
 *   argv — `getLaunchConfig` 가 유효 argv 를 내는가(바이너리·플래그·모델 슬러그)
 *   사다리 — 자동선택 후보에 오르는가, 아니면 **이유가 적힌** 제외인가
 *   표기 — argv 를 되읽은 값이 그 모델 id 인가(하네스 이름 "claude" 오표기 금지)
 *   크레덴셜 — env-swap 행이 전부-아니면-전무를 지키는가(부분 주입 = 크레덴셜 유출)
 *
 * ★테이블은 손으로 적지 않는다. `MODEL_REGISTRY` 를 그대로 돌므로, 새 행을 추가한
 * 사람이 이 파일을 잊어도 그 행이 자동으로 감사 대상이 된다(잊으면 빨개진다).
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import os from "os";
import fs from "fs";
import path from "path";
import {
  AgentConfigGenerator,
  vendorEnvReadiness,
} from "../../electron/agent-config";
import {
  spawnedModelFromArgs,
  formatModelAtEffort,
  type ModelType,
} from "../../electron/agent-manager";
import { resolveModelPin } from "../../electron/model-selection";
import {
  MODEL_REGISTRY,
  isHarnessFamilyId,
  vendorEnvSecretRef,
  HARNESS_NATIVE_VENDOR,
  type ModelRegistryEntry,
} from "../../electron/model-registry";
import { LADDER_EXCLUSIONS, ladderFor } from "../../electron/model-ladder";
import { autoCandidates } from "../../electron/model-autoselect";

/** 레지스트리 minCli 게이트를 전부 통과하는 설치 버전(폴백 없이 원본 id 확인). */
const CLI_OK = "2.1.220";

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "marblo-spawnability-"));
afterAll(() => fs.rmSync(TMP, { recursive: true, force: true }));

const ACTIVE = MODEL_REGISTRY.filter((m) => m.status === "active");

/**
 * 이 모델을 명시 지정했을 때의 실제 launch(핀 해석 → getLaunchConfig).
 *
 * ★모델당 한 번만 만들어 캐시한다. `getLaunchConfig` 는 MCP config 를 디스크에
 * 쓰고 스킬 파일을 읽는 **실제** 경로라, 축(argv·표기·크레덴셜)마다 다시 부르면
 * 한 파일에서 수십 번의 파일 IO 가 나고 병렬 스위트 전체가 느려진다.
 */
const _launchCache = new Map<string, ReturnType<typeof buildLaunch>>();
function launchFor(entry: ModelRegistryEntry) {
  const cached = _launchCache.get(entry.id);
  if (cached) return cached;
  const built = buildLaunch(entry);
  _launchCache.set(entry.id, built);
  return built;
}

function buildLaunch(entry: ModelRegistryEntry) {
  const pin = resolveModelPin(entry.id, CLI_OK);
  const gen = new AgentConfigGenerator();
  const cfg = gen.getLaunchConfig(
    {
      id: `matrix-${entry.id}-${Math.random().toString(36).slice(2)}`,
      model: entry.harness as ModelType,
      role: "backend",
      command: "",
    },
    TMP,
    undefined,
    undefined,
    undefined,
    false,
    "standard",
    pin
      ? {
          claudeModel: pin.claudeModel,
          codexModel: pin.codexModel,
          codexEffort: pin.codexEffort,
          nativeModel: pin.nativeModel,
        }
      : undefined,
  );
  return { pin, cfg };
}

/** argv 에서 이 하네스가 모델을 싣는 자리의 값. */
function modelArg(harness: string, args: string[]): string | undefined {
  if (harness === "claude") {
    const i = args.indexOf("--model");
    return i >= 0 ? args[i + 1] : undefined;
  }
  if (harness === "grok") {
    const i = args.indexOf("-m");
    return i >= 0 ? args[i + 1] : undefined;
  }
  if (harness === "gpt") {
    for (let i = 0; i < args.length - 1; i++) {
      if (args[i] !== "-c") continue;
      const m = /^model="(.*)"$/.exec(args[i + 1]);
      if (m) return m[1];
    }
  }
  return undefined;
}

// ─────────────────────────────────────────────────────────────────────────
// 1) 해석 — 이 id 로 지정하면 제 하네스·제 축으로 간다
// ─────────────────────────────────────────────────────────────────────────
describe("해석 — 모든 활성 모델이 자기 하네스로 해석된다", () => {
  it.each(ACTIVE.map((e) => [e.id, e] as const))("%s", (_id, entry) => {
    const pin = resolveModelPin(entry.id, CLI_OK);
    expect(
      pin,
      `${entry.id} 지정이 해석되지 않는다(조용히 무시되는 행)`,
    ).toBeDefined();
    // ★바이너리는 벤더가 아니라 하네스가 고른다(USbdRV4k). env-swap 행은
    // provider 가 zai/minimax/moonshot 이어도 harness 는 claude 다.
    expect(pin!.harness).toBe(entry.harness);
    expect(pin!.vendor).toBe(entry.provider);
    const axis =
      pin!.claudeModel ?? pin!.codexModel ?? pin!.nativeModel ?? undefined;
    expect(axis, `${entry.id} 이 어느 핀 축에도 실리지 않는다`).toBeDefined();
    // minCli 를 만족하는 버전으로 물었으니 폴백 없이 원본 id 여야 한다.
    expect(axis).toBe(entry.id);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// 2) argv — 유효한 명령줄이 나온다
// ─────────────────────────────────────────────────────────────────────────
describe("argv — 모든 활성 모델이 유효한 launch 를 만든다", () => {
  it.each(ACTIVE.map((e) => [e.id, e] as const))("%s", (_id, entry) => {
    const { cfg } = launchFor(entry);

    // 바이너리: 그 하네스의 CLI 여야 한다. 모델 슬러그가 command 로 새면 ENOENT.
    const base = path.basename(cfg.command).replace(/\.(exe|cmd|bat)$/i, "");
    const expectedBinary = { claude: "claude", gpt: "codex", grok: "grok" }[
      entry.harness as "claude" | "gpt" | "grok"
    ];
    expect(base).toBe(expectedBinary);
    expect(cfg.args.every((a) => typeof a === "string" && a.length > 0)).toBe(
      true,
    );

    // 모델 슬러그가 argv 의 제자리에 정확히 한 번.
    expect(modelArg(entry.harness, cfg.args)).toBe(entry.id);

    // 하네스 고유 필수 플래그가 살아 있다(다른 하네스 플래그가 새지 않는다).
    if (entry.harness === "claude") {
      expect(cfg.args).toContain("--dangerously-skip-permissions");
      expect(cfg.args).toContain("--strict-mcp-config");
      expect(cfg.args).not.toContain("-m");
    }
    if (entry.harness === "grok") {
      expect(cfg.args).toContain("--permission-mode");
      expect(cfg.args).not.toContain("--dangerously-skip-permissions");
      expect(cfg.args).not.toContain("--model");
    }
    if (entry.harness === "gpt") {
      expect(cfg.args).not.toContain("--model");
      expect(cfg.args).not.toContain("-m");
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────
// 3) 사다리 — 자동선택 후보이거나, 이유가 적힌 제외이거나
// ─────────────────────────────────────────────────────────────────────────
describe("사다리 — 죽은 행(영원히 미선택)이 없다", () => {
  it.each(ACTIVE.map((e) => [e.id, e] as const))("%s", (_id, entry) => {
    const ladder = ladderFor(entry.harness);
    const inLadder = !!ladder?.rungs.some((r) => r.model === entry.id);
    const excluded = entry.id in LADDER_EXCLUSIONS;
    expect(
      inLadder || excluded,
      `${entry.id}(harness=${entry.harness}) 는 사다리에도 제외 목록에도 없다 — 레지스트리에만 있고 자동선택은 영원히 못 고르는 죽은 행이다.`,
    ).toBe(true);
    if (excluded) {
      expect(LADDER_EXCLUSIONS[entry.id].length).toBeGreaterThan(20);
    }
  });

  // ★사다리에 있다고 자동선택 후보인 것은 아니다 — codex 축은 모델을 핀하지
  // 않으므로(`pinsModel=false`) 후보가 **상속 모델의 effort 칸**이다. 그 괴리를
  // 침묵시키지 않고 여기서 사실로 못박는다(정책이 바뀌면 이 단언이 먼저 깨진다).
  it("pinsModel 사다리(claude·grok)의 칸은 전부 자동선택 후보다", () => {
    for (const harness of ["claude", "grok"] as const) {
      const ladder = ladderFor(harness)!;
      expect(ladder.pinsModel).toBe(true);
      const candidates = new Set(
        autoCandidates(harness, "standard").candidates.map((c) => c.model),
      );
      for (const rung of ladder.rungs) {
        expect(candidates.has(rung.model), `${harness}/${rung.model}`).toBe(
          true,
        );
      }
    }
  });

  it("★알려진 괴리: gpt 사다리의 3변종은 자동선택 후보가 아니다(pinsModel=false)", () => {
    const ladder = ladderFor("gpt")!;
    expect(ladder.pinsModel).toBe(false);
    expect(ladder.inheritedModel).toBe("gpt-5.5");
    const candidates = new Set(
      autoCandidates("gpt", "standard").candidates.map((c) => c.model),
    );
    // 후보는 사용자 config.toml 이 물고 있는 상속 모델의 effort 칸들뿐이다.
    expect(candidates).toEqual(new Set(["gpt-5.5"]));
    for (const id of ["gpt-5.6-sol", "gpt-5.6-terra", "gpt-5.6-luna"]) {
      expect(candidates.has(id), `${id} 가 자동선택 후보가 됐다`).toBe(false);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────
// 4) 표기 — 스폰 후 화면·텔레메트리가 실제 모델을 말한다
// ─────────────────────────────────────────────────────────────────────────
describe("표기 — argv 를 되읽은 값이 그 모델 id 다", () => {
  it.each(ACTIVE.map((e) => [e.id, e] as const))("%s", (_id, entry) => {
    const { cfg } = launchFor(entry);
    const info = spawnedModelFromArgs(entry.harness as ModelType, cfg.args);
    expect(info.modelId).toBe(entry.id);
    const label = formatModelAtEffort(info)!;
    // ★하네스 이름("claude"/"gpt"/"grok")이 모델 자리에 새면 배지·cost_logs·KG 가
    // 전부 "모델미상" 을 모델인 척 적재한다(단가표에 없어 $0 유령 비용).
    expect(isHarnessFamilyId(label.split("@")[0])).toBe(false);
    expect(label.startsWith(entry.id)).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// 5) 크레덴셜 — env-swap 은 전부-아니면-전무
// ─────────────────────────────────────────────────────────────────────────
describe("크레덴셜 — env-swap 벤더 프로파일", () => {
  const ENV_SWAP = ACTIVE.filter((e) => !!e.envProfile);
  const NATIVE = ACTIVE.filter((e) => !e.envProfile);

  it("env-swap 행은 claude 하네스 + 비네이티브 벤더 + 시크릿 참조를 갖는다", () => {
    expect(ENV_SWAP.length).toBeGreaterThan(0);
    for (const entry of ENV_SWAP) {
      expect(entry.provider).not.toBe(HARNESS_NATIVE_VENDOR[entry.harness]);
      const readiness = vendorEnvReadiness(entry.id);
      expect(readiness.hasProfile).toBe(true);
      expect(readiness.requiredEnvKeys.length).toBeGreaterThan(0);
      // 자리표시자는 값 전체여야 한다(부분보간 = 마스킹 경계 파괴).
      for (const value of Object.values(entry.envProfile!)) {
        if (value.includes("${"))
          expect(vendorEnvSecretRef(value)).toBeTruthy();
      }
    }
  });

  it("네이티브 행은 크레덴셜 조건이 없다(회귀 0)", () => {
    for (const entry of NATIVE) {
      const readiness = vendorEnvReadiness(entry.id);
      expect(readiness.hasProfile).toBe(false);
      expect(readiness.ready).toBe(true);
      const { cfg } = launchFor(entry);
      expect(cfg.env.ANTHROPIC_BASE_URL).toBeUndefined();
      expect(cfg.env.ANTHROPIC_AUTH_TOKEN).toBeUndefined();
    }
  });

  // ★환경에 따라 키가 있을 수도 없을 수도 있다. 그래서 "주입된다/안 된다" 를
  // 고정하지 않고 **불변식**을 검증한다: ready 면 프로파일 전 키가 값으로 채워져
  // 있고, 아니면 **하나도** 없다. 그 사이(부분 주입)가 크레덴셜 유출 상태다.
  it.each(ENV_SWAP.map((e) => [e.id, e] as const))(
    "%s — ready 면 전부, 아니면 전무(부분 주입 없음)",
    (_id, entry) => {
      const readiness = vendorEnvReadiness(entry.id);
      const { cfg } = launchFor(entry);
      const profileKeys = Object.keys(entry.envProfile!);
      const present = profileKeys.filter((k) => k in cfg.env);
      if (readiness.ready) {
        expect(present.sort()).toEqual(profileKeys.sort());
        // 자리표시자가 해석되지 않은 채 CLI 로 나가지 않는다.
        for (const k of profileKeys) expect(cfg.env[k]).not.toMatch(/^\$\{/);
        expect(cfg.env.ANTHROPIC_BASE_URL).toBe(
          entry.envProfile!.ANTHROPIC_BASE_URL,
        );
      } else {
        expect(
          present,
          `${entry.id}: 키가 없는데 ${present.join(",")} 가 주입됐다 — 우리 Anthropic 크레덴셜이 ${entry.provider} 엔드포인트로 나간다`,
        ).toEqual([]);
      }
    },
  );

  it("★키를 지우면 프로파일 전체가 사라진다(주입 결정이 크레덴셜에 달려 있다)", () => {
    const entry = ENV_SWAP[0];
    const keys = vendorEnvReadiness(entry.id).requiredEnvKeys;
    const saved: Record<string, string | undefined> = {};
    for (const k of keys) {
      saved[k] = process.env[k];
      delete process.env[k];
    }
    try {
      expect(vendorEnvReadiness(entry.id).ready).toBe(false);
      // ★캐시를 우회한다 — 이 단언의 요점이 "env 를 바꾸면 결과가 바뀐다" 다.
      const { cfg } = buildLaunch(entry);
      for (const k of Object.keys(entry.envProfile!)) {
        expect(cfg.env[k]).toBeUndefined();
      }
      // 그래도 스폰 자체는 살아 있다(§8.3 "spawn 이 깨지는 것은 불허").
      expect(cfg.args).toContain("--dangerously-skip-permissions");
      expect(modelArg("claude", cfg.args)).toBe(entry.id);
    } finally {
      for (const k of keys) {
        if (saved[k] === undefined) delete process.env[k];
        else process.env[k] = saved[k]!;
      }
    }
  });

  it("모든 키를 채우면 프로파일 전체가 주입된다", () => {
    const entry = ENV_SWAP[0];
    const keys = vendorEnvReadiness(entry.id).requiredEnvKeys;
    const saved: Record<string, string | undefined> = {};
    for (const k of keys) {
      saved[k] = process.env[k];
      process.env[k] = `fixture-${k}`;
    }
    try {
      expect(vendorEnvReadiness(entry.id).ready).toBe(true);
      const { cfg } = buildLaunch(entry);
      for (const [k, v] of Object.entries(entry.envProfile!)) {
        const ref = vendorEnvSecretRef(v);
        expect(cfg.env[k]).toBe(ref ? `fixture-${ref}` : v);
      }
      // 보호 키(MCP 배선)는 벤더 프로파일이 건드리지 못한다.
      expect(cfg.env.MCP_CONFIG_PATH ?? cfg.mcpConfigPath).toBeTruthy();
    } finally {
      for (const k of keys) {
        if (saved[k] === undefined) delete process.env[k];
        else process.env[k] = saved[k]!;
      }
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────
// 6) stale command — 다른 하네스 바이너리가 argv 를 훔치지 못한다
//
// 에이전트 doc 의 `command` 는 모델을 바꿔도 남는다. claude argv 를 grok/codex
// 바이너리에 넘기면 "unknown option" 으로 즉사한다(grok 이 실제로 3번 겪은 버그).
// grok 분기엔 이 가드가 있었고 claude 분기엔 없었다.
// ─────────────────────────────────────────────────────────────────────────
describe("stale command — 낯선 바이너리로 새지 않는다", () => {
  let claudeBinDir: string;
  let savedPath: string | undefined;

  beforeAll(() => {
    // `claude` 해석이 이 기기의 실제 설치본을 찾도록 두되, 없을 때를 대비해
    // 가짜 바이너리를 PATH 앞에 둔다(테스트가 설치 상태에 의존하지 않게).
    claudeBinDir = fs.mkdtempSync(path.join(os.tmpdir(), "marblo-fakebin-"));
    for (const name of ["claude", "codex", "grok"]) {
      const p = path.join(claudeBinDir, name);
      fs.writeFileSync(
        p,
        `#!/bin/sh\nif [ "$1" = "--version" ]; then echo '${name} 9.9.9'; exit 0; fi\nexit 0\n`,
        "utf-8",
      );
      fs.chmodSync(p, 0o755);
    }
    savedPath = process.env.PATH;
    process.env.PATH = `${claudeBinDir}${path.delimiter}${savedPath ?? ""}`;
  });

  afterAll(() => {
    if (savedPath === undefined) delete process.env.PATH;
    else process.env.PATH = savedPath;
    fs.rmSync(claudeBinDir, { recursive: true, force: true });
  });

  const commandFor = (model: ModelType, baseCommand: string): string => {
    const gen = new AgentConfigGenerator();
    return gen.getLaunchConfig(
      {
        id: `stale-${model}-${Math.random().toString(36).slice(2)}`,
        model,
        role: "backend",
        command: baseCommand,
      },
      TMP,
      undefined,
      undefined,
      undefined,
      false,
      "standard",
    ).command;
  };

  it.each([
    ["grok", "claude"],
    ["codex", "claude"],
    ["agy", "claude"],
    ["claude-opus-5", "claude"],
    ["", "claude"],
  ] as const)(
    "claude 에이전트의 stale command=%s → %s 바이너리",
    (stale, expected) => {
      expect(path.basename(commandFor("claude", stale))).toBe(expected);
    },
  );

  it("정상 command='claude' 는 종전 그대로 통과한다(회귀 0)", () => {
    expect(commandFor("claude", "claude")).toBe("claude");
  });

  it("grok 분기의 기존 가드도 그대로다", () => {
    expect(path.basename(commandFor("grok", "claude"))).toBe("grok");
    expect(path.basename(commandFor("grok", "grok-4.5"))).toBe("grok");
  });
});
