export interface FileLock {
  id: string;
  projectId: string;
  filePath: string;
  userId: string;
  displayName: string;
  lockedAt: Date;
  expiresAt: Date;
}

export interface ActiveEditor {
  userId: string;
  filePath: string;
  displayName: string;
  photoURL: string;
}

export interface UserPresence {
  userId: string;
  displayName: string;
  photoURL: string;
  location: string;
  lastSeen: Date;
}
