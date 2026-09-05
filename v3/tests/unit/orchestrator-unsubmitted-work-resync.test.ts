// 미제출 작업 패스의 배선 회귀 (티켓 Z4095CT4CpAuTVtnAp9l, PM 피드백) —
// OrchestratorBoardResync 통합. 순수 판정 자체의 진리표는
// tests/unit/orchestrator-unsubmitted-work.test.ts 가 고정한다. 여기서는
// "값싼 사전 필터를 통과한 행에만 git/GitHub 조회가 돈다" · "쿨다운" ·
// "활성 정체와 상태를 공유하지 않는다"는 배선만 본다.

import { describe, expect, it } from "vitest";
import {
  OrchestratorBoardResync,
  type BoardResyncDeps,
  type ResyncTaskRow,
} from "../../electron/orchestrator-board-resync";
import type { UnsurfacedGitFacts } from "../../electron/orchestrator-unsubmitted-work";

const MIN_AGE = 180_000;
const ORPHAN_MIN_AGE = 600_000; // 미제출 판정의 나이 게이트로 재사용됨

// ★status=IN_PROGRESS + 살아 있는 claimedBy — 다이제스트·자율 픽업 축(둘 다
// classifyResyncAttention 을 쓴다)에는 안 걸린다(고아가 아니라서). 미제출
// 작업 패스는 그 분류기를 거치지 않고 원행을 직접 본다 — 세 패스의 injects
// 가 섞이지 않게 하려는 테스트 전용 선택이다(orchestrator-active-stall-resync
// 테스트와 같은 트릭).
function row(over: Partial<ResyncTaskRow> = {}): ResyncTaskRow {
  return {
    taskId: "t-1",
    projectId: "p1",
    status: "IN_PROGRESS",
    title: "제목",
    role: "backend",
    prUrl: null,
    contextId: "board",
    isMission: false,
    claimedBy: "agent-1",
    branch: "marblo/backend-x",
    ageMs: ORPHAN_MIN_AGE, // 나이 게이트를 이미 채운 상태로 시작
    ...over,
  };
}

function neverHadPrFacts(): UnsurfacedGitFacts {
  return {
    hasCommitsAheadOfBase: true,
    alreadyInBase: false,
    prExistsAnyState: false,
    mostRecentPrMergedAt: null,
    lastCommitAt: null,
    dirty: false,
  };
}

function submittedFacts(): UnsurfacedGitFacts {
  return {
    hasCommitsAheadOfBase: true,
    alreadyInBase: true,
    prExistsAnyState: true,
    mostRecentPrMergedAt: 1,
    lastCommitAt: 0,
    dirty: false,
  };
}

interface Harness {
  resync: OrchestratorBoardResync;
  injects: string[];
  now: { value: number };
  probes: number;
}

function harness(over: Partial<BoardResyncDeps> = {}): Harness {
  const injects: string[] = [];
  const now = { value: 1_000_000 };
  const state = { probes: 0 };
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
    minAgeMs: MIN_AGE,
    orphanMinAgeMs: ORPHAN_MIN_AGE,
    now: () => now.value,
    unsubmittedEnabled: () => true,
    getUnsurfacedGitFacts: async () => {
      state.probes += 1;
      return neverHadPrFacts();
    },
    isOwnerInputPending: async () => false,
    ...over,
  });
  return {
    resync,
    injects,
    now,
    get probes() {
      return state.probes;
    },
  };
}

describe("OrchestratorBoardResync — 미제출 작업 패스 배선", () => {
  it("★배선을 안 주면(unsubmittedEnabled 미지정) git/GitHub 조회 자체가 안 돈다", async () => {
    let probed = false;
    const h = harness({
      unsubmittedEnabled: undefined,
      getUnsurfacedGitFacts: async () => {
        probed = true;
        return neverHadPrFacts();
      },
      listAttentionTasks: async () => [row()],
    });
    await h.resync.tickOnce();
    expect(probed).toBe(false);
    expect(h.injects).toEqual([]);
  });

  it("플래그가 꺼져 있으면 조회하지 않는다", async () => {
    let probed = false;
    const h = harness({
      unsubmittedEnabled: () => false,
      getUnsurfacedGitFacts: async () => {
        probed = true;
        return neverHadPrFacts();
      },
      listAttentionTasks: async () => [row()],
    });
    await h.resync.tickOnce();
    expect(probed).toBe(false);
    expect(h.injects).toEqual([]);
  });

  it("★PR 이 한 번도 없었으면(값싼 필터 통과 + git 실측) 알린다", async () => {
    const h = harness({ listAttentionTasks: async () => [row()] });
    await h.resync.tickOnce();
    expect(h.injects).toHaveLength(1);
    expect(h.injects[0]).toContain("[미제출 작업]");
    expect(h.injects[0]).toContain("t-1");
  });

  it("이미 반영됐으면(alreadyInBase=true) 알리지 않는다 — squash 머지 오탐 회귀", async () => {
    const h = harness({
      listAttentionTasks: async () => [row()],
      getUnsurfacedGitFacts: async () => submittedFacts(),
    });
    await h.resync.tickOnce();
    expect(h.injects).toEqual([]);
  });

  it("★브랜치가 없으면 git/GitHub 조회 자체를 안 한다(값싼 필터)", async () => {
    const h = harness({
      listAttentionTasks: async () => [row({ branch: null })],
    });
    await h.resync.tickOnce();
    expect(h.probes).toBe(0);
    expect(h.injects).toEqual([]);
  });

  it("나이 게이트를 못 채운 티켓은 조회하지 않는다", async () => {
    const h = harness({
      listAttentionTasks: async () => [row({ ageMs: ORPHAN_MIN_AGE - 1 })],
    });
    await h.resync.tickOnce();
    expect(h.probes).toBe(0);
    expect(h.injects).toEqual([]);
  });

  it("★쿨다운 동안은 같은 티켓을 다시 조회·알리지 않는다", async () => {
    const h = harness({ listAttentionTasks: async () => [row()] });
    await h.resync.tickOnce();
    expect(h.injects).toHaveLength(1);
    expect(h.probes).toBe(1);

    h.now.value += 60_000;
    await h.resync.tickOnce();
    expect(h.injects).toHaveLength(1); // 쿨다운 안 — 다시 조회 안 함
    expect(h.probes).toBe(1);

    h.now.value += ORPHAN_MIN_AGE;
    await h.resync.tickOnce();
    expect(h.injects).toHaveLength(2); // 쿨다운 경과 — 여전히 미제출이면 다시 알린다
  });

  it("git 조회 실패는 재시도된다 — 실패를 미제출 아님으로 접지 않는다", async () => {
    let fail = true;
    const h = harness({
      listAttentionTasks: async () => [row()],
      getUnsurfacedGitFacts: async () => {
        if (fail) throw new Error("git spawn failed");
        return neverHadPrFacts();
      },
    });
    await h.resync.tickOnce();
    expect(h.injects).toEqual([]); // 실패 = 모름 — 오탐 방지 우선이라 안 민다

    fail = false;
    h.now.value += 1_000;
    await h.resync.tickOnce();
    expect(h.injects).toHaveLength(1);
  });

  it("사장님 입력이 대기 중이면 알리지 않는다", async () => {
    const h = harness({
      listAttentionTasks: async () => [row()],
      isOwnerInputPending: async () => true,
    });
    await h.resync.tickOnce();
    expect(h.injects).toEqual([]);
  });
});
