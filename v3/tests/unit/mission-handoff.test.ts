/**
 * 티켓 F2TAJlSgSP8Ag1qJNkp1 — 폐루프의 **마지막 계층**:
 * ① 미션을 태스크로 쪼개기 ② 미션 완료 → 다음 미션.
 *
 * 사장님 지시(2026-09-04):
 *   _"오케브레인 미션을 하나씩 끝내면서 다음 미션으로 넘어가는 형태로 …
 *   이 루프에서 우리 유세이지탭에 사용량 토큰 잔여량을 체크하면서 스폰을
 *   진행하고, 텔레로 다음 미션의 시작은 사용자에게 물어보고 가능 형태로"_
 * 그리고 **"한번에 켜줘"**.
 *
 * ★사장님 지시(2026-09-06, 텔레그램, 티켓 Ps490B7n6CvdHQmIXRfu) — 위 질문에
 * 대한 답: _"토큰 주간 잔여량이 얼마 없으면 물어보고 진행하는걸로?"_ 뒤집으면
 * **넉넉하면 묻지 않고 진행 + 채널 보고**, **적을 때만 묻는다**는 뜻이다.
 *
 * 그래서 이 스위트가 고정하는 것은 다섯이다:
 *   ① 근거 티켓 없는 사장님 지시가 분해 대상으로 잡히고, 붙은 건 안 잡힌다
 *   ② 다음 후보가 **선택 순서대로** 골라진다(순서가 암시적이면 사장님이 예측 못 한다)
 *   ③ ★토큰이 넉넉하면(sufficient) 승인 없이 진행하고 채널에 보고한다(PROCEED)
 *   ④ ★토큰이 부족하면(insufficient) 스폰하지 않고 알리고, **못 읽었으면
 *      (no-data) 안전 측으로 여전히 여쭙는다** — no-data 가 PROCEED 로 새면
 *      사장님 지시의 정반대로 실패한다
 * 그리고 ⑤ **플래그가 하나다**(동작 축 + 소스 축).
 *
 * 설계: v3/docs/mission-layer-advance-design-2026-09-04.md.
 */
import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";
import {
  ADVANCE_SIGNAL_ENV,
  emptyAdvanceState,
  evaluateTokenBudgetGate,
  isAdvanceSignalEnabled,
  type AdvanceStateSnapshot,
  type HarnessQuotaReading,
} from "../../electron/mcp-server/advance-guards";
import {
  chainItemNeedsApproval,
  countBlockedBy,
  evaluateMissionHandoff,
  isOwnerDirective,
  isStarted,
  lacksBackingTask,
  OWNER_CHOICE_LIMIT,
  selectHandoffCandidates,
  selectSplitTargets,
  toHandoffChainItem,
  type HandoffChainItem,
  type HandoffInput,
} from "../../electron/mcp-server/mission-handoff";
import { evaluateMissionAdvance } from "../../electron/mcp-server/mission-advance";
import {
  deriveWorkChain,
  type WorkChainItem,
} from "../../electron/mcp-server/work-chain-core";

// ── 픽스처 ──────────────────────────────────────────────────────────────────

const item = (over: Partial<HandoffChainItem> = {}): HandoffChainItem => ({
  id: "i1",
  what: "무언가를 한다",
  why: "필요하니까",
  source: "owner",
  state: "ready",
  evidenceTaskIds: [],
  ...over,
});

/** 잔여가 넉넉한 하네스 한 줄(예비선 10 기준) — 이제 이 기본값은 PROCEED 로 떨어진다. */
const roomy: HarnessQuotaReading[] = [
  { harness: "claude", remainingPercent: 62, source: "account-probe" },
  { harness: "gpt", remainingPercent: 41, source: "account-probe" },
];

/**
 * ★잔여를 아예 못 읽은 하네스 한 줄(no-data). 사장님 지시(2026-09-06, 티켓
 * Ps490B7n6CvdHQmIXRfu) 이후에도 이 경우만은 자동 진행하지 않고 여쭙는다 —
 * "모름"을 "넉넉함"으로 접으면 안 되기 때문이다(advance-guards.ts 참고).
 */
const unknownQuota: HarnessQuotaReading[] = [
  { harness: "claude", remainingPercent: null },
];

const handoff = (over: Partial<HandoffInput> = {}) =>
  evaluateMissionHandoff({
    closedMissionId: "m-closed",
    closedMissionLabel: "방금 끝난 묶음",
    finishedTaskId: "t-last",
    chain: [item()],
    alreadyAsked: false,
    state: emptyAdvanceState(),
    ownerInputPending: false,
    quota: roomy,
    reservePct: 10,
    enabled: true,
    ...over,
  });

const state = (
  over: Partial<AdvanceStateSnapshot> = {},
): AdvanceStateSnapshot => ({ ...emptyAdvanceState(), ...over });

// ── ① 미션 쪼개기 ───────────────────────────────────────────────────────────

