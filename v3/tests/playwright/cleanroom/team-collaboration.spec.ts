import { test, expect } from "@playwright/test";
import {
  launchCleanRoom,
  openWorkTab,
  passFirstRunModals,
  waitForAppShell,
} from "./helpers/cleanroom";

/**
 * Cleanroom half of the collaboration E2E.
 *
 * The service-level half uses two deterministic identities and a live
 * in-memory listener backend (see tests/integration/team-collaboration.test.ts).
 * This half proves that a project containing both identities can render the
 * shared board inside the existing userData/HOME-isolated Electron harness.
 */
test("@cleanroom @collaboration shared board is visible in an isolated session", async () => {
  const cleanRoom = await launchCleanRoom({ codex: "ready" });
  try {
    await passFirstRunModals(cleanRoom.page);
    await expect.poll(() => waitForAppShell(cleanRoom.page)).toBe(true);

    const paths = await cleanRoom.app.evaluate(({ app }) => ({
      userData: app.getPath("userData"),
      envHome: process.env.HOME,
    }));
    expect(paths.userData).toContain("marblo-cleanroom-");
    expect(paths.envHome).toContain("marblo-cleanroom-");

    await cleanRoom.page.evaluate(() => {
      const testWindow = window as unknown as {
        __marbloTest?: {
          stores: {
            project: {
              getState: () => {
                setCurrentProject: (project: unknown) => void;
              };
            };
            task: {
              setState: (state: unknown) => void;
            };
          };
        };
      };
      const hatch = testWindow.__marbloTest;
      if (!hatch) throw new Error("cleanroom test hatch is unavailable");

      hatch.stores.project.getState().setCurrentProject({
        id: "project-collaboration-e2e",
        name: "Shared E2E Project",
        ownerId: "user-owner",
        members: ["user-owner", "user-invitee"],
        folderPath: "/tmp/shared-e2e-project",
        enabledModels: ["claude"],
        createdAt: new Date(),
        updatedAt: new Date(),
      });
    });

    await openWorkTab(cleanRoom.page, "보드");

    // KanbanBoard subscribes on mount. Inject after that initial snapshot and
    // once more after the listener settles, matching the existing mock-board
    // harness pattern so an empty Firestore response cannot overwrite it.
    const injectSharedTask = async () => {
      await cleanRoom.page.evaluate(() => {
        const testWindow = window as unknown as {
          __marbloTest: {
            stores: {
              task: {
                setState: (state: unknown) => void;
              };
            };
          };
        };
        testWindow.__marbloTest.stores.task.setState({
          tasks: [
            {
              id: "shared-task",
              projectId: "project-collaboration-e2e",
              title: "Invitee can see this board task",
              description: "Shared project task",
              status: "TODO",
              dependsOn: [],
              dependsOnCompleted: true,
              priority: 1,
              role: "test",
              claimedBy: null,
              claimedAt: null,
              scope: [],
              comment: "",
              prUrl: "",
              hasPmFeedback: false,
              createdAt: new Date(),
              updatedAt: new Date(),
            },
          ],
          loading: false,
        });
      });
    };
    await injectSharedTask();
    await cleanRoom.page.waitForTimeout(600);
    await injectSharedTask();

    await expect(
      cleanRoom.page.getByText("Invitee can see this board task", {
        exact: true,
      }),
    ).toBeVisible();

    const members = await cleanRoom.page.evaluate(() => {
      const project = (
        window as unknown as {
          __marbloTest: {
            stores: {
              project: {
                getState: () => {
                  currentProject?: { members?: string[] };
                };
              };
            };
          };
        }
      ).__marbloTest.stores.project.getState().currentProject;
      return project?.members ?? [];
    });
    expect(members).toEqual(
      expect.arrayContaining(["user-owner", "user-invitee"]),
    );
  } finally {
    await cleanRoom.close();
  }
});
