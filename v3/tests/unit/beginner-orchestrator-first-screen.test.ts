/**
 * @vitest-environment jsdom
 *
 * ★비기너 대화창 첫 화면 — "배너·프롬프트·경로·스킬본문이 **화면에** 없다"
 * (티켓 fDceJJvz3eam2PMNOWyB). `orchestrator-boot-gate.test.ts` 가 게이트의 순수
 * 규칙을 보는 것과 달리, 여기서는 실제 배선을 본다:
 *
 *   ① `TerminalView` — PTY 라이브·replay 바이트가 `outputGate` 를 거쳐야만 xterm
 *      `write` 에 닿는다(가짜 xterm 이 받은 바이트를 그대로 검사). 게이트가 없으면
 *      (마블로/엑스퍼트) 원시 바이트가 그대로 쓰인다 — 무변경 증명.
 *   ② `OrchestratorPanel` — 비기너 props(`gateBootOutput`)면 오케가 말하기 전
 *      로딩 골격이 뜨고, 첫 발화가 오면 걷힌다. 멈춤(halt)이면 골격 뒤에 가두지
 *      않는다. 엑스퍼트 props 면 게이트도 골격도 없다.
 *   ③ 셸 배선 — `gateBootOutput` 을 주는 곳은 `BeginnerShell` 뿐이다.
 *
 * ★더미값만 — 실제 프롬프트 본문·실제 경로·토큰은 쓰지 않는다.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createElement, useEffect } from "react";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

import { OrchestratorBootGate } from "../../src/lib/orchestratorBootGate";
import type { PtyOutputGate } from "../../src/lib/orchestratorBootGate";
import { stripAnsi } from "../../src/lib/ansi";
import { en } from "../../src/locales/en";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, "..", "..");

function fixtureChunks(name: string): string[] {
  const raw = JSON.parse(
    fs.readFileSync(
      path.join(ROOT, "tests", "fixtures", "pty", `${name}.json`),
      "utf8",
    ),
  ) as { frames: Array<{ t: number; b64: string }> };
  return raw.frames.map((f) => Buffer.from(f.b64, "base64").toString("utf8"));
}

const FORBIDDEN = [
  "YOLO mode",
  "/var/folders",
  "You are the Marblo Orchestrator",
] as const;

const COMPOSER = "\x1b[2K  › Ask Codex to do anything   ? for shortcuts";
function history(lines: string[]): string {
  return (
    "\x1b[1;20r\x1b[19;1H" +
    lines.map((l) => `\n\x1b[0m${l}`).join("") +
    "\x1b[r\x1b[21;1H" +
    COMPOSER
  );
}
const ECHO = history([
  "› You are the Marblo Orchestrator Agent. Read the orchestrator skill file.",
  "  fallback CLI: /var/folders/xx/dummy/T/marblo-agent-configs/dummy/bin/marblo-fallback",
]);
const TOOL = history([
  '• Called marblo.get_agent_skill({"role":"orchestrator"})',
  "  └ # Orchestrator 스킬 (더미 본문)",
]);
const GREETING_LINE =
  "• 안녕하세요! 마블로예요. 작업 요청하시면 보드에 티켓 생성하고 에이전트 스폰해드릴게요.";
const GREETING = history([GREETING_LINE]);

// ── 가짜 xterm / electronAPI ─────────────────────────────────────────────
const fake = vi.hoisted(() => {
  class FakeTerminal {
    static instances: FakeTerminal[] = [];
    writes: string[] = [];
    cols = 80;
    rows = 24;
    options: Record<string, unknown>;
    buffer = { active: { type: "normal", viewportY: 0, baseY: 0 } };
    constructor(options: Record<string, unknown>) {
      this.options = options;
      FakeTerminal.instances.push(this);
    }
    loadAddon() {}
    open() {}
    write(s: string) {
      this.writes.push(s);
    }
    onData() {
      return { dispose() {} };
    }
    onResize() {
      return { dispose() {} };
    }
    attachCustomKeyEventHandler() {}
    refresh() {}
    scrollToBottom() {}
    focus() {}
    dispose() {}
    paste() {}
  }
  const pty = {
    dataListeners: new Map<string, Array<(d: string) => void>>(),
    replayChunks: [] as string[],
    resizes: [] as Array<[string, number, number]>,
  };
  return { FakeTerminal, pty };
});

vi.mock("@xterm/xterm", () => ({ Terminal: fake.FakeTerminal }));
vi.mock("@xterm/addon-fit", () => ({
  FitAddon: class {
    proposeDimensions() {
      return { cols: 80, rows: 24 };
    }
    fit() {}
  },
}));
vi.mock("@xterm/addon-web-links", () => ({ WebLinksAddon: class {} }));
vi.mock("@xterm/addon-webgl", () => ({ WebglAddon: class {} }));
vi.mock("@xterm/xterm/css/xterm.css", () => ({}));
vi.mock("../../src/lib/xtermIMEPatch", () => ({
  patchTerminalForFastIME: () => {},
}));
vi.mock("../../src/lib/monoFont", () => ({
  TERMINAL_FONT_FAMILY: "monospace",
  XTERM_CJK_RENDER_OPTIONS: {},
  bindTerminalCjkFont: () => {},
  repairTerminalCjkFontCachesIfLoaded: () => null,
  waitForTerminalCjkFontBeforeOpen: () => Promise.resolve(),
}));
vi.mock("../../src/utils/clipboardImage", () => ({
  resolveClipboardForTerminal: () => Promise.resolve(null),
}));
vi.mock("../../src/stores/agentSessionMap", () => ({
  useAgentSessionMap: { getState: () => ({ map: {} }) },
}));
vi.mock("../../src/stores/agentStore", () => ({
  useAgentStore: Object.assign(
    (selector: (s: unknown) => unknown) =>
      selector({ agents: [], hydrated: true }),
    { getState: () => ({ agents: [], hydrated: true }) },
  ),
}));
vi.mock("../../src/stores/projectStore", () => ({
  useProjectStore: Object.assign(
    (selector: (s: unknown) => unknown) =>
      selector({
        currentProject: { id: "p1", folderPath: "/tmp/p1" },
        machineId: "m1",
        subscribedUserId: "u1",
      }),
    {
      getState: () => ({
        currentProject: { id: "p1", folderPath: "/tmp/p1" },
        machineId: "m1",
        subscribedUserId: "u1",
      }),
    },
  ),
}));

// OrchestratorPanel 이 끄는 나머지 스토어·서비스.
const stores = vi.hoisted(() => ({
  status: "running" as string,
  halt: null as unknown,
  ptySessionId: "pty-orch" as string | null,
}));
vi.mock("../../src/stores/editorStore", () => ({
  useEditorStore: vi.fn((selector: (s: unknown) => unknown) =>
    selector({ rootPath: "/tmp/p1" }),
  ),
}));
vi.mock("../../src/stores/taskStore", () => ({
  useTaskStore: vi.fn((selector: (s: unknown) => unknown) =>
    selector({ tasks: [] }),
  ),
}));
vi.mock("../../src/stores/cliSetupStore", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../src/stores/cliSetupStore")>()),
  useCliSetupStore: vi.fn((selector: (s: unknown) => unknown) =>
    selector({ states: {} }),
  ),
}));
vi.mock("../../src/services/cliSetupActions", () => ({ launchLogin: vi.fn() }));
vi.mock("../../src/services/orchestratorAgentDoc", () => ({
  upsertOrchestratorAgentDoc: vi.fn(),
}));
// 워크체인 패널(티켓 fQtXQ2NzyYs0MRpqByTS)은 Firestore 구독을 서비스로 감싼다 —
// 이 테스트가 보는 건 패널 자체가 아니라 오케 헤더/배너이므로 서비스만 비운다.
vi.mock("../../src/services/workChainService", () => ({
  subscribeWorkChain: vi.fn(() => () => {}),
  addWorkChainItemFromUi: vi.fn(async () => ({ ok: true, itemId: "wc_x" })),
  dropWorkChainItemFromUi: vi.fn(async () => ({ ok: true })),
}));
vi.mock("../../src/services/onrampBlockSignal", () => ({
  reportOnrampExecBlocked: vi.fn(),
}));
vi.mock("../../src/stores/orchestratorStore", async () => {
  const actual = await vi.importActual<
    typeof import("../../src/stores/orchestratorStore")
  >("../../src/stores/orchestratorStore");
  const useOrchestratorStore = Object.assign(
    (selector: (s: unknown) => unknown) =>
      selector({
        sessionId: "s1",
        ptySessionId: stores.ptySessionId,
        status: stores.status,
        isCollapsed: false,
        selectedModel: "claude",
        runningModel: "claude",
        switchStatus: "idle",
        lastHandoffSummary: null,
        launchBlock: null,
        halt: stores.halt,
        setSession: () => {},
        setStatus: () => {},
        setCollapsed: () => {},
        setSelectedModel: () => {},
        setSwitchStatus: () => {},
        setHandoffSummary: () => {},
        setLaunchBlock: () => {},
        setHalt: () => {},
        confirmLaunched: () => {},
        toggleCollapsed: () => {},
        clear: () => {},
      }),
    { getState: () => ({ switchStatus: "idle" }) },
  );
  return { ...actual, useOrchestratorStore };
});

const { default: TerminalView } =
  await import("../../src/components/terminal/TerminalView");
const { default: OrchestratorPanel } =
  await import("../../src/components/orchestrator/OrchestratorPanel");

function installElectronApi() {
  (window as unknown as { electronAPI: Record<string, unknown> }).electronAPI =
    {
      testMode: { bypassAuth: false },
      claude: { version: () => Promise.resolve({ version: "2.1.238" }) },
      orchestratorModel: {
        get: () => Promise.resolve("claude"),
        set: () => Promise.resolve(),
      },
      orchestratorSession: {
        launch: () => Promise.resolve(null),
        stop: () => Promise.resolve(),
        listSessions: () => Promise.resolve([]),
      },
      pty: {
        onData: (sid: string, cb: (d: string) => void) => {
          const list = fake.pty.dataListeners.get(sid) ?? [];
          list.push(cb);
          fake.pty.dataListeners.set(sid, list);
        },
        onExit: () => {},
        replay: () => Promise.resolve(fake.pty.replayChunks.slice()),
        exists: () => Promise.resolve(true),
        write: () => Promise.resolve(),
        resize: (sid: string, cols: number, rows: number) => {
          fake.pty.resizes.push([sid, cols, rows]);
        },
        removeListeners: (sid: string) => {
          fake.pty.dataListeners.delete(sid);
        },
      },
    };
}

function emitPty(sid: string, chunk: string) {
  for (const cb of fake.pty.dataListeners.get(sid) ?? []) cb(chunk);
}

function termWrites(): string {
  return stripAnsi(
    fake.FakeTerminal.instances.map((t) => t.writes.join("")).join(""),
  );
}

beforeEach(() => {
  installElectronApi();
  fake.FakeTerminal.instances.length = 0;
  fake.pty.dataListeners.clear();
  fake.pty.replayChunks = [];
  fake.pty.resizes.length = 0;
  stores.status = "running";
  stores.halt = null;
  stores.ptySessionId = "pty-orch";
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

/** xterm 이 열리고 PTY 리스너가 붙을 때까지. */
async function waitForAttached(sid: string) {
  await waitFor(
    () => {
      expect(fake.pty.dataListeners.get(sid)?.length ?? 0).toBeGreaterThan(0);
    },
    { timeout: 3000 },
  );
}

