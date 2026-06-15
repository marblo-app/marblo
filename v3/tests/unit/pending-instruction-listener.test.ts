import { describe, expect, it } from "vitest";
import { claimDeliveryOnce } from "../../electron/pending-instruction-listener";

describe("claimDeliveryOnce — in-process deliver-once guard", () => {
  it("true on first sight, false thereafter (재주입 0)", () => {
    const seen = new Set<string>();
    expect(claimDeliveryOnce(seen, "doc1")).toBe(true);
    expect(claimDeliveryOnce(seen, "doc1")).toBe(false);
    expect(claimDeliveryOnce(seen, "doc1")).toBe(false);
  });

  it("independent ids each deliver once", () => {
    const seen = new Set<string>();
    expect(claimDeliveryOnce(seen, "a")).toBe(true);
    expect(claimDeliveryOnce(seen, "b")).toBe(true);
    expect(claimDeliveryOnce(seen, "a")).toBe(false);
    expect(claimDeliveryOnce(seen, "b")).toBe(false);
  });

  it("simulates re-attach initial-snapshot replay → no re-injection", () => {
    // 에이전트 재시작: 같은 미전달 doc 집합이 두 번의 attach 초기 스냅샷에 재방출돼도
    // 각 doc 은 정확히 1회만 전달돼야 한다.
    const seen = new Set<string>();
    const initialSnapshot = ["i1", "i2", "i3"];
    const firstAttach = initialSnapshot.filter((id) =>
      claimDeliveryOnce(seen, id),
    );
    const secondAttach = initialSnapshot.filter((id) =>
      claimDeliveryOnce(seen, id),
    );
    expect(firstAttach).toEqual(["i1", "i2", "i3"]);
    expect(secondAttach).toEqual([]);
  });

  it("FIFO-evicts oldest beyond max so the set stays bounded", () => {
    const seen = new Set<string>();
    // max=2: 세 번째를 넣으면 가장 오래된(첫) id 가 밀려난다.
    expect(claimDeliveryOnce(seen, "x", 2)).toBe(true);
    expect(claimDeliveryOnce(seen, "y", 2)).toBe(true);
    expect(claimDeliveryOnce(seen, "z", 2)).toBe(true);
    expect(seen.size).toBe(2);
    expect(seen.has("x")).toBe(false); // evicted
    expect(seen.has("y")).toBe(true);
    expect(seen.has("z")).toBe(true);
    // 밀려난 id 는 다시 true 가 될 수 있다 — durable 가드는 Firestore isDelivered.
    expect(claimDeliveryOnce(seen, "x", 2)).toBe(true);
  });
});
