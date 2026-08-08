import { useCallback, useMemo, useState } from "react";
import { useTranslation } from "../../lib/i18n";
import {
  DOCS_URL,
  ORCHESTRATOR_CLI_IDS,
  ROWS,
  UPDATE_CMD,
  cliLabel,
  isCliReady,
  useCliSetupStore,
  type CliRow,
  type CliState,
} from "../../stores/cliSetupStore";
import {
  bulkInstallOutcome,
  loginCommandFor,
  pendingInstallRows,
  signInRows,
} from "../../lib/oneClickSetup";
import { launchLogin, oneClickSignIn } from "../../services/cliSetupActions";

/**
 * The per-CLI row UI shared by both onboarding surfaces: the legacy modal
 * (CliSetupGate) and the Start Here tab. Presentation only — every decision
 * (probe results, readiness, install errors) comes from cliSetupStore, so the
 * two surfaces can never drift apart in what they claim about a CLI.
 */

type TFn = ReturnType<typeof useTranslation>["t"];

const SUBSCRIPTION_URL: Partial<Record<CliRow["model"], string>> = {
  claude: "https://claude.com/pricing",
  codex: "https://chatgpt.com/pricing/",
};

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
  // The auth step never types `cmd` blindly: for a not-installed CLI the probe
  // puts the INSTALL command in `action`, and a failed probe puts an error
  // string there. loginCommandFor keeps the sign-in button honest (and present
  // — it used to disappear entirely whenever `action` was empty).
  const loginCmd = loginCommandFor(row.model, state?.action);
  const subscriptionUrl = SUBSCRIPTION_URL[row.model];

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
        !state.authenticated && (
          <div className="mt-3">
            <p className="text-xs text-[#a6adc8]">
              {t("onboarding.cliGate.loginHint")}
            </p>
            <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1">
              <button
                data-testid={`cli-run-login-${row.model}`}
                onClick={() =>
                  void launchLogin(row.model, loginCmd, onLoginLaunched)
                }
                className="rounded-md bg-[#89b4fa] px-3 py-1.5 text-xs font-medium text-[#1e1e2e] transition-colors hover:bg-[#74c7ec]"
              >
                {t("onboarding.cliGate.runLogin")}
              </button>
              <span className="text-[10px] text-[#7f849c]">
                {t("onboarding.cliGate.runLoginHint")}
              </span>
            </div>
            <CommandBox cmd={loginCmd} />
          </div>
        )}

      {phase === "auth" &&
        subscriptionUrl &&
        state &&
        !state.checking &&
        !state.authenticated && (
          <div
            data-testid={`subscription-helper-${row.model}`}
            className="mt-3 rounded-md border border-[#45475a] bg-[#11111b]/45 px-3 py-2.5"
          >
            <p className="text-xs font-medium text-[#cdd6f4]">
              {t("onboarding.cliGate.subscription.title")}
            </p>
            <p className="mt-1 text-xs leading-5 text-[#a6adc8]">
              {t("onboarding.cliGate.subscription.body")}
            </p>
            <p className="mt-1 text-xs leading-5 text-[#7f849c]">
              {t("onboarding.cliGate.subscription.byomComplement")}
            </p>
            <a
              href={subscriptionUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-2 inline-block text-xs font-medium text-[#89b4fa] underline decoration-dotted hover:text-[#74c7ec]"
            >
              {row.model === "claude"
                ? t("onboarding.cliGate.subscription.openClaude")
                : t("onboarding.cliGate.subscription.openCodex")}{" "}
              ↗
            </a>
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

/**
 * ★①단계의 원클릭 — "필수 CLI 모두 설치".
 *
 * 종전에는 행마다 [설치] 를 눌러야 했고, 어느 행이 아직 미설치인지도 사용자가
 * 직접 읽어 판단해야 했다(활성화 진단 #850 의 최상단 마찰). 이 패널은 그 판단을
 * 대신한다: 미설치 행만 골라 순차 설치하고, 진행률(n/총)과 실패 행 수를 한 줄로
 * 보여준다. 실패한 행은 자기 카드에 수동 명령 + 공식문서 링크를 그대로 띄우므로
 * 폴백은 원래대로 살아 있다.
 *
 * 대상은 오케스트레이터 후보(Claude/Codex)뿐이다 — 이 둘 중 하나만 준비되면
 * 오케가 뜬다(#579). Grok·Antigravity 는 선택 확장이라 각 행의 개별 설치 버튼에
 * 남는다: "모두 설치" 한 번이 사용자가 고르지도 않은 벤더 인스톨러 두 개를 더
 * 실행해서는 안 된다.
 */
export function InstallAllPanel() {
  const { t } = useTranslation();
  const results = useCliSetupStore((s) => s.results);
  const states = useCliSetupStore((s) => s.states);
  const bulk = useCliSetupStore((s) => s.bulkInstall);
  const runInstallAll = useCliSetupStore((s) => s.runInstallAll);

  const targetRows = useMemo(
    () => ROWS.filter((r) => r.autoInstall || r.required),
    [],
  );
  const pending = useMemo(
    () => pendingInstallRows(targetRows, results),
    [targetRows, results],
  );
  const checking = targetRows.some((r) => states[r.id]?.checking);
  const running = bulk?.running === true;

  // 전부 설치돼 있으면 버튼 대신 완료 줄만 남긴다(누를 게 없는 버튼을 띄우지
  // 않는다 — 눌러도 아무 일이 없는 버튼이 곧 "고장난 앱" 으로 읽힌다).
  if (!running && pending.length === 0) {
    return (
      <div
        data-testid="cli-install-all"
        className="rounded-md border border-[#a6e3a1]/30 bg-[#a6e3a1]/10 px-3 py-2.5 text-xs text-[#a6e3a1]"
      >
        ✓ {t("onboarding.cliGate.installAll.allDone")}
      </div>
    );
  }

  return (
    <div
      data-testid="cli-install-all"
      className="rounded-lg border border-[#89b4fa]/30 bg-[#89b4fa]/5 px-3 py-3"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0">
          <p className="text-sm font-semibold text-[#cdd6f4]">
            {t("onboarding.cliGate.installAll.title")}
          </p>
          <p className="mt-0.5 text-xs text-[#a6adc8]">
            {t("onboarding.cliGate.installAll.body")}
          </p>
        </div>
        <button
          type="button"
          data-testid="cli-install-all-button"
          onClick={() => void runInstallAll(targetRows)}
          disabled={running || checking}
          className="shrink-0 rounded-md bg-[#89b4fa] px-3.5 py-2 text-xs font-semibold text-[#1e1e2e] transition-colors hover:bg-[#74c7ec] disabled:opacity-60"
        >
          {running
            ? t("onboarding.cliGate.installAll.running", {
                done: bulk?.done ?? 0,
                total: bulk?.total ?? 0,
              })
            : t("onboarding.cliGate.installAll.cta", {
                count: pending.length,
              })}
        </button>
      </div>

      {bulk && bulk.total > 0 && (
        <div className="mt-2.5">
          <div className="h-1.5 overflow-hidden rounded-full bg-[#313244]">
            <div
              data-testid="cli-install-all-progress"
              className="h-full rounded-full bg-[#89b4fa] transition-all duration-300"
              style={{ width: `${(bulk.done / bulk.total) * 100}%` }}
            />
          </div>
          {!bulk.running && (
            <p
              data-testid="cli-install-all-result"
              className={`mt-1.5 text-xs ${
                bulkInstallOutcome(bulk) === "success"
                  ? "text-[#a6e3a1]"
                  : "text-[#f9e2af]"
              }`}
            >
              {bulkInstallOutcome(bulk) === "success"
                ? t("onboarding.cliGate.installAll.done", { total: bulk.total })
                : t("onboarding.cliGate.installAll.partial", {
                    failed: bulk.failedIds.length,
                    total: bulk.total,
                  })}
            </p>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * ★②단계의 원클릭 — "원클릭 사인인".
 *
 * 누르면 우리 터미널 탭이 자동 생성되고 그 CLI 의 로그인 명령이 자동 입력된다
 * (`launchLogin` → `pty.writeAndSubmit`). CLI 가 브라우저 device-code 페이지를
 * 띄우면 사용자는 브라우저에서 승인만 하면 된다 — 터미널을 직접 열거나 명령을
 * 타이핑하는 수동 작업이 0 이 되는 지점이다. 인증 완료는 엔진의 auto-recheck
 * 폴이 스스로 감지한다(`loginRunning`).
 *
 * 대상 선택은 `signInRows` 가 한다: 설치돼 있고 아직 미인증인 행 중 오케 후보
 * (Claude/Codex)가 먼저다. 한 번에 하나만 여는 이유는 서비스 쪽 주석 참고.
 */
export function OneClickSignInPanel() {
  const { t } = useTranslation();
  const results = useCliSetupStore((s) => s.results);
  const loginRunning = useCliSetupStore((s) => s.loginRunning);
  const [launched, setLaunched] = useState<string | null>(null);

  const targets = useMemo(
    () => signInRows(ROWS, results, ORCHESTRATOR_CLI_IDS),
    [results],
  );
  const target = targets[0];

  // 설치된 미인증 CLI 가 없다 — 인증할 대상 자체가 없으므로 ①단계(설치)나 BYOM
  // 안내가 다음 액션이다. 이 패널은 조용히 빠진다.
  if (!target) return null;

  return (
    <div
      data-testid="cli-signin-oneclick"
      className="rounded-lg border border-[#89b4fa]/30 bg-[#89b4fa]/5 px-3 py-3"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0">
          <p className="text-sm font-semibold text-[#cdd6f4]">
            {t("onboarding.cliGate.signInAll.title")}
          </p>
          <p className="mt-0.5 text-xs text-[#a6adc8]">
            {t("onboarding.cliGate.signInAll.body")}
          </p>
        </div>
        <button
          type="button"
          data-testid="cli-signin-oneclick-button"
          onClick={() => {
            const model = oneClickSignIn();
            if (model) setLaunched(cliLabel(model));
          }}
          className="shrink-0 rounded-md bg-[#89b4fa] px-3.5 py-2 text-xs font-semibold text-[#1e1e2e] transition-colors hover:bg-[#74c7ec]"
        >
          {t("onboarding.cliGate.signInAll.cta", {
            cli: cliLabel(target.model),
          })}
        </button>
      </div>
      {launched && (
        <p
          data-testid="cli-signin-oneclick-note"
          className="mt-2 text-xs text-[#a6e3a1]"
        >
          {t("onboarding.cliGate.signInAll.launched", { cli: launched })}
          {loginRunning && (
            <span className="ml-1 text-[#a6adc8]">
              {t("onboarding.cliGate.signInAll.watching")}
            </span>
          )}
        </p>
      )}
      {targets.length > 1 && (
        <p className="mt-1.5 text-[11px] text-[#7f849c]">
          {t("onboarding.cliGate.signInAll.others", {
            count: targets.length - 1,
          })}
        </p>
      )}
    </div>
  );
}
