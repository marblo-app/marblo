import type { MessageKey } from "../locales/ko";

/**
 * 온보딩 ④ "첫 티켓" 의 전달 결과 → 화면·퍼널 해석 (활성화 F3, cleanroom E2E #633).
 *
 * ── 왜 이 모듈이 따로 있나 ────────────────────────────────────────────────────
 * `routeInstructionToOrchestrator` 는 세 결과를 정직하게 돌려준다:
 *   local  — 이 앱의 오케에 in-process inject 가 **실제로 커밋**됨(진짜 전달)
 *   queued — 커밋 못 함(로컬 오케 없음/미실행) → Firestore `pendingInstructions`
 *            에 넣어 둔 것뿐. 그 큐를 **소비할 오케가 어디에도 없으면 아무 일도
 *            일어나지 않는다.**
 *   failed — 큐 적재까지 실패
 * 그런데 온보딩만 local 과 queued 를 같은 "전달했어요" 로 접고 있었다. 신규
 * 유저는 오케가 안 떠 있는 상태에서 그 초록 문구를 보고 "됐구나" 하고 기다리다
 * 아무 것도 안 일어나는 화면에서 이탈한다(무성공 dead-end). 같은 전송 경로를
 * 쓰는 diff 코멘트는 이미 `sentLocal` / `sentQueued` 로 구분해 왔다 — 접혀 있던
 * 것은 활성화 퍼널의 결승선인 이 화면뿐이었다.
 *
 * 표시 규칙을 컴포넌트가 아니라 여기 순수 함수로 둔 이유: 같은 규칙을 두 표면
 * (레거시 모달 CliSetupGate / 시작하기 탭 StartHereTab)이 공유해야 하고, 라이브
 * 확인이 실계정을 요구하는 구간이라 **분기 자체는 유닛테스트로 못박아야** 하기
 * 때문이다(자동화 E2E 는 mock 이라 큐 쓰기가 실패한다).
 */
export type FirstTicketDelivery = "delivered" | "queued" | "failed";

export interface FirstTicketView {
  /** 결과 문구 색조. queued 는 성공(초록)도 실패(빨강)도 아닌 경고(노랑)다. */
  tone: "success" | "warning" | "error";
  /**
   * 활성화 퍼널의 결승선(아하 모먼트)에 도달했는가.
   * ★queued 는 false — 오케가 실제로 받은 적이 없으므로 "첫 티켓 완료" 로
   * 기록하거나(StartHereTab.markDone) 마법사를 닫아 버리면(CliSetupGate) 유저는
   * 다시 돌아올 길 없이 아무 일도 안 일어난 화면에 남는다.
   */
  completesStep: boolean;
  /** 결과 문구 키. */
  messageKey: MessageKey;
  /** 오케(큐 소비자)를 띄우는 방법 안내를 함께 보여야 하는가. */
  showOrchestratorHelp: boolean;
  /**
   * 퍼널 계측. queued 를 success 로 계상하면 "첫 티켓 도달률" 이 부풀어 F3 같은
   * 이탈이 지표에서 사라진다 — 그래서 사유를 실은 fail 로 계상한다.
   */
  telemetry: { phase: "success" | "fail"; reason?: string };
}

/** 오케 미기동으로 큐에만 쌓인 경우의 계측 사유(=활성화 이탈 지점 식별자). */
export const ORCHESTRATOR_NOT_RUNNING = "orchestrator_not_running";

const VIEWS: Record<FirstTicketDelivery, FirstTicketView> = {
  delivered: {
    tone: "success",
    completesStep: true,
    messageKey: "onboarding.cliGate.firstTicket.sent",
    showOrchestratorHelp: false,
    telemetry: { phase: "success" },
  },
  queued: {
    tone: "warning",
    completesStep: false,
    messageKey: "onboarding.cliGate.firstTicket.queued",
    showOrchestratorHelp: true,
    telemetry: { phase: "fail", reason: ORCHESTRATOR_NOT_RUNNING },
  },
  failed: {
    tone: "error",
    completesStep: false,
    messageKey: "onboarding.cliGate.firstTicket.failed",
    showOrchestratorHelp: false,
    telemetry: { phase: "fail", reason: "launch_error" },
  },
};

export function firstTicketView(
  delivery: FirstTicketDelivery,
): FirstTicketView {
  return VIEWS[delivery];
}

/**
 * `RouteResult`("local" | "queued" | "failed") → 이 모듈의 어휘.
 *
 * 문자열 유니온을 여기 다시 적은 것은 중복이 아니라 경계다: `src/lib` 는 서비스
 * 계층(Firestore/IPC 를 만지는 `services/orchestratorInstructionService`)에
 * 의존하지 않는다. 두 어휘가 어긋나면 호출부에서 타입 에러가 난다.
 */
export function deliveryFromRoute(
  route: "local" | "queued" | "failed",
): FirstTicketDelivery {
  if (route === "local") return "delivered";
  return route;
}

/**
 * "오케를 어떻게 띄우나" 안내 — 순서가 곧 유저가 밟아야 할 순서다. 문구를 여기
 * 목록으로 둬서 두 표면이 같은 안내를 렌더하고, 테스트가 "queued 인데 안내가
 * 비어 있다" 를 잡을 수 있게 한다.
 */
export const ORCHESTRATOR_HELP_STEP_KEYS = [
  "onboarding.cliGate.firstTicket.needOrch.step1",
  "onboarding.cliGate.firstTicket.needOrch.step2",
  "onboarding.cliGate.firstTicket.needOrch.step3",
] as const satisfies readonly MessageKey[];
