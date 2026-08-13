import type { CliModel } from "../stores/cliSetupStore";

/**
 * Pure decisions for the ONE-CLICK onboarding path (ticket afW5wNdX).
 *
 * The 시작하기 탭 already had every individual action (install this CLI, run
 * this CLI's login, connect a folder). What it did not have was the *one
 * click*: a new user had to work out which rows still needed installing, press
 * four buttons, then work out which row still needed a sign-in. Activation
 * diagnosis (#850) put CLI install+auth at the top of the drop-off list.
 *
 * Everything here is a pure function over probe results so the batching rules
 * are testable without a DOM or a live CLI:
 *   - which rows a "모두 설치" click should actually install (never re-install)
 *   - which row a "원클릭 사인인" click should sign in first, and in what order
 *   - what command to type into the spawned terminal (model → login command),
 *     including the guard against typing an *install* command at the auth step
 *   - whether finishing setup should reveal the orchestrator
 */

/** The subset of a probe result these decisions read. */
export interface CliProbeLike {
  installed: boolean;
  authenticated: boolean;
  /** Probe-supplied next command. Login command only when `installed`. */
  action?: string;
}

/** Structural shape of `cliSetupStore.ROWS` entries used here. */
export interface SetupRowLike {
  id: string;
  model: CliModel;
}

/**
 * The login command per CLI, used when the probe didn't hand us one.
 *
 * The probe (`harness:cliAuthCheck`) returns the login command in `action`
 * ONLY for an installed-but-signed-out CLI; for a missing CLI `action` is the
 * *install* command instead. The sign-in button used to render only when
 * `action` was non-empty, so a probe that failed (offline, throw → `action`
 * carries an error string) silently removed the one-click sign-in and left the
 * user with a copy box and no button. This table is the fallback that keeps
 * the button meaningful.
 */
export const LOGIN_CMD: Record<CliModel, string> = {
  claude: "claude login",
  codex: "codex login",
  grok: "grok login",
  // agy has no `login` subcommand — running it once opens the OAuth browser
  // flow (harness-catalog postInstall says the same).
  antigravity: "agy",
};

/**
 * Anything that installs rather than signs in. If a probe's `action` looks like
 * this we must NOT type it at the auth step: it would run a `curl … | bash`
 * installer in the user's terminal instead of opening the browser sign-in.
 */
const INSTALL_CMD_MARKERS = [
  "curl",
  "install.sh",
  "install.ps1",
  "npm i",
  "npm install",
  "iwr",
  "powershell",
];

/**
 * Binary that runs each CLI. Used to check that a probe-supplied command is
 * actually **that CLI's** command before we type it into the user's shell.
 */
const CLI_BIN: Record<CliModel, string> = {
  claude: "claude",
  codex: "codex",
  grok: "grok",
  antigravity: "agy",
};

/**
 * Whether `cmd` is a sign-in command (vs an installer / probe error text).
 *
 * When `model` is given the check is strict: the first token must be that
 * CLI's binary. ★이게 없으면 프로브가 돌려준 **아무 문자열이나** 사용자의 셸에
 * 그대로 타이핑된다. 클린룸에서 실제로 그랬다 — 프로브 action 이 `login` 이라
 * macOS 의 `login`(로그인 셸 교체)이 실행돼 터미널이 `login:` 프롬프트에 갇혔다.
 * 설치 명령 거부(아래 마커)만으로는 그 부류를 못 거른다.
 */
export function isLoginCommand(
  cmd: string | undefined,
  model?: CliModel
): boolean {
  if (!cmd) return false;
  const c = cmd.trim();
  if (!c) return false;
  const lower = c.toLowerCase();
  if (INSTALL_CMD_MARKERS.some((m) => lower.includes(m))) return false;
  if (model) {
    // 절대경로로 올 수 있다(`/usr/local/bin/claude login`).
    const bin = lower.split(/\s+/)[0].split("/").pop();
    if (bin !== CLI_BIN[model]) return false;
  }
  return true;
}

/**
 * What to type into the sign-in terminal for `model`. Prefers the probe's
 * `action` (it is the authoritative per-machine command) and falls back to the
 * static table when the probe gave us nothing usable.
 */
