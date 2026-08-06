import { expect, test } from "../helpers/fixtures";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";

test("@mocked Markdown Edit 뷰에서 수정 저장 후 Preview 에 반영된다", async ({
  marblo,
}) => {
  const rootPath = fs.mkdtempSync(path.join(os.tmpdir(), "marblo-md-edit-"));
  const relativePath = "docs/editable.md";
  const absolutePath = path.join(rootPath, relativePath);
  fs.mkdirSync(path.dirname(absolutePath), { recursive: true });
  fs.writeFileSync(absolutePath, "# Before\n\nOriginal body\n", "utf8");

  await marblo.openTab("code");
  await marblo.page.waitForFunction(
    () => {
      const tw = (
        window as unknown as {
          __marbloTest?: { stores?: { editor?: unknown } };
        }
      ).__marbloTest;
      return !!tw?.stores?.editor;
    },
    null,
    { timeout: 5000 },
  );

  await marblo.page.evaluate(
    ({ rootPath, absolutePath }) => {
      const tw = (
        window as unknown as {
          __marbloTest?: {
            stores: {
              editor: {
                setState: (s: Record<string, unknown>) => void;
              };
            };
          };
        }
      ).__marbloTest;
      if (!tw) throw new Error("__marbloTest hatch 가 노출되지 않음");
      tw.stores.editor.setState({
        rootPath,
        activeFilePath: absolutePath,
        showDiff: false,
        saveError: null,
        openFiles: [
          {
            path: absolutePath,
            name: "editable.md",
            content: "# Before\n\nOriginal body\n",
            originalContent: "# Before\n\nOriginal body\n",
            language: "markdown",
            isModified: false,
          },
        ],
      });
    },
    { rootPath, absolutePath },
  );

  await expect(marblo.page.getByText("Before")).toBeVisible();
  const editButton = marblo.page.getByRole("button", {
    name: "Edit",
    exact: true,
  });
  await expect(editButton).toBeVisible();
  await expect(marblo.page.getByRole("button", { name: "Raw" })).toHaveCount(0);

  const surveyClose = marblo.page.getByRole("button", { name: "설문 닫기" });
  if (await surveyClose.isVisible().catch(() => false)) {
    await surveyClose.click();
  }

  await editButton.click();
  await expect(marblo.page.locator(".monaco-editor")).toBeVisible({
    timeout: 10000,
  });

  await marblo.page
    .locator(".monaco-editor")
    .click({ position: { x: 80, y: 40 } });
  await marblo.page.keyboard.press("ControlOrMeta+A");
  await marblo.page.keyboard.type("# After\n\nEdited body\n");
  await marblo.page.keyboard.press("ControlOrMeta+S");

  await expect
    .poll(() => fs.readFileSync(absolutePath, "utf8"), {
      timeout: 10000,
      message: "Markdown edit was not saved to disk",
    })
    .toBe("# After\n\nEdited body\n");

  await marblo.page.getByRole("button", { name: "Preview" }).click();
  await expect(
    marblo.page.getByRole("heading", { name: "After" }),
  ).toBeVisible();
  await expect(marblo.page.getByText("Edited body")).toBeVisible();
  await marblo.page.screenshot({
    path: "test-results/playwright/markdown-edit-preview.png",
    fullPage: true,
  });
});
