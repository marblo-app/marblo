// projectAudit 순수 로직 단위테스트 (adminAnalytics.test.ts 규약).
// 실행:
//   npm run test:project-audit
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  coerceNumber,
  coerceString,
  truncateText,
  toMillis,
  toIso,
  parseTaskStatus,
  missionIdFromContext,
  agentClaimKeys,
  evaluateAttention,
  buildProjectAudit,
  buildExecutionLedger,
  coerceNullableNumber,
  readAgentModelAxes,
  mapProject,
  mapMission,
  mapMerge,
  STALLED_AFTER_MS,
  TEXT_MAX,
  type RawDoc,
} from "./projectAudit";

// ── 스칼라 헬퍼 ──────────────────────────────────────────────────────────────

test("coerceNumber: 숫자/문자열/쓰레기", () => {
  assert.equal(coerceNumber(3), 3);
  assert.equal(coerceNumber("42"), 42);
  assert.equal(coerceNumber("abc"), 0);
  assert.equal(coerceNumber(NaN), 0);
  assert.equal(coerceNumber(null), 0);
});

test("coerceString: 빈 문자열은 null(빈값으로 위장 금지)", () => {
  assert.equal(coerceString("  hi  "), "hi");
  assert.equal(coerceString("   "), null);
  assert.equal(coerceString(""), null);
  assert.equal(coerceString(undefined), null);
  assert.equal(coerceString(7), "7");
});

test("truncateText: 상한 초과분은 말줄임표로 잘렸음을 밝힌다", () => {
  assert.equal(truncateText("short", 10), "short");
  const long = "x".repeat(20);
  const cut = truncateText(long, 10);
  assert.equal(cut, `${"x".repeat(10)}…`);
  assert.equal(truncateText(null, 10), null);
});

test("toMillis: Date / Timestamp(toDate) / _seconds / ISO / epoch", () => {
  const d = new Date("2026-08-01T00:00:00.000Z");
  assert.equal(toMillis(d), d.getTime());
  assert.equal(toMillis({ toDate: () => d }), d.getTime());
  assert.equal(toMillis({ _seconds: 1000 }), 1_000_000);
  assert.equal(toMillis({ seconds: 2000 }), 2_000_000);
  assert.equal(toMillis("2026-08-01T00:00:00.000Z"), d.getTime());
  assert.equal(toMillis(12345), 12345);
});

test("toMillis/toIso: 못 읽는 값은 null — 0(1970)으로 접지 않는다", () => {
  assert.equal(toMillis(undefined), null);
  assert.equal(toMillis("not a date"), null);
  assert.equal(toMillis({}), null);
  assert.equal(toIso(undefined), null);
  assert.equal(
    toIso(new Date("2026-08-01T00:00:00.000Z")),
    "2026-08-01T00:00:00.000Z",
  );
});

test("toMillis: toDate 가 throw 해도 null 로 떨어진다", () => {
  assert.equal(
    toMillis({
      toDate: () => {
        throw new Error("boom");
      },
    }),
    null,
  );
});

// ── 상태 / 미션 귀속 ─────────────────────────────────────────────────────────

test("parseTaskStatus: 7원소 밖은 null(없는 상태를 발명하지 않는다)", () => {
  assert.equal(parseTaskStatus("DONE"), "DONE");
  assert.equal(parseTaskStatus("IN_PROGRESS"), "IN_PROGRESS");
  assert.equal(parseTaskStatus("done"), null);
  assert.equal(parseTaskStatus("WAT"), null);
  assert.equal(parseTaskStatus(undefined), null);
});

test("missionIdFromContext: board/lane 은 미션이 아니다", () => {
  assert.equal(missionIdFromContext("board"), null);
  assert.equal(missionIdFromContext("lane:abc"), null);
  assert.equal(missionIdFromContext(undefined), null);
  assert.equal(missionIdFromContext(""), null);
  assert.equal(missionIdFromContext("mission-123"), "mission-123");
});

// ── 고아 클레임 키 ───────────────────────────────────────────────────────────

test("agentClaimKeys: id·name·소문자 name 3갈래를 모두 담는다", () => {
  const keys = agentClaimKeys([{ id: "a1", name: "Backend-1" }]);
  assert.ok(keys.has("a1"));
  assert.ok(keys.has("Backend-1"));
  assert.ok(keys.has("backend-1"));
  assert.equal(keys.size, 3);
});

test("agentClaimKeys: 빈 값은 키로 넣지 않는다", () => {
  const keys = agentClaimKeys([{ id: "", name: "  " }, {}]);
  assert.equal(keys.size, 0);
});

// ── 주의 필요 판정 ───────────────────────────────────────────────────────────

