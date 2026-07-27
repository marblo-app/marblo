import { useCallback, useMemo, useState } from "react";
import { useTranslation } from "../../lib/i18n";
import type { MessageKey } from "../../locales/ko";
import { useProjectStore } from "../../stores/projectStore";
import telemetry from "../../services/telemetryService";
import {
  DISMISSED_KEY,
  canAdvanceWizard,
  nextWizardStep,
  WIZARD_STEPS,
  type WizardStep,
} from "../../lib/cliSetupGate";
import { ROWS, useCliSetupStore } from "../../stores/cliSetupStore";
import {
  useCliSetupEngine,
  useStepPrdSuccess,
} from "../../hooks/useCliSetupEngine";
import {
  connectFolder,
  createFirstTicket,
  seedSamplePrd,
  type ActionResult,
  type FirstTicketResult,
} from "../../services/cliSetupActions";
import { useByomOptions } from "../../hooks/useByomOptions";
import { CliRowCard } from "./CliSetupRows";
import { ByomStartSection } from "./ByomStartSection";
import { CliFailSurvey } from "./CliFailSurvey";
import { FirstTicketResultNote } from "./FirstTicketResultNote";

/**
 * First-run CLI setup gate — the LEGACY (workspace-mode OFF) activation
 * wizard, rendered as a blocking overlay by <Layout />.
 *
 * ★ In the split Workspace shell (flag ON) this modal is gone: onboarding is
 * the first-class "시작하기" tab (StartHereTab) plus a non-blocking inline
 * banner (CliSetupHost). Both surfaces share the SAME engine — cliSetupStore
 * (probe / auto-install / versions), useCliSetupEngine (effects + the #579 /
 * nB4eenxP / bRABKQX7 guards), cliSetupActions (sign-in, PRD seed, first
 * ticket) and CliSetupRows (per-CLI UI). This file is now only the modal
 * chrome + its step/visibility state, so the legacy path keeps behaving
 * exactly as before while the new shell can't drift from it.
 *
 * ── Linear 4-step activation wizard (ticket ir94m9C6) ────────────────────────
 *   ① install     — install the orchestrator CLI (auto `npm i -g`, official
 *                    fallback on failure).
 *   ② auth        — sign in to Claude OR Codex (at least one; #579 `.some`).
 *   ③ prd         — connect a folder (→ orchestrator auto-launches) + seed a
 *                    starter PRD.md, opened in the editor.
 *   ④ firstTicket — hand the PRD to the orchestrator as the first prompt so it
 *                    creates the first ticket, then close and let the user
 *                    watch it work.
 * Each step's enter/success/fail is instrumented via telemetry.cliSetupStep.
 * An already-set-up user never sees this gate.
 */
export function CliSetupGate() {
  const { t } = useTranslation();
  const [visible, setVisible] = useState(false);
  const [showSurvey, setShowSurvey] = useState(false);
  const [step, setStep] = useState<WizardStep>("install");
  const [seeding, setSeeding] = useState(false); // sample-PRD write in flight
  const [seedMsg, setSeedMsg] = useState<ActionResult | null>(null);
  const [sendingTicket, setSendingTicket] = useState(false);
  const [ticketMsg, setTicketMsg] = useState<FirstTicketResult | null>(null);

  const ready = useCliSetupStore((s) => s.ready);
  const states = useCliSetupStore((s) => s.states);
  const probeAll = useCliSetupStore((s) => s.probeAll);
  const refreshVersions = useCliSetupStore((s) => s.refreshVersions);
  const requiredInstalled = useCliSetupStore((s) => s.requiredInstalled());
  const hasProject = useProjectStore((s) => !!s.currentProject?.folderPath);

  // Open at `s` and log its entry. Centralizes the transition so every path
  // lands on a consistent, instrumented step.
  const openAt = useCallback((s: WizardStep) => {
    setStep(s);
    setVisible(true);
    telemetry.cliSetupStep(s, "enter");
  }, []);

  useCliSetupEngine({
    openAt,
    close: () => setVisible(false),
    showPostAuth: openAt,
  });

  // prd step: once a folder connects, the orchestrator auto-launches
  // (useOrchestratorAutoLaunch). Log success on the false→true edge of
  // hasProject. We intentionally do NOT auto-advance — the connected view
  // offers the optional "sample PRD" action and the user clicks Next.
  useStepPrdSuccess(step === "prd", hasProject);

  const goToStep = useCallback((next: WizardStep) => {
    setStep(next);
    telemetry.cliSetupStep(next, "enter");
  }, []);

  const dismiss = useCallback(() => {
    // CLI-fail drop-off: dismissing install/auth before Claude/Codex is authed
    // is the same "couldn't connect the CLI" failure orchestratorBlocked
    // reports — log it with the same cli_auth vocabulary so both funnels line
    // up, then surface the 5-second survey once before closing.
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

  const finishDismiss = useCallback(() => {
    try {
      localStorage.setItem(DISMISSED_KEY, "1");
    } catch {
      /* private mode — best effort */
    }
    setShowSurvey(false);
    setVisible(false);
  }, []);

  const handleSeed = useCallback(async () => {
    setSeeding(true);
    setSeedMsg(null);
    try {
      setSeedMsg(await seedSamplePrd());
    } finally {
      setSeeding(false);
    }
  }, []);

  const handleFirstTicket = useCallback(async () => {
    setSendingTicket(true);
    setTicketMsg(null);
    try {
      const res = await createFirstTicket();
      setTicketMsg(res);
      // ★오케가 실제로 받았을 때만 마법사를 닫는다. queued(오케 미기동)에 닫아
      // 버리면 유저는 아무 일도 안 일어난 화면에 남고 돌아올 길도 사라진다 —
      // 그대로 열어 두고 FirstTicketResultNote 가 오케 띄우는 법을 안내한다.
      if (res.ok) {
        try {
          localStorage.setItem(DISMISSED_KEY, "1");
        } catch {
          /* best effort */
        }
        setVisible(false);
      }
    } finally {
      setSendingTicket(false);
    }
  }, []);

  // BYOM 축(F4) — 시작하기 탭과 **같은 훅**에서 온다. 두 표면이 ②단계 통과 조건을
  // 두고 다른 말을 하면, 플래그 하나로 앱이 다른 제품이 된다.
  const { gate: byom } = useByomOptions();

  const gateState = useMemo(
    () => ({
      requiredInstalled,
      requiredReady: ready,
      hasProject,
      byomInstalled: byom.installed,
      byomReady: byom.ready,
    }),
    [requiredInstalled, ready, hasProject, byom.installed, byom.ready],
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
            {t(`onboarding.cliGate.${step}.title` as MessageKey)}
          </h2>
          <p className="mt-1 text-sm text-[#a6adc8]">
            {t(`onboarding.cliGate.${step}.body` as MessageKey)}
          </p>
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
            {ROWS.map((row) => (
              <CliRowCard
                key={row.id}
                row={row}
                phase={step}
                // Reveal the terminal so the user can finish the OAuth flow.
                onLoginLaunched={() => setVisible(false)}
              />
            ))}
            {/* ②단계의 대안 — 시작하기 탭과 같은 컴포넌트(F4). */}
            {step === "auth" && <ByomStartSection />}
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
                  onClick={() => void handleSeed()}
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
              onClick={() => void handleFirstTicket()}
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
            {ticketMsg && <FirstTicketResultNote result={ticketMsg} />}
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
