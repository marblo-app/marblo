import { beforeEach, describe, expect, it } from "vitest";
import {
  usePaneStore,
  type GroupNode,
  type LayoutNode,
  type SplitNode,
} from "../../src/stores/paneStore";

function groups(node: LayoutNode): GroupNode[] {
  if (node.type === "group") return [node];
  return [...groups(node.children[0]), ...groups(node.children[1])];
}

beforeEach(() => {
  usePaneStore.getState().reset();
});

describe("paneStore", () => {
  it("starts with a single Board pane in one group", () => {
    const { layout, panes } = usePaneStore.getState();
    expect(layout.type).toBe("group");
    const gs = groups(layout);
    expect(gs).toHaveLength(1);
    expect(gs[0].paneIds).toHaveLength(1);
    expect(panes[gs[0].paneIds[0]].kind).toBe("board");
  });

  it("addPane appends a tab to the focused group and activates it", () => {
    const s = usePaneStore.getState();
    const id = s.addPane("code");
    const { layout, panes, focusedGroupId } = usePaneStore.getState();
    const g = groups(layout)[0];
    expect(g.paneIds).toContain(id);
    expect(g.activePaneId).toBe(id);
    expect(focusedGroupId).toBe(g.id);
    expect(panes[id].kind).toBe("code");
  });

  it("browser panes get a default url", () => {
    const id = usePaneStore.getState().addPane("browser");
    expect(usePaneStore.getState().panes[id].url).toBe("about:blank");
  });

  it("splitGroup produces a split node with two groups", () => {
    const s = usePaneStore.getState();
    const rootGroup = groups(s.layout)[0];
    s.splitGroup(rootGroup.id, "row");
    const { layout } = usePaneStore.getState();
    expect(layout.type).toBe("split");
    expect((layout as SplitNode).direction).toBe("row");
    expect(groups(layout)).toHaveLength(2);
  });

  it("closing the last tab in a split group collapses the split", () => {
    const s = usePaneStore.getState();
    const rootGroup = groups(s.layout)[0];
    s.splitGroup(rootGroup.id, "column");
    const gs = groups(usePaneStore.getState().layout);
    expect(gs).toHaveLength(2);

    // Close the sole pane of the second group.
    const second = gs[1];
    usePaneStore.getState().closePane(second.paneIds[0]);

    const after = usePaneStore.getState().layout;
    expect(after.type).toBe("group");
    expect(groups(after)).toHaveLength(1);
  });

  it("never removes the very last group; it becomes empty instead", () => {
    const s = usePaneStore.getState();
    const g = groups(s.layout)[0];
    s.closePane(g.paneIds[0]);
    const after = usePaneStore.getState().layout;
    expect(after.type).toBe("group");
    expect(groups(after)).toHaveLength(1);
    expect((after as GroupNode).paneIds).toHaveLength(0);
  });

  it("movePane relocates a tab between groups and collapses an emptied source", () => {
    const s = usePaneStore.getState();
    const rootGroup = groups(s.layout)[0];
    // Two panes so the source group survives the split.
    const codeId = s.addPane("code");
    s.splitGroup(rootGroup.id, "row");

    let st = usePaneStore.getState();
    const [gA, gB] = groups(st.layout);
    // Move the split-created pane from gB into gA.
    const moved = gB.paneIds[0];
    st.movePane(moved, gA.id);

    st = usePaneStore.getState();
    const afterGroups = groups(st.layout);
    // gB is now empty → collapsed → single group holding all panes.
    expect(afterGroups).toHaveLength(1);
    expect(afterGroups[0].paneIds).toContain(moved);
    expect(afterGroups[0].paneIds).toContain(codeId);
  });

  it("setBrowserUrl updates only browser panes", () => {
    const s = usePaneStore.getState();
    const browserId = s.addPane("browser");
    const codeId = s.addPane("code");
    s.setBrowserUrl(browserId, "http://localhost:3001");
    s.setBrowserUrl(codeId, "http://nope");
    const { panes } = usePaneStore.getState();
    expect(panes[browserId].url).toBe("http://localhost:3001");
    expect(panes[codeId].url).toBeUndefined();
  });

  it("setSplitSizes clamps to [0.1, 0.9] and normalizes", () => {
    const s = usePaneStore.getState();
    const rootGroup = groups(s.layout)[0];
    s.splitGroup(rootGroup.id, "row");
    const splitId = usePaneStore.getState().layout.id;
    s.setSplitSizes(splitId, [0.99, 0.01]);
    const split = usePaneStore.getState().layout as SplitNode;
    expect(split.sizes[0]).toBeCloseTo(0.9);
    expect(split.sizes[0] + split.sizes[1]).toBeCloseTo(1);
  });
});
