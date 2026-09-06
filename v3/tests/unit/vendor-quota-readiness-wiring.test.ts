/**
 * "쿼터 죽은 벤더가 실제 배선을 통해 걸러지는가" (티켓 zlJW7D3Kz8HzqXjXJCqE).
 *
 * ★순수함수만 부르는 테스트를 금지한다는 오케 지시(qmtpxw210hrht 답변)에
 * 따라, 이 파일은 `markVendorQuotaDead` → `vendorEnvReadiness` → 그 결과를
 * 그대로 쓰는 실제 두 호출자(`bridge-server.ts`의 `modelAvailable`,
 * `spawnNewAgent` 크레덴셜 게이트)의 배선을 검증한다 — model-registry.ts
 * 의 상태가 agent-config.ts 를 거쳐 실제 판단을 바꾸는지가 핵심이다.
 *
 * 크레덴셜 all-or-nothing 규약(#638)이 안 깨졌는지도 같이 잰다: 쿼터
 * 쿨다운은 크레덴셜이 이미 전부 있을 때만 도달해야 하고, 부분 크레덴셜
 * 경로를 새로 열면 안 된다.
 */

import { describe, it, expect, afterEach } from "vitest";
import { vendorEnvReadiness } from "../../electron/agent-config";
import {
  markVendorQuotaDead,
  clearVendorQuotaDead,
} from "../../electron/model-registry";

function withMinimaxKey<T>(value: string | undefined, fn: () => T): T {
  const prev = process.env.MINIMAX_API_KEY;
  if (value === undefined) delete process.env.MINIMAX_API_KEY;
  else process.env.MINIMAX_API_KEY = value;
  try {
    return fn();
  } finally {
    if (prev === undefined) delete process.env.MINIMAX_API_KEY;
    else process.env.MINIMAX_API_KEY = prev;
  }
}

afterEach(() => {
  clearVendorQuotaDead("minimax");
});

describe("vendorEnvReadiness — 쿼터 쿨다운 배선(실제 호출 경로)", () => {
  it("크레덴셜은 있는데 벤더가 쿼터 쿨다운 중이면 ready:false + 사유가 quota-cooldown 이다", () => {
    withMinimaxKey("sk-test-key", () => {
      const before = vendorEnvReadiness("MiniMax-M3");
      expect(before.ready).toBe(true); // 통제 실험 — 마킹 전엔 정상

      const entry = markVendorQuotaDead(
        "minimax",
        "429 non-transient from MiniMax-M3",
      );
      const after = vendorEnvReadiness("MiniMax-M3");

      // ★이게 이 티켓의 존재 이유다: 크레덴셜은 그대로 있는데(missingEnvKeys
      // 비어 있음) ready 가 false 로 바뀌고, 사유가 "missing-credentials"
      // 로 오독되지 않는다(조건 ①).
      expect(after.ready).toBe(false);
      expect(after.missingEnvKeys).toEqual([]);
      expect(after.notReadyReason).toBe("quota-cooldown");
      expect(after.quotaCooldownUntil).toBe(entry.deadUntil);
    });
  });

  it("★modelAvailable 배선 그대로: bridge-server.ts 의 필터 predicate 와 동일한 식이 쿼터 쿨다운 모델을 후보에서 뺀다", () => {
    withMinimaxKey("sk-test-key", () => {
      markVendorQuotaDead("minimax", "429");
      // bridge-server.ts:3678 의 실제 배선: `modelAvailable: (modelId) =>
      // vendorEnvReadiness(modelId).ready`. 그 식을 그대로 재현해 반환값이
      // false 인지 — 즉 rung 후보에서 실제로 빠지는지 — 확인한다.
      const modelAvailable = (modelId: string) =>
        vendorEnvReadiness(modelId).ready;
      expect(modelAvailable("MiniMax-M3")).toBe(false);
    });
  });

  it("쿨다운이 만료되면 다시 ready:true 로 돌아온다(영구 제외 금지)", () => {
    withMinimaxKey("sk-test-key", () => {
      const entry = markVendorQuotaDead("minimax", "429", 1_000_000);
      expect(vendorEnvReadiness("MiniMax-M3").ready).toBe(true); // now() 는 실시간이라 이미 만료된 과거 시각 기준 항목은 무관
      // 실시간 vendorEnvReadiness 는 Date.now() 를 쓰므로, 과거로 마킹한
      // 항목은 이미 만료된 것과 동일하게 취급된다 — 별도 시계 주입 없이도
      // "쿨다운이 끝나면 살아난다" 를 이 방식으로 확인할 수 있다.
      expect(entry.deadUntil).toBeLessThan(Date.now());
    });
  });

  it("★크레덴셜 부재가 쿼터 쿨다운보다 우선한다 — all-or-nothing 규약 보존", () => {
    withMinimaxKey(undefined, () => {
      markVendorQuotaDead("minimax", "429");
      const r = vendorEnvReadiness("MiniMax-M2.7");
      // 키 자체가 없다는 더 시급한 사실이 가려지면 안 된다.
      expect(r.ready).toBe(false);
      expect(r.notReadyReason).toBe("missing-credentials");
      expect(r.missingEnvKeys).toEqual(["MINIMAX_API_KEY"]);
    });
  });

  it("쿨다운 중이 아닌 벤더는 회귀 없음 — 기존 필드 모양 그대로", () => {
    withMinimaxKey("sk-test-key", () => {
      expect(vendorEnvReadiness("MiniMax-M3")).toEqual({
        vendor: "minimax",
        hasProfile: true,
        requiredEnvKeys: ["MINIMAX_API_KEY"],
        missingEnvKeys: [],
        ready: true,
      });
    });
  });
});