const baseAttn = {
  status: "IN_PROGRESS" as const,
  claimedBy: "a1",
  archived: false,
  deleted: false,
  failedCount: 0,
  latestMs: 1_000_000,
};

test("evaluateAttention: 끝난·보관·삭제 티켓은 실패 이력이 있어도 null", () => {
  const withFailures = { ...baseAttn, failedCount: 5 };
  assert.equal(
    evaluateAttention(
      { ...withFailures, status: "DONE" },
      { nowMs: 1_000_000 },
    ),
    null,
  );
  assert.equal(
    evaluateAttention(
      { ...withFailures, archived: true },
      { nowMs: 1_000_000 },
    ),
    null,
  );
  assert.equal(
    evaluateAttention({ ...withFailures, deleted: true }, { nowMs: 1_000_000 }),
    null,
  );
});

test("evaluateAttention: FAILED=critical, BLOCKED=warning", () => {
  const failed = evaluateAttention(
    { ...baseAttn, status: "FAILED" },
    { nowMs: 1_000_000 },
  );
  assert.deepEqual(failed?.kinds, ["taskFailed"]);
  assert.equal(failed?.severity, "critical");

  const blocked = evaluateAttention(
    { ...baseAttn, status: "BLOCKED" },
    { nowMs: 1_000_000 },
  );
  assert.deepEqual(blocked?.kinds, ["taskBlocked"]);
  assert.equal(blocked?.severity, "warning");
});

test("evaluateAttention: 실패 툴 호출은 critical", () => {
  const r = evaluateAttention(
    { ...baseAttn, failedCount: 2 },
    { nowMs: 1_000_000 },
  );
  assert.deepEqual(r?.kinds, ["failedActions"]);
  assert.equal(r?.severity, "critical");
});

test("★evaluateAttention: liveAgentKeys 미지정이면 고아 클레임 판정 자체를 안 한다", () => {
  // 에이전트 목록을 못 읽은 상태에서 빈 집합을 넘기면 진행중 티켓이 전부 고아로
  // 뜬다 — '모름'을 '없음'으로 접지 않는 규칙.
  assert.equal(evaluateAttention(baseAttn, { nowMs: 1_000_000 }), null);
  assert.equal(
    evaluateAttention(baseAttn, { nowMs: 1_000_000, liveAgentKeys: null }),
    null,
  );
});

test("evaluateAttention: 살아있는 키에 없으면 고아 클레임(critical)", () => {
  const r = evaluateAttention(baseAttn, {
    nowMs: 1_000_000,
    liveAgentKeys: new Set(["other"]),
  });
  assert.deepEqual(r?.kinds, ["orphanedClaim"]);
  assert.equal(r?.severity, "critical");
});

test("evaluateAttention: 이름으로 물린 클레임도 살아있으면 고아가 아니다", () => {
  const r = evaluateAttention(
    { ...baseAttn, claimedBy: "Backend-1" },
    {
      nowMs: 1_000_000,
      liveAgentKeys: agentClaimKeys([{ id: "a1", name: "Backend-1" }]),
    },
  );
  assert.equal(r, null);
});

test("evaluateAttention: 대소문자 차이도 고아로 세지 않는다", () => {
  const r = evaluateAttention(
    { ...baseAttn, claimedBy: "backend-1" },
    {
      nowMs: 1_000_000,
      liveAgentKeys: agentClaimKeys([{ id: "a1", name: "Backend-1" }]),
    },
  );
  assert.equal(r, null);
});

test("evaluateAttention: 6시간 무기록이면 정체(warning), idleMs 를 근거로 남긴다", () => {
  const latestMs = 1_000_000;
  const nowMs = latestMs + STALLED_AFTER_MS;
  const r = evaluateAttention(
    { ...baseAttn, latestMs },
    { nowMs, liveAgentKeys: new Set(["a1"]) },
  );
  assert.deepEqual(r?.kinds, ["stalled"]);
  assert.equal(r?.severity, "warning");
  assert.equal(r?.idleMs, STALLED_AFTER_MS);
});

test("evaluateAttention: 임계 직전은 정체가 아니다", () => {
  const latestMs = 1_000_000;
  const r = evaluateAttention(
    { ...baseAttn, latestMs },
    { nowMs: latestMs + STALLED_AFTER_MS - 1, liveAgentKeys: new Set(["a1"]) },
  );
  assert.equal(r, null);
});

test("★evaluateAttention: 시각을 못 읽으면(latestMs=null) 정체 판정 제외", () => {
  // 손상된 시각을 1970 으로 읽으면 모든 손상 행이 최우선 경보가 된다.
  const r = evaluateAttention(
    { ...baseAttn, latestMs: null },
    { nowMs: 9_999_999_999, liveAgentKeys: new Set(["a1"]) },
  );
  assert.equal(r, null);
});

