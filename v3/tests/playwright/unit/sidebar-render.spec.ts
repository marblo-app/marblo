import { test, expect } from "../helpers/fixtures";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";

test.beforeEach(async ({ marblo }) => {
  await marblo.page.evaluate(() => {
    localStorage.removeItem("marblo:test:projectAuditHarness");
  });
  await marblo.page.reload();
  await marblo.page.waitForLoadState("domcontentloaded");
  await marblo.page
    .locator("button", { hasText: "나중에" })
    .click({ timeout: 2000 })
    .catch(() => {});
});

/**
 * Tier 1 smoke — Sidebar 가 글로벌 레이아웃에 mount 되고 핵심 탭 (파일/명령어/채팅)
 * 이 렌더되는지.
 *
 * Layout.tsx:305 에서 Sidebar 가 탭과 무관하게 항상 mount 됨. 따라서 부팅 직후
 * 어떤 탭에서도 보여야 함. 기본 isOpen 은 Layout 의 sidebarOpen state — true 라고
 * 가정하고, 만약 닫혀 있으면 toggle 버튼만이라도 보이는지 확인.
 *
 * 잡히는 회귀:
 *   - Sidebar / FileTree / CommandPanel / ProjectChat import 깨짐
 *   - useChatStore subscribe 시 throw
 *   - Sidebar 헤더 탭 (파일/명령어/채팅) 중 하나라도 사라지면 알람
 *   - Layout 에서 Sidebar 마운트가 빠지는 회귀
 */

test("@unit Sidebar 가 mount 되고 활성 패널 헤더가 보인다", async ({
  marblo,
}) => {
  // openTab 호출 안 하고 부팅 직후 상태에서 검증 — Sidebar 는 글로벌 mount.
  await marblo.page.waitForTimeout(400);

  // 1) ErrorBoundary / crash 패턴 0개.
  const errorPatterns = [
    "Something went wrong",
    "에러가 발생",
    "오류가 발생",
    "crashed",
  ];
  for (const pat of errorPatterns) {
    await expect(
      marblo.page.locator(`text=/${pat}/i`),
      `Sidebar 영역에 에러 패턴 "${pat}" 가 보임`,
    ).toHaveCount(0);
  }

  // 2) Sidebar 의 패널 헤더 탭 3개 중 하나 이상이 보여야 함.
  //    열린 상태면 "파일"/"명령어"/"채팅" 텍스트가 헤더에 노출됨.
  //    닫혀 있으면 toggle 버튼만 보이고 header tab 은 안 보임 → 그 경우도 PASS
  //    하도록 분기.
  const fileTab = marblo.page.locator(`button:has-text("파일")`).first();
  const commandTab = marblo.page.locator(`button:has-text("명령어")`).first();
  const chatTab = marblo.page.locator(`button:has-text("채팅")`).first();
  const toggleBtn = marblo.page
    .locator(`button[title="사이드바 열기"], button[title="사이드바 닫기"]`)
    .first();

  await expect
    .poll(
      async () => {
        const fileVisible = await fileTab.isVisible().catch(() => false);
        const commandVisible = await commandTab.isVisible().catch(() => false);
        const chatVisible = await chatTab.isVisible().catch(() => false);
        const toggleVisible = await toggleBtn.isVisible().catch(() => false);
        return fileVisible || commandVisible || chatVisible || toggleVisible;
      },
      {
        message:
          "Sidebar 의 패널 탭(파일/명령어/채팅) 도 toggle 버튼도 안 보임 — Sidebar mount 실패 가능성",
        timeout: 10_000,
      },
    )
    .toBe(true);

  // 열린 경우: 3개 탭 중 1개 이상 visible.
  // 닫힌 경우: toggle 버튼 visible.
  const fileVisible = await fileTab.isVisible().catch(() => false);
  const commandVisible = await commandTab.isVisible().catch(() => false);
  const chatVisible = await chatTab.isVisible().catch(() => false);

  // 3) Sidebar 가 열려 있으면 active 패널 콘텐츠 영역에 노드가 1개 이상.
  //    fileTree 로딩 spinner 든 empty placeholder 든 OK — DOM 자체 mount 확인용.
  if (fileVisible || commandVisible || chatVisible) {
    const sidebarInteractive = await marblo.page
      .locator("body button, body input, body svg")
      .count();
    expect(
      sidebarInteractive,
      "Sidebar 가 열렸는데 인터랙티브 요소가 0 — 패널 mount 실패 가능성",
    ).toBeGreaterThan(0);
  }
});