describe("① 분해 대상 — 근거 티켓이 안 붙은 사장님 지시", () => {
  it("사장님 지시인데 티켓이 0건이면 분해 대상으로 잡힌다", () => {
    const v = handoff({
      chain: [item({ id: "owner-unsplit", evidenceTaskIds: [] })],
    });
    expect(v.splitTargets.map((c) => c.item.id)).toEqual(["owner-unsplit"]);
    expect(v.next?.need).toBe("split");
  });

  it("★이미 티켓이 붙은 사장님 지시는 안 잡힌다 — 건드리지 마라", () => {
    const v = handoff({
      chain: [item({ id: "owner-split", evidenceTaskIds: ["t1", "t2"] })],
    });
    expect(v.splitTargets).toEqual([]);
    expect(v.next?.need).toBe("dispatch");
  });

  it("라벨만 걸고 티켓 0개(unsplit)도 분해 대상이다", () => {
    const v = handoff({
      chain: [
        item({ id: "labeled", missionLabel: "어떤 라벨", evidenceTaskIds: [] }),
      ],
    });
    expect(v.splitTargets.map((c) => c.item.id)).toEqual(["labeled"]);
  });

  it("★manual / auto 항목은 분해 대상이 아니다 — owner 축만 권한이 다르다", () => {
    const v = handoff({
      chain: [
        item({ id: "a", source: "auto" }),
        item({ id: "m", source: "manual" }),
        item({ id: "legacy", source: null }),
      ],
    });
    expect(v.splitTargets).toEqual([]);
    expect(isOwnerDirective(item({ source: "auto" }))).toBe(false);
    expect(isOwnerDirective(item({ source: "owner" }))).toBe(true);
  });

  it("닫힌·버려진 항목은 애초에 대상이 아니다", () => {
    const v = handoff({
      chain: [
        item({ id: "done", state: "done" }),
        item({ id: "dropped", state: "dropped" }),
      ],
    });
    expect(v.splitTargets).toEqual([]);
    expect(v.candidates).toEqual([]);
    expect(v.code).toBe("chain-exhausted");
  });

  it("판정 축은 evidenceTaskIds 하나다 — 새 개념을 만들지 않았다", () => {
    expect(lacksBackingTask(item({ evidenceTaskIds: [] }))).toBe(true);
    expect(lacksBackingTask(item({ evidenceTaskIds: ["t1"] }))).toBe(false);
  });

  it("★deriveWorkChain 의 실제 파생과 어댑터가 맞물린다(축이 갈리지 않는다)", () => {
    const raw: WorkChainItem[] = [
      {
        id: "owner-1",
        what: "사장님 지시 — 아직 티켓 없음",
        why: "지시",
        afterTaskIds: [],
        afterItemIds: [],
        taskIds: [],
        doneWhen: "done",
        source: "owner",
        createdAt: 1,
        updatedAt: 1,
        createdBy: "orchestrator",
      },
      {
        id: "owner-2",
        what: "사장님 지시 — 티켓 붙음",
        why: "지시",
        afterTaskIds: [],
        afterItemIds: [],
        taskIds: ["t-open"],
        doneWhen: "done",
        source: "owner",
        createdAt: 2,
        updatedAt: 2,
        createdBy: "orchestrator",
      },
    ];
    const derived = deriveWorkChain(raw, { "t-open": "TODO" });
    const v = handoff({ chain: derived.items.map(toHandoffChainItem) });
    expect(v.splitTargets.map((c) => c.item.id)).toEqual(["owner-1"]);
    expect(v.candidates.map((c) => c.need)).toEqual(["split", "dispatch"]);
  });
});

// ── ② 선택 순서 ─────────────────────────────────────────────────────────────

describe("② 미션 간 전진 — 선택 순서는 명시적 두 키", () => {
  it("★사장님 지시가 먼저, 그다음이 체인 배열 순서(=우선순위)", () => {
    const v = handoff({
      chain: [
        item({ id: "auto-first", source: "auto" }),
        item({ id: "manual-second", source: "manual" }),
        item({ id: "owner-third", source: "owner" }),
        item({ id: "owner-fourth", source: "owner" }),
      ],
    });
    expect(v.candidates.map((c) => c.item.id)).toEqual([
      "owner-third",
      "owner-fourth",
      "auto-first",
      "manual-second",
    ]);
    expect(v.next?.item.id).toBe("owner-third");
    expect(v.next?.rank).toBe(1);
    expect(v.next?.rankReason).toContain("사장님 지시");
  });

  it("사장님 지시가 없으면 순전히 배열 순서다", () => {
    const v = handoff({
      chain: [
        item({ id: "a", source: "auto" }),
        item({ id: "b", source: "manual" }),
        item({ id: "c", source: "auto" }),
      ],
    });
    expect(v.candidates.map((c) => c.item.id)).toEqual(["a", "b", "c"]);
  });

  it("★결정적이다 — 같은 입력이면 항상 같은 답(동률 없음)", () => {
    const chain = [
      item({ id: "x", source: "auto" }),
      item({ id: "y", source: "owner" }),
      item({ id: "z", source: "owner" }),
    ];
    const a = selectHandoffCandidates(chain).candidates.map((c) => c.item.id);
    const b = selectHandoffCandidates(chain).candidates.map((c) => c.item.id);
    const c = selectHandoffCandidates([...chain]).candidates.map(
      (x) => x.item.id,
    );
    expect(a).toEqual(["y", "z", "x"]);
    expect(b).toEqual(a);
    expect(c).toEqual(a);
  });

  it("선행 미충족(waiting)은 후보가 아니다 — 다만 조용히 빼지 않는다", () => {
    const v = handoff({
      chain: [
        item({
          id: "waiting",
          state: "waiting",
          pendingTaskIds: ["t-before"],
        }),
        item({ id: "ready", state: "ready" }),
      ],
    });
    expect(v.candidates.map((c) => c.item.id)).toEqual(["ready"]);
    expect(v.blocked.map((i) => i.id)).toEqual(["waiting"]);
    expect(v.orchestratorMessage).toContain("선행 미충족으로 후보에서 제외");
    expect(v.orchestratorMessage).toContain("t-before");
  });

  it("★승인 필요 작업(배포·메일·결제·심사화면)은 자율 후보가 아니다", () => {
    const v = handoff({
      chain: [
        item({ id: "deploy", what: "프로덕션에 배포한다" }),
        item({ id: "mail", what: "베타 안내 메일 발송" }),
        item({ id: "pay", what: "결제 연동 마무리" }),
        item({ id: "safe", what: "차트 라벨 정렬 고치기" }),
      ],
    });
    expect(v.candidates.map((c) => c.item.id)).toEqual(["safe"]);
    expect(v.needsOwnerApproval.map((i) => i.id)).toEqual([
      "deploy",
      "mail",
      "pay",
    ]);
    expect(v.orchestratorMessage).toContain("사장님 승인 필요");
  });

  it("부정어는 승인 필요로 오탐하지 않는다(#1414 의 부정어 창을 그대로 씀)", () => {
    expect(chainItemNeedsApproval(item({ what: "리팩터만 — 배포 없음" }))).toBe(
      false,
    );
    expect(chainItemNeedsApproval(item({ what: "프로덕션 배포" }))).toBe(true);
  });

  it("후보가 하나도 없으면 그 사실을 보고한다(조용히 끝내지 않는다)", () => {
    const v = handoff({ chain: [] });
    expect(v.code).toBe("chain-exhausted");
    expect(v.reason).not.toBe("");
    expect(v.orchestratorMessage).toContain("오케브레인이 비었습니다");
  });

  it("분해 대상은 후보 집합의 부분집합이다(같은 규칙 하나)", () => {
    const chain = [
      item({ id: "o1", source: "owner", evidenceTaskIds: [] }),
      item({ id: "o2", source: "owner", evidenceTaskIds: ["t"] }),
      item({ id: "a1", source: "auto", evidenceTaskIds: [] }),
    ];
    const { candidates } = selectHandoffCandidates(chain);
    expect(selectSplitTargets(candidates).map((c) => c.item.id)).toEqual([
      "o1",
    ]);
  });
});

