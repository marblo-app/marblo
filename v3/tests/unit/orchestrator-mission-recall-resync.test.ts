// PROCEED 재호출 패스의 배선 회귀 (티켓 xKhErJdSwDH3LIItFe42, P2→P1 격상) —
// OrchestratorBoardResync 통합. 순수 판정 자체의 진리표는
// tests/unit/orchestrator-mission-recall.test.ts 가 고정한다. 여기서는 "매 틱
// PROCEED 미션을 읽고, 근거 티켓 상태를 확인해 실제로 재호출을 주입하는가"
// 라는 배선만 본다.
//
// 고정하는 계약:
//   ① ★배선을 안 주면(missionRecallEnabled 미지정) 기존 동작이 한 줄도 안
//      바뀐다 — missions/tasks 를 아예 안 읽는다.
//   ② PROCEED 이후 판정 창(10분) 동안 근거 티켓이 TODO 로 남아 있으면
//      재호출을 주입한다.
//   ③ ★근거 티켓이 TODO 를 벗어났으면(=오케가 실제로 움직였다) 다시 안
//      묻는다 — "프로젝트 전체가 움직였다"가 아니라 "이 후보가 움직였다"만
//      본다.
//   ④ ★같은 미션을 쿨다운 안에 다시 안 부른다.
//   ⑤ 다른 패스가 이미 이번 틱에 뭔가 밀었으면 이 패스는 조용히 넘어간다
//      (같은 틱 이중 통보 방지 규율).
//   ⑥ ★한도(연속 신호)를 넘으면 HALT 하고, 오케 PTY 알림과 별개로 사장님
//      채널로 1회 에스컬레이션한다(조용한 포기 금지).

import { describe, expect, it, vi } from "vitest";
import {
  OrchestratorBoardResync,
  type BoardResyncDeps,
} from "../../electron/orchestrator-board-resync";
import {
  MISSION_RECALL_WINDOW_MS,
  type StalledProceedMission,
} from "../../electron/orchestrator-mission-recall";

const WINDOW = MISSION_RECALL_WINDOW_MS; // 10분

interface Harness {
  resync: OrchestratorBoardResync;
  injects: string[];
  escalations: string[];
  now: { value: number };
  missions: StalledProceedMission[];
  taskStatus: { value: string | null };
  listStalledProceedMissionsSpy: ReturnType<typeof vi.fn>;
  getTaskStatusSpy: ReturnType<typeof vi.fn>;
  notifyOwnerChannelSpy: ReturnType<typeof vi.fn>;
}

function mission(
  over: Partial<StalledProceedMission> = {},
): StalledProceedMission {
  return {
    missionId: "mission_abc123",
    label: "결제 리팩터",
    handoffAskedAt: 1_000_000,
    nextTaskId: "task_next1",
    nextWhat: "결제 리팩터 2단계 착수",
    ...over,
  };
}

function harness(over: Partial<BoardResyncDeps> = {}): Harness {
  const injects: string[] = [];
  const escalations: string[] = [];
  const now = { value: 1_000_000 };
  const missions: StalledProceedMission[] = [mission()];
  const taskStatus: { value: string | null } = { value: "TODO" };
  const listStalledProceedMissionsSpy = vi.fn(async () => missions);
  const getTaskStatusSpy = vi.fn(async () => taskStatus.value);
  const notifyOwnerChannelSpy = vi.fn(async (_p: string, m: string) => {
    escalations.push(m);
  });
  const resync = new OrchestratorBoardResync({
    listBoardOrchestratorProjects: () => ["p1"],
    getOrchestratorSession: () => ({ ptySessionId: "s1", status: "running" }),
    listAttentionTasks: async () => [],
    isAgentAliveInFleet: () => true,
    listReadyChainItems: async () => [],
    inject: async (_p, m) => {
      injects.push(m);
      return true;
    },
    log: () => {},
    logError: () => {},
    now: () => now.value,
    missionRecallEnabled: () => true,
    listStalledProceedMissions: listStalledProceedMissionsSpy,
    getTaskStatus: getTaskStatusSpy,
    notifyOwnerChannel: notifyOwnerChannelSpy,
    isOwnerInputPending: async () => false,
    ...over,
  });
  return {
    resync,
    injects,
    escalations,
    now,
    missions,
    taskStatus,
    listStalledProceedMissionsSpy,
    getTaskStatusSpy,
    notifyOwnerChannelSpy,
  };
}

