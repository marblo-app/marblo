import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "../../lib/i18n";
import type { MessageKey } from "../../locales/ko";
import { useTerminalStore } from "../../stores/terminalStore";
import { useProjectStore } from "../../stores/projectStore";
import { useEditorStore } from "../../stores/editorStore";
import telemetry from "../../services/telemetryService";
import {
  autoInstallComplete,
  canAdvanceWizard,
  initialWizardStep,
  nextWizardStep,
  requiredInstalled as computeRequiredInstalled,
  requiredReady as computeRequiredReady,
  resolveGateVisibility,
  WIZARD_STEPS,
  type WizardStep,
} from "../../lib/cliSetupGate";
import { routeInstructionToOrchestrator } from "../../services/orchestratorInstructionService";
import { CliFailSurvey } from "./CliFailSurvey";

/**
 * First-run CLI setup gate — the linear activation wizard.
 *
 * The designed onboarding wizard (WelcomeScreen/SetupWizard/OnboardingSteps)
 * was dead code — it only rendered from the Next.js-style `src/app/onboarding`
 * route, which this Vite+Electron SPA never mounts (QA vj7ZvHphYOIhsNd340ad).
 * New users reached the board with no guidance to install / log in to the CLIs
 * the orchestrator and agents need, so `claude` silently failed to spawn.
 *
 * This is a real, mounted gate (Layout renders it as an overlay). It live-probes
 * install + login state via harness.cliAuthCheck — the SAME probe the spawn
 * guard uses — for the orchestrator candidates (Claude or Codex) and the
 * optional Antigravity (agy). On mount it AUTO-INSTALLS any missing
 * auto-installable CLI in the background (no click); on failure it falls back to
 * the manual `npm install -g …` command + official docs link. Login is one-click
 * ("Run sign-in" spawns a terminal and runs the login command) with copy/re-check
 * as fallbacks.
 *
 * Orchestrator-first onboarding: the gate does NOT block the empty board before
 * a project/folder is connected — it stays quiet and only auto-installs in the
 * background. The blocking overlay surfaces at orchestrator-launch time (via the
 * `marblo:open-cli-setup` event from useOrchestratorAutoLaunch's needsAuth
 * branch, the spawn guard, and the agent:needsAuth backstop), i.e. exactly when
 * one orchestrator CLI auth is actually needed. When Claude or Codex becomes
 * authenticated the gate emits `marblo:cli-auth-ready` so the orchestrator
 * auto-launch resumes with no manual re-check.
 *
 * An already-set-up user (Claude or Codex installed & authed) never sees it.
 *
 * ── Linear 4-step activation wizard (ticket ir94m9C6) ────────────────────────
 * Onboarding no longer ends at "folder connected" — it drives all the way to the
 * activation KPI (first ticket completed within 30 min of signup). The single
 * gate is presented as an ORDERED, progress-tracked 4-step flow while keeping
 * every behavior above intact (probe, auto-install, dismissal, one-click sign-in,
 * auto-recheck, `marblo:cli-auth-ready`, re-open listener):
 *   ① install     — install the orchestrator CLI. Auto `npm i -g`; on failure
 *                    (EACCES / npm prefix perms) the manual command + official
 *                    docs link are surfaced instead of dying silently.
 *   ② auth        — sign in to Claude OR Codex (at least one; ticket A's
 *                    ORCHESTRATOR_CLI_IDS `.some` logic via computeRequiredReady).
 *   ③ prd         — connect a folder (→ orchestrator auto-launches) + seed a
 *                    starter PRD.md, opened in the editor.
 *   ④ firstTicket — hand the PRD to the orchestrator as the first prompt
 *                    (routeInstructionToOrchestrator, live-verified in #573) so it
 *                    creates the first ticket + proposes spawning an agent, then
 *                    close the gate and let the user watch the orchestrator work.
 * Each step's enter/success/fail is instrumented via telemetry.cliSetupStep with
 * the new install/auth/prd/firstTicket vocabulary (the funnel now sees where a
 * user drops — a missing CLI vs a failed sign-in vs never reaching the first
 * ticket), reusing cli_auth / launch_error reasons so it joins the
 * orchestratorBlocked funnel on one axis. The cost/BYOK-avoidance notice folds
 * into the install step's banner. Already-authed users still never see the
 * wizard; a blocked-launch re-open opens at the earliest incomplete step.
 */

const DISMISSED_KEY = "marblo.cliSetupGateDismissed";
const AUTO_INSTALL_KEY = "marblo.cliAutoInstallDone";

type Model = "claude" | "codex" | "antigravity";

interface CliRow {
  id: "cli-claude-code" | "cli-codex" | "cli-antigravity";
  model: Model;
  required: boolean;
  /** npm-global installs can be auto-installed silently. Shell installers
   * (agy) are optional and installed only on explicit click. */
  autoInstall: boolean;
}

