/**
 * "미제출 작업(unsurfaced work)" 판정 — REVIEW/IN_PROGRESS 티켓인데 그 작업이
 * GitHub 어디에도(패치 내용으로도, PR 로도) 반영되지 않은 상태를 감지한다
 * (티켓 Z4095CT4CpAuTVtnAp9l, PM 피드백 — **세 차례** 정정됨. 아래 절들이 그
 * 정정의 기록이다).
 *
 * ── 실증 (다섯 건, 부풀리지 않은 수) ─────────────────────────────────────────
 * `lx1EOdGI`(설계 문서 567줄) · `r70lKKYA`(코드 430줄+테스트) · `vJqIXvme`
 * (리서치 354줄) · `NSk98YoY`(벤치 1,416줄) · `OVilG1bM`(위키 개편, 미커밋
 * 15개) — 다섯 다 **PR 이 한 번도 존재한 적이 없었다.** 마지막 사례가 이
 * 기능의 존재 이유다: **완료 알림이 오케 PTY 주입에 실패**해서 보드 표시로만
 * 발견됐다 — 그래서 이 판정은 **알림 성공 여부에 의존하지 않는다.** 알림이
 * 실패해도 감지돼야 하고, 그러려면 판정 근거가 "오케가 봤는가"가 아니라
 * "PR 이 실제로 존재하는가"라는 GitHub 실측이어야 한다.
 *
 * ── 왜 "원격에 없는 커밋"(unpushed)이 아니라 "PR 존재"인가 ──────────────────
 * 첫 설계는 `worktree-manager.ts` 의 `staleInfoByHead().unpushed`(로컬 브랜치가
 * 자기 원격 추적 브랜치보다 앞서 있는가)를 썼다. **이 저장소는 squash 머지를
 * 쓴다** — 브랜치의 커밋 여러 개가 `main` 에서 새 커밋 하나로 합쳐지므로
 * 원본 커밋은 그 새 커밋의 조상이 아니다. 그 결과 `merged`(조상 관계)도
 * `git cherry`/`rev-list origin/main..HEAD` 도 **정상적으로 머지된 브랜치를
 * 전부 미머지로 오판한다.** 실측(워크트리 21개 중 표본 5개, 전부 MERGED PR
 * 보유)에서 **5/5 오탐**이 났다 — 그래서 그 설계를 전량 폐기했다. 대신 GitHub
 * 이 실제로 아는 사실 하나만 쓴다: **이 브랜치를 head 로 하는 PR 이 어떤
 * 상태(open·merged·closed)로든 존재하는가.**
 *
 * ── 머지 뒤 드리프트라는 예외 ────────────────────────────────────────────────
 * "PR 이 하나라도 있으면 통과"도 완전하지 않다 — 실측 사례 `8Po65yof` 는
 * PR #1403 이 MERGED 인데 그 **뒤에** 커밋이 더 붙었고 그건 어디에도 PR 로
 * 오르지 않았다. 그래서 PR 이 있어도, **가장 최근 PR 의 머지 시각 이후에
 * 생긴 커밋**이 있으면 여전히 미제출로 본다. 이 보조 규칙은 완벽하지
 * 않다(예: 머지 후 커밋이 사소한 후속 정리일 수 있다) — **오탐보다 미탐 쪽으로
 * 기운다**: 판단에 필요한 시각 중 하나라도 모르면 신호를 내지 않는다.
 *
 * ── ★세 번째 정정 — PR 존재보다 더 강한 신호가 있다 ──────────────────────────
 * 티켓 `3PRpIVJd`(조직 초대 취소·토큰 회전) 재검증에서 **PR 존재 확인 없이도**
 * 이미 반영됐음을 잡을 수 있는 더 강한 판정이 실증됐다: `git rebase origin/main`
 * 은 커밋 SHA 가 아니라 **패치 내용**으로 "이미 upstream 에 있다"를 판정해
 * squash 든 리베이스든 어느 경로로 들어갔어도 맞게 자동 drop 한다. 그 실측에서
 * 두 커밋 모두 already-upstream 으로 drop 됐고, `git diff origin/main HEAD
 * --stat` 이 그 뒤 **0** 이었다 — 그리고 그 커밋들이 가리키던 심볼
 * (`orgOnboarding.ts` 의 `ORG_INVITE_REUSE_WINDOW_MS`·`planOrgInviteRevoke`,
 * `index.ts` 의 `listOrgInvitations`·`revokeOrgInvitation`)이 실제로
 * `main` 에 있었다. 그래서 **판정 순서를 강도순으로 재배치한다**:
 *
 *   1. ★**가장 강함 — 패치 내용이 이미 base 에 있는가**(`alreadyInBase`).
 *      `git diff origin/main...<branch> --stat` 이 비었는지, 또는 티켓 ID 를
 *      커밋 메시지·소스 주석에 못박는 이 저장소의 관례를 이용해
 *      `git log --all --grep=<taskId>` 가 이미 `main` 계보에서 그 흔적을
 *      찾는지 — 둘 중 하나라도 "이미 있다"고 답하면 그 즉시 미제출이 아니다
 *      (PR 존재 여부를 더 볼 필요가 없다).
 *   2. PR 존재(open·merged·closed 어떤 상태로든) — 위 "왜 PR 존재인가" 절.
 *   3. ★**커밋 정체성 비교(`git cherry`, `git log origin/main..HEAD`)는
 *      절대 판정 근거로 쓰지 않는다** — squash 저장소에서 구조적으로
 *      오탐한다(이 파일 상단의 첫 폐기 사례 그대로).
 *
 * ── 왜 활성 정체와 다른 파일인가 ─────────────────────────────────────────────
 * `orchestrator-active-stall.ts` 는 "오케가 busy 인데 보드가 안 움직인다"를
 * 본다. 이 축은 "보드는 움직였다고 적혀 있는데(REVIEW 로 상태를 바꿨는데) 그
 * 근거가 GitHub 어디에도 없다"를 본다. 관측 대상도(오케 busy 상태 vs GitHub
 * PR 이력), 판정 축도, 상태도 다르다 — 한 함수에 뭉치면 한쪽이 오판했을 때
 * 다른 쪽 결과까지 의심해야 한다(PM 피드백 그대로 파일·세션 상태·쿨다운을
 * 분리했다).
 *
 * ── 왜 나머지 게이트가 있는가 ────────────────────────────────────────────────
 *   dirty        워크트리가 아직 미커밋 변경을 갖고 있으면 **아직 일하는
 *                중**이다 — 제출 실패가 아니라 정상 진행이다. 모르면(null)
 *                플래그하지 않는다(오탐 방지 우선).
 *   ageMs 게이트  IN_PROGRESS 는 커밋을 만들고 몇 초 안에는 항상 "PR 없음"
 *                상태를 거친다 — 그게 정상이다. `ageMs`(보드 활동 후 경과 —
 *                스위프가 이미 갖고 있는 값)가 `staleAfterMs` 이상일 때만
 *                후보로 본다. ★새 숫자를 만들지 않았다 — 호출부가 기존
 *                `orphanMinAgeMs`(10분, 고아 판정과 같은 값)를 그대로 넘긴다.
 *
 * ── 한도는 새로 만들지 않는다 ────────────────────────────────────────────────
 * `advance-guards.ts` 의 `evaluateAdvanceGuards`(연속 5·정체 2)를 그대로
 * 부른다. `openCount` 자리에는 이 축의 후보 수를 넣는다. 스폰을 만드는 축이
 * 아니라서 토큰 잔여 게이트는 적용하지 않는다(정보 전달만 한다).
 *
 * ── 순수 모듈 ──────────────────────────────────────────────────────────────
 * firebase/electron/git/GitHub 를 import 하지 않는다. PR 이력·dirty·시각은
 * 호출부가 이미 조회해 온 값을 받는다
 * (`tests/unit/orchestrator-unsubmitted-work.test.ts`).
 */

