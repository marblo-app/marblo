/**
 * @vitest-environment jsdom
 *
 * ProjectAuditRow 의 증거 상세 — 옛 문서의 인자를 못 싣는다는 사실을 말한다
 * (티켓 yJLfoRpqvCcvarIXcT23).
 *
 * ★조용히 비우면 감사 뷰가 반대 방향으로 거짓말한다: "인자가 없었다"와
 * "인자를 못 싣는다"는 조사할 때 취할 조치가 다르다.
 */
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { createElement } from "react";
import { AuditEvidenceDetails } from "../../src/components/project/ProjectAuditRow";
import type { AuditRowEvidence } from "../../src/lib/projectAuditView";

afterEach(cleanup);

function evidence(over: Partial<AuditRowEvidence> = {}): AuditRowEvidence {
  return {
    paramsJson: null,
    resultText: null,
    instructionRedacted: null,
    activityText: null,
    resolutionText: null,
    paramsWithheld: false,
    ...over,
  };
}

describe("AuditEvidenceDetails — 보류 표시", () => {
  it("보류된 인자밖에 없어도 상세를 그린다 — 행이 통째로 사라지지 않는다", () => {
    render(
      createElement(AuditEvidenceDetails, {
        evidence: evidence({ paramsWithheld: true }),
      }),
    );

    expect(screen.getByTestId("audit-params-withheld")).toBeTruthy();
  });

  it("보류가 없으면 그 표시도 없다", () => {
    render(
      createElement(AuditEvidenceDetails, {
        evidence: evidence({ paramsJson: "Ticket: t1" }),
      }),
    );

    expect(screen.queryByTestId("audit-params-withheld")).toBeNull();
  });
});