test("evaluateAttention: TODO 는 미착수라 정체/고아 판정 대상이 아니다", () => {
  const r = evaluateAttention(
    { ...baseAttn, status: "TODO", latestMs: 0 },
    { nowMs: 9_999_999_999, liveAgentKeys: new Set(["nobody"]) },
  );
  assert.equal(r, null);
});

test("evaluateAttention: 여러 사유가 겹치면 모두 남기고 severity 는 최악을 따른다", () => {
  const latestMs = 1_000_000;
  const r = evaluateAttention(
    { ...baseAttn, status: "BLOCKED", failedCount: 1, latestMs },
    { nowMs: latestMs + STALLED_AFTER_MS, liveAgentKeys: new Set(["nope"]) },
  );
  // BLOCKED 는 in-flight 가 아니므로 고아/정체는 붙지 않는다.
  assert.deepEqual(r?.kinds, ["taskBlocked", "failedActions"]);
  assert.equal(r?.severity, "critical");
});

// ── 매퍼 ─────────────────────────────────────────────────────────────────────

test("★mapProject: 기기별 로컬 경로는 절대 응답에 담지 않는다", () => {
  const out = mapProject({
    id: "p1",
    name: "Marblo",
    ownerId: "u1",
    members: ["u1", "u2"],
    folderPath: "/Users/secret/code",
    folderPaths: { mac: "/Users/secret/code" },
    legacyFolderPath: "/Users/secret/old",
  });
  assert.equal(out.id, "p1");
  assert.equal(out.name, "Marblo");
  assert.equal(out.memberCount, 2);
  const serialized = JSON.stringify(out);
  assert.ok(!serialized.includes("/Users/secret"));
  assert.ok(!("folderPath" in out));
  assert.ok(!("folderPaths" in out));
});

test("mapMission: projection.statusCounts 를 읽고 0 은 버린다", () => {
  const out = mapMission({
    id: "m1",
    goal: "목표",
    status: "in_progress",
    taskIds: ["t1", "t2", "t3"],
    projection: { statusCounts: { DONE: 2, TODO: 0, FAILED: 1 } },
  });
  assert.equal(out.taskCount, 3);
  assert.equal(out.doneCount, 2);
  assert.deepEqual(out.statusCounts, { DONE: 2, FAILED: 1 });
});

test("mapMission: projection 이 없으면 0 으로 떨어지되 taskIds 는 살린다", () => {
  const out = mapMission({ id: "m2", taskIds: ["t1"] });
  assert.equal(out.taskCount, 1);
  assert.equal(out.doneCount, 0);
  assert.deepEqual(out.statusCounts, {});
  assert.equal(out.goal, null);
});

test("mapMerge: prNumber 0/누락은 null 로", () => {
  assert.equal(mapMerge({ id: "g1", prNumber: 0 }).prNumber, null);
  assert.equal(mapMerge({ id: "g2" }).prNumber, null);
  assert.equal(mapMerge({ id: "g3", prNumber: 42 }).prNumber, 42);
  // 0 은 유효한 측정값이다 — null 로 접지 않는다.
  assert.equal(mapMerge({ id: "g4", filesChanged: 0 }).filesChanged, 0);
  assert.equal(mapMerge({ id: "g5" }).filesChanged, null);
});

// ── 전체 조립 ────────────────────────────────────────────────────────────────

const NOW = Date.parse("2026-08-06T12:00:00.000Z");
const ago = (ms: number): Date => new Date(NOW - ms);

