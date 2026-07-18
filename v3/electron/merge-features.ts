// De-identified merge/diff features for the routing data-collection pipeline
// (docs/bigquery-ml-readiness.md §4.1). These are DERIVED metrics only —
// counts and a path-shape category — never the raw diff or file contents.
// Privacy gate: no code text ever leaves the machine; a squash-merged commit
// yields only "N files, +X/-Y lines, looks like a docs/test/config/code change".
//
// Parsing lives here (pure, unit-tested) so WorktreeManager only has to run git
// and hand the output over — the fiddly numstat/rename edge cases are covered
// by merge-features.test.ts rather than an integration test that needs a repo.

/** Aggregate diff statistics for a single commit. */
export interface DiffStat {
  filesChanged: number;
  linesAdded: number;
  linesDeleted: number;
  /** Post-rename destination paths of the changed files. */
  paths: string[];
}

/** Coarse, path-derived change category. Intentionally NOT "feature vs fix" —
 *  that needs commit semantics we deliberately don't collect. What the file
 *  paths alone can honestly tell us: which kind of files moved. */
export type ChangeType =
  | "docs"
  | "test"
  | "config"
  | "code"
  | "mixed"
  | "unknown";

/**
 * Parse `git show --numstat --format=` (or `git diff --numstat`) output into
 * aggregate stats. Each data line is "<added>\t<deleted>\t<path>". Binary files
 * emit "-\t-\t<path>" → counted as a changed file, 0 lines. Robust to blank
 * lines and rename notation ("a => b" or "{a => b}") in the path column.
 */
export function parseDiffNumstat(stdout: string): DiffStat {
  let filesChanged = 0;
  let linesAdded = 0;
  let linesDeleted = 0;
  const paths: string[] = [];

  for (const raw of stdout.split("\n")) {
    if (!raw.trim()) continue;
    const parts = raw.split("\t");
    if (parts.length < 3) continue;
    const [ins, del, ...rest] = parts;
    filesChanged++;
    linesAdded += ins === "-" ? 0 : parseInt(ins, 10) || 0;
    linesDeleted += del === "-" ? 0 : parseInt(del, 10) || 0;
    paths.push(normalizeRenamePath(rest.join("\t")).trim());
  }

  return { filesChanged, linesAdded, linesDeleted, paths };
}

/** Reduce git's rename notation to the destination path. Handles both the
 *  "old => new" and "dir/{old => new}/file" forms git uses in numstat. */
function normalizeRenamePath(p: string): string {
  if (!p.includes("=>")) return p;
  // "src/{a => b}/x.ts" → "src/b/x.ts"; "a.ts => b.ts" → "b.ts".
  return p
    .replace(/\{[^}]*=>\s*([^}]*)\}/g, "$1")
    .replace(/^.*=>\s*/, "")
    .replace(/\/{2,}/g, "/");
}

function categorizePath(p: string): "docs" | "test" | "config" | "code" {
  const lower = p.toLowerCase();
  const base = lower.split("/").pop() ?? lower;

  if (
    /\.(test|spec)\.[cm]?[jt]sx?$/.test(base) ||
    /(^|\/)(tests?|__tests__|e2e|__mocks__)(\/|$)/.test(lower)
  ) {
    return "test";
  }
  if (
    /\.(md|mdx|markdown|rst|txt|adoc)$/.test(base) ||
    /(^|\/)docs?(\/|$)/.test(lower) ||
    /^(readme|changelog|license|contributing|authors)\b/.test(base)
  ) {
    return "docs";
  }
  if (
    /\.(json|ya?ml|toml|ini|cfg|conf|lock|env|properties)$/.test(base) ||
    /\.(config|rc)\.[cm]?[jt]s$/.test(base) ||
    /^\.[a-z]/.test(base) || // dotfiles: .gitignore, .eslintrc, .env.*
    /(^|\/)(dockerfile|makefile)$/.test(lower)
  ) {
    return "config";
  }
  return "code";
}

/**
 * Best-effort classify a change from the set of touched file paths ONLY.
 * De-identified: uses path shape (extension, well-known dirs), never contents.
 *
 * Rules, in order:
 *   - no paths            → "unknown"
 *   - any real code file  → "code" (tests/config accompanying code is still a
 *                            code change; this is the common feature+its-test case)
 *   - single category     → that category ("docs" | "test" | "config")
 *   - spans docs/test/config with no code → "mixed"
 */
export function classifyChangeType(paths: string[]): ChangeType {
  const cats = new Set<string>();
  for (const p of paths) {
    if (!p.trim()) continue;
    cats.add(categorizePath(p));
  }
  if (cats.size === 0) return "unknown";
  if (cats.has("code")) return "code";
  if (cats.size === 1) return [...cats][0] as ChangeType;
  return "mixed";
}
