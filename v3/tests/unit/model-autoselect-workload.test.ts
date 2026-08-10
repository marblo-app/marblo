/**
 * ★트랙A — 로컬 룰베이스 고도화(티켓 Xna0v2mcB3Rn2yE8snb1).
 *
 * 이 파일이 지키는 것은 네 가지다.
 *
 *   1. **워크로드 축** — 티켓 내용(tags·taskType)이 2층 칸 선택을 실제로 움직인다.
 *      종전 2층이 본 난도는 `tier` 하나뿐인데 dispatch 기본값이 `standard` 라,
 *      아키텍처 개편과 오타 수정이 같은 점수판을 받았다.
 *   2. **UCB1 회계** — "관측 1건" 이 dispatch 1건을 뜻한다. 종전엔 맥락 축 개수만큼
 *      부풀려 세어져서 저표본 보너스의 감쇠가 **태그 개수에 따라** 달라졌다.
 *   3. **회전 스트림** — 동률 회전이 맥락(하네스·티어·역할)별로 각자 한 바퀴 돈다.
 *   4. **★불변식: 읽는 셀 = 쓰는 셀** — 계획이 읽은 그 셀에 결과가 쌓인다(#654).
 *
 * ★무회귀 규율: 태그·taskType 이 중립인 dispatch 는 이 티켓 이전과 **같은 점수**를
 * 받아야 한다. 기존 `model-autoselect.test.ts`(220 단언)가 전부 중립 ctx 라 그
 * 파일 자체가 회귀 가드고, 여기서는 그 사실을 명시적으로 한 번 더 못 박는다.
 */
import { describe, it, expect, beforeEach } from "vitest";
import {
  TIE_BAND,
  WORKLOAD_TAG_SATURATION,
  autoCandidates,
  resetAutoSelectRotation,
  selectAutoModel,
  workloadIntensity,
  workloadTagNet,
  type AutoModelPlan,
} from "../../electron/model-autoselect";
import {
  CHEAP_WORKLOAD_TAGS,
  HEAVY_WORKLOAD_TAGS,
  classifyWorkloadTag,
} from "../../electron/workload-tags";
import { costEfficiencyScore } from "../../electron/dispatch-scoring";
import { costIndexForModel, entryRung } from "../../electron/model-ladder";
import { TASK_TYPES } from "../../electron/mcp-server/task-type";
import {
  applyOutcome,
  emptyRoutingGraph,
  factorKeysForContext,
  observationCountForModel,
  type GraphContext,
  type RoutingGraph,
} from "../../electron/routing-graph";

const T0 = Date.parse("2026-07-20T00:00:00Z");
const DAY = 24 * 60 * 60 * 1000;

/** env-swap 크레덴셜이 없는 기기(오늘 대다수) = 종전 3칸 승부. */
const ONLY_ORIGINAL_CLAUDE = new Set([
  "claude-sonnet-5",
  "claude-opus-5",
  "claude-fable-5",
]);
const onlyOriginalClaude = (id: string) => ONLY_ORIGINAL_CLAUDE.has(id);

type Tier = "simple" | "standard" | "complex";

function ctxFor(
  tier: Tier,
  tags: string[] = [],
  taskType = "feature",
  role = "backend",
): GraphContext {
  return { role, complexity: tier, taskType, tags };
}

function plan(
  harness: string,
  tier: Tier,
  extra: Partial<Parameters<typeof selectAutoModel>[0]> = {},
): AutoModelPlan {
  return selectAutoModel({
    harness,
    tier,
    ctx: ctxFor(tier),
    epsilon: 0,
    ...extra,
  })!;
}

function scoreOf(p: AutoModelPlan, model: string) {
  return p.scores.find((s) => s.candidate.model === model)!;
}

