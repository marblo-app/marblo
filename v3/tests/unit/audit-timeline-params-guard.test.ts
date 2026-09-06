/**
 * @vitest-environment jsdom
 *
 * AuditTimeline — 툴 인자 원문을 화면에 뿌리지 않는다 (티켓 yJLfoRpqvCcvarIXcT23).
 *
 * ★이 화면이 사고 지점이다: 행을 펼치면 `JSON.stringify(log.params)` 가 그대로
 * 떴다. write 를 고쳐도 **기존 문서에는 원문이 남아 있고 원장은 불변이라 못
 * 지우므로**, 여기서 같이 막지 않으면 수리가 절반만 된다.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { LEDGER_PARAMS_POLICY } from "../../src/lib/auditParamsPolicy";
import type { AuditLog } from "../../src/types/audit";

const RAW_SECRET_PROSE = "사장님 지시문 전문과 자격증명이 여기 그대로 있다";

const logs = vi.hoisted(() => ({ value: [] as unknown[] }));

vi.mock("../../src/stores/projectStore", () => ({
  useProjectStore: (selector: (s: unknown) => unknown) =>
    selector({ currentProject: { id: "p1", name: "p1" } }),
}));
vi.mock("../../src/services/auditService", () => ({
  subscribeToAuditLogs: (_projectId: string, cb: (rows: unknown[]) => void) => {
    cb(logs.value);
    return () => undefined;
  },
}));

const { default: AuditTimeline } =
  await import("../../src/components/agents/AuditTimeline");

function log(over: Partial<AuditLog>): AuditLog {
  return {
    id: "a1",
    projectId: "p1",
    agentId: "agent-1",
    toolName: "add_activity",
    params: { task_id: "t1", message: RAW_SECRET_PROSE },
    result: "ok",
    duration: 5,
    success: true,
    createdAt: new Date("2026-08-01T11:00:00Z"),
    ...over,
  } as AuditLog;
}

function expand() {
  // 툴 필터 <option> 에도 같은 텍스트가 있다. 행 쪽(span)을 집는다.
  const row = screen
    .getAllByText("add_activity")
    .find((el) => el.tagName === "SPAN");
  fireEvent.click(row!);
}

afterEach(cleanup);

describe("AuditTimeline — params 렌더 게이트", () => {
  it("정책 표식이 없는 옛 문서의 인자 원문은 펼쳐도 안 보인다", () => {
    logs.value = [log({})];

    render(createElement(AuditTimeline));
    expand();

    expect(document.body.textContent).not.toContain(RAW_SECRET_PROSE);
  });

  it("옛 문서에서도 티켓 id 는 보인다 — 통째로 감추는 게 목적이 아니다", () => {
    logs.value = [log({})];

    render(createElement(AuditTimeline));
    expand();

    expect(document.body.textContent).toContain("t1");
  });

  it("옛 문서라 인자를 못 싣는다는 사실을 화면이 말한다", () => {
    logs.value = [log({})];

    render(createElement(AuditTimeline));
    expand();

    expect(screen.getByTestId("audit-params-withheld")).toBeTruthy();
  });

  it("정책을 통과한 문서의 인자는 그대로 보인다", () => {
    logs.value = [
      log({
        paramsPolicy: LEDGER_PARAMS_POLICY,
        params: { task_id: "t1", message: "레드액트된 표시용 텍스트" },
      }),
    ];

    render(createElement(AuditTimeline));
    expand();

    expect(document.body.textContent).toContain("레드액트된 표시용 텍스트");
    expect(screen.queryByTestId("audit-params-withheld")).toBeNull();
  });
});
