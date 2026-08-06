import { test, expect } from "../helpers/fixtures";

test.use({ marbloOptions: { mock: true } });

const adminAnalyticsData = {
  retention: {
    rangeDays: 30,
    generatedAt: "2026-08-06T00:00:00.000Z",
    adminExcluded: { applied: true, uidFiltered: true, clientIdCount: 1 },
    cohorts: {
      day: [
        {
          period: "day",
          cohort: "2026-08-04",
          cohortUsers: 10,
          returningUsers: { d1: 8, d7: 4, d14: 2, d30: 1 },
          rates: { d1: 0.8, d7: 0.4, d14: 0.2, d30: 0.1 },
        },
        {
          period: "day",
          cohort: "2026-08-03",
          cohortUsers: 5,
          returningUsers: { d1: 1, d7: 1, d14: 0, d30: 0 },
          rates: { d1: 0.2, d7: 0.2, d14: 0, d30: 0 },
        },
      ],
      week: [
        {
          period: "week",
          cohort: "2026-08-03",
          cohortUsers: 15,
          returningUsers: { d1: 9, d7: 5, d14: 2, d30: 1 },
          rates: { d1: 0.6, d7: 0.3333, d14: 0.1333, d30: 0.0667 },
        },
      ],
      note: "mock",
    },
    activationGate: {
      steps: [
        {
          key: "install",
          event: "app:installed",
          label: "설치",
          users: 100,
          dropFromPrev: null,
          dropRateFromPrev: null,
          isMaxDrop: false,
        },
        {
          key: "first_run",
          event: "app:first_run",
          label: "최초 실행",
          users: 80,
          dropFromPrev: 20,
          dropRateFromPrev: 0.2,
          isMaxDrop: false,
        },
        {
          key: "login",
          event: "auth:login_success",
          label: "로그인",
          users: 70,
          dropFromPrev: 10,
          dropRateFromPrev: 0.125,
          isMaxDrop: false,
        },
        {
          key: "folder_connected",
          event: "onboarding:folder_connected",
          label: "폴더 연결",
          users: 42,
          dropFromPrev: 28,
          dropRateFromPrev: 0.4,
          isMaxDrop: true,
        },
        {
          key: "orchestrator_opened",
          event: "onboarding:orchestrator_opened",
          label: "오케 오픈",
          users: 38,
          dropFromPrev: 4,
          dropRateFromPrev: 0.0952,
          isMaxDrop: false,
        },
        {
          key: "agent_spawned",
          event: "agent:spawned",
          label: "스폰",
          users: 30,
          dropFromPrev: 8,
          dropRateFromPrev: 0.2105,
          isMaxDrop: false,
        },
        {
          key: "first_ticket_complete",
          event: "task:completed",
          label: "첫 티켓 완료",
          users: 21,
          dropFromPrev: 9,
          dropRateFromPrev: 0.3,
          isMaxDrop: false,
        },
      ],
      maxDrop: {
        key: "folder_connected",
        event: "onboarding:folder_connected",
        label: "폴더 연결",
        users: 42,
        dropFromPrev: 28,
        dropRateFromPrev: 0.4,
        isMaxDrop: true,
      },
      note: "mock",
    },
  },
  activeUsers: {
    rangeDays: 30,
    generatedAt: "2026-08-06T00:00:00.000Z",
    adminExcluded: { applied: true, uidFiltered: true, clientIdCount: 1 },
    dau: 12,
    wau: 36,
    mau: 90,
    dauWauRatio: 0.3333,
    dauMauRatio: 0.1333,
    activeByDay: [
      { date: "2026-08-04", dau: 7, events: 20 },
      { date: "2026-08-05", dau: 9, events: 28 },
      { date: "2026-08-06", dau: 12, events: 35 },
    ],
    thirtyDayRetention: {
      current: {
        date: "2026-07-06",
        eligibleUsers: 20,
        retainedUsers: 6,
        retentionRate: 0.3,
      },
      trend: [
        {
          date: "2026-07-04",
          eligibleUsers: 12,
          retainedUsers: 2,
          retentionRate: 0.1667,
        },
        {
          date: "2026-07-05",
          eligibleUsers: 15,
          retainedUsers: 4,
          retentionRate: 0.2667,
        },
        {
          date: "2026-07-06",
          eligibleUsers: 20,
          retainedUsers: 6,
          retentionRate: 0.3,
        },
      ],
    },
    note: "mock",
  },
};

test("@mocked 어드민 분석: retention callable 응답으로 그리드·퍼널 렌더", async ({
  marblo,
}) => {
  const { page } = marblo;

  await page.evaluate((seed) => {
    localStorage.setItem("marblo:locale", "ko");
    localStorage.removeItem("marblo.firstRun.inProgress");
    localStorage.setItem(
      "marblo:test:adminAnalyticsData",
      JSON.stringify(seed)
    );
  }, adminAnalyticsData);
  await page.reload({ waitUntil: "domcontentloaded" });

  await marblo.openTab("settings");
  await page.getByRole("button", { name: "어드민 분석" }).click();

  const panel = page.getByTestId("admin-analytics-panel");
  await expect(panel).toBeVisible();

  await expect(page.getByTestId("admin-stickiness-tiles")).toContainText("DAU");
  await expect(page.getByTestId("admin-stickiness-tiles")).toContainText("12");
  await expect(page.getByTestId("admin-stickiness-tiles")).toContainText(
    "DAU/MAU"
  );
  await expect(page.getByTestId("admin-stickiness-tiles")).toContainText("13%");

  const grid = page.getByTestId("admin-retention-grid");
  await expect(grid).toContainText("2026-08-04");
  await expect(grid).toContainText("80%");
  await expect(grid).toContainText("40%");

  await page.getByRole("button", { name: "Week" }).click();
  await expect(grid).toContainText("2026-08-03");
  await expect(grid).toContainText("60%");
  await expect(grid).toContainText("33%");

  const funnel = page.getByTestId("admin-activation-funnel");
  await expect(funnel).toContainText("최대 이탈: 폴더 연결 40%");
  await expect(funnel).toContainText("설치");
  await expect(funnel).toContainText("첫 티켓 완료");

  await expect(page.getByTestId("admin-thirty-day-retention")).toContainText(
    "30%"
  );

  await page.screenshot({
    path: "test-results/admin-analytics-mocked.png",
    fullPage: true,
  });
});
