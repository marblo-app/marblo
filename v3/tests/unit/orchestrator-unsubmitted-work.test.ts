// 미제출 작업(unsurfaced work) 감지 회귀 (티켓 Z4095CT4CpAuTVtnAp9l, PM 피드백).
//
// 고정하는 계약:
//   ① ★판정은 PR 존재(open·merged·closed) 기준이다 — "원격에 없는 커밋"
//      (unpushed/git cherry) 기준이 아니다. 이 저장소는 squash 머지를 쓴다 —
//      브랜치 커밋이 main 에서 새 커밋 하나로 합쳐지므로 커밋 정체성 비교는
//      정상 머지된 브랜치를 전부 미제출로 오판한다(실측 5/5 오탐, 폐기).
//   ② ★가장 강한 신호는 "패치 내용이 이미 base 에 있다"(alreadyInBase) —
//      PR 존재 여부보다 우선한다.
//   ③ PR 이 있어도 그 머지 시각 뒤에 커밋이 더 붙었으면 여전히 미제출이다
//      (머지 뒤 드리프트, 실측 `8Po65yof`).
//   ④ IN_PROGRESS 는 정상적으로 "PR 없음" 구간을 거친다 — 나이 게이트
//      (`staleAfterMs`)로 그 구간을 걸러낸다.
//   ⑤ dirty 인 워크트리는 아직 일하는 중이다 — 플래그하지 않는다.
//   ⑥ 판단에 필요한 사실을 모르면(`null`) 플래그하지 않는다 — 오탐보다 미탐.
//   ⑦ 한도는 #1414/#1416 의 것 그대로.
//   ⑧ 활성 정체와 상태·쿨다운을 공유하지 않는다(별도 파일·별도 세션 상태).

import { describe, expect, it } from "vitest";
import {
  DEFAULT_ADVANCE_CAPS,
  emptyAdvanceState,
  type AdvanceStateSnapshot,
} from "../../electron/mcp-server/advance-guards";
import {
  evaluateUnsubmittedWork,
  formatUnsubmittedWork,
  isUnsurfacedWork,
  type UnsubmittedCandidate,
  type UnsubmittedInput,
  type UnsurfacedEvidence,
} from "../../electron/orchestrator-unsubmitted-work";

const STALE_AFTER = 600_000; // orphanMinAgeMs 재사용(10분)
const NOW = 10_000_000;

function evidence(over: Partial<UnsurfacedEvidence> = {}): UnsurfacedEvidence {
  return {
    status: "REVIEW",
    hasCommitsAheadOfBase: true,
    alreadyInBase: false,
    prExistsAnyState: false,
    mostRecentPrMergedAt: null,
    lastCommitAt: null,
    dirty: false,
    ageMs: STALE_AFTER,
    ...over,
  };
}

// ── ①·② isUnsurfacedWork — PR 존재 기준, alreadyInBase 가 가장 강하다 ───────

