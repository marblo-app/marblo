/**
 * §5.6 test 3 — default-deny (§5.2 P1 의 실행 가능한 계약).
 * 분류가 지정되지 않은 새 필드/이벤트타입은 자동으로 private 이며, 어떤
 * 등급에서도 출력에 포함되지 않는다.
 */
import { describe, it, expect } from "vitest";
import { redact } from "../../../src/lib/redact/redact";
import { classifyField } from "../../../src/lib/redact/rules";
import type { RedactLevel } from "../../../src/types/redact";

const LEVELS: RedactLevel[] = ["L1", "L2", "L3"];

describe("default-deny", () => {
  it("classifier returns private for unknown keys", () => {
    expect(classifyField("someBrandNewField")).toBe("private");
    expect(classifyField("quantumFluxData")).toBe("private");
    expect(classifyField("")).toBe("private");
  });

  for (const level of LEVELS) {
    it(`${level}: unclassified fields never reach the output`, () => {
      const input = {
        status: "ok",
        someBrandNewField: "sk-ant-api03-Zz9Yy8Xx7Ww6Vv5Uu4Tt3Ss2Rr1",
        harmlessButUnknown: "just a plain sentence",
        newNestedContainer: {
          innerSecretishThing: "AKIAIOSFODNN7EXAMPLE",
          innerPlain: 42,
        },
      };
      const { payload } = redact(input, { level });
      const serialized = JSON.stringify(payload);
      expect(serialized).toContain('"status":"ok"');
      expect(serialized).not.toContain("someBrandNewField");
      expect(serialized).not.toContain("harmlessButUnknown");
      expect(serialized).not.toContain("plain sentence");
      expect(serialized).not.toContain("newNestedContainer");
      expect(serialized).not.toContain("AKIA");
      expect(serialized).not.toContain("sk-ant");
    });
  }

  it("fake new event type value passes only through known-safe fields", () => {
    const input = {
      eventType: "totally_new_event_type_v99",
      payloadOfNewEvent: { anything: "leaks?" },
    };
    const { payload } = redact(input, { level: "L3" });
    const serialized = JSON.stringify(payload);
    expect(serialized).toContain("totally_new_event_type_v99"); // eventType 은 분류된 안전 스칼라
    expect(serialized).not.toContain("payloadOfNewEvent"); // 컨테이너는 미분류 → private
    expect(serialized).not.toContain("leaks?");
  });

  it("depth bomb fails closed (beyond MAX_DEPTH everything is dropped)", () => {
    let deep: Record<string, unknown> = {
      title: "sk-ant-api03-Qq1Ww2Ee3Rr4Tt5Yy6Uu7Ii8Oo9",
    };
    for (let i = 0; i < 30; i += 1) {
      deep = { steps: deep }; // steps 는 structuredSafe → pass → 재귀
    }
    const { payload } = redact(deep, { level: "L3" });
    expect(JSON.stringify(payload)).not.toContain("sk-ant");
  });
});
