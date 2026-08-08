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
  "workspace.tab.project": "Project",
  "workspace.tab.settings": "Settings",
  "workspace.tab.code": "Code",
  "workspace.tab.worktrees": "Worktrees",
  "workspace.tab.history": "History",
  "workspace.tab.lanes": "Quick Lanes",
  "workspace.tab.guide": "Guide",
  "workspace.tab.usage": "Usage",
  "workspace.tab.store": "Store",
  "workspace.tab.harness": "Harness",
  "workspace.tab.missions": "Missions",
  "workspace.tab.flows": "Flows (Beta)",
  "workspace.tab.deploy": "Deploy",
};
