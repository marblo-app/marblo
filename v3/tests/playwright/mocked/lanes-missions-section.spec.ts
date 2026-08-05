import { expect } from "@playwright/test";
import type { Page } from "@playwright/test";
import { test } from "../helpers/fixtures";

test.use({ marbloOptions: { missionsInMem: true } });

type MissionsHatch = {
  reset(): void;
  seed(missions: Array<Record<string, unknown>>): void;
};

async function openMockLanes(page: Page) {
  const hasStore = await page
    .waitForFunction(
      () => {
        const tw = (
          window as unknown as {
            __marbloTest?: { stores: { project?: unknown } };
          }
        ).__marbloTest;
        return !!tw?.stores?.project;
      },
      null,
      { timeout: 3000 },
    )
    .then(() => true)
    .catch(() => false);

  if (!hasStore) {
    await page.evaluate(() => {
      localStorage.clear();
      localStorage.setItem("marblo:locale", "ko");
    });
    await page.reload({ waitUntil: "domcontentloaded" });
  }

  const later = page.getByRole("button", { name: /^나중에$/ }).first();
  if (
    await later
      .waitFor({ state: "visible", timeout: 5000 })
      .then(() => true)
      .catch(() => false)
  ) {
    await later.click();
  }

  await page.waitForFunction(
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
            pane?: {
              getState: () => {
                addPane: (kind: string) => string;
              };
            };
            splitWorkspace?: {
              getState: () => {
                setActiveTab: (tab: string) => void;
              };
            };
          };
        };
      }
    ).__marbloTest;
    if (!tw) throw new Error("__marbloTest hatch 가 노출되지 않음");
    tw.stores.project.getState().setCurrentProject({
      id: "test-mock-project",
      name: "Mock Project",
      ownerId: "test-user-bypass",
      members: ["test-user-bypass"],
      folderPath: "/tmp/marblo-test",
      enabledModels: ["claude"],
      createdAt: new Date(),
      updatedAt: new Date(),
    });
  });

  const lanesTab = page.getByRole("button", { name: /퀵레인|Quick Lanes/ }).first();
  if (
    await lanesTab
      .waitFor({ state: "visible", timeout: 5000 })
      .then(() => true)
      .catch(() => false)
  ) {
    await lanesTab.click({ force: true, timeout: 5000 }).catch(() => {});
  } else {
    await page.evaluate(() => {
      const tw = (
        window as unknown as {
          __marbloTest?: {
            stores: {
              pane?: {
                getState: () => {
                  addPane: (kind: string) => string;
                };
              };
              splitWorkspace?: {
                getState: () => {
                  setActiveTab: (tab: string) => void;
                };
              };
            };
          };
        }
      ).__marbloTest;
      tw?.stores.pane?.getState().addPane("lanes");
      tw?.stores.splitWorkspace?.getState().setActiveTab("lanes");
    });
  }

  await page.waitForFunction(
    () => {
      const tw = (
        window as unknown as { __marbloTest?: { missions?: unknown } }
      ).__marbloTest;
      return !!tw?.missions;
    },
    null,
    { timeout: 20000 },
  );
}

async function resetMissions(page: Page) {
  await page.evaluate(() => {
    const m = (
      window as unknown as { __marbloTest: { missions: MissionsHatch } }
    ).__marbloTest.missions;
    m.reset();
  });
}

async function seedMissions(page: Page, missions: Array<Record<string, unknown>>) {
  await page.evaluate((missions) => {
    const m = (
      window as unknown as { __marbloTest: { missions: MissionsHatch } }
    ).__marbloTest.missions;
    m.seed(missions);
  }, missions);
}

test.describe("Quick Lanes Missions section", () => {
  test("@mocked 미션 섹션 빈 상태와 projection 행을 렌더한다", async ({
    marblo,
  }, testInfo) => {
    await openMockLanes(marblo.page);
    await resetMissions(marblo.page);

    const section = marblo.page.getByTestId("lanes-missions-section");
    await expect(section).toBeVisible({ timeout: 8000 });
    await expect(
      section.getByText("아직 진행 중인 미션이 없습니다."),
    ).toBeVisible();
    await expect(
      section.getByRole("button", { name: "첫 미션 시작" }),
    ).toBeVisible();

    await marblo.page.screenshot({
      path: testInfo.outputPath("lanes-missions-empty.png"),
      fullPage: true,
    });

    const now = new Date();
    await seedMissions(marblo.page, [
      {
        id: "mission-projection-demo",
        projectId: "test-mock-project",
        goal: "퀵레인 하단 미션 통합 뷰",
        templateId: "feature",
        status: "active",
        ownerOrchestratorSessionId: "mock-orchestrator",
        steps: [
          { index: 0, type: "gstack", status: "success" },
          { index: 1, type: "dispatch", status: "success" },
          { index: 2, type: "wait", status: "running" },
        ],
        currentStepIndex: 2,
        taskIds: ["task-a", "task-b", "task-c"],
        contextLog: [],
        projection: {
          statusCounts: {
            IN_PROGRESS: 1,
            REVIEW: 1,
            DONE: 1,
          },
          lastTaskActivityAt: now,
        },
        launchedAt: now,
        lastActivityAt: now,
        completedAt: null,
      },
    ]);

    await expect(
      section.getByText("Feature: 퀵레인 하단 미션 통합 뷰"),
    ).toBeVisible({ timeout: 8000 });
    await expect(section.getByText("1/3 tasks")).toBeVisible();
    await expect(section.getByText("33%")).toBeVisible();
    await expect(section.getByText("task 3개")).toBeVisible();
    await expect(section.getByText("Orchestrator")).toBeVisible();
    await expect(section.getByText("IN_PROGRESS 1")).toBeVisible();
    await expect(section.getByText("REVIEW 1")).toBeVisible();
    await expect(section.getByText("DONE 1")).toBeVisible();

    await marblo.page.screenshot({
      path: testInfo.outputPath("lanes-missions-with-data.png"),
      fullPage: true,
    });

    await expect(
      section.getByRole("button", {
        name: /퀵레인 하단 미션 통합 뷰 미션 상세 열기/,
      }),
    ).toBeVisible();
  });
});
