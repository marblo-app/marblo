/**
 * ★전진 신호가 미션 컨텍스트의 오케를 찾다 버려지던 배달 층 회귀
 * (티켓 B0G7agMgarQPqIYEc3Jq — 2026-09-05 라이브 실측 P0).
 *
 * 실측: 플래그 ON 상태에서 형제 티켓이 남은 미션 티켓을 DONE 으로 닫았는데
 * SIGNAL_ADVANCE 가 오케에 닿지 않았고 활동기록에만 이것이 남았다 —
 *   "Mission orchestrator not running for project ... (context=h7mpRaw...) —
 *    notification dropped"
 * 원인은 판정 층이 아니라 **배달 층**이었다: 알림은 티켓 contextId(=missionId)로
 * 미션 오케를 찾는데, 암묵 미션(Mission Replay 라벨)에는 미션 오케를 띄우는
 * 경로가 아예 없다. 실제로 도는 오케는 board 하나뿐이라 신호가 만들어지고도
 * 배달 주소가 비어 버려졌다.
 *
 * 여기서 고정하는 세 축:
 *   1. 순수 판정 — chooseNotifyRecipient 의 폴백/미전달 진리표.
 *   2. ★배선 — 실제 BridgeServer 를 태워 "미션 오케 없음 + 보드 오케만 있음"
 *      에서 신호가 **보드 오케 PTY 에 실제로 닿는지**. 순수 함수만 봤다면 이
 *      티켓의 버그(배선)를 또 놓친다.
 *   3. 수신자가 아예 없을 때 **버리지 않고** 사람이 볼 곳(미전달 관찰자)에
 *      남는지.
 */
import { describe, expect, it, vi } from "vitest";

vi.mock("electron", () => ({
  BrowserWindow: { getAllWindows: () => [] },
}));

import {
  chooseNotifyRecipient,
  formatFallbackBanner,
} from "../../electron/notify-recipient";
import {
  BridgeServer,
  notifyOutcomeToResponse,
  describeNotifyRefusal,
  type NotifyUndeliveredInfo,
} from "../../electron/bridge-server";
import { classifyNotifyResponse } from "../../electron/mcp-server/notify-delivery";
import {
  describeResyncFollowup,
  describeNotifyFailureHeadline,
  resyncRedeliversNotification,
  RESYNC_ATTENTION_STATUSES,
} from "../../electron/mcp-server/notify-resync-coverage";
import { classifyResyncAttention } from "../../electron/orchestrator-board-resync";
import type { OrchestratorManager } from "../../electron/orchestrator-manager";

// ── 1. 순수 판정 ────────────────────────────────────────────────

describe("chooseNotifyRecipient — 미션 오케 부재 시 보드 오케 폴백", () => {
  it("미션 오케가 돌면 그대로 미션 오케로 간다(폴백 아님)", () => {
    expect(
      chooseNotifyRecipient({
        requestedTarget: "mission",
        missionOrchRunning: true,
        boardOrchRunning: true,
      }),
    ).toEqual({ outcome: "deliver", deliverTo: "mission", viaFallback: false });
  });

  it("★미션 오케가 없고 보드 오케만 있으면 보드 오케로 폴백한다", () => {
    const d = chooseNotifyRecipient({
      requestedTarget: "mission",
      missionOrchRunning: false,
      boardOrchRunning: true,
    });
    expect(d.outcome).toBe("deliver");
    if (d.outcome !== "deliver") return;
    expect(d.deliverTo).toBe("board");
    expect(d.viaFallback).toBe(true);
    // 사유가 비어 있으면 기록이 무의미해진다.
    expect(d.fallbackReason ?? "").not.toBe("");
  });

  it("둘 다 없으면 버리지 않고 undeliverable 로 사유를 남긴다", () => {
    const d = chooseNotifyRecipient({
      requestedTarget: "mission",
      missionOrchRunning: false,
      boardOrchRunning: false,
    });
    expect(d.outcome).toBe("undeliverable");
    if (d.outcome !== "undeliverable") return;
    expect(d.reason).not.toBe("");
  });

  it("보드 알림은 미션 오케로 절대 흘러가지 않는다(폴백은 한 방향뿐)", () => {
    const d = chooseNotifyRecipient({
      requestedTarget: "board",
      missionOrchRunning: true,
      boardOrchRunning: false,
    });
    expect(d.outcome).toBe("undeliverable");
  });

  it("보드 오케가 돌면 보드 알림은 그대로 간다", () => {
    expect(
      chooseNotifyRecipient({
        requestedTarget: "board",
        missionOrchRunning: false,
        boardOrchRunning: true,
      }),
    ).toEqual({ outcome: "deliver", deliverTo: "board", viaFallback: false });
  });
});

