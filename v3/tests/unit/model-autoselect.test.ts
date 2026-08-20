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
  subscriptionCostScaleForHeadroom,
  resolveEpsilon,
  modelGuidance,
  DEFAULT_EPSILON,
  effectiveCostIndexForModel,
  applyBudgetUsedFloor,
} from "../../electron/model-autoselect";
import { costIndexForModel, entryRung } from "../../electron/model-ladder";
import { MODEL_PRESETS } from "../../electron/dispatch-scoring";
import { formatModelKey } from "../../electron/routing-model-key";
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

/**
 * ★hyKsSYYM(env-swap 자동선택 편입) 이전의 claude 후보 3칸. 크레덴셜 없는
 * 기기(=GLM/MiniMax/Kimi 키 미등록, 오늘 대다수 기기의 실제 상태)에서
 * `modelAvailable`(vendorEnvReadiness) 이 걸러내는 결과와 **정확히 같은 집합**이다.
 * 아래 "★자기강화 루프"·"★잔여예산" 류 테스트는 KG·예산압력 **메커니즘** 을
 * 검증하는 것이지 "어떤 벤더가 후보냐" 를 검증하는 게 아니라서, 이 필터로
 * env-swap 편입 이전과 동일한 승부 구도를 재현해 원래 단언을 그대로 지킨다.
 */
const ONLY_ORIGINAL_CLAUDE = new Set([
  "claude-sonnet-5",
  "claude-opus-5",
  "claude-fable-5",
]);
const onlyOriginalClaude = (id: string) => ONLY_ORIGINAL_CLAUDE.has(id);

function ctxFor(
  complexity: "simple" | "standard" | "complex",
  taskType = "feature"
): GraphContext {
  return { role: "backend", complexity, taskType, tags: [] };
}

