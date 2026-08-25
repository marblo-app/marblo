/**
 * 비용 축 연속성 가드 회귀 테스트 (ticket UGTAvo3d1hnxMqKHZ8i9).
 *
 * ★이 파일의 픽스처는 지어낸 숫자가 아니다. 2026-08-24 에 BQ
 * `marblo-2253d.marblo_telemetry.cost_logs` 를 읽기전용으로 실측한 값이다.
 * 그래서 이 테스트는 두 가지를 동시에 한다:
 *   1. 판정 로직의 회귀 가드
 *   2. **당시 실측치의 고정** — 나중에 누가 "7월은 원래 오케를 안 썼다" 고 하면
 *      이 파일이 그때 표가 어떻게 생겼는지 증언한다.
 *
 * 티켓의 요구는 명시적이다 — "지금 상태(7월)에서 RED 가 되는 걸 보여라."
 * 아래 `2026-07` 케이스가 그것이다.
 */
import { describe, it, expect } from "vitest";

import {
  BACKFILL_DOMINANCE_THRESHOLD,
  bucketCostRows,
  detectCostAxisGaps,
  formatCostAxisReport,
  inspectCostAxisBucket,
  isRed,
  orchestratorCostDisplay,
  type CostAxisBucket,
} from "../../electron/cost-axis-continuity";
import {
  orchestratorCostAgentId,
  ORCHESTRATOR_AGENT_ID_PREFIX,
} from "../../electron/session-kind";

// ── 실측 픽스처 (BQ, 2026-08-24 읽기) ───────────────────────────────────

/**
 * 월 단위 실측. `orchActiveDays`/`workerActiveDays`/`maxOrchRowCost` 는 같은
 * 읽기의 일 단위 집계에서 온 값이다.
 */
const MEASURED_2026: CostAxisBucket[] = [
  {
    period: "2026-04",
    workerRows: 141,
    workerCost: 269.98,
    orchRows: 0,
    orchCost: 0,
    maxOrchRowCost: 0,
    orchActiveDays: 0,
    workerActiveDays: 3,
  },
  {
    period: "2026-05",
    workerRows: 549,
    workerCost: 5.75,
    orchRows: 165,
    orchCost: 2.42,
    maxOrchRowCost: 0.66,
    orchActiveDays: 8,
    workerActiveDays: 9,
  },
  {
    period: "2026-06",
    workerRows: 40125,
    workerCost: 54084.45,
    orchRows: 4711,
    orchCost: 22329.33,
    maxOrchRowCost: 1165.81,
    // 오케도 워커도 같은 20일에만 행이 있다 — 6월 안에서는 끊긴 흔적이 없다.
    // 단절은 7월에 드러난다(아래).
    orchActiveDays: 20,
    workerActiveDays: 20,
  },
  {
    period: "2026-07",
    workerRows: 56756,
    workerCost: 8506.74,
    orchRows: 0,
    orchCost: 0,
    maxOrchRowCost: 0,
    orchActiveDays: 0,
    workerActiveDays: 20,
  },
  {
    period: "2026-08",
    workerRows: 278231,
    workerCost: 18466.18,
    orchRows: 1161,
    orchCost: 8614.17,
    // ★08-23 15:18 단 한 행. cacheRead 92.4억 토큰, 152MB 세션 파일 콜드스타트 백필.
    maxOrchRowCost: 6978.23,
    orchActiveDays: 2,
    workerActiveDays: 24,
  },
];

const byPeriod = (p: string): CostAxisBucket => {
  const b = MEASURED_2026.find((x) => x.period === p);
  if (!b) throw new Error(`fixture ${p} missing`);
  return b;
};

// ── ★티켓의 요구: 지금 상태(7월)에서 RED ────────────────────────────────

