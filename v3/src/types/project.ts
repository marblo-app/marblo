import type { ModelType } from "./agent";

export interface Project {
  id: string;
  name: string;
  ownerId: string;
  members: string[];
  folderPath?: string;
  gitRemoteUrl?: string;
  enabledModels?: ModelType[]; // Active models for dispatch (default: ['claude'])
  createdAt: Date;
  updatedAt: Date;
}
