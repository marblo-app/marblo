/**
 * 감사 원장 L1 — 로컬 스풀 유닛 테스트.
 *
 * 검증 대상(스펙 §7/§11 + 티켓 요구):
 *  - 오프라인 적재 → 복구 후 **순서 보존** 재적재
 *  - 쓰기 실패가 **관측 가능한 상태**로 남는가 (조용히 삼켜지지 않는가)
 *  - 상한 초과 시 알림이 발생하고 **조용히 버려지지 않는가**
 *  - enqueue 의 비차단 성질
 *
 * ★스풀 디렉터리는 매 테스트마다 os.tmpdir() 아래 격리한다. 실제
 * `~/.marblo` 를 건드리면 사장님의 라이브 앱 상태를 오염시킨다(티켓
 * Me11Ze8kvI35LvONzU9F 에서 실제 사고).
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";

import {
  LedgerSpool,
  SPOOL_OVERFLOW_TOOL,
  defaultSpoolDir,
  formatSpoolStatus,
  requireServerAck,
  spoolFileName,
  spoolNotice,
  type SpoolRecord,
} from "../../electron/mcp-server/ledger-spool";
import type { LedgerEventWrite } from "../../electron/mcp-server/ledger";

const AGENT = "backend-1";

let dir: string;

beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), "marblo-spool-test-"));
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(async () => {
  vi.restoreAllMocks();
  await fs.rm(dir, { recursive: true, force: true });
});

function evt(
  n: number,
  over: Partial<LedgerEventWrite> = {},
): LedgerEventWrite {
  return {
    projectId: "GFB8JnJrrX6AgahqmGB3",
    agentId: AGENT,
    toolName: `tool_${n}`,
    params: { n },
    result: "ok",
    duration: 1,
    success: true,
    kind: "action",
    actorUid: "uid-1",
    model: "claude",
    tier: "standard",
    instructionHash: null,
    taskId: null,
    worktreeId: null,
    ...over,
  };
}

/** 실패시킬 수 있는 sink. `fail` 이 true 인 동안 모든 쓰기를 거부한다. */
function makeSink() {
  const written: SpoolRecord[] = [];
  const state = { fail: false, reason: "network offline" };
  const sink = async (rec: SpoolRecord) => {
    if (state.fail) throw new Error(state.reason);
    written.push(rec);
  };
  return { written, state, sink };
}

/** 재시도 타이머를 수동으로 돌리는 스케줄러. 테스트에서 시간을 지배한다. */
function makeScheduler() {
  const pending: Array<() => void> = [];
  return {
    schedule: (fn: () => void) => {
      pending.push(fn);
    },
    /** 예약된 재시도를 전부 실행한다. */
    fire: () => {
      const batch = pending.splice(0, pending.length);
      for (const fn of batch) fn();
    },
    get count() {
      return pending.length;
    },
  };
}

function spoolWith(
  overrides: Partial<ConstructorParameters<typeof LedgerSpool>[0]> = {},
) {
  const { written, state, sink } = makeSink();
  const sched = makeScheduler();
  let seq = 0;
  const spool = new LedgerSpool({
    dir,
    agentId: AGENT,
    sink,
    now: () => 1_000_000 + seq * 10,
    newId: () => `id-${++seq}`,
    schedule: sched.schedule,
    ...overrides,
  });
  return { spool, written, state, sched };
}

describe("정상 경로 — 비차단 + 디스크 무접촉", () => {
  it("enqueue 는 동기이고 즉시 반환한다 (툴 호출을 막지 않는다)", () => {
    const { spool } = spoolWith();
    const returned = spool.enqueue(evt(1));
    // 반환 시점에는 아직 sink 가 돌지 않았다 = await 하지 않았다.
    expect(typeof returned).toBe("string");
    expect(spool.status().pending).toBe(1);
  });

  it("성공하면 큐가 비고 스풀 파일을 만들지 않는다", async () => {
    const { spool, written } = spoolWith();
    spool.enqueue(evt(1));
    spool.enqueue(evt(2));
    await spool.settled();

    expect(written.map((r) => r.event.toolName)).toEqual(["tool_1", "tool_2"]);
    const s = spool.status();
    expect(s.pending).toBe(0);
    expect(s.degraded).toBe(false);
    expect(s.everDegraded).toBe(false);
    expect(s.writtenCount).toBe(2);
    await expect(fs.access(spool.spoolPath)).rejects.toThrow();
  });

  it("재시도가 중복 문서를 만들지 않도록 문서 id 를 1회만 생성해 재사용한다", async () => {
    const { spool, written, state, sched } = spoolWith();
    state.fail = true;
    const id = spool.enqueue(evt(1));
    await spool.settled();

    state.fail = false;
    sched.fire();
    await spool.settled();

    expect(written).toHaveLength(1);
    expect(written[0].id).toBe(id);
  });
});

