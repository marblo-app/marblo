import {
  memo,
  useCallback,
  useEffect,
  useMemo,
  useSyncExternalStore,
} from "react";
import TerminalView from "../terminal/TerminalView";
import { StateBlock } from "../common/StateBlock";
import { useTranslation } from "../../lib/i18n";
import {
  OrchestratorBootGate,
  type BootGateState,
  type PtyOutputGate,
} from "../../lib/orchestratorBootGate";

interface OrchestratorTerminalProps {
  sessionId: string;
  panelHeight?: number;
  status?: string;
  onUserSubmit?: (text: string) => void;
  /**
   * 비기너 대화창(티켓 fDceJJvz3eam2PMNOWyB): 오케가 사람에게 처음 말하기 전까지
   * PTY 부트 출력(CLI 배너·`permissions: YOLO mode`·주입 프롬프트 에코·
   * `/var/folders/…` 경로·tool call 과 반환 본문)을 xterm 에 쓰지 않고, 그 자리에
   * 로딩 골격을 그린다. 규칙은 `lib/orchestratorBootGate`, 적용 지점은
   * `TerminalView.outputGate`. ★마블로(엑스퍼트)는 이 prop 을 주지 않는다 —
   * 거기서는 원시 출력이 진단에 쓰인다.
   */
  gateBootOutput?: boolean;
  /**
   * 게이트를 강제로 연다 — 로그인·첫 실행 다이얼로그처럼 **사용자가 원시 화면에
   * 답해야 풀리는** 멈춤(`orchestratorHaltKeepsTerminal`)일 때. 그때까지의 부트
   * 출력은 여전히 버린다; 현재 프레임은 리페인트 넛지가 되살린다.
   */
  gateBypass?: boolean;
}

const NO_GATE_SUBSCRIBE = () => () => {};
const GATE_OPEN: BootGateState = "open";

/**
 * 오케가 말하기 전의 자리 — 빈 화면도 원시 로그도 아닌 **로딩 상태**(#1135).
 * `StateBlock` 의 loading 은 최종 높이(패널 전체)와 같은 골격을 지키고, 5초가 넘으면
 * "계속 시도 중" 을 골격 위에 겹친다(높이 불변). 위에 한 줄 "준비하고 있어요".
 */
function BootGateOverlay({
  state,
  since,
}: {
  state: BootGateState;
  since: number | null;
}) {
  const { t } = useTranslation();
  return (
    <div
      data-testid="orchestrator-boot-gate"
      data-gate-state={state}
      className="absolute inset-0 z-10 flex flex-col bg-[#1e1e2e] p-3"
    >
      <StateBlock
        variant="block"
        state={{ kind: "loading", since: since ?? undefined }}
        minHeight="100%"
        skeletonLines={5}
        className="h-full"
      >
        {() => null}
      </StateBlock>
      <p
        role="status"
        className="pointer-events-none absolute inset-x-0 top-4 text-center text-xs text-secondary"
      >
        {t("beginner.chat.preparing")}
      </p>
    </div>
  );
}

export default memo(function OrchestratorTerminal({
  sessionId,
  status,
  onUserSubmit,
  gateBootOutput = false,
  gateBypass = false,
}: OrchestratorTerminalProps) {
  // 세션당 게이트 하나. TerminalView 는 sessionId 가 바뀔 때만 init 이펙트를 다시
  // 돌리므로 게이트도 같은 키로 만든다 — 리마운트(모드 전환)마다 replay 가 처음부터
  // 다시 오고, 그때 TerminalView 가 `reset()` 으로 판정을 처음부터 다시 한다.
  const gate = useMemo<PtyOutputGate | undefined>(
    () =>
      gateBootOutput
        ? // sid 를 넘겨야 게이트가 "이 PTY 는 이미 부트를 지났다" 를 알아본다
          // (티켓 vnJWQrrfdLoXPR13rx1B) — 리마운트가 0바이트여도 갇히지 않는다.
          new OrchestratorBootGate({ sessionId })
        : undefined,
    [sessionId, gateBootOutput],
  );
  useEffect(() => () => gate?.dispose(), [gate]);
  useEffect(() => {
    if (gate && gateBypass) gate.open("forced");
  }, [gate, gateBypass]);
  const subscribeGate = useCallback(
    (cb: () => void) => (gate ? gate.subscribe(cb) : NO_GATE_SUBSCRIBE()),
    [gate],
  );
  const gateState = useSyncExternalStore(
    subscribeGate,
    () => gate?.state ?? GATE_OPEN,
    () => GATE_OPEN,
  );

  return (
    <>
      <TerminalView
        sessionId={sessionId}
        isActive
        activityState={status}
        onUserSubmit={onUserSubmit}
        outputGate={gate}
      />
      {gate && gateState !== "open" && (
        <BootGateOverlay state={gateState} since={gate.armedAt} />
      )}
    </>
  );
});