// ── 2. ★배선 — 실제 BridgeServer 를 태운다 ──────────────────────

interface Written {
  ptySessionId: string;
  text: string;
}

function fakeOrch(
  ptySessionId: string,
  status: string,
): OrchestratorManager | null {
  return {
    getSession: () => ({ ptySessionId, status }),
  } as unknown as OrchestratorManager;
}

function makeBridge(opts: {
  board?: { ptySessionId: string; status?: string } | null;
  mission?: { ptySessionId: string; status?: string } | null;
  injected?: boolean;
  composerState?: string;
  composerRefusal?: string;
  occupancy?: string | null;
}) {
  const written: Written[] = [];
  const undelivered: NotifyUndeliveredInfo[] = [];
  const pty = {
    writeAndSubmit: async (ptySessionId: string, text: string) => {
      written.push({ ptySessionId, text });
      return opts.injected ?? true;
    },
    composerVerdict: () => ({
      state: opts.composerState ?? "occupied",
      writable: false,
      refusal: opts.composerRefusal ?? "composer-occupied",
    }),
    composerOccupancy: () => opts.occupancy ?? "orchestrator-busy",
  };
  const bridge = new BridgeServer(
    {} as unknown as ConstructorParameters<typeof BridgeServer>[0],
    pty as unknown as ConstructorParameters<typeof BridgeServer>[1],
    new Map(),
    {} as unknown as ConstructorParameters<typeof BridgeServer>[3],
  );
  bridge.setOrchestratorLookup(() =>
    opts.board
      ? fakeOrch(opts.board.ptySessionId, opts.board.status ?? "running")
      : null,
  );
  bridge.setMissionOrchestratorLookup(() =>
    opts.mission
      ? fakeOrch(opts.mission.ptySessionId, opts.mission.status ?? "running")
      : null,
  );
  bridge.setNotifyUndeliveredObserver((info) => undelivered.push(info));
  return { bridge, written, undelivered };
}

/** 실측에서 죽었던 바로 그 메시지 모양. */
const ADVANCE_SIGNAL =
  "[Mission Advance] '폐루프' 전진 — 방금 닫힘: \"티켓 A\" (id=xqO5KKEf)\n" +
  "미션 h7mpRawtJ7YET7ak48lF · 남음 2건 / 지금 가능 2건 / 대기 0건 / 진행중 0건 / 승인필요 0건";

