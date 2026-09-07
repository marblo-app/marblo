/**
 * 오케브레인 아카이브 분리 (티켓 `xZtqOCLN1GQvloeGJkeD`). 사장님 지시:
 * "A 미션 완료되면 오케브레인에서 아카이브 리스트로 넘어가고." 완료는 오케
 * 자기보고가 아니라 보드 파생 상태로 판정한다 — `isWorkChainRenderEntryFinished`
 * 는 저장된 `.archived` 필드가 아니라 각 항목의 `state`만 본다.
 */
import { describe, expect, it } from "vitest";
import type {
  DerivedWorkChainItem,
  WorkChainItem,
  WorkChainRenderEntry,
} from "../../src/lib/workChain";
import {
  isWorkChainRenderEntryFinished,
  partitionWorkChainRenderEntries,
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

describe("isWorkChainRenderEntryFinished", () => {
  it("a standalone item is finished only when its own state is done or dropped", () => {
    const ready = derived({ item: chainItem({ id: "a" }), state: "ready" });
    const done = derived({ item: chainItem({ id: "b" }), state: "done" });
    const dropped = derived({
      item: chainItem({ id: "c" }),
      state: "dropped",
    });
    expect(isWorkChainRenderEntryFinished({ kind: "item", item: ready })).toBe(
      false,
    );
    expect(isWorkChainRenderEntryFinished({ kind: "item", item: done })).toBe(
      true,
    );
    expect(
      isWorkChainRenderEntryFinished({ kind: "item", item: dropped }),
    ).toBe(true);
  });

  it("★a group is finished only when ALL of its steps are — one open step keeps the whole mission active", () => {
    const done1 = derived({ item: chainItem({ id: "s1" }), state: "done" });
    const done2 = derived({ item: chainItem({ id: "s2" }), state: "done" });
    const ready = derived({ item: chainItem({ id: "s3" }), state: "ready" });

    const allDone: WorkChainRenderEntry = {
      kind: "group",
      labelKey: "m",
      label: "M",
      items: [done1, done2],
    };
    const mixed: WorkChainRenderEntry = {
      kind: "group",
      labelKey: "m",
      label: "M",
      items: [done1, done2, ready],
    };
    expect(isWorkChainRenderEntryFinished(allDone)).toBe(true);
    expect(isWorkChainRenderEntryFinished(mixed)).toBe(false);
  });
});

describe("partitionWorkChainRenderEntries", () => {
  it("splits standalone items and fully-finished groups into archived, everything else stays active", () => {
    const openItem = derived({
      item: chainItem({ id: "open" }),
      state: "ready",
    });
    const doneItem = derived({
      item: chainItem({ id: "done" }),
      state: "done",
    });
    const step1 = derived({
      item: chainItem({ id: "step1" }),
      state: "done",
    });
    const step2 = derived({
      item: chainItem({ id: "step2" }),
      state: "ready",
    });
    const finishedStep1 = derived({
      item: chainItem({ id: "fstep1" }),
      state: "done",
    });
    const finishedStep2 = derived({
      item: chainItem({ id: "fstep2" }),
      state: "dropped",
    });

    const partiallyDoneGroup: WorkChainRenderEntry = {
      kind: "group",
      labelKey: "partial",
      label: "Partial Mission",
      items: [step1, step2],
    };
    const fullyDoneGroup: WorkChainRenderEntry = {
      kind: "group",
      labelKey: "finished",
      label: "Finished Mission",
      items: [finishedStep1, finishedStep2],
    };

    const entries: WorkChainRenderEntry[] = [
      { kind: "item", item: openItem },
      { kind: "item", item: doneItem },
      partiallyDoneGroup,
      fullyDoneGroup,
    ];

    const { active, archived } = partitionWorkChainRenderEntries(entries);

    expect(active).toEqual([
      { kind: "item", item: openItem },
      partiallyDoneGroup,
    ]);
    expect(archived).toEqual([
      { kind: "item", item: doneItem },
      fullyDoneGroup,
    ]);
  });

  it("an empty input partitions into two empty arrays", () => {
    expect(partitionWorkChainRenderEntries([])).toEqual({
      active: [],
      archived: [],
    });
  });
});