/** 한 칸(modelKey)에 같은 결과를 n 번 먹인다. */
function feed(
  graph: RoutingGraph,
  modelKey: string,
  mode: OutcomeMode,
  count: number,
  ctx: GraphContext
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
  extra: Partial<Parameters<typeof selectAutoModel>[0]> = {}
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
  it("claude 는 사다리 칸 그대로(모델 축을 실제로 핀한다) — hyKsSYYM 이후 env-swap 칸도 구조적으로 후보다", () => {
    const { candidates, pinsModel, entryIndex } = autoCandidates(
      "claude",
      "standard"
    );
    expect(pinsModel).toBe(true);
    // ★키 유무는 여기서 걸러지지 않는다(구조 단계) — `modelAvailable` 없이 부르면
    // 사다리의 모든 칸이 후보다. 크레덴셜 필터는 selectAutoModel 호출자 몫
    // (아래 "★가용성" describe, bridge-server 의 vendorEnvReadiness 배선).
    expect(candidates.map((c) => c.model)).toEqual([
      "MiniMax-M2.7",
      "glm-4.7",
      "kimi-for-coding",
      "claude-sonnet-5",
      "claude-opus-5",
      "MiniMax-M3",
      "glm-5.2",
      "k3",
      "k3-256k",
      "claude-fable-5",
    ]);
    // 진입칸은 사다리가 말하는 그 칸이다(여기서 순서를 새로 만들지 않는다) —
    // env-swap 이 편입돼도 entry 는 여전히 claude-opus-5.
    expect(candidates[entryIndex].model).toBe(
      entryRung("claude", "standard")!.model
    );
    expect(candidates[entryIndex].model).toBe("claude-opus-5");
  });

  it("★codex 는 gpt-5.6 변종 칸을 실제 모델 핀 후보로 올린다", () => {
    const { candidates, pinsModel, entryIndex } = autoCandidates(
      "gpt",
      "standard"
    );
    expect(pinsModel).toBe(true);
    expect(candidates[entryIndex].model).toBe("gpt-5.6-terra");
    expect(candidates[entryIndex].effort).toBe("medium");
    expect(new Set(candidates.map((c) => c.model))).toEqual(
      new Set(["gpt-5.6-luna", "solar-pro4", "gpt-5.6-terra", "gpt-5.6-sol"])
    );
  });

  it("★승인게이트 칸(max/ultra)은 자동선택 후보가 아니다", () => {
    for (const harness of ["claude", "gpt"]) {
      for (const tier of ["simple", "standard", "complex"] as const) {
        const { candidates } = autoCandidates(harness, tier);
        expect(candidates.some((c) => isApprovalGatedEffort(c.effort))).toBe(
          false
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
    // 에서 되읽은 모델 id 라 읽기·쓰기가 갈렸다.
    const p = plan("grok", "complex")!;
    expect(p).not.toBeNull();
    expect(p.modelKey).toBe("grok-4.6");
    expect(p.pinsModel).toBe(true);
    expect(p.mode).toBe("single");
    // 진입칸을 벗어나지 않는다 = 스폰 argv 가 기본값(`-m grok-4.6`)과 같다.
    expect(p.movedFromEntry).toBe(false);
  });
});

describe("★단순 → 저단가", () => {
  it("simple claude 는 후보 중 effective 단가가 가장 싼 구독 칸을 고른다", () => {
    const p = plan("claude", "simple")!;
    const costs = p.scores.map(
      (s) => effectiveCostIndexForModel(s.candidate.model)!
    );
    expect(effectiveCostIndexForModel(p.model)).toBe(Math.min(...costs));
    expect(p.model).toBe("claude-sonnet-5");
    expect(p.mode).toBe("top-score");
  });

  it("simple gpt 는 가장 낮은 effort 칸을 고른다(토큰 소모가 최소)", () => {
    const p = plan("gpt", "simple")!;
    expect(p.model).toBe("gpt-5.6-luna");
    expect(p.effort).toBe("low");
    expect(p.pinsModel).toBe(true);
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
    expect(p.model).toBe("gpt-5.6-sol");
    expect(p.effort).toBe(entryRung("gpt", "complex")!.effort);
  });

  it("standard gpt 콜드스타트는 terra 진입칸을 유지한다", () => {
    const p = plan("gpt", "standard")!;
    expect(p.model).toBe("gpt-5.6-terra");
    expect(p.effort).toBe("medium");
    expect(p.movedFromEntry).toBe(false);
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

  it("연속 dispatch 가 한 칸에 고이지 않는다 — 더 싼 칸이 실제로 뽑힌다(env-swap 키 없는 기기, 무회귀)", () => {
    const picks = new Set<string>();
    for (let i = 0; i < 6; i++)
      picks.add(
        plan("claude", "standard", { modelAvailable: onlyOriginalClaude })!
          .model
      );
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
      false
    );
  });

  it("전부 못 쓰면 계획이 없다(호출자가 종전 경로로 떨어진다)", () => {
    expect(
      plan("claude", "standard", { modelAvailable: () => false })
    ).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────
// ★hyKsSYYM — env-swap 벤더(키 있으면) 자동선택 편입, 사장님 A안.
//
// 불변경계 3개:
//   1. 워커 자동선택에만 연다(오케 영구선택은 별도 — model-selection 계열 테스트).
//   2. 키 있는 것만 후보다. `modelAvailable = vendorEnvReadiness(id).ready` 가
//      이미 있어(bridge-server.ts 배선) 키 없는 env-swap 은 여기서 걸러진다.
//   3. 읽는 셀 = 쓰는 셀 — `plan.modelKey` 가 곧 그래프 조회/기록 키이자
//      스폰이 실제로 핀하는 모델 id(pinsModel=true 이므로 argv 도 같은 id).
// ─────────────────────────────────────────────────────────────────────────
describe("★env-swap 자동선택 편입(hyKsSYYM, 사장님 A안)", () => {
  const ENV_SWAP_IDS = [
    "glm-5.2",
    "glm-4.7",
    "MiniMax-M3",
    "MiniMax-M2.7",
    "k3",
    "k3-256k",
    "kimi-for-coding",
  ] as const;

  it("키 있으면(vendorEnvReadiness.ready) simple/standard 후보에 env-swap 이 뜬다", () => {
    for (const tier of ["simple", "standard"] as const) {
      const p = plan("claude", tier)!;
      const modelsInScores = new Set(p.scores.map((s) => s.candidate.model));
      const present = ENV_SWAP_IDS.filter((id) => modelsInScores.has(id));
      expect(
        present.length,
        `${tier} 티어 scores 에 env-swap 후보가 하나도 없다`
      ).toBeGreaterThan(0);
    }
  });

  it("키 없으면(vendorEnvReadiness.ready=false) 같은 env-swap 이 후보에서 빠진다", () => {
    for (const tier of ["simple", "standard"] as const) {
      const p = plan("claude", tier, { modelAvailable: onlyOriginalClaude })!;
      const modelsInScores = new Set(p.scores.map((s) => s.candidate.model));
      for (const id of ENV_SWAP_IDS) {
        expect(modelsInScores.has(id), `${tier}: ${id} 가 키 없이도 떴다`).toBe(
          false
        );
      }
      // 무회귀: 키가 없으면 종전 3칸(sonnet5/opus5/fable5)만 경쟁한다.
      expect([...modelsInScores].every((m) => onlyOriginalClaude(m))).toBe(
        true
      );
    }
  });

  it("★양쪽 분기가 vendorEnvReadiness 토글 하나로 갈린다(#660 게이트와 이중 안전)", () => {
    // glm-5.2 하나로 대표 검증한다 — 실전 배선(bridge-server.ts)은 이 콜백
    // 자리에 정확히 `(modelId) => vendorEnvReadiness(modelId).ready` 를 넣는다.
    let glmReady = false;
    const modelAvailable = (id: string) => (id === "glm-5.2" ? glmReady : true);

    const withoutKey = plan("claude", "standard", { modelAvailable })!;
    expect(withoutKey.scores.some((s) => s.candidate.model === "glm-5.2")).toBe(
      false
    );

    glmReady = true;
    const withKey = plan("claude", "standard", { modelAvailable })!;
    expect(withKey.scores.some((s) => s.candidate.model === "glm-5.2")).toBe(
      true
    );
  });

  it("OpenAI 호환 env-swap(Solar) 도 gpt 후보에서 같은 가용성 게이트를 탄다", () => {
    let solarReady = false;
    const modelAvailable = (id: string) =>
      id === "solar-pro4" ? solarReady : true;

    const withoutKey = plan("gpt", "standard", { modelAvailable })!;
    expect(
      withoutKey.scores.some((s) => s.candidate.model === "solar-pro4")
    ).toBe(false);

    solarReady = true;
    const withKey = plan("gpt", "standard", { modelAvailable })!;
    expect(withKey.scores.some((s) => s.candidate.model === "solar-pro4")).toBe(
      true
    );
  });

  it("구독 쿼터가 넉넉하면 simple 은 env-swap 실단가보다 구독 칸을 우선한다", () => {
    const p = plan("claude", "simple")!;
    expect(p.model).toBe("claude-sonnet-5");
    expect(effectiveCostIndexForModel(p.model)).toBeLessThan(
      costIndexForModel("MiniMax-M2.7")!
    );
  });

  it("complex 는 SWE·비대칭감점(#654)으로 claude 프론티어(fable5)가 env-swap 을 이긴다", () => {
    const p = plan("claude", "complex")!;
    expect(p.model).toBe("claude-fable-5");
    expect(p.movedFromEntry).toBe(false);
    // env-swap 후보 전부가 fable5 보다 낮은 점수라는 것 — 강제가 아니라 점수.
    const fableScore = p.scores.find(
      (s) => s.candidate.model === "claude-fable-5"
    )!;
    for (const id of ENV_SWAP_IDS) {
      const s = p.scores.find((s) => s.candidate.model === id);
      if (!s) continue;
      expect(s.total, `${id} 가 fable5 를 이겼다`).toBeLessThan(
        fableScore.total
      );
    }
  });

  it("구독 쿼터가 마르면 env-swap 이 overflow 로 이기고 modelKey 가 그 모델 id 에서 파생된다", () => {
    const p = plan("claude", "simple", { budgetUsedPercent: 95 })!;
    expect(p.model).toBe("MiniMax-M2.7");
    expect(p.pinsModel).toBe(true);
    expect(p.effort).toBeUndefined();
    // ★formatModelKey 는 그래프 키를 소문자로 정규화한다(routing-model-key.ts) —
    // 하네스 인자 핀(`--model MiniMax-M2.7`, agent-config 의 원본 대소문자 보존)과
    // 그래프 조회/기록 키는 별개 축이다. 여기서 보는 것은 "같은 스폰이 같은 셀을
    // 읽고 쓴다" 는 것이지 대소문자 보존이 아니다.
    expect(p.modelKey).toBe(formatModelKey("MiniMax-M2.7"));
    expect(p.modelKey).toBe("minimax-m2.7");
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
      (c) =>
        c.model === entryRung("gpt", "complex")!.model &&
        c.effort === entryRung("gpt", "complex")!.effort
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
      }))
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
        rep && typeof rep.score === "number" ? rep.score : undefined
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
          ].model
        );
        for (const s of p.scores) {
          if (s.bench === 0) continue;
          expect(modelGuidance(s.candidate.model)!.benchmark).toBe(
            entry!.benchmark
          );
        }
      }
    }
  });
});

