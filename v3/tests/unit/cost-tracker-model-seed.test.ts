/**
 * `cost_logs.model = 'claude'` (90행) 의 발원지 — 트래커 씨앗.
 *
 * 종전 `trackSession(agentId, cwd, sessionId, model)` 의 `model` 은 **하네스족**
 * (`claude`)이지 모델 id 가 아니었고, 그 문자열이 그대로 트래커의 초기 모델이
 * 됐다. 결과는 두 가지였다:
 *
 *   1. 세션 JSONL 이 첫 assistant 턴을 쓰기 전에 나가는 emit — 특히 토큰 0 인
 *      rate-limit 전용 emit(`emit()` 은 rlChanged 만으로도 발화한다) — 이 전부
 *      `model='claude'` 로 적재됐다.
 *   2. `findPricing("claude")` 는 단가표에도 레지스트리에도 없어 미매칭 →
 *      그 구간이 $0 로 청구됐다(고스트 비용, P1 규칙과 같은 결함).
 *
 * 수리: 스폰 argv 에서 되읽은 **구체 모델 id** 를 씨앗으로 받는다. 파일에서
 * 실제 과금 모델이 읽히면 그 관측이 여전히 씨앗을 덮는다(pollSessionFile).
 */

import { describe, it, expect, afterEach, vi } from "vitest";
import {
  CostTracker,
  normalizeSeedModel,
  perTokenRateFor,
} from "../../electron/cost-tracker";

/** `sessions` 는 private — 씨앗을 확인할 공개 경로가 없어 구조적으로 들여다본다
 *  (같은 파일군의 `cost-tracker-unmatched-pricing.test.ts` 와 같은 방식). */
function seededModel(
  tracker: CostTracker,
  agentId: string,
): string | undefined {
  const sessions = (
    tracker as unknown as { sessions: Map<string, { model: string }> }
  ).sessions;
  return sessions.get(agentId)?.model;
}

const trackers: CostTracker[] = [];
function makeTracker(): CostTracker {
  // 계정 전역 rate-limit 프로브가 실제 CLI 를 때리지 않게 죽여둔다 — 이 파일이
  // 보는 것은 씨앗뿐이다.
  const t = new CostTracker(() => {});
  vi.spyOn(
    t as unknown as { ensureClaudeProbe: () => void },
    "ensureClaudeProbe",
  ).mockImplementation(() => {});
  trackers.push(t);
  return t;
}

afterEach(() => {
  for (const t of trackers.splice(0)) t.clearAll();
  vi.restoreAllMocks();
});

describe("cost-tracker 씨앗 — 하네스족이 모델 자리에 앉지 않는다", () => {
  it("★구체 모델을 주면 첫 emit 부터 그 모델 id 로 적재된다", () => {
    const t = makeTracker();
    // sessionId 를 주면 파일이 아직 없어도 트래커는 생긴다(폴러가 기다린다) —
    // 실제 스폰과 같은 타이밍이다.
    t.trackSession("ag-1", process.cwd(), "sess-1", "claude", "claude-opus-5");
    expect(seededModel(t, "ag-1")).toBe("claude-opus-5");
  });

  it("씨앗 모델은 단가가 실제로 매겨진다(족은 미매칭 $0 였다)", () => {
    // 이게 고스트 비용의 절반이다 — 이름만 고친 게 아니라 청구가 되살아난다.
    expect(perTokenRateFor("claude")).toEqual({
      inputPer1M: 0,
      outputPer1M: 0,
    });
    const rate = perTokenRateFor("claude-opus-5");
    expect(rate.inputPer1M).toBeGreaterThan(0);
    expect(rate.outputPer1M).toBeGreaterThan(0);
  });

  it("effort 접미사는 벗기고 모델 id 로 씨딩한다(단가 조회 축)", () => {
    const t = makeTracker();
    t.trackSession(
      "ag-2",
      process.cwd(),
      "sess-2",
      "claude",
      "claude-opus-5@high",
    );
    expect(seededModel(t, "ag-2")).toBe("claude-opus-5");
  });

  it("씨앗이 하네스족이면 무시한다 — 미상을 모델인 척 적지 않는다", () => {
    const t = makeTracker();
    t.trackSession("ag-3", process.cwd(), "sess-3", "claude", "claude");
    // 종전 동작(족)으로 떨어지되, 씨앗이 그 값을 **승인해서** 그런 게 아니다.
    expect(normalizeSeedModel("claude")).toBeNull();
    expect(seededModel(t, "ag-3")).toBe("claude");
  });

  it("씨앗이 없으면 종전과 바이트 동일(무회귀)", () => {
    const t = makeTracker();
    t.trackSession("ag-4", process.cwd(), "sess-4", "claude");
    expect(seededModel(t, "ag-4")).toBe("claude");
  });
});