// ── ②-b ★우선순위 진리표 (티켓 hKdbFBcRKsWZThQc8C4p) ───────────────────────
//
// 선택 순서는 **사전식 4키**다. 계수가 없으므로 고정할 것은 "무엇이 무엇을
// 이기는가" 하나뿐이고, 그건 표로 전부 적을 수 있다. 각 케이스는 **한 축만
// 다르게** 세워 그 축이 실제로 발화하는지 본다 — 축을 지우면 이 표가 깨진다.

/** 우선순위만 보는 얇은 헬퍼 — 게이트/신호와 무관하게 순서만 읽는다. */
const order = (chain: readonly HandoffChainItem[]): string[] =>
  selectHandoffCandidates(chain).candidates.map((c) => c.item.id);

describe("②-b ★우선순위 진리표 — 사전식 4키(K1 owner > K2 막는 수 > K3 착수 > K4 배열)", () => {
  it("K2 는 K4 를 이긴다 — 배열 뒤라도 '3건을 막고 있는' 항목이 먼저다", () => {
    // leaf 는 아무것도 막지 않고, bottleneck 은 셋을 막는다. 배열은 leaf 가 앞.
    expect(
      order([
        item({ id: "leaf", source: "auto" }),
        item({ id: "bottleneck", source: "auto" }),
        item({
          id: "w1",
          source: "auto",
          state: "waiting",
          pendingItemIds: ["bottleneck"],
        }),
        item({
          id: "w2",
          source: "auto",
          state: "waiting",
          pendingItemIds: ["bottleneck"],
        }),
        item({
          id: "w3",
          source: "auto",
          state: "waiting",
          pendingItemIds: ["bottleneck"],
        }),
      ]),
    ).toEqual(["bottleneck", "leaf"]);
  });

  it("★K1 은 K2 를 이긴다 — 아무것도 안 막는 사장님 지시가 병목보다 먼저", () => {
    // 권한 축이 처리량 축 위에 있다. 이 줄이 뒤집히면 설계가 바뀐 것이다.
    expect(
      order([
        item({ id: "bottleneck", source: "auto" }),
        item({ id: "owner-leaf", source: "owner" }),
        item({
          id: "w1",
          source: "auto",
          state: "waiting",
          pendingItemIds: ["bottleneck"],
        }),
        item({
          id: "w2",
          source: "auto",
          state: "waiting",
          pendingItemIds: ["bottleneck"],
        }),
      ]),
    ).toEqual(["owner-leaf", "bottleneck"]);
  });

  it("K3 은 K4 를 이긴다 — 배열 뒤라도 '이미 착수된' 미션이 먼저다", () => {
    expect(
      order([
        item({
          id: "fresh",
          source: "auto",
          evidenceTaskIds: ["t1", "t2"],
          reachedCount: 0,
          totalCount: 2,
        }),
        item({
          id: "started",
          source: "auto",
          evidenceTaskIds: ["t3", "t4"],
          reachedCount: 1,
          totalCount: 2,
        }),
      ]),
    ).toEqual(["started", "fresh"]);
  });

  it("K2 는 K3 을 이긴다 — 착수 전이라도 막고 있으면 먼저다", () => {
    expect(
      order([
        item({
          id: "started",
          source: "auto",
          evidenceTaskIds: ["t1"],
          reachedCount: 1,
          totalCount: 1,
        }),
        item({
          id: "blocker",
          source: "auto",
          evidenceTaskIds: ["t2"],
          reachedCount: 0,
          totalCount: 1,
        }),
        item({
          id: "w1",
          source: "auto",
          state: "waiting",
          pendingItemIds: ["blocker"],
        }),
      ]),
    ).toEqual(["blocker", "started"]);
  });

  it("K4 는 최종 tie-break — 네 축이 전부 같으면 배열 순서다(동률 없음)", () => {
    expect(
      order([
        item({ id: "a", source: "auto" }),
        item({ id: "b", source: "auto" }),
        item({ id: "c", source: "auto" }),
      ]),
    ).toEqual(["a", "b", "c"]);
  });

  it("★막는 수는 체인 전체에서 센다 — 닫힌 항목은 세지 않고, 승인 필요는 센다", () => {
    const chain = [
      item({ id: "x", source: "auto" }),
      // 닫힌 항목이 x 를 기다린다고 적혀 있어도 그건 막힌 게 아니다.
      item({ id: "done", state: "done", pendingItemIds: ["x"] }),
      item({ id: "dropped", state: "dropped", pendingItemIds: ["x"] }),
      // 승인 필요 항목은 자율 후보가 아닐 뿐, 막혀 있다는 사실은 그대로다.
      item({
        id: "deploy",
        what: "프로덕션에 배포한다",
        state: "waiting",
        pendingItemIds: ["x"],
      }),
    ];
    expect(countBlockedBy(chain, "x")).toBe(1);
    // 자기 자신은 안 센다.
    expect(
      countBlockedBy([item({ id: "x", pendingItemIds: ["x"] })], "x"),
    ).toBe(0);
  });

  it("착수 판정 축은 reachedCount 하나다 — 티켓이 붙었다고 착수가 아니다", () => {
    expect(
      isStarted(item({ evidenceTaskIds: ["t1", "t2"], reachedCount: 0 })),
    ).toBe(false);
    expect(
      isStarted(item({ evidenceTaskIds: ["t1", "t2"], reachedCount: 1 })),
    ).toBe(true);
    // 구버전 호출자(필드 없음) 는 "착수 근거 없음" 으로 떨어진다 — 순서가 흔들리지 않는다.
    expect(isStarted(item({ evidenceTaskIds: ["t1"] }))).toBe(false);
  });

  it("★순위 근거는 실제로 발화한 축을 적는다 — 고정 문구가 아니다", () => {
    const { candidates } = selectHandoffCandidates([
      item({
        id: "top",
        source: "auto",
        evidenceTaskIds: ["t1", "t2"],
        reachedCount: 1,
        totalCount: 2,
      }),
      item({
        id: "w1",
        source: "auto",
        state: "waiting",
        pendingItemIds: ["top"],
      }),
      item({
        id: "w2",
        source: "auto",
        state: "waiting",
        pendingItemIds: ["top"],
      }),
    ]);
    const top = candidates[0];
    expect(top.item.id).toBe("top");
    expect(top.facts).toEqual({
      owner: false,
      blocking: 2,
      reached: 1,
      total: 2,
      index: 0,
    });
    expect(top.rankReason).toContain("다른 항목 2건이 이걸 기다린다");
    expect(top.rankReason).toContain("이미 착수(티켓 1/2 완료)");
  });

  it("★파생 구조와 축이 갈리지 않는다 — deriveWorkChain 의 실제 값으로 정렬된다", () => {
    const base = {
      why: "지시",
      afterTaskIds: [] as string[],
      afterItemIds: [] as string[],
      doneWhen: "done" as const,
      source: "auto" as const,
      createdAt: 1,
      updatedAt: 1,
      createdBy: "orchestrator",
    };
    const raw: WorkChainItem[] = [
      // 배열 앞이지만 착수 전.
      {
        ...base,
        id: "fresh",
        what: "아직 아무것도 안 됨",
        taskIds: ["t-a", "t-b"],
        missionLabel: undefined,
      },
      // 배열 뒤이지만 티켓 하나가 이미 DONE = 착수됨.
      { ...base, id: "started", what: "반쯤 됐음", taskIds: ["t-c", "t-d"] },
    ];
    const derived = deriveWorkChain(raw, {
      "t-a": "TODO",
      "t-b": "TODO",
      "t-c": "DONE",
      "t-d": "TODO",
    });
    const v = handoff({ chain: derived.items.map(toHandoffChainItem) });
    expect(v.candidates.map((c) => c.item.id)).toEqual(["started", "fresh"]);
    expect(v.candidates[0].facts.reached).toBe(1);
  });
});

