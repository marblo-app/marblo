/**
 * ★오퍼스 편중의 1층 기전 — 태그 가점 포화 (티켓 sgeSFIh6NAnNHKMIRNpf)
 *
 * 사장님 관찰: "코덱스·그록 연결됐는데 오퍼스만 스폰됨."
 *
 * 감별 결과(측정은 아래 테스트가 그대로 고정한다):
 *   · 2층 다양성 스택(#654/#656)은 **정상**이다 — 무태그 standard 에서 opus5 는
 *     14% 뿐이고 1층은 claude/gpt/grok 을 33%씩 고른다.
 *   · 후보 집합도 정상이다 — 기본 프리셋 `auto` 에 codex(gpt)·grok 이 들어 있고,
 *     인증된 하네스는 `filterAvailableHarnesses` 를 그대로 통과한다.
 *   · 진범은 1층의 **무제한 태그 가산**이었다. 오케 스킬이 "복잡한 코딩" 에 달라고
 *     지시하던 `["architecture","multi-file","coding"]` 세트가 claude 열에서
 *     25+25+22=72 로 쌓여, 총점 격차가 다른 축 전부(budgetBias ±16, graphBias ±20,
 *     costEff ~12)의 사거리 밖인 55 가 됐다 → claude 100% 고정.
 *
 * 이 파일이 고정하는 계약:
 *   1. 단일 태그는 **비트 단위로 종전과 같다**(무회귀).
 *   2. 여러 태그가 맞아도 리드가 다른 축의 사거리 안에 머문다.
 *   3. 연결된 codex/grok 이 후보에 들어가고 실제로 선택된다.
 */

import { describe, it, expect } from "vitest";
import {
  MODEL_TAG_BONUSES,
  TAG_BONUS_SATURATION,
  saturatedTagBonus,
  scoreModelsDetailed,
  resolvePreset,
} from "../../electron/dispatch-scoring";
import { filterAvailableHarnesses } from "../../electron/model-availability";
import type { ModelType } from "../../src/types/agent";

const FLEET = ["claude", "gpt", "grok"] as ModelType[];
/** 오케 스킬이 "복잡한 코딩/리팩토링" 에 달라고 지시하던 그 세트. */
const ORCHESTRATOR_CODING_TAGS = ["architecture", "multi-file", "coding"];

function totals(tags: string[], budgets = {}) {
  const sel = scoreModelsDetailed(FLEET, tags, "standard", budgets);
  const by = new Map(sel.scores.map((s) => [s.model, s]));
  return { sel, by };
}

describe("saturatedTagBonus — 태그 개수는 독립 근거가 아니다", () => {
  it("매치가 없으면 0, 하나면 그 값 그대로(무회귀)", () => {
    expect(saturatedTagBonus([])).toBe(0);
    expect(saturatedTagBonus([25])).toBe(25);
    expect(saturatedTagBonus([22])).toBe(22);
  });

  it("둘째 매치는 절반만, 셋째부터는 세지 않는다", () => {
    expect(saturatedTagBonus([25, 25])).toBe(37.5);
    expect(saturatedTagBonus([25, 25, 22])).toBe(37.5);
    // 순서와 무관하다 — 강한 것이 1등 자리를 갖는다.
    expect(saturatedTagBonus([22, 25, 25])).toBe(
      saturatedTagBonus([25, 25, 22]),
    );
  });

  it("포화 개수는 2층(WORKLOAD_TAG_SATURATION)과 같은 2다", () => {
    expect(TAG_BONUS_SATURATION).toBe(2);
  });

  it("가장 강한 매치는 언제나 온전히 남는다(가점을 깎는 장치가 아니다)", () => {
    for (const model of Object.keys(MODEL_TAG_BONUSES)) {
      const values = Object.values(MODEL_TAG_BONUSES[model]);
      const strongest = Math.max(...values);
      expect(saturatedTagBonus(values)).toBeGreaterThanOrEqual(strongest);
    }
  });
});

