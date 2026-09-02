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
  updateBotDefinition: vi.fn(async () => undefined),
  deleteBotDefinition: vi.fn(async () => undefined),
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
  updateBotDefinition: serviceMock.updateBotDefinition,
  deleteBotDefinition: serviceMock.deleteBotDefinition,
  subscribeToBotDefinitions: serviceMock.subscribeToBotDefinitions,
}));

vi.mock("../../src/services/orchestratorInstructionService", () => ({
  routeInstructionToOrchestrator: routeMock.routeInstructionToOrchestrator,
}));

import { MarbloBotGallery } from "../../src/components/agents/MarbloBotGallery";
import { useLocaleStore } from "../../src/lib/i18n";
import { ko } from "../../src/locales/ko";
import { en } from "../../src/locales/en";
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

/**
 * 수정·삭제 (티켓 ddSiPtvknBaA4f1ptCh1).
 *
 * ★삭제는 되돌릴 수 없다. 그래서 "버튼 한 번에 지워지지 않는다" 를 제일 먼저
 * 고정한다 — 이 테스트가 깨지면 오삭제가 프로덕션으로 나간다는 뜻이다.
 */
describe("봇 수정", () => {
  it("'수정' 을 누르면 저장된 값이 그대로 채워진 폼이 열린다", async () => {
    renderGallery();
    serviceMock.subscribers[0]([savedBot()]);

    fireEvent.click(await screen.findByText(ko["agents.marbloBots.edit"]));

    expect(screen.getByDisplayValue("저장된 봇")).toBeTruthy();
    expect(screen.getByDisplayValue("차분함")).toBeTruthy();
    expect(screen.getByDisplayValue("문서를 정리한다.")).toBeTruthy();
    expect(screen.getByText(ko["agents.marbloBots.editLocked"])).toBeTruthy();
  });

  it("고친 값으로 update 를 부르고 성공 문구를 보여준 뒤 폼을 닫는다", async () => {
    renderGallery();
    serviceMock.subscribers[0]([savedBot()]);
    fireEvent.click(await screen.findByText(ko["agents.marbloBots.edit"]));

    fireEvent.change(screen.getByDisplayValue("저장된 봇"), {
      target: { value: "이름 오타 수정" },
    });
    fireEvent.click(screen.getByText(ko["agents.marbloBots.editSave"]));

    await waitFor(() => {
      expect(screen.getByText(ko["agents.marbloBots.edited"])).toBeTruthy();
    });
    expect(serviceMock.updateBotDefinition).toHaveBeenCalledTimes(1);
    const [id, draft] = serviceMock.updateBotDefinition.mock.calls[0] as [
      string,
      Record<string, unknown>,
    ];
    expect(id).toBe("bot-1");
    expect(draft.name).toBe("이름 오타 수정");
    expect(screen.queryByText(ko["agents.marbloBots.editSave"])).toBeNull();
  });

  it("★수정은 projectId·ownerId·tools 를 그대로 넘긴다 — 화면이 범위를 넓히지 않는다", async () => {
    renderGallery();
    serviceMock.subscribers[0]([
      savedBot({ tools: ["wiki_query", "filesystem"] }),
    ]);
    fireEvent.click(await screen.findByText(ko["agents.marbloBots.edit"]));
    fireEvent.click(screen.getByText(ko["agents.marbloBots.editSave"]));

    await waitFor(() => {
      expect(serviceMock.updateBotDefinition).toHaveBeenCalled();
    });
    const [, draft] = serviceMock.updateBotDefinition.mock.calls[0] as [
      string,
      Record<string, unknown>,
    ];
    expect(draft.projectId).toBe("project-1");
    expect(draft.ownerId).toBe("user-1");
    expect(draft.tools).toEqual(["wiki_query", "filesystem"]);
  });

  it("검증에 걸리면 저장하지 않고 이유를 보여준다", async () => {
    renderGallery();
    serviceMock.subscribers[0]([savedBot()]);
    fireEvent.click(await screen.findByText(ko["agents.marbloBots.edit"]));

    fireEvent.change(screen.getByDisplayValue("저장된 봇"), {
      target: { value: "   " },
    });
    fireEvent.click(screen.getByText(ko["agents.marbloBots.editSave"]));

    await waitFor(() => {
      expect(
        screen.getByText(
          new RegExp(ko["agents.marbloBots.validation.missingName"]),
        ),
      ).toBeTruthy();
    });
    expect(serviceMock.updateBotDefinition).not.toHaveBeenCalled();
  });

  it("★저장이 실패하면 폼을 닫지 않는다 — 사용자가 쓴 내용을 잃지 않게", async () => {
    serviceMock.updateBotDefinition.mockRejectedValueOnce(
      new Error("permission-denied"),
    );
    renderGallery();
    serviceMock.subscribers[0]([savedBot()]);
    fireEvent.click(await screen.findByText(ko["agents.marbloBots.edit"]));

    fireEvent.change(screen.getByDisplayValue("저장된 봇"), {
      target: { value: "안 지워질 이름" },
    });
    fireEvent.click(screen.getByText(ko["agents.marbloBots.editSave"]));

    await waitFor(() => {
      expect(screen.getByText("permission-denied")).toBeTruthy();
    });
    expect(screen.getByDisplayValue("안 지워질 이름")).toBeTruthy();
  });

  it("'취소' 는 저장하지 않고 폼을 닫는다", async () => {
    renderGallery();
    serviceMock.subscribers[0]([savedBot()]);
    fireEvent.click(await screen.findByText(ko["agents.marbloBots.edit"]));

    fireEvent.change(screen.getByDisplayValue("저장된 봇"), {
      target: { value: "버려질 이름" },
    });
    fireEvent.click(screen.getByText(ko["agents.marbloBots.editCancel"]));

    expect(serviceMock.updateBotDefinition).not.toHaveBeenCalled();
    expect(screen.queryByDisplayValue("버려질 이름")).toBeNull();
  });

  it("시드에서 온 봇은 '다시 저장' 이 수정을 덮어쓴다는 경고를 보여준다", async () => {
    renderGallery();
    serviceMock.subscribers[0]([savedBot({ seedId: "knowledge-assistant" })]);
    fireEvent.click(await screen.findByText(ko["agents.marbloBots.edit"]));

    expect(screen.getByText(ko["agents.marbloBots.editSeedNote"])).toBeTruthy();
  });

  it("★다른 기기에서 그 봇이 지워지면 열려 있던 수정 폼이 닫힌다", async () => {
    renderGallery();
    serviceMock.subscribers[0]([savedBot()]);
    fireEvent.click(await screen.findByText(ko["agents.marbloBots.edit"]));
    expect(screen.getByText(ko["agents.marbloBots.editSave"])).toBeTruthy();

    serviceMock.subscribers[0]([]);

    await waitFor(() => {
      expect(screen.queryByText(ko["agents.marbloBots.editSave"])).toBeNull();
    });
  });
});