import {
  evaluateAdvanceGuards,
  type AdvanceCaps,
  type AdvanceStateSnapshot,
  type GuardCode,
} from "./mcp-server/advance-guards";

const ACTIVE_STATUSES = new Set(["REVIEW", "IN_PROGRESS"]);

/** 후보 판정에 필요한 티켓 1행 + git/GitHub 증거. */
export interface UnsurfacedEvidence {
  status: string;
  /** 브랜치에 base(main) 보다 앞선 커밋이 하나라도 있는가. */
  hasCommitsAheadOfBase: boolean;
  /**
   * ★가장 강한 신호 — 이 브랜치의 패치 내용이 **이미 base 에 반영돼 있는가**.
   * `git diff origin/main...<branch> --stat` 이 비어 있는지, 또는 이 저장소의
   * "커밋 메시지·소스 주석에 티켓 ID 를 못박는" 관례를 이용해
   * `git log --all --grep=<taskId>` 가 이미 `main` 계보에서 흔적을 찾는지 —
   * 호출부가 그 둘 중 하나(또는 patch-id 비교)로 확정한 값. `true` 면 그
   * 즉시 미제출이 아니다(PR 존재를 더 볼 필요가 없다). ★커밋 SHA/정체성
   * 비교(`git cherry`, `rev-list origin/main..HEAD`)로 만든 값이면 안 된다 —
   * squash 저장소에서 구조적으로 오탐한다(파일 상단 참조). `null` = 확인 못 함.
   */
  alreadyInBase: boolean | null;
  /**
   * 이 브랜치를 head 로 하는 PR 이 **어떤 상태로도**(open·merged·closed)
   * 존재하는가. `null` = GitHub 조회 실패(모름) — **없음(false)으로 접지
   * 않는다.** 모르면 플래그하지 않는다(아래 `isUnsurfacedWork` 의 오탐
   * 방지 우선 규율).
   */
  prExistsAnyState: boolean | null;
  /** 가장 최근 PR 의 머지 시각(epoch ms). PR 이 없거나 모르면 null. */
  mostRecentPrMergedAt: number | null;
  /** 브랜치의 마지막 커밋 시각(epoch ms). 모르면 null. */
  lastCommitAt: number | null;
  /**
   * 워크트리가 dirty(미커밋 변경)인가. `null` = 확인 못 함 — **아직 일하는
   * 중일 수 있으므로 플래그하지 않는다**(오탐보다 미탐).
   */
  dirty: boolean | null;
  /** 보드 활동 후 경과 ms. 모르면 null(나이 게이트를 통과시킨다). */
  ageMs: number | null;
}

