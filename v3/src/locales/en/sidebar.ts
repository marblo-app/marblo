/**
 * English — `sidebar.*` namespace. Typed `Record<keyof typeof koSidebar, string>`
 * so a key present in ko but missing here (or vice-versa) is a compile error
 * for this namespace alone.
 */
import type { sidebar as koSidebar } from "../ko/sidebar";

export const sidebar: Record<keyof typeof koSidebar, string> = {
  // Inline create / rename
  "sidebar.tree.fileName": "File name",
  "sidebar.tree.folderName": "Folder name",
  // Worktree switch
  "sidebar.tree.toMain": "To main worktree",
  "sidebar.tree.toTask": "To task worktree",
  "sidebar.tree.toOtherTask": "To another task worktree",
  // File-op errors (toast)
  "sidebar.tree.createFailMsg": "Create failed: {msg}",
  "sidebar.tree.createFail": "Create failed",
  "sidebar.tree.renameFailMsg": "Rename failed: {msg}",
  "sidebar.tree.renameFail": "Rename failed",
  "sidebar.tree.deleteFailMsg": "Delete failed: {msg}",
  "sidebar.tree.deleteFail": "Delete failed",
  "sidebar.tree.pasteFailMsg": "Paste failed: {msg}",
  "sidebar.tree.pasteFail": "Paste failed",
  "sidebar.tree.pasteSelf": "Can't paste into itself",
  "sidebar.tree.moveFailMsg": "Move failed: {msg}",
  "sidebar.tree.moveFail": "Move failed",
  "sidebar.tree.copyPathFail": "Failed to copy path",
  // Delete confirm dialog
  "sidebar.tree.deleteTitle": "Confirm delete",
  "sidebar.tree.deleteMsg": "Permanently delete '{name}'?",
  "sidebar.tree.deleteDirSuffix":
    "\nEverything inside the folder is deleted too.",
  // Context menu
  "sidebar.tree.newFile": "New file",
  "sidebar.tree.newFolder": "New folder",
  "sidebar.tree.cut": "Cut",
  "sidebar.tree.copy": "Copy",
  "sidebar.tree.paste": "Paste",
  "sidebar.tree.rename": "Rename",
  "sidebar.tree.delete": "Delete",
  "sidebar.tree.revealInFinder": "Reveal in Finder",
  "sidebar.tree.copyPath": "Copy path",
  // Empty state
  "sidebar.tree.openProject": "Open project",
  "sidebar.tree.selectFolder": "Select folder",
  // Folder-open choice banner
  "sidebar.tree.openFolder": "Open folder",
  "sidebar.tree.registerProject": "Register as project",
  "sidebar.tree.browseReadonly": "Browse (read-only)",
  "sidebar.tree.cancel": "Cancel",
  // New project banner
  "sidebar.tree.newProject": "New project",
  "sidebar.tree.projectNamePlaceholder": "Project name",
  "sidebar.tree.create": "Create",
  "sidebar.tree.createHint": "Enter to create / Esc to cancel",
  // Root header badges
  "sidebar.tree.activeWorktree": "Active worktree",
  "sidebar.tree.projectRoot": "Project root",
  // Toolbar
  "sidebar.tree.recentFolders": "Recent folders",
  "sidebar.tree.newFileShortcut": "New file (⌘N)",
  "sidebar.tree.newFolderShortcut": "New folder (⇧⌘N)",
  "sidebar.tree.refresh": "Refresh",
  "sidebar.tree.loading": "Loading...",
  // Confirm dialog
  "sidebar.tree.confirm": "OK",
};
