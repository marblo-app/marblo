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
import { getMissionDriver } from "./conductor-driver";

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
  // 유저가 ⏸️ Pause 한 미션인가 (마지막 paused/resumed timeline 이벤트로 판별).
  // true 면 task.status_changed wakeup 신호를 발행하지 않는다 — engine.onEvent
  // 가드와 동일 의도의 이중 방어(발원지에서 차단).
  pausedByUser: boolean;
}

/**
 * mission doc 의 contextLog 를 뒤에서부터 훑어 "유저가 명시적으로 Pause 했는가" 판정.
 * engine/index.ts 의 isPausedByUser 와 동일한 규칙: 가장 가까운 mission.resumed 면
 * 재개됨(false), mission.paused(kind="paused_by_user") 면 일시정지(true).
 * wait-step sleeping(kind="sleeping") / abandoned 는 paused_by_user 아님.
 */
export function isMissionPausedByUser(data: Record<string, unknown>): boolean {
  const log = data.contextLog;
  if (!Array.isArray(log)) return false;
  for (let i = log.length - 1; i >= 0; i--) {
    const ev = log[i] as { type?: string; payload?: { kind?: string } } | null;
    if (!ev || typeof ev.type !== "string") continue;
    if (ev.type === "mission.resumed") return false;
    if (ev.type === "mission.paused") {
      return ev.payload?.kind === "paused_by_user";
    }
  }
  return false;
}

/**
 * task 문서의 projection.lastActivityAt(Firestore Timestamp)를 millis 로 변환.
 * projection 미시드/비정상 타입이면 null — 호출부가 activity 발행을 건너뛴다.
 */
function projectionActivityMillis(
  data: Record<string, unknown>,
): number | null {
  const projection = data.projection as
    | { lastActivityAt?: unknown }
    | undefined;
  const ts = projection?.lastActivityAt;
  if (ts && typeof (ts as { toMillis?: unknown }).toMillis === "function") {
    return (ts as { toMillis: () => number }).toMillis();
  }
  return null;
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
  // taskId → last seen projection.lastActivityAt (millis). add_activity 가 status 를
  // 바꾸지 않으므로 별도 추적 — 값이 달라졌을 때만 task.activity_logged 를 발행한다.
  // (B안 타임라인 합성 전용. orchestrator 모드에서만 채워진다 — 아래 emit 가드 참고.)
  private lastActivityAt: Map<string, number> = new Map();

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
      where("status", "in", ACTIVE_STATUSES),
    );
    this.missionsUnsub = onSnapshot(
      q,
      (snap) => this.handleMissionsSnapshot(snap.docs),
      (err) => this.log("missions subscribe error", { err: String(err) }),
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
    this.lastActivityAt.clear();
    this.log("stopped");
  }

  private handleMissionsSnapshot(
    docs: ReadonlyArray<{
      id: string;
      data(): Record<string, unknown>;
    }>,
  ): void {
    const next = new Map<string, ActiveMissionRow>();
    const projectsNeeded = new Set<string>();
    for (const d of docs) {
      const data = d.data();
      const projectId = String(data.projectId ?? "");
      const status = String(data.status ?? "");
      if (!projectId || !status) continue;
      next.set(d.id, {
        missionId: d.id,
        projectId,
        status,
        pausedByUser: status === "sleeping" && isMissionPausedByUser(data),
      });
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
      where("projectId", "==", projectId),
    );
    const unsub = onSnapshot(
      q,
      (snap) => {
        for (const change of snap.docChanges()) {
          if (change.type === "removed") {
            this.lastTaskStatus.delete(change.doc.id);
            this.lastActivityAt.delete(change.doc.id);
            continue;
          }
          const data = change.doc.data();
          const missionId = data.missionId as string | undefined;
          if (!missionId) continue;
          const row = this.activeMissions.get(missionId);
          if (!row) continue;
          const taskTitle = typeof data.title === "string" ? data.title : null;

          // ── (1) status 변화 신호 ─────────────────────────────────────────
          // A안 wait-step wakeup 의 원천이자, B안에서 지휘자가 'task.status' 로
          // 합성하는 원천. (B안 Phase 4-A: payload 에 taskTitle 추가.)
          const status = String(data.status ?? "");
          if (status) {
            const prev = this.lastTaskStatus.get(change.doc.id);
            this.lastTaskStatus.set(change.doc.id, status);
            // 이중 방어: 유저가 ⏸️ Pause 한 미션은 task 변화로 깨우지 않는다.
            // lastTaskStatus 는 위에서 갱신해 두므로, 나중에 Resume 되면 그 사이
            // 쌓인 변화가 중복 재발행되지 않는다(다음 실제 변화부터 정상 forward).
            if (prev !== status && !row.pausedByUser) {
              this.eventBus.emit({
                type: "task.status_changed",
                missionId,
                payload: {
                  taskId: change.doc.id,
                  from: prev ?? null,
                  to: status,
                  taskTitle,
                },
              });
            }
          }

          // ── (2) activity(add_activity) 신호 ──────────────────────────────
          // B안 타임라인 합성 전용(단일 writer=지휘자). add_activity 는 status 를
          // 바꾸지 않으므로 projection.lastActivityAt 변화로 감지한다. A안 engine 은
          // 모든 버스 이벤트를 generic onEvent(=supervisor.note append + scheduleAdvance)
          // 로 처리하므로, 이 신규 이벤트를 A안에 흘리면 "A안 무영향" 이 깨진다 →
          // orchestrator(B) 모드에서만 발행한다.
          if (getMissionDriver() === "orchestrator") {
            const activityAtMillis = projectionActivityMillis(data);
            if (activityAtMillis !== null) {
              const prevAt = this.lastActivityAt.get(change.doc.id);
              // status 와 동일하게 가드 전에 갱신 — Resume 후 중복 재발행 방지.
              this.lastActivityAt.set(change.doc.id, activityAtMillis);
              if (prevAt !== activityAtMillis && !row.pausedByUser) {
                const projection = data.projection as
                  | { lastActivitySummary?: unknown; lastAgentId?: unknown }
                  | undefined;
                this.eventBus.emit({
                  type: "task.activity_logged",
                  missionId,
                  payload: {
                    taskId: change.doc.id,
                    message:
                      typeof projection?.lastActivitySummary === "string"
                        ? projection.lastActivitySummary
                        : "",
                    agentId:
                      typeof projection?.lastAgentId === "string"
                        ? projection.lastAgentId
                        : null,
                    taskTitle,
                    activityAtMillis,
                  },
                });
              }
            }
          }
        }
      },
      (err) =>
        this.log("tasks subscribe error", { projectId, err: String(err) }),
    );
    this.tasksUnsubs.set(projectId, unsub);
    this.log("subscribed tasks for project", { projectId });
  }
}
