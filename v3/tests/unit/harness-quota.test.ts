/**
 * 하네스 잔여 쿼터 합성 — **Usage 탭이 보여주는 수치 == 라우터가 읽는 수치**.
 *
 * 이 파일이 고정하는 불변식(티켓 AS4noeJq):
 *   1. 계정 프로브(= Usage 탭 게이지의 원산지)가 그대로 라우터로 간다.
 *   2. cost_logs 로컬 거울(추정치)은 **더 빡셀 때만** 발언하고,
 *      ★혼자서는 절대 "소진"/"near-limit 제외" 를 발동시키지 못한다.
 *   3. 값이 없는 하네스는 키 자체가 없다(no-data = 중립, 0% 잔여가 아니다).
 */
import { describe, it, expect } from "vitest";
import {
  budgetSnapshotFromQuotaRows,
  harnessQuotaRows,
  quotaDivergences,
  weeklyRollupCap,
} from "../../electron/harness-quota";
import { usageSnapshotFromRows } from "../../electron/usage-rollup";
import {
  budgetBiasScore,
  nearLimitModels,
} from "../../electron/dispatch-scoring";
import type { RateLimitInfo } from "../../electron/session-parsers";

function info(partial: Partial<RateLimitInfo>): RateLimitInfo {
  return {
    planType: null,
    primaryPercent: null,
    primaryResetAt: null,
    primaryWindowDurationMins: null,
    secondaryPercent: null,
    secondaryResetAt: null,
    secondaryWindowDurationMins: null,
    ...partial,
  };
}

const row = (rows: ReturnType<typeof harnessQuotaRows>, harness: string) =>
  rows.find((r) => r.harness === harness)!;

describe("harnessQuotaRows — Usage 탭과 같은 소스", () => {
  it("계정 프로브 값을 그대로 쓴다(창이 둘이면 더 빡센 쪽)", () => {
    const rows = harnessQuotaRows(
      {
        claude: info({ primaryPercent: 23, secondaryPercent: 61 }),
        gpt: null,
        grok: null,
      },
      null,
    );
    expect(row(rows, "claude").usedPercent).toBe(61);
    expect(row(rows, "claude").remainingPercent).toBe(39);
    expect(row(rows, "claude").source).toBe("account-probe");
  });

  it("★라이브 codex 모양(주간창 only, prolite)을 그대로 읽는다", () => {
    // 실측 2026-08-07: rateLimits.primary = { usedPercent: 100,
    // windowDurationMins: 10080 }, secondary = null, planType "prolite".
    const rows = harnessQuotaRows(
      {
        claude: null,
        gpt: info({
          planType: "prolite",
          primaryPercent: 100,
          primaryWindowDurationMins: 10080,
        }),
        grok: null,
      },
      null,
    );
    expect(row(rows, "gpt").usedPercent).toBe(100);
    expect(row(rows, "gpt").remainingPercent).toBe(0);
    expect(row(rows, "gpt").planType).toBe("prolite");
    // 소진은 실측이 말했으므로 하드게이트가 정상 발동한다.
    const budgets = budgetSnapshotFromQuotaRows(rows);
    expect(budgetBiasScore("gpt", budgets).bias).toBeNull();
  });

  it("데이터가 전혀 없으면 키를 만들지 않는다(no-data = 중립)", () => {
    const rows = harnessQuotaRows(
      { claude: null, gpt: null, grok: null },
      null,
    );
    expect(budgetSnapshotFromQuotaRows(rows)).toEqual({});
    expect(row(rows, "claude").usedPercent).toBeNull();
    expect(row(rows, "claude").source).toBe("none");
  });

  it("grok 은 행 자체가 없다 — 조회 API 가 없어서다(#713)", () => {
    const rows = harnessQuotaRows(
      { claude: null, gpt: null, grok: info({ primaryPercent: 10 }) },
      null,
    );
    expect(rows.map((r) => r.harness)).toEqual(["claude", "gpt"]);
  });
});