describe("BridgeServer.routeOrchestratorNotification — 배선 회귀", () => {
  it("★미션 컨텍스트 + 미션 오케 없음 + 보드 오케만 있음 → 보드 오케 PTY 에 닿는다", async () => {
    const { bridge, written, undelivered } = makeBridge({
      board: { ptySessionId: "board-pty" },
      mission: null,
    });

    const outcome = await bridge.routeOrchestratorNotification({
      message: ADVANCE_SIGNAL,
      projectId: "GFB8JnJrrX6AgahqmGB3",
      contextId: "h7mpRawtJ7YET7ak48lF",
      taskId: "xqO5KKEf",
    });

    // 회귀 지점: 예전에는 여기서 undeliverable("Mission orchestrator not
    // running ... notification dropped") 로 끝나고 PTY 는 한 글자도 안 받았다.
    expect(outcome.kind).toBe("attempted");
    if (outcome.kind !== "attempted") return;
    expect(outcome.deliveredTo).toBe("board");
    expect(outcome.viaFallback).toBe(true);
    expect(outcome.injected).toBe(true);

    expect(written).toHaveLength(1);
    expect(written[0].ptySessionId).toBe("board-pty");
    // 신호 본문이 온전히 실렸고, 폴백을 탄 사실이 배달물에 적혀 있다.
    expect(written[0].text).toContain(ADVANCE_SIGNAL);
    expect(written[0].text).toContain(
      formatFallbackBanner("h7mpRawtJ7YET7ak48lF"),
    );
    // 배달됐으므로 미전달 표면은 조용해야 한다(오탐 소음 금지).
    expect(undelivered).toEqual([]);
  });

  it("미션 오케가 돌고 있으면 폴백하지 않고 미션 오케로 간다", async () => {
    const { bridge, written } = makeBridge({
      board: { ptySessionId: "board-pty" },
      mission: { ptySessionId: "mission-pty" },
    });
    const outcome = await bridge.routeOrchestratorNotification({
      message: ADVANCE_SIGNAL,
      projectId: "p1",
      contextId: "h7mpRawtJ7YET7ak48lF",
    });
    expect(outcome.kind).toBe("attempted");
    if (outcome.kind !== "attempted") return;
    expect(outcome.deliveredTo).toBe("mission");
    expect(outcome.viaFallback).toBe(false);
    expect(written[0].ptySessionId).toBe("mission-pty");
    // 폴백이 아니면 배너를 붙이지 않는다.
    expect(written[0].text).toBe(ADVANCE_SIGNAL);
  });

  it("미션 오케가 stopped 면 running 이 아니므로 보드 오케로 폴백한다", async () => {
    const { bridge, written } = makeBridge({
      board: { ptySessionId: "board-pty" },
      mission: { ptySessionId: "mission-pty", status: "stopped" },
    });
    const outcome = await bridge.routeOrchestratorNotification({
      message: ADVANCE_SIGNAL,
      projectId: "p1",
      contextId: "m1",
    });
    expect(outcome.kind).toBe("attempted");
    expect(written[0].ptySessionId).toBe("board-pty");
  });

  it("★수신자가 아예 없으면 버리지 않고 사람이 볼 표면에 남는다", async () => {
    const { bridge, written, undelivered } = makeBridge({
      board: null,
      mission: null,
    });
    const outcome = await bridge.routeOrchestratorNotification({
      message: ADVANCE_SIGNAL,
      projectId: "GFB8JnJrrX6AgahqmGB3",
      contextId: "h7mpRawtJ7YET7ak48lF",
      taskId: "xqO5KKEf",
    });

    expect(outcome.kind).toBe("undeliverable");
    expect(written).toEqual([]);
    // 조용한 유실 금지 — 관찰자가 티켓/사유/원문을 그대로 받는다.
    expect(undelivered).toHaveLength(1);
    expect(undelivered[0].taskId).toBe("xqO5KKEf");
    expect(undelivered[0].requestedTarget).toBe("mission");
    expect(undelivered[0].contextId).toBe("h7mpRawtJ7YET7ak48lF");
    expect(undelivered[0].reason).not.toBe("");
    expect(undelivered[0].message).toBe(ADVANCE_SIGNAL);
  });

  it("PTY 가 거절해도(injected=false) 사람이 볼 표면에 남는다", async () => {
    const { bridge, undelivered } = makeBridge({
      board: { ptySessionId: "board-pty" },
      mission: null,
      injected: false,
    });
    const outcome = await bridge.routeOrchestratorNotification({
      message: ADVANCE_SIGNAL,
      projectId: "p1",
      contextId: "m1",
      taskId: "t1",
    });
    expect(outcome.kind).toBe("attempted");
    if (outcome.kind !== "attempted") return;
    expect(outcome.injected).toBe(false);
    expect(undelivered).toHaveLength(1);
    expect(undelivered[0].deliveredTo).toBe("board");
  });

  it("★거절 사유가 뭉뚱그린 문구가 아니라 실제 컴포저 판독을 싣는다(티켓 rjoTuGmIlXJQpjDvWMMR)", async () => {
    const { bridge, undelivered } = makeBridge({
      board: { ptySessionId: "board-pty" },
      mission: null,
      injected: false,
      composerState: "occupied",
      composerRefusal: "composer-occupied",
      occupancy: "orchestrator-busy",
    });
    const outcome = await bridge.routeOrchestratorNotification({
      message: ADVANCE_SIGNAL,
      projectId: "p1",
      contextId: "m1",
      taskId: "t1",
    });
    expect(outcome.kind).toBe("attempted");
    if (outcome.kind !== "attempted") return;
    expect(outcome.refusalReason).toBe(
      "orchestrator PTY did not accept the message — composer=occupied (composer-occupied) cause=orchestrator-busy",
    );
    expect(undelivered[0].reason).toBe(outcome.refusalReason);
    // notifyOutcomeToResponse 도 뭉뚱그린 문구 대신 이 사유를 그대로 싣는다.
    expect(
      notifyOutcomeToResponse(outcome, { projectId: "p1", contextId: "m1" })
        .error,
    ).toBe(outcome.refusalReason);
  });

  it("컴포저 판독 자체가 실패해도(관측기 없음) 뭉뚱그린 문구로 안전하게 떨어진다", async () => {
    const { bridge, undelivered } = makeBridge({
      board: { ptySessionId: "board-pty" },
      mission: null,
      injected: false,
    });
    // composerVerdict 가 던지는 pty 로 교체 — 관측 실패를 흉내낸다.
    (
      bridge as unknown as {
        ptyManager: { composerVerdict: () => never };
      }
    ).ptyManager.composerVerdict = () => {
      throw new Error("no such session");
    };
    const outcome = await bridge.routeOrchestratorNotification({
      message: ADVANCE_SIGNAL,
      projectId: "p1",
      contextId: "m1",
      taskId: "t1",
    });
    expect(outcome.kind).toBe("attempted");
    if (outcome.kind !== "attempted") return;
    expect(outcome.refusalReason).toBeUndefined();
    expect(undelivered[0].reason).toBe(
      "orchestrator PTY did not accept the message",
    );
  });

  it("타임라인 전용 진행 보고는 폴백 판정 **이전에** 억제된다 — 보드 오케 오염 없음", async () => {
    const { bridge, written, undelivered } = makeBridge({
      board: { ptySessionId: "board-pty" },
      mission: null,
    });
    const outcome = await bridge.routeOrchestratorNotification({
      message:
        '[Task Activity] "Build API" progress update (backend, id=t1, agent=a1): 구현 중',
      projectId: "p1",
      contextId: "m1",
    });
    expect(outcome.kind).toBe("suppressed");
    expect(written).toEqual([]);
    expect(undelivered).toEqual([]);
  });

  it("★[Review Submitted] 도 같은 폴백을 탄다 — 23:34 유실과 같은 축", async () => {
    const { bridge, written } = makeBridge({
      board: { ptySessionId: "board-pty" },
      mission: null,
    });
    const outcome = await bridge.routeOrchestratorNotification({
      message:
        '[Review Submitted] "티켓 A" is ready for review (backend, id=t1)',
      projectId: "p1",
      contextId: "h7mpRawtJ7YET7ak48lF",
      taskId: "t1",
    });
    expect(outcome.kind).toBe("attempted");
    if (outcome.kind !== "attempted") return;
    expect(outcome.viaFallback).toBe(true);
    expect(written[0].ptySessionId).toBe("board-pty");
  });
});

