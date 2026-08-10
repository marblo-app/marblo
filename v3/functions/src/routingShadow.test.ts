// routingShadow 순수 로직 단위테스트 (telemetryMetadata.test.ts 규약).
//
// 실행:
//   cd v3/functions && npm run test:routing-shadow
//
// ★이 파일이 지키는 불변식 두 가지:
//   1. **추천은 로컬 결정을 훔쳐보지 않는다.** 정답이 입력에 섞이면 "일치율" 이
//      측정하는 것이 아무것도 없어진다. 타입이 1차 방어, 이 테스트가 2차다.
//   2. **파서는 화이트리스트다.** 모르는 키(특히 자유입력 텍스트)는 통째로
//      버려진다 — 클라이언트 실수가 서버 로그의 프라이버시 사고가 되지 않는다.
import test from "node:test";
import assert from "node:assert/strict";

import {
  ROUTING_SHADOW_HEURISTIC_VERSION,
  compareShadowRouting,
  costPressureForHeadroom,
  parseShadowFeatures,
  recommendRouting,
  type RoutingShadowFeatures,
} from "./routingShadow";

/** claude 사다리를 닮은 3칸(아래=싼 칸). 값은 테스트용 합성치다. */
function ladder(): RoutingShadowFeatures {
  return {
    schemaVersion: 1,
    tier: "standard",
    harness: "claude",
    entryIndex: 1,
    rungs: [
      { modelKey: "claude-sonnet-5", index: 0, costIndex: 3 },
      { modelKey: "claude-opus-5", index: 1, costIndex: 12 },
      { modelKey: "claude-fable-5", index: 2, costIndex: 30 },
    ],
    budgetUsedPercent: 10,
  };
}

test("후보가 없으면 추천하지 않는다(지어내지 않는다)", () => {
  assert.equal(recommendRouting({ ...ladder(), rungs: [] }), null);
});

test("모르는 티어는 추천하지 않는다", () => {
  const bad = { ...ladder(), tier: "epic" } as unknown as RoutingShadowFeatures;
  assert.equal(recommendRouting(bad), null);
});

test("잔량이 충분하면 진입칸을 유지한다(과반응 금지)", () => {
  // 잔여 90% → costPressure=1, standard COST_WEIGHT=7.
  // sonnet: fit +5(down 1칸) + cost 7*log2(12/3)=+14 → +19 로 진입칸을 이긴다.
  // 그래서 "유지" 를 보려면 단가차가 없는 사다리를 쓴다 — 단가가 같으면 cost=0.
  const flat: RoutingShadowFeatures = {
    ...ladder(),
    budgetUsedPercent: 10,
    rungs: [
      { modelKey: "a", index: 0, costIndex: 10 },
      { modelKey: "b", index: 1, costIndex: 10 },
      { modelKey: "c", index: 2, costIndex: 10 },
    ],
  };
  const rec = recommendRouting(flat);
  assert.ok(rec);
  assert.equal(rec.modelKey, "b");
  assert.equal(rec.decidedBy, "entry");
});

test("단가차가 크면 싼 칸으로 내려간다 — 그리고 성분이 그 이유를 말한다", () => {
  const rec = recommendRouting(ladder());
  assert.ok(rec);
  assert.equal(rec.modelKey, "claude-sonnet-5");
  assert.equal(rec.decidedBy, "cost");
  assert.equal(rec.heuristicVersion, ROUTING_SHADOW_HEURISTIC_VERSION);
  const winner = rec.scores.find((s) => s.modelKey === "claude-sonnet-5");
  assert.ok(winner);
  // fit: standard.down=5, 한 칸 아래 → +5·(-1) = -5 가 아니라 로컬과 같은 부호
  // 규약(steps<0 → down*steps = 음수)이므로 -5.
  assert.equal(winner.fit, -5);
  assert.ok(winner.cost > 0, "싼 칸은 cost 성분이 양수여야 한다");
});

test("★추천은 로컬 결정을 입력으로 받지 않는다 — 정답을 심어도 결과가 같다", () => {
  const base = ladder();
  const withLeak = {
    ...base,
    // 있어서는 안 되는 필드들. 타입에 없고, 휴리스틱이 읽지도 않는다.
    plannedModelKey: "claude-fable-5",
    localModelKey: "claude-fable-5",
    selectedModel: "claude-fable-5",
  } as unknown as RoutingShadowFeatures;
  assert.deepEqual(recommendRouting(withLeak), recommendRouting(base));
});

