import { useCallback, useEffect, useRef } from "react";
import { useProjectStore } from "../stores/projectStore";
import { useOrchestratorStore } from "../stores/orchestratorStore";
import {
  cleanupLegacyOrchestratorDocs,
  upsertOrchestratorAgentDoc,
} from "../services/orchestratorAgentDoc";
import telemetry from "../services/telemetryService";

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
  const currentProject = useProjectStore((s) => s.currentProject);
  // Project fixed root — see header comment. Falls back to null when the
  // project has no folder bound (orchestrator can't run without a root).
  const fixedRoot = currentProject?.folderPath ?? null;
  const clear = useOrchestratorStore((s) => s.clear);
  const prevKeyRef = useRef<string | null>(null);
  const autoConnectRef = useRef(false);

  // Teardown on project/folder change
  useEffect(() => {
    const projectId = currentProject?.id;
    const key = projectId && fixedRoot ? `${projectId}:${fixedRoot}` : null;

    if (prevKeyRef.current && prevKeyRef.current !== key) {
      window.electronAPI.orchestratorSession.stop().catch(() => {});
      clear();
      autoConnectRef.current = false;
    }
    prevKeyRef.current = key;

    return () => {
      window.electronAPI.orchestratorSession.stop().catch(() => {});
      clear();
    };
  }, [currentProject?.id, fixedRoot, clear]);

  // Auto-reconnect: separate effect so status changes don't trigger cleanup
  const setSession = useOrchestratorStore((s) => s.setSession);
  const setStatus = useOrchestratorStore((s) => s.setStatus);

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
        window.dispatchEvent(new CustomEvent("marblo:open-cli-setup"));
        return;
      }
      if (result) {
        // 첫 에이전트(오케스트레이터)가 실제로 뜬 순간. resumed=이전 세션 재접속.
        telemetry.orchestratorOpened(!!priorId);
        setSession(result.sessionId, result.ptySessionId);
        setStatus("running");
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
  }, [currentProject?.id, fixedRoot, setSession, setStatus]);

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
