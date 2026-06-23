import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  resolveOrchestratorModel,
  orchestratorCommandForModel,
  DEFAULT_ORCHESTRATOR_MODEL,
} from "../../electron/agent-config";

// 오케스트레이터 부팅 모델 추상화 — MARBLO_ORCHESTRATOR_MODEL env.
// 절대기준: 기본값 claude = 현 동작 0 변화. "codex"→"gpt" 정규화, 미지원→claude+경고.
describe("orchestrator-model resolver", () => {
  const KEY = "MARBLO_ORCHESTRATOR_MODEL";
  let saved: string | undefined;
  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    saved = process.env[KEY];
    delete process.env[KEY];
    warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
  });
  afterEach(() => {
    if (saved === undefined) delete process.env[KEY];
    else process.env[KEY] = saved;
    vi.restoreAllMocks();
  });

  // ── resolveOrchestratorModel ─────────────────────────────────
  describe("resolveOrchestratorModel", () => {
    it("env 미설정 → claude (무회귀 기본값)", () => {
      expect(resolveOrchestratorModel()).toBe("claude");
      expect(warnSpy).not.toHaveBeenCalled();
    });

    it("빈 문자열/공백 → claude, 경고 없음", () => {
      process.env[KEY] = "   ";
      expect(resolveOrchestratorModel()).toBe("claude");
      expect(warnSpy).not.toHaveBeenCalled();
    });

    it("기본 상수도 claude", () => {
      expect(DEFAULT_ORCHESTRATOR_MODEL).toBe("claude");
    });

    it('명시적 "claude" → claude', () => {
      process.env[KEY] = "claude";
      expect(resolveOrchestratorModel()).toBe("claude");
      expect(warnSpy).not.toHaveBeenCalled();
    });

    it('"codex" → gpt 로 정규화 (기존 내부 네이밍)', () => {
      process.env[KEY] = "codex";
      expect(resolveOrchestratorModel()).toBe("gpt");
      expect(warnSpy).not.toHaveBeenCalled();
    });

    it('"gpt" 도 그대로 gpt', () => {
      process.env[KEY] = "gpt";
      expect(resolveOrchestratorModel()).toBe("gpt");
    });

    it('"local" → local', () => {
      process.env[KEY] = "local";
      expect(resolveOrchestratorModel()).toBe("local");
      expect(warnSpy).not.toHaveBeenCalled();
    });

    it("antigravity/custom 도 통과", () => {
      process.env[KEY] = "antigravity";
      expect(resolveOrchestratorModel()).toBe("antigravity");
      process.env[KEY] = "custom";
      expect(resolveOrchestratorModel()).toBe("custom");
    });

    it("대소문자/주변 공백 정규화", () => {
      process.env[KEY] = "  CODEX  ";
      expect(resolveOrchestratorModel()).toBe("gpt");
      process.env[KEY] = "Claude";
      expect(resolveOrchestratorModel()).toBe("claude");
    });

    it("미지원 값 → claude 폴백 + console.warn", () => {
      process.env[KEY] = "banana";
      expect(resolveOrchestratorModel()).toBe("claude");
      expect(warnSpy).toHaveBeenCalledOnce();
    });

    it("gemini(소프트 제거)는 미지원 취급 → claude 폴백 + 경고", () => {
      process.env[KEY] = "gemini";
      expect(resolveOrchestratorModel()).toBe("claude");
      expect(warnSpy).toHaveBeenCalledOnce();
    });
  });

  // ── orchestratorCommandForModel ──────────────────────────────
  describe("orchestratorCommandForModel", () => {
    it('claude → "claude" 리터럴 (byte-identical 보장)', () => {
      expect(orchestratorCommandForModel("claude")).toBe("claude");
    });
    it("gpt → codex, antigravity → agy (MODEL_BINARY 재사용)", () => {
      expect(orchestratorCommandForModel("gpt")).toBe("codex");
      expect(orchestratorCommandForModel("antigravity")).toBe("agy");
    });
    it("local/custom → 모델명 그대로 (관리 바이너리 없음)", () => {
      expect(orchestratorCommandForModel("local")).toBe("local");
      expect(orchestratorCommandForModel("custom")).toBe("custom");
    });
  });
});
