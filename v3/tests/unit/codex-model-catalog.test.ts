import { describe, it, expect } from "vitest";
import {
  buildCodexModelCatalog,
  pickCodexReferenceModelInfo,
  renderCodexModelCatalogJson,
  type CodexModelInfo,
} from "../../electron/codex-model-catalog";
import { renderCodexVendorProviderToml } from "../../electron/codex-vendor-provider";

/**
 * codex 가 실제로 들려주는 ModelInfo 의 축소판. 카탈로그가 요구하는 프롬프트
 * 템플릿과, 우리가 성질로 거르는 축들만 담았다.
 */
function referenceModelInfo(
  overrides: Partial<CodexModelInfo> = {},
): CodexModelInfo {
  return {
    slug: "gpt-5.5",
    display_name: "GPT-5.5",
    apply_patch_tool_type: "freeform",
    shell_type: "shell_command",
    tool_mode: null,
    visibility: "list",
    supported_in_api: true,
    priority: 7,
    support_verbosity: true,
    web_search_tool_type: "text_and_image",
    supports_search_tool: true,
    input_modalities: ["text", "image"],
    supports_reasoning_summaries: true,
    prefer_websockets: true,
    context_window: 272_000,
    max_context_window: 272_000,
    truncation_policy: { mode: "tokens", limit: 10_000 },
    experimental_supported_tools: [],
    supported_reasoning_levels: [{ effort: "medium", description: "d" }],
    model_messages: {
      instructions_template: "You are Codex, a coding agent based on GPT-5.",
    },
    ...overrides,
  };
}

describe("pickCodexReferenceModelInfo", () => {
  it("skips code_mode_only models — they ship no tools array at all", () => {
    const picked = pickCodexReferenceModelInfo([
      referenceModelInfo({
        slug: "gpt-5.6-terra",
        tool_mode: "code_mode_only",
        priority: 1,
      }),
      referenceModelInfo({ slug: "gpt-5.5", priority: 7 }),
    ]);
    expect(picked?.slug).toBe("gpt-5.5");
  });

  it("skips models without an instructions template (catalog would not parse)", () => {
    const picked = pickCodexReferenceModelInfo([
      referenceModelInfo({ slug: "bare", priority: 1, model_messages: {} }),
      referenceModelInfo({ slug: "gpt-5.4", priority: 8 }),
    ]);
    expect(picked?.slug).toBe("gpt-5.4");
  });

  it("skips models that do not use freeform apply_patch", () => {
    expect(
      pickCodexReferenceModelInfo([
        referenceModelInfo({ apply_patch_tool_type: null }),
      ]),
    ).toBeNull();
  });

  it("is deterministic: lowest priority wins, then slug order", () => {
    const picked = pickCodexReferenceModelInfo([
      referenceModelInfo({ slug: "b", priority: 3 }),
      referenceModelInfo({ slug: "a", priority: 3 }),
      referenceModelInfo({ slug: "z", priority: 9 }),
    ]);
    expect(picked?.slug).toBe("a");
  });

  it("accepts base_instructions in place of a message template", () => {
    const picked = pickCodexReferenceModelInfo([
      referenceModelInfo({
        slug: "plain",
        model_messages: {},
        base_instructions: "You are Codex.",
      }),
    ]);
    expect(picked?.slug).toBe("plain");
  });
});

