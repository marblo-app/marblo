import { beforeEach, describe, expect, it, vi } from "vitest";
import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { WorktreeManager } from "../../electron/worktree-manager";
import { WorktreeCoordinator } from "../../electron/worktree-coordinator";

/**
 * TASK-010 — 워크트리 라이프사이클 통합 E2E (실제 temp git, 모킹 X).
 *
 * coordinator + manager 를 진짜 git 위에서 한 흐름으로 엮어
 * WORKTREE-SPEC §3~§6 의 핵심 시나리오를 끝까지 단언한다:
 *
 *   prepare(코디네이터) → 워크트리 생성
 *     → 워크트리 안에서 파일 커밋
 *     → manager.status 로 ahead>0 · mergeable 확인
 *     → squashMergeToBase 로 base 머지 + 워크트리/브랜치 cleanup
 *     → list 에서 사라짐
 *
 * 그리고 충돌 시나리오: base 와 워크트리가 같은 파일을 충돌나게 수정 →
 * status.mergeable=false, squashMergeToBase 는 rebase 단계에서 안전중단
 * (needsResolve) 하고 양쪽 트리를 보존.
 *
 * worktree-manager.test.ts / worktree-coordinator.test.ts 의 makeRepo 패턴을
 * 그대로 따른다 (self-contained — 다른 test 파일 import 없이 독립 실행).
 * fs.realpathSync 로 /var → /private/var (macOS) 심링크를 정규화해 경로 동등
 * 비교를 안정화한다.
 */

function git(args: string[], cwd: string): string {
  const r = spawnSync("git", args, { cwd, encoding: "utf8" });
  if (r.status !== 0)
    throw new Error(`git ${args.join(" ")} failed: ${r.stderr}`);
  return (r.stdout || "").trim();
}

/** Fresh, isolated git repo on branch `main` with one commit. No remote (offline). */
function makeRepo(): {
  repoRoot: string;
  wtRoot: string;
  mgr: WorktreeManager;
} {
  const base = fs.realpathSync(
    fs.mkdtempSync(path.join(os.tmpdir(), "marblo-wtlc-")),
  );
  const repoRoot = path.join(base, "repo");
  const wtRoot = path.join(base, "worktrees");
  fs.mkdirSync(repoRoot, { recursive: true });
  git(["init", "-b", "main"], repoRoot);
  git(["config", "user.email", "t@t.com"], repoRoot);
  git(["config", "user.name", "t"], repoRoot);
  fs.writeFileSync(path.join(repoRoot, "README.md"), "base\n");
  git(["add", "."], repoRoot);
  git(["commit", "-m", "init"], repoRoot);
  return {
    repoRoot,
    wtRoot,
    mgr: new WorktreeManager({ worktreesRoot: wtRoot }),
  };
}

