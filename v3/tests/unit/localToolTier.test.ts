/**
 * 로컬 모델 tool-use **3티어** 경계 + 프로파일 매핑 고정 (FTpA0okG26XqOusctR5H).
 *
 * 이 파일이 지키는 것:
 *  1. **경계** — 25B / 30B 두 임계가 상수 하나씩으로 모여 있고, 그 양쪽 값이
 *     정확히 chat-only / tool-use-lite / tool-use 로 갈린다.
 *  2. **회귀 금지** — qwen2.5-coder:7b·qwen3:14b 는 계속 chat-only,
 *     qwen3:30b·qwen3:32b 는 계속 tool-use. 이 4개가 티켓이 명시한 고정점이다.
 *  3. **프로파일 매핑** — 티어가 스폰 프로파일로 옮겨지는 축(localProfileForPinnedModel)
 *     이 3갈래로 갈리고, 로컬이 아닌 모델은 종전대로 "full" 이다.
 *  4. **override** — 크기 규칙을 덮는 행 단위 예외가 실제로 동작하고, 근거
 *     문자열이 행에 남는다.
 *  5. **MCP 표면** — lite 프로파일이 쓰는 `local-lite` 표면이 에이전트 구실에
 *     필요한 최소 툴(티켓 조회·활동기록·상태변경·완료보고·막힘)을 전부 갖는다.
 *
 * ★임계값 자체는 추정치다(local-tool-tier.ts 헤더 참조). 이 테스트가 고정하는
 * 것은 "그 값이 옳다"가 아니라 "그 값이 한 곳에 있고 일관되게 적용된다"이다.
 * 실측으로 경계가 바뀌면 상수와 이 파일의 기대값을 함께 고친다.
 */
import { describe, it, expect } from "vitest";
import {
  LOCAL_TOOL_USE_LITE_MIN_BILLIONS,
  LOCAL_TOOL_USE_MIN_BILLIONS,
  isToolCapableToolSupport,
  localToolSupportLabel,
  parseLocalParamBillions,
  resolveLocalToolSupport,
} from "../../electron/local-tool-tier";
import {
  buildLocalCatalogEntry,
  catalogEntry,
  isLocalChatOnlyModel,
  isLocalToolUseLiteModel,
  toolSupportForLocalModelId,
} from "../../electron/local-models";
import {
  isLocalToolProfile,
  localLiteRoleBrief,
  localProfileForPinnedModel,
} from "../../electron/agent-config";
import {
  LOCAL_LITE_MCP_TOOLS,
  resolveToolSurface,
} from "../../electron/mcp-server/tool-surface";

describe("티어 경계 (25B / 30B)", () => {
  it("경계값은 상수 두 개로만 존재한다", () => {
    expect(LOCAL_TOOL_USE_LITE_MIN_BILLIONS).toBe(25);
    expect(LOCAL_TOOL_USE_MIN_BILLIONS).toBe(30);
    expect(LOCAL_TOOL_USE_LITE_MIN_BILLIONS).toBeLessThan(
      LOCAL_TOOL_USE_MIN_BILLIONS,
    );
  });

  it("경계 바로 아래/위가 정확히 갈린다", () => {
    expect(resolveLocalToolSupport("x:24b")).toBe("chat-only");
    expect(resolveLocalToolSupport("x:24.9b")).toBe("chat-only");
    expect(resolveLocalToolSupport("x:25b")).toBe("tool-use-lite");
    expect(resolveLocalToolSupport("x:27b")).toBe("tool-use-lite");
    expect(resolveLocalToolSupport("x:29.9b")).toBe("tool-use-lite");
    expect(resolveLocalToolSupport("x:30b")).toBe("tool-use");
    expect(resolveLocalToolSupport("x:70b")).toBe("tool-use");
  });

  it("규모를 못 읽으면 안전하게 chat-only", () => {
    expect(resolveLocalToolSupport("mystery-model")).toBe("chat-only");
    expect(resolveLocalToolSupport("")).toBe("chat-only");
    expect(parseLocalParamBillions("mystery-model")).toBeNull();
  });

  it("★모델명에 소수점이 든 태그도 파라미터를 오독하지 않는다", () => {
    // `qwen3.8:27b` 의 "3.8" 은 모델 세대이지 파라미터가 아니다.
    expect(parseLocalParamBillions("qwen3.8:27b")).toBe(27);
    expect(parseLocalParamBillions("qwen2.5-coder:7b")).toBe(7);
    expect(parseLocalParamBillions("qwen3:30b")).toBe(30);
    expect(parseLocalParamBillions("phi3:mini")).toBe(3.8);
  });

  it("티어마다 배지 문구가 서로 다르다 (lite 가 대화전용으로 보이면 안 된다)", () => {
    const labels = [
      localToolSupportLabel("chat-only"),
      localToolSupportLabel("tool-use-lite"),
      localToolSupportLabel("tool-use"),
    ];
    expect(new Set(labels).size).toBe(3);
    expect(labels[1]).toContain("도구 사용 가능");
    expect(isToolCapableToolSupport("chat-only")).toBe(false);
    expect(isToolCapableToolSupport("tool-use-lite")).toBe(true);
    expect(isToolCapableToolSupport("tool-use")).toBe(true);
  });
});

