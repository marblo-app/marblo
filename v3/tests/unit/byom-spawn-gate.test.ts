/**
 * ★BYOM 관문 (He6nTg00dO2iTvA6ZmGg) — 스폰/오케 auth 게이트의 **인증 축** 교정.
 *
 * 증명해야 하는 것:
 *
 *  (1) **env-swap 벤더의 인증 축은 Anthropic 계정이 아니다.** GLM/MiniMax/Kimi 는
 *      우리 `claude` 바이너리로 뜨지만 붙는 백엔드가 Anthropic 이 아니므로, 그
 *      스폰의 준비 여부는 벤더 크레덴셜이 답한다. 종전 게이트는 이 스폰을
 *      `claudeAuthenticatedSync` 로 판정해 **Claude 계정 없는 BYOM 유저가 벤더 키를
 *      다 넣고도 스폰조차 못 했다**.
 *  (2) **미준비는 차단한다.** 부분 주입 금지(전부-아니면-전무) 규율 때문에 키가
 *      하나라도 없으면 프로파일이 통째로 안 얹히고, 그러면 우리 Anthropic
 *      크레덴셜을 든 claude 가 `--model glm-4.7` 로 Anthropic 에 붙는다(조용한 쿼터
 *      소모). Anthropic 계정이 **있어도** 막는 게 정답이다.
 *  (3) **회귀 0** — 핀이 없거나 네이티브 벤더 핀이면 종전 프로브 경로 그대로다.
 *  (4) **오케 축**: grok(네이티브 CLI, 자체 auth)은 오케로 지정 가능, env-swap 은
 *      여전히 불가(오케 선택은 프로젝트별 영구 저장이라 조건부 크레덴셜 금지 —
 *      `selectorEligible` 의 확정 결정).
 *  (5) **시크릿 비노출** — 차단 메시지에 담기는 것은 env 키 **이름**뿐이다.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as actualFs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { vendorEnvReadiness } from "../../electron/agent-config";
import {
  normalizeOrchestratorModelSetting,
  orchestratorModelTypeForSetting,
  ORCHESTRATOR_HARNESS_SETTINGS,
} from "../../electron/model-selection";
import { getModel, HARNESS_NATIVE_VENDOR } from "../../electron/model-registry";

// ── 게이트 로딩 하네스(harness-spawn-gate.test.ts 와 동일한 격리 홈) ──────────
function makeHome(): string {
  return actualFs.realpathSync(
    actualFs.mkdtempSync(path.join(os.tmpdir(), "marblo-byom-gate-")),
  );
}

function touchFakeBinary(
  home: string,
  binary: "claude" | "codex" | "grok",
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
    // macKeychainHasClaudeCreds 의 `security` 프로브는 항상 "없음"(exit 1) 으로
    // 답한다 — 이 테스트의 관심은 벤더 축이지 실제 키체인이 아니다.
    const spawn = vi.fn(() => {
      const child = new EventEmitter() as ReturnType<
        typeof import("node:child_process").spawn
      >;
      child.stdout = new EventEmitter() as typeof child.stdout;
      child.stderr = new EventEmitter() as typeof child.stderr;
      child.kill = vi.fn() as typeof child.kill;
      queueMicrotask(() => child.emit("close", 1));
      return child;
    });
    return {
      spawn,
      execFileSync: vi.fn(() => ""),
      default: { spawn, execFileSync: vi.fn(() => "") },
    };
  });
  return await import("../../electron/harness-manager");
}

/**
 * 이 테스트가 만지는 env 전부. 벤더 키 이름은 **레지스트리에서 파생**한다 —
 * 여기 리터럴로 적으면 레지스트리가 키 이름을 바꿔도 테스트가 통과해 버린다.
 */
const ENV_SWAP_MODELS = ["glm-4.7", "MiniMax-M3", "kimi-for-coding"] as const;
const VENDOR_ENV_KEYS = [
  ...new Set(
    ENV_SWAP_MODELS.flatMap((id) => vendorEnvReadiness(id).requiredEnvKeys),
  ),
];
const TOUCHED_ENV = [
  "ANTHROPIC_API_KEY",
  "ANTHROPIC_AUTH_TOKEN",
  "OPENAI_API_KEY",
  "XAI_API_KEY",
  ...VENDOR_ENV_KEYS,
];

