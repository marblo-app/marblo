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
};
