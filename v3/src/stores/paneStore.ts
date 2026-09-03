import { create } from "zustand";

/**
 * Pane model for the Workspace shell's center area.
 *
 * The layout is a binary split tree: every node is either a `group` (a leaf
 * holding a set of tabbed panes) or a `split` (row/column with two children).
 * This supports the mockup's "chrome-tab panes with drag / split / close":
 *  - tabs live in a group and can be dragged between groups (movePane)
 *  - a group can split right/down (splitGroup) into two adjacent groups
 *  - closing the last tab in a group collapses the split (closePane)
 *
 * Only reachable from the Workspace shell (flag ON). Nothing here mutates the
 * legacy Layout state, so it's inert when the flag is OFF.
 */

export type PaneKind =
  | "board"
  | "code"
  | "agents"
  | "fleet"
  | "flows"
  | "missions"
  | "deploy"
  | "worktrees"
  | "history"
  | "usage"
  | "guide"
  | "browser";

export interface Pane {
  id: string;
  kind: PaneKind;
  /** Browser panes carry their own URL; other kinds ignore it. */
  url?: string;
}

export interface GroupNode {
  type: "group";
  id: string;
  paneIds: string[];
  activePaneId: string | null;
}

export interface SplitNode {
  type: "split";
  id: string;
  direction: "row" | "column";
  children: [LayoutNode, LayoutNode];
  /** Fractional sizes of the two children; always sums to 1. */
  sizes: [number, number];
}

export type LayoutNode = GroupNode | SplitNode;

export const PANE_TITLES: Record<PaneKind, string> = {
  board: "Board",
  code: "Code",
  agents: "Agents",
  fleet: "Fleet",
  flows: "Flows",
  missions: "Missions",
  deploy: "Deploy",
  worktrees: "Worktrees",
  history: "History",
  usage: "Usage",
  guide: "Guide",
  browser: "Browser",
};

export function paneDisplayTitle(pane: Pane): string {
  if (pane.kind === "browser") {
    // Distinct labels make several local demos understandable at a glance;
    // the address bar remains the source of truth for the full URL.
    const url = pane.url ?? "about:blank";
    if (url === "about:blank") return PANE_TITLES.browser;
    try {
      return new URL(url).host || PANE_TITLES.browser;
    } catch {
      return PANE_TITLES.browser;
    }
  }
  return PANE_TITLES[pane.kind];
}

// Monotonic id counters. Not derived from Date/random so they stay
// deterministic within a session (aligns with the codebase's avoidance of
// Date.now/Math.random in resumable code paths).
let paneSeq = 0;
let nodeSeq = 0;
const nextPaneId = () => `pane-${++paneSeq}`;
const nextNodeId = () => `node-${++nodeSeq}`;

function makeGroup(paneIds: string[]): GroupNode {
  return {
    type: "group",
    id: nextNodeId(),
    paneIds,
    activePaneId: paneIds[0] ?? null,
  };
}

interface PaneState {
  panes: Record<string, Pane>;
  layout: LayoutNode;
  /** Group that receives new tabs / keyboard focus. */
  focusedGroupId: string | null;

  addPane: (
    kind: PaneKind,
    opts?: { url?: string; groupId?: string }
  ) => string;
  closePane: (paneId: string) => void;
  setActivePane: (groupId: string, paneId: string) => void;
  focusGroup: (groupId: string) => void;
  movePane: (paneId: string, toGroupId: string, index?: number) => void;
  splitGroup: (groupId: string, direction: "row" | "column") => void;
  setSplitSizes: (splitId: string, sizes: [number, number]) => void;
  setBrowserUrl: (paneId: string, url: string) => void;
  reset: () => void;
}

// ---- pure tree helpers -----------------------------------------------------

function findGroup(node: LayoutNode, groupId: string): GroupNode | null {
  if (node.type === "group") return node.id === groupId ? node : null;
  return (
    findGroup(node.children[0], groupId) ?? findGroup(node.children[1], groupId)
  );
}

function firstGroup(node: LayoutNode): GroupNode {
  return node.type === "group" ? node : firstGroup(node.children[0]);
}

