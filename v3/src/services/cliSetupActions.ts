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
import {
  deliveryFromRoute,
  firstTicketView,
  type FirstTicketDelivery,
} from "../lib/firstTicketDelivery";

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

/**
 * 첫 티켓만 결과가 3값이다 — 전달됨 / 큐에만 쌓임(오케 없음) / 실패. `ok` 만으로
 * 접으면 "큐에만 쌓임" 이 성공으로 보인다(활성화 F3). 색조·안내·퍼널 계상 규칙은
 * `lib/firstTicketDelivery` 의 순수 함수가 단일소스다.
 */
export interface FirstTicketResult extends ActionResult {
  delivery: FirstTicketDelivery;
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
 *
 * ★"queued" 는 성공이 아니다(활성화 F3). 예전에는 local 과 queued 를 한데 접어
 * `firstTicket.sent`("전달했어요") + success 계측으로 끝냈는데, queued 는 로컬 오케에
 * 못 넣어 Firestore 큐에 쌓아만 둔 상태다. 큐를 소비할 오케가 없으면 아무 일도
 * 일어나지 않는데 화면은 초록색 성공이라, 신규 유저는 죽은 화면을 성공으로 읽고
 * 이탈했다. 이제 세 결과를 그대로 넘겨 호출부가 색조·안내·완료여부를 가른다.
 */
export async function createFirstTicket(): Promise<FirstTicketResult> {
  const proj = useProjectStore.getState().currentProject;
  if (!proj?.id) {
    // 폴더 미연결 — 전송 자체를 시도하지 않았다. 전달 실패와 같은 색조(빨강)지만
    // 오케 안내는 붙지 않는다(③단계로 돌아가는 게 다음 액션이라서).
    return {
      ok: false,
      delivery: "failed",
      text: t("onboarding.cliGate.firstTicket.needProject"),
    };
  }
  let delivery: FirstTicketDelivery = "failed";
  try {
    delivery = deliveryFromRoute(
      await routeInstructionToOrchestrator({
        projectId: proj.id,
        message: t("onboarding.cliGate.firstTicket.prompt"),
      }),
    );
  } catch {
    delivery = "failed";
  }
  const view = firstTicketView(delivery);
  telemetry.cliSetupStep(
    "firstTicket",
    view.telemetry.phase,
    view.telemetry.reason,
  );
  return { ok: view.completesStep, delivery, text: t(view.messageKey) };
}
