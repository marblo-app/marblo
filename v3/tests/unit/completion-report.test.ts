/**
 * 완료 보고(completion report) 규약 순수 헬퍼 테스트.
 *
 * 커버:
 *   - formatCompletionReport: 구조화 요약 → "✅ 완료 보고" 메시지, 빈 필드 생략,
 *     내용 없으면 null.
 *   - isCompletionReport / hasCompletionReport: 마커 인식(선행 공백 허용).
 *   - buildCompletionNudge: soft nudge 형태 — 마커·task_id 포함, 하드블록 문구 없음.
 *
 * 실제 Firestore 쓰기/조회와 nudge 주입은 tools.ts 가 담당(통합 영역)하므로 여기선
 * 순수 변환/판정만 핀한다.
 */
import { describe, it, expect } from "vitest";
import {
  COMPLETION_REPORT_MARKER,
  formatCompletionReport,
  isCompletionReport,
  hasCompletionReport,
  buildCompletionNudge,
  resolveCompletionReport,
} from "../../electron/mcp-server/completion-report";

describe("formatCompletionReport", () => {
  it("구조화 요약을 마커 + 라벨 라인으로 변환(필드 순서 고정)", () => {
    const msg = formatCompletionReport({
      problem: "X가 깨짐",
      approach: "Y로 우회",
      changes: "a.ts, b.ts",
      verification: "npm test green",
      pr: "https://example.com/pr/1",
    });
    expect(msg).toBe(
      [
        COMPLETION_REPORT_MARKER,
        "- 문제: X가 깨짐",
        "- 접근: Y로 우회",
        "- 변경: a.ts, b.ts",
        "- 검증: npm test green",
        "- PR: https://example.com/pr/1",
      ].join("\n"),
    );
  });

  it("비어 있거나 공백뿐인 필드는 생략", () => {
    const msg = formatCompletionReport({
      problem: "P",
      approach: "   ",
      changes: "",
      verification: "V",
    });
    expect(msg).toBe(
      [COMPLETION_REPORT_MARKER, "- 문제: P", "- 검증: V"].join("\n"),
    );
  });

  it("실질 내용이 하나도 없으면 null(undefined / 빈 객체 / 공백뿐)", () => {
    expect(formatCompletionReport(undefined)).toBeNull();
    expect(formatCompletionReport({})).toBeNull();
    expect(formatCompletionReport({ problem: "  ", pr: "" })).toBeNull();
  });

  it("결과 메시지는 항상 완료 보고로 인식된다(라운드트립)", () => {
    const msg = formatCompletionReport({ problem: "P" });
    expect(msg).not.toBeNull();
    expect(isCompletionReport(msg)).toBe(true);
  });
});

describe("isCompletionReport", () => {
  it("마커로 시작하면 true(선행 공백 허용)", () => {
    expect(isCompletionReport(`${COMPLETION_REPORT_MARKER}: 문제 ...`)).toBe(
      true,
    );
    expect(
      isCompletionReport(`\n  ${COMPLETION_REPORT_MARKER}\n- 문제: x`),
    ).toBe(true);
  });

  it("일반 진행 로그/빈값은 false", () => {
    expect(isCompletionReport("구현 완료: 핸들러 추가")).toBe(false);
    expect(isCompletionReport("")).toBe(false);
    expect(isCompletionReport(undefined)).toBe(false);
    expect(isCompletionReport(null)).toBe(false);
  });
});

describe("hasCompletionReport", () => {
  it("목록에 완료 보고가 하나라도 있으면 true", () => {
    expect(
      hasCompletionReport([
        "태스크 선점",
        "구현 완료: x",
        `${COMPLETION_REPORT_MARKER}\n- 문제: y`,
      ]),
    ).toBe(true);
  });

  it("진행 로그만 있으면 false", () => {
    expect(
      hasCompletionReport(["태스크 선점", "구현 완료: x", "검증 완료"]),
    ).toBe(false);
    expect(hasCompletionReport([])).toBe(false);
  });
});

describe("buildCompletionNudge", () => {
  it("마커·task_id·status 를 포함하고, 비-블로킹임을 명시", () => {
    const nudge = buildCompletionNudge("task-123", "REVIEW");
    expect(nudge).toContain(COMPLETION_REPORT_MARKER);
    expect(nudge).toContain("task-123");
    expect(nudge).toContain("REVIEW");
    expect(nudge).toContain("블로킹 아님");
    // 보완 경로(add_activity)를 알려준다.
    expect(nudge).toContain("add_activity");
  });
});

describe("resolveCompletionReport", () => {
  it("① summary 가 있으면 → 보고 기록, nudge 없음 (최근 activity 무시)", () => {
    const decision = resolveCompletionReport(
      "t1",
      "REVIEW",
      { problem: "P", approach: "A" },
      [], // 최근 activity 가 비어 있어도 summary 가 우선
    );
    expect(decision.report).toContain(COMPLETION_REPORT_MARKER);
    expect(decision.report).toContain("- 문제: P");
    expect(decision.nudge).toBe("");
  });

  it("② summary 없지만 최근 activity 에 완료 보고가 있으면 → 기록·nudge 둘 다 없음", () => {
    const decision = resolveCompletionReport("t1", "DONE", undefined, [
      "구현 완료: x",
      `${COMPLETION_REPORT_MARKER}\n- 문제: 이미 보고함`,
    ]);
    expect(decision.report).toBeNull();
    expect(decision.nudge).toBe("");
  });

  it("③ summary 없고 최근 보고도 없으면 → 기록 없음 + soft nudge", () => {
    const decision = resolveCompletionReport("t1", "REVIEW", undefined, [
      "태스크 선점",
      "구현 완료: x",
    ]);
    expect(decision.report).toBeNull();
    expect(decision.nudge).toContain(COMPLETION_REPORT_MARKER);
    expect(decision.nudge).toContain("t1");
    expect(decision.nudge).toContain("블로킹 아님");
  });

  it("빈 객체 summary 는 내용 없음으로 보고 nudge 경로로 떨어진다", () => {
    const decision = resolveCompletionReport("t1", "REVIEW", {}, []);
    expect(decision.report).toBeNull();
    expect(decision.nudge).not.toBe("");
  });
});
