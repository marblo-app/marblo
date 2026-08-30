/**
 * @vitest-environment jsdom
 *
 * AssistantTriggerSettingsPanel(렌더러) — 티켓 EzCYDCeMETcEyecPUfMI.
 *
 * 화면 단위로 고정하는 것:
 *  · 초기(빈) 상태: 엔진 꺼짐, 커넥터 전부 "연결 필요", 저장은 통과(fail-closed 저장 허용).
 *  · dev 프로젝트에서 엔진을 켜면 저장이 assistantProjectRequired 로 막힌다.
 *  · 웹훅을 발급 없이 켜면 저장이 webhookNotIssued 로 막히고, 발급 후 통과한다.
 *  · 잘못된 timezone 은 invalidTimezone 으로 막힌다.
 *  · 커넥터 조회 실패는 에러 문구로 드러난다(조용히 삼키지 않는다).
 *  · updateProject 실패는 saveFailed/에러 문구로 드러난다.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";

const storeMock = vi.hoisted(() => ({
  updateProject: vi.fn(async () => undefined),
}));
const webhookMock = vi.hoisted(() => ({
  provisionAssistantWebhook: vi.fn(async () => ({
    webhookId: "awh_1",
    url: "https://hooks.example/awh_1",
    secret: "sekrit",
    secretMasked: "se****",
    rotated: false,
  })),
}));

vi.mock("../../src/stores/projectStore", () => ({
  useProjectStore: vi.fn((selector: (state: unknown) => unknown) =>
    selector({ updateProject: storeMock.updateProject }),
  ),
}));
vi.mock("../../src/services/assistantWebhookService", () => ({
  provisionAssistantWebhook: webhookMock.provisionAssistantWebhook,
}));
vi.mock("../../src/components/harness/SlackChannelPanel", () => ({
  SlackChannelPanel: () => null,
}));
vi.mock("../../src/components/harness/TelegramChannelPanel", () => ({
  TelegramChannelPanel: () => null,
}));

import { AssistantTriggerSettingsPanel } from "../../src/components/agents/AssistantTriggerSettingsPanel";
import { useLocaleStore } from "../../src/lib/i18n";
import { ko } from "../../src/locales/ko";
import type { Project } from "../../src/types/project";

function installElectronStub(
  overrides: Partial<{
    scopes: string[];
    slack: { canEnable: boolean; active: boolean };
    telegram: { canEnable: boolean; active: boolean };
    driveError: Error;
  }> = {},
) {
  (
    globalThis as unknown as { window: { electronAPI: unknown } }
  ).window.electronAPI = {
    drive: {
      status: vi.fn(async () => {
        if (overrides.driveError) throw overrides.driveError;
        return { connected: true, scopes: overrides.scopes ?? [] };
      }),
    },
    slackChannel: {
      status: vi.fn(
        async () => overrides.slack ?? { canEnable: true, active: false },
      ),
    },
    telegramChannel: {
      status: vi.fn(
        async () => overrides.telegram ?? { canEnable: false, active: false },
      ),
    },
  };
}

function makeProject(overrides: Partial<Project> = {}): Project {
  return {
    id: "project-1",
    name: "비서",
    kind: "assistant",
    ...overrides,
  } as unknown as Project;
}

function renderPanel(project = makeProject()) {
  return render(createElement(AssistantTriggerSettingsPanel, { project }));
}

function checkboxByLabel(label: string): HTMLInputElement {
  const el = screen.getByText(label);
  const input = el.closest("label")?.querySelector("input[type=checkbox]");
  if (!input) throw new Error(`checkbox not found for ${label}`);
  return input as HTMLInputElement;
}

function saveButton(): HTMLButtonElement {
  return screen
    .getByText(ko["agents.triggers.save"])
    .closest("button") as HTMLButtonElement;
}

async function connectorsLoaded() {
  await waitFor(() => {
    expect(
      screen.getAllByText(ko["agents.triggers.connectorReady"]).length,
    ).toBeGreaterThan(0);
  });
}

beforeEach(() => {
  useLocaleStore.setState({ locale: "ko" });
  vi.clearAllMocks();
  storeMock.updateProject.mockResolvedValue(undefined);
  installElectronStub();
});

afterEach(() => {
  cleanup();
});

describe("빈 상태", () => {
  it("엔진이 꺼진 초기 상태는 저장이 통과한다(fail-closed 저장)", async () => {
    renderPanel();
    await connectorsLoaded();
    expect(checkboxByLabel(ko["agents.triggers.enableLabel"]).checked).toBe(
      false,
    );
    fireEvent.click(saveButton());
    await waitFor(() => {
      expect(screen.getByText(ko["agents.triggers.saved"])).toBeTruthy();
    });
    expect(storeMock.updateProject).toHaveBeenCalledWith(
      "project-1",
      expect.objectContaining({
        assistantTriggers: expect.objectContaining({ enabled: false }),
      }),
    );
  });

  it("회수된 Google 트리거 배지는 내려가고 Slack·Telegram 만 남는다", async () => {
    renderPanel();
    await connectorsLoaded();
    expect(screen.getByText("Slack")).toBeTruthy();
    expect(screen.getByText("Telegram")).toBeTruthy();
    expect(screen.queryByText("Calendar")).toBeNull();
    expect(screen.queryByText("Gmail")).toBeNull();
    expect(screen.queryByText("Sheets")).toBeNull();
  });

  it("커넥터 조회가 실패하면 에러를 보여준다 — 조용히 '연결 필요' 로 두지 않는다", async () => {
    installElectronStub({ driveError: new Error("drive status failed") });
    renderPanel();
    await waitFor(() => {
      expect(screen.getByText("drive status failed")).toBeTruthy();
    });
  });
});

describe("엔진 켜기 — 프로젝트 종류", () => {
  it("dev 프로젝트에서 엔진을 켜고 저장하면 assistantProjectRequired 로 막힌다", async () => {
    renderPanel(makeProject({ kind: "dev" }));
    await connectorsLoaded();
    fireEvent.click(checkboxByLabel(ko["agents.triggers.enableLabel"]));
    fireEvent.click(checkboxByLabel(ko["agents.triggers.schedule.enable"]));
    fireEvent.click(saveButton());
    await waitFor(() => {
      expect(
        screen.getByText(ko["agents.triggers.errors.assistantProjectRequired"]),
      ).toBeTruthy();
    });
    expect(storeMock.updateProject).not.toHaveBeenCalled();
  });

  it("엔진만 켜고 조건이 없으면 noTriggerEnabled 로 막힌다", async () => {
    renderPanel();
    await connectorsLoaded();
    fireEvent.click(checkboxByLabel(ko["agents.triggers.enableLabel"]));
    fireEvent.click(saveButton());
    await waitFor(() => {
      expect(
        screen.getAllByText(
          new RegExp(ko["agents.triggers.validation.noTriggerEnabled"]),
        ).length,
      ).toBeGreaterThan(0);
    });
    expect(storeMock.updateProject).not.toHaveBeenCalled();
  });
});

describe("스케줄 조건", () => {
  async function openScheduleAndEnable() {
    renderPanel();
    await connectorsLoaded();
    fireEvent.click(checkboxByLabel(ko["agents.triggers.enableLabel"]));
    fireEvent.click(checkboxByLabel(ko["agents.triggers.schedule.enable"]));
  }

  it("기본 cron·timezone(Asia/Seoul) 으로 저장이 통과한다", async () => {
    await openScheduleAndEnable();
    fireEvent.click(saveButton());
    await waitFor(() => {
      expect(screen.getByText(ko["agents.triggers.saved"])).toBeTruthy();
    });
    const [, patch] = storeMock.updateProject.mock.calls[0] as [
      string,
      { assistantTriggers: { schedule: { timezone: string } } },
    ];
    expect(patch.assistantTriggers.schedule.timezone).toBe("Asia/Seoul");
  });

  it("잘못된 timezone 은 저장을 막는다(켜지는데 안 도는 상태 방지)", async () => {
    await openScheduleAndEnable();
    const tzInput = screen.getByDisplayValue("Asia/Seoul");
    fireEvent.change(tzInput, { target: { value: "Seoul" } });
    fireEvent.click(saveButton());
    await waitFor(() => {
      expect(
        screen.getAllByText(
          new RegExp(
            ko["agents.triggers.validation.invalidTimezone"].slice(0, 20),
          ),
        ).length,
      ).toBeGreaterThan(0);
    });
    expect(storeMock.updateProject).not.toHaveBeenCalled();
  });

  it("잘못된 cron 은 저장을 막는다", async () => {
    await openScheduleAndEnable();
    fireEvent.change(screen.getByDisplayValue("0 9 * * 1-5"), {
      target: { value: "every day" },
    });
    fireEvent.click(saveButton());
    await waitFor(() => {
      expect(
        screen.getAllByText(
          new RegExp(ko["agents.triggers.validation.invalidCron"].slice(0, 12)),
        ).length,
      ).toBeGreaterThan(0);
    });
    expect(storeMock.updateProject).not.toHaveBeenCalled();
  });
});

describe("웹훅 조건", () => {
  async function openConditions() {
    renderPanel();
    await connectorsLoaded();
    fireEvent.click(checkboxByLabel(ko["agents.triggers.enableLabel"]));
    fireEvent.click(screen.getByText(ko["agents.triggers.tabs.conditions"]));
  }

  it("발급 없이 켜면 저장이 webhookNotIssued 로 막힌다", async () => {
    await openConditions();
    fireEvent.click(checkboxByLabel(ko["agents.triggers.webhook.enable"]));
    fireEvent.click(saveButton());
    await waitFor(() => {
      expect(
        screen.getAllByText(
          new RegExp(
            ko["agents.triggers.validation.webhookNotIssued"].slice(0, 16),
          ),
        ).length,
      ).toBeGreaterThan(0);
    });
    expect(storeMock.updateProject).not.toHaveBeenCalled();
  });

  it("URL 을 발급하면 통과하고, 발급된 webhookId 가 저장 페이로드에 실린다", async () => {
    await openConditions();
    fireEvent.click(checkboxByLabel(ko["agents.triggers.webhook.enable"]));
    fireEvent.click(screen.getByText(ko["agents.triggers.webhook.issue"]));
    await waitFor(() => {
      expect(
        screen.getByText(ko["agents.triggers.webhook.issued"]),
      ).toBeTruthy();
    });
    expect(webhookMock.provisionAssistantWebhook).toHaveBeenCalledWith(
      "project-1",
      false,
    );
    fireEvent.click(saveButton());
    await waitFor(() => {
      expect(screen.getByText(ko["agents.triggers.saved"])).toBeTruthy();
    });
    const [, patch] = storeMock.updateProject.mock.calls[0] as [
      string,
      {
        assistantTriggers: { webhook: { webhookId: string; enabled: boolean } };
      },
    ];
    expect(patch.assistantTriggers.webhook).toMatchObject({
      enabled: true,
      webhookId: "awh_1",
    });
  });

  it("발급이 실패하면 에러를 보여주고 저장은 여전히 막힌다", async () => {
    webhookMock.provisionAssistantWebhook.mockRejectedValueOnce(
      new Error("functions/unauthenticated"),
    );
    await openConditions();
    fireEvent.click(checkboxByLabel(ko["agents.triggers.webhook.enable"]));
    fireEvent.click(screen.getByText(ko["agents.triggers.webhook.issue"]));
    await waitFor(() => {
      expect(screen.getByText("functions/unauthenticated")).toBeTruthy();
    });
    fireEvent.click(saveButton());
    await waitFor(() => {
      expect(storeMock.updateProject).not.toHaveBeenCalled();
    });
  });

  it("이미 발급된 프로젝트는 켜고 저장할 수 있다(기존 사용자 회귀 없음)", async () => {
    renderPanel(
      makeProject({
        assistantTriggers: {
          enabled: true,
          outputs: ["slack"],
          webhook: {
            enabled: true,
            webhookId: "awh_old",
            url: "https://hooks.example/awh_old",
            pollMinutes: 1,
          },
        },
      }),
    );
    await connectorsLoaded();
    fireEvent.click(saveButton());
    await waitFor(() => {
      expect(screen.getByText(ko["agents.triggers.saved"])).toBeTruthy();
    });
  });
});

describe("회수된 Google 조건", () => {
  it("캘린더를 켜면 '연결 필요' 가 아니라 '회수' 문구로 막힌다", async () => {
    installElectronStub({
      scopes: ["https://www.googleapis.com/auth/calendar.readonly"],
    });
    renderPanel();
    await connectorsLoaded();
    fireEvent.click(checkboxByLabel(ko["agents.triggers.enableLabel"]));
    fireEvent.click(screen.getByText(ko["agents.triggers.tabs.conditions"]));
    fireEvent.click(checkboxByLabel(ko["agents.triggers.calendar.enable"]));
    fireEvent.click(saveButton());
    await waitFor(() => {
      expect(
        screen.getAllByText(
          new RegExp(
            ko["agents.triggers.validation.calendarTriggerWithheld"].slice(
              0,
              20,
            ),
          ),
        ).length,
      ).toBeGreaterThan(0);
    });
    expect(
      screen.queryByText(
        new RegExp(
          ko["agents.triggers.validation.calendarConnectorRequired"].slice(
            0,
            20,
          ),
        ),
      ),
    ).toBeNull();
    expect(storeMock.updateProject).not.toHaveBeenCalled();
  });
});

describe("저장 실패", () => {
  it("updateProject 가 던지면 에러 문구를 보여주고 버튼이 살아난다", async () => {
    storeMock.updateProject.mockRejectedValueOnce(new Error("offline"));
    renderPanel();
    await connectorsLoaded();
    fireEvent.click(saveButton());
    await waitFor(() => {
      expect(screen.getByText("offline")).toBeTruthy();
    });
    expect(saveButton().disabled).toBe(false);
  });
});
