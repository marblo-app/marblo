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

test("@mocked Work History aggregate replay renders and generates a mission GIF", async ({
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
  await expect(
    page.getByRole("heading", { name: /에이전트별 기여|Cast/ }),
  ).toBeVisible();
  // 타임라인(raw ReplayTimeline)은 집계 쇼케이스에서 제거됨 — 완료 내역과 중복.
  await expect(page.getByText("티켓 ticket-hero")).toHaveCount(0);

  // ★기본 공유 경로는 미션 GIF 하나다 — 형식 탭(카드/링크)과 3단계 마법사는
  // 기본 화면에서 빠졌다(코드는 남아 있다).
  await expect(page.getByText("공유 형식")).toHaveCount(0);
  await expect(page.getByLabel("Mission Replay 공유 마법사")).toHaveCount(0);

  await page.screenshot({
    path: "test-results/mission-replay-redesign.png",
    fullPage: false,
  });

  // 집계 쇼케이스의 단일 진입점 → 미션 선택 화면.
  await page.getByTestId("work-history-open-mission-gif").click();
  await expect(page.getByTestId("mission-gif-panel")).toBeVisible();

  // missions 컬렉션이 비어 있어도 고를 게 하나는 있다(완료 작업 집계 fallback).
  const options = page.getByTestId("mission-gif-options");
  await expect(options).toBeVisible();
  await expect(options.getByRole("radio").first()).toHaveAttribute(
    "aria-checked",
    "true",
  );
  // 선택된 미션의 태스크 분해 미리보기.
  await expect(page.getByTestId("mission-gif-preview")).toContainText(
    /집계 공유 진입 배선|ReplayCast/,
  );
  // 등급(L1/L2/L3) 선택·비식별 미리보기는 이 플로우에 없다.
  await expect(page.getByText("검증 통과")).toHaveCount(0);

  // ★생성물 실제 검증: 버튼 클릭 → GIF 생성 → 다운로드 버튼(blob URL 연결).
  const generateBtn = page.getByTestId("mission-gif-generate");
  await expect(generateBtn).toBeEnabled({ timeout: 10_000 });
  await generateBtn.click();
  const downloadBtn = page.getByTestId("mission-gif-download");
  await expect(downloadBtn).toBeVisible({ timeout: 30_000 });
  await expect(downloadBtn).toBeEnabled();
  // 파일명은 gif.ts buildReplayMotionFileName("mission") 규약.
  await expect(downloadBtn).toContainText(/\.gif/i);
  await expect(page.getByTestId("mission-gif-error")).toHaveCount(0);

  // Cast: auto-loop 금지 — reveal-once 또는 hover-pan 만.
  const castTrack = page.locator("[data-cast-motion]");
  if ((await castTrack.count()) > 0) {
    const motion = await castTrack.first().getAttribute("data-cast-motion");
    expect(motion === "reveal-once" || motion === "hover-pan").toBeTruthy();
  }
});
