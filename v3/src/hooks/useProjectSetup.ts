import { useCallback, useEffect, useRef, useState } from "react";
import { useAuth } from "./useAuth";
import { useEditorStore } from "../stores/editorStore";
import { useProjectStore } from "../stores/projectStore";
import { useSubscriptionStore } from "../stores/subscriptionStore";
import { useUiStore } from "../stores/uiStore";
import { checkProjectCreate, ProjectLimitError } from "../lib/planLimits";
import { useFirstRunSampleProject } from "./useFirstRunSampleProject";
import telemetry from "../services/telemetryService";
import type { Project, ProjectKind } from "../types/project";
import {
  ensureAssistantMemoryFile,
  isAssistantProject,
  normalizeProjectKind,
} from "../lib/projectKind";

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

  /**
   * Everything `handleSelectDirectory` does *after* the native picker returns:
   * bind the folder, dedupe against existing projects, auto-register, boot the
   * orchestrator. Split out so a caller that already knows the path (the
   * first-run sample seeder) reuses this exact path instead of growing a
   * second, subtly different registration flow.
   */
  connectFolderPath: (dir: string) => Promise<void>;

  // Inline "name your project" banner — the fallback shown only when the
  // zero-click auto-register can't run (no signed-in user) or its write fails.
  showNewProject: boolean;
  newProjectName: string;
  setNewProjectName: (name: string) => void;
  /** 인라인 생성 시 고른 kind (기본 dev). */
  newProjectKind: ProjectKind;
  setNewProjectKind: (kind: ProjectKind) => void;
  newProjectInputRef: React.RefObject<HTMLInputElement>;
  handleCreateInlineProject: () => Promise<void>;
  handleCancelInlineProject: () => void;

  // Non-blocking recovery notice from main when a normal worktree cleanup
  // silently falls back to the project root.
  recoveryNotice: string | null;
  dismissRecoveryNotice: () => void;
}