describe("★2026-07 은 지금 이 검사에서 RED 다", () => {
  const july = byPeriod("2026-07");

  it("워커 비용이 있는데 오케 0행이면 orchestrator-silent 를 red 로 낸다", () => {
    const findings = inspectCostAxisBucket(july);
    expect(findings).toHaveLength(1);
    expect(findings[0].code).toBe("orchestrator-silent");
    expect(findings[0].severity).toBe("red");
    expect(findings[0].period).toBe("2026-07");
  });

  it("근거에 실측치가 그대로 실린다 (문장 파싱 없이 기계가 읽을 수 있게)", () => {
    const [f] = inspectCostAxisBucket(july);
    expect(f.evidence.workerCost).toBeCloseTo(8506.74, 2);
    expect(f.evidence.workerRows).toBe(56756);
    expect(f.evidence.orchRows).toBe(0);
    expect(f.evidence.orchCost).toBe(0);
    expect(f.evidence.orchShare).toBe(0);
  });

  it("전체 실측 표를 넣으면 검사 결과가 RED 다", () => {
    expect(isRed(detectCostAxisGaps(MEASURED_2026))).toBe(true);
  });

  it("★화면 계약: 7월 오케 비용은 0 이 아니라 null(미상) 로 나간다", () => {
    const d = orchestratorCostDisplay(july);
    expect(d.coverage).toBe("unknown");
    expect(d.value).toBeNull();
    // 0 으로 강제 변환될 여지를 남기지 않는다.
    expect(d.value).not.toBe(0);
    expect(d.note).toContain("미상");
  });
});

// ── 나머지 달들이 무엇으로 걸리는가 ─────────────────────────────────────

describe("실측 5개월 각각의 판정", () => {
  it("2026-04 도 같은 이유로 red — 워커 $269.98 인데 오케 0행", () => {
    const f = inspectCostAxisBucket(byPeriod("2026-04"));
    expect(f.map((x) => x.code)).toEqual(["orchestrator-silent"]);
    expect(orchestratorCostDisplay(byPeriod("2026-04")).value).toBeNull();
  });

  it("★2026-06 은 이 검사를 통과한다 — 단절이 6월 안에서는 안 보이기 때문이다", () => {
    // 6월은 오케도 워커도 같은 20일에만 행이 있다(마지막 행이 둘 다 06-22).
    // 즉 "6/22 에 끊겼다" 는 6월 표만 봐서는 안 보이고, 워커만 계속 돈
    // **7월**에서 드러난다. 연속성 검사가 월 경계에 갇히면 안 되는 이유다 —
    // 그래서 스크립트는 --daily 로도 돌린다.
    expect(inspectCostAxisBucket(byPeriod("2026-06"))).toEqual([]);
  });

  it("★2026-08 의 31.8% 는 정상치가 아니다 — 백필 지배로 잡힌다", () => {
    const aug = byPeriod("2026-08");
    const findings = inspectCostAxisBucket(aug);
    const backfill = findings.find(
      (x) => x.code === "orchestrator-backfill-dominated",
    );
    expect(backfill).toBeDefined();
    expect(backfill?.severity).toBe("red");
    // 한 행이 8월 오케 축의 81% 다.
    expect(backfill?.evidence.maxOrchRowShare).toBeGreaterThan(0.8);
    // 그 달 오케 비중(31.8%)이 근거에 남아 있어야 "이건 정상치가 아니다" 를 말할 수 있다.
    expect(backfill?.evidence.orchShare).toBeCloseTo(0.319, 2);
  });

  it("2026-08 은 값을 그리되 반드시 사유를 달고 나간다 (suspect)", () => {
    const d = orchestratorCostDisplay(byPeriod("2026-08"));
    expect(d.coverage).toBe("suspect");
    expect(d.value).toBeCloseTo(8614.17, 2);
    expect(d.note).toBeTruthy();
    expect(d.note).toContain("백필");
  });

  it("2026-05 는 부분수집이다 — 워커 9일 중 오케는 8일뿐", () => {
    const codes = inspectCostAxisBucket(byPeriod("2026-05")).map((x) => x.code);
    expect(codes).toContain("orchestrator-partial");
  });

  it("★연속성이 깨끗한 달은 2026-06 하나뿐이다 — 그런데 그 달은 다른 이유로 못 쓴다", () => {
    const clean = MEASURED_2026.filter(
      (b) => orchestratorCostDisplay(b).coverage === "collected",
    ).map((b) => b.period);
    expect(clean).toEqual(["2026-06"]);
    // ★이 검사는 **연속성**만 본다. 2026-06 은 연속적이지만 그 행들 자체가 오케
    // 비용이 아니었다(#1107: agent:reconnect unclaimed-JSONL 오귀속 — 6월 오케
    // $22,329 중 $5,605 가 같은 초 워커 행과 바이트 단위로 동일). 오귀속은 이
    // 검사가 잡는 종류가 아니고, 그쪽 가드는 orchestrator-cost-collection.test.ts 다.
    // 결론은 그래서 바뀌지 않는다 — **오케 비중을 정상치로 쓸 수 있는 달은 없다.**
  });
});

// ── 건강한 표는 조용해야 한다 (거짓양성 가드) ───────────────────────────

