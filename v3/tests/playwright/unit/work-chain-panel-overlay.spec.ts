import { afterAll, expect } from "@playwright/test";
import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { test } from "../helpers/fixtures";

const userDataDir = mkdtempSync(join(tmpdir(), "marblo-okebrain-"));

test.use({
  marbloOptions: {
    mock: true,
    args: [`--user-data-dir=${userDataDir}`],
  },
});

afterAll(() => rmSync(userDataDir, { recursive: true, force: true }));

test("@unit 오케브레인은 격리 프로필에서 티켓 상태를 그리고 터미널 위로만 펼쳐진다", async ({
  marblo,
}, testInfo) => {
  const { page } = marblo;
  // Session restore may still be replacing the initial project immediately
  // after launch; settle it before injecting the deterministic mock project.
  await page.waitForTimeout(1200);
  const languageDialog = page.getByRole("dialog", {
    name: "언어를 선택하세요",
  });
  try {
    await languageDialog.waitFor({ state: "visible", timeout: 5000 });
    await languageDialog.getByRole("button", { name: /한국어/ }).click();
    await languageDialog.getByRole("button", { name: "계속" }).click();
    await languageDialog.waitFor({ state: "hidden" });
  } catch {
    // Existing profiles already have a locale; no dialog is expected there.
  }
  await page.evaluate(() => {
    const harness = (
      window as unknown as {
        __marbloTest?: Record<string, unknown>;
      }
    ).__marbloTest;
    if (!harness) throw new Error("missing Playwright test hatch");
    (
      harness.stores as {
        beginnerMode: { setState: (value: { state: string }) => void };
      }
    ).beginnerMode.setState({ state: "advanced" });
    harness.workChain = {
      subscribe: (_projectId: string, callback: (value: unknown) => void) => {
        callback({
          kind: "data",
          snapshot: {
            projectId: "test-mock-project",
            exists: true,
            rev: 1,
            items: [
              {
                id: "work-chain-evidence",
                what: "근거 티켓 검증",
                why: "보드 상태를 확인합니다",
                taskIds: ["evidence-review"],
                afterTaskIds: [],
                afterItemIds: [],
                doneWhen: "done",
                createdAt: 1,
                updatedAt: 1,
                createdBy: "test",
              },
            ],
          },
        });
        return () => {};
      },
    };
  });

  await marblo.openMockOrchestrator();
  await page.evaluate(() => {
    const hatch = (
      window as unknown as {
        __marbloTest: {
          stores: { task: { setState: (value: unknown) => void } };
        };
      }
    ).__marbloTest;
    hatch.stores.task.setState({
      loading: false,
      tasks: [
        {
          id: "evidence-review",
          projectId: "test-mock-project",
          title: "실제 REVIEW 티켓",
          status: "REVIEW",
          role: "frontend",
          priority: 3,
          dependsOn: [],
          dependsOnCompleted: true,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ],
    });
  });

  await expect(page.getByTestId("work-chain-panel")).toBeVisible();
  await expect(page.getByTestId("work-chain-next")).toContainText(
    "근거 티켓 검증",
  );
  const terminal = page.locator(".xterm").first();
  const collapsedHeight = (await terminal.boundingBox())?.height;
  expect(collapsedHeight).toBeTruthy();
  await page.screenshot({
    path: testInfo.outputPath("work-chain-collapsed.png"),
  });

  await page.getByTestId("work-chain-toggle").click();
  await expect(page.getByTestId("work-chain-overlay")).toBeVisible();
  await expect(page.getByText("실제 REVIEW 티켓")).toBeVisible();
  await expect(
    page.getByText(/보드에 없는 티켓|Ticket missing from board/),
  ).toHaveCount(0);
  const expandedHeight = (await terminal.boundingBox())?.height;
  expect(expandedHeight).toBe(collapsedHeight);
  await page.screenshot({
    path: testInfo.outputPath("work-chain-expanded.png"),
  });
});