export function loginCommandFor(model: CliModel, action?: string): string {
  return isLoginCommand(action, model)
    ? (action as string).trim()
    : LOGIN_CMD[model];
}

/**
 * Rows a "모두 설치" click should install.
 *
 * Only rows the probe explicitly reported as NOT installed. A row with no
 * probe result yet is left alone on purpose — "we haven't looked" must never
 * become "install it", or a slow/failed probe would re-run a shell installer
 * over a working CLI.
 */
export function pendingInstallRows<R extends { id: string }>(
  rows: R[],
  results: Record<string, CliProbeLike | undefined>
): R[] {
  return rows.filter((r) => results[r.id]?.installed === false);
}

/**
 * Rows a sign-in click can act on, most useful first.
 *
 * Installed but not authenticated — a missing CLI has nothing to sign into.
 * `priorityIds` (the orchestrator candidates: Claude / Codex) come first,
 * in their given order, because authenticating one of those is what actually
 * unblocks the orchestrator; the optional CLIs follow in row order.
 */
export function signInRows<R extends { id: string }>(
  rows: R[],
  results: Record<string, CliProbeLike | undefined>,
  priorityIds: string[] = []
): R[] {
  const eligible = rows.filter((r) => {
    const s = results[r.id];
    return s?.installed === true && s.authenticated !== true;
  });
  const rank = (id: string) => {
    const i = priorityIds.indexOf(id);
    return i === -1 ? priorityIds.length : i;
  };
  return [...eligible].sort((a, b) => rank(a.id) - rank(b.id));
}

/**
 * Rows a "모두 설치" click targets, before looking at what is already there.
 *
 * The default fleet: every row flagged `autoInstall` (Claude / Codex / Grok),
 * plus anything flagged `required`. Antigravity stays out — it keeps its own
 * per-row install button, because one click must not run a vendor installer
 * the user never chose. Shared so the 시작하기 탭 패널과 비기너 모달이 같은
 * 대상 집합을 쓴다 — 한쪽만 늘어나면 "모두 설치" 의 뜻이 화면마다 달라진다.
 *
 * ★대상 집합 ≠ 오케 후보. Grok 은 여기 들지만 `ORCHESTRATOR_CLI_IDS` 에는 없다:
 * 깔아는 주되, 그것만으로 게이트가 열리지는 않는다.
 */
export function oneClickInstallRows<
  R extends { autoInstall: boolean; required: boolean }
>(rows: R[]): R[] {
  return rows.filter((r) => r.autoInstall || r.required);
}

/** Progress of a bulk install pass, rendered as "n/total" + failures. */
export interface BulkInstallProgress {
  running: boolean;
  total: number;
  /** Rows whose install attempt finished (successfully or not). */
  done: number;
  /** Row ids whose install failed — each keeps its own manual fallback card. */
  failedIds: string[];
}

export type BulkInstallOutcome = "success" | "partial" | "failed";

/**
 * How a finished bulk pass ended. `partial` matters: some CLIs installed and
 * some didn't, which is a different message (and a different next action) than
 * "everything failed" — the failed rows keep their manual command + docs link.
 */
export function bulkInstallOutcome(p: BulkInstallProgress): BulkInstallOutcome {
  if (p.failedIds.length === 0) return "success";
  return p.failedIds.length >= p.total ? "failed" : "partial";
}

