import { describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
  computeUnpushed,
  LEGACY_MAX_IDLE_DAYS,
  WorktreeManager,
} from "../../electron/worktree-manager";
import { LEGACY_IDLE_ARCHIVE_DAYS } from "../../src/lib/worktreeHygiene";

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

/**
 * Give `repoRoot` a real bare `origin` and push `branch` to it, so the branch
 * has a genuine upstream. A hand-written `refs/remotes/origin/*` is not enough:
 * without a configured remote git refuses to treat it as a tracking branch, and
 * `%(upstream)` stays empty — which would make these tests assert the very
 * "no upstream" case they are trying to distinguish from.
 */
function pushToOrigin(repoRoot: string, worktreePath: string, branch: string) {
  const remotes = spawnSync("git", ["remote"], {
    cwd: repoRoot,
    encoding: "utf8",
  });
  if (!(remotes.stdout || "").includes("origin")) {
    const bare = path.join(path.dirname(repoRoot), "origin.git");
    git(["init", "--bare", "-b", "main", bare], path.dirname(repoRoot));
    git(["remote", "add", "origin", bare], repoRoot);
  }
  git(["push", "-u", "origin", branch], worktreePath);
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

/**
 * 티켓 MT2ny8ng — idle 임계값 14 → 5 하향과, 그 하향이 절대 새어나가면 안 되는
 * 곳(물리 삭제)의 경계를 고정한다.
 */
describe("MT2ny8ng — idle 임계값 하향과 그 blast radius", () => {
  it("기본 임계값이 5일이다 (승인범위 3~5 상단)", async () => {
    const { repoRoot, mgr } = makeRepo();
    const info = await mgr.create({
      repoRoot,
      projectId: "p",
      taskId: "thresh000001",
      slug: "thresh",
    });
    fs.writeFileSync(path.join(info.path, "t.ts"), "x\n");
    git(["add", "."], info.path);
    git(["commit", "-m", "t"], info.path);

    // 4일 = 미달(정상 주말을 삼키지 않는다), 5일 = 도달.
    const at4 = await mgr.staleInfo(info.path, "main", {
      now: new Date(Date.now() + 4 * DAY_MS),
    });
    expect(at4.stale).toBe(false);

    const at5 = await mgr.staleInfo(info.path, "main", {
      now: new Date(Date.now() + 5 * DAY_MS),
    });
    expect(at5.stale).toBe(true);
  });

  it("배치 경로도 같은 임계값을 쓴다 (경로별로 갈리면 안 된다)", async () => {
    const { repoRoot, mgr } = makeRepo();
    const info = await mgr.create({
      repoRoot,
      projectId: "p",
      taskId: "thresh000002",
      slug: "threshb",
    });
    fs.writeFileSync(path.join(info.path, "t.ts"), "x\n");
    git(["add", "."], info.path);
    git(["commit", "-m", "t"], info.path);
    const list = await mgr.list(repoRoot);
    const head = list.find((w) => w.path === info.path)!.head;

    const at4 = await mgr.staleInfoByHead(repoRoot, "main", {
      now: new Date(Date.now() + 4 * DAY_MS),
    });
    expect(at4.get(head)?.stale).toBe(false);
    const at5 = await mgr.staleInfoByHead(repoRoot, "main", {
      now: new Date(Date.now() + 5 * DAY_MS),
    });
    expect(at5.get(head)?.stale).toBe(true);
  });

  /**
   * ★ 아카이브(숨김)와 cleanupStale(워크트리+브랜치 물리 삭제)이 같은 기본값을
   * 공유하면, UI 가시성 조정이 파괴적 작업의 사정거리를 조용히 4배로 넓힌다.
   * 삭제 쪽은 종전 14일에 고정되어 있어야 한다.
   */
  it("★cleanupStale 은 낮아진 아카이브 임계값을 물려받지 않는다 (14일 유지)", async () => {
    const { repoRoot, mgr } = makeRepo();
    const info = await mgr.create({
      repoRoot,
      projectId: "p",
      taskId: "nodelete0001",
      slug: "nodelete",
    });
    fs.writeFileSync(path.join(info.path, "n.ts"), "x\n");
    git(["add", "."], info.path);
    git(["commit", "-m", "n"], info.path);
    // 원격에 올라간 것처럼 보이게 해 unpushed 가드와 임계값 효과를 분리한다.
    pushToOrigin(repoRoot, info.path, info.branch);

    // idle 7일: 아카이브 임계값(5)은 넘었지만 삭제 임계값(14)에는 못 미친다.
    const res = await mgr.cleanupStale(repoRoot, {
      now: new Date(Date.now() + 7 * DAY_MS),
    });
    expect(res.removed).not.toContain(info.path);
    expect(fs.existsSync(info.path)).toBe(true);

    // 명시적으로 요구하면 그때는 지운다 — 고정이지 봉인이 아니다.
    const forced = await mgr.cleanupStale(repoRoot, {
      now: new Date(Date.now() + 7 * DAY_MS),
      maxIdleDays: 5,
    });
    expect(forced.removed).toContain(info.path);
  });

  it("★cleanupStale 은 unpushed 브랜치를 지우지 않는다 (유일본 파괴 금지)", async () => {
    const { repoRoot, mgr } = makeRepo();
    const info = await mgr.create({
      repoRoot,
      projectId: "p",
      taskId: "unpushed0001",
      slug: "unpushed",
    });
    fs.writeFileSync(path.join(info.path, "u.ts"), "x\n");
    git(["add", "."], info.path);
    git(["commit", "-m", "u"], info.path);
    // 원격 없음 → 이 커밋은 이 디스크에만 존재한다.

    const res = await mgr.cleanupStale(repoRoot, {
      now: new Date(Date.now() + 400 * DAY_MS),
    });
    expect(res.removed).not.toContain(info.path);
    expect(fs.existsSync(info.path)).toBe(true);
  });
});

describe("unpushed 판정 — 배치 verdict 에 spawn 추가 없이 실림", () => {
  it("원격이 없는 브랜치는 unpushed 다 (한 번도 push 된 적 없음)", async () => {
    const { repoRoot, mgr } = makeRepo();
    const info = await mgr.create({
      repoRoot,
      projectId: "p",
      taskId: "noupstream01",
      slug: "noup",
    });
    fs.writeFileSync(path.join(info.path, "a.ts"), "x\n");
    git(["add", "."], info.path);
    git(["commit", "-m", "a"], info.path);

    const list = await mgr.list(repoRoot);
    const head = list.find((w) => w.path === info.path)!.head;
    const byHead = await mgr.staleInfoByHead(repoRoot, "main");
    expect(byHead.get(head)?.unpushed).toBe(true);
    // 워크트리별 경로도 같은 답이어야 한다.
    expect((await mgr.staleInfo(info.path, "main")).unpushed).toBe(true);
  });

  it("upstream 과 같은 지점이면 unpushed 가 아니다", async () => {
    const { repoRoot, mgr } = makeRepo();
    const info = await mgr.create({
      repoRoot,
      projectId: "p",
      taskId: "uptodate0001",
      slug: "uptodate",
    });
    fs.writeFileSync(path.join(info.path, "a.ts"), "x\n");
    git(["add", "."], info.path);
    git(["commit", "-m", "a"], info.path);
    pushToOrigin(repoRoot, info.path, info.branch);

    const list = await mgr.list(repoRoot);
    const head = list.find((w) => w.path === info.path)!.head;
    const byHead = await mgr.staleInfoByHead(repoRoot, "main");
    expect(byHead.get(head)?.unpushed).toBe(false);
    expect((await mgr.staleInfo(info.path, "main")).unpushed).toBe(false);
  });

  it("upstream 보다 앞서 있으면 unpushed 다", async () => {
    const { repoRoot, mgr } = makeRepo();
    const info = await mgr.create({
      repoRoot,
      projectId: "p",
      taskId: "aheadonly001",
      slug: "ahead",
    });
    fs.writeFileSync(path.join(info.path, "a.ts"), "x\n");
    git(["add", "."], info.path);
    git(["commit", "-m", "a"], info.path);
    pushToOrigin(repoRoot, info.path, info.branch);
    // 원격이 모르는 커밋 하나 추가.
    fs.writeFileSync(path.join(info.path, "b.ts"), "y\n");
    git(["add", "."], info.path);
    git(["commit", "-m", "b"], info.path);

    const list = await mgr.list(repoRoot);
    const head = list.find((w) => w.path === info.path)!.head;
    const byHead = await mgr.staleInfoByHead(repoRoot, "main");
    expect(byHead.get(head)?.unpushed).toBe(true);
    expect((await mgr.staleInfo(info.path, "main")).unpushed).toBe(true);
  });

  it("merged 브랜치는 unpushed 가 아니다 — base 가 이미 그 작업을 갖고 있다", async () => {
    const { repoRoot, mgr } = makeRepo();
    const info = await mgr.create({
      repoRoot,
      projectId: "p",
      taskId: "mergedsafe01",
      slug: "mergedsafe",
    });
    fs.writeFileSync(path.join(info.path, "m.ts"), "x\n");
    git(["add", "."], info.path);
    git(["commit", "-m", "m"], info.path);
    git(["merge", "--no-ff", info.branch, "-m", "merge"], repoRoot);

    const list = await mgr.list(repoRoot);
    const head = list.find((w) => w.path === info.path)!.head;
    expect(
      (await mgr.staleInfoByHead(repoRoot, "main")).get(head)?.unpushed,
    ).toBe(false);
  });
});

describe("computeUnpushed — for-each-ref 필드 파싱", () => {
  it("merged 면 upstream 상태와 무관하게 false", () => {
    expect(computeUnpushed(true, "", "")).toBe(false);
    expect(computeUnpushed(true, "refs/remotes/origin/x", "[ahead 3]")).toBe(
      false,
    );
  });

  it("upstream 이 없으면 true (한 번도 push 안 됨)", () => {
    expect(computeUnpushed(false, "", "")).toBe(true);
    expect(computeUnpushed(false, "   ", "")).toBe(true);
  });

  it("upstream 과 동기 상태면 false", () => {
    expect(computeUnpushed(false, "refs/remotes/origin/x", "")).toBe(false);
  });

  it("behind 뿐이면 false — 로컬에만 있는 커밋은 없다", () => {
    expect(computeUnpushed(false, "refs/remotes/origin/x", "[behind 4]")).toBe(
      false,
    );
  });

  it("ahead 면 true", () => {
    expect(computeUnpushed(false, "refs/remotes/origin/x", "[ahead 2]")).toBe(
      true,
    );
  });

  it("★'[ahead 1, behind 2]' 를 true 로 읽는다 (공백 split 이었으면 깨질 자리)", () => {
    expect(
      computeUnpushed(false, "refs/remotes/origin/x", "[ahead 1, behind 2]"),
    ).toBe(true);
  });

  it("upstream 이 삭제된(gone) 브랜치는 true", () => {
    expect(computeUnpushed(false, "refs/remotes/origin/x", "[gone]")).toBe(
      true,
    );
  });
});

/**
 * ★ #511 이 확보한 예산: verdict 는 '워크트리당 2 spawn' 이 아니라 '리포당 2
 * spawn' 이다. unpushed 신호를 얹으면서 필드만 늘리고 프로세스는 늘리지 않았다는
 * 것을 고정한다 — 이게 깨지면 워크트리 수에 비례해 다시 느려진다.
 */
describe("★staleInfoByHead 성능 예산 — 워크트리 수와 무관한 spawn 수", () => {
  it("워크트리가 1개든 6개든 git spawn 은 2회다", async () => {
    const { repoRoot, mgr } = makeRepo();

    const countSpawns = async (m: WorktreeManager): Promise<number> => {
      const target = m as unknown as {
        runGit: (...a: unknown[]) => Promise<unknown>;
      };
      const original = target.runGit.bind(target);
      let calls = 0;
      target.runGit = (...args: unknown[]) => {
        calls += 1;
        return original(...args);
      };
      await m.staleInfoByHead(repoRoot, "main");
      target.runGit = original;
      return calls;
    };

    const withOne = await countSpawns(mgr);
    expect(withOne).toBe(2);

    for (let i = 0; i < 6; i += 1) {
      const info = await mgr.create({
        repoRoot,
        projectId: "p",
        taskId: `perfbudget${i}0`,
        slug: `perf${i}`,
      });
      fs.writeFileSync(path.join(info.path, `p${i}.ts`), "x\n");
      git(["add", "."], info.path);
      git(["commit", "-m", `p${i}`], info.path);
    }

    const withMany = await countSpawns(mgr);
    expect(withMany).toBe(2);
    expect(withMany).toBe(withOne);
  });
});

/**
 * 렌더러의 worktreeHygiene 는 메인 프로세스 코드를 import 할 수 없어 14를 리터럴로
 * 갖고 있다. 두 값이 갈라지면 "라이트 경로에서 5~13일은 증거가 있을 때만 숨긴다"는
 * 밴드 경계가 조용히 어긋나므로, 짝을 여기서 고정한다.
 */
describe("임계값 상수 짝 맞춤", () => {
  it("LEGACY_MAX_IDLE_DAYS 와 렌더러의 LEGACY_IDLE_ARCHIVE_DAYS 가 같다", () => {
    expect(LEGACY_IDLE_ARCHIVE_DAYS).toBe(LEGACY_MAX_IDLE_DAYS);
  });
});