function fixture(
  overrides: Partial<Parameters<typeof buildProjectAudit>[0]> = {},
): Parameters<typeof buildProjectAudit>[0] {
  const tasks: RawDoc[] = [
    {
      id: "t-done",
      title: "완료 티켓",
      status: "DONE",
      role: "backend",
      priority: 3,
      contextId: "board",
      prUrl: "https://github.com/x/y/pull/1",
      claimedBy: "a1",
      updatedAt: ago(60_000),
    },
    {
      id: "t-failed",
      title: "실패 티켓",
      status: "FAILED",
      role: "frontend",
      contextId: "m1",
      claimedBy: "a1",
      updatedAt: ago(60_000),
    },
    {
      id: "t-stalled",
      title: "정체 티켓",
      status: "IN_PROGRESS",
      contextId: "lane:l1",
      claimedBy: "a1",
      updatedAt: ago(STALLED_AFTER_MS + 60_000),
    },
    {
      id: "t-open",
      title: "정상 진행",
      status: "IN_PROGRESS",
      contextId: "m1",
      claimedBy: "a1",
      updatedAt: ago(60_000),
    },
    {
      id: "t-deleted",
      title: "지워진 티켓",
      status: "TODO",
      deleted: true,
      updatedAt: ago(60_000),
    },
  ];
  return {
    projects: [{ id: "p1", name: "Marblo", members: ["u1"] }],
    projectId: "p1",
    tasks,
    agents: [
      {
        id: "a1",
        name: "backend-1",
        model: "claude",
        role: "backend",
        status: "working",
        currentTaskId: "t-open",
        totalCost: 1.5,
      },
    ],
    activities: [
      {
        id: "act1",
        taskId: "t-open",
        agentId: "a1",
        message: "진행 중",
        createdAt: ago(30_000),
      },
      {
        id: "act2",
        taskId: "t-open",
        agentId: "a1",
        message: "또 진행",
        createdAt: ago(20_000),
      },
    ],
    ledger: [
      {
        id: "l1",
        taskId: "t-failed",
        agentId: "a1",
        toolName: "update_task_status",
        success: false,
        result: "실패 사유",
        params: { secret: "sk-should-never-leak" },
        createdAt: ago(40_000),
      },
    ],
    missions: [
      {
        id: "m1",
        goal: "미션 목표",
        status: "in_progress",
        taskIds: ["t-failed", "t-open"],
        projection: { statusCounts: { DONE: 0, FAILED: 1, IN_PROGRESS: 1 } },
        updatedAt: ago(10_000),
      },
    ],
    merges: [
      {
        id: "g1",
        taskId: "t-done",
        repoRoot: "melocream/marblo",
        branch: "feat/x",
        prNumber: 1,
        mergedAt: ago(50_000),
        filesChanged: 3,
        linesAdded: 10,
        linesDeleted: 2,
      },
    ],
    agentsLoaded: true,
    nowMs: NOW,
    ...overrides,
  };
}

test("buildProjectAudit: 요약 집계(삭제 제외, open/done 분리)", () => {
  const r = buildProjectAudit(fixture());
  // t-deleted 는 어디에도 안 센다.
  assert.equal(r.summary.tasksTotal, 4);
  assert.equal(r.summary.tasksDone, 1);
  assert.equal(r.summary.tasksOpen, 3);
  assert.equal(r.summary.tasksByStatus["DONE"], 1);
  assert.equal(r.summary.tasksByStatus["FAILED"], 1);
  assert.equal(r.summary.tasksByStatus["IN_PROGRESS"], 2);
  assert.equal(r.summary.agentsTotal, 1);
  assert.equal(r.summary.agentsWorking, 1);
  assert.equal(r.summary.missionsTotal, 1);
  assert.equal(r.summary.missionsActive, 1);
  assert.equal(r.summary.mergesTotal, 1);
  assert.equal(r.summary.prCount, 1);
  assert.equal(r.projectId, "p1");
});

test("buildProjectAudit: 주의 목록 = 실패 + 정체(완료 티켓은 제외)", () => {
  const r = buildProjectAudit(fixture());
  const ids = r.attention.map((t) => t.id).sort();
  assert.deepEqual(ids, ["t-failed", "t-stalled"]);
  assert.equal(r.summary.attentionCount, 2);
  // t-failed 는 상태 + 실패 툴 호출 둘 다.
  const failed = r.attention.find((t) => t.id === "t-failed");
  assert.deepEqual(failed?.attention?.kinds, ["taskFailed", "failedActions"]);
  assert.equal(failed?.failedActions, 1);
  assert.equal(r.summary.criticalCount, 1);
});

test("buildProjectAudit: 티켓 정렬은 critical → warning → 최신순", () => {
  const r = buildProjectAudit(fixture());
  assert.equal(r.tickets[0].id, "t-failed"); // critical
  assert.equal(r.tickets[1].id, "t-stalled"); // warning
});

test("buildProjectAudit: 미션 귀속은 contextId 에서 파생(board/lane 은 null)", () => {
  const r = buildProjectAudit(fixture());
  const byId = new Map(r.tickets.map((t) => [t.id, t]));
  assert.equal(byId.get("t-failed")?.missionId, "m1");
  assert.equal(byId.get("t-open")?.missionId, "m1");
  assert.equal(byId.get("t-done")?.missionId, null); // board
  assert.equal(byId.get("t-stalled")?.missionId, null); // lane:*
});

test("buildProjectAudit: 활동 수는 티켓별로 센다", () => {
  const r = buildProjectAudit(fixture());
  const open = r.tickets.find((t) => t.id === "t-open");
  assert.equal(open?.activityCount, 2);
});

