import { initializeApp, getApps } from 'firebase/app';
import {
  getFirestore,
  collection,
  doc,
  getDoc,
  getDocs,
  updateDoc,
  query,
  where,
  onSnapshot,
  Timestamp,
  type Unsubscribe,
} from 'firebase/firestore';

// ── Types ────────────────────────────────────────────────────

export type TaskStatus = 'TODO' | 'CLAIMED' | 'IN_PROGRESS' | 'REVIEW' | 'BLOCKED' | 'FAILED' | 'DONE';

export interface Task {
  id: string;
  projectId: string;
  title: string;
  description: string;
  status: TaskStatus;
  role: string;
  priority: number;
  dependsOn: string[];
  dependsOnCompleted: boolean;
  claimedBy: string | null;
  scope: string[];
}

export interface DAGStatus {
  ready: Task[];
  blocked: Task[];
  inProgress: Task[];
  completed: Task[];
  failed: Task[];
}

// ── DAGResolver ──────────────────────────────────────────────

export class DAGResolver {
  private db;

  constructor(db?: ReturnType<typeof getFirestore>) {
    if (db) {
      this.db = db;
    } else {
      const app = getApps().length === 0
        ? initializeApp({
            apiKey: process.env.FIREBASE_API_KEY || process.env.VITE_FIREBASE_API_KEY || '',
            authDomain: process.env.FIREBASE_AUTH_DOMAIN || process.env.VITE_FIREBASE_AUTH_DOMAIN || '',
            projectId: process.env.FIREBASE_PROJECT_ID || process.env.VITE_FIREBASE_PROJECT_ID || '',
            storageBucket: process.env.FIREBASE_STORAGE_BUCKET || process.env.VITE_FIREBASE_STORAGE_BUCKET || '',
            messagingSenderId: process.env.FIREBASE_MESSAGING_SENDER_ID || process.env.VITE_FIREBASE_MESSAGING_SENDER_ID || '',
            appId: process.env.FIREBASE_APP_ID || process.env.VITE_FIREBASE_APP_ID || '',
          })
        : getApps()[0];
      this.db = getFirestore(app);
    }
  }

  /**
   * Watch a project for task completions and trigger dependent tasks.
   * Calls onTaskReady when a blocked task becomes ready.
   * Returns an unsubscribe function.
   */
  watch(projectId: string, onTaskReady: (task: Task) => void): () => void {
    const q = query(
      collection(this.db, 'tasks'),
      where('projectId', '==', projectId),
    );

    const unsubscribe: Unsubscribe = onSnapshot(q, async (snapshot) => {
      for (const change of snapshot.docChanges()) {
        if (change.type === 'modified') {
          const data = change.doc.data();
          if (data.status === 'DONE') {
            // A task just completed — resolve dependents
            const readyTasks = await this.resolve(change.doc.id);
            for (const task of readyTasks) {
              onTaskReady(task);
            }
          }
        }
      }
    });

    return unsubscribe;
  }

  /**
   * When a task completes, check all tasks that depend on it.
   * If all their dependencies are now met, mark them as ready.
   * Returns the list of newly unblocked tasks.
   */
  async resolve(completedTaskId: string): Promise<Task[]> {
    // Find all tasks that depend on the completed task
    const q = query(
      collection(this.db, 'tasks'),
      where('dependsOn', 'array-contains', completedTaskId),
    );
    const snap = await getDocs(q);

    if (snap.empty) return [];

    const newlyReady: Task[] = [];

    for (const taskDoc of snap.docs) {
      const data = taskDoc.data();

      // Skip if already completed or not waiting
      if (data.status === 'DONE' || data.dependsOnCompleted) continue;

      // Check if ALL dependencies are now complete
      const allMet = await this.areAllDepsCompleted(data.dependsOn || []);

      if (allMet) {
        // Mark as ready
        await updateDoc(doc(this.db, 'tasks', taskDoc.id), {
          dependsOnCompleted: true,
          updatedAt: Timestamp.now(),
        });

        newlyReady.push({
          id: taskDoc.id,
          projectId: data.projectId ?? '',
          title: data.title ?? '',
          description: data.description ?? '',
          status: data.status as TaskStatus,
          role: data.role ?? '',
          priority: data.priority ?? 0,
          dependsOn: data.dependsOn ?? [],
          dependsOnCompleted: true,
          claimedBy: data.claimedBy ?? null,
          scope: data.scope ?? [],
        });
      }
    }

    return newlyReady;
  }

