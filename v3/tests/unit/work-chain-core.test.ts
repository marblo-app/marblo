/**
 * 오케 워크체인 코어 (티켓 fQtXQ2NzyYs0MRpqByTS).
 *
 * 여기서 못 박는 것은 하나다 — **완료 판정은 오케 자기보고가 아니라 보드 사실이다.**
 *   · 티켓이 연결된 항목은 그 티켓의 status 가 doneWhen 에 닿아야 done 이다.
 *   · 오케가 self_reported 로 닫으려 해도 티켓이 연결돼 있으면 거부된다.
 *   · 선행 티켓이 DONE 이 아니면 waiting, 되면 ready — 저장값이 아니라 파생이다.
 * 그리고 2026-08-22 의 실제 세 사례가 이 모델로 표현·판정되는지를 그대로 재현한다.
 */
import { describe, expect, it } from "vitest";
import {
  buildMissionMembership,
  buildWorkChainHandoff,
  buildWorkChainItem,
  deriveWorkChain,
  evidenceTaskIds,
  formatWorkChain,
  insertItem,
  newWorkChainItemId,
  normalizeWorkChainItems,
  referencedTaskIds,
  rejectDropReason,
  rejectSelfReportReason,
  statusSatisfiesDoneWhen,
  validateNewItem,
  workChainFooter,
  workChainNudgeForTaskChange,
  OWNER_DROP_REASON_MIN,
  WORK_CHAIN_HANDOFF_WHY_MAX,
  type TaskStatusLookup,
  type WorkChainItem,
} from "../../electron/mcp-server/work-chain-core";
import { missionLabelKey } from "../../electron/mcp-server/implicit-mission";

function item(
  over: Partial<WorkChainItem> & { id: string; what: string },
): WorkChainItem {
  return {
    why: "because",
    afterTaskIds: [],
    afterItemIds: [],
    taskIds: [],
    doneWhen: "done",
    createdAt: 1,
    updatedAt: 1,
    createdBy: "orchestrator-p1",
    ...over,
  };
}

function bucket(taskIds: readonly string[], missionCount = 1) {
  return { taskIds, missionCount };
}

describe("statusSatisfiesDoneWhen", () => {
  it("done 은 DONE 만, review 는 REVIEW|DONE, exists 는 보드에 있기만 하면 된다", () => {
    expect(statusSatisfiesDoneWhen("REVIEW", "done")).toBe(false);
    expect(statusSatisfiesDoneWhen("DONE", "done")).toBe(true);
    expect(statusSatisfiesDoneWhen("REVIEW", "review")).toBe(true);
    expect(statusSatisfiesDoneWhen("DONE", "review")).toBe(true);
    expect(statusSatisfiesDoneWhen("IN_PROGRESS", "review")).toBe(false);
    expect(statusSatisfiesDoneWhen("TODO", "exists")).toBe(true);
    expect(statusSatisfiesDoneWhen(null, "exists")).toBe(false);
  });
});