describe("★오프라인 적재 → 복구 후 순서 보존 재적재 (§7)", () => {
  it("오프라인 동안 쌓인 이벤트를 복구 후 발생 순서대로 재적재한다", async () => {
    const { spool, written, state, sched } = spoolWith();

    state.fail = true;
    for (let i = 1; i <= 5; i++) spool.enqueue(evt(i));
    await spool.settled();

    expect(written).toHaveLength(0);
    expect(spool.status().pending).toBe(5);

    state.fail = false;
    sched.fire();
    await spool.settled();

    expect(written.map((r) => r.event.toolName)).toEqual([
      "tool_1",
      "tool_2",
      "tool_3",
      "tool_4",
      "tool_5",
    ]);
    expect(spool.status().pending).toBe(0);
  });

  it("★degraded 중에 들어온 이벤트도 큐를 지나므로 앞 이벤트를 추월하지 않는다", async () => {
    const { spool, written, state, sched } = spoolWith();

    state.fail = true;
    spool.enqueue(evt(1)); // 실패해서 스풀에 남는다
    await spool.settled();

    // 이 시점에 sink 가 회복됐지만, 1번이 아직 밀려 있으므로 2번이 직행하면 안 된다.
    state.fail = false;
    spool.enqueue(evt(2));
    await spool.settled();

    expect(written.map((r) => r.event.toolName)).toEqual(["tool_1", "tool_2"]);
    void sched;
  });

  it("프로세스 재기동: 디스크 스풀을 복원해 순서를 보존한 채 재적재한다", async () => {
    // 1) 첫 프로세스 — 오프라인으로 3건을 디스크에 남긴다
    const first = spoolWith();
    first.state.fail = true;
    for (let i = 1; i <= 3; i++) first.spool.enqueue(evt(i));
    await first.spool.settled();

    const onDisk = JSON.parse(await fs.readFile(first.spool.spoolPath, "utf8"));
    expect(onDisk.records.map((r: SpoolRecord) => r.event.toolName)).toEqual([
      "tool_1",
      "tool_2",
      "tool_3",
    ]);

    // 2) 새 프로세스 — 복원 후 재적재. 새 이벤트는 복원분 뒤에 와야 한다.
    const second = spoolWith();
    const restored = await second.spool.restore();
    expect(restored).toBe(3);
    second.spool.enqueue(evt(4));
    await second.spool.settled();

    expect(second.written.map((r) => r.event.toolName)).toEqual([
      "tool_1",
      "tool_2",
      "tool_3",
      "tool_4",
    ]);
    // 큐가 비었으므로 스풀 파일도 정리된다
    await expect(fs.access(second.spool.spoolPath)).rejects.toThrow();
  });

  it("재적재는 발생 시각을 보존한다 — 재적재 시각으로 덮어쓰지 않는다", async () => {
    const { spool, written, state, sched } = spoolWith();
    state.fail = true;
    spool.enqueue(evt(1), 111_111);
    await spool.settled();

    state.fail = false;
    sched.fire();
    await spool.settled();

    expect(written[0].occurredAtMs).toBe(111_111);
  });

  it("손상된 스풀 파일은 삭제하지 않고 격리하며, 그 사실을 상태에 남긴다", async () => {
    const { spool } = spoolWith();
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(spool.spoolPath, "{ not json", "utf8");

    expect(await spool.restore()).toBe(0);
    // 증거를 버리지 않는다
    await expect(
      fs.access(`${spool.spoolPath}.corrupt`),
    ).resolves.toBeUndefined();
    const s = spool.status();
    expect(s.everDegraded).toBe(true);
    expect(s.lastError).toContain("손상");
  });
});

