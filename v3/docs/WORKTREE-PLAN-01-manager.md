# Worktree Manager (Plan 01) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build `electron/worktree-manager.ts` — a fully unit-tested module that creates, lists, inspects (ahead/behind/dirty/diff/mergeable-or-conflict), and removes git worktrees — the foundation every later phase of `v3/docs/WORKTREE-SPEC.md` builds on.

**Architecture:** A `WorktreeManager` class mirrors the existing `FsManager` git pattern (raw `child_process.spawn`, Promise + event listeners, graceful error handling). It owns a configurable `worktreesRoot` (default `~/.marblo/worktrees`, injectable for tests). All git work routes through one private `runGit(args, cwd)` helper returning `{ code, stdout, stderr }`. No Firestore, no IPC, no Electron globals — pure, offline-testable against temp git repos.

**Tech Stack:** TypeScript, Node `child_process`, Vitest (`npm test`, `environment: node`). Git ≥ 2.38 required for `git merge-tree --write-tree` (conflict detection).

**Scope boundary (this plan ONLY):** Covers SPEC §4 (lifecycle git ops, branch naming, base ref, location), §5 (merge-status data fields), §8 (the `worktree-manager` module), and the unit-test slice of §10. It deliberately does NOT touch agent spawn integration, ad-hoc auto-task, IPC/preload, the `WorktreeTab` UI, or merge/rebase _actions_ — those are Plans 02–04. This plan ships a working, tested library with zero dependency on the unresolved main↔renderer task-creation question.

---

## File Structure

| File                                             | Responsibility                                                                                                                                 |
| ------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| Create: `v3/electron/worktree-manager.ts`        | `WorktreeManager` class + exported interfaces (`WorktreeInfo`, `WorktreeStatus`, `CreateWorktreeParams`, `GitResult`). All git worktree logic. |
| Create: `v3/tests/unit/worktree-manager.test.ts` | Vitest unit tests against fresh temp git repos (one per test via `makeRepo()`).                                                                |

Public API (locked here — later tasks must match these names exactly):

```typescript
export interface GitResult {
  code: number;
  stdout: string;
  stderr: string;
}

export interface WorktreeInfo {
  path: string; // absolute worktree path
  branch: string; // short branch name, e.g. "marblo/login-fix-ab12cd34"
  head: string; // commit sha
}

export interface WorktreeStatus {
  branch: string;
  baseRef: string;
  ahead: number; // commits in HEAD not in baseRef
  behind: number; // commits in baseRef not in HEAD
  dirty: boolean; // uncommitted working-tree changes
  mergeable: boolean; // merges cleanly into baseRef
  conflicts: string[]; // conflicted file paths (empty when mergeable)
  filesChanged: number;
  insertions: number;
  deletions: number;
}

export interface CreateWorktreeParams {
  repoRoot: string; // main repo working copy
  projectId: string;
  taskId: string;
  slug: string; // human slug for the branch name
  baseRef?: string; // default: resolveBaseRef(repoRoot)
}

export class WorktreeManager {
  constructor(opts?: { worktreesRoot?: string });
  resolveBaseRef(repoRoot: string): Promise<string>;
  create(params: CreateWorktreeParams): Promise<WorktreeInfo>;
  list(repoRoot: string): Promise<WorktreeInfo[]>;
  status(worktreePath: string, baseRef: string): Promise<WorktreeStatus>;
  remove(
    repoRoot: string,
    worktreePath: string,
    opts?: { deleteBranch?: boolean }
  ): Promise<void>;
  prune(repoRoot: string): Promise<void>;
}
```

---

### Task 1: Scaffold `WorktreeManager` + `runGit` + `resolveBaseRef`

**Files:**

- Create: `v3/electron/worktree-manager.ts`
- Test: `v3/tests/unit/worktree-manager.test.ts`

- [ ] **Step 1: Write the failing test**

Create `v3/tests/unit/worktree-manager.test.ts`:

```typescript
import { beforeEach, describe, expect, it } from "vitest";
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

/** Fresh, isolated git repo on branch `main` with one commit. No remote (offline). */
function makeRepo(): {
  repoRoot: string;
  wtRoot: string;
  mgr: WorktreeManager;
} {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), "marblo-wt-"));
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

describe("WorktreeManager.resolveBaseRef", () => {
  let repoRoot: string;
  let mgr: WorktreeManager;
  beforeEach(() => {
    ({ repoRoot, mgr } = makeRepo());
  });

  it("falls back to the local current branch when no origin remote exists", async () => {
    const base = await mgr.resolveBaseRef(repoRoot);
    expect(base).toBe("main");
  });
});

// Export so later tasks can reuse these helpers (same file).
export { git, makeRepo };
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd v3 && npx vitest run tests/unit/worktree-manager.test.ts`
Expected: FAIL — `Cannot find module '../../electron/worktree-manager'` (or `WorktreeManager is not a constructor`).

- [ ] **Step 3: Write minimal implementation**

Create `v3/electron/worktree-manager.ts`:

```typescript
import { spawn } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

export interface GitResult {
  code: number;
  stdout: string;
  stderr: string;
}

export interface WorktreeInfo {
  path: string;
  branch: string;
  head: string;
}

export interface WorktreeStatus {
  branch: string;
  baseRef: string;
  ahead: number;
  behind: number;
  dirty: boolean;
  mergeable: boolean;
  conflicts: string[];
  filesChanged: number;
  insertions: number;
  deletions: number;
}

export interface CreateWorktreeParams {
  repoRoot: string;
  projectId: string;
  taskId: string;
  slug: string;
  baseRef?: string;
}

export class WorktreeManager {
  private worktreesRoot: string;

  constructor(opts?: { worktreesRoot?: string }) {
    this.worktreesRoot =
      opts?.worktreesRoot ?? path.join(os.homedir(), ".marblo", "worktrees");
  }

  /** Single choke-point for git. Never rejects — always resolves a GitResult. */
  private runGit(args: string[], cwd: string): Promise<GitResult> {
    return new Promise((resolve) => {
      let stdout = "";
      let stderr = "";
      try {
        const proc = spawn("git", args, { cwd });
        proc.stdout.on("data", (d) => (stdout += d.toString()));
        proc.stderr.on("data", (d) => (stderr += d.toString()));
        proc.on("close", (code) =>
          resolve({ code: code ?? 1, stdout, stderr })
        );
        proc.on("error", (e) =>
          resolve({ code: 1, stdout, stderr: String(e) })
        );
      } catch (e) {
        resolve({ code: 1, stdout, stderr: String(e) });
      }
    });
  }

  /** Prefer origin's default branch; fall back to the local current branch. */
  async resolveBaseRef(repoRoot: string): Promise<string> {
    const sym = await this.runGit(
      ["symbolic-ref", "--short", "refs/remotes/origin/HEAD"],
      repoRoot
    );
    if (sym.code === 0 && sym.stdout.trim()) return sym.stdout.trim();
    const cur = await this.runGit(
      ["rev-parse", "--abbrev-ref", "HEAD"],
      repoRoot
    );
    if (cur.code === 0 && cur.stdout.trim()) return cur.stdout.trim();
    return "HEAD";
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd v3 && npx vitest run tests/unit/worktree-manager.test.ts`
Expected: PASS (1 test).

- [ ] **Step 5: Commit**

```bash
git add v3/electron/worktree-manager.ts v3/tests/unit/worktree-manager.test.ts
git commit -m "feat(v3): WorktreeManager scaffold — runGit + resolveBaseRef"
```

---

### Task 2: `create` — `git worktree add` on a fresh branch

**Files:**

- Modify: `v3/electron/worktree-manager.ts` (add `branchName` + `create`)
- Test: `v3/tests/unit/worktree-manager.test.ts` (add describe block)

- [ ] **Step 1: Write the failing test**

Append to `v3/tests/unit/worktree-manager.test.ts`:

```typescript
describe("WorktreeManager.create", () => {
  let repoRoot: string;
  let wtRoot: string;
  let mgr: WorktreeManager;
  beforeEach(() => {
    ({ repoRoot, wtRoot, mgr } = makeRepo());
  });

  it("creates a worktree dir on a marblo/<slug>-<id8> branch under worktreesRoot", async () => {
    const info = await mgr.create({
      repoRoot,
      projectId: "proj1",
      taskId: "abcdef1234567890",
      slug: "Login Bug Fix",
    });
    expect(info.branch).toBe("marblo/login-bug-fix-abcdef12");
    expect(info.path).toBe(path.join(wtRoot, "proj1", "abcdef1234567890"));
    expect(fs.existsSync(path.join(info.path, "README.md"))).toBe(true);
    expect(info.head).toMatch(/^[0-9a-f]{40}$/);
    // The new branch is checked out in the worktree
    expect(git(["rev-parse", "--abbrev-ref", "HEAD"], info.path)).toBe(
      info.branch
    );
  });

  it("throws when the branch already exists", async () => {
    const params = {
      repoRoot,
      projectId: "proj1",
      taskId: "dupdupdup000000",
      slug: "dup",
    };
    await mgr.create(params);
    await expect(mgr.create(params)).rejects.toThrow(/worktree add failed/i);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd v3 && npx vitest run tests/unit/worktree-manager.test.ts`
Expected: FAIL — `mgr.create is not a function`.

- [ ] **Step 3: Write minimal implementation**

Add these two methods to the `WorktreeManager` class in `v3/electron/worktree-manager.ts`:

```typescript
  /** marblo/<sanitized-slug>-<first 8 of taskId> */
  private branchName(slug: string, taskId: string): string {
    const cleanSlug =
      slug
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "")
        .slice(0, 32) || "task";
    return `marblo/${cleanSlug}-${taskId.slice(0, 8)}`;
  }

  async create(params: CreateWorktreeParams): Promise<WorktreeInfo> {
    const baseRef =
      params.baseRef ?? (await this.resolveBaseRef(params.repoRoot));
    const branch = this.branchName(params.slug, params.taskId);
    const wtPath = path.join(
      this.worktreesRoot,
      params.projectId,
      params.taskId,
    );
    fs.mkdirSync(path.dirname(wtPath), { recursive: true });

    const res = await this.runGit(
      ["worktree", "add", "-b", branch, wtPath, baseRef],
      params.repoRoot,
    );
    if (res.code !== 0) {
      throw new Error(`git worktree add failed: ${res.stderr.trim()}`);
    }

    const headRes = await this.runGit(["rev-parse", "HEAD"], wtPath);
    return { path: wtPath, branch, head: headRes.stdout.trim() };
  }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd v3 && npx vitest run tests/unit/worktree-manager.test.ts`
Expected: PASS (3 tests total).

- [ ] **Step 5: Commit**

```bash
git add v3/electron/worktree-manager.ts v3/tests/unit/worktree-manager.test.ts
git commit -m "feat(v3): WorktreeManager.create — git worktree add on marblo/<slug> branch"
```

---

### Task 3: `list` — parse `git worktree list --porcelain`

**Files:**

- Modify: `v3/electron/worktree-manager.ts` (add `list`)
- Test: `v3/tests/unit/worktree-manager.test.ts` (add describe block)

- [ ] **Step 1: Write the failing test**

Append to `v3/tests/unit/worktree-manager.test.ts`:

```typescript
describe("WorktreeManager.list", () => {
  let repoRoot: string;
  let mgr: WorktreeManager;
  beforeEach(() => {
    ({ repoRoot, mgr } = makeRepo());
  });

  it("lists the main worktree plus any created worktrees with branch names", async () => {
    const info = await mgr.create({
      repoRoot,
      projectId: "p",
      taskId: "task1234abcd",
      slug: "feature",
    });
    const all = await mgr.list(repoRoot);
    const paths = all.map((w) => w.path);
    expect(paths).toContain(info.path);
    const created = all.find((w) => w.path === info.path)!;
    expect(created.branch).toBe("marblo/feature-task1234");
    expect(created.head).toMatch(/^[0-9a-f]{40}$/);
    // The main repo worktree is present too
    expect(paths).toContain(repoRoot);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd v3 && npx vitest run tests/unit/worktree-manager.test.ts`
Expected: FAIL — `mgr.list is not a function`.

- [ ] **Step 3: Write minimal implementation**

Add this method to the `WorktreeManager` class:

