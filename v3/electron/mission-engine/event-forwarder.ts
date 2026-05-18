import { type FirebaseApp } from "firebase/app";
import {
  getFirestore,
  collection,
  onSnapshot,
  query,
  where,
  type Firestore,
  type Unsubscribe,
} from "firebase/firestore";
import type { MissionEventBus } from "./ports";

// Wait-step wakeup 메커니즘.
// MissionEngine 은 wait step 진입 시 sleeping 으로 전환되고, eventBus 에 들어오는
// 신호 (task.status_changed) 를 받아 다시 active 로 깨어난다.
// 이 forwarder 가 Firestore tasks 변화를 그 신호로 변환한다.
//
// 동작:
//   1. 활성 missions (status in active/sleeping/waiting_for_human) subscribe
//   2. 각 활성 미션의 projectId 별로 tasks subscribe 를 보장
//   3. tasks 변화 중 missionId 필드가 활성 미션의 ID 와 일치하면
//      task.status_changed event 발행
//   4. 활성 미션이 모두 사라진 project 의 tasks subscribe 는 정리
//
// 주의:
//   - tasks 룰은 isAuthenticated 만 검사하므로 main 의 anon auth 로 동작.
//   - dispatcher-impl 가 task doc 에 `missionId` 필드를 함께 쓴다 (Step 5b 도입).
//     fix-runner-impl 도 동일.

const ACTIVE_STATUSES = ["active", "sleeping", "waiting_for_human"];

interface ActiveMissionRow {
  missionId: string;
  projectId: string;
  status: string;
}

export interface MissionEventForwarderDeps {
  app: FirebaseApp;
  authReady?: Promise<void>;
  eventBus: MissionEventBus;
  logger?: (msg: string, meta?: Record<string, unknown>) => void;
}

export class MissionEventForwarder {
  private db: Firestore;
  private ready: Promise<void>;
  private eventBus: MissionEventBus;
  private log: (msg: string, meta?: Record<string, unknown>) => void;

  private missionsUnsub: Unsubscribe | null = null;
  // projectId → unsubscribe of that project's tasks listener
  private tasksUnsubs: Map<string, Unsubscribe> = new Map();
  // missionId → projectId (snapshot of current active missions)
  private activeMissions: Map<string, ActiveMissionRow> = new Map();
  // taskId → last seen status (so we only forward on actual changes)
  private lastTaskStatus: Map<string, string> = new Map();

  constructor(deps: MissionEventForwarderDeps) {
    this.db = getFirestore(deps.app);
    this.ready = deps.authReady ?? Promise.resolve();
    this.eventBus = deps.eventBus;
    this.log =
      deps.logger ??
      ((m, meta) => console.log(`[MissionEventForwarder] ${m}`, meta ?? ""));
  }

  async start(): Promise<void> {
    await this.ready;
    if (this.missionsUnsub) return;

    const q = query(
      collection(this.db, "missions"),
      where("status", "in", ACTIVE_STATUSES)
    );
    this.missionsUnsub = onSnapshot(
      q,
      (snap) => this.handleMissionsSnapshot(snap.docs),
      (err) => this.log("missions subscribe error", { err: String(err) })
    );
    this.log("started");
  }

  /** 현재 활성 (non-terminal) 미션 ID 목록 — 즉시 broadcast 용. */
  getActiveMissionIds(): string[] {
    return Array.from(this.activeMissions.keys());
  }

  stop(): void {
    if (this.missionsUnsub) {
      this.missionsUnsub();
      this.missionsUnsub = null;
    }
    for (const unsub of this.tasksUnsubs.values()) {
      try {
        unsub();
      } catch {
        /* best-effort */
      }
    }
    this.tasksUnsubs.clear();
    this.activeMissions.clear();
    this.lastTaskStatus.clear();
    this.log("stopped");
  }

  private handleMissionsSnapshot(
    docs: ReadonlyArray<{
      id: string;
      data(): Record<string, unknown>;
    }>
  ): void {
    const next = new Map<string, ActiveMissionRow>();
    const projectsNeeded = new Set<string>();
    for (const d of docs) {
      const data = d.data();
      const projectId = String(data.projectId ?? "");
      const status = String(data.status ?? "");
      if (!projectId || !status) continue;
      next.set(d.id, { missionId: d.id, projectId, status });
      projectsNeeded.add(projectId);
    }
    this.activeMissions = next;

    // Ensure tasks subscription for each needed project.
    for (const pid of projectsNeeded) {
      if (!this.tasksUnsubs.has(pid)) {
        this.subscribeTasksForProject(pid);
      }
    }
    // Cleanup tasks subscriptions for projects that no longer have active missions.
    for (const [pid, unsub] of this.tasksUnsubs.entries()) {
      if (!projectsNeeded.has(pid)) {
        try {
          unsub();
        } catch {
          /* best-effort */
        }
        this.tasksUnsubs.delete(pid);
      }
    }
  }

  private subscribeTasksForProject(projectId: string): void {
    const q = query(
      collection(this.db, "tasks"),
      where("projectId", "==", projectId)
    );
    const unsub = onSnapshot(
      q,
      (snap) => {
        for (const change of snap.docChanges()) {
          if (change.type === "removed") {
            this.lastTaskStatus.delete(change.doc.id);
            continue;
          }
          const data = change.doc.data();
          const missionId = data.missionId as string | undefined;
          if (!missionId) continue;
          if (!this.activeMissions.has(missionId)) continue;
          const status = String(data.status ?? "");
          if (!status) continue;
          const prev = this.lastTaskStatus.get(change.doc.id);
          this.lastTaskStatus.set(change.doc.id, status);
          if (prev === status) continue; // no actual change

          this.eventBus.emit({
            type: "task.status_changed",
            missionId,
            payload: {
              taskId: change.doc.id,
              from: prev ?? null,
              to: status,
            },
          });
        }
      },
      (err) =>
        this.log("tasks subscribe error", { projectId, err: String(err) })
    );
    this.tasksUnsubs.set(projectId, unsub);
    this.log("subscribed tasks for project", { projectId });
  }
}
