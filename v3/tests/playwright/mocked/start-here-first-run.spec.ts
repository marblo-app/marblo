import { test, expect } from "../helpers/fixtures";
import type { Page, TestInfo } from "@playwright/test";
import * as fs from "fs";
import * as path from "path";

type CliModel = "claude" | "codex" | "grok" | "antigravity";

async function forceCliMissing(page: Page): Promise<void> {
  await page.evaluate(() => {
    const harness = window.electronAPI.harness as unknown as {
      cliAuthCheck: (model: CliModel) => Promise<{
        installed: boolean;
        authenticated: boolean;
        action?: string;
      }>;
    };
    harness.cliAuthCheck = async (model: CliModel) => ({
      installed: false,
      authenticated: false,
      action:
        model === "codex"
          ? "codex login"
          : model === "grok"
            ? "grok auth login"
            : `${model} login`,
    });
  });
}

async function clearProject(page: Page): Promise<void> {
  await page.evaluate(() => {
    const tw = (
      window as unknown as {
        __marbloTest?: {
          stores: {
            project: {
              getState: () => {
                setCurrentProject: (p: unknown) => void;
              };
            };
          };
        };
      }
    ).__marbloTest;
    if (!tw) throw new Error("__marbloTest hatch 가 노출되지 않음");
    tw.stores.project.getState().setCurrentProject(null);
  });
}

async function screenshot(page: Page, testInfo: TestInfo, name: string) {
  const dir = path.join(testInfo.project.outputDir, "start-here-first-run");
  fs.mkdirSync(dir, { recursive: true });
  const screenshotPath = path.join(dir, `${name}.png`);
  await page.screenshot({ path: screenshotPath, fullPage: true });
  await testInfo.attach(name, {
    path: screenshotPath,
    contentType: "image/png",
  });
}

test.describe("StartHereTab first-run mocked rendering", () => {
  test("@mocked no project -> CLI missing -> auth/BYOM -> first ticket steps stay reachable", async ({
    marblo,
  }, testInfo) => {
    await marblo.openTab("startHere");
    await clearProject(marblo.page);
    await forceCliMissing(marblo.page);
    await marblo.page.getByRole("button", { name: "다시 확인" }).click();

    await expect(
      marblo.page.getByRole("heading", { name: "시작하기" }),
      "시작하기 탭 헤더가 보여야 함",
    ).toBeVisible();
    await expect(
      marblo.page.getByText(/4단계 중 \d단계 완료/),
      "진행률은 4단계 기준으로 보여야 함",
    ).toBeVisible();

    for (const step of ["install", "auth", "prd", "firstTicket"] as const) {
      await expect(
        marblo.page.getByTestId(`start-here-step-${step}`),
        `${step} 단계가 체크리스트에서 사라지면 안 됨`,
      ).toBeVisible();
    }

    await marblo.page.getByTestId("start-here-step-install").click();
    await expect(
      marblo.page.getByTestId("start-here-step-body-install"),
    ).toBeVisible();
    await expect(
      marblo.page.getByRole("button", { name: "설치" }).first(),
      "CLI 미설치 상태에서는 명확한 설치 CTA가 보여야 함",
    ).toBeVisible();
    await expect(
      marblo.page.getByText(/자동 설치가 실패하면/),
      "설치 단계의 막혔을 때 대안이 보여야 함",
    ).toBeVisible();
    await screenshot(marblo.page, testInfo, "start-here-install-missing");

    await marblo.page.getByTestId("start-here-step-auth").click();
    await expect(
      marblo.page.getByTestId("start-here-step-body-auth"),
      "인증 단계가 열려야 함",
    ).toBeVisible();
    await expect(
      marblo.page.getByTestId("start-here-byom-section"),
      "Claude/Codex 계정이 없어도 BYOM 경로가 노출되어야 함",
    ).toBeVisible();
    await expect(
      marblo.page.getByText("계정이 없나요? 벤더 키로 시작하기"),
    ).toBeVisible();
    await expect(
      marblo.page.getByText(/Claude Code 와 Codex 중 하나만 로그인하면 됩니다/),
      "인증 단계의 막혔을 때 안내가 보여야 함",
    ).toBeVisible();
    await screenshot(marblo.page, testInfo, "start-here-auth-byom");

    await marblo.page.getByTestId("start-here-step-prd").click();
    await expect(
      marblo.page.getByRole("button", { name: "폴더 연결하고 시작" }),
      "프로젝트 없음 상태에서는 저장소/폴더 연결 CTA가 보여야 함",
    ).toBeVisible();

    const firstTicketStep = marblo.page
      .locator('button:has-text("첫 티켓")')
      .first();
    await firstTicketStep.scrollIntoViewIfNeeded();
    await firstTicketStep.click();
    await expect(
      marblo.page.getByTestId("start-here-step-body-firstTicket"),
      "첫 티켓 단계가 열려야 함",
    ).toBeVisible();
    await expect(
      marblo.page.getByRole("button", {
        name: "이 PRD로 첫 티켓 만들기",
      }),
      "프로젝트 없음 상태에서도 첫 티켓 CTA는 보이되 막혀야 함",
    ).toBeDisabled();
    await expect(
      marblo.page.getByText("먼저 폴더를 연결해 주세요(③ 단계)."),
      "첫 티켓 단계는 프로젝트 연결 선행을 안내해야 함",
    ).toBeVisible();
    await screenshot(marblo.page, testInfo, "start-here-first-ticket");

    for (const pattern of [
      "Something went wrong",
      "에러가 발생",
      "crashed",
    ]) {
      await expect(
        marblo.page.locator(`text=/${pattern}/i`),
        `에러 패턴 "${pattern}" 가 보이면 안 됨`,
      ).toHaveCount(0);
    }
  });
});