describe("정상 수집 구간은 아무것도 내지 않는다", () => {
  const healthy: CostAxisBucket = {
    period: "2026-09",
    workerRows: 20000,
    workerCost: 10000,
    orchRows: 3000,
    orchCost: 3000,
    maxOrchRowCost: 42.5, // 어느 한 행도 축을 지배하지 않는다
    orchActiveDays: 30,
    workerActiveDays: 30,
  };

  it("발견 0건", () => {
    expect(inspectCostAxisBucket(healthy)).toEqual([]);
    expect(isRed(detectCostAxisGaps([healthy]))).toBe(false);
  });

  it("화면 계약은 collected — 값을 그대로 쓴다", () => {
    const d = orchestratorCostDisplay(healthy);
    expect(d).toEqual({ coverage: "collected", value: 3000, note: null });
  });

  it("워커도 오케도 없는 기간은 red 가 아니다 (안 쓴 날은 안 쓴 날이다)", () => {
    expect(
      inspectCostAxisBucket({
        period: "2026-09",
        workerRows: 0,
        workerCost: 0,
        orchRows: 0,
        orchCost: 0,
        maxOrchRowCost: 0,
        orchActiveDays: 0,
        workerActiveDays: 0,
      }),
    ).toEqual([]);
  });

  it("하루짜리 기간은 partial 로 오탐하지 않는다", () => {
    const oneDay: CostAxisBucket = {
      period: "2026-09-01",
      workerRows: 100,
      workerCost: 50,
      orchRows: 10,
      orchCost: 5,
      maxOrchRowCost: 1,
      orchActiveDays: 1,
      workerActiveDays: 1,
    };
    expect(inspectCostAxisBucket(oneDay)).toEqual([]);
  });
});

// ── 백필 임계가 무엇을 뜻하는지 못 박는다 ────────────────────────────────

describe("백필 지배 임계", () => {
  const base: CostAxisBucket = {
    period: "2026-09",
    workerRows: 100,
    workerCost: 100,
    orchRows: 100,
    orchCost: 100,
    maxOrchRowCost: 0,
    orchActiveDays: 30,
    workerActiveDays: 30,
  };

  it(`한 행이 축의 ${BACKFILL_DOMINANCE_THRESHOLD * 100}% 이상이면 잡는다`, () => {
    const hit = { ...base, maxOrchRowCost: 50 };
    expect(inspectCostAxisBucket(hit).map((f) => f.code)).toContain(
      "orchestrator-backfill-dominated",
    );
  });

  it("그 아래는 잡지 않는다", () => {
    const miss = { ...base, maxOrchRowCost: 49.99 };
    expect(inspectCostAxisBucket(miss)).toEqual([]);
  });
});

// ── 축 정의는 session-kind.ts 정본만 쓴다 ───────────────────────────────

describe("★축 id 규약을 깨지 않는다", () => {
  it("보드 오케·미션 오케 둘 다 오케 축으로 들어간다", () => {
    const rows = [
      {
        agentId: orchestratorCostAgentId("board", "P1"),
        totalCost: 1,
        timestamp: "2026-07-01T00:00:00Z",
      },
      {
        agentId: orchestratorCostAgentId("mission", "P1"),
        totalCost: 2,
        timestamp: "2026-07-01T00:00:00Z",
      },
      {
        agentId: "agent-abc123",
        totalCost: 4,
        timestamp: "2026-07-01T00:00:00Z",
      },
    ];
    const [bucket] = bucketCostRows(rows, "month");
    expect(bucket.orchRows).toBe(2);
    expect(bucket.orchCost).toBe(3);
    expect(bucket.workerRows).toBe(1);
    expect(bucket.workerCost).toBe(4);
  });

  it("새 접두를 발명하지 않는다 — 소스에 접두 리터럴이 없다", async () => {
    const { readFileSync } = await import("node:fs");
    const path = await import("node:path");
    const { fileURLToPath } = await import("node:url");
    const src = readFileSync(
      path.resolve(
        path.dirname(fileURLToPath(import.meta.url)),
        "../../electron/cost-axis-continuity.ts",
      ),
      "utf8",
    );
    // 판정은 isOrchestratorAgentId 만 쓴다. 접두 문자열 비교가 재등장하면 축이 두 벌이 된다.
    expect(src).toContain("isOrchestratorAgentId");
    // 접두를 **그 자체로** 적은 리터럴이 없어야 한다. (finding code 들은
    // `"orchestrator-silent"` 처럼 뒤가 더 붙으므로 여기 걸리지 않는다.)
    expect(src.includes(`"${ORCHESTRATOR_AGENT_ID_PREFIX}"`)).toBe(false);
    expect(src.includes(`'${ORCHESTRATOR_AGENT_ID_PREFIX}'`)).toBe(false);
    // 접두 비교를 직접 하는 형태도 금지 — 그게 이 사고의 구조적 원인이었다.
    expect(src.includes("startsWith(")).toBe(false);
  });

  it("알 수 없는 agentId 는 오케로 세지 않는다 (모르면 지어내지 않는다)", () => {
    const [bucket] = bucketCostRows(
      [
        { agentId: null, totalCost: 1, timestamp: "2026-07-01T00:00:00Z" },
        { agentId: "", totalCost: 1, timestamp: "2026-07-01T00:00:00Z" },
        {
          agentId: "orch-xyz-1700000000000",
          totalCost: 1,
          timestamp: "2026-07-01T00:00:00Z",
        },
      ],
      "month",
    );
    expect(bucket.orchRows).toBe(0);
    expect(bucket.workerRows).toBe(3);
  });
});

