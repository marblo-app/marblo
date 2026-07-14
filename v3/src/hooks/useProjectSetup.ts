import { useCallback, useEffect, useRef, useState } from "react";
import { useAuth } from "./useAuth";
import { useEditorStore } from "../stores/editorStore";
import { useProjectStore } from "../stores/projectStore";
import { useSubscriptionStore } from "../stores/subscriptionStore";
import { useUiStore } from "../stores/uiStore";
import { checkProjectCreate, ProjectLimitError } from "../lib/planLimits";
import type { Project } from "../types/project";

function basename(p: string): string {
  // Handle both POSIX (/) and Windows (\) separators, and trailing separators,
  // so a native Windows path like C:\Users\me\proj yields "proj" not the full path.
  return (
    p
      .replace(/[\\/]+$/, "")
      .split(/[\\/]/)
      .pop() || p
  );
}

/**
 * The one place that turns a picked folder into a project. Extracted out of
 * FileTree so it can be mounted once at the always-present Layout level: the
 * board / agents no-project CTAs dispatch `marblo:select-folder`, and that
 * event has to be heard even when the sidebar is collapsed or on a non-files
 * panel (where FileTree isn't mounted). Rendering the follow-up banners is left
 * to the caller via the returned state — see ProjectSetupBanners.
 */
export interface ProjectSetup {
  /** Full folder-pick → auto-register (zero-click) flow, with an inline
   * name-your-project banner as the not-signed-in / write-failed fallback. */
  handleSelectDirectory: () => Promise<void>;

  // Inline "name your project" banner — the fallback shown only when the
  // zero-click auto-register can't run (no signed-in user) or its write fails.
  showNewProject: boolean;
  newProjectName: string;
  setNewProjectName: (name: string) => void;
  newProjectInputRef: React.RefObject<HTMLInputElement>;
  handleCreateInlineProject: () => Promise<void>;
  handleCancelInlineProject: () => void;
}

