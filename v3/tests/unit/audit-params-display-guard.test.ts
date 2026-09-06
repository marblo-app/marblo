/**
 * 화면 쪽 params 가드 (티켓 yJLfoRpqvCcvarIXcT23).
 *
 * ★write 를 고쳐도 **기존 문서에는 원문이 이미 남아 있고 원장은 불변이라 못
 * 지운다.** 그래서 뷰가 정책 표식이 없는 문서의 `params` 를 렌더에서 끊는다.
 * 여기가 그 계약이다 — `types/audit.ts` 의 "감사 뷰는 이 필드를 화면에 뿌리지
 * 않는다" 가 주석이 아니라 실행되는 문장이 되는 자리.
 */
import { describe, expect, it } from "vitest";
import {
  LEDGER_PARAMS_POLICY as ELECTRON_POLICY,
  LEDGER_PARAM_ID_KEYS as ELECTRON_ID_KEYS,
  LEDGER_PARAM_TEXT_KEYS as ELECTRON_TEXT_KEYS,
  LEDGER_PARAM_ID_MAX_CHARS as ELECTRON_ID_MAX,
} from "../../electron/mcp-server/ledger";
import {
  LEDGER_PARAMS_POLICY,
  LEDGER_PARAM_ID_KEYS,
  LEDGER_PARAM_TEXT_KEYS,
  LEDGER_PARAM_ID_MAX_CHARS,
  displayableLedgerParams,
  ledgerParamsAreScrubbed,
} from "../../src/lib/auditParamsPolicy";
import { agentAuditRow } from "../../src/lib/projectAuditView";
import type { AuditLog } from "../../src/types/audit";

/** 정책 이전에 쌓인 문서 — `paramsPolicy` 가 없다. 원문이 그대로 들어 있다. */
function legacyEvent(over: Partial<AuditLog> = {}): AuditLog {
  return {
    id: "old-1",
    projectId: "p1",
    agentId: "agent-1",
    toolName: "add_activity",
    params: {
      task_id: "t1",
      status: "IN_PROGRESS",
      message: "사장님 지시문 전문이 여기 그대로 들어 있다",
      internal_note: "티켓 본문 원문",
    },
    result: "ok",
    duration: 12,
    success: true,
    createdAt: new Date("2026-08-01T11:00:00Z"),
    ...over,
  } as AuditLog;
}

/** 정책 이후 문서 — 이미 write 에서 걸러졌으므로 화면이 그대로 그려도 된다. */
function scrubbedEvent(over: Partial<AuditLog> = {}): AuditLog {
  return legacyEvent({
    id: "new-1",
    paramsPolicy: LEDGER_PARAMS_POLICY,
    params: {
      task_id: "t1",
      status: "IN_PROGRESS",
      message: "레드액트된 표시용 텍스트",
    },
    ...over,
  });
}

describe("ledgerParamsAreScrubbed — 문서 하나의 정책 판별", () => {
  it("표식이 없으면 원문 문서로 본다 — 모르면 안전한 쪽으로 판정한다", () => {
    expect(ledgerParamsAreScrubbed(legacyEvent())).toBe(false);
  });

  it("표식이 맞아야만 걸러진 문서로 본다", () => {
    expect(ledgerParamsAreScrubbed(scrubbedEvent())).toBe(true);
    expect(
      ledgerParamsAreScrubbed(legacyEvent({ paramsPolicy: "whatever-v9" })),
    ).toBe(false);
  });
});

describe("displayableLedgerParams — 옛 문서에서 화면에 내보낼 것", () => {
  it("옛 문서의 자유 텍스트는 화면에 안 나간다", () => {
    const shown = displayableLedgerParams(legacyEvent());

    expect(shown.params).not.toHaveProperty("message");
    expect(shown.params).not.toHaveProperty("internal_note");
    expect(shown.withheld).toBe(true);
  });

  it("옛 문서라도 식별자·상태는 남긴다 — 원장을 보이게 하는 것과 충돌하지 않게", () => {
    const shown = displayableLedgerParams(legacyEvent());

    expect(shown.params).toEqual({ task_id: "t1", status: "IN_PROGRESS" });
  });

  it("옛 문서의 식별자 칸에 산문이 들어 있으면 그것도 버린다", () => {
    const shown = displayableLedgerParams(
      legacyEvent({
        params: { status: "S".repeat(LEDGER_PARAM_ID_MAX_CHARS + 1) },
      }),
    );

    expect(shown.params).toEqual({});
  });

  it("걸러진 문서는 손대지 않는다 — write 가 이미 한 일을 두 번 하지 않는다", () => {
    const event = scrubbedEvent();
    const shown = displayableLedgerParams(event);

    expect(shown.params).toEqual(event.params);
    expect(shown.withheld).toBe(false);
  });
});

describe("agentAuditRow — 감사 행에 원문이 실리지 않는다", () => {
  it("옛 문서의 params 원문이 evidence 로 새지 않는다", () => {
    const row = agentAuditRow(legacyEvent());

    const serialized = JSON.stringify(row);
    expect(serialized).not.toContain(
      "사장님 지시문 전문이 여기 그대로 들어 있다",
    );
    expect(serialized).not.toContain("티켓 본문 원문");
  });

  it("옛 문서의 params 원문이 항상 보이는 detail 한 줄로도 새지 않는다", () => {
    const row = agentAuditRow(
      legacyEvent({
        toolName: "ask_orchestrator",
        params: { question: "여기에 자격증명이 섞일 수 있다" },
      }),
    );

    expect(row.detail ?? "").not.toContain("여기에 자격증명이 섞일 수 있다");
  });

  it("옛 문서라는 사실을 표시한다 — 조용히 감추면 뷰가 반대 방향으로 거짓말한다", () => {
    expect(agentAuditRow(legacyEvent()).evidence?.paramsWithheld).toBe(true);
    expect(agentAuditRow(scrubbedEvent()).evidence?.paramsWithheld).toBe(false);
  });

  it("걸러진 문서의 표시용 텍스트는 그대로 보인다 — 감추는 티켓이 아니다", () => {
    const row = agentAuditRow(scrubbedEvent());

    expect(row.evidence?.activityText).toBe("레드액트된 표시용 텍스트");
  });
});

describe("★정책 상수 드리프트 가드 — 렌더러 사본과 원장 권위본", () => {
  it("정책 문자열이 두 트리에서 같다", () => {
    expect(LEDGER_PARAMS_POLICY).toBe(ELECTRON_POLICY);
  });

  it("화이트리스트가 두 트리에서 같다", () => {
    expect(LEDGER_PARAM_ID_KEYS).toEqual(ELECTRON_ID_KEYS);
    expect(LEDGER_PARAM_TEXT_KEYS).toEqual(ELECTRON_TEXT_KEYS);
    expect(LEDGER_PARAM_ID_MAX_CHARS).toBe(ELECTRON_ID_MAX);
  });
});
