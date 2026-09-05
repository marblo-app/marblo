// 활성 정체 패스의 배선 회귀 (티켓 Z4095CT4CpAuTVtnAp9l) — OrchestratorBoardResync
// 통합. 순수 판정 자체의 진리표는 tests/unit/orchestrator-active-stall.test.ts 가
// 고정한다. 여기서는 "매 틱 이미 읽어 오는 attention 행을 diff 해서 실제로
// activeSince·진전 시각을 굴린다" 는 배선이 맞는지만 본다.
//
// 고정하는 계약:
//   ① ★배선을 안 주면(activeStallEnabled 미지정) 기존 동작이 한 줄도 안 바뀐다.
//   ② 오케가 continuous 하게 busy 인 채로 보드가 그대로면 판정 창 뒤에 민다.
//   ③ ★티켓이 실제로 전이되면 정체 시계가 그 시각으로 리셋된다(diff 기반).
//   ④ 쿨다운 동안은 다시 안 민다.
//   ⑤ 오케가 진짜 유휴로 빠지면 활성 구간이 리셋된다 — 다시 busy 가 되면 창을
//      처음부터 채워야 한다.

import { describe, expect, it } from "vitest";
import {
  OrchestratorBoardResync,
  type BoardResyncDeps,
  type ResyncTaskRow,
} from "../../electron/orchestrator-board-resync";
import { ACTIVE_STALL_WINDOW_MS } from "../../electron/orchestrator-active-stall";

const MIN_AGE = 180_000;
const ORPHAN_MIN_AGE = 600_000;
const WINDOW = ACTIVE_STALL_WINDOW_MS; // 10분

// ★status=IN_PROGRESS + 살아 있는 claimedBy — 다이제스트·자율 픽업 축(둘 다
// classifyResyncAttention 을 쓴다)에는 안 걸린다(고아가 아니라서). 활성 정체
// 패스는 classifyResyncAttention 을 거치지 않고 원행을 직접 diff 하므로 여전히
// 본다. 세 패스의 injects 가 섞이지 않게 하려는 테스트 전용 선택이다.
function row(over: Partial<ResyncTaskRow> = {}): ResyncTaskRow {
  return {
    taskId: "t-review",
    projectId: "p1",
    status: "IN_PROGRESS",
    title: "제목",
    role: "backend",
    prUrl: null,
    contextId: "board",
    isMission: false,
    claimedBy: "agent-1",
    ageMs: 20 * 60_000,
    ...over,
  };
}

interface Harness {
  resync: OrchestratorBoardResync;
  injects: string[];
  now: { value: number };
}

function harness(over: Partial<BoardResyncDeps> = {}): Harness {
  const injects: string[] = [];
  const now = { value: 1_000_000 };
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
    activeStallEnabled: () => true,
    isOwnerInputPending: async () => false,
    ...over,
  });
  return { resync, injects, now };
}

/**
 * "오케가 계속 busy 다"를 시뮬레이션한다 — busy 신호 사이 간격을 기본 유휴
 * 판정 창(6초)보다 짧게 유지해야 `activeSince` 가 리셋되지 않는다.
 */
function advanceWhileBusy(h: Harness, totalMs: number, stepMs = 5_000): void {
  let remaining = totalMs;
  while (remaining > 0) {
    const step = Math.min(stepMs, remaining);
    h.now.value += step;
    h.resync.markOrchestratorActivity("p1");
    remaining -= step;
  }
}