export function useProjectSetup(): ProjectSetup {
  const { user } = useAuth();
  const setRootPath = useEditorStore((s) => s.setRootPath);
  const setCurrentProject = useProjectStore((s) => s.setCurrentProject);
  const findByPathOrRemote = useProjectStore((s) => s.findByPathOrRemote);
  const createProject = useProjectStore((s) => s.createProject);
  const projects = useProjectStore((s) => s.projects);
  const getPlan = useSubscriptionStore((s) => s.getPlan);

  const [showNewProject, setShowNewProject] = useState(false);
  const [newProjectName, setNewProjectName] = useState("");
  const [pendingFolderPath, setPendingFolderPath] = useState<string | null>(
    null,
  );
  const [pendingGitRemoteUrl, setPendingGitRemoteUrl] = useState<string | null>(
    null,
  );
  const newProjectInputRef = useRef<HTMLInputElement>(null);

  // Autofocus the name field whenever the inline banner opens.
  useEffect(() => {
    if (showNewProject && newProjectInputRef.current) {
      newProjectInputRef.current.focus();
      newProjectInputRef.current.select();
    }
  }, [showNewProject]);

  const ensureProjectQuota = useCallback((): boolean => {
    const check = checkProjectCreate(getPlan(), projects.length);
    if (!check.allowed) {
      useUiStore.getState().showUpgrade("projects", "pro");
      return false;
    }
    return true;
  }, [getPlan, projects.length]);

  const startInlineProjectCreation = useCallback(
    (path: string, remoteUrl: string | null) => {
      const folderName = basename(path) || "new-project";
      setNewProjectName(folderName);
      setPendingFolderPath(path);
      setPendingGitRemoteUrl(remoteUrl);
      setShowNewProject(true);
    },
    [],
  );

  // Zero-click registration (the default for EVERY user, not just the first):
  // the picked folder immediately becomes a project (name = folder basename)
  // with no confirm banner and no name-your-project step. useOrchestratorAutoLaunch
  // keys off currentProject's folderPath and auto-starts the orchestrator, so it
  // reads as "pick folder → orchestrator boots". If the CLI isn't installed /
  // logged in, CliSetupGate + the spawn guard take over the auth flow. The plan
  // choke point (createProject) throws ProjectLimitError for a Free user over cap
  // → we surface the upgrade path. Requires a signed-in user (createProject needs
  // ownerId); returns false so the caller can fall back to the inline name banner
  // when there's no user or the write fails.
  const autoRegisterProject = useCallback(
    async (dir: string, remoteUrl: string | null): Promise<boolean> => {
      if (!user) return false;
      try {
        const data: Omit<Project, "id" | "createdAt" | "updatedAt"> = {
          name: basename(dir) || "new-project",
          ownerId: user.uid,
          members: [user.uid],
          folderPath: dir,
        };
        if (remoteUrl) data.gitRemoteUrl = remoteUrl;
        const id = await createProject(data);
        setRootPath(dir);
        setCurrentProject({
          id,
          ...data,
          createdAt: new Date(),
          updatedAt: new Date(),
        });
        return true;
      } catch (err) {
        // Plan limit hit (Free user over their project cap; the store is the
        // choke point) → surface the upgrade path, treat as "handled" so the
        // caller doesn't fall through to the inline banner.
        if (err instanceof ProjectLimitError) {
          useUiStore.getState().showUpgrade("projects", "pro");
          return true;
        }
        console.error("Failed to auto-register project:", err);
        return false;
      }
    },
    [user, createProject, setRootPath, setCurrentProject],
  );

  const handleSelectDirectory = useCallback(async () => {
    const dir = await window.electronAPI.fs.selectDirectory();
    if (!dir) return;

    setRootPath(dir);

    const remoteUrl = await window.electronAPI.fs.gitRemoteUrl(dir);

    // Duplicate guard: this folder (or a project sharing its git remote) is
    // already registered → open it, never create a second project. This is the
    // deterministic common case; a genuinely ambiguous conflict is rare and
    // still resolves to an existing project here rather than prompting.
    const existing = findByPathOrRemote(dir, remoteUrl);
    if (existing) {
      setCurrentProject(existing);
      return;
    }

    // Default happy path for EVERY user (new or returning): the folder pick
    // alone registers a project named after the folder, and setCurrentProject
    // boots the orchestrator — zero extra clicks, no register-or-browse choice
    // and no name-confirm step. Browsing a folder read-only without registering
    // is still available as a non-blocking secondary action in the FileTree
    // "Open Folder" menu, and the name can be changed afterwards via the
    // FileTree project rename. Fall back to the inline name banner only when
    // auto-register can't run (not signed in) or the write fails.
    if (await autoRegisterProject(dir, remoteUrl)) return;
    startInlineProjectCreation(dir, remoteUrl);
  }, [
    setRootPath,
    findByPathOrRemote,
    setCurrentProject,
    autoRegisterProject,
    startInlineProjectCreation,
  ]);

  const handleCreateInlineProject = useCallback(async () => {
    if (!newProjectName.trim() || !user || !pendingFolderPath) return;
    // Gate before writing: Free plan at its project cap → upgrade path instead.
    if (!ensureProjectQuota()) {
      setShowNewProject(false);
      setNewProjectName("");
      setPendingFolderPath(null);
      setPendingGitRemoteUrl(null);
      return;
    }
    try {
      const data: Omit<Project, "id" | "createdAt" | "updatedAt"> = {
        name: newProjectName.trim(),
        ownerId: user.uid,
        members: [user.uid],
        folderPath: pendingFolderPath,
      };
      if (pendingGitRemoteUrl) data.gitRemoteUrl = pendingGitRemoteUrl;
      const id = await createProject(data);
      setRootPath(pendingFolderPath);
      setCurrentProject({
        id,
        ...data,
        createdAt: new Date(),
        updatedAt: new Date(),
      });
    } catch (err) {
      // Choke-point gate raced ahead of us (e.g. concurrent create) → upgrade.
      if (err instanceof ProjectLimitError) {
        useUiStore.getState().showUpgrade("projects", "pro");
      } else {
        console.error("Failed to create project:", err);
      }
    } finally {
      setShowNewProject(false);
      setNewProjectName("");
      setPendingFolderPath(null);
      setPendingGitRemoteUrl(null);
    }
  }, [
    newProjectName,
    user,
    pendingFolderPath,
    pendingGitRemoteUrl,
    ensureProjectQuota,
    createProject,
    setRootPath,
    setCurrentProject,
  ]);

  const handleCancelInlineProject = useCallback(() => {
    setShowNewProject(false);
    setNewProjectName("");
    setPendingFolderPath(null);
    setPendingGitRemoteUrl(null);
  }, []);

  return {
    handleSelectDirectory,
    showNewProject,
    newProjectName,
    setNewProjectName,
    newProjectInputRef,
    handleCreateInlineProject,
    handleCancelInlineProject,
  };
}
