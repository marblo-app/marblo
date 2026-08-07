import { test, expect } from "../helpers/fixtures";

test.use({ marbloOptions: { mock: true } });

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
      .getByRole("button", { name: /History/ })
      .first()
      .click({ timeout: 5_000 });
  }

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
      createdAt: new Date("2026-08-01T09:05:00Z"),
      claimedAt: new Date("2026-08-01T09:10:00Z"),
      updatedAt: new Date("2026-08-01T10:00:00Z"),
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
          updatedAt: new Date("2026-08-01T10:20:00Z"),
        },
      ],
    });
  });

  await expect(page.getByTestId("work-history-replay-showcase")).toBeVisible();
  await expect(page.getByTestId("replay-accomplishment-hero")).toContainText(
    "당신의 AI 팀이 2개 작업을 완수했습니다.",
  );
  await expect(page.getByText("공유 형식")).toBeVisible();
  await expect(
    page.getByRole("button", { name: /카드 PNG 성과 카드/ }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: /GIF Replay 비트/ }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: /링크 레닭션된 공개/ }),
  ).toBeVisible();
  await expect(page.getByText("에이전트별 기여")).toBeVisible();
  // 타임라인(raw ReplayTimeline)은 집계 쇼케이스에서 제거됨 — 완료 내역과 중복.
  await expect(page.getByText("티켓 ticket-hero")).toHaveCount(0);

  await page.screenshot({
    path: "test-results/mission-replay-redesign.png",
    fullPage: false,
  });

  // 공유 형식 버튼이 포맷을 실어 마법사를 연다(생성 단계로 직행).
  await page.getByRole("button", { name: /카드 PNG 성과 카드/ }).click();
  await expect(page.getByLabel("Mission Replay 공유 마법사")).toBeVisible();
  await expect(page.getByText("2. 생성")).toBeVisible();
  await expect(
    page.getByRole("button", { name: /이미지 카드 생성/ }),
  ).toBeVisible();
});