```typescript
  async list(repoRoot: string): Promise<WorktreeInfo[]> {
    const res = await this.runGit(
      ["worktree", "list", "--porcelain"],
      repoRoot,
    );
    if (res.code !== 0) return [];

    const out: WorktreeInfo[] = [];
    let cur: Partial<WorktreeInfo> = {};
    const flush = () => {
      if (cur.path) {
        out.push({
          path: cur.path,
          branch: cur.branch ?? "",
          head: cur.head ?? "",
        });
      }
      cur = {};
    };
    for (const line of res.stdout.split("\n")) {
      if (line.startsWith("worktree ")) {
        flush();
        cur.path = line.slice("worktree ".length).trim();
      } else if (line.startsWith("HEAD ")) {
        cur.head = line.slice("HEAD ".length).trim();
      } else if (line.startsWith("branch ")) {
        cur.branch = line
          .slice("branch ".length)
          .trim()
          .replace("refs/heads/", "");
      }
    }
    flush();
    return out;
  }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd v3 && npx vitest run tests/unit/worktree-manager.test.ts`
Expected: PASS (4 tests total).

- [ ] **Step 5: Commit**

```bash
git add v3/electron/worktree-manager.ts v3/tests/unit/worktree-manager.test.ts
git commit -m "feat(v3): WorktreeManager.list — parse worktree list --porcelain"
```

---

### Task 4: `status` — ahead/behind, dirty, diffstat

**Files:**

- Modify: `v3/electron/worktree-manager.ts` (add `status`)
- Test: `v3/tests/unit/worktree-manager.test.ts` (add describe block)

- [ ] **Step 1: Write the failing test**

Append to `v3/tests/unit/worktree-manager.test.ts`:

```typescript
describe("WorktreeManager.status — counts & diff", () => {
  let repoRoot: string;
  let mgr: WorktreeManager;
  beforeEach(() => {
    ({ repoRoot, mgr } = makeRepo());
  });

  it("reports ahead/behind, dirty flag, and diff stats", async () => {
    const info = await mgr.create({
      repoRoot,
      projectId: "p",
      taskId: "statustask01",
      slug: "work",
    });

    // One committed change in the worktree => ahead 1, behind 0
    fs.writeFileSync(path.join(info.path, "README.md"), "base\nline2\nline3\n");
    git(["add", "."], info.path);
    git(["commit", "-m", "wt change"], info.path);

    const s1 = await mgr.status(info.path, "main");
    expect(s1.branch).toBe("marblo/work-statustask");
    expect(s1.baseRef).toBe("main");
    expect(s1.ahead).toBe(1);
    expect(s1.behind).toBe(0);
    expect(s1.dirty).toBe(false);
    expect(s1.filesChanged).toBe(1);
    expect(s1.insertions).toBe(2);
    expect(s1.deletions).toBe(0);

    // Advance base (main) by one commit => behind becomes 1
    fs.writeFileSync(path.join(repoRoot, "OTHER.md"), "x\n");
    git(["add", "."], repoRoot);
    git(["commit", "-m", "main advance"], repoRoot);

    // Uncommitted edit in the worktree => dirty true
    fs.writeFileSync(path.join(info.path, "scratch.txt"), "wip\n");

    const s2 = await mgr.status(info.path, "main");
    expect(s2.ahead).toBe(1);
    expect(s2.behind).toBe(1);
    expect(s2.dirty).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd v3 && npx vitest run tests/unit/worktree-manager.test.ts`
Expected: FAIL — `mgr.status is not a function`.

- [ ] **Step 3: Write minimal implementation**

Add this method to the `WorktreeManager` class. (Conflict detection is added in Task 5 — for now `mergeable` is `true` and `conflicts` is `[]`.)

```typescript
  async status(worktreePath: string, baseRef: string): Promise<WorktreeStatus> {
    const branchRes = await this.runGit(
      ["rev-parse", "--abbrev-ref", "HEAD"],
      worktreePath,
    );
    const branch = branchRes.stdout.trim();

    // behind = left (baseRef-only), ahead = right (HEAD-only)
    const ab = await this.runGit(
      ["rev-list", "--left-right", "--count", `${baseRef}...HEAD`],
      worktreePath,
    );
    let behind = 0;
    let ahead = 0;
    if (ab.code === 0) {
      const parts = ab.stdout.trim().split(/\s+/);
      behind = parseInt(parts[0] ?? "0", 10) || 0;
      ahead = parseInt(parts[1] ?? "0", 10) || 0;
    }

    const st = await this.runGit(["status", "--porcelain"], worktreePath);
    const dirty = st.stdout.trim().length > 0;

    const ns = await this.runGit(
      ["diff", "--numstat", `${baseRef}...HEAD`],
      worktreePath,
    );
    let filesChanged = 0;
    let insertions = 0;
    let deletions = 0;
    for (const line of ns.stdout.split("\n")) {
      if (!line.trim()) continue;
      const [ins, del] = line.split("\t");
      filesChanged++;
      insertions += ins === "-" ? 0 : parseInt(ins, 10) || 0;
      deletions += del === "-" ? 0 : parseInt(del, 10) || 0;
    }

    return {
      branch,
      baseRef,
      ahead,
      behind,
      dirty,
      mergeable: true,
      conflicts: [],
      filesChanged,
      insertions,
      deletions,
    };
  }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd v3 && npx vitest run tests/unit/worktree-manager.test.ts`
