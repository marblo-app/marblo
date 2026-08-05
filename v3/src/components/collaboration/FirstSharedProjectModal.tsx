import { useEffect, useState } from "react";
import { useAuth } from "../../hooks/useAuth";
import { useProjectStore } from "../../stores/projectStore";
import type { Project } from "../../types/project";
import { REPO_CONNECT_OPEN_EVENT } from "./RepoConnectModal";
import { FirstSharedProjectModalView } from "./FirstSharedProjectModalView";

const STORAGE_PREFIX = "marblo:collaboration:first-shared-project";

type StorageLike = Pick<Storage, "getItem" | "setItem">;

function safeStorage(): StorageLike | null {
  return typeof window === "undefined" ? null : window.localStorage;
}

function storageKey(projectId: string, userId: string): string {
  return `${STORAGE_PREFIX}:${userId}:${projectId}`;
}

function hasSeen(storage: StorageLike | null, projectId: string, userId: string) {
  if (!storage) return false;
  return storage.getItem(storageKey(projectId, userId)) !== null;
}

function markSeen(
  storage: StorageLike | null,
  projectId: string,
  userId: string,
) {
  if (!storage) return;
  storage.setItem(storageKey(projectId, userId), "1");
}

export { FirstSharedProjectModalView } from "./FirstSharedProjectModalView";

function shouldShowForProject(
  project: Project | null,
  userId: string | null | undefined,
): project is Project {
  if (!project || !userId) return false;
  if (project.ownerId === userId) return false;
  return project.members.includes(userId);
}

export function FirstSharedProjectModal() {
  const { user } = useAuth();
  const currentProject = useProjectStore((s) => s.currentProject);
  const [dismissedFor, setDismissedFor] = useState<string | null>(null);

  const userId = user?.uid;
  const visibleProject = shouldShowForProject(currentProject, userId)
    ? currentProject
    : null;

  useEffect(() => {
    if (!visibleProject || !userId) return;
    setDismissedFor(
      hasSeen(safeStorage(), visibleProject.id, userId)
        ? visibleProject.id
        : null,
    );
  }, [visibleProject?.id, userId]);

  if (!visibleProject || !userId || dismissedFor === visibleProject.id) {
    return null;
  }

  const close = () => {
    markSeen(safeStorage(), visibleProject.id, userId);
    setDismissedFor(visibleProject.id);
  };

  const needsRepoConnect =
    visibleProject.folderPathResolution?.kind !== "own" ||
    !visibleProject.folderPath;

  return (
    <FirstSharedProjectModalView
      projectName={visibleProject.name}
      hasRepoRemote={!!visibleProject.gitRemoteUrl?.trim()}
      needsRepoConnect={needsRepoConnect}
      onClose={close}
      onConnectRepo={() => {
        window.dispatchEvent(new CustomEvent(REPO_CONNECT_OPEN_EVENT));
        close();
      }}
    />
  );
}