describe("★회귀 금지 — 티켓이 명시한 고정점", () => {
  it("qwen2.5-coder:7b · qwen3:14b 는 계속 chat-only", () => {
    expect(toolSupportForLocalModelId("qwen2.5-coder:7b")).toBe("chat-only");
    expect(toolSupportForLocalModelId("qwen3:14b")).toBe("chat-only");
    expect(isLocalChatOnlyModel("qwen2.5-coder:7b")).toBe(true);
    expect(isLocalChatOnlyModel("qwen3:14b")).toBe(true);
    expect(localProfileForPinnedModel("local", "qwen2.5-coder:7b")).toBe(
      "chat-only",
    );
    expect(localProfileForPinnedModel("local", "qwen3:14b")).toBe("chat-only");
  });

  it("qwen3:30b · qwen3:32b 는 계속 tool-use(경량 티어로 강등되지 않는다)", () => {
    expect(toolSupportForLocalModelId("qwen3:30b")).toBe("tool-use");
    expect(toolSupportForLocalModelId("qwen3:32b")).toBe("tool-use");
    expect(localProfileForPinnedModel("local", "qwen3:30b")).toBe(
      "local-tool-use",
    );
    expect(localProfileForPinnedModel("local", "qwen3:32b")).toBe(
      "local-tool-use",
    );
  });
});

describe("Qwen 3.8 27B 카탈로그 행", () => {
  it("ollama 실측 태그 `qwen3.8:27b` 로 등록돼 있다", () => {
    // ★`qwen3:27b` 은 ollama 에 존재하지 않는다(qwen3 라이브러리는 0.6b/1.7b/
    // 14b/30b/32b/235b). 27B 는 별도 라이브러리 `qwen3.8` 로 배포된다.
    expect(catalogEntry("qwen3:27b")).toBeUndefined();
    expect(catalogEntry("qwen3.8:27b")).toMatchObject({
      id: "qwen3.8:27b",
      toolSupport: "tool-use-lite",
      // 태그 페이지 실측값(18GB / 256K).
      downloadSizeMB: 18_000,
      contextTokens: 256_000,
    });
  });

  it("하드웨어 게이트가 걸리도록 메모리 추정치가 들어 있다", () => {
    const entry = catalogEntry("qwen3.8:27b");
    expect(entry?.minRamGB).toBeGreaterThan(0);
    // 같은 27B 급(gemma3:27b, 17GB) 큐레이션과 어긋나지 않는다.
    expect(entry?.minRamGB).toBe(catalogEntry("gemma3:27b")?.minRamGB);
  });

  it("경량 티어로 판정된다", () => {
    expect(isLocalToolUseLiteModel("qwen3.8:27b")).toBe(true);
    expect(isLocalChatOnlyModel("qwen3.8:27b")).toBe(false);
    expect(localProfileForPinnedModel("local", "qwen3.8:27b")).toBe(
      "local-tool-use-lite",
    );
  });
});

describe("행 단위 toolSupport override", () => {
  it("크기 규칙을 덮고 근거를 행에 남긴다", () => {
    const forced = buildLocalCatalogEntry({
      id: "somecoder:22b",
      displayName: "Some Coder 22B",
      category: "coding",
      categoryLabel: "코딩 특화",
      downloadSizeMB: 13_000,
      minRamGB: 32,
      contextTokens: 32_000,
      toolSupport: "tool-use-lite",
      toolSupportOverrideReason: "코더 특화 — 규모 규칙으로 판단 불가",
    });
    // 크기 규칙만 봤으면 chat-only 였을 행이다.
    expect(resolveLocalToolSupport("somecoder:22b")).toBe("chat-only");
    expect(forced.toolSupport).toBe("tool-use-lite");
    expect(forced.toolSupportLabel).toBe(
      localToolSupportLabel("tool-use-lite"),
    );
    expect(forced.toolSupportOverrideReason).toContain("코더 특화");
  });

  it("override 없는 행은 근거 필드가 비어 있다", () => {
    const plain = buildLocalCatalogEntry({
      id: "plain:8b",
      displayName: "Plain 8B",
      category: "general",
      categoryLabel: "범용",
      downloadSizeMB: 5_000,
      minRamGB: 12,
      contextTokens: 32_000,
    });
    expect(plain.toolSupport).toBe("chat-only");
    expect(plain.toolSupportOverrideReason).toBeUndefined();
  });

  it("코더 특화 2종은 override 로 chat-only 가 '결정'으로 고정돼 있다", () => {
    for (const id of ["devstral:24b", "codestral:22b"]) {
      const row = catalogEntry(id);
      expect(row?.toolSupport).toBe("chat-only");
      expect(row?.toolSupportOverrideReason).toBeTruthy();
    }
  });
});

