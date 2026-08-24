/**
 * 에이전트 진척 관측(lib/agentProgress) — 과금 토큰 카운터의 **증가**만 진척.
 *
 * 이 축이 왜 존재하는가는 그 파일 헤더에 있다. 여기서 못 박는 계약은 셋이다:
 *   ① 처음 본 에이전트는 기준선만 잡는다(앱 켜자마자 전원 "방금 진척" 금지)
 *   ② 카운터가 안 움직이면 시각도 안 움직인다(같은 스냅샷 재접기 안전)
 *   ③ 줄어든 카운터는 진척이 아니다(문서 교체·재생성)
 */
import { describe, expect, it } from "vitest";
import {
  agentActivityMap,
  foldAgentTokenObservations,
  observeAgentTokens,
  resetAgentTokenObservations,
  totalBilledTokens,
  type AgentTokenSnapshot,
} from "../../src/lib/agentProgress";

const T0 = Date.UTC(2026, 6, 27, 12, 0, 0);
const MINUTE = 60_000;

function snap(
  id: string,
  tokens: Partial<AgentTokenSnapshot> = {},
): AgentTokenSnapshot {
  return { id, totalOutputTokens: 0, ...tokens };
}

describe("totalBilledTokens", () => {
  it("네 카운터를 모두 더하고, 없는 필드는 0으로 본다(구 doc)", () => {
    expect(totalBilledTokens({} as AgentTokenSnapshot)).toBe(0);
    expect(
      totalBilledTokens({
        totalInputTokens: 1,
        totalOutputTokens: 2,
        totalCacheReadTokens: 4,
        totalCacheWriteTokens: 8,
      }),
    ).toBe(15);
  });
});

describe("foldAgentTokenObservations", () => {
  it("★처음 본 에이전트는 기준선만 잡는다 — 진척 시각이 없다", () => {
    const obs = foldAgentTokenObservations(
      new Map(),
      [snap("a", { totalOutputTokens: 500 })],
      T0,
    );
    expect(obs.get("a")).toEqual({ tokens: 500, at: null });
    expect(agentActivityMap(obs).has("a")).toBe(false);
  });

  it("카운터가 오르면 그때 시각이 찍힌다", () => {
    const first = foldAgentTokenObservations(
      new Map(),
      [snap("a", { totalOutputTokens: 500 })],
      T0,
    );
    const second = foldAgentTokenObservations(
      first,
      [snap("a", { totalOutputTokens: 900 })],
      T0 + MINUTE,
    );
    expect(second.get("a")).toEqual({ tokens: 900, at: T0 + MINUTE });
    expect(agentActivityMap(second).get("a")).toBe(T0 + MINUTE);
  });

  it("★같은 스냅샷을 두 번 접어도 시각이 안 움직인다(순수 fold·StrictMode 안전)", () => {
    const a = foldAgentTokenObservations(
      new Map(),
      [snap("a", { totalOutputTokens: 100 })],
      T0,
    );
    const b = foldAgentTokenObservations(
      a,
      [snap("a", { totalOutputTokens: 200 })],
      T0 + MINUTE,
    );
    const again = foldAgentTokenObservations(
      b,
      [snap("a", { totalOutputTokens: 200 })],
      T0 + 30 * MINUTE,
    );
    expect(again.get("a")?.at).toBe(T0 + MINUTE);
  });

  it("카운터가 줄면 진척이 아니다 — 기준선만 다시 잡고 시각은 유지", () => {
    const a = foldAgentTokenObservations(
      new Map(),
      [snap("a", { totalOutputTokens: 100 })],
      T0,
    );
    const b = foldAgentTokenObservations(
      a,
      [snap("a", { totalOutputTokens: 300 })],
      T0 + MINUTE,
    );
    const shrunk = foldAgentTokenObservations(
      b,
      [snap("a", { totalOutputTokens: 50 })],
      T0 + 2 * MINUTE,
    );
    expect(shrunk.get("a")).toEqual({ tokens: 50, at: T0 + MINUTE });
  });

  it("목록에서 사라진 에이전트는 관측에서도 빠진다", () => {
    const a = foldAgentTokenObservations(new Map(), [snap("a"), snap("b")], T0);
    const b = foldAgentTokenObservations(a, [snap("a")], T0 + MINUTE);
    expect([...b.keys()]).toEqual(["a"]);
  });

  it("캐시 토큰만 움직여도 진척이다 — 캐시 읽기도 모델 턴이 돌았다는 뜻", () => {
    const a = foldAgentTokenObservations(
      new Map(),
      [snap("a", { totalCacheReadTokens: 10 })],
      T0,
    );
    const b = foldAgentTokenObservations(
      a,
      [snap("a", { totalCacheReadTokens: 20 })],
      T0 + MINUTE,
    );
    expect(b.get("a")?.at).toBe(T0 + MINUTE);
  });
});

describe("모듈 전역 관측 슬롯", () => {
  it("탭을 오가도(훅 언마운트) 기준선이 유지되도록 모듈에 남는다", () => {
    resetAgentTokenObservations();
    observeAgentTokens([snap("a", { totalOutputTokens: 10 })], T0);
    const after = observeAgentTokens(
      [snap("a", { totalOutputTokens: 11 })],
      T0 + MINUTE,
    );
    expect(agentActivityMap(after).get("a")).toBe(T0 + MINUTE);

    resetAgentTokenObservations();
    const fresh = observeAgentTokens(
      [snap("a", { totalOutputTokens: 11 })],
      T0 + 2 * MINUTE,
    );
    expect(agentActivityMap(fresh).has("a")).toBe(false);
  });
});