describe("봇 삭제", () => {
  it("★'삭제' 를 눌러도 바로 지워지지 않는다 — 확인 단계를 거친다", async () => {
    renderGallery();
    serviceMock.subscribers[0]([savedBot()]);

    fireEvent.click(await screen.findByText(ko["agents.marbloBots.delete"]));

    expect(serviceMock.deleteBotDefinition).not.toHaveBeenCalled();
    expect(screen.getByRole("alertdialog")).toBeTruthy();
  });

  it("★확인창은 무엇이 사라지는지·이미 나간 일은 어떻게 되는지를 밝힌다", async () => {
    renderGallery();
    serviceMock.subscribers[0]([savedBot()]);
    fireEvent.click(await screen.findByText(ko["agents.marbloBots.delete"]));

    const dialog = screen.getByRole("alertdialog");
    expect(dialog.textContent).toContain("저장된 봇");
    expect(dialog.textContent).toContain(ko["agents.marbloBots.deleteBody"]);
    expect(dialog.textContent).toContain(
      ko["agents.marbloBots.deleteKeepsRuns"],
    );
  });

  it("★커스텀 봇은 '되돌릴 수 없다', 시드 봇은 '다시 담을 수 있다' 로 문구가 갈린다", async () => {
    renderGallery();
    serviceMock.subscribers[0]([savedBot()]);
    fireEvent.click(await screen.findByText(ko["agents.marbloBots.delete"]));
    expect(screen.getByRole("alertdialog").textContent).toContain(
      ko["agents.marbloBots.deleteIrreversibleCustom"],
    );

    cleanup();
    renderGallery();
    serviceMock.subscribers[1]([savedBot({ seedId: "knowledge-assistant" })]);
    fireEvent.click(await screen.findByText(ko["agents.marbloBots.delete"]));
    expect(screen.getByRole("alertdialog").textContent).toContain(
      ko["agents.marbloBots.deleteIrreversibleSeed"],
    );
  });

  it("확인하면 그 봇 하나만 지우고 성공 문구를 보여준다", async () => {
    renderGallery();
    serviceMock.subscribers[0]([savedBot()]);
    fireEvent.click(await screen.findByText(ko["agents.marbloBots.delete"]));
    fireEvent.click(screen.getByText(ko["agents.marbloBots.deleteConfirm"]));

    await waitFor(() => {
      expect(screen.getByText(ko["agents.marbloBots.deleted"])).toBeTruthy();
    });
    expect(serviceMock.deleteBotDefinition).toHaveBeenCalledTimes(1);
    expect(serviceMock.deleteBotDefinition).toHaveBeenCalledWith("bot-1");
    expect(screen.queryByRole("alertdialog")).toBeNull();
  });

  it("'취소' 는 아무것도 지우지 않는다", async () => {
    renderGallery();
    serviceMock.subscribers[0]([savedBot()]);
    fireEvent.click(await screen.findByText(ko["agents.marbloBots.delete"]));
    fireEvent.click(screen.getByText(ko["agents.marbloBots.deleteCancel"]));

    expect(serviceMock.deleteBotDefinition).not.toHaveBeenCalled();
    expect(screen.queryByRole("alertdialog")).toBeNull();
  });

  it("★삭제가 실패하면 확인창을 닫지 않고 그 안에 이유를 보여준다 — '지워졌다'고 오해하지 않게", async () => {
    serviceMock.deleteBotDefinition.mockRejectedValueOnce(
      new Error("permission-denied"),
    );
    renderGallery();
    serviceMock.subscribers[0]([savedBot()]);
    fireEvent.click(await screen.findByText(ko["agents.marbloBots.delete"]));
    fireEvent.click(screen.getByText(ko["agents.marbloBots.deleteConfirm"]));

    await waitFor(() => {
      expect(screen.getByRole("alertdialog").textContent).toContain(
        "permission-denied",
      );
    });
    expect(screen.queryByText(ko["agents.marbloBots.deleted"])).toBeNull();
  });

  it("삭제되면 목록에서 사라지고, 시드 봇이었으면 시드 카드에서 다시 담을 수 있다", async () => {
    renderGallery();
    serviceMock.subscribers[0]([savedBot({ seedId: "knowledge-assistant" })]);
    await screen.findByText(ko["agents.marbloBots.delete"]);
    expect(
      screen.getAllByText(ko["agents.marbloBots.saveAgain"]).length,
    ).toBeGreaterThan(0);

    // 구독이 삭제 결과를 반영한다.
    serviceMock.subscribers[0]([]);

    await waitFor(() => {
      expect(screen.getByText(ko["agents.marbloBots.savedEmpty"])).toBeTruthy();
    });
    // 시드 카드는 그대로 남아 라벨이 '프로젝트에 저장' 으로 되돌아간다.
    expect(
      screen.getAllByText(ko["agents.marbloBots.saveToProject"]).length,
    ).toBeGreaterThan(0);
    expect(screen.queryByText(ko["agents.marbloBots.saveAgain"])).toBeNull();
  });
});

