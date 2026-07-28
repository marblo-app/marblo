/**
 * 다요소 모델 칸 자동선택(`electron/model-autoselect.ts`).
 *
 * 이 파일이 지키는 완료기준(티켓 YkzwnyOk):
 *   · 단순 → 저단가 칸, 복잡 → 고성능 칸
 *   · standard 가 **항상 opus5** 이던 편중이 풀린다
 *   · 인증/크레덴셜 없는 칸은 후보에서 빠진다
 *   · exploration 이 실제로 다른 칸을 고른다(= 비교데이터가 생긴다)
 *   · 콜드스타트(관측 0)는 정적신호로만 판단하고 진입칸을 뒤집지 않는다
 *   · 관측이 쌓이면 그 근거로 선택이 바뀐다(자기강화 루프)
 *
 * 숫자를 하드코딩하지 않고 **레지스트리·사다리 파생값과 대조**한다 — 단가표가
 * 바뀌면 테스트가 같이 움직여야지, 옛 숫자를 지키느라 거짓 통과하면 안 된다.
 */
import { describe, it, expect, beforeEach } from "vitest";
import {
  selectAutoModel,
  autoCandidates,
  resetAutoSelectRotation,
  costPressureForHeadroom,
  resolveEpsilon,
  modelGuidance,
  DEFAULT_EPSILON,
} from "../../electron/model-autoselect";
import { costIndexForModel, entryRung } from "../../electron/model-ladder";
import { modelGuidanceStatic } from "../../electron/model-guidance";
import { withModelTiers } from "../../electron/mcp-server/model-tier";
import { getModel } from "../../electron/model-registry";
import { isApprovalGatedEffort } from "../../electron/mcp-server/escalation-approval";
import {
  applyOutcome,
  emptyRoutingGraph,
  type GraphContext,
  type OutcomeMode,
  type RoutingGraph,
} from "../../electron/routing-graph";

const T0 = Date.parse("2026-07-20T00:00:00Z");
const DAY = 24 * 60 * 60 * 1000;

function ctxFor(
  complexity: "simple" | "standard" | "complex",
  taskType = "feature",
): GraphContext {
  return { role: "backend", complexity, taskType, tags: [] };
}

/** 한 칸(modelKey)에 같은 결과를 n 번 먹인다. */
function feed(
  graph: RoutingGraph,
  modelKey: string,
  mode: OutcomeMode,
  count: number,
  ctx: GraphContext,
): RoutingGraph {
  for (let i = 0; i < count; i++) {
    applyOutcome(graph, {
      model: modelKey,
      mode,
      ctx,
      taskId: `T-${modelKey}-${mode}-${i}`,
      agentId: `a-${i}`,
      atMs: T0 + i * DAY,
    });
  }
  return graph;
}

/** exploration 없이(ε=0) 결정적으로 한 판 돌린다. */
function plan(
  harness: string,
  tier: "simple" | "standard" | "complex",
  extra: Partial<Parameters<typeof selectAutoModel>[0]> = {},
) {
  return selectAutoModel({
    harness,
    tier,
    ctx: ctxFor(tier),
    epsilon: 0,
    ...extra,
  });
}

beforeEach(() => {
  resetAutoSelectRotation();
});

