import { useCallback, useState } from "react";
import { useTranslation } from "../../lib/i18n";
import {
  DOCS_URL,
  UPDATE_CMD,
  cliLabel,
  isCliReady,
  useCliSetupStore,
  type CliRow,
  type CliState,
} from "../../stores/cliSetupStore";
import { launchLogin } from "../../services/cliSetupActions";

/**
 * The per-CLI row UI shared by both onboarding surfaces: the legacy modal
 * (CliSetupGate) and the Start Here tab. Presentation only — every decision
 * (probe results, readiness, install errors) comes from cliSetupStore, so the
 * two surfaces can never drift apart in what they claim about a CLI.
 */

type TFn = ReturnType<typeof useTranslation>["t"];

/** Copy-to-clipboard command box with a transient "복사됨" confirmation. */
export function CommandBox({ cmd }: { cmd: string }) {
  const { t } = useTranslation();
  const [copied, setCopied] = useState(false);
  const onCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(cmd);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      /* clipboard blocked — user can select manually */
    }
  }, [cmd]);
  return (
    <div className="mt-1.5 flex items-center gap-2">
      <code className="flex-1 overflow-x-auto rounded bg-[#11111b] px-2 py-1.5 font-mono text-xs text-[#a6e3a1]">
        {cmd}
      </code>
      <button
        onClick={() => void onCopy()}
        className="shrink-0 rounded-md border border-[#45475a] px-2.5 py-1.5 text-xs text-[#cdd6f4] transition-colors hover:bg-[#313244]"
      >
        {copied ? t("onboarding.cliGate.copied") : t("onboarding.cliGate.copy")}
      </button>
    </div>
  );
}

export function StatusBadge({
  state,
  installing,
  t,
}: {
  state: CliState | undefined;
  installing: boolean;
  t: TFn;
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
  if (isCliReady(state)) {
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

export interface CliRowCardProps {
  row: CliRow;
  /** Which phase's actions to offer — install buttons vs sign-in buttons. */
  phase: "install" | "auth";
  /** Called after a sign-in terminal is spawned (the modal hides itself). */
  onLoginLaunched?: () => void;
}

/**
 * One CLI (Claude / Codex / Antigravity): status, the phase-appropriate action,
 * and the "막혔을 때" fallbacks — the manual `npm install -g …` command plus the
 * official docs link when auto-install fails (EACCES / npm prefix perms), and
 * an advisory update hint when an installed CLI is behind. Advisory only: the
 * version check never blocks readiness.
 */
export function CliRowCard({ row, phase, onLoginLaunched }: CliRowCardProps) {
  const { t } = useTranslation();
  const state = useCliSetupStore((s) => s.states[row.id]);
  const installing = useCliSetupStore((s) => s.installing === row.id);
  const installError = useCliSetupStore((s) => s.installErrors[row.id]);
  const version = useCliSetupStore((s) => s.versions[row.id]);
  const runInstall = useCliSetupStore((s) => s.runInstall);

  const cmd = state?.action ?? "";
  const manualCmd = cmd || UPDATE_CMD[row.model];

  return (
    <div className="rounded-lg border border-[#313244] bg-[#181825] p-4">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="font-medium text-[#cdd6f4]">
              {cliLabel(row.model)}
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
                : row.model === "grok"
                  ? // grok 행이 ROWS 에 들어온 뒤로도 이 분기가 없어서 Antigravity
                    // 설명을 달고 있었다 — 브라우저 인증이라는 결정적 차이가 가려졌다.
                    t("onboarding.cliGate.grokDesc")
                  : t("onboarding.cliGate.agyDesc")}
          </p>
        </div>
        <StatusBadge state={state} installing={installing} t={t} />
      </div>

      {/* install: not installed → install button (auto for required, click for
          optional). On failure the manual command + official docs link are
          surfaced so auto-install never dies silently. */}
      {phase === "install" && state && !state.checking && !state.installed && (
        <div className="mt-3">
          <button
            onClick={() => void runInstall(row)}
            disabled={installing}
            className="rounded-md bg-[#89b4fa] px-3 py-1.5 text-xs font-medium text-[#1e1e2e] transition-colors hover:bg-[#74c7ec] disabled:opacity-60"
          >
            {installing
              ? t("onboarding.cliGate.installing")
              : t("onboarding.cliGate.install")}
          </button>
          {installError && (
            <div className="mt-2 rounded-md border border-[#f38ba8]/25 bg-[#f38ba8]/5 p-2.5">
              <p className="text-xs text-[#f38ba8]">
                {t("onboarding.cliGate.installFail")}: {installError}
              </p>
              <p className="mt-1.5 text-xs text-[#a6adc8]">
                {t("onboarding.cliGate.install.officialHint")}
              </p>
              <CommandBox cmd={manualCmd} />
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

      {/* auth: installed but not authed → one-click "Run sign-in" (spawns a
          terminal and runs the login command). */}
      {phase === "auth" &&
        state &&
        !state.checking &&
        state.installed &&
        !state.authenticated &&
        cmd && (
          <div className="mt-3">
            <p className="text-xs text-[#a6adc8]">
              {t("onboarding.cliGate.loginHint")}
            </p>
            <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1">
              <button
                onClick={() =>
                  void launchLogin(row.model, cmd, onLoginLaunched)
                }
                className="rounded-md bg-[#89b4fa] px-3 py-1.5 text-xs font-medium text-[#1e1e2e] transition-colors hover:bg-[#74c7ec]"
              >
                {t("onboarding.cliGate.runLogin")}
              </button>
              <span className="text-[10px] text-[#7f849c]">
                {t("onboarding.cliGate.runLoginHint")}
              </span>
            </div>
            <CommandBox cmd={cmd} />
          </div>
        )}

      {/* auth: not installed yet — point back at the install step. */}
      {phase === "auth" && state && !state.checking && !state.installed && (
        <p className="mt-3 text-xs text-[#f9e2af]">
          {t("onboarding.cliGate.auth.needInstall")}
        </p>
      )}

      {/* Installed but outdated → advisory + update command (FT-5). */}
      {state &&
        !state.checking &&
        state.installed &&
        version?.updateState === "outdated" && (
          <div className="mt-3 rounded-md border border-[#f9e2af]/30 bg-[#f9e2af]/10 p-2.5">
            <p className="text-xs font-medium text-[#f9e2af]">
              {t("onboarding.cliGate.outdated", {
                from: version.localVersion ?? "?",
                to: version.latestVersion ?? "?",
              })}
            </p>
            <p className="mt-1 text-xs text-[#a6adc8]">
              {t("onboarding.cliGate.updateHint")}
            </p>
            <CommandBox cmd={UPDATE_CMD[row.model]} />
          </div>
        )}
    </div>
  );
}
