import { test, expect, type Page } from "@playwright/test";
import {
  launchCleanRoom,
  passFirstRunModals,
  waitForAppShell,
} from "./helpers/cleanroom";

type ProjectKind = "assistant" | "dev";

async function setLocale(page: Page, locale: "ko" | "en"): Promise<void> {
  await page.evaluate((nextLocale) => {
    localStorage.setItem("marblo:locale", nextLocale);
  }, locale);
  await page.reload();
  await page.waitForLoadState("domcontentloaded");
}

async function installProjectHarness(
  page: Page,
  kind: ProjectKind,
): Promise<void> {
  await waitForAppShell(page);
  await page.waitForFunction(
    () => {
      const hatch = (
        window as unknown as {
          __marbloTest?: { stores?: { project?: unknown } };
        }
      ).__marbloTest;
      return Boolean(hatch?.stores?.project);
    },
    null,
    { timeout: 15_000 },
  );

  await page.evaluate((projectKind) => {
    const win = window as unknown as {
      electronAPI?: {
        drive?: { status?: () => Promise<{ scopes: string[] }> };
        slackChannel?: {
          status?: (projectId: string) => Promise<Record<string, unknown>>;
        };
        telegramChannel?: {
          status?: (projectId: string) => Promise<Record<string, unknown>>;
        };
      };
      __marbloBotTriggerE2E?: {
        saves: Array<{ id: string; data: Record<string, unknown> }>;
      };
      __marbloTest: {
        stores: {
          agent: {
            setState: (partial: Record<string, unknown>) => void;
          };
          editor: {
            setState: (partial: Record<string, unknown>) => void;
          };
          project: {
            setState: (partial: Record<string, unknown>) => void;
            getState: () => { setCurrentProject: (project: unknown) => void };
          };
          splitWorkspace: {
            setState: (partial: Record<string, unknown>) => void;
          };
          task: {
            setState: (partial: Record<string, unknown>) => void;
          };
        };
        botDefinitions?: unknown;
      };
    };

    win.__marbloBotTriggerE2E = { saves: [] };
    const savedBots: Array<Record<string, unknown>> = [];
    win.__marbloTest.botDefinitions = {
      create: async (draft: Record<string, unknown>) => {
        const id = `bot-definition-${savedBots.length + 1}`;
        savedBots.push({
          ...draft,
          id,
          createdAt: new Date(),
          updatedAt: new Date(),
        });
        return id;
      },
      upsertSeed: async (draft: Record<string, unknown>) => {
        const id = `${draft.projectId}_${draft.seedId}`;
        const next = {
          ...draft,
          id,
          createdAt: new Date(),
          updatedAt: new Date(),
        };
        const index = savedBots.findIndex((bot) => bot.id === id);
        if (index >= 0) savedBots[index] = next;
        else savedBots.push(next);
        return id;
      },
      subscribe: (_projectId: string, callback: (bots: unknown[]) => void) => {
        callback([...savedBots]);
        return () => {};
      },
    };

    if (win.electronAPI?.drive) {
      win.electronAPI.drive.status = async () => ({ scopes: [] });
    }
    if (win.electronAPI?.slackChannel) {
      win.electronAPI.slackChannel.status = async () => ({
        active: true,
        canEnable: true,
      });
    }
    if (win.electronAPI?.telegramChannel) {
      win.electronAPI.telegramChannel.status = async () => ({
        active: false,
        canEnable: false,
      });
    }

    const project = {
      id: "cleanroom-bot-trigger-project",
      name: "Cleanroom Bot Trigger Project",
      ownerId: "test-user-bypass",
      members: ["test-user-bypass"],
      kind: projectKind,
      enabledModels: ["claude", "gpt"],
      assistantTriggers: {
        enabled: true,
        outputs: ["slack"],
        schedule: {
          enabled: true,
          cron: "0 9 * * 1-5",
          timezone: "Asia/Seoul",
        },
        calendar: { enabled: false, upcomingMinutes: 15, pollMinutes: 5 },
        gmail: {
          enabled: false,
          query: "in:inbox newer_than:1d",
          pollMinutes: 5,
        },
        webhook: { enabled: false, pollMinutes: 1 },
        sheets: {
          enabled: false,
          spreadsheetId: "",
          range: "A:Z",
          pollMinutes: 5,
        },
      },
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    win.__marbloTest.stores.editor.setState({ rootPath: "" });
    win.__marbloTest.stores.splitWorkspace.setState({ activeTab: "agents" });
    win.__marbloTest.stores.agent.setState({
      agents: [],
      loading: false,
      subscribeToAgents: () => () => {},
    });
    win.__marbloTest.stores.task.setState({
      tasks: [],
      loading: false,
      subscribeToTasks: () => () => {},
    });
    win.__marbloTest.stores.project.setState({
      subscribeToProjects: () => () => {},
      currentProject: project,
      projects: [project],
      subscribedUserId: "test-user-bypass",
      projectsHydrated: true,
      loading: false,
      updateProject: async (id: string, data: Record<string, unknown>) => {
        win.__marbloBotTriggerE2E?.saves.push({ id, data });
        if (String((data as { errorMode?: unknown }).errorMode) === "deny") {
          throw new Error("permission-denied");
        }
        win.__marbloTest.stores.project.setState({
          currentProject: { ...project, ...data },
          projects: [{ ...project, ...data }],
        });
      },
    });
    console.info("[marblo-bots-e2e] project harness installed", {
      kind: projectKind,
      hasFolderPath: Boolean((project as { folderPath?: string }).folderPath),
    });
  }, kind);
}

async function readTriggerSaves(
  page: Page,
): Promise<Array<{ id: string; data: Record<string, unknown> }>> {
  return page.evaluate(
    () =>
      (
        window as unknown as {
          __marbloBotTriggerE2E?: {
            saves: Array<{ id: string; data: Record<string, unknown> }>;
          };
        }
      ).__marbloBotTriggerE2E?.saves ?? [],
  );
}

async function clickWorkTab(page: Page, label: string): Promise<void> {
  const tab = page.locator(`button:has-text("${label}")`).first();
  await expect(tab, `워크스페이스 탭 "${label}" 이 안 보임`).toBeVisible({
    timeout: 10_000,
  });
  await tab.click();
  await page.waitForTimeout(300);
}

test("@cleanroom @marblo-bots bot tab sections and trigger save are isolated and non-vacuous", async () => {
  test.setTimeout(120_000);
  const cr = await launchCleanRoom({ codex: "ready" });
  try {
    const paths = await cr.app.evaluate(({ app }) => ({
      userData: app.getPath("userData"),
      envHome: process.env.HOME,
    }));
    console.log("[marblo-bots-e2e] isolated paths:", paths);
    expect(
      paths.userData,
      "Electron userData must be cleanroom-isolated",
    ).toContain("marblo-cleanroom-");
    expect(paths.userData).toContain("/userData");
    expect(paths.envHome, "Electron HOME must be cleanroom-isolated").toContain(
      "marblo-cleanroom-",
    );
    expect(paths.envHome).toContain("/home");

    await passFirstRunModals(cr.page);
    await setLocale(cr.page, "ko");
    await clickWorkTab(cr.page, "마블로봇");
    await installProjectHarness(cr.page, "assistant");

    const sectionTabs = cr.page.getByRole("tablist", {
      name: "마블로봇 탭",
    });
    await expect(sectionTabs, "마블로봇 내부 3섹션 탭바가 안 보임").toBeVisible();
    for (const section of ["봇 갤러리", "봇 실행 중", "트리거"]) {
      await expect(
        sectionTabs.getByRole("tab", { name: section, exact: true }),
        `마블로봇 섹션 "${section}" 이 안 보임`,
      ).toBeVisible();
    }

    await expect(
      cr.page.getByRole("heading", { name: "마블로봇", exact: true }),
      "봇 갤러리 헤더가 안 보임",
    ).toBeVisible();
    await expect(
      cr.page.getByText("지식 비서", { exact: true }).first(),
      "시드 봇 '지식 비서' 가 갤러리에 안 보임",
    ).toBeVisible();

    await sectionTabs.getByRole("tab", { name: "트리거", exact: true }).click();
    await expect(
      cr.page.getByRole("heading", { name: "스케줄·조건 트리거" }),
      "트리거 설정 패널이 안 보임",
    ).toBeVisible();
    await expect(
      cr.page.getByText(/kind === "assistant"/),
      "engineNotice 가 프로젝트 kind 판정을 보여주지 않음",
    ).toBeVisible();

    await cr.page
      .getByRole("checkbox", { name: /트리거 엔진 사용/ })
      .uncheck();
    await cr.page.getByRole("button", { name: /^저장$/ }).click();
    await expect(
      cr.page.getByText("프로젝트 트리거 설정을 저장했습니다."),
      "트리거 설정 저장 성공 메시지가 안 보임",
    ).toBeVisible();
    await expect(
      cr.page.locator("body"),
      "permission-denied 가 화면에 노출됨",
    ).not.toContainText(/permission-denied|Missing or insufficient permissions/i);

    const saves = await readTriggerSaves(cr.page);
    console.log(
      "[marblo-bots-e2e] trigger saves:",
      JSON.stringify(saves, null, 2),
    );
    expect(saves, "저장 버튼이 projectStore.updateProject 를 호출하지 않음")
      .toHaveLength(1);
    expect(saves[0]?.id).toBe("cleanroom-bot-trigger-project");
    expect(saves[0]?.data).toHaveProperty("assistantTriggers");
    expect(
      (saves[0]?.data.assistantTriggers as { enabled?: boolean } | undefined)
        ?.enabled,
    ).toBe(false);

    await cr.page.evaluate(() => {
      const win = window as unknown as {
        __marbloTest: {
          stores: {
            project: {
              setState: (partial: Record<string, unknown>) => void;
              getState: () => { currentProject: Record<string, unknown> };
            };
          };
        };
      };
      const current = win.__marbloTest.stores.project.getState().currentProject;
      const next = { ...current, kind: "dev" };
      win.__marbloTest.stores.project.setState({
        currentProject: next,
        projects: [next],
      });
    });
    await expect(
      cr.page.getByText(/실제 폴링은 돌지 않습니다/),
      "비서 프로젝트가 아닐 때 engineNotice 비활성 문구가 안 보임",
    ).toBeVisible();

    await setLocale(cr.page, "en");
    await installProjectHarness(cr.page, "assistant");
    await clickWorkTab(cr.page, "Marblo Bots");
    await expect(
      cr.page.getByRole("tablist", { name: "Marblo Bots tab" }),
      "English locale Marblo Bots tablist is missing",
    ).toBeVisible();
    await expect(
      cr.page.getByRole("tab", { name: "Bot gallery", exact: true }),
    ).toBeVisible();
    await expect(
      cr.page.getByRole("tab", { name: "Bot runs", exact: true }),
    ).toBeVisible();
    await expect(
      cr.page.getByRole("tab", { name: "Triggers", exact: true }),
    ).toBeVisible();
    const visibleText = await cr.page.locator("body").innerText();
    expect(
      visibleText,
      "English Marblo Bots surface should not expose Korean copy",
    ).not.toMatch(/[가-힣]/);
  } finally {
    await cr.close();
  }
});