// ── ②-c ★제안은 하나가 아니라 상위 몇 개다(여쭙는 경로 = no-data) ──────────
//
// ★토큰이 넉넉하면 더 이상 여쭙지 않고 진행한다(PROCEED, 아래 ③). "고르실 수
// 있는 선택지를 늘어놓는다" 는 성질은 이제 **여쭙는 경로에만** 남는다 — 그
// 경로는 no-data(잔여를 못 읽음) 뿐이므로 이 describe 는 quota 를 명시적으로
// unknownQuota 로 고정한다.

describe("②-c ★기계가 하나를 지명하지 않는다 — 사장님이 고르실 수 있어야 한다(no-data 경로)", () => {
  const many = (n: number): HandoffChainItem[] =>
    Array.from({ length: n }, (_, i) =>
      item({ id: `c${i}`, source: "auto", what: `후보 ${i}` }),
    );

  it("상위 후보가 각각 근거와 함께 실린다 — 1순위만 실리지 않는다", () => {
    const v = handoff({ chain: many(3), quota: unknownQuota });
    expect(v.action).toBe("ASK_OWNER");
    for (const rank of ["1순위", "2순위", "3순위"]) {
      expect(v.telegramMessage).toContain(rank);
    }
    for (const what of ["후보 0", "후보 1", "후보 2"]) {
      expect(v.telegramMessage).toContain(what);
    }
    // 고르실 수 있는 문장이어야 한다 — 통보가 아니다.
    expect(v.telegramMessage).toContain("어느 것부터 할까요?");
  });

  it("★잘라낸 나머지는 개수로 정직하게 밝힌다 — 조용히 자르지 않는다", () => {
    const v = handoff({
      chain: many(OWNER_CHOICE_LIMIT + 2),
      quota: unknownQuota,
    });
    expect(v.candidates).toHaveLength(OWNER_CHOICE_LIMIT + 2);
    expect(v.telegramMessage).toContain(
      `후보 ${OWNER_CHOICE_LIMIT + 2}건 중 상위 ${OWNER_CHOICE_LIMIT}건`,
    );
    expect(v.telegramMessage).toContain("그 밖에 후보 2건이 더 있습니다");
    // 전체 목록은 오케 신호에 그대로 남는다(옮겨 담았지 버리지 않았다).
    for (let i = 0; i < OWNER_CHOICE_LIMIT + 2; i += 1) {
      expect(v.orchestratorMessage).toContain(`후보 ${i}`);
    }
  });

  it("후보가 하나뿐이면 하나만 싣되 '상위 1건' 이라고 정직하게 적는다", () => {
    const v = handoff({ chain: many(1), quota: unknownQuota });
    expect(v.telegramMessage).toContain("후보 1건 중 상위 1건");
    expect(v.telegramMessage).not.toContain("그 밖에 후보");
  });

  it("★그래도 시작하라는 말은 어디에도 없다 — 제안은 제안이지 실행이 아니다", () => {
    const v = handoff({ chain: many(4), quota: unknownQuota });
    expect(v.telegramMessage).toContain(
      "승인해 주시기 전까지는 아무것도 스폰하지 않고",
    );
    expect(v.orchestratorMessage).toContain("사장님 승인 전에는 시작하지 마라");
  });
});