async function settle(ms = 150) {
  await act(async () => {
    await new Promise((r) => setTimeout(r, ms));
  });
}

describe("① TerminalView — PTY 바이트는 게이트를 거쳐야 xterm 에 닿는다", () => {
  it("★비기너(outputGate): 배너·에코·툴 출력은 xterm 에 한 바이트도 안 쓰이고, 인사말부터 쓰인다", async () => {
    const gate = new OrchestratorBootGate();
    render(
      createElement(TerminalView, {
        sessionId: "pty-orch",
        isActive: true,
        outputGate: gate,
      }),
    );
    await waitForAttached("pty-orch");
    // 라이브: 실제 codex 0.149.0 부트 프레임 → 더미 에코 → 더미 툴 호출/반환.
    for (const chunk of fixtureChunks("codex-ready-composer"))
      emitPty("pty-orch", chunk);
    emitPty("pty-orch", ECHO);
    emitPty("pty-orch", TOOL);
    await settle(400);
    expect(gate.state).toBe("armed");
    expect(termWrites()).toBe("");

    emitPty("pty-orch", GREETING);
    await waitFor(() => {
      expect(termWrites()).toContain(GREETING_LINE);
    });
    const shown = termWrites();
    for (const s of FORBIDDEN) expect(shown).not.toContain(s);
    expect(shown).not.toContain("OpenAI Codex");
    expect(shown).not.toContain("Called marblo");
    expect(shown).not.toContain("더미 본문");
    // 열린 뒤 TUI 가 컴포저를 다시 그리도록 SIGWINCH 넛지를 보냈다.
    await waitFor(() => {
      expect(fake.pty.resizes.some(([, cols]) => cols === 81)).toBe(true);
    });
  });

  it("★replay 경로(리마운트)도 같다 — 링에 부트가 있어도 인사말부터만 xterm 에 쓰인다", async () => {
    fake.pty.replayChunks = [
      ...fixtureChunks("codex-ready-composer"),
      ECHO,
      TOOL,
      GREETING,
    ];
    const gate = new OrchestratorBootGate();
    render(
      createElement(TerminalView, {
        sessionId: "pty-orch",
        isActive: true,
        outputGate: gate,
      }),
    );
    await waitFor(
      () => {
        expect(termWrites()).toContain(GREETING_LINE);
      },
      { timeout: 3000 },
    );
    const shown = termWrites();
    for (const s of FORBIDDEN) expect(shown).not.toContain(s);
    expect(shown).not.toContain("OpenAI Codex");
  });

  it("마블로/엑스퍼트(outputGate 없음): 원시 바이트가 그대로 xterm 에 쓰인다 — 무변경", async () => {
    render(
      createElement(TerminalView, { sessionId: "pty-orch", isActive: true }),
    );
    await waitForAttached("pty-orch");
    for (const chunk of fixtureChunks("codex-ready-composer"))
      emitPty("pty-orch", chunk);
    emitPty("pty-orch", ECHO);
    await waitFor(() => {
      expect(termWrites()).toContain("OpenAI Codex");
    });
    expect(termWrites()).toContain("YOLO mode");
    expect(termWrites()).toContain("You are the Marblo Orchestrator");
  });
});