/**
 * 로케일 (티켓 ddSiPtvknBaA4f1ptCh1) — en 로 바꿨을 때 한국어가 새지 않는지.
 * ko/en 은 `Record<MessageKey, string>` 이라 키 누락은 컴파일에서 잡히지만,
 * "값이 실제로 번역돼 있는가" 는 타입이 못 잡는다.
 */
describe("수정·삭제 로케일", () => {
  const NEW_KEYS = [
    "agents.marbloBots.edit",
    "agents.marbloBots.editSave",
    "agents.marbloBots.editCancel",
    "agents.marbloBots.edited",
    "agents.marbloBots.editFailed",
    "agents.marbloBots.editLocked",
    "agents.marbloBots.editSeedNote",
    "agents.marbloBots.seedBadge",
    "agents.marbloBots.delete",
    "agents.marbloBots.deleteTitle",
    "agents.marbloBots.deleteBody",
    "agents.marbloBots.deleteIrreversibleCustom",
    "agents.marbloBots.deleteIrreversibleSeed",
    "agents.marbloBots.deleteKeepsRuns",
    "agents.marbloBots.deleteConfirm",
    "agents.marbloBots.deleteCancel",
    "agents.marbloBots.deleted",
    "agents.marbloBots.deleteFailed",
  ] as const;

  it("새 키가 ko/en 양쪽에 비어 있지 않게 채워져 있고 서로 다르다", () => {
    for (const key of NEW_KEYS) {
      expect(ko[key], `ko:${key}`).toBeTruthy();
      expect(en[key], `en:${key}`).toBeTruthy();
      expect(en[key], `en:${key} 가 ko 값 그대로다`).not.toBe(ko[key]);
      // en 값에 한글이 섞이면 번역이 덜 된 것이다.
      expect(/[가-힣]/.test(en[key]), `en:${key} 에 한글이 남아 있다`).toBe(
        false,
      );
    }
  });

  it("en 로케일에서 수정·삭제 버튼이 영어로 나온다", async () => {
    useLocaleStore.setState({ locale: "en" });
    renderGallery();
    // 봇 이름은 사용자 데이터라 이 검사에서 빼야 한다 — ASCII 이름을 쓴다.
    serviceMock.subscribers[0]([savedBot({ name: "Saved bot" })]);

    expect(await screen.findByText(en["agents.marbloBots.edit"])).toBeTruthy();
    fireEvent.click(screen.getByText(en["agents.marbloBots.delete"]));

    const dialog = screen.getByRole("alertdialog");
    expect(dialog.textContent).toContain(en["agents.marbloBots.deleteBody"]);
    expect(dialog.textContent).toContain(
      en["agents.marbloBots.deleteKeepsRuns"],
    );
    // ★영어 화면에 한국어 문자열이 그대로 새지 않는다.
    expect(/[가-힣]/.test(dialog.textContent ?? "")).toBe(false);
  });
});
