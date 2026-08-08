import { create } from "zustand";
import { t } from "../lib/i18n";
import {
  requiredInstalled as computeRequiredInstalled,
  requiredReady as computeRequiredReady,
} from "../lib/cliSetupGate";
import {
  pendingInstallRows,
  type BulkInstallProgress,
} from "../lib/oneClickSetup";

/**
 * Shared CLI setup engine state — the probe / install / version machinery that
 * used to live inside CliSetupGate.tsx.
 *
 * It moved into a store (rather than a hook) because two very different
 * surfaces now consume the SAME state and must never double-probe or
 * double-auto-install:
 *   - the legacy Layout's modal gate (flag OFF), and
 *   - the Start Here tab + its inline "CLI 인증 필요" banner (flag ON).
 * Only one of those trees mounts at a time, but the tab is lazily mounted while
 * the banner host is always mounted, so the state has to outlive either.
 *
 * ★ Nothing here is reimplemented: the probe contract (harness.cliAuthCheck —
 * the same probe the spawn guard uses), the Claude-OR-Codex `.some` readiness
 * rule (ticket #579 via lib/cliSetupGate), the auto-install semantics and the
 * advisory version check are lifted verbatim from the gate.
 */

export type CliModel = "claude" | "codex" | "grok" | "antigravity";
export type CliRowId =
  | "cli-claude-code"
  | "cli-codex"
  | "cli-grok"
  | "cli-antigravity";

export interface CliRow {
  id: CliRowId;
  model: CliModel;
  required: boolean;
  /** npm-global installs can be auto-installed silently. Shell installers
   * (agy) are optional and installed only on explicit click. */
  autoInstall: boolean;
}

/**
 * Claude and Codex are orchestrator candidates: either one being installed and
 * authenticated is enough (#579 `.some`). Both are still recommended and
 * auto-installed in the background; Antigravity remains optional.
 */
export const ORCHESTRATOR_CLI_IDS: CliRowId[] = [
  "cli-claude-code",
  "cli-codex",
];