test("★buildProjectAudit: 원장 params 는 응답 어디에도 실리지 않는다", () => {
  const r = buildProjectAudit(fixture());
  // 값이 새지 않는가 — 이게 본질이다.
  assert.ok(!JSON.stringify(r).includes("sk-should-never-leak"));
  // 키 자체도 어느 행에도 붙지 않는가. (notes 본문은 규율을 설명하느라 "params"
  // 라는 낱말을 쓰므로 문자열 포함 검사가 아니라 **구조**를 본다.)
  for (const row of r.timeline) {
    assert.ok(!("params" in row), `타임라인 행에 params 가 붙었다: ${row.id}`);
  }
  for (const t of r.tickets) {
    assert.ok(!("params" in t), `티켓 행에 params 가 붙었다: ${t.id}`);
  }
});

test("buildProjectAudit: 원장 행은 instructionRedacted 를 우선 노출한다", () => {
  const base = fixture();
  const r = buildProjectAudit({
    ...base,
    ledger: [
      {
        id: "l9",
        taskId: "t-open",
        agentId: "a1",
        toolName: "spawn_agent",
        success: true,
        instructionRedacted: "마스킹된 지시문",
        result: "원시 결과",
        params: { token: "leak-me" },
        createdAt: ago(5_000),
      },
    ],
  });
  const row = r.timeline.find((t) => t.id === "ledger:l9");
  assert.equal(row?.text, "마스킹된 지시문");
  assert.equal(row?.label, "spawn_agent");
  assert.equal(row?.success, true);
  assert.ok(!JSON.stringify(r).includes("leak-me"));
});

test("buildProjectAudit: 긴 활동 메시지는 절단된다", () => {
  const base = fixture();
  const long = "가".repeat(TEXT_MAX + 50);
  const r = buildProjectAudit({
    ...base,
    activities: [
      {
        id: "actL",
        taskId: "t-open",
        agentId: "a1",
        message: long,
        createdAt: ago(1000),
      },
    ],
  });
  const row = r.timeline.find((t) => t.id === "activity:actL");
  assert.equal(row?.text?.length, TEXT_MAX + 1); // 절단분 + 말줄임표
  assert.ok(row?.text?.endsWith("…"));
});

test("buildProjectAudit: 타임라인은 3소스 병합 + 최신순", () => {
  const r = buildProjectAudit(fixture());
  const kinds = new Set(r.timeline.map((t) => t.kind));
  assert.ok(kinds.has("activity"));
  assert.ok(kinds.has("ledger"));
  assert.ok(kinds.has("merge"));
  const times = r.timeline
    .map((t) => Date.parse(t.at ?? ""))
    .filter(Number.isFinite);
  for (let i = 1; i < times.length; i++) {
    assert.ok(times[i - 1] >= times[i], "타임라인이 최신순이어야 한다");
  }
  // 티켓 제목이 조인된다.
  const act = r.timeline.find((t) => t.id === "activity:act1");
  assert.equal(act?.taskTitle, "정상 진행");
});

test("buildProjectAudit: 시각 없는 행도 버리지 않고 맨 뒤로 보낸다", () => {
  const base = fixture();
  const r = buildProjectAudit({
    ...base,
    activities: [
      ...base.activities,
      {
        id: "actNoTime",
        taskId: "t-open",
        agentId: "a1",
        message: "시각 손상",
      },
    ],
  });
  const idx = r.timeline.findIndex((t) => t.id === "activity:actNoTime");
  assert.ok(idx >= 0, "조용한 누락 금지");
  assert.equal(idx, r.timeline.length - 1);
});

test("buildProjectAudit: 타임라인 상한 초과는 잘리고 notes 에 밝힌다", () => {
  const base = fixture();
  const many: RawDoc[] = Array.from({ length: 10 }, (_, i) => ({
    id: `bulk${i}`,
    taskId: "t-open",
    agentId: "a1",
    message: `m${i}`,
    createdAt: ago(1000 + i),
  }));
  const r = buildProjectAudit({
    ...base,
    activities: many,
    timelineLimit: 4,
  });
  assert.equal(r.timeline.length, 4);
  assert.ok(r.notes.some((n) => n.includes("잘렸다")));
});

test("★buildProjectAudit: agentsLoaded=false 면 고아 판정을 하지 않고 그 사실을 밝힌다", () => {
  const base = fixture();
  const r = buildProjectAudit({
    ...base,
    agents: [],
    agentsLoaded: false,
  });
  const orphans = r.attention.filter((t) =>
    t.attention?.kinds.includes("orphanedClaim"),
  );
  assert.equal(orphans.length, 0);
  assert.ok(r.notes.some((n) => n.includes("고아 클레임 판정을 생략")));
});