describe("isUnsurfacedWork — 판정 축", () => {
  it("★PR 이 한 번도 없었고 다른 조건도 맞으면 미제출이다", () => {
    expect(isUnsurfacedWork(evidence(), STALE_AFTER)).toBe(true);
  });

  it("★alreadyInBase 가 true 면 PR 존재 여부와 무관하게 미제출이 아니다 — 가장 강한 반증", () => {
    expect(
      isUnsurfacedWork(
        evidence({ alreadyInBase: true, prExistsAnyState: false }),
        STALE_AFTER,
      ),
    ).toBe(false);
  });

  it("IN_PROGRESS/REVIEW 가 아니면 대상이 아니다", () => {
    expect(isUnsurfacedWork(evidence({ status: "DONE" }), STALE_AFTER)).toBe(
      false,
    );
    expect(isUnsurfacedWork(evidence({ status: "TODO" }), STALE_AFTER)).toBe(
      false,
    );
  });

  it("IN_PROGRESS 도 대상이다(PR 이 없고 오래 조용하면)", () => {
    expect(
      isUnsurfacedWork(evidence({ status: "IN_PROGRESS" }), STALE_AFTER),
    ).toBe(true);
  });

  it("★워크트리가 dirty 면(아직 일하는 중) 플래그하지 않는다", () => {
    expect(isUnsurfacedWork(evidence({ dirty: true }), STALE_AFTER)).toBe(
      false,
    );
  });

  it("dirty 를 모르면(null) 플래그하지 않는다 — 오탐보다 미탐", () => {
    expect(isUnsurfacedWork(evidence({ dirty: null }), STALE_AFTER)).toBe(
      false,
    );
  });

  it("base 보다 앞선 커밋이 없으면(빈 브랜치) 대상이 아니다", () => {
    expect(
      isUnsurfacedWork(evidence({ hasCommitsAheadOfBase: false }), STALE_AFTER),
    ).toBe(false);
  });

  it("★아직 나이 게이트를 못 채웠으면(방금 커밋함) 플래그하지 않는다", () => {
    expect(
      isUnsurfacedWork(evidence({ ageMs: STALE_AFTER - 1 }), STALE_AFTER),
    ).toBe(false);
  });

  it("나이를 모르면(null) 게이트를 통과시킨다", () => {
    expect(isUnsurfacedWork(evidence({ ageMs: null }), STALE_AFTER)).toBe(true);
  });

  it("PR 존재 여부를 모르면(null) 플래그하지 않는다", () => {
    expect(
      isUnsurfacedWork(evidence({ prExistsAnyState: null }), STALE_AFTER),
    ).toBe(false);
  });

  it("★PR 이 존재하고 드리프트도 없으면 미제출이 아니다", () => {
    expect(
      isUnsurfacedWork(
        evidence({
          prExistsAnyState: true,
          mostRecentPrMergedAt: NOW - 1_000,
          lastCommitAt: NOW - 2_000,
        }),
        STALE_AFTER,
      ),
    ).toBe(false);
  });

  it("★PR 은 있지만 머지 뒤에 커밋이 더 붙었으면(드리프트) 미제출이다", () => {
    expect(
      isUnsurfacedWork(
        evidence({
          prExistsAnyState: true,
          mostRecentPrMergedAt: NOW - 2_000,
          lastCommitAt: NOW - 1_000,
        }),
        STALE_AFTER,
      ),
    ).toBe(true);
  });

  it("PR 은 있지만 드리프트 판단에 필요한 시각을 모르면 미탐 쪽으로", () => {
    expect(
      isUnsurfacedWork(
        evidence({
          prExistsAnyState: true,
          mostRecentPrMergedAt: null,
          lastCommitAt: null,
        }),
        STALE_AFTER,
      ),
    ).toBe(false);
  });
});

// ── 결정 코어 ──────────────────────────────────────────────────────────────

function candidate(
  over: Partial<UnsubmittedCandidate> = {},
): UnsubmittedCandidate {
  return {
    row: {
      taskId: "t-1",
      projectId: "p1",
      title: "제목",
      role: "backend",
      status: "REVIEW",
      branch: "marblo/backend-x",
      prUrl: null,
    },
    neverHadPr: true,
    ...over,
  };
}

function state(over: Partial<AdvanceStateSnapshot> = {}): AdvanceStateSnapshot {
  return { ...emptyAdvanceState(), ...over };
}

function input(over: Partial<UnsubmittedInput> = {}): UnsubmittedInput {
  return {
    enabled: true,
    sessionRunning: true,
    candidates: [candidate()],
    ownerInputPending: false,
    state: state(),
    ...over,
  };
}

describe("evaluateUnsubmittedWork — 신호를 내지 않는 자리", () => {
  it("플래그 OFF 면 아무것도 하지 않는다", () => {
    const d = evaluateUnsubmittedWork(input({ enabled: false }));
    expect(d.action).toBe("NO_SIGNAL");
    expect(d.code).toBe("flag-off");
  });

  it("세션이 없으면 하지 않는다", () => {
    expect(evaluateUnsubmittedWork(input({ sessionRunning: false })).code).toBe(
      "no-session",
    );
  });

  it("이미 HALT 면 조용히 빠진다", () => {
    const d = evaluateUnsubmittedWork(
      input({ state: state({ haltReason: "연속 자율 스폰 한도 도달" }) }),
    );
    expect(d.action).toBe("NO_SIGNAL");
    expect(d.code).toBe("already-halted");
    expect(d.message).toBe("");
  });

  it("후보가 없으면 상태를 건드리지 않는다", () => {
    const d = evaluateUnsubmittedWork(input({ candidates: [] }));
    expect(d.action).toBe("NO_SIGNAL");
    expect(d.code).toBe("nothing-stale");
    expect(d.nextState).toBeUndefined();
  });

  it("사장님 입력이 대기 중이면 보류한다", () => {
    const d = evaluateUnsubmittedWork(input({ ownerInputPending: true }));
    expect(d.action).toBe("NO_SIGNAL");
    expect(d.code).toBe("owner-input-pending");
  });
});