describe("★추정치(주간 롤업)는 '아껴' 까지만 말한다", () => {
  // 라이브 실측 2026-08-07: usage-weekly.json 하루치가 claude 161M(soft limit
  // 80M → 201%), gpt 510M(60M → 850%). 즉 정상 운용 기기에서 롤업은 **상시
  // 포화**다. 캡이 없으면 이 추정치가 계정 실측과 max 합성되어 usedPercent 100
  // → budgetBias null → "모든 후보 소진" 으로 dispatch 를 통째로 막았다.
  const saturated = usageSnapshotFromRows([
    { model: "claude-opus-5", totalTokens: 161_000_000 },
    { model: "gpt-5.5", totalTokens: 510_000_000 },
  ]);

  it("포화된 롤업이 혼자서 소진 하드게이트를 발동시키지 못한다", () => {
    const rows = harnessQuotaRows(
      { claude: null, gpt: null, grok: null },
      saturated,
    );
    const budgets = budgetSnapshotFromQuotaRows(rows);
    for (const harness of ["claude", "gpt"] as const) {
      // 원값은 정직하게 100 으로 남고(진단용)…
      expect(row(rows, harness).weeklyRollupUsedPercent).toBe(100);
      expect(row(rows, harness).weeklyRollupCapped).toBe(true);
      // …라우터가 읽는 값은 캡을 넘지 않는다.
      expect(row(rows, harness).usedPercent).toBe(weeklyRollupCap(10));
      expect(budgetBiasScore(harness, budgets).bias).not.toBeNull();
    }
  });

  it("포화된 롤업이 혼자서 near-limit 후보 제외도 발동시키지 못한다", () => {
    const budgets = budgetSnapshotFromQuotaRows(
      harnessQuotaRows({ claude: null, gpt: null, grok: null }, saturated),
    );
    expect([...nearLimitModels(["claude", "gpt"], budgets)]).toEqual([]);
  });

  it("★계정 실측이 있으면 실측이 정본이다 — 소진도 실측이 말한다", () => {
    const rows = harnessQuotaRows(
      {
        claude: null,
        gpt: info({ primaryPercent: 100, primaryWindowDurationMins: 10080 }),
        grok: null,
      },
      saturated,
    );
    expect(row(rows, "gpt").usedPercent).toBe(100);
    expect(row(rows, "gpt").source).toBe("account-probe");
    expect(
      budgetBiasScore("gpt", budgetSnapshotFromQuotaRows(rows)).bias,
    ).toBeNull();
  });

  /**
   * ★이 케이스가 티켓의 불변식 그 자체다(라이브 재현 2026-08-07).
   * 계정 실측은 claude 10% 사용(잔여 90%)인데 롤업은 포화 100% 였다. 종전 max
   * 합성은 89~100% 를 라우터에 먹여 Usage 탭 화면과 88%p 갈라졌고, claude 가
   * 근거 없이 강하게 디프라이어리티됐다.
   */
  it("★실측이 있으면 포화 추정치가 그걸 덮지 못한다 (Usage 탭 == 라우터)", () => {
    const rows = harnessQuotaRows(
      { claude: info({ primaryPercent: 10 }), gpt: null, grok: null },
      saturated,
    );
    expect(row(rows, "claude").usedPercent).toBe(10);
    expect(row(rows, "claude").remainingPercent).toBe(90);
    expect(row(rows, "claude").source).toBe("account-probe");
    // 원값은 진단용으로 남고, 불일치는 크게 보고된다.
    expect(row(rows, "claude").weeklyRollupUsedPercent).toBe(100);
    expect(quotaDivergences(rows).map((r) => r.harness)).toEqual(["claude"]);
    // 잔여 90% → 넉넉 구간(+6), near-limit 아님.
    const budgets = budgetSnapshotFromQuotaRows(rows);
    expect(budgetBiasScore("claude", budgets).bias).toBe(6);
    expect(nearLimitModels(["claude"], budgets).size).toBe(0);
  });

  it("실측이 없으면 추정치가 자리를 메운다(캡 안에서)", () => {
    const modest = usageSnapshotFromRows([
      // 80M soft limit 의 절반 → 50%
      { model: "claude-opus-5", totalTokens: 40_000_000 },
    ]);
    const rows = harnessQuotaRows(
      { claude: null, gpt: null, grok: null },
      modest,
    );
    expect(row(rows, "claude").usedPercent).toBe(50);
    expect(row(rows, "claude").source).toBe("weekly-rollup");
    expect(row(rows, "claude").weeklyRollupCapped).toBe(false);
  });

  it("캡은 예비선과 함께 움직인다(둘이 드리프트하면 게이트가 스스로를 발동시킨다)", () => {
    expect(weeklyRollupCap(10)).toBe(89);
    expect(weeklyRollupCap(25)).toBe(74);
    expect(weeklyRollupCap(0)).toBe(99); // 게이트를 꺼도 소진 하드게이트는 실측 몫
  });
});

describe("quotaDivergences — 불일치가 조용히 지나가지 않는다", () => {
  it("두 소스가 임계 이상 벌어지면 그 행을 돌려준다(원값 기준)", () => {
    const rows = harnessQuotaRows(
      { claude: info({ primaryPercent: 12 }), gpt: null, grok: null },
      usageSnapshotFromRows([
        { model: "claude-opus-5", totalTokens: 161_000_000 }, // 100%
      ]),
    );
    const diverged = quotaDivergences(rows);
    expect(diverged.map((r) => r.harness)).toEqual(["claude"]);
    expect(diverged[0].divergencePct).toBe(88);
  });

  it("한쪽 소스만 있으면 불일치가 아니다", () => {
    const rows = harnessQuotaRows(
      { claude: info({ primaryPercent: 90 }), gpt: null, grok: null },
      null,
    );
    expect(quotaDivergences(rows)).toEqual([]);
  });
});
