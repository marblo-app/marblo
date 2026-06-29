/**
 * "작업내역" 탭 / 공유카드 lite 의 순수 로직 테스트.
 *
 * 커버:
 *   - parseCompletionReport: "✅ 완료 보고" 평문 → 구조 필드, 값 내 콜론/URL 보존,
 *     비보고 메시지는 null.
 *   - extractFirstUrl: 첫 http(s) URL 추출.
 *   - computeShareStats / buildShareMarkdown: 완료 태스크 + 보고에서 집계 산출.
 *
 * UI/Firestore 구독은 통합 영역이라 여기선 순수 변환/집계만 핀한다.
 */
import { describe, it, expect } from "vitest";
import {
  COMPLETION_REPORT_MARKER,
  extractFirstUrl,
  isCompletionReport,
  parseCompletionReport,
} from "../../src/lib/completionReport";
import {
  buildShareMarkdown,
  computeShareStats,
  resolvePrUrl,
} from "../../src/lib/shareCard";
import type { Task } from "../../src/types/task";

function makeTask(over: Partial<Task>): Task {
  return {
    id: "t1",
    projectId: "p1",
    contextId: "board",
    title: "t",
    description: "",
    status: "DONE",
    role: "frontend",
    priority: 3,
    dependsOn: [],
    dependsOnCompleted: true,
    claimedBy: null,
    claimedAt: null,
    scope: [],
    comment: "",
    prUrl: "",
    hasPmFeedback: false,
    createdAt: new Date(0),
    updatedAt: new Date(0),
    ...over,
  };
}

describe("parseCompletionReport", () => {
  it("마커 + 라벨 라인을 구조 필드로 파싱(값 내 콜론/URL 보존)", () => {
    const msg = [
      COMPLETION_REPORT_MARKER,
      "- 문제: A 가 깨짐",
      "- 접근: B 로 우회",
      "- 변경: src/x.ts 수정",
      "- 검증: tsc 통과",
      "- PR: https://github.com/o/r/pull/9",
    ].join("\n");
    expect(parseCompletionReport(msg)).toEqual({
      problem: "A 가 깨짐",
      approach: "B 로 우회",
      changes: "src/x.ts 수정",
      verification: "tsc 통과",
      pr: "https://github.com/o/r/pull/9",
    });
  });

  it("마커 없는 일반 activity 는 null", () => {
    expect(parseCompletionReport("그냥 진행 로그")).toBeNull();
    expect(isCompletionReport("그냥 진행 로그")).toBe(false);
  });

  it("인식되는 필드가 없으면 null", () => {
    expect(
      parseCompletionReport(`${COMPLETION_REPORT_MARKER}\n- 기타: x`),
    ).toBeNull();
  });
});

describe("extractFirstUrl", () => {
  it("첫 http(s) URL 을 뽑는다", () => {
    expect(extractFirstUrl("see https://a.com/x and https://b.com")).toBe(
      "https://a.com/x",
    );
    expect(extractFirstUrl("no url")).toBeNull();
    expect(extractFirstUrl(undefined)).toBeNull();
  });
});

describe("resolvePrUrl", () => {
  it("완료보고 PR 필드 URL 우선, 없으면 task.prUrl", () => {
    expect(
      resolvePrUrl(makeTask({ prUrl: "https://fallback" }), {
        pr: "https://report/pull/1",
      }),
    ).toBe("https://report/pull/1");
    expect(resolvePrUrl(makeTask({ prUrl: "https://fallback" }), null)).toBe(
      "https://fallback",
    );
    expect(resolvePrUrl(makeTask({ prUrl: "" }), null)).toBeNull();
  });
});

describe("computeShareStats", () => {
  it("에이전트/PR/파일/테스트/리스크를 완료 태스크에서 집계", () => {
    const tasks = [
      makeTask({
        id: "a",
        claimedBy: "agent-1",
        scope: ["src/x.ts", "src/y.ts"],
        prUrl: "https://pr/1",
      }),
      makeTask({
        id: "b",
        claimedBy: "agent-2",
        scope: ["src/y.ts", "src/z.ts"], // y.ts 중복 → 합집합
      }),
      makeTask({ id: "c", claimedBy: "agent-1" }), // 에이전트 중복
    ];
    const reports = {
      a: { verification: "vitest 통과", changes: "ok" },
      b: { approach: "보안 취약점 회귀 위험 있음", verification: "수동 확인" },
    };
    const stats = computeShareStats(tasks, reports);
    expect(stats.agents).toBe(2); // agent-1, agent-2
    expect(stats.files).toBe(3); // x, y, z
    expect(stats.prs).toBe(1); // a 만 PR
    expect(stats.testsPassed).toBe(1); // a 만 test 신호
    expect(stats.riskFlags).toBe(1); // b 만 risk 신호
    expect(stats.doneTasks).toBe(3);
  });

  it("빈 입력은 0 집계", () => {
    expect(computeShareStats([], {})).toEqual({
      agents: 0,
      prs: 0,
      files: 0,
      testsPassed: 0,
      riskFlags: 0,
      doneTasks: 0,
    });
  });
});

describe("buildShareMarkdown", () => {
  it("한 줄 공유 문구를 만든다(단수/복수 처리)", () => {
    expect(
      buildShareMarkdown({
        agents: 1,
        prs: 2,
        files: 37,
        testsPassed: 12,
        riskFlags: 1,
        doneTasks: 5,
      }),
    ).toBe(
      "Shipped with Marblo: 1 parallel agent · 37 files changed · 12 tests passed · 1 risky deps flagged",
    );
  });
});