describe("deriveWorkChain — 완료는 보드 사실로", () => {
  it("사례 3: 머지한 티켓이 보드에서 REVIEW 면 '마감' 항목은 아직 열려 있다", () => {
    const items = [
      item({ id: "a", what: "NTQY·IcjP 마감", taskIds: ["NTQY", "IcjP"] }),
    ];
    const stillReview: TaskStatusLookup = { NTQY: "REVIEW", IcjP: "REVIEW" };
    const d1 = deriveWorkChain(items, stillReview);
    expect(d1.items[0].state).toBe("ready");
    expect(d1.next?.item.id).toBe("a");

    // 하나만 DONE 이어도 아직 아니다 — 전부 닿아야 한다.
    const half: TaskStatusLookup = { NTQY: "DONE", IcjP: "REVIEW" };
    expect(deriveWorkChain(items, half).items[0].state).toBe("ready");

    const closed: TaskStatusLookup = { NTQY: "DONE", IcjP: "DONE" };
    const d2 = deriveWorkChain(items, closed);
    expect(d2.items[0].state).toBe("done");
    expect(d2.items[0].evidence).toBe("board");
    expect(d2.open).toHaveLength(0);
    expect(d2.next).toBeNull();
  });

  it("사례 2: '배포 급해서 3/8 보류' — 배포 티켓이 DONE 되면 자동으로 READY", () => {
    const items = [
      item({
        id: "d38",
        what: "디자인 3/8 재개",
        why: "배포가 급해서 보류",
        afterTaskIds: ["deploy"],
        taskIds: ["design38"],
      }),
    ];
    const before = deriveWorkChain(items, {
      deploy: "IN_PROGRESS",
      design38: "TODO",
    });
    expect(before.items[0].state).toBe("waiting");
    expect(before.items[0].pendingTaskIds).toEqual(["deploy"]);
    expect(before.next).toBeNull();

    const after = deriveWorkChain(items, { deploy: "DONE", design38: "TODO" });
    expect(after.items[0].state).toBe("ready");
    expect(after.next?.item.id).toBe("d38");

    const nudge = workChainNudgeForTaskChange(before, after, "deploy");
    expect(nudge).toContain("준비됨");
    expect(nudge).toContain("디자인 3/8 재개");
  });

  it("사례 1: '내가 웹 티켓으로 열겠다' — 티켓을 붙이기 전엔 READY, 붙이면 exists 로 즉시 done", () => {
    const promise = item({
      id: "web",
      what: "에이전트 요청 웹 티켓으로 열기",
      doneWhen: "exists",
    });
    const d1 = deriveWorkChain([promise], {});
    expect(d1.items[0].state).toBe("ready"); // 잊지 않게 계속 떠 있다
    const linked = { ...promise, taskIds: ["q8ENCS944JZxoPwxNI68"] };
    const d2 = deriveWorkChain([linked], { q8ENCS944JZxoPwxNI68: "TODO" });
    expect(d2.items[0].state).toBe("done");
    expect(d2.items[0].evidence).toBe("board");
  });

  it("★자기보고는 티켓이 연결된 항목에서 무시된다 — 보드가 이긴다", () => {
    const lying = item({
      id: "x",
      what: "티켓 있는 일",
      taskIds: ["t1"],
      closed: { kind: "self_reported", reason: "했음", at: 2, by: "orch" },
    });
    const d = deriveWorkChain([lying], { t1: "IN_PROGRESS" });
    expect(d.items[0].state).toBe("ready");
    expect(d.items[0].evidence).toBeUndefined();
  });

  it("티켓 없는 항목의 self_reported 는 done 이되 evidence=self 로 구분된다", () => {
    const it1 = item({
      id: "y",
      what: "사장님께 말씀드리기",
      closed: {
        kind: "self_reported",
        reason: "텔레그램으로 전달",
        at: 2,
        by: "orch",
      },
    });
    const d = deriveWorkChain([it1], {});
    expect(d.items[0].state).toBe("done");
    expect(d.items[0].evidence).toBe("self");
  });

  it("dropped 는 티켓 상태와 무관하게 dropped", () => {
    const it1 = item({
      id: "z",
      what: "x",
      taskIds: ["t1"],
      closed: { kind: "dropped", reason: "범위 밖", at: 2, by: "orch" },
    });
    expect(deriveWorkChain([it1], { t1: "DONE" }).items[0].state).toBe(
      "dropped",
    );
  });

  it("보드에 없는 티켓은 missingTaskIds 로 드러난다(근거 사라짐)", () => {
    const it1 = item({ id: "m", what: "x", taskIds: ["gone"] });
    const d = deriveWorkChain([it1], { gone: null });
    expect(d.items[0].state).toBe("ready");
    expect(d.items[0].missingTaskIds).toEqual(["gone"]);
  });

  it("선행 체인 항목: 앞 항목이 done/dropped 여야 ready, 뒤 항목을 선행으로 건 역참조는 waiting", () => {
    const a = item({ id: "a", what: "A", taskIds: ["ta"] });
    const b = item({ id: "b", what: "B", afterItemIds: ["a"] });
    const c = item({ id: "c", what: "C", afterItemIds: ["zzz"] }); // 뒤/없는 참조
    const d1 = deriveWorkChain([a, b, c], { ta: "REVIEW" });
    expect(d1.items.map((x) => x.state)).toEqual([
      "ready",
      "waiting",
      "waiting",
    ]);
    expect(d1.next?.item.id).toBe("a");
    const d2 = deriveWorkChain([a, b, c], { ta: "DONE" });
    expect(d2.items.map((x) => x.state)).toEqual(["done", "ready", "waiting"]);
    expect(d2.next?.item.id).toBe("b");
  });

  it("next 는 배열 순서상 첫 READY — 순서가 우선순위다", () => {
    const items = [
      item({ id: "w", what: "W", afterTaskIds: ["t"] }),
      item({ id: "r1", what: "R1" }),
      item({ id: "r2", what: "R2" }),
    ];
    expect(deriveWorkChain(items, { t: "TODO" }).next?.item.id).toBe("r1");
  });
});

