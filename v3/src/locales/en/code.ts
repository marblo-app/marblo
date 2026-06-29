/**
 * English — `code.*` namespace. Typed `Record<keyof typeof koCode, string>`
 * so a key present in ko but missing here (or vice-versa) is a compile error
 * for this namespace alone.
 */
import type { code as koCode } from "../ko/code";

export const code: Record<keyof typeof koCode, string> = {
  "code.rootNotSelected": "No project root selected",
  "code.noFileSelected.title": "Select a file",
  "code.noFileSelected.hint": "Click a file in the sidebar to open it here",
  "code.diffView": "View diff",
  "code.diffLoading": "Loading diff...",
};
