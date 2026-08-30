/**
 * @vitest-environment jsdom
 *
 * MarbloBotGallery(렌더러) — 티켓 EzCYDCeMETcEyecPUfMI.
 *
 * 실사용자가 거의 없어 **빈 화면이 기본 상태**다. 그래서 빈 상태·에러 상태부터
 * 고정한다:
 *  · 저장된 봇 없음 → 빈 안내 문구.
 *  · 위키 root 없음 → "구성 필요" 배지.
 *  · 새 봇 저장: 검증 실패 문구 / Firestore 실패 문구(unhandled rejection 금지).
 *  · 시드 저장·실행: 오케 라우팅 실패 → 실패 문구, 성공 → 큐 문구.
 *  · 구독이 봇을 내려주면 카드가 그려지고 '이 봇에게 맡기기' 가 dispatch 한다.
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

const serviceMock = vi.hoisted(() => ({
  createBotDefinition: vi.fn(async () => "custom-1"),
  upsertSeedBotDefinition: vi.fn(async () => "project-1_seed"),
  subscribers: [] as Array<(bots: unknown[]) => void>,
  subscribeToBotDefinitions: vi.fn(
    (_projectId: string, cb: (bots: unknown[]) => void) => {
      serviceMock.subscribers.push(cb);
      return () => undefined;
    },
  ),
}));

const routeMock = vi.hoisted(() => ({
  routeInstructionToOrchestrator: vi.fn(async () => "queued"),
}));

vi.mock("../../src/services/botDefinitionService", () => ({
  createBotDefinition: serviceMock.createBotDefinition,
  upsertSeedBotDefinition: serviceMock.upsertSeedBotDefinition,
  subscribeToBotDefinitions: serviceMock.subscribeToBotDefinitions,
}));

vi.mock("../../src/services/orchestratorInstructionService", () => ({
  routeInstructionToOrchestrator: routeMock.routeInstructionToOrchestrator,
}));

import { MarbloBotGallery } from "../../src/components/agents/MarbloBotGallery";
import { useLocaleStore } from "../../src/lib/i18n";
import { ko } from "../../src/locales/ko";
import type { Project } from "../../src/types/project";

const project = {
  id: "project-1",
  name: "비서",
  folderPath: "/repo",
  kind: "assistant",
} as unknown as Project;

function installElectronStub(pathExists: boolean | Error) {
  (
    globalThis as unknown as { window: { electronAPI: unknown } }
  ).window.electronAPI = {
    fs: {
      pathExists: vi.fn(async () =>
        pathExists instanceof Error ? Promise.reject(pathExists) : pathExists,
      ),
    },
  };
}

function renderGallery(
  props: Partial<{ project: Project; ownerId: string }> = {},
) {
  return render(
    createElement(MarbloBotGallery, {
      project: props.project ?? project,
      ownerId: props.ownerId ?? "user-1",
    }),
  );
}

function savedBot(overrides: Record<string, unknown> = {}) {
  return {
    id: "bot-1",
    projectId: "project-1",
    ownerId: "user-1",
    name: "저장된 봇",
    persona: "차분함",
    mission: "문서를 정리한다.",
    model: "claude",
    role: "backend",
    tools: ["wiki_query"],
    knowledge: { enabled: true, rootPath: "/repo/docs/wiki" },
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

beforeEach(() => {
  useLocaleStore.setState({ locale: "ko" });
  vi.clearAllMocks();
  serviceMock.subscribers.length = 0;
  routeMock.routeInstructionToOrchestrator.mockResolvedValue("queued");
  installElectronStub(false);
});

afterEach(() => {
  cleanup();
});

describe("빈 상태", () => {
  it("저장된 봇이 없으면 빈 안내를, 위키가 없으면 '구성 필요' 배지를 보여준다", async () => {
    renderGallery();
    expect(screen.getByText(ko["agents.marbloBots.savedEmpty"])).toBeTruthy();
    await waitFor(() => {
      expect(
        screen.getByText(ko["agents.marbloBots.wiki.needsSetup"]),
      ).toBeTruthy();
    });
    expect(serviceMock.subscribeToBotDefinitions).toHaveBeenCalledWith(
      "project-1",
      expect.any(Function),
    );
  });

  it("pathExists 가 실패해도 화면이 죽지 않고 '구성 필요' 로 떨어진다", async () => {
    installElectronStub(new Error("fs unavailable"));
    renderGallery();
    await waitFor(() => {
      expect(
        screen.getByText(ko["agents.marbloBots.wiki.needsSetup"]),
      ).toBeTruthy();
    });
  });

  it("folderPath 가 없는 프로젝트는 Knowledge root 없음 → 시드 카드가 검증 오류로 잠긴다", () => {
    renderGallery({
      project: { ...project, folderPath: undefined } as unknown as Project,
    });
    // 지식 시드는 knowledgeEnabled 라 root 없이는 저장·실행 버튼이 비활성이다.
    expect(
      screen.getAllByText(
        ko["agents.marbloBots.validation.knowledgeRootRequired"],
      ).length,
    ).toBeGreaterThan(0);
    const runButtons = screen.getAllByText(ko["agents.marbloBots.saveAndRun"]);
    const disabled = runButtons.filter(
      (el) => (el.closest("button") as HTMLButtonElement).disabled,
    );
    expect(disabled.length).toBeGreaterThan(0);
  });

  it("위키가 있으면 '준비됨' 배지로 바뀐다", async () => {
    installElectronStub(true);
    renderGallery();
    await waitFor(() => {
      expect(screen.getByText(ko["agents.marbloBots.wiki.ready"])).toBeTruthy();
    });
  });
});

describe("새 봇 저장", () => {
  function fillCustom(name: string, persona: string, mission: string) {
    const inputs = screen.getAllByRole("textbox");
    // 순서: 실행 미션(textarea) · name · persona · mission
    fireEvent.change(inputs[1], { target: { value: name } });
    fireEvent.change(inputs[2], { target: { value: persona } });
    fireEvent.change(inputs[3], { target: { value: mission } });
  }

  it("비어 있는 필드는 저장 전에 검증 문구로 막는다", () => {
    renderGallery();
    fireEvent.click(screen.getByText(ko["agents.marbloBots.save"]));
    expect(
      screen.getByText(
        new RegExp(ko["agents.marbloBots.validation.missingName"]),
      ),
    ).toBeTruthy();
    expect(serviceMock.createBotDefinition).not.toHaveBeenCalled();
  });

  it("검증을 통과하면 저장하고 성공 문구를 보여준 뒤 폼을 비운다", async () => {
    renderGallery();
    fillCustom("새 봇", "친절함", "질문에 답한다");
    fireEvent.click(screen.getByText(ko["agents.marbloBots.save"]));
    await waitFor(() => {
      expect(
        screen.getByText(ko["agents.marbloBots.savedCustom"]),
      ).toBeTruthy();
    });
    expect(serviceMock.createBotDefinition).toHaveBeenCalledWith(
      expect.objectContaining({
        projectId: "project-1",
        ownerId: "user-1",
        name: "새 봇",
        knowledge: { enabled: true, rootPath: "/repo/docs/wiki" },
      }),
    );
    const inputs = screen.getAllByRole("textbox");
    expect((inputs[1] as HTMLInputElement).value).toBe("");
  });

  it("Firestore 저장이 실패하면 에러 문구를 보여주고 버튼이 다시 살아난다", async () => {
    serviceMock.createBotDefinition.mockRejectedValueOnce(
      new Error("permission-denied"),
    );
    renderGallery();
    fillCustom("새 봇", "친절함", "질문에 답한다");
    const button = screen
      .getByText(ko["agents.marbloBots.save"])
      .closest("button") as HTMLButtonElement;
    fireEvent.click(button);
    await waitFor(() => {
      expect(screen.getByText("permission-denied")).toBeTruthy();
    });
    expect(button.disabled).toBe(false);
    // 입력값은 지우지 않는다 — 사용자가 다시 시도할 수 있어야 한다.
    expect((screen.getAllByRole("textbox")[1] as HTMLInputElement).value).toBe(
      "새 봇",
    );
  });
});

describe("시드 저장·실행", () => {
  it("'저장 후 실행' 은 upsert 뒤 오케에 라우팅하고 큐 문구를 보여준다", async () => {
    renderGallery();
    const [runButton] = screen.getAllByText(ko["agents.marbloBots.saveAndRun"]);
    fireEvent.click(runButton);
    await waitFor(() => {
      expect(
        screen.getByText(ko["agents.marbloBots.dispatchQueued"]),
      ).toBeTruthy();
    });
    expect(serviceMock.upsertSeedBotDefinition).toHaveBeenCalledTimes(1);
    expect(routeMock.routeInstructionToOrchestrator).toHaveBeenCalledWith(
      expect.objectContaining({
        projectId: "project-1",
        fromUserId: "user-1",
        taskId: null,
      }),
    );
    const { message } = routeMock.routeInstructionToOrchestrator.mock
      .calls[0][0] as { message: string };
    expect(message).toContain("create_task");
    expect(message).toContain("dispatch_task");
  });

  it("실행 미션을 적으면 그 문장이 지시문에 실린다", async () => {
    renderGallery();
    const [missionBox] = screen.getAllByRole("textbox");
    fireEvent.change(missionBox, { target: { value: "가격 전략 정리" } });
    fireEvent.click(screen.getAllByText(ko["agents.marbloBots.saveAndRun"])[0]);
    await waitFor(() => {
      expect(routeMock.routeInstructionToOrchestrator).toHaveBeenCalled();
    });
    const { message } = routeMock.routeInstructionToOrchestrator.mock
      .calls[0][0] as { message: string };
    expect(message).toContain("가격 전략 정리");
  });

  it("오케 라우팅이 실패하면 실패 문구를 보여준다", async () => {
    routeMock.routeInstructionToOrchestrator.mockResolvedValueOnce("failed");
    renderGallery();
    fireEvent.click(screen.getAllByText(ko["agents.marbloBots.saveAndRun"])[0]);
    await waitFor(() => {
      expect(
        screen.getByText(ko["agents.marbloBots.dispatchFailed"]),
      ).toBeTruthy();
    });
  });

  it("시드 저장이 실패하면 실행하지 않고 에러를 보여준다", async () => {
    serviceMock.upsertSeedBotDefinition.mockRejectedValueOnce(
      new Error("quota exceeded"),
    );
    renderGallery();
    fireEvent.click(screen.getAllByText(ko["agents.marbloBots.saveAndRun"])[0]);
    await waitFor(() => {
      expect(screen.getByText("quota exceeded")).toBeTruthy();
    });
    expect(routeMock.routeInstructionToOrchestrator).not.toHaveBeenCalled();
  });

  it("'프로젝트에 저장' 만 누르면 라우팅 없이 저장 문구만 보여준다", async () => {
    renderGallery();
    fireEvent.click(
      screen.getAllByText(ko["agents.marbloBots.saveToProject"])[0],
    );
    await waitFor(() => {
      expect(screen.getByText(ko["agents.marbloBots.savedSeed"])).toBeTruthy();
    });
    expect(routeMock.routeInstructionToOrchestrator).not.toHaveBeenCalled();
  });
});

describe("저장된 봇 목록", () => {
  it("구독이 봇을 내려주면 카드가 그려지고 시드 버튼 라벨이 '다시 저장' 으로 바뀐다", async () => {
    renderGallery();
    serviceMock.subscribers[0]([savedBot({ seedId: "knowledge-assistant" })]);
    await waitFor(() => {
      expect(screen.getByText("저장된 봇")).toBeTruthy();
    });
    expect(screen.queryByText(ko["agents.marbloBots.savedEmpty"])).toBeNull();
    expect(
      screen.getAllByText(ko["agents.marbloBots.saveAgain"]).length,
    ).toBeGreaterThan(0);
  });

  it("'이 봇에게 맡기기' 는 저장 없이 바로 라우팅한다", async () => {
    renderGallery();
    serviceMock.subscribers[0]([savedBot()]);
    const button = await screen.findByText(ko["agents.marbloBots.runSaved"]);
    fireEvent.click(button);
    await waitFor(() => {
      expect(
        screen.getByText(ko["agents.marbloBots.dispatchQueued"]),
      ).toBeTruthy();
    });
    expect(serviceMock.upsertSeedBotDefinition).not.toHaveBeenCalled();
    expect(serviceMock.createBotDefinition).not.toHaveBeenCalled();
  });

  it("저장된 봇이 검증을 통과 못 하면(예: knowledge root 없음) 라우팅하지 않고 이유를 보여준다", async () => {
    renderGallery();
    serviceMock.subscribers[0]([
      savedBot({ knowledge: { enabled: true, rootPath: "" } }),
    ]);
    const button = await screen.findByText(ko["agents.marbloBots.runSaved"]);
    fireEvent.click(button);
    await waitFor(() => {
      expect(
        screen.getByText(
          new RegExp(ko["agents.marbloBots.validation.knowledgeRootRequired"]),
        ),
      ).toBeTruthy();
    });
    expect(routeMock.routeInstructionToOrchestrator).not.toHaveBeenCalled();
  });

  it("구독이 빈 목록으로 돌아오면(에러 시 firestore 가 [] 를 준다) 다시 빈 상태다", async () => {
    renderGallery();
    serviceMock.subscribers[0]([savedBot()]);
    await screen.findByText("저장된 봇");
    serviceMock.subscribers[0]([]);
    await waitFor(() => {
      expect(screen.getByText(ko["agents.marbloBots.savedEmpty"])).toBeTruthy();
    });
  });
});