describe("★자기강화 루프 — 관측이 선택을 바꾼다", () => {
  // ★env-swap 키 없는 기기(onlyOriginalClaude)로 좁혀서 KG 피드백 **메커니즘**
  // 자체를 검증한다 — "어떤 벤더가 후보냐" 는 위 "★env-swap 자동선택 편입"
  // describe 가 이미 딴다. 필터 없이 두면 glm-5.2 류가 정적 단가만으로 이미
  // sonnet5 를 이겨서, 여기서 보려는 "KG 가 쌓이면 진입칸을 뒤집는다" 는
  // 인과관계가 가려진다.
  it("싼 칸이 성공을 쌓으면 그 칸이 진입칸을 이긴다", () => {
    const ctx = ctxFor("standard");
    const graph = emptyRoutingGraph();
    feed(graph, "claude-sonnet-5", "merged", 12, ctx);
    const p = plan("claude", "standard", {
      ctx,
      graph,
      modelAvailable: onlyOriginalClaude,
    })!;
    expect(p.model).toBe("claude-sonnet-5");
    expect(p.coldStart).toBe(false);
    expect(
      p.scores.find((s) => s.candidate.model === "claude-sonnet-5")!.kg
    ).toBeGreaterThan(0);
  });

  it("싼 칸이 실패를 쌓으면 진입칸이 단독으로 이긴다(동률 회전도 멈춘다)", () => {
    const ctx = ctxFor("standard");
    const graph = emptyRoutingGraph();
    feed(graph, "claude-sonnet-5", "review_rejected", 12, ctx);
    const picks = new Set<string>();
    for (let i = 0; i < 4; i++)
      picks.add(
        plan("claude", "standard", {
          ctx,
          graph,
          modelAvailable: onlyOriginalClaude,
        })!.model
      );
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
      costPressureForHeadroom(60)
    );
  });

  it("잔량이 5% 면 standard 에서 싼 칸이 이기고, 회전/탐색을 사지 않는다", () => {
    // env-swap 키 없는 기기로 좁혀 종전 sonnet5 vs opus5 승부를 재현한다(무회귀).
    for (let i = 0; i < 4; i++) {
      const p = plan("claude", "standard", {
        budgetUsedPercent: 95,
        // 탐색이 걸릴 난수인데도 — 절약 모드에서는 굴리지 않는다.
        epsilon: 1,
        random: () => 0,
        modelAvailable: onlyOriginalClaude,
      })!;
      expect(p.model).toBe("claude-sonnet-5");
      expect(p.mode).toBe("top-score");
      expect(p.decidedBy).toBe("cost");
    }
  });

  it("잔량이 넉넉하면 종전대로 회전한다(절약 모드는 부족할 때만)", () => {
    const picks = new Set<string>();
    for (let i = 0; i < 4; i++)
      picks.add(
        plan("claude", "standard", {
          budgetUsedPercent: 10,
          modelAvailable: onlyOriginalClaude,
        })!.model
      );
    expect(picks.size).toBeGreaterThan(1);
  });

  // ── ★P2 튜닝(티켓 Aki3gavI) — 잔여량을 '주요 팩터'로 ────────────────
  //
  // 라이브 실측(dist-electron, claude 실 usage-probe 60% 사용)에서 나온 두 결함을
  // 잠근다: (a) 잔여 25~50% 가 scale 0.08 로 평평해 아무 칸도 안 움직이던 죽은
  // 구간, (b) 잔여 20% 에서 한 번에 터지던 절벽. 곡선을 연속·단조로 만들되
  // **잔여 50% 이상은 종전 값 그대로**(과반응 금지)여야 한다.

  it("★잔여 50% 이상은 종전과 동일하다 — 넉넉할 땐 쿼터가 발언권을 갖지 않는다", () => {
    // 종전 구간상수의 마디값. 이 구간이 움직이면 '평소엔 능력/단가가 주도'가 깨진다.
    for (const used of [0, 10, 25, 40, 50]) {
      expect(subscriptionCostScaleForHeadroom(used)).toBe(0.02);
      expect(costPressureForHeadroom(used)).toBe(1);
    }
  });

  it("★스케일·압력은 잔여가 줄수록 단조 증가하고 절벽이 없다", () => {
    let prevScale = -Infinity;
    let prevPressure = -Infinity;
    // used 오름차순 = 잔여 내림차순.
    for (let used = 0; used <= 100; used++) {
      const scale = subscriptionCostScaleForHeadroom(used);
      const pressure = costPressureForHeadroom(used);
      expect(scale).toBeGreaterThanOrEqual(prevScale);
      expect(pressure).toBeGreaterThanOrEqual(prevPressure);
      // 1%p 만에 2배 넘게 뛰는 지점이 없어야 한다(= 절벽 없음). 종전 구간상수는
      // 잔여 25→24 에서 0.08→0.35(4.4배)로 뛰었다.
      if (prevScale > 0) expect(scale / prevScale).toBeLessThan(2);
      prevScale = scale;
      prevPressure = pressure;
    }
  });

  it("★잔여 25% 마디가 종전 <25% 값에 도달한다 — '25%부터 체감'", () => {
    // 종전엔 잔여 25% 에서 0.08(죽은 구간)이었고 0.35 는 잔여 10~25% 에서야 닿았다.
    expect(subscriptionCostScaleForHeadroom(75)).toBeCloseTo(0.35, 5);
    // 잔여 40% 는 그 중간 어딘가 — 평평하지도(0.02), 다 오르지도(0.35) 않는다.
    const mid = subscriptionCostScaleForHeadroom(60);
    expect(mid).toBeGreaterThan(0.02);
    expect(mid).toBeLessThan(0.35);
  });

  it("★잔여 25% 에서 standard 진입칸(opus5)이 실제로 밀린다 — 종전엔 잔여 20% 까지 안 밀렸다", () => {
    const at25 = plan("claude", "standard", { budgetUsedPercent: 75 })!;
    expect(costIndexForModel(at25.model)!).toBeLessThan(
      costIndexForModel(entryRung("claude", "standard")!.model)!
    );
    // 그런데 잔여 40% 에서는 아직 진입칸을 지킨다(과반응 금지 경계).
    const at40 = plan("claude", "standard", { budgetUsedPercent: 60 })!;
    expect(at40.model).toBe(entryRung("claude", "standard")!.model);
  });

  it("★키 있으면 잔량이 말라도 env-swap 최저단가 칸이 sonnet5 보다 더 유리하다", () => {
    // 절약 모드는 단가 가중치를 키운다(costPressureForHeadroom) — env-swap 이
    // 후보면 그 압력이 sonnet5 가 아니라 더 싼 벤더 칸으로 쏠려야 한다.
    const p = plan("claude", "standard", {
      budgetUsedPercent: 95,
      epsilon: 0,
    })!;
    expect(p.mode).toBe("top-score");
    expect(costIndexForModel(p.model)!).toBeLessThan(
      costIndexForModel("claude-sonnet-5")!
    );
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
    const p = plan("claude", "standard", {
      ctx,
      graph,
      modelAvailable: onlyOriginalClaude,
    })!;
    expect(p.movedFromEntry).toBe(true);
    expect(p.reason).toContain("claude-opus-5 → claude-sonnet-5");
  });
});

