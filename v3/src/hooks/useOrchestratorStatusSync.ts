import { useEffect } from "react";
import { useOrchestratorStore } from "../stores/orchestratorStore";
import {
  classifyOrchestratorHalt,
  type OrchestratorStatusEvent,
} from "../lib/orchestratorHalt";

/**
 * `orchestrator:statusChanged` 의 **보드 렌더러 구독자**.
 *
 * ── 왜 이 훅이 새로 필요했나 ─────────────────────────────────────────────
 * 이 채널엔 구독자가 **0** 이었다(실측 F-4: `src/App.tsx` 의 dev IPC 카운터가
 * 유일한 등장이고, 그건 이벤트 수만 세는 계측이다). 그래서 렌더러의 오케 상태는
 * "launch 가 성공 반환했다" 는 한 순간의 스냅샷에 영원히 고정됐고, main 이 뒤에
 * 무슨 일을 겪든 패널은 초록 running 이었다. 사장님이 오늘 아침 보신 화면이
 * 그것이다 — 폴더 신뢰 다이얼로그 위의 초록 점.
 *
 * ── 어디에 다나 ─────────────────────────────────────────────────────────
 * `useOrchestratorAutoLaunch` 안에서 부른다. 그 훅이 **두 셸의 공통 조상**이라서다:
 *   · 마블로(어드밴스드) — `components/Layout.tsx`
 *   · 비기너            — `hooks/useAppLifecycle.ts` → `BeginnerShell`
 * 패널(`OrchestratorPanel`)에 달지 않은 이유는 패널이 언마운트될 수 있기 때문이다
 * (탭 전환·접힘 레이아웃). 상태는 패널이 보이든 말든 최신이어야 한다.
 * ★두 셸이 같은 훅을 타므로 이 한 곳이 비기너까지 함께 고친다 — 비기너에만 있는
 * 별도 런치 경로는 없다(실측 F-5).
 *
 * ── 왜 status 를 통째로 받아 적나 ────────────────────────────────────────
 * "error 만 받자" 가 더 안전해 보이지만 그러면 error 를 벗어나는 신호가 없다.
 * 오케는 크래시 후 자동 재시작(최대 3회)으로 스스로 복구하는데, 그때 main 은
 * starting → running 을 보낸다. 그 둘을 버리면 이미 살아난 오케 위에 빨간 배너가
 * 남는다 — 이 티켓이 고치는 거짓말의 방향만 뒤집은 것이다. 사유를 지우는 일은
 * 스토어의 `setStatus` 가 진다(비-error 로 가면 halt 를 비운다).
 */
export function useOrchestratorStatusSync(): void {
  const setStatus = useOrchestratorStore((s) => s.setStatus);
  const setHalt = useOrchestratorStore((s) => s.setHalt);

  useEffect(() => {
    const api = window.electronAPI?.orchestratorSession;
    if (!api?.onStatusChange) return;

    const dispose = api.onStatusChange((data: OrchestratorStatusEvent) => {
      if (!data || typeof data.status !== "string") return;
      const status = data.status;
      if (
        status !== "stopped" &&
        status !== "starting" &&
        status !== "running" &&
        status !== "error"
      ) {
        // 모르는 상태값은 버린다. 스토어의 상태 축은 넷뿐이고, 낯선 값을 넣으면
        // 패널이 어느 분기로도 안 가서 "회색 점 + 빈 라벨" 이 된다.
        return;
      }
      // 순서가 중요하다: setStatus 가 비-error 에서 halt 를 비우므로, 사유는
      // 그 뒤에 실어야 한다.
      setStatus(status);
      const halt = classifyOrchestratorHalt(data);
      if (halt) setHalt(halt);
    });

    // 해제 함수는 preload 가 준다(제네릭 off 는 removeAllListeners 라 App.tsx 의
    // dev IPC 카운터까지 지운다 — 그래서 쓰면 안 된다).
    return () => {
      dispose?.();
    };
  }, [setStatus, setHalt]);
}