// Claude and Codex are orchestrator candidates: either one being installed and
// authenticated is enough to pass the gate. Both are still recommended and
// auto-installed in the background; Antigravity remains optional.
const ORCHESTRATOR_CLI_IDS: Array<CliRow["id"]> = [
  "cli-claude-code",
  "cli-codex",
];

const ROWS: CliRow[] = [
  { id: "cli-claude-code", model: "claude", required: true, autoInstall: true },
  { id: "cli-codex", model: "codex", required: false, autoInstall: true },
  {
    id: "cli-antigravity",
    model: "antigravity",
    required: false,
    autoInstall: false,
  },
];

/** Command that installs/updates each CLI to the latest published version.
 * Reused by the version-check advisory when an installed CLI is behind, and as
 * the manual install fallback when auto-install fails. */
const UPDATE_CMD: Record<Model, string> = {
  claude: "npm install -g @anthropic-ai/claude-code",
  codex: "npm install -g @openai/codex",
  antigravity: "curl -fsSL https://antigravity.google/cli/install.sh | bash",
};

/** Official install/docs page per CLI — the "official method" fallback link
 * shown next to the manual command when auto-install fails. */
const DOCS_URL: Record<Model, string> = {
  claude: "https://www.npmjs.com/package/@anthropic-ai/claude-code",
  codex: "https://www.npmjs.com/package/@openai/codex",
  antigravity: "https://antigravity.google",
};

type CliState = CliAuthResult & { checking: boolean };

function isReady(s: CliState | undefined): boolean {
  return !!s && s.installed && s.authenticated;
}

function labelFor(model: Model): string {
  return model === "claude"
    ? "Claude Code"
    : model === "codex"
    ? "Codex (GPT)"
    : "Antigravity (agy)";
}

function joinPath(dir: string, name: string): string {
  return dir.endsWith("/") ? `${dir}${name}` : `${dir}/${name}`;
}