describe("후보 구성", () => {
  it("claude 는 사다리 칸 그대로(모델 축을 실제로 핀한다)", () => {
    const { candidates, pinsModel, entryIndex } = autoCandidates(
      "claude",
      "standard",
    );
    expect(pinsModel).toBe(true);
    expect(candidates.map((c) => c.model)).toEqual([
      "claude-sonnet-5",
      "claude-opus-5",
      "claude-fable-5",
    ]);
    // 진입칸은 사다리가 말하는 그 칸이다(여기서 순서를 새로 만들지 않는다).
    expect(candidates[entryIndex].model).toBe(
      entryRung("claude", "standard")!.model,
    );
  });

  it("★codex 는 상속 모델의 effort 칸들 — 사용자 config.toml 모델을 갈아치우지 않는다", () => {
    const { candidates, pinsModel } = autoCandidates("gpt", "standard");
    expect(pinsModel).toBe(false);
    // 모든 후보가 같은 모델(= 사다리의 inheritedModel)이라 단가 축이 평평하다.
    expect(new Set(candidates.map((c) => c.model)).size).toBe(1);
    expect(candidates.every((c) => !!c.effort)).toBe(true);
  });

  it("★승인게이트 칸(max/ultra)은 자동선택 후보가 아니다", () => {
    for (const harness of ["claude", "gpt"]) {
      for (const tier of ["simple", "standard", "complex"] as const) {
        const { candidates } = autoCandidates(harness, tier);
        expect(candidates.some((c) => isApprovalGatedEffort(c.effort))).toBe(
          false,
        );
      }
    }
  });

  it("사다리가 없는 하네스는 계획 자체가 없다(종전 경로 유지 = 무회귀)", () => {
    expect(plan("antigravity", "standard")).toBeNull();
    expect(plan("gemini", "standard")).toBeNull();
  });

  it("★grok 은 칸이 하나라도 계획이 나온다 — 그래프 읽는 셀 = 쓰는 셀", () => {
    // 사다리가 없던 동안 grok dispatch 는 계획이 null 이라 그래프 조회 키가
    // 하네스 이름 "grok"(=모델미상 유령 셀)으로 떨어졌다. 결과를 쓰는 쪽은 argv
    // 에서 되읽은 "grok-4.5" 라 읽기·쓰기가 갈렸다.
    const p = plan("grok", "complex")!;
    expect(p).not.toBeNull();
    expect(p.modelKey).toBe("grok-4.5");
    expect(p.pinsModel).toBe(true);
    expect(p.mode).toBe("single");
    // 진입칸을 벗어나지 않는다 = 스폰 argv 가 종전(`-m grok-4.5` 기본값)과 같다.
    expect(p.movedFromEntry).toBe(false);
  });
});

describe("★단순 → 저단가", () => {
  it("simple claude 는 후보 중 실단가가 가장 싼 칸을 고른다", () => {
    const p = plan("claude", "simple")!;
    const costs = p.scores.map((s) => costIndexForModel(s.candidate.model)!);
    expect(costIndexForModel(p.model)).toBe(Math.min(...costs));
    expect(p.mode).toBe("top-score");
  });

  it("simple gpt 는 가장 낮은 effort 칸을 고른다(토큰 소모가 최소)", () => {
    const p = plan("gpt", "simple")!;
    expect(p.effort).toBe("low");
    expect(p.pinsModel).toBe(false);
  });

  it("simple 에서 최상위 칸은 큰 격차로 진다(비용 폭발 방지)", () => {
    const p = plan("claude", "simple")!;
    const fable = p.scores.find((s) => s.candidate.model === "claude-fable-5")!;
    const winner = p.scores.find((s) => s.candidate.model === p.model)!;
    expect(winner.total - fable.total).toBeGreaterThan(20);
  });
});

describe("★복잡 → 고성능", () => {
  it("complex claude 는 능력등급 최상위(frontier) 칸을 유지한다", () => {
    const p = plan("claude", "complex")!;
    expect(getModel(p.model)!.capability).toBe("frontier");
    expect(p.movedFromEntry).toBe(false);
  });

  it("complex gpt 는 진입 effort 아래로 내려가지 않는다", () => {
    const p = plan("gpt", "complex")!;
    expect(p.effort).toBe(entryRung("gpt", "complex")!.effort);
  });

  it("complex 에서는 회전만으로 상향되지 않는다(근거 없는 비용증가 금지)", () => {
    // TIE_BAND 보다 큰 up 페널티라 상단 칸이 동률 밴드에 들어오지 않는다.
    const p = plan("gpt", "complex")!;
    expect(p.mode).toBe("top-score");
  });
});

