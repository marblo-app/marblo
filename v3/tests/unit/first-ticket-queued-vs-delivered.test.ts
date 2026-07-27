/**
 * 활성화 F3 — 첫 티켓의 'queued' 를 'delivered' 로 오표기하던 회귀 방지
 * (cleanroom 최초실행 E2E #633 에서 잡힌 무성공 dead-end).
 *
 * 증상: 온보딩 ④ 첫 티켓 버튼이 `routeInstructionToOrchestrator` 의 세 결과 중
 * local 과 queued 를 한데 접어 초록색 "첫 프롬프트를 전달했어요" 를 띄우고
 * success 텔레메트리까지 찍었다. queued 는 **로컬 오케에 못 넣어 Firestore 큐에
 * 쌓아만 둔 상태**라, 그 큐를 소비할 오케스트레이터가 없으면 아무 일도 일어나지
 * 않는다. 신규 유저는 죽은 화면을 성공으로 읽고(모달은 닫히고 단계는 완료로
 * 찍힌 채) 이탈했다.
 *
 * 라이브 확인은 실계정을 요구한다(자동화 E2E 는 mock 이라 큐 쓰기 자체가 실패).
 * 그래서 상태분기를 순수 함수로 뽑아 여기서 못박는다:
 *   1) delivered / queued / failed 의 색조·완료여부·안내·계측이 서로 다르다.
 *   2) createFirstTicket 이 그 분기를 그대로 실어 나른다(queued 는 ok=false).
 * 두 온보딩 표면(레거시 모달 CliSetupGate, 시작하기 탭 StartHereTab)은 모두
 * `result.ok` 로 단계완료/모달닫기를 판단하므로, (2)가 곧 dead-end 차단이다.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  deliveryFromRoute,
  firstTicketView,
  ORCHESTRATOR_HELP_STEP_KEYS,
  ORCHESTRATOR_NOT_RUNNING,
  type FirstTicketDelivery,
} from "../../src/lib/firstTicketDelivery";
import { ko } from "../../src/locales/ko";
import { en } from "../../src/locales/en";

describe("firstTicketView — queued 는 성공도 실패도 아닌 '오케 필요'", () => {
  it("delivered 만 퍼널 결승선(완료·초록·success 계측)이다", () => {
    const v = firstTicketView("delivered");
    expect(v).toEqual({
      tone: "success",
      completesStep: true,
      messageKey: "onboarding.cliGate.firstTicket.sent",
      showOrchestratorHelp: false,
      telemetry: { phase: "success" },
    });
  });

  it("★queued 는 단계를 완료로 찍지 않고, 경고 색조 + 오케 안내를 요구한다", () => {
    const v = firstTicketView("queued");
    expect(v.completesStep).toBe(false); // ← 회귀 지점: 예전엔 true 였다
    expect(v.tone).toBe("warning"); // 초록(성공)도 빨강(실패)도 아니다
    expect(v.showOrchestratorHelp).toBe(true); // 다음 액션을 반드시 안내
    expect(v.messageKey).toBe("onboarding.cliGate.firstTicket.queued");
    expect(v.messageKey).not.toBe("onboarding.cliGate.firstTicket.sent");
  });

  it("queued 는 success 로 계상되지 않는다 — 사유가 실린 fail(이탈 지점 식별)", () => {
    expect(firstTicketView("queued").telemetry).toEqual({
      phase: "fail",
      reason: ORCHESTRATOR_NOT_RUNNING,
    });
  });

  it("failed 는 실패 색조이되 오케 안내는 붙지 않는다(큐 적재조차 실패한 경우)", () => {
    const v = firstTicketView("failed");
    expect(v.tone).toBe("error");
    expect(v.completesStep).toBe(false);
    expect(v.showOrchestratorHelp).toBe(false);
    expect(v.telemetry.phase).toBe("fail");
  });

  it("세 결과의 문구 키가 서로 다르다(어느 둘도 같은 화면이 아니다)", () => {
    const keys = (
      ["delivered", "queued", "failed"] as FirstTicketDelivery[]
    ).map((d) => firstTicketView(d).messageKey);
    expect(new Set(keys).size).toBe(3);
  });

  it("RouteResult 어휘 매핑: local→delivered, queued/failed 는 그대로", () => {
    expect(deliveryFromRoute("local")).toBe("delivered");
    expect(deliveryFromRoute("queued")).toBe("queued");
    expect(deliveryFromRoute("failed")).toBe("failed");
  });
});

describe("오케 띄우는 법 안내 문구", () => {
  it("ko·en 양쪽에 실제 문구가 있다(키 누락으로 빈 안내가 되지 않는다)", () => {
    const keys = [
      ...ORCHESTRATOR_HELP_STEP_KEYS,
      "onboarding.cliGate.firstTicket.needOrch.title",
      "onboarding.cliGate.firstTicket.needOrch.crossMachine",
      "onboarding.cliGate.firstTicket.queued",
    ] as const;
    for (const key of keys) {
      expect(ko[key]?.length ?? 0).toBeGreaterThan(0);
      expect(en[key]?.length ?? 0).toBeGreaterThan(0);
    }
  });

  it("안내는 비어 있지 않고, 오케 기동(Start)을 실제로 지시한다", () => {
    expect(ORCHESTRATOR_HELP_STEP_KEYS.length).toBeGreaterThan(0);
    const body = ORCHESTRATOR_HELP_STEP_KEYS.map((k) => ko[k]).join(" ");
    expect(body).toContain("Start"); // 패널의 실제 버튼 라벨
  });

  it("queued 문구가 '전달했어요' 로 읽히지 않는다", () => {
    expect(ko["onboarding.cliGate.firstTicket.queued"]).not.toContain(
      "전달했어요",
    );
    expect(ko["onboarding.cliGate.firstTicket.queued"]).toContain("대기열");
  });
});

// ── createFirstTicket 특성화 ────────────────────────────────────────────────
// 서비스 계층이 위 분기를 그대로 실어 나르는지. 두 온보딩 표면이 보는 것은
// {ok, delivery, text} 뿐이라 여기까지 검증하면 화면 판단의 입력이 고정된다.

const route = vi.fn();
const cliSetupStep = vi.fn();
let currentProject: { id?: string } | null = { id: "proj-1" };

vi.mock("../../src/services/orchestratorInstructionService", () => ({
  routeInstructionToOrchestrator: (...args: unknown[]) => route(...args),
}));
vi.mock("../../src/stores/projectStore", () => ({
  useProjectStore: { getState: () => ({ currentProject }) },
}));
vi.mock("../../src/stores/editorStore", () => ({
  useEditorStore: { getState: () => ({}) },
}));
vi.mock("../../src/stores/terminalStore", () => ({
  useTerminalStore: { getState: () => ({}) },
}));
vi.mock("../../src/stores/cliSetupStore", () => ({
  useCliSetupStore: { getState: () => ({}) },
  cliLabel: () => "Claude",
  ROWS: [],
}));
vi.mock("../../src/services/telemetryService", () => ({
  default: { cliSetupStep: (...args: unknown[]) => cliSetupStep(...args) },
}));

const { createFirstTicket } =
  await import("../../src/services/cliSetupActions");

describe("createFirstTicket", () => {
  beforeEach(() => {
    route.mockReset();
    cliSetupStep.mockReset();
    currentProject = { id: "proj-1" };
  });

  it("local(오케가 실제로 받음) → ok=true, delivered, success 계측", async () => {
    route.mockResolvedValue("local");

    const res = await createFirstTicket();

    expect(res.delivery).toBe("delivered");
    expect(res.ok).toBe(true);
    expect(res.text).toBe(ko["onboarding.cliGate.firstTicket.sent"]);
    expect(cliSetupStep).toHaveBeenCalledWith(
      "firstTicket",
      "success",
      undefined,
    );
  });

  it("★queued(오케 없음) → ok=false — 단계완료·모달닫기가 일어나지 않는다", async () => {
    route.mockResolvedValue("queued");

    const res = await createFirstTicket();

    expect(res.delivery).toBe("queued");
    expect(res.ok).toBe(false); // ← StartHereTab.markDone / CliSetupGate 닫기 차단
    expect(res.text).toBe(ko["onboarding.cliGate.firstTicket.queued"]);
    expect(cliSetupStep).toHaveBeenCalledWith(
      "firstTicket",
      "fail",
      ORCHESTRATOR_NOT_RUNNING,
    );
    // 퍼널 결승선을 부풀리지 않는다.
    expect(cliSetupStep).not.toHaveBeenCalledWith(
      "firstTicket",
      "success",
      expect.anything(),
    );
  });

  it("failed(큐 적재까지 실패) → ok=false, launch_error", async () => {
    route.mockResolvedValue("failed");

    const res = await createFirstTicket();

    expect(res.delivery).toBe("failed");
    expect(res.ok).toBe(false);
    expect(cliSetupStep).toHaveBeenCalledWith(
      "firstTicket",
      "fail",
      "launch_error",
    );
  });

  it("라우팅이 throw 해도 failed 로 떨어진다(성공으로 새지 않는다)", async () => {
    route.mockRejectedValue(new Error("ipc boom"));

    const res = await createFirstTicket();

    expect(res.ok).toBe(false);
    expect(res.delivery).toBe("failed");
  });

  it("폴더 미연결 → 전송 시도 없이 ③단계 안내(오케 안내는 붙지 않음)", async () => {
    currentProject = null;

    const res = await createFirstTicket();

    expect(route).not.toHaveBeenCalled();
    expect(res.ok).toBe(false);
    expect(res.delivery).toBe("failed");
    expect(firstTicketView(res.delivery).showOrchestratorHelp).toBe(false);
    expect(res.text).toBe(ko["onboarding.cliGate.firstTicket.needProject"]);
  });
});