export function CliSetupGate() {
  const { t } = useTranslation();
  const [visible, setVisible] = useState(false);
  const [showSurvey, setShowSurvey] = useState(false);
  const [states, setStates] = useState<Record<string, CliState>>({});
  const [installing, setInstalling] = useState<string | null>(null);
  const [installErrors, setInstallErrors] = useState<Record<string, string>>(
    {}
  );
  const [copied, setCopied] = useState<string | null>(null);
  const [ready, setReady] = useState(false); // Claude or Codex ready
  const [loginRunning, setLoginRunning] = useState(false); // sign-in launched in a terminal
  // Local↔latest CLI versions (keyed by row id). Advisory only — used to warn
  // when an installed CLI is behind so an outdated build isn't silently passed
  // through the auth-only gate. Never blocks readiness.
  const [versions, setVersions] = useState<Record<string, HarnessVersionInfo>>(
    {}
  );
  const autoRunRef = useRef(false); // one auto-install pass per mount

  // ── Wizard step state (ticket ir94m9C6 — linear install→auth→prd→firstTicket)
  const [step, setStep] = useState<WizardStep>("install");
  const [seeding, setSeeding] = useState(false); // sample-PRD write in flight
  const [seedMsg, setSeedMsg] = useState<{ ok: boolean; text: string } | null>(
    null
  );
  const [sendingTicket, setSendingTicket] = useState(false); // firstTicket route in flight
  const [ticketMsg, setTicketMsg] = useState<{
    ok: boolean;
    text: string;
  } | null>(null);

  // Orchestrator-first onboarding: before a project/folder is connected the gate
  // must not block the empty board. We keep a live ref (the auto-install pass is
  // async and a folder may be connected mid-flight) so the blocking overlay is
  // only auto-shown once a project exists; auto-install still runs silently.
  const hasProject = useProjectStore((s) => !!s.currentProject?.folderPath);
  const hasProjectRef = useRef(hasProject);
  hasProjectRef.current = hasProject;

  // Latest raw probe results, kept in a ref so openWizard can compute the right
  // entry step synchronously (React state lags the async probe).
  const resultsRef = useRef<Record<string, CliAuthResult>>({});

  // Non-blocking version probe (npm view under the hood). Fire-and-forget so a
  // slow/offline lookup never stalls the gate or the readiness spinner.
  const refreshVersions = useCallback(() => {
    window.electronAPI.harness
      .versions()
      .then((v) => setVersions(v))
      .catch(() => {
        /* advisory only — ignore failures */
      });
  }, []);

  // Advance to `next`, logging its entry. Centralizes the step transition so
  // every path lands on a consistent, instrumented step.
  const goToStep = useCallback((next: WizardStep) => {
    setStep(next);
    telemetry.cliSetupStep(next, "enter");
  }, []);

  // Open the wizard at the earliest incomplete step and log its entry. Reads the
  // live probe/project refs so a re-open (already installed/authed) skips
  // finished steps rather than re-walking install/auth.
  const openWizard = useCallback(() => {
    const s = initialWizardStep({
      requiredInstalled: computeRequiredInstalled(
        ORCHESTRATOR_CLI_IDS,
        resultsRef.current
      ),
      requiredReady: computeRequiredReady(
        ORCHESTRATOR_CLI_IDS,
        resultsRef.current
      ),
      hasProject: hasProjectRef.current,
    });
    setStep(s);
    setVisible(true);
    telemetry.cliSetupStep(s, "enter");
  }, []);

  const probe = useCallback(async (model: Model, id: string) => {
    setStates((prev) => ({
      ...prev,
      [id]: {
        ...(prev[id] ?? { installed: false, authenticated: false }),
        checking: true,
      },
    }));
    try {
      const res = await window.electronAPI.harness.cliAuthCheck(model);
      resultsRef.current[id] = res;
      setStates((prev) => ({ ...prev, [id]: { ...res, checking: false } }));
      return res;
    } catch {
      const miss = { installed: false, authenticated: false };
      resultsRef.current[id] = miss;
      setStates((prev) => ({ ...prev, [id]: { ...miss, checking: false } }));
      return miss as CliAuthResult;
    }
  }, []);

  // Probe every row; return the raw results + whether an orchestrator candidate
  // is ready (used synchronously by the auto-install pass, since React state lags).
  const probeAll = useCallback(async () => {
    const results: Record<string, CliAuthResult> = {};
    await Promise.all(
      ROWS.map(async (r) => {
        results[r.id] = await probe(r.model, r.id);
      })
    );
    const requiredReady = computeRequiredReady(ORCHESTRATOR_CLI_IDS, results);
    setReady(requiredReady);
    return { results, requiredReady };
  }, [probe]);

  const runInstall = useCallback(
    async (row: CliRow) => {
      setInstalling(row.id);
      setInstallErrors((prev) => ({ ...prev, [row.id]: "" }));
      try {
        const result = await window.electronAPI.harness.install(row.id);
        if (!result.success) {
          setInstallErrors((prev) => ({
            ...prev,
            [row.id]: result.error ?? t("onboarding.cliGate.installFail"),
          }));
        }
      } catch (err) {
        setInstallErrors((prev) => ({
          ...prev,
          [row.id]:
            err instanceof Error
              ? err.message
              : t("onboarding.cliGate.installFail"),
        }));
      } finally {
        setInstalling(null);
        await probe(row.model, row.id);
      }
    },
    [probe, t]
  );

  // First-run: probe, then auto-install any missing REQUIRED CLI (once), then
  // decide visibility. Existing fully-set-up users are never shown the gate,
  // and auto-install skips anything already installed.
  useEffect(() => {
    if (autoRunRef.current) return;
    autoRunRef.current = true;
    let cancelled = false;
    refreshVersions(); // fire-and-forget; result renders when it arrives
    (async () => {
      const first = await probeAll();
      if (cancelled) return;

      let autoDone = false;
      try {
        autoDone = localStorage.getItem(AUTO_INSTALL_KEY) === "1";
      } catch {
        /* private mode — treat as not done */
      }

      let requiredReady = first.requiredReady;
      // Latest per-row probe results (refreshed after an auto-install pass) —
      // the source for the install-complete (FT-8) and re-prompt (FT-6) checks.
      let latest = first.results;
      // Auto-install every auto-installable CLI that's missing so the fleet is
      // ready without a click. Optional rows install silently; only the
      // Claude/Codex candidate set can gate visibility.
      const missing = ROWS.filter(
        (r) => r.autoInstall && first.results[r.id]?.installed === false
      );
      if (!autoDone && missing.length > 0) {
        // Only surface install progress once a project is connected — before
        // that, install silently so the empty board isn't blocked.
        if (hasProjectRef.current) openWizard();
        for (const row of missing) {
          if (cancelled) return;
          await runInstall(row);
        }
        if (cancelled) return;
        const reprobe = await probeAll();
        requiredReady = reprobe.requiredReady;
        latest = reprobe.results;
        // Only mark auto-install "done" once every previously-missing CLI is
        // actually installed. On failure we leave the flag unset so the next
        // launch retries the auto-install rather than silently giving up (FT-8).
        if (
          autoInstallComplete(
            missing.map((r) => r.id),
            latest
          )
        ) {
          try {
            localStorage.setItem(AUTO_INSTALL_KEY, "1");
          } catch {
            /* best effort */
          }
        }
      }

      if (cancelled) return;
      let dismissed = false;
      try {
        dismissed = localStorage.getItem(DISMISSED_KEY) === "1";
      } catch {
        /* private mode — treat as not dismissed */
      }

      // A prior "Later" is honored only while at least one orchestrator
      // candidate is installed. If none is installed the user can't launch
      // anything, so re-surface the gate and clear the stale dismissal — the
      // next run keeps behaving like a first run until install succeeds (FT-6).
      // Login-only gaps (installed but not authed) still respect the dismissal.
      const decision = resolveGateVisibility({
        requiredReady,
        requiredInstalled: computeRequiredInstalled(
          ORCHESTRATOR_CLI_IDS,
          latest
        ),
        dismissed,
      });
      if (decision.clearDismissed) {
        try {
          localStorage.removeItem(DISMISSED_KEY);
        } catch {
          /* best effort */
        }
      }
      // Orchestrator-first: never auto-block the empty board. With a project
      // connected, the orchestrator auto-launch fires `marblo:open-cli-setup`
      // when Claude auth is actually needed — that path always shows the gate.
      if (decision.visible && hasProjectRef.current) openWizard();
    })();
    return () => {
      cancelled = true;
    };
  }, [probeAll, runInstall, refreshVersions, openWizard]);

  // Re-open on demand — the spawn guard dispatches this when a launch is
  // blocked (orchestrator/agent), and agent-manager's login-screen backstop
  // surfaces it via the agent:needsAuth → Layout bridge.
  useEffect(() => {
    const onOpen = () => {
      void probeAll();
      refreshVersions();
      openWizard();
    };
    window.addEventListener("marblo:open-cli-setup", onOpen);
    return () => window.removeEventListener("marblo:open-cli-setup", onOpen);
  }, [probeAll, refreshVersions, openWizard]);

  const handleCopy = useCallback(async (cmd: string) => {
    try {
      await navigator.clipboard.writeText(cmd);
      setCopied(cmd);
      setTimeout(() => setCopied((c) => (c === cmd ? null : c)), 1800);
    } catch {
      /* clipboard blocked — user can select manually */
    }
  }, []);

  const dismiss = useCallback(() => {
    // CLI-fail drop-off: dismissing the install/auth step before Claude/Codex is
    // authed is the same "couldn't connect the CLI" failure orchestratorBlocked
    // reports — log it with the same cli_auth vocabulary so both funnels line up,
    // then surface the 5-second "무엇이 어려우셨나요?" survey once before closing.
    // Any other dismiss (prd/firstTicket, or a ready gate) just closes.
    if ((step === "install" || step === "auth") && !ready) {
      telemetry.cliSetupStep(step, "fail", "cli_auth");
      let surveyDone = false;
      try {
        surveyDone = localStorage.getItem("marblo.survey.cli_fail") === "1";
      } catch {
        /* private mode — treat as not done */
      }
      if (!surveyDone) {
        setShowSurvey(true);
        return;
      }
    }

    try {
      localStorage.setItem(DISMISSED_KEY, "1");
    } catch {
      /* private mode — best effort */
    }
    setVisible(false);
  }, [step, ready]);

  // project (prd) step: open the native folder picker. useProjectSetup's global
  // `marblo:select-folder` listener auto-registers the folder as a project;
  // useOrchestratorAutoLaunch then boots the orchestrator — this is the wizard's
  // "첫 오케 실행" with no extra wiring here.
  const connectFolder = useCallback(() => {
    window.dispatchEvent(new CustomEvent("marblo:select-folder"));
  }, []);

  // prd step: seed a starter PRD.md into the connected folder and open it, so a
  // first-time user has something concrete to hand the orchestrator. Never
  // clobbers an existing PRD.md — if one is already there we just open it.
  const seedSamplePrd = useCallback(async () => {
    const root = useProjectStore.getState().currentProject?.folderPath;
    if (!root) return;
    setSeeding(true);
    setSeedMsg(null);
    try {
      const prdPath = joinPath(root, "PRD.md");
      let exists = true;
      try {
        await window.electronAPI.fs.readFile(root, prdPath);
      } catch {
        exists = false; // no PRD.md yet — safe to create
      }
      if (!exists) {
        await window.electronAPI.fs.writeFile(
          root,
          prdPath,
          t("onboarding.cliGate.prdContent")
        );
      }
      const editor = useEditorStore.getState();
      editor.setRootPath(root);
      await editor.openFile(prdPath);
      setSeedMsg({ ok: true, text: t("onboarding.cliGate.project.seeded") });
    } catch {
      setSeedMsg({ ok: false, text: t("onboarding.cliGate.project.seedFail") });
    } finally {
      setSeeding(false);
    }
  }, [t]);

  // firstTicket step (the aha-moment): hand the PRD to the orchestrator as the
  // very first prompt. routeInstructionToOrchestrator is the local-PTY-first,
  // durable-queue-fallback path live-verified in #573 — the orchestrator creates
  // the first ticket and proposes spawning an agent. On success we close the gate
  // so the user watches the orchestrator work (the tf-start greeting takes over).
  const createFirstTicket = useCallback(async () => {
    const proj = useProjectStore.getState().currentProject;
    if (!proj?.id) {
      setTicketMsg({
        ok: false,
        text: t("onboarding.cliGate.firstTicket.needProject"),
      });
      return;
    }
    setSendingTicket(true);
    setTicketMsg(null);
    try {
      const result = await routeInstructionToOrchestrator({
        projectId: proj.id,
        message: t("onboarding.cliGate.firstTicket.prompt"),
      });
      if (result === "failed") {
        telemetry.cliSetupStep("firstTicket", "fail", "launch_error");
        setTicketMsg({
          ok: false,
          text: t("onboarding.cliGate.firstTicket.failed"),
        });
        return;
      }
      // "local" (in-process ack) or "queued" (durable fallback) — either way the
      // orchestrator will pick it up. Mark the funnel's finish line and close.
      telemetry.cliSetupStep("firstTicket", "success");
      try {
        localStorage.setItem(DISMISSED_KEY, "1");
      } catch {
        /* best effort */
      }
      setTicketMsg({
        ok: true,
        text: t("onboarding.cliGate.firstTicket.sent"),
      });
      setVisible(false);
    } catch {
      telemetry.cliSetupStep("firstTicket", "fail", "launch_error");
      setTicketMsg({
        ok: false,
        text: t("onboarding.cliGate.firstTicket.failed"),
      });
    } finally {
      setSendingTicket(false);
    }
  }, [t]);

  const finishDismiss = useCallback(() => {
    try {
      localStorage.setItem(DISMISSED_KEY, "1");
    } catch {
      /* private mode — best effort */
    }
    setShowSurvey(false);
    setVisible(false);
  }, []);

  // One-click sign-in: spawn a real terminal tab, type the CLI's login command,
  // and hide the gate so the user can complete the interactive OAuth flow. The
  // auto-recheck effect below polls until the required set is authenticated, so
  // no manual "Re-check" click is needed. Copy/Re-check remain as fallbacks.
  const launchLogin = useCallback(async (row: CliRow, cmd: string) => {
    if (!cmd) return;
    const label = labelFor(row.model);
    try {
      const term = useTerminalStore.getState();
      const id = await term.createSession(label);
      term.openTerminalForSession(id, label);
      setLoginRunning(true);
      setVisible(false); // reveal the terminal so the user can finish sign-in
      // Let the shell print its prompt before typing, so the command isn't
      // swallowed by a not-yet-interactive shell.
      setTimeout(() => {
        window.electronAPI.pty.writeAndSubmit(id, cmd).catch(() => {
          /* PTY closed — user can still type it themselves */
        });
      }, 700);
    } catch {
      /* terminal spawn failed — user can still copy/run the command manually */
    }
  }, []);

  // Auto re-check while a sign-in is running in a terminal: poll the auth probe
  // and re-check when the window regains focus (user returns from the browser
  // OAuth flow). As soon as the required set is authenticated we stop — the
  // gate is already hidden, so sign-in "just works" without a manual re-check.
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
  }, [loginRunning, probeAll]);

  // When the required set (Claude/Codex) transitions to ready — via one-click
  // sign-in, manual Re-check, or auto-install completing — emit
  // `marblo:cli-auth-ready` so useOrchestratorAutoLaunch resumes the launch
  // (unchanged contract). Then advance the wizard to the PRD step so onboarding
  // keeps moving toward the first ticket. If a project already exists (a blocked-
  // launch re-open), close as before and let auto-launch take over. Guarded on
  // the false→true edge so it fires once, never on an already-ready mount.
  const prevReadyRef = useRef(false);
  useEffect(() => {
    if (ready && !prevReadyRef.current) {
      telemetry.cliSetupStep("auth", "success");
      window.dispatchEvent(new CustomEvent("marblo:cli-auth-ready"));
      if (hasProjectRef.current) {
        // Mid-session blocked re-open: the orchestrator resumes on its own.
        setVisible(false);
      } else {
        // First-run: guide the freshly-authed user into connecting a project.
        // launchLogin may have hidden the gate to reveal the terminal — re-show
        // it so the PRD step is actually visible.
        setStep("prd");
        setVisible(true);
        telemetry.cliSetupStep("prd", "enter");
      }
    }
    prevReadyRef.current = ready;
  }, [ready]);

  // prd step: once a folder connects, the orchestrator auto-launches
  // (useOrchestratorAutoLaunch). Log success on the false→true edge of
  // hasProject. We intentionally do NOT auto-advance — the connected view offers
  // the optional "sample PRD" action and the user clicks Next when ready.
  const prevHasProjectRef = useRef(hasProject);
  useEffect(() => {
    if (step === "prd" && hasProject && !prevHasProjectRef.current) {
      telemetry.cliSetupStep("prd", "success");
    }
    prevHasProjectRef.current = hasProject;
  }, [step, hasProject]);

  const gateState = useMemo(
    () => ({
      requiredInstalled: computeRequiredInstalled(ORCHESTRATOR_CLI_IDS, states),
      requiredReady: ready,
      hasProject,
    }),
    [states, ready, hasProject]
  );

  if (!visible) return null;

  if (showSurvey) {
    return (
      <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 p-4">
        <div className="w-full max-w-md rounded-xl border border-[#313244] bg-[#1e1e2e] shadow-2xl">
          <CliFailSurvey onComplete={finishDismiss} />
        </div>
      </div>
    );
  }

  const anyChecking = ROWS.some((r) => states[r.id]?.checking);
  const currentIndex = WIZARD_STEPS.indexOf(step);
  const canAdvance = canAdvanceWizard(step, gateState);
  const next = nextWizardStep(step);

  const headerTitle = t(`onboarding.cliGate.${step}.title` as MessageKey);
  const headerSubtitle = t(`onboarding.cliGate.${step}.body` as MessageKey);

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 p-4">
      <div className="w-full max-w-lg rounded-xl border border-[#313244] bg-[#1e1e2e] shadow-2xl">
        <div className="border-b border-[#313244] px-6 py-4">
          {/* Progress indicator — the four ordered steps with connectors. */}
          <div className="mb-3 flex items-center gap-1.5">
            {WIZARD_STEPS.map((sId, i) => {
              const active = i === currentIndex;
              const done = i < currentIndex;
              return (
                <div key={sId} className="flex items-center gap-1.5">
                  <span
                    className={`flex h-5 w-5 items-center justify-center rounded-full text-[10px] font-semibold ${
                      active
                        ? "bg-[#89b4fa] text-[#1e1e2e]"
                        : done
                        ? "bg-[#a6e3a1] text-[#1e1e2e]"
                        : "bg-[#313244] text-[#7f849c]"
                    }`}
                  >
                    {done ? "✓" : i + 1}
                  </span>
                  <span
                    className={`text-[11px] font-medium ${
                      active ? "text-[#cdd6f4]" : "text-[#7f849c]"
                    }`}
                  >
                    {t(`onboarding.cliGate.step.${sId}` as MessageKey)}
                  </span>
                  {i < WIZARD_STEPS.length - 1 && (
                    <span className="mx-0.5 text-[#45475a]">›</span>
                  )}
                </div>
              );
            })}
          </div>
          <h2 className="text-lg font-semibold text-[#cdd6f4]">
            {headerTitle}
          </h2>
          <p className="mt-1 text-sm text-[#a6adc8]">{headerSubtitle}</p>
        </div>

        {/* ── Step ① + ②: detect / install / sign-in / auth confirmation ──── */}
        {(step === "install" || step === "auth") && (
          <div className="max-h-[60vh] space-y-3 overflow-auto px-6 py-4">
            {/* Cost / account-connect notice folds into the install step. */}
            {step === "install" && (
              <div className="rounded-md border border-[#89b4fa]/25 bg-[#89b4fa]/5 px-3 py-2.5 text-xs text-[#a6adc8]">
                {t("onboarding.cliGate.install.costNote")}
              </div>
            )}
            {ROWS.map((row) => {
              const s = states[row.id];
              const cmd = s?.action ?? "";
              const manualCmd = cmd || UPDATE_CMD[row.model];
              const installError = installErrors[row.id];
              const isInstalling = installing === row.id;
              return (
                <div
                  key={row.id}
                  className="rounded-lg border border-[#313244] bg-[#181825] p-4"
                >
                  <div className="flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="font-medium text-[#cdd6f4]">
                          {labelFor(row.model)}
                        </span>
                        <span
                          className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${
                            row.required
                              ? "bg-[#f38ba8]/15 text-[#f38ba8]"
                              : "bg-[#585b70]/30 text-[#a6adc8]"
                          }`}
                        >
                          {row.required
                            ? t("onboarding.cliGate.required")
                            : t("onboarding.cliGate.optional")}
                        </span>
                      </div>
                      <p className="mt-0.5 text-xs text-[#7f849c]">
                        {row.model === "claude"
                          ? t("onboarding.cliGate.claudeDesc")
                          : row.model === "codex"
                          ? t("onboarding.cliGate.codexDesc")
                          : t("onboarding.cliGate.agyDesc")}
                      </p>
                    </div>
                    <StatusBadge state={s} installing={isInstalling} t={t} />
                  </div>

                  {/* ① install: not installed → install button (auto for required,
                      click for optional). On failure the manual command +
                      official docs link are surfaced (no silent death). */}
                  {step === "install" && s && !s.checking && !s.installed && (
                    <div className="mt-3">
                      <button
                        onClick={() => void runInstall(row)}
                        disabled={isInstalling}
                        className="rounded-md bg-[#89b4fa] px-3 py-1.5 text-xs font-medium text-[#1e1e2e] transition-colors hover:bg-[#74c7ec] disabled:opacity-60"
                      >
                        {isInstalling
                          ? t("onboarding.cliGate.installing")
                          : t("onboarding.cliGate.install")}
                      </button>
                      {installError && (
                        <div className="mt-2 rounded-md border border-[#f38ba8]/25 bg-[#f38ba8]/5 p-2.5">
                          <p className="text-xs text-[#f38ba8]">
                            {t("onboarding.cliGate.installFail")}:{" "}
                            {installError}
                          </p>
                          <p className="mt-1.5 text-xs text-[#a6adc8]">
                            {t("onboarding.cliGate.install.officialHint")}
                          </p>
                          <CommandBox
                            cmd={manualCmd}
                            copied={copied}
                            onCopy={handleCopy}
                            t={t}
                          />
                          <a
                            href={DOCS_URL[row.model]}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="mt-1.5 inline-block text-xs text-[#89b4fa] underline decoration-dotted hover:text-[#74c7ec]"
                          >
                            {t("onboarding.cliGate.install.official")} ↗
                          </a>
                        </div>
                      )}
                    </div>
                  )}

                  {/* ② auth: installed but not authed → one-click "Run sign-in"
                      (spawns a terminal and runs the login command). */}
                  {step === "auth" &&
                    s &&
                    !s.checking &&
                    s.installed &&
                    !s.authenticated &&
                    cmd && (
                      <div className="mt-3">
                        <p className="text-xs text-[#a6adc8]">
                          {t("onboarding.cliGate.loginHint")}
                        </p>
                        <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1">
                          <button
                            onClick={() => void launchLogin(row, cmd)}
                            className="rounded-md bg-[#89b4fa] px-3 py-1.5 text-xs font-medium text-[#1e1e2e] transition-colors hover:bg-[#74c7ec]"
                          >
                            {t("onboarding.cliGate.runLogin")}
                          </button>
                          <span className="text-[10px] text-[#7f849c]">
                            {t("onboarding.cliGate.runLoginHint")}
                          </span>
                        </div>
                        <CommandBox
                          cmd={cmd}
                          copied={copied}
                          onCopy={handleCopy}
                          t={t}
                        />
                      </div>
                    )}

                  {/* ② auth: installed but not yet installed elsewhere — hint to
                      finish install first. Only shown on the auth step. */}
                  {step === "auth" && s && !s.checking && !s.installed && (
                    <p className="mt-3 text-xs text-[#f9e2af]">
                      {t("onboarding.cliGate.auth.needInstall")}
                    </p>
                  )}

                  {/* Installed but outdated → advisory + update command (FT-5).
                      Advisory only: never blocks the ready gate. */}
                  {s &&
                    !s.checking &&
                    s.installed &&
                    versions[row.id]?.updateState === "outdated" && (
                      <div className="mt-3 rounded-md border border-[#f9e2af]/30 bg-[#f9e2af]/10 p-2.5">
                        <p className="text-xs font-medium text-[#f9e2af]">
                          {t("onboarding.cliGate.outdated", {
                            from: versions[row.id]?.localVersion ?? "?",
                            to: versions[row.id]?.latestVersion ?? "?",
                          })}
                        </p>
                        <p className="mt-1 text-xs text-[#a6adc8]">
                          {t("onboarding.cliGate.updateHint")}
                        </p>
                        <CommandBox
                          cmd={UPDATE_CMD[row.model]}
                          copied={copied}
                          onCopy={handleCopy}
                          t={t}
                        />
                      </div>
                    )}
                </div>
              );
            })}
          </div>
        )}

        {/* ── Step ③: connect a project + seed a sample PRD ─────────────── */}
        {step === "prd" && (
          <div className="max-h-[60vh] space-y-3 overflow-auto px-6 py-5">
            {!hasProject ? (
              <>
                <button
                  onClick={connectFolder}
                  className="w-full rounded-md bg-[#89b4fa] px-3 py-2 text-sm font-semibold text-[#1e1e2e] transition-colors hover:bg-[#74c7ec]"
                >
                  {t("onboarding.cliGate.project.connectFolder")}
                </button>
                <p className="text-xs text-[#7f849c]">
                  {t("onboarding.cliGate.project.hint")}
                </p>
              </>
            ) : (
              <>
                <div className="flex items-center gap-2 rounded-md border border-[#a6e3a1]/30 bg-[#a6e3a1]/10 px-3 py-2.5 text-sm text-[#a6e3a1]">
                  <span>✓ {t("onboarding.cliGate.project.connected")}</span>
                  <span className="text-[#a6adc8]">·</span>
                  <span className="text-[#a6adc8]">
                    {t("onboarding.cliGate.project.launching")}
                  </span>
                </div>
                <button
                  onClick={() => void seedSamplePrd()}
                  disabled={seeding}
                  className="w-full rounded-md border border-[#45475a] px-3 py-2 text-sm font-medium text-[#cdd6f4] transition-colors hover:bg-[#313244] disabled:opacity-60"
                >
                  {seeding
                    ? t("onboarding.cliGate.project.seeding")
                    : t("onboarding.cliGate.project.seedPrd")}
                </button>
                {seedMsg && (
                  <p
                    className={`text-xs ${
                      seedMsg.ok ? "text-[#a6e3a1]" : "text-[#f38ba8]"
                    }`}
                  >
                    {seedMsg.text}
                  </p>
                )}
              </>
            )}
          </div>
        )}

        {/* ── Step ④: hand the PRD to the orchestrator — the first ticket ── */}
        {step === "firstTicket" && (
          <div className="max-h-[60vh] space-y-3 overflow-auto px-6 py-5">
            <button
              onClick={() => void createFirstTicket()}
              disabled={sendingTicket || !hasProject}
              className="w-full rounded-md bg-[#a6e3a1] px-3 py-2.5 text-sm font-semibold text-[#1e1e2e] transition-colors hover:bg-[#94e2d5] disabled:cursor-not-allowed disabled:opacity-50"
            >
              {sendingTicket
                ? t("onboarding.cliGate.firstTicket.creating")
                : t("onboarding.cliGate.firstTicket.create")}
            </button>
            {!hasProject && (
              <p className="text-xs text-[#f9e2af]">
                {t("onboarding.cliGate.firstTicket.needProject")}
              </p>
            )}
            {ticketMsg && (
              <p
                className={`text-xs ${
                  ticketMsg.ok ? "text-[#a6e3a1]" : "text-[#f38ba8]"
                }`}
              >
                {ticketMsg.text}
              </p>
            )}
          </div>
        )}

        {/* ── Contextual footer per step ────────────────────────────────── */}
        <div className="flex items-center justify-between gap-3 border-t border-[#313244] px-6 py-4">
          {/* Left cluster: Re-check (install/auth steps only), else a spacer. */}
          {step === "install" || step === "auth" ? (
            <button
              onClick={() => {
                void probeAll();
                refreshVersions();
              }}
              disabled={anyChecking}
              className="rounded-md border border-[#45475a] px-3 py-1.5 text-xs text-[#cdd6f4] transition-colors hover:bg-[#313244] disabled:opacity-60"
            >
              {anyChecking
                ? t("onboarding.cliGate.checking")
                : t("onboarding.cliGate.recheck")}
            </button>
          ) : (
            <span />
          )}

          <div className="flex items-center gap-2">
            {/* Later / Done — dismiss. Labeled "Done" on the final step. */}
            <button
              onClick={dismiss}
              className="rounded-md px-3 py-1.5 text-xs text-[#a6adc8] transition-colors hover:text-[#cdd6f4]"
            >
              {step === "firstTicket"
                ? t("onboarding.cliGate.done")
                : t("onboarding.cliGate.skip")}
            </button>

            {/* Primary advance button — linear, contextual per step. The final
                step's primary action lives in the body (the big "create first
                ticket" button), so no Next here. */}
            {next && (
              <button
                onClick={() => goToStep(next)}
                disabled={!canAdvance}
                className="rounded-md bg-[#a6e3a1] px-4 py-1.5 text-xs font-semibold text-[#1e1e2e] transition-colors hover:bg-[#94e2d5] disabled:cursor-not-allowed disabled:opacity-40"
              >
                {t("onboarding.cliGate.next")}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function CommandBox({
  cmd,
  copied,
  onCopy,
  t,
}: {
  cmd: string;
  copied: string | null;
  onCopy: (cmd: string) => void;
  t: ReturnType<typeof useTranslation>["t"];
}) {
  return (
    <div className="mt-1.5 flex items-center gap-2">
      <code className="flex-1 overflow-x-auto rounded bg-[#11111b] px-2 py-1.5 font-mono text-xs text-[#a6e3a1]">
        {cmd}
      </code>
      <button
        onClick={() => onCopy(cmd)}
        className="shrink-0 rounded-md border border-[#45475a] px-2.5 py-1.5 text-xs text-[#cdd6f4] transition-colors hover:bg-[#313244]"
      >
        {copied === cmd
          ? t("onboarding.cliGate.copied")
          : t("onboarding.cliGate.copy")}
      </button>
    </div>
  );
}

function StatusBadge({
  state,
  installing,
  t,
}: {
  state: CliState | undefined;
  installing: boolean;
  t: ReturnType<typeof useTranslation>["t"];
}) {
  if (installing) {
    return (
      <span className="shrink-0 text-xs text-[#89b4fa]">
        {t("onboarding.cliGate.installing")}
      </span>
    );
  }
  if (!state || state.checking) {
    return (
      <span className="shrink-0 text-xs text-[#7f849c]">
        {t("onboarding.cliGate.checking")}
      </span>
    );
  }
  if (isReady(state)) {
    return (
      <span className="shrink-0 rounded px-2 py-0.5 text-xs font-medium text-[#a6e3a1]">
        ✓ {t("onboarding.cliGate.ready")}
      </span>
    );
  }
  if (!state.installed) {
    return (
      <span className="shrink-0 rounded px-2 py-0.5 text-xs font-medium text-[#f38ba8]">
        {t("onboarding.cliGate.notInstalled")}
      </span>
    );
  }
  return (
    <span className="shrink-0 rounded px-2 py-0.5 text-xs font-medium text-[#f9e2af]">
      {t("onboarding.cliGate.needsLogin")}
    </span>
  );
}