describe("evaluateUnsubmittedWork — 한도는 기존 캡 아래에 있다", () => {
  it("연속 신호가 5에 닿으면 HALT", () => {
    const d = evaluateUnsubmittedWork(
      input({
        state: state({
          consecutiveSignals: DEFAULT_ADVANCE_CAPS.maxConsecutiveSignals,
        }),
      }),
    );
    expect(d.action).toBe("HALT");
    expect(d.code).toBe("consecutive-spawn-cap");
    expect(d.haltReason).toBeTruthy();
  });

  it("4회까지는 신호를 내고 카운터가 1 올라간다", () => {
    const d = evaluateUnsubmittedWork(
      input({ state: state({ consecutiveSignals: 4 }) }),
    );
    expect(d.action).toBe("SIGNAL");
    expect(d.nextState?.consecutiveSignals).toBe(5);
  });
});

describe("formatUnsubmittedWork — PR 이 있어도 제출된 게 아니라는 오판을 막는다", () => {
  it('★"PR 이 하나라도 있으면 제출된 것"이라는 문구를 담지 않되, 왜 미제출인지는 항목별로 담는다', () => {
    const msg = formatUnsubmittedWork([
      candidate({
        row: {
          taskId: "3PRpIVJd",
          projectId: "p1",
          title: "조직 초대 취소",
          status: "REVIEW",
          branch: "marblo/backend-x",
          prUrl: null,
        },
        neverHadPr: true,
      }),
      candidate({
        row: {
          taskId: "8Po65yof",
          projectId: "p1",
          title: "릴리스",
          status: "REVIEW",
          branch: "marblo/backend-y",
          prUrl: "https://github.com/melocream/marblo/pull/1403",
        },
        neverHadPr: false,
      }),
    ]);
    expect(msg).toContain("3PRpIVJd");
    expect(msg).toContain("PR 이 한 번도 존재한 적이 없습니다");
    expect(msg).toContain("8Po65yof");
    expect(msg).toContain("머지된 PR 뒤에 반영 안 된 커밋이 더 있습니다");
    expect(msg).toContain("#1403".replace("#", "pull/"));
  });
});

// ── 완료 기준 시나리오(PM 정정 반영) ────────────────────────────────────────

describe("실증 시나리오", () => {
  it('★"REVIEW + PR 없음 + 10분 이상 조용함 + dirty 아님" → 미제출', () => {
    expect(
      isUnsurfacedWork(
        evidence({
          status: "REVIEW",
          hasCommitsAheadOfBase: true,
          alreadyInBase: false,
          prExistsAnyState: false,
          dirty: false,
          ageMs: STALE_AFTER,
        }),
        STALE_AFTER,
      ),
    ).toBe(true);
  });

  it("★squash 머지로 이미 반영된 브랜치는(alreadyInBase=true) PR 조회 결과와 무관하게 미제출이 아니다 — 커밋 정체성 오탐의 직접 회귀", () => {
    // 실측: git cherry/rev-list 기준으로는 "미머지"로 보이지만 실제로는
    // squash 머지로 이미 main 에 있던 5개 브랜치 표본과 같은 모양.
    expect(
      isUnsurfacedWork(
        evidence({
          status: "REVIEW",
          hasCommitsAheadOfBase: true,
          alreadyInBase: true,
          prExistsAnyState: false, // gh 조회가 이 시점에 실패했다고 가정해도
          dirty: false,
          ageMs: STALE_AFTER,
        }),
        STALE_AFTER,
      ),
    ).toBe(false);
  });
});