describe("★standard opus5 편중 해소", () => {
  it("종전 고정 동작(진입칸)이 opus5 라는 전제를 명시한다", () => {
    expect(entryRung("claude", "standard")!.model).toBe("claude-opus-5");
  });

  it("연속 dispatch 가 한 칸에 고이지 않는다 — 더 싼 칸이 실제로 뽑힌다", () => {
    const picks = new Set<string>();
    for (let i = 0; i < 6; i++) picks.add(plan("claude", "standard")!.model);
    expect(picks.size).toBeGreaterThan(1);
    expect(picks.has("claude-sonnet-5")).toBe(true);
    // 그렇다고 아무 칸이나 도는 것은 아니다 — 두 칸 떨어진 frontier 는 안 뽑힌다.
    expect(picks.has("claude-fable-5")).toBe(false);
  });

  it("회전은 하네스별로 돈다(한 dispatch 가 여러 하네스를 계산해도 죽지 않는다)", () => {
    const seq: string[] = [];
    for (let i = 0; i < 4; i++) {
      // 실제 dispatch 처럼 후보 하네스마다 한 번씩 계산한다.
      seq.push(plan("claude", "standard")!.model);
      plan("gpt", "standard");
    }
    expect(new Set(seq).size).toBeGreaterThan(1);
  });
});

describe("★가용성 — 못 쓰는 칸은 후보에서 빠진다", () => {
  it("크레덴셜 없는 구체 모델은 선택되지 않는다", () => {
    const p = plan("claude", "standard", {
      modelAvailable: (id) => id !== "claude-opus-5",
    })!;
    expect(p.model).not.toBe("claude-opus-5");
    expect(p.scores.some((s) => s.candidate.model === "claude-opus-5")).toBe(
      false,
    );
  });

  it("전부 못 쓰면 계획이 없다(호출자가 종전 경로로 떨어진다)", () => {
    expect(
      plan("claude", "standard", { modelAvailable: () => false }),
    ).toBeNull();
  });
});

describe("★exploration — 비교데이터를 만든다", () => {
  it("탐색이 걸리면 exploit 승자가 아닌 인접 칸을 고른다", () => {
    const exploit = plan("claude", "simple")!;
    const explored = plan("claude", "simple", { forceExplore: true })!;
    expect(explored.mode).toBe("explore");
    expect(explored.modelKey).not.toBe(exploit.modelKey);
    expect(explored.decidedBy).toBe("explore");
  });

  it("★관측이 가장 적은 칸을 고른다(다양성이 아니라 빈 셀 채우기)", () => {
    const ctx = ctxFor("standard");
    const graph = emptyRoutingGraph();
    // sonnet 은 이미 많이 봤다 → 탐색은 아직 안 본 칸으로 가야 한다.
    feed(graph, "claude-sonnet-5", "completed", 10, ctx);
    const p = plan("claude", "standard", {
      ctx,
      graph,
      forceExplore: true,
    })!;
    expect(p.modelKey).not.toBe("claude-sonnet-5");
    expect(p.mode).toBe("explore");
  });

  it("탐색은 인접 칸(±1)까지만 — complex 가 simple 칸으로 떨어지지 않는다", () => {
    const p = plan("gpt", "complex", { forceExplore: true })!;
    const efforts = autoCandidates("gpt", "complex").candidates;
    const entryIdx = efforts.findIndex(
      (c) => c.effort === entryRung("gpt", "complex")!.effort,
    );
    const pickedIdx = efforts.findIndex((c) => c.modelKey === p.modelKey);
    expect(Math.abs(pickedIdx - entryIdx)).toBeLessThanOrEqual(1);
  });

  it("ε=0 이면 탐색이 절대 일어나지 않는다(끌 수 있는 스위치)", () => {
    const rolls: number[] = [];
    const p = plan("claude", "standard", {
      epsilon: 0,
      random: () => {
        rolls.push(1);
        return 0; // 항상 탐색이 걸릴 난수인데도
      },
    })!;
    expect(p.mode).not.toBe("explore");
    expect(rolls).toHaveLength(0); // 굴리지도 않는다
  });

  it("resolveEpsilon 은 잘못된 env 를 기본값으로 되돌린다", () => {
    expect(resolveEpsilon("0")).toBe(0);
    expect(resolveEpsilon("0.4")).toBe(0.4);
    expect(resolveEpsilon("abc")).toBe(DEFAULT_EPSILON);
    expect(resolveEpsilon("7")).toBe(DEFAULT_EPSILON);
    expect(resolveEpsilon(undefined)).toBe(DEFAULT_EPSILON);
  });
});