export const ROWS: CliRow[] = [
  { id: "cli-claude-code", model: "claude", required: true, autoInstall: true },
  { id: "cli-codex", model: "codex", required: false, autoInstall: true },
  { id: "cli-grok", model: "grok", required: false, autoInstall: false },
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
export const UPDATE_CMD: Record<CliModel, string> = {
  claude: "curl -fsSL https://claude.ai/install.sh | bash",
  codex: "curl -fsSL https://chatgpt.com/codex/install.sh | sh",
  grok: "curl -fsSL https://x.ai/cli/install.sh | bash",
  antigravity: "curl -fsSL https://antigravity.google/cli/install.sh | bash",
};

/** Official install/docs page per CLI — the "official method" fallback link
 * shown next to the manual command when auto-install fails. */
export const DOCS_URL: Record<CliModel, string> = {
  claude: "https://code.claude.com/docs/en/setup",
  codex: "https://github.com/openai/codex",
  grok: "https://x.ai/cli",
  antigravity: "https://antigravity.google",
};

export type CliState = CliAuthResult & { checking: boolean };

const TEST_CLI_AUTH_OVERRIDES_KEY = "marblo:test:cliAuthOverrides";

export function isCliReady(s: CliState | undefined): boolean {
  return !!s && s.installed && s.authenticated;
}

export function cliLabel(model: CliModel): string {
  return model === "claude"
    ? "Claude Code"
    : model === "codex"
      ? "Codex (GPT)"
      : model === "grok"
        ? "Grok Build"
        : "Antigravity (agy)";
}

function testCliAuthOverride(model: CliModel): CliAuthResult | null {
  if (!window.electronAPI?.testMode?.bypassAuth) return null;
  try {
    const raw = localStorage.getItem(TEST_CLI_AUTH_OVERRIDES_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const override = parsed[model] as Partial<CliAuthResult> | undefined;
    if (!override || typeof override !== "object") return null;
    return {
      installed: override.installed === true,
      authenticated: override.authenticated === true,
      action:
        typeof override.action === "string"
          ? override.action
          : model === "codex"
            ? "codex login"
            : `${model} login`,
    };
  } catch {
    return null;
  }
}

interface CliSetupState {
  /** Per-row probe result + in-flight flag (render state). */
  states: Record<string, CliState>;
  /**
   * Raw probe results, no `checking` noise. Callers that need the truth
   * synchronously right after `probeAll` read this instead of `states`
   * (React state lags the async probe — this is the old `resultsRef`).
   */
  results: Record<string, CliAuthResult>;
  /** Advisory local↔latest versions, keyed by row id. Never gates readiness. */
  versions: Record<string, HarnessVersionInfo>;
  /** At least one orchestrator candidate is installed AND authenticated. */
  ready: boolean;
  /** Row id currently installing, if any. */
  installing: string | null;
  installErrors: Record<string, string>;
  /** A sign-in command is running in a terminal — drives the auto-recheck poll. */
  loginRunning: boolean;
  /**
   * Live progress of a "모두 설치" pass, or null when none has run this
   * session. Per-row errors stay in `installErrors` so each failed card keeps
   * its own manual command + docs fallback.
   */
  bulkInstall: BulkInstallProgress | null;
  /**
   * The user pressed one of the one-click buttons (모두 설치 / 원클릭 사인인)
   * in THIS session. Guards the "setup finished → reveal the orchestrator"
   * jump so it can't fire on the cold-start ready edge of an already
   * set-up user (see lib/oneClickSetup.shouldRevealOrchestrator).
   */
  setupInitiated: boolean;

  probe: (model: CliModel, id: string) => Promise<CliAuthResult>;
  probeAll: () => Promise<{
    results: Record<string, CliAuthResult>;
    requiredReady: boolean;
  }>;
  runInstall: (row: CliRow) => Promise<void>;
  /** One-click: install every not-yet-installed row of `rows`, in order. */
  runInstallAll: (rows: CliRow[]) => Promise<void>;
  refreshVersions: () => void;
  setLoginRunning: (v: boolean) => void;
  markSetupInitiated: () => void;
  /** Whether any orchestrator candidate is at least installed (live). */
  requiredInstalled: () => boolean;
}

export const useCliSetupStore = create<CliSetupState>((set, get) => ({
  states: {},
  results: {},
  versions: {},
  ready: false,
  installing: null,
  installErrors: {},
  loginRunning: false,
  bulkInstall: null,
  setupInitiated: false,

  probe: async (model, id) => {
    set((s) => ({
      states: {
        ...s.states,
        [id]: {
          ...(s.states[id] ?? { installed: false, authenticated: false }),
          checking: true,
        },
      },
    }));
    try {
      const res =
        testCliAuthOverride(model) ??
        (await window.electronAPI.harness.cliAuthCheck(model));
      set((s) => ({
        results: { ...s.results, [id]: res },
        states: { ...s.states, [id]: { ...res, checking: false } },
      }));
      return res;
    } catch {
      const miss = { installed: false, authenticated: false } as CliAuthResult;
      set((s) => ({
        results: { ...s.results, [id]: miss },
        states: { ...s.states, [id]: { ...miss, checking: false } },
      }));
      return miss;
    }
  },

  probeAll: async () => {
    const { probe } = get();
    const results: Record<string, CliAuthResult> = {};
    await Promise.all(
      ROWS.map(async (r) => {
        results[r.id] = await probe(r.model, r.id);
      }),
    );
    const requiredReady = computeRequiredReady(ORCHESTRATOR_CLI_IDS, results);
    set({ ready: requiredReady });
    return { results, requiredReady };
  },

  runInstall: async (row) => {
    set((s) => ({
      installing: row.id,
      installErrors: { ...s.installErrors, [row.id]: "" },
    }));
    try {
      const result = await window.electronAPI.harness.install(row.id);
      if (!result.success) {
        set((s) => ({
          installErrors: {
            ...s.installErrors,
            [row.id]: result.error ?? t("onboarding.cliGate.installFail"),
          },
        }));
      }
    } catch (err) {
      set((s) => ({
        installErrors: {
          ...s.installErrors,
          [row.id]:
            err instanceof Error
              ? err.message
              : t("onboarding.cliGate.installFail"),
        },
      }));
    } finally {
      set({ installing: null });
      await get().probe(row.model, row.id);
    }
  },

  /**
   * ★"모두 설치" — the one click that replaces "press install on every row".
   *
   * SEQUENTIAL on purpose: these are shell installers (`curl … | bash`) that
   * write into the same `~/.local/bin` and shell rc, and `runInstall` keys the
   * per-row spinner off a single `installing` id. Running them in parallel
   * would race those writes and make the row spinners lie about which CLI is
   * being installed.
   *
   * Already-installed rows are skipped (pendingInstallRows), so a second click
   * only retries what actually failed. A failure never aborts the pass — each
   * failed row keeps its error in `installErrors`, which renders that row's
   * manual command + official docs fallback, and the remaining CLIs still get
   * installed.
   */
  runInstallAll: async (rows) => {
    if (get().bulkInstall?.running) return; // already running — ignore re-click
    const targets = pendingInstallRows(rows, get().results);
    set({
      setupInitiated: true,
      bulkInstall: {
        running: true,
        total: targets.length,
        done: 0,
        failedIds: [],
      },
    });
    if (targets.length === 0) {
      set((s) => ({
        bulkInstall: s.bulkInstall
          ? { ...s.bulkInstall, running: false }
          : null,
      }));
      return;
    }
    for (const row of targets) {
      await get().runInstall(row);
      // runInstall re-probes the row, so `results` is the truth about whether
      // the install actually took — not just whether the IPC resolved.
      const installed = get().results[row.id]?.installed === true;
      set((s) => ({
        bulkInstall: s.bulkInstall
          ? {
              ...s.bulkInstall,
              done: s.bulkInstall.done + 1,
              failedIds: installed
                ? s.bulkInstall.failedIds
                : [...s.bulkInstall.failedIds, row.id],
            }
          : null,
      }));
    }
    // Refresh readiness once at the end (each runInstall only re-probed its
    // own row, which leaves `ready` stale).
    await get().probeAll();
    set((s) => ({
      bulkInstall: s.bulkInstall ? { ...s.bulkInstall, running: false } : null,
    }));
  },

  // Non-blocking version probe (npm view under the hood). Fire-and-forget so a
  // slow/offline lookup never stalls the surface or the readiness spinner.
  refreshVersions: () => {
    window.electronAPI.harness
      .versions()
      .then((v) => set({ versions: v }))
      .catch(() => {
        /* advisory only — ignore failures */
      });
  },

  setLoginRunning: (v) => set({ loginRunning: v }),

  markSetupInitiated: () => set({ setupInitiated: true }),

  requiredInstalled: () =>
    computeRequiredInstalled(ORCHESTRATOR_CLI_IDS, get().results),
}));
