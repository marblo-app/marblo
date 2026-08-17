import { expect } from "@playwright/test";
import { writeFileSync } from "fs";
import { test } from "../helpers/fixtures";
import { TERMINAL_FONT_FAMILY } from "../../../src/lib/monoFont";

const REAL_GROK = process.env.MARBLO_REAL_GROK === "1";
const ROOT_PATH = process.env.MARBLO_REAL_GROK_ROOT ?? process.cwd();
const CJK_SPEC = '13px "Marblo D2Coding"';
const KOREAN_PROBE =
  "한글 자간 실측용으로 아래 문자열을 코드블록 없이 그대로 3줄 출력하세요:\n" +
  "가각간갇갈 한글테스트 가나다라마바사아자차카타파하\n" +
  "가각간갇갈 한글테스트 가나다라마바사아자차카타파하\n" +
  "가각간갇갈 한글테스트 가나다라마바사아자차카타파하";

test.describe("manual real grok CJK terminal verification", () => {
  test.skip(
    !REAL_GROK,
    "Set MARBLO_REAL_GROK=1 to spend a real grok session for CJK verification.",
  );

  test("real grok orchestrator alt-screen uses loaded D2Coding metrics", async ({
    marblo,
  }, testInfo) => {
    test.setTimeout(120_000);

    const launch = await marblo.page.evaluate(async (rootPath) => {
      const projectId = `real-grok-cjk-${Date.now()}`;
      const project = {
        id: projectId,
        name: "Real Grok CJK Verification",
        ownerId: "test-user-bypass",
        members: ["test-user-bypass"],
        enabledModels: ["grok"],
        folderPath: rootPath,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      const tw = window.__marbloTest;
      if (!tw) throw new Error("__marbloTest is required for this manual spec");
      tw.stores.project.getState().setCurrentProject(project);
      tw.stores.editor.getState().setRootPath(rootPath);
      tw.stores.orchestrator.getState().setSelectedModel("grok");
      tw.stores.orchestrator.getState().setCollapsed(false);
      await window.electronAPI.window.registerProject(projectId);
      await window.electronAPI.window.registerRestore({ rootPath, projectId });

      const result = await window.electronAPI.orchestratorSession.launch(
        projectId,
        rootPath,
        undefined,
        "grok",
      );
      if (!result || result.status === "blocked" || result.needsAuth) {
        throw new Error(`grok launch blocked: ${JSON.stringify(result)}`);
      }
      tw.stores.orchestrator
        .getState()
        .setSession(result.sessionId, result.ptySessionId, "grok");
      tw.stores.orchestrator.getState().setStatus("running");
      tw.stores.orchestrator.getState().setCollapsed(false);
      return { ...result, projectId };
    }, ROOT_PATH);

    await marblo.page.locator(".xterm").first().waitFor({
      state: "visible",
      timeout: 20_000,
    });

    await expect
      .poll(
        () =>
          marblo.page.evaluate((sessionId) => {
            return window.__marbloTerminalDebug?.[sessionId]?.() ?? null;
          }, launch.ptySessionId),
        { timeout: 45_000, message: "grok should enter alt-screen TUI" },
      )
      .toMatchObject({ activeBufferType: "alternate" });

    await marblo.page.screenshot({
      path: testInfo.outputPath("real-grok-alt-screen-before.png"),
      fullPage: true,
    });

    await marblo.page.evaluate(
      async ({ sessionId, prompt }) => {
        await window.electronAPI.pty.writeAndSubmit(sessionId, prompt, true);
      },
      { sessionId: launch.ptySessionId, prompt: KOREAN_PROBE },
    );

    await marblo.page.waitForTimeout(18_000);

    const metrics = await marblo.page.evaluate(
      async ({ sessionId, stack, spec }) => {
        await document.fonts.load(spec, "가");
        const fontLoaded = document.fonts.check(spec, "가");
        const debug = window.__marbloTerminalDebug?.[sessionId]?.() ?? null;
        const root = document.querySelector(".xterm") as HTMLElement | null;
        const screen = root?.querySelector(
          ".xterm-screen",
        ) as HTMLElement | null;
        const rows = root?.querySelector(".xterm-rows") as HTMLElement | null;
        const textarea = root?.querySelector("textarea") as HTMLElement | null;
        const ctx = document.createElement("canvas").getContext("2d")!;
        ctx.font = `13px ${stack}`;
        const asciiWidth = ctx.measureText("0").width;
        const hangulWidth = ctx.measureText("한").width;
        ctx.font = spec.replace('"Marblo D2Coding"', "monospace");
        const fallbackHangulWidth = ctx.measureText("한").width;
        const screenWidth = screen?.getBoundingClientRect().width ?? 0;
        const screenCellWidth = debug?.cols ? screenWidth / debug.cols : 0;
        const text = rows?.textContent ?? "";
        return {
          debug,
          fontLoaded,
          asciiWidth,
          hangulWidth,
          fallbackHangulWidth,
          hangulToAsciiRatio: hangulWidth / asciiWidth,
          screenWidth,
          screenCellWidth,
          hangulToScreenCellRatio: screenCellWidth
            ? hangulWidth / screenCellWidth
            : 0,
          rowsLetterSpacing: rows ? getComputedStyle(rows).letterSpacing : null,
          textareaFontFamily: textarea
            ? getComputedStyle(textarea).fontFamily
            : null,
          rowsTextSample: text.slice(-500),
        };
      },
      {
        sessionId: launch.ptySessionId,
        stack: TERMINAL_FONT_FAMILY,
        spec: CJK_SPEC,
      },
    );

    await marblo.page.screenshot({
      path: testInfo.outputPath("real-grok-alt-screen-after-korean.png"),
      fullPage: true,
    });
    writeFileSync(
      testInfo.outputPath("real-grok-cjk-metrics.json"),
      `${JSON.stringify(metrics, null, 2)}\n`,
    );
    await testInfo.attach("real-grok-cjk-metrics", {
      body: JSON.stringify(metrics, null, 2),
      contentType: "application/json",
    });

    expect(metrics.fontLoaded).toBe(true);
    expect(metrics.debug?.activeBufferType).toBe("alternate");
    expect(metrics.debug?.fontFamily).toContain("Marblo D2Coding");
    expect(metrics.hangulToAsciiRatio).toBeCloseTo(2, 3);
    expect(metrics.hangulToScreenCellRatio).toBeCloseTo(2, 1);
    if (metrics.rowsLetterSpacing !== null) {
      expect(metrics.rowsLetterSpacing).toMatch(/^-?\d+(\.\d+)?px$|^normal$/);
    }

    await marblo.page
      .evaluate(() => window.electronAPI.orchestratorSession.stop())
      .catch(() => {});
  });
});