describe("BYOM 스폰 게이트 — env-swap 벤더의 인증 축", () => {
  let saved: Record<string, string | undefined>;
  let home: string;

  beforeEach(() => {
    saved = Object.fromEntries(TOUCHED_ENV.map((k) => [k, process.env[k]]));
    for (const k of TOUCHED_ENV) delete process.env[k];
    home = makeHome();
  });

  afterEach(() => {
    for (const k of TOUCHED_ENV) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k]!;
    }
    actualFs.rmSync(home, { recursive: true, force: true });
    vi.doUnmock("os");
    vi.doUnmock("fs");
    vi.doUnmock("child_process");
    vi.resetModules();
  });

  it("레지스트리 전제: 세 env-swap 행이 claude 하네스 + 비-Anthropic 벤더다", () => {
    for (const id of ENV_SWAP_MODELS) {
      const entry = getModel(id);
      expect(entry, `레지스트리에 ${id} 행이 없다`).toBeTruthy();
      expect(entry!.harness).toBe("claude");
      expect(entry!.provider).not.toBe(HARNESS_NATIVE_VENDOR[entry!.harness]);
      expect(vendorEnvReadiness(id).requiredEnvKeys.length).toBeGreaterThan(0);
    }
  });

  it.each(ENV_SWAP_MODELS)(
    "크레덴셜 준비됨(%s) → Claude 계정 없이도 스폰 허용",
    async (modelId) => {
      touchFakeBinary(home, "claude");
      for (const key of vendorEnvReadiness(modelId).requiredEnvKeys) {
        process.env[key] = "test-vendor-key";
      }
      const { checkSpawnAuthGate } = await loadGateWithFakeHome(home);
      const gate = await checkSpawnAuthGate("claude", modelId);
      // ★ANTHROPIC_* 는 하나도 없다 — 종전 게이트라면 여기서 차단됐다.
      expect(gate.ok).toBe(true);
      expect(gate.vendor).toBe(getModel(modelId)!.provider);
      expect(gate.reason).toBeUndefined();
    },
  );

  it.each(ENV_SWAP_MODELS)(
    "크레덴셜 미준비(%s) → Anthropic 계정이 있어도 차단(부분 주입 금지)",
    async (modelId) => {
      touchFakeBinary(home, "claude");
      process.env.ANTHROPIC_API_KEY = "sk-ant-live-secret";
      const { checkSpawnAuthGate } = await loadGateWithFakeHome(home);
      const gate = await checkSpawnAuthGate("claude", modelId);
      expect(gate.ok).toBe(false);
      expect(gate.reason).toBe("vendor-not-configured");
      expect(gate.installed).toBe(true);
      expect(gate.vendor).toBe(getModel(modelId)!.provider);
      expect(gate.missingEnvKeys).toEqual(
        vendorEnvReadiness(modelId).requiredEnvKeys,
      );
      // 안내에는 키 **이름**만 — 값(시크릿)은 절대 담기지 않는다.
      for (const key of gate.missingEnvKeys!) {
        expect(gate.action).toContain(key);
      }
      expect(gate.action).not.toContain("sk-ant-live-secret");
    },
  );

  it("키가 일부만 있으면 여전히 차단한다(전부-아니면-전무)", async () => {
    const required = vendorEnvReadiness("glm-4.7").requiredEnvKeys;
    // 이 벤더는 시크릿 참조가 하나뿐이라 '일부만' 을 만들려면 빈 문자열이 필요하다.
    // 빈 값은 "설정됨" 이 아니다(vendor-secrets 불변식 4).
    for (const key of required) process.env[key] = "   ";
    touchFakeBinary(home, "claude");
    const { checkSpawnAuthGate } = await loadGateWithFakeHome(home);
    const gate = await checkSpawnAuthGate("claude", "glm-4.7");
    expect(gate.ok).toBe(false);
    expect(gate.reason).toBe("vendor-not-configured");
  });

  it("벤더 키가 다 있어도 claude 바이너리가 없으면 차단한다", async () => {
    for (const key of vendorEnvReadiness("glm-4.7").requiredEnvKeys) {
      process.env[key] = "test-vendor-key";
    }
    const { checkSpawnAuthGate } = await loadGateWithFakeHome(home);
    const gate = await checkSpawnAuthGate("claude", "glm-4.7");
    // env-swap 벤더도 결국 우리 claude 바이너리로 뜬다.
    expect(gate.ok).toBe(false);
    expect(gate.reason).toBe("not-installed");
    expect(gate.action).toBe("curl -fsSL https://claude.ai/install.sh | bash");
  });

  it("하네스가 어긋난 핀은 벤더 판정에서 제외한다(스폰 쪽도 그 핀을 버린다)", async () => {
    touchFakeBinary(home, "codex");
    for (const key of vendorEnvReadiness("glm-4.7").requiredEnvKeys) {
      process.env[key] = "test-vendor-key";
    }
    const { checkSpawnAuthGate } = await loadGateWithFakeHome(home);
    // claude 하네스 행(glm-4.7)을 codex 스폰에 핀했다 → 벤더 축으로 통과시키면
    // "인증은 GLM 으로 판정, 스폰은 codex" 라는 어긋남이 된다.
    const gate = await checkSpawnAuthGate("gpt", "glm-4.7");
    expect(gate.ok).toBe(false);
    expect(gate.reason).toBe("not-authenticated");
    expect(gate.vendor).toBeUndefined();
  });

  it("네이티브 벤더 핀·핀 없음은 종전 경로 그대로다(회귀 0)", async () => {
    touchFakeBinary(home, "claude");
    const { checkSpawnAuthGate } = await loadGateWithFakeHome(home);
    // 로그인 안 된 상태: 핀 유무와 무관하게 종전대로 차단된다.
    for (const pin of [undefined, "claude-opus-5"]) {
      const blocked = await checkSpawnAuthGate("claude", pin);
      expect(blocked).toEqual({
        ok: false,
        model: "claude",
        installed: true,
        authenticated: false,
        action: "claude login",
        reason: "not-authenticated",
      });
    }
    process.env.ANTHROPIC_API_KEY = "test-key";
    for (const pin of [undefined, "claude-opus-5"]) {
      const allowed = await checkSpawnAuthGate("claude", pin);
      expect(allowed).toEqual({
        ok: true,
        model: "claude",
        installed: true,
        authenticated: true,
      });
    }
  });

  it("게이트 없는 하네스는 핀이 있어도 그대로 통과한다", async () => {
    const { checkSpawnAuthGate } = await loadGateWithFakeHome(home);
    await expect(checkSpawnAuthGate("antigravity", "glm-4.7")).resolves.toEqual(
      {
        ok: true,
        model: null,
        installed: true,
        authenticated: true,
      },
    );
  });
});