// ─────────────────────────────────────────────────────────────────────────
// ★벤더모델 후보풀 · SWE/단가/능력 경로 감사 가드 (5k94HAnWJsYc9qYC2IwD)
//
// 경로 추적(후보가 어디서 오고 어디서 빠지나):
//   MODEL_REGISTRY(active)
//     → model-ladder CLAUDE_RUNGS / GPT_RUNGS / GROK_RUNGS
//     → autoCandidates(harness, tier)  // 승인게이트 max/ultra 제외
//     → selectAutoModel 의 modelAvailable(vendorEnvReadiness)  // 키 없으면 제외
//     → 점수: fit(사다리거리) + cost(단가 log2) + bench|capability + kg + diversity
//   antigravity/gemini: 사다리 없음 → selectAutoModel=null (레지스트리 행 없음)
//   guidance 는 modelGuidanceStatic() ← registry+bench-reference 조인(사실 0 추가)
// ─────────────────────────────────────────────────────────────────────────
describe("★벤더모델 후보풀·SWE/능력 경로(5k94 감사 가드)", () => {
  const VENDOR_AUTOSELECT_IDS = [
    "MiniMax-M3",
    "MiniMax-M2.7",
    "glm-5.2",
    "glm-4.7",
    "k3",
    "k3-256k",
    "kimi-for-coding",
    "solar-pro4",
    // ★grok-4.5 는 여기 없다 — 2026-08-20 부터 `LADDER_EXCLUSIONS` 다(grok-4.6 과
    // 능력등급·단가·컨텍스트가 완전히 동일해서 자동선택이 고를 근거가 없다).
    // 대신 4.6 이 후보풀에 있어야 한다.
    "grok-4.6",
  ] as const;

  it("벤더 활성 모델이 구조적으로 autoCandidates 후보풀에 있다", () => {
    const pool = new Set([
      ...autoCandidates("claude", "standard").candidates.map((c) => c.model),
      ...autoCandidates("gpt", "standard").candidates.map((c) => c.model),
      ...autoCandidates("grok", "standard").candidates.map((c) => c.model),
    ]);
    for (const id of VENDOR_AUTOSELECT_IDS) {
      expect(pool.has(id), `${id} 가 후보풀에서 빠졌다`).toBe(true);
    }
  });

  it("modelGuidance 가 벤더 모델을 전부 서빙한다(단가·능력·벤치|null)", () => {
    for (const id of VENDOR_AUTOSELECT_IDS) {
      const g = modelGuidance(id);
      expect(g, `${id} guidance 없음`).toBeDefined();
      expect(g!.capability).toMatch(/^(cheap|mid|top|frontier)$/);
      expect(typeof g!.costIndex).toBe("number");
      // 벤치가 없으면 benchScore 를 0 으로 꾸며내지 않는다(undefined).
      if (g!.benchScore !== undefined) {
        expect(typeof g!.benchScore).toBe("number");
        expect(g!.benchmark).toBeTruthy();
      } else {
        expect(g!.benchmark).toBeUndefined();
      }
    }
  });

  it("★MiniMax-M3 guidance 는 SWE-bench Verified 80.5 를 대표로 쓴다", () => {
    const g = modelGuidance("MiniMax-M3")!;
    expect(g.benchScore).toBe(80.5);
    expect(g.benchmark).toBe("swe-bench-verified");
    expect(g.capability).toBe("top");
  });

  it("★SWE 비교 가능 시 MiniMax-M3 score 에 bench 성분이 실제로 움직인다", () => {
    // standard 진입칸 opus5 도 Verified 를 대표로 쓰므로 같은 벤치끼리 감산된다.
    const p = plan("claude", "standard")!;
    const m3 = p.scores.find((s) => s.candidate.model === "MiniMax-M3");
    expect(m3, "MiniMax-M3 가 scores 에 없다").toBeDefined();
    // opus5 Verified ≫ M3 80.5 이므로 M3 의 bench 는 음수(진입 대비 열세).
    expect(m3!.bench).toBeLessThan(0);
    // 비교 가능 벤치가 있으면 capability 폴백은 0(이중계상 금지).
    expect(m3!.capability).toBe(0);
    // 구독 쿼터가 넉넉하면 effective 단가≈0 이라 env-swap cost 는 음수(구독 대비 비쌈).
    // 쿼터가 마르면 시장가 우위가 살아 cost 가 양수로 뒤집힌다 — 단가 축이 실제로 산다.
    expect(m3!.cost).toBeLessThan(0);
    const exhausted = plan("claude", "standard", { budgetUsedPercent: 95 })!;
    const m3Low = exhausted.scores.find(
      (s) => s.candidate.model === "MiniMax-M3"
    );
    expect(m3Low!.cost).toBeGreaterThan(0);
    // bench 축은 쿼터와 무관 — 같은 음수 방향 유지.
    expect(m3Low!.bench).toBeLessThan(0);
  });

  it("★벤치 없는 Kimi 는 capability 폴백으로만 능력 축이 움직인다", () => {
    // k3/kimi-for-coding 은 score:null 행만 있다 → guidance.benchScore undefined.
    expect(modelGuidance("kimi-for-coding")!.benchScore).toBeUndefined();
    expect(modelGuidance("k3")!.benchScore).toBeUndefined();

    const p = plan("claude", "standard")!;
    const kimi = p.scores.find((s) => s.candidate.model === "kimi-for-coding");
    const k3 = p.scores.find((s) => s.candidate.model === "k3");
    expect(kimi).toBeDefined();
    expect(k3).toBeDefined();
    // 벤치 비교 불가 → bench=0, capability 는 등급차(mid vs top entry)로만.
    expect(kimi!.bench).toBe(0);
    expect(k3!.bench).toBe(0);
    // entry=opus5(top). kimi mid → 음수, k3 top → 0.
    expect(kimi!.capability).toBeLessThan(0);
    expect(k3!.capability).toBe(0);
  });

  it("antigravity 는 레지스트리·사다리 없음 → 후보 0 · 계획 null", () => {
    const { candidates } = autoCandidates("antigravity", "standard");
    expect(candidates).toEqual([]);
    expect(plan("antigravity", "standard")).toBeNull();
  });

  it("Grok 은 단일 칸이지만 계획이 나와 modelKey=grok-4.6(그래프 셀 일치)", () => {
    const p = plan("grok", "standard")!;
    expect(p.model).toBe("grok-4.6");
    expect(p.modelKey).toBe("grok-4.6");
    expect(p.mode).toBe("single");
    // grok-4.5 는 사다리에서 내려도 레지스트리에 그대로 살아 있어서, 그 모델로
    // 돌았던 과거 티켓의 가이던스 조회가 계속 답을 준다(집계 해석 무회귀).
    expect(modelGuidance("grok-4.5")!.benchmark).toBe("swe-bench-pro");
    expect(modelGuidance("grok-4.5")!.benchScore).toBe(64.7);
  });
});