describe("★쓰기 실패가 관측 가능한 상태로 남는가", () => {
  it("실패 사유와 대기 건수가 상태에 드러난다", async () => {
    const { spool, state } = spoolWith();
    state.fail = true;
    state.reason = "PERMISSION_DENIED: missing or insufficient permissions";
    spool.enqueue(evt(1));
    await spool.settled();

    const s = spool.status();
    expect(s.degraded).toBe(true);
    expect(s.pending).toBe(1);
    expect(s.lastError).toContain("PERMISSION_DENIED");
    expect(s.failureCount).toBeGreaterThan(0);
    expect(s.lastErrorAtMs).not.toBeNull();
    expect(s.nextRetryAtMs).not.toBeNull();
  });

  it("★회복해도 '실패한 적이 있다'는 사실은 지워지지 않는다", async () => {
    const { spool, state, sched } = spoolWith();
    state.fail = true;
    spool.enqueue(evt(1));
    await spool.settled();

    state.fail = false;
    sched.fire();
    await spool.settled();

    const s = spool.status();
    expect(s.degraded).toBe(false); // 큐는 즉시 정상으로 돌아온다
    expect(s.pending).toBe(0);
    expect(s.everDegraded).toBe(true); // 그러나 흔적은 남는다
    expect(s.failureCount).toBeGreaterThan(0);
    expect(s.lastError).not.toBeNull();
    expect(formatSpoolStatus(s, 1_000_000)).toContain("회복됨");
  });

  it("degraded 이면 툴 결과에 붙일 경고가 생기고, 정상이면 null 이다", async () => {
    const { spool, state, sched } = spoolWith();
    expect(spoolNotice(spool.status())).toBeNull();

    state.fail = true;
    spool.enqueue(evt(1));
    await spool.settled();
    expect(spoolNotice(spool.status())).toContain("로컬 스풀에 대기");

    state.fail = false;
    sched.fire();
    await spool.settled();
    expect(spoolNotice(spool.status())).toBeNull();
  });
});

describe("★상한 초과 — 조용히 버리지 않는다 (§11)", () => {
  it("상한을 넘으면 오래된 것부터 버리되 알림이 발생한다", async () => {
    const notices: string[] = [];
    const { spool, state } = spoolWith({
      maxRecords: 3,
      onNotice: (n) => notices.push(n.kind),
    });
    state.fail = true;
    for (let i = 1; i <= 10; i++) spool.enqueue(evt(i));
    await spool.settled();

    expect(notices).toContain("overflow");
    const s = spool.status();
    expect(s.droppedCount).toBeGreaterThan(0);
    expect(s.droppedFromMs).not.toBeNull();
    expect(s.droppedToMs).not.toBeNull();
    // 콘솔로도 시끄럽게 알린다
    expect(console.error).toHaveBeenCalled();
  });

  it("★유실 구간이 tombstone 원장 이벤트로 남아 복구 시 실제로 적재된다", async () => {
    const { spool, written, state, sched } = spoolWith({ maxRecords: 3 });
    state.fail = true;
    for (let i = 1; i <= 8; i++) spool.enqueue(evt(i));
    await spool.settled();

    state.fail = false;
    sched.fire();
    await spool.settled();

    const tomb = written.find((r) => r.event.toolName === SPOOL_OVERFLOW_TOOL);
    expect(tomb, "유실 구간 tombstone 이 원장에 적재되어야 한다").toBeDefined();
    expect(tomb!.event.kind).toBe("lifecycle");
    expect(tomb!.event.success).toBe(false);
    const p = tomb!.event.params as Record<string, unknown>;
    expect(p.droppedCount).toBe(spool.status().droppedCount);
    expect(p.firstDroppedAtMs).not.toBeNull();
    // tombstone 이 살아남은 레코드보다 앞에 온다 = 유실 구간의 올바른 자리
    expect(written[0].event.toolName).toBe(SPOOL_OVERFLOW_TOOL);
  });

  it("연속 오버플로는 tombstone 을 쌓지 않고 하나로 병합한다", async () => {
    const { spool, written, state, sched } = spoolWith({ maxRecords: 2 });
    state.fail = true;
    for (let i = 1; i <= 20; i++) spool.enqueue(evt(i));
    await spool.settled();

    state.fail = false;
    sched.fire();
    await spool.settled();

    const tombs = written.filter(
      (r) => r.event.toolName === SPOOL_OVERFLOW_TOOL,
    );
    expect(tombs).toHaveLength(1);
    expect(
      (tombs[0].event.params as Record<string, unknown>).droppedCount,
    ).toBe(spool.status().droppedCount);
  });

  it("★tombstone 자체는 절대 버려지지 않는다 (유실 기록의 유실 금지)", async () => {
    // 상한을 1건으로 조여도 tombstone 은 남아야 한다
    const { spool, state } = spoolWith({ maxRecords: 1 });
    state.fail = true;
    for (let i = 1; i <= 30; i++) spool.enqueue(evt(i));
    await spool.settled();

    const s = spool.status();
    expect(s.droppedCount).toBeGreaterThan(0);
    expect(spoolNotice(s)).toContain("유실");
    expect(formatSpoolStatus(s, 1_000_000)).toContain("원장에 공백 있음");
  });

  it("바이트 상한으로도 걸리고, 큐가 상한 근처로 억제된다", async () => {
    const MAX = 2_000;
    const { spool, state } = spoolWith({ maxBytes: MAX, maxRecords: 10_000 });
    state.fail = true;
    for (let i = 1; i <= 200; i++) spool.enqueue(evt(i));
    await spool.settled();

    const s = spool.status();
    expect(s.droppedCount).toBeGreaterThan(0);
    // 건수 상한이 아니라 바이트 상한이 작동했음을 확인한다. tombstone 한 건이
    // 상한 위로 얹힐 수 있으므로(드롭 금지) 그만큼만 여유를 준다.
    expect(s.pending).toBeLessThan(200);
    expect(s.queuedBytes).toBeLessThanOrEqual(MAX * 2);
  });
});