describe("프로파일 매핑", () => {
  it("로컬이 아니면 종전대로 full", () => {
    expect(localProfileForPinnedModel("claude", "opus")).toBe("full");
    expect(localProfileForPinnedModel("claude", undefined)).toBe("full");
    expect(localProfileForPinnedModel("local", "   ")).toBe("full");
  });

  it("세 티어가 세 프로파일로 1:1 대응된다", () => {
    expect(localProfileForPinnedModel("local", "qwen2.5:0.5b")).toBe(
      "chat-only",
    );
    expect(localProfileForPinnedModel("local", "qwen3.8:27b")).toBe(
      "local-tool-use-lite",
    );
    expect(localProfileForPinnedModel("local", "llama3.3:70b")).toBe(
      "local-tool-use",
    );
  });

  it("isLocalToolProfile 은 도구를 싣는 두 프로파일만 참", () => {
    expect(isLocalToolProfile("chat-only")).toBe(false);
    expect(isLocalToolProfile("full")).toBe(false);
    expect(isLocalToolProfile("local-tool-use")).toBe(true);
    expect(isLocalToolProfile("local-tool-use-lite")).toBe(true);
  });

  it("lite 브리프는 짧고, 없는 툴을 지시하지 않는다", () => {
    const brief = localLiteRoleBrief("backend");
    expect(brief).toContain("backend");
    // 길이 자체가 이 티어의 존재 이유다 — 역할 스킬 전문(수 KB)의 대체물이다.
    expect(brief.length).toBeLessThan(1_200);
    // 브리프가 언급하는 툴은 전부 local-lite 표면에 실제로 존재해야 한다.
    // (없는 툴을 지시하면 로컬 모델이 가짜 tool_use JSON 을 뱉는다.)
    for (const tool of ["get_task", "add_activity", "submit_for_review"]) {
      expect(brief).toContain(tool);
      expect(LOCAL_LITE_MCP_TOOLS).toContain(tool);
    }
    expect(brief).not.toContain("claim_task");
    expect(brief).not.toContain("get_agent_skill");
  });
});

describe("local-lite MCP 표면", () => {
  it("MARBLO_TOOL_SURFACE=local-lite 가 5툴로 스코핑된다", () => {
    const surface = resolveToolSurface({
      MARBLO_TOOL_SURFACE: "local-lite",
      MARBLO_AGENT_ROLE: "backend",
    });
    expect(surface.mode).toBe("scoped");
    expect(surface.reason).toBe("override=local-lite");
    expect([...(surface.allowed ?? [])].sort()).toEqual(
      [...LOCAL_LITE_MCP_TOOLS].sort(),
    );
  });

  it("★에이전트 구실에 필요한 최소 툴이 전부 있다", () => {
    // 티켓 조회 / 활동기록 / 상태변경 — 티켓이 명시한 하한선.
    expect(LOCAL_LITE_MCP_TOOLS).toContain("get_task");
    expect(LOCAL_LITE_MCP_TOOLS).toContain("add_activity");
    expect(LOCAL_LITE_MCP_TOOLS).toContain("update_task_status");
    // 완료 보고와 막힘 경로가 없으면 실패가 조용해진다.
    expect(LOCAL_LITE_MCP_TOOLS).toContain("submit_for_review");
    expect(LOCAL_LITE_MCP_TOOLS).toContain("ask_orchestrator");
  });

  it("역할 추가분·탐색 계열은 빠져 있다(경량의 정의)", () => {
    for (const tool of [
      "get_available_tasks",
      "claim_task",
      "search_tasks",
      "get_agent_skill",
      "wiki_query",
    ]) {
      expect(LOCAL_LITE_MCP_TOOLS).not.toContain(tool);
    }
    // full 워커 표면보다 확실히 작다.
    const full = resolveToolSurface({
      MARBLO_TOOL_SURFACE: "scoped",
      MARBLO_AGENT_ROLE: "backend",
    });
    expect(LOCAL_LITE_MCP_TOOLS.length).toBeLessThan(
      (full.allowed ?? new Set()).size,
    );
  });

  it("기존 local-light(30B+) 표면은 건드리지 않는다", () => {
    const surface = resolveToolSurface({
      MARBLO_TOOL_SURFACE: "local-light",
      MARBLO_AGENT_ROLE: "backend",
    });
    expect([...(surface.allowed ?? [])].sort()).toEqual([
      "add_activity",
      "ask_orchestrator",
      "submit_for_review",
      "update_task_status",
    ]);
  });
});
