import { describe, it, expect } from "vitest";

import { selectUnfetchedNotice } from "../../src/components/tabs/worktreeCoverageBanner";
import { WORKTREE_PROJECT_FILTER_ALL } from "../../src/components/tabs/worktreeProjectFilter";

const entry = (over: Partial<WorktreeCoverage> = {}): WorktreeCoverage => ({
  projectId: "P1",
  onDisk: 0,
  listed: 0,
  missing: 0,
  strayDirs: 0,
  unreachableRoots: [],
  ...over,
});

describe("selectUnfetchedNotice", () => {
  it("stays silent when everything on disk was listed", () => {
    expect(
      selectUnfetchedNotice(
        [entry({ onDisk: 8, listed: 8, missing: 0 })],
        WORKTREE_PROJECT_FILTER_ALL,
      ),
    ).toBeNull();
  });

  it("stays silent when there is no coverage information at all", () => {
    // Older preload / failed probe → the filter banner keeps working alone.
    expect(selectUnfetchedNotice([], WORKTREE_PROJECT_FILTER_ALL)).toBeNull();
  });

  it("reports the fetch-side loss the filter banner cannot see (NHCsWfnp)", () => {
    // The measured outage: 81 on disk, 7 listed, 74 never fetched. hiddenCount
    // was 0 throughout, so #1045's banner said nothing.
    const notice = selectUnfetchedNotice(
      [
        entry({
          onDisk: 81,
          listed: 7,
          missing: 74,
          unreachableRoots: ["/Users/x/Documents/programming/marblo"],
        }),
      ],
      WORKTREE_PROJECT_FILTER_ALL,
    );

    expect(notice).not.toBeNull();
    expect(notice?.missing).toBe(74);
    expect(notice?.unreachableRoots).toEqual([
      "/Users/x/Documents/programming/marblo",
    ]);
  });

  it("scopes to the selected project", () => {
    const coverage = [
      entry({ projectId: "P1", missing: 3, unreachableRoots: ["/a"] }),
      entry({ projectId: "P2", missing: 40, unreachableRoots: ["/b"] }),
    ];

    expect(selectUnfetchedNotice(coverage, "P1")).toEqual({
      missing: 3,
      unreachableRoots: ["/a"],
    });
    // A project with nothing missing must not inherit another's problem.
    expect(
      selectUnfetchedNotice([entry({ projectId: "P1" }), coverage[1]], "P1"),
    ).toBeNull();
  });

  it("sums across projects and de-duplicates shared roots under 'all'", () => {
    const notice = selectUnfetchedNotice(
      [
        entry({ projectId: "P1", missing: 2, unreachableRoots: ["/x", "/y"] }),
        entry({ projectId: "P2", missing: 5, unreachableRoots: ["/y"] }),
      ],
      WORKTREE_PROJECT_FILTER_ALL,
    );

    expect(notice?.missing).toBe(7);
    expect(notice?.unreachableRoots).toEqual(["/x", "/y"]);
  });

  it("ignores a negative count rather than rendering a nonsense banner", () => {
    expect(
      selectUnfetchedNotice(
        [entry({ missing: -3 })],
        WORKTREE_PROJECT_FILTER_ALL,
      ),
    ).toBeNull();
  });
});
