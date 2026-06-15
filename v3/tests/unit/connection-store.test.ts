import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
  ConnectionStore,
  deriveGitRepoMeta,
  parseGitHubRepoSlug,
  normalizeGitUrl,
  repoUrlsMatch,
  type ProjectConnection,
} from "../../electron/connection-store";

function git(args: string[], cwd: string): string {
  const r = spawnSync("git", args, { cwd, encoding: "utf8" });
  if (r.status !== 0)
    throw new Error(`git ${args.join(" ")} failed: ${r.stderr}`);
  return (r.stdout || "").trim();
}

/** Isolated tmp dir with an isolated store file path inside it. */
function makeStore(): {
  dir: string;
  storePath: string;
  store: ConnectionStore;
} {
  const base = fs.realpathSync(
    fs.mkdtempSync(path.join(os.tmpdir(), "marblo-conn-")),
  );
  const storePath = path.join(base, "connections.json");
  return { dir: base, storePath, store: new ConnectionStore({ storePath }) };
}

/** Fresh git repo on `main` with one commit and an origin remote + HEAD ref. */
function makeRepoWithOrigin(dir: string): string {
  const repoRoot = path.join(dir, "repo");
  fs.mkdirSync(repoRoot, { recursive: true });
  git(["init", "-b", "main"], repoRoot);
  git(["config", "user.email", "t@t.com"], repoRoot);
  git(["config", "user.name", "t"], repoRoot);
  fs.writeFileSync(path.join(repoRoot, "README.md"), "base\n");
  git(["add", "."], repoRoot);
  git(["commit", "-m", "init"], repoRoot);
  // Add an origin remote and pin origin/HEAD → origin/main so default-branch
  // resolution via refs/remotes/origin/HEAD works fully offline.
  git(
    ["remote", "add", "origin", "https://github.com/acme/widget.git"],
    repoRoot,
  );
  git(["update-ref", "refs/remotes/origin/main", "HEAD"], repoRoot);
  git(
    ["symbolic-ref", "refs/remotes/origin/HEAD", "refs/remotes/origin/main"],
    repoRoot,
  );
  return repoRoot;
}

describe("ConnectionStore round-trip", () => {
  let ctx: ReturnType<typeof makeStore>;
  beforeEach(() => {
    ctx = makeStore();
  });
  afterEach(() => {
    fs.rmSync(ctx.dir, { recursive: true, force: true });
  });

  it("returns null for an unknown project", () => {
    expect(ctx.store.get("nope")).toBeNull();
  });

  it("upserts a full record and reads it back identically", () => {
    const conn: ProjectConnection = {
      projectId: "p1",
      localPath: "/tmp/p1",
      repoUrl: "https://github.com/acme/p1.git",
      defaultBranch: "main",
      connectedHarness: "claude",
      availableMcps: ["marblo", "github"],
      accessMode: "pr",
      lastRunAt: 1234,
      permissionsState: "granted",
    };
    ctx.store.upsert(conn);
    expect(ctx.store.get("p1")).toEqual(conn);
  });

  it("persists across store instances (real file write)", () => {
    ctx.store.upsert({
      projectId: "p2",
      localPath: "/tmp/p2",
      repoUrl: null,
      defaultBranch: null,
      connectedHarness: null,
      availableMcps: [],
      accessMode: "read",
      lastRunAt: null,
      permissionsState: "unknown",
    });
    // A brand-new instance pointed at the same file must see it.
    const reopened = new ConnectionStore({ storePath: ctx.storePath });
    expect(reopened.get("p2")?.localPath).toBe("/tmp/p2");
  });

  it("upsert replaces an existing record by projectId", () => {
    const base: ProjectConnection = {
      projectId: "p3",
      localPath: "/tmp/p3",
      repoUrl: null,
      defaultBranch: null,
      connectedHarness: null,
      availableMcps: [],
      accessMode: "read",
      lastRunAt: null,
      permissionsState: "unknown",
    };
    ctx.store.upsert(base);
    ctx.store.upsert({ ...base, accessMode: "commit" });
    expect(ctx.store.get("p3")?.accessMode).toBe("commit");
    expect(ctx.store.list()).toHaveLength(1);
  });

  it("touchLastRun updates only when the record exists", () => {
    expect(ctx.store.touchLastRun("ghost", 999)).toBeNull();
    ctx.store.upsert({
      projectId: "p4",
      localPath: "/tmp/p4",
      repoUrl: null,
      defaultBranch: null,
      connectedHarness: null,
      availableMcps: [],
      accessMode: "read",
      lastRunAt: null,
      permissionsState: "unknown",
    });
    ctx.store.touchLastRun("p4", 777);
    expect(ctx.store.get("p4")?.lastRunAt).toBe(777);
  });

  it("remove deletes a record and reports whether it existed", () => {
    ctx.store.upsert({
      projectId: "p5",
      localPath: "/tmp/p5",
      repoUrl: null,
      defaultBranch: null,
      connectedHarness: null,
      availableMcps: [],
      accessMode: "read",
      lastRunAt: null,
      permissionsState: "unknown",
    });
    expect(ctx.store.remove("p5")).toBe(true);
    expect(ctx.store.remove("p5")).toBe(false);
    expect(ctx.store.get("p5")).toBeNull();
  });

  it("survives a corrupt store file (treats it as empty)", () => {
    fs.mkdirSync(path.dirname(ctx.storePath), { recursive: true });
    fs.writeFileSync(ctx.storePath, "{ not json", "utf-8");
    expect(ctx.store.list()).toEqual([]);
    // And a subsequent write recovers cleanly.
    ctx.store.upsert({
      projectId: "p6",
      localPath: "/tmp/p6",
      repoUrl: null,
      defaultBranch: null,
      connectedHarness: null,
      availableMcps: [],
      accessMode: "read",
      lastRunAt: null,
      permissionsState: "unknown",
    });
    expect(ctx.store.get("p6")?.projectId).toBe("p6");
  });
});

