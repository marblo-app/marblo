/**
 * project kind (dev | assistant) 계약 — 기본값·기본 서피스·MEMORY 시드.
 */
import { describe, expect, it, vi } from "vitest";
import {
  ASSISTANT_MEMORY_FILENAME,
  ASSISTANT_MEMORY_SEED,
  applyAssistantDefaultSurface,
  defaultBeginnerTabForKind,
  defaultRightTabForKind,
  ensureAssistantMemoryFile,
  isAssistantProject,
  isProjectKind,
  normalizeProjectKind,
  shouldNudgeAssistantWorkTab,
  withNormalizedKind,
} from "../../src/lib/projectKind";
import { BEGINNER_CHAT_TAB } from "../../src/lib/beginnerTabs";

describe("normalizeProjectKind", () => {
  it("유효값만 통과하고 나머지는 dev", () => {
    expect(normalizeProjectKind("dev")).toBe("dev");
    expect(normalizeProjectKind("assistant")).toBe("assistant");
    expect(normalizeProjectKind(undefined)).toBe("dev");
    expect(normalizeProjectKind(null)).toBe("dev");
    expect(normalizeProjectKind("")).toBe("dev");
    expect(normalizeProjectKind("other")).toBe("dev");
  });

  it("isProjectKind 가 좁혀 준다", () => {
    expect(isProjectKind("dev")).toBe(true);
    expect(isProjectKind("assistant")).toBe(true);
    expect(isProjectKind("board")).toBe(false);
  });
});

describe("isAssistantProject", () => {
  it("kind=assistant 만 true (구문서는 false)", () => {
    expect(isAssistantProject({ kind: "assistant" })).toBe(true);
    expect(isAssistantProject({ kind: "dev" })).toBe(false);
    expect(isAssistantProject({})).toBe(false);
    expect(isAssistantProject(null)).toBe(false);
    expect(isAssistantProject(undefined)).toBe(false);
  });
});

describe("default surfaces", () => {
  it("dev 는 board, assistant 는 code", () => {
    expect(defaultRightTabForKind("dev")).toBe("board");
    expect(defaultRightTabForKind(undefined)).toBe("board");
    expect(defaultRightTabForKind("assistant")).toBe("code");
  });

  it("심플 셸은 kind 무관 대화 기본", () => {
    expect(defaultBeginnerTabForKind("dev")).toBe(BEGINNER_CHAT_TAB);
    expect(defaultBeginnerTabForKind("assistant")).toBe(BEGINNER_CHAT_TAB);
  });

  it("board 중심 탭만 assistant 로 넛지한다", () => {
    expect(shouldNudgeAssistantWorkTab("board")).toBe(true);
    expect(shouldNudgeAssistantWorkTab("startHere")).toBe(true);
    expect(shouldNudgeAssistantWorkTab("lanes")).toBe(true);
    expect(shouldNudgeAssistantWorkTab("history")).toBe(true);
    expect(shouldNudgeAssistantWorkTab("code")).toBe(false);
    expect(shouldNudgeAssistantWorkTab("harness")).toBe(false);
    expect(shouldNudgeAssistantWorkTab("settings")).toBe(false);
  });
});

describe("applyAssistantDefaultSurface", () => {
  it("board 이면 code 로 옮기고 파일트리·문서그래프를 연다", () => {
    const setActiveTab = vi.fn();
    const setFileTreeOpen = vi.fn();
    const revealDocGraph = vi.fn();
    applyAssistantDefaultSurface({
      activeTab: "board",
      setActiveTab,
      setFileTreeOpen,
      revealDocGraph,
    });
    expect(setActiveTab).toHaveBeenCalledWith("code");
    expect(setFileTreeOpen).toHaveBeenCalledWith(true);
    expect(revealDocGraph).toHaveBeenCalledTimes(1);
  });

  it("이미 harness 이면 탭은 건드리지 않는다", () => {
    const setActiveTab = vi.fn();
    applyAssistantDefaultSurface({
      activeTab: "harness",
      setActiveTab,
      setFileTreeOpen: vi.fn(),
      revealDocGraph: vi.fn(),
    });
    expect(setActiveTab).not.toHaveBeenCalled();
  });
});

describe("ensureAssistantMemoryFile", () => {
  it("없으면 시드하고 있으면 덮지 않는다", async () => {
    const writes: Array<{ path: string; content: string }> = [];
    const io = {
      readFile: vi.fn(async () => {
        throw new Error("ENOENT");
      }),
      writeFile: vi.fn(async (_root: string, path: string, content: string) => {
        writes.push({ path, content });
      }),
    };
    await expect(
      ensureAssistantMemoryFile("/wiki", io),
    ).resolves.toBe("created");
    expect(writes).toEqual([
      { path: ASSISTANT_MEMORY_FILENAME, content: ASSISTANT_MEMORY_SEED },
    ]);

    io.readFile = vi.fn(async () => "# existing\n");
    io.writeFile = vi.fn();
    await expect(
      ensureAssistantMemoryFile("/wiki", io),
    ).resolves.toBe("exists");
    expect(io.writeFile).not.toHaveBeenCalled();
  });

  it("folderPath 없으면 skipped", async () => {
    await expect(ensureAssistantMemoryFile(null)).resolves.toBe("skipped");
    await expect(ensureAssistantMemoryFile("")).resolves.toBe("skipped");
  });
});

describe("withNormalizedKind", () => {
  it("kind 를 명시 필드로 박는다", () => {
    expect(withNormalizedKind({ name: "a" }).kind).toBe("dev");
    expect(withNormalizedKind({ name: "a", kind: "assistant" }).kind).toBe(
      "assistant",
    );
  });
});
