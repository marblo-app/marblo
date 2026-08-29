import { describe, it, expect } from "vitest";

/**
 * 감사 로그 **관리자 뷰** 파생 계층의 계약
 * (src/lib/projectAuditView.ts 의 "관리자 뷰" 섹션).
 *
 * 위 projectAuditView.test.ts 와 같은 이유로 firebase 를 타지 않는다 — 타면
 * VITE_FIREBASE_* 부재로 모듈 로드 시점에 죽는다. 여기서 검증하는 것은 화면이
 * 아니라 **화면이 말하는 사실**이다: 문제를 필터로 숨기지 않는가, 없는 숫자를
 * 지어내지 않는가, 모르는 것을 없는 것으로 접지 않는가.
 */
import {
  AUDIT_BOARD_SECTION_ID,
  AUDIT_STALLED_AFTER_MS,
  auditAgentClaimKeys,
  auditAttention,
  auditMissionOptions,
  auditMissionProgress,
  auditWorkloadTiles,
  buildAuditAdminView,
  groupAuditRowsByTicket,
  type AuditMissionMeta,
  type AuditTaskMeta,
  type UnifiedAuditRow,
} from "../../src/lib/projectAuditView";

const T0 = new Date("2026-08-05T10:00:00.000Z");
const minutes = (n: number) => new Date(T0.getTime() + n * 60_000);

function taskMeta(
  partial: Partial<AuditTaskMeta> & { id: string },
): AuditTaskMeta {
  return {
    title: null,
    status: null,
    contextId: null,
    prUrl: null,
    claimedBy: null,
    archived: false,
    deleted: false,
    ...partial,
  };
}

function row(
  partial: Partial<UnifiedAuditRow> & { key: string },
): UnifiedAuditRow {
  return {
    actorKind: "agent",
    createdAt: T0,
    actorLabel: "테스트 오너",
    actorUid: "u1",
    label: { kind: "raw", text: "update_task_status" },
    detail: null,
    taskId: "t1",
    model: "codex",
    failed: false,
    worktree: null,
    ...partial,
  };
}

// ── 티켓 그룹 ────────────────────────────────────────────────────

describe("groupAuditRowsByTicket — 1차 단위는 티켓", () => {
  it("같은 티켓의 행을 한 그룹으로 접고, 원본 행은 그대로 들고 있다", () => {
    const rows = [
      row({ key: "a", taskId: "t1", createdAt: minutes(3) }),
      row({ key: "b", taskId: "t2", createdAt: minutes(2) }),
      row({ key: "c", taskId: "t1", createdAt: minutes(1) }),
    ];

    const groups = groupAuditRowsByTicket(rows);

    expect(groups.map((g) => g.taskId)).toEqual(["t1", "t2"]);
    expect(groups[0].rows.map((r) => r.key)).toEqual(["a", "c"]);
    expect(groups[0].actionCount).toBe(2);
  });

  it("★티켓에 안 붙는 행도 버리지 않는다 — 별도 그룹(taskId: null)", () => {
    const groups = groupAuditRowsByTicket([
      row({ key: "a", taskId: null }),
      row({ key: "b", taskId: "t1" }),
    ]);

    expect(groups.map((g) => g.taskId)).toEqual([null, "t1"]);
    expect(groups[0].key).toContain("__noTicket__");
  });

  it("최신 시각은 정렬을 믿지 않고 최대값으로 — 손상된 createdAt 이 앞에 와도 안 밀린다", () => {
    const groups = groupAuditRowsByTicket([
      row({ key: "broken", createdAt: new Date("nope") }),
      row({ key: "real", createdAt: minutes(5) }),
    ]);

    expect(groups[0].latestAt).toEqual(minutes(5));
  });

  it("모델·행위자는 중복 없이 등장 순, 행위자 수는 uid 기준", () => {
    const groups = groupAuditRowsByTicket([
      row({ key: "a", model: "codex", actorUid: "u1" }),
      row({ key: "b", model: "grok", actorUid: "u2" }),
      row({ key: "c", model: "codex", actorUid: "u1" }),
      row({ key: "d", model: null, actorUid: null }),
    ]);

    expect(groups[0].models).toEqual(["codex", "grok"]);
    expect(groups[0].actorCount).toBe(2);
  });

  it("티켓 메타에서 상태·PR·미션을 싣는다 (미션은 contextId 규약으로만)", () => {
    const groups = groupAuditRowsByTicket([row({ key: "a" })], {
      t1: taskMeta({
        id: "t1",
        title: "결제 API",
        status: "REVIEW",
        contextId: "mission-42",
        prUrl: "https://example.test/pr/1",
      }),
    });

    expect(groups[0].title).toBe("결제 API");
    expect(groups[0].status).toBe("REVIEW");
    expect(groups[0].missionId).toBe("mission-42");
    expect(groups[0].prUrl).toBe("https://example.test/pr/1");
  });

  it("★contextId 가 board/lane 이면 미션이 아니다 — 보드 티켓을 미션으로 오분류하지 않는다", () => {
    const groups = groupAuditRowsByTicket(
      [row({ key: "a", taskId: "t1" }), row({ key: "b", taskId: "t2" })],
      {
        t1: taskMeta({ id: "t1", contextId: "board" }),
        t2: taskMeta({ id: "t2", contextId: "lane:abc" }),
      },
    );

    expect(groups.map((g) => g.missionId)).toEqual([null, null]);
  });

  it("워크트리 근거는 원장 행에서 첫 실값만 — 없으면 null", () => {
    const withEvidence = groupAuditRowsByTicket([
      row({ key: "a", worktree: { state: "preLedger" } }),
      row({ key: "b", worktree: { state: "value", value: "p/t1" } }),
    ]);
    expect(withEvidence[0].worktreeId).toBe("p/t1");

    const without = groupAuditRowsByTicket([row({ key: "a" })]);
    expect(without[0].worktreeId).toBeNull();
  });
});