// ── ★프리셋 소진율 바닥(비용절감 프리셋, 티켓 mzHNVsHV) ──────────────────
//
// env-swap 벤더는 별도 하네스가 아니라 **claude 사다리의 칸**이라, "비용절감"은
// 1층 후보목록으로 표현할 수 없고 2층 입력으로만 전달된다. 그 레버가
// `minBudgetUsedPercent` 다 — 구독 쿼터를 실측보다 귀하게 보게 만든다.
//
// ★이 블록은 `MODEL_PRESETS["cost-saver"].budgetUsedFloorPercent` 가 90 인 근거를
// 고정한다(그 주석의 스윕 표). 숫자를 하드코딩하지 않고 사다리·레지스트리 실단가와
// 대조하되, "어느 칸이 이기나"는 정책이므로 명시적으로 단언한다.
describe("★프리셋 소진율 바닥(minBudgetUsedPercent)", () => {
  const COST_SAVER_FLOOR = MODEL_PRESETS["cost-saver"].budgetUsedFloorPercent!;

  it("바닥이 없으면 완전 무회귀(입력 하나만 다른 두 호출이 같은 칸)", () => {
    resetAutoSelectRotation();
    const withoutFloor = plan("claude", "standard", { budgetUsedPercent: 10 })!;
    resetAutoSelectRotation();
    const nullFloor = plan("claude", "standard", {
      budgetUsedPercent: 10,
      minBudgetUsedPercent: undefined,
    })!;
    expect(nullFloor.modelKey).toBe(withoutFloor.modelKey);
    expect(nullFloor.reason).toBe(withoutFloor.reason);
    expect(withoutFloor.reason).not.toContain("preset floor");
  });

  it("applyBudgetUsedFloor: 실측이 더 나쁘면 실측이 이긴다(낙관적 덮어쓰기 금지)", () => {
    // 데이터 없음 → 바닥이 곧 값(프로브가 없는 기기가 이 레버의 주 사용처).
    expect(applyBudgetUsedFloor(undefined, 90)).toBe(90);
    expect(applyBudgetUsedFloor(null, 90)).toBe(90);
    // 실측 95% 소진(잔여 5%)은 바닥보다 나쁘다 → 실측 유지.
    expect(applyBudgetUsedFloor(95, 90)).toBe(95);
    // 실측이 넉넉하면 바닥으로 눌린다.
    expect(applyBudgetUsedFloor(10, 90)).toBe(90);
    // 바닥이 없으면 그대로 통과.
    expect(applyBudgetUsedFloor(10, undefined)).toBe(10);
    expect(applyBudgetUsedFloor(10, Number.NaN)).toBe(10);
    // 범위 밖 바닥은 클램프.
    expect(applyBudgetUsedFloor(0, 140)).toBe(100);
    expect(applyBudgetUsedFloor(0, -5)).toBe(0);
  });

  it("바닥은 구독 칸의 effective 단가만 올린다(종량제 env-swap 은 불변)", () => {
    const cheapWhenFresh = effectiveCostIndexForModel("claude-opus-5", 10)!;
    const dearWhenSaving = effectiveCostIndexForModel(
      "claude-opus-5",
      COST_SAVER_FLOOR
    )!;
    expect(dearWhenSaving).toBeGreaterThan(cheapWhenFresh);
    // 종량제 env-swap 칸은 구독이 아니므로 잔여와 무관하게 그대로다 — 그래서
    // "구독을 아껴라"가 곧 "env-swap 이 이긴다"가 된다.
    expect(effectiveCostIndexForModel("MiniMax-M3", 10)).toBe(
      effectiveCostIndexForModel("MiniMax-M3", COST_SAVER_FLOOR)
    );
  });

  it("★키 있으면 simple·standard 가 env-swap 최저단가 칸으로 간다", () => {
    for (const tier of ["simple", "standard"] as const) {
      resetAutoSelectRotation();
      const saving = plan("claude", tier, {
        budgetUsedPercent: 0,
        minBudgetUsedPercent: COST_SAVER_FLOOR,
      })!;
      expect(saving.model, tier).toBe("MiniMax-M2.7");
      expect(saving.movedFromEntry, tier).toBe(true);
      // 고른 칸이 진입칸보다 실제로 싸다(레지스트리 실단가 대조).
      expect(costIndexForModel(saving.model)!).toBeLessThan(
        costIndexForModel(entryRung("claude", tier)!.model)!
      );
    }
  });

  it("★키가 없어도 standard 는 절약된다(opus5 → sonnet5) — 80 이 아니라 90 인 이유", () => {
    resetAutoSelectRotation();
    const saving = plan("claude", "standard", {
      budgetUsedPercent: 0,
      minBudgetUsedPercent: COST_SAVER_FLOOR,
      modelAvailable: onlyOriginalClaude,
    })!;
    expect(saving.model).toBe("claude-sonnet-5");
    expect(costIndexForModel("claude-sonnet-5")!).toBeLessThan(
      costIndexForModel("claude-opus-5")!
    );

    // 바닥 80 은 같은 조건에서 아무것도 바꾸지 못한다 — 벤더 키가 없는 기기(대다수)
    // 에서 "비용절감"이 이름뿐인 프리셋이 되는 지점이라 90 을 골랐다.
    resetAutoSelectRotation();
    const tooShallow = plan("claude", "standard", {
      budgetUsedPercent: 0,
      minBudgetUsedPercent: 80,
      modelAvailable: onlyOriginalClaude,
    })!;
    expect(tooShallow.model).toBe("claude-opus-5");
    expect(COST_SAVER_FLOOR).toBeGreaterThan(80);
  });

  it("★complex 진입칸(fable5)은 절약 바닥으로 무너지지 않는다 — 95 를 안 쓰는 이유", () => {
    for (const available of [undefined, onlyOriginalClaude]) {
      resetAutoSelectRotation();
      const saving = plan("claude", "complex", {
        budgetUsedPercent: 0,
        minBudgetUsedPercent: COST_SAVER_FLOOR,
        ...(available ? { modelAvailable: available } : {}),
      })!;
      expect(saving.model).toBe("claude-fable-5");
      expect(saving.movedFromEntry).toBe(false);
    }
    // 95 까지 올리면 complex 가 무너진다(재작업이 절약분보다 비싸다).
    resetAutoSelectRotation();
    const tooDeep = plan("claude", "complex", {
      budgetUsedPercent: 0,
      minBudgetUsedPercent: 95,
    })!;
    expect(tooDeep.model).not.toBe("claude-fable-5");
    expect(COST_SAVER_FLOOR).toBeLessThan(95);
  });

  it("codex/grok 사다리는 이 바닥으로 움직이지 않는다(한 구독 = 아낄 자원 없음)", () => {
    // 프리셋 설명이 "Codex 에서도 싼 변종이 뜬다" 고 주장하지 않도록 고정하는 단언.
    for (const harness of ["gpt", "grok"]) {
      for (const tier of ["simple", "standard", "complex"] as const) {
        resetAutoSelectRotation();
        const base = plan(harness, tier, { budgetUsedPercent: 0 })!;
        resetAutoSelectRotation();
        const saving = plan(harness, tier, {
          budgetUsedPercent: 0,
          minBudgetUsedPercent: COST_SAVER_FLOOR,
        })!;
        expect(saving.modelKey, `${harness}/${tier}`).toBe(base.modelKey);
      }
    }
  });

  it("근거 문자열이 눌린 잔여를 실측으로 위장하지 않는다", () => {
    const saving = plan("claude", "standard", {
      budgetUsedPercent: 0,
      minBudgetUsedPercent: COST_SAVER_FLOOR,
    })!;
    expect(saving.reason).toContain(`${100 - COST_SAVER_FLOOR}% left`);
    expect(saving.reason).toContain(`preset floor ${COST_SAVER_FLOOR}% used`);
  });

  it("절약 모드에서는 탐색·동률회전을 사지 않는다(conserving 경로)", () => {
    // 바닥이 pressure > 1 을 만들므로 ε=1(항상 탐색)이어도 근거상 최선만 쓴다.
    resetAutoSelectRotation();
    const saving = plan("claude", "standard", {
      budgetUsedPercent: 0,
      minBudgetUsedPercent: COST_SAVER_FLOOR,
      epsilon: 1,
      random: () => 0,
    })!;
    expect(saving.mode).toBe("top-score");
    expect(costPressureForHeadroom(COST_SAVER_FLOOR)).toBeGreaterThan(1);
  });
});
