// betaSegments 순수 로직 단위테스트 (adminAnalytics.test.ts 규약).
// 실행:
//   tsc src/adminAnalytics.ts src/betaSegments.ts src/betaSegments.test.ts \
//       --outDir .test-out/beta-segments --module commonjs --target es2020 \
//       --esModuleInterop --strict --skipLibCheck \
//   && node --test .test-out/beta-segments/betaSegments.test.js
// package.json: npm run test:beta-segments
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  classifyGrantReason,
  buildGrantRoster,
  buildBetaSegmentUsage,
  MIN_COHORT_SIZE,
  BETA_SEGMENT_LABELS,
  type GrantHolderRow,
  type SegmentActivityRow,
  type SegmentEventRow,
  type SegmentSessionRow,
} from "./betaSegments";

// ── 분류 ─────────────────────────────────────────────────────────────────────

test("classifyGrantReason maps known reasons and folds the rest into other", () => {
  assert.equal(classifyGrantReason("founder_backfill"), "founder_backfill");
  assert.equal(classifyGrantReason("beta_selected"), "beta_selected");
  assert.equal(classifyGrantReason("beta_signup"), "beta_signup");
  assert.equal(classifyGrantReason("  beta_signup  "), "beta_signup");
  // 미지/누락 reason 이 모수에서 사라지면 안 된다.
  assert.equal(classifyGrantReason("something_new"), "other");
  assert.equal(classifyGrantReason(undefined), "other");
  assert.equal(classifyGrantReason(null), "other");
  assert.equal(classifyGrantReason(123), "other");
  // "other" 를 직접 보내도 other 로 접힌다.
  assert.equal(classifyGrantReason("other"), "other");
});

test("buildGrantRoster counts each uid once and skips blanks", () => {
  const rows: GrantHolderRow[] = [
    { uid: "a", founderGrantReason: "founder_backfill" },
    { uid: "b", founderGrantReason: "beta_selected" },
    { uid: "a", founderGrantReason: "beta_signup" }, // 중복 uid → 최초 승리
    { uid: "", founderGrantReason: "beta_selected" }, // 빈 uid → 무시
    { uid: "c", founderGrantReason: "unknown_reason" },
  ];
  const roster = buildGrantRoster(rows);
  assert.equal(roster.total, 3);
  assert.equal(roster.cohortSizes.founder_backfill, 1);
  assert.equal(roster.cohortSizes.beta_selected, 1);
  assert.equal(roster.cohortSizes.beta_signup, 0);
  assert.equal(roster.cohortSizes.other, 1);
  assert.equal(roster.segmentOf.get("a"), "founder_backfill");
});

// ── 헬퍼: N명짜리 세그먼트를 만든다 ─────────────────────────────────────────

function holders(prefix: string, n: number, reason: string): GrantHolderRow[] {
  return Array.from({ length: n }, (_, i) => ({
    uid: `${prefix}${i}`,
    founderGrantReason: reason,
  }));
}

function activity(
  prefix: string,
  n: number,
  activeDays: number,
  first = "2026-08-01",
  last = "2026-08-05",
): SegmentActivityRow[] {
  return Array.from({ length: n }, (_, i) => ({
    userId: `${prefix}${i}`,
    activeDays,
    firstActiveDate: first,
    lastActiveDate: last,
    events: activeDays * 10,
  }));
}

// ── 최소 코호트 가드(프라이버시 핵심) ───────────────────────────────────────

test("segment below MIN_COHORT_SIZE is suppressed but keeps its counts", () => {
  const n = MIN_COHORT_SIZE - 1;
  const out = buildBetaSegmentUsage({
    grantHolders: holders("u", 10, "beta_selected"),
    activityRows: activity("u", n, 3),
    eventRows: Array.from({ length: n }, (_, i) => ({
      userId: `u${i}`,
      event: "agent:spawned",
      n: 5,
    })),
    sessionRows: [],
  });
  const seg = out.segments.find((s) => s.key === "beta_selected");
  assert.ok(seg);
  assert.equal(seg.suppressed, true);
  // 카운트는 살아 있어야 "grant 10명 중 4명 관측"을 말할 수 있다.
  assert.equal(seg.cohortSize, 10);
  assert.equal(seg.observedUsers, n);
  assert.equal(seg.observedRate, n / 10);
  // 행동지표는 전부 비어야 한다.
  assert.deepEqual(seg.featureUsage, []);
  assert.equal(seg.sessions, null);
  assert.equal(seg.rhythm, null);
  assert.equal(seg.adoption, null);
  assert.match(seg.suppressionReason ?? "", /최소 코호트/);
});

test("segment with zero observed users reports the no-observation reason", () => {
  const out = buildBetaSegmentUsage({
    grantHolders: holders("u", 7, "founder_backfill"),
    activityRows: [],
    eventRows: [],
    sessionRows: [],
  });
  const seg = out.segments.find((s) => s.key === "founder_backfill");
  assert.ok(seg);
  assert.equal(seg.suppressed, true);
  assert.equal(seg.observedUsers, 0);
  assert.equal(seg.observedRate, 0);
  assert.equal(seg.suppressionReason, "관측된 계정 없음");
  assert.equal(out.accountAttributionAvailable, false);
});