// ── ②-d ★남은 미션이 0개일 때의 문구 ───────────────────────────────────────

describe("②-d ★후보 0건 — 두 경우를 섞지 않는다", () => {
  it("체인이 완전히 비면 '오케브레인이 비었습니다' 가 사장님께 간다(침묵보다 낫다)", () => {
    const v = handoff({ chain: [] });
    expect(v.action).toBe("NOTIFY_OWNER");
    expect(v.code).toBe("chain-exhausted");
    expect(v.telegramMessage).toContain("오케브레인이 비었습니다");
    expect(v.telegramMessage).toContain("남은 미션이 0건입니다");
    // ★보고지 질문이 아니다 — 승인받을 것이 없으므로 여쭙지 않는다.
    expect(v.telegramMessage).not.toContain("어느 것부터 할까요?");
    expect(v.telegramMessage).toContain("아무것도 스폰하지 않았고");
  });

  it("★대기·승인필요가 남아 있으면 '비었다' 고 말하지 않는다 — 거짓말이 된다", () => {
    const v = handoff({
      chain: [
        item({
          id: "w",
          source: "auto",
          state: "waiting",
          pendingTaskIds: ["t-x"],
        }),
        item({ id: "deploy", what: "프로덕션에 배포한다" }),
      ],
    });
    expect(v.candidates).toEqual([]);
    expect(v.code).toBe("chain-exhausted");
    // 사장님을 깨우지 않는다 — 새 미션을 주실 일이 아니라 막힘을 푸는 일이다.
    expect(v.action).toBe("NO_HANDOFF");
    expect(v.telegramMessage).toBe("");
    expect(v.orchestratorMessage).toContain("오케브레인이 빈 것은 아니다");
    expect(v.orchestratorMessage).toContain("선행 대기 1건");
    expect(v.orchestratorMessage).toContain("승인 필요 1건");
    expect(v.orchestratorMessage).not.toContain("오케브레인이 비었습니다");
  });
});

// ── ③ ★토큰이 넉넉하면 승인 없이 진행한다(PROCEED) ─────────────────────────
//
// 사장님 지시(2026-09-06): "잔여가 적으면 물어보고 진행" — 뒤집으면 넉넉할
// 때는 묻지 않고 진행한다. 기본 픽스처(`roomy`)가 바로 그 sufficient 케이스다.

describe("③ ★토큰이 넉넉하면(sufficient) 승인 없이 진행하고 채널에 보고한다", () => {
  it("질문 대신 보고가 나가고, 오케에는 '지금 진행하라' 가 담긴다", () => {
    const v = handoff();
    expect(v.action).toBe("PROCEED");
    expect(v.code).toBe("auto-proceed");
    expect(v.telegramMessage).not.toBe("");
    // ★질문형 문구가 없다 — 이미 진행했으므로 고르시라고 묻지 않는다.
    expect(v.telegramMessage).not.toContain("어느 것부터 할까요?");
    expect(v.telegramMessage).not.toContain("답장해 주시면");
    // 오케에게 나가는 문장은 "진행하라" 여야 한다 — 예전 STOP_LINE 의 반대.
    expect(v.orchestratorMessage).toContain("진행한다");
    expect(v.orchestratorMessage).not.toContain(
      "사장님 승인 전에는 시작하지 마라",
    );
  });

  it("★보고에 네 가지가 반드시 들어간다 — 무엇이 닫혔나·무엇을 시작했나·왜·토큰 잔여", () => {
    const v = handoff({
      closedMissionLabel: "베타 온보딩 정리",
      chain: [
        item({
          id: "next",
          source: "owner",
          what: "다음 할 일",
          why: "급하니까",
        }),
      ],
    });
    expect(v.action).toBe("PROCEED");
    expect(v.telegramMessage).toContain("베타 온보딩 정리"); // 무엇이 닫혔나
    expect(v.telegramMessage).toContain("다음 할 일"); // 무엇을 시작했나
    expect(v.telegramMessage).toContain("사장님 지시(source=owner)"); // 왜(순위 근거)
    expect(v.telegramMessage).toContain("토큰 잔여"); // 토큰 잔여
  });

  it("★후보가 여럿이면 나머지 개수를 정직하게 밝힌다(조용히 자르지 않는다)", () => {
    const v = handoff({
      chain: [
        item({ id: "a", source: "auto", what: "첫 번째" }),
        item({ id: "b", source: "auto", what: "두 번째" }),
        item({ id: "c", source: "auto", what: "세 번째" }),
      ],
    });
    expect(v.action).toBe("PROCEED");
    expect(v.telegramMessage).toContain("첫 번째");
    expect(v.telegramMessage).toContain("그 밖에 후보 2건이 더 있습니다");
  });

  it("★같은 완료가 두 번 들어와도 진행/보고는 한 번", () => {
    const v = handoff({ alreadyAsked: true });
    expect(v.action).toBe("NO_HANDOFF");
    expect(v.code).toBe("already-asked");
    expect(v.telegramMessage).toBe("");
  });

  it("★#1414 한도에 걸리면 진행하지 않는다 — 새 한도를 만들지 않았다", () => {
    const halted = handoff({ state: state({ haltReason: "이전 사유" }) });
    expect(halted.action).toBe("HALT");
    expect(halted.telegramMessage).toBe("");
    expect(halted.haltReason).toContain("이전 사유");

    const capped = handoff({ state: state({ consecutiveSignals: 5 }) });
    expect(capped.action).toBe("HALT");
    expect(capped.code).toBe("consecutive-spawn-cap");
    expect(capped.telegramMessage).toBe("");
  });

  it("★사장님이 이미 말씀 중이면 진행하지 않는다(hold, 상태 불변)", () => {
    const v = handoff({ ownerInputPending: true });
    expect(v.action).toBe("HOLD");
    expect(v.code).toBe("owner-input-pending");
    expect(v.telegramMessage).toBe("");
    expect(v.reason).not.toBe("");
  });
});

