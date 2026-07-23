/**
 * Turn a git *remote* URL into GitHub **web** URLs (the ones a browser opens),
 * for the Worktrees-tab "GitHub" button.
 *
 * Distinct from `services/projectService.normalizeGitRemoteUrl`, which
 * lower-cases everything to build a match key. We must NOT lower-case: a GitHub
 * branch segment (`tree/<branch>`, `compare/…<branch>`) is case-sensitive, so
 * the case has to survive. Owner/repo are case-insensitive on github.com
 * (it redirects), so preserving their original case is harmless.
 *
 * Only github.com is handled — other hosts (GitLab, Bitbucket, self-hosted)
 * would need different path shapes, and the button is meant to disable rather
 * than guess. Enterprise GitHub on a custom domain is intentionally out of
 * scope for the same reason.
 */

const GITHUB_HOST = "github.com";

interface GithubRepo {
  owner: string;
  repo: string;
}

/** Parse `host`, `owner`, `repo` out of any common git remote URL spelling. */
function parseRemote(url: string): { host: string; repo: GithubRepo } | null {
  const s = url.trim().replace(/\/+$/, "");
  if (!s) return null;

  let host: string;
  let path: string;

  // scp-like: git@host:owner/repo(.git)
  const scp = s.match(/^[^@]+@([^:/]+):(.+)$/);
  if (scp) {
    host = scp[1];
    path = scp[2];
  } else {
    // URL form: (ssh|https|http|git)://[user@]host/owner/repo(.git)
    const m = s.match(/^[a-z]+:\/\/(?:[^@/]+@)?([^/]+)\/(.+)$/i);
    if (!m) return null;
    host = m[1];
    path = m[2];
  }

  const repo = parseOwnerRepo(path);
  if (!repo) return null;
  return { host: host.toLowerCase(), repo };
}

/** `owner/repo(.git)(/anything)` → {owner, repo}, case preserved. */
function parseOwnerRepo(path: string): GithubRepo | null {
  const cleaned = path.replace(/\.git$/i, "");
  const segments = cleaned.split("/").filter(Boolean);
  if (segments.length < 2) return null;
  return { owner: segments[0], repo: segments[1] };
}

/**
 * The `https://github.com/<owner>/<repo>` base for a remote, or null when the
 * remote is absent, unparseable, or not on github.com.
 */
export function githubRepoWebBase(
  remoteUrl: string | null | undefined,
): string | null {
  if (!remoteUrl) return null;
  const parsed = parseRemote(remoteUrl);
  if (!parsed || parsed.host !== GITHUB_HOST) return null;
  return `https://${GITHUB_HOST}/${parsed.repo.owner}/${parsed.repo.repo}`;
}

/** Encode a branch for a URL path, keeping `/` separators (feat/x → feat/x). */
function encodeBranch(branch: string): string {
  return branch.split("/").map(encodeURIComponent).join("/");
}

/** Strip a leading `origin/` (or `remotes/<name>/`) from a base ref. */
function bareBranch(ref: string): string {
  return ref.replace(/^remotes\/[^/]+\//, "").replace(/^origin\//, "");
}

/** `…/tree/<branch>` — the branch's file view on GitHub. */
export function githubTreeUrl(base: string, branch: string): string {
  return `${base}/tree/${encodeBranch(branch)}`;
}

/** `…/compare/<base>...<branch>` — the audit diff (what this branch changed). */
export function githubCompareUrl(
  base: string,
  baseRef: string,
  branch: string,
): string {
  return `${base}/compare/${encodeBranch(bareBranch(baseRef))}...${encodeBranch(
    branch,
  )}`;
}

/**
 * Best GitHub web URL for a worktree's branch: the audit **compare** view
 * (base…branch) when a distinct base ref is known, else the branch **tree**.
 * Returns null when there is no github.com remote or no branch.
 */
export function worktreeGithubUrl(input: {
  remoteUrl: string | null | undefined;
  branch: string;
  baseRef?: string | null;
}): string | null {
  const base = githubRepoWebBase(input.remoteUrl);
  if (!base || !input.branch) return null;
  const baseRef = input.baseRef ? bareBranch(input.baseRef) : "";
  if (baseRef && baseRef !== input.branch) {
    return githubCompareUrl(base, input.baseRef as string, input.branch);
  }
  return githubTreeUrl(base, input.branch);
}
