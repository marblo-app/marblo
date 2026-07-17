/**
 * English — `workspace.*` namespace. Typed against the ko counterpart so key
 * drift is a compile-time error.
 */
import type { workspace as koWorkspace } from "../ko/workspace";

export const workspace: Record<keyof typeof koWorkspace, string> = {
  // Shell chrome
  "workspace.badge": "Workspace Beta",
  "workspace.tagline": "Unified shell — panes · browser · diff review",
  "workspace.exit": "Exit",

  // Settings toggle
  "workspace.settings.heading": "New Workspace (Beta)",
  "workspace.settings.help":
    "An experimental shell that unifies chrome-tab panes (move / split / close), a collapsible orchestrator spine, an agent dock, a built-in browser, and inline diff review in one window. Off by default; turning it on leaves all existing features intact.",
  "workspace.settings.toggleLabel": "Use the new Workspace shell",
  "workspace.settings.on": "On",
  "workspace.settings.off": "Off",

  // Diff-A inline comments
  "workspace.diff.gutterHint":
    "Click a line's gutter to comment to the orchestrator",
  "workspace.diff.commentOn": "Comment",
  "workspace.diff.commentPlaceholder": "Review comment for this line…",
  "workspace.diff.sendToOrchestrator": "Send to orchestrator",
  "workspace.diff.sentLocal": "Sent to the orchestrator",
  "workspace.diff.sentQueued": "Queued (the orchestrator host will receive it)",
  "workspace.diff.sentFailed": "Send failed — try again later",
};