/**
 * ★"모두 설치 + 자동 사인인" 을 **한 흐름**으로 진행할 때의 국면.
 *
 * 시작하기 탭은 두 패널(InstallAllPanel / OneClickSignInPanel)이 체크리스트의
 * 서로 다른 단계에 나란히 서 있어서 국면이라는 개념이 필요 없었다 — 사용자가
 * ①에서 누르고 ②로 내려가면 그만이다. 비기너 모달은 그 두 단계를 한 화면에서
 * 자동으로 이어 붙이므로(설치가 끝나면 사인인이 **스스로** 시작된다) "지금 무엇을
 * 보여줄 것인가" 를 판정할 규칙이 필요하다.
 *
 * 판정은 전부 이미 있는 관측값에서 파생한다(새 상태 없음):
 *   ready         cliSetupStore.ready — Claude/Codex 중 하나가 설치+인증
 *   bulk          runInstallAll 의 진행 기록
 *   signInTargets signInRows(...).length — 설치됐지만 미인증인 행 수
 *   loginLaunched 우리가 이 흐름에서 로그인 터미널을 띄웠는가
 *
 * 우선순위가 곧 계약이다:
 *  - `done` 이 항상 먼저다. 설치 패스가 아직 정리 중이어도 이미 인증이 됐다면
 *    사용자에게 보여줄 것은 성공이다(예: 다른 창/터미널에서 먼저 로그인한 경우).
 *  - `installing` 은 사인인보다 먼저다 — 설치 중에 사인인 터미널을 띄우면 아직
 *    없는 바이너리에 로그인 명령을 타이핑하게 된다.
 *  - `awaiting_auth` 는 `sign_in` 보다 먼저다. 터미널을 띄운 뒤에는 대상 행이
 *    여전히 미인증으로 남아 있는 게 정상이므로(브라우저 승인 대기), 그걸로
 *    "다시 사인인" 을 그리면 같은 로그인을 두 번 띄운다.
 *  - `blocked` 는 마지막 폴백이다: 설치가 끝났는데 사인인할 대상이 **하나도**
 *    없다 = 설치가 전부 실패했다는 뜻이라, 수동 명령·공식문서로 넘겨야 한다.
 *
 * ★칸이 하나 늘었다 — `choose_subscription`(티켓 LLHMclpKaIAJbsiHzGoG).
 * 설치와 사인인 사이에서 "어떤 구독 가지고 계세요?" 를 묻는다. 종전에는 설치가
 * 끝나는 즉시 오케 후보 **하나**의 로그인을 띄웠는데, 그 하나가 그 사용자가 가진
 * 구독이 아니면 승인할 것이 없어서 신규 유저가 그대로 멈췄다(콜드테스트 관측).
 * 이 칸은 **묻는 자리**일 뿐, 설치·로그인 규칙은 종전 그대로다.
 */
export type OneClickPhase =
  | "idle"
  | "installing"
  | "choose_subscription"
  | "sign_in"
  | "awaiting_auth"
  | "blocked"
  | "done";

export interface OneClickFlowState {
  /** 사용자가 이 흐름을 시작했는가(모달의 CTA 를 눌렀는가). */
  started: boolean;
  /** Claude/Codex 중 하나가 설치+인증 완료. */
  ready: boolean;
  bulk: BulkInstallProgress | null;
  /** 설치됐지만 아직 미인증인 행 수(= signInRows 의 길이). */
  signInTargets: number;
  /** 이 흐름이 로그인 터미널을 띄웠는가. */
  loginLaunched: boolean;
  /**
   * 사용자가 "어떤 구독 가지고 계세요?" 에 답했는가.
   *
   * ★`false` 일 때만 묻는다. 생략(undefined)하면 이 칸이 없던 시절과 **바이트
   * 동일**하게 동작한다 — 이 국면 함수를 읽는 다른 표면(시작하기 탭 계열)이
   * 비기너 전용 단계를 강제로 지나가게 되는 일은 없다.
   */
  subscriptionPicked?: boolean;
  /**
   * 아직 로그인 터미널을 띄워야 하는 CLI 수(= `pendingLoginModels` 의 길이).
   *
   * ★`done` 판정을 붙잡는 유일한 이유다. `ready` 는 오케 후보 **하나**가
   * 인증되면 서는데(#579), 사용자가 구독을 둘 골랐다면 두 번째 로그인은 아직
   * 진행 중이다. 이 값이 없으면 첫 인증 순간 모달이 "연결됐어요" 를 띄우고
   * 1.6초 뒤 닫히면서 두 번째 로그인을 화면에서 통째로 지운다.
   */
  pendingLogins?: number;
}

