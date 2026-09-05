/**
 * 오케 알림의 **수신자 선택**과 폴백 (티켓 B0G7agMgarQPqIYEc3Jq).
 *
 * ── 왜 이 모듈이 생겼나 ─────────────────────────────────────────────────────
 * `/notify-orchestrator` 는 `resolveNotifyTarget(contextId)` 로 board/mission
 * 두 풀 중 하나를 고른 뒤, 그 풀에 running 세션이 없으면 **알림을 버렸다**.
 * 미션 컨텍스트에서 이게 치명적이다:
 *
 *   · `missionOrchestrators` 맵(main.ts)은 Missions 탭 PTY 패널이나 미션 엔진이
 *     **명시적으로 launch 할 때만** 채워진다.
 *   · 그런데 암묵 미션(Mission Replay 라벨)은 **보드 오케가 dispatch 로 만든다** —
 *     미션 오케를 띄우는 경로가 아예 없다. 그 티켓들의 contextId 는 missionId 라
 *     라우팅은 mission 을 가리키는데 수신자 맵은 영원히 비어 있다.
 *   · 결과: 그 미션 티켓의 **모든** 알림(전진 신호·[Review Submitted]·
 *     [Task Update] DONE/FAILED/BLOCKED·[질문])이 조용히 사라졌다. 2026-09-05
 *     라이브 실측에서 SIGNAL_ADVANCE 와 [Review Submitted] 가 같은 자리에서
 *     dropped 됐다.
 *
 * ── 폴백이 안전한 이유 ──────────────────────────────────────────────────────
 * 원래 drop 은 "미션 진행 잡음이 보드 오케 PTY 를 오염시키는 것" 을 막으려는
 * 것이었다. 그런데 `shouldInjectOrchestratorNotification` 억제 게이트는 수신자
 * 조회보다 **먼저** 돈다 — 여기 도달하는 것은 이미 "오케가 행동해야 하는" 알림
 * 뿐이다(진행 보고는 그 위에서 timeline-only 로 떨어진다). 게다가 폴백은 미션
 * 오케가 **하나도 안 도는 순간에만** 발동한다. 즉 폴백의 대안은 "깨끗한 보드
 * 오케" 가 아니라 **아무도 안 받음** 이다. 버리는 것보다 늘 낫다.
 *
 * ── 방향은 한쪽뿐 ───────────────────────────────────────────────────────────
 * mission → board 폴백만 있고 board → mission 폴백은 **없다**. 미션 오케는
 * 포커스된 미션 하나에 종속된 세션이라(ensureMissionOrchestratorLaunched 의
 * getOwnerMissionId 교체 규칙), 보드 전반의 알림을 거기로 흘리면 그게 정확히
 * 이 라우팅이 막으려던 오염이다.
 *
 * 순수 모듈 — electron 도 firebase 도 import 하지 않는다. 판정만 여기 있고
 * PTY 주입과 관찰자 호출은 bridge-server 가 한다.
 */

/** `/notify-orchestrator` 가 고르는 두 오케 풀. */
export type NotifyTarget = "board" | "mission";

export interface NotifyRecipientInput {
  /** `resolveNotifyTarget(contextId)` 의 결과 — 컨텍스트가 **원하는** 풀. */
  requestedTarget: NotifyTarget;
  /** 이 프로젝트의 미션 오케에 running 세션이 있는가. */
  missionOrchRunning: boolean;
  /** 이 프로젝트의 보드 오케에 running 세션이 있는가. */
  boardOrchRunning: boolean;
}

export type NotifyRecipientDecision =
  | {
      outcome: "deliver";
      /** 실제로 주입할 풀. */
      deliverTo: NotifyTarget;
      /** 원하던 풀이 비어 폴백을 탔는가. */
      viaFallback: boolean;
      /** 폴백일 때만 채워진다 — 사람이 읽는 사유. */
      fallbackReason?: string;
    }
  | {
      outcome: "undeliverable";
      requestedTarget: NotifyTarget;
      /** 왜 아무 데도 못 보내는지. 절대 비어 있지 않다(조용한 유실 금지). */
      reason: string;
    };

/**
 * 수신자 1명을 고른다. ★`undeliverable` 은 "버려도 된다" 가 아니라
 * "사람이 볼 곳에 남겨야 한다" 는 뜻이다 — 호출부가 관찰자에게 흘린다.
 */
export function chooseNotifyRecipient(
  input: NotifyRecipientInput,
): NotifyRecipientDecision {
  const { requestedTarget, missionOrchRunning, boardOrchRunning } = input;

  if (requestedTarget === "mission") {
    if (missionOrchRunning) {
      return { outcome: "deliver", deliverTo: "mission", viaFallback: false };
    }
    if (boardOrchRunning) {
      return {
        outcome: "deliver",
        deliverTo: "board",
        viaFallback: true,
        fallbackReason:
          "미션 오케가 실행 중이 아니라 보드 오케로 전달했습니다 " +
          "(암묵 미션은 보드 오케가 운전하므로 이쪽이 실제 수신자입니다)",
      };
    }
    return {
      outcome: "undeliverable",
      requestedTarget,
      reason:
        "미션 오케도 보드 오케도 실행 중이 아닙니다 — 이 프로젝트에 알림을 받을 오케가 없습니다",
    };
  }

  if (boardOrchRunning) {
    return { outcome: "deliver", deliverTo: "board", viaFallback: false };
  }
  // ★보드 → 미션 폴백은 만들지 않는다(모듈 주석 "방향은 한쪽뿐").
  return {
    outcome: "undeliverable",
    requestedTarget,
    reason: "보드 오케가 실행 중이 아닙니다",
  };
}

/**
 * 폴백으로 흘러들어온 알림 앞에 붙는 한 줄. 보드 오케(와 PTY 를 보는 사람)가
 * "이건 원래 미션 오케 것" 임을 알아야 판단이 어긋나지 않는다 — 배달 사실을
 * 조용히 감추지 않는 것이 이 티켓의 요구사항이다.
 */
export function formatFallbackBanner(contextId: string): string {
  const ctx = contextId.trim() || "(unknown)";
  return (
    `⤵ [미션 알림 폴백] 미션 컨텍스트(contextId=${ctx}) 의 오케가 실행 중이 아니라 ` +
    `보드 오케에 전달합니다. 이 미션은 지금 보드 오케가 운전합니다.`
  );
}
