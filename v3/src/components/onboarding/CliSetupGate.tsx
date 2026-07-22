import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "../../lib/i18n";
import type { MessageKey } from "../../locales/ko";
import { useTerminalStore } from "../../stores/terminalStore";
import { useProjectStore } from "../../stores/projectStore";
import { useEditorStore } from "../../stores/editorStore";
import telemetry from "../../services/telemetryService";
import {
  autoInstallComplete,
  requiredInstalled as computeRequiredInstalled,
  resolveGateVisibility,
} from "../../lib/cliSetupGate";
import { CliFailSurvey } from "./CliFailSurvey";

/**
 * First-run CLI setup gate.
 *
 * The designed onboarding wizard (WelcomeScreen/SetupWizard/OnboardingSteps)
 * was dead code — it only rendered from the Next.js-style `src/app/onboarding`
 * route, which this Vite+Electron SPA never mounts (QA vj7ZvHphYOIhsNd340ad).
 * New users reached the board with no guidance to install / log in to the CLIs
 * the orchestrator and agents need, so `claude` silently failed to spawn.
 *
 * This is a real, mounted gate (Layout renders it as an overlay). It live-probes
 * install + login state via harness.cliAuthCheck — the SAME probe the spawn
 * guard uses — for the REQUIRED set (claude only) and the OPTIONAL Codex (GPT)
 * and Antigravity (agy). On mount it AUTO-INSTALLS any missing auto-installable
 * CLI in the background (no click); on failure it falls back to the manual
 * `npm install -g …` command. Login is one-click ("Run sign-in" spawns a
 * terminal and runs the login command) with copy/re-check as fallbacks.
 *
 * Orchestrator-first onboarding: the gate does NOT block the empty board before
 * a project/folder is connected — it stays quiet and only auto-installs in the
 * background. The blocking overlay surfaces at orchestrator-launch time (via the
 * `marblo:open-cli-setup` event from useOrchestratorAutoLaunch's needsAuth
 * branch, the spawn guard, and the agent:needsAuth backstop), i.e. exactly when
 * Claude auth is actually needed. When Claude becomes authenticated the gate
 * emits `marblo:cli-auth-ready` so the orchestrator auto-launch resumes with no
 * manual re-check.
 *
 * An already-set-up user (claude installed & authed) never sees it.
 *
 * ── Ordered connection wizard (ticket CecrriY8) ──────────────────────────
 * The single-panel gate is now presented as an ORDERED 3-step wizard while
 * keeping every behavior above intact (probe, auto-install, dismissal,
 * one-click sign-in, auto-recheck, `marblo:cli-auth-ready`, re-open listener):
 *   1. notice  — cost/account-connect notice ("AI 사용료 미포함, 기존 Claude
 *                Code·Codex 계정 연결"; the BYOK term is deliberately avoided).
 *   2. connect — the CLI rows: detect → one-click install / copy command →
 *                built-in terminal sign-in → auth confirmation.
 *   3. project — connect a folder (→ orchestrator auto-launches) with an
 *                optional sample PRD.md seeded + opened in the editor.
 * Each step's enter/success/fail is instrumented via telemetry.cliSetupStep,
 * reusing the same cli_auth / launch_error vocabulary as orchestratorBlocked
 * so the two funnels join on one axis. Already-authed users still never see
 * the wizard; a blocked-launch re-open (project already exists) starts at the
 * connect step and skips the project step (auto-launch resumes on auth).
 */

const DISMISSED_KEY = "marblo.cliSetupGateDismissed";
const AUTO_INSTALL_KEY = "marblo.cliAutoInstallDone";
// Sticky "the intro/cost notice has been shown once" flag. First run starts at
// the notice step; later re-opens (e.g. a blocked orchestrator launch mid-
// session) skip straight to the connect step so we don't re-lecture the user.
const NOTICE_SEEN_KEY = "marblo.cliWizardNoticeSeen";

type WizardStep = "notice" | "connect" | "project";

type Model = "claude" | "codex" | "antigravity";

interface CliRow {
  id: "cli-claude-code" | "cli-codex" | "cli-antigravity";
  model: Model;
  required: boolean;
  /** npm-global installs can be auto-installed silently. Shell installers
   * (agy) are optional and installed only on explicit click. */
  autoInstall: boolean;
}

// Claude is the ONLY required CLI: it powers the orchestrator, which is the
// hub of the orchestrator-first onboarding flow (folder → project → orchestrator).
// Codex is secondary here (it runs spawned Codex/GPT agents) — a codex-only
// orchestrator is a separate follow-up — so it's optional and never blocks the
// gate. It still auto-installs in the background (autoInstall) for convenience.
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
 * Reused by the version-check advisory when an installed CLI is behind. */
