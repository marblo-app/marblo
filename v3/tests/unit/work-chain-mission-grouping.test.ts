/**
 * 오케브레인 패널을 미션 단위로 구조화하는 순수 접착 (티켓
 * `te3lbjp13nJ39L8WhUhv`). 사장님 원문: "오케브레인에 분류되는 걸 미션으로
 * 나눠야 하지 않을까 — 리스트를 조금 더 구조화해서 열로 보이고 클릭하면
 * 조금 더 구조화돼서 보이게 해달라고 한 거야."
 *
 * ★가장 큰 위험은 전환 상태다 — 오늘까지 대부분의 항목에 미션 라벨이
 * 없다. 라벨이 하나뿐이거나 없는 항목은 그룹 래퍼 없이 지금과 완전히 같은
 * 모양으로 남아야 한다.
 */
import { describe, expect, it } from "vitest";
import type {
  DerivedWorkChainItem,
  WorkChainItem,
} from "../../src/lib/workChain";
import {
  buildWorkChainRenderGroups,
  summarizeWorkChainGroup,
} from "../../src/lib/workChain";

function chainItem(
  over: Partial<WorkChainItem> & { id: string },
): WorkChainItem {
  return {
    what: `what-${over.id}`,
    why: "why",
    afterTaskIds: [],
    afterItemIds: [],
    taskIds: [],
    doneWhen: "done",
    createdAt: 1,
    updatedAt: 1,
    createdBy: "orch",
    ...over,
  };
}

function derived(
  over: Partial<DerivedWorkChainItem> & { item: WorkChainItem },
): DerivedWorkChainItem {
  return {
    state: "ready",
    pendingTaskIds: [],
    pendingItemIds: [],
    missingTaskIds: [],
    evidenceMissing: false,
    unblockedByMissing: [],
    evidenceTaskIds: [],
    reachedCount: 0,
    totalCount: 0,
    unsplit: false,
    missionCount: 0,
    ...over,
  };
}

describe("buildWorkChainRenderGroups", () => {
  it("leaves unlabeled items as plain entries, in order — the majority case during the transition", () => {
    const items = [
      derived({ item: chainItem({ id: "a" }) }),
      derived({ item: chainItem({ id: "b" }) }),
    ];
    const entries = buildWorkChainRenderGroups(items);
    expect(entries).toEqual([
      { kind: "item", item: items[0] },
      { kind: "item", item: items[1] },
    ]);
  });

  it("does not wrap a single-item mission label in a group — same shape as before this ticket", () => {
    const items = [
      derived({ item: chainItem({ id: "a", missionLabel: "Replay Wiring" }) }),
    ];
    const entries = buildWorkChainRenderGroups(items);
    expect(entries).toEqual([{ kind: "item", item: items[0] }]);
  });

  it("groups 2+ items sharing the same mission label at the first item's position", () => {
    const a = derived({ item: chainItem({ id: "a" }) });
    const b1 = derived({
      item: chainItem({ id: "b1", missionLabel: "Replay Wiring" }),
    });
    const c = derived({ item: chainItem({ id: "c" }) });
    const b2 = derived({
      item: chainItem({ id: "b2", missionLabel: "Replay Wiring" }),
    });
    const entries = buildWorkChainRenderGroups([a, b1, c, b2]);
    expect(entries).toEqual([
      { kind: "item", item: a },
      {
        kind: "group",
        labelKey: "replay wiring",
        label: "Replay Wiring",
        items: [b1, b2],
      },
      { kind: "item", item: c },
    ]);
  });

  it("matches labels case-insensitively, same rule as mission membership matching", () => {
    const a = derived({
      item: chainItem({ id: "a", missionLabel: "Replay Wiring" }),
    });
    const b = derived({
      item: chainItem({ id: "b", missionLabel: "replay wiring" }),
    });
    const entries = buildWorkChainRenderGroups([a, b]);
    expect(entries).toEqual([
      {
        kind: "group",
        labelKey: "replay wiring",
        // Display label keeps the first-seen casing.
        label: "Replay Wiring",
        items: [a, b],
      },
    ]);
  });

  it("keeps different mission labels in separate groups", () => {
    const a1 = derived({ item: chainItem({ id: "a1", missionLabel: "A" }) });
    const a2 = derived({ item: chainItem({ id: "a2", missionLabel: "A" }) });
    const b1 = derived({ item: chainItem({ id: "b1", missionLabel: "B" }) });
    const b2 = derived({ item: chainItem({ id: "b2", missionLabel: "B" }) });
    const entries = buildWorkChainRenderGroups([a1, b1, a2, b2]);
    expect(entries).toEqual([
      { kind: "group", labelKey: "a", label: "A", items: [a1, a2] },
      { kind: "group", labelKey: "b", label: "B", items: [b1, b2] },
    ]);
  });
});

describe("summarizeWorkChainGroup", () => {
  it("counts done and dropped as finished, and picks the highest-priority unfinished item as next", () => {
    const done = derived({ item: chainItem({ id: "done" }), state: "done" });
    const dropped = derived({
      item: chainItem({ id: "dropped" }),
      state: "dropped",
    });
    const ready = derived({ item: chainItem({ id: "ready" }), state: "ready" });
    const waiting = derived({
      item: chainItem({ id: "waiting" }),
      state: "waiting",
    });

    const summary = summarizeWorkChainGroup([done, dropped, ready, waiting]);
    expect(summary.finishedCount).toBe(2);
    expect(summary.totalCount).toBe(4);
    expect(summary.next?.item.id).toBe("ready");
  });

  it("returns next: null when every item in the group is finished", () => {
    const done = derived({ item: chainItem({ id: "done" }), state: "done" });
    const dropped = derived({
      item: chainItem({ id: "dropped" }),
      state: "dropped",
    });
    const summary = summarizeWorkChainGroup([done, dropped]);
    expect(summary.finishedCount).toBe(2);
    expect(summary.next).toBeNull();
  });
});
