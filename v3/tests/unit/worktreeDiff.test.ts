import { beforeEach, describe, expect, it, vi } from "vitest";

vi.stubGlobal("window", {});

const { openWorktreeDiff, toChangedFiles } = await import(
  "../../src/lib/worktreeDiff"
);
const { useEditorStore } = await import("../../src/stores/editorStore");
const { useWorktreeDiffStore } = await import(
  "../../src/stores/worktreeDiffStore"
);

import type { Worktree } from "../../src/types/worktree";

/**
 * 티켓 Sm1RfWx4F6DLEn1mZkai — "이 워크트리 보기" 를 눌러도 diff 가 자동으로
 * 안 열리던 문제.
 *
 * PR#476 은 파일트리 + 에이전트만 워크트리에 동기화하고 diff 는 건드리지
 * 않았다. 이 테스트는 openWorktreeDiff 가 (a) 변경 파일을 실제로 열고 diff 모드로
 * 전환하는지, 그리고 (b) diff 가 안 열리는 모든 경우에 **왜** 안 열렸는지를
 * 명시적 상태로 남기는지를 고정한다. (b) 가 핵심이다 — PR#489 의 버그가
 * "조용한 미렌더" 였으므로, 여기서 조용히 no-op 하는 경로가 생기면 같은 함정을
 * 되풀이한다.
 */

const WT = "/tmp/wt/feature-x";

function worktree(overrides: Partial<Worktree> = {}): Worktree {
  return {
    id: "wt-1",
    taskId: "T1",
    projectId: "p1",
    agentId: null,
    branch: "feature-x",
    baseRef: "main",
    path: WT,
    repoRoot: "/tmp/repo",
    createdAt: null,
    ...overrides,
  };
}

function installFs(opts: {
  gitStatus: () => Promise<Record<string, string>>;
  readFile?: (root: string, p: string) => Promise<string>;
}) {
  (window as unknown as { electronAPI: unknown }).electronAPI = {
    fs: {
      gitStatus: vi.fn(opts.gitStatus),
      readFile: vi.fn(
        opts.readFile ?? (async (_root: string, p: string) => `content:${p}`),
      ),
    },
  };
}

beforeEach(() => {
  useEditorStore.setState({
    rootPath: WT,
    openFiles: [],
    activeFilePath: null,
    showDiff: false,
    saveError: null,
  });
  useWorktreeDiffStore.setState({ state: { kind: "idle" }, requestSeq: 0 });
});

describe("toChangedFiles", () => {
  it("marks deletions unopenable and sorts openable files first", () => {
    const files = toChangedFiles(
      {
        [`${WT}/z.ts`]: "M",
        [`${WT}/gone.ts`]: "D",
        [`${WT}/a.ts`]: "??",
      },
      WT,
    );

    expect(files.map((f) => f.relPath)).toEqual(["a.ts", "z.ts", "gone.ts"]);
    expect(files.map((f) => f.openable)).toEqual([true, true, false]);
  });

  it("treats staged-then-deleted codes (MD/AD) as unopenable", () => {
    const files = toChangedFiles({ [`${WT}/x.ts`]: "MD" }, WT);
    expect(files[0].openable).toBe(false);
  });

  it("resolves a rename entry to its destination path", () => {
    const files = toChangedFiles({ [`${WT}/old.ts -> new.ts`]: "R" }, WT);
    expect(files[0].path).toBe(`${WT}/new.ts`);
    expect(files[0].relPath).toBe("new.ts");
    expect(files[0].openable).toBe(true);
  });
});

describe("openWorktreeDiff", () => {
  it("opens the first changed file and turns on diff mode", async () => {
    installFs({
      gitStatus: async () => ({ [`${WT}/src/a.ts`]: "M", [`${WT}/b.ts`]: "M" }),
    });

    await openWorktreeDiff(worktree());

    const editor = useEditorStore.getState();
    expect(editor.activeFilePath).toBe(`${WT}/b.ts`); // sorted by relPath
    expect(editor.showDiff).toBe(true);

    const state = useWorktreeDiffStore.getState().state;
    expect(state.kind).toBe("opened");
    if (state.kind === "opened") {
      expect(state.openedPath).toBe(`${WT}/b.ts`);
      expect(state.files).toHaveLength(2);
    }
  });

  it("reports committedOnly — not 'no changes' — when the branch has commits", async () => {
    installFs({ gitStatus: async () => ({}) });

    await openWorktreeDiff(
      worktree({
        status: {
          branch: "feature-x",
          baseRef: "main",
          ahead: 3,
          behind: 0,
          dirty: false,
          mergeable: true,
          conflicts: [],
          filesChanged: 7,
          insertions: 100,
          deletions: 2,
        },
      }),
    );

    const state = useWorktreeDiffStore.getState().state;
    expect(state.kind).toBe("committedOnly");
    if (state.kind === "committedOnly") expect(state.filesChanged).toBe(7);
    expect(useEditorStore.getState().showDiff).toBe(false);
  });

  it("reports clean when neither the working tree nor the branch has changes", async () => {
    installFs({ gitStatus: async () => ({}) });
    await openWorktreeDiff(worktree());
    expect(useWorktreeDiffStore.getState().state.kind).toBe("clean");
  });

  it("reports deletionsOnly when every change is a deletion", async () => {
    installFs({ gitStatus: async () => ({ [`${WT}/gone.ts`]: "D" }) });
    await openWorktreeDiff(worktree());
    expect(useWorktreeDiffStore.getState().state.kind).toBe("deletionsOnly");
  });

  it("surfaces a git status failure instead of failing silently", async () => {
    installFs({
      gitStatus: async () => {
        throw new Error("not a git repository");
      },
    });

    await openWorktreeDiff(worktree());

    const state = useWorktreeDiffStore.getState().state;
    expect(state.kind).toBe("error");
    if (state.kind === "error") {
      expect(state.message).toContain("not a git repository");
    }
  });

  it("surfaces an unreadable file — editorStore.openFile swallows the error", async () => {
    installFs({
      gitStatus: async () => ({ [`${WT}/a.ts`]: "M" }),
      readFile: async () => {
        throw new Error("EACCES");
      },
    });

    await openWorktreeDiff(worktree());

    expect(useWorktreeDiffStore.getState().state.kind).toBe("error");
    expect(useEditorStore.getState().showDiff).toBe(false);
  });

  it("does not touch the editor when the root moved on during git status", async () => {
    installFs({
      gitStatus: async () => {
        // The user clicks another worktree while git status is in flight.
        useEditorStore.setState({ rootPath: "/tmp/wt/other" });
        return { [`${WT}/a.ts`]: "M" };
      },
    });

    await openWorktreeDiff(worktree());

    expect(useEditorStore.getState().openFiles).toHaveLength(0);
    expect(useEditorStore.getState().showDiff).toBe(false);
  });

  it("lets the newer click win when two worktrees are opened back to back", async () => {
    const stale = useWorktreeDiffStore.getState().nextRequest();
    // A newer request has since started...
    useWorktreeDiffStore.getState().nextRequest();

    useWorktreeDiffStore
      .getState()
      .settle(stale, { kind: "clean", worktreeId: "old", worktreePath: "/old" });

    expect(useWorktreeDiffStore.getState().state.kind).toBe("idle");
  });
});
