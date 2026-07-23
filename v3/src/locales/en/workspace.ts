/**
 * English — `workspace.*` namespace. Typed against the ko counterpart so key
 * drift is a compile-time error.
 */
import type { workspace as koWorkspace } from "../ko/workspace";

export const workspace: Record<keyof typeof koWorkspace, string> = {
  // Shell chrome
  "workspace.badge": "Workspace Beta",
  "workspace.tagline": "IDE split — fixed terminals left · work tabs right",
  "workspace.exit": "Exit",

  // IDE split shell
  "workspace.terminals": "Terminals",
  "workspace.collapseTerminals": "Collapse terminals",
  "workspace.expandTerminals": "Expand terminals",
  "workspace.resizeTerminals": "Resize orchestrator / agents",
  "workspace.showFiles": "Show file tree",
  "workspace.hideFiles": "Hide file tree",
  "workspace.showActivity": "Show activity stream",
  "workspace.activity": "Activity",
  "workspace.tab.startHere": "Start here",
  "workspace.tab.board": "Board",
  "workspace.tab.agents": "Agents",
  "workspace.tab.settings": "Settings",
  "workspace.tab.code": "Code",
  "workspace.tab.worktrees": "Worktrees",
  "workspace.tab.history": "History",
  "workspace.tab.lanes": "Lanes",
  "workspace.tab.guide": "Guide",
  "workspace.tab.usage": "Usage",
  "workspace.tab.harness": "Harness",
  "workspace.tab.missions": "Missions",
  "workspace.tab.flows": "Flows (Beta)",
  "workspace.tab.deploy": "Deploy",

  // Settings toggle
  "workspace.settings.heading": "New Workspace (Beta)",
  "workspace.settings.help":
    "An IDE-style split shell: the orchestrator and agent terminals stay pinned on the left while you switch between board, code, worktree, and history tabs on the right. Switching a right tab never disturbs the left terminals. Off by default; turning it on leaves all existing features intact.",
  "workspace.settings.toggleLabel": "Use the new Workspace shell",
  "workspace.settings.on": "On",
  "workspace.settings.off": "Off",
};
