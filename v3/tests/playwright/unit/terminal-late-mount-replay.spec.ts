import { test, expect } from "../helpers/fixtures";
import { TERMINAL_FONT_FAMILY } from "../../../src/lib/monoFont";

/**
 * 회귀: "지연 마운트 터미널이 빈 화면으로 뜬다".
 *
 * 사장님 증상 — 비기너 모드에서 그록 에이전트 창을 열면 아무것도 안 보이고,
 * 뭔가 입력해야 그때부터 글자가 조금씩 나온다. 에이전트는 정상(MCP 호출까지
 * 성공)이었으므로 순수 렌더 문제.
 *
 * 원인(이 스펙으로 실측): main 의 `pty:replay` 전까지 PTY 출력은 라이브 전송을
 * 아예 하지 않고 `ptyBuffers[sid]` 에만 쌓인다 — 즉 그 버퍼가 **유일한 사본**이다.
 * 그런데 `pty:resize` 가 아직 드레인 안 된 버퍼를 통째로 비웠다. 터미널이 스폰과
 * 동시에 떠 있는 고급 모드에서는 버퍼에 초기 80x24 프레임밖에 없어 무해했지만
 * (Gemini 중복 프레임 방지가 원래 의도), 비기너 모달처럼 한참 뒤에 마운트하면
 * 세션 히스토리 전체가 그 안에 있고 — 마운트 직후 스스로 보내는 fit resize 한
 * 번에 전부 지워졌다. 자기가 보려던 걸 자기가 지운다.
 *
 * 수정: 폐기는 "아직 안 드레인됨" 이 아니라 **시간 창**으로 판정한다
 * (PTY_INITIAL_FRAME_DISCARD_MS).
 */

const CJK_SPEC = '13px "Marblo D2Coding"';
const MAX_HEALTHY_LETTER_SPACING_PX = 0.05;

