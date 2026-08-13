import { t } from "../lib/i18n";
import { useEditorStore } from "../stores/editorStore";
import { useProjectStore } from "../stores/projectStore";
import { useTerminalStore } from "../stores/terminalStore";
import {
  useCliSetupStore,
  cliLabel,
  ORCHESTRATOR_CLI_IDS,
  ROWS,
  type CliModel,
} from "../stores/cliSetupStore";
import { loginCommandFor, signInRows } from "../lib/oneClickSetup";
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
 *
 * The user's whole job is the browser step: the CLI opens its device-code page
 * and they approve there. No terminal is opened by hand and no command is
 * typed by hand — that is the entire point of this path.
 *
 * `cmd` is optional: when the probe didn't hand us a usable login command
 * (probe failed, or `action` is actually an *install* command because the CLI
 * is missing) `loginCommandFor` falls back to the per-model table rather than
 * typing an installer into the terminal.
 *
 * ★Returns the spawned session id (null when the spawn failed), and hands the
 * same id to `onLaunched`. The modal / tab surfaces only need "hide me", but the
 * 비기너 셸에는 터미널 열이 없어서 **이 세션을 카드 안에 임베드**해야 한다 —
 * CLI 가 인쇄하는 인증 URL 을 못 보면 로그인은 그 자리에서 끝난다. 예전에는
 * 호출부가 `terminalStore.activeSessionId` 를 훔쳐봤는데, 그건 방금 만든 세션이
 * 곧 active 라는 가정에 기대는 것이라 다른 탭이 하나라도 끼면 엉뚱한 터미널을
 * 그린다.
 */
export async function launchLogin(
  model: CliModel,
  cmd?: string,
  onLaunched?: (sessionId: string) => void
): Promise<string | null> {
  const command = loginCommandFor(model, cmd);
  if (!command) return null;
  const label = cliLabel(model);
  try {
    const term = useTerminalStore.getState();
    const id = await term.createSession(label);
    term.openTerminalForSession(id, label);
    const setup = useCliSetupStore.getState();
    setup.setLoginRunning(true);
    // One-click sign-in counts as "the user started setup here", which is what
    // lets a successful auth reveal the orchestrator (and keeps a cold-start
    // ready edge from doing the same).
    setup.markSetupInitiated();
    onLaunched?.(id);
    // Let the shell print its prompt before typing, so the command isn't
    // swallowed by a not-yet-interactive shell.
    setTimeout(() => {
      window.electronAPI.pty.writeAndSubmit(id, command).catch(() => {
        /* PTY closed — user can still type it themselves */
      });
    }, 700);
    return id;
  } catch {
    /* terminal spawn failed — user can still copy/run the command manually */
    return null;
  }
}

/**
 * 고른 CLI **하나**의 로그인 터미널을 띄운다. 아직 안 깔렸으면 먼저 깐다.
 *
 * 구독 선택(티켓 LLHMclpKaIAJbsiHzGoG)이 생기면서 필요해진 자리다: 사용자가 고를
 * 수 있는 것 중 grok 은 `autoInstall: false` 라 자동설치 패스에 들어 있지 않다.
 * 그래서 "SuperGrok 있어요" 를 고른 사람에게 그대로 `grok login` 을 타이핑하면
 * `command not found` 만 남는다 — 구독은 있는데 CLI 가 없는 것이 로그인을
 * 건너뛸 이유는 아니므로, 여기서 설치를 먼저 태운다.
 *
 * 설치는 프로브가 **명시적으로 "안 깔렸다"** 고 말했을 때만 한다(`=== false`).
 * 결과가 아직 없는 행은 건드리지 않는다 — `pendingInstallRows` 와 같은 규칙이고,
 * 느린 프로브 한 번이 멀쩡한 CLI 위로 셸 인스톨러를 다시 돌리는 것을 막는다.
 *
 * 로그인 명령은 종전대로 `launchLogin` 안의 `loginCommandFor` 가 정한다. `cmd` 를
 * 안 주면 설치 **후의** 프로브 결과에서 읽는다 — 설치 전 `action` 은 (미설치
 * 행이라) 실은 설치 명령이라, 그걸 인증 단계에서 타이핑하면 인스톨러가 한 번 더
 * 돈다.
 */
export async function installAndLogin(
  model: CliModel,
  cmd?: string,
  onLaunched?: (sessionId: string) => void
): Promise<string | null> {
  const row = ROWS.find((r) => r.model === model);
  if (!row) return null;
  if (useCliSetupStore.getState().results[row.id]?.installed === false) {
    await useCliSetupStore.getState().runInstall(row);
  }
  const action = cmd ?? useCliSetupStore.getState().results[row.id]?.action;
  return launchLogin(model, action, onLaunched);
}

/**
 * 이 설치의 **기본 오케 하네스**를 정한다(티켓 LLHMclpKaIAJbsiHzGoG 요구 (3)).
 *
 * 값은 설정 화면의 "실행 모델" 과 **같은 저장소·같은 IPC** 다
 * (`orchestratorModel:set` → main 의 `normalizeOrchestratorModelSetting`). 온보딩
 * 전용 설정을 새로 만들지 않는 게 중요하다 — 두 벌이 되면 온보딩에서 고른 CLI 와
 * 설정 화면이 보여주는 CLI 가 갈린다.
 *
 * 어느 CLI 를 넣을지는 `lib/loginPrompt.defaultOrchestratorModel` 이 정한다. 여기는
 * 그 결정을 저장하기만 한다. 실패해도 흐름을 멈추지 않는다: 기본값이 안 바뀐 것은
 * 불편이지 차단이 아니고(오케 패널에서 언제든 바꾼다), 여기서 던지면 로그인
 * 큐까지 함께 죽는다.
 */
export async function setDefaultOrchestrator(
  model: CliModel
): Promise<boolean> {
  try {
    const result = await window.electronAPI.orchestratorModel.set(model);
    return result?.success !== false;
  } catch {
    return false;
  }
}

/**
 * ★"원클릭 사인인" — the auth step's single button.
 *
 * Picks the CLI whose sign-in actually unblocks the orchestrator (Claude or
 * Codex first, then the optional CLIs), spawns its terminal and types its
 * login command. Returns the model it started, or null when nothing is
 * signable (nothing installed yet, or everything is already signed in).
 *
 * Deliberately ONE terminal, not one per CLI: each login opens its own browser
 * device-code page, and firing three at once leaves the user with three
 * half-finished approval tabs and no idea which terminal is waiting. Readiness
 * needs only one of Claude/Codex (#579), and the remaining rows keep their own
 * sign-in buttons for anyone who wants more.
 */
export function oneClickSignIn(
  onLaunched?: (sessionId: string) => void
): CliModel | null {
  const { results } = useCliSetupStore.getState();
  const target = signInRows(ROWS, results, ORCHESTRATOR_CLI_IDS)[0];
  if (!target) return null;
  void launchLogin(target.model, results[target.id]?.action, onLaunched);
  return target.model;
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
        t("onboarding.cliGate.prdContent")
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
      })
    );
  } catch {
    delivery = "failed";
  }
  const view = firstTicketView(delivery);
  telemetry.cliSetupStep(
    "firstTicket",
    view.telemetry.phase,
    view.telemetry.reason
  );
  return { ok: view.completesStep, delivery, text: t(view.messageKey) };
}