test("segment at exactly MIN_COHORT_SIZE is released", () => {
  const n = MIN_COHORT_SIZE;
  const out = buildBetaSegmentUsage({
    grantHolders: holders("u", n, "beta_selected"),
    activityRows: activity("u", n, 4),
    eventRows: Array.from({ length: n }, (_, i) => ({
      userId: `u${i}`,
      event: "agent:spawned",
      n: 3,
    })),
    sessionRows: [],
  });
  const seg = out.segments.find((s) => s.key === "beta_selected");
  assert.ok(seg);
  assert.equal(seg.suppressed, false);
  assert.equal(seg.observedUsers, n);
  assert.deepEqual(seg.featureUsage, [
    { event: "agent:spawned", users: n, count: 3 * n },
  ]);
});

// ── 집계 정확성 ──────────────────────────────────────────────────────────────

test("feature usage aggregates users and counts per event, sorted by users", () => {
  const n = 6;
  const eventRows: SegmentEventRow[] = [];
  for (let i = 0; i < n; i++) {
    eventRows.push({ userId: `u${i}`, event: "agent:spawned", n: 2 });
    // 절반만 오케를 연다.
    if (i < 3) {
      eventRows.push({
        userId: `u${i}`,
        event: "onboarding:orchestrator_opened",
        n: 1,
      });
    }
  }
  const out = buildBetaSegmentUsage({
    grantHolders: holders("u", n, "beta_selected"),
    activityRows: activity("u", n, 2),
    eventRows,
    sessionRows: [],
  });
  const seg = out.segments.find((s) => s.key === "beta_selected");
  assert.ok(seg && !seg.suppressed);
  assert.deepEqual(seg.featureUsage, [
    { event: "agent:spawned", users: 6, count: 12 },
    { event: "onboarding:orchestrator_opened", users: 3, count: 3 },
  ]);
  // 채택: 스폰 6/6, 오케 3/6, 티켓 0.
  assert.equal(seg.adoption?.spawnUsers, 6);
  assert.equal(seg.adoption?.spawnRate, 1);
  assert.equal(seg.adoption?.orchestratorUsers, 3);
  assert.equal(seg.adoption?.orchestratorRate, 0.5);
  assert.equal(seg.adoption?.ticketUsers, 0);
  assert.equal(seg.adoption?.ticketRate, 0);
  assert.equal(out.accountAttributionAvailable, true);
});

test("adoption counts a user once even across multiple events of the same axis", () => {
  const n = 5;
  const eventRows: SegmentEventRow[] = [];
  for (let i = 0; i < n; i++) {
    // 티켓 축의 서로 다른 두 이벤트를 같은 유저가 낸다 → 1명으로만 세야 한다.
    eventRows.push({ userId: `u${i}`, event: "task:created", n: 1 });
    eventRows.push({ userId: `u${i}`, event: "task:completed", n: 4 });
  }
  const out = buildBetaSegmentUsage({
    grantHolders: holders("u", n, "beta_signup"),
    activityRows: activity("u", n, 1),
    eventRows,
    sessionRows: [],
  });
  const seg = out.segments.find((s) => s.key === "beta_signup");
  assert.equal(seg?.adoption?.ticketUsers, n);
});

test("session stats average over sessions, not over users", () => {
  const n = 5;
  const sessionRows: SegmentSessionRow[] = [
    { userId: "u0", sessions: 4, totalMs: 400, medianMs: 100 },
    { userId: "u1", sessions: 1, totalMs: 600, medianMs: 600 },
    { userId: "u2", sessions: 0, totalMs: 0, medianMs: 0 }, // 무시
    { userId: "u3", sessions: 3, totalMs: 300, medianMs: 100 },
    { userId: "u4", sessions: 2, totalMs: 700, medianMs: 350 },
  ];
  const out = buildBetaSegmentUsage({
    grantHolders: holders("u", n, "beta_selected"),
    activityRows: activity("u", n, 3),
    eventRows: Array.from({ length: n }, (_, i) => ({
      userId: `u${i}`,
      event: "session:started",
      n: 1,
    })),
    sessionRows,
  });
  const seg = out.segments.find((s) => s.key === "beta_selected");
  assert.ok(seg && seg.sessions);
  assert.equal(seg.sessions.sessions, 10);
  // 총 2000ms / 10 세션 = 200 (유저 평균 아님).
  assert.equal(seg.sessions.avgDurationMs, 200);
  assert.equal(seg.sessions.sessionsPerUser, 2);
  // 중앙값 후보 [100,100,350,600] → 하위 중앙 100.
  assert.equal(seg.sessions.medianDurationMs, 100);
});

