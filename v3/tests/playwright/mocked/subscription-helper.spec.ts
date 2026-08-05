import { test, expect } from "../helpers/fixtures";
import type { Page, TestInfo } from "@playwright/test";
import * as fs from "fs";
import * as path from "path";

type CliModel = "claude" | "codex" | "grok" | "antigravity";

async function forceCliUnauthed(page: Page): Promise<void> {
  await page.evaluate(() => {
    const overrides: Record<CliModel, unknown> = {
      claude: {
        installed: true,
        authenticated: false,
        action: "claude login",
      },
      codex: {
        installed: true,
        authenticated: false,
        action: "codex login",
      },
      grok: {
        installed: false,
        authenticated: false,
        action: "grok auth login",
      },
      antigravity: {
        installed: false,
        authenticated: false,
        action: "antigravity login",
      },
    };
    localStorage.setItem(
      "marblo:test:cliAuthOverrides",
      JSON.stringify(overrides),
    );
  });
}

async function openStartHere(page: Page): Promise<void> {
  await page.evaluate(() => {
    localStorage.removeItem("marblo:test:projectAuditHarness");
  });
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.evaluate(() => {
    const tw = (
      window as unknown as {
        __marbloTest?: {
          stores: {
            splitWorkspace: {
              getState: () => {
                setActiveTab: (tab: "startHere") => void;
              };
            };
          };
        };
      }
    ).__marbloTest;
    if (!tw) throw new Error("__marbloTest hatch 가 노출되지 않음");
    tw.stores.splitWorkspace.getState().setActiveTab("startHere");
  });
  await expect(page.getByRole("heading", { name: "시작하기" })).toBeVisible();
}

async function screenshot(page: Page, testInfo: TestInfo, name: string) {
  const dir = path.join(testInfo.project.outputDir, "subscription-helper");
  fs.mkdirSync(dir, { recursive: true });
  const screenshotPath = path.join(dir, `${name}.png`);
  await page.screenshot({ path: screenshotPath, fullPage: true });
  await testInfo.attach(name, {
    path: screenshotPath,
    contentType: "image/png",
  });
}

test.describe("Onboarding subscription helper mocked rendering", () => {
  test("@mocked auth step shows official plan links and honest billing copy", async ({
    marblo,
  }, testInfo) => {
    await openStartHere(marblo.page);
    await screenshot(marblo.page, testInfo, "before-auth-step");

    await forceCliUnauthed(marblo.page);
    await marblo.page.getByRole("button", { name: "다시 확인" }).click();
    await marblo.page.getByTestId("start-here-step-auth").click();

    await expect(
      marblo.page.getByTestId("subscription-helper-claude"),
    ).toBeVisible();
    await expect(
      marblo.page.getByTestId("subscription-helper-codex"),
    ).toBeVisible();

    await expect(
      marblo.page.getByText("구독 없으신가요?").first(),
    ).toBeVisible();
    await expect(
      marblo.page.getByText(/per-token 깜짝 청구 없이/).first(),
    ).toBeVisible();
    await expect(
      marblo.page.getByText(/플랜 사용한도 내에서 안전하게/).first(),
    ).toBeVisible();
    await expect(
      marblo.page.getByText(/구독 로그인과 벤더 키 등록은 서로 보완/),
    ).toBeVisible();

    await expect(
      marblo.page.getByRole("link", {
        name: /Claude Pro\/Max 공식 페이지로 이동/,
      }),
    ).toHaveAttribute("href", "https://claude.com/pricing");
    await expect(
      marblo.page.getByRole("link", {
        name: /ChatGPT Plus\/Pro 공식 페이지로 이동/,
      }),
    ).toHaveAttribute("href", "https://chatgpt.com/pricing/");

    await expect(
      marblo.page.getByText(/무제한|추가요금 절대없음/),
      "과장된 비용 문구는 노출하면 안 됨",
    ).toHaveCount(0);

    await screenshot(marblo.page, testInfo, "after-auth-subscription-helper");
  });
});
