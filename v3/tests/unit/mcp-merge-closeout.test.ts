/**
 * Ticket pn2m5cVx — `merge_and_close` decision core.
 *
 * The whole point of extracting this as a pure function is that the dangerous
 * direction is asymmetric: a wrong DONE flip silently closes work that is NOT
 * finished ("코드 머지 ≠ 작업 완료"), while a wrong HOLD just leaves a ticket in
 * REVIEW where a human sees it. So these tests pin the hold-biased branch with
 * the two REAL tickets that motivated it:
 *   • N8sAY4Tj — marketing_contacts 백필 미실행 (PR #585 MERGED, ticket REVIEW,
 *     comment says "DONE 아님", 차단 사유 2개, 승인 미수령)
 *   • 84tDu7UW — 센트리 대시보드 승인 대기
 */
import { describe, it, expect } from "vitest";
import {
  evaluateMergeCloseout,
  detectFollowupSignals,
  formatMergeWikiDecisionPrompt,
  isWikiDecisionResolvedMessage,
  shouldPromptForMergeWikiDecision,
  parsePrNumber,
  branchMatchesTask,
  type CloseoutInput,
} from "../../electron/mcp-server/merge-closeout";

const merged = { state: "MERGED" as const, prNumber: 585 };

const input = (over: Partial<CloseoutInput> = {}): CloseoutInput => ({
  status: "REVIEW",
  merge: merged,
  ...over,
});

describe("evaluateMergeCloseout — merged PR, clean ticket", () => {
  it("flips REVIEW → DONE in one legal transition", () => {
    const v = evaluateMergeCloseout(input());
    expect(v.action).toBe("FLIP_DONE");
    expect(v.path).toEqual(["DONE"]);
    expect(v.reapWorktree).toBe(true);
  });

  it("walks IN_PROGRESS → REVIEW → DONE rather than bypassing the state machine", () => {
    // IN_PROGRESS -> DONE is NOT a legal edge (state-machine.ts). Going through
    // REVIEW keeps every hop validated instead of reaching for force=true.
    const v = evaluateMergeCloseout(input({ status: "IN_PROGRESS" }));
    expect(v.action).toBe("FLIP_DONE");
    expect(v.path).toEqual(["REVIEW", "DONE"]);
  });

  it("treats a comment with no hold language as clean", () => {
    const v = evaluateMergeCloseout(
      input({ comment: "PR #585 머지 완료. 타입체크 클린, 테스트 통과." }),
    );
    expect(v.action).toBe("FLIP_DONE");
    expect(v.followupSignals).toEqual([]);
  });
});

describe("evaluateMergeCloseout — needs_followup holds at REVIEW", () => {
  it("holds N8sAY4Tj (백필 실적재): merged PR but comment says DONE 아님", () => {
    const v = evaluateMergeCloseout(
      input({
        comment:
          "조사·계획 완료, 실행은 차단 상태로 대기. DONE 아님 — 티켓 목표(백필 실행)가 미달성이다.\n" +
          "★차단 사유 2개\n① 하드 블로커: 시크릿 부재\n② 사장님 승인 미수령 (프로덕션 데이터 변경)",
      }),
    );
    expect(v.action).toBe("HOLD_REVIEW");
    expect(v.path).toEqual([]);
    // Signals are reported normalized (lower-cased) so they can be quoted back
    // verbatim in the hold comment.
    expect(v.followupSignals).toContain("done 아님");
    expect(v.followupSignals).toEqual(
      expect.arrayContaining(["done 아님", "승인 미수령", "차단"]),
    );
    expect(v.reason).toMatch(/후속/);
  });

  it("holds 84tDu7UW-style approval-pending tickets", () => {
    const v = evaluateMergeCloseout(
      input({
        comment: "코드는 머지됐으나 센트리 대시보드 알림규칙 승인 대기.",
      }),
    );
    expect(v.action).toBe("HOLD_REVIEW");
    expect(v.followupSignals).toContain("승인 대기");
  });

  it("brings an IN_PROGRESS followup ticket up to REVIEW but no further", () => {
    const v = evaluateMergeCloseout(
      input({ status: "IN_PROGRESS", comment: "라이브 검증 대기" }),
    );
    expect(v.action).toBe("HOLD_REVIEW");
    expect(v.path).toEqual(["REVIEW"]);
  });

  it("honors an explicit needs_followup marker even in the description", () => {
    // The description is the immutable creation-time spec, so it is scanned ONLY
    // for a deliberate opt-in marker — never for incidental planning language.
    const v = evaluateMergeCloseout(
      input({
        description: "## 목표\nneeds_followup: 배포 후 라이브 재측정 필요",
      }),
    );
    expect(v.action).toBe("HOLD_REVIEW");
    expect(v.followupSignals).toContain("needs_followup");
  });

  it("still reaps the worktree while holding — the merged code is on origin", () => {
    const v = evaluateMergeCloseout(input({ comment: "승인 대기" }));
    expect(v.reapWorktree).toBe(true);
  });
});

