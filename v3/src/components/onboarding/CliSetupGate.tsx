import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "../../lib/i18n";
import { useTerminalStore } from "../../stores/terminalStore";
import {
  autoInstallComplete,
  requiredInstalled as computeRequiredInstalled,
  resolveGateVisibility,
} from "../../lib/cliSetupGate";

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
 * guard uses — for the REQUIRED set (claude + codex) and the OPTIONAL
 * Antigravity (agy). On first run it AUTO-INSTALLS any missing required CLI in
 * the background (no click); on failure it falls back to the manual
 * `npm install -g …` command. Login is always manual: copy the command, run it,
 * then re-check without a restart.
 *
 * An already-set-up user (claude + codex installed & authed) never sees it.
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

const ROWS: CliRow[] = [
  { id: "cli-claude-code", model: "claude", required: true, autoInstall: true },
  { id: "cli-codex", model: "codex", required: true, autoInstall: true },
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
  const [states, setStates] = useState<Record<string, CliState>>({});
  const [installing, setInstalling] = useState<string | null>(null);
  const [installErrors, setInstallErrors] = useState<Record<string, string>>(
    {},
  );
  const [copied, setCopied] = useState<string | null>(null);
  const [ready, setReady] = useState(false); // required set (claude+codex) satisfied
  const [loginRunning, setLoginRunning] = useState(false); // sign-in launched in a terminal
  // Local↔latest CLI versions (keyed by row id). Advisory only — used to warn
  // when an installed CLI is behind so an outdated build isn't silently passed
  // through the auth-only gate. Never blocks readiness.
  const [versions, setVersions] = useState<Record<string, HarnessVersionInfo>>(
    {},
  );
  const autoRunRef = useRef(false); // one auto-install pass per mount

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
      }),
    );
    const requiredReady = ROWS.filter((r) => r.required).every(
      (r) => results[r.id]?.installed && results[r.id]?.authenticated,
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
    [probe, t],
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
      const missing = ROWS.filter(
        (r) =>
          r.required &&
          r.autoInstall &&
          first.results[r.id]?.installed === false,
      );
      if (!autoDone && missing.length > 0) {
        setVisible(true); // show progress while auto-installing
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
            latest,
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
      if (decision.visible) setVisible(true);
    })();
    return () => {
      cancelled = true;
    };
  }, [probeAll, runInstall, refreshVersions]);

  // Re-open on demand — the spawn guard dispatches this when a launch is
  // blocked (orchestrator/agent), and agent-manager's login-screen backstop
  // surfaces it via the agent:needsAuth → Layout bridge.
  useEffect(() => {
    const onOpen = () => {
      void probeAll();
      refreshVersions();
      setVisible(true);
    };
    window.addEventListener("marblo:open-cli-setup", onOpen);
    return () => window.removeEventListener("marblo:open-cli-setup", onOpen);
  }, [probeAll, refreshVersions]);

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
    try {
      localStorage.setItem(DISMISSED_KEY, "1");
    } catch {
      /* private mode — best effort */
    }
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

  if (!visible) return null;

  const anyChecking = ROWS.some((r) => states[r.id]?.checking);

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 p-4">
      <div className="w-full max-w-lg rounded-xl border border-[#313244] bg-[#1e1e2e] shadow-2xl">
        <div className="border-b border-[#313244] px-6 py-4">
          <h2 className="text-lg font-semibold text-[#cdd6f4]">
            {t("onboarding.cliGate.title")}
          </h2>
          <p className="mt-1 text-sm text-[#a6adc8]">
            {t("onboarding.cliGate.subtitle")}
          </p>
        </div>

        <div className="max-h-[60vh] space-y-3 overflow-auto px-6 py-4">
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

        <div className="flex items-center justify-between gap-3 border-t border-[#313244] px-6 py-4">
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
          <div className="flex items-center gap-2">
            <button
              onClick={dismiss}
              className="rounded-md px-3 py-1.5 text-xs text-[#a6adc8] transition-colors hover:text-[#cdd6f4]"
            >
              {t("onboarding.cliGate.skip")}
            </button>
            <button
              onClick={dismiss}
              disabled={!ready}
              className="rounded-md bg-[#a6e3a1] px-4 py-1.5 text-xs font-semibold text-[#1e1e2e] transition-colors hover:bg-[#94e2d5] disabled:cursor-not-allowed disabled:opacity-40"
            >
              {t("onboarding.cliGate.continue")}
            </button>
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
