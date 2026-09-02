/**
 * botDefinitionService — Firestore 경계 테스트. 티켓 EzCYDCeMETcEyecPUfMI.
 *
 * 저장소 호출은 spy 로 바꾸고, 이 서비스가 지켜야 할 것만 고정한다:
 *  · 생성/시드 upsert 는 검증을 통과한 정의만 쓴다(불법 초안은 쓰기 전에 거부).
 *  · 구독은 빈 목록·손상 문서를 화면이 그릴 수 있는 모양으로 돌려준다.
 *  · 테스트 해치(window.__marbloTest)는 bypassAuth 일 때만 잡힌다.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const firestoreMock = vi.hoisted(() => ({
  createDocument: vi.fn(async () => "doc-1"),
  setDocument: vi.fn(async () => undefined),
  updateDocument: vi.fn(async () => undefined),
  deleteDocument: vi.fn(async () => undefined),
  subscribeToCollection: vi.fn(),
  toTimestamp: vi.fn((date: Date) => ({ __ts: date.toISOString() })),
  convertTimestamps: vi.fn(
    (data: Record<string, unknown>, fields: string[]) => {
      const out = { ...data };
      for (const field of fields) {
        const value = out[field] as { toDate?: () => Date } | undefined;
        if (value && typeof value.toDate === "function") {
          out[field] = value.toDate();
        }
      }
      return out;
    },
  ),
}));

vi.mock("../../src/services/firestore", () => firestoreMock);

import {
  createBotDefinition,
  deleteBotDefinition,
  normalizeBotDefinitionDoc,
  subscribeToBotDefinitions,
  updateBotDefinition,
  upsertSeedBotDefinition,
} from "../../src/services/botDefinitionService";
import type { BotDefinitionDraft } from "../../src/lib/botDefinition";

const validDraft: BotDefinitionDraft = {
  projectId: "project-1",
  ownerId: "user-1",
  name: "지식 비서",
  persona: "근거 중심",
  mission: "위키에 근거해 답한다.",
  model: "claude",
  role: "backend",
  tools: ["wiki_query"],
  knowledge: { enabled: true, rootPath: "/repo/docs/wiki" },
};

type WindowLike = {
  electronAPI?: { testMode?: { bypassAuth?: boolean } };
  __marbloTest?: unknown;
};

function setWindow(value: WindowLike | undefined): void {
  (globalThis as unknown as { window?: WindowLike }).window = value;
}

beforeEach(() => {
  vi.clearAllMocks();
  setWindow({});
});

afterEach(() => {
  setWindow(undefined);
});

describe("createBotDefinition", () => {
  it("검증을 통과한 초안만 createdAt/updatedAt 을 붙여 쓴다", async () => {
    const id = await createBotDefinition(validDraft);
    expect(id).toBe("doc-1");
    expect(firestoreMock.createDocument).toHaveBeenCalledTimes(1);
    const [collection, payload] = firestoreMock.createDocument.mock
      .calls[0] as [string, Record<string, unknown>];
    expect(collection).toBe("botDefinitions");
    expect(payload.name).toBe("지식 비서");
    expect(payload.createdAt).toBeDefined();
    expect(payload.updatedAt).toBeDefined();
    // 배열/객체는 복사본이다 — 초안을 나중에 바꿔도 저장 페이로드가 흔들리지 않는다.
    expect(payload.tools).not.toBe(validDraft.tools);
    expect(payload.knowledge).not.toBe(validDraft.knowledge);
  });

  it("불법 초안은 저장소에 닿기 전에 거부한다", async () => {
    await expect(
      createBotDefinition({ ...validDraft, name: "", mission: "  " }),
    ).rejects.toThrow(/missing_name/);
    expect(firestoreMock.createDocument).not.toHaveBeenCalled();
  });

  it("Knowledge 를 켰는데 root 가 없으면 거부한다", async () => {
    await expect(
      createBotDefinition({
        ...validDraft,
        knowledge: { enabled: true, rootPath: "" },
      }),
    ).rejects.toThrow(/knowledge_root_required/);
    expect(firestoreMock.createDocument).not.toHaveBeenCalled();
  });

  it("저장소 실패는 호출자에게 그대로 전파된다(화면이 에러를 보여줄 수 있게)", async () => {
    firestoreMock.createDocument.mockRejectedValueOnce(
      new Error("permission-denied"),
    );
    await expect(createBotDefinition(validDraft)).rejects.toThrow(
      "permission-denied",
    );
  });
});

describe("upsertSeedBotDefinition", () => {
  it("프로젝트_시드 결정적 ID 로 setDocument 한다 — 같은 시드를 다시 저장해도 중복이 생기지 않는다", async () => {
    const id = await upsertSeedBotDefinition({
      ...validDraft,
      seedId: "knowledge-assistant",
    });
    expect(id).toBe("project-1_knowledge-assistant");
    expect(firestoreMock.setDocument).toHaveBeenCalledWith(
      "botDefinitions",
      "project-1_knowledge-assistant",
      expect.objectContaining({ seedId: "knowledge-assistant" }),
    );
  });

  it("불법 시드 초안은 거부한다", async () => {
    await expect(
      upsertSeedBotDefinition({
        ...validDraft,
        seedId: "x",
        model: "gpt-9" as BotDefinitionDraft["model"],
      }),
    ).rejects.toThrow(/unknown_model/);
    expect(firestoreMock.setDocument).not.toHaveBeenCalled();
  });
});

describe("subscribeToBotDefinitions", () => {
  it("빈 컬렉션은 빈 배열로 전달한다", () => {
    const received: unknown[] = [];
    firestoreMock.subscribeToCollection.mockImplementation(
      (_c: string, _q: unknown[], cb: (docs: unknown[]) => void) => {
        cb([]);
        return () => undefined;
      },
    );
    subscribeToBotDefinitions("project-1", (bots) => received.push(bots));
    expect(received).toEqual([[]]);
  });

  it("프로젝트 범위로 구독하고 unsubscribe 를 돌려준다", () => {
    const unsub = vi.fn();
    firestoreMock.subscribeToCollection.mockImplementation(() => unsub);
    const returned = subscribeToBotDefinitions("project-1", () => undefined);
    expect(firestoreMock.subscribeToCollection).toHaveBeenCalledWith(
      "botDefinitions",
      expect.any(Array),
      expect.any(Function),
    );
    returned();
    expect(unsub).toHaveBeenCalledTimes(1);
  });

  it("손상 문서(knowledge/tools 누락)가 섞여도 목록 전체가 죽지 않는다", () => {
    const received: unknown[][] = [];
    firestoreMock.subscribeToCollection.mockImplementation(
      (
        _c: string,
        _q: unknown[],
        cb: (docs: Record<string, unknown>[]) => void,
      ) => {
        cb([
          { id: "ok", ...validDraft },
          { id: "broken", projectId: "project-1", name: "구버전" },
        ]);
        return () => undefined;
      },
    );
    subscribeToBotDefinitions("project-1", (bots) => received.push(bots));
    expect(received).toHaveLength(1);
    const [bots] = received as [Array<Record<string, unknown>>];
    expect(bots).toHaveLength(2);
    expect(bots[1]).toMatchObject({
      id: "broken",
      name: "구버전",
      tools: [],
      knowledge: { enabled: false, rootPath: "" },
      model: "claude",
    });
  });
});

describe("normalizeBotDefinitionDoc", () => {
  it("Timestamp 를 Date 로 바꾸고 seedId 는 있을 때만 싣는다", () => {
    const bot = normalizeBotDefinitionDoc({
      id: "b1",
      ...validDraft,
      seedId: "jarvis",
      createdAt: { toDate: () => new Date("2026-08-26T00:00:00Z") },
      updatedAt: { toDate: () => new Date("2026-08-27T00:00:00Z") },
    });
    expect(bot.createdAt.toISOString()).toBe("2026-08-26T00:00:00.000Z");
    expect(bot.updatedAt.toISOString()).toBe("2026-08-27T00:00:00.000Z");
    expect(bot.seedId).toBe("jarvis");
    expect(bot.knowledge).toEqual({
      enabled: true,
      rootPath: "/repo/docs/wiki",
    });
  });

  it("seedId 가 빈 문자열이면 키 자체를 싣지 않는다(savedSeedIds 집합이 '' 로 오염되지 않게)", () => {
    const bot = normalizeBotDefinitionDoc({ id: "b2", seedId: "" });
    expect("seedId" in bot).toBe(false);
  });

  it("모르는 model·비문자열 tools 는 안전한 기본값으로 떨어진다", () => {
    const bot = normalizeBotDefinitionDoc({
      id: "b3",
      model: "gpt-9",
      tools: ["wiki_query", 42, null],
      knowledge: { enabled: "yes", rootPath: 7 },
    });
    expect(bot.model).toBe("claude");
    expect(bot.tools).toEqual(["wiki_query"]);
    expect(bot.knowledge).toEqual({ enabled: false, rootPath: "" });
    expect(bot.createdAt).toBeInstanceOf(Date);
  });
});

describe("테스트 해치", () => {
  it("bypassAuth 가 아니면 해치를 무시하고 Firestore 로 간다", async () => {
    setWindow({
      electronAPI: { testMode: { bypassAuth: false } },
      __marbloTest: { botDefinitions: { create: vi.fn(async () => "hatch") } },
    });
    await expect(createBotDefinition(validDraft)).resolves.toBe("doc-1");
  });

  it("bypassAuth 면 해치가 저장소를 대신한다", async () => {
    const create = vi.fn(async () => "hatch-id");
    setWindow({
      electronAPI: { testMode: { bypassAuth: true } },
      __marbloTest: { botDefinitions: { create } },
    });
    await expect(createBotDefinition(validDraft)).resolves.toBe("hatch-id");
    expect(create).toHaveBeenCalledTimes(1);
    expect(firestoreMock.createDocument).not.toHaveBeenCalled();
  });
});

/**
 * 수정·삭제 (티켓 ddSiPtvknBaA4f1ptCh1).
 *
 * 이 서비스가 지켜야 할 것:
 *  · 수정은 검증을 통과한 정의만 쓰고, createdAt 을 다시 찍지 않는다.
 *  · knowledge 는 통째 객체로 보낸다(updateDoc 이 중첩 맵을 교체하므로 껐을 때
 *    rootPath 가 남지 않는다).
 *  · id 가 비면 저장소에 닿기 전에 거부한다 — 빈 경로로 컬렉션을 때리지 않게.
 *  · 삭제는 그 문서 하나만 지운다.
 */
