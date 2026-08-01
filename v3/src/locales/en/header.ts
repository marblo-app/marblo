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
};
