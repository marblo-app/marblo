import { t } from "../lib/i18n";
import { useEditorStore } from "../stores/editorStore";
import { useProjectStore } from "../stores/projectStore";
import { useTerminalStore } from "../stores/terminalStore";
import {
  useCliSetupStore,
  cliLabel,
  type CliModel,
} from "../stores/cliSetupStore";
import telemetry from "../services/telemetryService";
import { routeInstructionToOrchestrator } from "./orchestratorInstructionService";

/**
 * The onboarding wizard's side-effecting step actions, lifted out of
 * CliSetupGate.tsx so the modal (legacy Layout) and the Start Here tab (split
 * shell) share one implementation instead of two.
 *
 * Each function is UI-agnostic: it performs the effect and returns a
 * {ok, text} result the caller renders however its surface wants. Telemetry
 * that belongs to the *step* (not the surface) stays here so both surfaces
 * report the same activation funnel.
 */

export interface ActionResult {
  ok: boolean;
  text: string;
}

function joinPath(dir: string, name: string): string {
  return dir.endsWith("/") ? `${dir}${name}` : `${dir}/${name}`;
}

/**
 * prd step: open the native folder picker. useProjectSetup's global
 * `marblo:select-folder` listener auto-registers the folder as a project;
 * useOrchestratorAutoLaunch then boots the orchestrator — this is the wizard's
 * "첫 오케 실행" with no extra wiring here.
 */
export function connectFolder(): void {
  window.dispatchEvent(new CustomEvent("marblo:select-folder"));
}

/**
 * auth step, one-click sign-in: spawn a real terminal tab and type the CLI's
 * login command. The caller reveals the terminal (the modal hides itself; the
 * tab does nothing) via `onLaunched`. The engine's auto-recheck poll watches
 * `loginRunning` until the required set authenticates, so no manual "Re-check"
 * click is needed — copy/Re-check remain as fallbacks.
 */
export async function launchLogin(
  model: CliModel,
  cmd: string,
  onLaunched?: () => void,
): Promise<void> {
  if (!cmd) return;
  const label = cliLabel(model);
  try {
    const term = useTerminalStore.getState();
    const id = await term.createSession(label);
    term.openTerminalForSession(id, label);
    useCliSetupStore.getState().setLoginRunning(true);
    onLaunched?.();
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
}

/**
 * prd step: seed a starter PRD.md into the connected folder and open it, so a
 * first-time user has something concrete to hand the orchestrator. Never
 * clobbers an existing PRD.md — if one is already there we just open it.
 * Returns null when there is no connected folder yet.
 */
export async function seedSamplePrd(): Promise<ActionResult | null> {
  const root = useProjectStore.getState().currentProject?.folderPath;
  if (!root) return null;
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
        t("onboarding.cliGate.prdContent"),
      );
    }
    const editor = useEditorStore.getState();
    editor.setRootPath(root);
    await editor.openFile(prdPath);
    return { ok: true, text: t("onboarding.cliGate.project.seeded") };
  } catch {
    return { ok: false, text: t("onboarding.cliGate.project.seedFail") };
  }
}

/**
 * firstTicket step (the aha-moment): hand the PRD to the orchestrator as the
 * very first prompt. routeInstructionToOrchestrator is the local-PTY-first,
 * durable-queue-fallback path live-verified in #573 — the orchestrator creates
 * the first ticket and proposes spawning an agent.
 */
export async function createFirstTicket(): Promise<ActionResult> {
  const proj = useProjectStore.getState().currentProject;
  if (!proj?.id) {
    return { ok: false, text: t("onboarding.cliGate.firstTicket.needProject") };
  }
  try {
    const result = await routeInstructionToOrchestrator({
      projectId: proj.id,
      message: t("onboarding.cliGate.firstTicket.prompt"),
    });
    if (result === "failed") {
      telemetry.cliSetupStep("firstTicket", "fail", "launch_error");
      return { ok: false, text: t("onboarding.cliGate.firstTicket.failed") };
    }
    // "local" (in-process ack) or "queued" (durable fallback) — either way the
    // orchestrator will pick it up. Mark the funnel's finish line.
    telemetry.cliSetupStep("firstTicket", "success");
    return { ok: true, text: t("onboarding.cliGate.firstTicket.sent") };
  } catch {
    telemetry.cliSetupStep("firstTicket", "fail", "launch_error");
    return { ok: false, text: t("onboarding.cliGate.firstTicket.failed") };
  }
}
