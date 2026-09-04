/**
 * 티켓 F2TAJlSgSP8Ag1qJNkp1 — 폐루프의 **마지막 계층**:
 * ① 미션을 태스크로 쪼개기 ② 미션 완료 → 다음 미션.
 *
 * 사장님 지시:
 *   _"오케브레인 미션을 하나씩 끝내면서 다음 미션으로 넘어가는 형태로 …
 *   이 루프에서 우리 유세이지탭에 사용량 토큰 잔여량을 체크하면서 스폰을
 *   진행하고, 텔레로 다음 미션의 시작은 사용자에게 물어보고 가능 형태로"_
 * 그리고 **"한번에 켜줘"**.
 *
 * 그래서 이 스위트가 고정하는 것은 넷이다:
 *   ① 근거 티켓 없는 사장님 지시가 분해 대상으로 잡히고, 붙은 건 안 잡힌다
 *   ② 다음 후보가 **선택 순서대로** 골라진다(순서가 암시적이면 사장님이 예측 못 한다)
 *   ③ ★사장님 승인 없이는 다음 미션이 시작되지 않는다 — 질문을 보내고 멈춘다
 *   ④ ★토큰 잔여가 임계 아래면 스폰하지 않고 사유와 함께 알린다
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
  evaluateMissionHandoff,
  isOwnerDirective,
  lacksBackingTask,
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

/** 잔여가 넉넉한 하네스 한 줄(예비선 10 기준). */
const roomy: HarnessQuotaReading[] = [
  { harness: "claude", remainingPercent: 62, source: "account-probe" },
  { harness: "gpt", remainingPercent: 41, source: "account-probe" },
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
    expect(
      chainItemNeedsApproval(item({ what: "리팩터만 — 배포 없음" })),
    ).toBe(false);
    expect(chainItemNeedsApproval(item({ what: "프로덕션 배포" }))).toBe(true);
  });

  it("후보가 하나도 없으면 그 사실을 오케에 보고한다(조용히 끝내지 않는다)", () => {
    const v = handoff({ chain: [] });
    expect(v.action).toBe("NO_HANDOFF");
    expect(v.code).toBe("chain-exhausted");
    expect(v.reason).not.toBe("");
    expect(v.orchestratorMessage).toContain("후보가 없다");
    expect(v.telegramMessage).toBe("");
  });

  it("분해 대상은 후보 집합의 부분집합이다(같은 규칙 하나)", () => {
    const chain = [
      item({ id: "o1", source: "owner", evidenceTaskIds: [] }),
      item({ id: "o2", source: "owner", evidenceTaskIds: ["t"] }),
      item({ id: "a1", source: "auto", evidenceTaskIds: [] }),
    ];
    const { candidates } = selectHandoffCandidates(chain);
    expect(selectSplitTargets(candidates).map((c) => c.item.id)).toEqual(["o1"]);
  });
});

// ── ③ ★사장님 승인 게이트 ───────────────────────────────────────────────────

describe("③ ★다음 미션은 사장님 승인 없이 시작되지 않는다", () => {
  it("질문이 텔레그램으로 나가고 거기서 멈춘다 — 스폰 지시가 없다", () => {
    const v = handoff();
    expect(v.action).toBe("ASK_OWNER");
    expect(v.telegramMessage).not.toBe("");
    expect(v.telegramMessage).toContain("시작할까요?");
    expect(v.telegramMessage).toContain("멈춰 있습니다");
    // 오케에게 나가는 문장은 "시작하지 마라" 여야 한다.
    expect(v.orchestratorMessage).toContain("사장님 승인 전에는 시작하지 마라");
    expect(v.orchestratorMessage).not.toContain("지금 dispatch 하라");
  });

  it("★어떤 판정 결과도 '스폰하라'를 뜻하지 않는다 — 액션 집합이 닫혀 있다", () => {
    const actions = new Set(
      [
        handoff().action,
        handoff({ chain: [] }).action,
        handoff({ enabled: false }).action,
        handoff({ alreadyAsked: true }).action,
        handoff({ quota: [{ harness: "claude", remainingPercent: 3 }] }).action,
        handoff({ state: state({ haltReason: "이전 사유" }) }).action,
        handoff({ ownerInputPending: true }).action,
      ].filter(Boolean),
    );
    for (const a of actions) {
      expect(["NO_HANDOFF", "HALT", "HOLD", "NOTIFY_OWNER", "ASK_OWNER"]).toContain(
        a,
      );
    }
    // "SPAWN" 같은 자동 전진 액션은 타입에도 없다.
    expect(actions.has("ASK_OWNER" as never)).toBe(true);
  });

  it("★같은 완료가 두 번 들어와도 질문은 한 번", () => {
    const v = handoff({ alreadyAsked: true });
    expect(v.action).toBe("NO_HANDOFF");
    expect(v.code).toBe("already-asked");
    expect(v.telegramMessage).toBe("");
  });

  it("질문 본문에 1순위 후보와 그 선택 이유가 들어간다(사장님이 예측 가능해야)", () => {
    const v = handoff({
      chain: [
        item({ id: "a", source: "auto", what: "오케 메모" }),
        item({ id: "o", source: "owner", what: "사장님이 시키신 것" }),
      ],
    });
    expect(v.telegramMessage).toContain("사장님이 시키신 것");
    expect(v.telegramMessage).toContain("사장님 지시");
    expect(v.telegramMessage).toContain("대기 중인 다른 후보: 1건");
  });

  it("★#1414 한도에 걸리면 질문이 안 나간다 — 새 한도를 만들지 않았다", () => {
    const halted = handoff({ state: state({ haltReason: "이전 사유" }) });
    expect(halted.action).toBe("HALT");
    expect(halted.telegramMessage).toBe("");
    expect(halted.haltReason).toContain("이전 사유");

    const capped = handoff({ state: state({ consecutiveSignals: 5 }) });
    expect(capped.action).toBe("HALT");
    expect(capped.code).toBe("consecutive-spawn-cap");
    expect(capped.telegramMessage).toBe("");
  });

  it("★사장님이 이미 말씀 중이면 질문을 또 보내지 않는다(hold, 상태 불변)", () => {
    const v = handoff({ ownerInputPending: true });
    expect(v.action).toBe("HOLD");
    expect(v.code).toBe("owner-input-pending");
    expect(v.telegramMessage).toBe("");
    expect(v.reason).not.toBe("");
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

  it("하나라도 여유가 있으면 통과한다", () => {
    const v = handoff({
      quota: [
        { harness: "claude", remainingPercent: 2 },
        { harness: "gpt", remainingPercent: 55 },
      ],
      reservePct: 10,
    });
    expect(v.action).toBe("ASK_OWNER");
    expect(v.tokenGate?.headroom.map((h) => h.harness)).toEqual(["gpt"]);
    expect(v.tokenGate?.exhausted.map((h) => h.harness)).toEqual(["claude"]);
  });

  it("경계값 — 예비선과 '같으면' 소진이다(초과라야 여유)", () => {
    expect(
      evaluateTokenBudgetGate(
        [{ harness: "claude", remainingPercent: 10 }],
        10,
      ).code,
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
    expect(v.telegramMessage).not.toContain("시작할까요?");
    expect(v.action).toBe("NOTIFY_OWNER");
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
    expect(new Set(envNames.filter((n) => n !== "MISSION_ADVANCE_SIGNAL")).size).toBe(
      0,
    );
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