/**
 * git/GitHub 조회로만 채워지는 부분 — 호출부(배선)가 이 값에 `status`·`ageMs`
 * (보드가 이미 갖고 있는 값)를 얹어 `UnsurfacedEvidence` 를 완성한다. I/O 와
 * 판정을 분리하는 경계선이 이 타입이다.
 */
export type UnsurfacedGitFacts = Pick<
  UnsurfacedEvidence,
  | "hasCommitsAheadOfBase"
  | "alreadyInBase"
  | "prExistsAnyState"
  | "mostRecentPrMergedAt"
  | "lastCommitAt"
  | "dirty"
>;

/**
 * 이 티켓이 미제출 작업인가 — 순수 판정. **모르면 신호를 내지 않는다** —
 * PM 피드백 그대로("오탐보다 미탐 쪽으로 기울여라").
 */
export function isUnsurfacedWork(
  ev: UnsurfacedEvidence,
  staleAfterMs: number,
): boolean {
  if (!ACTIVE_STATUSES.has(ev.status)) return false;
  if (ev.dirty !== false) return false; // null 또는 true — 확실히 정리된 것만 본다
  if (!ev.hasCommitsAheadOfBase) return false;
  if (ev.alreadyInBase === true) return false; // ★가장 강한 반증 — 이미 반영됐다
  if (ev.prExistsAnyState === null) return false;
  if (ev.ageMs !== null && ev.ageMs < staleAfterMs) return false;

  if (ev.prExistsAnyState === false) return true; // 핵심 케이스 — PR 이 한 번도 없었다

  // PR 은 있다 — 그 뒤에 반영 안 된 커밋이 더 붙었는가(머지 뒤 드리프트).
  if (ev.mostRecentPrMergedAt !== null && ev.lastCommitAt !== null) {
    return ev.lastCommitAt > ev.mostRecentPrMergedAt;
  }
  return false; // 판단에 필요한 시각을 모르면 미탐 쪽으로
}

// ── 결정 코어 ───────────────────────────────────────────────────────────────

export type UnsubmittedAction = "NO_SIGNAL" | "SIGNAL" | "HALT";

export type UnsubmittedCode =
  | "flag-off"
  | "no-session"
  | "already-halted"
  | "nothing-stale"
  | "unsurfaced"
  | GuardCode;

/** 신호 본문에 실을 최소 필드. */
export interface UnsubmittedRow {
  taskId: string;
  projectId: string;
  title?: string | null;
  role?: string | null;
  status: string;
  branch?: string | null;
  /** 있으면(과거 PR이 있었는데 드리프트한 경우) 그 PR 링크. */
  prUrl?: string | null;
}

export interface UnsubmittedCandidate {
  row: UnsubmittedRow;
  /** true = PR 자체가 한 번도 없었다. false = PR 은 있었지만 머지 후 드리프트. */
  neverHadPr: boolean;
}

export interface UnsubmittedInput {
  /** ★전진 신호·자율 픽업·활성 정체와 **같은 플래그 하나**를 공유한다. */
  enabled: boolean;
  sessionRunning: boolean;
  /** 이번 프로젝트의 미제출 후보 전체(쿨다운은 호출부가 이미 걸러 넘긴다). */
  candidates: readonly UnsubmittedCandidate[];
  ownerInputPending: boolean;
  state: AdvanceStateSnapshot;
  caps?: AdvanceCaps;
}