test("buildProjectAudit: 에이전트를 읽었고 클레임 주인이 없으면 고아로 뜬다", () => {
  const base = fixture();
  const r = buildProjectAudit({
    ...base,
    agents: [{ id: "someone-else", name: "other", status: "idle" }],
    agentsLoaded: true,
  });
  const orphans = r.attention
    .filter((t) => t.attention?.kinds.includes("orphanedClaim"))
    .map((t) => t.id)
    .sort();
  // 진행 중(IN_PROGRESS)인 두 티켓만. DONE/FAILED 는 in-flight 가 아니다.
  assert.deepEqual(orphans, ["t-open", "t-stalled"]);
});

test("buildProjectAudit: 워크로드는 이름/id 양쪽으로 클레임을 센다", () => {
  const base = fixture();
  const r = buildProjectAudit({
    ...base,
    tasks: [
      {
        id: "x1",
        status: "IN_PROGRESS",
        claimedBy: "a1",
        updatedAt: ago(1000),
      },
      {
        id: "x2",
        status: "IN_PROGRESS",
        claimedBy: "backend-1",
        updatedAt: ago(1000),
      },
      {
        id: "x3",
        status: "DONE",
        claimedBy: "Backend-1",
        updatedAt: ago(1000),
      },
    ],
  });
  assert.equal(r.workload.length, 1);
  assert.equal(r.workload[0].openTasks, 2);
  assert.equal(r.workload[0].doneTasks, 1);
  assert.equal(r.workload[0].model, "claude");
});

test("buildProjectAudit: spawnedModel 이 있으면 그걸 우선 표시한다", () => {
  const base = fixture();
  const r = buildProjectAudit({
    ...base,
    agents: [
      {
        id: "a1",
        name: "backend-1",
        model: "claude",
        spawnedModel: "MiniMax-M3",
      },
    ],
  });
  assert.equal(r.workload[0].model, "MiniMax-M3");
});

test("buildProjectAudit: 빈 프로젝트도 터지지 않고 0 으로 떨어진다", () => {
  const r = buildProjectAudit({
    projects: [],
    projectId: null,
    tasks: [],
    agents: [],
    activities: [],
    ledger: [],
    missions: [],
    merges: [],
    agentsLoaded: true,
    nowMs: NOW,
  });
  assert.equal(r.summary.tasksTotal, 0);
  assert.equal(r.summary.attentionCount, 0);
  assert.deepEqual(r.attention, []);
  assert.deepEqual(r.timeline, []);
  assert.equal(r.generatedAt, new Date(NOW).toISOString());
  assert.ok(r.notes.length > 0);
});

test("buildProjectAudit: 상태를 못 읽은 티켓은 (미기록) 칸으로 모은다", () => {
  const base = fixture();
  const r = buildProjectAudit({
    ...base,
    tasks: [{ id: "weird", status: "NOPE", updatedAt: ago(1000) }],
  });
  assert.equal(r.summary.tasksByStatus["(미기록)"], 1);
  assert.equal(r.tickets[0].status, null);
});

test("buildProjectAudit: notes 에 읽기전용 범위를 명시한다", () => {
  const r = buildProjectAudit(fixture());
  assert.ok(r.notes.some((n) => n.includes("읽기 전용")));
  assert.ok(r.notes.some((n) => n.includes("params")));
});

// ── 실행 원장 (Mission→Ticket→Agent→Model→Cost→Result) ──────────────────────
//
// ★이 블록이 못박는 것은 두 가지고, 둘 다 "발표에서 틀린 숫자가 나가는" 경로다:
//   (1) 결측을 0 으로 그리지 않는다 — 미측정과 실측 0 은 다른 사실이다.
//   (2) 하네스 축(agents.model / audit_logs.model)을 실제 모델로 승격시키지
//       않는다.
// 주석으로만 적힌 계약은 갈라진다(이 리포에서 이미 세 번). 그래서 테스트다.

test("coerceNullableNumber: 미측정(null)과 실측 0 을 가른다", () => {
  assert.equal(coerceNullableNumber(0), 0);
  assert.equal(coerceNullableNumber(1.5), 1.5);
  assert.equal(coerceNullableNumber("0"), 0);
  assert.equal(coerceNullableNumber(undefined), null);
  assert.equal(coerceNullableNumber(null), null);
  assert.equal(coerceNullableNumber(""), null);
  assert.equal(coerceNullableNumber("abc"), null);
  assert.equal(coerceNullableNumber(NaN), null);
  assert.equal(coerceNullableNumber(Infinity), null);
});

