/**
 * @vitest-environment jsdom
 *
 * 원클릭 온보딩(티켓 afW5wNdX) — 활성화 진단 #850 이 지목한 두 마찰을 없애는
 * 경로를 못박는다.
 *
 *  ① "모두 설치" — 미설치 CLI 만 골라 **순차** 설치하고, 한 행이 실패해도 나머지는
 *     계속 간다. 이미 설치된 행은 절대 다시 설치하지 않는다(셸 인스톨러를 멀쩡한
 *     CLI 위에 다시 돌리는 건 되돌리기 어려운 부작용이다).
 *  ② "원클릭 사인인" — 터미널을 **우리가** 띄우고 로그인 명령을 **우리가** 넣는다
 *     (`pty.writeAndSubmit`). 사용자의 수동 터미널 작업이 0 이 되는 지점이라,
 *     "무엇을 타이핑했는가" 를 여기서 실제로 검사한다. ★미설치 CLI 의 probe
 *     `action` 은 **설치 명령**이므로, 그걸 인증 단계에서 그대로 타이핑하면
 *     브라우저 로그인 대신 `curl … | bash` 가 돈다 — 그 오작동을 막는 가드가
 *     `loginCommandFor` 다.
 *  ③ 설치+인증 성공 → 오케 노출. 다만 그 판정은 **이 세션에서 원클릭을 눌렀을 때만**
 *     참이다: ready 의 false→true 엣지는 이미 인증된 사용자의 콜드 스타트에서도
 *     뜨고(bRABKQX7/nB4eenxP), 그때마다 탭·접힘 상태를 앱이 되돌리면 안 된다.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  LOGIN_CMD,
  bulkInstallOutcome,
  isLoginCommand,
  loginCommandFor,
  pendingInstallRows,
  shouldRevealOrchestrator,
  signInRows,
  type CliProbeLike,
} from "../../src/lib/oneClickSetup";

const ROWS = [
  { id: "cli-claude-code", model: "claude" as const },
  { id: "cli-codex", model: "codex" as const },
  { id: "cli-grok", model: "grok" as const },
  { id: "cli-antigravity", model: "antigravity" as const },
];
const ORCH_IDS = ["cli-claude-code", "cli-codex"];

const probe = (
  installed: boolean,
  authenticated: boolean,
  action?: string,
): CliProbeLike => ({ installed, authenticated, action });

describe("pendingInstallRows — 모르는 것을 설치하지 않는다", () => {
  it("probe 가 명시적으로 미설치라고 한 행만 고른다", () => {
    const results = {
      "cli-claude-code": probe(false, false),
      "cli-codex": probe(true, false),
    };
    expect(pendingInstallRows(ROWS, results).map((r) => r.id)).toEqual([
      "cli-claude-code",
    ]);
  });

  it("★probe 결과가 아직 없는 행은 건드리지 않는다 (미확인 ≠ 미설치)", () => {
    // 느린/실패한 probe 를 '미설치' 로 읽으면 멀쩡한 CLI 위로 셸 인스톨러가 돈다.
    expect(pendingInstallRows(ROWS, {})).toEqual([]);
  });
});

describe("signInRows — 오케를 여는 CLI 가 먼저다", () => {
  it("설치됐고 미인증인 행만, 오케 후보를 앞세워 정렬한다", () => {
    const results = {
      "cli-claude-code": probe(false, false), // 미설치 → 인증할 게 없다
      "cli-codex": probe(true, false),
      "cli-grok": probe(true, false),
      "cli-antigravity": probe(true, true), // 이미 인증
    };
    expect(signInRows(ROWS, results, ORCH_IDS).map((r) => r.id)).toEqual([
      "cli-codex",
      "cli-grok",
    ]);
  });

  it("오케 후보끼리는 주어진 우선순위 순서를 지킨다", () => {
    const results = {
      "cli-claude-code": probe(true, false),
      "cli-codex": probe(true, false),
    };
    expect(signInRows(ROWS, results, ORCH_IDS)[0]?.id).toBe("cli-claude-code");
  });

  it("전부 인증됐으면 비어 있다(패널이 조용히 빠지는 근거)", () => {
    const results = {
      "cli-claude-code": probe(true, true),
      "cli-codex": probe(true, true),
    };
    expect(signInRows(ROWS, results, ORCH_IDS)).toEqual([]);
  });
});

describe("loginCommandFor — 인증 단계에서 설치 명령을 타이핑하지 않는다", () => {
  it("probe 가 준 로그인 명령을 그대로 쓴다", () => {
    expect(loginCommandFor("codex", "codex login")).toBe("codex login");
  });

  it("★설치 명령(curl … | bash)은 거부하고 모델별 로그인 명령으로 폴백한다", () => {
    const installer = "curl -fsSL https://claude.ai/install.sh | bash";
    expect(isLoginCommand(installer)).toBe(false);
    expect(loginCommandFor("claude", installer)).toBe(LOGIN_CMD.claude);
    expect(loginCommandFor("claude", installer)).toBe("claude login");
  });

  it("action 이 비었거나(probe 실패) 공백뿐이어도 버튼이 살아 있다", () => {
    expect(loginCommandFor("grok", undefined)).toBe("grok login");
    expect(loginCommandFor("grok", "   ")).toBe("grok login");
  });

  it("agy 는 login 서브커맨드가 없다 — 한 번 실행이 곧 OAuth 다", () => {
    expect(LOGIN_CMD.antigravity).toBe("agy");
  });

  it("★그 CLI 의 명령이 아니면 거부한다 — 프로브 문자열이 셸로 새면 안 된다", () => {
    // 클린룸에서 실측된 사고: probe action 이 그냥 `login` 이었고, 그게 그대로
    // 타이핑돼 macOS 의 `login`(로그인 셸 교체)이 실행됐다. 설치 명령 거부만으로는
    // 이 부류가 안 걸러진다 — 첫 토큰이 그 CLI 의 바이너리여야 한다.
    expect(isLoginCommand("login", "claude")).toBe(false);
    expect(loginCommandFor("claude", "login")).toBe("claude login");
    // 프로브가 에러 문자열을 실어 보낸 경우도 같다.
    expect(loginCommandFor("codex", "command not found: codex")).toBe(
      "codex login",
    );
    // 엉뚱한 CLI 의 명령을 이 행에 타이핑하지 않는다.
    expect(loginCommandFor("codex", "claude login")).toBe("codex login");
    // 절대경로로 와도 그 CLI 면 그대로 쓴다.
    expect(loginCommandFor("claude", "/usr/local/bin/claude login")).toBe(
      "/usr/local/bin/claude login",
    );
    // model 을 안 주면 종전 계약 그대로(설치 명령만 거른다).
    expect(isLoginCommand("login")).toBe(true);
  });
});

describe("bulkInstallOutcome — 부분 실패는 성공도 실패도 아니다", () => {
  const p = (total: number, failed: string[]) => ({
    running: false,
    total,
    done: total,
    failedIds: failed,
  });
  it("전부 성공 / 일부 실패 / 전부 실패를 가른다", () => {
    expect(bulkInstallOutcome(p(2, []))).toBe("success");
    expect(bulkInstallOutcome(p(2, ["cli-codex"]))).toBe("partial");
    expect(bulkInstallOutcome(p(2, ["cli-codex", "cli-claude-code"]))).toBe(
      "failed",
    );
  });
});

describe("shouldRevealOrchestrator — 재시작마다 화면을 되돌리지 않는다", () => {
  it("이 세션에서 원클릭을 눌렀고, 준비됐고, 프로젝트가 있을 때만 참", () => {
    expect(
      shouldRevealOrchestrator({
        ready: true,
        hasProject: true,
        setupInitiated: true,
      }),
    ).toBe(true);
  });

  it("★이미 인증된 사용자의 콜드 스타트(ready 엣지만)에는 아무 일도 하지 않는다", () => {
    expect(
      shouldRevealOrchestrator({
        ready: true,
        hasProject: true,
        setupInitiated: false,
      }),
    ).toBe(false);
  });

  it("폴더가 없으면 열 오케가 없다 → 거짓(③단계가 다음 액션)", () => {
    expect(
      shouldRevealOrchestrator({
        ready: true,
        hasProject: false,
        setupInitiated: true,
      }),
    ).toBe(false);
  });
});

// ── 스토어: 실제 일괄 설치 패스 ────────────────────────────────────────────
describe("cliSetupStore.runInstallAll — 순차 · 스킵 · 실패해도 계속", () => {
  let installed: Set<string>;
  let installCalls: string[];

  beforeEach(async () => {
    vi.resetModules();
    installed = new Set<string>();
    installCalls = [];
    const api = {
      harness: {
        install: vi.fn(async (id: string) => {
          installCalls.push(id);
          if (id === "cli-codex") return { success: false, error: "EACCES" };
          installed.add(id);
          return { success: true };
        }),
        cliAuthCheck: vi.fn(async (model: string) => {
          const id =
            model === "claude"
              ? "cli-claude-code"
              : model === "codex"
                ? "cli-codex"
                : model === "grok"
                  ? "cli-grok"
                  : "cli-antigravity";
          return {
            installed: installed.has(id),
            authenticated: false,
            action: `${model} login`,
          };
        }),
        versions: vi.fn(async () => ({})),
      },
    };
    (
      globalThis as unknown as { window: Record<string, unknown> }
    ).window.electronAPI = api;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("이미 설치된 행은 건너뛰고, 실패한 행이 있어도 나머지를 끝까지 설치한다", async () => {
    const { useCliSetupStore, ROWS: STORE_ROWS } =
      await import("../../src/stores/cliSetupStore");
    installed.add("cli-grok"); // 이 행은 이미 설치돼 있다

    await useCliSetupStore.getState().probeAll();
    await useCliSetupStore.getState().runInstallAll(STORE_ROWS);

    // grok 은 설치 대상에서 빠졌다.
    expect(installCalls).not.toContain("cli-grok");
    // codex 가 실패했지만 그 뒤 행(antigravity)까지 계속 갔다.
    expect(installCalls).toEqual([
      "cli-claude-code",
      "cli-codex",
      "cli-antigravity",
    ]);

    const bulk = useCliSetupStore.getState().bulkInstall;
    expect(bulk?.running).toBe(false);
    expect(bulk?.total).toBe(3);
    expect(bulk?.done).toBe(3);
    expect(bulk?.failedIds).toEqual(["cli-codex"]);
    expect(bulkInstallOutcome(bulk!)).toBe("partial");
    // 실패한 행은 자기 카드의 수동 폴백을 띄울 에러 문구를 갖는다.
    expect(useCliSetupStore.getState().installErrors["cli-codex"]).toBe(
      "EACCES",
    );
    // 원클릭을 눌렀다는 사실이 남아야 인증 성공 시 오케를 열 수 있다.
    expect(useCliSetupStore.getState().setupInitiated).toBe(true);
  });

  it("설치할 게 없으면 harness.install 을 한 번도 부르지 않는다", async () => {
    const { useCliSetupStore, ROWS: STORE_ROWS } =
      await import("../../src/stores/cliSetupStore");
    for (const r of STORE_ROWS) installed.add(r.id);

    await useCliSetupStore.getState().probeAll();
    await useCliSetupStore.getState().runInstallAll(STORE_ROWS);

    expect(installCalls).toEqual([]);
    expect(useCliSetupStore.getState().bulkInstall?.running).toBe(false);
  });
});