describe("connect() defaults + git auto-fill", () => {
  let ctx: ReturnType<typeof makeStore>;
  beforeEach(() => {
    ctx = makeStore();
  });
  afterEach(() => {
    fs.rmSync(ctx.dir, { recursive: true, force: true });
  });

  it("fills defaults for a minimal input (non-git path → null meta)", async () => {
    const nonGit = path.join(ctx.dir, "plain");
    fs.mkdirSync(nonGit, { recursive: true });
    const conn = await ctx.store.connect({
      projectId: "m1",
      localPath: nonGit,
    });
    expect(conn).toMatchObject({
      projectId: "m1",
      localPath: nonGit,
      repoUrl: null,
      defaultBranch: null,
      connectedHarness: null,
      availableMcps: [],
      accessMode: "read",
      lastRunAt: null,
      permissionsState: "unknown",
    });
  });

  it("auto-fills repoUrl + defaultBranch from a real git repo", async () => {
    const repoRoot = makeRepoWithOrigin(ctx.dir);
    const conn = await ctx.store.connect({
      projectId: "m2",
      localPath: repoRoot,
    });
    expect(conn.repoUrl).toBe("https://github.com/acme/widget.git");
    expect(conn.defaultBranch).toBe("main");
    // And it round-trips through the file.
    expect(ctx.store.get("m2")?.repoUrl).toBe(
      "https://github.com/acme/widget.git",
    );
  });

  it("does not overwrite explicitly provided repo meta with git", async () => {
    const repoRoot = makeRepoWithOrigin(ctx.dir);
    const conn = await ctx.store.connect({
      projectId: "m3",
      localPath: repoRoot,
      repoUrl: "https://example.com/override.git",
      defaultBranch: "develop",
    });
    expect(conn.repoUrl).toBe("https://example.com/override.git");
    expect(conn.defaultBranch).toBe("develop");
  });

  it("merges partial updates over an existing record", async () => {
    const repoRoot = makeRepoWithOrigin(ctx.dir);
    await ctx.store.connect({ projectId: "m4", localPath: repoRoot });
    const updated = await ctx.store.connect({
      projectId: "m4",
      localPath: repoRoot,
      connectedHarness: "codex",
      accessMode: "write",
      availableMcps: ["marblo"],
    });
    // New fields applied…
    expect(updated.connectedHarness).toBe("codex");
    expect(updated.accessMode).toBe("write");
    expect(updated.availableMcps).toEqual(["marblo"]);
    // …and the previously derived git meta is preserved.
    expect(updated.repoUrl).toBe("https://github.com/acme/widget.git");
    expect(updated.defaultBranch).toBe("main");
  });
});