describe("★오케 태그 세트가 1층을 잠그지 못한다", () => {
  it("claude 는 여전히 이기되, 격차가 다른 축의 사거리 안이다", () => {
    const { by } = totals(ORCHESTRATOR_CODING_TAGS);
    const claude = by.get("claude")!;
    const grok = by.get("grok")!;
    // 근거대로 claude 가 앞선다 — 이 티켓은 "claude 를 벌주자" 가 아니다.
    expect(claude.total).toBeGreaterThan(grok.total);
    // 종전엔 tagBonus 72 / 격차 55 라 budgetBias(±16)·graphBias(±20) 를 합쳐도
    // 닿지 않았다. 포화 후에는 닿는다.
    expect(claude.tagBonus).toBe(37.5);
    expect(claude.total - grok.total).toBeLessThan(16 + 20);
  });

  it("claude 쿼터가 마르면 그 세트에서도 실제로 순위가 뒤집힌다", () => {
    const drained = {
      claude: { usedPercent: 99 },
      gpt: { usedPercent: 10 },
      grok: { usedPercent: 10 },
    };
    const { by } = totals(ORCHESTRATOR_CODING_TAGS, drained);
    expect(by.get("grok")!.total).toBeGreaterThan(by.get("claude")!.total);
  });

  it("쿼터가 넉넉하면 종전대로 claude 가 top-score 다(무회귀)", () => {
    const { sel } = totals(ORCHESTRATOR_CODING_TAGS);
    expect(sel.mode).toBe("top-score");
    expect(sel.selected).toBe("claude");
  });
});

describe("단일 태그 경로는 비트 단위로 종전과 같다", () => {
  it.each([
    ["architecture", "claude", 25],
    ["multi-file", "claude", 25],
    ["coding", "claude", 22],
    ["github", "gpt", 25],
    ["simple-fix", "gpt", 25],
    ["agentic", "grok", 20],
  ])("[%s] → %s tagBonus %d", (tag, model, expected) => {
    const { by } = totals([tag]);
    expect(by.get(model as ModelType)!.tagBonus).toBe(expected);
  });

  it("감점은 포화하지 않는다 — 리드를 만들지 않으므로", () => {
    const { by } = totals(["architecture", "large-refactor"]);
    expect(by.get("gpt")!.tagPenalty).toBe(-20);
  });
});

describe("★연결된 codex/grok 이 후보에 들어가고 실제로 선택된다", () => {
  it("기본 프리셋(auto)에 codex(gpt)·grok 이 들어 있다", () => {
    expect(resolvePreset(undefined)).toEqual(["claude", "gpt", "grok"]);
  });

  it("셋 다 인증돼 있으면 아무도 후보에서 빠지지 않는다", async () => {
    const filtered = await filterAvailableHarnesses(resolvePreset(undefined), {
      ttlMs: 0,
      probe: async () => ({ installed: true, authenticated: true }),
    });
    expect(filtered.excluded).toEqual([]);
    expect(filtered.available).toEqual(["claude", "gpt", "grok"]);
  });

  it("각 하네스가 자기 축의 태그에서 실제로 뽑힌다", () => {
    const pick = (tags: string[]) =>
      scoreModelsDetailed(FLEET, tags, "standard").selected;
    expect(pick(["simple-fix"])).toBe("gpt");
    expect(pick(["github"])).toBe("gpt");
    expect(pick(["agentic"])).toBe("grok");
    expect(pick(["architecture"])).toBe("claude");
  });

  it("무태그 dispatch 는 셋을 고루 돈다(라운드로빈)", () => {
    const picked = new Set<string>();
    for (let i = 0; i < 30; i++) {
      picked.add(scoreModelsDetailed(FLEET, [], "standard").selected);
    }
    expect(picked).toEqual(new Set(["claude", "gpt", "grok"]));
  });

  it("일반 코딩 태그 하나면 셋이 동률 회전한다", () => {
    const picked = new Set<string>();
    for (let i = 0; i < 30; i++) {
      picked.add(scoreModelsDetailed(FLEET, ["coding"], "standard").selected);
    }
    expect(picked).toEqual(new Set(["claude", "gpt", "grok"]));
  });
});