export function oneClickPhase(s: OneClickFlowState): OneClickPhase {
  // 인증이 끝났고 더 띄울 로그인도 없다 = 이 흐름의 끝.
  if (s.ready && (s.pendingLogins ?? 0) === 0) return "done";
  if (!s.started) return "idle";
  if (s.bulk?.running) return "installing";
  if (s.loginLaunched) return "awaiting_auth";
  // ★설치가 **끝난 뒤에** 묻는다. 설치 중에 물으면 아직 없는 CLI 를 고르게 되고,
  // 고른 순간 로그인 명령이 없는 바이너리로 날아간다.
  // 사인인할 대상이 하나도 없으면 묻지 않는다 — 설치가 전부 실패했다는 뜻이라
  // 물어봤자 띄울 터미널이 없다(아래 `blocked` 로 떨어진다).
  if (s.subscriptionPicked === false && s.signInTargets > 0) {
    return "choose_subscription";
  }
  if (s.signInTargets > 0) return "sign_in";
  // 설치 패스가 아직 시작 전이면(클릭 직후 한 틱) 설치 중으로 본다 — 빈
  // "막힘" 화면이 한 프레임 스치는 것을 막는다.
  if (!s.bulk) return "installing";
  return "blocked";
}

/**
 * 지금 로그인 터미널을 띄워도 되는 **국면**인가.
 *
 * 모달의 "자동" 이 성립하는 지점이다 — 사용자가 두 번째 버튼을 누르지 않는다.
 * 설치 중(아직 없는 바이너리)·구독 질문 중(무엇을 띄울지 아직 모른다)·완료
 * 후에는 아니다.
 *
 * ★종전 이름은 `shouldAutoSignIn` 이었고 `sign_in` 국면 하나만 통과시켰다. 그
 * 좁은 게이트가 "같은 로그인을 폴 주기마다 다시 띄우지 않는다" 는 규칙까지 겸했기
 * 때문인데, 구독 선택이 생기면서 로그인은 **큐**가 됐다(고른 CLI 마다 하나씩).
 * 이제 `awaiting_auth` 는 "더 띄울 것이 없다" 가 아니라 "지금 하나가 진행 중" 일
 * 뿐이라, 중복 방지는 국면이 아니라 **대상 선정**이 맡는다
 * (`loginPrompt.nextLoginTarget` + 호출부의 시도 기록). 이름을 함께 바꾼 이유는
 * 그 책임 이동을 조용히 넘기지 않기 위해서다.
 */
export function canLaunchSignIn(s: OneClickFlowState): boolean {
  const phase = oneClickPhase(s);
  return phase === "sign_in" || phase === "awaiting_auth";
}

/**
 * Whether finishing setup should reveal the orchestrator (사장님 요구 (3)):
 * install + sign-in succeeding should land the user *in* the product, not on
 * the checklist they just completed.
 *
 * `setupInitiated` is the guard that keeps this honest. The ready edge
 * (`false → true`) ALSO fires on every cold start, because the probe starts
 * false and flips once an already-authenticated user is re-probed — the same
 * edge that caused the restart-popup regressions (bRABKQX7 / nB4eenxP). So we
 * only reveal when the user actually pressed one of OUR one-click buttons in
 * this session. Without a project there is nothing to open, so that is required
 * too (the checklist's ③단계 is then the next action).
 *
 * ★알려진 갭 (사장님 요구 (4), 이 티켓에서 **분리**): 폴더가 없으면 여기서 멈춘다.
 * "폴더 미설정이면 기본/데모 폴더를 자동선택해서 오케가 뜨게" 하려면 렌더러가
 * 홈 디렉터리를 알고 폴더를 만들 수 있어야 하는데, preload 의 fs 표면에는
 * `selectDirectory`(네이티브 피커) 외에 홈 경로도 mkdir 도 없다 — 새 메인
 * 프로세스 IPC 가 필요하고, 그건 이 티켓의 스코프(프론트엔드) 밖이다. 후속
 * 티켓에서 `fs:defaultProjectDir` 류를 열고 나면 이 함수의 hasProject 조건이
 * 그 경로로 대체된다.
 */
export function shouldRevealOrchestrator(input: {
  ready: boolean;
  hasProject: boolean;
  setupInitiated: boolean;
}): boolean {
  return input.ready && input.hasProject && input.setupInitiated;
}
