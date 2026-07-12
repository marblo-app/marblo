import { expect } from "@playwright/test";
import { test } from "../helpers/fixtures";

test("@unit 오케스트레이터 모델 셀렉터가 전환 확인 시트를 렌더한다", async ({
  marblo,
}) => {
  await marblo.openMockOrchestrator();

  const selector = marblo.page
    .locator('select[title="Switch orchestrator model"]')
    .first();
  await expect(selector).toBeVisible({ timeout: 5000 });
  await selector.selectOption("codex");

  await expect(
    marblo.page.locator("text=/Switch orchestrator to Codex/"),
  ).toBeVisible({ timeout: 3000 });
  await expect(
    marblo.page.locator('button:has-text("Switch and wait")'),
  ).toBeVisible();
  await expect(
    marblo.page.locator('button:has-text("Take over now")'),
  ).toBeVisible();
  await expect(marblo.page.locator('button:has-text("Cancel")')).toBeVisible();
});