export interface UnsubmittedDecision {
  action: UnsubmittedAction;
  code: UnsubmittedCode;
  reason: string;
  picked: UnsubmittedCandidate[];
  message: string;
  nextState?: {
    consecutiveSignals: number;
    stagnantSignals: number;
    lastOpenCount: number;
  };
  haltReason?: string;
}

function no(code: UnsubmittedCode, reason: string): UnsubmittedDecision {
  return { action: "NO_SIGNAL", code, reason, picked: [], message: "" };
}

function line(c: UnsubmittedCandidate): string {
  const { row } = c;
  const meta: string[] = [`status=${row.status}`];
  if (row.role) meta.push(row.role);
  if (row.branch) meta.push(`branch=${row.branch}`);
  const why = c.neverHadPr
    ? "PR 이 한 번도 존재한 적이 없습니다"
    : `머지된 PR 뒤에 반영 안 된 커밋이 더 있습니다${
        row.prUrl ? ` (${row.prUrl})` : ""
      }`;
  const title = (row.title ?? "").trim() || "(제목 없음)";
  return `  · "${title}" (id=${row.taskId}, ${meta.join(", ")}) — ${why}`;
}

/**
 * 오케가 **이 메시지만 읽고** 무엇을 해야 하는지 알 수 있어야 한다. "PR 이
 * 있으니 제출된 것"이라는 오판을 막기 위해 그 오판이 왜 틀렸는지를 본문에
 * 직접 적는다.
 */
export function formatUnsubmittedWork(
  picked: readonly UnsubmittedCandidate[],
): string {
  const lines = picked.map(line);
  return (
    `[미제출 작업] ${picked.length}건이 REVIEW/IN_PROGRESS 인데 GitHub 에 그 ` +
    `작업의 흔적이 없습니다:\n${lines.join("\n")}\n` +
    `권고: 각 티켓의 워크트리에서 브랜치를 push 하고 PR 을 열거나(또는 드리프트한 ` +
    `커밋을 기존 PR 에 반영하라) 갱신하라. 확인 후 add_activity 에 남겨라.`
  );
}

/** HALT 본문 — 자율 알림이 멈췄다는 사실은 반드시 사람이 볼 곳에 남는다. */
export function formatUnsubmittedHalt(reason: string): string {
  return (
    `[미제출 작업] ⏸ 자율 알림 정지\n` +
    `사유: ${reason}\n` +
    `이 오케 세션에서는 미제출 작업 알림을 더 하지 않는다. 사장님 지시가 오면 해제된다.`
  );
}

/**
 * 미제출 작업의 전체 판정. **판정 순서가 곧 우선순위다**:
 *
 *   0. 플래그 OFF  — 아무것도 읽지 않는다(기본값 OFF, 회귀 0)
 *   1. 세션 없음/미실행
 *   2. ★이미 HALT — 메시지 없이 조용히 빠진다(같은 정지를 매 틱 떠들지 않는다)
 *   3. 후보 0     — 상태를 건드리지 않는다
 *   4. 한도(evaluateAdvanceGuards) → HALT | hold
 *   5. → SIGNAL
 */
export function evaluateUnsubmittedWork(
  input: UnsubmittedInput,
): UnsubmittedDecision {
  if (!input.enabled) {
    return no("flag-off", "미제출 작업 감지가 꺼져 있다(기본값 OFF).");
  }
  if (!input.sessionRunning) {
    return no("no-session", "이 프로젝트의 오케 세션이 실행 중이 아니다.");
  }
  if ((input.state.haltReason ?? "").trim()) {
    return no(
      "already-halted",
      `자율 진행이 이미 정지 상태다 — ${input.state.haltReason}`,
    );
  }
  if (input.candidates.length === 0) {
    return no("nothing-stale", "지금 미제출로 볼 티켓이 없다.");
  }

  const guard = evaluateAdvanceGuards({
    state: input.state,
    openCount: input.candidates.length,
    ownerInputPending: input.ownerInputPending,
    caps: input.caps,
  });
  if (guard.outcome === "halt") {
    return {
      action: "HALT",
      code: guard.code,
      reason: guard.reason,
      picked: [],
      message: formatUnsubmittedHalt(guard.reason),
      haltReason: guard.reason,
    };
  }
  if (guard.outcome === "hold") {
    return no(guard.code, guard.reason);
  }

  return {
    action: "SIGNAL",
    code: "unsurfaced",
    reason: `미제출 작업 ${input.candidates.length}건을 알린다.`,
    picked: [...input.candidates],
    message: formatUnsubmittedWork(input.candidates),
    nextState: {
      consecutiveSignals: input.state.consecutiveSignals + 1,
      stagnantSignals: guard.nextStagnantSignals,
      lastOpenCount: input.candidates.length,
    },
  };
}