/** Map every group in the tree, rebuilding split nodes as needed. */
function mapGroups(
  node: LayoutNode,
  fn: (g: GroupNode) => GroupNode
): LayoutNode {
  if (node.type === "group") return fn(node);
  return {
    ...node,
    children: [
      mapGroups(node.children[0], fn),
      mapGroups(node.children[1], fn),
    ],
  };
}

/**
 * Replace `groupId`'s leaf with `replacement`, or if `replacement` is null,
 * remove the group and collapse its parent split (sibling takes the space).
 * Returns the new tree, or null if the whole tree collapsed (never happens
 * because we always keep at least one group).
 */
function replaceOrRemove(
  node: LayoutNode,
  groupId: string,
  replacement: LayoutNode | null
): LayoutNode | null {
  if (node.type === "group") {
    if (node.id !== groupId) return node;
    return replacement;
  }
  const [a, b] = node.children;
  if (a.type === "group" && a.id === groupId) {
    return replacement ? { ...node, children: [replacement, b] } : b;
  }
  if (b.type === "group" && b.id === groupId) {
    return replacement ? { ...node, children: [a, replacement] } : a;
  }
  const newA = replaceOrRemove(a, groupId, replacement);
  const newB = replaceOrRemove(b, groupId, replacement);
  return { ...node, children: [newA ?? a, newB ?? b] };
}

function groupContainingPane(
  node: LayoutNode,
  paneId: string
): GroupNode | null {
  if (node.type === "group") {
    return node.paneIds.includes(paneId) ? node : null;
  }
  return (
    groupContainingPane(node.children[0], paneId) ??
    groupContainingPane(node.children[1], paneId)
  );
}

// ---- initial layout --------------------------------------------------------

function makeInitialLayout(): {
  panes: Record<string, Pane>;
  layout: GroupNode;
} {
  const boardId = nextPaneId();
  const board: Pane = { id: boardId, kind: "board" };
  return { panes: { [boardId]: board }, layout: makeGroup([boardId]) };
}

const initial = makeInitialLayout();