test("★readAgentModelAxes: 하네스(model)를 실제 모델로 승격시키지 않는다", () => {
  // 하네스만 있는 에이전트 — 실제 모델은 **모른다**.
  const onlyHarness = readAgentModelAxes({ model: "claude" });
  assert.equal(onlyHarness.actual, null);
  assert.equal(onlyHarness.actualSource, null);
  assert.equal(onlyHarness.harness, "claude");

  // spawnedModel 이 있으면 그게 실제 모델(argv 되읽기).
  const spawned = readAgentModelAxes({
    model: "claude",
    spawnedModel: "claude-opus-5",
  });
  assert.equal(spawned.actual, "claude-opus-5");
  assert.equal(spawned.actualSource, "spawnedModel");
  assert.equal(spawned.harness, "claude");

  // detectedModelId(과금 관측)가 더 강한 증거라 1순위.
  const detected = readAgentModelAxes({
    model: "gpt",
    spawnedModel: "gpt-5.6-sol@high",
    detectedModelId: "gpt-5.6-sol",
  });
  assert.equal(detected.actual, "gpt-5.6-sol");
  assert.equal(detected.actualSource, "detectedModelId");
  assert.equal(detected.harness, "gpt");
});

/** 실행 원장 픽스처 — 비용 롤업/모델 축이 갈리는 티켓들. */
function ledgerFixture(): Parameters<typeof buildProjectAudit>[0] {
  return fixture({
    tasks: [
      {
        id: "t-measured",
        title: "비용도 모델도 실측된 티켓",
        status: "DONE",
        role: "backend",
        contextId: "m1",
        claimedBy: "a-measured",
        prUrl: "https://github.com/x/y/pull/9",
        costTotal: 2.25,
        costInputTokens: 1000,
        costOutputTokens: 200,
        retriesCount: 1,
        completedAt: ago(10_000),
        updatedAt: ago(10_000),
      },
      {
        id: "t-zero-cost",
        title: "실측 0 원 티켓",
        status: "DONE",
        contextId: "m1",
        claimedBy: "a-measured",
        costTotal: 0,
        costInputTokens: 0,
        costOutputTokens: 0,
        updatedAt: ago(20_000),
      },
      {
        id: "t-unmeasured",
        title: "롤업 이전 티켓(비용 필드 없음)",
        status: "DONE",
        contextId: "m1",
        claimedBy: "a-harness-only",
        updatedAt: ago(30_000),
      },
      {
        id: "t-untouched",
        title: "아무도 손대지 않은 티켓",
        status: "TODO",
        contextId: "m1",
        updatedAt: ago(40_000),
      },
      {
        id: "t-ghost-agent",
        title: "에이전트 문서가 사라진 완료 티켓",
        status: "DONE",
        contextId: "board",
        claimedBy: "a-gone",
        updatedAt: ago(50_000),
      },
    ],
    agents: [
      {
        id: "a-measured",
        name: "backend-1",
        model: "claude",
        spawnedModel: "claude-opus-5",
        role: "backend",
        status: "working",
      },
      {
        id: "a-harness-only",
        name: "frontend-1",
        model: "codex",
        role: "frontend",
        status: "idle",
      },
    ],
    activities: [],
    ledger: [
      {
        id: "l-ok",
        taskId: "t-measured",
        agentId: "a-measured",
        toolName: "submit_for_review",
        model: "claude",
        success: true,
        params: { instruction: "절대 새면 안 되는 지시문" },
        createdAt: ago(11_000),
      },
      {
        id: "l-ghost",
        taskId: "t-ghost-agent",
        agentId: "a-gone",
        toolName: "add_activity",
        model: "grok",
        success: true,
        params: { prompt: "역시 새면 안 된다" },
        createdAt: ago(51_000),
      },
    ],
    merges: [
      {
        id: "g-measured",
        taskId: "t-measured",
        repoRoot: "melocream/marblo",
        branch: "feat/a",
        prNumber: 9,
        mergedAt: ago(9_000),
      },
    ],
  });
}

function ledgerRow(
  result: ReturnType<typeof buildProjectAudit>,
  taskId: string,
) {
  const row = result.executionLedger.find((r) => r.taskId === taskId);
  assert.ok(row, `실행 원장에 ${taskId} 행이 없다`);
  return row;
}

test("실행 원장: 미션·티켓·에이전트·모델·비용·결과가 한 행에 이어진다", () => {
  const res = buildProjectAudit(ledgerFixture());
  const row = ledgerRow(res, "t-measured");
  assert.equal(row.missionId, "m1");
  assert.equal(row.missionGoal, "미션 목표");
  assert.equal(row.ticketTitle, "비용도 모델도 실측된 티켓");
  assert.equal(row.agentId, "a-measured");
  assert.equal(row.agentName, "backend-1");
  assert.equal(row.agentResolved, true);
  assert.equal(row.model.actual, "claude-opus-5");
  assert.equal(row.model.harness, "claude");
  assert.equal(row.cost.total, 2.25);
  assert.equal(row.cost.inputTokens, 1000);
  assert.equal(row.cost.retries, 1);
  assert.equal(row.result.status, "DONE");
  assert.equal(row.result.prUrl, "https://github.com/x/y/pull/9");
  assert.equal(row.result.merged, true);
  assert.equal(row.result.actions, 1);
  assert.equal(row.result.failedActions, 0);
});