test("쿼터가 마르면 단가 민감도가 올라간다(연속·단조)", () => {
  assert.equal(costPressureForHeadroom(0), 1); // 잔여 100%
  assert.equal(costPressureForHeadroom(50), 1); // 잔여 50% — 평평
  assert.ok(costPressureForHeadroom(80) > 1); // 잔여 20%
  assert.ok(costPressureForHeadroom(95) > costPressureForHeadroom(80));
  assert.equal(costPressureForHeadroom(null), 1); // 데이터 없음 = 중립
  assert.equal(costPressureForHeadroom(Number.NaN), 1);
});

test("비교 — 일치/불일치/로컬 미상", () => {
  const features = ladder();
  const rec = recommendRouting(features);
  assert.ok(rec);

  const same = compareShadowRouting(features, rec, "claude-sonnet-5");
  assert.equal(same.agree, true);
  assert.equal(same.rungDelta, 0);
  assert.equal(same.costDelta, 0);

  const diff = compareShadowRouting(features, rec, "claude-fable-5");
  assert.equal(diff.agree, false);
  assert.equal(diff.rungDelta, -2); // cloud(0) − local(2)
  assert.equal(diff.costDelta, -27); // 3 − 30

  const unknown = compareShadowRouting(features, rec, "");
  assert.equal(unknown.agree, null);
  assert.equal(unknown.localModelKey, null);
  assert.equal(unknown.rungDelta, null);
});

test("비교 — 사다리에 없는 로컬 칸은 delta 를 지어내지 않는다", () => {
  const features = ladder();
  const rec = recommendRouting(features);
  assert.ok(rec);
  const out = compareShadowRouting(features, rec, "gpt-5.6-terra@high");
  assert.equal(out.agree, false);
  assert.equal(out.rungDelta, null);
  assert.equal(out.costDelta, null);
});

test("★파서는 화이트리스트 — 모르는 키(자유입력 포함)를 통째로 버린다", () => {
  const parsedFeatures = parseShadowFeatures({
    tier: "complex",
    harness: "gpt",
    entryIndex: 2,
    rungs: [
      { modelKey: "gpt-5.6-terra@high", index: 1, costIndex: 4 },
      { modelKey: "gpt-5.6-sol@high", index: 2, costIndex: 9 },
    ],
    budgetUsedPercent: 30,
    role: "backend",
    tagCount: 3,
    // ↓ 전부 버려져야 한다.
    prompt: "여기에 티켓 본문이 실렸다고 가정",
    instruction: "secret",
    cwd: "/Users/someone/project",
    tags: ["auth", "billing"],
    email: "a@b.c",
  });
  assert.ok(parsedFeatures);
  const keys = Object.keys(parsedFeatures);
  for (const forbidden of ["prompt", "instruction", "cwd", "tags", "email"]) {
    assert.equal(keys.includes(forbidden), false, `${forbidden} 가 통과했다`);
  }
  assert.equal(parsedFeatures.tier, "complex");
  assert.equal(parsedFeatures.entryIndex, 2);
  assert.equal(parsedFeatures.rungs.length, 2);
});

test("파서 — 형태가 안 맞으면 null(추측 금지)", () => {
  assert.equal(parseShadowFeatures(null), null);
  assert.equal(parseShadowFeatures("nope"), null);
  assert.equal(parseShadowFeatures([]), null);
  assert.equal(parseShadowFeatures({ tier: "standard" }), null); // harness 없음
  assert.equal(
    parseShadowFeatures({ tier: "standard", harness: "claude", rungs: [] }),
    null,
  );
  // 칸에 modelKey/index 가 없으면 그 칸만 떨어지고, 남는 게 없으면 null.
  assert.equal(
    parseShadowFeatures({
      tier: "standard",
      harness: "claude",
      rungs: [{ costIndex: 3 }],
    }),
    null,
  );
});

test("파서 — 단가 0/음수는 담지 않는다(공짜라는 거짓 근거 금지)", () => {
  const out = parseShadowFeatures({
    tier: "simple",
    harness: "claude",
    rungs: [
      { modelKey: "a", index: 0, costIndex: 0 },
      { modelKey: "b", index: 1, costIndex: -5 },
      { modelKey: "c", index: 2, costIndex: 3 },
    ],
  });
  assert.ok(out);
  assert.equal(out.rungs[0].costIndex, undefined);
  assert.equal(out.rungs[1].costIndex, undefined);
  assert.equal(out.rungs[2].costIndex, 3);
});