describe("detectFollowupSignals — precision guards", () => {
  it("does NOT scan the description for incidental planning language", () => {
    // Nearly every ticket's 제약·주의 section says approval is required at plan
    // time. Scanning it would hold every ticket forever and make the tool
    // useless — 84tDu7UW itself shipped DONE with exactly this wording.
    expect(
      detectFollowupSignals({
        description:
          "## 제약·주의\n- ★프로덕션 데이터 변경이므로 실행 전 사장님 승인 필수",
      }),
    ).toEqual([]);
  });

  it("does not fire on unchecked acceptance checkboxes", () => {
    // `- [ ]` is present in essentially every ticket body; it carries no signal.
    expect(
      detectFollowupSignals({
        comment: "완료 기준\n- [ ] 항목 1\n- [ ] 항목 2",
      }),
    ).toEqual([]);
  });

  it("ignores a negated blocker (차단 없음 / no blockers)", () => {
    expect(detectFollowupSignals({ comment: "차단 없음, 머지 완료" })).toEqual(
      [],
    );
    expect(detectFollowupSignals({ comment: "blocker: none" })).toEqual([]);
    expect(detectFollowupSignals({ comment: "블로커 해소됨" })).toEqual([]);
  });

  it("matches English hold language case-insensitively", () => {
    expect(
      detectFollowupSignals({ comment: "Merged, but AWAITING APPROVAL." }),
    ).toContain("awaiting approval");
  });

  it("scans notes as live state", () => {
    expect(
      detectFollowupSignals({ notes: ["시크릿 생성 후 재배포 보류"] }),
    ).toContain("보류");
  });

  it("dedups repeated signals", () => {
    const s = detectFollowupSignals({ comment: "보류. 다시 보류. 또 보류." });
    expect(s).toEqual(["보류"]);
  });
});

describe("evaluateMergeCloseout — unmerged PR changes nothing", () => {
  it.each([
    ["OPEN" as const, /open/i],
    ["CLOSED" as const, /closed/i],
    ["UNKNOWN" as const, /확인/],
  ])("state=%s → NO_CHANGE and no worktree reap", (state, reasonRe) => {
    const v = evaluateMergeCloseout(input({ merge: { state } }));
    expect(v.action).toBe("NO_CHANGE");
    expect(v.path).toEqual([]);
    expect(v.reapWorktree).toBe(false);
    expect(v.reason).toMatch(reasonRe);
  });

  it("a conflicting (DIRTY) but still-open PR never flips", () => {
    const v = evaluateMergeCloseout(
      input({ merge: { state: "OPEN", mergeStateStatus: "DIRTY" } }),
    );
    expect(v.action).toBe("NO_CHANGE");
    expect(v.reason).toMatch(/충돌/);
  });

  it("a followup ticket with an unmerged PR is NO_CHANGE, not HOLD", () => {
    // Merge state is checked before followup: with nothing merged there is no
    // closeout to perform at all.
    const v = evaluateMergeCloseout(
      input({ merge: { state: "OPEN" }, comment: "승인 대기" }),
    );
    expect(v.action).toBe("NO_CHANGE");
  });
});

