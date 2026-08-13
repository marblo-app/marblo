import { useEffect, useRef } from "react";
import {
  AUTO_INSTALL_KEY,
  initialWizardStep,
  requiredInstalled as computeRequiredInstalled,
  resolveGateVisibility,
  shouldOpenGateOnReopen,
  shouldShowPostAuthStep,
  type WizardStep,
} from "../lib/cliSetupGate";
import {
  ORCHESTRATOR_CLI_IDS,
  useCliSetupStore,
} from "../stores/cliSetupStore";
import {
  isOnboardingDismissed,
  setOnboardingDismissed,
} from "../stores/onboardingProgressStore";
import { useProjectStore } from "../stores/projectStore";
import telemetry from "../services/telemetryService";

/**
 * The CLI setup engine's EFFECTS — first-run probe + background auto-install,
 * the `marblo:open-cli-setup` re-open request, the sign-in auto-recheck poll,
 * and the `marblo:cli-auth-ready` hand-off to useOrchestratorAutoLaunch.
 *
 * Lifted verbatim out of CliSetupGate.tsx (only the surface-specific bits are
 * now callbacks) so the legacy modal and the split shell's Start Here tab run
 * the SAME logic — including the three guards that each cost a live bug:
 *   - #579  readiness is Claude OR Codex (`.some`, via lib/cliSetupGate)
 *   - nB4eenxP  a re-open request re-probes first and only surfaces when the
 *     orchestrator set is genuinely not ready (a restart-restored PTY can make
 *     agent-manager emit a spurious agent:needsAuth)
 *   - bRABKQX7  the post-auth advance honors a prior dismissal, because the
 *     false→true ready edge also fires on every restart
 *
 * ★ Mount this EXACTLY ONCE per window. Two mounts would run two auto-install
 * passes. The split shell mounts it in the always-present inline banner host;
 * the legacy Layout mounts it in CliSetupGate. Only one of those trees exists
 * at a time (workspace-mode flag).
 */
export interface CliSetupEngineHandlers {
  /**
   * Surface the setup UI at `step` — a blocked launch, or a first run that
   * still needs attention. The modal opens itself; the tab shows a banner.
   */
  openAt: (step: WizardStep) => void;
  /** Setup is no longer needed mid-session (auth completed with a project). */
  close?: () => void;
  /**
   * First run, freshly authenticated, no project yet: keep onboarding moving
   * toward the first ticket. Only called when the user has NOT dismissed.
   */
  showPostAuth?: (step: WizardStep) => void;
}

function readFlag(key: string): boolean {
  try {
    return localStorage.getItem(key) === "1";
  } catch {
    return false; // private mode — treat as unset
  }
}

/**
 * prd-step success telemetry: fires once on the false→true edge of
 * `hasProject` while the user is actually on the PRD step (connecting a folder
 * auto-launches the orchestrator via useOrchestratorAutoLaunch). Shared so the
 * modal and the tab report the same funnel event on the same condition.
 */
export function useStepPrdSuccess(
  onPrdStep: boolean,
  hasProject: boolean,
): void {
  const prev = useRef(hasProject);
  useEffect(() => {
    if (onPrdStep && hasProject && !prev.current) {
      telemetry.cliSetupStep("prd", "success");
    }
    prev.current = hasProject;
  }, [onPrdStep, hasProject]);
}