// ── ② 패널 — 골격이 뜨고 걷힌다 ──────────────────────────────────────────
// 여기서는 xterm 대신 게이트 prop 을 붙잡는 가짜 TerminalView 를 쓴다.
const captured = vi.hoisted(() => ({
  gates: [] as Array<PtyOutputGate | undefined>,
}));

const BEGINNER_PROPS = {
  fill: true,
  hideModelControls: true,
  showConnectedModelPicker: true,
  showSessionRecovery: true,
  gateBootOutput: true,
} as const;

describe("② OrchestratorPanel — 오케가 말하기 전엔 로딩 골격, 말하면 걷힌다", () => {
  beforeEach(() => {
    captured.gates.length = 0;
    vi.doMock("../../src/components/terminal/TerminalView", () => ({
      default: (props: { outputGate?: PtyOutputGate }) => {
        useEffect(() => {
          captured.gates.push(props.outputGate);
          props.outputGate?.reset();
        }, [props.outputGate]);
        return createElement("div", { "data-testid": "stub-terminal" });
      },
    }));
  });

  async function mountPanel(props: Record<string, unknown>) {
    vi.resetModules();
    const { default: Panel } =
      await import("../../src/components/orchestrator/OrchestratorPanel");
    return render(createElement(Panel, props));
  }

  it("★비기너: 골격 + '준비하고 있어요' 가 먼저, 첫 발화가 오면 골격이 걷힌다", async () => {
    await mountPanel(BEGINNER_PROPS);
    const overlay = screen.getByTestId("orchestrator-boot-gate");
    expect(overlay.textContent).toContain(en["beginner.chat.preparing"]);
    // #1135 골격 — StateBlock loading 이 전체 높이(100%)를 지킨다.
    const block = overlay.querySelector('[data-state-block="block"]');
    expect(block?.getAttribute("data-state-kind")).toBe("loading");
    expect((block as HTMLElement).style.minHeight).toBe("100%");
    expect(overlay.querySelector("[data-skeleton]")).toBeTruthy();
    // 골격 위에 배너·프롬프트가 글자로 있지 않다.
    for (const s of FORBIDDEN) expect(overlay.textContent).not.toContain(s);

    const gate = captured.gates.find(Boolean);
    expect(gate).toBeTruthy();
    act(() => {
      for (const chunk of fixtureChunks("codex-ready-composer"))
        gate!.feed(chunk);
      gate!.feed(ECHO);
      gate!.feed(TOOL);
    });
    expect(gate!.state).toBe("armed");
    expect(screen.getByTestId("orchestrator-boot-gate")).toBeTruthy();

    act(() => {
      gate!.feed(GREETING);
    });
    expect(gate!.state).toBe("open");
    expect(screen.queryByTestId("orchestrator-boot-gate")).toBeNull();
    expect(screen.getByTestId("stub-terminal")).toBeTruthy();
  });

  it("★멈춤(로그인 필요)이면 골격 뒤에 가두지 않는다 — 사용자가 원시 화면에 답해야 풀린다", async () => {
    stores.status = "error";
    stores.halt = { kind: "needsAuth", model: "codex" };
    await mountPanel(BEGINNER_PROPS);
    await waitFor(() => {
      expect(screen.queryByTestId("orchestrator-boot-gate")).toBeNull();
    });
    expect(screen.getByTestId("stub-terminal")).toBeTruthy();
    expect(captured.gates.find(Boolean)?.state).toBe("open");
  });

  it("마블로/엑스퍼트 props: 게이트도 골격도 없다 — 무변경", async () => {
    await mountPanel({});
    expect(screen.queryByTestId("orchestrator-boot-gate")).toBeNull();
    expect(screen.getByTestId("stub-terminal")).toBeTruthy();
    expect(captured.gates.length).toBeGreaterThan(0);
    expect(captured.gates.every((g) => g === undefined)).toBe(true);

    cleanup();
    captured.gates.length = 0;
    await mountPanel({ fill: true }); // 워크스페이스 TerminalColumn 의 마운트
    expect(screen.queryByTestId("orchestrator-boot-gate")).toBeNull();
    expect(captured.gates.every((g) => g === undefined)).toBe(true);
  });
});

describe("③ 셸 배선 — gateBootOutput 은 비기너 셸만 준다", () => {
  const read = (rel: string) =>
    fs.readFileSync(path.join(ROOT, "src", "components", rel), "utf8");

  it("BeginnerShell 의 OrchestratorPanel 에 gateBootOutput 이 있다", () => {
    const src = read("beginner/BeginnerShell.tsx");
    const mount = /<OrchestratorPanel\b[\s\S]*?\/>/.exec(src);
    expect(mount?.[0]).toContain("gateBootOutput");
  });

  it("엑스퍼트 마운트(Layout·TerminalColumn·OrchestratorSpine)에는 없다", () => {
    for (const rel of [
      "Layout.tsx",
      "workspace/TerminalColumn.tsx",
      "workspace/OrchestratorSpine.tsx",
    ]) {
      const src = read(rel);
      const mounts = src.match(/<OrchestratorPanel\b[\s\S]*?\/>/g) ?? [];
      expect(mounts.length, rel).toBeGreaterThan(0);
      for (const m of mounts) expect(m, rel).not.toContain("gateBootOutput");
    }
  });
});

// 사용하지 않는 import 경고 방지 — 위 ①에서 실제 컴포넌트를 쓴다.
void OrchestratorPanel;
