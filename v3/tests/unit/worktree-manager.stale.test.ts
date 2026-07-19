import { describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { WorktreeManager } from "../../electron/worktree-manager";

function git(args: string[], cwd: string): string {
  const r = spawnSync("git", args, { cwd, encoding: "utf8" });
  if (r.status !== 0)
    throw new Error(`git ${args.join(" ")} failed: ${r.stderr}`);
  return (r.stdout || "").trim();
}

/**
 * Fresh, isolated git repo on branch `main` with one commit (no remote).
 * Mirrors the makeRepo() helper in worktree-manager.test.ts — fs.realpathSync
 * normalizes /var → /private/var on macOS so path equality holds.
 */
function makeRepo(): {
  repoRoot: string;
  wtRoot: string;
  mgr: WorktreeManager;
} {
  const base = fs.realpathSync(
    fs.mkdtempSync(path.join(os.tmpdir(), "marblo-wts-")),
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

const DAY_MS = 24 * 60 * 60 * 1000;

describe("WorktreeManager.isMergedIntoBase", () => {
  it("returns true for a fresh worktree with no commits beyond base", async () => {
    const { repoRoot, mgr } = makeRepo();
    const info = await mgr.create({
      repoRoot,
      projectId: "p",
      taskId: "freshtask001",
      slug: "fresh",
    });
    expect(await mgr.isMergedIntoBase(info.path, "main")).toBe(true);
  });

  it("returns false once the branch has a commit not in base", async () => {
    const { repoRoot, mgr } = makeRepo();
    const info = await mgr.create({
      repoRoot,
      projectId: "p",
      taskId: "aheadtask001",
      slug: "ahead",
    });
    fs.writeFileSync(path.join(info.path, "wip.ts"), "export const x = 1;\n");
    git(["add", "."], info.path);
    git(["commit", "-m", "wip"], info.path);
    expect(await mgr.isMergedIntoBase(info.path, "main")).toBe(false);
  });

  it("returns true again after the branch is merged into base", async () => {
    const { repoRoot, mgr } = makeRepo();
    const info = await mgr.create({
      repoRoot,
      projectId: "p",
      taskId: "mergeback001",
      slug: "merge-back",
    });
    fs.writeFileSync(
      path.join(info.path, "feature.ts"),
      "export const x = 1;\n",
    );
    git(["add", "."], info.path);
    git(["commit", "-m", "feat"], info.path);
    // Merge the branch into base (main) — branch tip becomes reachable from base.
    git(["merge", "--no-ff", info.branch, "-m", "merge feat"], repoRoot);
    expect(await mgr.isMergedIntoBase(info.path, "main")).toBe(true);
  });
});

describe("WorktreeManager.lastActivityAt", () => {
  it("returns the last commit time as a Date", async () => {
    const { repoRoot, mgr } = makeRepo();
    const info = await mgr.create({
      repoRoot,
      projectId: "p",
      taskId: "activitytsk1",
      slug: "act",
    });
    fs.writeFileSync(path.join(info.path, "a.ts"), "x\n");
    git(["add", "."], info.path);
    git(["commit", "-m", "commit"], info.path);

    const when = await mgr.lastActivityAt(info.path);
    expect(when).toBeInstanceOf(Date);
    expect(when!.getTime()).toBeLessThanOrEqual(Date.now() + 60_000);
  });
});

describe("WorktreeManager.staleInfo", () => {
  it("flags a branch already merged into base as merged:true and stale:true", async () => {
    const { repoRoot, mgr } = makeRepo();
    const info = await mgr.create({
      repoRoot,
      projectId: "p",
      taskId: "mergedtask01",
      slug: "merged",
    });
    fs.writeFileSync(
      path.join(info.path, "feature.ts"),
      "export const x = 1;\n",
    );
    git(["add", "."], info.path);
    git(["commit", "-m", "feat"], info.path);
    git(["merge", "--no-ff", info.branch, "-m", "merge feat"], repoRoot);

    const stale = await mgr.staleInfo(info.path, "main");
    expect(stale.merged).toBe(true);
    expect(stale.stale).toBe(true);
  });

  it("reports merged:false and not stale for a fresh unmerged commit", async () => {
    const { repoRoot, mgr } = makeRepo();
    const info = await mgr.create({
      repoRoot,
      projectId: "p",
      taskId: "unmergedtsk1",
      slug: "unmerged",
    });
    fs.writeFileSync(path.join(info.path, "wip.ts"), "x\n");
    git(["add", "."], info.path);
    git(["commit", "-m", "wip"], info.path);

    const stale = await mgr.staleInfo(info.path, "main");
    expect(stale.merged).toBe(false);
    expect(stale.stale).toBe(false);
  });

  it("flags a long-idle but unmerged worktree as stale via idleDays", async () => {
    const { repoRoot, mgr } = makeRepo();
    const info = await mgr.create({
      repoRoot,
      projectId: "p",
      taskId: "idletask0001",
      slug: "idle",
    });
    fs.writeFileSync(path.join(info.path, "old.ts"), "x\n");
    git(["add", "."], info.path);
    git(["commit", "-m", "old work"], info.path);

    // 20 days after the commit, maxIdleDays=14 → stale by idleness alone.
    const future = new Date(Date.now() + 20 * DAY_MS);
    const stale = await mgr.staleInfo(info.path, "main", {
      maxIdleDays: 14,
      now: future,
    });
    expect(stale.merged).toBe(false);
    expect(stale.idleDays).toBeGreaterThanOrEqual(14);
    expect(stale.stale).toBe(true);
  });
});

describe("WorktreeManager.cleanupStale", () => {
  it("removes merged worktrees (with their branches) but keeps main and active ones", async () => {
    const { repoRoot, mgr } = makeRepo();

    // Stale: a worktree merged back into base.
    const merged = await mgr.create({
      repoRoot,
      projectId: "p",
      taskId: "cleanmerged1",
      slug: "merged",
    });
    fs.writeFileSync(path.join(merged.path, "m.ts"), "x\n");
    git(["add", "."], merged.path);
    git(["commit", "-m", "m"], merged.path);
    git(["merge", "--no-ff", merged.branch, "-m", "merge m"], repoRoot);

    // Active: a worktree with a fresh, unmerged commit (not stale).
    const active = await mgr.create({
      repoRoot,
      projectId: "p",
      taskId: "activework01",
      slug: "active",
    });
    fs.writeFileSync(path.join(active.path, "a.ts"), "x\n");
    git(["add", "."], active.path);
    git(["commit", "-m", "a"], active.path);

    const result = await mgr.cleanupStale(repoRoot);

    expect(result.removed).toContain(merged.path);
    expect(result.removed).not.toContain(active.path);
    expect(result.removed).not.toContain(repoRoot);
    expect(fs.existsSync(merged.path)).toBe(false);
    expect(fs.existsSync(active.path)).toBe(true);

    const paths = (await mgr.list(repoRoot)).map((w) => w.path);
    expect(paths).toContain(repoRoot); // main worktree untouched
    expect(paths).toContain(active.path);
    expect(paths).not.toContain(merged.path);
    // merged branch was deleted as part of cleanup
    expect(git(["branch", "--list", merged.branch], repoRoot)).toBe("");
  });
});

/**
 * 티켓 NaviULZe — 라이트 경로에는 verdict 가 없어 아카이브 필터(#475)가 근거를
 * 잃고 무력화됐다. staleInfoByHead 는 그 근거를 '워크트리당 2 spawn' 이 아니라
 * '리포당 2 spawn' 으로 복원한다(#498/#495 성능 유지). 아래는 배치 결과가
 * 워크트리별 staleInfo() 와 동일하다는 것과, 실패 시 '전부 안 stale' 을
 * 날조하지 않는다는 것을 고정한다.
 */
describe("WorktreeManager.staleInfoByHead — 배치 verdict", () => {
  it("머지된 워크트리와 살아있는 워크트리를 구분한다 (staleInfo() 와 동일 판정)", async () => {
    const { repoRoot, mgr } = makeRepo();

    const merged = await mgr.create({
      repoRoot,
      projectId: "p",
      taskId: "batchmerged1",
      slug: "merged",
    });
    fs.writeFileSync(path.join(merged.path, "m.ts"), "x\n");
    git(["add", "."], merged.path);
    git(["commit", "-m", "m"], merged.path);
    git(["merge", "--no-ff", merged.branch, "-m", "merge m"], repoRoot);

    const active = await mgr.create({
      repoRoot,
      projectId: "p",
      taskId: "batchactive1",
      slug: "active",
    });
    fs.writeFileSync(path.join(active.path, "a.ts"), "x\n");
    git(["add", "."], active.path);
    git(["commit", "-m", "a"], active.path);

    const byHead = await mgr.staleInfoByHead(repoRoot, "main");
    const list = await mgr.list(repoRoot);
    const headOf = (p: string) => list.find((w) => w.path === p)!.head;

    expect(byHead.get(headOf(merged.path))?.merged).toBe(true);
    expect(byHead.get(headOf(merged.path))?.stale).toBe(true);
    expect(byHead.get(headOf(active.path))?.merged).toBe(false);
    expect(byHead.get(headOf(active.path))?.stale).toBe(false);

    // 배치 판정이 워크트리별 판정과 어긋나면 안 된다 — 성능만 다르고 답은 같아야.
    for (const wt of [merged.path, active.path]) {
      const one = await mgr.staleInfo(wt, "main");
      expect(byHead.get(headOf(wt))).toEqual(one);
    }
  });

  it("오래 idle 한 브랜치를 stale 로 판정한다 (maxIdleDays 경계)", async () => {
    const { repoRoot, mgr } = makeRepo();
    const info = await mgr.create({
      repoRoot,
      projectId: "p",
      taskId: "batchidle001",
      slug: "idle",
    });
    fs.writeFileSync(path.join(info.path, "i.ts"), "x\n");
    git(["add", "."], info.path);
    git(["commit", "-m", "i"], info.path);

    const list = await mgr.list(repoRoot);
    const head = list.find((w) => w.path === info.path)!.head;

    // 커밋 직후 = idle 0일 → 미머지이므로 stale 아님
    const fresh = await mgr.staleInfoByHead(repoRoot, "main");
    expect(fresh.get(head)?.stale).toBe(false);

    // now 를 20일 뒤로 밀면 idle 20 >= 14 → stale
    const later = await mgr.staleInfoByHead(repoRoot, "main", {
      now: new Date(Date.now() + 20 * DAY_MS),
    });
    expect(later.get(head)?.idleDays).toBeGreaterThanOrEqual(14);
    expect(later.get(head)?.stale).toBe(true);
  });

  it("★git 이 답하지 못하면 빈 맵을 주고, '전부 안 stale' 을 날조하지 않는다", async () => {
    const { mgr } = makeRepo();
    // 리포가 아닌 경로 → for-each-ref 실패
    const out = await mgr.staleInfoByHead(os.tmpdir(), "main");
    expect(out.size).toBe(0);
  });

  it("존재하지 않는 baseRef 로도 '전부 머지됨' 을 날조하지 않는다", async () => {
    const { repoRoot, mgr } = makeRepo();
    await mgr.create({
      repoRoot,
      projectId: "p",
      taskId: "batchnobase1",
      slug: "nobase",
    });
    const out = await mgr.staleInfoByHead(
      repoRoot,
      "refs/heads/does-not-exist",
    );
    // --merged=<없는 ref> 는 실패한다 → 판정 없음(빈 맵). merged:true 를 뿌리면 안 된다.
    for (const v of out.values()) expect(v.merged).toBe(false);
  });
});
