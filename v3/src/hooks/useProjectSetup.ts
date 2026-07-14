import { useCallback, useEffect, useRef, useState } from "react";
import { useAuth } from "./useAuth";
import { useEditorStore } from "../stores/editorStore";
import { useProjectStore } from "../stores/projectStore";
import { useSubscriptionStore } from "../stores/subscriptionStore";
import { useUiStore } from "../stores/uiStore";
import { checkProjectCreate, ProjectLimitError } from "../lib/planLimits";
import { saveRecentFolder } from "../lib/recentFolders";
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
  /** Full folder-pick → auto-register / choose / inline-create flow. */
  handleSelectDirectory: () => Promise<void>;

  // Folder-open choice banner (existing user picks an unregistered folder).
  folderChoice: { path: string; remoteUrl: string | null } | null;
  handleChooseRegister: () => void;
  handleChooseBrowse: () => void;
  dismissFolderChoice: () => void;

  // Inline "name your project" banner (first-user auto-register fallback, or
  // the "register" branch of the choice banner).
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
  const projectsHydrated = useProjectStore((s) => s.projectsHydrated);
  const getPlan = useSubscriptionStore((s) => s.getPlan);

  const [folderChoice, setFolderChoice] = useState<{
    path: string;
    remoteUrl: string | null;
  } | null>(null);
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
      setFolderChoice(null);
      setShowNewProject(true);
    },
    [],
  );

  // Zero-click first-project registration: the picked folder immediately
  // becomes a project (name = folder basename) with no confirm banner. This is
  // the new-user path — useOrchestratorAutoLaunch keys off currentProject's
  // folderPath and auto-starts the orchestrator, so it reads as
  // "pick folder → orchestrator boots". If the CLI isn't installed/logged in,
  // CliSetupGate + the spawn guard take over the auth flow. Requires a signed-in
  // user (createProject needs ownerId); returns false so the caller can fall
  // back to the inline banner when there's no user or the write fails.
  const autoRegisterFirstProject = useCallback(
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
        // Plan limit hit (shouldn't happen on the first project, but the store
        // is the choke point) → surface the upgrade path, treat as "handled" so
        // the caller doesn't fall through to the inline banner.
        if (err instanceof ProjectLimitError) {
          useUiStore.getState().showUpgrade("projects", "pro");
          return true;
        }
        console.error("Failed to auto-register first project:", err);
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
    const existing = findByPathOrRemote(dir, remoteUrl);
    if (existing) {
      setCurrentProject(existing);
      return;
    }

    if (projectsHydrated && projects.length === 0) {
      // First user (no projects yet): register with one click — the folder
      // pick alone. Fall back to the inline confirm banner if not signed in or
      // the auto-register write fails.
      if (await autoRegisterFirstProject(dir, remoteUrl)) return;
      startInlineProjectCreation(dir, remoteUrl);
      return;
    }

    // Unregistered folder for an existing user: don't auto-open the register
    // banner. Offer a choice — register as a project (existing flow), or just
    // browse read-only. (Zero-click is intentionally first-user only.)
    setFolderChoice({ path: dir, remoteUrl });
  }, [
    setRootPath,
    findByPathOrRemote,
    setCurrentProject,
    projectsHydrated,
    projects.length,
    autoRegisterFirstProject,
    startInlineProjectCreation,
  ]);

  // "Register as a project" branch of the folder-choice banner → hand off to
  // the inline new-project banner with the picked folder prefilled.
  const handleChooseRegister = useCallback(() => {
    if (!folderChoice) return;
    // Free plan already at its project cap → offer upgrade instead of opening
    // the register banner. (Browse read-only stays available.)
    if (!ensureProjectQuota()) {
      setFolderChoice(null);
      return;
    }
    startInlineProjectCreation(folderChoice.path, folderChoice.remoteUrl);
  }, [folderChoice, ensureProjectQuota, startInlineProjectCreation]);

  // "Browse (read-only)" branch → the root was already switched to the folder in
  // handleSelectDirectory, so we only remember it in recents. No project bind.
  // Notify FileTree (which owns the recents dropdown) to reload its list.
  const handleChooseBrowse = useCallback(() => {
    if (!folderChoice) return;
    saveRecentFolder(folderChoice.path);
    window.dispatchEvent(new CustomEvent("marblo:recents-changed"));
    setFolderChoice(null);
  }, [folderChoice]);

  const dismissFolderChoice = useCallback(() => setFolderChoice(null), []);

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
    folderChoice,
    handleChooseRegister,
    handleChooseBrowse,
    dismissFolderChoice,
    showNewProject,
    newProjectName,
    setNewProjectName,
    newProjectInputRef,
    handleCreateInlineProject,
    handleCancelInlineProject,
  };
}
