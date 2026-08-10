/**
 * 항목 닫기(X)의 판정 규칙 — 어느 갈래로 자원을 정리할지와, 언제 손실 경고를
 * 띄울지를 못박는다. 이 규칙이 흔들리면 (a) 렌더러가 에이전트 PTY 를 직접
 * 죽이거나 (b) 정리하려는 사용자에게 매번 모달을 되던지게 된다.
 */
import { describe, expect, it } from "vitest";
import {
  closePlanFor,
  neighborIdAfterClose,
} from "../../src/lib/agentEntryClose";

describe("closePlanFor", () => {
  it("셸 터미널은 terminal 갈래 — 확인 없이 즉시", () => {
    expect(
      closePlanFor({ id: "terminal:s1", isAgent: false, status: "running" }),
    ).toEqual({
      kind: "terminal",
      needsConfirm: false,
    });
  });

  it("작업 중 에이전트만 손실 경고를 받는다", () => {
    expect(
      closePlanFor({ id: "a1", isAgent: true, status: "running" }),
    ).toEqual({
      kind: "agent-live",
      needsConfirm: true,
    });
    // 패널이 working → running 으로 접기 전 값이 그대로 들어와도 같은 판정.
    expect(
      closePlanFor({ id: "a1", isAgent: true, status: "working" }),
    ).toEqual({
      kind: "agent-live",
      needsConfirm: true,
    });
  });

  it("idle 에이전트는 살아 있지만 즉시 닫는다 (경고 없음)", () => {
    expect(closePlanFor({ id: "a1", isAgent: true, status: "idle" })).toEqual({
      kind: "agent-live",
      needsConfirm: false,
    });
  });

  it("stopped/error 는 죽일 PTY 가 없는 갈래", () => {
    expect(
      closePlanFor({ id: "a1", isAgent: true, status: "stopped" }).kind,
    ).toBe("agent-dead");
    expect(
      closePlanFor({ id: "a1", isAgent: true, status: "error" }).kind,
    ).toBe("agent-dead");
    expect(
      closePlanFor({ id: "a1", isAgent: true, status: "stopped" }).needsConfirm,
    ).toBe(false);
  });
});

describe("neighborIdAfterClose", () => {
  const rows = [{ id: "a" }, { id: "b" }, { id: "c" }];

  it("다음 항목으로 옮긴다", () => {
    expect(neighborIdAfterClose(rows, "a")).toBe("b");
    expect(neighborIdAfterClose(rows, "b")).toBe("c");
  });

  it("마지막 항목이면 이전 항목으로", () => {
    expect(neighborIdAfterClose(rows, "c")).toBe("b");
  });

  it("하나뿐이면 null — 빈 상태로 떨어진다", () => {
    expect(neighborIdAfterClose([{ id: "only" }], "only")).toBeNull();
  });

  it("목록에 없는 id 는 null (이미 사라진 행)", () => {
    expect(neighborIdAfterClose(rows, "zzz")).toBeNull();
    expect(neighborIdAfterClose([], "a")).toBeNull();
  });
});