describe("★콜드스타트 폴백", () => {
  it("그래프가 없으면 kg=0 이고 콜드로 표시된다(정적신호로만 판단)", () => {
    const p = plan("claude", "complex")!;
    expect(p.coldStart).toBe(true);
    expect(p.scores.every((s) => s.kg === 0)).toBe(true);
    // 콜드에서는 진입칸을 뒤집지 않는다.
    expect(p.movedFromEntry).toBe(false);
  });

  it("빈 그래프도 그래프 없음과 같은 결론을 낸다", () => {
    const withGraph = plan("claude", "simple", { graph: emptyRoutingGraph() })!;
    const without = plan("claude", "simple")!;
    expect(withGraph.modelKey).toBe(without.modelKey);
    expect(withGraph.coldStart).toBe(true);
  });

  it("벤치 점수가 없는 모델은 0 이 아니라 '없음' 으로 다뤄진다", () => {
    // gpt-5.4 는 참조표에 행은 있으나 공식 점수가 없다(score: null).
    // 그 칸을 0 점으로 접으면 "측정 안 됨" 이 "최악" 으로 둔갑한다.
    const g = modelGuidance("gpt-5.4");
    expect(g?.capability).toBe("mid");
    expect(g?.benchScore).toBeUndefined();
    // 반대로 점수가 있는 모델은 그 값이 그대로 실린다(단일소스 파생).
    expect(modelGuidance("claude-opus-5")?.benchScore).toBeGreaterThan(0);
  });
});

describe("★정적 지식은 get_model_guidance(obPe) 소스에서 온다", () => {
  it("대표 벤치·티어가 그 툴이 서빙하는 페이로드와 같은 값이다", () => {
    const payload = modelGuidanceStatic();
    const tiers = withModelTiers(
      payload.models.map((row) => ({
        capability: row.capability as "cheap" | "mid" | "top" | "frontier",
        outputPer1M: row.outputPer1M,
        bench:
          row.representativeIndex === null
            ? null
            : {
                benchmark: row.benchRecords[row.representativeIndex].benchmark,
                score: row.benchRecords[row.representativeIndex].score,
              },
      })),
    );
    payload.models.forEach((row, i) => {
      const g = modelGuidance(row.modelId);
      expect(g, row.modelId).toBeDefined();
      expect(g!.tier).toBe(tiers[i].tier);
      const rep =
        row.representativeIndex === null
          ? null
          : row.benchRecords[row.representativeIndex];
      expect(g!.benchScore).toBe(
        rep && typeof rep.score === "number" ? rep.score : undefined,
      );
    });
  });

  it("★서로 다른 벤치는 빼지 않는다(Verified 96 − Pro 64.6 은 능력차가 아니다)", () => {
    for (const tier of ["simple", "standard", "complex"] as const) {
      for (const harness of ["claude", "gpt"]) {
        const p = plan(harness, tier)!;
        const entry = modelGuidance(
          autoCandidates(harness, tier).candidates[
            autoCandidates(harness, tier).entryIndex
          ].model,
        );
        for (const s of p.scores) {
          if (s.bench === 0) continue;
          expect(modelGuidance(s.candidate.model)!.benchmark).toBe(
            entry!.benchmark,
          );
        }
      }
    }
  });
});