describe("updateBotDefinition", () => {
  it("검증을 통과한 정의만 updatedAt 을 새로 찍어 쓴다 (createdAt 은 건드리지 않는다)", async () => {
    await updateBotDefinition("bot-1", validDraft);

    expect(firestoreMock.updateDocument).toHaveBeenCalledTimes(1);
    const [collection, id, payload] = firestoreMock.updateDocument.mock
      .calls[0] as [string, string, Record<string, unknown>];
    expect(collection).toBe("botDefinitions");
    expect(id).toBe("bot-1");
    expect(payload.name).toBe("지식 비서");
    expect(payload.updatedAt).toBeDefined();
    expect(payload).not.toHaveProperty("createdAt");
  });

  it("knowledge 를 통째 객체로 보낸다 — 껐을 때 rootPath 가 남지 않는다", async () => {
    await updateBotDefinition("bot-1", {
      ...validDraft,
      knowledge: { enabled: false, rootPath: "" },
    });

    const [, , payload] = firestoreMock.updateDocument.mock.calls[0] as [
      string,
      string,
      Record<string, unknown>,
    ];
    expect(payload.knowledge).toEqual({ enabled: false, rootPath: "" });
  });

  it("불법 정의는 저장소에 닿기 전에 거부한다", async () => {
    await expect(
      updateBotDefinition("bot-1", { ...validDraft, name: "  " }),
    ).rejects.toThrow(/missing_name/);
    expect(firestoreMock.updateDocument).not.toHaveBeenCalled();
  });

  it("id 가 비면 저장소를 부르지 않는다", async () => {
    await expect(updateBotDefinition("", validDraft)).rejects.toThrow(
      /missing id/,
    );
    expect(firestoreMock.updateDocument).not.toHaveBeenCalled();
  });

  it("저장소 실패는 호출자에게 그대로 전파된다(화면이 폼을 닫지 않고 이유를 보여줄 수 있게)", async () => {
    firestoreMock.updateDocument.mockRejectedValueOnce(
      new Error("permission-denied"),
    );

    await expect(updateBotDefinition("bot-1", validDraft)).rejects.toThrow(
      "permission-denied",
    );
  });
});

