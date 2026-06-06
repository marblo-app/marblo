// missionService 의 테스트 전용 in-memory 백엔드.
//
// 활성 조건: preload 가 노출하는 window.electronAPI.testMode.missionsInMemory
// === true (env MARBLO_TEST_MISSIONS_INMEM=1) 인 경우에만. production 빌드는
// 이 env 를 set 하지 않으므로 inMemEnabled() 가 항상 false → missionService 의
// 모든 호출이 기존 Firestore 경로로 그대로 흐른다 (이 모듈은 dead code).
//
// 목적: 미션탭 end-to-end 흐름(카드→LaunchDialog→createMission→리스트/디테일/
// 타임라인 렌더→상태 전이)을 진짜 Firestore/LLM 없이 결정적으로 구동하기 위한
// seam. 미션 진행(planning→active→completed, step 전이, timeline append)은
// window.__marbloTest.missions 제어 API 로 테스트가 직접 구동한다.
//
// 메인 프로세스의 mission-engine(decompose/dispatchOne)은 이 백엔드를 보지
// 못한다(별도 Firestore 인스턴스). 즉 이 seam 은 "렌더러 UI 배선" 만 검증하며,
// 엔진 로직 검증은 wire.ts 의 주입 포트로 별도 트랙에서 한다.

import type { Mission } from "../types/mission";
import type { Unsubscribe } from "firebase/firestore";

type CreateData = Omit<
  Mission,
  "id" | "launchedAt" | "lastActivityAt" | "completedAt"
>;
type UpdateData = Partial<Omit<Mission, "id" | "launchedAt">>;
type CollSub = { projectId: string; cb: (missions: Mission[]) => void };
type DocSub = { id: string; cb: (mission: Mission | null) => void };

let missions: Mission[] = [];
let idCounter = 0;
const collSubs = new Set<CollSub>();
const docSubs = new Set<DocSub>();

function clone<T>(value: T): T {
  // 렌더러(Chromium)/Node 18+ 모두 structuredClone 지원. Date·중첩 배열을
  // 보존하므로 toMission 변환 없이 Mission 표현을 그대로 복제할 수 있다.
  return structuredClone(value);
}

// Firestore 경로(subscribeToMissions)와 동일하게 projectId 필터 + lastActivityAt
// 내림차순 정렬. 호출자 보호를 위해 복제본 반환.
function sortedFor(projectId: string): Mission[] {
  return missions
    .filter((m) => m.projectId === projectId)
    .slice()
    .sort((a, b) => b.lastActivityAt.getTime() - a.lastActivityAt.getTime())
    .map(clone);
}

function notifyColl(): void {
  for (const sub of collSubs) sub.cb(sortedFor(sub.projectId));
}

function notifyDoc(id: string): void {
  const found = missions.find((m) => m.id === id) ?? null;
  for (const sub of docSubs) {
    if (sub.id === id) sub.cb(found ? clone(found) : null);
  }
}

// window.__marbloTest.missions 제어 API 설치 (idempotent). main.tsx 가 bypassAuth
// 모드에서 window.__marbloTest = { stores } 를 먼저 세팅하므로, 여기서는 .missions
// 만 덧붙인다. 첫 in-mem 호출(보통 MissionsTab mount 의 subscribeToMissions) 시점에
// 호출돼 main.tsx 의 전체 할당 이후를 보장한다 (eval 순서 경합 회피).
function ensureHatch(): void {
  if (typeof window === "undefined") return;
  const w = window as unknown as { __marbloTest?: Record<string, unknown> };
  if (!w.__marbloTest) w.__marbloTest = {};
  if (w.__marbloTest.missions) return;
  w.__marbloTest.missions = {
    reset(): void {
      missions = [];
      idCounter = 0;
      notifyColl();
    },
    // UI 없이 미션들을 직접 주입 (초기 리스트/디테일 시나리오용).
    seed(seedList: Mission[]): void {
      missions = seedList.map(clone);
      notifyColl();
      for (const m of missions) notifyDoc(m.id);
    },
    // 미션 필드 patch — status/steps/contextLog 등을 구동해 엔진 진행을 흉내낸다.
    patch(id: string, partial: Partial<Mission>): void {
      const idx = missions.findIndex((m) => m.id === id);
      if (idx === -1)
        throw new Error(`[missions inmem] patch: not found ${id}`);
      const next = clone({ ...missions[idx], ...partial }) as Mission;
      if (!partial.lastActivityAt) next.lastActivityAt = new Date();
      missions[idx] = next;
      notifyColl();
      notifyDoc(id);
    },
    get(id: string): Mission | null {
      const m = missions.find((x) => x.id === id);
      return m ? clone(m) : null;
    },
    list(): Mission[] {
      return missions.map(clone);
    },
    count(): number {
      return missions.length;
    },
  };
  // eslint-disable-next-line no-console
  console.log("[TestHatch] window.__marbloTest.missions exposed (in-memory)");
}

export function inMemEnabled(): boolean {
  try {
    return (
      typeof window !== "undefined" &&
      window.electronAPI?.testMode?.missionsInMemory === true
    );
  } catch {
    return false;
  }
}

// missionService 의 public 시그니처와 1:1 매칭되는 in-memory 구현.
// 상위 헬퍼(appendTimelineEvent/updateMissionStep/setMissionStatus)는
// missionService 의 getMission/updateMission 을 경유하므로 자동으로 이 백엔드를
// 탄다 — 별도 구현 불필요.
export const inMem = {
  async getMissions(projectId: string): Promise<Mission[]> {
    return sortedFor(projectId);
  },

  async getMission(missionId: string): Promise<Mission | null> {
    const m = missions.find((x) => x.id === missionId);
    return m ? clone(m) : null;
  },

  async createMission(data: CreateData): Promise<string> {
    ensureHatch();
    const now = new Date();
    const id = `mock-mission-${++idCounter}`;
    const mission = clone({
      ...data,
      id,
      launchedAt: now,
      lastActivityAt: now,
      completedAt: null,
    }) as Mission;
    missions.push(mission);
    notifyColl();
    notifyDoc(id);
    return id;
  },

  async updateMission(missionId: string, data: UpdateData): Promise<void> {
    const idx = missions.findIndex((m) => m.id === missionId);
    if (idx === -1) return; // Firestore 는 throw 하지만 테스트 친화적으로 무시.
    const next = clone({
      ...missions[idx],
      ...data,
      lastActivityAt: new Date(),
    }) as Mission;
    if (data.completedAt instanceof Date) next.completedAt = data.completedAt;
    missions[idx] = next;
    notifyColl();
    notifyDoc(missionId);
  },

  async deleteMission(missionId: string): Promise<void> {
    missions = missions.filter((m) => m.id !== missionId);
    notifyColl();
    notifyDoc(missionId);
  },

  subscribeToMissions(
    projectId: string,
    callback: (missions: Mission[]) => void,
  ): Unsubscribe {
    ensureHatch();
    const sub: CollSub = { projectId, cb: callback };
    collSubs.add(sub);
    callback(sortedFor(projectId)); // 초기 스냅샷 즉시 전달 (onSnapshot 동작 모사).
    return () => {
      collSubs.delete(sub);
    };
  },

  subscribeToMission(
    missionId: string,
    callback: (mission: Mission | null) => void,
  ): Unsubscribe {
    ensureHatch();
    const sub: DocSub = { id: missionId, cb: callback };
    docSubs.add(sub);
    const m = missions.find((x) => x.id === missionId) ?? null;
    callback(m ? clone(m) : null);
    return () => {
      docSubs.delete(sub);
    };
  },
};