describe("merge-time wiki decision prompt", () => {
  it("MERGED면 reap 결과와 무관하게 묻되, 해소 기록이 있으면 반복하지 않는다", () => {
    expect(
      shouldPromptForMergeWikiDecision({
        mergeState: "MERGED",
        alreadyResolved: false,
      }),
    ).toBe(true);
    expect(
      shouldPromptForMergeWikiDecision({
        mergeState: "MERGED",
        alreadyResolved: true,
      }),
    ).toBe(false);
    expect(
      shouldPromptForMergeWikiDecision({
        mergeState: "OPEN",
        alreadyResolved: false,
      }),
    ).toBe(false);
  });

  it("asks for a human decision without making wiki writing the default", () => {
    const out = formatMergeWikiDecisionPrompt({
      taskId: "task-123",
      pendingUnresolvedCount: 2,
      pendingExamples: ["task-123 현재 작업", "old-task 이전 작업"],
    });

    expect(out).toContain("이번 변경이 다음 작업에도 반복될 규칙인가");
    expect(out).toContain("docs/wiki/_meta/WIKI-SKIP.md");
    expect(out).toContain("[wiki-decision:resolved]");
    expect(out).toContain("미판정 누적: 2건");
    expect(out).not.toContain("자동으로");
  });

  it("recognizes either the explicit resolved marker or the skip/wiki-note paths", () => {
    expect(
      isWikiDecisionResolvedMessage(
        "[wiki-decision:resolved] docs/wiki/40-methodology/example.md",
      ),
    ).toBe(true);
    expect(
      isWikiDecisionResolvedMessage(
        "docs/wiki/_meta/WIKI-SKIP.md 에 사유를 남김",
      ),
    ).toBe(true);
    expect(isWikiDecisionResolvedMessage("/wiki-note 로 노트 작성")).toBe(true);
    expect(
      isWikiDecisionResolvedMessage(
        "[wiki-decision:pending] decide whether WIKI-SKIP is needed",
      ),
    ).toBe(false);
    expect(isWikiDecisionResolvedMessage("일반 진행 로그")).toBe(false);
  });
});

describe("evaluateMergeCloseout — ineligible ticket states", () => {
  it("an already-DONE ticket is an idempotent no-op that still reaps", () => {
    const v = evaluateMergeCloseout(input({ status: "DONE" }));
    expect(v.action).toBe("NO_CHANGE");
    expect(v.path).toEqual([]);
    expect(v.reapWorktree).toBe(true);
    expect(v.reason).toMatch(/이미 DONE/);
  });

  it.each(["TODO", "CLAIMED", "BLOCKED", "FAILED"] as const)(
    "%s is not a closeout candidate",
    (status) => {
      const v = evaluateMergeCloseout(input({ status }));
      expect(v.action).toBe("NO_CHANGE");
      expect(v.reapWorktree).toBe(false);
      expect(v.reason).toMatch(/REVIEW\/IN_PROGRESS/);
    },
  );
});

describe("parsePrNumber", () => {
  it("extracts the number from a PR URL", () => {
    expect(parsePrNumber("https://github.com/melocream/marblo/pull/585")).toBe(
      585,
    );
    expect(
      parsePrNumber("https://github.com/melocream/marblo/pull/585/files"),
    ).toBe(585);
  });

  it("returns null for anything that is not a PR URL", () => {
    expect(parsePrNumber("")).toBeNull();
    expect(parsePrNumber(undefined)).toBeNull();
    expect(
      parsePrNumber("https://github.com/melocream/marblo/issues/585"),
    ).toBe(null);
    expect(parsePrNumber("nope")).toBeNull();
  });
});

describe("branchMatchesTask", () => {
  // WorktreeManager.branchName → `marblo/<slug>-<taskId.slice(0,8)>`, widening
  // the id suffix on collision. Match on the suffix, not the slug.
  it("matches the 8-char task-id suffix convention", () => {
    expect(
      branchMatchesTask(
        "marblo/devops-claude-wc6q-N8sAY4Tj",
        "N8sAY4Tjelm5EhZmvjvv",
      ),
    ).toBe(true);
  });

  it("matches a widened (collision-resolved) id suffix", () => {
    expect(
      branchMatchesTask(
        "marblo/devops-claude-wc6q-N8sAY4Tjelm5",
        "N8sAY4Tjelm5EhZmvjvv",
      ),
    ).toBe(true);
  });

  it("does not match a different task", () => {
    expect(
      branchMatchesTask(
        "marblo/sentry-env-split-claude-84tDu7UW",
        "N8sAY4Tjelm5EhZmvjvv",
      ),
    ).toBe(false);
  });

  it("is not fooled by a short/empty id", () => {
    expect(branchMatchesTask("marblo/whatever-abc", "")).toBe(false);
    expect(branchMatchesTask("", "N8sAY4Tjelm5EhZmvjvv")).toBe(false);
  });
});