  /**
   * Get the full DAG status for a project, categorized by state.
   */
  async getDAGStatus(projectId: string): Promise<DAGStatus> {
    const q = query(
      collection(this.db, 'tasks'),
      where('projectId', '==', projectId),
    );
    const snap = await getDocs(q);

    const status: DAGStatus = {
      ready: [],
      blocked: [],
      inProgress: [],
      completed: [],
      failed: [],
    };

    for (const taskDoc of snap.docs) {
      const data = taskDoc.data();
      const task: Task = {
        id: taskDoc.id,
        projectId: data.projectId ?? '',
        title: data.title ?? '',
        description: data.description ?? '',
        status: data.status as TaskStatus,
        role: data.role ?? '',
        priority: data.priority ?? 0,
        dependsOn: data.dependsOn ?? [],
        dependsOnCompleted: data.dependsOnCompleted ?? false,
        claimedBy: data.claimedBy ?? null,
        scope: data.scope ?? [],
      };

      switch (task.status) {
        case 'DONE':
          status.completed.push(task);
          break;
        case 'FAILED':
          status.failed.push(task);
          break;
        case 'IN_PROGRESS':
        case 'CLAIMED':
        case 'REVIEW':
          status.inProgress.push(task);
          break;
        case 'TODO':
          if (task.dependsOnCompleted) {
            status.ready.push(task);
          } else {
            status.blocked.push(task);
          }
          break;
        case 'BLOCKED':
          status.blocked.push(task);
          break;
      }
    }

    // Sort ready tasks by priority (high first)
    status.ready.sort((a, b) => b.priority - a.priority);

    return status;
  }

  /**
   * Identify bottleneck tasks: in-progress tasks that block the most other tasks.
   */
  async findBottlenecks(projectId: string): Promise<Task[]> {
    const q = query(
      collection(this.db, 'tasks'),
      where('projectId', '==', projectId),
    );
    const snap = await getDocs(q);

    const tasks: Task[] = snap.docs.map(d => {
      const data = d.data();
      return {
        id: d.id,
        projectId: data.projectId ?? '',
        title: data.title ?? '',
        description: data.description ?? '',
        status: data.status as TaskStatus,
        role: data.role ?? '',
        priority: data.priority ?? 0,
        dependsOn: data.dependsOn ?? [],
        dependsOnCompleted: data.dependsOnCompleted ?? false,
        claimedBy: data.claimedBy ?? null,
        scope: data.scope ?? [],
      };
    });

    // Count how many incomplete tasks depend on each task
    const blockerCount = new Map<string, number>();
    for (const task of tasks) {
      if (task.status === 'DONE') continue; // skip completed
      for (const depId of task.dependsOn) {
        blockerCount.set(depId, (blockerCount.get(depId) ?? 0) + 1);
      }
    }

    // Filter to non-completed tasks that block others, sorted by impact
    const bottlenecks = tasks
      .filter(t => t.status !== 'DONE' && (blockerCount.get(t.id) ?? 0) > 0)
      .map(t => ({ task: t, count: blockerCount.get(t.id) ?? 0 }))
      .sort((a, b) => b.count - a.count)
      .map(b => b.task);

    return bottlenecks;
  }

  // ── Helpers ──────────────────────────────────────────────────

  private async areAllDepsCompleted(depIds: string[]): Promise<boolean> {
    if (depIds.length === 0) return true;

    for (const depId of depIds) {
      const depSnap = await getDoc(doc(this.db, 'tasks', depId));
      if (!depSnap.exists()) return false;
      if (depSnap.data().status !== 'DONE') return false;
    }
    return true;
  }
}