describe("deriveWorkChain — 미션 라벨 묶음", () => {
  const replayKey = missionLabelKey("Replay Wiring");

  it("미션 티켓을 모아 doneWhen 으로 판정하고 진행률이 움직인다", () => {
    const items = [
      item({ id: "m", what: "리플레이 배선", missionLabel: "Replay Wiring" }),
    ];
    const membership = { [replayKey]: bucket(["a", "b", "c"]) };
    const d1 = deriveWorkChain(
      items,
      { a: "DONE", b: "REVIEW", c: "TODO" },
      membership,
    );
    expect(d1.items[0].state).toBe("ready");
    expect(d1.items[0].unsplit).toBe(false);
    expect(d1.items[0].reachedCount).toBe(1);
    expect(d1.items[0].totalCount).toBe(3);
    expect(d1.items[0].evidenceTaskIds).toEqual(["a", "b", "c"]);

    const d2 = deriveWorkChain(
      items,
      { a: "DONE", b: "DONE", c: "DONE" },
      membership,
    );
    expect(d2.items[0].state).toBe("done");
    expect(d2.items[0].evidence).toBe("board");
    expect(d2.items[0].reachedCount).toBe(3);
    expect(d2.open).toHaveLength(0);
  });

  it("★티켓 0개 미션은 done 이 아니다 — unsplit", () => {
    const items = [
      item({ id: "m", what: "큰 덩어리", missionLabel: "아직 안 쪼갬" }),
    ];
    const d = deriveWorkChain(items, {}, {});
    expect(d.items[0].state).toBe("ready");
    expect(d.items[0].unsplit).toBe(true);
    expect(d.items[0].totalCount).toBe(0);
    expect(d.items[0].evidence).toBeUndefined();
    expect(d.next?.item.id).toBe("m");
  });

  it("명시 taskIds 와 미션 소속은 합집합", () => {
    const items = [
      item({
        id: "m",
        what: "묶음",
        missionLabel: "Replay Wiring",
        taskIds: ["extra"],
      }),
    ];
    const membership = { [replayKey]: bucket(["a", "b"]) };
    const half = deriveWorkChain(
      items,
      { extra: "DONE", a: "DONE", b: "TODO" },
      membership,
    );
    expect(half.items[0].state).toBe("ready");
    expect(half.items[0].totalCount).toBe(3);
    expect(half.items[0].reachedCount).toBe(2);
    const all = deriveWorkChain(
      items,
      { extra: "DONE", a: "DONE", b: "DONE" },
      membership,
    );
    expect(all.items[0].state).toBe("done");
  });

  it("개별 taskIds 만 걸린 기존 항목은 membership 과 무관하게 그대로다", () => {
    const items = [item({ id: "a", what: "센트리 마감", taskIds: ["t1"] })];
    const membership = { [replayKey]: bucket(["x", "y"]) };
    expect(
      deriveWorkChain(items, { t1: "REVIEW" }, membership).items[0].state,
    ).toBe("ready");
    expect(
      deriveWorkChain(items, { t1: "DONE" }, membership).items[0].state,
    ).toBe("done");
  });

  it("매칭은 missionLabelKey 그대로 — 대소문자만 다른 라벨은 한 묶음", () => {
    const items = [
      item({ id: "m", what: "묶음", missionLabel: "Replay Wiring" }),
    ];
    const membership = {
      [missionLabelKey("replay wiring")]: bucket(["t1"]),
    };
    expect(evidenceTaskIds(items[0], membership)).toEqual(["t1"]);
    expect(
      deriveWorkChain(items, { t1: "DONE" }, membership).items[0].state,
    ).toBe("done");
  });

  it("format 은 펼친 근거에 3/7·unsplit 을 쓰고, 요약 푸터는 한 줄이다", () => {
    const labeled = item({
      id: "m",
      what: "큰 일",
      missionLabel: "Replay Wiring",
    });
    const unsplit = formatWorkChain(deriveWorkChain([labeled], {}, {}));
    expect(unsplit).toMatch(/unsplit/);
    expect(unsplit).toMatch(/아직 안 쪼개짐/);
    const progress = formatWorkChain(
      deriveWorkChain(
        [labeled],
        { a: "DONE", b: "TODO", c: "TODO" },
        { [replayKey]: bucket(["a", "b", "c"]) },
      ),
      { taskStatuses: { a: "DONE", b: "TODO", c: "TODO" } },
    );
    expect(progress).toMatch(/1\/3 reached/);
    expect(workChainFooter(deriveWorkChain([labeled], {}, {}))).not.toMatch(
      /\d+\/\d+/,
    );
  });

  it("nudge 는 미션 소속 티켓이 항목을 done 으로 바꾸면 말한다", () => {
    const items = [
      item({ id: "m", what: "리플레이 배선", missionLabel: "Replay Wiring" }),
    ];
    const membership = { [replayKey]: bucket(["a", "b"]) };
    const before = deriveWorkChain(
      items,
      { a: "DONE", b: "REVIEW" },
      membership,
    );
    const after = deriveWorkChain(items, { a: "DONE", b: "DONE" }, membership);
    const n = workChainNudgeForTaskChange(before, after, "b");
    expect(n).toMatch(/리플레이 배선/);
    expect(n).toMatch(/완료/);
  });
});

