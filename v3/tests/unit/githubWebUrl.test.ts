import { describe, expect, it } from "vitest";
import {
  githubCompareUrl,
  githubRepoWebBase,
  githubTreeUrl,
  worktreeGithubUrl,
} from "../../src/lib/githubWebUrl";

describe("githubRepoWebBase", () => {
  it("parses scp-style git@ remotes", () => {
    expect(githubRepoWebBase("git@github.com:melocream/marblo.git")).toBe(
      "https://github.com/melocream/marblo",
    );
  });

  it("parses https remotes with and without .git", () => {
    expect(githubRepoWebBase("https://github.com/melocream/marblo.git")).toBe(
      "https://github.com/melocream/marblo",
    );
    expect(githubRepoWebBase("https://github.com/melocream/marblo")).toBe(
      "https://github.com/melocream/marblo",
    );
  });

  it("parses ssh:// remotes", () => {
    expect(githubRepoWebBase("ssh://git@github.com/melocream/marblo.git")).toBe(
      "https://github.com/melocream/marblo",
    );
  });

  it("preserves owner/repo case (github redirects, but keep it)", () => {
    expect(githubRepoWebBase("git@github.com:Melo/Marblo.git")).toBe(
      "https://github.com/Melo/Marblo",
    );
  });

  it("is idempotent on an already-parsed base URL", () => {
    const base = "https://github.com/melocream/marblo";
    expect(githubRepoWebBase(base)).toBe(base);
  });

  it("returns null for non-github hosts", () => {
    expect(githubRepoWebBase("git@gitlab.com:foo/bar.git")).toBeNull();
    expect(githubRepoWebBase("https://bitbucket.org/foo/bar")).toBeNull();
  });

  it("returns null for empty / unparseable input", () => {
    expect(githubRepoWebBase(null)).toBeNull();
    expect(githubRepoWebBase(undefined)).toBeNull();
    expect(githubRepoWebBase("")).toBeNull();
    expect(githubRepoWebBase("not a url")).toBeNull();
  });
});

describe("githubTreeUrl / githubCompareUrl", () => {
  const base = "https://github.com/melocream/marblo";

  it("builds a tree URL, keeping branch slashes", () => {
    expect(githubTreeUrl(base, "feature/foo")).toBe(`${base}/tree/feature/foo`);
  });

  it("builds a compare URL and strips origin/ from the base ref", () => {
    expect(githubCompareUrl(base, "origin/main", "feature/foo")).toBe(
      `${base}/compare/main...feature/foo`,
    );
  });

  it("encodes unsafe characters but not path separators", () => {
    expect(githubTreeUrl(base, "feat/a b")).toBe(`${base}/tree/feat/a%20b`);
  });
});

describe("worktreeGithubUrl", () => {
  const remote = "git@github.com:melocream/marblo.git";
  const base = "https://github.com/melocream/marblo";

  it("prefers the compare view when a distinct base ref is known", () => {
    expect(
      worktreeGithubUrl({
        remoteUrl: remote,
        branch: "feat/x",
        baseRef: "main",
      }),
    ).toBe(`${base}/compare/main...feat/x`);
  });

  it("falls back to the tree view when base equals branch", () => {
    expect(
      worktreeGithubUrl({ remoteUrl: remote, branch: "main", baseRef: "main" }),
    ).toBe(`${base}/tree/main`);
  });

  it("falls back to the tree view when no base ref is given", () => {
    expect(worktreeGithubUrl({ remoteUrl: remote, branch: "feat/x" })).toBe(
      `${base}/tree/feat/x`,
    );
  });

  it("returns null without a github remote or a branch", () => {
    expect(
      worktreeGithubUrl({ remoteUrl: "git@gitlab.com:a/b.git", branch: "x" }),
    ).toBeNull();
    expect(worktreeGithubUrl({ remoteUrl: remote, branch: "" })).toBeNull();
    expect(worktreeGithubUrl({ remoteUrl: null, branch: "x" })).toBeNull();
  });
});