test.describe("지연 마운트 PTY replay (비기너 에이전트 모달 경로)", () => {
  test("@unit 터미널 없이 쌓인 출력은 replay 로 전달된다 (대조군)", async ({
    marblo,
  }) => {
    const result = await marblo.page.evaluate(async () => {
      const id = `late-mount-control-${Date.now()}`;
      await window.electronAPI.pty.create({
        id,
        name: "LateMountControl",
        command: "sh",
        args: [],
        cwd: undefined,
      });
      window.electronAPI.pty.write(
        id,
        'printf "한글 이전 출력 MARKER\\r\\n"\r',
      );
      await new Promise((r) => setTimeout(r, 900));
      const replayed = await window.electronAPI.pty.replay(id);
      window.electronAPI.pty.kill(id);
      return { chunks: replayed.length, text: replayed.join("") };
    });

    expect(result.chunks).toBeGreaterThan(0);
    expect(result.text).toContain("MARKER");
  });

  test("@unit 지연 마운트의 fit resize 가 쌓인 출력을 지우지 않는다", async ({
    marblo,
  }) => {
    // 수정 전에는 여기서 replay 가 '    \x1b[Ksh-3.2$ ' 한 조각만 돌려줬다.
    // 즉 모달을 열기 전까지의 세션 출력이 통째로 사라졌다 = 백지 화면.
    const result = await marblo.page.evaluate(async () => {
      const id = `late-mount-kept-${Date.now()}`;
      await window.electronAPI.pty.create({
        id,
        name: "LateMountKept",
        command: "sh",
        args: [],
        cwd: undefined,
      });
      window.electronAPI.pty.write(
        id,
        'printf "한글 이전 출력 MARKER\\r\\n"\r',
      );
      // 초기 프레임 폐기 창(3s)을 확실히 넘긴 "나중에 연 모달" 상황.
      await new Promise((r) => setTimeout(r, 3400));
      // TerminalView 가 마운트 직후 fit() → terminal.onResize 로 보내는 바로 그 호출.
      await window.electronAPI.pty.resize(id, 100, 30);
      await new Promise((r) => setTimeout(r, 150));
      const replayed = await window.electronAPI.pty.replay(id);
      window.electronAPI.pty.kill(id);
      return { chunks: replayed.length, text: replayed.join("") };
    });

    expect(result.chunks).toBeGreaterThan(0);
    expect(result.text).toContain("MARKER");
  });

  test("@unit 스폰 직후 resize 는 초기 80x24 프레임을 계속 폐기한다", async ({
    marblo,
  }) => {
    // 반대쪽 회귀 — Gemini alt-screen 중복 프레임(두 개의 입력창) 방지가
    // 시간 창 안에서는 그대로 살아 있어야 한다.
    const result = await marblo.page.evaluate(async () => {
      const id = `late-mount-initial-${Date.now()}`;
      await window.electronAPI.pty.create({
        id,
        name: "LateMountInitial",
        command: "sh",
        args: [],
        cwd: undefined,
      });
      window.electronAPI.pty.write(
        id,
        'printf "초기 프레임 STALEFRAME\\r\\n"\r',
      );
      await new Promise((r) => setTimeout(r, 600));
      await window.electronAPI.pty.resize(id, 100, 30);
      await new Promise((r) => setTimeout(r, 150));
      const replayed = await window.electronAPI.pty.replay(id);
      window.electronAPI.pty.kill(id);
      return { text: replayed.join("") };
    });

    expect(result.text).not.toContain("STALEFRAME");
  });

  test("@mocked 나중에 마운트한 터미널이 입력 없이 기존 출력을 그린다", async ({
    marblo,
  }) => {
    // 비기너 모달과 같은 순서: PTY 가 먼저 살아서 출력하고, TerminalView 는
    // 한참 뒤에 마운트한다. (BeginnerAgentTerminalModal 은 어드밴스드와 똑같이
    // TerminalView 를 쓰므로 OrchestratorTerminal 경로로 같은 계약을 검증한다.)
    const sessionId = `late-mount-render-${Date.now()}`;

    await marblo.page.evaluate(() => {
      const tw = (
        window as unknown as {
          __marbloTest?: {
            stores: {
              project: {
                getState: () => { setCurrentProject: (p: unknown) => void };
              };
            };
          };
        }
      ).__marbloTest;
      if (!tw) throw new Error("__marbloTest hatch 미노출 (bypassAuth 확인)");
      tw.stores.project.getState().setCurrentProject({
        id: "test-mock-project",
        name: "Mock Project",
        ownerId: "test-user-bypass",
        members: ["test-user-bypass"],
        enabledModels: ["claude"],
        createdAt: new Date(),
        updatedAt: new Date(),
      });
    });
    await marblo.page.waitForTimeout(100);

    // 1) 터미널 없이 PTY 를 띄우고 한글을 출력한다.
    await marblo.page.evaluate(async (id) => {
      await window.electronAPI.pty.create({
        id,
        name: "LateMountRender",
        command: "sh",
        args: [],
        cwd: undefined,
      });
      window.electronAPI.pty.write(
        id,
        'printf "한글 지연 마운트 확인 LATEMOUNT\\r\\n"\r',
      );
    }, sessionId);
    // 초기 프레임 폐기 창을 넘긴다 — 사람이 모달을 여는 시점.
    await marblo.page.waitForTimeout(3600);

    // 2) 이제서야 TerminalView 를 마운트한다.
    await marblo.page.evaluate((id) => {
      const tw = (
        window as unknown as {
          __marbloTest?: {
            stores: {
              orchestrator: {
                getState: () => {
                  setSession: (sid: string, pid: string) => void;
                  setStatus: (s: string) => void;
                  setCollapsed: (c: boolean) => void;
                };
              };
            };
          };
        }
      ).__marbloTest;
      if (!tw) throw new Error("__marbloTest hatch 미노출");
      const orch = tw.stores.orchestrator.getState();
      orch.setSession("test-mock-session", id);
      orch.setStatus("running");
      orch.setCollapsed(false);
    }, sessionId);

    const term = await marblo.terminal("orchestrator");
    await term.waitReady();

    // 3) ★키 입력을 단 한 번도 하지 않는다. 그래도 기존 출력이 보여야 한다.
    await expect
      .poll(
        () =>
          marblo.page.evaluate(
            () =>
              document.querySelector(".xterm .xterm-rows")?.textContent ?? "",
          ),
        {
          message: "지연 마운트 터미널이 입력 없이 기존 출력을 그려야 함",
          timeout: 15_000,
        },
      )
      .toContain("LATEMOUNT");

    // 4) 한글 자간 회귀 금지 (touCs5cr / RuXTqrpd / YHtv8TPY).
    const geom = await marblo.page.evaluate(
      ({ stack, spec }) => {
        const rows = document.querySelector(
          ".xterm .xterm-rows",
        ) as HTMLElement | null;
        const ctx = document.createElement("canvas").getContext("2d")!;
        ctx.font = `13px ${stack}`;
        const cellW = ctx.measureText("0").width;
        ctx.font = spec;
        const hanW = ctx.measureText("한").width;
        const parseCssPx = (value: string | null) => {
          if (!value || value === "normal") return 0;
          const parsed = Number.parseFloat(value);
          return Number.isFinite(parsed) ? parsed : null;
        };
        const rowSpacing = rows ? getComputedStyle(rows).letterSpacing : null;
        const spanSpacings = rows
          ? Array.from(rows.querySelectorAll("span"), (span) =>
              parseCssPx(getComputedStyle(span).letterSpacing),
            ).filter((v): v is number => v !== null)
          : [];
        return {
          rowSpacingPx: parseCssPx(rowSpacing),
          maxSpanSpacingPx: spanSpacings.length
            ? Math.max(...spanSpacings.map(Math.abs))
            : 0,
          ratio: hanW / cellW,
        };
      },
      { stack: TERMINAL_FONT_FAMILY, spec: CJK_SPEC },
    );

    expect(geom.ratio, "한글 advance / 셀폭 = 2.0 이어야 함").toBeCloseTo(2, 3);
    if (geom.rowSpacingPx !== null) {
      expect(Math.abs(geom.rowSpacingPx)).toBeLessThanOrEqual(
        MAX_HEALTHY_LETTER_SPACING_PX,
      );
    }
    expect(geom.maxSpanSpacingPx).toBeLessThanOrEqual(
      MAX_HEALTHY_LETTER_SPACING_PX,
    );

    await marblo.page.evaluate(
      (id) => window.electronAPI.pty.kill(id),
      sessionId,
    );
  });
});
