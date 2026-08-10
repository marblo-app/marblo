/**
 * ★새 라우팅 라벨 필드 × PII 스크럽 — #890 §7-A 가 **계약상 필수**로 요구한 검토.
 *
 * > "★단 `metadata` 는 스크럽 denylist 를 지난다(#887 R8). 새 키를 넣을 때
 * >  `lib/telemetry/scrub.ts` 규칙 동반 검토가 필요하다 — 위 필드는 전부
 * >  숫자·enum·모델 id 라 통과가 맞지만, **그 판단을 명시적으로 하고 지나가야
 * >  한다.**"
 *
 * 그 "명시적 판단" 을 문장이 아니라 **실행 가능한 형태**로 남긴다. 스크럽은
 * denylist 라서 새 키는 기본 통과인데, 그게 곧 위험이기도 하다: 누군가 나중에
 * 이 페이로드에 원문 문자열을 하나 끼워 넣으면 아무도 못 막는다. 아래 두 축이
 * 그 두 방향을 각각 잡는다.
 *   1. 지금 넣은 필드는 스크럽을 **손상 없이** 통과한다(계측이 죽지 않는다).
 *   2. 원문 계열 키는 여전히 **떨어진다**(계측이 유출로 바뀌지 않는다).
 */
import { describe, it, expect } from "vitest";
import { scrubValue } from "../../src/lib/telemetry/scrub";

/** #890 F-1~F-4 로 dispatch:decision 에 추가된 필드 전량(대표값). */
const ROUTING_LABELS = {
  spawnedModel: "claude-opus-5",
  spawnedModelSource: "argv",
  plannedModelKey: "gpt-5.6-terra@high",
  candidateKeys: ["claude-opus-5", "gpt-5.6-terra@high"],
  candidateCostIndex: { "claude-opus-5": 15, "gpt-5.6-terra@high": 17.5 },
  decisionState: {
    budgetUsedPercent: 37,
    weeklyTokenShare: 0.42,
    activeAgentCount: 3,
    roleAgentCount: 1,
    candidateSetSize: 2,
  },
  decisionComponents: {
    mode: "tie-rotate",
    decidedBy: "diversity",
    entryModelKey: "claude-opus-5",
    movedFromEntry: false,
    coldStart: true,
    fit: 0,
    // 트랙A(Xna0v2mc)가 추가한 9번째 성분 — tags·taskType 워크로드. 값은 숫자라
    // 위 §1/§2 판단(숫자·enum·모델 id 만 싣는다)이 그대로 성립한다.
    workload: -6,
    cost: -2,
    bench: 3,
    capability: 0,
    kg: 0,
    diversity: 3.2,
    usage: -1,
    weeklyLimit: 0,
    observations: 0,
    totalObservations: 12,
    total: 78,
  },
};

describe("라우팅 라벨 × PII 스크럽 (#890 §7-A 동반 검토)", () => {
  it("새 필드는 스크럽을 손상 없이 통과한다", () => {
    expect(scrubValue(ROUTING_LABELS)).toEqual(ROUTING_LABELS);
  });

  it("모델 키는 시크릿 키 이름 규칙에 걸리지 않는다", () => {
    // `_KEY` 를 포함하는 **객체 키**는 값이 <REDACTED> 로 바뀐다. 모델 id 는
    // 그 모양이 아니라는 것이 candidateCostIndex 를 맵으로 둘 수 있는 근거다.
    const scrubbed = scrubValue(ROUTING_LABELS) as typeof ROUTING_LABELS;
    for (const value of Object.values(scrubbed.candidateCostIndex)) {
      expect(typeof value).toBe("number");
    }
  });

  it("★원문 계열 키는 여전히 떨어진다 — 계측이 유출로 바뀌지 않는다", () => {
    const scrubbed = scrubValue({
      ...ROUTING_LABELS,
      prompt: "티켓 본문 원문",
      message: "사용자가 친 말",
      MARBLO_API_KEY: "sk-ant-aaaaaaaaaaaaaaaaaaaaaaaa",
    }) as Record<string, unknown>;
    expect(scrubbed.prompt).toBeUndefined();
    expect(scrubbed.message).toBeUndefined();
    expect(scrubbed.MARBLO_API_KEY).toBe("<REDACTED>");
    // 그러면서 라우팅 라벨은 그대로 남는다.
    expect(scrubbed.plannedModelKey).toBe("gpt-5.6-terra@high");
  });

  it("에이전트 종료 신호(F-7)도 숫자·불리언뿐이라 그대로 통과한다", () => {
    const stopped = { outputChars: 1240, noOutput: true, exitCode: 1 };
    expect(scrubValue(stopped)).toEqual(stopped);
  });

  // ── 라우팅 shadow (티켓 6LH4Y1GC7xeWA94pW3Ar) ─────────────────────────────
  // 같은 동반 검토를 shadow 이벤트의 metadata 에도 적용한다. 특히 `...ModelKey`
  // 계열이 `_KEY` 규칙(언더스코어 필수)에 걸리지 않는다는 판정을 못 박는다 —
  // 걸리면 이벤트가 조용히 `<REDACTED>` 로 채워져 일치율이 통째로 거짓이 된다.
  const SHADOW_METADATA = {
    cloudModelKey: "claude-sonnet-5",
    localModelKey: "claude-opus-5",
    rungDelta: -1,
    costDelta: -12.5,
    cloudDecidedBy: "cost",
    heuristicVersion: "heuristic-v0-cost-fit",
    localMode: "top-score",
    localDecidedBy: "kg",
    localMovedFromEntry: false,
    localColdStart: true,
    tier: "standard",
    harness: "claude",
  };

  it("shadow metadata 는 스크럽을 손상 없이 통과한다", () => {
    expect(scrubValue(SHADOW_METADATA)).toEqual(SHADOW_METADATA);
  });

  it("★shadow 요청 특징에 자유입력이 섞이면 그 키는 떨어진다", () => {
    // features 는 숫자·enum·모델 id 만 싣는 계약이다(태그는 개수만). 계약이
    // 깨져 원문이 섞여 들어와도 choke point 가 마지막으로 걷어낸다.
    const scrubbed = scrubValue({
      tier: "complex",
      harness: "gpt",
      tagCount: 3,
      rungs: [{ modelKey: "gpt-5.6-sol@high", index: 2, costIndex: 17.5 }],
      prompt: "티켓 본문이 실렸다고 가정",
    }) as Record<string, unknown>;
    expect(scrubbed.prompt).toBeUndefined();
    expect(scrubbed.tagCount).toBe(3);
    expect(scrubbed.rungs).toEqual([
      { modelKey: "gpt-5.6-sol@high", index: 2, costIndex: 17.5 },
    ]);
  });
});