// ── 와이어 계약 — 브리지 응답 ↔ mcp 판정이 어긋나면 안 된다 ──────

describe("notifyOutcomeToResponse ↔ classifyNotifyResponse 계약", () => {
  const params = { projectId: "p1", contextId: "m1" };

  it("폴백 배달은 delivered 로 읽히고 viaFallback 이 보존된다", () => {
    const body = notifyOutcomeToResponse(
      {
        kind: "attempted",
        requestedTarget: "mission",
        deliveredTo: "board",
        viaFallback: true,
        fallbackReason: "미션 오케가 실행 중이 아니라 보드 오케로 전달했습니다",
        injected: true,
      },
      params,
    );
    const result = classifyNotifyResponse(true, 200, body);
    expect(result.outcome).toBe("delivered");
    expect(result.deliveredTo).toBe("board");
    expect(result.viaFallback).toBe(true);
    expect(result.fallbackReason).toBeTruthy();
  });

  it("평범한 배달은 폴백 표시가 붙지 않는다", () => {
    const result = classifyNotifyResponse(
      true,
      200,
      notifyOutcomeToResponse(
        {
          kind: "attempted",
          requestedTarget: "board",
          deliveredTo: "board",
          viaFallback: false,
          injected: true,
        },
        params,
      ),
    );
    expect(result.outcome).toBe("delivered");
    expect(result.viaFallback).toBeUndefined();
  });

  it("억제는 여전히 suppressed 로, 미전달은 failed 로 읽힌다", () => {
    expect(
      classifyNotifyResponse(
        true,
        200,
        notifyOutcomeToResponse(
          {
            kind: "suppressed",
            requestedTarget: "mission",
            reason: "timeline-only notification suppressed",
          },
          params,
        ),
      ).outcome,
    ).toBe("suppressed");

    const failed = classifyNotifyResponse(
      true,
      200,
      notifyOutcomeToResponse(
        {
          kind: "undeliverable",
          requestedTarget: "mission",
          reason: "미션 오케도 보드 오케도 실행 중이 아닙니다",
        },
        params,
      ),
    );
    expect(failed.outcome).toBe("failed");
    expect(failed.reason).toContain("미션 오케도 보드 오케도");
  });

  it("PTY 거절은 delivered 가 아니라 failed 다", () => {
    expect(
      classifyNotifyResponse(
        true,
        200,
        notifyOutcomeToResponse(
          {
            kind: "attempted",
            requestedTarget: "board",
            deliveredTo: "board",
            viaFallback: false,
            injected: false,
          },
          params,
        ),
      ).outcome,
    ).toBe("failed");
  });
});