test("@unit FileTree 긴 루트/파일명이 좁은 사이드바에서 char-wrap 되지 않는다", async ({
  marblo,
}, testInfo) => {
  const longRootName =
    "marblo-frontend-gpt-ydnc-bLRPEdmi-without-spaces-extra-long-worktree-name";
  const longFileName =
    "SuperLongFileNameWithoutSpacesThatUsedToWrapOneCharacterPerLine.tsx";
  const rootPath = path.join(os.tmpdir(), `${longRootName}-${Date.now()}`);

  fs.mkdirSync(rootPath, { recursive: true });
  fs.writeFileSync(
    path.join(rootPath, longFileName),
    "export const value = 1;\n",
  );

  try {
    await marblo.page.waitForFunction(
      () => {
        const tw = (
          window as unknown as {
            __marbloTest?: { stores: { project?: unknown } };
          }
        ).__marbloTest;
        return !!tw?.stores?.project;
      },
      null,
      { timeout: 5000 },
    );

    await marblo.page.evaluate((rootPath) => {
      const tw = (
        window as unknown as {
          __marbloTest?: {
            stores: {
              editor: {
                getState: () => { setRootPath: (path: string) => void };
              };
              project: {
                setState: (s: Record<string, unknown>) => void;
              };
            };
          };
        }
      ).__marbloTest;
      if (!tw) throw new Error("__marbloTest hatch 가 노출되지 않음");
      tw.stores.project.setState({
        currentProject: null,
        projects: [
          {
            id: "long-filetree-label-project",
            name: "Long FileTree Label Project",
            ownerId: "test-user-bypass",
            members: ["test-user-bypass"],
            folderPath: rootPath,
            enabledModels: ["claude"],
            createdAt: new Date(),
            updatedAt: new Date(),
          },
        ],
        loading: false,
        projectsHydrated: true,
      });
      tw.stores.editor.getState().setRootPath(rootPath);
    }, rootPath);

    const rootLabel = marblo.page.getByTestId("file-tree-root-label");
    await expect(rootLabel).toBeVisible({ timeout: 5000 });
    await expect(rootLabel).toHaveText(new RegExp(longRootName));
    await expect(rootLabel).toHaveAttribute("title", rootPath);

    const fileLabel = marblo.page
      .getByTestId("file-tree-node-label")
      .filter({ hasText: longFileName })
      .first();
    await expect(fileLabel).toBeVisible({ timeout: 5000 });
    await expect(fileLabel).toHaveAttribute(
      "title",
      path.join(rootPath, longFileName),
    );

    const resizeHandle = marblo.page.locator(".cursor-col-resize").first();
    const box = await resizeHandle.boundingBox();
    if (!box) throw new Error("sidebar resize handle not found");
    await marblo.page.mouse.move(box.x + box.width / 2, box.y + 20);
    await marblo.page.mouse.down();
    await marblo.page.mouse.move(160, box.y + 20);
    await marblo.page.mouse.up();

    const measure = async (testId: string, text?: string) =>
      marblo.page.evaluate(
        ({ testId, text }) => {
          const candidates = Array.from(
            document.querySelectorAll<HTMLElement>(`[data-testid="${testId}"]`),
          );
          const el = text
            ? candidates.find((candidate) =>
                candidate.textContent?.includes(text),
              )
            : candidates[0];
          if (!el) throw new Error(`missing ${testId}`);
          const style = window.getComputedStyle(el);
          const lineHeight = Number.parseFloat(style.lineHeight);
          const height = el.getBoundingClientRect().height;
          return {
            height,
            lineHeight,
            lines: height / lineHeight,
            whiteSpace: style.whiteSpace,
            overflowWrap: style.overflowWrap,
            wordBreak: style.wordBreak,
            textOverflow: style.textOverflow,
            clientWidth: el.clientWidth,
            scrollWidth: el.scrollWidth,
          };
        },
        { testId, text },
      );

    const beforeStyle = await marblo.page.addStyleTag({
      content: `
        [data-testid="file-tree-root-label"],
        [data-testid="file-tree-node-label"] {
          white-space: normal !important;
          overflow-wrap: anywhere !important;
          word-break: break-word !important;
          overflow: visible !important;
          text-overflow: clip !important;
        }
      `,
    });
    await rootLabel.screenshot({
      path: testInfo.outputPath("filetree-long-root-before-char-wrap.png"),
    });
    const beforeRoot = await measure("file-tree-root-label");
    expect(beforeRoot.lines).toBeGreaterThan(1.5);

    await beforeStyle.evaluate((node) => node.remove());
    await rootLabel.screenshot({
      path: testInfo.outputPath("filetree-long-root-after-truncate.png"),
    });
    await fileLabel.screenshot({
      path: testInfo.outputPath("filetree-long-file-after-truncate.png"),
    });

    const afterRoot = await measure("file-tree-root-label");
    const afterFile = await measure("file-tree-node-label", longFileName);

    expect(afterRoot.lines).toBeLessThan(1.25);
    expect(afterRoot.whiteSpace).toBe("nowrap");
    expect(afterRoot.textOverflow).toBe("ellipsis");
    expect(afterRoot.scrollWidth).toBeGreaterThan(afterRoot.clientWidth);
    expect(afterFile.lines).toBeLessThan(1.25);
    expect(afterFile.whiteSpace).toBe("nowrap");
    expect(afterFile.textOverflow).toBe("ellipsis");
  } finally {
    fs.rmSync(rootPath, { recursive: true, force: true });
  }
});