export const usePaneStore = create<PaneState>((set, get) => ({
  panes: initial.panes,
  layout: initial.layout,
  focusedGroupId: initial.layout.id,

  addPane: (kind, opts = {}) => {
    const id = nextPaneId();
    const pane: Pane = { id, kind };
    if (kind === "browser") pane.url = opts.url ?? "about:blank";

    const { layout, focusedGroupId } = get();
    const targetId =
      opts.groupId ??
      (focusedGroupId && findGroup(layout, focusedGroupId)
        ? focusedGroupId
        : firstGroup(layout).id);

    const newLayout = mapGroups(layout, (g) =>
      g.id === targetId
        ? { ...g, paneIds: [...g.paneIds, id], activePaneId: id }
        : g
    );
    set((s) => ({
      panes: { ...s.panes, [id]: pane },
      layout: newLayout,
      focusedGroupId: targetId,
    }));
    return id;
  },

  closePane: (paneId) => {
    const { layout } = get();
    const group = groupContainingPane(layout, paneId);
    if (!group) return;

    const remaining = group.paneIds.filter((p) => p !== paneId);

    let newLayout: LayoutNode;
    let nextFocus: string | null;
    if (remaining.length > 0) {
      const nextActive =
        group.activePaneId === paneId
          ? remaining[
              Math.min(group.paneIds.indexOf(paneId), remaining.length - 1)
            ]
          : group.activePaneId;
      newLayout = mapGroups(layout, (g) =>
        g.id === group.id
          ? { ...g, paneIds: remaining, activePaneId: nextActive }
          : g
      );
      nextFocus = group.id;
    } else {
      // Last tab in the group — collapse the split. Never remove the root
      // group; keep an empty group so the shell always has a drop target.
      const collapsed = replaceOrRemove(layout, group.id, null);
      if (!collapsed) {
        newLayout = { ...group, paneIds: [], activePaneId: null };
        nextFocus = group.id;
      } else {
        newLayout = collapsed;
        nextFocus = firstGroup(collapsed).id;
      }
    }

    set((s) => {
      const panes = { ...s.panes };
      delete panes[paneId];
      return { panes, layout: newLayout, focusedGroupId: nextFocus };
    });
  },

  setActivePane: (groupId, paneId) => {
    set((s) => ({
      layout: mapGroups(s.layout, (g) =>
        g.id === groupId ? { ...g, activePaneId: paneId } : g
      ),
      focusedGroupId: groupId,
    }));
  },

  focusGroup: (groupId) => set({ focusedGroupId: groupId }),

  movePane: (paneId, toGroupId, index) => {
    const { layout } = get();
    const from = groupContainingPane(layout, paneId);
    if (!from) return;
    if (from.id === toGroupId) {
      // Reorder within the same group.
      set({
        layout: mapGroups(layout, (g) => {
          if (g.id !== toGroupId) return g;
          const without = g.paneIds.filter((p) => p !== paneId);
          const at = index ?? without.length;
          without.splice(Math.max(0, Math.min(at, without.length)), 0, paneId);
          return { ...g, paneIds: without, activePaneId: paneId };
        }),
        focusedGroupId: toGroupId,
      });
      return;
    }

    // Remove from source; if that empties the source group, collapse it.
    const sourceRemaining = from.paneIds.filter((p) => p !== paneId);
    let working: LayoutNode;
    if (sourceRemaining.length > 0) {
      working = mapGroups(layout, (g) =>
        g.id === from.id
          ? {
              ...g,
              paneIds: sourceRemaining,
              activePaneId:
                g.activePaneId === paneId ? sourceRemaining[0] : g.activePaneId,
            }
          : g
      );
    } else {
      working = replaceOrRemove(layout, from.id, null) ?? layout;
    }

    // Insert into destination (destination survives the collapse above because
    // it's a different group).
    const dest = findGroup(working, toGroupId);
    if (!dest) {
      // Destination vanished (shouldn't happen) — put the pane back safely.
      set({ layout, focusedGroupId: from.id });
      return;
    }
    const newLayout = mapGroups(working, (g) => {
      if (g.id !== toGroupId) return g;
      const at = index ?? g.paneIds.length;
      const paneIds = [...g.paneIds];
      paneIds.splice(Math.max(0, Math.min(at, paneIds.length)), 0, paneId);
      return { ...g, paneIds, activePaneId: paneId };
    });
    set({ layout: newLayout, focusedGroupId: toGroupId });
  },

  splitGroup: (groupId, direction) => {
    const { layout, panes } = get();
    const group = findGroup(layout, groupId);
    if (!group || group.activePaneId == null) return;

    // The new group gets a copy of the active pane's kind so the split shows
    // meaningful content immediately; the user can retab it afterwards.
    const src = panes[group.activePaneId];
    const newPaneId = nextPaneId();
    const newPane: Pane = { id: newPaneId, kind: src?.kind ?? "board" };
    if (newPane.kind === "browser") newPane.url = src?.url ?? "about:blank";
    const newGroup = makeGroup([newPaneId]);

    const split: SplitNode = {
      type: "split",
      id: nextNodeId(),
      direction,
      children: [{ ...group }, newGroup],
      sizes: [0.5, 0.5],
    };
    const newLayout = replaceOrRemove(layout, groupId, split) ?? layout;
    set((s) => ({
      panes: { ...s.panes, [newPaneId]: newPane },
      layout: newLayout,
      focusedGroupId: newGroup.id,
    }));
  },

  setSplitSizes: (splitId, sizes) => {
    const clamp = (n: number) => Math.max(0.1, Math.min(0.9, n));
    const a = clamp(sizes[0]);
    const norm: [number, number] = [a, 1 - a];
    const walk = (node: LayoutNode): LayoutNode => {
      if (node.type === "group") return node;
      if (node.id === splitId) return { ...node, sizes: norm };
      return {
        ...node,
        children: [walk(node.children[0]), walk(node.children[1])],
      };
    };
    set((s) => ({ layout: walk(s.layout) }));
  },

  setBrowserUrl: (paneId, url) => {
    set((s) => {
      const pane = s.panes[paneId];
      if (!pane || pane.kind !== "browser") return s;
      return { panes: { ...s.panes, [paneId]: { ...pane, url } } };
    });
  },

  reset: () => {
    const fresh = makeInitialLayout();
    set({
      panes: fresh.panes,
      layout: fresh.layout,
      focusedGroupId: fresh.layout.id,
    });
  },
}));