test("rhythm counts returning users by active days and spans first→last", () => {
  const n = 5;
  const activityRows: SegmentActivityRow[] = [
    {
      userId: "u0",
      activeDays: 1,
      firstActiveDate: "2026-08-01",
      lastActiveDate: "2026-08-01",
    },
    {
      userId: "u1",
      activeDays: 5,
      firstActiveDate: "2026-08-01",
      lastActiveDate: "2026-08-11",
    },
    {
      userId: "u2",
      activeDays: 2,
      firstActiveDate: "2026-08-02",
      lastActiveDate: "2026-08-04",
    },
    {
      userId: "u3",
      activeDays: 1,
      firstActiveDate: "2026-08-03",
      lastActiveDate: "2026-08-03",
    },
    {
      userId: "u4",
      activeDays: 6,
      firstActiveDate: "2026-08-01",
      lastActiveDate: "2026-08-06",
    },
  ];
  const out = buildBetaSegmentUsage({
    grantHolders: holders("u", n, "founder_backfill"),
    activityRows,
    eventRows: Array.from({ length: n }, (_, i) => ({
      userId: `u${i}`,
      event: "session:started",
      n: 1,
    })),
    sessionRows: [],
  });
  const seg = out.segments.find((s) => s.key === "founder_backfill");
  assert.ok(seg && seg.rhythm);
  // 활동일 2일 이상 = u1,u2,u4 → 3명.
  assert.equal(seg.rhythm.returningUsers, 3);
  assert.equal(seg.rhythm.returningRate, 3 / 5);
  assert.equal(seg.rhythm.avgActiveDays, (1 + 5 + 2 + 1 + 6) / 5);
  // span: 0,10,2,0,5 → 평균 3.4
  assert.equal(seg.rhythm.avgSpanDays, (0 + 10 + 2 + 0 + 5) / 5);
});

// ── 모수 경계 ────────────────────────────────────────────────────────────────

test("BQ rows for non-grant accounts never leak into the segment view", () => {
  const n = 5;
  const out = buildBetaSegmentUsage({
    grantHolders: holders("u", n, "beta_selected"),
    activityRows: [
      ...activity("u", n, 3),
      // grant 명단에 없는 계정 — 무시돼야 한다.
      {
        userId: "stranger",
        activeDays: 99,
        firstActiveDate: "2026-01-01",
        lastActiveDate: "2026-08-01",
      },
    ],
    eventRows: [
      ...Array.from({ length: n }, (_, i) => ({
        userId: `u${i}`,
        event: "agent:spawned",
        n: 1,
      })),
      { userId: "stranger", event: "agent:spawned", n: 1000 },
    ],
    sessionRows: [
      { userId: "stranger", sessions: 50, totalMs: 5, medianMs: 1 },
    ],
  });
  assert.equal(out.observedUsers, n);
  const seg = out.segments.find((s) => s.key === "beta_selected");
  assert.equal(seg?.featureUsage[0].count, n); // 1000 이 새어 들어오지 않았다
  assert.equal(seg?.sessions?.sessions, 0);
});

test("all-segment rolls up across segments and can pass the guard when parts cannot", () => {
  // 세그먼트별로는 3명씩이라 전부 억제되지만, 합치면 6명이라 전체는 공개된다.
  const grantHolders = [
    ...holders("f", 3, "founder_backfill"),
    ...holders("b", 3, "beta_selected"),
  ];
  const activityRows = [...activity("f", 3, 2), ...activity("b", 3, 2)];
  const eventRows: SegmentEventRow[] = [
    ...Array.from({ length: 3 }, (_, i) => ({
      userId: `f${i}`,
      event: "agent:spawned",
      n: 1,
    })),
    ...Array.from({ length: 3 }, (_, i) => ({
      userId: `b${i}`,
      event: "agent:spawned",
      n: 1,
    })),
  ];
  const out = buildBetaSegmentUsage({
    grantHolders,
    activityRows,
    eventRows,
    sessionRows: [],
  });
  assert.equal(out.grantCohortSize, 6);
  assert.equal(out.observedUsers, 6);
  assert.ok(out.segments.every((s) => s.suppressed));
  assert.equal(out.all.suppressed, false);
  assert.equal(out.all.label, "베타 전체");
  assert.equal(out.all.adoption?.spawnUsers, 6);
});

test("segments with an empty cohort are dropped from the response", () => {
  const out = buildBetaSegmentUsage({
    grantHolders: holders("u", 2, "beta_signup"),
    activityRows: [],
    eventRows: [],
    sessionRows: [],
  });
  assert.deepEqual(
    out.segments.map((s) => s.key),
    ["beta_signup"],
  );
  assert.equal(out.segments[0].label, BETA_SEGMENT_LABELS.beta_signup);
});

test("empty input is safe", () => {
  const out = buildBetaSegmentUsage({
    grantHolders: [],
    activityRows: [],
    eventRows: [],
    sessionRows: [],
  });
  assert.equal(out.grantCohortSize, 0);
  assert.equal(out.observedUsers, 0);
  assert.deepEqual(out.segments, []);
  assert.equal(out.all.suppressed, true);
  assert.equal(out.all.observedRate, null); // 분모 0 → null (0% 로 오도 금지)
  assert.equal(out.minCohortSize, MIN_COHORT_SIZE);
});
