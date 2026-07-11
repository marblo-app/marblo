import { create } from "zustand";
import { where } from "firebase/firestore";
import type { Project } from "../types/project";
import {
  subscribeToCollection,
  convertTimestamps,
} from "../services/firestore";
import * as projectService from "../services/projectService";
import { useSubscriptionStore } from "./subscriptionStore";
import { checkProjectCreate, ProjectLimitError } from "../lib/planLimits";

const COLLECTION = "projects";
const DATE_FIELDS = ["createdAt", "updatedAt"];

function toProject(raw: Record<string, unknown>): Project {
  return convertTimestamps<Project>(raw, DATE_FIELDS);
}

// Cold-start race: the very first onSnapshot can arrive empty before Firestore
// has hydrated / the auth token has propagated to the SDK (a permission error is
// collapsed to [] by subscribeToCollection). Re-arm the listener a few times with
// backoff so the board recovers without a manual renderer refresh.
const COLD_START_RETRY_BACKOFF_MS = [300, 800, 1500];

interface ProjectState {
  currentProject: Project | null;
  projects: Project[];
  autoSelectFirstProject: boolean;
  loading: boolean;
  // True once the first projects snapshot has settled (carried data, or the
  // cold-start retries were exhausted). Lets the UI distinguish "still loading
  // on cold start" from "genuinely has no projects".
  projectsHydrated: boolean;
  error: string | null;

  setCurrentProject: (project: Project) => void;
  clearCurrentProject: () => void;
  setAutoSelectFirstProject: (enabled: boolean) => void;
  findByFolderPath: (folderPath: string) => Project | undefined;
  findByPathOrRemote: (
    folderPath: string,
    gitRemoteUrl: string | null | undefined,
  ) => Project | undefined;
  fetchProjects: (userId: string) => Promise<void>;
  createProject: (
    data: Omit<Project, "id" | "createdAt" | "updatedAt">,
  ) => Promise<string>;
  updateProject: (id: string, data: Partial<Project>) => Promise<void>;
  deleteProject: (id: string) => Promise<void>;
  subscribeToProjects: (userId: string) => () => void;
}

export const useProjectStore = create<ProjectState>((set, get) => ({
  currentProject: null,
  projects: [],
  autoSelectFirstProject: true,
  loading: false,
  projectsHydrated: false,
  error: null,

  setCurrentProject: (project: Project) => {
    set({ currentProject: project });
  },

  clearCurrentProject: () => {
    set({ currentProject: null });
  },

  setAutoSelectFirstProject: (enabled: boolean) => {
    set({ autoSelectFirstProject: enabled });
  },

  findByFolderPath: (folderPath: string) => {
    return get().projects.find((p) => p.folderPath === folderPath);
  },

  findByPathOrRemote: (
    folderPath: string,
    gitRemoteUrl: string | null | undefined,
  ) => {
    const projects = get().projects;
    const normalized = projectService.normalizeGitRemoteUrl(gitRemoteUrl);
    if (normalized) {
      const byRemote = projects.find(
        (p) =>
          projectService.normalizeGitRemoteUrl(p.gitRemoteUrl) === normalized,
      );
      if (byRemote) return byRemote;
    }
    return projects.find((p) => p.folderPath === folderPath);
  },

  fetchProjects: async (userId: string) => {
    set({ loading: true, error: null });
    try {
      const projects = await projectService.getProjects(userId);
      set({ projects, loading: false });
    } catch (err) {
      set({
        error: err instanceof Error ? err.message : "Failed to fetch projects",
        loading: false,
      });
    }
  },

  createProject: async (data) => {
    // Plan gate (choke point): block a Free user's 2nd+ project regardless of
    // which UI path called us. The UI catches ProjectLimitError to open the
    // UpgradeModal; the server (enforceProjectLimit trigger) re-validates in
    // case a client bypasses this check with a direct Firestore write.
    const plan = useSubscriptionStore.getState().getPlan();
    const check = checkProjectCreate(plan, get().projects.length);
    if (!check.allowed) {
      const err = new ProjectLimitError(check);
      set({ error: err.message });
      throw err;
    }
    try {
      const id = await projectService.createProject(data);
      return id;
    } catch (err) {
      set({
        error: err instanceof Error ? err.message : "Failed to create project",
      });
      throw err;
    }
  },

  updateProject: async (id, data) => {
    try {
      await projectService.updateProject(id, data);
    } catch (err) {
      set({
        error: err instanceof Error ? err.message : "Failed to update project",
      });
      throw err;
    }
  },

  deleteProject: async (id) => {
    try {
      await projectService.deleteProject(id);
      const { currentProject } = get();
      if (currentProject?.id === id) {
        set({ currentProject: null });
      }
    } catch (err) {
      set({
        error: err instanceof Error ? err.message : "Failed to delete project",
      });
      throw err;
    }
  },

  subscribeToProjects: (userId: string) => {
    set({ loading: true, projectsHydrated: false });

    let cancelled = false;
    let innerUnsub: (() => void) | null = null;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;
    let attempt = 0;
    // Only the *initial* cold-start triggers retries. Once we accept an
    // authoritative snapshot, later emptying (e.g. last project deleted) must
    // not re-arm the listener.
    let settled = false;

    const arm = () => {
      if (cancelled) return;
      innerUnsub = subscribeToCollection<Record<string, unknown>>(
        COLLECTION,
        [where("members", "array-contains", userId)],
        (docs) => {
          if (cancelled) return;
          const projects = docs.map(toProject);
          const { currentProject, autoSelectFirstProject } = get();

          // Auto-select first project if none selected
          let nextCurrent = currentProject;
          if (!nextCurrent && autoSelectFirstProject && projects.length > 0) {
            nextCurrent = projects[0];
          } else if (nextCurrent) {
            // Sync current project with latest data
            const updated = projects.find((p) => p.id === nextCurrent!.id);
            nextCurrent = updated || (projects.length > 0 ? projects[0] : null);
          }

          // Cold-start: first snapshot empty → likely transient (cold cache /
          // token lag). Tear down this listener and re-arm after a backoff,
          // keeping the store loading/unhydrated so the UI shows a spinner
          // instead of a false "No Projects". Give up after a few tries.
          if (
            !settled &&
            projects.length === 0 &&
            attempt < COLD_START_RETRY_BACKOFF_MS.length
          ) {
            const delay = COLD_START_RETRY_BACKOFF_MS[attempt];
            attempt += 1;
            // Keep whatever currentProject we have but don't flip loading off.
            set({ projects, currentProject: nextCurrent });
            if (innerUnsub) {
              innerUnsub();
              innerUnsub = null;
            }
            retryTimer = setTimeout(arm, delay);
            return;
          }

          settled = true;
          set({
            projects,
            currentProject: nextCurrent,
            loading: false,
            projectsHydrated: true,
          });
        },
      );
    };

    arm();

    return () => {
      cancelled = true;
      if (retryTimer) clearTimeout(retryTimer);
      if (innerUnsub) innerUnsub();
    };
  },
}));