export function useCliSetupEngine(handlers: CliSetupEngineHandlers): void {
  const probeAll = useCliSetupStore((s) => s.probeAll);
  const refreshVersions = useCliSetupStore((s) => s.refreshVersions);
  const ready = useCliSetupStore((s) => s.ready);
  const loginRunning = useCliSetupStore((s) => s.loginRunning);
  const setLoginRunning = useCliSetupStore((s) => s.setLoginRunning);

  // Keep handlers in a ref so a caller re-creating them each render never
  // re-runs the one-shot auto-install effect.
  const hRef = useRef(handlers);
  hRef.current = handlers;

  // Orchestrator-first onboarding: before a project/folder is connected the
  // engine must not surface anything blocking. Live ref because the
  // auto-install pass is async and a folder may connect mid-flight.
  const hasProject = useProjectStore((s) => !!s.currentProject?.folderPath);
  const hasProjectRef = useRef(hasProject);
  hasProjectRef.current = hasProject;

  const autoRunRef = useRef(false); // one auto-install pass per mount

  // Open at the earliest incomplete step, computed from the LIVE probe results
  // (store state lags the async probe, so read them synchronously).
  const openAtEarliest = () => {
    const results = useCliSetupStore.getState().results;
    hRef.current.openAt(
      initialWizardStep({
        requiredInstalled: computeRequiredInstalled(
          ORCHESTRATOR_CLI_IDS,
          results,
        ),
        requiredReady: useCliSetupStore.getState().ready,
        hasProject: hasProjectRef.current,
      }),
    );
  };

  // First-run: probe, then decide visibility. Existing fully-set-up users are
  // never surfaced.
  useEffect(() => {
    if (autoRunRef.current) return;
    autoRunRef.current = true;
    let cancelled = false;
    refreshVersions(); // fire-and-forget; result renders when it arrives
    void (async () => {
      const first = await probeAll();
      if (cancelled) return;

      let requiredReady = first.requiredReady;
      // Latest per-row probe results — the source for the re-prompt checks.
      let latest = first.results;
      // Do not auto-install on first entry. The setup surface now asks which AI
      // account the user has, then installs only that selected set. The old
      // background pass was the first-run auto-advance that jumped users into
      // Claude install before they had chosen an account.
      if (!readFlag(AUTO_INSTALL_KEY)) {
        try {
          localStorage.setItem(AUTO_INSTALL_KEY, "1");
        } catch {
          /* best effort */
        }
      }

      if (cancelled) return;

      // A prior "Later" is honored only while at least one orchestrator
      // candidate is installed. If none is installed the user can't launch
      // anything, so re-surface and clear the stale dismissal — the next run
      // keeps behaving like a first run until install succeeds (FT-6).
      const decision = resolveGateVisibility({
        requiredReady,
        requiredInstalled: computeRequiredInstalled(
          ORCHESTRATOR_CLI_IDS,
          latest,
        ),
        dismissed: isOnboardingDismissed(),
      });
      if (decision.clearDismissed) setOnboardingDismissed(false);
      // Orchestrator-first: never auto-surface on the empty board. With a
      // project connected, the orchestrator auto-launch fires
      // `marblo:open-cli-setup` when auth is actually needed.
      if (decision.visible && hasProjectRef.current) openAtEarliest();
    })();
    return () => {
      cancelled = true;
    };
  }, [probeAll, refreshVersions]);

  // Re-open on demand — the spawn guard dispatches this when a launch is
  // blocked (orchestrator/agent), and agent-manager's login-screen backstop
  // surfaces it via the agent:needsAuth → shell bridge.
  useEffect(() => {
    const onOpen = () => {
      // Treat the event as "re-check auth, surface only if actually needed",
      // not "force open" — agent-manager's backstop can emit a spurious
      // agent:needsAuth for a restart-restored PTY, which made an already
      // authenticated user see the popup on every restart (nB4eenxP).
      refreshVersions(); // advisory, fire-and-forget
      void (async () => {
        const { requiredReady } = await probeAll();
        if (shouldOpenGateOnReopen(requiredReady)) openAtEarliest();
      })();
    };
    window.addEventListener("marblo:open-cli-setup", onOpen);
    return () => window.removeEventListener("marblo:open-cli-setup", onOpen);
  }, [probeAll, refreshVersions]);

  // Retraction — main 의 로그인-화면 백스톱이 스스로 오탐을 확정했을 때
  // (`agent:authResolved` → Layout → 이 이벤트). 사용자가 아무것도 안 했는데 떠 있던
  // 안내이므로 **사용자 결정(dismiss)이 아닌 close 로** 닫는다: 영구 dismissal 을
  // 기록하면 진짜 미인증일 때 안내가 안 뜨게 된다.
  useEffect(() => {
    const onResolved = () => hRef.current.close?.();
    window.addEventListener("marblo:cli-auth-resolved", onResolved);
    return () =>
      window.removeEventListener("marblo:cli-auth-resolved", onResolved);
  }, []);

  // Auto re-check while a sign-in is running in a terminal: poll the auth probe
  // and re-check when the window regains focus (user returns from the browser
  // OAuth flow). As soon as the required set is authenticated we stop.
  useEffect(() => {
    if (!loginRunning) return;
    let stopped = false;
    let ticks = 0;
    const MAX_TICKS = 150; // ~6min backstop — then fall back to manual Re-check
    const tick = async () => {
      const { requiredReady } = await probeAll();
      if (!stopped && requiredReady) setLoginRunning(false);
    };
    const interval = window.setInterval(() => {
      if (++ticks > MAX_TICKS) {
        setLoginRunning(false); // cleanup below clears the interval
        return;
      }
      void tick();
    }, 2500);
    const onFocus = () => void tick();
    window.addEventListener("focus", onFocus);
    return () => {
      stopped = true;
      window.clearInterval(interval);
      window.removeEventListener("focus", onFocus);
    };
  }, [loginRunning, probeAll, setLoginRunning]);

  // When the required set (Claude/Codex) transitions to ready — via one-click
  // sign-in, manual Re-check, or auto-install completing — emit
  // `marblo:cli-auth-ready` so useOrchestratorAutoLaunch resumes the launch
  // (unchanged contract). Guarded on the false→true edge so it fires once.
  const prevReadyRef = useRef(false);
  useEffect(() => {
    if (ready && !prevReadyRef.current) {
      telemetry.cliSetupStep("auth", "success");
      window.dispatchEvent(new CustomEvent("marblo:cli-auth-ready"));
      // ★인증 다음 칸: 로그인이 성립했다고 그 계정이 **돌아간다**는 뜻은 아니다.
      // 구독/크레딧이 없으면 CLI 는 한 턴도 못 도는데 여기까지의 모든 신호는
      // 초록색이라, 사용자는 "연결됐어요" 를 보고 조용히 막힌다. 짧은 헤드리스
      // 턴 하나로 실제 실행 가능 여부를 재 본다.
      //
      // ★`setupInitiated` 게이트가 필수다. 이 엣지는 **이미 인증된 사용자의 콜드
      // 스타트에서도** 뜬다(bRABKQX7/nB4eenxP 와 같은 엣지). 게이트가 없으면 매
      // 재시작마다 모든 사용자에게 모델 턴이 한 번씩 청구된다. 이 세션에서 우리
      // 원클릭 버튼을 눌러 방금 인증을 끝낸 사람에게만 돈다 — 그게 이 안내가
      // 실제로 필요한 순간이기도 하다. 그 밖의 경우는 가이드 모달의 "다시 확인"
      // 이 수동 경로로 남는다.
      if (useCliSetupStore.getState().setupInitiated) {
        void useCliSetupStore
          .getState()
          .runFundingProbe()
          .then((outcome) => {
            // ★스톨 계측(티켓 9dXgBdkGn1LyJokShh1g): **판정 전체**를 남긴다 —
            // `ok` 까지 포함해야 "인증까지 온 유저 중 몇 %가 못 도는가" 의 분모가
            // 생긴다. 아래 cliSetupStep(fail) 은 퍼널용이라 실패만 남기고,
            // 그것만으로는 비율을 못 구한다(#883/#885 가 막힌 지점).
            if (outcome) {
              telemetry.fundingProbe(
                outcome.verdict,
                outcome.model,
                "auto",
                outcome.blockedReason,
              );
            }
            // 인증 성공(위 `auth/success`)과 별개로, 그 계정이 실제로 못 돈
            // 경우를 남긴다 — 퍼널에서 "인증까지 왔는데 왜 아무도 안 넘어가나"
            // 를 설명하는 것이 이 사유다.
            if (!outcome || outcome.verdict === "ok") return;
            if (outcome.verdict === "inconclusive") return;
            telemetry.cliSetupStep(
              "auth",
              "fail",
              outcome.verdict === "unfunded"
                ? "unfunded"
                : `blocked:${outcome.blockedReason ?? "unknown"}`,
            );
          });
      }
      if (hasProjectRef.current) {
        // Mid-session blocked re-open: the orchestrator resumes on its own.
        hRef.current.close?.();
      } else if (shouldShowPostAuthStep(isOnboardingDismissed())) {
        // First run: guide the freshly-authed user into connecting a project.
        // The dismissal check matters because this edge ALSO fires on every
        // restart (the probe starts false and flips once re-probed) — without
        // it, a user who clicked "Later" saw the PRD popup every restart
        // (bRABKQX7). `marblo:cli-auth-ready` above fires either way.
        // ★ Read via the onboarding record, NOT the legacy flag: only the
        // legacy modal ever wrote that flag, so shell users had no way to make
        // a dismissal stick and got this banner on every restart (barrier F2).
        hRef.current.showPostAuth?.("prd");
      }
    }
    prevReadyRef.current = ready;
  }, [ready]);
}
