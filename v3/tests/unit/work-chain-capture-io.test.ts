/**
 * 워크체인 자동 포착 — **I/O 경로** (티켓 lW9iiLGWlO0lVoy4khSM).
 *
 * 감지 규칙은 `work-chain-capture.test.ts` 가 못 박는다. 여기서 못 박는 것은
 * 감지 이후의 네 가지고, 전부 "기능이 조용히 죽는" 경로다.
 *
 *   ① ★**재현 시나리오**: 오케가 "A 가 끝나면 B" 를 말하면 `workChains/{projectId}`
 *      문서에 항목이 **실제로 들어간다.** 세션은 이 문서를 다시 읽을 뿐이므로,
 *      문서에 들어갔다는 것이 곧 "세션을 갈아도 남는다" 이다.
 *   ② **약속 없는 호출은 Firestore 를 건드리지도 않는다** — 소음 0의 근거.
 *      비용도 0이어야 오케가 이 훅을 끄고 싶어지지 않는다.
 *   ③ ★**쓰기 실패를 삼키지 않는다.** 지금 프로덕션은 workChains 규칙이 미배포라
 *      permission-denied 가 실제로 난다. 조용히 실패하면 오케는 "적혔다" 고 믿고
 *      지나가고, 그건 안 적은 것보다 나쁘다.
 *   ④ **merge_and_close 의 HOLD_REVIEW 는 무조건 적고, 멱등이다.**
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

// Firestore 를 얇게 가짜로 세운다. 트랜잭션은 "읽고 → 콜백 → 쓰기" 한 번이면
// 충분하다(동시성은 실제 SDK 의 책임이고 여기서 검증할 대상이 아니다).
interface FakeDocSnap {
  exists(): boolean;
  data(): Record<string, unknown> | undefined;
}

const store = new Map<string, Record<string, unknown>>();
let failWrites: string | null = null;
let getDocCalls = 0;

function keyOf(ref: { path: string }): string {
  return ref.path;
}

function snapFor(path: string): FakeDocSnap {
  const data = store.get(path);
  return { exists: () => data !== undefined, data: () => data };
}

vi.mock("firebase/firestore", () => ({
  doc: (_db: unknown, collection: string, id: string) => ({
    path: `${collection}/${id}`,
  }),
  getDoc: async (ref: { path: string }) => {
    getDocCalls++;
    return snapFor(keyOf(ref));
  },
  runTransaction: async (
    _db: unknown,
    fn: (txn: unknown) => Promise<unknown>,
  ) => {
    const txn = {
      get: async (ref: { path: string }) => snapFor(keyOf(ref)),
      set: (ref: { path: string }, data: Record<string, unknown>) => {
        if (failWrites) throw new Error(failWrites);
        store.set(keyOf(ref), data);
      },
      update: (ref: { path: string }, data: Record<string, unknown>) => {
        if (failWrites) throw new Error(failWrites);
        store.set(keyOf(ref), { ...store.get(keyOf(ref)), ...data });
      },
    };
    return fn(txn);
  },
  Timestamp: { now: () => ({ seconds: 0, nanoseconds: 0 }) },
}));

const {
  captureMergeHoldFollowUp,
  captureWorkChainPromises,
  readWorkChain,
} = await import("../../electron/mcp-server/work-chain");

const db = {} as never;
const PROJECT = "proj1";
const CHAIN = `workChains/${PROJECT}`;
const TASK_A = "aaaaaaaaaaaaaaaaaaaa";

function seedTask(id: string, status = "IN_PROGRESS"): void {
  store.set(`tasks/${id}`, { status, title: `티켓 ${id}` });
}

beforeEach(() => {
  store.clear();
  failWrites = null;
  getDocCalls = 0;
});

describe("① ★재현 시나리오 — 세션을 갈아도 B 가 체인에 남는다", () => {
  it("'A 가 끝나면 B 를 해야 한다' 를 말하면 workChains 문서에 항목이 들어간다", async () => {
    seedTask(TASK_A);
    const res = await captureWorkChainPromises(db, {
      projectId: PROJECT,
      by: "orchestrator-proj1",
      tool: "dispatch_task",
      surface: "dispatch_instruction",
      text:
        `보안 규칙 배포 티켓이다. 배포 스크립트를 돌려라.\n` +
        `이 티켓(${TASK_A})이 끝나면 Up Next 패널을 검증해야 한다.`,
      contextTaskId: TASK_A,
    });

    expect(res.written).toHaveLength(1);
    expect(res.error).toBeUndefined();

    // ★"세션을 갈아도 남는다" 의 실체 — 새 세션이 읽는 그 문서를 그대로 읽는다.
    const reread = await readWorkChain(db, PROJECT);
    expect(reread.items).toHaveLength(1);
    const [item] = reread.items;
    expect(item.what).toContain("Up Next 패널을 검증해야 한다");
    expect(item.source).toBe("auto");
    expect(item.sourceTool).toBe("dispatch_task");
    // 선행은 방금 디스패치한 티켓 — 문장의 "이거 끝나면" 의 '이거'.
    expect(item.afterTaskIds).toEqual([TASK_A]);
    // ★티켓은 붙이지 않는다. 붙이는 건 오케가 티켓을 만든 뒤의 일이고,
    //   그래야 완료 판정이 계속 보드 몫으로 남는다(§7 불변).
    expect(item.taskIds).toEqual([]);
  });

  it("보드에 없는 티켓 id 는 선행으로 걸지 않는다 — 영원한 waiting 방지", async () => {
    // TASK_A 를 seed 하지 않는다 = 보드에 없는 티켓.
    const res = await captureWorkChainPromises(db, {
      projectId: PROJECT,
      by: "orchestrator-proj1",
      tool: "dispatch_task",
      surface: "dispatch_instruction",
      text: `티켓 ${TASK_A} 이 끝나면 문서를 갱신해야 한다.`,
      contextTaskId: TASK_A,
    });
    expect(res.written).toHaveLength(1);
    const reread = await readWorkChain(db, PROJECT);
    expect(reread.items[0].afterTaskIds).toEqual([]);
  });

  it("이미 열려 있는 같은 약속은 다시 적지 않는다(중복 폭주 방지)", async () => {
    const input = {
      projectId: PROJECT,
      by: "orchestrator-proj1",
      tool: "escalate_to_owner",
      surface: "owner_report" as const,
      text: "규칙을 한 번 더 배포해야 합니다.",
    };
    await captureWorkChainPromises(db, input);
    const second = await captureWorkChainPromises(db, input);
    expect(second.written).toHaveLength(0);
    expect(second.skippedDuplicate).toBe(1);
    expect((await readWorkChain(db, PROJECT)).items).toHaveLength(1);
  });
});

describe("② 약속 없는 호출 — Firestore 를 건드리지도 않는다", () => {
  it("감지 0건이면 읽기조차 하지 않는다", async () => {
    const res = await captureWorkChainPromises(db, {
      projectId: PROJECT,
      by: "orchestrator-proj1",
      tool: "add_activity",
      surface: "activity",
      text: "구현 완료: 렌더러 경계에서 부트 출력을 가르는 필터를 추가했습니다.",
    });
    expect(res).toMatchObject({ note: "", written: [], detected: 0 });
    expect(getDocCalls).toBe(0);
    expect(store.has(CHAIN)).toBe(false);
  });

  it("워커 지시문의 명령형만 있는 호출도 조용하다", async () => {
    const res = await captureWorkChainPromises(db, {
      projectId: PROJECT,
      by: "orchestrator-proj1",
      tool: "dispatch_task",
      surface: "dispatch_instruction",
      text: "강제 방식 4개를 비교하고 하나를 골라라. 근거를 PR 에 남겨라.",
    });
    expect(res.note).toBe("");
    expect(getDocCalls).toBe(0);
  });
});

describe("③ ★쓰기 실패를 삼키지 않는다", () => {
  it("permission-denied 면 잡은 문장을 그대로 돌려주고 실패를 명시한다", async () => {
    failWrites = "PERMISSION_DENIED: Missing or insufficient permissions.";
    const res = await captureWorkChainPromises(db, {
      projectId: PROJECT,
      by: "orchestrator-proj1",
      tool: "escalate_to_owner",
      surface: "owner_report",
      text: "규칙을 한 번 더 배포해야 합니다.",
    });
    expect(res.written).toHaveLength(0);
    expect(res.error).toContain("PERMISSION_DENIED");
    expect(res.note).toContain("자동 기록 실패");
    // ★잡은 문장이 결과에 남아야 오케가 손으로라도 옮겨 적을 수 있다.
    expect(res.note).toContain("배포해야 합니다");
    expect(res.note).toContain("add_work_chain_item");
  });

  it("쓰기가 실패해도 예외를 던지지 않는다 — 원래 도구는 성공해야 한다", async () => {
    failWrites = "boom";
    await expect(
      captureWorkChainPromises(db, {
        projectId: PROJECT,
        by: "orchestrator-proj1",
        tool: "send_telegram_message",
        surface: "owner_report",
        text: "머지되면 후속 티켓 두 개를 열겠습니다.",
      }),
    ).resolves.toBeTruthy();
  });

  it("projectId 가 없으면 아무것도 하지 않는다", async () => {
    const res = await captureWorkChainPromises(db, {
      projectId: "",
      by: "orchestrator-proj1",
      tool: "add_activity",
      surface: "activity",
      text: "규칙을 한 번 더 배포해야 합니다.",
    });
    expect(res.detected).toBe(0);
    expect(getDocCalls).toBe(0);
  });
});

describe("④ merge_and_close HOLD_REVIEW — 무조건, 그리고 멱등", () => {
  const hold = {
    projectId: PROJECT,
    by: "orchestrator-proj1",
    taskId: TASK_A,
    taskTitle: "마케팅 연락처 백필",
    signals: ["미실행"],
    reason: "PR 는 머지됐지만 후속 작업이 남아 있어 DONE 으로 넘기지 않는다",
  };

  it("텍스트 감지 없이 항목이 생기고, 완료 판정은 보드가 한다", async () => {
    const res = await captureMergeHoldFollowUp(db, hold);
    expect(res.written).toHaveLength(1);
    const [item] = (await readWorkChain(db, PROJECT)).items;
    expect(item.what).toBe("후속 마무리: 마케팅 연락처 백필");
    // ★티켓을 물고 있으므로 오케 자기보고로는 닫을 수 없다 — 티켓이 DONE 이
    //   돼야 항목이 닫힌다(rejectSelfReportReason 이 걸어 놓은 규율 그대로).
    expect(item.taskIds).toEqual([TASK_A]);
    expect(item.doneWhen).toBe("done");
    expect(item.source).toBe("auto");
    expect(item.why).toContain("미실행");
  });

  it("두 번 호출해도 항목은 하나 — merge_and_close 재호출은 흔하다", async () => {
    await captureMergeHoldFollowUp(db, hold);
    const second = await captureMergeHoldFollowUp(db, hold);
    expect(second.written).toHaveLength(0);
    expect(second.skippedDuplicate).toBe(1);
    expect((await readWorkChain(db, PROJECT)).items).toHaveLength(1);
  });

  it("쓰기 실패는 여기서도 문장으로 드러난다", async () => {
    failWrites = "PERMISSION_DENIED";
    const res = await captureMergeHoldFollowUp(db, hold);
    expect(res.error).toContain("PERMISSION_DENIED");
    expect(res.note).toContain("후속 마무리: 마케팅 연락처 백필");
    expect(res.note).toContain(TASK_A);
  });
});
