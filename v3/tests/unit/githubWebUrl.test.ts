import { describe, expect, it } from "vitest";
import { githubCompareUrl, githubRepoWebBase, githubTreeUrl, worktreeGithubUrl, githubCollaboratorsUrl } from "../../src/lib/githubWebUrl";

describe("githubRepoWebBase", () => {
  it("parses common remotes", () => {
    expect(githubRepoWebBase("git@github.com:melocream/marblo.git")).toBe("https://github.com/melocream/marblo");
    expect(githubRepoWebBase("https://github.com/melocream/marblo")).toBe("https://github.com/melocream/marblo");
    expect(githubRepoWebBase("ssh://git@github.com/melocream/marblo.git")).toBe("https://github.com/melocream/marblo");
  });
  it("preserves case and rejects non-GitHub remotes", () => {
    expect(githubRepoWebBase("git@github.com:Melo/Marblo.git")).toBe("https://github.com/Melo/Marblo");
    expect(githubRepoWebBase("git@gitlab.com:foo/bar.git")).toBeNull();
    expect(githubRepoWebBase(null)).toBeNull();
  });
});

describe("githubTreeUrl / githubCompareUrl", () => {
  const base = "https://github.com/melocream/marblo";
  it("builds tree and compare URLs", () => {
    expect(githubTreeUrl(base, "feature/foo")).toBe(`${base}/tree/feature/foo`);
    expect(githubCompareUrl(base, "origin/main", "feature/foo")).toBe(`${base}/compare/main...feature/foo`);
  });
});

describe("worktreeGithubUrl", () => {
  it("builds compare/tree URLs and rejects invalid input", () => {
    const remote = "git@github.com:melocream/marblo.git";
    expect(worktreeGithubUrl({ remoteUrl: remote, branch: "feat/x", baseRef: "main" })).toBe("https://github.com/melocream/marblo/compare/main...feat/x");
    expect(worktreeGithubUrl({ remoteUrl: remote, branch: "main", baseRef: "main" })).toBe("https://github.com/melocream/marblo/tree/main");
    expect(worktreeGithubUrl({ remoteUrl: null, branch: "x" })).toBeNull();
  });
});

describe("githubCollaboratorsUrl", () => {
  it.each([
    ["https://github.com/acme/widget.git", "https://github.com/acme/widget/settings/access"],
    ["git@github.com:acme/widget.git", "https://github.com/acme/widget/settings/access"],
    ["ssh://git@github.com/acme/widget", "https://github.com/acme/widget/settings/access"],
  ])("parses %s", (remote, expected) => expect(githubCollaboratorsUrl(remote)).toBe(expected));
  it("returns null for non-GitHub or missing remotes", () => {
    expect(githubCollaboratorsUrl("https://gitlab.com/acme/widget.git")).toBeNull();
    expect(githubCollaboratorsUrl(undefined)).toBeNull();
  });
});