describe("buildMissionMembership", () => {
  it("implicit + contextId 조인, completed 포함, abandoned 제외", () => {
    const replayKey = missionLabelKey("Replay Wiring");
    const membership = buildMissionMembership(
      [
        {
          id: "m1",
          missionKind: "implicit",
          implicitLabel: "Replay Wiring",
          status: "completed",
        },
        {
          id: "m2",
          missionKind: "implicit",
          implicitLabel: "Replay Wiring",
          status: "abandoned",
        },
        {
          id: "m3",
          missionKind: "explicit",
          implicitLabel: "Replay Wiring",
          status: "active",
        },
      ],
      [
        { id: "t-done", contextId: "m1" },
        { id: "t-abandoned", contextId: "m2" },
        { id: "t-explicit", contextId: "m3" },
        { id: "t-board", contextId: "board" },
        { id: "t-deleted", contextId: "m1", deleted: true },
      ],
    );
    expect(membership[replayKey]?.taskIds).toEqual(["t-done"]);
    expect(membership[replayKey]?.missionCount).toBe(1);
  });

  it("같은 라벨 미션 2개는 합산하되 개수를 드러낸다 — 조용히 합산하지 않는다", () => {
    const replayKey = missionLabelKey("Replay Wiring");
    const membership = buildMissionMembership(
      [
        {
          id: "m-old",
          missionKind: "implicit",
          implicitLabel: "Replay Wiring",
          status: "completed",
        },
        {
          id: "m-new",
          missionKind: "implicit",
          implicitLabel: "replay wiring",
          status: "active",
        },
      ],
      [
        { id: "old-1", contextId: "m-old" },
        { id: "old-2", contextId: "m-old" },
        { id: "new-1", contextId: "m-new" },
        { id: "new-2", contextId: "m-new" },
        { id: "new-3", contextId: "m-new" },
      ],
    );
    expect(membership[replayKey]?.missionCount).toBe(2);
    expect(membership[replayKey]?.taskIds).toEqual([
      "old-1",
      "old-2",
      "new-1",
      "new-2",
      "new-3",
    ]);

    const items = [
      item({ id: "wc", what: "리플레이 배선", missionLabel: "Replay Wiring" }),
    ];
    const statuses = {
      "old-1": "DONE" as const,
      "old-2": "DONE" as const,
      "new-1": "DONE" as const,
      "new-2": "TODO" as const,
      "new-3": "TODO" as const,
    };
    const d = deriveWorkChain(items, statuses, membership);
    expect(d.items[0].state).toBe("ready");
    expect(d.items[0].missionCount).toBe(2);
    expect(d.items[0].reachedCount).toBe(3);
    expect(d.items[0].totalCount).toBe(5);
    const text = formatWorkChain(d, { taskStatuses: statuses });
    expect(text).toMatch(/3\/5 reached/);
    expect(text).toMatch(/미션 2개 합산/);
    expect(workChainFooter(d)).not.toMatch(/합산/);
    expect(workChainFooter(d)).not.toMatch(/3\/5/);
  });
});