// ── 주의 필요 ────────────────────────────────────────────────────

describe("auditAttention — 문제 판정은 관측된 사실에서만", () => {
  const base = {
    status: null,
    claimedBy: null,
    archived: false,
    deleted: false,
    failedCount: 0,
    latestAt: T0,
  };

  it("FAILED 는 critical", () => {
    const attention = auditAttention(
      { ...base, status: "FAILED" },
      { now: T0 },
    );
    expect(attention?.kinds).toEqual(["taskFailed"]);
    expect(attention?.severity).toBe("critical");
  });

  it("BLOCKED 는 warning — 선언된 상태이지 이상 징후가 아니다", () => {
    const attention = auditAttention(
      { ...base, status: "BLOCKED" },
      { now: T0 },
    );
    expect(attention?.severity).toBe("warning");
  });

  it("실패한 툴 호출은 티켓 상태를 몰라도 사실이라 그대로 남는다", () => {
    const attention = auditAttention({ ...base, failedCount: 2 }, { now: T0 });
    expect(attention?.kinds).toEqual(["failedActions"]);
  });

  it("★DONE·보관·삭제 티켓은 아예 판정하지 않는다 — 끝난 일은 문제가 아니다", () => {
    for (const patch of [
      { status: "DONE" as const },
      { archived: true },
      { deleted: true },
    ]) {
      expect(
        auditAttention({ ...base, ...patch, failedCount: 3 }, { now: T0 }),
      ).toBeNull();
    }
  });

  it("고아 클레임 — 살아 있는 에이전트에 없는 claimedBy", () => {
    const attention = auditAttention(
      { ...base, status: "IN_PROGRESS", claimedBy: "agent-dead" },
      { now: T0, liveAgentKeys: new Set(["agent-alive"]) },
    );
    expect(attention?.kinds).toContain("orphanedClaim");
  });

  it("★liveAgentKeys 가 null 이면 고아 판정을 아예 안 한다 (하이드레이트 전 거짓 경보 금지)", () => {
    expect(
      auditAttention(
        { ...base, status: "IN_PROGRESS", claimedBy: "agent-dead" },
        { now: T0, liveAgentKeys: null },
      ),
    ).toBeNull();
  });

  it("★claimedBy 가 이름이어도 고아로 치지 않는다 (보드가 id|name 둘 다로 푼다)", () => {
    const keys = auditAgentClaimKeys([{ id: "a-1", name: "Codex-1" }]);
    expect(
      auditAttention(
        { ...base, status: "IN_PROGRESS", claimedBy: "codex-1" },
        { now: T0, liveAgentKeys: keys },
      ),
    ).toBeNull();
  });

  it("정체 — 진행 중인데 임계값을 넘겨 무변동", () => {
    const now = new Date(T0.getTime() + AUDIT_STALLED_AFTER_MS + 60_000);
    const attention = auditAttention(
      { ...base, status: "IN_PROGRESS", latestAt: T0 },
      { now },
    );
    expect(attention?.kinds).toEqual(["stalled"]);
    expect(attention?.idleMs).toBeGreaterThan(AUDIT_STALLED_AFTER_MS);
  });

  it("끝나지 않았어도 임계값 전이면 정체가 아니다", () => {
    expect(
      auditAttention(
        { ...base, status: "IN_PROGRESS", latestAt: T0 },
        { now: minutes(30) },
      ),
    ).toBeNull();
  });

  it("★시각 변환에 실패한 행을 '1970년부터 정체'로 읽지 않는다", () => {
    expect(
      auditAttention(
        { ...base, status: "IN_PROGRESS", latestAt: new Date("nope") },
        { now: T0 },
      ),
    ).toBeNull();
  });

  it("TODO 는 아직 아무도 안 진 상태라 정체·고아 판정 대상이 아니다", () => {
    expect(
      auditAttention(
        { ...base, status: "TODO", claimedBy: "agent-dead", latestAt: T0 },
        {
          now: new Date(T0.getTime() + AUDIT_STALLED_AFTER_MS * 2),
          liveAgentKeys: new Set<string>(),
        },
      ),
    ).toBeNull();
  });
});