export function useProjectSetup(): ProjectSetup {
  const { user } = useAuth();
  const setRootPath = useEditorStore((s) => s.setRootPath);
  const setCurrentProject = useProjectStore((s) => s.setCurrentProject);
  const findByPathOrRemote = useProjectStore((s) => s.findByPathOrRemote);
  const createProject = useProjectStore((s) => s.createProject);
  const setFolderPathForThisMachine = useProjectStore(
    (s) => s.setFolderPathForThisMachine,
  );
  const projects = useProjectStore((s) => s.projects);
  const getPlan = useSubscriptionStore((s) => s.getPlan);

  const [showNewProject, setShowNewProject] = useState(false);
  const [newProjectName, setNewProjectName] = useState("");
  const [newProjectKind, setNewProjectKind] = useState<ProjectKind>("dev");
  const [pendingFolderPath, setPendingFolderPath] = useState<string | null>(
    null,
  );
  const [pendingGitRemoteUrl, setPendingGitRemoteUrl] = useState<string | null>(
    null,
  );
  const [recoveryNotice, setRecoveryNotice] = useState<string | null>(null);
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
        // 폴더 원클릭 등록은 기본 dev — 하위호환·현행 불변. 비서 프로젝트는
        // 헤더/인라인 생성 UI 에서 kind 를 고른 경로로 만든다.
        const data: Omit<Project, "id" | "createdAt" | "updatedAt"> = {
          name: basename(dir) || "new-project",
          ownerId: user.uid,
          members: [user.uid],
          folderPath: dir,
          kind: "dev",
        };
        if (remoteUrl) data.gitRemoteUrl = remoteUrl;
        const id = await createProject(data);
        // 이 기기의 경로 칸도 함께 기록한다 — 레거시 단일 folderPath 는 구버전
        // 클라이언트를 위해 그대로 두고, 새 기기가 붙을 때는 이 칸이 권위자다.
        // fail-soft: 실패해도 레거시 필드로 이 기기에서는 정상 동작한다.
        try {
          await setFolderPathForThisMachine(id, dir);
        } catch (err) {
          console.error("Failed to record this machine's folder path:", err);
        }
        setRootPath(dir);
        setCurrentProject({
          id,
          ...data,
          createdAt: new Date(),
          updatedAt: new Date(),
        });
        // Onboarding funnel: "폴더 연결" 도달(신규 자동등록). 경로는 싣지 않음.
        telemetry.folderConnected("new", !!remoteUrl);
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
        // Folder was picked but the project write failed — a real onboarding
        // drop-off distinct from "not signed in" (which returns false without
        // throwing and falls through to the inline name banner).
        telemetry.folderConnectFailed("write_error");
        return false;
      }
    },
    [
      user,
      createProject,
      setFolderPathForThisMachine,
      setRootPath,
      setCurrentProject,
    ],
  );

  const connectFolderPath = useCallback(
    async (dir: string) => {
      setRootPath(dir);

      const remoteUrl = await window.electronAPI.fs.gitRemoteUrl(dir);

      // Duplicate guard: this folder (or a project sharing its git remote) is
      // already registered → open it, never create a second project. This is the
      // deterministic common case; a genuinely ambiguous conflict is rare and
      // still resolves to an existing project here rather than prompting.
      const existing = findByPathOrRemote(dir, remoteUrl);
      if (existing) {
        // ★기기 간 경로 충돌의 근본 해소 지점 (티켓 sHyHC9RoutYHDt97UOEm).
        // 다른 기기(예: 윈도우 PC)가 등록한 프로젝트를 여기서 git remote 로
        // 매칭했다면, 이 기기에는 경로 칸이 없어 folderPath 가 undefined 다.
        // 사용자가 방금 자기 로컬 클론을 골랐으므로 그 경로를 **내 칸에만**
        // 기록한다 — 다음 부팅부터 own 으로 해결되고, 상대 기기의 칸은 그대로
        // 남아 반대 방향으로 깨지지 않는다.
        if (existing.folderPath !== dir) {
          try {
            await setFolderPathForThisMachine(existing.id, dir);
          } catch (err) {
            // 경로 기록 실패가 프로젝트 열기를 막아선 안 된다(fail-soft).
            console.error("Failed to record this machine's folder path:", err);
          }
        }
        // repo URL backfill (티켓 r8VggohxLGciDVXV2rf6): 생성 시점에 remote 가
        // 없었거나 구버전으로 만들어진 프로젝트가 처음으로 git 폴더와 연결될 때
        // gitRemoteUrl 을 기록한다 — 이 값이 있어야 초대된 멤버의 기기에서
        // "저장소 연결(Clone & 연결)" 모달이 repo 를 자동 표시할 수 있다.
        if (!existing.gitRemoteUrl && remoteUrl) {
          try {
            await useProjectStore
              .getState()
              .updateProject(existing.id, { gitRemoteUrl: remoteUrl });
          } catch (err) {
            // backfill 실패가 프로젝트 열기를 막아선 안 된다(fail-soft).
            console.error("Failed to backfill project gitRemoteUrl:", err);
          }
        }
        // `existing` 은 쓰기 이전의 스냅샷이라 folderPath 가 아직 비어 있다.
        // 스토어가 낙관적으로 갱신한 최신본을 다시 집어야 오케 자동기동이
        // 방금 고른 경로를 본다.
        const refreshed =
          useProjectStore
            .getState()
            .projects.find((p) => p.id === existing.id) ?? existing;
        setCurrentProject(refreshed);
        // Onboarding funnel: existing project opened (returning user / re-pick).
        telemetry.folderConnected("existing", !!remoteUrl);
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
    },
    [
      setRootPath,
      findByPathOrRemote,
      setCurrentProject,
      setFolderPathForThisMachine,
      autoRegisterProject,
      startInlineProjectCreation,
    ],
  );

  const handleSelectDirectory = useCallback(async () => {
    const dir = await window.electronAPI.fs.selectDirectory();
    if (!dir) return;
    await connectFolderPath(dir);
  }, [connectFolderPath]);

  // 첫 실행 자동 연결 — 이 훅 안에 두는 이유는 두 셸(Layout / WorkspaceShell)이
  // 각자 useProjectSetup 을 부르기 때문이다. 여기 달면 배선 지점이 하나다.
  useFirstRunSampleProject(connectFolderPath);

  // Main-process recovery actions for a dead rootPath (see notifyRootPathMissing
  // / invalidateRemovedWorktreeRoots in electron/main.ts).
  //
  // Until now main sent "window:rootPathInvalidated" and NOTHING listened: main
  // repointed its own restore record, but the live window kept the dead root, so
  // the very next PTY spawn failed and re-raised the popup. Scrubbing what gets
  // persisted was never enough on its own — the open window has to follow.
  useEffect(() => {
    window.electronAPI.on("window:rootPathInvalidated", (payload: unknown) => {
      const data = payload as
        | { rootPath?: string; notice?: string }
        | undefined;
      const next = data?.rootPath;
      // No replacement → drop to the folder picker rather than sit on a lie.
      setRootPath(next ?? null);
      if (data?.notice) setRecoveryNotice(data.notice);
    });
    window.electronAPI.on("window:requestFolderPicker", () => {
      void handleSelectDirectory();
    });
    return () => {
      window.electronAPI.off("window:rootPathInvalidated");
      window.electronAPI.off("window:requestFolderPicker");
    };
  }, [setRootPath, handleSelectDirectory]);

  useEffect(() => {
    if (!recoveryNotice) return;
    const timer = window.setTimeout(() => setRecoveryNotice(null), 6000);
    return () => window.clearTimeout(timer);
  }, [recoveryNotice]);

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
      const kind = normalizeProjectKind(newProjectKind);
      const data: Omit<Project, "id" | "createdAt" | "updatedAt"> = {
        name: newProjectName.trim(),
        ownerId: user.uid,
        members: [user.uid],
        folderPath: pendingFolderPath,
        kind,
      };
      if (pendingGitRemoteUrl) data.gitRemoteUrl = pendingGitRemoteUrl;
      const id = await createProject(data);
      // autoRegisterProject 와 같은 이유로 이 기기의 경로 칸을 기록한다.
      try {
        await setFolderPathForThisMachine(id, pendingFolderPath);
      } catch (err) {
        console.error("Failed to record this machine's folder path:", err);
      }
      // store createProject 도 시드하지만, 서비스 직행 경로·경합을 대비해
      // 인라인 생성에서도 한 번 더 멱등 시드한다.
      if (isAssistantProject(data)) {
        void ensureAssistantMemoryFile(pendingFolderPath);
      }
      setRootPath(pendingFolderPath);
      setCurrentProject({
        id,
        ...data,
        createdAt: new Date(),
        updatedAt: new Date(),
      });
      // Onboarding funnel: folder connected via the inline name-your-project
      // fallback banner (the non-zero-click path).
      telemetry.folderConnected("inline", !!pendingGitRemoteUrl);
    } catch (err) {
      // Choke-point gate raced ahead of us (e.g. concurrent create) → upgrade.
      if (err instanceof ProjectLimitError) {
        useUiStore.getState().showUpgrade("projects", "pro");
      } else {
        console.error("Failed to create project:", err);
        telemetry.folderConnectFailed("write_error");
      }
    } finally {
      setShowNewProject(false);
      setNewProjectName("");
      setNewProjectKind("dev");
      setPendingFolderPath(null);
      setPendingGitRemoteUrl(null);
    }
  }, [
    newProjectName,
    newProjectKind,
    user,
    pendingFolderPath,
    pendingGitRemoteUrl,
    ensureProjectQuota,
    createProject,
    setFolderPathForThisMachine,
    setRootPath,
    setCurrentProject,
  ]);

  const handleCancelInlineProject = useCallback(() => {
    setShowNewProject(false);
    setNewProjectName("");
    setNewProjectKind("dev");
    setPendingFolderPath(null);
    setPendingGitRemoteUrl(null);
  }, []);

  return {
    handleSelectDirectory,
    connectFolderPath,
    showNewProject,
    newProjectName,
    setNewProjectName,
    newProjectKind,
    setNewProjectKind,
    newProjectInputRef,
    handleCreateInlineProject,
    handleCancelInlineProject,
    recoveryNotice,
    dismissRecoveryNotice: () => setRecoveryNotice(null),
  };
}