describe("rejectSelfReportReason — 자기보고 종료 거부 규칙", () => {
  it("티켓이 연결돼 있으면 reason 이 있어도 거부한다", () => {
    const r = rejectSelfReportReason(
      item({ id: "a", what: "x", taskIds: ["t1"] }),
      "확인했음",
    );
    expect(r).toMatch(/보드 상태/);
    expect(r).toMatch(/t1/);
  });
  it("티켓이 없으면 reason 이 비면 거부, 있으면 허용", () => {
    expect(rejectSelfReportReason(item({ id: "a", what: "x" }), "")).toMatch(
      /근거/,
    );
    expect(
      rejectSelfReportReason(item({ id: "a", what: "x" }), "전달 완료"),
    ).toBeNull();
  });
  it("미션 라벨만 있어도 자기보고를 거부한다 — 보드가 판정한다", () => {
    const r = rejectSelfReportReason(
      item({ id: "a", what: "큰 일", missionLabel: "Replay Wiring" }),
      "다 했다",
    );
    expect(r).toMatch(/보드 상태/);
    expect(r).toMatch(/Replay Wiring/);
  });
});

// ── ★사장님 항목의 닫는 규칙 (티켓 wx9c4NeVtZ1SGcbEISpg) ─────────────────
//
// 사장님 항목은 오케 약속보다 기준이 높아야 한다. 근거는 표시가 아니라 **권한**
// 이다 — 내 약속은 내가 물릴 수 있지만 사장님이 시킨 일은 내가 못 물린다.

describe("★source=owner — 사장님 항목은 오케 약속보다 닫기 어렵다", () => {
  const ownerItem = (over: Partial<WorkChainItem> = {}) =>
    item({
      id: "o1",
      what: "사장님 미션: 광고 집행",
      source: "owner",
      ...over,
    });

  it("티켓이 없어도 self_reported 를 거부한다 — 오케 항목에 있는 예외가 없다", () => {
    // 오케 항목은 티켓만 없으면 근거를 달아 자기보고로 닫을 수 있다(위 describe).
    expect(
      rejectSelfReportReason(item({ id: "a", what: "x" }), "확인함"),
    ).toBeNull();
    // 같은 조건에서 사장님 항목은 거부다.
    const r = rejectSelfReportReason(ownerItem(), "다 했습니다");
    expect(r).toMatch(/사장님/);
    expect(r).toMatch(/자기보고로 닫을 수 없다/);
    // 대신 무엇을 해야 하는지 알려준다 — 막기만 하면 오케가 우회할 길을 찾는다.
    expect(r).toMatch(/add_task_ids/);
  });

  it("티켓이 붙어 있으면 기존 규율이 먼저 걸린다 — source 와 무관하게 보드가 판정", () => {
    const r = rejectSelfReportReason(ownerItem({ taskIds: ["t1"] }), "했음");
    expect(r).toMatch(/보드 상태/);
    expect(r).toMatch(/t1/);
  });

  it("dropped 는 막지 않는다 — 다만 사유의 바닥이 높다", () => {
    // 막아 버리면 죽은 항목이 체인에 영원히 남고, 그게 체인을 다시 쓰레기로 만든다.
    expect(rejectDropReason(ownerItem(), "취소")).toMatch(/사장님/);
    expect(rejectDropReason(ownerItem(), "n/a")).toMatch(
      new RegExp(`${OWNER_DROP_REASON_MIN}자`),
    );
    expect(
      rejectDropReason(
        ownerItem(),
        "사장님이 광고는 다음 분기로 미루자고 하셨다",
      ),
    ).toBeNull();
  });

  it("사장님 항목이 아니면 dropped 규칙은 아무것도 바꾸지 않는다(기존 동작 무변경)", () => {
    expect(rejectDropReason(item({ id: "a", what: "x" }), "취소")).toBeNull();
    expect(
      rejectDropReason(item({ id: "a", what: "x", source: "auto" }), "n/a"),
    ).toBeNull();
  });

  it("source=owner 는 저장·복원된다 — 구버전 문서는 여전히 manual 로 읽힌다", () => {
    const built = buildWorkChainItem(
      {
        what: "사장님 미션: 광고 집행",
        why: "행동 증거",
        source: "owner",
        sourceTool: "create_task",
      },
      { id: "o1", now: 5, by: "orchestrator-p1" },
    );
    expect(built.source).toBe("owner");
    expect(built.sourceTool).toBe("create_task");
    expect(normalizeWorkChainItems([built])[0].source).toBe("owner");
    // 구버전 항목엔 source 가 없다 — 없으면 manual(자동 포착 이전 항목은 전부 수기).
    expect(
      normalizeWorkChainItems([{ ...built, source: undefined }])[0].source,
    ).toBeUndefined();
  });

  it("★렌더에서 눈으로도 갈린다 — 닫는 권한이 다르기 때문이다", () => {
    const derived = deriveWorkChain(
      [ownerItem({ taskIds: ["t1"], sourceTool: "create_task" })],
      { t1: "IN_PROGRESS" },
    );
    const out = formatWorkChain(derived);
    expect(out).toContain("source: owner(create_task)");
    expect(out).toContain("자기보고로 못 닫는다");
  });
});