Expected: PASS (5 tests total).

- [ ] **Step 5: Commit**

```bash
git add v3/electron/worktree-manager.ts v3/tests/unit/worktree-manager.test.ts
git commit -m "feat(v3): WorktreeManager.status — ahead/behind, dirty, diffstat"
```

---

### Task 5: `status` — mergeable vs conflict via `git merge-tree`

**Files:**

- Modify: `v3/electron/worktree-manager.ts` (extend `status` with merge-tree)
- Test: `v3/tests/unit/worktree-manager.test.ts` (add describe block)

> Requires git ≥ 2.38 for `git merge-tree --write-tree`. Older git exits non-1 with an "unknown option" error, which this code treats as `mergeable: true` (a safe false-negative — surfaced in Plan 02's notes for a runtime version check).

- [ ] **Step 1: Write the failing test**

Append to `v3/tests/unit/worktree-manager.test.ts`:

```typescript
describe("WorktreeManager.status — mergeability", () => {
  let repoRoot: string;
  let mgr: WorktreeManager;
  beforeEach(() => {
    ({ repoRoot, mgr } = makeRepo());
  });

  it("reports mergeable=true with no conflicts for a non-overlapping change", async () => {
    const info = await mgr.create({
      repoRoot,
      projectId: "p",
      taskId: "cleanmerge01",
      slug: "clean",
    });
    fs.writeFileSync(path.join(info.path, "NEWFILE.md"), "fresh\n");
    git(["add", "."], info.path);
    git(["commit", "-m", "add new file"], info.path);

    const s = await mgr.status(info.path, "main");
    expect(s.mergeable).toBe(true);
    expect(s.conflicts).toEqual([]);
  });

  it("reports mergeable=false and lists the conflicted file on overlapping edits", async () => {
    const info = await mgr.create({
      repoRoot,
      projectId: "p",
      taskId: "conflict0001",
      slug: "conflict",
    });
    // Worktree edits README line
    fs.writeFileSync(path.join(info.path, "README.md"), "worktree edit\n");
    git(["add", "."], info.path);
    git(["commit", "-m", "wt edit"], info.path);
    // Base (main) edits the SAME line differently
    fs.writeFileSync(path.join(repoRoot, "README.md"), "main edit\n");
    git(["add", "."], repoRoot);
    git(["commit", "-m", "main edit"], repoRoot);

    const s = await mgr.status(info.path, "main");
    expect(s.mergeable).toBe(false);
    expect(s.conflicts).toContain("README.md");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd v3 && npx vitest run tests/unit/worktree-manager.test.ts`
Expected: FAIL — the conflict test fails (`mergeable` is still hardcoded `true`, `conflicts` is `[]`).

- [ ] **Step 3: Write minimal implementation**

In `status`, replace the hardcoded `mergeable: true, conflicts: []` block. First, before the `return`, compute merge status:

```typescript
// mergeable / conflicts — requires git >= 2.38 (--write-tree)
const mt = await this.runGit(
  ["merge-tree", "--write-tree", "--name-only", baseRef, "HEAD"],
  worktreePath
);
const hasConflicts = mt.code === 1;
let conflicts: string[] = [];
if (hasConflicts) {
  // First stdout line is the conflicted tree OID; the rest are file names.
  const lines = mt.stdout
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
  conflicts = lines.slice(1);
}
```

Then change the returned object's two fields from the literals to:

```typescript
      mergeable: !hasConflicts,
      conflicts,
```

(The final `return` object now reads `mergeable: !hasConflicts, conflicts,` instead of `mergeable: true, conflicts: [],`.)

- [ ] **Step 4: Run test to verify it passes**

Run: `cd v3 && npx vitest run tests/unit/worktree-manager.test.ts`
Expected: PASS (7 tests total).

- [ ] **Step 5: Commit**

```bash
git add v3/electron/worktree-manager.ts v3/tests/unit/worktree-manager.test.ts
git commit -m "feat(v3): WorktreeManager.status — mergeable/conflict via git merge-tree"
```

---

### Task 6: `remove` + `prune`

**Files:**

- Modify: `v3/electron/worktree-manager.ts` (add `remove`, `prune`)
- Test: `v3/tests/unit/worktree-manager.test.ts` (add describe block)

- [ ] **Step 1: Write the failing test**

Append to `v3/tests/unit/worktree-manager.test.ts`:

```typescript
describe("WorktreeManager.remove & prune", () => {
  let repoRoot: string;
  let mgr: WorktreeManager;
  beforeEach(() => {
    ({ repoRoot, mgr } = makeRepo());
  });

  it("removes the worktree dir and drops it from list", async () => {
    const info = await mgr.create({
      repoRoot,
      projectId: "p",
      taskId: "removeme0001",
      slug: "gone",
    });
    expect(fs.existsSync(info.path)).toBe(true);

    await mgr.remove(repoRoot, info.path);
    expect(fs.existsSync(info.path)).toBe(false);
    const paths = (await mgr.list(repoRoot)).map((w) => w.path);
    expect(paths).not.toContain(info.path);
  });

  it("deletes the branch too when deleteBranch is set", async () => {
    const info = await mgr.create({
      repoRoot,
      projectId: "p",
      taskId: "delbranch001",
      slug: "byebye",
    });
    await mgr.remove(repoRoot, info.path, { deleteBranch: true });
    const branches = git(["branch", "--list", info.branch], repoRoot);
    expect(branches).toBe("");
  });

  it("prune runs without throwing", async () => {
    await expect(mgr.prune(repoRoot)).resolves.toBeUndefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd v3 && npx vitest run tests/unit/worktree-manager.test.ts`
Expected: FAIL — `mgr.remove is not a function`.

- [ ] **Step 3: Write minimal implementation**

Add these methods to the `WorktreeManager` class:

```typescript
  async remove(
    repoRoot: string,
    worktreePath: string,
    opts?: { deleteBranch?: boolean },
  ): Promise<void> {
    let branch = "";
    if (opts?.deleteBranch) {
      const b = await this.runGit(
        ["rev-parse", "--abbrev-ref", "HEAD"],
        worktreePath,
      );
      if (b.code === 0) branch = b.stdout.trim();
    }

    const res = await this.runGit(
      ["worktree", "remove", "--force", worktreePath],
      repoRoot,
    );
    if (res.code !== 0) {
      throw new Error(`git worktree remove failed: ${res.stderr.trim()}`);
    }

    if (opts?.deleteBranch && branch) {
      await this.runGit(["branch", "-D", branch], repoRoot);
    }
  }

  async prune(repoRoot: string): Promise<void> {
    await this.runGit(["worktree", "prune"], repoRoot);
  }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd v3 && npx vitest run tests/unit/worktree-manager.test.ts`
Expected: PASS (10 tests total).

- [ ] **Step 5: Commit**

```bash
git add v3/electron/worktree-manager.ts v3/tests/unit/worktree-manager.test.ts
git commit -m "feat(v3): WorktreeManager.remove + prune"
```

---

### Task 7: Full-lifecycle integration test + run the whole suite

**Files:**

- Test: `v3/tests/unit/worktree-manager.test.ts` (add describe block)

- [ ] **Step 1: Write the failing test**

Append to `v3/tests/unit/worktree-manager.test.ts`:

```typescript
describe("WorktreeManager — full lifecycle", () => {
  it("create → commit → status → remove(deleteBranch) leaves a clean repo", async () => {
    const { repoRoot, mgr } = makeRepo();
    const info = await mgr.create({
      repoRoot,
      projectId: "proj",
      taskId: "lifecycle001",
      slug: "End To End",
    });
    fs.writeFileSync(
      path.join(info.path, "feature.ts"),
      "export const x = 1;\n"
    );
    git(["add", "."], info.path);
    git(["commit", "-m", "feature"], info.path);

    const s = await mgr.status(info.path, "main");
    expect(s.ahead).toBe(1);
    expect(s.mergeable).toBe(true);
    expect(s.filesChanged).toBe(1);

    await mgr.remove(repoRoot, info.path, { deleteBranch: true });
    await mgr.prune(repoRoot);

    expect(fs.existsSync(info.path)).toBe(false);
    expect(git(["branch", "--list", info.branch], repoRoot)).toBe("");
    // Only the main worktree remains
    expect((await mgr.list(repoRoot)).map((w) => w.path)).toEqual([repoRoot]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails (or confirm it passes against the built module)**

Run: `cd v3 && npx vitest run tests/unit/worktree-manager.test.ts`
Expected: PASS — every method already exists, so this integration test should pass on first run. (If it fails, the failure pinpoints a regression in an earlier task; fix before continuing.)

- [ ] **Step 3: Run the full project test suite + typecheck**

Run: `cd v3 && npm test`
Expected: all tests pass, including the 11 `worktree-manager` tests, with no regressions elsewhere.

Run: `cd v3 && npx tsc --noEmit` (or the project's typecheck script if different — check `package.json`)
Expected: no type errors introduced by `worktree-manager.ts`.

- [ ] **Step 4: Commit**

```bash
git add v3/tests/unit/worktree-manager.test.ts
git commit -m "test(v3): WorktreeManager full-lifecycle integration test"
```

---

## What comes next (not in this plan)

- **Plan 02 — Agent isolation + ad-hoc auto-task:** hook `WorktreeManager.create` into `AgentManager.launch` (set `params.cwd` to the worktree path), and resolve the main↔renderer task-creation path so ad-hoc agents auto-create a Board task. Add a runtime git-version check for `merge-tree --write-tree`.
- **Plan 03 — IPC + store + read-only WorktreeTab:** `worktree:` preload namespace + `ipcMain.handle` handlers, `worktreeStore` (zustand), and `src/components/tabs/WorktreeTab.tsx` (cross-project portfolio, status pills) behind `DEV_ONLY_TABS`.
- **Plan 04 — Merge actions + Review owner:** rebase / squash-merge / cleanup (clean path = direct git in `WorktreeManager`; conflict path = spawn a resolver agent), Review-stage pluggable owner, Board pill, Code-tab worktree awareness, stale hygiene.

---

## Self-Review

**1. Spec coverage (this plan's scope):**

- SPEC §4 branch naming `marblo/<slug>-<taskId8>` → Task 2 ✓; base ref `origin/<default>` fresh w/ local fallback → Task 1 (`resolveBaseRef`) ✓; location `~/.marblo/worktrees/<projectId>/<taskId>` → Task 2 (`create` path) ✓; create/remove lifecycle → Tasks 2 & 6 ✓; prune → Task 6 ✓.
- SPEC §5 data fields ahead/behind/dirty/mergeable/conflicts/diffstat → Tasks 4 & 5 ✓ (PR/CI fields are explicitly v1.1, out of scope).
- SPEC §8 `worktree-manager.ts` raw-git-spawn mirroring `fs-manager` → Task 1 `runGit` ✓.
- SPEC §9 error handling: `worktree add` failure throws (Task 2 test), `remove` failure throws (Task 6) ✓; prune (Task 6) ✓.
- SPEC §10 unit tests against temp git fixtures → all tasks ✓.
- Deferred (NOT gaps — Plans 02–04): agent integration, ad-hoc task, IPC/store/UI, merge/rebase actions, Review owner, Board pill, Code-tab awareness, stale UI.

**2. Placeholder scan:** No TBD/TODO/"handle edge cases"/"add validation" — every step has literal code and exact run commands. ✓

**3. Type consistency:** `WorktreeInfo {path,branch,head}`, `WorktreeStatus {branch,baseRef,ahead,behind,dirty,mergeable,conflicts,filesChanged,insertions,deletions}`, `CreateWorktreeParams {repoRoot,projectId,taskId,slug,baseRef?}`, `GitResult {code,stdout,stderr}` — defined once in Task 1's File Structure and used identically in Tasks 2–7. Method names `resolveBaseRef/create/list/status/remove/prune/runGit/branchName` consistent across tasks and the test file. ✓