test("★실행 원장: 비용 필드가 없는 티켓은 null(미측정) — 0 으로 접지 않는다", () => {
  const res = buildProjectAudit(ledgerFixture());
  const unmeasured = ledgerRow(res, "t-unmeasured");
  assert.equal(unmeasured.cost.total, null);
  assert.equal(unmeasured.cost.inputTokens, null);
  assert.equal(unmeasured.cost.outputTokens, null);
  assert.equal(unmeasured.cost.retries, null);

  // 그리고 실측 0 은 null 로 접히지 않는다 — 반대 방향도 같이 못박는다.
  const zero = ledgerRow(res, "t-zero-cost");
  assert.equal(zero.cost.total, 0);
  assert.equal(zero.cost.inputTokens, 0);
});

test("★실행 원장: 실제 모델이 없으면 하네스로 채우지 않고 null 로 둔다", () => {
  const res = buildProjectAudit(ledgerFixture());
  const row = ledgerRow(res, "t-unmeasured");
  assert.equal(
    row.model.actual,
    null,
    "하네스 값이 실제 모델 칸으로 새면 안 된다",
  );
  assert.equal(row.model.actualSource, null);
  assert.equal(row.model.harness, "codex");
});

test("★실행 원장: 에이전트 문서가 사라져도 그 사실을 남기고 하네스는 원장에서 살린다", () => {
  const res = buildProjectAudit(ledgerFixture());
  const row = ledgerRow(res, "t-ghost-agent");
  assert.equal(row.agentResolved, false);
  assert.equal(row.agentId, null);
  assert.equal(row.claimedBy, "a-gone", "물린 문자열 자체는 지우지 않는다");
  assert.equal(row.model.actual, null);
  assert.equal(row.model.harness, "grok", "원장에 남은 하네스 축은 살린다");
});

test("★실행 원장: 실행 흔적 없는 티켓은 조용히 빼지 않고 개수로 밝힌다", () => {
  const res = buildProjectAudit(ledgerFixture());
  assert.equal(
    res.executionLedger.some((r) => r.taskId === "t-untouched"),
    false,
  );
  assert.equal(res.executionCoverage.ticketsWithoutExecution, 1);
  assert.ok(
    res.notes.some((n) => n.includes("실행 흔적이 없어")),
    "빠진 건수를 notes 로 밝혀야 한다",
  );
});

test("★실행 원장 커버리지: 분모가 rows 지 미측정 0 합산이 아니다", () => {
  const res = buildProjectAudit(ledgerFixture());
  const c = res.executionCoverage;
  assert.equal(c.rows, 4); // t-untouched 제외
  assert.equal(c.modelMeasured, 2); // t-measured, t-zero-cost (같은 에이전트)
  assert.equal(c.costMeasured, 2); // t-measured(2.25) + t-zero-cost(0)
  assert.equal(c.agentResolved, 3);
  assert.equal(c.costMeasuredTotal, 2.25);
  // 미측정 2건을 0 으로 세어 평균을 희석하지 않는다.
  assert.equal(c.costMeasuredTotal / c.costMeasured, 1.125);
});

test("★실행 원장: 원장 params 원문은 실행 원장 어디에도 실리지 않는다", () => {
  const res = buildProjectAudit(ledgerFixture());
  const json = JSON.stringify(res.executionLedger);
  assert.equal(json.includes("절대 새면 안 되는 지시문"), false);
  assert.equal(json.includes("역시 새면 안 된다"), false);
  assert.equal(json.includes("instruction"), false);
  assert.equal(json.includes("prompt"), false);
});

test("실행 원장: 최신 실행순으로 정렬된다", () => {
  const res = buildProjectAudit(ledgerFixture());
  assert.deepEqual(
    res.executionLedger.map((r) => r.taskId),
    ["t-measured", "t-zero-cost", "t-unmeasured", "t-ghost-agent"],
  );
});

test("buildExecutionLedger: 빈 입력이면 행 0 + 커버리지 0(에러 아님)", () => {
  const out = buildExecutionLedger({
    tickets: [],
    taskDocs: [],
    agents: [],
    missions: [],
    ledger: [],
    merges: [],
    latestByTask: new Map(),
  });
  assert.deepEqual(out.rows, []);
  assert.equal(out.coverage.rows, 0);
  assert.equal(out.coverage.ticketsWithoutExecution, 0);
  assert.equal(out.coverage.costMeasuredTotal, 0);
});
