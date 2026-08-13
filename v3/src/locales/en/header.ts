/**
 * English — `header.*` namespace. Typed `Record<keyof typeof koHeader, string>`
 * so a key present in ko but missing here (or vice-versa) is a compile error
 * for this namespace alone.
 */
import type { header as koHeader } from "../ko/header";

export const header: Record<keyof typeof koHeader, string> = {
  "header.selectProject": "Select Project",
  "header.newProject": "New Project",
  "header.projectName": "Project name",
  "header.add": "Add",
  "header.settings": "Settings",
  "header.logout": "Log out",
  "header.planBadge.suffix": "Plan",
  "header.searchProjects": "Search projects",
  "header.recentProjects": "Recent",
  "header.myProjects": "My Projects",
  "header.noSearchResults": "No matching projects",
  // Project kind (dev | assistant)
  "header.projectKind.label": "Project type",
  "header.projectKind.dev": "Dev",
  "header.projectKind.assistant": "Assistant",
  "header.projectKind.devHint": "Board-first development workspace",
  "header.projectKind.assistantHint":
    "Chat + wiki + connectors assistant workspace",
  "header.projectKind.badge.dev": "Dev",
  "header.projectKind.badge.assistant": "Assistant",
};