describe("validateNewItem / buildWorkChainItem", () => {
  it("what 과 why 는 둘 다 필수다", () => {
    expect(validateNewItem({ what: "", why: "y" })).toMatch(/what/);
    expect(validateNewItem({ what: "x", why: "  " })).toMatch(/why/);
    expect(validateNewItem({ what: "x", why: "y" })).toBeNull();
  });
  it("길이 상한", () => {
    expect(validateNewItem({ what: "x".repeat(201), why: "y" })).toMatch(
      /너무 길다/,
    );
  });
  it("중복 id 는 한 번만, 공백은 걷어낸다", () => {
    const b = buildWorkChainItem(
      { what: " x ", why: " y ", taskIds: ["a", " a ", "b", ""] },
      { id: "wc_1", now: 5, by: "orch" },
    );
    expect(b.what).toBe("x");
    expect(b.taskIds).toEqual(["a", "b"]);
    expect(b.doneWhen).toBe("done");
    expect(b.createdAt).toBe(5);
  });
  it("missionLabel 은 정규화해 저장하고 공백은 버린다", () => {
    const b = buildWorkChainItem(
      { what: "x", why: "y", missionLabel: "  Replay   Wiring  " },
      { id: "wc_1", now: 5, by: "orch" },
    );
    expect(b.missionLabel).toBe("Replay Wiring");
    const empty = buildWorkChainItem(
      { what: "x", why: "y", missionLabel: "   " },
      { id: "wc_2", now: 5, by: "orch" },
    );
    expect(empty.missionLabel).toBeUndefined();
  });
});

describe("normalizeWorkChainItems — 손상/구버전 문서에 관대", () => {
  it("필수 필드 없는 항목은 버리고 나머지는 기본값으로 채운다", () => {
    const out = normalizeWorkChainItems([
      { id: "ok", what: "fine" },
      { id: "", what: "no id" },
      { id: "x" },
      "garbage",
      {
        id: "bad-done-when",
        what: "w",
        doneWhen: "banana",
        closed: { kind: "weird" },
      },
    ]);
    expect(out.map((i) => i.id)).toEqual(["ok", "bad-done-when"]);
    expect(out[1].doneWhen).toBe("done");
    expect(out[1].closed).toBeUndefined();
    expect(out[0].afterTaskIds).toEqual([]);
  });
  it("missionLabel 을 정규화해 살리고 구버전은 필드가 없다", () => {
    const out = normalizeWorkChainItems([
      { id: "ok", what: "fine", missionLabel: "  Replay   Wiring " },
      { id: "old", what: "legacy" },
    ]);
    expect(out[0].missionLabel).toBe("Replay Wiring");
    expect(out[1].missionLabel).toBeUndefined();
  });
  it("배열이 아니면 빈 배열", () => {
    expect(normalizeWorkChainItems(undefined)).toEqual([]);
    expect(normalizeWorkChainItems({})).toEqual([]);
  });
});

describe("insertItem / referencedTaskIds / id", () => {
  it("position 없거나 범위 밖이면 끝, 범위 안이면 그 자리", () => {
    const a = item({ id: "a", what: "A" });
    const b = item({ id: "b", what: "B" });
    const n = item({ id: "n", what: "N" });
    expect(insertItem([a, b], n).map((i) => i.id)).toEqual(["a", "b", "n"]);
    expect(insertItem([a, b], n, 0).map((i) => i.id)).toEqual(["n", "a", "b"]);
    expect(insertItem([a, b], n, 9).map((i) => i.id)).toEqual(["a", "b", "n"]);
  });
  it("referencedTaskIds 는 선행+실체 티켓을 중복 없이", () => {
    expect(
      referencedTaskIds([
        item({
          id: "a",
          what: "A",
          afterTaskIds: ["t1"],
          taskIds: ["t2", "t1"],
        }),
        item({ id: "b", what: "B", taskIds: ["t3"] }),
      ]),
    ).toEqual(["t1", "t2", "t3"]);
  });
  it("referencedTaskIds 는 미션 소속 티켓도 포함한다", () => {
    expect(
      referencedTaskIds(
        [item({ id: "m", what: "M", missionLabel: "Replay Wiring" })],
        { [missionLabelKey("Replay Wiring")]: bucket(["a", "b"]) },
      ),
    ).toEqual(["a", "b"]);
  });
  it("id 는 wc_ 접두 + 10자", () => {
    expect(newWorkChainItemId(() => 0)).toBe("wc_aaaaaaaaaa");
  });
});