describe("worktree lifecycle — clean merge E2E (coordinator → manager)", () => {
  let repoRoot: string;
  let wtRoot: string;
  let mgr: WorktreeManager;
  beforeEach(() => {
    ({ repoRoot, wtRoot, mgr } = makeRepo());
  });

  it("prepare → commit → status(ahead/mergeable) → squashMerge → cleanup → gone from list", async () => {
    // createTask 는 taskId 가 주어졌으므로 절대 호출되면 안 된다.
    const createTask = vi.fn(async () => "SHOULD_NOT_BE_CALLED");
    const coord = new WorktreeCoordinator({ worktreeManager: mgr, createTask });

    // 1) 코디네이터가 (projectId, taskId) 용 워크트리를 생성.
    const prep = await coord.prepare({
      projectId: "proj1",
      taskId: "lifecycleE2E",
      title: "Lifecycle E2E",
      repoRoot,
    });
    expect(prep.worktreeCreated).toBe(true);
    expect(prep.taskId).toBe("lifecycleE2E");
    expect(prep.cwd).toBe(path.join(wtRoot, "proj1", "lifecycleE2E"));
    expect(createTask).not.toHaveBeenCalled();
    const wtPath = prep.cwd;
    // base 커밋이 워크트리에 체크아웃됨.
    expect(fs.existsSync(path.join(wtPath, "README.md"))).toBe(true);

    // 워크트리 목록에 잡힘 + 브랜치 이름 확보 (squashMerge 에 필요).
    const before = await mgr.list(repoRoot);
    const created = before.find((w) => w.path === wtPath);
    expect(created).toBeDefined();
    const branch = created!.branch;
    expect(branch).toBe("marblo/lifecycle-e2e-lifecycl");

    // 2) 워크트리 안에서 새 파일을 커밋 (base 와 비충돌).
    fs.writeFileSync(path.join(wtPath, "feature.ts"), "export const x = 1;\n");
    git(["add", "."], wtPath);
    git(["commit", "-m", "feature work"], wtPath);

    // 3) base(main)도 다른 파일로 한 칸 전진 → squashMerge 의 rebase 단계가
    //    실제로 replay 하도록 (현실적인 머지 시나리오).
    fs.writeFileSync(path.join(repoRoot, "OTHER.md"), "other\n");
    git(["add", "."], repoRoot);
    git(["commit", "-m", "main advance"], repoRoot);

    // manager.status — ahead>0, behind 반영, mergeable=true (비충돌).
    const status = await mgr.status(wtPath, "main");
    expect(status.branch).toBe(branch);
    expect(status.baseRef).toBe("main");
    expect(status.ahead).toBeGreaterThan(0);
    expect(status.ahead).toBe(1);
    expect(status.behind).toBe(1);
    expect(status.dirty).toBe(false);
    expect(status.mergeable).toBe(true);
    expect(status.conflicts).toEqual([]);
    expect(status.filesChanged).toBe(1);
    expect(status.insertions).toBe(1);

    // 4) squashMergeToBase — rebase → squash onto main → 워크트리/브랜치 정리.
    const merge = await mgr.squashMergeToBase(repoRoot, wtPath, "main", branch);
    expect(merge.ok).toBe(true);
    expect(merge.needsResolve).toBeUndefined();

    // 5) 워크트리의 변경이 base(main)에 실제로 반영됨.
    expect(fs.existsSync(path.join(repoRoot, "feature.ts"))).toBe(true);
    expect(fs.readFileSync(path.join(repoRoot, "feature.ts"), "utf8")).toBe(
      "export const x = 1;\n",
    );
    // squash 커밋이 main 히스토리에 1개 추가됨.
    const log = git(["log", "--oneline", "main"], repoRoot);
    expect(log).toMatch(
      new RegExp(branch.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")),
    );

    // cleanup: 워크트리 디렉터리 제거 + 브랜치 삭제 + list 에서 사라짐.
    expect(fs.existsSync(wtPath)).toBe(false);
    expect(git(["branch", "--list", branch], repoRoot)).toBe("");
    const after = await mgr.list(repoRoot);
    expect(after.map((w) => w.path)).not.toContain(wtPath);
    // main 워크트리만 남는다.
    expect(after.map((w) => w.path)).toEqual([repoRoot]);
  });
});

describe("worktree lifecycle — conflict E2E (safe-stop, needsResolve)", () => {
  let repoRoot: string;
  let mgr: WorktreeManager;
  beforeEach(() => {
    ({ repoRoot, mgr } = makeRepo());
  });

  it("overlapping edits → status.mergeable=false → squashMerge safe-stops & preserves both trees", async () => {
    const createTask = vi.fn(async () => "SHOULD_NOT_BE_CALLED");
    const coord = new WorktreeCoordinator({ worktreeManager: mgr, createTask });

    const prep = await coord.prepare({
      projectId: "proj1",
      taskId: "conflictE2E",
      title: "Conflict E2E",
      repoRoot,
    });
    expect(prep.worktreeCreated).toBe(true);
    const wtPath = prep.cwd;
    const branch = (await mgr.list(repoRoot)).find(
      (w) => w.path === wtPath,
    )!.branch;

    // 워크트리가 README 같은 줄을 수정·커밋.
    fs.writeFileSync(path.join(wtPath, "README.md"), "worktree edit\n");
    git(["add", "."], wtPath);
    git(["commit", "-m", "wt edit"], wtPath);
    // base(main)도 같은 줄을 다르게 수정·커밋 → 충돌.
    fs.writeFileSync(path.join(repoRoot, "README.md"), "main edit\n");
    git(["add", "."], repoRoot);
    git(["commit", "-m", "main edit"], repoRoot);

    // status — 충돌 감지: mergeable=false, conflicts 에 README.md.
    const status = await mgr.status(wtPath, "main");
    expect(status.mergeable).toBe(false);
    expect(status.conflicts).toContain("README.md");

    // squashMergeToBase — rebase 단계에서 충돌 → 안전중단(needsResolve).
    const merge = await mgr.squashMergeToBase(repoRoot, wtPath, "main", branch);
    expect(merge.ok).toBe(false);
    expect(merge.needsResolve).toBe(true);
    expect(merge.conflicts).toContain("README.md");

    // 워크트리 보존 (제거되지 않음) + 내용 그대로.
    expect(fs.existsSync(wtPath)).toBe(true);
    expect(fs.readFileSync(path.join(wtPath, "README.md"), "utf8")).toBe(
      "worktree edit\n",
    );
    // base(main) 도 무손상 — squash 커밋 없음.
    expect(fs.readFileSync(path.join(repoRoot, "README.md"), "utf8")).toBe(
      "main edit\n",
    );
    // 브랜치/워크트리 모두 살아있음 → list 에 여전히 존재.
    expect(git(["branch", "--list", branch], repoRoot)).not.toBe("");
    expect((await mgr.list(repoRoot)).map((w) => w.path)).toContain(wtPath);
  });
});
