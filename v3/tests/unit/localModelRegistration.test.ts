/**
 * 로컬(Ollama) 모델 런타임 등록 → env-swap 스폰 축 편입 (dRalTvhI4HR2NaAcxn4C).
 *
 * 이 파일이 지키는 것:
 *  1. **유령비용 방지** — 등록된 id 만 레지스트리 조회에 잡히고(미등록 id 는
 *     getModel undefined → 핀 불가), 등록 행의 단가는 0/0(로컬 추론은 무과금)이다.
 *  2. **축 접힘** — 등록 행은 {harness:"claude", provider:"local"} 라서
 *     `resolveModelPin` 이 claude 핀으로 해석하고, `applyVendorEnv` 가 Ollama
 *     Anthropic 호환 엔드포인트를 주입한다(PR#608 설계의 (B)형 env-swap 1행).
 *  3. **크레덴셜 안전** — 프로파일에 ANTHROPIC_AUTH_TOKEN 더미가 반드시 있어
 *     우리 Anthropic 크레덴셜이 로컬 엔드포인트로 새지 않고, 보호 키(MARBLO_*)
 *     는 프로파일이 덮지 못한다.
 *  4. **정적 레지스트리 무오염** — 정적 행과 id 가 겹치면 정적 행이 이긴다.
 */
import { describe, it, expect } from "vitest";
import {
  LOCAL_OLLAMA_ENV_PROFILE,
  getModel,
  harnessForModel,
  vendorForModel,
  envProfileForModel,
  registerLocalOllamaModels,
  registeredLocalOllamaModelIds,
} from "../../electron/model-registry";
import {
  applyVendorEnv,
  vendorEnvReadiness,
} from "../../electron/agent-config";
import { resolveModelPin } from "../../electron/model-selection";

describe("registerLocalOllamaModels (유령비용 방지)", () => {
  it("★미등록 id 는 레지스트리가 모른다 — 핀 불가가 기본값이다", () => {
    expect(getModel("not-pulled:0.5b")).toBeUndefined();
    expect(resolveModelPin("not-pulled:0.5b")).toBeUndefined();
  });

  it("등록된 id 는 claude 하네스 · local 벤더 · 0 단가 행이 된다", () => {
    registerLocalOllamaModels(["qwen2.5:0.5b"]);
    const entry = getModel("qwen2.5:0.5b");
    expect(entry).toBeDefined();
    expect(entry?.harness).toBe("claude");
    expect(entry?.provider).toBe("local");
    expect(entry?.pricing).toEqual({ inputPer1M: 0, outputPer1M: 0 });
    expect(harnessForModel("qwen2.5:0.5b")).toBe("claude");
    expect(vendorForModel("qwen2.5:0.5b")).toBe("local");
    expect(registeredLocalOllamaModelIds()).toContain("qwen2.5:0.5b");
  });

  it("재등록은 멱등이고, 빈/공백 id 는 무시된다", () => {
    registerLocalOllamaModels(["qwen2.5:0.5b", "", "  "]);
    registerLocalOllamaModels(["qwen2.5:0.5b"]);
    expect(
      registeredLocalOllamaModelIds().filter((id) => id === "qwen2.5:0.5b"),
    ).toHaveLength(1);
    expect(registeredLocalOllamaModelIds()).not.toContain("");
  });

  it("★정적 레지스트리 행과 id 가 겹치면 정적 행이 이긴다(검증 사실 무오염)", () => {
    const before = getModel("claude-opus-5");
    expect(before).toBeDefined();
    registerLocalOllamaModels(["claude-opus-5"]);
    const after = getModel("claude-opus-5");
    expect(after).toBe(before);
    expect(after?.provider).toBe("anthropic");
    expect(registeredLocalOllamaModelIds()).not.toContain("claude-opus-5");
  });
});

describe("등록 행의 env-swap 접힘 (스폰 축)", () => {
  it("resolveModelPin 이 claude 핀 + local 벤더로 해석한다", () => {
    registerLocalOllamaModels(["llama3.2:1b"]);
    // installedClaudeVersion 명시 → 테스트 환경에서 바이너리 프로브를 타지 않는다.
    const pin = resolveModelPin("llama3.2:1b", "2.1.220");
    expect(pin?.harness).toBe("claude");
    expect(pin?.vendor).toBe("local");
    expect(pin?.claudeModel).toBe("llama3.2:1b");
  });

  it("★프로파일은 BASE_URL + 더미 AUTH_TOKEN 세트다(빈 토큰 = 크레덴셜 유출)", () => {
    expect(LOCAL_OLLAMA_ENV_PROFILE.ANTHROPIC_BASE_URL).toMatch(
      /^http:\/\/localhost:11434$/,
    );
    expect(LOCAL_OLLAMA_ENV_PROFILE.ANTHROPIC_AUTH_TOKEN).toBeTruthy();
    registerLocalOllamaModels(["gemma2:2b"]);
    expect(envProfileForModel("gemma2:2b")).toEqual(LOCAL_OLLAMA_ENV_PROFILE);
  });

  it("시크릿 참조가 없으므로 크레덴셜 게이트는 항상 ready 다", () => {
    registerLocalOllamaModels(["phi3:mini"]);
    const readiness = vendorEnvReadiness("phi3:mini");
    expect(readiness.vendor).toBe("local");
    expect(readiness.hasProfile).toBe(true);
    expect(readiness.requiredEnvKeys).toEqual([]);
    expect(readiness.ready).toBe(true);
  });

  it("applyVendorEnv 가 Ollama 엔드포인트를 주입하되 보호 키는 못 덮는다", () => {
    registerLocalOllamaModels(["qwen2.5:1.5b"]);
    const base = {
      MARBLO_PROJECT: "p-1",
      PATH: "/usr/bin",
    };
    const merged = applyVendorEnv(base, "qwen2.5:1.5b");
    expect(merged.ANTHROPIC_BASE_URL).toBe("http://localhost:11434");
    expect(merged.ANTHROPIC_AUTH_TOKEN).toBe(
      LOCAL_OLLAMA_ENV_PROFILE.ANTHROPIC_AUTH_TOKEN,
    );
    // 배선 보호: MCP 브리지·PATH 는 벤더 프로파일이 덮을 수 없다.
    expect(merged.MARBLO_PROJECT).toBe("p-1");
    expect(merged.PATH).toBe("/usr/bin");
  });

  it("미등록 id 는 applyVendorEnv 가 base 를 그대로 돌려준다(참조 동일)", () => {
    const base = { MARBLO_PROJECT: "p-1" };
    expect(applyVendorEnv(base, "ghost:9b")).toBe(base);
  });
});