// ── ③-b ★토큰을 못 읽었으면(no-data) 넉넉해도 진행하지 않는다 ─────────────
//
// ★이게 이 티켓의 핵심 안전장치다. `evaluateTokenBudgetGate` 의 `no-data` 는
// `allowSpawn:true` 를 주지만, 자동 진행 판정은 그 필드를 보지 않고 `code`
// 로만 분기한다 — `no-data` 는 `insufficient` 와 마찬가지로 절대 PROCEED 로
// 새지 않는다. 새면 사장님 지시("잔여가 적으면 물어보고 진행")의 정반대다.

describe("③-b ★토큰 잔여를 못 읽었으면(no-data) 여전히 여쭙고 멈춘다", () => {
  it("질문이 텔레그램으로 나가고 거기서 멈춘다 — 스폰 지시가 없다", () => {
    const v = handoff({ quota: unknownQuota });
    expect(v.action).toBe("ASK_OWNER");
    expect(v.tokenGate?.code).toBe("no-data");
    expect(v.telegramMessage).not.toBe("");
    // ★"이거 시작할까요?"(예/아니오) 가 아니라 "어느 것부터?"(선택) 다.
    expect(v.telegramMessage).toContain("어느 것부터 할까요?");
    expect(v.telegramMessage).toContain("멈춰 있습니다");
    // 오케에게 나가는 문장은 "시작하지 마라" 여야 한다.
    expect(v.orchestratorMessage).toContain("사장님 승인 전에는 시작하지 마라");
    expect(v.orchestratorMessage).not.toContain("지금 dispatch 하라");
  });

  it("★no-data 는 절대 PROCEED 로 새지 않는다 — allowSpawn:true 여도 여쭙는다", () => {
    // evaluateTokenBudgetGate 자체는 no-data 에도 allowSpawn:true 를 준다
    // (advance-guards.ts 의 설계). evaluateMissionHandoff 가 그 필드를 쓰지
    // 않고 code 로만 분기한다는 것을 여기서 직접 고정한다.
    const gate = evaluateTokenBudgetGate(unknownQuota, 10);
    expect(gate.allowSpawn).toBe(true);
    expect(gate.code).toBe("no-data");

    const v = handoff({ quota: unknownQuota });
    expect(v.action).not.toBe("PROCEED");
    expect(v.action).toBe("ASK_OWNER");
  });

  it("질문 본문에 후보와 그 선택 이유가 들어간다(사장님이 예측 가능해야)", () => {
    const v = handoff({
      chain: [
        item({ id: "a", source: "auto", what: "오케 메모" }),
        item({ id: "o", source: "owner", what: "사장님이 시키신 것" }),
      ],
      quota: unknownQuota,
    });
    expect(v.telegramMessage).toContain("사장님이 시키신 것");
    expect(v.telegramMessage).toContain("사장님 지시");
    // ★하나만 지명하지 않는다 — 2순위도 근거와 함께 실린다.
    expect(v.telegramMessage).toContain("오케 메모");
    expect(v.telegramMessage).toContain("2순위");
  });

  it("★#1414 한도에 걸리면 질문이 안 나간다 — 새 한도를 만들지 않았다", () => {
    const halted = handoff({
      state: state({ haltReason: "이전 사유" }),
      quota: unknownQuota,
    });
    expect(halted.action).toBe("HALT");
    expect(halted.telegramMessage).toBe("");
    expect(halted.haltReason).toContain("이전 사유");
  });

  it("★사장님이 이미 말씀 중이면 질문을 또 보내지 않는다(hold, 상태 불변)", () => {
    const v = handoff({ ownerInputPending: true, quota: unknownQuota });
    expect(v.action).toBe("HOLD");
    expect(v.code).toBe("owner-input-pending");
    expect(v.telegramMessage).toBe("");
    expect(v.reason).not.toBe("");
  });
});

// ── ③-c ★액션 집합과 금지 문구는 진행 여부에 따라 갈라진다 ─────────────────

