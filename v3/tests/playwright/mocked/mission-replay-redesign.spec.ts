import { test, expect } from "../helpers/fixtures";

test.use({ marbloOptions: { mock: true } });

/**
 * Seed DONE tasks into taskStore. WorkHistoryTab's Firestore subscribe may
 * briefly overwrite with [] — callers re-seed until the aggregate showcase
 * appears (same pattern as other store-injected mocked specs).
 */
async function seedAggregateTasks(
  page: import("@playwright/test").Page,
): Promise<void> {
  await page.evaluate(() => {
    type TestWindow = Window & {
      __marbloTest?: {
        stores: {
          task: {
            setState: (patch: Record<string, unknown>) => void;
          };
        };
      };
    };
    const hatch = (window as TestWindow).__marbloTest;
    if (!hatch) throw new Error("__marbloTest hatch is unavailable");
    const now = Date.now();
    const taskBase = {
      projectId: "mock-replay-project",
      contextId: null,
      description: "",
      status: "DONE",
      priority: 3,
      dependsOn: [],
      dependsOnCompleted: true,
      scope: [],
      comment: "",
      prUrl: "",
      hasPmFeedback: false,
      // Relative to "now" so the default 30d filter always includes them
      // regardless of wall-clock when the suite runs.
      createdAt: new Date(now - 2 * 60 * 60 * 1000),
      claimedAt: new Date(now - 90 * 60 * 1000),
      updatedAt: new Date(now - 30 * 60 * 1000),
    };
    hatch.stores.task.setState({
      loading: false,
      tasks: [
        {
          ...taskBase,
          id: "ticket-hero",
          title: "집계 공유 진입 배선",
          role: "frontend",
          claimedBy: "agent-frontend",
        },
        {
          ...taskBase,
          id: "ticket-cast",
          title: "ReplayCast 시각 스트립",
          role: "frontend",
          claimedBy: "agent-ui",
          updatedAt: new Date(now - 10 * 60 * 1000),
        },
      ],
    });
  });
}

test("@mocked Work History aggregate replay renders and opens share flow", async ({
  marblo,
}) => {
  const { page } = marblo;

  await page.evaluate(() => {
    type TestWindow = Window & {
      __marbloTest?: {
        stores: {
          project: {
            setState: (patch: Record<string, unknown>) => void;
          };
          task: {
            setState: (patch: Record<string, unknown>) => void;
          };
        };
      };
    };
    const hatch = (window as TestWindow).__marbloTest;
    if (!hatch) throw new Error("__marbloTest hatch is unavailable");

    const project = {
      id: "mock-replay-project",
      name: "Replay Mock Project",
      ownerId: "test-user-bypass",
      members: ["test-user-bypass"],
      enabledModels: ["claude", "gpt"],
      createdAt: new Date("2026-08-01T09:00:00Z"),
      updatedAt: new Date("2026-08-01T12:00:00Z"),
    };
    hatch.stores.project.setState({
      currentProject: project,
      projects: [project],
      projectsHydrated: true,
      loading: false,
    });
  });

  const workspaceHistoryTab = page.getByRole("tab", { name: "완료 이력" });
  if ((await workspaceHistoryTab.count()) > 0) {
    await workspaceHistoryTab.scrollIntoViewIfNeeded();
    await workspaceHistoryTab.click();
  } else {
    await page
      .getByRole("button", { name: /History|완료/ })
      .first()
      .click({ timeout: 5_000 });
  }

  // Subscribe may clear injected tasks — re-seed until aggregate UI mounts.
  await expect(async () => {
    await seedAggregateTasks(page);
    await expect(page.getByTestId("work-history-replay-showcase")).toBeVisible({
      timeout: 2_000,
    });
  }).toPass({ timeout: 20_000 });

  await expect(page.getByTestId("replay-accomplishment-hero")).toContainText(
    /2개 작업|2 tasks|2/,
  );
  await expect(page.getByText("공유 형식")).toBeVisible();
  await expect(
    page.getByRole("button", { name: /카드 PNG|Card PNG|성과 카드/ }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: /GIF/ }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: /링크|Link/ }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: /에이전트별 기여|Cast/ }),
  ).toBeVisible();
  // 타임라인(raw ReplayTimeline)은 집계 쇼케이스에서 제거됨 — 완료 내역과 중복.
  await expect(page.getByText("티켓 ticket-hero")).toHaveCount(0);

  await page.screenshot({
    path: "test-results/mission-replay-redesign.png",
    fullPage: false,
  });

  // 공유 형식 버튼이 포맷을 실어 마법사를 연다(생성 단계로 직행).
  await page
    .getByRole("button", { name: /카드 PNG|Card PNG|성과 카드/ })
    .click();
  await expect(page.getByLabel("Mission Replay 공유 마법사")).toBeVisible();
  await expect(page.getByText("2. 생성")).toBeVisible();

  // ★생성물 실제 검증: 버튼 클릭 → PNG 생성 → step3 다운로드 UI.
  // (과거 회귀는 마법사 오픈만 보고 통과 — getMissionPublication hang 시
  //  생성 버튼 dead 를 놓쳤다.)
  const generateBtn = page.getByTestId("replay-share-generate");
  await expect(generateBtn).toBeVisible();
  await expect(generateBtn).toBeEnabled({ timeout: 10_000 });
  await expect(page.getByTestId("replay-share-asset-hint")).toBeVisible();
  // 검증 통과 배지(RedactionPreview) — 집계 lightweight 는 L2 verified=true.
  await expect(page.getByText("검증 통과")).toBeVisible();

  await generateBtn.click();
  // step 3: 채널 선택 + 다운로드 버튼(실제 생성물 blob URL 연결)
  await expect(page.getByText("3. 채널 선택")).toBeVisible({ timeout: 15_000 });
  const downloadBtn = page.getByRole("button", { name: /다운로드/ });
  await expect(downloadBtn).toBeVisible();
  await expect(downloadBtn).toBeEnabled();
  // 파일명에 goal/Replay 힌트가 들어간다(card.ts buildReplayCardFileName).
  await expect(downloadBtn).toContainText(/\.png|Replay|mission|완료|작업/i);

  // Cast: auto-loop 금지 — reveal-once 또는 hover-pan 만.
  const castTrack = page.locator("[data-cast-motion]");
  if ((await castTrack.count()) > 0) {
    const motion = await castTrack.first().getAttribute("data-cast-motion");
    expect(motion === "reveal-once" || motion === "hover-pan").toBeTruthy();
  }
});