describe("★쓰기 시간 상한 — 영원히 매달리는 쓰기를 실패로 관측한다", () => {
  it("제때 끝나면 통과한다", async () => {
    await expect(
      requireServerAck(async () => {}, 1_000),
    ).resolves.toBeUndefined();
  });

  it("★settle 하지 않는 쓰기를 시간 초과로 실패 판정한다", async () => {
    // Firestore 가 오프라인일 때의 실제 동작: resolve 도 reject 도 하지 않는다.
    await expect(
      requireServerAck(() => new Promise<void>(() => {}), 20),
    ).rejects.toThrow(/서버 ack 없음/);
  });

  it("쓰기가 명시적으로 reject 하면 그 사유가 그대로 올라온다", async () => {
    await expect(
      requireServerAck(async () => {
        throw new Error("PERMISSION_DENIED");
      }, 1_000),
    ).rejects.toThrow(/PERMISSION_DENIED/);
  });

  it("★매달리는 sink 는 스풀에 남고, 복구 후 재적재된다", async () => {
    const written: SpoolRecord[] = [];
    let online = false;
    const spool = new LedgerSpool({
      dir,
      agentId: AGENT,
      newId: (() => {
        let n = 0;
        return () => `id-${++n}`;
      })(),
      schedule: () => {},
      sink: async (rec) => {
        // 오프라인이면 영원히 매달리는 쓰기 — 상한이 없으면 여기서 배수가 멈춘다.
        await requireServerAck(
          () => (online ? Promise.resolve() : new Promise<void>(() => {})),
          20,
        );
        written.push(rec);
      },
    });

    spool.enqueue(evt(1));
    spool.enqueue(evt(2));
    await spool.settled();
    expect(written).toHaveLength(0);
    expect(spool.status().pending).toBe(2);
    expect(spool.status().lastError).toMatch(/서버 ack 없음/);
    // ★상한 덕분에 '실패했다'가 상태로 드러난다 — 매달린 채 침묵하지 않는다
    expect(spool.status().everDegraded).toBe(true);

    online = true;
    await spool.retryNow();
    expect(written.map((r) => r.event.toolName)).toEqual(["tool_1", "tool_2"]);
    expect(spool.status().pending).toBe(0);
  });
});

describe("경로 규약", () => {
  it("에이전트 id 의 경로 조각을 파일명에서 무력화한다", () => {
    expect(spoolFileName("../../etc/passwd")).not.toContain("/");
    expect(spoolFileName("../../etc/passwd")).not.toContain("..");
    expect(spoolFileName("")).toBe("unknown.spool.json");
    expect(spoolFileName("backend-1")).toBe("backend-1.spool.json");
  });

  it("기본 스풀 디렉터리는 ~/.marblo 하위이고 env 로 격리할 수 있다", () => {
    expect(defaultSpoolDir({}, "/home/t")).toBe("/home/t/.marblo/ledger-spool");
    expect(
      defaultSpoolDir({ MARBLO_LEDGER_SPOOL_DIR: "/tmp/x" }, "/home/t"),
    ).toBe("/tmp/x");
  });
});

// ═══════════════════════════════════════════════════════════════════
// L1.6 회귀 — 불변성 룰 vs 멱등 재시도
// ═══════════════════════════════════════════════════════════════════