describe("OrchestratorBoardResync — PROCEED 재호출 패스 배선", () => {
  it("★배선을 안 주면(missionRecallEnabled 미지정) missions/tasks 를 아예 안 읽는다", async () => {
    const h = harness({ missionRecallEnabled: undefined });
    h.now.value += WINDOW + 60_000;
    await h.resync.tickOnce();
    expect(h.injects).toEqual([]);
    expect(h.listStalledProceedMissionsSpy).not.toHaveBeenCalled();
  });

  it("플래그가 꺼져 있으면 안 읽는다", async () => {
    const h = harness({ missionRecallEnabled: () => false });
    h.now.value += WINDOW + 60_000;
    await h.resync.tickOnce();
    expect(h.injects).toEqual([]);
    expect(h.listStalledProceedMissionsSpy).not.toHaveBeenCalled();
  });

  it("★판정 창 안에서는 티켓 상태도 안 읽는다(값싼 사전 필터)", async () => {
    const h = harness();
    h.now.value += WINDOW - 60_000;
    await h.resync.tickOnce();
    expect(h.injects).toEqual([]);
    expect(h.getTaskStatusSpy).not.toHaveBeenCalled();
  });

  it("★판정 창을 채우고 근거 티켓이 여전히 TODO 면 재호출을 주입한다", async () => {
    const h = harness();
    h.now.value += WINDOW;
    await h.resync.tickOnce();
    expect(h.injects).toHaveLength(1);
    expect(h.injects[0]).toContain("[PROCEED 재호출]");
    expect(h.injects[0]).toContain("mission_abc123");
    expect(h.injects[0]).toContain("task_next1");
  });

  it("★근거 티켓이 TODO 를 벗어났으면(오케가 실제로 움직였다) 재호출하지 않는다", async () => {
    const h = harness();
    h.taskStatus.value = "CLAIMED";
    h.now.value += WINDOW;
    await h.resync.tickOnce();
    expect(h.injects).toEqual([]);
    expect(h.getTaskStatusSpy).toHaveBeenCalledWith("task_next1");
  });

  it("★한 번 해소로 확인되면 다음 틱부터 그 미션의 티켓 상태를 다시 조회하지 않는다", async () => {
    const h = harness();
    h.taskStatus.value = "CLAIMED";
    h.now.value += WINDOW;
    await h.resync.tickOnce();
    expect(h.getTaskStatusSpy).toHaveBeenCalledTimes(1);

    h.now.value += WINDOW;
    await h.resync.tickOnce();
    // 여전히 같은 missions 목록을 돌려주더라도(호출부가 Firestore 필드를 안
    // 지우므로) 이미 해소로 캐시된 missionId 는 값싼 필터에서 걸러진다.
    expect(h.getTaskStatusSpy).toHaveBeenCalledTimes(1);
    expect(h.injects).toEqual([]);
  });

  it("★같은 미션을 쿨다운 안에 다시 안 부른다", async () => {
    const h = harness();
    h.now.value += WINDOW;
    await h.resync.tickOnce();
    expect(h.injects).toHaveLength(1);

    h.now.value += 60_000; // 쿨다운 안
    await h.resync.tickOnce();
    expect(h.injects).toHaveLength(1); // 늘지 않았다
  });

  it("★쿨다운이 지나면 여전히 TODO 일 때 다시 부른다", async () => {
    const h = harness();
    h.now.value += WINDOW;
    await h.resync.tickOnce();
    expect(h.injects).toHaveLength(1);

    h.now.value += WINDOW; // 쿨다운 경과
    await h.resync.tickOnce();
    expect(h.injects).toHaveLength(2);
  });

  it("같은 틱에 다른 패스가 이미 밀었으면 조용히 넘어간다", async () => {
    const h = harness({
      listAttentionTasks: async () => [
        {
          taskId: "t1",
          projectId: "p1",
          status: "REVIEW",
          title: "제목",
          role: "backend",
          prUrl: null,
          contextId: "board",
          isMission: false,
          claimedBy: null,
          ageMs: 10 * 60_000,
        },
      ],
    });
    h.now.value += WINDOW;
    await h.resync.tickOnce();
    expect(h.injects).toHaveLength(1);
    expect(h.injects[0]).not.toContain("[PROCEED 재호출]");
    expect(h.listStalledProceedMissionsSpy).not.toHaveBeenCalled();
  });

  it("★한도를 넘으면 HALT 하고 오케 PTY 알림과 별개로 사장님 채널로 에스컬레이션한다", async () => {
    const h = harness();
    // 후보 수(1건)가 안 줄어드는 채로 신호가 반복되므로 진행없음 한도
    // (maxStagnantSignals=2, "2회 초과"에서 HALT)가 연속 스폰 한도(5)보다
    // 먼저 걸린다 — advance-guards.ts 의 기존 한도를 그대로 쓴 결과다.
    for (let i = 0; i < 3; i++) {
      h.now.value += WINDOW;
      await h.resync.tickOnce();
    }
    const before = h.injects.length;
    h.now.value += WINDOW;
    await h.resync.tickOnce();
    expect(h.injects.length).toBe(before + 1);
    expect(h.injects.at(-1)).toContain("⏸");
    expect(h.escalations).toHaveLength(1);
    expect(h.escalations[0]).toContain("🚨");
    expect(h.escalations[0]).toContain("mission_abc123");

    // ★HALT 이후로는 조용하다 — 매 틱 다시 에스컬레이션하지 않는다.
    h.now.value += WINDOW;
    await h.resync.tickOnce();
    expect(h.escalations).toHaveLength(1);
  });

  it("미션이 없으면 조용하다 — 조회는 하되 아무것도 안 민다", async () => {
    const h = harness();
    h.missions.length = 0;
    h.now.value += WINDOW;
    await h.resync.tickOnce();
    expect(h.injects).toEqual([]);
  });
});
