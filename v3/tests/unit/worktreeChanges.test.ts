import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { execFileSync } from "child_process";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { FsManager } from "../../electron/fs-manager";

/**
 * 티켓 F2WGGGVthmg7lN490PDy — "이 워크트리 보기" 를 눌러도 코드창이 하나도
 * 안 열리던 문제의 메인프로세스 쪽 절반.
 *
 * 에이전트는 작업을 커밋하고 끝내므로 완료된 티켓의 워크트리는 워킹트리가
 * 깨끗하다. 라이브 체크아웃 실측에서 50개 중 36개가 그 상태였고, 워킹트리만
 * 보는 `git status` 기반 수집은 그 36개에서 0건을 돌려줘 아무것도 못 열었다.
 *
 * 그래서 이 스위트는 **실제 git 을 돌려서** 두 가지를 고정한다:
 *  1. 커밋된 변경이 수집되는가 (getWorktreeChanges)
 *  2. 그 baseSha 기준선으로 diff 가 실제로 나오는가 (getGitDiff)
 * 2번이 특히 중요하다 — 파일 목록만 고치고 기준선을 HEAD 로 두면 파일은
 * 열리지만 diff 는 빈 화면이라 사용자 눈에는 여전히 고장난 것과 같다.
 */

let repo: string;
let manager: FsManager;

function git(args: string[], cwd: string) {
  execFileSync("git", args, {
    cwd,
    stdio: "pipe",
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: "t",
      GIT_AUTHOR_EMAIL: "t@t",
      GIT_COMMITTER_NAME: "t",
      GIT_COMMITTER_EMAIL: "t@t",
    },
  });
}

beforeAll(() => {
  manager = new FsManager();
  repo = fs.mkdtempSync(path.join(os.tmpdir(), "marblo-wtchanges-"));

  git(["init", "-b", "main"], repo);
  fs.writeFileSync(path.join(repo, "kept.ts"), "export const a = 1;\n");
  fs.writeFileSync(path.join(repo, "edited.ts"), "export const b = 1;\n");
  fs.writeFileSync(path.join(repo, "removed.ts"), "export const c = 1;\n");
  git(["add", "."], repo);
  git(["commit", "-m", "base"], repo);

  // The agent's work, already committed — invisible to `git status`.
  git(["checkout", "-b", "feature"], repo);
  fs.writeFileSync(path.join(repo, "edited.ts"), "export const b = 2;\n");
  fs.writeFileSync(path.join(repo, "added.ts"), "export const d = 1;\n");
  fs.rmSync(path.join(repo, "removed.ts"));
  git(["add", "-A"], repo);
  git(["commit", "-m", "agent work"], repo);

  // Base moves on after the fork — must NOT show up as this worktree's change.
  git(["checkout", "main"], repo);
  fs.writeFileSync(path.join(repo, "unrelated.ts"), "export const e = 1;\n");
  git(["add", "."], repo);
  git(["commit", "-m", "later work on base"], repo);
  git(["checkout", "feature"], repo);
});

afterAll(() => {
  fs.rmSync(repo, { recursive: true, force: true });
});

describe("getWorktreeChanges", () => {
  it("collects committed work that `git status` cannot see", async () => {
    // The precondition for the whole bug: the working tree is clean.
    expect(Object.keys(await manager.getGitStatus(repo))).toHaveLength(0);

    const { files } = await manager.getWorktreeChanges(repo, "main");
    const byPath = Object.fromEntries(files.map((f) => [f.relPath, f.status]));

    expect(byPath["edited.ts"]).toBe("M");
    expect(byPath["added.ts"]).toBe("A");
    expect(byPath["removed.ts"]).toBe("D");
    expect(byPath["kept.ts"]).toBeUndefined();
  });

  it("ignores commits base gained after the fork point", async () => {
    const { files } = await manager.getWorktreeChanges(repo, "main");
    // merge-base pins the fork point; without it "unrelated.ts" would surface
    // as a deletion in this worktree.
    expect(files.map((f) => f.relPath)).not.toContain("unrelated.ts");
  });

  it("unions in uncommitted and untracked work", async () => {
    fs.writeFileSync(path.join(repo, "kept.ts"), "export const a = 99;\n");
    fs.writeFileSync(path.join(repo, "scratch.ts"), "export const f = 1;\n");
    try {
      const { files } = await manager.getWorktreeChanges(repo, "main");
      const byPath = Object.fromEntries(
        files.map((f) => [f.relPath, f.status]),
      );
      expect(byPath["kept.ts"]).toBe("M");
      expect(byPath["scratch.ts"]).toBe("??");
      // Committed work is still there — the two sources union, not replace.
      expect(byPath["added.ts"]).toBe("A");
    } finally {
      git(["checkout", "--", "kept.ts"], repo);
      fs.rmSync(path.join(repo, "scratch.ts"));
    }
  });

  it("rejects rather than reporting an empty change set on failure", async () => {
    // A failed collection must be distinguishable from "nothing changed" —
    // reporting it as clean is what made the broken path look honest.
    await expect(
      manager.getWorktreeChanges(repo, "no-such-ref"),
    ).rejects.toThrow();
  });
});

describe("getGitDiff baseline", () => {
  it("renders committed work against baseSha, but not against HEAD", async () => {
    const { baseSha } = await manager.getWorktreeChanges(repo, "main");
    const file = path.join(repo, "edited.ts");

    const withBase = await manager.getGitDiff(file, baseSha);
    expect(withBase.original).toBe("export const b = 1;\n");
    expect(withBase.modified).toBe("export const b = 2;\n");

    // The old behaviour: HEAD already contains the commit, so the surface had
    // nothing to show even once the file was open.
    const withHead = await manager.getGitDiff(file);
    expect(withHead.original).toBe(withHead.modified);
  });

  it("treats a file absent from the baseline as an addition", async () => {
    const { baseSha } = await manager.getWorktreeChanges(repo, "main");
    const res = await manager.getGitDiff(path.join(repo, "added.ts"), baseSha);
    expect(res.original).toBe("");
    expect(res.modified).toBe("export const d = 1;\n");
  });
});
