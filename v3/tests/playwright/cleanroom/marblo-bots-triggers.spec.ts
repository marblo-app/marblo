import { test, expect, type Page } from "@playwright/test";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import {
  launchCleanRoom,
  passFirstRunModals,
  waitForAppShell,
  type CleanRoom,
} from "./helpers/cleanroom";

type ProjectKind = "assistant" | "dev";

async function setLocale(page: Page, locale: "ko" | "en"): Promise<void> {
  await page.evaluate((nextLocale) => {
    localStorage.setItem("marblo:locale", nextLocale);
  }, locale);
  await page.reload();
  await page.waitForLoadState("domcontentloaded");
  await waitForAppShell(page);
}

async function installProjectHarness(
  page: Page,
  kind: ProjectKind,
): Promise<void> {
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
      __marbloBotEditE2E?: {
        updates: Array<{ id: string; draft: Record<string, unknown> }>;
        removes: string[];
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
    win.__marbloBotEditE2E = { updates: [], removes: [] };
    const savedBots: Array<Record<string, unknown>> = [];
    const subscribers = new Set<(bots: unknown[]) => void>();
    const emit = () => {
      for (const callback of subscribers) callback([...savedBots]);
    };
    win.__marbloTest.botDefinitions = {
      create: async (draft: Record<string, unknown>) => {
        const id = `bot-definition-${savedBots.length + 1}`;
        savedBots.push({
          ...draft,
          id,
          createdAt: new Date(),
          updatedAt: new Date(),
        });
        emit();
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
        emit();
        return id;
      },
      update: async (id: string, draft: Record<string, unknown>) => {
        const index = savedBots.findIndex((bot) => bot.id === id);
        if (index < 0) throw new Error(`missing bot: ${id}`);
        win.__marbloBotEditE2E?.updates.push({ id, draft: { ...draft } });
        savedBots[index] = {
          ...savedBots[index],
          ...draft,
          id,
          updatedAt: new Date(),
        };
        emit();
      },
      remove: async (id: string) => {
        const index = savedBots.findIndex((bot) => bot.id === id);
        if (index < 0) throw new Error(`missing bot: ${id}`);
        win.__marbloBotEditE2E?.removes.push(id);
        savedBots.splice(index, 1);
        emit();
      },
      subscribe: (_projectId: string, callback: (bots: unknown[]) => void) => {
        subscribers.add(callback);
        callback([...savedBots]);
        return () => subscribers.delete(callback);
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
      folderPath: "/cleanroom/bot-trigger-project",
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

/** 사장님 실사용 상태 — 이 스펙은 읽기 전용 fingerprint로만 대조한다. */
const LIVE_STATE_PATHS = [
  path.join(os.homedir(), "Library", "Application Support", "marblo-v3"),
  path.join(os.homedir(), ".marblo", "app-state.json"),
];

function stateFingerprint(): Array<string | null> {
  return LIVE_STATE_PATHS.map((target) => {
    try {
      return String(fs.statSync(target).mtimeMs);
    } catch {
      return null;
    }
  });
}

async function assertCleanRoomIsolation(cr: CleanRoom): Promise<void> {
  const paths = await cr.app.evaluate(({ app }) => ({
    userData: app.getPath("userData"),
    envHome: process.env.HOME,
  }));
  expect(
    paths.userData,
    "Electron userData must be cleanroom-isolated",
  ).toContain("marblo-cleanroom-");
  expect(paths.userData).toContain("/userData");
  expect(paths.envHome, "Electron HOME must be cleanroom-isolated").toContain(
    "marblo-cleanroom-",
  );
  expect(paths.envHome).toContain("/home");
}

async function describeOverlays(page: Page): Promise<string> {
  const overlays = page.locator("div.fixed.inset-0");
  const descriptions: string[] = [];
  for (const overlay of await overlays.all()) {
    if (!(await overlay.isVisible().catch(() => false))) continue;
    descriptions.push(
      (await overlay.innerText().catch(() => "")).trim().slice(0, 300),
    );
  }
  return descriptions.length ? descriptions.join(" / ") : "없음";
}

/** 폐루프 E2E와 같은 방식으로 실패 마디·오버레이·스크린샷을 남긴다. */
async function segment<T>(
  name: string,
  cr: CleanRoom,
  body: () => Promise<T>,
): Promise<T> {
  try {
    return await body();
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    const overlays = await describeOverlays(cr.page);
    const shot = await cr.shot(`marblo-bots-edit-delete-${name.slice(0, 2)}`);
    throw new Error(
      `★마블로봇 수정·삭제 마디 [${name}] 에서 끊겼습니다:\n${detail}\n[오버레이] ${overlays}\n[스크린샷] ${shot}`,
    );
  }
}

/** 무료 플랜 안내는 이 스펙의 수정·삭제 동작과 무관하므로 닫고 진행한다. */
async function dismissUpgradeModal(page: Page): Promise<void> {
  const close = page
    .locator("div.fixed.inset-0")
    .getByRole("button", { name: "닫기", exact: true })
    .first();
  if (await close.isVisible().catch(() => false)) {
    await close.click();
    await page.waitForTimeout(300);
  }
}

async function readBotMutations(page: Page): Promise<{
  updates: Array<{ id: string; draft: Record<string, unknown> }>;
  removes: string[];
}> {
  return page.evaluate(() => {
    const hatch = (
      window as unknown as {
        __marbloBotEditE2E?: {
          updates: Array<{ id: string; draft: Record<string, unknown> }>;
          removes: string[];
        };
      }
    ).__marbloBotEditE2E;
    return hatch ?? { updates: [], removes: [] };
  });
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
    await installProjectHarness(cr.page, "assistant");
    await clickWorkTab(cr.page, "마블로봇");

    const sectionTabs = cr.page.getByRole("tablist", {
      name: "마블로봇 탭",
    });
    await expect(
      sectionTabs,
      "마블로봇 내부 3섹션 탭바가 안 보임",
    ).toBeVisible();
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

    await cr.page.getByRole("checkbox", { name: /트리거 엔진 사용/ }).uncheck();
    await cr.page.getByRole("button", { name: /^저장$/ }).click();
    await expect(
      cr.page.getByText("프로젝트 트리거 설정을 저장했습니다."),
      "트리거 설정 저장 성공 메시지가 안 보임",
    ).toBeVisible();
    await expect(
      cr.page.locator("body"),
      "permission-denied 가 화면에 노출됨",
    ).not.toContainText(
      /permission-denied|Missing or insufficient permissions/i,
    );

    const saves = await readTriggerSaves(cr.page);
    console.log(
      "[marblo-bots-e2e] trigger saves:",
      JSON.stringify(saves, null, 2),
    );
    expect(
      saves,
      "저장 버튼이 projectStore.updateProject 를 호출하지 않음",
    ).toHaveLength(1);
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

test("@cleanroom @marblo-bots saved bot edit preserves locked fields and delete copy reflects recoverability", async () => {
  test.setTimeout(120_000);
  const liveBefore = stateFingerprint();
  const cr = await launchCleanRoom({ codex: "ready" });
  try {
    await assertCleanRoomIsolation(cr);
    await passFirstRunModals(cr.page);
    await setLocale(cr.page, "ko");
    await installProjectHarness(cr.page, "assistant");
    await clickWorkTab(cr.page, "마블로봇");
    await dismissUpgradeModal(cr.page);

    const savedSection = cr.page
      .locator("section")
      .filter({ has: cr.page.getByRole("heading", { name: "저장된 봇" }) });
    const newBotSection = cr.page
      .locator("section")
      .filter({ has: cr.page.getByRole("heading", { name: "새 봇 저장" }) });

    await segment("M1 커스텀 봇 저장", cr, async () => {
      await newBotSection
        .getByLabel("이름", { exact: true })
        .fill("수정 전 봇");
      await newBotSection
        .getByLabel("Persona", { exact: true })
        .fill("수정 전 페르소나");
      await newBotSection
        .getByLabel("Mission", { exact: true })
        .fill("수정 전 미션");
      // 클린룸 프로젝트에는 실제 폴더가 없으므로 Knowledge root 검증을 통과하게
      // 끈다. 이 값은 수정 허용 필드이며, 잠김 필드 검증과 독립적이다.
      await newBotSection
        .getByLabel("Knowledge 사용", { exact: true })
        .uncheck();
      await newBotSection
        .getByRole("button", { name: "저장", exact: true })
        .click();
      await expect(
        savedSection.getByRole("heading", { name: "수정 전 봇", exact: true }),
        "새 봇 저장 뒤 저장된 봇 목록에 카드가 나타나야 함",
      ).toBeVisible();
    });

    const customCard = savedSection.locator("article").filter({
      has: cr.page.getByRole("heading", { name: "수정 전 봇", exact: true }),
    });
    await segment("M2 커스텀 봇 수정 및 목록 반영", cr, async () => {
      await customCard
        .getByRole("button", { name: "수정", exact: true })
        .click();
      await expect(cr.page.getByText("봇 수정", { exact: true })).toBeVisible();
      await expect(
        customCard.getByText(
          /프로젝트 귀속·소유자·도구 구성은 그대로 유지됩니다/,
        ),
        "수정 화면이 잠긴 범위를 사용자에게 고지해야 함",
      ).toBeVisible();
      await customCard.getByLabel("이름", { exact: true }).fill("수정 후 봇");
      await customCard
        .getByLabel("Persona", { exact: true })
        .fill("수정 후 페르소나");
      await customCard
        .getByRole("button", { name: "수정 저장", exact: true })
        .click();
      await expect(
        savedSection.getByRole("heading", { name: "수정 후 봇", exact: true }),
        "수정 저장 뒤 목록 이름이 새 값으로 갱신되어야 함",
      ).toBeVisible();
      await expect(savedSection).toContainText("수정 후 페르소나");
    });

    await segment("M3 커스텀 잠김 필드 보존", cr, async () => {
      const mutations = await readBotMutations(cr.page);
      const update = mutations.updates[0];
      expect(
        update,
        "수정 저장이 botDefinitions.update를 호출해야 함",
      ).toBeTruthy();
      expect(update.draft).toMatchObject({
        projectId: "cleanroom-bot-trigger-project",
        ownerId: "test-user-bypass",
        tools: ["wiki_query", "filesystem", "marblo_mcp"],
        name: "수정 후 봇",
        persona: "수정 후 페르소나",
      });
      expect(
        update.draft,
        "커스텀 봇에 seedId를 새로 만들면 안 됨",
      ).not.toHaveProperty("seedId");
    });

    await segment("M4 커스텀 삭제 경고와 제거", cr, async () => {
      const editedCustomCard = savedSection.locator("article").filter({
        has: cr.page.getByRole("heading", {
          name: "수정 후 봇",
          exact: true,
        }),
      });
      await editedCustomCard
        .getByRole("button", { name: "삭제", exact: true })
        .click();
      const dialog = cr.page.getByRole("alertdialog");
      await expect(
        dialog.getByText("「수정 후 봇」 봇을 삭제할까요?", { exact: true }),
      ).toBeVisible();
      await expect(dialog).toContainText("직접 만든 봇이라 되돌릴 수 없습니다");
      await dialog
        .getByRole("button", { name: "삭제합니다", exact: true })
        .click();
      await expect(
        savedSection.getByRole("heading", { name: "수정 후 봇", exact: true }),
        "삭제 확인 뒤 커스텀 봇이 저장 목록에서 사라져야 함",
      ).toHaveCount(0);
    });

    await segment("M5 시드 봇 잠김 seedId 및 삭제 복구 안내", cr, async () => {
      const seedCard = cr.page
        .locator("article")
        .filter({
          has: cr.page.getByRole("heading", { name: "지식 비서", exact: true }),
        })
        .first();
      await seedCard
        .getByRole("button", { name: "프로젝트에 저장", exact: true })
        .click();
      const seedSavedCard = savedSection.locator("article").filter({
        has: cr.page.getByRole("heading", { name: "지식 비서", exact: true }),
      });
      await expect(
        seedSavedCard.getByText("시드", { exact: true }),
      ).toBeVisible();
      await seedSavedCard
        .getByRole("button", { name: "수정", exact: true })
        .click();
      await seedSavedCard
        .getByLabel("이름", { exact: true })
        .fill("수정된 시드 지식 비서");
      await seedSavedCard
        .getByRole("button", { name: "수정 저장", exact: true })
        .click();

      const mutations = await readBotMutations(cr.page);
      const seedUpdate = mutations.updates[1];
      expect(seedUpdate, "시드 봇 수정도 update를 호출해야 함").toBeTruthy();
      expect(seedUpdate.draft).toMatchObject({
        projectId: "cleanroom-bot-trigger-project",
        ownerId: "test-user-bypass",
        seedId: "knowledge-assistant",
        tools: ["wiki_query"],
        name: "수정된 시드 지식 비서",
      });

      const editedSeedCard = savedSection.locator("article").filter({
        has: cr.page.getByRole("heading", {
          name: "수정된 시드 지식 비서",
          exact: true,
        }),
      });
      await editedSeedCard
        .getByRole("button", { name: "삭제", exact: true })
        .click();
      const dialog = cr.page.getByRole("alertdialog");
      await expect(dialog).toContainText("다시 담을 수 있습니다");
      await expect(dialog).not.toContainText(
        "직접 만든 봇이라 되돌릴 수 없습니다",
      );
      await dialog
        .getByRole("button", { name: "삭제합니다", exact: true })
        .click();
      await expect(
        savedSection.getByRole("heading", {
          name: "수정된 시드 지식 비서",
          exact: true,
        }),
        "삭제 확인 뒤 시드 봇도 저장된 목록에서는 사라져야 함",
      ).toHaveCount(0);
      expect((await readBotMutations(cr.page)).removes).toHaveLength(2);
    });
  } finally {
    await cr.close();
    expect(
      stateFingerprint(),
      "클린룸 실행이 사장님 라이브 상태 파일을 변경하면 안 됨",
    ).toEqual(liveBefore);
  }
});