function feed(
  graph: RoutingGraph,
  modelKey: string,
  count: number,
  ctx: GraphContext,
): RoutingGraph {
  for (let i = 0; i < count; i++) {
    applyOutcome(graph, {
      model: modelKey,
      mode: "completed",
      ctx,
      taskId: `W-${modelKey}-${i}`,
      agentId: `a-${i}`,
      atMs: T0 + i * DAY,
    });
  }
  return graph;
}

beforeEach(() => {
  resetAutoSelectRotation();
});

// ─────────────────────────────────────────────────────────────────────────
// 1. 어휘 — 1층과 2층이 같은 목록을 읽는다
// ─────────────────────────────────────────────────────────────────────────
describe("★워크로드 태그 어휘는 1층·2층 단일 소스다", () => {
  it("무거운 태그는 2층 intensity 를 올리고 1층 비용효율을 낮춘다", () => {
    const neutral = costEfficiencyScore("gpt", []);
    for (const tag of HEAVY_WORKLOAD_TAGS) {
      expect(classifyWorkloadTag(tag), tag).toBe("heavy");
      expect(workloadIntensity(ctxFor("standard", [tag])), tag).toBeGreaterThan(
        0,
      );
      // 같은 태그가 1층에서도 반응한다 — 목록이 갈라지면 이 단언이 깨진다.
      expect(costEfficiencyScore("gpt", [tag]), tag).toBeLessThan(neutral);
    }
  });

  it("가벼운 태그는 반대 방향으로 같은 관계를 갖는다", () => {
    const neutral = costEfficiencyScore("gpt", []);
    for (const tag of CHEAP_WORKLOAD_TAGS) {
      expect(classifyWorkloadTag(tag), tag).toBe("cheap");
      expect(workloadIntensity(ctxFor("standard", [tag])), tag).toBeLessThan(0);
      expect(costEfficiencyScore("gpt", [tag]), tag).toBeGreaterThan(neutral);
    }
  });

  it("자유입력이라 대소문자·공백을 정규화한다(양쪽 층 동시에)", () => {
    expect(classifyWorkloadTag("  Simple-Fix ")).toBe("cheap");
    expect(workloadIntensity(ctxFor("standard", [" ARCHITECTURE "]))).toBe(0.5);
    expect(costEfficiencyScore("gpt", ["Simple-Fix"])).toBeGreaterThan(
      costEfficiencyScore("gpt", []),
    );
  });

  it("모르는 태그·비문자열은 중립이다(추측 금지)", () => {
    expect(classifyWorkloadTag("marketing")).toBeNull();
    expect(classifyWorkloadTag(42)).toBeNull();
    expect(classifyWorkloadTag(undefined)).toBeNull();
    expect(
      workloadIntensity(ctxFor("standard", ["marketing", "routing"])),
    ).toBe(0);
    // ctx 자체가 이상해도 0 = 종전 동작(fail-safe).
    expect(workloadIntensity(undefined)).toBe(0);
    expect(
      workloadIntensity({ tags: "architecture" as unknown as string[] }),
    ).toBe(0);
  });

  it("태그가 상쇄되면 0, 한쪽으로 모여도 ±1 에서 포화한다", () => {
    expect(
      workloadIntensity(ctxFor("standard", ["architecture", "quick-edit"])),
    ).toBe(0);
    const many = [
      "architecture",
      "multi-file",
      "large-context",
      "complex-edit",
    ];
    expect(workloadTagNet(ctxFor("standard", many))).toBe(many.length);
    expect(workloadIntensity(ctxFor("standard", many))).toBe(1);
    expect(
      workloadIntensity(
        ctxFor("standard", many.slice(0, WORKLOAD_TAG_SATURATION)),
      ),
    ).toBe(1);
  });
});