// ── 미션 진행도 ──────────────────────────────────────────────────

describe("auditMissionProgress — 분모를 지어내지 않는다", () => {
  const mission = (partial: Partial<AuditMissionMeta>): AuditMissionMeta => ({
    id: "m1",
    goal: "결제",
    status: "active",
    taskIds: [],
    statusCounts: null,
    ...partial,
  });

  it("프로젝터 롤업이 있으면 그걸 쓴다", () => {
    const progress = auditMissionProgress(
      mission({ statusCounts: { DONE: 3, IN_PROGRESS: 2 } }),
    );
    expect(progress).toEqual({
      done: 3,
      total: 5,
      unknown: 0,
      source: "projection",
    });
  });

  it("★롤업이 없으면 분모는 mission.taskIds — 감사 창에 잡힌 수가 아니다", () => {
    const progress = auditMissionProgress(
      mission({ taskIds: ["t1", "t2", "t3", "t4"] }),
      {
        t1: taskMeta({ id: "t1", status: "DONE" }),
        t2: taskMeta({ id: "t2", status: "IN_PROGRESS" }),
        // t3/t4 는 메타를 못 읽었다 — 미완료가 아니라 "모름"이다.
      },
    );
    expect(progress).toEqual({
      done: 1,
      total: 4,
      unknown: 2,
      source: "tasks",
    });
  });

  it("셀 근거가 아무것도 없으면 진행바를 그리지 않는다(null)", () => {
    expect(auditMissionProgress(mission({}))).toBeNull();
  });
});

// ── 조립 ─────────────────────────────────────────────────────────

