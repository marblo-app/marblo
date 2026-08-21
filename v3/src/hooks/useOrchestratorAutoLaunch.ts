import { useCallback, useEffect, useRef } from "react";
import { useProjectStore } from "../stores/projectStore";
import { useOrchestratorStore } from "../stores/orchestratorStore";
import {
  cleanupLegacyOrchestratorDocs,
  upsertOrchestratorAgentDoc,
} from "../services/orchestratorAgentDoc";
import telemetry from "../services/telemetryService";
import {
  orchestratorKey,
  orchestratorTeardownAction,
} from "../lib/orchestratorTeardown";
import { planOrchestratorBlockUi } from "../lib/orchestratorLaunchBlock";
import { reportOnrampExecBlocked } from "../services/onrampBlockSignal";
import { useOrchestratorStatusSync } from "./useOrchestratorStatusSync";

/**
 * - Stops the orchestrator when project/folder changes or unmounts.
 * - Auto-reconnects to the latest orchestrator session on mount
 *   (e.g., after page reload or session restore).
 *
 * The orchestrator lifecycle is bound to the project's FIXED root
 * (currentProject.folderPath), NOT to editorStore.rootPath (the path the
 * editor/file-tree is currently viewing). Merely opening a worktree for
 * inspection moves rootPath (WorktreeTab/TaskCard), and keying off it would
 * tear down and relaunch the running orchestrator in a different
 * claudeProjectDir — destroying its conversation context. Keying off
 * folderPath keeps the orchestrator stable across worktree browsing while
 * still tearing down on a genuine project switch.
 */