describe("deriveGitRepoMeta", () => {
  let dir: string;
  beforeEach(() => {
    dir = fs.realpathSync(
      fs.mkdtempSync(path.join(os.tmpdir(), "marblo-git-")),
    );
  });
  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("returns null meta for a non-git directory (never throws)", async () => {
    const meta = await deriveGitRepoMeta(dir);
    expect(meta).toEqual({ repoUrl: null, defaultBranch: null });
  });

  it("falls back to the current branch when origin/HEAD is absent", async () => {
    const repoRoot = path.join(dir, "repo");
    fs.mkdirSync(repoRoot, { recursive: true });
    git(["init", "-b", "trunk"], repoRoot);
    git(["config", "user.email", "t@t.com"], repoRoot);
    git(["config", "user.name", "t"], repoRoot);
    fs.writeFileSync(path.join(repoRoot, "f"), "x\n");
    git(["add", "."], repoRoot);
    git(["commit", "-m", "i"], repoRoot);
    const meta = await deriveGitRepoMeta(repoRoot);
    expect(meta.repoUrl).toBeNull(); // no origin remote
    expect(meta.defaultBranch).toBe("trunk"); // current-branch fallback
  });
});

describe("parseGitHubRepoSlug", () => {
  it("parses https form (with/without .git, trailing slash)", () => {
    expect(parseGitHubRepoSlug("https://github.com/owner/repo")).toBe(
      "owner/repo",
    );
    expect(parseGitHubRepoSlug("https://github.com/owner/repo.git")).toBe(
      "owner/repo",
    );
    expect(parseGitHubRepoSlug("https://github.com/owner/repo/")).toBe(
      "owner/repo",
    );
  });

  it("parses ssh (scp) form", () => {
    expect(parseGitHubRepoSlug("git@github.com:owner/repo.git")).toBe(
      "owner/repo",
    );
  });

  it("preserves case in the returned slug", () => {
    expect(parseGitHubRepoSlug("https://github.com/Owner/Repo")).toBe(
      "Owner/Repo",
    );
  });

  it("returns null for non-github hosts and bad input", () => {
    expect(parseGitHubRepoSlug("https://gitlab.com/owner/repo")).toBeNull();
    expect(parseGitHubRepoSlug("not a url")).toBeNull();
    expect(parseGitHubRepoSlug(null)).toBeNull();
    expect(parseGitHubRepoSlug(undefined)).toBeNull();
    expect(parseGitHubRepoSlug("")).toBeNull();
  });
});

describe("normalizeGitUrl", () => {
  it("normalizes https/ssh of the same self-hosted repo to one form", () => {
    expect(normalizeGitUrl("https://git.example.com/Team/Proj.git")).toBe(
      "git.example.com/team/proj",
    );
    expect(normalizeGitUrl("git@git.example.com:Team/Proj.git")).toBe(
      "git.example.com/team/proj",
    );
  });

  it("returns null for junk", () => {
    expect(normalizeGitUrl("nonsense")).toBeNull();
    expect(normalizeGitUrl(null)).toBeNull();
    expect(normalizeGitUrl("")).toBeNull();
  });
});

describe("repoUrlsMatch", () => {
  it("matches the same GitHub repo across protocol/case/.git/slash variants", () => {
    expect(
      repoUrlsMatch(
        "git@github.com:Owner/Repo.git",
        "https://github.com/owner/repo/",
      ),
    ).toBe(true);
  });

  it("flags different GitHub repos as a mismatch", () => {
    expect(
      repoUrlsMatch(
        "https://github.com/owner/repo",
        "https://github.com/owner/other",
      ),
    ).toBe(false);
  });

  it("falls back to generic normalization for non-github hosts", () => {
    expect(
      repoUrlsMatch(
        "git@git.example.com:team/proj.git",
        "https://git.example.com/team/proj",
      ),
    ).toBe(true);
    expect(
      repoUrlsMatch(
        "https://git.example.com/team/proj",
        "https://git.example.com/team/other",
      ),
    ).toBe(false);
  });

  it("does not cross-match github and a same-named self-hosted repo", () => {
    expect(
      repoUrlsMatch(
        "https://github.com/owner/repo",
        "https://gitlab.com/owner/repo",
      ),
    ).toBe(false);
  });

  it("returns false when either side is missing/unparseable", () => {
    expect(repoUrlsMatch(null, "https://github.com/owner/repo")).toBe(false);
    expect(repoUrlsMatch("https://github.com/owner/repo", "")).toBe(false);
    expect(repoUrlsMatch("junk", "also junk")).toBe(false);
  });
});