describe("buildAuditAdminView — 미션 섹션 · 문제 우선 · 필터", () => {
  const rows = [
    row({ key: "m-done", taskId: "t1", createdAt: minutes(9) }),
    row({ key: "m-failed", taskId: "t2", createdAt: minutes(8) }),
    row({ key: "board", taskId: "t3", createdAt: minutes(7) }),
    row({
      key: "human",
      taskId: "t3",
      createdAt: minutes(6),
      actorKind: "human",
      model: null,
      actorUid: "u2",
      actorLabel: "김개발",
    }),
  ];
  const taskMetaById: Record<string, AuditTaskMeta> = {
    t1: taskMeta({
      id: "t1",
      title: "결제 API",
      status: "DONE",
      contextId: "m1",
    }),
    t2: taskMeta({
      id: "t2",
      title: "결제 UI",
      status: "FAILED",
      contextId: "m1",
    }),
    t3: taskMeta({
      id: "t3",
      title: "보드 티켓",
      status: "IN_PROGRESS",
      contextId: "board",
    }),
  };
  const missionMetaById: Record<string, AuditMissionMeta> = {
    m1: {
      id: "m1",
      goal: "결제 플로우",
      status: "active",
      taskIds: ["t1", "t2"],
      statusCounts: { DONE: 1, FAILED: 1 },
    },
  };

  it("미션 섹션이 먼저, 보드는 항상 맨 뒤", () => {
    const view = buildAuditAdminView(rows, {
      taskMetaById,
      missionMetaById,
      now: minutes(10),
    });

    expect(view.sections.map((s) => s.missionId)).toEqual(["m1", null]);
    expect(view.sections[0].goal).toBe("결제 플로우");
    expect(view.sections[0].ticketCount).toBe(2);
    expect(view.sections[1].ticketCount).toBe(1);
  });

  it("원장 목록은 미션/보드 섹션으로 나누지 않고 최신 티켓순 한 목록이다", () => {
    const view = buildAuditAdminView(rows, {
      taskMetaById,
      missionMetaById,
      now: minutes(10),
    });

    expect(view.tickets.map((group) => group.taskId)).toEqual([
      "t1",
      "t2",
      "t3",
    ]);
  });

  it("주의 필요는 심각도 → 최신순", () => {
    const view = buildAuditAdminView(rows, {
      taskMetaById,
      missionMetaById,
      now: minutes(10),
    });

    expect(view.attention.map((g) => g.taskId)).toEqual(["t2"]);
    expect(view.attention[0].attention?.severity).toBe("critical");
  });

  it("★배너는 필터를 무시한다 — 미션 필터를 걸어도 다른 미션의 문제가 남는다", () => {
    const view = buildAuditAdminView(rows, {
      taskMetaById,
      missionMetaById,
      now: minutes(10),
      filters: { mission: AUDIT_BOARD_SECTION_ID },
    });

    expect(view.sections.map((s) => s.missionId)).toEqual([null]);
    // 섹션에서는 빠졌지만 배너에는 그대로 있다.
    expect(view.attention.map((g) => g.taskId)).toEqual(["t2"]);
  });

  it("상태 필터는 티켓 축에 걸린다", () => {
    const view = buildAuditAdminView(rows, {
      taskMetaById,
      missionMetaById,
      now: minutes(10),
      filters: { status: "FAILED" },
    });

    expect(view.ticketCount).toBe(1);
    expect(view.sections[0].tickets[0].taskId).toBe("t2");
  });

  it("행위자 축 필터는 행에 걸리고, 가려진 행 수를 밝힌다", () => {
    const view = buildAuditAdminView(rows, {
      taskMetaById,
      missionMetaById,
      now: minutes(10),
      filters: { actorKind: "human" },
    });

    expect(view.actionCount).toBe(1);
    expect(view.hiddenByFilterCount).toBe(3);
  });

  it("필터가 없으면 가려진 행이 0 이고 액션 수가 입력과 같다", () => {
    const view = buildAuditAdminView(rows, {
      taskMetaById,
      missionMetaById,
      now: minutes(10),
    });

    expect(view.actionCount).toBe(rows.length);
    expect(view.hiddenByFilterCount).toBe(0);
  });

  it("미션 선택지는 화면에 등장한 미션만", () => {
    const view = buildAuditAdminView(rows, { taskMetaById, missionMetaById });
    expect(auditMissionOptions(view.sections)).toEqual([
      { missionId: "m1", label: "결제 플로우", ticketCount: 2 },
    ]);
  });

  it("미션 메타를 못 읽어도 묶음은 살아남는다(헤더만 id 로 떨어진다)", () => {
    const view = buildAuditAdminView(rows, { taskMetaById });
    const mission = view.sections.find((s) => s.missionId === "m1");
    expect(mission?.goal).toBeNull();
    expect(mission?.ticketCount).toBe(2);
  });
});

// ── 워크로드 스트립 ──────────────────────────────────────────────

describe("auditWorkloadTiles — 범위를 숨기지 않는다", () => {
  const groups = () =>
    groupAuditRowsByTicket(
      [
        row({ key: "a", actorUid: "u1", taskId: "t1" }),
        row({ key: "b", actorUid: "u2", taskId: "t1" }),
        row({ key: "c", actorUid: null, actorLabel: null, taskId: "t2" }),
      ],
      { t1: taskMeta({ id: "t1", status: "FAILED" }) },
    );

  it("서버 집계가 있으면 그 수를 쓰고 범위를 project 로 표시한다", () => {
    const tiles = auditWorkloadTiles(groups(), [
      { actorUid: "u1", actorName: "오너", count: 120 },
    ]);
    const u1 = tiles.find((tile) => tile.actorUid === "u1");
    expect(u1).toMatchObject({ actionCount: 120, countScope: "project" });
  });

  it("★창에 한 건도 없는 구성원도 타일이 남는다 — 서버 필터의 진입점이라", () => {
    const tiles = auditWorkloadTiles(groups(), [
      { actorUid: "u9", actorName: "휴면", count: 4 },
    ]);
    expect(tiles.map((tile) => tile.actorUid)).toContain("u9");
  });

  it("서버 집계에 없는 행위자는 창 기준으로 세고 window 로 표시한다", () => {
    const tiles = auditWorkloadTiles(groups(), []);
    const u1 = tiles.find((tile) => tile.actorUid === "u1");
    expect(u1).toMatchObject({ actionCount: 1, countScope: "window" });
  });

  it("미귀속 타일은 맨 뒤", () => {
    const tiles = auditWorkloadTiles(groups(), []);
    expect(tiles[tiles.length - 1].actorUid).toBeNull();
  });

  it("주의 필요는 그 티켓에 손댄 모든 사람에게 표시된다", () => {
    const tiles = auditWorkloadTiles(groups(), []);
    expect(
      tiles
        .filter((tile) => tile.actorUid === "u1" || tile.actorUid === "u2")
        .map((tile) => tile.attentionCount),
    ).toEqual([1, 1]);
  });
});
