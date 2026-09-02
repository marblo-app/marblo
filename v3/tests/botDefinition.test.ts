import { describe, expect, it } from "vitest";
import {
  BOT_DISPATCH_SOURCE,
  BOT_TASK_SCOPE_PREFIX,
  buildBotDispatchInstruction,
  localizeSeedBots,
  seedToDraft,
  applyBotDefinitionEdit,
  toBotDefinitionEdit,
  validateBotDefinition,
  type BotDefinition,
  type BotDefinitionEdit,
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

/**
 * 수정 허용 목록 (티켓 ddSiPtvknBaA4f1ptCh1).
 *
 * "무엇을 고칠 수 있는가" 를 타입 하나에 몰아 놓은 이유를 테스트로 고정한다.
 * 화면이 실수로 범위를 넓히더라도 여기서 잘려야 한다.
 */
describe("applyBotDefinitionEdit", () => {
  const saved: BotDefinition = {
    id: "bot-1",
    projectId: "project-1",
    ownerId: "user-1",
    name: "원래 이름",
    persona: "원래 persona",
    mission: "원래 mission",
    model: "claude",
    role: "backend",
    tools: ["wiki_query", "filesystem"],
    knowledge: { enabled: true, rootPath: "/repo/docs/wiki" },
    seedId: "knowledge-assistant",
    createdAt: new Date("2026-01-01"),
    updatedAt: new Date("2026-01-01"),
  };

  it("허용된 6개 필드만 새 값으로 바뀐다", () => {
    const draft = applyBotDefinitionEdit(saved, {
      name: "고친 이름",
      persona: "고친 persona",
      mission: "고친 mission",
      model: "codex",
      role: "frontend",
      knowledge: { enabled: true, rootPath: "/repo/docs/wiki2" },
    });

    expect(draft.name).toBe("고친 이름");
    expect(draft.persona).toBe("고친 persona");
    expect(draft.mission).toBe("고친 mission");
    expect(draft.model).toBe("codex");
    expect(draft.role).toBe("frontend");
    expect(draft.knowledge).toEqual({
      enabled: true,
      rootPath: "/repo/docs/wiki2",
    });
  });

  it("★projectId·ownerId·seedId·tools 는 수정값이 무엇이든 원본이 이긴다", () => {
    const hostile = {
      ...toBotDefinitionEdit(saved),
      // 허용 목록 밖 필드를 억지로 실어 보낸다 — 통과하면 안 된다.
      projectId: "다른-프로젝트",
      ownerId: "다른-사용자",
      seedId: "다른-시드",
      tools: ["exfiltrate"],
      id: "다른-문서",
    } as unknown as BotDefinitionEdit;

    const draft = applyBotDefinitionEdit(saved, hostile);

    expect(draft.projectId).toBe("project-1");
    expect(draft.ownerId).toBe("user-1");
    expect(draft.seedId).toBe("knowledge-assistant");
    expect(draft.tools).toEqual(["wiki_query", "filesystem"]);
    expect(draft).not.toHaveProperty("id");
    expect(draft).not.toHaveProperty("createdAt");
    expect(draft).not.toHaveProperty("updatedAt");
  });

  it("Knowledge 를 끄면 rootPath 가 남지 않는다 — 껐는데 경로가 살아 있는 상태 금지", () => {
    const draft = applyBotDefinitionEdit(saved, {
      ...toBotDefinitionEdit(saved),
      knowledge: { enabled: false, rootPath: "/repo/docs/wiki" },
    });

    expect(draft.knowledge).toEqual({ enabled: false, rootPath: "" });
    expect(validateBotDefinition(draft).ok).toBe(true);
  });

  it("Knowledge 를 켰는데 root 가 비면 저장 전에 검증에서 막힌다", () => {
    const draft = applyBotDefinitionEdit(saved, {
      ...toBotDefinitionEdit(saved),
      knowledge: { enabled: true, rootPath: "  " },
    });

    expect(validateBotDefinition(draft)).toEqual({
      ok: false,
      issues: ["knowledge_root_required"],
    });
  });

  it("이름을 비우면 검증에서 막힌다 — 빈 이름으로 덮어쓰는 사고 방지", () => {
    const draft = applyBotDefinitionEdit(saved, {
      ...toBotDefinitionEdit(saved),
      name: "   ",
    });

    expect(validateBotDefinition(draft)).toEqual({
      ok: false,
      issues: ["missing_name"],
    });
  });

  it("커스텀 봇(seedId 없음)은 seedId 키 자체가 실리지 않는다", () => {
    const { seedId: _seedId, ...custom } = saved;
    const draft = applyBotDefinitionEdit(
      custom as BotDefinition,
      toBotDefinitionEdit(custom as BotDefinition),
    );

    expect(draft).not.toHaveProperty("seedId");
  });

  it("knowledge 는 복사본이다 — 폼에서 고쳐도 원본 봇이 오염되지 않는다", () => {
    const edit = toBotDefinitionEdit(saved);
    edit.knowledge.rootPath = "/tampered";

    expect(saved.knowledge.rootPath).toBe("/repo/docs/wiki");
  });
});