describe("★자기강화 루프 — 관측이 선택을 바꾼다", () => {
  it("싼 칸이 성공을 쌓으면 그 칸이 진입칸을 이긴다", () => {
    const ctx = ctxFor("standard");
    const graph = emptyRoutingGraph();
    feed(graph, "claude-sonnet-5", "merged", 12, ctx);
    const p = plan("claude", "standard", { ctx, graph })!;
    expect(p.model).toBe("claude-sonnet-5");
    expect(p.coldStart).toBe(false);
    expect(
      p.scores.find((s) => s.candidate.model === "claude-sonnet-5")!.kg,
    ).toBeGreaterThan(0);
  });

  it("싼 칸이 실패를 쌓으면 진입칸이 단독으로 이긴다(동률 회전도 멈춘다)", () => {
    const ctx = ctxFor("standard");
    const graph = emptyRoutingGraph();
    feed(graph, "claude-sonnet-5", "review_rejected", 12, ctx);
    const picks = new Set<string>();
    for (let i = 0; i < 4; i++)
      picks.add(plan("claude", "standard", { ctx, graph })!.model);
    expect([...picks]).toEqual(["claude-opus-5"]);
  });

  it("관측은 맥락별이다 — 다른 난도의 성공이 이 난도를 흔들지 않는다", () => {
    const graph = emptyRoutingGraph();
    feed(graph, "claude-sonnet-5", "merged", 12, ctxFor("simple"));
    const p = plan("claude", "complex", { ctx: ctxFor("complex"), graph })!;
    expect(p.model).toBe(entryRung("claude", "complex")!.model);
  });
});

describe("★잔여예산 — 쿼터가 마르면 싼 칸이 유리해진다", () => {
  it("압력 계수는 잔량이 적을수록 커지고, 데이터가 없으면 중립이다", () => {
    expect(costPressureForHeadroom(undefined)).toBe(1);
    expect(costPressureForHeadroom(null)).toBe(1);
    expect(costPressureForHeadroom(10)).toBe(1);
    expect(costPressureForHeadroom(95)).toBeGreaterThan(
      costPressureForHeadroom(60),
    );
  });

  it("잔량이 5% 면 standard 에서 싼 칸이 이기고, 회전/탐색을 사지 않는다", () => {
    for (let i = 0; i < 4; i++) {
      const p = plan("claude", "standard", {
        budgetUsedPercent: 95,
        // 탐색이 걸릴 난수인데도 — 절약 모드에서는 굴리지 않는다.
        epsilon: 1,
        random: () => 0,
      })!;
      expect(p.model).toBe("claude-sonnet-5");
      expect(p.mode).toBe("top-score");
      expect(p.decidedBy).toBe("cost");
    }
  });

  it("잔량이 넉넉하면 종전대로 회전한다(절약 모드는 부족할 때만)", () => {
    const picks = new Set<string>();
    for (let i = 0; i < 4; i++)
      picks.add(plan("claude", "standard", { budgetUsedPercent: 10 })!.model);
    expect(picks.size).toBeGreaterThan(1);
  });
});

describe("관측성 — 근거가 문자열로 남는다", () => {
  it("reason 이 난이도·성분·모드·결정요인을 담는다", () => {
    const p = plan("claude", "simple")!;
    expect(p.reason).toContain("auto-model[simple]");
    expect(p.reason).toContain(p.modelKey);
    expect(p.reason).toMatch(/fit [+-]/);
    expect(p.reason).toMatch(/cost [+-]/);
    expect(p.reason).toMatch(/kg [+-]0\(cold\)/);
    expect(p.reason).toContain("mode=");
    expect(p.reason).toContain("by=");
  });

  it("진입칸을 벗어나면 그 사실이 reason 에 드러난다", () => {
    const ctx = ctxFor("standard");
    const graph = emptyRoutingGraph();
    feed(graph, "claude-sonnet-5", "merged", 12, ctx);
    const p = plan("claude", "standard", { ctx, graph })!;
    expect(p.movedFromEntry).toBe(true);
    expect(p.reason).toContain("claude-opus-5 → claude-sonnet-5");
  });
});