const UPDATE_CMD: Record<Model, string> = {
  claude: "npm install -g @anthropic-ai/claude-code",
  codex: "npm install -g @openai/codex",
  antigravity: "curl -fsSL https://antigravity.google/cli/install.sh | bash",
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
  const [ready, setReady] = useState(false); // required set (claude+codex) satisfied
  const [loginRunning, setLoginRunning] = useState(false); // sign-in launched in a terminal
  // Local↔latest CLI versions (keyed by row id). Advisory only — used to warn
  // when an installed CLI is behind so an outdated build isn't silently passed
  // through the auth-only gate. Never blocks readiness.
  const [versions, setVersions] = useState<Record<string, HarnessVersionInfo>>(
    {}
  );
  const autoRunRef = useRef(false); // one auto-install pass per mount

  // ── Wizard step state (ticket CecrriY8) ─────────────────────────────────
  const [step, setStep] = useState<WizardStep>("notice");
  const [seeding, setSeeding] = useState(false); // sample-PRD write in flight
  const [seedMsg, setSeedMsg] = useState<{ ok: boolean; text: string } | null>(
    null
  );

  // Orchestrator-first onboarding: before a project/folder is connected the gate
  // must not block the empty board. We keep a live ref (the auto-install pass is
  // async and a folder may be connected mid-flight) so the blocking overlay is
  // only auto-shown once a project exists; auto-install still runs silently.
  const hasProject = useProjectStore((s) => !!s.currentProject?.folderPath);
  const hasProjectRef = useRef(hasProject);
  hasProjectRef.current = hasProject;

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

  // First run opens at the cost/notice step; a later re-open (blocked launch
  // mid-session) skips to connect so we don't re-show the intro every time.
  const initialStep = useCallback((): WizardStep => {
    try {
      return localStorage.getItem(NOTICE_SEEN_KEY) === "1"
        ? "connect"
        : "notice";
    } catch {
      return "notice";
    }
  }, []);

  // Show the wizard at the right starting step and log that step's entry.
  // Centralizes the "become visible" transition so every entry point (auto-run
  // decision, re-open listener) lands on a consistent, instrumented step.
  const openWizard = useCallback(() => {
    const s = initialStep();
    setStep(s);
    setVisible(true);
    telemetry.cliSetupStep(s, "enter");
  }, [initialStep]);

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
      setStates((prev) => ({ ...prev, [id]: { ...res, checking: false } }));
      return res;
    } catch {
      const miss = { installed: false, authenticated: false };
      setStates((prev) => ({ ...prev, [id]: { ...miss, checking: false } }));
      return miss as CliAuthResult;
    }
  }, []);

  // Probe every row; return the raw results + whether the REQUIRED set is ready
  // (used synchronously by the auto-install pass, since React state lags).
  const probeAll = useCallback(async () => {
    const results: Record<string, CliAuthResult> = {};
    await Promise.all(
      ROWS.map(async (r) => {
        results[r.id] = await probe(r.model, r.id);
      })
    );
    const requiredReady = ROWS.filter((r) => r.required).every(
      (r) => results[r.id]?.installed && results[r.id]?.authenticated
    );
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
      // Auto-install every auto-installable CLI that's missing — including the
      // now-optional Codex — so the fleet is ready without a click. Optional
      // rows install silently; only Claude (required) can gate visibility.
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

      // A prior "Later" is honored only while the required CLIs are at least
      // installed. If one is still missing the user can't launch anything, so
      // re-surface the gate and clear the stale dismissal — the next run keeps
      // behaving like a first run until install succeeds (FT-6). Login-only
      // gaps (installed but not authed) still respect the dismissal.
      const requiredIds = ROWS.filter((r) => r.required).map((r) => r.id);
      const decision = resolveGateVisibility({
        requiredReady,
        requiredInstalled: computeRequiredInstalled(requiredIds, latest),
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
    // CLI-fail drop-off: dismissing the connect step before Claude is authed is
    // the same "couldn't connect the CLI" failure orchestratorBlocked reports —
    // log it with the same cli_auth vocabulary so both funnels line up, then
    // surface the 5-second "무엇이 어려우셨나요?" survey once before closing.
    // Any other dismiss (notice, or a connected/ready project step) just closes.
    if (step === "connect" && !ready) {
      telemetry.cliSetupStep("connect", "fail", "cli_auth");
      let surveyDone = false;
      try {
        surveyDone = localStorage.getItem("marblo.survey.cli_fail") === "1";
      } catch {}
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

  // notice → connect. Persist that the intro was seen so re-opens skip it.
  const advanceFromNotice = useCallback(() => {
    try {
      localStorage.setItem(NOTICE_SEEN_KEY, "1");
    } catch {
      /* private mode — best effort; re-shows the notice next time, harmless */
    }
    telemetry.cliSetupStep("notice", "success");
    setStep("connect");
    telemetry.cliSetupStep("connect", "enter");
  }, []);

  // project step: open the native folder picker. useProjectSetup's global
  // `marblo:select-folder` listener auto-registers the folder as a project;
  // useOrchestratorAutoLaunch then boots the orchestrator — this is the wizard's
  // "첫 오케 실행" with no extra wiring here. We stay visible until the project
  // connects (watched below), then auto-close.
  const connectFolder = useCallback(() => {
    window.dispatchEvent(new CustomEvent("marblo:select-folder"));
  }, []);

  // project step: seed a starter PRD.md into the connected folder and open it,
  // so a first-time user has something concrete to hand the orchestrator. Never
  // clobbers an existing PRD.md — if one is already there we just open it.
  const seedSamplePrd = useCallback(async () => {
    const root = useProjectStore.getState().currentProject?.folderPath;
    if (!root) return;
    setSeeding(true);
    setSeedMsg(null);
    try {
      let exists = true;
      try {
        await window.electronAPI.fs.readFile(root, "PRD.md");
      } catch {
        exists = false; // no PRD.md yet — safe to create
      }
      if (!exists) {
        await window.electronAPI.fs.writeFile(
          root,
          "PRD.md",
          t("onboarding.cliGate.prdContent")
        );
      }
      const editor = useEditorStore.getState();
      editor.setRootPath(root);
      await editor.openFile("PRD.md");
      setSeedMsg({ ok: true, text: t("onboarding.cliGate.project.seeded") });
    } catch {
      setSeedMsg({ ok: false, text: t("onboarding.cliGate.project.seedFail") });
    } finally {
      setSeeding(false);
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

  // When the required set (Claude) transitions to ready — via one-click sign-in,
  // manual Re-check, or auto-install completing — emit `marblo:cli-auth-ready`
  // so useOrchestratorAutoLaunch resumes the launch (unchanged contract). Then,
  // in the wizard, advance to the project step when there is no project yet
  // ("인증확인 → 샘플 프로젝트 열기"); if a project already exists (a blocked-
  // launch re-open), close as before and let auto-launch take over. Guarded on
  // the false→true edge so it fires once, never on an already-ready mount.
  const prevReadyRef = useRef(false);
  useEffect(() => {
    if (ready && !prevReadyRef.current) {
      telemetry.cliSetupStep("connect", "success");
      window.dispatchEvent(new CustomEvent("marblo:cli-auth-ready"));
      if (hasProjectRef.current) {
        setVisible(false);
      } else {
        // First-run: guide the freshly-authed user into connecting a project.
        // launchLogin may have hidden the gate to reveal the terminal — re-show
        // it so the project step is actually visible.
        setStep("project");
        setVisible(true);
        telemetry.cliSetupStep("project", "enter");
      }
    }
    prevReadyRef.current = ready;
  }, [ready]);

  // project step: once a folder connects, the orchestrator auto-launches
  // (useOrchestratorAutoLaunch). Log success on the false→true edge of
  // hasProject. We intentionally do NOT auto-close here — the connected view
  // offers the optional "sample PRD" action and a Done button, so the user
  // controls when to dismiss while the orchestrator boots underneath.
  const prevHasProjectRef = useRef(hasProject);
  useEffect(() => {
    if (step === "project" && hasProject && !prevHasProjectRef.current) {
      telemetry.cliSetupStep("project", "success");
    }
    prevHasProjectRef.current = hasProject;
  }, [step, hasProject]);

  // The header's visible steps: always notice + connect; add project for a
  // first-run flow (no project yet) or while the project step is showing.
  const steps = useMemo<WizardStep[]>(() => {
    const base: WizardStep[] = ["notice", "connect"];
    if (!hasProject || step === "project") base.push("project");
    return base;
  }, [hasProject, step]);

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

  const currentIndex = steps.indexOf(step);
  const headerTitle =
    step === "notice"
      ? t("onboarding.cliGate.notice.title")
      : step === "project"
      ? t("onboarding.cliGate.project.title")
      : t("onboarding.cliGate.title");
  const headerSubtitle =
    step === "notice"
      ? t("onboarding.cliGate.notice.body")
      : step === "project"
      ? t("onboarding.cliGate.project.body")
      : t("onboarding.cliGate.subtitle");

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 p-4">
      <div className="w-full max-w-lg rounded-xl border border-[#313244] bg-[#1e1e2e] shadow-2xl">
        <div className="border-b border-[#313244] px-6 py-4">
          {/* Step indicator — dots + labels for the ordered wizard. */}
          <div className="mb-3 flex items-center gap-2">
            {steps.map((sId, i) => {
              const active = i === currentIndex;
              const done = i < currentIndex;
              return (
                <div key={sId} className="flex items-center gap-2">
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
                  {i < steps.length - 1 && (
                    <span className="mx-1 text-[#45475a]">›</span>
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

        {/* ── Step 1: cost / account-connect notice ─────────────────────── */}
        {step === "notice" && (
          <div className="max-h-[60vh] overflow-auto px-6 py-5">
            <ul className="space-y-2.5">
              {[
                t("onboarding.cliGate.notice.b1"),
                t("onboarding.cliGate.notice.b2"),
                t("onboarding.cliGate.notice.b3"),
              ].map((line, i) => (
                <li key={i} className="flex gap-2.5 text-sm text-[#cdd6f4]">
                  <span className="mt-0.5 shrink-0 text-[#89b4fa]">•</span>
                  <span>{line}</span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* ── Step 3: connect a project + first orchestrator run ────────── */}
        {step === "project" && (
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

        {/* ── Step 2: detect / install / sign-in / auth confirmation ────── */}
        <div
          className={`max-h-[60vh] space-y-3 overflow-auto px-6 py-4 ${
            step === "connect" ? "" : "hidden"
          }`}
        >
          {ROWS.map((row) => {
            const s = states[row.id];
            const cmd = s?.action ?? "";
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

                {/* Not installed → install button (auto for required, click for
                    optional). Manual npm/curl command shown only on failure. */}
                {s && !s.checking && !s.installed && (
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
                      <div className="mt-2">
                        <p className="text-xs text-[#f38ba8]">
                          {t("onboarding.cliGate.installFail")}: {installError}
                        </p>
                        {cmd && (
                          <p className="mt-1 text-xs text-[#a6adc8]">
                            {t("onboarding.cliGate.manualHint")}
                          </p>
                        )}
                        {cmd && (
                          <CommandBox
                            cmd={cmd}
                            copied={copied}
                            onCopy={handleCopy}
                            t={t}
                          />
                        )}
                      </div>
                    )}
                  </div>
                )}

                {/* Installed but not authed → one-click "Run sign-in" (spawns a
                    terminal and runs the login command), with copy as fallback. */}
                {s && !s.checking && s.installed && !s.authenticated && cmd && (
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

        {/* ── Contextual footer per step ────────────────────────────────── */}
        <div className="flex items-center justify-between gap-3 border-t border-[#313244] px-6 py-4">
          {/* Left cluster: Re-check (connect step only), else a spacer. */}
          {step === "connect" ? (
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
            {/* Later / Done — dismiss. Labeled "Done" on a connected project. */}
            <button
              onClick={dismiss}
              className="rounded-md px-3 py-1.5 text-xs text-[#a6adc8] transition-colors hover:text-[#cdd6f4]"
            >
              {step === "project" && hasProject
                ? t("onboarding.cliGate.done")
                : t("onboarding.cliGate.skip")}
            </button>

            {/* Primary advance button — contextual per step. */}
            {step === "notice" && (
              <button
                onClick={advanceFromNotice}
                className="rounded-md bg-[#89b4fa] px-4 py-1.5 text-xs font-semibold text-[#1e1e2e] transition-colors hover:bg-[#74c7ec]"
              >
                {t("onboarding.cliGate.notice.continue")}
              </button>
            )}
            {step === "connect" && (
              <button
                onClick={() => {
                  if (hasProject) dismiss();
                  else {
                    setStep("project");
                    telemetry.cliSetupStep("project", "enter");
                  }
                }}
                disabled={!ready}
                className="rounded-md bg-[#a6e3a1] px-4 py-1.5 text-xs font-semibold text-[#1e1e2e] transition-colors hover:bg-[#94e2d5] disabled:cursor-not-allowed disabled:opacity-40"
              >
                {hasProject
                  ? t("onboarding.cliGate.continue")
                  : t("onboarding.cliGate.next")}
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