/**
 * ack 만 유실된 쓰기를 재시도하면 같은 문서 id 로 setDoc 하게 되고, Firestore 는
 * 그걸 update 로 판정한다. `allow update: if false` 였을 때 이 재시도는 영원히
 * permission-denied 를 받았고 스풀이 그 레코드에서 고착했다(pending=1 영구).
 *
 * 아래 테스트들이 지키는 성질:
 *  1. 권한 거부는 **재시도 루프를 돌지 않는다** (고착 금지)
 *  2. 확인 결과 이미 원장에 있으면 **성공 처리**한다 (중복 문서 미생성)
 *  3. 확인 불가는 "없음"이 아니라 **미상**으로 남는다 (L2 read 조이기 대비)
 *  4. 한 건이 막혀도 **뒤따르는 이벤트는 계속 적재된다**
 *  5. 진짜 재시도 가능한 실패는 **여전히 재시도**한다 (회귀 방지의 반대편)
 */
describe("L1.6 — 터미널 실패(권한 거부)는 큐를 고착시키지 않는다", () => {
  /** permission-denied 를 흉내내는 FirebaseError 형태의 에러. */
  const denied = () =>
    Object.assign(new Error("PERMISSION_DENIED"), {
      code: "permission-denied",
    });
  const isTerminal = (e: unknown) =>
    (e as { code?: string })?.code === "permission-denied";

  it("★ack 유실 후 재시도: 확인 결과 이미 원장에 있으면 성공 처리하고 큐를 비운다", async () => {
    const verified: string[] = [];
    const { spool, sched } = spoolWith({
      // 첫 시도가 서버에 닿았지만 ack 이 유실된 상황 → 재시도는 update 로 거부된다.
      sink: async () => {
        throw denied();
      },
      isTerminal,
      verify: async (rec) => {
        verified.push(rec.id);
        return true; // 확인해 보니 이미 있다
      },
    });

    spool.enqueue(evt(1));
    await spool.settled();

    expect(verified).toEqual(["id-1"]);
    // 고착하지 않는다: 대기 0, 재시도 예약 0.
    expect(spool.status().pending).toBe(0);
    expect(sched.count).toBe(0);
    // 중복 문서를 만들지 않았다 — 성공 처리했을 뿐 다시 쓰지 않았다.
    expect(spool.status().ackRecoveredCount).toBe(1);
    expect(spool.status().unresolvedCount).toBe(0);
    // 실패가 있었다는 사실 자체는 지워지지 않는다.
    expect(spool.status().everDegraded).toBe(true);
  });

  it("★확인 결과 원장에 없으면 '확인된 유실'로 남긴다 — 성공으로 반올림하지 않는다", async () => {
    const { spool, sched } = spoolWith({
      sink: async () => {
        throw denied();
      },
      isTerminal,
      verify: async () => false,
    });

    spool.enqueue(evt(1));
    await spool.settled();

    const s = spool.status();
    expect(s.pending).toBe(0); // 고착 금지
    expect(sched.count).toBe(0); // 무한 재시도 금지
    expect(s.unresolvedCount).toBe(1);
    expect(s.unresolvedConfirmedMissing).toBe(1);
    expect(s.unresolvedUnknown).toBe(0);
    expect(s.ackRecoveredCount).toBe(0);
  });

  it("★확인 자체가 불가능하면(L2 read 조이기) '유실'이 아니라 '미상'으로 남긴다", async () => {
    const { spool } = spoolWith({
      sink: async () => {
        throw denied();
      },
      isTerminal,
      // L2 가 audit_logs read 를 isProjectMember() 로 조이면 이렇게 된다.
      verify: async () => {
        throw new Error("permission-denied on read");
      },
    });

    spool.enqueue(evt(1));
    await spool.settled();

    const s = spool.status();
    expect(s.unresolvedCount).toBe(1);
    // ★핵심: 확인 불가를 유실로 단정하지 않는다.
    expect(s.unresolvedConfirmedMissing).toBe(0);
    expect(s.unresolvedUnknown).toBe(1);
    expect(formatSpoolStatus(s, 1_000_000)).toContain("확인하지 못했습니다");
  });

  it("verify 를 아예 주지 않아도 고착하지 않는다 (미상으로 남긴다)", async () => {
    const { spool, sched } = spoolWith({
      sink: async () => {
        throw denied();
      },
      isTerminal,
    });

    spool.enqueue(evt(1));
    await spool.settled();

    expect(spool.status().pending).toBe(0);
    expect(sched.count).toBe(0);
    expect(spool.status().unresolvedUnknown).toBe(1);
  });

  it("★한 건이 거부돼도 뒤따르는 이벤트는 계속 원장에 들어간다", async () => {
    // 이게 회귀의 진짜 심각도였다: ack 하나 유실 → 그 뒤 모든 감사 이벤트 정지.
    const written: SpoolRecord[] = [];
    const { spool } = spoolWith({
      sink: async (rec) => {
        if (rec.event.toolName === "tool_1") throw denied();
        written.push(rec);
      },
      isTerminal,
      verify: async () => false,
    });

    spool.enqueue(evt(1));
    spool.enqueue(evt(2));
    spool.enqueue(evt(3));
    await spool.settled();

    // 2, 3 은 정상 적재됐다. 마커도 함께 적재된다(새 id 라 create 로 통과).
    expect(written.map((r) => r.event.toolName)).toContain("tool_2");
    expect(written.map((r) => r.event.toolName)).toContain("tool_3");
    expect(spool.status().pending).toBe(0);
    expect(spool.status().unresolvedCount).toBe(1);
  });

  it("★원장에 미해결 마커가 남는다 — 공백 사실이 로컬 상태에만 갇히지 않는다", async () => {
    const written: SpoolRecord[] = [];
    const { spool } = spoolWith({
      sink: async (rec) => {
        if (rec.event.toolName === "tool_1") throw denied();
        written.push(rec);
      },
      isTerminal,
      verify: async () => false,
    });

    spool.enqueue(evt(1));
    await spool.settled();

    const marker = written.find(
      (r) => r.event.toolName === "ledger:spool_unresolved",
    );
    expect(marker).toBeDefined();
    expect(marker!.event.kind).toBe("lifecycle");
    expect(marker!.event.success).toBe(false);
    expect(marker!.event.params).toMatchObject({
      unresolvedCount: 1,
      confirmedMissing: true,
    });
    // 귀속이 살아 있어야 한다 — 원장에서 agentId 는 핵심 필드다.
    expect(marker!.event.agentId).toBe(AGENT);
  });

  it("★재시도 가능한 실패는 여전히 재시도한다 (반대편 회귀 방지)", async () => {
    const { spool, state, written, sched } = spoolWith({ isTerminal });
    state.fail = true;

    spool.enqueue(evt(1));
    await spool.settled();

    // 네트워크 실패는 코드가 없으니 터미널이 아니다 → 큐에 남고 재시도가 걸린다.
    expect(spool.status().pending).toBe(1);
    expect(spool.status().unresolvedCount).toBe(0);
    expect(sched.count).toBe(1);

    state.fail = false;
    sched.fire();
    await spool.settled();

    expect(written.map((r) => r.event.toolName)).toEqual(["tool_1"]);
    expect(spool.status().pending).toBe(0);
  });

  it("미해결분은 재기동해도 큐로 되돌아오지 않는다 (같은 이유로 또 막히지 않게)", async () => {
    const { spool } = spoolWith({
      sink: async () => {
        throw denied();
      },
      isTerminal,
      verify: async () => false,
    });
    spool.enqueue(evt(1));
    await spool.settled();
    expect(spool.status().unresolvedCount).toBe(1);

    // 새 프로세스가 같은 스풀 파일을 읽는다.
    const { spool: next, written } = spoolWith({ agentId: AGENT });
    const restored = await next.restore();
    await next.settled();

    expect(restored).toBe(0); // 큐로 되돌리지 않는다
    expect(written).toEqual([]); // 재시도하지 않는다
    expect(next.status().unresolvedCount).toBe(1); // 증거는 남는다
    expect(next.status().everDegraded).toBe(true);
  });

  it("미해결분이 있으면 큐가 비어도 상태를 '정상'이라 답하지 않는다", async () => {
    const { spool } = spoolWith({
      sink: async () => {
        throw denied();
      },
      isTerminal,
      verify: async () => false,
    });
    spool.enqueue(evt(1));
    await spool.settled();

    const s = spool.status();
    expect(s.pending).toBe(0);
    // ★"대기 0건"만 보고 정상이라 읽히면 안 된다.
    expect(formatSpoolStatus(s, 1_000_000)).toContain("원장 미적재");
    expect(spoolNotice(s)).toContain("원장에 넣지 못했습니다");
  });
});