// ── 4. "재동기화 스위프가 다시 밀어준다" 문구의 참·거짓 ─────────

describe("resyncRedeliversNotification — 거짓 위로 제거", () => {
  it("★미션 티켓은 어떤 알림이든 재전달되지 않는다(스위프가 통째로 제외)", () => {
    for (const message of [
      '[Review Submitted] "t" is ready for review (backend, id=t1)',
      '[Task Update] "t" REVIEW → FAILED (backend, id=t1)',
      '[Task Update] "t" IN_PROGRESS → DONE (backend, id=t1)',
      "[Mission Advance] '묶음' 전진 — 방금 닫힘",
    ]) {
      expect(
        resyncRedeliversNotification({ message, isMissionContext: true }),
      ).toBe(false);
    }
  });

  it("★DONE 전이는 보드 티켓이어도 재전달되지 않는다(조회 집합에 없다)", () => {
    expect(
      resyncRedeliversNotification({
        message: '[Task Update] "t" IN_PROGRESS → DONE (backend, id=t1)',
        isMissionContext: false,
      }),
    ).toBe(false);
  });

  it("보드 티켓의 REVIEW/FAILED/BLOCKED 만 참이다", () => {
    expect(
      resyncRedeliversNotification({
        message: '[Review Submitted] "t" is ready for review (backend, id=t1)',
        isMissionContext: false,
      }),
    ).toBe(true);
    expect(
      resyncRedeliversNotification({
        message: '[Task Update] "t" IN_PROGRESS → FAILED (backend, id=t1)',
        isMissionContext: false,
      }),
    ).toBe(true);
    expect(
      resyncRedeliversNotification({
        message: '[Task Update] "t" IN_PROGRESS → BLOCKED (backend, id=t1)',
        isMissionContext: false,
      }),
    ).toBe(true);
  });

  it("스위프 축이 아닌 알림은 전부 거짓 — fail-closed", () => {
    for (const message of [
      '[Dependency Resolved] "t" is now ready (id=t2, role=backend)',
      '[Task Deleted] "t" soft-deleted (id=t1)',
      '[Task Activity] "t" progress update (backend, id=t1, agent=a1): [질문] 확인 필요',
      "[Mission Handoff] 다음 묶음",
      "완전히 새로운 알림 포맷",
    ]) {
      expect(
        resyncRedeliversNotification({ message, isMissionContext: false }),
      ).toBe(false);
    }
  });

  it("거짓일 때 문구가 ★재전달 없음을 명시한다(위로 금지)", () => {
    const mission = describeResyncFollowup({
      message: "[Mission Advance] 전진",
      isMissionContext: true,
    });
    expect(mission).toContain("재전달 없음");
    expect(mission).toContain("미션 티켓을 제외");
    expect(mission).not.toContain("다시 밀어줍니다");

    const board = describeResyncFollowup({
      message: '[Task Update] "t" IN_PROGRESS → DONE (backend, id=t1)',
      isMissionContext: false,
    });
    expect(board).toContain("재전달 없음");
    expect(board).not.toContain("다시 밀어줍니다");
  });

  it("참일 때만 다시 밀어준다고 적는다", () => {
    expect(
      describeResyncFollowup({
        message: '[Review Submitted] "t" is ready for review (backend, id=t1)',
        isMissionContext: false,
      }),
    ).toContain("다시 밀어줍니다");
  });
});

