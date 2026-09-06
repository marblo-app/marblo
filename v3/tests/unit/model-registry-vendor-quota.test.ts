/**
 * 벤더 쿼터 쿨다운 회귀 (티켓 zlJW7D3Kz8HzqXjXJCqE).
 *
 * 실측 사고: MiniMax(env-swap 벤더) 크레덴셜은 있었는데 벤더 자신의 Token
 * Plan 구독 쿼터가 첫 요청부터 429(non-transient)로 거절했다. 크레덴셜
 * 존재/부재(`vendorEnvReadiness`)는 이 사고를 못 잡는다 — 이 레지스트리는
 * "쿼터 생사"라는 독립 축을 담는다.
 */

import { describe, it, expect, beforeEach } from "vitest";
import {
  markVendorQuotaDead,
  vendorQuotaDeadEntry,
  isVendorQuotaDead,
  listVendorQuotaDead,
  clearVendorQuotaDead,
} from "../../electron/model-registry";

describe("벤더 쿼터 쿨다운", () => {
  beforeEach(() => {
    clearVendorQuotaDead("minimax");
    clearVendorQuotaDead("zai");
  });

  it("marking 직후에는 그 벤더가 죽음으로 판정된다", () => {
    const now = 1_000_000;
    markVendorQuotaDead("minimax", "429 non-transient from MiniMax-M3", now);
    expect(isVendorQuotaDead("minimax", now)).toBe(true);
  });

  it("쿨다운이 지나면 자동으로 살아난다(만료 시점 이후 false)", () => {
    const now = 1_000_000;
    const entry = markVendorQuotaDead("minimax", "429", now);
    expect(isVendorQuotaDead("minimax", entry.deadUntil - 1)).toBe(true);
    expect(isVendorQuotaDead("minimax", entry.deadUntil)).toBe(false);
  });

  it("만료된 항목을 조회하면 레지스트리에서 지워진다(조용히 영원히 안 남는다)", () => {
    const now = 1_000_000;
    const entry = markVendorQuotaDead("minimax", "429", now);
    expect(vendorQuotaDeadEntry("minimax", entry.deadUntil)).toBeNull();
    // 지워졌으니 listVendorQuotaDead 에도 안 남는다.
    expect(listVendorQuotaDead(entry.deadUntil)).toEqual([]);
  });

  it("마킹 안 한 벤더는 항상 살아있다로 판정한다", () => {
    expect(isVendorQuotaDead("anthropic")).toBe(false);
    expect(vendorQuotaDeadEntry("anthropic")).toBeNull();
  });

  it("같은 벤더를 다시 마킹하면 만료 시각이 연장된다(계속 429가 나는 동안)", () => {
    const t1 = 1_000_000;
    const first = markVendorQuotaDead("minimax", "429 #1", t1);
    const t2 = t1 + 60_000;
    const second = markVendorQuotaDead("minimax", "429 #2", t2);
    expect(second.deadUntil).toBeGreaterThan(first.deadUntil);
    expect(isVendorQuotaDead("minimax", t2)).toBe(true);
  });

  it("서로 다른 벤더는 독립적으로 죽고 산다", () => {
    const now = 1_000_000;
    markVendorQuotaDead("minimax", "429", now);
    expect(isVendorQuotaDead("minimax", now)).toBe(true);
    expect(isVendorQuotaDead("zai", now)).toBe(false);
  });

  it("listVendorQuotaDead 는 값(시크릿)이 아니라 벤더·사유·시각만 담는다", () => {
    const now = 1_000_000;
    markVendorQuotaDead("minimax", "429 non-transient from MiniMax-M3", now);
    const list = listVendorQuotaDead(now);
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ vendor: "minimax" });
    expect(list[0].reason).not.toMatch(/sk-|key|token=/i);
  });

  it("clearVendorQuotaDead 는 즉시 해제한다(운영 escape hatch)", () => {
    const now = 1_000_000;
    markVendorQuotaDead("minimax", "429", now);
    expect(isVendorQuotaDead("minimax", now)).toBe(true);
    clearVendorQuotaDead("minimax");
    expect(isVendorQuotaDead("minimax", now)).toBe(false);
  });
});