describe("deleteBotDefinition", () => {
  it("그 문서 하나만 지운다", async () => {
    await deleteBotDefinition("bot-1");

    expect(firestoreMock.deleteDocument).toHaveBeenCalledTimes(1);
    expect(firestoreMock.deleteDocument).toHaveBeenCalledWith(
      "botDefinitions",
      "bot-1",
    );
  });

  it("id 가 비면 저장소를 부르지 않는다", async () => {
    await expect(deleteBotDefinition("")).rejects.toThrow(/missing id/);
    expect(firestoreMock.deleteDocument).not.toHaveBeenCalled();
  });

  it("저장소 실패는 그대로 전파된다 — 실패했는데 '지워졌다'고 보이면 안 된다", async () => {
    firestoreMock.deleteDocument.mockRejectedValueOnce(
      new Error("permission-denied"),
    );

    await expect(deleteBotDefinition("bot-1")).rejects.toThrow(
      "permission-denied",
    );
  });

  it("★삭제는 이 문서에만 닿는다 — 다른 쓰기 경로를 건드리지 않는다", async () => {
    await deleteBotDefinition("bot-1");

    expect(firestoreMock.createDocument).not.toHaveBeenCalled();
    expect(firestoreMock.setDocument).not.toHaveBeenCalled();
    expect(firestoreMock.updateDocument).not.toHaveBeenCalled();
  });
});