describe("텍스트 렌더 — 오케가 읽는 형태", () => {
  it("빈 체인은 적으라는 안내만", () => {
    expect(formatWorkChain(deriveWorkChain([], {}))).toMatch(
      /add_work_chain_item/,
    );
  });
  it("▶ 다음 이 맨 위에 못 박히고, 근거 줄에 티켓 status 가 보인다", () => {
    const items = [item({ id: "a", what: "마감", taskIds: ["t1"] })];
    const out = formatWorkChain(deriveWorkChain(items, { t1: "REVIEW" }), {
      taskStatuses: { t1: "REVIEW" },
      taskTitles: { t1: "센트리" },
    });
    expect(out).toMatch(/▶ 다음: 마감/);
    expect(out).toMatch(/evidence\(doneWhen=done\): 센트리 t1=REVIEW/);
  });
  it("SELF-REPORTED 는 글자로 드러난다", () => {
    const items = [
      item({
        id: "a",
        what: "말씀",
        closed: { kind: "self_reported", reason: "전달", at: 1, by: "o" },
      }),
    ];
    expect(
      formatWorkChain(deriveWorkChain(items, {}), { includeClosed: true }),
    ).toMatch(/SELF-REPORTED/);
  });
  it("footer 는 열린 항목이 있을 때만", () => {
    expect(workChainFooter(deriveWorkChain([], {}))).toBe("");
    expect(
      workChainFooter(deriveWorkChain([item({ id: "a", what: "A" })], {})),
    ).toMatch(/open=1 — 다음: A/);
  });
  it("nudge 는 이 티켓이 바꾼 항목만 말하고, 변화 없으면 조용하다", () => {
    const items = [
      item({ id: "a", what: "A", taskIds: ["t1"] }),
      item({ id: "b", what: "B", taskIds: ["t2"] }),
    ];
    const before = deriveWorkChain(items, { t1: "REVIEW", t2: "REVIEW" });
    const after = deriveWorkChain(items, { t1: "DONE", t2: "REVIEW" });
    const n = workChainNudgeForTaskChange(before, after, "t1");
    expect(n).toMatch(/'A' 완료/);
    expect(n).not.toMatch(/'B'/);
    expect(workChainNudgeForTaskChange(before, before, "t1")).toBe("");
  });
});

// ── 세션 인수인계 적재 (티켓 itSrsErpvtwUEcI4Deif) ────────────────────────
//
// 못 박는 것: ① 실리는 건 **항목**이지 파생 상태가 아니다, ② 열린 것만 실린다,
// ③ 분량이 잘려도 "다음 할 일" 은 절대 안 떨어진다, ④ missionLabel 은 반드시
// 따라간다(없으면 새 세션이 미션 진행률을 아예 파생 못 한다 — #1168).

