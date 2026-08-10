/**
 * 라우팅 shadow — 클라이언트 절반 (티켓 6LH4Y1GC7xeWA94pW3Ar).
 *
 * ★이 파일이 지키는 불변식:
 *   1. **행동 변경 0** — shadow 요청을 만드는 것이 `selectAutoModel` 의 결과를
 *      바꾸지 않는다. 순서(결정 → 관측)가 코드가 아니라 테스트로도 못 박힌다.
 *   2. **로컬 정답이 특징에 새지 않는다** — `features` 에 `plannedModelKey`
 *      계열 키가 하나도 없어야 한다. 새면 클라우드 일치율이 자기충족이 된다.
 *   3. **자유입력이 안 실린다** — 태그 문자열·프롬프트·경로가 페이로드에 없다.
 */
import { describe, it, expect, beforeEach } from "vitest";
import {
  ROUTING_SHADOW_SCHEMA_VERSION,
  buildShadowRequest,
  routingShadowEnabled,
} from "../../electron/routing-shadow";
import {
  resetAutoSelectRotation,
  selectAutoModel,
} from "../../electron/model-autoselect";
import type { GraphContext } from "../../electron/routing-graph";

const ctx: GraphContext = {
  role: "backend",
  complexity: "standard",
  taskType: "feature",
  tags: [],
};

function plan(tier: "simple" | "standard" | "complex" = "standard") {
  return selectAutoModel({
    harness: "claude",
    tier,
    ctx: { ...ctx, complexity: tier },
    graph: null,
    budgetUsedPercent: 20,
    epsilon: 0,
    diversityCoefficient: 0,
    random: () => 0.99,
  });
}

describe("buildShadowRequest", () => {
  beforeEach(() => resetAutoSelectRotation());

  it("자동선택이 없으면(명시 핀·사다리 없음) null — 비교 대상이 없다", () => {
    expect(buildShadowRequest({ plan: null, tier: "standard" })).toBeNull();
    expect(
      buildShadowRequest({ plan: undefined, tier: "standard" }),
    ).toBeNull();
  });

  it("티어가 없으면 null — 난도적합 축을 지어내지 않는다", () => {
    expect(buildShadowRequest({ plan: plan(), tier: undefined })).toBeNull();
  });

  it("사다리 칸을 **사다리 순서**로 싣는다(점수 순서는 로컬 판단의 누설)", () => {
    const req = buildShadowRequest({ plan: plan(), tier: "standard" });
    expect(req).not.toBeNull();
    const idx = req!.features.rungs.map((r) => r.index);
    expect(idx).toEqual([...idx].sort((a, b) => a - b));
    expect(req!.features.rungs.length).toBeGreaterThan(1);
    expect(req!.features.schemaVersion).toBe(ROUTING_SHADOW_SCHEMA_VERSION);
  });

  it("★features 에 로컬 결정이 새지 않는다", () => {
    const req = buildShadowRequest({ plan: plan(), tier: "standard" });
    const keys = Object.keys(req!.features);
    for (const leak of [
      "plannedModelKey",
      "localModelKey",
      "selectedModel",
      "modelKey",
      "decidedBy",
      "mode",
      "scores",
    ]) {
      expect(keys).not.toContain(leak);
    }
    // 로컬 선택은 features 바깥의 별도 필드로만 존재한다(서버가 추천 뒤에 쓴다).
    expect(req!.localModelKey).toBeTruthy();
  });

  it("★자유입력을 싣지 않는다 — 태그는 개수만", () => {
    const req = buildShadowRequest({
      plan: plan(),
      tier: "standard",
      role: "backend",
      taskType: "feature",
      tagCount: 3,
    });
    const json = JSON.stringify(req);
    expect(req!.features.tagCount).toBe(3);
    expect(json).not.toContain("tags");
    expect(json).not.toContain("prompt");
    expect(json).not.toContain("instruction");
    expect(json).not.toContain("cwd");
  });

  it("진입칸 위치를 사다리 index 로 싣는다", () => {
    const p = plan();
    const req = buildShadowRequest({ plan: p, tier: "standard" });
    const entry = req!.features.rungs.find(
      (r) => r.modelKey === p!.entryModelKey,
    );
    expect(entry).toBeTruthy();
    expect(req!.features.entryIndex).toBe(entry!.index);
  });

  it("단가는 레지스트리에 있을 때만 — 0 을 지어내지 않는다", () => {
    const req = buildShadowRequest({ plan: plan(), tier: "standard" });
    for (const rung of req!.features.rungs) {
      if (rung.costIndex !== undefined)
        expect(rung.costIndex).toBeGreaterThan(0);
    }
  });

  it("★행동 변경 0 — shadow 를 만들어도 로컬 결정이 그대로다", () => {
    resetAutoSelectRotation();
    const before = plan();
    resetAutoSelectRotation();
    const after = plan();
    buildShadowRequest({ plan: after, tier: "standard" });
    expect(after!.modelKey).toBe(before!.modelKey);
    expect(after!.mode).toBe(before!.mode);
    expect(after!.scores).toEqual(before!.scores);
  });
});

describe("routingShadowEnabled", () => {
  it("미설정은 켜짐(Number('')===0 함정 회피)", () => {
    expect(routingShadowEnabled(undefined)).toBe(true);
    expect(routingShadowEnabled("")).toBe(true);
    expect(routingShadowEnabled("   ")).toBe(true);
  });

  it("명시적 끄기만 끈다", () => {
    expect(routingShadowEnabled("0")).toBe(false);
    expect(routingShadowEnabled("false")).toBe(false);
    expect(routingShadowEnabled("FALSE")).toBe(false);
    expect(routingShadowEnabled("1")).toBe(true);
  });
});