// ── 버킷 만들기 ─────────────────────────────────────────────────────────

describe("bucketCostRows", () => {
  const rows = [
    { agentId: "agent-a", totalCost: 1, timestamp: "2026-07-01T10:00:00Z" },
    { agentId: "agent-a", totalCost: 2, timestamp: "2026-07-02T10:00:00Z" },
    {
      agentId: orchestratorCostAgentId("board", "P1"),
      totalCost: 5,
      timestamp: "2026-07-02T11:00:00Z",
    },
    { agentId: "agent-b", totalCost: 3, timestamp: "2026-08-01T10:00:00Z" },
  ];

  it("월 단위로 묶고 기간 순으로 정렬한다", () => {
    const out = bucketCostRows(rows, "month");
    expect(out.map((b) => b.period)).toEqual(["2026-07", "2026-08"]);
    expect(out[0].workerCost).toBe(3);
    expect(out[0].orchCost).toBe(5);
    expect(out[0].workerActiveDays).toBe(2);
    expect(out[0].orchActiveDays).toBe(1);
  });

  it("일 단위로도 묶는다 — 어느 날 끊겼는지 보려면 이쪽이다", () => {
    const out = bucketCostRows(rows, "day");
    expect(out.map((b) => b.period)).toEqual([
      "2026-07-01",
      "2026-07-02",
      "2026-08-01",
    ]);
    // 07-01 은 워커만 있다 → 그 날짜에서 이미 red 다.
    expect(inspectCostAxisBucket(out[0]).map((f) => f.code)).toEqual([
      "orchestrator-silent",
    ]);
  });

  it("★일 단위로 돌리면 7/1 에 이미 잡힌다 — 월말까지 기다릴 이유가 없었다", () => {
    const julyFirst = bucketCostRows(
      [
        {
          agentId: "agent-a",
          totalCost: 12.5,
          timestamp: "2026-07-01T09:00:00Z",
        },
      ],
      "day",
    );
    expect(isRed(detectCostAxisGaps(julyFirst))).toBe(true);
  });

  it("maxOrchRowCost 는 그 기간 최대 단일 오케 행이다", () => {
    const out = bucketCostRows(
      [
        {
          agentId: orchestratorCostAgentId("board", "P1"),
          totalCost: 10,
          timestamp: "2026-08-23T15:18:00Z",
        },
        {
          agentId: orchestratorCostAgentId("board", "P1"),
          totalCost: 1,
          timestamp: "2026-08-24T15:18:00Z",
        },
      ],
      "month",
    );
    expect(out[0].maxOrchRowCost).toBe(10);
  });

  it("깨진 timestamp 는 버린다 (조용히 엉뚱한 기간에 실리지 않게)", () => {
    expect(
      bucketCostRows([
        { agentId: "agent-a", totalCost: 1, timestamp: "not-a-date" },
      ]),
    ).toEqual([]);
  });
});

// ── 리포트 ──────────────────────────────────────────────────────────────

describe("formatCostAxisReport", () => {
  it("실측 표를 사람이 읽는 한 덩어리로 낸다", () => {
    const out = formatCostAxisReport(
      MEASURED_2026,
      detectCostAxisGaps(MEASURED_2026),
    );
    expect(out).toContain("2026-07");
    expect(out).toContain("RED 미상");
    expect(out).toContain("orchestrator-silent");
  });
});