describe("buildWorkChainHandoff", () => {
  it("열린 항목만 싣고 닫힌 항목(보드 done · dropped)은 뺀다", () => {
    const items = [
      item({ id: "a", what: "머지된 티켓 마감", taskIds: ["t-done"] }),
      item({
        id: "b",
        what: "GitHub App 등록",
        why: "사장님 대기",
        afterTaskIds: ["t-open"],
      }),
      item({
        id: "c",
        what: "접었던 실험",
        closed: { kind: "dropped", reason: "우선순위 밀림", at: 1, by: "o" },
      }),
      item({ id: "d", what: "v3.0.36 재컷" }),
    ];
    const tasks: TaskStatusLookup = { "t-done": "DONE", "t-open": "REVIEW" };
    const carry = buildWorkChainHandoff(deriveWorkChain(items, tasks), {
      rev: 7,
    });
    expect(carry.items.map((i) => i.id)).toEqual(["b", "d"]);
    expect(carry.rev).toBe(7);
    expect(carry.openCount).toBe(2);
    expect(carry.omittedCount).toBe(0);
  });

  it("★파생 상태를 싣지 않는다 — 저장 필드만, 상태·진행률 키는 없다", () => {
    const items = [
      item({
        id: "a",
        what: "이탈자 메일 발송",
        why: "08-29 시한",
        missionLabel: "이탈자 메일",
        taskIds: ["t1"],
        afterTaskIds: ["t0"],
        note: "발송 직전 상태 확인",
        source: "auto",
        sourceTool: "escalate_to_owner",
      }),
    ];
    const tasks: TaskStatusLookup = { t0: "IN_PROGRESS", t1: "TODO" };
    const membership = { [missionLabelKey("이탈자 메일")]: bucket(["t1"], 2) };
    const carry = buildWorkChainHandoff(
      deriveWorkChain(items, tasks, membership),
    );
    const carried = carry.items[0];
    // 실린 것: 항목 그 자체.
    expect(carried).toEqual({
      id: "a",
      what: "이탈자 메일 발송",
      why: "08-29 시한",
      doneWhen: "done",
      afterTaskIds: ["t0"],
      taskIds: ["t1"],
      missionLabel: "이탈자 메일",
      note: "발송 직전 상태 확인",
      source: "auto",
      sourceTool: "escalate_to_owner",
    });
    // 안 실린 것: 새 세션이 보드에서 다시 파생해야 하는 모든 판정.
    const serialized = JSON.stringify(carry);
    for (const derivedKey of [
      "state",
      "evidence",
      "pendingTaskIds",
      "evidenceTaskIds",
      "reachedCount",
      "totalCount",
      "unsplit",
      "missionCount",
    ]) {
      expect(serialized).not.toContain(`"${derivedKey}"`);
    }
  });

  it("항목 상한을 넘으면 자르고 남은 수를 밝힌다", () => {
    const items = Array.from({ length: 20 }, (_, i) =>
      item({ id: `i${i}`, what: `할 일 ${i}` }),
    );
    const carry = buildWorkChainHandoff(deriveWorkChain(items, {}), {
      itemLimit: 5,
      charBudget: 100000,
    });
    expect(carry.items).toHaveLength(5);
    expect(carry.openCount).toBe(20);
    expect(carry.omittedCount).toBe(15);
  });

  it("문자 예산을 넘으면 거기서 멈춘다 — 첫 항목은 예산을 넘어도 싣는다", () => {
    const long = (i: number) =>
      item({ id: `i${i}`, what: "가".repeat(200), why: "나".repeat(500) });
    const carry = buildWorkChainHandoff(
      deriveWorkChain([long(0), long(1), long(2)], {}),
      { charBudget: 300 },
    );
    expect(carry.items).toHaveLength(1);
    expect(carry.omittedCount).toBe(2);
    // what 은 절대 안 자른다 — 항목의 신원이자 자동 포착 중복 판정의 키다.
    expect(carry.items[0].what).toHaveLength(200);
    // why 는 자른다 — 전문은 새 세션이 get_work_chain 으로 본다.
    expect(carry.items[0].why.length).toBeLessThanOrEqual(
      WORK_CHAIN_HANDOFF_WHY_MAX + 1,
    );
  });

  it("★잘려도 ▶ 다음(첫 ready)은 반드시 따라간다", () => {
    const items = [
      ...Array.from({ length: 4 }, (_, i) =>
        item({
          id: `w${i}`,
          what: `대기 ${i}`,
          afterTaskIds: ["blocker"],
        }),
      ),
      item({ id: "next", what: "GitHub App 등록" }),
    ];
    const tasks: TaskStatusLookup = { blocker: "IN_PROGRESS" };
    const derived = deriveWorkChain(items, tasks);
    expect(derived.next?.item.id).toBe("next");
    const carry = buildWorkChainHandoff(derived, { itemLimit: 2 });
    expect(carry.items.map((i) => i.id)).toEqual(["w0", "w1", "next"]);
    expect(carry.omittedCount).toBe(2);
  });

  it("미션 라벨만 있고 티켓이 0개인 항목(unsplit)도 열린 것으로 따라간다", () => {
    const items = [
      item({ id: "a", what: "배치 쪼개기", missionLabel: "온보딩" }),
    ];
    const membership = { [missionLabelKey("온보딩")]: bucket([], 1) };
    const carry = buildWorkChainHandoff(deriveWorkChain(items, {}, membership));
    expect(carry.items).toHaveLength(1);
    expect(carry.items[0].missionLabel).toBe("온보딩");
  });
});