describe("③-c ★어떤 경로로도 근거 없이는 시작되지 않는다(제안이 늘어도 그대로)", () => {
  it("★여쭙거나 알리는 경로에는 '시작하라/스폰하라' 가 없다 — PROCEED 만 예외다", () => {
    // 이 티켓이 더한 것은 'sufficient 면 진행' 하나뿐이다. 그 밖의 경로(여쭘·
    // 알림·정지·보류)의 시작 권한은 한 톨도 늘지 않았다.
    const nonProceedPaths = [
      handoff({ quota: unknownQuota }),
      handoff({ chain: [] }),
      handoff({
        chain: [
          item({ id: "a", source: "owner" }),
          item({ id: "b", source: "auto" }),
          item({ id: "c", source: "auto" }),
          item({ id: "d", source: "auto" }),
        ],
        quota: unknownQuota,
      }),
      handoff({ quota: [{ harness: "claude", remainingPercent: 1 }] }),
      handoff({ enabled: false }),
    ];
    for (const v of nonProceedPaths) {
      expect(v.action).not.toBe("PROCEED");
      expect([
        "NO_HANDOFF",
        "HALT",
        "HOLD",
        "NOTIFY_OWNER",
        "ASK_OWNER",
      ]).toContain(v.action);
      // 나가는 어떤 문장도 '스폰하라 / 지금 시작하라' 를 말하지 않는다.
      const all = `${v.orchestratorMessage}\n${v.telegramMessage}`;
      for (const forbidden of [
        "지금 dispatch 하라",
        "스폰하라",
        "지금 시작하라",
      ]) {
        expect(all).not.toContain(forbidden);
      }
      // ASK_OWNER 로 후보를 냈다면 반드시 '승인 전 금지' 를 같은 신호에 단다.
      if (v.action === "ASK_OWNER" && v.candidates.length > 0) {
        expect(v.orchestratorMessage).toContain("자율 스폰 금지");
      }
    }
  });

  it("★반대로 PROCEED 는 오케에게 '지금 진행하라' 를 명시적으로 담는다", () => {
    const v = handoff(); // 기본값 = sufficient
    expect(v.action).toBe("PROCEED");
    expect(v.orchestratorMessage).toContain("지금 진행하라");
  });

  it("★액션 집합은 PROCEED 를 포함해 다섯으로 닫혀 있다", () => {
    const actions = new Set(
      [
        handoff().action, // sufficient → PROCEED
        handoff({ quota: unknownQuota }).action, // no-data → ASK_OWNER
        handoff({ chain: [] }).action,
        handoff({ enabled: false }).action,
        handoff({ alreadyAsked: true }).action,
        handoff({ quota: [{ harness: "claude", remainingPercent: 3 }] }).action,
        handoff({ state: state({ haltReason: "이전 사유" }) }).action,
        handoff({ ownerInputPending: true }).action,
      ].filter(Boolean),
    );
    for (const a of actions) {
      expect([
        "NO_HANDOFF",
        "HALT",
        "HOLD",
        "NOTIFY_OWNER",
        "ASK_OWNER",
        "PROCEED",
      ]).toContain(a);
    }
    expect(actions.has("PROCEED" as never)).toBe(true);
    expect(actions.has("ASK_OWNER" as never)).toBe(true);
  });

  it("멈춤에는 항상 사유가 남는다 — 조용한 정지 금지", () => {
    for (const v of [
      handoff({ state: state({ haltReason: "x" }) }),
      handoff({ ownerInputPending: true }),
      handoff({ chain: [] }),
      handoff({ quota: [{ harness: "claude", remainingPercent: 1 }] }),
    ]) {
      expect(v.reason.trim()).not.toBe("");
    }
  });

  it("진행에도 항상 사유가 남는다 — PROCEED 도 조용히 넘어가지 않는다", () => {
    const v = handoff();
    expect(v.action).toBe("PROCEED");
    expect(v.reason.trim()).not.toBe("");
  });
});

// ── ④ ★토큰 잔여 게이트 ─────────────────────────────────────────────────────

describe("④ ★토큰 잔여가 임계 아래면 스폰하지 않는다", () => {
  it("잔여가 예비선 이하면 스폰 없이 사유와 함께 알린다", () => {
    const v = handoff({
      quota: [
        { harness: "claude", remainingPercent: 4, source: "account-probe" },
        { harness: "gpt", remainingPercent: 9, source: "account-probe" },
      ],
      reservePct: 10,
    });
    expect(v.action).toBe("NOTIFY_OWNER");
    expect(v.code).toBe("tokens-insufficient");
    expect(v.tokenGate?.allowSpawn).toBe(false);
    expect(v.reason).toContain("예비선");
    // ★질문이 아니라 보고다 — 부족한데 "시작할까요" 를 여쭈면 승인해도 못 한다.
    expect(v.telegramMessage).toContain("시작하지 못했습니다");
    expect(v.telegramMessage).toContain("스폰은 진행하지 않았습니다");
    expect(v.telegramMessage).not.toContain("시작할까요?");
  });

  it("하나라도 여유가 있으면 통과해 진행한다(PROCEED)", () => {
    const v = handoff({
      quota: [
        { harness: "claude", remainingPercent: 2 },
        { harness: "gpt", remainingPercent: 55 },
      ],
      reservePct: 10,
    });
    expect(v.action).toBe("PROCEED");
    expect(v.tokenGate?.headroom.map((h) => h.harness)).toEqual(["gpt"]);
    expect(v.tokenGate?.exhausted.map((h) => h.harness)).toEqual(["claude"]);
  });

  it("경계값 — 예비선과 '같으면' 소진이다(초과라야 여유)", () => {
    expect(
      evaluateTokenBudgetGate([{ harness: "claude", remainingPercent: 10 }], 10)
        .code,
    ).toBe("insufficient");
    expect(
      evaluateTokenBudgetGate(
        [{ harness: "claude", remainingPercent: 10.5 }],
        10,
      ).code,
    ).toBe("sufficient");
  });

  it("★전부 no-data 면 차단하지 않되 그 사실이 질문에 실린다", () => {
    const v = handoff({
      quota: [
        { harness: "claude", remainingPercent: null },
        { harness: "gpt", remainingPercent: null },
      ],
      quotaError: "브리지 응답 500",
    });
    expect(v.action).toBe("ASK_OWNER");
    expect(v.tokenGate?.code).toBe("no-data");
    expect(v.telegramMessage).toContain("조회하지 못했다");
    expect(v.telegramMessage).toContain("브리지 응답 500");
  });

  it("null 은 '모름'이지 '0% 잔여'가 아니다", () => {
    const g = evaluateTokenBudgetGate(
      [
        { harness: "claude", remainingPercent: null },
        { harness: "gpt", remainingPercent: 80 },
      ],
      10,
    );
    expect(g.code).toBe("sufficient");
    expect(g.unknown.map((h) => h.harness)).toEqual(["claude"]);
    expect(g.exhausted).toEqual([]);
  });

  it("사유는 언제나 비어 있지 않다(세 분기 전부)", () => {
    for (const rows of [
      [{ harness: "claude", remainingPercent: 90 }],
      [{ harness: "claude", remainingPercent: 1 }],
      [{ harness: "claude", remainingPercent: null }],
    ] as HarnessQuotaReading[][]) {
      expect(evaluateTokenBudgetGate(rows, 10).reason.trim()).not.toBe("");
    }
  });

  it("★게이트 순서가 토큰 먼저다 — 토큰이 없으면 승인 질문 자체가 안 나간다", () => {
    const v = handoff({ quota: [{ harness: "claude", remainingPercent: 0 }] });
    expect(v.telegramMessage).not.toContain("어느 것부터 할까요?");
    expect(v.action).toBe("NOTIFY_OWNER");
  });

  it("★잔여 부족이어도 제안은 보류하지 않는다 — 부족을 '함께' 적는다", () => {
    // 게이트가 막는 것은 스폰이지 정보가 아니다. 후보를 감추면 사장님이
    // "그건 급하니 다른 하네스로 돌려라" 같은 판단 자체를 못 하신다.
    const v = handoff({
      chain: [
        item({ id: "a", source: "owner", what: "급한 것" }),
        item({ id: "b", source: "auto", what: "덜 급한 것" }),
      ],
      quota: [{ harness: "claude", remainingPercent: 2 }],
      reservePct: 10,
    });
    expect(v.action).toBe("NOTIFY_OWNER");
    expect(v.telegramMessage).toContain("★지금은 토큰 잔여가 부족합니다");
    expect(v.telegramMessage).toContain("급한 것");
    expect(v.telegramMessage).toContain("덜 급한 것");
    expect(v.telegramMessage).toContain("2순위");
    // ★그러나 승인을 구하지는 않는다 — 승인하셔도 지금은 못 돌기 때문이다.
    expect(v.telegramMessage).not.toContain("어느 것부터 할까요?");
    expect(v.telegramMessage).toContain("스폰은 진행하지 않았습니다");
  });

  it("후보가 0건이면 잔여 부족 문구도 '없음' 이라고 정직하게 적는다", () => {
    // 후보 0건은 토큰 게이트 앞에서 갈라지므로 이 경로로 오지 않는다 —
    // 그 사실 자체를 고정한다(잔여 부족과 브레인 공백이 안 섞인다).
    const v = handoff({
      chain: [],
      quota: [{ harness: "claude", remainingPercent: 1 }],
    });
    expect(v.code).toBe("chain-exhausted");
    expect(v.telegramMessage).not.toContain("토큰 잔여가 부족합니다");
  });
});