describe("buildCodexModelCatalog", () => {
  const models = [referenceModelInfo()];

  it("★no catalog for openai gpt models — codex already knows them, and the " +
    "catalog REPLACES the built-in one, so emitting it would be a regression", () => {
    for (const id of ["gpt-5.6-sol", "gpt-5.5", "gpt-5.4-mini"]) {
      expect(buildCodexModelCatalog(id, { models })).toBeNull();
    }
  });

  it("★no catalog for claude-harness env-swap vendors — GLM/MiniMax/Kimi spawn " +
    "the claude binary and never touch codex's model catalog", () => {
    for (const id of ["glm-5.2", "glm-4.7", "MiniMax-M3", "k3", "kimi-for-coding"]) {
      expect(buildCodexModelCatalog(id, { models })).toBeNull();
    }
  });

  it("returns null when no usable reference ModelInfo is available", () => {
    expect(buildCodexModelCatalog("solar-pro4", { models: [] })).toBeNull();
  });

  it("returns null without a pinned model", () => {
    expect(buildCodexModelCatalog(undefined, { models })).toBeNull();
  });

  for (const id of ["solar-pro4", "deepseek-v4-flash", "deepseek-v4-pro"]) {
    it(`registers freeform apply_patch for ${id}`, () => {
      const catalog = buildCodexModelCatalog(id, { models });
      expect(catalog).not.toBeNull();
      const info = catalog!.models[0]!;
      expect(catalog!.models).toHaveLength(1);
      expect(info.slug).toBe(id);
      // ★이 한 줄이 이 티켓 전체다.
      expect(info.apply_patch_tool_type).toBe("freeform");
      // code_mode_only 면 tools 배열 자체가 안 실린다.
      expect(info.tool_mode).toBeNull();
      // 프롬프트 템플릿은 설치된 codex 것을 그대로 물려받는다.
      expect(info.model_messages).toEqual(models[0]!.model_messages);
    });
  }

  it("drops hosted web_search rather than nulling it (null fails to parse)", () => {
    const info = buildCodexModelCatalog("solar-pro4", { models })!.models[0]!;
    expect("web_search_tool_type" in info).toBe(false);
    expect(info.supports_search_tool).toBe(false);
  });

  it("turns off verbosity so codex stops adding a `text` block vendors reject", () => {
    const info = buildCodexModelCatalog("solar-pro4", { models })!.models[0]!;
    expect(info.support_verbosity).toBe(false);
  });

  it("uses the registry's effort axis, not the reference model's", () => {
    const info = buildCodexModelCatalog("solar-pro4", { models })!.models[0]!;
    expect(info.supported_reasoning_levels).toEqual([
      { effort: "low", description: expect.any(String) },
      { effort: "medium", description: expect.any(String) },
      { effort: "high", description: expect.any(String) },
    ]);
    expect(info.default_reasoning_level).toBe("medium");
  });

  it("uses the sourced context window, not the reference model's", () => {
    const solar = buildCodexModelCatalog("solar-pro4", { models })!.models[0]!;
    expect(solar.context_window).toBe(512_000);
    const deepseek = buildCodexModelCatalog("deepseek-v4-pro", { models })!
      .models[0]!;
    expect(deepseek.context_window).toBe(1_000_000);
  });

  it("renders a JSON document codex can read", () => {
    const json = renderCodexModelCatalogJson(
      buildCodexModelCatalog("solar-pro4", { models })!,
    );
    const parsed = JSON.parse(json) as { models: CodexModelInfo[] };
    expect(parsed.models[0]!.slug).toBe("solar-pro4");
  });
});

describe("renderCodexVendorProviderToml + model_catalog_json", () => {
  const override = {
    providerId: "upstage" as const,
    name: "Upstage Solar",
    upstreamBaseUrl: "https://api.upstage.ai/v1",
    envKey: "UPSTAGE_API_KEY",
    wireApi: "responses" as const,
    needsChatBridge: true,
  };

  it("★places model_catalog_json BEFORE [model_providers.*] — a top-level key " +
    "written after the table is absorbed into it and the config fails to load", () => {
    const toml = renderCodexVendorProviderToml(
      override,
      "http://127.0.0.1:1234/v1",
      "/tmp/model-catalog.json",
    );
    const keyAt = toml.indexOf("model_catalog_json");
    const tableAt = toml.indexOf("[model_providers.");
    expect(keyAt).toBeGreaterThan(-1);
    expect(keyAt).toBeLessThan(tableAt);
    expect(toml).toContain('model_catalog_json = "/tmp/model-catalog.json"');
  });

  it("omits the key entirely when there is no catalog", () => {
    const toml = renderCodexVendorProviderToml(override, "https://x/v1");
    expect(toml).not.toContain("model_catalog_json");
  });
});