describe("★taskType 사전값은 docs/chore 에만, 그리고 약하다", () => {
  it("docs·chore 만 가볍고 나머지 5종은 일부러 중립이다", () => {
    for (const type of TASK_TYPES) {
      const intensity = workloadIntensity(ctxFor("standard", [], type));
      if (type === "docs" || type === "chore") {
        expect(intensity, type).toBeLessThan(0);
        // 태그 하나(±0.5)보다 세지 않다 — 추론 라벨이 선언을 이기면 안 된다.
        expect(Math.abs(intensity), type).toBeLessThanOrEqual(
          1 / WORKLOAD_TAG_SATURATION,
        );
      } else {
        expect(intensity, type).toBe(0);
      }
    }
  });

  it("태그와 사전값은 더해진다 — '설계문서 개편' 이 그냥 문서가 되지 않는다", () => {
    // architecture(+0.5) + docs(-0.5) = 0 이 아니라… 각각 살아서 합쳐진다.
    const archDocs = workloadIntensity(
      ctxFor("standard", ["architecture", "multi-file"], "docs"),
    );
    const plainDocs = workloadIntensity(ctxFor("standard", [], "docs"));
    expect(archDocs).toBeGreaterThan(0);
    expect(plainDocs).toBeLessThan(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// 2. 무회귀 — 중립 ctx 는 종전과 같은 점수판
// ─────────────────────────────────────────────────────────────────────────
describe("★무회귀 — 태그·taskType 이 중립이면 이 티켓 이전과 같다", () => {
  it("모든 하네스·티어에서 workload 성분이 정확히 0 이다", () => {
    for (const harness of ["claude", "gpt", "grok"]) {
      for (const tier of ["simple", "standard", "complex"] as const) {
        resetAutoSelectRotation();
        const p = plan(harness, tier);
        expect(
          p.scores.every((s) => s.workload === 0),
          `${harness}/${tier}`,
        ).toBe(true);
        expect(p.reason, `${harness}/${tier}`).not.toContain("workload");
      }
    }
  });

  it("tags 미지정과 빈 배열이 같은 결정을 낸다", () => {
    resetAutoSelectRotation();
    const empty = plan("claude", "standard", {
      ctx: ctxFor("standard", []),
      modelAvailable: onlyOriginalClaude,
    });
    resetAutoSelectRotation();
    const absent = plan("claude", "standard", {
      ctx: { role: "backend", complexity: "standard", taskType: "feature" },
      modelAvailable: onlyOriginalClaude,
    });
    expect(absent.modelKey).toBe(empty.modelKey);
    expect(absent.reason).toBe(empty.reason);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// 3. 워크로드가 실제로 칸을 움직인다 — 그러나 티어 안전선은 못 넘는다
// ─────────────────────────────────────────────────────────────────────────
describe("★standard — 티켓 내용이 opus5 편중을 가른다", () => {
  it("가벼운 태그면 더 싼 칸이 진입칸을 이긴다", () => {
    const p = plan("claude", "standard", {
      ctx: ctxFor("standard", ["quick-edit", "boilerplate"]),
      modelAvailable: onlyOriginalClaude,
    });
    const entry = entryRung("claude", "standard")!.model;
    const top = p.scores[0];
    expect(top.candidate.model).toBe("claude-sonnet-5");
    expect(top.total).toBeGreaterThan(scoreOf(p, entry).total);
    expect(costIndexForModel(top.candidate.model)!).toBeLessThan(
      costIndexForModel(entry)!,
    );
    expect(top.workload).toBeGreaterThan(0);
  });

  it("★무거운 태그면 싼 칸이 **동률 밴드 밖**으로 밀린다 — 회전으로도 안 뽑힌다", () => {
    const ctx = ctxFor("standard", ["architecture", "multi-file"]);
    const p = plan("claude", "standard", {
      ctx,
      modelAvailable: onlyOriginalClaude,
    });
    const entry = scoreOf(p, entryRung("claude", "standard")!.model);
    const cheap = scoreOf(p, "claude-sonnet-5");
    expect(entry.total - cheap.total).toBeGreaterThan(TIE_BAND);

    // 그래서 연속 dispatch 가 전부 진입칸이다(종전엔 여기가 회전 구간이었다).
    const picks = new Set<string>();
    for (let i = 0; i < 6; i++) {
      picks.add(
        plan("claude", "standard", { ctx, modelAvailable: onlyOriginalClaude })
          .model,
      );
    }
    expect([...picks]).toEqual(["claude-opus-5"]);
  });

  it("decidedBy·reason 이 그 근거를 이름으로 말한다", () => {
    const p = plan("claude", "standard", {
      ctx: ctxFor("standard", ["quick-edit", "boilerplate"]),
      modelAvailable: onlyOriginalClaude,
    });
    const winner = p.scores.find((s) => s.candidate.modelKey === p.modelKey)!;
    expect(winner.workload).not.toBe(0);
    expect(p.reason).toMatch(/workload [+-]/);
  });
});

describe("★티어 안전선 — 태그가 난도 정책의 뒷문이 되지 않는다", () => {
  it("simple 은 무거운 태그로도 상향되지 않는다(비용 폭발 금지)", () => {
    const p = plan("claude", "simple", {
      ctx: ctxFor("simple", ["architecture", "multi-file", "large-context"]),
      modelAvailable: onlyOriginalClaude,
    });
    expect(p.model).toBe(entryRung("claude", "simple")!.model);
    expect(p.movedFromEntry).toBe(false);
  });

  it("complex 는 가벼운 태그로도 무너지지 않는다(재작업이 절약분보다 비싸다)", () => {
    const p = plan("claude", "complex", {
      ctx: ctxFor("complex", ["quick-edit", "boilerplate", "simple-fix"]),
    });
    expect(p.model).toBe("claude-fable-5");
    expect(p.movedFromEntry).toBe(false);
  });

  it("★먼 칸에서는 신호가 더 자라지 않는다(2칸 상한) — 사다리 바닥으로 미끄러지지 않는다", () => {
    const p = plan("claude", "simple", {
      ctx: ctxFor("simple", ["quick-edit", "boilerplate"]),
    });
    const { candidates, entryIndex } = autoCandidates("claude", "simple");
    const magnitudes = new Map<number, number>();
    for (const s of p.scores) {
      const steps = Math.abs(s.candidate.index - entryIndex);
      magnitudes.set(steps, Math.abs(s.workload));
    }
    const twoSteps = magnitudes.get(2);
    expect(twoSteps).toBeGreaterThan(0);
    for (const [steps, magnitude] of magnitudes) {
      if (steps <= 2) continue;
      expect(magnitude, `${steps}칸`).toBe(twoSteps);
    }
    expect(candidates.length).toBeGreaterThan(3); // 상한이 실제로 걸리는 사다리
  });
});

describe("★gpt 진입칸 보류 — 선언은 열고 추론은 못 연다", () => {
  it("추론 taskType(docs) 만으로는 진입칸을 놓지 않는다", () => {
    const p = plan("gpt", "standard", {
      ctx: ctxFor("standard", [], "docs"),
    });
    expect(p.model).toBe(entryRung("gpt", "standard")!.model);
    expect(p.effort).toBe(entryRung("gpt", "standard")!.effort);
    expect(p.movedFromEntry).toBe(false);
  });

  it("명시 태그가 있으면 그 근거로 칸이 움직인다", () => {
    const p = plan("gpt", "standard", {
      ctx: ctxFor("standard", ["quick-edit", "boilerplate"]),
    });
    expect(p.model).toBe("gpt-5.6-luna");
    expect(p.movedFromEntry).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// 4. UCB1 회계 — 관측 1건 = dispatch 1건
// ─────────────────────────────────────────────────────────────────────────
describe("★UCB1 회계 — 저표본 보너스가 태그 개수에 흔들리지 않는다", () => {
  it("observations 가 dispatch 환산이다(셀 합계가 아니라)", () => {
    const ctx = ctxFor("standard");
    const graph = feed(emptyRoutingGraph(), "claude-opus-5", 6, ctx);
    // 그래프 자체는 맥락 축마다 한 셀씩 기록한다 — 원시 합계는 6 이 아니다.
    const factors = factorKeysForContext(ctx).length;
    expect(observationCountForModel("claude-opus-5", ctx, graph)).toBe(
      6 * factors,
    );

    const p = plan("claude", "standard", { ctx, graph });
    expect(scoreOf(p, "claude-opus-5").observations).toBe(6);
  });

  it("★같은 dispatch 수라면 태그가 몇 개든 같은 보너스가 나온다", () => {
    const bare = ctxFor("standard", []);
    const tagged = ctxFor("standard", ["routing", "telemetry", "board"]);
    const bareGraph = feed(emptyRoutingGraph(), "claude-opus-5", 6, bare);
    const taggedGraph = feed(emptyRoutingGraph(), "claude-opus-5", 6, tagged);

    const a = scoreOf(
      plan("claude", "standard", { ctx: bare, graph: bareGraph }),
      "claude-opus-5",
    );
    const b = scoreOf(
      plan("claude", "standard", { ctx: tagged, graph: taggedGraph }),
      "claude-opus-5",
    );
    expect(b.observations).toBe(a.observations);
    expect(b.diversity).toBe(a.diversity);
  });

  it("★상수의 근거와 코드가 같은 말을 한다 — n=0, dispatch 10건에서 약 +6점", () => {
    const ctx = ctxFor("standard");
    const graph = feed(emptyRoutingGraph(), "claude-opus-5", 10, ctx);
    const p = plan("claude", "standard", {
      ctx,
      graph,
      modelAvailable: onlyOriginalClaude,
    });
    const cold = scoreOf(p, "claude-sonnet-5");
    expect(cold.observations).toBe(0);
    expect(cold.diversity).toBeGreaterThan(5.5);
    expect(cold.diversity).toBeLessThan(7);
  });
});

describe("★저표본 보너스도 ε-greedy 와 같은 근접창 규율을 받는다", () => {
  it("관측이 같아도 먼 칸은 이웃 칸보다 적게 끌어올려진다", () => {
    const ctx = ctxFor("standard");
    const graph = feed(emptyRoutingGraph(), "claude-opus-5", 10, ctx);
    const p = plan("claude", "standard", { ctx, graph });
    const { entryIndex } = autoCandidates("claude", "standard");
    const near = p.scores.find(
      (s) => Math.abs(s.candidate.index - entryIndex) === 1,
    )!;
    const far = p.scores.find(
      (s) => Math.abs(s.candidate.index - entryIndex) >= 3,
    )!;
    expect(near.observations).toBe(0);
    expect(far.observations).toBe(0);
    expect(far.diversity).toBeGreaterThan(0); // 끊지는 않는다
    expect(far.diversity).toBeLessThan(near.diversity);
  });

  it("절약 국면(잔량 50% 미만)에서는 보너스를 아예 사지 않는다", () => {
    const ctx = ctxFor("standard");
    const graph = feed(emptyRoutingGraph(), "claude-opus-5", 10, ctx);
    const rich = plan("claude", "standard", {
      ctx,
      graph,
      budgetUsedPercent: 10,
    });
    const poor = plan("claude", "standard", {
      ctx,
      graph,
      budgetUsedPercent: 95,
    });
    expect(rich.scores.some((s) => s.diversity > 0)).toBe(true);
    expect(poor.scores.every((s) => s.diversity === 0)).toBe(true);
    expect(poor.mode).toBe("top-score");
  });
});

// ─────────────────────────────────────────────────────────────────────────
// 5. 회전 스트림 — 맥락별로 각자 한 바퀴
// ─────────────────────────────────────────────────────────────────────────
describe("★동률 회전은 맥락(하네스·티어·역할)별 스트림이다", () => {
  it("다른 역할의 dispatch 가 내 회전을 밀지 않는다", () => {
    const backend: string[] = [];
    const soloBackend: string[] = [];

    // (a) backend 만 4번
    resetAutoSelectRotation();
    for (let i = 0; i < 4; i++) {
      soloBackend.push(
        plan("claude", "standard", {
          ctx: ctxFor("standard", [], "feature", "backend"),
          modelAvailable: onlyOriginalClaude,
        }).modelKey,
      );
    }

    // (b) backend 와 frontend 를 번갈아 — backend 가 보는 순서는 (a) 와 같아야 한다.
    resetAutoSelectRotation();
    for (let i = 0; i < 4; i++) {
      backend.push(
        plan("claude", "standard", {
          ctx: ctxFor("standard", [], "feature", "backend"),
          modelAvailable: onlyOriginalClaude,
        }).modelKey,
      );
      plan("claude", "standard", {
        ctx: ctxFor("standard", [], "feature", "frontend"),
        modelAvailable: onlyOriginalClaude,
      });
    }
    expect(backend).toEqual(soloBackend);
    expect(new Set(backend).size).toBeGreaterThan(1); // 회전 자체는 살아 있다
  });

  it("티어가 다르면 스트림도 다르다(같은 역할이라도)", () => {
    resetAutoSelectRotation();
    const first = plan("claude", "standard", {
      modelAvailable: onlyOriginalClaude,
    }).modelKey;
    plan("claude", "simple", { modelAvailable: onlyOriginalClaude });
    const second = plan("claude", "standard", {
      modelAvailable: onlyOriginalClaude,
    }).modelKey;
    // simple 한 판이 끼어들어도 standard 스트림은 자기 두 번째 칸으로 간다.
    expect(second).not.toBe(first);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// 6. ★불변식 — 읽는 셀 = 쓰는 셀 (#654 재발 방지)
// ─────────────────────────────────────────────────────────────────────────
describe("★읽는 셀 = 쓰는 셀", () => {
  it("계획이 고른 칸으로 결과를 쓰면 그 칸의 관측만 오른다", () => {
    for (const harness of ["claude", "gpt", "grok"]) {
      for (const tier of ["simple", "standard", "complex"] as const) {
        resetAutoSelectRotation();
        const ctx = ctxFor(tier, ["architecture"], "feature");
        const graph = emptyRoutingGraph();
        const before = selectAutoModel({
          harness,
          tier,
          ctx,
          graph,
          epsilon: 0,
        })!;

        // 스폰 결과는 계획이 고른 그 키로 기록된다(graph-updater 경로와 같은 키).
        feed(graph, before.modelKey, 3, ctx);

        const after = selectAutoModel({
          harness,
          tier,
          ctx,
          graph,
          epsilon: 0,
        })!;
        const chosen = after.scores.find(
          (s) => s.candidate.modelKey === before.modelKey,
        )!;
        expect(chosen.observations, `${harness}/${tier}`).toBe(3);
        for (const s of after.scores) {
          if (s.candidate.modelKey === before.modelKey) continue;
          expect(
            s.observations,
            `${harness}/${tier}:${s.candidate.modelKey}`,
          ).toBe(0);
        }
        expect(after.coldStart, `${harness}/${tier}`).toBe(false);
      }
    }
  });

  it("워크로드 신호가 켜져도 조회 키는 그대로 model@effort 다", () => {
    const heavy = plan("gpt", "standard", {
      ctx: ctxFor("standard", ["architecture", "multi-file"]),
    });
    const light = plan("gpt", "standard", {
      ctx: ctxFor("standard", ["quick-edit", "boilerplate"]),
    });
    for (const p of [heavy, light]) {
      expect(p.modelKey).toBe(
        p.effort
          ? `${p.model}@${p.effort}`.toLowerCase()
          : p.model.toLowerCase(),
      );
    }
  });
});
