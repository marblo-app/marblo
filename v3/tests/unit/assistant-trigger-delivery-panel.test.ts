/**
 * @vitest-environment jsdom
 *
 * 티켓 lcR4OMWCriWIpwbVDwVt — 실패 사유가 **화면 상태로** 이어지는지.
 *
 * 여기서 고정하는 것은 "메인이 사유 X 를 보내면 패널이 X 의 문구와 X 가 요구하는
 * 행동을 그린다" 는 동작이다. 문구 자체는 로케일 테이블에서 읽어와 비교하므로
 * 카피를 다듬어도 안 깨지고, **사유가 뭉개지면(예: 전부 '전달 실패' 한 줄로)
 * 깨진다** — 그게 이 티켓의 결함이다.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import type { AssistantTriggerDeliveryFailure } from "../../electron/assistant-trigger-delivery";

const storeMock = vi.hoisted(() => ({
  updateProject: vi.fn(async () => undefined),
}));

vi.mock("../../src/stores/projectStore", () => ({
  useProjectStore: vi.fn((selector: (state: unknown) => unknown) =>
    selector({ updateProject: storeMock.updateProject }),
  ),
}));
vi.mock("../../src/services/assistantWebhookService", () => ({
  provisionAssistantWebhook: vi.fn(),
}));
vi.mock("../../src/components/harness/SlackChannelPanel", () => ({
  SlackChannelPanel: () => null,
}));
vi.mock("../../src/components/harness/TelegramChannelPanel", () => ({
  TelegramChannelPanel: () => null,
}));

import { AssistantTriggerSettingsPanel } from "../../src/components/agents/AssistantTriggerSettingsPanel";
import { useLocaleStore } from "../../src/lib/i18n";
import { en } from "../../src/locales/en";
import { ko } from "../../src/locales/ko";
import type { Project } from "../../src/types/project";

interface TriggerStub {
  emitFailure: (failure: AssistantTriggerDeliveryFailure) => void;
  emitRecovered: (projectId: string) => void;
  offFailureCalls: () => number;
}

function failure(
  over: Partial<AssistantTriggerDeliveryFailure> = {},
): AssistantTriggerDeliveryFailure {
  return {
    projectId: "project-1",
    projectName: "비서",
    reason: "composer-busy",
    trigger: "schedule",
    firstAt: Date.UTC(2026, 8, 2, 0, 0, 0),
    lastAt: Date.UTC(2026, 8, 2, 0, 5, 0),
    count: 3,
    ...over,
  };
}

function installElectronStub(initial: AssistantTriggerDeliveryFailure[] = []) {
  const failureListeners: Array<(f: AssistantTriggerDeliveryFailure) => void> =
    [];
  const recoveredListeners: Array<(projectId: string) => void> = [];
  let offFailure = 0;
  (
    globalThis as unknown as { window: { electronAPI: unknown } }
  ).window.electronAPI = {
    drive: { status: vi.fn(async () => ({ connected: true, scopes: [] })) },
    slackChannel: {
      status: vi.fn(async () => ({ canEnable: true, active: false })),
    },
    telegramChannel: {
      status: vi.fn(async () => ({ canEnable: false, active: false })),
    },
    assistantTriggers: {
      deliveryFailures: vi.fn(async () => initial),
      onDeliveryFailure: (cb: (f: AssistantTriggerDeliveryFailure) => void) => {
        failureListeners.push(cb);
        return () => {
          offFailure += 1;
        };
      },
      onDeliveryRecovered: (cb: (projectId: string) => void) => {
        recoveredListeners.push(cb);
        return () => undefined;
      },
    },
  };
  const stub: TriggerStub = {
    emitFailure: (f) => failureListeners.forEach((cb) => cb(f)),
    emitRecovered: (id) => recoveredListeners.forEach((cb) => cb(id)),
    offFailureCalls: () => offFailure,
  };
  return stub;
}

function makeProject(overrides: Partial<Project> = {}): Project {
  return {
    id: "project-1",
    name: "비서",
    kind: "assistant",
    folderPath: "/tmp/project-1",
    ...overrides,
  } as unknown as Project;
}

function renderPanel(project = makeProject()) {
  return render(createElement(AssistantTriggerSettingsPanel, { project }));
}

beforeEach(() => {
  useLocaleStore.setState({ locale: "ko" });
  vi.clearAllMocks();
});

afterEach(() => {
  cleanup();
});

describe("발화 실패가 화면에 뜬다", () => {
  it("패널을 열면 메인이 들고 있던 실패를 그대로 그린다 — 발화 순간을 놓쳐도 보인다", async () => {
    installElectronStub([failure()]);
    renderPanel();

    await waitFor(() => {
      expect(
        screen.getByTestId("assistant-trigger-delivery-failure"),
      ).toBeTruthy();
    });
    expect(screen.getByText(ko["agents.triggers.delivery.title"])).toBeTruthy();
  });

  it("발화 시점에 이 화면을 보고 있으면 실시간으로 뜬다", async () => {
    const stub = installElectronStub([]);
    renderPanel();
    await waitFor(() => {
      expect(
        (
          window.electronAPI as unknown as {
            assistantTriggers: { deliveryFailures: { mock: unknown } };
          }
        ).assistantTriggers.deliveryFailures,
      ).toHaveBeenCalled();
    });
    expect(
      screen.queryByTestId("assistant-trigger-delivery-failure"),
    ).toBeNull();

    stub.emitFailure(failure({ reason: "orchestrator-offline" }));

    await waitFor(() => {
      expect(
        screen.getByText(
          ko["agents.triggers.delivery.reason.orchestratorOffline"],
        ),
      ).toBeTruthy();
    });
  });

  // ★이 티켓의 핵심. 사유마다 **다른 행동**이 화면에 적혀야 한다.
  const cases: Array<
    [
      AssistantTriggerDeliveryFailure["reason"],
      keyof typeof ko,
      keyof typeof ko,
    ]
  > = [
    [
      "orchestrator-offline",
      "agents.triggers.delivery.reason.orchestratorOffline",
      "agents.triggers.delivery.action.orchestratorOffline",
    ],
    [
      "orchestrator-folder-missing",
      "agents.triggers.delivery.reason.orchestratorFolderMissing",
      "agents.triggers.delivery.action.orchestratorFolderMissing",
    ],
    [
      "orchestrator-auth-blocked",
      "agents.triggers.delivery.reason.orchestratorAuthBlocked",
      "agents.triggers.delivery.action.orchestratorAuthBlocked",
    ],
    [
      "orchestrator-mcp-blocked",
      "agents.triggers.delivery.reason.orchestratorMcpBlocked",
      "agents.triggers.delivery.action.orchestratorMcpBlocked",
    ],
    [
      "orchestrator-vendor-blocked",
      "agents.triggers.delivery.reason.orchestratorVendorBlocked",
      "agents.triggers.delivery.action.orchestratorVendorBlocked",
    ],
    [
      "composer-busy",
      "agents.triggers.delivery.reason.composerBusy",
      "agents.triggers.delivery.action.composerBusy",
    ],
    [
      "delivery-failed",
      "agents.triggers.delivery.reason.deliveryFailed",
      "agents.triggers.delivery.action.deliveryFailed",
    ],
  ];

  for (const [reason, reasonKey, actionKey] of cases) {
    it(`사유 ${reason} 은 자기 문구와 자기 행동을 낸다`, async () => {
      installElectronStub([failure({ reason })]);
      renderPanel();

      await waitFor(() => {
        expect(screen.getByText(ko[reasonKey])).toBeTruthy();
      });
      // 무엇을 하면 되는지가 반드시 함께 있어야 한다.
      expect(screen.getByText(ko[actionKey])).toBeTruthy();
      // 다른 사유의 문구는 절대 같이 뜨지 않는다(사유가 뭉치면 여기서 깨진다).
      for (const [other, otherReasonKey] of cases) {
        if (other === reason) continue;
        expect(screen.queryByText(ko[otherReasonKey])).toBeNull();
      }
    });
  }

  it("영어 로케일에서도 같은 사유가 영어로 채워져 있다", async () => {
    useLocaleStore.setState({ locale: "en" });
    installElectronStub([failure({ reason: "orchestrator-vendor-blocked" })]);
    renderPanel();

    await waitFor(() => {
      expect(
        screen.getByText(
          en["agents.triggers.delivery.reason.orchestratorVendorBlocked"],
        ),
      ).toBeTruthy();
    });
    expect(
      screen.getByText(
        en["agents.triggers.delivery.action.orchestratorVendorBlocked"],
      ),
    ).toBeTruthy();
  });

  it("놓친 발화가 자동 재시도되지 않는다는 사실을 숨기지 않는다", async () => {
    installElectronStub([failure()]);
    renderPanel();

    await waitFor(() => {
      expect(
        screen.getByText(ko["agents.triggers.delivery.retryNote"]),
      ).toBeTruthy();
    });
  });

  it("어떤 트리거가 몇 번 죽었는지도 함께 보여준다", async () => {
    installElectronStub([failure({ trigger: "webhook", count: 7 })]);
    renderPanel();

    await waitFor(() => {
      expect(
        screen.getByTestId("assistant-trigger-delivery-failure").textContent,
      ).toContain(ko["agents.triggers.delivery.trigger.webhook"]);
    });
    expect(
      screen.getByTestId("assistant-trigger-delivery-failure").textContent,
    ).toContain("7");
  });

  it("복구되면 배너가 사라진다", async () => {
    const stub = installElectronStub([failure()]);
    renderPanel();
    await waitFor(() => {
      expect(
        screen.getByTestId("assistant-trigger-delivery-failure"),
      ).toBeTruthy();
    });

    stub.emitRecovered("project-1");

    await waitFor(() => {
      expect(
        screen.queryByTestId("assistant-trigger-delivery-failure"),
      ).toBeNull();
    });
  });

  it("다른 프로젝트의 실패는 이 패널에 뜨지 않는다", async () => {
    const stub = installElectronStub([failure({ projectId: "project-2" })]);
    renderPanel();
    await waitFor(() => {
      expect(
        (
          window.electronAPI as unknown as {
            assistantTriggers: { deliveryFailures: { mock: unknown } };
          }
        ).assistantTriggers.deliveryFailures,
      ).toHaveBeenCalled();
    });
    expect(
      screen.queryByTestId("assistant-trigger-delivery-failure"),
    ).toBeNull();

    stub.emitFailure(failure({ projectId: "project-2" }));
    await Promise.resolve();
    expect(
      screen.queryByTestId("assistant-trigger-delivery-failure"),
    ).toBeNull();
  });

  it("패널이 사라지면 구독을 해지한다 — 리스너가 쌓이지 않는다", async () => {
    const stub = installElectronStub([]);
    const view = renderPanel();
    await waitFor(() => {
      expect(
        (
          window.electronAPI as unknown as {
            assistantTriggers: { deliveryFailures: { mock: unknown } };
          }
        ).assistantTriggers.deliveryFailures,
      ).toHaveBeenCalled();
    });

    view.unmount();
    expect(stub.offFailureCalls()).toBe(1);
  });
});

describe("저장 시점에 이미 아는 것은 발화를 기다리지 않는다", () => {
  it("이 기기에 폴더가 없으면 트리거를 켠 순간 미리 경고한다", async () => {
    installElectronStub([]);
    renderPanel(
      makeProject({
        folderPath: undefined,
        assistantTriggers: {
          enabled: true,
          outputs: ["slack"],
          schedule: { enabled: true, cron: "0 9 * * *" },
        },
      } as Partial<Project>),
    );

    await waitFor(() => {
      expect(
        screen.getByTestId("assistant-trigger-folder-preflight"),
      ).toBeTruthy();
    });
    expect(
      screen.getByText(ko["agents.triggers.delivery.preflight.folderMissing"]),
    ).toBeTruthy();
  });

  it("폴더가 있으면 그 경고는 뜨지 않는다", async () => {
    installElectronStub([]);
    renderPanel(
      makeProject({
        assistantTriggers: {
          enabled: true,
          outputs: ["slack"],
          schedule: { enabled: true, cron: "0 9 * * *" },
        },
      } as Partial<Project>),
    );

    await waitFor(() => {
      expect(
        (
          window.electronAPI as unknown as {
            assistantTriggers: { deliveryFailures: { mock: unknown } };
          }
        ).assistantTriggers.deliveryFailures,
      ).toHaveBeenCalled();
    });
    expect(
      screen.queryByTestId("assistant-trigger-folder-preflight"),
    ).toBeNull();
  });
});