describe("오케 모델 설정 정규화 — grok 편입 / env-swap 미편입", () => {
  it("grok 은 오케 후보다(더 이상 claude 로 강등되지 않는다)", () => {
    expect(normalizeOrchestratorModelSetting("grok")).toBe("grok");
    expect(normalizeOrchestratorModelSetting(" GROK ")).toBe("grok");
    expect(orchestratorModelTypeForSetting("grok")).toBe("grok");
  });

  it("★grok 모델 핀은 살아남는다 — launch 옵션에 grok 축이 있다", () => {
    // 2026-08-20(티켓 6AsbulPe)에 열렸다. 근거는 취향이 아니라 배선이다:
    // `orchestratorLaunchPin` 의 grok 분기(`nativeModel`) → main.ts 오케 launch 의
    // `nativeModelOverride` → `buildCLICommand` 의 `-m`. 그 분기가 들어온 뒤에도
    // 이 함수만 접미를 버리고 있어서, 셀렉터가 세워도 저장 직전에 잘려 나갔다.
    for (const id of ["grok-4.6", "grok-4.5"]) {
      expect(normalizeOrchestratorModelSetting(`grok:${id}`)).toBe(
        `grok:${id}`
      );
      expect(orchestratorModelTypeForSetting(`grok:${id}`)).toBe("grok");
    }
    // effort 축은 여전히 없다 — argv 에 `--reasoning-effort` 를 안 붙이므로
    // 접미 effort 는 버려진다(레지스트리 grok 행의 `efforts: []`).
    expect(normalizeOrchestratorModelSetting("grok:grok-4.6@high")).toBe(
      "grok:grok-4.6"
    );
    // 레지스트리에 없는 id 는 그대로 강등된다(오타·옛 빌드 저장값).
    expect(normalizeOrchestratorModelSetting("grok:grok-9.9")).toBe("grok");
  });

  it("antigravity 는 아직 모델 핀 축이 없어 접미를 버린다", () => {
    // 레지스트리에 antigravity 행 자체가 없다 → 접미가 살아남을 근거가 없다.
    expect(normalizeOrchestratorModelSetting("antigravity:agy-1")).toBe(
      "antigravity"
    );
    expect(orchestratorModelTypeForSetting("antigravity:agy-1")).toBe(
      "antigravity"
    );
  });

  it("★env-swap 벤더는 오케 후보가 아니다 — 손편집/옛 저장값도 강등된다", () => {
    for (const id of ["glm-4.7", "MiniMax-M3", "kimi-for-coding"]) {
      expect(normalizeOrchestratorModelSetting(`claude:${id}`)).toBe("claude");
      expect(orchestratorModelTypeForSetting(`claude:${id}`)).toBe("claude");
    }
    // 하네스 자리에 벤더 이름을 적은 값도 마찬가지(후보 목록에 없다).
    expect(normalizeOrchestratorModelSetting("zai")).toBe("claude");
    expect(normalizeOrchestratorModelSetting("minimax")).toBe("claude");
  });

  it("오케 후보 목록은 네이티브 CLI(자기 auth)만이다", () => {
    expect([...ORCHESTRATOR_HARNESS_SETTINGS]).toEqual([
      "claude",
      "codex",
      "grok",
      "antigravity",
    ]);
  });

  it("claude/codex 경로는 종전과 바이트 동일하다(회귀 0)", () => {
    expect(normalizeOrchestratorModelSetting("")).toBe("claude");
    expect(normalizeOrchestratorModelSetting(undefined)).toBe("claude");
    expect(normalizeOrchestratorModelSetting("weird")).toBe("claude");
    expect(normalizeOrchestratorModelSetting("codex")).toBe("codex");
    expect(normalizeOrchestratorModelSetting("gpt")).toBe("codex");
    expect(normalizeOrchestratorModelSetting("claude:claude-opus-5")).toBe(
      "claude:claude-opus-5",
    );
    // 하네스와 어긋난 핀은 종전대로 접미만 버린다.
    expect(normalizeOrchestratorModelSetting("claude:gpt-5.6-terra")).toBe(
      "claude",
    );
    expect(orchestratorModelTypeForSetting("codex")).toBe("gpt");
    expect(orchestratorModelTypeForSetting("antigravity")).toBe("antigravity");
  });
});