// ── 비밀 유출 금지 ──────────────────────────────────────────────────────────

describe("본문·토큰·chatId 는 사유 축으로 새지 않는다", () => {
  it("오케 PTY 본문에 텔레그램 본문이 들어가지 않는다", () => {
    const v = handoff();
    expect(v.telegramMessage).not.toBe("");
    expect(v.orchestratorMessage).not.toContain(v.telegramMessage);
    expect(v.orchestratorMessage).not.toContain("답장해 주시면");
  });

  it("어떤 출력에도 토큰/chatId 계열 문자열이 없다", () => {
    const v = handoff();
    const all = [
      v.reason,
      v.orchestratorMessage,
      v.telegramMessage,
      v.haltReason ?? "",
    ].join("\n");
    for (const forbidden of [
      "chatId",
      "chat_id",
      "bot_token",
      "botToken",
      "MARBLO_BRIDGE_TOKEN",
      "Bearer ",
    ]) {
      expect(all).not.toContain(forbidden);
    }
  });
});

// ── ⑤ ★플래그는 하나다 ──────────────────────────────────────────────────────

describe("⑤ ★플래그가 하나다 — 사장님 지시 '한번에 켜줘'", () => {
  const advance = (enabled: boolean) =>
    evaluateMissionAdvance({
      finishedTaskId: "t1",
      contextId: "m1",
      mission: {
        id: "m1",
        status: "active",
        missionKind: "implicit",
        implicitLabel: "묶음",
        steps: [],
      },
      siblings: [
        { id: "t1", status: "DONE" },
        { id: "t2", status: "TODO", dependsOnCompleted: true },
      ],
      state: emptyAdvanceState(),
      ownerInputPending: false,
      enabled,
    });

  it("동작 축 — 하나의 enabled 로 두 계층이 같이 켜지고 같이 꺼진다", () => {
    expect(advance(false).code).toBe("flag-off");
    expect(handoff({ enabled: false }).code).toBe("flag-off");

    expect(advance(true).code).not.toBe("flag-off");
    expect(handoff({ enabled: true }).code).not.toBe("flag-off");
  });

  it("플래그가 꺼져 있으면 이 계층은 아무 신호도 만들지 않는다", () => {
    const v = handoff({ enabled: false });
    expect(v.action).toBe("NO_HANDOFF");
    expect(v.orchestratorMessage).toBe("");
    expect(v.telegramMessage).toBe("");
    expect(v.splitTargets).toEqual([]);
    expect(v.candidates).toEqual([]);
  });

  it("환경변수 이름은 MISSION_ADVANCE_SIGNAL 하나이고 정확일치만 켠다", () => {
    expect(ADVANCE_SIGNAL_ENV).toBe("MISSION_ADVANCE_SIGNAL");
    expect(isAdvanceSignalEnabled({ MISSION_ADVANCE_SIGNAL: "on" })).toBe(true);
    for (const raw of ["", "true", "1", "yes", "ON!", undefined]) {
      expect(isAdvanceSignalEnabled({ MISSION_ADVANCE_SIGNAL: raw })).toBe(
        false,
      );
    }
  });

  it("★소스 축 — 핸드오프 모듈은 자기 환경변수를 가지지 않는다", () => {
    const src = fs.readFileSync(
      path.join(__dirname, "../../electron/mcp-server/mission-handoff.ts"),
      "utf-8",
    );
    // process.env 를 아예 읽지 않는다(플래그 판정은 호출자 몫).
    expect(src).not.toContain("process.env");
    // 다른 advance 계열 스위치를 새로 만들지 않았다.
    const envNames = src.match(/MISSION_[A-Z_]+/g) ?? [];
    expect(
      new Set(envNames.filter((n) => n !== "MISSION_ADVANCE_SIGNAL")).size,
    ).toBe(0);
  });

  it("★소스 축 — 한도 파일에도 advance 계열 환경변수는 하나뿐이다", () => {
    const src = fs.readFileSync(
      path.join(__dirname, "../../electron/mcp-server/advance-guards.ts"),
      "utf-8",
    );
    const envNames = new Set(src.match(/MISSION_[A-Z_]+/g) ?? []);
    expect([...envNames]).toEqual(["MISSION_ADVANCE_SIGNAL"]);
  });
});
