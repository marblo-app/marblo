import { create } from 'zustand';
import { where } from 'firebase/firestore';
import type { Project } from '../types/project';
import { subscribeToCollection, convertTimestamps } from '../services/firestore';
import * as projectService from '../services/projectService';

const COLLECTION = 'projects';
const DATE_FIELDS = ['createdAt', 'updatedAt'];

function toProject(raw: Record<string, unknown>): Project {
  return convertTimestamps<Project>(raw, DATE_FIELDS);
}

interface ProjectState {
  currentProject: Project | null;
  projects: Project[];
  loading: boolean;
  error: string | null;

  setCurrentProject: (project: Project) => void;
  findByFolderPath: (folderPath: string) => Project | undefined;
  fetchProjects: (userId: string) => Promise<void>;
  createProject: (data: Omit<Project, 'id' | 'createdAt' | 'updatedAt'>) => Promise<string>;
  updateProject: (id: string, data: Partial<Project>) => Promise<void>;
  deleteProject: (id: string) => Promise<void>;
  subscribeToProjects: (userId: string) => () => void;
}

export const useProjectStore = create<ProjectState>((set, get) => ({
  currentProject: null,
  projects: [],
  loading: false,
  error: null,

  setCurrentProject: (project: Project) => {
    set({ currentProject: project });
  },

  findByFolderPath: (folderPath: string) => {
    return get().projects.find((p) => p.folderPath === folderPath);
  },

  fetchProjects: async (userId: string) => {
    set({ loading: true, error: null });
    try {
      const projects = await projectService.getProjects(userId);
      set({ projects, loading: false });
    } catch (err) {
      set({ error: err instanceof Error ? err.message : 'Failed to fetch projects', loading: false });
    }
  },

  createProject: async (data) => {
    try {
      const id = await projectService.createProject(data);
      return id;
    } catch (err) {
      set({ error: err instanceof Error ? err.message : 'Failed to create project' });
      throw err;
    }
  },

  updateProject: async (id, data) => {
    try {
      await projectService.updateProject(id, data);
    } catch (err) {
      set({ error: err instanceof Error ? err.message : 'Failed to update project' });
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
      set({ error: err instanceof Error ? err.message : 'Failed to delete project' });
      throw err;
    }
  },

  subscribeToProjects: (userId: string) => {
    set({ loading: true });
    return subscribeToCollection<Record<string, unknown>>(
      COLLECTION,
      [where('members', 'array-contains', userId)],
      (docs) => {
        const projects = docs.map(toProject);
        const { currentProject } = get();

        // Auto-select first project if none selected
        let nextCurrent = currentProject;
        if (!nextCurrent && projects.length > 0) {
          nextCurrent = projects[0];
        } else if (nextCurrent) {
          // Sync current project with latest data
          const updated = projects.find((p) => p.id === nextCurrent!.id);
          nextCurrent = updated || (projects.length > 0 ? projects[0] : null);
        }

        set({ projects, currentProject: nextCurrent, loading: false });
      },
    );
  },
}));