describe("OrchestratorBoardResync — 활성 정체 패스 배선", () => {
  it("★배선을 안 주면(activeStallEnabled 미지정) 기존 동작 그대로 — 정체가 계속돼도 안 민다", async () => {
    const h = harness({
      activeStallEnabled: undefined,
      listAttentionTasks: async () => [row()],
    });
    h.resync.markOrchestratorActivity("p1");
    await h.resync.tickOnce();
    advanceWhileBusy(h, WINDOW + 60_000);
    await h.resync.tickOnce();
    expect(h.injects).toEqual([]);
  });

  it("플래그가 꺼져 있으면 정체가 계속돼도 안 민다", async () => {
    const h = harness({
      activeStallEnabled: () => false,
      listAttentionTasks: async () => [row()],
    });
    h.resync.markOrchestratorActivity("p1");
    await h.resync.tickOnce();
    advanceWhileBusy(h, WINDOW + 60_000);
    await h.resync.tickOnce();
    expect(h.injects).toEqual([]);
  });

  it("★오케가 continuous 하게 busy 인데 보드가 그대로면 판정 창 뒤에 활성 정체를 알린다", async () => {
    const h = harness({ listAttentionTasks: async () => [row()] });
    h.resync.markOrchestratorActivity("p1"); // 활성 구간 시작
    await h.resync.tickOnce(); // 첫 관측 — 아직 창을 못 채웠다
    expect(h.injects).toEqual([]);

    advanceWhileBusy(h, WINDOW); // 그동안 보드는 그대로, 오케는 계속 busy
    await h.resync.tickOnce();
    expect(h.injects).toHaveLength(1);
    expect(h.injects[0]).toContain("[활성 정체]");
  });

  it("★티켓이 실제로 전이되면 정체 시계가 그 시각으로 리셋된다", async () => {
    const rows: ResyncTaskRow[] = [row()];
    const h = harness({ listAttentionTasks: async () => rows });
    h.resync.markOrchestratorActivity("p1"); // t=1_000_000, 활성 구간 시작
    await h.resync.tickOnce(); // 기준 스냅샷

    advanceWhileBusy(h, WINDOW - 60_000); // t=1_540_000 — 아직 창 전
    // ★CLAIMED 로 바꾼다 — BLOCKED 는 classifyResyncAttention 이 다이제스트
    //   축으로도 집어 injects 가 섞인다. CLAIMED+살아있는 claimedBy 는 고아가
    //   아니므로 다이제스트·픽업 어느 쪽에도 안 걸린다.
    rows[0] = { ...rows[0], status: "CLAIMED" }; // 실제 전이
    await h.resync.tickOnce(); // diff 가 전이를 감지 → lastTicketTransitionAt=t
    expect(h.injects).toEqual([]);

    advanceWhileBusy(h, 60_000); // t=1_600_000 — activeForMs 는 창을 채웠다
    await h.resync.tickOnce(); // 그런데 전이 이후 60초밖에 안 지났다 — 진행중
    expect(h.injects).toEqual([]);

    advanceWhileBusy(h, WINDOW); // 전이 이후로 창을 다 채웠다
    await h.resync.tickOnce();
    expect(h.injects).toHaveLength(1);
  });

  it("★쿨다운 동안은 같은 정체를 다시 알리지 않는다", async () => {
    const h = harness({ listAttentionTasks: async () => [row()] });
    h.resync.markOrchestratorActivity("p1");
    await h.resync.tickOnce();
    advanceWhileBusy(h, WINDOW);
    await h.resync.tickOnce();
    expect(h.injects).toHaveLength(1);

    advanceWhileBusy(h, 60_000);
    await h.resync.tickOnce();
    expect(h.injects).toHaveLength(1); // 쿨다운 안

    advanceWhileBusy(h, WINDOW + 1_000); // 쿨다운 경과, 여전히 정체
    await h.resync.tickOnce();
    expect(h.injects).toHaveLength(2);
  });

  it("오케가 진짜 유휴로 빠지면 활성 구간이 리셋된다", async () => {
    const h = harness({ listAttentionTasks: async () => [row()] });
    h.resync.markOrchestratorActivity("p1");
    await h.resync.tickOnce();

    // 이 사이 busy 신호가 하나도 없다 — 유휴로 판정된다.
    h.now.value += WINDOW + 60_000;
    await h.resync.tickOnce();
    expect(h.injects).toEqual([]);

    h.now.value += 1_000;
    h.resync.markOrchestratorActivity("p1"); // 다시 busy — 새 활성 구간
    await h.resync.tickOnce();
    expect(h.injects).toEqual([]); // 창을 처음부터 다시 채워야 한다

    advanceWhileBusy(h, WINDOW);
    await h.resync.tickOnce();
    expect(h.injects).toHaveLength(1);
  });

  it("사장님 입력이 대기 중이면 정체를 알리지 않는다", async () => {
    const h = harness({
      listAttentionTasks: async () => [row()],
      isOwnerInputPending: async () => true,
    });
    h.resync.markOrchestratorActivity("p1");
    await h.resync.tickOnce();
    advanceWhileBusy(h, WINDOW);
    await h.resync.tickOnce();
    expect(h.injects).toEqual([]);
  });

  it("★주입 실패는 상태를 태우지 않는다 — 다음 틱에 재시도된다", async () => {
    let ok = false;
    const injects: string[] = [];
    const now = { value: 1_000_000 };
    const resync = new OrchestratorBoardResync({
      listBoardOrchestratorProjects: () => ["p1"],
      getOrchestratorSession: () => ({ ptySessionId: "s1", status: "running" }),
      listAttentionTasks: async () => [row()],
      isAgentAliveInFleet: () => true,
      listReadyChainItems: async () => [],
      inject: async (_p, m) => {
        if (!ok) return false;
        injects.push(m);
        return true;
      },
      log: () => {},
      logError: () => {},
      minAgeMs: MIN_AGE,
      orphanMinAgeMs: ORPHAN_MIN_AGE,
      now: () => now.value,
      activeStallEnabled: () => true,
    });
    const h: Harness = { resync, injects, now };
    resync.markOrchestratorActivity("p1");
    await resync.tickOnce();
    advanceWhileBusy(h, WINDOW);
    await resync.tickOnce();
    expect(injects).toEqual([]);

    ok = true;
    advanceWhileBusy(h, 5_000);
    await resync.tickOnce();
    expect(injects).toHaveLength(1);
  });
});