describe("수정·삭제 테스트 해치", () => {
  it("bypassAuth 면 해치가 저장소를 대신한다", async () => {
    const update = vi.fn(async () => undefined);
    const remove = vi.fn(async () => undefined);
    setWindow({
      electronAPI: { testMode: { bypassAuth: true } },
      __marbloTest: { botDefinitions: { update, remove } },
    });

    await updateBotDefinition("bot-1", validDraft);
    await deleteBotDefinition("bot-1");

    expect(update).toHaveBeenCalledWith("bot-1", validDraft);
    expect(remove).toHaveBeenCalledWith("bot-1");
    expect(firestoreMock.updateDocument).not.toHaveBeenCalled();
    expect(firestoreMock.deleteDocument).not.toHaveBeenCalled();
  });

  it("해치가 수정·삭제를 구현하지 않으면 Firestore 로 떨어진다", async () => {
    setWindow({
      electronAPI: { testMode: { bypassAuth: true } },
      __marbloTest: { botDefinitions: { create: vi.fn() } },
    });

    await updateBotDefinition("bot-1", validDraft);
    await deleteBotDefinition("bot-1");

    expect(firestoreMock.updateDocument).toHaveBeenCalledTimes(1);
    expect(firestoreMock.deleteDocument).toHaveBeenCalledTimes(1);
  });
});
