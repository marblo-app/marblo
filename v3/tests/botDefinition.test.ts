import { describe, expect, it } from "vitest";
import {
  BOT_DISPATCH_SOURCE,
  BOT_TASK_SCOPE_PREFIX,
  buildBotDispatchInstruction,
  localizeSeedBots,
  seedToDraft,
  validateBotDefinition,
  type BotDefinition,
  type BotDefinitionDraft,
  type LocalizedSeedBotDefinition,
} from "../src/lib/botDefinition";

const validDraft: BotDefinitionDraft = {
  projectId: "project-1",
  ownerId: "user-1",
  name: "지식 비서",
  persona: "근거 중심 비서",
  mission: "위키에 근거해 답한다.",
  model: "claude",
  role: "backend",
  tools: ["wiki_query"],
  knowledge: { enabled: true, rootPath: "/repo/docs/wiki" },
};

describe("validateBotDefinition", () => {
  it("필수 필드 누락을 잡는다", () => {
    const result = validateBotDefinition({
      ...validDraft,
      projectId: "",
      ownerId: "",
      name: "",
      persona: "",
    });

    expect(result.ok).toBe(false);
    expect(result.issues).toEqual(
      expect.arrayContaining([
        "missing_project",
        "missing_owner",
        "missing_name",
        "missing_persona",
      ]),
    );
  });

  it("모르는 모델을 거부한다", () => {
    const result = validateBotDefinition({
      ...validDraft,
      model: "unknown-model" as BotDefinitionDraft["model"],
    });

    expect(result.ok).toBe(false);
    expect(result.issues).toContain("unknown_model");
  });

  it("빈 Mission을 거부한다", () => {
    const result = validateBotDefinition({ ...validDraft, mission: "   " });

    expect(result.ok).toBe(false);
    expect(result.issues).toContain("empty_mission");
  });

  it("Knowledge를 켰는데 wiki root_path가 없으면 거부한다", () => {
    const result = validateBotDefinition({
      ...validDraft,
      knowledge: { enabled: true, rootPath: "" },
    });

    expect(result.ok).toBe(false);
    expect(result.issues).toContain("knowledge_root_required");
  });

  it("Knowledge root_path가 있으면 통과한다", () => {
    expect(validateBotDefinition(validDraft)).toEqual({ ok: true, issues: [] });
  });
});

describe("seedToDraft", () => {
  it("시드의 Knowledge 축을 프로젝트 wiki root_path로 구체화한다", () => {
    const seed: LocalizedSeedBotDefinition = {
      seedId: "knowledge-assistant",
      name: "지식 비서",
      persona: "비서",
      mission: "답한다",
      model: "claude",
      role: "backend",
      tools: ["wiki_query"],
      evidence: "wiki_query registered",
      knowledgeEnabled: true,
    };
    const draft = seedToDraft({
      seed,
      projectId: "project-1",
      ownerId: "user-1",
      wikiRootPath: "/repo/docs/wiki",
    });

    expect(draft.projectId).toBe("project-1");
    expect(draft.knowledge).toEqual({
      enabled: true,
      rootPath: "/repo/docs/wiki",
    });
  });
});

describe("buildBotDispatchInstruction", () => {
  it("기존 create_task + dispatch_task 경로와 wiki_query root_path를 지시문에 싣는다", () => {
    const bot: BotDefinition = {
      ...validDraft,
      id: "bot-1",
      createdAt: new Date("2026-08-26T00:00:00Z"),
      updatedAt: new Date("2026-08-26T00:00:00Z"),
    };

    const instruction = buildBotDispatchInstruction({
      bot,
      userMission: "이번 분기 가격 전략 정리",
      projectRootPath: "/repo",
    });

    expect(instruction).toContain("create_task");
    expect(instruction).toContain("dispatch_task");
    expect(instruction).toContain(`source: ${BOT_DISPATCH_SOURCE}`);
    expect(instruction).toContain(`${BOT_TASK_SCOPE_PREFIX}bot-1`);
    expect(instruction).toContain("wiki_query");
    expect(instruction).toContain("root_path: /repo/docs/wiki");
    expect(instruction).toContain("이번 분기 가격 전략 정리");
  });
});

describe("localizeSeedBots", () => {
  it("시드 정의의 화면 문자열을 로케일 함수로 만든다", () => {
    const seeds = localizeSeedBots((key) => `ko:${key}`);

    expect(seeds[0].name).toBe("ko:agents.marbloBots.seed.knowledge.name");
    expect(seeds.some((seed) => seed.seedId === "marketer")).toBe(true);
    expect(seeds.some((seed) => seed.seedId === "designer")).toBe(true);
    expect(seeds.some((seed) => seed.seedId === "jarvis")).toBe(true);
  });
});