export function useOrchestratorAutoLaunch() {
  // main 의 상태 변화를 렌더러 스토어로 흘린다. 여기 다는 이유는 이 훅이 마블로
  // 셸(Layout)과 비기너 셸(useAppLifecycle)의 **공통 조상**이라서다 — 한 곳에
  // 달면 두 모드가 같이 고쳐진다(useOrchestratorStatusSync 주석).
  useOrchestratorStatusSync();
  const currentProject = useProjectStore((s) => s.currentProject);
  // Project fixed root — see header comment. Falls back to null when the
  // project has no folder bound (orchestrator can't run without a root).
  const fixedRoot = currentProject?.folderPath ?? null;
  const clear = useOrchestratorStore((s) => s.clear);
  const prevKeyRef = useRef<string | null>(null);
  const autoConnectRef = useRef(false);

  // Teardown on project/folder change.
  //
  // ★UNMOUNT IS NOT A PROJECT SWITCH. See orchestratorTeardownAction for why
  // the cleanup below must never stop the orchestrator: this effect's cleanup
  // fires on every unmount, and in dev the dominant cause is a Vite FULL PAGE
  // RELOAD, which used to kill the boss's live session on any file edit.
  useEffect(() => {
    const key = orchestratorKey(currentProject?.id, fixedRoot);

    const onKeyChange = orchestratorTeardownAction(
      "key-change",
      prevKeyRef.current,
      key,
    );
    if (onKeyChange.stopOrchestrator) {
      window.electronAPI.orchestratorSession.stop().catch(() => {});
    }
    if (onKeyChange.clearStore) {
      clear();
      autoConnectRef.current = false;
    }
    prevKeyRef.current = key;

    return () => {
      const onUnmount = orchestratorTeardownAction("unmount", key, key);
      if (onUnmount.stopOrchestrator) {
        window.electronAPI.orchestratorSession.stop().catch(() => {});
      }
      if (onUnmount.clearStore) clear();
    };
  }, [currentProject?.id, fixedRoot, clear]);

  // Auto-reconnect: separate effect so status changes don't trigger cleanup
  const setSession = useOrchestratorStore((s) => s.setSession);
  const setStatus = useOrchestratorStore((s) => s.setStatus);
  const setLaunchBlock = useOrchestratorStore((s) => s.setLaunchBlock);
  const confirmLaunched = useOrchestratorStore((s) => s.confirmLaunched);

  const tryAutoConnect = useCallback(async () => {
    const projectId = currentProject?.id;
    if (!projectId || !fixedRoot) return;

    // One-time legacy cleanup: drop the per-launch orchestrator-<timestamp>
    // docs that accumulated before the stable-ID migration. Best-effort —
    // a failure here must not block auto-reconnect.
    cleanupLegacyOrchestratorDocs(projectId).catch(() => undefined);

    try {
      // Resolve the prior orchestrator session via label OR content
      // signature (works even when marblo-labels.json is missing, which is
      // the common case). Fall back to "new" only when there is genuinely
      // no prior orchestrator session.
      const priorId =
        await window.electronAPI.orchestratorSession.resolvePrevious(
          fixedRoot,
          projectId,
        );
      const resumeId = priorId ?? "new";

      setStatus("starting");
      const result = await window.electronAPI.orchestratorSession.launch(
        projectId,
        fixedRoot,
        resumeId,
      );
      // Blocked on CLI auth — surface the setup gate (Claude-first) rather than
      // auto-looping a spawn that will keep hitting the login prompt. Release
      // the auto-connect latch so that once the user authenticates, the gate's
      // `marblo:cli-auth-ready` event can resume the launch without a restart.
      if (result?.needsAuth) {
        // ★첫 스폰 실패 사유의 최상단 후보: 오케 자동오픈이 CLI 미설치/미인증에
        // 막힘. 근본원인 분석 22→6(−73%)에서 "시도했으나 CLI 미설치"를 정확히
        // 잡는 지점 — 이게 없으면 "시도조차 안 함"과 구분 불가.
        telemetry.orchestratorBlocked("cli_auth");
        setStatus("stopped");
        autoConnectRef.current = false;
        // 자동기동 경로에서도 패널 배너는 항상 세운다 — 위저드는 자기 판단으로
        // 억제될 수 있고(claude 는 준비됐는데 저장된 오케가 grok 인 경우),
        // 그러면 사용자는 "오케가 그냥 안 뜬다" 만 겪는다.
        const ui = planOrchestratorBlockUi(result.needsAuth);
        if (ui.showPanelNotice) setLaunchBlock(ui.block);
        if (ui.openCliSetup) {
          window.dispatchEvent(new CustomEvent("marblo:open-cli-setup"));
        }
        // ★온램프 축(설계 #886 §5-A 의 트리거 ②: "오케 자동기동이 needsAuth 로
        // 반환"). 배너·위저드는 이미 있는 유저를 위한 것이고, 아직 계정이 없는
        // 유저에게 처음 말을 거는 것이 M1 이다.
        reportOnrampExecBlocked(result.needsAuth, "spawn_needs_auth");
        return;
      }
      if (result) {
        // 첫 에이전트(오케스트레이터)가 실제로 뜬 순간. resumed=이전 세션 재접속.
        telemetry.orchestratorOpened(!!priorId);
        setSession(result.sessionId, result.ptySessionId);
        // ★`setStatus("running")` 이 아니다 — main 이 이미 정지 사유를 보낸 뒤라면
        // 무시해야 한다(codex 미인증은 스폰 445ms 에 이미 error 다).
        confirmLaunched();
        // Mirror the manual-Start path: upsert the canonical orchestrator
        // agent doc so the Activity feed's agentId filter accepts events
        // emitted by this auto-reconnected session.
        upsertOrchestratorAgentDoc(projectId, "working").catch(() => undefined);
        console.debug(
          priorId
            ? `[Orchestrator] Auto-reconnected: ${priorId}`
            : `[Orchestrator] Auto-started fresh session (no prior session)`,
        );
      }
    } catch {
      // No previous session or launch failed — user starts manually. Distinct
      // from cli_auth: an exception here means the launch itself threw (spawn
      // env, resolve error) rather than a clean needsAuth signal.
      telemetry.orchestratorBlocked("launch_error");
      setStatus("stopped");
    }
  }, [
    currentProject?.id,
    fixedRoot,
    setSession,
    setStatus,
    setLaunchBlock,
    confirmLaunched,
  ]);

  useEffect(() => {
    if (autoConnectRef.current || !currentProject?.id || !fixedRoot) return;
    autoConnectRef.current = true;
    void tryAutoConnect();
  }, [currentProject?.id, fixedRoot, tryAutoConnect]);

  // Resume auto-launch after the CLI setup gate reports Claude just became
  // authenticated. The needsAuth branch above released the latch, so a fresh
  // launch attempt here opens the orchestrator with no manual re-check — the
  // orchestrator-first onboarding flow (folder → project → auth → orchestrator).
  useEffect(() => {
    const onAuthReady = () => {
      if (autoConnectRef.current || !currentProject?.id || !fixedRoot) return;
      autoConnectRef.current = true;
      void tryAutoConnect();
    };
    window.addEventListener("marblo:cli-auth-ready", onAuthReady);
    return () =>
      window.removeEventListener("marblo:cli-auth-ready", onAuthReady);
  }, [currentProject?.id, fixedRoot, tryAutoConnect]);
}
