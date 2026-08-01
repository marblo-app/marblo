/**
 * "Shipped with Marblo" 공유카드 lite — 세션/프로젝트 집계 순수 로직 (I/O 없음).
 *
 * 완료(DONE) 태스크 + 그 완료 보고에서 한눈 요약을 산출한다. 모든 수치는 이미
 * 렌더러가 구독 중인 데이터(taskStore.tasks, activities)에서 파생되며, 별도 IPC/
 * 백엔드 호출이 없다. heuristic 항목(testsPassed/riskFlags)은 완료 보고 평문을
 * 키워드 매칭하므로 근사값이다 — 카드 부제에 그 점을 밝힌다.
 */

import type { Task } from "../types/task";
import {
  extractFirstUrl,
  type ParsedCompletionReport,
} from "./completionReport";

export interface ShareStats {
  /** 완료에 기여한 distinct 에이전트 수 (claimedBy 기준). */
  agents: number;
  /** PR 이 달린 완료 태스크 수 (완료보고 PR 필드 또는 task.prUrl). */
  prs: number;
  /** 변경된 distinct 파일 수 (완료 태스크 scope 의 합집합). */
  files: number;
  /** 검증(테스트/타입체크/빌드) 증거가 있는 완료 태스크 수. */
  testsPassed: number;
  /** 위험/회귀/보안 플래그가 언급된 완료 태스크 수. */
  riskFlags: number;
  /** 집계 대상 완료 태스크 총수. */
  doneTasks: number;
  /**
   * 완료 보고를 **읽어본** 태스크 수(= reports 맵에 키가 있는 수).
   *
   * ★testsPassed/riskFlags 는 완료 보고에서만 나온다. 탭은 activities 리스너
   * 폭발을 막으려고 최신 N건의 보고만 구독하므로, 집계 대상이 그보다 많으면 이
   * 두 축의 분모는 `doneTasks` 가 아니라 이 값이다. 카드가 "N건 집계" 라고만
   * 말하면 12/207 을 12/207 처럼 읽히게 만든다 — 분모를 같이 내보낸다.
   */
  reportsScanned: number;
}

/** 검증 필드에서 "테스트/빌드 통과" 신호로 보는 키워드. */
const TEST_SIGNAL =
  /test|테스트|tsc|build|빌드|통과|pass|vitest|타입체크|lint/i;
/** 보고 어디든 "리스크 플래그"로 보는 키워드. */
const RISK_SIGNAL =
  /위험|risk|취약|보안|security|cve|회귀|regress|deprecat|주의/i;

/** 완료 태스크에 PR 이 있는지 (완료보고 PR 필드의 URL 우선, 없으면 task.prUrl). */
export function resolvePrUrl(
  task: Task,
  report: ParsedCompletionReport | null,
): string | null {
  return extractFirstUrl(report?.pr) ?? (task.prUrl?.trim() || null);
}

/**
 * 완료 태스크들 + 보고 맵에서 공유카드 수치를 집계.
 * reports[taskId] 는 해당 태스크의 파싱된 완료 보고(없으면 null/undefined).
 */
export function computeShareStats(
  doneTasks: Task[],
  reports: Record<string, ParsedCompletionReport | null | undefined>,
): ShareStats {
  const agentIds = new Set<string>();
  const fileSet = new Set<string>();
  let prs = 0;
  let testsPassed = 0;
  let riskFlags = 0;
  let reportsScanned = 0;

  for (const task of doneTasks) {
    const report = reports[task.id] ?? null;
    // 키 존재 여부로 "보고를 읽었는데 없더라"(값 null)와 "아직 안 읽었다"(키 부재)
    // 를 가른다. 후자는 heuristic 축의 분모에서 빠져야 한다.
    if (Object.prototype.hasOwnProperty.call(reports, task.id)) {
      reportsScanned += 1;
    }

    if (task.claimedBy) agentIds.add(task.claimedBy);

    for (const file of task.scope ?? []) {
      const trimmed = file.trim();
      if (trimmed) fileSet.add(trimmed);
    }

    if (resolvePrUrl(task, report)) prs += 1;

    if (report?.verification && TEST_SIGNAL.test(report.verification)) {
      testsPassed += 1;
    }

    const reportBlob = report
      ? [report.problem, report.approach, report.changes, report.verification]
          .filter(Boolean)
          .join(" ")
      : "";
    if (reportBlob && RISK_SIGNAL.test(reportBlob)) riskFlags += 1;
  }

  return {
    agents: agentIds.size,
    prs,
    files: fileSet.size,
    testsPassed,
    riskFlags,
    doneTasks: doneTasks.length,
    reportsScanned,
  };
}

/**
 * 복사 가능한 한 줄 markdown 생성.
 * 예: "Shipped with Marblo: 4 parallel agents · 37 files changed · 12 tests passed · 1 risky deps flagged"
 */
export function buildShareMarkdown(stats: ShareStats): string {
  const parts = [
    `${stats.agents} parallel ${stats.agents === 1 ? "agent" : "agents"}`,
    `${stats.files} files changed`,
    `${stats.testsPassed} tests passed`,
    `${stats.riskFlags} risky deps flagged`,
  ];
  return `Shipped with Marblo: ${parts.join(" · ")}`;
}
