import type { Worktree } from "../types/worktree";
import { useEditorStore } from "../stores/editorStore";
import { useProjectStore } from "../stores/projectStore";
import { useAgentFocusStore } from "../stores/agentFocusStore";
import { useNavigationStore } from "../stores/navigationStore";
import { useWorktreeViewStore } from "../stores/worktreeViewStore";

export interface ViewWorktreeOptions {
  /**
   * Agent to select in the always-mounted bottom AgentListPanel. Worktrees
   * never carry an agentId, so callers resolve it from the task — see
   * {@link resolveTaskAgentId}. Null/omitted leaves the current selection.
   */
  focusAgentId?: string | null;
  /**
   * Bring the Code tab forward. Default **false**: the ticket "이 워크트리 보기"
   * flow deliberately keeps the current main tab (Board / 오케 중심 / 기능탭) —
   * only the file tree + agent selection change (no full-pane takeover). The
   * Worktrees-tab "Open" action passes true to preserve its "open in Code"
   * behaviour.
   */
  switchToCodeTab?: boolean;
  /**
   * Nudge the left sidebar to its Files panel (opening it if collapsed) so the
   * file-tree switch is never invisible. Default true.
   */
  revealFileTree?: boolean;
}

/**
 * Switch the app's *view* to a worktree — the single sanctioned path that
 * replaces the old DOM hack in WorktreeTab (which synthesised a click on the
 * "Code" tab button, `document.querySelectorAll("button")…click()`).
 *
 * ── Minimal blast radius (the "activeWorktree" scope) ────────────────────────
 * Only three things change: the bound project (so the sidebar resolves the
 * right worktree list), `editorStore.rootPath` (the file tree), and
 * `agentFocusStore` (the bottom panel selection). The active main tab is left
 * alone unless `switchToCodeTab` is set. `activeWorktreeId` follows rootPath via
 * the central reconciler ({@link useActiveWorktreeSync}); we also set it here
 * optimistically for instant button feedback.
 *
 * ── Watcher lifecycle / no leak ──────────────────────────────────────────────
 * We do NOT register any file watcher here. The only rootPath-keyed watcher is
 * FileTree's effect, which tears down its listeners + poll on each rootPath
 * change; the main-process watcher is per-window and *replaced* on the next
 * `fs.watch()` call (fs-manager keys by webContents id). Routing every switch
 * through this one function keeps that lifecycle centralised, so repeated
 * switches can't accumulate watchers.
 */
export function viewWorktree(
  worktree: Worktree,
  options: ViewWorktreeOptions = {},
): void {
  const {
    focusAgentId,
    switchToCodeTab = false,
    revealFileTree = true,
  } = options;

  // Bind the worktree's project so the FileTree's worktree list + header
  // indicator (describeRootView) resolve against the right project.
  const projectStore = useProjectStore.getState();
  const project = projectStore.projects.find(
    (p) => p.id === worktree.projectId,
  );
  if (project && projectStore.currentProject?.id !== project.id) {
    projectStore.setCurrentProject(project);
  }

  // Switch the left file tree to this worktree. Files opened from the previous
  // root no longer exist under the new one, so drop them first (matches the
  // previous openWorktree behaviour).
  const editorStore = useEditorStore.getState();
  editorStore.closeAllFiles();
  editorStore.setRootPath(worktree.path);

  // Optimistic active-worktree hint for instant button feedback; the central
  // reconciler confirms/corrects it from rootPath on the next tick.
  useWorktreeViewStore.getState().setActiveWorktree(worktree.id);

  // Select the agent in the always-mounted bottom AgentListPanel. Setting the
  // focus store alone flips the panel to its FocusView — no tab switch needed.
  if (focusAgentId) {
    useAgentFocusStore.getState().setFocusedAgent(focusAgentId);
  }

  if (switchToCodeTab) {
    useNavigationStore.getState().requestJump({ type: "code" });
  }

  if (revealFileTree && typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent("marblo:reveal-files"));
  }
}