// ── 5. 머리말 심각도 — 재전달이 보장되면 "미전달"이 아니다 ──────────
// 티켓 rjoTuGmIlXJQpjDvWMMR: 사장님이 "오케에게 알림이 전달되지 않았습니다"를
// 한번씩 계속 본다고 관측했다. 재전달이 보장되는 경우(REVIEW/FAILED/BLOCKED,
// 비미션)는 소음이지 사고가 아니다 — 머리말이 그 구분을 반영해야 한다.
describe("describeNotifyFailureHeadline — 재전달 보장 여부로 심각도를 가른다", () => {
  it("재전달이 보장되면(REVIEW 제출, 비미션) 미전달이 아니라 지연으로 적는다", () => {
    const headline = describeNotifyFailureHeadline({
      message: '[Review Submitted] "t" is ready for review (backend, id=t1)',
      isMissionContext: false,
    });
    expect(headline).toContain("[알림 지연]");
    expect(headline).not.toContain("[알림 미전달]");
    expect(headline).not.toContain("⚠️");
  });

  it("재전달이 없으면(미션 티켓) 그대로 미전달 사고로 적는다", () => {
    const headline = describeNotifyFailureHeadline({
      message: '[Review Submitted] "t" is ready for review (backend, id=t1)',
      isMissionContext: true,
    });
    expect(headline).toContain("[알림 미전달]");
    expect(headline).toContain("⚠️");
  });

  it("재전달이 없으면(DONE 전이, 조회 집합 밖) 그대로 미전달 사고로 적는다", () => {
    const headline = describeNotifyFailureHeadline({
      message: '[Task Update] "t" IN_PROGRESS → DONE (backend, id=t1)',
      isMissionContext: false,
    });
    expect(headline).toContain("[알림 미전달]");
  });
});

// ── 6. PTY 거절 사유 — "PTY did not accept" 뭉뚱그림을 걷어낸다 ─────
describe("describeNotifyRefusal — 거절 직후 컴포저 판독을 사람이 읽게 만든다", () => {
  it("컴포저 상태·거절 사유·occupancy 를 모두 실으면 전부 담는다", () => {
    expect(
      describeNotifyRefusal(
        { state: "occupied", refusal: "composer-occupied" },
        "orchestrator-busy",
      ),
    ).toBe(
      "orchestrator PTY did not accept the message — composer=occupied (composer-occupied) cause=orchestrator-busy",
    );
  });

  it("refusal 이 없으면 그 괄호를 붙이지 않는다", () => {
    const reason = describeNotifyRefusal({ state: "occupied" }, null);
    expect(reason).toBe(
      "orchestrator PTY did not accept the message — composer=occupied",
    );
    expect(reason).not.toContain("()");
  });

  it("occupancy 가 없으면(null) cause= 를 붙이지 않는다", () => {
    const reason = describeNotifyRefusal(
      { state: "awaiting-choice", refusal: "awaiting-choice" },
      null,
    );
    expect(reason).not.toContain("cause=");
    expect(reason).toContain("composer=awaiting-choice");
  });
});

describe("RESYNC_ATTENTION_STATUSES — 스위프 조회 집합과 판정의 단일소스", () => {
  const alive = () => true;

  it("목록에 없는 상태는 스위프가 절대 집지 않는다(DONE·TODO 포함)", () => {
    for (const status of ["DONE", "TODO", "REVIEWING", ""]) {
      expect(
        classifyResyncAttention(
          { taskId: "t1", projectId: "p1", status, ageMs: null },
          alive,
          0,
          0,
        ),
      ).toBeNull();
    }
  });

  it("목록에 있는 상태는 (미션이 아니면) 스위프의 관심사다", () => {
    for (const status of RESYNC_ATTENTION_STATUSES) {
      expect(
        classifyResyncAttention(
          {
            taskId: "t1",
            projectId: "p1",
            status,
            ageMs: null,
            claimedBy: null,
          },
          alive,
          0,
          0,
        ),
      ).not.toBeNull();
    }
  });

  it("★미션 티켓이면 목록에 있는 상태여도 제외된다 — 거짓 위로의 근원", () => {
    for (const status of RESYNC_ATTENTION_STATUSES) {
      expect(
        classifyResyncAttention(
          {
            taskId: "t1",
            projectId: "p1",
            status,
            ageMs: null,
            claimedBy: null,
            isMission: true,
          },
          alive,
          0,
          0,
        ),
      ).toBeNull();
    }
  });
});
